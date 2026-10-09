# Reasoning out a scene (gaitbench.scene.v2)

You write one JSON file that describes the video: the place, the person, and **what the person's body does, as poses over time**. The camera for the output is set by the user in the studio, not by you. Nothing is measured from the pixels and nothing is decided for you: the scripts draw what you write, and blend between your poses. If she stumbles, scrambles on all fours, falls flat or lies still, you write that, and that is what is drawn. Aim for **plausible and broadly similar**, not exact.

`gb.mjs look VIDEO` writes a starting `scene.json`. `references/example.scene.json` is a complete example: a walk on ice, a slip, a drop onto a knee with one hand on the ice.

## Coordinates

- Metres, y up, the ground at y = 0 (or the terrain's height).
- At t = 0 the camera stands at x = 0, z = 0 and looks along +z. +x is to its right.
- Azimuths are degrees clockwise from +z: 0 is straight away from the camera, 90 the camera's right, 180 toward the camera.
- A person facing `facing_deg` has her own left at `facing_deg − 90`. Facing the camera (180), her left is the camera's right (+x).

Sketch it from above before writing numbers: where the person is at each moment, which way she faces, and how the ground runs.

## The order

### 1. A viewpoint, roughly

The output's camera is the user's: they set it in the studio (Orbit, then **Use this view**), and every export (video, clay and contact references) uses it; the 3D file has no camera at all. You only need a rough viewpoint so the comparison sheet lines up with the clip, so spend little time on it:

- `camera`: `{ "lens": "main", "height_m": 1.4, "path": [{"t": 0, "at": [0, 0]}], "aim": "figure" }`, moved to about where the clip's camera stood (`path` keys if it followed her). `lens` is `main`, `ultrawide`, `2x`, `3x` or `5x`.
- Don't refine it beyond "she's about the right size and side-on the right way" in the sheet. `camera.fixed` is the user's own view and is written by the studio: leave it alone.

### 2. Ground, terrain, sky, sun

- `ground.colour` is the main surface. `patches` adds a second material in blobs (snow on ice, puddles): `colour`, `cover` (0–1), `size_m`. `shine` (0–1) is how much it mirrors the sky: wet ice 0.3–0.4, wet tarmac 0.2, dry 0. `surface` names it (dry, wet, grass, snow, ice …). It is a label for the reader, and changes nothing in the drawing.
- `terrain` shapes the ground as a polygon grid, so feet and knees and hands rest on it:
  - **near**: `{size_m: 30, cell_m: 0.25}`, with `far_cell_m` and `extent_m` for the rest.
  - **noise**: `{amp_m, scale_m}` for bumps.
  - **features**:

| kind | what it makes | fields |
| --- | --- | --- |
| `slope` | the whole ground tilted | `grade_deg`, `toward_deg` |
| `step` | a bank, kerb, terrace edge or wall | `line` [[x, z], …], `toward` [x, z] (a point on the high side), `height_m`, `width_m` |
| `ridge` | an embankment, a drift | `line`, `height_m`, `width_m` (half-width) |
| `mound` | a hump; negative `height_m` makes a dip | `at` [x, z], `radius_m`, `height_m` |
| `area` | a patch of other ground: a path, a lawn, a block | `poly` [[x, z], …], `height_m`, `edge_m` |

  - All features take `colour` and `shine`.
  - `grid` draws pinstripes: `{show, every_m: 0.5, micro_every_m: 0.1, micro_fade_m: 4, colour, opacity}`. The 10 cm microgrid near the camera shows where feet land and slide.
- `sky.zenith`, `sky.horizon`, `haze_m`.
- `sun.azimuth_deg` and `elevation_deg` come from shadows and which side is lit. `sun.strength` (0–1) is 0.2–0.3 under full cloud.

### 3. Far scenery and props

- `far` bands sit round the horizon: `{kind, from_deg, to_deg, distance_m, height_m, colour}`. `kind` is `trees`, `bare_trees`, `buildings`, `hills`, `bank` or `wall`.
- `props` are single objects `{kind, at: [x, z], height_m}`: `pole`, `lamp`, `tree`, `bare_tree`, or `box` (with `width_m`, `depth_m`, `yaw_deg`).
- Distant scenery is only a landmark. The ground near her matters more.

### 4. The figure

- `stature_m` is barefoot height. `build` is `slim`, `average` or `broad`.
- `hair` is `none`, `short`, `long` or `bun`. `sleeves`, `top_length` (`crop`/`full`), `bottom_length` (`shorts`/`knee`/`full`).
- `bag`: `left` or `right` if she carries one.
- `footwear.model` is a real shoe (`gb.mjs shoes`, `references/shoes.md`). Give `heel_cm` and `platform_cm` as seen. The shoe is sized to her.
- `colours`: `skin`, `hair`, `top`, `bottom`, `legs`, `shoes`, `sole`, `heel`, `bag`. Use `footwear.colours: "scene"` to draw the shoe in your colours rather than the model's own. `gloss` (0–1) per material.

### 5. What she does: `action` and `poses`

First say it in words, in `action.why`: what she does from start to end, with times. For example: "walks slowly up the bank bent forward, hands down to the snow; her feet skid back at 9, 18 and 21 s; at 26 s her left leg shoots back and she falls forward onto her front and stays there". Then write it as poses.

Step through the frames at the moments that matter: each change of posture, each footfall, each slip, the start and end of a fall. Use `gb.mjs look VIDEO --at 8.5,9,9.5` for a close look at a moment. At each moment write a pose:

```json
{ "t": 9.0, "at": [0.2, 3.1], "facing_deg": 20, "pelvis_m": 0.62,
  "trunk": { "pitch_deg": 55, "roll_deg": -5, "twist_deg": 0 },
  "head": { "pitch_deg": -10, "turn_deg": 0 },
  "feet": { "left": { "at": [0.32, 3.2], "lift_m": 0, "out_deg": 20, "pitch_deg": 0 },
            "right": { "at": [0.05, 2.7], "slide": true } },
  "arms": { "left": { "raise_deg": 60, "out_deg": 20, "elbow_deg": 20 } },
  "hands": { "right": { "on": [0.1, 3.6] } },
  "note": "right foot skids back; right hand down on the snow" }
```

- `at`: the ground point under her pelvis. `facing_deg`: which way her hips face.
- `pelvis_m`: the pelvis's height above the ground there. Standing it is about 0.53 × stature. Crouched it is 0.4–0.6 m, kneeling about 0.45 m, sitting on the ground 0.1–0.15 m, lying 0.1–0.15 m. Leave it out and the legs set it, standing on the planted feet. Once given, it holds until a later pose gives another height, or `"auto"` to hand it back to the legs.
- `trunk.pitch_deg`: how far the trunk leans forward from upright. 0 is upright, 45 bent well over, 90 lying on her front, −90 lying on her back. `roll_deg` + leans to her left. `twist_deg` + turns her shoulders to her left.
- `head.pitch_deg`: + looks down. `turn_deg` + turns to her left.
- `feet.<side>`: each foot by its ball.
  - `at` is where it is on the ground, `lift_m` how high it is off it.
  - `out_deg` turns the toes out (+) or in (−).
  - `pitch_deg` tips the toes down (+): on tiptoe, or toes dug in kneeling or lying on her front (60–90).
  - A foot stays where you last put it. When a later pose puts it elsewhere, it steps there in an arc over the time between the two poses. With `slide: true` on the later pose, it slides there along the ground instead, drawn as sliding.
  - So write a foot's pose where it lifts and again where it lands. Write it where it starts to slide and where it stops.
- `arms.<side>`:
  - `raise_deg` is the upper arm from hanging (0) through level (90) to straight up (180).
  - `out_deg` is its direction: 0 forward, 90 out to the side, 180 back.
  - `elbow_deg` is the bend.
- `hands.<side>.on: [x, z]` presses the hand on the ground there. It stays there until a later pose gives that arm's angles.
- Anything a pose leaves out is held from the poses around it. Before the first pose that gives it, it is a relaxed default.
- Between poses, the body travels and turns smoothly. Feet move only as described above.

**Think about the body.**
- Bent over with hands on the ground needs the pelvis low and the trunk pitched 60–80°: a person's arm is about 0.33 × stature long.
- A foot sliding away behind her drops the pelvis and pitches the trunk.
- A fall forward goes from the last standing pose, through a pose with the trunk past 45° and the hands reaching out (0.3–0.5 s later), to her lying on her front with `pelvis_m` about 0.12 and the trunk at 90°.
- Write what you see, at the times you see it.

`check` tells you when a pose can't be reached: a hand put further than the arm reaches, or a pelvis too high for the planted feet. Fix it there.

### 6. Compare, and correct

1. `gb.mjs check scene.json`: format problems and unreachable limbs. It also lists each pose with what touches the ground.
2. `gb.mjs render scene.json --sheet`: the original beside the render at your pose times (or `--at 2,9,26`). **Look at each pair.** Is the posture the same: the trunk's lean, the knees, where the hands and feet are, what touches the ground? Is the ground's shape right under her?
3. Fix the poses (and the ground) where they differ, and render the sheet again. Two or three rounds. Move the rough viewpoint only if the sheet can't be compared at all.

This look-and-correct loop is the method. Nothing else checks the movement for you.

### 7. Evidence

- Each section (`action`, `figure`, `ground`, `terrain`, `sky`, `sun`) takes:
  - a `why`: what you saw;
  - `confidence`: `unknown`, `weak`, `moderate` or `strong`;
  - `basis`: `seen`, `inferred` or `assumed`.
- `alternatives`: `[{about, instead, because}]` for readings you chose between.
- `differs`: what the drawing can't show of what you saw (snow spray, a scarf). Never put the person's main action here: if she falls, the poses show her falling.
