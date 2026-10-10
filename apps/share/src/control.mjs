// The control panel: a small page on this PC only (127.0.0.1) where the user picks the folders to
// share, sees the address and pairing link for the Quest (with a QR code), and can forget paired
// devices. It is never reachable from the network.
import { execFile } from 'node:child_process';
import http from 'node:http';
import qrcode from 'qrcode-generator';
import { fingerprint } from './cert.mjs';

// Ask for a folder with the system's own folder picker. Resolves to a path, or '' if cancelled.
export function pickFolder() {
  const run = (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 20 }, (err, out) => err ? reject(err) : resolve(out.trim()));
  });
  if (process.platform === 'win32') {
    const ps = [
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d=New-Object System.Windows.Forms.FolderBrowserDialog',
      "$d.Description='Choose a folder of videos or photos to share with your headset'",
      '$d.ShowNewFolderButton=$false',
      '$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true}',
      "if($d.ShowDialog($o) -eq 'OK'){ $d.SelectedPath }",
    ].join('; ');
    return run('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', ps]);
  }
  if (process.platform === 'darwin') {
    return run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose a folder of videos or photos to share with your headset")'])
      .catch(e => /-128/.test(String(e.message)) ? '' : Promise.reject(e)); // -128: cancelled
  }
  return run('zenity', ['--file-selection', '--directory', '--title=Choose a folder to share']).catch(e => e.code === 1 ? '' : Promise.reject(e));
}

export function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
}

// state for the panel; urls() gives the share's addresses (they can change as networks come and go)
function state(cfg, urls) {
  const base = urls();
  const pair = base.map(u => u + '/pair/' + cfg.data.pairKey);
  return {
    addresses: base, pairLinks: pair, qr: pair.length ? qrSvg(pair[0]) : '',
    folders: cfg.data.folders, devices: cfg.data.devices.length,
    fingerprint: cfg.data.tls ? fingerprint(cfg.data.tls.cert) : '', configFile: cfg.file,
  };
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 64 * 1024) throw new Error('too big'); }
  return body ? JSON.parse(body) : {};
}

export function createControlHandler(cfg, { urls, port, onQuit = () => {}, pick = pickFolder, log = () => {} }) {
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
        case '/api/folders/browse': { const p = await pick(); if (p) cfg.addFolder(p); break; }
        case '/api/folders/remove': cfg.removeFolder(String(body.id || '')); break;
        case '/api/devices/forget': cfg.forgetDevices(); log('forgot all paired devices; new pairing link made'); break;
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
.big{font:600 20px/1.3 ui-monospace,Consolas,monospace;word-break:break-all;margin:4px 0 10px}
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
</style></head><body><main>
<h1>Four Eyes Share</h1>
<p class="sub">Watch the videos and photos on this PC in Four Eyes on a Quest, over your home Wi-Fi. Nothing leaves your network, and only paired devices can see the folders below.</p>

<section class="card connect">
  <div>
    <h2>Connect your Quest</h2>
    <ol>
      <li>Put the Quest on the same Wi-Fi as this PC and open <b>Quest Browser</b>.</li>
      <li>Go to this pairing link (type it in, or scan the code with a phone and send it on):
        <div class="big" id="pair">…</div></li>
      <li>The browser warns that the connection isn't private, because this PC made its own certificate. Choose <b>Advanced</b>, then <b>Proceed</b>. You only do this once.</li>
      <li>Four Eyes opens. Your folders are under <b>PC Share</b> in the media browser. Next time just go to <span id="addr" class="big" style="font-size:16px"></span></li>
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
  <p class="err" id="err"></p>
</section>

<section class="card">
  <h2>Paired devices</h2>
  <p><span id="devices">0</span> device(s) can see your shared folders. <b>Forget all devices</b> unpairs them all and makes a new pairing link.</p>
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
function show(s){
  $('pair').textContent=s.pairLinks[0]||'No network connection found. Connect this PC to your Wi-Fi.';
  $('addr').textContent=s.addresses[0]||'';
  $('others').textContent=s.addresses.length>1?'Other addresses for this PC, if that one doesn\\'t work: '+s.pairLinks.slice(1).join('   '):'';
  $('qr').innerHTML=s.qr;
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
$('browse').onclick=()=>act('/api/folders/browse',{});
$('add').onclick=()=>{ const p=$('path').value.trim(); if(p) act('/api/folders/add',{path:p}).then(()=>{ if(!$('err').textContent) $('path').value=''; }); };
$('path').onkeydown=e=>{ if(e.key==='Enter') $('add').click(); };
$('forget').onclick=()=>{ if(confirm('Unpair every device? They will need the new pairing link to connect again.')) act('/api/devices/forget',{}); };
$('quit').onclick=async()=>{ if(!confirm('Stop sharing? Your headset will lose access until you start Four Eyes Share again.')) return; try{ await call('/api/quit',{}); }catch(e){} document.body.innerHTML='<main><h1>Four Eyes Share has stopped.</h1><p>You can close this tab.</p></main>'; };
call('/api/state').then(show).catch(e=>$('err').textContent=e.message);
setInterval(()=>call('/api/state').then(show).catch(()=>{}),5000);
</script></body></html>`;
