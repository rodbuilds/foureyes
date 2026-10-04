import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

test('every setting stays in sync with its checkbox on the page, both ways', async () => {
  const keys = await app.run(() => Object.keys(window.FourEyes.SETTINGS));
  for (const k of keys) {
    const r = await app.run((k) => {
      const F = window.FourEyes, st = F.SETTINGS[k], box = document.getElementById(st.el), start = st.get();
      F.setSetting(k, !start); const afterSet = { value: st.get(), box: box.checked };
      box.click(); const afterClick = { value: st.get(), box: box.checked };
      return { start, afterSet, afterClick };
    }, k);
    assert.deepEqual(r.afterSet, { value: !r.start, box: !r.start }, `${k}: setting -> checkbox`);
    assert.deepEqual(r.afterClick, { value: r.start, box: r.start }, `${k}: checkbox -> setting`);
  }
});

test('the Settings page in the VR media browser changes settings and the layout', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, T = window.T;
    T.reset('2');
    F.openBrowser(0); F.browserClick({ id: 'settings' }); F.drawPanel();
    const rows = F.lib.rects.filter(x => x.id === 'set').map(x => x.data);
    const focusBefore = F.SETTINGS.focus.get();
    F.browserClick({ id: 'set', data: 'focus' });
    const focusAfter = F.SETTINGS.focus.get(), box = document.getElementById('focusOn').checked;
    F.browserClick({ id: 'layout', data: '3arc' });
    const res = { view: F.lib.view, rows, focusBefore, focusAfter, box, layout: F.layout(), screens: F.visible().length };
    F.browserClick({ id: 'set', data: 'focus' }); F.closeBrowser();
    return res;
  });
  assert.equal(r.view, 'settings');
  assert.deepEqual(r.rows.sort(), ['autoCrop', 'autoHide', 'cropBtn', 'curved', 'focus', 'headCursor', 'linkSize']);
  assert.equal(r.focusAfter, !r.focusBefore);
  assert.equal(r.box, r.focusAfter, 'the page checkbox followed');
  assert.equal(r.layout, '3arc'); assert.equal(r.screens, 3);
});

test('dropdowns are readable in dark mode', async () => {
  const dark = await import('./helpers.mjs').then(h => h.openApp({ darkMode: true }));
  try {
    const r = await dark.run(() => [...document.querySelectorAll('select')].map(sel => {
      const cs = getComputedStyle(sel), rgb = c => c.match(/\d+/g).slice(0, 3).map(Number);
      const lum = c => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const [a, b] = [lum(cs.color), lum(cs.backgroundColor)].sort((x, y) => y - x);
      return { id: sel.id || sel.dataset.r, contrast: (a + 0.05) / (b + 0.05) };
    }));
    assert.ok(r.length >= 3);
    for (const s of r) assert.ok(s.contrast >= 4.5, `${s.id}: contrast ${s.contrast.toFixed(1)} (needs 4.5)`);
  } finally { await dark.close(); }
});
