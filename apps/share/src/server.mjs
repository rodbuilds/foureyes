// The HTTPS server the Quest talks to. It serves the Four Eyes page, a JSON listing of the shared
// folders, and the videos and photos in them (with range requests, so seeking works).
//
// Privacy: nothing is served to a device until it has been paired. Pairing means opening
// /pair/<key> once, with the key shown in the control panel on this PC; the device then gets a
// cookie. Only videos and photos inside the shared folders are ever served: no other files, no
// hidden files, nothing reached through "..", and nothing a link inside a shared folder points
// outside it to.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|ogv)$/i;
export const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|jps)$/i;
export const hiddenName = n => n.startsWith('.') || n.startsWith('$') || n === 'System Volume Information';

const TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', // Chrome plays most .mov files (H.264) when told they're MP4
  webm: 'video/webm', mkv: 'video/webm', ogv: 'video/ogg', // Chrome plays Matroska through its WebM support
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jps: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
};
const kindOf = name => VIDEO_EXT.test(name) ? 'file' : IMAGE_EXT.test(name) ? 'image' : null;

const COOKIE = 'fes';
const COOKIE_DAYS = 400; // the most Chrome allows

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// "<folder id>/<sub>/<folders>/<file>" -> absolute path inside that shared folder, or an error.
// The real path (links followed) must still be inside the folder's own real path.
export async function resolveShared(folders, rel) {
  const parts = String(rel || '').split('/');
  const folder = folders.find(f => f.id === parts[0]);
  if (!folder) throw new HttpError(404, 'No such shared folder.');
  for (const p of parts.slice(1)) {
    if (!p || p === '.' || p === '..' || /[\\:\0]/.test(p) || hiddenName(p)) throw new HttpError(400, 'Bad path.');
  }
  const abs = path.join(folder.path, ...parts.slice(1));
  let real, rootReal;
  try {
    [real, rootReal] = await Promise.all([fsp.realpath(abs), fsp.realpath(folder.path)]);
  } catch {
    throw new HttpError(404, 'Not found.');
  }
  if (real !== rootReal && !real.startsWith(rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep)) throw new HttpError(403, 'Outside the shared folder.');
  return { folder, abs: real, root: rootReal };
}

// One folder's videos, photos and subfolders. Dates are milliseconds, like File.lastModified.
// Links that lead outside root (the shared folder's real path) are left out.
export async function listFolder(abs, root) {
  const dirents = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  await Promise.all(dirents.map(async d => {
    if (hiddenName(d.name)) return;
    let isDir = d.isDirectory(), isFile = d.isFile();
    if (d.isSymbolicLink()) { // follow links to see what they are, and where they lead
      try {
        const real = await fsp.realpath(path.join(abs, d.name));
        if (root && !real.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) return;
        const st = await fsp.stat(real); isDir = st.isDirectory(); isFile = st.isFile();
      } catch { return; }
    }
    if (isDir) { out.push({ name: d.name, kind: 'dir' }); return; }
    const kind = isFile && kindOf(d.name);
    if (!kind) return;
    try {
      const st = await fsp.stat(path.join(abs, d.name));
      out.push({ name: d.name, kind, size: st.size, mtime: Math.round(st.mtimeMs) });
    } catch { /* gone, or unreadable */ }
  }));
  return out;
}

// A folder's date, as the page works it out for local folders: its newest video or photo, looking in
// the folder and one level of subfolders.
export async function folderLatest(abs, depth = 1) {
  let t = 0;
  let dirents;
  try { dirents = await fsp.readdir(abs, { withFileTypes: true }); } catch { return 0; }
  for (const d of dirents) {
    if (hiddenName(d.name)) continue;
    const p = path.join(abs, d.name);
    if (d.isDirectory()) { if (depth > 0) t = Math.max(t, await folderLatest(p, depth - 1)); }
    else if (kindOf(d.name)) { try { t = Math.max(t, Math.round((await fsp.stat(p)).mtimeMs)); } catch {} }
  }
  return t;
}

// Parse a single "bytes=a-b" range; null for none or one we don't handle (multiple ranges).
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { // the last N bytes
    const n = Number(m[2]); if (!n) return { invalid: true };
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return { invalid: true };
  return { start, end };
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}
const sendJson = (res, status, obj) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store' });

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function page(title, html) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>body{font:18px/1.5 system-ui,sans-serif;max-width:40em;margin:3em auto;padding:0 16px;background:#111;color:#eee}
code{background:#222;padding:2px 6px;border-radius:4px}h1{font-size:1.6em}</style></head><body>${html}</body></html>`;
}
const LOCKED = page('Four Eyes Share', `<h1>Four Eyes Share</h1>
<p>This device isn't paired yet. On the PC, open the Four Eyes Share window and open the <b>pairing link</b> it shows
(it ends in <code>/pair/…</code>) on this device. You only need to do this once.</p>`);
const BAD_KEY = page('Four Eyes Share', `<h1>That pairing link didn't work</h1>
<p>It may be mistyped, or the devices were forgotten on the PC, which makes a new link. Check the Four Eyes Share window on the PC for the current one.</p>`);

// Limits guessing at the pairing key: after MAX_MISSES wrong keys in a minute, pairing pauses for a minute.
const MAX_MISSES = 10;
function missCounter() {
  let misses = [], lockedUntil = 0;
  return {
    locked: (now = Date.now()) => now < lockedUntil,
    miss(now = Date.now()) {
      misses = misses.filter(t => now - t < 60_000); misses.push(now);
      if (misses.length >= MAX_MISSES) { lockedUntil = now + 60_000; misses = []; }
    },
  };
}

// The request handler, separate from the server so tests can drive it. cfg is from loadConfig;
// assets from loadWebAssets.
export function createShareHandler(cfg, assets, { log = () => {} } = {}) {
  const pairing = missCounter();
  return async function handle(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      const url = new URL(req.url, 'https://share.invalid');
      const p = url.pathname;

      // pairing: the key from the control panel trades for a long-lived cookie for this device
      if (p.startsWith('/pair/')) {
        if (pairing.locked()) { send(res, 429, 'text/html; charset=utf-8', BAD_KEY); return; }
        const key = decodeURIComponent(p.slice(6)).trim().toLowerCase();
        if (!key || key !== cfg.data.pairKey) { pairing.miss(); log('pairing refused'); send(res, 403, 'text/html; charset=utf-8', BAD_KEY); return; }
        const token = cfg.addDevice(req.headers['user-agent']);
        log('paired a device: ' + (req.headers['user-agent'] || 'unknown browser'));
        res.writeHead(303, { ...BASE_HEADERS, Location: '/',
          'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict` });
        res.end(); return;
      }

      if (p === '/favicon.ico') { res.writeHead(204, BASE_HEADERS); res.end(); return; } // the page has none; avoid a logged 404

      if (!cfg.hasDevice(cookies(req)[COOKIE])) {
        if (p === '/' || p === '/index.html') { send(res, 401, 'text/html; charset=utf-8', LOCKED); return; }
        throw new HttpError(401, 'This device isn\'t paired.');
      }

      const asset = assets.get(p === '/' ? 'index.html' : p.slice(1));
      if (asset) { send(res, 200, asset.type, asset.body, { 'Cache-Control': 'no-cache' }); return; }

      if (p === '/api/share') {
        sendJson(res, 200, { name: os.hostname(), folders: cfg.data.folders.map(f => ({ id: f.id, name: f.name })) });
        return;
      }
      if (p === '/api/list') {
        const { abs, root } = await resolveShared(cfg.data.folders, url.searchParams.get('path'));
        let entries;
        try { entries = await listFolder(abs, root); } catch { throw new HttpError(404, 'Couldn\'t read this folder.'); }
        sendJson(res, 200, { entries }); return;
      }
      if (p === '/api/latest') {
        const { abs } = await resolveShared(cfg.data.folders, url.searchParams.get('path'));
        sendJson(res, 200, { mtime: await folderLatest(abs) }); return;
      }
      if (p.startsWith('/media/')) { await sendMedia(req, res, cfg, p.slice(7)); return; }
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) log('error: ' + (e.stack || e));
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong on the PC.' : e.message });
      else res.destroy();
    }
  };
}

async function sendMedia(req, res, cfg, encoded) {
  let rel;
  try { rel = encoded.split('/').map(decodeURIComponent).join('/'); } catch { throw new HttpError(400, 'Bad path.'); }
  const { abs } = await resolveShared(cfg.data.folders, rel);
  const kind = kindOf(abs);
  if (!kind) throw new HttpError(404, 'Not found.');
  const st = await fsp.stat(abs).catch(() => null);
  if (!st || !st.isFile()) throw new HttpError(404, 'Not found.');
  const size = st.size;
  const headers = {
    ...BASE_HEADERS,
    'Content-Type': TYPES[path.extname(abs).slice(1).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': 'private, no-cache',
  };
  const range = parseRange(req.headers.range, size);
  if (range && range.invalid) {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }); res.end(); return;
  }
  const start = range ? range.start : 0, end = range ? range.end : size - 1;
  res.writeHead(range ? 206 : 200, {
    ...headers,
    'Content-Length': size ? end - start + 1 : 0,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  });
  if (req.method === 'HEAD' || !size) { res.end(); return; }
  try {
    await pipeline(fs.createReadStream(abs, { start, end }), res);
  } catch {
    // the headset stopped reading (seeking, or a new video): nothing to do
  }
}

// Start listening on every network interface, so the Quest can reach it over Wi-Fi.
export function startShareServer(cfg, assets, { port = cfg.data.port, host = '0.0.0.0', log } = {}) {
  const server = https.createServer({ cert: cfg.data.tls.cert, key: cfg.data.tls.key }, createShareHandler(cfg, assets, { log }));
  server.keepAliveTimeout = 30_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server); });
  });
}

// This PC's addresses on the local network, the likeliest home-network one first.
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  const rank = ip => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b));
}
