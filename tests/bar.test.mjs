import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

const ORDER = ['open', 'prev', 'back', 'play', 'fwd', 'next', 'mute', 'vdn', 'vup', 'solo', 'sdn', 'sup', 'loop', 'swap'];

test('the control bar\'s buttons fit inside it without overlapping', async () => {
  for (const cropOn of [false, true]) {
    const r = await app.run((cropOn) => {
      const F = window.FourEyes; F.setSetting('cropBtn', cropOn);
      return { bw: F.BW, buttons: F.barButtons().map(b => ({ id: b.id, x: b.x, w: b.w })) };
    }, cropOn);
    const want = cropOn ? [...ORDER.slice(0, 12), 'crop', ...ORDER.slice(12)] : ORDER;
    assert.deepEqual(r.buttons.map(b => b.id), want);
    for (let i = 1; i < r.buttons.length; i++) assert.ok(r.buttons[i].x >= r.buttons[i - 1].x + r.buttons[i - 1].w, `${r.buttons[i].id} overlaps`);
    const last = r.buttons.at(-1); assert.ok(last.x + last.w <= r.bw, 'runs off the end of the bar');
  }
  await app.run(() => window.FourEyes.setSetting('cropBtn', false));
});

test('pointing at a button on the bar finds that button; the bottom row is the seek bar', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, s = F.slots[0];
    const uvAt = (x, y) => ({ x: x / F.BW, y: 1 - y / F.BH });
    const swap = F.barButtons().find(b => b.id === 'swap');
    return { button: s.hitBar(uvAt(swap.x + swap.w / 2, 50)), seek: s.hitBar(uvAt(310, F.ROW2 + 48)) };
  });
  assert.equal(r.button.id, 'swap');
  assert.equal(r.seek.id, 'seek');
  assert.ok(r.seek.frac > 0.4 && r.seek.frac < 0.6);
});

test('a hidden bar\'s buttons can\'t be pressed by accident; a showing bar\'s can', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, s = F.slots[0];
    s.video.muted = false;
    s.barMat.opacity = 0; F.activate({ kind: 'bar', slot: s, btn: { id: 'mute' } });
    const whileHidden = s.video.muted;
    s.barMat.opacity = 1; F.activate({ kind: 'bar', slot: s, btn: { id: 'mute' } });
    const whileShowing = s.video.muted; s.video.muted = false;
    return { whileHidden, whileShowing };
  });
  assert.equal(r.whileHidden, false);
  assert.equal(r.whileShowing, true);
});
