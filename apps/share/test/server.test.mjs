// The share server, driven over real HTTPS: pairing, what is and isn't served, listings and ranges.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { makeCertificate, needsNewCertificate } from '../src/cert.mjs';
import { loadConfig } from '../src/config.mjs';
import { parseRange, startShareServer } from '../src/server.mjs';
import { loadWebAssets, sharePage } from '../src/web-assets.mjs';

let tmp, cfg, server, base, cookie;
const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

function get(p, { headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(base + p, { method, headers, rejectUnauthorized: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body, json });
      });
    });
    req.on('error', reject); req.end();
  });
}
const authed = (p, o = {}) => get(p, { ...o, headers: { cookie, ...(o.headers || {}) } });

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fes-test-'));
  const media = path.join(tmp, 'Media'), secret = path.join(tmp, 'Secret');
  fs.mkdirSync(path.join(media, 'Trip', 'Day 1'), { recursive: true });
  fs.mkdirSync(path.join(media, '.hidden'));
  fs.mkdirSync(secret);
  fs.writeFileSync(path.join(media, 'clip.mp4'), VIDEO);
  fs.writeFileSync(path.join(media, 'notes.txt'), 'not media');
  fs.writeFileSync(path.join(media, '.private.mp4'), 'hidden');
  fs.writeFileSync(path.join(media, 'Trip', 'Day 1', 'beach #1.jpg'), 'jpeg');
  fs.writeFileSync(path.join(secret, 'secret.mp4'), 'outside');
  fs.utimesSync(path.join(media, 'Trip', 'Day 1', 'beach #1.jpg'), new Date('2025-06-01'), new Date('2025-06-01'));
  // a link inside the shared folder pointing out of it (junctions need no admin rights on Windows)
  try { fs.symlinkSync(secret, path.join(media, 'escape'), 'junction'); } catch {}

  cfg = loadConfig(path.join(tmp, 'config'));
  cfg.addFolder(media);
  cfg.data.tls = makeCertificate();
  server = await startShareServer(cfg, loadWebAssets(), { port: 0, host: '127.0.0.1' });
  base = 'https://127.0.0.1:' + server.address().port;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('an unpaired device gets the "not paired" page and no data', async () => {
  const page = await get('/');
  assert.equal(page.status, 401);
  assert.match(page.body.toString(), /isn't paired yet/);
  for (const p of ['/api/share', '/api/list?path=' + cfg.data.folders[0].id, '/media/' + cfg.data.folders[0].id + '/clip.mp4', '/vendor/three.min.js']) {
    const r = await get(p);
    assert.equal(r.status, 401, p);
  }
});

test('a wrong pairing key is refused, and repeated guessing locks pairing for a while', async () => {
  const r = await get('/pair/wrongkey');
  assert.equal(r.status, 403);
  assert.ok(!r.headers['set-cookie']);
  for (let i = 0; i < 9; i++) await get('/pair/guess' + i);
  const locked = await get('/pair/' + cfg.data.pairKey); // even the right key, while locked
  assert.equal(locked.status, 429);
});

test('the right pairing key gives a secure, http-only cookie and only a hash is stored', async (t) => {
  // a fresh handler (the lock above is per server), sharing the same config
  const s2 = await startShareServer(cfg, loadWebAssets(), { port: 0, host: '127.0.0.1' });
  t.after(() => s2.close());
  const saved = base; base = 'https://127.0.0.1:' + s2.address().port;
  try {
    const r = await get('/pair/' + cfg.data.pairKey.toUpperCase()); // case doesn't matter when typing it
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/');
    const c = r.headers['set-cookie'][0];
    assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Strict/);
    cookie = c.split(';')[0];
    const token = cookie.split('=')[1];
    const stored = fs.readFileSync(cfg.file, 'utf8');
    assert.ok(!stored.includes(token), 'the cookie itself is not written to disk');
    assert.ok(stored.includes(crypto.createHash('sha256').update(token).digest('hex')));
  } finally { base = saved; }
});

test('a paired device gets the page, served without any CDN', async () => {
  const r = await authed('/');
  assert.equal(r.status, 200);
  const html = r.body.toString();
  assert.match(html, /<meta name="four-eyes-share" content="1">/);
  assert.match(html, /src="vendor\/three\.min\.js"/);
  assert.doesNotMatch(html, /googleapis|gstatic|cdnjs/);
  assert.equal((await authed('/vendor/three.min.js')).status, 200);
  const css = (await authed('/vendor/fonts.css')).body.toString();
  for (const m of css.matchAll(/url\(([^)]+)\)/g)) assert.equal((await authed('/vendor/' + m[1])).status, 200, m[1]);
  assert.equal(r.headers['x-frame-options'], 'DENY');
});

test('the share lists its folders by id and name, never their paths on the PC', async () => {
  const r = await authed('/api/share');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.folders, [{ id: cfg.data.folders[0].id, name: 'Media' }]);
  assert.ok(!r.body.toString().includes(tmp.replace(/\\/g, '\\\\')));
});

test('a listing has only videos, photos and folders, without hidden ones', async () => {
  const id = cfg.data.folders[0].id;
  const r = await authed('/api/list?path=' + id);
  const names = r.json.entries.map(e => e.name).sort();
  assert.ok(names.includes('clip.mp4') && names.includes('Trip'));
  assert.ok(!names.includes('notes.txt') && !names.includes('.private.mp4') && !names.includes('.hidden'));
  assert.ok(!names.includes('escape'), 'a link leading out of the share is not listed');
  const clip = r.json.entries.find(e => e.name === 'clip.mp4');
  assert.equal(clip.kind, 'file'); assert.equal(clip.size, VIDEO.length); assert.equal(typeof clip.mtime, 'number');
  const deep = await authed('/api/list?path=' + encodeURIComponent(id + '/Trip/Day 1'));
  assert.deepEqual(deep.json.entries.map(e => [e.name, e.kind]), [['beach #1.jpg', 'image']]);
  const latest = await authed('/api/latest?path=' + encodeURIComponent(id + '/Trip'));
  assert.equal(latest.json.mtime, new Date('2025-06-01').getTime(), 'a folder dates from its newest photo, one level down');
});

test('nothing outside the shared folders can be reached', async () => {
  const id = cfg.data.folders[0].id;
  const tries = [
    '/api/list?path=' + encodeURIComponent(id + '/..'),
    '/api/list?path=' + encodeURIComponent(id + '/../Secret'),
    '/api/list?path=' + encodeURIComponent(id + '/Trip/../..'),
    '/api/list?path=' + encodeURIComponent(id + '/.hidden'),
    '/api/list?path=' + encodeURIComponent('nosuchid'),
    '/media/' + id + '/%2e%2e/Secret/secret.mp4',
    '/media/' + id + '/..%2FSecret%2Fsecret.mp4',
    '/media/' + id + '/..%5CSecret%5Csecret.mp4',
    '/media/' + id + '/notes.txt',
    '/media/' + id + '/.private.mp4',
    '/media/' + id + '/escape/secret.mp4',
  ];
  for (const p of tries) {
    const r = await authed(p);
    assert.ok(r.status >= 400 && r.status < 500, `${p} -> ${r.status}`);
    assert.ok(!r.body.toString().includes('outside'), p);
  }
});

test('media is served whole, or by range for seeking', async () => {
  const id = cfg.data.folders[0].id;
  const whole = await authed('/media/' + id + '/clip.mp4');
  assert.equal(whole.status, 200);
  assert.equal(whole.headers['content-type'], 'video/mp4');
  assert.equal(whole.headers['accept-ranges'], 'bytes');
  assert.deepEqual(whole.body, VIDEO);
  const part = await authed('/media/' + id + '/clip.mp4', { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], 'bytes 100-199/1000');
  assert.deepEqual(part.body, VIDEO.subarray(100, 200));
  const tail = await authed('/media/' + id + '/clip.mp4', { headers: { range: 'bytes=-10' } });
  assert.deepEqual(tail.body, VIDEO.subarray(990));
  const open = await authed('/media/' + id + '/clip.mp4', { headers: { range: 'bytes=900-' } });
  assert.equal(open.headers['content-range'], 'bytes 900-999/1000');
  const bad = await authed('/media/' + id + '/clip.mp4', { headers: { range: 'bytes=5000-' } });
  assert.equal(bad.status, 416);
  const photo = await authed('/media/' + id + '/Trip/Day%201/beach%20%231.jpg');
  assert.equal(photo.status, 200); assert.equal(photo.headers['content-type'], 'image/jpeg');
});

test('only GET and HEAD are answered', async () => {
  assert.equal((await authed('/api/share', { method: 'POST' })).status, 405);
  const head = await authed('/media/' + cfg.data.folders[0].id + '/clip.mp4', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers['content-length'], '1000'); assert.equal(head.body.length, 0);
});

test('forgetting devices locks out the paired cookie and the old pairing link', async () => {
  const oldKey = cfg.data.pairKey;
  cfg.forgetDevices();
  assert.notEqual(cfg.data.pairKey, oldKey);
  assert.equal((await authed('/api/share')).status, 401);
});

test('parseRange handles the forms browsers send', () => {
  assert.deepEqual(parseRange('bytes=0-', 10), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=2-4', 10), { start: 2, end: 4 });
  assert.deepEqual(parseRange('bytes=2-400', 10), { start: 2, end: 9 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.equal(parseRange('bytes=0-1,4-5', 10), null);
  assert.equal(parseRange(undefined, 10), null);
  assert.deepEqual(parseRange('bytes=10-', 10), { invalid: true });
});

test('the certificate names the PC, verifies, and is renewed before it runs out', () => {
  const tls = makeCertificate({ hosts: ['localhost', 'mypc.local'], ips: ['127.0.0.1', '192.168.1.20', 'fe80::1'] });
  const x = new crypto.X509Certificate(tls.cert);
  assert.ok(x.verify(x.publicKey), 'self-signed signature checks out');
  assert.ok(x.checkPrivateKey(crypto.createPrivateKey(tls.key)));
  assert.ok(x.checkHost('mypc.local')); assert.ok(x.checkIP('192.168.1.20')); assert.ok(x.checkIP('FE80:0:0:0:0:0:0:1'));
  assert.equal(x.ca, false);
  assert.equal(needsNewCertificate(tls), false);
  assert.equal(needsNewCertificate(tls, new Date(Date.now() + 820 * 86400e3)), true);
  assert.equal(needsNewCertificate(null), true);
});

test('the page rewrite refuses to start if the page no longer matches', () => {
  assert.throws(() => sharePage('<html><head><meta charset="utf-8"></head></html>'), /has changed/);
});
