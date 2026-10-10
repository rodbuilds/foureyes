// The control panel: reachable only as 127.0.0.1 / localhost, and changes need its own header.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCertificate } from '../src/cert.mjs';
import { loadConfig } from '../src/config.mjs';
import { startControlServer, qrSvg } from '../src/control.mjs';

let tmp, cfg, server, port, picked = '';

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fes-ctl-'));
  fs.mkdirSync(path.join(tmp, 'Videos')); fs.mkdirSync(path.join(tmp, 'Picked'));
  cfg = loadConfig(path.join(tmp, 'config'));
  cfg.data.tls = makeCertificate();
  server = await startControlServer(cfg, { port: 0, urls: () => ['https://192.168.1.20:8443'], pick: async () => picked });
  port = server.address().port;
  // the handler checks the Host header against the port it was given; restart on the real one
  server.close();
  server = await startControlServer(cfg, { port, urls: () => ['https://192.168.1.20:8443'], pick: async () => picked });
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
  assert.match(s.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

test('folders are added by path or with the picker, and removed', async () => {
  let s = await (await call('/api/folders/add', { body: { path: path.join(tmp, 'Videos') } })).json();
  assert.deepEqual(s.folders.map(f => f.name), ['Videos']);
  picked = path.join(tmp, 'Picked');
  s = await (await call('/api/folders/browse', { body: {} })).json();
  assert.deepEqual(s.folders.map(f => f.name), ['Videos', 'Picked']);
  picked = ''; // cancelled
  s = await (await call('/api/folders/browse', { body: {} })).json();
  assert.equal(s.folders.length, 2);
  const bad = await call('/api/folders/add', { body: { path: path.join(tmp, 'nope') } });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /doesn't exist/);
  s = await (await call('/api/folders/remove', { body: { id: s.folders[0].id } })).json();
  assert.deepEqual(s.folders.map(f => f.name), ['Picked']);
  assert.deepEqual(loadConfig(cfg.dir).data.folders.map(f => f.name), ['Picked'], 'saved to disk');
});

test('only one folder picker opens at a time', async () => {
  let finish;
  picked = new Promise(r => { finish = r; }); // the picker stays open until finish()
  const first = call('/api/folders/browse', { body: {} });
  await new Promise(r => setTimeout(r, 50));
  const second = await call('/api/folders/browse', { body: {} });
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /already open/);
  finish('');
  assert.equal((await first).status, 200);
  picked = '';
  assert.equal((await call('/api/folders/browse', { body: {} })).status, 200, 'and it can open again once closed');
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
