import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

test('the page starts without errors and builds all four screens', async () => {
  const r = await app.run(() => ({
    cards: document.querySelectorAll('.card').length,
    title: document.title,
    screens: window.FourEyes.slots.length,
    layout: window.FourEyes.layout(),
  }));
  assert.equal(r.cards, 4);
  assert.equal(r.screens, 4);
  assert.equal(r.title, 'Four Eyes');
  assert.equal(r.layout, '2');
  assert.deepEqual(app.errors, [], 'console errors: ' + app.errors.join(' | '));
});

test('settings start at their defaults', async () => {
  const r = await app.run(() => Object.fromEntries(Object.entries(window.FourEyes.SETTINGS).map(([k, s]) => [k, s.get()])));
  assert.deepEqual(r, { curved: true, focus: false, linkSize: false, headCursor: true, autoHide: true, cropBtn: false, autoCrop: false });
});

test('a normal visit (no ?test) does not expose the internals', async () => {
  const plain = await openApp({ query: '' });
  try {
    assert.equal(await plain.run(() => typeof window.FourEyes), 'undefined');
    assert.deepEqual(plain.errors, []);
  } finally { await plain.close(); }
});
