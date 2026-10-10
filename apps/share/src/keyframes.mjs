// Keyframe times of an MP4, read from its index (the moov box), so the page can jump straight to a
// keyframe. A video can only start decoding at a keyframe: a jump to any other point makes the
// player fetch and decode everything from the keyframe before it, which on a headset over Wi-Fi is
// slow when keyframes are far apart (10 s is common).
//
// Only the index is read, never the video data. Times are presentation times in seconds, as the
// video element's currentTime counts them (edit list applied). Returns null when there's nothing
// useful to report: not an MP4, a fragmented MP4 (no sample tables in moov), no video track, or
// every frame a keyframe.
import fsp from 'node:fs/promises';

const MAX_MOOV = 256 * 1024 * 1024; // a sanity limit; long, high-frame-rate videos have moovs of a few MB

async function readAt(fh, pos, len) {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fh.read(b, 0, len, pos);
  return b.subarray(0, bytesRead);
}

// child boxes of buf[start..end): [{type, start (of payload), end}]
function children(buf, start = 0, end = buf.length) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p), head = 8;
    const type = buf.toString('latin1', p + 4, p + 8);
    if (size === 1) { if (p + 16 > end) break; size = Number(buf.readBigUInt64BE(p + 8)); head = 16; }
    else if (size === 0) size = end - p;
    if (size < head || p + size > end) break;
    out.push({ type, start: p + head, end: p + size });
    p += size;
  }
  return out;
}
const child = (buf, box, type) => children(buf, box.start, box.end).find(b => b.type === type);
const path = (buf, box, ...types) => { for (const t of types) { if (!box) return null; box = child(buf, box, t); } return box; };

// Find and read the top-level moov box.
async function readMoov(fh, size) {
  let pos = 0;
  while (pos + 8 <= size) {
    const h = await readAt(fh, pos, 16);
    if (h.length < 8) return null;
    let len = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    if (len === 1) len = Number(h.readBigUInt64BE(8)); else if (len === 0) len = size - pos;
    if (len < 8) return null;
    if (type === 'moov') return len > MAX_MOOV ? null : readAt(fh, pos, len);
    pos += len;
  }
  return null;
}

export function keyframesFromMoov(moovBuf) {
  const moov = { start: 8, end: moovBuf.length };
  const mvhd = child(moovBuf, moov, 'mvhd');
  const movieScale = mvhd ? moovBuf.readUInt32BE(mvhd.start + (moovBuf[mvhd.start] === 1 ? 20 : 12)) : 0;
  for (const trak of children(moovBuf, moov.start, moov.end).filter(b => b.type === 'trak')) {
    const mdia = child(moovBuf, trak, 'mdia');
    const hdlr = mdia && child(moovBuf, mdia, 'hdlr');
    if (!hdlr || moovBuf.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue;
    const mdhd = child(moovBuf, mdia, 'mdhd');
    const scale = moovBuf.readUInt32BE(mdhd.start + (moovBuf[mdhd.start] === 1 ? 20 : 12));
    const stbl = path(moovBuf, mdia, 'minf', 'stbl');
    if (!stbl || !scale) return null;
    const stts = child(moovBuf, stbl, 'stts'), stss = child(moovBuf, stbl, 'stss'), ctts = child(moovBuf, stbl, 'ctts');
    if (!stts || !stss) return null; // no stss: every frame is a keyframe, so any jump is already instant
    const nStts = moovBuf.readUInt32BE(stts.start + 4);
    if (!nStts) return null; // fragmented MP4: the samples are described in moof boxes instead

    // edit list: where presentation starts in the track's own time, plus any empty lead-in
    let shift = 0, lead = 0;
    const elst = path(moovBuf, trak, 'edts', 'elst');
    if (elst) {
      const v1 = moovBuf[elst.start] === 1, n = moovBuf.readUInt32BE(elst.start + 4);
      let p = elst.start + 8;
      for (let i = 0; i < n; i++) {
        const dur = v1 ? Number(moovBuf.readBigUInt64BE(p)) : moovBuf.readUInt32BE(p);
        const mt = v1 ? Number(moovBuf.readBigInt64BE(p + 8)) : moovBuf.readInt32BE(p + 4);
        p += v1 ? 20 : 12;
        if (mt === -1) { if (movieScale) lead += dur / movieScale; continue; } // empty edit: a pause before the video
        shift = mt; break;
      }
    }

    // composition offsets, as runs: [count, offset]
    const cttsRuns = [];
    if (ctts) {
      const v1 = moovBuf[ctts.start] === 1, n = moovBuf.readUInt32BE(ctts.start + 4);
      for (let i = 0, p = ctts.start + 8; i < n; i++, p += 8)
        cttsRuns.push([moovBuf.readUInt32BE(p), v1 ? moovBuf.readInt32BE(p + 4) : moovBuf.readUInt32BE(p + 4)]);
    }

    // walk the sample timeline once, picking out the keyframes (stss: 1-based sample numbers, ascending)
    const nSync = moovBuf.readUInt32BE(stss.start + 4);
    const out = [];
    let si = 0, sync = nSync ? moovBuf.readUInt32BE(stss.start + 8) : Infinity;
    let sample = 1, dts = 0, ci = 0, cLeft = cttsRuns.length ? cttsRuns[0][0] : 0;
    const cttsAt = () => { // offset for the current sample (advanced in step with the samples)
      while (ci < cttsRuns.length && cLeft === 0) { ci++; cLeft = ci < cttsRuns.length ? cttsRuns[ci][0] : 0; }
      return ci < cttsRuns.length ? cttsRuns[ci][1] : 0;
    };
    for (let e = 0, p = stts.start + 8; e < nStts && si < nSync; e++, p += 8) {
      const count = moovBuf.readUInt32BE(p), delta = moovBuf.readUInt32BE(p + 4);
      for (let k = 0; k < count && si < nSync; k++) {
        const off = cttsRuns.length ? cttsAt() : 0;
        if (sample === sync) {
          out.push(Math.max(0, lead + (dts + off - shift) / scale));
          si++; sync = si < nSync ? moovBuf.readUInt32BE(stss.start + 8 + si * 4) : Infinity;
        }
        if (cttsRuns.length) cLeft--;
        sample++; dts += delta;
      }
    }
    out.sort((a, b) => a - b);
    return out.length > 1 ? out.map(t => Math.round(t * 1000) / 1000) : null;
  }
  return null;
}

// Keyframe times (seconds) of the MP4 at file, or null. Remembers recent answers by file, size and date.
const cache = new Map();
export async function keyframes(file) {
  if (!/\.(mp4|m4v|mov)$/i.test(file)) return null;
  const fh = await fsp.open(file, 'r');
  try {
    const st = await fh.stat();
    const key = file + '|' + st.size + '|' + st.mtimeMs;
    if (cache.has(key)) return cache.get(key);
    let times = null;
    try { const moov = await readMoov(fh, st.size); times = moov ? keyframesFromMoov(moov) : null; } catch { times = null; }
    cache.set(key, times);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return times;
  } finally {
    await fh.close();
  }
}
