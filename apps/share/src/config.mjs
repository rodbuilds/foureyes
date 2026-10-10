// Settings kept between runs, in one JSON file in the user's app-data folder: the shared folders,
// the pairing code, the paired devices (only a hash of each device's cookie), the ports and the
// certificate. Nothing about the user's files is stored here, only the folder paths they chose.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 8443;
export const DEFAULT_CONTROL_PORT = 8444;

export function defaultConfigDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Four Eyes Share');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Four Eyes Share');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'four-eyes-share');
}

// The pairing code: 6 digits, easy to type on a Quest. It is used once (a new one is made when a
// device pairs) and the server pauses pairing after a few wrong tries, which keeps guessing it hopeless.
export const PAIR_DIGITS = 6;
export const newPairCode = () => String(crypto.randomInt(0, 10 ** PAIR_DIGITS)).padStart(PAIR_DIGITS, '0');
export const isPairCode = s => /^\d+$/.test(String(s)) && String(s).length === PAIR_DIGITS;
export const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

function fresh() {
  return {
    version: 1,
    port: DEFAULT_PORT,
    controlPort: DEFAULT_CONTROL_PORT,
    folders: [],   // [{id, name, path}]
    pairCode: newPairCode(),
    devices: [],   // [{hash, added, agent}]
    tls: null,     // {cert, key, notAfter}
  };
}

// Load (or create) the config. save() writes it back; the file is readable by this user only
// where the platform supports it, because it holds the certificate's private key.
export function loadConfig(dir = defaultConfigDir()) {
  const file = path.join(dir, 'config.json');
  let data = fresh();
  try {
    data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Couldn't read ${file}: ${e.message}`);
  }
  if (!Array.isArray(data.folders)) data.folders = [];
  if (!Array.isArray(data.devices)) data.devices = [];
  delete data.pairKey; // the 10-letter key used before pairing codes
  if (!isPairCode(data.pairCode)) data.pairCode = newPairCode();
  const cfg = {
    dir, file, data,
    save() {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
    addFolder(p) {
      const abs = path.resolve(p);
      let st;
      try { st = fs.statSync(abs); } catch { throw new Error(`"${abs}" doesn't exist.`); }
      if (!st.isDirectory()) throw new Error(`"${abs}" isn't a folder.`);
      const same = data.folders.find(f => samePath(f.path, abs));
      if (same) return same;
      const f = { id: crypto.randomBytes(4).toString('hex'), name: uniqueName(path.basename(abs) || abs, data.folders), path: abs };
      data.folders.push(f); cfg.save(); return f;
    },
    removeFolder(id) {
      const n = data.folders.length;
      data.folders = data.folders.filter(f => f.id !== id);
      if (data.folders.length !== n) cfg.save();
      return data.folders.length !== n;
    },
    // Trade the pairing code for a new device cookie, or null if the code is wrong. The cookie is
    // remembered as a hash, so the config file can't be used to impersonate it. The code is then
    // replaced, so each code pairs one device.
    pair(code, agent = '') {
      const want = Buffer.from(data.pairCode), got = Buffer.from(String(code ?? '').replace(/\s+/g, ''));
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
      const token = crypto.randomBytes(32).toString('base64url');
      data.devices.push({ hash: hashToken(token), added: new Date().toISOString(), agent: String(agent).slice(0, 200) });
      data.pairCode = newPairCode();
      cfg.save(); return token;
    },
    hasDevice(token) {
      if (!token) return false;
      const h = Buffer.from(hashToken(token), 'hex');
      return data.devices.some(d => d.hash.length === 64 && crypto.timingSafeEqual(Buffer.from(d.hash, 'hex'), h));
    },
    // forget every paired device, with a new pairing code too
    forgetDevices() {
      data.devices = []; data.pairCode = newPairCode(); cfg.save();
    },
  };
  return cfg;
}

const samePath = (a, b) => process.platform === 'win32' || process.platform === 'darwin'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);

// Two shared folders can both be called "Videos"; the second shows as "Videos (2)".
function uniqueName(name, folders) {
  const taken = new Set(folders.map(f => f.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
}
