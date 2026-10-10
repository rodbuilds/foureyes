// Build Four Eyes Share as one executable for this platform, using Node's "single executable
// application" support: the app is bundled into one script, the Four Eyes page, three.js and the
// fonts are added as assets, and the lot is injected into a copy of the node binary.
//
//   npm run build:share        -> apps/share/dist/four-eyes-share(.exe)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { sourcePaths } from '../src/web-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const win = process.platform === 'win32';
const exe = path.join(DIST, 'four-eyes-share' + (win ? '.exe' : ''));

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 1. one CommonJS file (what Node's single executables run)
const bundle = path.join(DIST, 'four-eyes-share.cjs');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src', 'main.mjs')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: bundle,
  logOverride: { 'empty-import-meta': 'silent' }, // only used when running from the repository
  legalComments: 'inline',
});

// 2. the blob: the bundle plus the page, three.js and fonts
const blob = path.join(DIST, 'sea-prep.blob');
const seaConfig = path.join(DIST, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: bundle, output: blob,
  disableExperimentalSEAWarning: true, useCodeCache: true,
  assets: sourcePaths(),
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 3. a copy of node with the blob injected
fs.copyFileSync(process.execPath, exe);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });
const postject = path.join(ROOT, '..', '..', 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });

for (const f of [blob, seaConfig]) fs.rmSync(f);
const mb = (fs.statSync(exe).size / 1048576).toFixed(0);
console.log(`\nBuilt ${path.relative(process.cwd(), exe)} (${mb} MB)`);
if (win) console.log('Note: it is unsigned, so Windows SmartScreen may warn the first time it runs.');
