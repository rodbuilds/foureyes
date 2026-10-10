import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => { app = await openApp(); });
after(async () => { await app?.close(); });

for (const layout of ['1', '2', '3arc', '4grid', '4arc']) {
  test(`${layout}: screens in a row never overlap, even with mixed shapes`, async () => {
    const gaps = await app.run((layout) => {
      const F = window.FourEyes, T = window.T;
      T.reset(layout, 1.15);
      T.fake(0, 1920, 1080); T.fake(1, 1080, 1920); T.fake(2, 2560, 1080); T.fake(3, 1080, 1350);
      F.sizeTo(F.slots[1], 1.6); F.arrange(); // one big tall screen
      const rows = { '1': [[0]], '2': [[0, 1]], '3arc': [[0, 1, 2]], '4grid': [[0, 1], [2, 3]], '4arc': [[0, 1, 2, 3]] }[layout];
      const out = [];
      for (const row of rows) for (let k = 1; k < row.length; k++) {
        const a = T.view(F.slots[row[k - 1]]), b = T.view(F.slots[row[k]]);
        out.push((a.yaw - b.yaw) - (a.width + b.width) / 2); // free degrees between the two
      }
      return out;
    }, layout);
    for (const g of gaps) assert.ok(g > -0.01, `screens overlap by ${(-g).toFixed(2)}°`);
  });
}

test('beside a big tall screen, the short screens stay at eye level (3 wide, seated)', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, T = window.T;
    T.reset('3arc', 1.15);
    T.fake(0, 1920, 1080); T.fake(1, 1080, 1920); T.fake(2, 1920, 1080);
    F.sizeTo(F.slots[1], 1.4); F.arrange();
    return [0, 1, 2].map(i => T.view(F.slots[i]));
  });
  const eyeRowCentre = 1.15 - 0.1; // 3 wide is designed 0.1 m below the eyes
  assert.ok(Math.abs(r[0].y - eyeRowCentre) < 0.01, `left screen centre ${r[0].y}`);
  assert.ok(Math.abs(r[2].y - eyeRowCentre) < 0.01, `right screen centre ${r[2].y}`);
  assert.ok(r[1].y - r[1].h / 2 - r[1].bar >= 0.2 - 1e-6, 'the tall screen (and its bar) clears the floor');
});

test('screens tilt to face your eyes', async () => {
  const dots = await app.run(() => {
    const F = window.FourEyes, T = window.T, THREE = F.THREE;
    T.reset('4grid', 1.15); T.fakeAll(1920, 1080);
    F.world.updateMatrixWorld(true);
    return F.visible().map(s => {
      const facing = new THREE.Vector3(0, 0, 1).transformDirection(s.group.matrixWorld);
      const toEye = new THREE.Vector3(0, F.eyeY(), 0).sub(new THREE.Vector3().setFromMatrixPosition(s.group.matrixWorld)).normalize();
      return facing.dot(toEye);
    });
  });
  for (const d of dots) assert.ok(d > 0.9999, `screen faces ${Math.acos(Math.min(1, d)) * 180 / Math.PI}° away from the eyes`);
});

test('each layout keeps its own screen sizes', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, T = window.T, widths = () => F.visible().map(s => +s.dims.vw.toFixed(3));
    T.reset('2'); T.fakeAll(1920, 1080);
    F.fitInView(90);
    F.applyLayout('3arc'); const threeFresh = widths();
    F.sizeTo(F.slots[2], 1.3);
    F.applyLayout('4grid'); const gridFresh = widths();
    F.applyLayout('3arc'); const threeBack = widths();
    return { threeFresh, gridFresh, threeBack };
  });
  assert.equal(new Set(r.threeFresh).size, 1, '3 wide opens with equal screens: ' + r.threeFresh);
  assert.equal(new Set(r.gridFresh).size, 1, '2x2 opens with equal screens: ' + r.gridFresh);
  assert.ok(r.threeBack[2] > r.threeBack[0], '3 wide remembers the enlarged screen: ' + r.threeBack);
});

test('swapping two screens trades their places and nothing else', async () => {
  const r = await app.run(() => {
    const F = window.FourEyes, T = window.T;
    T.reset('3arc'); T.fakeAll(1920, 1080);
    const before = F.slots.map(s => T.view(s).yaw);
    F.slots[0].video.volume = 0.3;
    F.swapScreens(F.slots[0], F.slots[2]); F.arrange();
    const after = F.slots.map(s => T.view(s).yaw);
    return { before, after, vol: F.slots[0].video.volume, slotAt: [...F.slotAt] };
  });
  assert.ok(Math.abs(r.after[0] - r.before[2]) < 0.01 && Math.abs(r.after[2] - r.before[0]) < 0.01, 'screens 1 and 3 traded places');
  assert.ok(Math.abs(r.after[1] - r.before[1]) < 0.01, 'screen 2 stayed put');
  assert.equal(r.vol, 0.3, 'the moved screen kept its own settings');
});
