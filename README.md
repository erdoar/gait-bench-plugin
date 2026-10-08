# Gait Bench plugin

Rebuilds a video of someone walking as a simple 3D scene: the ground, sky and sun, the scenery around the horizon, a few props, and the camera with its movement, optionally as polygon-grid terrain with banks, kerbs and walls. A plausible animated figure in it does broadly what the person did. It renders as video, beside the original if you like, and as a page you can play and orbit.

Claude does the reasoning. It looks at the frames and works out the lens, the camera's height and distance, the place, the person and the walk, and writes down why. Small Node scripts build the walk and draw the pictures. Shoes are real 3D models fitted to a real human foot (47 ship with the plugin); no shape is invented. Nothing is measured from the pixels, and your clip is uploaded nowhere unless you press Capture in the studio panel.

**How to use it: [USER-GUIDE.md](USER-GUIDE.md).**

## What you can ask

- "Mocap", "capture" or "gait": opens the **Gait Bench Studio** panel in the Claude app at once. Drop a clip in it, preview the result, and save the scene, page and video
- "Recreate this walk in 3D" (attach one video)
- "Put the original beside it"
- "Give me the 3D page" (one HTML file: your clip beside the reconstruction, synced, with overlay and orbit; pop it out to another monitor and resize it)
- "Same scene, but on a 2× lens / from further away / in trainers / walking faster"

## Needs

- Node.js 18 or newer
- ffmpeg with libx264 (`brew install ffmpeg`, `sudo apt install ffmpeg`, `winget install ffmpeg`, or `pip install imageio-ffmpeg`)

## Honest claims

The result is a reasoned reconstruction: the same kind of place, person and movement, framed about the same. It is not a measurement. Lens, stature, speed and the camera's path are Claude's judgements from looking, and the result says which ones mattered and why. The walk is built so that planted feet stay put and limbs never stretch.

## Install

Claude Code:

```
/plugin marketplace add erdoar/gait-bench-plugin
/plugin install gait-bench@gait-bench
```

Claude desktop app: download `gait-bench.plugin` from https://gait.nulytica.com and add it as a plugin.

## Licence

Free to use; not to be copied, modified or redistributed. See [LICENSE](LICENSE). The shoe models carry their own credits ([CREDITS.md](skills/gait-bench/shoes/CREDITS.md)).
