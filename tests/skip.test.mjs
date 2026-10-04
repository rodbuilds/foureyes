import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => {
  app = await openApp();
  await app.run(async () => {
    // a real, playable little video: record a canvas for a moment
    const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' }), parts = [];
    rec.ondataavailable = e => parts.push(e.data);
    const timer = setInterval(() => { x.fillStyle = `hsl(${Math.random() * 360},60%,50%)`; x.fillRect(0, 0, 64, 36); }, 50);
    rec.start(); await new Promise(r => setTimeout(r, 700)); rec.stop(); await new Promise(r => rec.onstop = r); clearInterval(timer);
    const webm = new Blob(parts, { type: 'video/webm' });
    window.good = name => ({ name, kind: 'file', key: name, file: new File([webm], name) });
    window.bad = name => ({ name, kind: 'file', key: name, file: new File(['this is not a video'], name) }); // fails like a damaged file
    window.waitFor = async (cond, ms = 6000) => { const t0 = performance.now(); while (!cond()) { if (performance.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); } };
    // remember every message a screen shows on its bar
    for (const s of window.FourEyes.slots) { const show = s.flashMsg.bind(s); s.said = []; s.flashMsg = (t, ms) => { s.said.push(t); show(t, ms); }; }
  });
});
after(async () => { await app?.close(); });

test('broken videos in a playlist are skipped, on to the next one that plays', async () => {
  const r = await app.run(async () => {
    const s = window.FourEyes.slots[0]; s.said = [];
    s.setList([bad('broken1.mp4'), bad('broken2.mp4'), good('fine.webm')], 0); s.next(0);
    await waitFor(() => s.name === 'fine.webm' && s.loaded);
    return { name: s.name, said: s.said };
  });
  assert.equal(r.name, 'fine.webm');
  assert.deepEqual(r.said, ['Can\'t play broken1, skipping', 'Can\'t play broken2, skipping']);
});

test('after PREV, broken videos are skipped backwards', async () => {
  const r = await app.run(async () => {
    const s = window.FourEyes.slots[1]; s.said = [];
    s.setList([good('first.webm'), bad('broken1.mp4'), bad('broken2.mp4'), good('last.webm')], 3); s.next(0);
    await waitFor(() => s.name === 'last.webm' && s.loaded);
    s.next(-1); // PREV
    await waitFor(() => s.name === 'first.webm' && s.loaded);
    return { name: s.name, skips: s.said.length };
  });
  assert.equal(r.name, 'first.webm', 'went back past both broken videos, not forward again');
  assert.equal(r.skips, 2);
});

test('a playlist where nothing plays stops instead of looping forever', async () => {
  const r = await app.run(async () => {
    const s = window.FourEyes.slots[2]; s.said = [];
    s.setList([bad('a.mp4'), bad('b.mp4'), bad('c.mp4')], 0); s.next(0);
    await waitFor(() => s.said.includes('Nothing in this playlist can be played'));
    const tries = s.said.length;
    await new Promise(r => setTimeout(r, 3000)); // nothing more should happen
    return { tries, later: s.said.length, said: s.said };
  });
  assert.equal(r.tries, 3, 'two skips, then it gives up: ' + r.said.join(' | '));
  assert.equal(r.later, r.tries, 'and then it stays stopped');
});

test('picking another video from the same playlist while a skip is pending cancels the skip', async () => {
  const r = await app.run(async () => {
    const s = window.FourEyes.slots[3]; s.said = [];
    s.setList([bad('broken.mp4'), good('second.webm'), good('my-choice.webm')], 0); s.next(0);
    await waitFor(() => s.said.length === 1);                   // the skip is now pending
    s.pos = 2; s.next(0);                                       // you pick another video from the same list (as the browser does)
    await new Promise(r => setTimeout(r, 2500));                // longer than the skip delay
    return { name: s.name };
  });
  assert.equal(r.name, 'my-choice.webm', 'the pending skip did not move you off your choice');
});
