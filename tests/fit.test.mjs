import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

// Fit all in view: at most 90° across, and no top edge more than 20° above the eyes.
const cases = [
  ['4 wide, seated, landscape', '4arc', 1.15, 1920, 1080],
  ['4 wide, seated, tall videos', '4arc', 1.15, 1080, 1920],
  ['3 wide, seated, landscape', '3arc', 1.15, 1920, 1080],
  ['3 wide, seated, tall videos', '3arc', 1.15, 1080, 1920],
  ['2x2, seated', '4grid', 1.15, 1920, 1080],
  ['2x2, standing', '4grid', 1.6, 1920, 1080],
  ['2 screens, seated', '2', 1.15, 1920, 1080],
];
for (const [name, layout, eye, w, h] of cases) {
  test(`Fit: ${name}`, async () => {
    const r = await app.run((layout, eye, w, h) => {
      const F = window.FourEyes, T = window.T;
      T.reset(layout, eye); T.fakeAll(w, h);
      F.fitInView(90);
      const v = F.visible();
      return { across: F.layoutSpan(1).h, top: F.topAngle(v), scales: v.map(s => s.scale) };
    }, layout, eye, w, h);
    assert.ok(r.across <= 90.5, `${r.across.toFixed(1)}° across`);
    assert.ok(r.top <= 20.5, `top edge ${r.top.toFixed(1)}° up`);
    for (const sc of r.scales) assert.ok(sc > 0.25, `screen shrunk to the minimum (scale ${sc})`);
  });
}

test('Fit makes one of the two limits tight (it uses the space it has)', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, T = window.T;
    T.reset('4arc', 1.15); T.fakeAll(1920, 1080); F.fitInView(90);
    return { across: F.layoutSpan(1).h, top: F.topAngle(F.visible()) };
  });
  assert.ok(r.across > 88 || r.top > 19, `neither limit reached: ${r.across.toFixed(1)}° across, ${r.top.toFixed(1)}° up`);
});

test('when nothing can fit, Fit leaves the sizes alone and says so', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, T = window.T;
    T.reset('4arc', 1.15); T.fakeAll(1920, 1080);
    const before = F.visible().map(s => s.scale);
    F.fitInView(5); // 5° can't hold four screens at any allowed size
    return { before, after: F.visible().map(s => s.scale), status: document.getElementById('status').textContent };
  });
  assert.deepEqual(r.after, r.before);
  assert.match(r.status, /cannot be made to fit/);
});
