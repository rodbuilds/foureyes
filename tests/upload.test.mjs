import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

// a photo, red top half and blue bottom half. 1024x640 (5 strips): the software renderer the tests
// run on (no GPU in CI) loses its WebGL context on 4096-pixel textures, whichever way they are
// uploaded; on a real GPU full-size photos upload fine (checked by hand on a GTX 1070).
const makePhoto = () => app.run(async () => {
  const c = new OffscreenCanvas(1024, 640), x = c.getContext('2d');
  x.fillStyle = '#ff0000'; x.fillRect(0, 0, 1024, 320); x.fillStyle = '#0000ff'; x.fillRect(0, 320, 1024, 320);
  window.BMP = await createImageBitmap(c);
});

test('a photo goes to the graphics card one strip per frame, and arrives intact', async () => {
  await makePhoto();
  const r = await app.run(async () => {
    const F = window.FourEyes, perFrame = [];
    let last = 0, watching = true;
    const watch = () => { // how many strips went up between one frame and the next
      const j = F.uploads[0]; const done = j ? j.i : last;
      if (done >= last) perFrame.push(done - last); last = done;
      if (watching) requestAnimationFrame(watch);
    };
    const pending = F.photoTexture(window.BMP);
    requestAnimationFrame(watch);
    const t = await pending; watching = false;
    // read the finished texture back: first row, middle rows, last row
    const gl = F.renderer.getContext(), fb = gl.createFramebuffer(), tex = F.renderer.properties.get(t).__webglTexture;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const px = y => { const b = new Uint8Array(4); gl.readPixels(512, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return Array.from(b.slice(0, 3)); };
    const rows = { first: px(0), aboveMiddle: px(319), belowMiddle: px(320), last: px(639) };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); F.renderer.state.reset();
    return { strips: Math.ceil(640 / F.UPLOAD_ROWS), maxPerFrame: Math.max(...perFrame), frames: perFrame.filter(x => x > 0).length, rows, left: F.uploads.length };
  });
  assert.equal(r.strips, 5);
  assert.equal(r.maxPerFrame, 1, 'never more than one strip in a frame');
  assert.ok(r.frames >= 4, `spread over ${r.frames} frames`);
  // texture row 0 is the top of the photo (the screens flip it back when drawing)
  assert.deepEqual(r.rows.first, [255, 0, 0]); assert.deepEqual(r.rows.aboveMiddle, [255, 0, 0]);
  assert.deepEqual(r.rows.belowMiddle, [0, 0, 255]); assert.deepEqual(r.rows.last, [0, 0, 255]);
  assert.equal(r.left, 0);
});

test('a photo that is let go of halfway through stops uploading cleanly', async () => {
  await makePhoto();
  const r = await app.run(async () => {
    const F = window.FourEyes;
    const pending = F.photoTexture(window.BMP);
    await new Promise(res => { const wait = () => (F.uploads[0] && F.uploads[0].i >= 3) ? res() : requestAnimationFrame(wait); wait(); });
    F.uploads[0].t.dead = true; // what letting go of a preloaded photo does
    await pending;
    return { left: F.uploads.length };
  });
  assert.equal(r.left, 0);
  assert.deepEqual(app.errors, []);
});

test('after the graphics context is lost and restored, the photo on screen is sent again', async () => {
  await makePhoto();
  const r = await app.run(async () => {
    const F = window.FourEyes, s = F.slots[0], gl = F.renderer.getContext();
    window.T.reset('2');
    // show the red/blue test photo on screen 1
    const blob = await (async () => { const c = new OffscreenCanvas(1024, 640), x = c.getContext('2d');
      x.fillStyle = '#ff0000'; x.fillRect(0, 0, 1024, 320); x.fillStyle = '#0000ff'; x.fillRect(0, 320, 1024, 320); return c.convertToBlob(); })();
    s.setList([{ name: 'photo.png', kind: 'image', key: 'photo.png', file: new File([blob], 'photo.png') }], 0);
    s.next(0);
    const until = async c => { const t0 = performance.now(); while (!c()) { if (performance.now() - t0 > 15000) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); } };
    await until(() => s.cur && s.cur.tex && s.photo && s.photo.key === 'photo.png');
    const before = s.cur.tex;
    const lose = gl.getExtension('WEBGL_lose_context');
    // restoring only works once the "lost" event has been delivered, a moment after the loss itself
    const lostEvent = new Promise(r => F.renderer.domElement.addEventListener('webglcontextlost', r, { once: true }));
    lose.loseContext(); await lostEvent; await new Promise(r => setTimeout(r, 50));
    lose.restoreContext(); await until(() => !gl.isContextLost());
    await until(() => s.cur.tex !== before && F.uploads.length === 0);
    const tex = F.renderer.properties.get(s.cur.tex).__webglTexture, fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const q = new Uint8Array(4); gl.readPixels(512, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, q);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); F.renderer.state.reset();
    const onScreen = s.mono.material.map === s.cur.tex;
    s.leavePhoto();
    return { top: Array.from(q.slice(0, 3)), onScreen };
  });
  assert.deepEqual(r.top, [255, 0, 0], 'the photo came back with its pixels');
  assert.equal(r.onScreen, true, 'and the screen shows the re-sent photo');
});
