// The files Four Eyes Share serves besides the user's media: the Four Eyes page itself, three.js and
// the two fonts. They are served from here rather than from the CDNs the hosted page uses, so a Quest
// on PC Share never contacts anyone but this PC.
//
// In the packaged .exe they are built in (Node "single executable application" assets); when run
// from the repository they are read from apps/web and node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const FONT_FILES = [
  ['Barlow', 400, 'barlow-latin-400-normal.woff2'],
  ['Barlow', 500, 'barlow-latin-500-normal.woff2'],
  ['Barlow', 600, 'barlow-latin-600-normal.woff2'],
  ['Barlow Condensed', 500, 'barlow-condensed-latin-500-normal.woff2'],
  ['Barlow Condensed', 600, 'barlow-condensed-latin-600-normal.woff2'],
  ['Barlow Condensed', 700, 'barlow-condensed-latin-700-normal.woff2'],
];

const sea = (() => {
  try {
    const m = process.getBuiltinModule('node:sea');
    return m && m.isSea() ? m : null;
  } catch {
    return null;
  }
})();

// Where each asset lives when running from the repository (also used by the build to package them).
export function sourcePaths() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(path.join(here, 'web-assets.mjs'));
  const out = {
    'index.html': path.resolve(here, '..', '..', 'web', 'index.html'),
    'three.min.js': require.resolve('three/build/three.min.js'),
  };
  for (const [family, , file] of FONT_FILES) {
    const pkg = family === 'Barlow' ? '@fontsource/barlow' : '@fontsource/barlow-condensed';
    out['fonts/' + file] = path.join(path.dirname(require.resolve(pkg + '/package.json')), 'files', file);
  }
  return out;
}

let paths = null;
function readAsset(name) {
  if (sea) return Buffer.from(sea.getAsset(name));
  paths ||= sourcePaths();
  if (!paths[name]) throw new Error('unknown asset ' + name);
  return fs.readFileSync(paths[name]);
}

// The hosted page loads fonts from Google and three.js from cdnjs. Point both at this server, and
// add the marker that tells the page it came from Four Eyes Share. If the page changes so that these
// lines aren't found, refuse to start rather than quietly serve a page that calls out to the CDNs.
export function sharePage(html) {
  const swaps = [
    [/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*<link href="https:\/\/fonts\.googleapis\.com\/[^"]*" rel="stylesheet">/,
      '<link href="vendor/fonts.css" rel="stylesheet">'],
    [/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"><\/script>/,
      '<script src="vendor/three.min.js"></script>'],
    [/<meta charset="utf-8">/, '<meta charset="utf-8">\n<meta name="four-eyes-share" content="1">'],
  ];
  for (const [re, to] of swaps) {
    if (!re.test(html)) throw new Error('The Four Eyes page has changed: ' + re + ' no longer matches. Update apps/share/src/web-assets.mjs.');
    html = html.replace(re, to);
  }
  if (/https:\/\/(fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare)\.com/.test(html)) throw new Error('The Four Eyes page still refers to a CDN.');
  return html;
}

const fontsCss = () => FONT_FILES.map(([family, weight, file]) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(fonts/${file}) format('woff2');}`).join('\n') + '\n';

// path under /vendor/ (or '' for the page) -> {type, body}; read once and kept in memory
export function loadWebAssets() {
  const map = new Map();
  map.set('index.html', { type: 'text/html; charset=utf-8', body: Buffer.from(sharePage(readAsset('index.html').toString('utf8'))) });
  map.set('vendor/three.min.js', { type: 'text/javascript; charset=utf-8', body: readAsset('three.min.js') });
  map.set('vendor/fonts.css', { type: 'text/css; charset=utf-8', body: Buffer.from(fontsCss()) });
  for (const [, , file] of FONT_FILES) map.set('vendor/fonts/' + file, { type: 'font/woff2', body: readAsset('fonts/' + file) });
  return map;
}
