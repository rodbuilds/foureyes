// Keyframe times from an MP4's index: on hand-built indexes (so every case is exact), and on a real
// file made by ffmpeg when it's installed, checked against ffprobe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyframes, keyframesFromMoov } from '../src/keyframes.mjs';

// ----- a tiny MP4 box writer -----
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]); };
const full = (type, version, ...parts) => box(type, Buffer.from([version, 0, 0, 0]), ...parts);
const table = (type, rows, version = 0) => full(type, version, u32(rows.length), ...rows.flat());
const mvhd = scale => full('mvhd', 0, u32(0), u32(0), u32(scale), u32(0), Buffer.alloc(80));
const mdhd = scale => full('mdhd', 0, u32(0), u32(0), u32(scale), u32(0), Buffer.alloc(4));
const hdlr = kind => full('hdlr', 0, u32(0), Buffer.from(kind, 'latin1'), Buffer.alloc(12), Buffer.from('x\0'));

// A video track: frames of `delta` ticks at `scale`/s, keyframes at the given 1-based sample numbers.
function moov({ scale = 1000, frames = 100, delta = 40, sync = [1, 26, 51, 76], ctts = null, elst = null, kind = 'vide', fragmented = false, movieScale = 1000 }) {
  const stbl = box('stbl',
    table('stts', fragmented ? [] : [[u32(frames), u32(delta)]]),
    ...(sync ? [table('stss', sync.map(n => [u32(n)]))] : []),
    ...(ctts ? [table('ctts', ctts.map(([c, o]) => [u32(c), i32(o)]), 1)] : []));
  const trak = box('trak',
    ...(elst ? [box('edts', table('elst', elst.map(([dur, mt]) => [u32(dur), i32(mt), u32(0x10000)])))] : []),
    box('mdia', mdhd(scale), hdlr(kind), box('minf', stbl)));
  return box('moov', mvhd(movieScale), trak);
}

test('keyframe times come from the sync-sample table, in seconds', () => {
  assert.deepEqual(keyframesFromMoov(moov({})), [0, 1, 2, 3]);
  assert.deepEqual(keyframesFromMoov(moov({ scale: 90000, delta: 3600, sync: [1, 51] })), [0, 2]);
});

test('B-frame reordering (ctts) and the edit list are applied, as the player counts time', () => {
  // every frame shown 2 frames (80 ms) late, and the edit list starts the video 80 ms in: back to 0, 1, 2, 3
  assert.deepEqual(keyframesFromMoov(moov({ ctts: [[100, 80]], elst: [[4000, 80]] })), [0, 1, 2, 3]);
  // ctts runs: offsets differ per run; the keyframes (samples 1, 26, 51, 76) take their own run's offset
  assert.deepEqual(keyframesFromMoov(moov({ ctts: [[25, 0], [25, 40], [50, 120]] })), [0, 1.04, 2.12, 3.12]);
  // an empty edit (a 500 ms pause before the video) moves everything later
  assert.deepEqual(keyframesFromMoov(moov({ elst: [[500, -1], [4000, 0]] })), [0.5, 1.5, 2.5, 3.5]);
});

test('nothing is reported when snapping wouldn\'t help or can\'t be worked out', () => {
  assert.equal(keyframesFromMoov(moov({ sync: null })), null, 'no sync table: every frame is a keyframe');
  assert.equal(keyframesFromMoov(moov({ fragmented: true })), null, 'fragmented MP4');
  assert.equal(keyframesFromMoov(moov({ kind: 'soun' })), null, 'no video track');
  assert.equal(keyframesFromMoov(moov({ sync: [1] })), null, 'a single keyframe');
});

test('keyframes() finds moov after the video data too, and leaves other files alone', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fes-kf-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const end = path.join(tmp, 'moov-at-end.mp4');
  fs.writeFileSync(end, Buffer.concat([box('ftyp', Buffer.from('isom')), box('mdat', Buffer.alloc(5000)), moov({})]));
  assert.deepEqual(await keyframes(end), [0, 1, 2, 3]);
  const junk = path.join(tmp, 'junk.mp4');
  fs.writeFileSync(junk, 'this is not a video');
  assert.equal(await keyframes(junk), null);
  const webm = path.join(tmp, 'clip.webm');
  fs.writeFileSync(webm, '');
  assert.equal(await keyframes(webm), null);
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('on a real H.264 file with B-frames, the times match ffprobe', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fes-kf-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const f = path.join(tmp, 'real.mp4');
  // 20 s at 25 fps, a keyframe every 3 s (75 frames), B-frames on, index at the end (ffmpeg's default)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=20',
    '-c:v', 'libx264', '-g', '75', '-keyint_min', '75', '-sc_threshold', '0', '-bf', '3', '-pix_fmt', 'yuv420p', f]);
  const theirs = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey',
    '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', f]).toString().trim().split(/\s+/).map(parseFloat); // a line can end in a stray comma
  const ours = await keyframes(f);
  assert.equal(ours.length, theirs.length);
  ours.forEach((x, i) => assert.ok(Math.abs(x - theirs[i]) < 0.002, `keyframe ${i}: ${x} vs ffprobe ${theirs[i]}`));
});
