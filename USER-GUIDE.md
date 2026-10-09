# Gait Bench: user guide

> **Status:** on hold since 9 Oct 2026 while we wait for a new major version of the AI model. 2.0.1 keeps working as described here, but expect the figure's movement to be broadly similar to your clip rather than convincing.

Gait Bench turns a short video of a person into a simple 3D scene with a figure moving as they did: walking, slipping, scrambling, falling. You get a video beside your original, a page you can play and orbit, and the scene file. Claude does the reasoning, posing the body from what it sees and checking its render against your clip; small scripts on your computer only draw it.

## 1. Install

You need Node.js 18 or newer, and ffmpeg with libx264 for video (`brew install ffmpeg`, `sudo apt install ffmpeg`, `winget install ffmpeg`, or `pip install imageio-ffmpeg`).

- **Claude Code:**
  ```
  /plugin marketplace add erdoar/gait-bench-plugin
  /plugin install gait-bench@gait-bench
  ```
  (or `/plugin marketplace add https://gait.nulytica.com/marketplace.json`, the same plugin from the website)
- **Claude desktop app:** download `gait-bench.plugin` from https://gait.nulytica.com and add it as a plugin.

To update later: `/plugin marketplace update` (each release is published on GitHub at https://github.com/erdoar/gait-bench-plugin). The studio shows its version in small type at the bottom, with the update command (**Copy** copies it) and a link to the releases for the desktop app.

## 2. Make a capture

1. Say **"capture"**, **"mocap"** or **"gait"**. Claude opens the **Gait Bench Studio** panel.
2. Press **Capture a clip** (or drop a video on the Original panel) and choose your clip. It plays at once, on your device only.
3. Press **Send to Claude ▸** (the same button, relabelled once a clip is chosen). The clip goes to the studio's private storage, nowhere else, and the studio sends Claude a comment so it starts by itself (the first time, allow the studio to post comments). If it can't, the button turns into **Tell Claude ▸**, or the progress line asks you to say "capture" in the chat. A progress bar shows each step: clip received, looking at the frames, posing the figure, comparing with the clip, building the result, done.
4. The result appears beside your original, playing, whenever you open the studio. Claude also writes a short summary in the chat: its main guesses, how sure it is of each, and what differs from your video.

You can also just attach a video in the chat and ask: "Recreate this in 3D".

## 3. Use the result

- **Play bar:** play and pause (Space), step a frame (← →), speed ¼×, ½×, 1×.
- **Layout:** side by side, overlay (the reconstruction over your clip), reconstruction only, or original only.
- **Look:** Scene (as reasoned), Clay (neutral greys) or Contact (planted soles blue, sliding soles orange). Clay and Contact make good reference videos for video models such as Seedance.
- **Your camera / Orbit:** in Orbit, drag to turn around the scene and scroll to zoom. Press **📷 Use this view** to make that view your camera: playback and every video you save use it.
- **⛶** fills the screen; **⧉ Pop out** opens the player in its own window for a second monitor.
- **Stop** halts playback and rendering at once and empties both panels; use it if the panel jams. **Reset** clears the clip and the progress, including a capture left unfinished (the progress bar says when one has stalled); while Claude is still working, press it twice to cancel.
- **Results:** save, from your camera, the video, a clay reference and a contact reference (WebM; rendered frame by frame in the page, about a minute for 30 s). Also save the 3D file (`.glb`: the moving figure and its ground, for Blender or any glTF viewer, where you choose the camera), the scene file (with your camera) and the result page (works offline).
- **How the scene was reasoned:** each guess with its confidence (weak, moderate, strong) and whether it was seen, inferred or assumed, plus the other readings Claude considered.

## 4. Ask for changes

Say what you want in plain words, for example:

- "Same scene from further away" or "on a 2× lens"
- "She's wearing trainers, not boots"
- "The camera was level", "the ground is wet", "it's packed snow, not ice"
- "She slips at about 4 seconds", "both hands are on the ground there", "she falls forward onto her front at the end"
- "Put the original beside it" or "give me the 3D page"

Facts you know (the person's height, the lens, a level or fixed camera) help most. Claude keeps them and works everything else out around them. Corrections to the movement go straight into the poses.

## 5. Clips that work best

- 5 to 30 seconds, one person, the body and feet visible for most of it.
- Handheld is fine: a moving camera helps work out the ground.
- Any size: a clip over 20 MB (the artifact upload limit) is shrunk in the studio before sending, to at most 960 px; that takes about as long as the clip runs.

## 6. What it is, and isn't

The result is a reasoned reconstruction: the same kind of place, person and movement, framed about the same. It is not a measurement. Height, distance, the lens, the camera's path and every pose are Claude's judgements from looking, and the summary says which ones mattered and how sure it is. The figure moves between the moments Claude posed, so fast movements between them are smoothed.

## 7. Privacy

Your clip stays on your device until you press Capture in the studio. Then it is stored in the studio's private storage in your Claude account, and Gait Bench sends it nowhere else. The update check contacts gait.nulytica.com only when you press it.

## 8. Licence

Free to use; not to be copied, modified or redistributed. See `LICENSE`. The shoe models carry their own credits (`skills/gait-bench/shoes/CREDITS.md`).
