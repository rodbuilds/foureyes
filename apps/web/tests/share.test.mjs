// PC Share end to end: Four Eyes Share (apps/share) serves a temporary folder, and the page is opened
// from it the way a Quest would open it: pair once, then browse, play and shuffle from the PC.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openApp } from './helpers.mjs';
import { makeCertificate } from '../../share/src/cert.mjs';
import { loadConfig } from '../../share/src/config.mjs';
import { startShareServer } from '../../share/src/server.mjs';
import { loadWebAssets } from '../../share/src/web-assets.mjs';

// a small solid-colour PNG
function png(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

let tmp, media, cfg, server, base, app;
const requests = [];

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-share-'));
  media = path.join(tmp, 'Media');
  for (const d of ['Clips', 'Photos/Set A', 'Photos/Set B']) fs.mkdirSync(path.join(media, d), { recursive: true });
  fs.writeFileSync(path.join(media, 'Photos/Set A/a1.png'), png(64, 36, [200, 30, 30]));
  fs.writeFileSync(path.join(media, 'Photos/Set A/a2.png'), png(64, 36, [30, 200, 30]));
  fs.writeFileSync(path.join(media, 'Photos/Set B/b1.png'), png(36, 64, [30, 30, 200]));
  fs.utimesSync(path.join(media, 'Photos'), new Date('2020-01-01'), new Date('2020-01-01'));
  fs.utimesSync(path.join(media, 'Photos/Set A/a1.png'), new Date('2021-01-01'), new Date('2021-01-01'));
  fs.utimesSync(path.join(media, 'Photos/Set A/a2.png'), new Date('2021-01-01'), new Date('2021-01-01'));
  fs.utimesSync(path.join(media, 'Photos/Set B/b1.png'), new Date('2021-01-01'), new Date('2021-01-01'));

  cfg = loadConfig(path.join(tmp, 'config'));
  cfg.addFolder(media);
  cfg.data.tls = makeCertificate();
  server = await startShareServer(cfg, loadWebAssets(), { port: 0, host: '127.0.0.1' });
  base = 'https://127.0.0.1:' + server.address().port;

  app = await openApp({
    url: base + '/',
    before: async page => {
      page.on('request', r => requests.push(r.url()));
      await page.goto(base + '/', { waitUntil: 'load' }); // as on a Quest: the code page, then type the code
      await page.type('input[name=code]', cfg.data.pairCode);
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('form button')]);
    },
  });

  // two real little videos for the Clips folder, recorded in the page and written to the PC's folder
  const webm = await app.run(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' }), parts = [];
    rec.ondataavailable = e => parts.push(e.data);
    const timer = setInterval(() => { x.fillStyle = `hsl(${Math.random() * 360},60%,50%)`; x.fillRect(0, 0, 64, 36); }, 50);
    rec.start(); await new Promise(r => setTimeout(r, 1200)); rec.stop(); await new Promise(r => rec.onstop = r); clearInterval(timer);
    const buf = new Uint8Array(await new Blob(parts).arrayBuffer());
    let s = ''; for (const b of buf) s += String.fromCharCode(b); return btoa(s);
  });
  fs.writeFileSync(path.join(media, 'Clips/one.webm'), Buffer.from(webm, 'base64'));
  fs.writeFileSync(path.join(media, 'Clips/two.webm'), Buffer.from(webm, 'base64'));
  fs.utimesSync(path.join(media, 'Clips/one.webm'), new Date('2022-01-01'), new Date('2022-01-01'));
  fs.utimesSync(path.join(media, 'Clips/two.webm'), new Date('2024-01-01'), new Date('2024-01-01'));

  await app.run(() => {
    window.waitFor = async (cond, ms = 8000) => { const t0 = performance.now(); while (!cond()) { if (performance.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); } };
    // go to a folder on the share, as clicking through the browser would: go('Media', 'Clips')
    window.go = async (...names) => {
      const F = window.FourEyes, lib = F.lib;
      await waitFor(() => lib.roots.some(r => r.share));
      lib.path = [lib.roots.find(r => r.share && r.name === names[0]).node]; await F.refreshDir();
      for (const n of names.slice(1)) { const e = lib.entries.find(e => e.name === n); if (!e) throw new Error('no ' + n + ' in ' + lib.entries.map(e => e.name)); lib.path.push(e); await F.refreshDir(); }
      return lib.entries;
    };
  });
});
after(async () => {
  await app?.close(); server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('opened from Four Eyes Share, the shared folders appear as PC Share places', async () => {
  const r = await app.run(async () => {
    const F = window.FourEyes;
    await waitFor(() => F.lib.roots.some(r => r.share));
    return { share: F.SHARE, roots: F.lib.roots.map(r => [r.name, !!r.share]), status: document.getElementById('shareStatus').textContent,
      listed: document.getElementById('rootList').textContent };
  });
  assert.equal(r.share, true);
  assert.deepEqual(r.roots, [['Media', true]]);
  assert.match(r.status, /PC Share: 1 folder from /);
  assert.match(r.listed, /Media.*on the PC/);
});

test('the hosted page (not from Four Eyes Share) never asks for PC Share', async () => {
  const plain = await openApp();
  try {
    const r = await plain.run(() => ({ share: window.FourEyes.SHARE, hidden: document.getElementById('shareStatus').hidden }));
    assert.deepEqual(r, { share: false, hidden: true });
  } finally { await plain.close(); }
});

test('browsing the PC\'s folders, sorted by name or newest first', async () => {
  const r = await app.run(async () => {
    const F = window.FourEyes, lib = F.lib;
    const top = (await go('Media')).map(e => e.name);
    await go('Media', 'Clips');
    const az = lib.entries.map(e => e.name);
    F.browserClick({ id: 'sort', data: 'latest' }); await waitFor(() => lib.entries.length === 2 && lib.msg === '');
    const latest = lib.entries.map(e => e.name);
    F.browserClick({ id: 'sort', data: 'az' }); await waitFor(() => lib.entries[0]?.name === 'one.webm');
    return { top, az, latest };
  });
  assert.deepEqual(r.top, ['Clips', 'Photos']);
  assert.deepEqual(r.az, ['one.webm', 'two.webm']);
  assert.deepEqual(r.latest, ['two.webm', 'one.webm']);
});

test('a video plays streamed from the PC, and seeking works (range requests)', async () => {
  const r = await app.run(async () => {
    const F = window.FourEyes, s = F.slots[0], files = (await go('Media', 'Clips')).filter(e => e.kind === 'file');
    s.setList(files, 0); s.next(0);
    await waitFor(() => s.loaded && s.name === 'one.webm');
    const v = s.video;
    await v.play().catch(() => {});
    v.currentTime = 0.5; await new Promise(res => v.addEventListener('seeked', res, { once: true }));
    s.next(1); await waitFor(() => s.loaded && s.name === 'two.webm');
    return { src: v.currentSrc, w: v.videoWidth, list: s.list.length, url: s.url };
  });
  assert.match(r.src, /\/media\/[0-9a-f]+\/Clips\/two\.webm$/);
  assert.equal(r.w, 64);
  assert.equal(r.list, 2, 'the rest of the folder is the playlist');
  assert.ok(!r.url, 'streamed, not downloaded into a blob');
});

test('thumbnails are made from the PC\'s videos and photos', async () => {
  const r = await app.run(async () => {
    const F = window.FourEyes, lib = F.lib;
    F.openBrowser(0); lib.sort = 'az';
    await go('Media', 'Clips');
    const keys = lib.entries.map(e => e.key);
    await waitFor(() => keys.every(k => ['done', 'fail'].includes(F.thumbs.get(k)?.state)), 20000);
    await go('Media', 'Photos', 'Set A');
    const pkeys = lib.entries.map(e => e.key);
    await waitFor(() => pkeys.every(k => ['done', 'fail'].includes(F.thumbs.get(k)?.state)), 20000);
    F.closeBrowser();
    return [...keys, ...pkeys].map(k => F.thumbs.get(k).state);
  });
  assert.deepEqual(r, ['done', 'done', 'done', 'done']);
});

test('SHUFFLE ALL plays the PC\'s photos as sets', async () => {
  const r = await app.run(async () => {
    const F = window.FourEyes, lib = F.lib, s = F.slots[1];
    F.openBrowser(1); lib.path = []; await F.refreshDir();
    s.playKind = lib.kind = 'image';
    await F.shuffleAll();
    await waitFor(() => s.photo && s.loaded);
    return { sets: s.sets.map(x => [x.folder, x.items.length]).sort(), name: s.name };
  });
  assert.deepEqual(r.sets, [['Set A', 2], ['Set B', 1]]);
  assert.match(r.name, /^(a1|a2|b1)\.png$/);
});

test('↻ picks up folders shared on the PC since the page opened', async () => {
  fs.mkdirSync(path.join(tmp, 'More'));
  cfg.addFolder(path.join(tmp, 'More')); // as the control panel does
  const r = await app.run(async () => {
    const F = window.FourEyes;
    F.openBrowser(0); F.browserClick({ id: 'refresh' });
    await waitFor(() => F.lib.roots.filter(r => r.share).length === 2);
    F.closeBrowser();
    return F.lib.roots.filter(r => r.share).map(r => r.name);
  });
  assert.deepEqual(r, ['Media', 'More']);
});

test('nothing is requested from anywhere but the PC, and the page has no errors', async () => {
  const outside = requests.filter(u => !u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:'));
  assert.deepEqual(outside, []);
  assert.deepEqual(app.errors, []);
});
