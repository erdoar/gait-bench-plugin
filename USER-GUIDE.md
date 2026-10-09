# Gait Bench: user guide

Gait Bench turns a short video of someone walking into a simple 3D scene with a figure doing broadly the same thing. You get a video beside your original, a page you can play and orbit, and the scene file. Claude does the reasoning; small scripts on your computer build and draw it.

## 1. Install

You need Node.js 18 or newer, and ffmpeg with libx264 for video (`brew install ffmpeg`, `sudo apt install ffmpeg`, `winget install ffmpeg`, or `pip install imageio-ffmpeg`).

- **Claude Code:**
  ```
  /plugin marketplace add erdoar/gait-bench-plugin
  /plugin install gait-bench@gait-bench
  ```
  (or `/plugin marketplace add https://gait.nulytica.com/marketplace.json`, the same plugin from the website)
- **Claude desktop app:** download `gait-bench.plugin` from https://gait.nulytica.com and add it as a plugin.

To update later: `/plugin marketplace update` (each release is published on GitHub at https://github.com/erdoar/gait-bench-plugin). The studio shows its version in small type at the bottom, with **Check for updates**: when a newer version is out it gives the update command with a **Copy** button, and a link to the releases for the desktop app.

## 2. Make a capture

1. Say **"capture"**, **"mocap"** or **"gait"**. Claude opens the **Gait Bench Studio** panel.
2. Press **Capture a clip** (or drop a video on the Original panel) and choose your clip. It plays at once, on your device only.
3. Press **Capture** again to send it. The clip goes to the studio's private storage, nowhere else. A progress bar shows each step: clip received, looking at the frames, reasoning the scene, checking, rendering, done.
4. The result appears beside your original. Claude also writes a short summary in the chat: its main guesses, how sure it is of each, and what differs from your video.

You can also just attach a video in the chat and ask: "Recreate this walk in 3D".

## 3. Use the result

- **Play bar:** play and pause (Space), step a frame (← →), speed ¼×, ½×, 1×.
- **Layout:** side by side, overlay (the reconstruction over your clip), reconstruction only, or original only.
- **Look:** Scene (as reasoned), Clay (neutral greys) or Contact (planted soles blue, sliding soles orange). Clay and Contact make good reference videos for video models such as Seedance.
- **Cap ↔ Sim:** how far the motion follows your footage (cap) or the walking physics (sim). Sim gives shorter, more careful steps and slips on slippery ground.
- **Video camera / Orbit:** in Orbit, drag to turn around the scene and scroll to zoom.
- **⛶** fills the screen; **⧉ Pop out** opens the player in its own window for a second monitor.
- **Stop** halts playback and rendering at once and empties both panels; use it if the panel jams. **Reset** clears the clip and the progress, including a capture left unfinished (the progress bar says when one has stalled); while Claude is still working, press it twice to cancel.
- **Results:** save the scene file, the result page (works offline) and the videos. **Earlier captures** are listed below, each with **Show in player** and **Delete**; **Delete all** removes them all. Both ask to confirm.
- **How the scene was reasoned:** each guess with its confidence (weak, moderate, strong) and whether it was seen, inferred or assumed, plus the other readings Claude considered.

## 4. Ask for changes

Say what you want in plain words, for example:

- "Same scene from further away" or "on a 2× lens"
- "She's wearing trainers, not boots"
- "The camera was level", "the ground is wet", "it's packed snow, not ice"
- "Walking faster" or "she slips at about 4 seconds"
- "Put the original beside it" or "give me the 3D page"

Facts you know (the person's height, the lens, a level or fixed camera, the surface) help most: Claude holds them fixed and fits everything else around them.

## 5. Clips that work best

- 5 to 20 seconds, one person, the feet visible for most of it.
- Handheld is fine: a moving camera helps work out the ground.
- Under 20 MB to send from the studio; trim longer clips, or attach them in the chat.

## 6. What it is, and isn't

The result is a reasoned reconstruction: the same kind of place, person and movement, framed about the same. It is not a measurement. Height, speed, distance, the lens and the camera's path are Claude's judgements from looking, and the summary says which ones mattered and how sure it is. Hard balancing moments (slips, standing on ice in heels) are approximate.

## 7. Privacy

Your clip stays on your device until you press Capture in the studio. Then it is stored in the studio's private storage in your Claude account, and Gait Bench sends it nowhere else. The update check contacts gait.nulytica.com only when you press it.

## 8. Licence

Free to use; not to be copied, modified or redistributed. See `LICENSE`. The shoe models carry their own credits (`skills/gait-bench/shoes/CREDITS.md`).
