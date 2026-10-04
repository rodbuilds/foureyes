import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

// Border detection runs on small greyscale samples (CW x CH). Each case builds n synthetic frames:
// f(x, y, k) -> brightness for pixel (x, y) of frame k. Bars are 15% wide on each side unless noted.
const cases = [
  ['dark-grey noisy bars are cut', 'side ? 42 + (rnd() * 6 - 3) : moving', 6, { l: .153, r: .153, t: 0, b: 0 }],
  ['mid-grey bars are cut', 'side ? 120 : moving', 6, { l: .153, r: .153, t: 0, b: 0 }],
  ['off-white bars are cut', 'side ? 205 + (rnd() * 4 - 2) : moving', 6, { l: .153, r: .153, t: 0, b: 0 }],
  ['a still, textured room beside a moving dancer is kept', 'side ? 80 + tex * 0.6 : moving', 6, { l: 0, r: 0, t: 0, b: 0 }],
  ['plain dark sides that flicker (a night scene) are kept', 'side ? 8 + k * 6 : moving', 6, { l: 0, r: 0, t: 0, b: 0 }],
  ['a fade to black counts as blank (try again later)', '3', 6, null],
  ['a still shot with pure black bars is cut', 'side ? 2 : 60 + tex', 6, { l: .153, r: .153, t: 0, b: 0 }],
  ['paused, one frame: near-black bars are cut', 'side ? 30 : 60 + tex', 1, { l: .153, r: .153, t: 0, b: 0 }],
  ['paused, one frame: mid-grey bars are kept (can\'t tell)', 'side ? 120 : 60 + tex', 1, { l: 0, r: 0, t: 0, b: 0 }],
  ['grey letterbox top and bottom is cut', '(y < 10 || y >= 80) ? 50 : moving', 6, { l: 0, r: 0, t: .117, b: .117 }],
];
for (const [name, expr, frames, want] of cases) {
  test(`crop: ${name}`, async () => {
    const got = await app.run((expr, frames) => {
      const F = window.FourEyes, W = F.CW, H = F.CH;
      let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const f = new Function('x', 'y', 'k', 'rnd', 'side', 'tex', 'moving', 'return ' + expr);
      const S = Array.from({ length: frames }, (_, k) => {
        const L = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
          L[y * W + x] = f(x, y, k, rnd, x < 24 || x >= 136, ((x * 73856093) ^ (y * 19349663)) % 97, 60 + ((x * 7 + y * 3 + k * 37) % 120));
        return L;
      });
      return F.findBorders(S);
    }, expr, frames);
    if (want === null) return assert.equal(got, null);
    for (const k of ['l', 'r', 't', 'b']) assert.ok(Math.abs(got[k] - want[k]) < 0.015, `${k}: got ${got[k]}, want ${want[k]}`);
  });
}

test('cropping empty sides makes the picture bigger in a tall layout (3 wide)', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, T = window.T, s = F.slots[0], size = () => ({ w: s.dims.vw, h: s.dims.h - 0.07 });
    T.reset('3arc'); T.fake(0, 1920, 1080);
    const before = size();
    s.setCrop({ l: 0.125, r: 0.125, t: 0, b: 0 }); // a 4:3 picture inside a 16:9 frame
    return { before, after: size() };
  });
  assert.ok(r.after.w <= r.before.w + 1e-9, 'no wider');
  assert.ok(r.after.h > r.before.h * 1.3, `the picture grew taller: ${r.before.h.toFixed(2)} -> ${r.after.h.toFixed(2)} m`);
});
