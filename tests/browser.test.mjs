import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => {
  app = await openApp();
  // A collection like a real one: "Dance" holds 16 subfolders, each with 3 videos and 12 photos
  // (named so that natural order matters: pic2 before pic10), plus a photos-only "Holiday".
  await app.run(() => {
    const T = window.T;
    const sub = i => T.dir('Set' + String(i).padStart(2, '0'), [
      ...[1, 2, 3].map(v => T.file('clip' + v + '.mp4')),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(p => T.file('pic' + p + '.jpg')),
    ]);
    window.DANCE = T.addRoot(T.dir('Dance', Array.from({ length: 16 }, (_, i) => sub(i + 1))), 'dance');
    window.HOLIDAY = T.addRoot(T.dir('Holiday', [T.file('a.jpg'), T.file('b.jpg')]), 'holiday');
  });
});
after(async () => { await app?.close(); });

// open the browser for a screen, inside a folder
const inFolder = (screen, ...names) => app.run(async (screen, names) => {
  const F = window.FourEyes; F.openBrowser(screen);
  let node = { DANCE: window.DANCE, HOLIDAY: window.HOLIDAY }[names[0]]; F.lib.path = [node];
  for (const n of names.slice(1)) { await F.refreshDir(); node = F.lib.entries.find(e => e.name === n); F.lib.path.push(node); }
  await F.refreshDir();
}, screen, names);

test('SHUFFLE ALL on VIDEOS mixes every video from every subfolder', async () => {
  await app.run(() => window.T.reset('2'));
  await inFolder(0, 'DANCE');
  const r = await app.run(async () => {
    const F = window.FourEyes, s = F.slots[0];
    F.browserClick({ id: 'shuffletree' }); await window.T.wait(400);
    return { n: s.list.length, kinds: [...new Set(s.list.map(e => e.kind))], folders: new Set(s.list.map(e => e.folder)).size,
             endMode: s.endMode, sets: s.sets, msg: s.flash };
  });
  assert.equal(r.n, 48); assert.deepEqual(r.kinds, ['file']); assert.equal(r.folders, 16);
  assert.equal(r.endMode, 'shuffle'); assert.equal(r.sets, null);
  assert.match(r.msg, /48 videos from 16 folders/);
});

test('SHUFFLE ALL on PHOTOS plays each folder as a set, in name order, with the sets shuffled', async () => {
  await inFolder(0, 'DANCE');
  const r = await app.run(async () => {
    const F = window.FourEyes, s = F.slots[0];
    F.browserClick({ id: 'kind', data: 'image' }); F.browserClick({ id: 'shuffletree' }); await window.T.wait(400);
    return { sets: s.sets.length, perSet: s.sets.map(x => x.items.length), firstSet: s.order.map(i => s.list[i].name) /* the order they actually play in */, pos: s.pos,
             folderOfSet: new Set(s.list.map(e => e.folder)).size, msg: s.flash, kind: s.playKind };
  });
  assert.equal(r.sets, 16);
  assert.ok(r.perSet.every(n => n === 12));
  assert.deepEqual(r.firstSet, ['pic1.jpg', 'pic2.jpg', 'pic3.jpg', 'pic4.jpg', 'pic5.jpg', 'pic6.jpg', 'pic7.jpg', 'pic8.jpg', 'pic9.jpg', 'pic10.jpg', 'pic11.jpg', 'pic12.jpg']);
  assert.equal(r.pos, 0, 'a set starts at its first photo');
  assert.equal(r.folderOfSet, 1, 'a set never mixes folders');
  assert.match(r.msg, /16 photo sets \(192 photos\)/);
  assert.equal(r.kind, 'image');
});

test('photo sets: PREV / NEXT step whole sets, and the photo steps cross into the next set', async () => {
  const r = await app.run(() => {
    const s = window.FourEyes.slots[0], folder = () => s.list[0].folder;
    const a = folder(); s.action('next'); const b = folder(); s.action('prev'); const c = folder();
    s.pos = s.order.length - 1; s.next(1); const d = folder(), dPos = s.pos;   // +10 on the last photo
    s.next(-1); const e = folder(), ePos = s.pos;                                // -10 on the first photo
    return { a, b, c, d, dPos, e, ePos };
  });
  assert.notEqual(r.b, r.a, 'NEXT moves to another set'); assert.equal(r.c, r.a, 'PREV comes back');
  assert.notEqual(r.d, r.a); assert.equal(r.dPos, 0, 'stepping past the last photo opens the next set at its start');
  assert.equal(r.e, r.a, 'stepping back before the first photo returns to the previous set');
});

test('photo sets: what happens at the end of a set', async () => {
  const r = await app.run(() => {
    const s = window.FourEyes.slots[0], folder = () => s.list[0].folder;
    const atEnd = () => { s.photo = { key: 'x' }; s.slidePlaying = true; s.pos = s.order.length - 1; };
    // SHUFFLE (the default for SHUFFLE ALL): the next set starts, at its first photo
    atEnd(); const f0 = folder(); s.advancePhoto(); const shuffle = { moved: folder() !== f0, pos: s.pos, playing: s.slidePlaying };
    // LOOP: the same set starts again
    atEnd(); s.video.loop = true; const f1 = folder(); s.advancePhoto(); const loop = { same: folder() === f1, pos: s.pos }; s.video.loop = false;
    // STOP: it stops at the end of the set
    s.setEndMode('stop'); atEnd(); s.advancePhoto(); const stop = { playing: s.slidePlaying };
    // NEXT: sets in order, stopping after the last one
    s.setEndMode('next'); s.setPos = s.sets.length - 1; s.openSet(); atEnd(); s.advancePhoto(); const nextLast = { playing: s.slidePlaying };
    s.setEndMode('shuffle');
    return { shuffle, loop, stop, nextLast };
  });
  assert.deepEqual(r.shuffle, { moved: true, pos: 0, playing: true });
  assert.deepEqual(r.loop, { same: true, pos: 0 });
  assert.equal(r.stop.playing, false);
  assert.equal(r.nextLast.playing, false);
});

test('VIDEOS / PHOTOS is chosen per screen, PLAY ALL follows it, and an empty choice falls back', async () => {
  await inFolder(1, 'DANCE', 'Set01');
  const r = await app.run(async () => {
    const F = window.FourEyes, s1 = F.slots[1];
    const screen2Kind = F.lib.kind;                       // screen 1 was switched to PHOTOS earlier
    F.browserClick({ id: 'playall' });                    // Set01 has 3 videos and 12 photos
    const playAll = { n: s1.list.length, kind: s1.list[0].kind };
    return { screen2Kind, screen1Kind: F.slots[0].playKind, playAll };
  });
  assert.equal(r.screen2Kind, 'file', 'screen 2 still on VIDEOS'); assert.equal(r.screen1Kind, 'image');
  assert.deepEqual(r.playAll, { n: 3, kind: 'file' });
  await inFolder(1, 'HOLIDAY');
  const fb = await app.run(async () => {
    const F = window.FourEyes, s1 = F.slots[1];
    F.browserClick({ id: 'shuffletree' }); await window.T.wait(400);
    return { kind: s1.list[0].kind, msg: s1.flash };
  });
  assert.equal(fb.kind, 'image'); assert.match(fb.msg, /No videos in these folders, so shuffling 1 photo set/);
});

test('each screen keeps its own place and sort in the browser', async () => {
  await app.run(() => window.FourEyes.applyLayout('4grid')); // so screen 3 exists
  await inFolder(0, 'DANCE', 'Set03');
  const r = await app.run(async () => {
    const F = window.FourEyes;
    F.browserClick({ id: 'sort', data: 'latest' }); await window.T.wait(200);
    F.openBrowser(2); const screen3 = { depth: F.lib.path.length, sort: F.lib.sort };
    F.openBrowser(0); const screen1 = { folder: F.lib.path.at(-1)?.name, sort: F.lib.sort };
    F.browserClick({ id: 'sort', data: 'az' }); F.closeBrowser();
    return { screen3, screen1 };
  });
  assert.deepEqual(r.screen3, { depth: 0, sort: 'az' }, 'a screen that never browsed starts at the top, A-Z');
  assert.deepEqual(r.screen1, { folder: 'Set03', sort: 'latest' }, 'screen 1 picks up where it left off');
});

test('gathering reads every folder, and stops at the limit on a huge tree', async () => {
  const r = await app.run(async () => {
    const F = window.FourEyes, T = window.T;
    const all = await F.gatherTree([window.DANCE], () => {});
    const big = T.dir('Huge', [0, 1, 2].map(i => T.dir('D' + i, Array.from({ length: 4000 }, (_, j) => ({ name: 'p' + j + '.jpg', kind: 'image', file: null })))));
    big.key = 'huge';
    const capped = await F.gatherTree([big], () => {});
    return { dirs: all.dirs, files: all.file.length, photos: all.image.length, sets: all.sets.length,
             capped: capped.capped, total: capped.file.length + capped.image.length, limit: F.TREE_LIMIT };
  });
  assert.deepEqual({ dirs: r.dirs, files: r.files, photos: r.photos, sets: r.sets }, { dirs: 17, files: 48, photos: 192, sets: 16 });
  assert.equal(r.capped, true); assert.equal(r.total, r.limit);
});

test('↻ refresh picks up files and folders added or removed after SHUFFLE ALL', async () => {
  await inFolder(0, 'DANCE');
  const r = await app.run(async () => {
    const F = window.FourEyes, T = window.T, s = F.slots[0], videos = () => s.list.length;
    F.browserClick({ id: 'kind', data: 'file' });
    F.browserClick({ id: 'shuffletree' }); await T.wait(400); const before = videos();
    // meanwhile, on disk: a 17th folder with 3 videos appears, and one video is deleted
    window.DANCE.vdir.set('Set17', T.dir('Set17', [T.file('n1.mp4'), T.file('n2.mp4'), T.file('n3.mp4')]));
    window.DANCE.vdir.get('Set01').vdir.delete('clip1.mp4');
    F.openBrowser(0); F.browserClick({ id: 'shuffletree' }); await T.wait(400); const cached = videos();
    F.openBrowser(0); F.browserClick({ id: 'refresh' }); await T.wait(300); const note = F.lib.note;
    F.browserClick({ id: 'shuffletree' }); await T.wait(400); const after = videos();
    // put the collection back as it was
    window.DANCE.vdir.delete('Set17'); window.DANCE.vdir.get('Set01').vdir.set('clip1.mp4', T.file('clip1.mp4'));
    F.openBrowser(0); F.browserClick({ id: 'refresh' }); await T.wait(300); F.closeBrowser();
    return { before, cached, after, note };
  });
  assert.equal(r.before, 48);
  assert.equal(r.cached, 48, 'without a refresh, SHUFFLE ALL reuses its earlier scan');
  assert.equal(r.after, 50, 'after refreshing: 48 + 3 new - 1 deleted');
  assert.match(r.note, /Refreshed/);
});
