import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

test('a curved screen lies on the cylinder around you and covers exactly width / radius', async () => {
  const results = await app.run(() => {
    const F = window.FourEyes, THREE = F.THREE, R = F.R, out = [];
    for (const [w, yawDeg] of [[2, 18], [1.35, -40], [5, 0]]) {
      const g = new THREE.Group(), m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 48, 1)); g.add(m);
      const a = yawDeg * Math.PI / 180; g.position.set(-R * Math.sin(a), 1.5, -R * Math.cos(a)); g.lookAt(0, 1.5, 0);
      m.scale.set(w, w * 9 / 16, 1); F.bendScreen(m, w, true); g.updateMatrixWorld(true);
      const p = m.geometry.attributes.position, v = new THREE.Vector3(); let maxErr = 0;
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); maxErr = Math.max(maxErr, Math.abs(Math.hypot(v.x, v.z) - R)); }
      v.fromBufferAttribute(p, 0).applyMatrix4(m.matrixWorld); const a0 = Math.atan2(v.x, v.z);
      v.fromBufferAttribute(p, 48).applyMatrix4(m.matrixWorld); const a1 = Math.atan2(v.x, v.z);
      let da = a1 - a0; da = Math.atan2(Math.sin(da), Math.cos(da));
      F.bendScreen(m, w, false); let flat = 0; for (let i = 0; i < p.count; i++) flat = Math.max(flat, Math.abs(p.getZ(i)));
      out.push({ w, maxErr, arc: Math.abs(da) * R, flat });
    }
    return out;
  });
  for (const r of results) {
    assert.ok(r.maxErr < 1e-6, `w=${r.w}: off the cylinder by ${r.maxErr}`);
    assert.ok(Math.abs(r.arc - r.w) < 1e-6, `w=${r.w}: arc ${r.arc}`);
    assert.equal(r.flat, 0, `w=${r.w}: flattening leaves it bent`);
  }
});

test('each eye maps onto its half of a side-by-side frame, and can be re-mapped without drifting', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, g = new F.THREE.PlaneGeometry(1, 1, 4, 1);
    F.setUV(g, 0.5, 1, 0, 1); const right = Array.from(g.attributes.uv.array);
    F.setUV(g, 0, 0.5, 0, 1); F.setUV(g, 0.5, 1, 0, 1); const again = Array.from(g.attributes.uv.array);
    const us = right.filter((_, i) => i % 2 === 0);
    return { min: Math.min(...us), max: Math.max(...us), same: right.every((x, i) => Math.abs(x - again[i]) < 1e-9) };
  });
  assert.equal(r.min, 0.5); assert.equal(r.max, 1); assert.ok(r.same);
});

test('the head cursor can point at a 3D screen (its picture is on another render layer)', async () => {
  const hit = await app.run(() => {
    const F = window.FourEyes, T = window.T, THREE = F.THREE;
    T.reset('1', 1.6); T.fake(0, 3840, 1080); F.slots[0].mode = 'sbs'; F.slots[0].applyMode(); F.arrange();
    F.world.updateMatrixWorld(true);
    const s = F.slots[0], target = new THREE.Vector3().setFromMatrixPosition(s.group.matrixWorld);
    const eye = new THREE.Vector3(0, F.eyeY(), 0);
    const h = F.raycastFrom(new THREE.Raycaster(eye, target.sub(eye).normalize()));
    return h && { kind: h.kind, slot: h.slot && h.slot.i };
  });
  assert.deepEqual(hit, { kind: 'screen', slot: 0 });
});
