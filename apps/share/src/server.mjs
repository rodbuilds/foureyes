// The HTTPS server the Quest talks to. It serves the Four Eyes page, a JSON listing of the shared
// folders, and the videos and photos in them (with range requests, so seeking works).
//
// Privacy: nothing is served to a device until it has been paired. Pairing means typing the 6-digit
// code shown on this PC into the page an unpaired device gets (or opening /pair/<code> from the QR
// code) once; the device then gets a cookie. Only videos and photos inside the shared folders are ever served: no other files, no
// hidden files, nothing reached through "..", and nothing a link inside a shared folder points
// outside it to.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { keyframes } from './keyframes.mjs';

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
// What an unpaired device sees: a box for the code shown on the PC. note is a line above it
// (a wrong code, or pairing paused).
function pairPage(note = '') {
  return page('Pair with Four Eyes Share', `<h1>Four Eyes Share</h1>
<p>Type the <b>pairing code</b> shown in the Four Eyes Share window on your PC. You only do this once on each device.</p>
${note ? `<p class="note">${esc(note)}</p>` : ''}
<form method="post" action="/pair">
  <input name="code" inputmode="numeric" pattern="[0-9 ]*" autocomplete="one-time-code" maxlength="8" autofocus required aria-label="Pairing code" placeholder="000000">
  <button>Pair</button>
</form>
<style>form{display:flex;gap:12px;flex-wrap:wrap;margin-top:1em}
input{font:600 40px/1 ui-monospace,Consolas,monospace;letter-spacing:.25em;width:7.5em;padding:12px 16px;border-radius:10px;border:2px solid #555;background:#000;color:#fff}
button{font:600 28px system-ui,sans-serif;padding:12px 32px;border-radius:10px;border:0;background:#58a6ff;color:#000}
.note{color:#ffb4a8}</style>`);
}

// Limits guessing at the code: after MAX_MISSES wrong codes within LOCK_MS, pairing pauses for LOCK_MS.
// With 6 digits that is a million codes at 5 tries per 5 minutes: about a year to try half of them,
// and each successful pairing makes a new code anyway.
export const MAX_MISSES = 5;
const LOCK_MS = 5 * 60_000;
function missCounter() {
  let misses = [], lockedUntil = 0;
  return {
    locked: (now = Date.now()) => now < lockedUntil,
    miss(now = Date.now()) {
      misses = misses.filter(t => now - t < LOCK_MS); misses.push(now);
      if (misses.length >= MAX_MISSES) { lockedUntil = now + LOCK_MS; misses = []; }
    },
  };
}

async function readForm(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 1024) throw new HttpError(413, 'Too big.'); }
  return new URLSearchParams(body);
}

// The request handler, separate from the server so tests can drive it. cfg is from loadConfig;
// assets from loadWebAssets.
export function createShareHandler(cfg, assets, { log = () => {} } = {}) {
  const pairing = missCounter();
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'https://share.invalid');
      const p = url.pathname;
      const html = (status, body) => send(res, status, 'text/html; charset=utf-8', body, { 'Cache-Control': 'no-store' });

      // pairing: the code from the PC trades for a long-lived cookie for this device. Typed into the
      // form (POST /pair), or opened as a link from the QR code (GET /pair/<code>).
      const formPost = p === '/pair' && req.method === 'POST';
      if (formPost || (p.startsWith('/pair/') && req.method === 'GET')) {
        // the form must come from this server's own page, not another site's
        if (formPost && !['same-origin', 'none', undefined].includes(req.headers['sec-fetch-site'])) throw new HttpError(403, 'Forbidden.');
        const code = formPost ? (await readForm(req)).get('code') : decodeURIComponent(p.slice(6));
        if (pairing.locked()) { html(429, pairPage('Too many wrong codes. Pairing is paused for a few minutes; try again then.')); return; }
        const token = cfg.pair(code, req.headers['user-agent']);
        if (!token) {
          pairing.miss(); log('pairing refused: wrong code');
          html(403, pairPage('That code didn\'t work. Check the code on the PC (it changes after each device pairs).')); return;
        }
        log('Paired a device (' + (req.headers['user-agent'] || 'unknown browser') + '). Next pairing code: ' + cfg.data.pairCode.slice(0, 3) + ' ' + cfg.data.pairCode.slice(3));
        res.writeHead(303, { ...BASE_HEADERS, Location: '/',
          'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict` });
        res.end(); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');

      if (p === '/favicon.ico') { res.writeHead(204, BASE_HEADERS); res.end(); return; } // the page has none; avoid a logged 404

      if (!cfg.hasDevice(cookies(req)[COOKIE])) {
        if (p === '/' || p === '/index.html') { html(200, pairPage()); return; } // a normal page, so browsers don't log an error
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
      if (p === '/api/keyframes') { // where a video's keyframes are, so the page can jump straight to one
        const { abs } = await resolveShared(cfg.data.folders, url.searchParams.get('path'));
        if (!kindOf(abs)) throw new HttpError(404, 'Not found.');
        let times = null;
        try { times = await keyframes(abs); } catch { /* unreadable: the page just seeks normally */ }
        sendJson(res, 200, { times }); return;
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
// One port serves both: HTTPS, and plain HTTP that only redirects to HTTPS. Quest Browser assumes
// http:// when you type "192.168.1.20:8443", so this way the address works without "https://".
// The first byte tells them apart: a TLS connection starts with a handshake record (0x16).
export function startShareServer(cfg, assets, { port = cfg.data.port, host = '0.0.0.0', log } = {}) {
  const secure = https.createServer({ cert: cfg.data.tls.cert, key: cfg.data.tls.key }, createShareHandler(cfg, assets, { log }));
  secure.keepAliveTimeout = 30_000;
  const plain = http.createServer((req, res) => {
    const where = 'https://' + String(req.headers.host || '').replace(/[^\w.:[\]-]/g, '') + '/';
    res.writeHead(301, { Location: where, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('Four Eyes Share needs https: ' + where);
  });
  const server = net.createServer(socket => {
    socket.once('data', first => {
      socket.pause(); socket.unshift(first);
      (first[0] === 0x16 ? secure : plain).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
    socket.on('error', () => {});
  });
  server.on('close', () => { secure.close(); plain.close(); });
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
