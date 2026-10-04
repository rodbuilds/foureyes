// Shared setup for the Four Eyes tests: opens index.html in headless Chrome with ?test, which makes
// the page expose its internals as window.FourEyes, and installs a few in-page helpers as window.T.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

// Uses the Chrome (or Chromium/Edge) already on the machine; set CHROME_PATH to point elsewhere.
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('No Chrome found. Install Chrome or set CHROME_PATH.');
  return found;
}

// Console noise that isn't an app error.
const NOISE = /GL Driver Message|GPU stall|favicon|Automatic fallback to software WebGL/i;

// Open the app. Returns { page, errors, run(fn, ...args), close() }.
// run() evaluates fn inside the page, where window.FourEyes (F) and window.T are available.
export async function openApp({ query = 'test', darkMode = false } = {}) {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio',
           '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--window-size=1280,900'],
  });
  try {
    return await startApp(browser, query, darkMode);
  } catch (e) {
    await browser.close(); // a page that never starts must not leave Chrome running (it would hang the test run)
    throw e;
  }
}

async function startApp(browser, query, darkMode) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()); });
  if (darkMode) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(APP_URL + (query ? '?' + query : ''), { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 4, { timeout: 30000 });
  if (query.includes('test')) {
    await page.waitForFunction(() => !!window.FourEyes && !window.FourEyes.renderer.getContext().isContextLost(), { timeout: 30000 }); // graphics ready too: headless Chrome reports the context lost for the first moment
    await page.evaluate(installHelpers);
  }
  return {
    page, errors,
    run: (fn, ...args) => page.evaluate(fn, ...args),
    // reload the page (local storage survives, as it would for a real visitor) and wait for it to start again
    reload: async () => {
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => !!window.FourEyes && document.querySelectorAll('.card').length === 4 && !window.FourEyes.renderer.getContext().isContextLost(), { timeout: 30000 });
      await page.evaluate(installHelpers);
    },
    // close Chrome, forcibly if it doesn't go within 5 s (a page stuck mid-load must not hang the test run)
    close: async () => {
      await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 5000))]);
      try { browser.process()?.kill('SIGKILL'); } catch {}
    },
  };
}

// In-page helpers (runs inside the browser).
function installHelpers() {
  const F = window.FourEyes;
  window.T = {
    // pretend a screen is showing a picture of w x h, without loading any media
    fake(i, w, h) { const s = F.slots[i]; s.photo = { key: 'fake' + i }; s.mw = w; s.mh = h; s.loaded = true; s.updateSize(); },
    fakeAll(w, h) { for (let i = 0; i < 4; i++) this.fake(i, w, h); F.arrange(); },
    // start each test from the same place
    reset(layout = '2', eye = 1.6) {
      F.closeBrowser();
      for (const s of F.slots) { s.scales = {}; s.scale = 1; s.crop = { l: 0, r: 0, t: 0, b: 0 }; s.list = null; s.sets = null; }
      F.slotAt.splice(0, 4, 0, 1, 2, 3);
      F.setEye(eye); F.applyLayout(layout); F.arrange();
    },
    // where a screen is, as seen from the eyes: yaw (degrees, + is left), height, and angular width
    view(s) {
      const p = s.group.position, eye = F.eyeY();
      return { yaw: Math.atan2(-p.x, -p.z) * 180 / Math.PI, y: p.y, eye,
               width: F.screenAngle(s.dims) * 180 / Math.PI, h: s.dims.h, bar: s.dims.bar };
    },
    // a folder tree in the shape of the "virtual" folders the page builds when the folder picker isn't
    // available: { name, kind:'dir', vdir: Map(name -> child) }
    dir(name, children) { return { name, kind: 'dir', vdir: new Map(children.map(c => [c.name, c])) }; },
    file(name) { return { name, kind: /\.(jpe?g|png|webp|gif)$/i.test(name) ? 'image' : 'file', file: new File([''], name) }; },
    addRoot(node, id) { node.key = id; F.lib.roots.push({ id, name: node.name, perm: 'granted', temp: true, node }); return node; },
    wait: ms => new Promise(r => setTimeout(r, ms)),
  };
}
