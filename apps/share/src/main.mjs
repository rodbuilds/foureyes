// Four Eyes Share: shares folders on this PC with Four Eyes on a Quest (or any browser on the
// home network). Starts the HTTPS share server and the control panel, and opens the panel.
//
//   four-eyes-share [--port 8443] [--control-port 8444] [--config-dir DIR] [--add FOLDER]... [--no-open]
import { execFile } from 'node:child_process';
import os from 'node:os';
import { makeCertificate, needsNewCertificate, fingerprint } from './cert.mjs';
import { loadConfig, defaultConfigDir } from './config.mjs';
import { startControlServer } from './control.mjs';
import { startShareServer, lanAddresses } from './server.mjs';
import { loadWebAssets } from './web-assets.mjs';

function parseArgs(argv) {
  const o = { add: [], open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => { if (i + 1 >= argv.length) throw new Error(a + ' needs a value'); return argv[++i]; };
    if (a === '--port') o.port = Number(val());
    else if (a === '--control-port') o.controlPort = Number(val());
    else if (a === '--config-dir') o.configDir = val();
    else if (a === '--add') o.add.push(val());
    else if (a === '--no-open') o.open = false;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('Unknown option ' + a);
  }
  return o;
}

const HELP = `Four Eyes Share: watch this PC's videos and photos in Four Eyes on a Quest.

  --add FOLDER         share a folder (can be repeated; remembered)
  --port N             port for the headset (default 8443)
  --control-port N     port for the control panel on this PC (default 8444)
  --config-dir DIR     where settings are kept (default ${defaultConfigDir()})
  --no-open            don't open the control panel in the browser
`;

function openInBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd, args, { windowsHide: true }, () => {});
}

const stamp = () => new Date().toLocaleTimeString();
const log = msg => console.log(`[${stamp()}] ${msg}`);

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  const cfg = loadConfig(o.configDir);
  if (o.port) cfg.data.port = o.port;
  if (o.controlPort) cfg.data.controlPort = o.controlPort;
  for (const f of o.add) cfg.addFolder(f);

  if (needsNewCertificate(cfg.data.tls)) {
    const host = os.hostname().toLowerCase();
    cfg.data.tls = makeCertificate({ hosts: ['localhost', host, host + '.local'], ips: ['127.0.0.1', ...lanAddresses()] });
    log('Made a new certificate for this PC.');
  }
  cfg.save();

  const assets = loadWebAssets();
  const urls = () => lanAddresses().map(ip => `https://${ip}:${cfg.data.port}`);
  let share, control;
  try {
    share = await startShareServer(cfg, assets, { log });
  } catch (e) {
    throw new Error(e.code === 'EADDRINUSE' ? `Port ${cfg.data.port} is in use. Is Four Eyes Share already running? (Or choose another with --port.)` : e.message);
  }
  const quit = () => { log('Stopped.'); share.close(); control && control.close(); setTimeout(() => process.exit(0), 200); };
  try {
    control = await startControlServer(cfg, { port: cfg.data.controlPort, urls, onQuit: quit, log });
  } catch (e) {
    share.close();
    throw new Error(e.code === 'EADDRINUSE' ? `Port ${cfg.data.controlPort} is in use. Is Four Eyes Share already running? (Or choose another with --control-port.)` : e.message);
  }
  const panel = `http://127.0.0.1:${cfg.data.controlPort}`;
  const first = urls()[0];
  console.log(`
  Four Eyes Share is running.

  Control panel (this PC only):  ${panel}
  On your Quest, open:           ${first ? first + '/pair/' + cfg.data.pairKey : '(no network connection found)'}
  Certificate fingerprint:       ${fingerprint(cfg.data.tls.cert)}

  Sharing ${cfg.data.folders.length} folder(s). Close this window to stop sharing.
`);
  if (o.open) openInBrowser(panel);
  process.on('SIGINT', quit);
}

main().catch(e => {
  console.error('\n  Four Eyes Share couldn\'t start: ' + (e.message || e) + '\n');
  process.exitCode = 1;
  // keep a double-clicked window open long enough to read the message
  if (process.platform === 'win32' && process.stdout.isTTY) setTimeout(() => {}, 30_000);
});
