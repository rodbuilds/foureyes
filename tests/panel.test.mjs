import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

test('the media browser opens straight ahead, even from a screen at the far end of 4 wide', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, T = window.T;
    T.reset('4arc', 1.6); T.fakeAll(1920, 1080);
    const left = F.slots[0], yawOf = v => Math.atan2(-v.x, -v.z) * 180 / Math.PI;
    // turn to face the far-left screen, then press FILES on it
    const leftYaw = yawOf(left.group.position);
    F.camera.position.set(0, 1.6, 0); F.camera.rotation.set(0, leftYaw * Math.PI / 180, 0, 'YXZ'); F.camera.updateMatrixWorld();
    left.action('open');
    const p = F.panel.position.clone(), facing = new F.THREE.Vector3(0, 0, 1).applyQuaternion(F.panel.quaternion);
    const res = { leftYaw, panelYaw: yawOf(p), dist: Math.hypot(p.x, p.z), facesYou: facing.dot(new F.THREE.Vector3(-p.x, 0, -p.z).normalize()) };
    F.closeBrowser(); F.camera.rotation.set(0, 0, 0);
    return res;
  });
  assert.ok(r.leftYaw > 30, `the far-left screen is well off to the side (${r.leftYaw.toFixed(0)}°)`);
  assert.ok(Math.abs(r.panelYaw) < 0.5, `the browser opened ${r.panelYaw.toFixed(1)}° off centre`);
  assert.ok(Math.abs(r.dist - 2) < 0.01, 'at the usual 2 m');
  assert.ok(r.facesYou > 0.999, 'facing you');
});
