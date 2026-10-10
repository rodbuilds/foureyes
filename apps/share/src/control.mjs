// The control panel: a small page on this PC only (127.0.0.1) where the user picks the folders to
// share, sees the address and pairing code for the Quest (and a QR code), and can forget paired
// devices. It is never reachable from the network.
import { execFile } from 'node:child_process';
import http from 'node:http';
import qrcode from 'qrcode-generator';
import { fingerprint } from './cert.mjs';

// Windows: the standard folder picker (the Explorer-style one, with Quick Access and an address bar),
// through its COM interface (IFileOpenDialog with FOS_PICKFOLDERS) from PowerShell.
//
// The dialog has to come up in front of the browser, but Windows won't let a background program
// take the foreground. So it is owned by a tiny, always-on-top window that is actually shown (off
// screen): a dialog owned by an always-on-top window is always on top too.
const WIN_PICKER = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
  }
  // IFileOpenDialog, as far as GetResult (the methods must be declared in vtable order)
  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint c, IntPtr specs); void SetFileTypeIndex(uint i); void GetFileTypeIndex(out uint i);
    void Advise(IntPtr events, out uint cookie); void Unadvise(uint cookie);
    void SetOptions(uint fos); void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem si); void SetFolder(IShellItem si); void GetFolder(out IShellItem si);
    void GetCurrentSelection(out IShellItem si);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name); void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title); void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem si);
  }
  const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
  const uint SIGDN_FILESYSPATH = 0x80058000;
  public static string Pick(IntPtr owner, string title) {
    var d = (IFileOpenDialog)new FileOpenDialog();
    uint o; d.GetOptions(out o);
    d.SetOptions(o | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    d.SetTitle(title); d.SetOkButtonLabel("Share this folder");
    if (d.Show(owner) != 0) return "";  // cancelled (or failed)
    IShellItem si; d.GetResult(out si);
    string path; si.GetDisplayName(SIGDN_FILESYSPATH, out path);
    return path;
  }
}
"@
$o = New-Object System.Windows.Forms.Form -Property @{
  TopMost = $true; ShowInTaskbar = $false; FormBorderStyle = 'None'; StartPosition = 'Manual'
  Location = New-Object System.Drawing.Point(-32000, -32000); Size = New-Object System.Drawing.Size(1, 1)
}
$o.Show(); $o.Activate()
[FolderPicker]::Pick($o.Handle, 'Choose a folder of videos or photos to share with your headset')
$o.Close()
`;

// Ask for a folder with the system's own folder picker. Resolves to a path, or '' if cancelled.
export function pickFolder() {
  const run = (cmd, args) => new Promise((resolve, reject) => {
    // no windowsHide: it would also hide the dialog; PowerShell shares this app's console, so no window flashes
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 20 }, (err, out) => err ? reject(err) : resolve(out.trim()));
  });
  if (process.platform === 'win32') {
    // passed encoded (UTF-16LE, base64) so nothing in the script needs quoting
    return run('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive',
      '-EncodedCommand', Buffer.from(WIN_PICKER, 'utf16le').toString('base64')]);
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

export function createControlHandler(cfg, { urls, port, onQuit = () => {}, pick = pickFolder, log = () => {} }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  let picking = false;
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
        case '/api/folders/browse': {
          // one picker at a time: more clicks while it's open would only stack up more windows
          if (picking) { json(409, { error: 'The folder window is already open on this PC. Choose a folder there, or cancel it.' }); return; }
          picking = true;
          let p;
          try { p = await pick(); } finally { picking = false; }
          if (p) cfg.addFolder(p);
          break;
        }
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
$('browse').onclick=async()=>{
  const b=$('browse'); b.disabled=true; b.textContent='Choose a folder in the window that opened…';
  try{ await act('/api/folders/browse',{}); } finally { b.disabled=false; b.textContent='Add folder…'; }
};
$('add').onclick=()=>{ const p=$('path').value.trim(); if(p) act('/api/folders/add',{path:p}).then(()=>{ if(!$('err').textContent) $('path').value=''; }); };
$('path').onkeydown=e=>{ if(e.key==='Enter') $('add').click(); };
$('forget').onclick=()=>{ if(confirm('Unpair every device? They will need the new pairing code to connect again.')) act('/api/devices/forget',{}); };
$('quit').onclick=async()=>{ if(!confirm('Stop sharing? Your headset will lose access until you start Four Eyes Share again.')) return; try{ await call('/api/quit',{}); }catch(e){} document.body.innerHTML='<main><h1>Four Eyes Share has stopped.</h1><p>You can close this tab.</p></main>'; };
call('/api/state').then(show).catch(e=>$('err').textContent=e.message);
setInterval(()=>call('/api/state').then(show).catch(()=>{}),2000);
</script></body></html>`;
