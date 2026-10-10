// The control panel: a small page on this PC only (127.0.0.1) where the user picks the folders to
// share, sees the address and pairing code for the Quest (and a QR code), and can forget paired
// devices. It is never reachable from the network.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import qrcode from 'qrcode-generator';
import { fingerprint } from './cert.mjs';
import { VIDEO_EXT, IMAGE_EXT, hiddenName } from './server.mjs';

// ----- choosing folders -----
// Folders are chosen in the panel itself, from a folder browser drawn by the page, rather than with
// the system's folder dialog: Windows keeps a dialog opened by a background program behind the
// browser the user is clicking in, where it can't be found. These listings go only to the panel,
// which only this PC can open.

// Where browsing starts: the usual media folders, then the drives (or volumes).
export async function folderRoots() {
  const home = os.homedir();
  const places = [['Videos', 'Videos'], ['Pictures', 'Pictures'], ['Desktop', 'Desktop'], ['Downloads', 'Downloads'], ['Home', '']]
    .map(([name, sub]) => ({ name, path: path.join(home, sub) }))
    .filter(p => fs.existsSync(p.path));
  let drives = [];
  if (process.platform === 'win32') {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('');
    // checked together, each with a time limit, since an empty card reader or a sleeping network drive can be slow
    const ok = await Promise.all(letters.map(l => Promise.race([
      fsp.access(l + ':\\').then(() => true, () => false),
      new Promise(r => setTimeout(() => r(false), 1500)),
    ])));
    drives = letters.filter((_, i) => ok[i]).map(l => ({ name: l + ':', path: l + ':\\' }));
  } else {
    const vols = process.platform === 'darwin' ? '/Volumes' : '/media';
    drives = [{ name: '/', path: '/' }];
    try { for (const d of await fsp.readdir(vols, { withFileTypes: true })) if (d.isDirectory()) drives.push({ name: d.name, path: path.join(vols, d.name) }); } catch {}
  }
  return { places, drives };
}

// A folder's subfolders, and how many videos and photos are directly in it (so you can tell which
// folder is the one with your media). parent is null at the top of a drive.
export async function listForPicker(dir) {
  const abs = path.resolve(dir);
  let dirents;
  try { dirents = await fsp.readdir(abs, { withFileTypes: true }); }
  catch (e) { throw new Error(e.code === 'EPERM' || e.code === 'EACCES' ? 'Windows won\'t let Four Eyes Share read that folder.' : `Couldn't open "${abs}".`); }
  const folders = [];
  let videos = 0, photos = 0;
  for (const d of dirents) {
    if (hiddenName(d.name) || d.name.startsWith('~')) continue;
    if (d.isDirectory() || d.isSymbolicLink()) folders.push({ name: d.name, path: path.join(abs, d.name) });
    else if (VIDEO_EXT.test(d.name)) videos++;
    else if (IMAGE_EXT.test(d.name)) photos++;
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const parent = path.dirname(abs);
  return { path: abs, parent: parent === abs ? null : parent, folders, videos, photos };
}

export function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
}

// state for the panel; urls() gives the share's addresses (they can change as networks come and go)
function state(cfg, urls) {
  const base = urls();
  return {
    // the QR code opens the pairing link directly, so a scanned code needs no typing
    addresses: base, code: cfg.data.pairCode, qr: base.length ? qrSvg(base[0] + '/pair/' + cfg.data.pairCode) : '',
    folders: cfg.data.folders, devices: cfg.data.devices.length,
    fingerprint: cfg.data.tls ? fingerprint(cfg.data.tls.cert) : '', configFile: cfg.file,
  };
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 64 * 1024) throw new Error('too big'); }
  return body ? JSON.parse(body) : {};
}

export function createControlHandler(cfg, { urls, port, onQuit = () => {}, log = () => {} }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return async function handle(req, res) {
    const json = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(obj));
    };
    // Only this PC, by name: a web page elsewhere can't reach 127.0.0.1 under its own host name
    // (DNS rebinding), and changes need a header other sites' pages can't send without permission.
    if (!hosts.has(req.headers.host)) { json(403, { error: 'Forbidden.' }); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'",
      });
      res.end(PANEL); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') { json(200, state(cfg, urls)); return; }
    if (req.method !== 'POST' || req.headers['x-four-eyes-share'] !== '1') { json(404, { error: 'Not found.' }); return; }
    const origin = req.headers.origin;
    if (origin && !hosts.has(origin.replace(/^http:\/\//, ''))) { json(403, { error: 'Forbidden.' }); return; }
    try {
      const body = await readJson(req);
      switch (url.pathname) {
        case '/api/folders/add': cfg.addFolder(String(body.path || '')); break;
        // the panel's folder browser: the starting places, or one folder's subfolders
        case '/api/fs/roots': json(200, await folderRoots()); return;
        case '/api/fs/list': json(200, await listForPicker(String(body.path || ''))); return;
        case '/api/folders/remove': cfg.removeFolder(String(body.id || '')); break;
        case '/api/devices/forget': cfg.forgetDevices(); log('forgot all paired devices; new pairing code made'); break;
        case '/api/quit': json(200, state(cfg, urls)); onQuit(); return;
        default: json(404, { error: 'Not found.' }); return;
      }
      json(200, state(cfg, urls));
    } catch (e) {
      json(400, { error: e.message || String(e) });
    }
  };
}

export function startControlServer(cfg, opts) {
  const server = http.createServer(createControlHandler(cfg, opts));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => { server.off('error', reject); resolve(server); });
  });
}

const PANEL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Four Eyes Share</title>
<style>
:root{--bg:#f6f5f2;--fg:#1c1c1c;--mute:#666;--card:#fff;--line:#ddd;--acc:#1f6feb;--warn:#a33}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--mute:#aaa;--card:#1e1e1e;--line:#333;--acc:#58a6ff;--warn:#f88}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 48px}
h1{margin:0 0 4px;font-size:28px}h2{font-size:18px;margin:0 0 8px}
.sub{color:var(--mute);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:0 0 16px}
.connect{display:grid;grid-template-columns:1fr 200px;gap:16px;align-items:start}
@media (max-width:640px){.connect{grid-template-columns:1fr}}
.qr svg{width:200px;height:200px;background:#fff;border-radius:6px}
.big{font:600 22px/1.3 ui-monospace,Consolas,monospace;word-break:break-all;margin:4px 0 10px}
.code{font:700 56px/1.1 ui-monospace,Consolas,monospace;letter-spacing:.12em;margin:4px 0 6px}
.ok{color:#3fb950;font-weight:600}
ol{padding-left:20px;margin:6px 0}
ul.folders{list-style:none;margin:0 0 12px;padding:0}
ul.folders li{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
ul.folders .n{font-weight:600}ul.folders .p{color:var(--mute);font-size:14px;flex:1;word-break:break-all}
button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
button.primary{background:var(--acc);border-color:var(--acc);color:#fff}
.row{display:flex;gap:8px;flex-wrap:wrap}
input[type=text]{flex:1;min-width:200px;font:inherit;padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.mute{color:var(--mute);font-size:14px}.err{color:var(--warn)}
code{font-family:ui-monospace,Consolas,monospace}
.picker{border:1px solid var(--line);border-radius:8px;margin:12px 0 0;background:var(--bg)}
.pbar,.pfoot{display:flex;gap:8px;align-items:center;padding:8px 10px}
.pbar{border-bottom:1px solid var(--line)}.pfoot{border-top:1px solid var(--line);justify-content:space-between;flex-wrap:wrap}
.ppath{flex:1;font:600 14px ui-monospace,Consolas,monospace;word-break:break-all}
.plist{max-height:340px;overflow:auto;padding:4px 0}
.plist h3{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--mute);margin:10px 12px 4px}
.plist button{display:block;width:100%;text-align:left;border:0;border-radius:0;background:none;padding:7px 14px}
.plist button:hover,.plist button:focus-visible{background:var(--card);outline:none}
.plist .empty{padding:10px 14px;color:var(--mute)}
button:disabled{opacity:.5;cursor:default}
</style></head><body><main>
<h1>Four Eyes Share</h1>
<p class="sub">Watch the videos and photos on this PC in Four Eyes on a Quest, over your home Wi-Fi. Nothing leaves your network, and only paired devices can see the folders below.</p>

<section class="card connect">
  <div>
    <h2>Connect your Quest</h2>
    <ol>
      <li>Put the Quest on the same Wi-Fi as this PC and open <b>Quest Browser</b>.</li>
      <li>Go to:
        <div class="big" id="addr">…</div></li>
      <li>The browser warns that the connection isn't private, because this PC made its own certificate. Choose <b>Advanced</b>, then <b>Proceed</b>.</li>
      <li>Type this pairing code:
        <div class="code" id="code">…</div>
        <span class="mute">Each code works once: after a device pairs, a new one appears here.</span> <span class="ok" id="paired"></span></li>
      <li>Four Eyes opens. Your folders are under <b>PC Share</b> in the media browser. Next time just go to the address; the Quest stays paired.</li>
    </ol>
    <p class="mute" id="others"></p>
  </div>
  <div class="qr" id="qr"></div>
</section>

<section class="card">
  <h2>Shared folders</h2>
  <ul class="folders" id="folders"></ul>
  <div class="row">
    <button class="primary" id="browse">Add folder…</button>
    <input type="text" id="path" placeholder="or paste a folder path, e.g. D:\\Videos" aria-label="Folder path">
    <button id="add">Add</button>
  </div>
  <div class="picker" id="picker" hidden>
    <div class="pbar"><button id="pup">↑ Up</button><span class="ppath" id="ppath"></span><button id="pclose">Cancel</button></div>
    <div class="plist" id="plist" role="list"></div>
    <div class="pfoot"><span class="mute" id="pcount"></span><button class="primary" id="pshare" disabled>Share this folder</button></div>
  </div>
  <p class="err" id="err"></p>
</section>

<section class="card">
  <h2>Paired devices</h2>
  <p><span id="devices">0</span> device(s) can see your shared folders. <b>Forget all devices</b> unpairs them all and makes a new pairing code.</p>
  <div class="row"><button id="forget">Forget all devices</button><button id="quit">Stop sharing</button></div>
  <p class="mute">Certificate fingerprint (SHA-256): <code id="fp"></code><br>Settings: <code id="cfg"></code></p>
</section>
</main>
<script>
const $=id=>document.getElementById(id);
async function call(path,body){
  const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Four-Eyes-Share':'1'},body:JSON.stringify(body)});
  const j=await r.json(); if(!r.ok) throw new Error(j.error||('HTTP '+r.status)); return j;
}
// addresses without "https://": the server answers plain http on the same port with a redirect
const short=u=>u.replace('https://','');
let lastDevices=null;
function show(s){
  $('addr').textContent=s.addresses.length? short(s.addresses[0]) : 'No network connection found. Connect this PC to your Wi-Fi.';
  $('code').textContent=s.code.slice(0,3)+' '+s.code.slice(3);
  $('others').textContent=s.addresses.length>1?'Other addresses for this PC, if that one doesn\\'t work: '+s.addresses.slice(1).map(short).join('   '):'';
  if(lastDevices!=null && s.devices>lastDevices) $('paired').textContent='✓ A device just paired.';
  lastDevices=s.devices;
  $('qr').innerHTML=s.qr;
  shared=s.folders;
  const ul=$('folders'); ul.innerHTML='';
  if(!s.folders.length){ const li=document.createElement('li'); li.className='mute'; li.textContent='No folders shared yet.'; ul.appendChild(li); }
  for(const f of s.folders){
    const li=document.createElement('li');
    const n=document.createElement('span'); n.className='n'; n.textContent=f.name;
    const p=document.createElement('span'); p.className='p'; p.textContent=f.path;
    const b=document.createElement('button'); b.textContent='Stop sharing'; b.onclick=()=>act('/api/folders/remove',{id:f.id});
    li.append(n,p,b); ul.appendChild(li);
  }
  $('devices').textContent=s.devices; $('fp').textContent=s.fingerprint; $('cfg').textContent=s.configFile;
}
async function act(path,body){ $('err').textContent=''; try{ show(await call(path,body)); }catch(e){ $('err').textContent=e.message; } }
// ----- the folder browser: open folders until you're in the one to share, then "Share this folder" -----
let here=null, shared=[]; // here: the listing on show (null at the starting places)
const plural=(n,one,many)=>n+' '+(n===1? one : many);
function entry(label,onclick){ const b=document.createElement('button'); b.textContent=label; b.setAttribute('role','listitem'); b.onclick=onclick; return b; }
async function browseTo(path){
  $('err').textContent='';
  try{
    const list=$('plist');
    if(path==null){
      const r=await call('/api/fs/roots',{}); here=null; list.innerHTML='';
      const group=(title,items)=>{ if(!items.length) return; const h=document.createElement('h3'); h.textContent=title; list.appendChild(h); for(const it of items) list.appendChild(entry('📁  '+it.name,()=>browseTo(it.path))); };
      group('Places',r.places); group('Drives',r.drives);
      $('ppath').textContent='Choose where to look'; $('pcount').textContent=''; $('pup').disabled=true; $('pshare').disabled=true;
    }else{
      const r=await call('/api/fs/list',{path}); here=r; list.innerHTML='';
      for(const f of r.folders) list.appendChild(entry('📁  '+f.name,()=>browseTo(f.path)));
      if(!r.folders.length){ const d=document.createElement('div'); d.className='empty'; d.textContent='No folders inside this one.'; list.appendChild(d); }
      const already=shared.some(f=>f.path.toLowerCase()===r.path.toLowerCase());
      $('ppath').textContent=r.path; $('pup').disabled=false;
      $('pcount').textContent= already? '✓ Already shared' : 'In this folder: '+plural(r.videos,'video','videos')+', '+plural(r.photos,'photo','photos')+' (Four Eyes also sees the folders inside it)';
      $('pshare').disabled=already;
    }
    list.scrollTop=0; const first=list.querySelector('button'); if(first) first.focus();
  }catch(e){ $('err').textContent=e.message; }
}
$('browse').onclick=()=>{ $('picker').hidden=false; browseTo(null); };
$('pclose').onclick=()=>{ $('picker').hidden=true; };
$('pup').onclick=()=>browseTo(here && here.parent!=null? here.parent : null);
$('pshare').onclick=async()=>{ if(!here) return; await act('/api/folders/add',{path:here.path}); if(!$('err').textContent) $('picker').hidden=true; };
$('add').onclick=()=>{ const p=$('path').value.trim(); if(p) act('/api/folders/add',{path:p}).then(()=>{ if(!$('err').textContent) $('path').value=''; }); };
$('path').onkeydown=e=>{ if(e.key==='Enter') $('add').click(); };
$('forget').onclick=()=>{ if(confirm('Unpair every device? They will need the new pairing code to connect again.')) act('/api/devices/forget',{}); };
$('quit').onclick=async()=>{ if(!confirm('Stop sharing? Your headset will lose access until you start Four Eyes Share again.')) return; try{ await call('/api/quit',{}); }catch(e){} document.body.innerHTML='<main><h1>Four Eyes Share has stopped.</h1><p>You can close this tab.</p></main>'; };
call('/api/state').then(show).catch(e=>$('err').textContent=e.message);
setInterval(()=>call('/api/state').then(show).catch(()=>{}),2000);
</script></body></html>`;
