import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

// what the page shows for each remembered setting
const snapshot = () => app.run(() => {
  const F = window.FourEyes;
  return {
    settings: Object.fromEntries(Object.entries(F.SETTINGS).map(([k, s]) => [k, s.get()])),
    boxes: Object.fromEntries(Object.entries(F.SETTINGS).map(([k, s]) => [k, document.getElementById(s.el).checked])),
    photoSecs: F.photoSecs(), photoBox: +document.getElementById('photoSecs').value,
    xrScale: document.getElementById('xrScale').value, layout: F.layout(),
  };
});
const DEFAULTS = { curved: true, focus: false, linkSize: false, headCursor: true, autoHide: true, cropBtn: false, autoCrop: false };

test('settings are remembered across a reload', async () => {
  await app.run(() => {
    const F = window.FourEyes;
    F.setSetting('curved', false); F.setSetting('focus', true); F.setSetting('cropBtn', true);
    F.browserClick({ id: 'psecs', data: 1 }); F.browserClick({ id: 'psecs', data: 1 }); // 5 s -> 7 s -> 10 s
    const xr = document.getElementById('xrScale'); xr.value = '1.25'; xr.dispatchEvent(new Event('change'));
    F.applyLayout('4arc');
  });
  await app.reload();
  const r = await snapshot();
  assert.deepEqual(r.settings, { ...DEFAULTS, curved: false, focus: true, cropBtn: true });
  assert.deepEqual(r.boxes, r.settings, 'the page checkboxes show the remembered values');
  assert.equal(r.photoSecs, 10); assert.equal(r.photoBox, 10);
  assert.equal(r.xrScale, '1.25');
  assert.equal(r.layout, '4arc');
  assert.deepEqual(app.errors, []);
});

test('Reset settings puts everything back, and it stays reset after a reload', async () => {
  await app.run(() => window.FourEyes.resetPrefs());
  const now = await snapshot();
  await app.reload();
  const later = await snapshot();
  for (const r of [now, later]) {
    assert.deepEqual(r.settings, DEFAULTS);
    assert.equal(r.photoSecs, 5); assert.equal(r.xrScale, '1'); assert.equal(r.layout, '2');
  }
});

test('the VR Settings page has a working RESET SETTINGS button', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes;
    F.setSetting('focus', true);
    F.openBrowser(0); F.browserClick({ id: 'settings' }); F.drawPanel();
    const hasButton = F.lib.rects.some(x => x.id === 'resetprefs');
    F.browserClick({ id: 'resetprefs' }); F.closeBrowser();
    return { hasButton, focus: F.SETTINGS.focus.get() };
  });
  assert.deepEqual(r, { hasButton: true, focus: false });
});

test('a damaged or odd save is ignored instead of breaking the page', async () => {
  for (const saved of ['{not json', JSON.stringify({ v: 1, settings: { focus: 'yes', bogus: true }, photoSecs: 999, xrScale: '9', layout: 'nope' }),
                       JSON.stringify({ v: 99, settings: { focus: true } })]) {
    await app.run((key, saved) => localStorage.setItem(key, saved), await app.run(() => window.FourEyes.PREFS_KEY), saved);
    await app.reload();
    const r = await snapshot();
    assert.deepEqual(r.settings, DEFAULTS, 'save: ' + saved);
    assert.equal(r.photoSecs, 5); assert.equal(r.xrScale, '1'); assert.equal(r.layout, '2');
  }
  assert.deepEqual(app.errors, [], 'console errors: ' + app.errors.join(' | '));
});

test('only settings are remembered: screen sizes and volumes are not', async () => {
  await app.run(() => { const F = window.FourEyes; F.sizeTo(F.slots[0], 1.5); F.slots[0].video.volume = 0.2; });
  await app.reload();
  const r = await app.run(() => { const s = window.FourEyes.slots[0]; return { scale: s.scale, volume: s.video.volume }; });
  assert.deepEqual(r, { scale: 1, volume: 1 });
});
