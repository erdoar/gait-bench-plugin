# Reasoning out a scene (gaitbench.scene.v1)

You write one JSON file that describes the video well enough to rebuild it as a simple 3D scene, and a figure that does broadly what the person did. Nothing is measured from the pixels: every value is your best guess from looking, and each section carries a `why` that says what you saw. Aim for **plausible and broadly similar**, not exact. A good scene is one a viewer would accept as the same place, the same kind of person and the same kind of movement.

`gb.mjs look VIDEO` writes a starting `scene.json` with the `source` block filled in. `references/example.scene.json` is a complete example.

## Coordinates

- Metres, y up, ground at y = 0 (flat).
- At t = 0 the camera stands at x = 0, z = 0 and looks along +z. +x is to its right.
- Azimuths (`azimuth_deg`, `from_deg`, `to_deg`) are degrees clockwise from +z, so 90 is the camera's starting right and 180 is behind it.

Sketch the layout from above before writing numbers: where the camera starts, where the person starts and ends, and which way the camera turns or moves to keep them in frame.

## Reason in this order

### 1. Camera: lens, height, distance

These set everything else, so settle them first.

- **Lens.** Use `main` (67° across the long side), `ultrawide`, `2x`, `3x` or `5x`, or give `hfov_deg` across the frame's width.
  - The size of the figure in the frame can't separate the lens from the distance, because a near camera on a wide lens and a far camera on a long lens frame a person the same.
  - The **ground** can: on a long lens the floor near the bottom of the frame looks flattened (round patches look like thin ellipses) and the shoes are seen side-on. On a wide lens the near floor opens out and the feet are seen from above.
  - Background size helps too: distant buildings that look large mean a long lens.
- **Height.** The horizon runs through the person at the camera's height. If the far shore or the end of a flat floor crosses them at the hips, the camera is at hip height (about 0.55 × stature, plus any heel). Use the horizon whenever it's visible.
- **Distance.** It follows from the lens and how much of the frame the person fills. A person who fills the frame height is f × (stature + heel) / frame height away, where f = (width / 2) / tan(hfov / 2).
- **Movement.** `path` holds key positions `[{t, at: [x, z]}]`, linear between keys and lightly smoothed.
  - If the person stays the same size while walking toward or past the camera, the operator is moving with them (a dolly).
  - If the background swings by a lot, the camera turns. With `aim: "figure"` it turns by itself to keep the figure in frame.
  - `aim_offset: [x, y]` sets where the figure sits, as fractions of the frame (+ is right, down).
  - `lag_s` is how far the operator's aim trails behind the figure.
  - `shake` is 0–1 of hand-held wobble.

### 2. Ground, sky, sun

- `ground.colour` is the main surface.
  - `patches` adds a second material in blobs: snow on ice, grass in gravel, puddles. Give its `colour`, `cover` (0–1) and blob `size_m`.
  - `shine` (0–1) is how much the surface mirrors the sky: wet ice 0.3–0.4, wet tarmac 0.2, dry ground 0.
  - `surface` is what the feet stand on: `dry`, `wet`, `grass`, `snow`, `ice`, `wet_ice` or `black_ice`. It sets the grip. `check` then says which planted steps that ground couldn't hold, and `activity.mix` can let the ice-walk physics adjust the walk (`references/scene-options.md`, "Friction and the cap/sim mix").
- `sky.zenith` and `sky.horizon` are the colours straight up and at the horizon. `haze_m` is how far you can see before things fade into the horizon colour (clear winter air 3000 m, city haze 1000 m).
- `sun.azimuth_deg` and `elevation_deg` come from the shadows and from which side of the person is lit. A face lit with no harsh shadow means the sun is behind the camera. A low winter sun is 15–25° up; overcast light is high and soft: give it `sun.strength` 0.2–0.3 so shadows stay faint.

### 3. Far scenery and props

`far` lists bands around the horizon. Each has `kind`, `from_deg`, `to_deg`, `distance_m`, `height_m` and `colour`.

| kind | what it is |
| --- | --- |
| `trees` | leafy trees |
| `bare_trees` | winter trees you can see through |
| `buildings` | a skyline; `width_m` per building, `gaps` 0–1 |
| `hills` | smooth high ground |
| `bank` | a shore or kerb line |
| `wall` | a fence or wall |

- A nearer band hides farther ones.
- Remember the camera may turn: put scenery where it will come into view. For example, a skyline that appears on the right late in the clip sits at azimuth 40–120°.
- Height and distance together set how tall a band looks. Something 9 m tall at 70 m rises about 6° above the horizon (at a camera height of about 1.2 m).

`props` are single objects at `at: [x, z]`:
- `pole`, `lamp`, `tree`, `bare_tree`: a `height_m` and an optional `width_m`;
- `box`: `width_m`, `depth_m`, `height_m` and `yaw_deg` (a bench, a bin, a car).

Two or three props that the camera passes do more for the sense of place than many distant ones.

### 4. The figure

- `stature_m` is barefoot height. Judge it from proportions and the surroundings; the heels are added on top.
- `build` is `slim`, `average` or `broad`. `hair` is `none`, `short`, `long` or `bun`. `sleeves` is `none`, `short` or `long`. `top_length` is `crop` (a bare midriff) or `full`; `bottom_length` is `shorts`, `knee` or `full` (trousers, the default). Below shorts the legs take `colours.legs` (skin, or the tights' tone).
- `footwear.heel_cm` is the height of the heel at the back, from the ground. `footwear.platform_cm` is the sole under the ball of the foot.

  | footwear | heel_cm | platform_cm |
  | --- | --- | --- |
  | trainers | 3 | 1.5 |
  | dress shoes | 3 | 1 |
  | mid heels | 6 | 0.5 |
  | high heels | 10 | 0.5 |
  | very high platform stilettos | 15–16 | 4 |
  | boots | 4 | 1.5 |
  | bare feet | 0 | 0 |

  Then choose the shoe: a real library model in `footwear.model` (46 real shoes, plus the real bare foot), or a `footwear.style` name that picks the nearest model for you. `references/shoes.md` lists both. Every model is fitted to a real human foot and sized so the foot inside is 0.152 × stature. Leave `length_cm` out unless the footage fixes the size.
- Give one or two shoe boxes in `observed`, `{t, foot, box}`, each near a figure box. `check` then compares this person's shoe-to-height proportion, seen against rendered (`references/shoes.md`, "Checking the foot against the person").

  Compare the heel with the shin to judge it. The difference between heel and platform sets how steeply the foot points down.
- `colours`: `skin`, `hair`, `top`, `bottom` (trousers or leggings), optionally `legs` (bare legs or tights below the knee), `shoes` and `bag`.
- `gloss` per material (0–1), for leather, latex or wet hair.

### 5. The activity

- `kind` is `walk` or `stand`. For `stand`, give a one-point `path` and optionally `facing_deg`; by default the figure faces the camera.
- `path` is `[[x, z], …]`: where the body travels, drawn as a smooth curve. Make it a little longer than the distance walked; past its end the figure carries straight on.
- `speed_mps` and `cadence_spm` (steps a minute) set the step length: speed × 60 / cadence. Count the steps in the clip for the cadence. Typical values:

  | walk | speed | cadence | step |
  | --- | --- | --- | --- |
  | easy | 1.2–1.4 m/s | 105–115 | 0.7 m |
  | slow | 0.8 m/s | about 95 | |
  | high heels | 0.6–0.9 m/s | 95–110 | 0.35–0.5 m |
  | careful, on ice | 0.5–0.7 m/s | | short |

  `check` warns when the steps are too long for the figure.
- `style`:
  - `normal`;
  - `catwalk`: feet on one line, more hip sway and swing;
  - `careful`: wider, flatter, more bent knees.

  `step_width_m` is the sideways gap between the two feet's centre lines, across the path. It is **positive whenever the feet land side by side**, however far apart:
  - 0.08–0.12 m for normal walking;
  - 0.12–0.2 m on ice or a slope, where people widen their stance for balance;
  - 0 to −0.04 m only for a deliberate catwalk, with the feet landing on one line or just past it.

  Seen from behind, shoes about 18 cm apart mean +0.18, not −0.18. A larger negative value would cross the legs into an X, so the walker limits it to −0.04 and `check` warns.
- `knee_bend_deg` (0–45): knees seen bent through the walk (a braced walk on ice, a crouch). The stance leg never straightens past it. Seen from the front the bend points at the camera, so it shows less than it is.
- `toe_out_deg` (−10–35): feet turned out as seen; the style's own value otherwise (6° normal, 8° careful).
- `arms.left` and `arms.right` each take one of `swing`, `hang`, `bag` (it carries the bag), `hip`, `hair`, `phone`, `balance` (held out to the side for balance, elbows soft, rocking with the steps) or `catch` (flung up and out). `arm_raise_deg` `{left, right}` holds an out-held arm higher or lower than the pose's own, as seen.
- **For balancing, use the sim engine** (`activity.engine: "sim"`, `references/scene-options.md`): the kinematic walker below keeps a schedule; the sim engine balances.
- **Balance is worked out, not set.** The walker asks how much the body must balance with its hips and arms because the ankles can't: high heels (no heel to press), poor grip (`ground.surface`) and a cross-slope under the path each take some of the ankles' work away. When that demand is high, swinging arms come up and out, the trunk leans forward, the feet land wider and turned out, the knees bend and turn in over them, and the head bows to watch the feet. `check` notes the demand and why (`balance 0.93 (15 cm heels, μ 0.15, a 18° cross-slope)`). Give the ground, the shoes and the terrain right and the stance follows; set `activity.balance` (0–1) only to override it, 0 to switch it off, and `knees_in` (0–1) for the knees alone.
- **Slips are recovered.** Each slip (read off the footage, or added by the cap/sim mix) starts a response scaled by how far the foot went: the trunk folds forward, the pelvis drops onto bent knees, the arms fly up and out (highest on the slipping foot's side) and the other foot's next step lands early and wide to catch the body. `recover: false` on a slip leaves it out.
- `gestures` are timed poses: `[{arm, pose, from_s, to_s}]`, blended in and out over about 0.35 s.
- `start_foot` is the foot that lands first. `head_turn_deg` turns the head from the walking direction.

### 6. What you saw: `observed`

For three or four frames on the sheet, give the box around the whole person on the sheet's 0–1000 grid: `{t, box: [x0, y0, x1, y1]}`.

`check` compares the rendered figure with these boxes and says what to change:
- a figure too big or small means the camera distance or lens;
- a figure too far left or right means the path, the camera, `aim_offset` or `lag_s`;
- a figure too high or low means the camera height or `aim_offset` y.

Adjust and check again, two or three rounds at most. Being within about 15% in size and 100 grid units in place is good enough.

Where the frame cuts the person off (the head above the top edge, the feet below the bottom), give the box as far as the frame goes. `check` then compares only the uncut edge, the feet line usually, and leaves size to a shoe box (`{t, foot, box}`): a cut box's height says where the frame edge falls, not how big the person is.

### 6b. Where the ground ends: `ground_edges`, and the fix cycle

The figure has its boxes; the terrain has its edge. In two or three frames on the sheet, trace where the ground ends as a polyline on the 0–1000 grid: the top of a bank against the trees, a path's far edge, the horizon. `{t, line: [[x, y], …]}`, left to right, with a point wherever the line bends.

`check` finds where the rendered ground ends along the same columns (the ground stops at the first `far` band in that direction, as the trees hide what lies beyond) and reports how far off it is: the mean offset and the tilt. Past 40 grid units it tries the things that move that edge, one at a time: `camera.roll_deg`, `camera.height_m`, `camera.aim_offset` y, and each terrain feature's `height_m`, `width_m` or `grade_deg`. It names the single changes that bring the edge closest, each scored together with the figure's boxes, so a change that fixes the ground by moving the figure off them ranks lower.

What you know, hold. `camera.level: true` keeps the roll at 0 (a tripod, a gimbal, a generated clip prompted level), and `hold` lists any other knob names the fit must not touch (`"hold": ["camera.height_m"]`; `"camera"` holds every camera knob). Then the tilt of a traced edge is put down to the ground, where it belongs. Woods in `world.stands` stop the ground's edge as the far bands do (a tree line hides the ground beyond it).

Then go round:
1. `check`; read the ground line and the suggested changes.
2. Make the one change the footage supports. A tilted edge with trees leaning the same way is the camera's roll; a tilted edge with trees upright is the terrain.
3. `render --still T --compare` at a traced time. The still marks the edge as traced (green) and as rendered (magenta), and the figure boxes (yellow). Look at it (`--no-marks` leaves the marks off).
4. Repeat until the edge is within 40 grid units, two or three rounds. When no single change helps, the terrain's shape is wrong: add, move or remove a feature.

The fit is to your own tracing of the frames, not to the pixels. It can only be as right as the line you drew.

### 6c. The movement's fix cycle: `observed_joints`

The boxes say where the person is; the joints say what the body is doing. In two or three frames on the sheet, mark the joints you can see: `{t, joints: {hand_r: [x, y], knee_l: [x, y], …}}` on the 0–1000 grid. Names are the person's own left and right (facing the camera, their left is on the right of the picture): `head`, `neck`, `shoulder_l/r`, `elbow_l/r`, `hand_l/r`, `hip_l/r`, `knee_l/r`, `ankle_l/r`, `toe_l/r`. Mark the hands, knees and ankles at least.

`check` projects the figure's joints at those times and reports how far off they are, worst first. Past 40 grid units it tries the activity's big levers one at a time (stance width, balance demand, knees in, knee bend, toe-out, each arm's raise, the step timing, the path's line) and names the single changes that bring the figure closest. Make the one the footage supports, check again, and stop when no single lever helps: what is left is the pose itself at those moments (a gesture, a slip, a pause), and belongs in `gestures`, `slips` or `pace`, or in `differs`. The marked still shows the marks (cyan) joined to the figure's joints (red).

### 7. When the feet touch down: `contacts`

Where the feet are visible, step through the frames around two to four footfalls and note when each foot lands and, if you can see it, lifts: `"contacts": [{"foot": "left", "on_s": 1.28, "off_s": 1.92}, …]`. Add `"kind": "slide"` where a planted foot visibly glides (and model it with `slips`).

`check` sets these against the walker's own landings and lifts and reports the timing error. A steady offset means `step_offset_s` (it gives the value to use); landings that fit the other foot better mean `start_foot`; a scattered error means the cadence. One frame is the best you can read, so an error under about two frames is good. Leave out a foot you can't see land rather than guess it.

### 8. How sure you are: `confidence`, `basis` and `alternatives`

Give each main section (`camera`, `figure`, `activity`, `ground`, and `terrain`, `sky` and `sun` when they matter) a `confidence` of `unknown`, `weak`, `moderate` or `strong`, and a `basis`:
- `seen`: read directly off the frames (the horizon, the clothes, a footfall);
- `inferred`: worked out from what was seen (the lens from the floor's flattening, stature from the doorway);
- `assumed`: a typical value, because nothing in the footage says (a 1.7 m adult, a 26 mm phone lens).

These are words, not numbers: nothing here is calibrated, and a number would suggest it was. Never promote an inference to `seen`.

When the footage allows more than one reading, don't silently pick one. Choose the likelier for the scene and list the others: `"alternatives": [{"about": "terrain", "instead": "flat ice; the slope is the camera's roll", "because": "no horizon in frame"}]`. Do this especially when:
- **the feet are hidden** (grass, a hem, the frame edge, motion blur): mark `figure` and `activity` weak, leave out `contacts` for those steps, and say what the shoes could be;
- **the shoes and the ground disagree** (a sole that would sink into, or float above, the ground you reasoned): don't quietly change one to fit the other. Say which you trust more and why, and list the other readings: the terrain is wrong, the shoe is wrong, the camera's height or lens explains it, or that foot is not on the ground at all.

### 9. Say only what the scene holds: `differs`

Each `why` is read back against the scene. When a `why` says arms held out, bent knees, turned-out feet, a slip, a pause, a tilted picture or a moving camera, the scene must hold it (the field `check` names), or the render will contradict your words. What the renderer can't show at all, say in `differs`: `"differs": ["Fishnet tights are drawn as a flat tone."]`. Don't park a thing you saw in `alternatives` because there was no field for it: alternatives are other readings of the footage, not gaps in the render.

`check` lists the evidence and the alternatives, and names any weak or unknown section that has none. The studio shows them under "How the scene was reasoned".

## More options

`references/scene-options.md` adds terrain as a polygon grid (banks, kerbs, walls, furniture, a pinstripe grid and a foreground microgrid), library shoes traced from real photos (`figure.footwear.model`, zone-scaled to the heel and platform you see), detailed capsule shoes, and in the activity: footfall timing (`step_offset_s`), pauses (`pace`), glides and skids (`slips`) and upper-body `twist`. Use them when the footage shows them.

## Then

1. `gb.mjs check scene.json` checks that the walk is plausible, the framing matches the boxes, the ground's edge matches `ground_edges` (step 6b), the joints match `observed_joints` (step 6c), and the scene holds what the `why`s say.
2. `gb.mjs render scene.json --still T --compare` puts one frame beside the original. View it.
3. `gb.mjs render scene.json --compare` renders the video beside the original.
4. `gb.mjs render scene.json --look contact` draws the same scene in neutral clay with each planted sole in blue and each sliding sole in orange (`--look clay` without the marks). Use it as a reference for a video model, such as Seedance: it carries the path, the footfall timing, the ground and the camera without the reasoned colours. The result page has the same Scene / Clay / Contact choice.
5. `gb.mjs describe scene.json` writes the summary for the chat from the scene's own values: the main guesses with how sure each is, the other readings, what differs, and anything a `why` says that the scene does not yet hold. Send that, not a summary written from memory.
6. `gb.mjs view scene.json` writes the result page: the original beside the reconstruction, synced, with overlay, orbit, pop-out to its own window and fullscreen. `--artifact` writes it for a Claude artifact, so it shows with its controls in the app's chat (see SKILL.md).

## Honesty

Say what the scene is: a reconstruction by reasoning, broadly similar, with no measurement. Say which values are guesses that matter (the `confidence` and `basis` you gave them), usually the lens, the stature and the camera's movement, and what in the footage led to each. Don't claim speed, distance or stature as measured.
