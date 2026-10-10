# Four Eyes Share (experimental)

A small companion app for the PC that lets a **Quest** (or any browser on your home network) watch
the videos and photos on that PC in Four Eyes.

Quest Browser can't open folders on a PC, and Four Eyes needs folder access to browse. Four Eyes Share
fills the gap. It runs on the PC, serves the Four Eyes page and the folders you choose, and the Quest
opens it over Wi-Fi. In Four Eyes, those folders appear in the media browser as **PC Share** places
(marked `PC ·`). Browsing, PLAY ALL, SHUFFLE, **SHUFFLE ALL**, photo sets, LATEST sorting and
thumbnails all work as they do with local folders.

## Using it

1. Run `four-eyes-share.exe`. A console window shows the address and pairing code, and the
   **control panel** opens in your browser at `http://127.0.0.1:8444` (reachable from this PC only).
   Run it again at any time to reopen the panel. A second copy doesn't start; it opens the running
   copy's panel instead.
2. Click **Add folder…**, open folders until you're in one with your videos or photos (it shows how
   many each folder holds), and click **Share this folder**. Or paste a path. Folders are remembered.
3. On the Quest, open **Quest Browser** and go to the address the panel shows, for example
   `192.168.1.20:8443`. You don't need to type `https://`.
4. The Quest warns that the connection isn't private. Choose **Advanced → Proceed**. You only do this
   once (see [the certificate](#the-certificate)).
5. Type the **6-digit pairing code** from the panel, for example `441 388`. Each code pairs one device,
   and the panel shows a new one straight after.
6. Four Eyes opens. Press **Enter VR** and open the media browser. Your folders are listed under Places.

The next time, just go to the address (bookmark it). The Quest stays paired. The panel's QR code is
a pairing link with the code built in, for a phone or tablet.

Windows asks once whether to let the app through the firewall. Allow **private networks**, which is
your home Wi-Fi.

## Privacy

- **Nothing leaves your home network.** The page, three.js and the fonts are all served by the app,
  so a Quest using PC Share never contacts a CDN, Google, or anyone else. There's no account, no
  telemetry, and no cloud.
- **Only paired devices see anything.** Until a device has entered the pairing code, it gets only
  the code page: no folder names, listings or files. Pairing gives that browser a long random
  cookie (HttpOnly, Secure, SameSite=Strict). The app stores only a hash of it.
- **The 6-digit code is safe to keep short.** Each code pairs one device and is then replaced. Five
  wrong codes pause pairing for five minutes. At that rate, getting through half of the million
  codes would take about a year. The form only accepts posts from its own page.
- **Forget all devices** in the panel unpairs everything and makes a new code.
- **Only media in the shared folders is served:** videos and photos by file extension. It never
  serves other files, hidden files (`.name`, `$name`, `System Volume Information`), paths that use
  `..`, or links and junctions that lead outside a shared folder. The headset sees folder *names*,
  never their paths on the PC.
- **The control panel is local only.** It listens on `127.0.0.1`, rejects other host names (DNS
  rebinding), and only accepts changes that carry its own header, which other websites can't send.

Settings live in `%APPDATA%\Four Eyes Share\config.json`: the shared folder paths, the pairing code,
the hashes of paired devices, and the certificate with its private key.

## The certificate

WebXR, the browser's VR support, only works on secure (HTTPS) pages. On first run the app makes its
own **self-signed** certificate, so the Quest warns once and then remembers the exception. The
fingerprint is shown in the console and the panel if you want to compare it with the one the Quest
shows. The certificate lasts about two years and is renewed automatically before it expires (the
Quest then asks once more).

Removing the warning means a certificate a browser already trusts. That needs a real domain name,
or something like Tailscale's HTTPS certificates. Neither is part of this experiment.

## Options

```
four-eyes-share [--add FOLDER]... [--port 8443] [--control-port 8444] [--config-dir DIR] [--no-open]
```

## Development

From the repository root:

```sh
npm install
npm run share -- --add "D:\Videos"   # run from source
npm run test:share                   # server, pairing, path safety, ranges, certificate, panel
npm run test:web                     # includes PC Share end to end in headless Chrome
npm run build:share                  # apps/share/dist/four-eyes-share.exe
```

How it's put together:

| File | What it does |
|---|---|
| `src/main.mjs` | Command line, starts both servers, prints the addresses |
| `src/server.mjs` | The HTTPS server the headset uses: pairing, `/api/share`, `/api/list`, `/api/latest`, `/media/…` with range requests |
| `src/control.mjs` | The local control panel, including its folder browser |
| `src/cert.mjs` | The self-signed certificate, built with Node's own crypto (no OpenSSL, no libraries) |
| `src/config.mjs` | Settings file, folders, pairing and devices |
| `src/web-assets.mjs` | Serves `apps/web/index.html` with the CDN links pointed at local copies, and adds the `<meta name="four-eyes-share">` marker that turns on PC Share in the page |
| `scripts/build.mjs` | Bundles with esbuild and packs everything into one executable (Node single executable application) |

The only runtime dependency is `qrcode-generator` (MIT, no dependencies of its own), for the QR code.
three.js and the Barlow fonts come from npm at build time and are packaged into the executable.

### Known rough edges

- **Size.** The executable is about 85 MB because it contains a whole Node.js runtime. A Go version
  would be closer to 10 MB. The HTTP API is small, so porting it is straightforward if size matters.
- **Unsigned.** Windows SmartScreen may warn the first time it runs, until it's code-signed.
- **Not yet tried on a real Quest.** The tests cover the server and run the page from it in headless
  Chrome (browse, stream and seek a video, thumbnails, SHUFFLE ALL photo sets, no outside requests).
  WebXR on the Quest after "Proceed" past the certificate warning still needs a check by hand.
- **Photos and thumbnails** are fetched whole from the PC (the browser decodes them), which is fine on
  home Wi-Fi but slower than local folders for very large photos. Server-side thumbnails would help.
