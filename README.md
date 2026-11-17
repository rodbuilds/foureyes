# Four Eyes

**A free VR player for watching multiple videos at once.** Watch up to four flat or 3D (SBS)
videos or photo slideshows side by side in VR, each on its own screen with its own controls.

**[Open Four Eyes](https://foureyesvr.com/)** in Chrome or Edge, with a Meta Quest
(Link / Air Link), Rift or SteamVR headset.

Four Eyes is a single web page. Open it in Chrome or Edge on a PC with a VR headset, press
**Enter VR**, and your own videos and photos appear on floating screens around you. There's
nothing to install and no account, and your files never leave your computer.

**Privacy comes first.** Four Eyes has no analytics, no telemetry, no tracking and no cookies.
It collects nothing and reports nothing: not what you watch, not your file names, not even that
you opened it. We genuinely don't know how many people use it. See [Privacy](#privacy).

## Features

- **Up to four screens.** Layouts for 1 screen, 2 side by side, 3 or 4 in a wide arc, or a
  2×2 grid. Screens curve around you, the arcs give tall videos full height, and screens space
  themselves so they never overlap, whatever their size or shape.
- **Focus zoom and fit all in view.** Optionally, the screen you look at slides toward you for
  a bigger, sharper picture while the others stay in view. One button shrinks everything to fit
  within 90°.
- **Crop empty borders.** Cut away black, white or plain bars at the sides of a video, by hand
  or automatically (it looks for edges that stay still while the picture moves), so the picture
  itself can be bigger.
- **Independent controls per screen.** Play, pause, seek, skip, volume, mute, solo (hear one
  screen only), loop, playback speed and size, from a control bar under each screen.
- **Media browser in VR.** Browse your video and photo folders from inside the headset, with
  thumbnails, on a curved panel. Sort each folder A–Z or newest first, then pick which screen
  a video goes to. Each screen remembers where it was. A Settings page in the browser has the
  layout and options, so you never need to take the headset off.
- **Playlists.** Picking a video makes the rest of its folder that screen's playlist. When a
  video ends, a screen can stop, play the next one, or shuffle the folder. PLAY ALL and
  SHUFFLE start a whole folder; **SHUFFLE ALL** also mixes in every subfolder, so one press
  shuffles a whole collection. A **VIDEOS / PHOTOS** switch picks which of the two they play.
  Photos are shuffled as **sets**: each folder plays in order, and the sets come in random order
  (PREV / NEXT skip a whole set).
  After adding or removing files, press **↻** in the browser so the next shuffle sees them.
- **Photo slideshows.** Any screen can show a folder of photos as a slideshow, with an
  adjustable time per photo.
- **3D.** Side-by-side (SBS) and over/under (OU) videos and photos, full or half width, with a
  left/right eye swap. `.jps` stereo photos are detected automatically.
- **Xbox controller with a head cursor.** A small ring in the middle of your view works as a
  pointer: look at any button and press **A**. Touch/motion controllers also work, and so
  does the mouse on the desktop preview.
- **Rearrange on the fly.** Swap two screens' places without interrupting playback.
- **Remembers your settings.** Layout, curved screens, focus zoom, photo time, VR render
  resolution and the other settings come back next time; **Reset settings** undoes them.
- **Private by design.** Everything runs in your browser. Videos and photos are read straight
  from your disk and are never uploaded anywhere. No analytics, no telemetry, no data collected.

## What you need

- A PC VR headset that works with WebXR in Chrome or Edge, for example an Oculus/Meta Rift,
  a Quest over Link/Air Link, or a SteamVR headset.
- **Chrome or Edge** on Windows. Other browsers lack WebXR or folder access.
- Optional: an Xbox controller (wired or Bluetooth).

## Getting started

1. Open Four Eyes in Chrome or Edge on the PC your headset is connected to, with your
   headset's PC app (Oculus, SteamVR…) running.
   - **Hosted:** open the published page (for example on GitHub Pages).
   - **Locally:** download `index.html` and open it in Chrome.
2. Under **Media library**, click **Add video folder…** and choose the folders your videos and
   photos are in. You only do this once, because the browser remembers them. After a browser
   restart you may need to click **Reconnect** once.
3. Pick a layout at the top (1 screen, 2 screens, 3 wide, 4 grid, 4 wide).
4. Click once anywhere on the page so the browser has focus (it won't receive controller
   input otherwise), then press **Enter VR**.
5. In VR, press **View** on the Xbox controller (or **FILES** on a screen's control bar) to
   open the media browser, and pick something to watch.

You can also load a single file or a direct video link onto a screen from its card on the
page.

## Controls

### Xbox controller

One screen is selected at a time, shown by a coloured frame. Looking at a screen selects it.

| Button | Action |
|---|---|
| **A** | Click whatever the head cursor is on. When it's on nothing, play/pause the selected screen |
| **View** | Open or close the media browser |
| **Menu** | Play or pause all screens |
| **D-pad left / right** | Previous / next video (or photo) in the selected screen's playlist |
| **D-pad up / down** | Volume (on a photo screen: time per photo) |
| **LB / RB** | Back / forward 10 seconds (photos: previous / next), hold to repeat |
| **LT / RT** | Back / forward 1 minute |
| **Left stick left / right** | Scrub 5 seconds at a time |
| **Right stick up / down** | Make the screen bigger or smaller |
| **Right stick left / right** | Crop the sides of the picture in or out |
| **B** | Mute |
| **X** | Solo this screen's sound |
| **Y** | Loop |
| **Left stick click** | Keep control bars visible, or let them fade |
| **Right stick click** | Show or hide the head cursor |

In the media browser: **A** opens a folder or plays what's under the cursor, **B** goes up a
folder (or closes the browser), and **LB / RB** or the **D-pad** turn pages. **⚙ Settings** at
the top left holds the layout, curved screens, focus zoom, fit all in view, head cursor, crop
options and photo time.

### Touch / motion controllers

Point at a screen or button and pull the trigger. The trigger on a screen plays or pauses it.
While pointing at a screen, the thumbstick skips (left/right) and changes volume (up/down).

### Control bar

Each screen has a two-row bar underneath it:

- **Top:** FILES · PREV −10 ▶ +10 NEXT · MUTE V− V+ SOLO · S− S+ (CROP) LOOP SWAP
- **Bottom:** seek bar · time (or photo count) · file name


- **SWAP:** press it on one screen (its frame blinks), then look at another screen and press
  **A**, or press that screen's button, which now reads **HERE**. The two trade places and
  keep playing.
- **Photos:** on a screen showing photos, V−/V+ become **T−/T+** (time per photo), and −10/+10
  go to the previous/next photo.
- **CROP** (turn on "CROP button on screen bars" in settings): press it while the video plays
  to cut away empty borders; press again to undo. The head cursor fades while you watch a
  screen and comes back when you look elsewhere.

## Supported files

- **Video:** whatever the browser can play. MP4 (H.264) and WebM work everywhere; H.265/HEVC
  and MKV depend on your system's codecs.
- **Photos:** JPG, PNG, WebP, GIF (first frame), BMP, AVIF, and JPS stereo photos.

## Tips and troubleshooting

- **Picture freezes but sound keeps playing:** Chrome pauses video pictures when it thinks the
  page is hidden. Don't minimize the Chrome window or cover it completely while you're in VR.
- **Where the screens appear:** a moment after you enter VR, Four Eyes centres the screens on
  your head, in front of the way you're facing and at your eye height. Sit or stand the way
  you'll watch and look straight ahead as you press Enter VR. To move them later, recentre your
  headset (hold the Oculus / system button) and they follow.
- **"The browser blocked playback":** click once on the page (browsers only allow sound after
  you've interacted with a page), then try again.
- **File pickers don't open inside the headset.** Add your folders on the PC first; after that,
  everything can be picked in VR.

## Privacy

Privacy is the point, not an afterthought.

- **No analytics, telemetry or tracking.** There's no analytics script, no usage counter, no
  crash reporter, no cookies and no account. Four Eyes never sends anything about you or your
  viewing anywhere, so nobody, including the author, knows who uses it or what they watch.
- **Your files stay on your computer.** Videos and photos are read directly from your disk by
  your browser and are never uploaded.
- **Nothing about what you watch is saved.** No watch history, recently played list or file
  names are stored, so someone else using the same computer can't see what you played.
- **What is stored, only in your browser:** your settings (layout and options, in
  localStorage) and access to the folders you added, which includes the folder names (in
  IndexedDB, so you don't have to pick them every time). **Remove** next to a folder under Media library forgets it, **Reset
  settings** clears the settings, and clearing the site's data in your browser removes both.
- **What the page loads from elsewhere:** three.js from cdnjs and fonts from Google Fonts, like
  any web page loading a library. These are plain downloads; Four Eyes sends them nothing
  about you. The host (for example GitHub Pages) and those CDNs may keep standard server
  logs, as every website does. To avoid even that, download `index.html` and the files it
  loads, and run it locally.
- **Check it yourself.** It's one readable HTML file with no build step. The only things it
  loads from elsewhere are the three.js and font files above; its other web addresses (its
  own page address and a link to this repository) are plain links that load nothing.

## FAQ

**How can I watch multiple flat videos at once in VR?** Open Four Eyes in Chrome or Edge on
your PC, add your video folders, choose 2, 3 or 4 screens and press **Enter VR**. Each screen
plays its own video with its own controls and sound.

**Is it free?** Yes. It's free and open source (AGPL-3.0), with no account, no ads and no in-app
purchases.

**Which headsets work?** Any PC VR headset Chrome or Edge supports through WebXR: Meta Quest 2,
3 and Pro over Link or Air Link, Rift, and SteamVR headsets such as Index or Vive.

**Does it play 3D videos?** Yes: side-by-side (SBS) and over/under, full or half width, plus
`.jps` stereo photos. You can mix flat and 3D screens.

**Does it collect any data?** No. See [Privacy](#privacy).

**Like it?** Four Eyes counts nothing, so a ⭐ star on this repository is the only way to know
it's being used. Stars also help other people find it.

## How it's built

One self-contained HTML file with no build step and no server. It uses
[three.js](https://threejs.org/) (r128, loaded from a CDN) for rendering and WebXR, the
browser's File System Access API for folder browsing, and the Gamepad API for the Xbox
controller. Your added folders are remembered in the browser's IndexedDB.

## Running the tests

The tests open the app in headless Chrome and check layout, Fit all in view, curved screens, crop
detection, the control bar, settings and the media browser (shuffles and photo sets). They use the
Chrome already on your computer.

```sh
npm install
npm test
```

If Chrome is somewhere unusual, point to it with `CHROME_PATH`. The tests open the page with
`?test` in the address, which makes it share its internals with them; normal visits never do.
They also run automatically on every pull request on GitHub.

What they can't cover is the headset itself: how it looks and feels in VR is still checked by hand.

## License

Copyright © 2026 Rodney Moore. Four Eyes is free and open source under the [GNU Affero General Public License v3.0](LICENSE)
(AGPL-3.0). You can use, change and share it, including running it on a website, as long as
anyone who uses your version can get its full source code under the same licence.

Versions released before this change were under the MIT License, and stay under it.

**Commercial licensing.** If you want to build Four Eyes into a website or product without the
AGPL's terms, a commercial licence is available. Contact
[@rodbuilds on GitHub](https://github.com/rodbuilds).
