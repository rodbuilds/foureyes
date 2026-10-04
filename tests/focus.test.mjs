import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

test('opening FILES on a zoomed screen unzooms it, so it can\'t cut through the browser', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, T = window.T, s = F.slots[1];
    T.reset('3arc', 1.15); T.fakeAll(1920, 1080);
    F.setSetting('focus', true);
    const dist = () => s.group.position.distanceTo(new F.THREE.Vector3(0, F.eyeY(), 0));
    // you're looking at screen 2 and using its control bar, so it zooms in
    let t = performance.now();
    F.focus.set(s);
    for (let i = 0; i < 60; i++) { s.lastBarLook = t; F.updateFocus(t); t += 16; }
    const zoomed = { zoom: s.zoom, dist: dist() };
    // press FILES on that bar
    s.action('open');
    F.updateFocus(t);
    const focusAfterOpen = F.focus.get();
    for (let i = 0; i < 120; i++) { s.lastBarLook = t; F.updateFocus(t); t += 16; } // still "looking at the bar" for 2 s
    const settled = { zoom: s.zoom, dist: dist(), browserOpen: F.lib.open };
    F.closeBrowser(); F.setSetting('focus', false);
    return { zoomed, focusAfterOpen, settled, R: F.R };
  });
  assert.ok(r.zoomed.zoom > 1.4, `screen zoomed first (zoom ${r.zoomed.zoom.toFixed(2)})`);
  assert.equal(r.focusAfterOpen, null, 'focus lets go as soon as the browser opens');
  assert.equal(r.settled.browserOpen, true);
  assert.equal(r.settled.zoom, 1, 'the screen is back to normal while the browser is open');
  assert.ok(r.settled.dist > 2.5, `screen is back out at ${r.settled.dist.toFixed(2)} m, behind the browser (2 m)`);
});
