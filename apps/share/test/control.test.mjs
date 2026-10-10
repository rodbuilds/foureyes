// The control panel: reachable only as 127.0.0.1 / localhost, and changes need its own header.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCertificate } from '../src/cert.mjs';
import { loadConfig } from '../src/config.mjs';
import { startControlServer, qrSvg } from '../src/control.mjs';

let tmp, cfg, server, port;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fes-ctl-'));
  fs.mkdirSync(path.join(tmp, 'Videos')); fs.mkdirSync(path.join(tmp, 'Picked'));
  fs.mkdirSync(path.join(tmp, 'Picked', 'Trip 10')); fs.mkdirSync(path.join(tmp, 'Picked', 'Trip 9')); fs.mkdirSync(path.join(tmp, 'Picked', '.cache'));
  for (const n of ['a.mp4', 'b.MKV', 'c.jpg', 'notes.txt', '.hidden.mp4']) fs.writeFileSync(path.join(tmp, 'Picked', n), '');
  cfg = loadConfig(path.join(tmp, 'config'));
  cfg.data.tls = makeCertificate();
  server = await startControlServer(cfg, { port: 0, urls: () => ['https://192.168.1.20:8443'] });
  port = server.address().port;
  // the handler checks the Host header against the port it was given; restart on the real one
  server.close();
  server = await startControlServer(cfg, { port, urls: () => ['https://192.168.1.20:8443'] });
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const call = (p, { body, headers = {}, host } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Four-Eyes-Share': '1' }), ...(host ? { host } : {}), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('the panel and its state are served, with the pairing code and a QR code', async () => {
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const s = await (await call('/api/state')).json();
  assert.deepEqual(s.addresses, ['https://192.168.1.20:8443']);
  assert.match(s.code, /^\d{6}$/);
  assert.equal(s.code, cfg.data.pairCode);
  assert.match(s.qr, /^<svg/);
  assert.equal(s.qr, qrSvg('https://192.168.1.20:8443'), 'the QR code is the address alone: scanning it doesn\'t pair or use up the code');
  // the guidance that keeps a first-time Quest user out of the search box
  const html = await page.text();
  assert.match(html, /address bar at the very top/);
  assert.match(html, /id="copy"/);
  assert.match(html, /Check with your phone first/);
  assert.doesNotMatch(html, /replace\('https:\/\/'/, 'addresses are shown with https://');
  assert.match(s.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

test('folders are added by path, and removed', async () => {
  let s = await (await call('/api/folders/add', { body: { path: path.join(tmp, 'Videos') } })).json();
  assert.deepEqual(s.folders.map(f => f.name), ['Videos']);
  s = await (await call('/api/folders/add', { body: { path: path.join(tmp, 'Picked') } })).json();
  assert.deepEqual(s.folders.map(f => f.name), ['Videos', 'Picked']);
  const bad = await call('/api/folders/add', { body: { path: path.join(tmp, 'nope') } });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /doesn't exist/);
  s = await (await call('/api/folders/remove', { body: { id: s.folders[0].id } })).json();
  assert.deepEqual(s.folders.map(f => f.name), ['Picked']);
  assert.deepEqual(loadConfig(cfg.dir).data.folders.map(f => f.name), ['Picked'], 'saved to disk');
});

test('the folder browser starts from the usual places and the drives', async () => {
  const r = await (await call('/api/fs/roots', { body: {} })).json();
  assert.ok(r.places.some(p => p.name === 'Home'));
  assert.ok(r.drives.length >= 1);
  if (process.platform === 'win32') assert.ok(r.drives.some(d => d.path === 'C:\\'));
});

test('the folder browser lists subfolders (not hidden ones) and counts videos and photos', async () => {
  const r = await (await call('/api/fs/list', { body: { path: path.join(tmp, 'Picked') } })).json();
  assert.equal(r.path, path.join(tmp, 'Picked'));
  assert.equal(r.parent, tmp);
  assert.deepEqual(r.folders.map(f => f.name), ['Trip 9', 'Trip 10'], 'in natural order, without .cache');
  assert.deepEqual([r.videos, r.photos], [2, 1]);
  const top = await (await call('/api/fs/list', { body: { path: path.parse(tmp).root } })).json();
  assert.equal(top.parent, null, 'the top of a drive has no parent');
  const bad = await call('/api/fs/list', { body: { path: path.join(tmp, 'nope') } });
  assert.equal(bad.status, 400);
  const noHeader = await fetch(`http://127.0.0.1:${port}/api/fs/list`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ path: tmp }) });
  assert.equal(noHeader.status, 404, 'listings need the panel header too');
});

test('changes without the panel\'s header, or from another site, are refused', async () => {
  const noHeader = await fetch(`http://127.0.0.1:${port}/api/folders/add`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ path: tmp }) });
  assert.equal(noHeader.status, 404);
  const cross = await call('/api/folders/add', { body: { path: tmp }, headers: { origin: 'http://evil.example' } });
  assert.equal(cross.status, 403);
  assert.ok(!cfg.data.folders.some(f => f.path === tmp));
});

test('requests under another host name (DNS rebinding) are refused', async () => {
  const http = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/state', headers: { host: 'evil.example:' + port } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
});

test('a QR code is a well-formed SVG', () => {
  const svg = qrSvg('https://192.168.1.20:8443/pair/abcdefghjk');
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
});
