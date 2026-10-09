# Gait Bench plugin

Rebuilds a video of a person as a simple 3D scene: the ground, sky and sun, the scenery around the horizon, a few props, and the camera with its movement, optionally as polygon-grid terrain with banks, kerbs and walls. A figure in it moves as the person did: walking, slipping, scrambling, falling or lying still. You set the camera in the studio and save a video from it, clay and contact references for video models, or the whole thing as an animated 3D file (`.glb`) for Blender or any glTF viewer.

Claude does the reasoning. It looks at the frames and works out the lens, the camera's height and distance, the place and the person, and poses the person's body at the moments that matter, writing down why. It then compares its render with your clip, frame against frame, and corrects itself. Small Node scripts only draw what Claude wrote: no program decides how the person moves. Shoes are real 3D models fitted to a real human foot (47 ship with the plugin); no shape is invented. Nothing is measured from the pixels, and your clip is uploaded nowhere unless you press Capture in the studio panel.

**How to use it: [USER-GUIDE.md](USER-GUIDE.md).**

## What you can ask

- "Mocap", "capture" or "gait": opens the **Gait Bench Studio** panel in the Claude app at once. Drop a clip in it, preview the result, and save the scene, page and video
- "Recreate this in 3D" (attach one video)
- "Put the original beside it"
- "Give me the 3D page" (one HTML file: your clip beside the reconstruction, synced, with overlay and orbit; pop it out to another monitor and resize it)
- "Same scene, but on a 2× lens / from further away / in trainers"
- "She slips at about 4 seconds", "her hands are on the ground there", "she falls forward, not back"

## Needs

- Node.js 18 or newer
- ffmpeg with libx264 (`brew install ffmpeg`, `sudo apt install ffmpeg`, `winget install ffmpeg`, or `pip install imageio-ffmpeg`)

## Honest claims

The result is a reasoned reconstruction: the same kind of place, person and movement, framed about the same. It is not a measurement. Lens, stature, the poses and the camera's path are Claude's judgements from looking, and the result says which ones mattered and why. Planted feet stay put, limbs never stretch, and a pose a body can't reach is flagged rather than faked.

## Install

Claude Code:

```
/plugin marketplace add erdoar/gait-bench-plugin
/plugin install gait-bench@gait-bench
```

Claude desktop app: download `gait-bench.plugin` from https://gait.nulytica.com and add it as a plugin.

## Licence

Free to use; not to be copied, modified or redistributed. See [LICENSE](LICENSE). The shoe models carry their own credits ([CREDITS.md](skills/gait-bench/shoes/CREDITS.md)).
