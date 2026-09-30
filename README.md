# Four Eyes

Watch up to four videos or photo slideshows side by side in VR, each on its own screen with
its own controls.

Four Eyes is a single web page. Open it in Chrome or Edge on a PC with a VR headset, press
**Enter VR**, and your own videos and photos appear on floating screens around you. There's
nothing to install and no account, and your files never leave your computer.

## Features

- **Up to four screens.** Layouts for 1 screen, 2 side by side, a 2×2 grid, or 4 in a wide
  arc. Screens space themselves so they never overlap, whatever their size or shape.
- **Independent controls per screen.** Play, pause, seek, skip, volume, mute, solo (hear one
  screen only), loop, playback speed and size, from a control bar under each screen.
- **Media browser in VR.** Browse your video and photo folders from inside the headset, with
  thumbnails, on a curved panel. Sort each folder A–Z or newest first, then pick which screen
  a video goes to.
- **Playlists.** Picking a video makes the rest of its folder that screen's playlist. When a
  video ends, a screen can stop, play the next one, or shuffle the folder. PLAY ALL and
  SHUFFLE start a whole folder.
- **Photo slideshows.** Any screen can show a folder of photos as a slideshow, with an
  adjustable time per photo.
- **3D.** Side-by-side (SBS) and over/under (OU) videos and photos, full or half width, with a
  left/right eye swap. `.jps` stereo photos are detected automatically.
- **Xbox controller with a head cursor.** A small ring in the middle of your view works as a
  pointer: look at any button and press **A**. Touch/motion controllers also work, and so
  does the mouse on the desktop preview.
- **Rearrange on the fly.** Swap two screens' places without interrupting playback.
- **Private by design.** Everything runs in your browser. Videos and photos are read straight
  from your disk and are never uploaded anywhere.

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
3. Pick a layout at the top (1 screen, 2 screens, 4 grid, 4 wide).
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
| **D-pad left / right** | Select the previous or next screen |
| **D-pad up / down** | Volume (on a photo screen: time per photo) |
| **LB / RB** | Back / forward 10 seconds (photos: previous / next), hold to repeat |
| **LT / RT** | Back / forward 1 minute |
| **Left stick left / right** | Scrub 5 seconds at a time |
| **Right stick up / down** | Make the screen bigger or smaller |
| **B** | Mute |
| **X** | Solo this screen's sound |
| **Y** | Loop |
| **Left stick click** | Keep control bars visible, or let them fade |
| **Right stick click** | Show or hide the head cursor |

In the media browser: **A** opens a folder or plays what's under the cursor, **B** goes up a
folder (or closes the browser), and **LB / RB** or the **D-pad** turn pages.

### Touch / motion controllers

Point at a screen or button and pull the trigger. The trigger on a screen plays or pauses it.
While pointing at a screen, the thumbstick skips (left/right) and changes volume (up/down).

### Control bar

Each screen has a bar underneath it:
**FILES · −10 · ▶ · +10 · NEXT · seek bar · MUTE · V− V+ · SOLO · S− S+ · LOOP · SWAP**

- **SWAP:** press it on one screen (its frame blinks), then look at another screen and press
  **A**, or press that screen's button, which now reads **HERE**. The two trade places and
  keep playing.
- **Photos:** on a screen showing photos, V−/V+ become **T−/T+** (time per photo), and −10/+10
  go to the previous/next photo.

## Supported files

- **Video:** whatever the browser can play. MP4 (H.264) and WebM work everywhere; H.265/HEVC
  and MKV depend on your system's codecs.
- **Photos:** JPG, PNG, WebP, GIF (first frame), BMP, AVIF, and JPS stereo photos.

## Tips and troubleshooting

- **Picture freezes but sound keeps playing:** Chrome pauses video pictures when it thinks the
  page is hidden. Don't minimize the Chrome window or cover it completely while you're in VR.
- **Screens too high or low:** Four Eyes measures your eye height a moment after you enter VR
  and centres the screens on it. Sit or stand the way you'll watch before pressing Enter VR.
- **"The browser blocked playback":** click once on the page (browsers only allow sound after
  you've interacted with a page), then try again.
- **File pickers don't open inside the headset.** Add your folders on the PC first; after that,
  everything can be picked in VR.

## How it's built

One self-contained HTML file with no build step and no server. It uses
[three.js](https://threejs.org/) (r128, loaded from a CDN) for rendering and WebXR, the
browser's File System Access API for folder browsing, and the Gamepad API for the Xbox
controller. Your added folders are remembered in the browser's IndexedDB.

## License

[MIT](LICENSE)
