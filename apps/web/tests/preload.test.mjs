import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => {
  app = await openApp();
  // two photo sets of real (tiny, generated) PNGs that the browser can actually decode
  await app.run(async () => {
    const png = async (folder, i) => {
      const c = new OffscreenCanvas(64, 32); const x = c.getContext('2d'); x.fillStyle = `hsl(${i * 40},60%,50%)`; x.fillRect(0, 0, 64, 32);
      const name = 'p' + i + '.png';
      return { name, kind: 'image', key: folder + '/' + name, folder, file: new File([await c.convertToBlob({ type: 'image/png' })], name) };
    };
    const set = async (folder, count) => ({ folder, items: await Promise.all(Array.from({ length: count }, (_, i) => png(folder, i + 1))) });
    window.SETS = [await set('A', 5), await set('B', 4)];
    window.waitFor = async (cond, ms = 5000) => { const t0 = performance.now(); while (!cond()) { if (performance.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
    window.settle = async (s) => { for (const c of s.photoCache().values()) await c.promise; }; // let preloading finish
  });
});
after(async () => { await app?.close(); });

test('photo sets: the next photos, and the next set\'s first photos, are preloaded so stepping doesn\'t wait', async () => {
  const r = await app.run(async () => {
    const F = window.FourEyes, s = F.slots[0], shown = () => s.photo && s.photo.key, cacheKeys = () => [...s.photoCache().keys()].sort();
    window.T.reset('2');
    s.endMode = 'next'; s.autoplay = true; s.sets = window.SETS; s.buildSetOrder(0); s.openSet(); // set A, then B, in order
    await waitFor(() => shown() === 'A/p1.png'); await settle(s);
    const atStart = cacheKeys();
    s.next(1); await waitFor(() => shown() === 'A/p2.png');
    const stepReady = s.fromCache;                          // it was already preloaded
    await settle(s);
    s.pos = 3; s.next(1); await waitFor(() => shown() === 'A/p5.png'); await settle(s); // last photo of set A
    const atEndOfSet = cacheKeys();
    s.next(1); await waitFor(() => shown() === 'B/p1.png');
    const crossReady = s.fromCache;                         // the next set's first photo was preloaded
    await settle(s);
    s.next(1); await waitFor(() => shown() === 'B/p2.png'); await settle(s);
    s.next(-1); await waitFor(() => shown() === 'B/p1.png');
    const prevReady = s.fromCache;                          // the previous photo was kept
    await settle(s);
    const maxCache = s.photoCache().size;
    s.leavePhoto();
    return { atStart, stepReady, atEndOfSet, crossReady, prevReady, maxCache, afterLeave: s.photoCache().size, ahead: F.PHOTO_AHEAD };
  });
  assert.deepEqual(r.atStart, ['A/p2.png', 'A/p3.png'], 'the next two photos are preloaded');
  assert.equal(r.stepReady, true, 'the next photo was ready when stepping to it');
  assert.deepEqual(r.atEndOfSet, ['A/p4.png', 'B/p1.png', 'B/p2.png'], 'at the end of a set: the previous photo and the next set\'s first two');
  assert.equal(r.crossReady, true, 'the first photo of the next set was ready');
  assert.equal(r.prevReady, true, 'going back a photo was instant');
  assert.ok(r.maxCache <= r.ahead + 1, `at most ${r.ahead + 1} photos kept besides the one showing (had ${r.maxCache})`);
  assert.equal(r.afterLeave, 0, 'leaving photos lets go of everything preloaded');
});
