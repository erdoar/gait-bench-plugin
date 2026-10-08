# More scene options (1.1)

Everything here is optional and came from the walk-scene plugin. `references/scene.md` covers the rest of `scene.json`; a scene without these options renders as in 1.0, plus faint contact prints under planted feet.

## Camera keys from anchors

For each time t: her position P on the path at the walked distance, a viewing azimuth θ (+ = turned right) and a distance D; the camera sits at P − D·(sin θ, cos θ).

```python
import math
def at(path, s):
    acc = 0
    for (x0, z0), (x1, z1) in zip(path, path[1:]):
        L = math.dist((x0, z0), (x1, z1))
        if acc + L >= s: u = (s - acc) / L; return (x0 + u * (x1 - x0), z0 + u * (z1 - z0))
        acc += L
    return tuple(path[-1])
keys = [(0, 0, None), (1.2, 0, None), (2.3, 10, 1.65), (5.1, 48, 1.6), (7.4, 76, 1.9)]  # (t, theta_deg, D); None = still at the start
cam = [{"t": t, "at": [0, 0]} if D is None else
       {"t": t, "at": [round(at(path, v * t)[0] - D * math.sin(math.radians(th)), 3), round(at(path, v * t)[1] - D * math.cos(math.radians(th)), 3)]}
       for t, th, D in keys]
```

With `pace`, use the walked distance at t, not v × t.

## Terrain: the polygon grid

```json
"terrain": {
  "near": { "size_m": 30, "cell_m": 0.25 },
  "far_cell_m": 6,
  "extent_m": 300,
  "flat_under_path_m": 1.5,
  "noise": { "amp_m": 0.02, "scale_m": 3 },
  "features": [
    { "kind": "step", "line": [[-300, 26], [-40, 20], [0, 19], [40, 21], [300, 40]], "toward": [0, 200],
      "height_m": 2.5, "width_m": 10, "colour": "#b49b74", "why": "The far shore: a sandy bank 20 m away." }
  ],
  "grid": { "show": true, "every_m": 0.5, "coarse_every_m": 5, "micro_every_m": 0.1, "micro_fade_m": 4,
            "colour": "#ffffff", "opacity": 0.32, "width_px": 0.8, "fade_m": 30 },
  "why": "Flat glossy ice where she walks, rising to sandy banks at the far shore and on the right."
}
```

- **Grid**: half-metre pinstripes (`every_m` 0.5, `width_px` 0.8), 5 m lines to the distance, and a **foreground microgrid** of 10 cm squares (`micro_every_m` 0.1) that fades out by `micro_fade_m` (about 4 m). The microgrid shows foot placement and slips at the shoes. Keep the near mesh at 0.25 m cells outdoors and 0.1 m indoors.
- **Features**:

| kind | what it makes | fields |
| --- | --- | --- |
| `step` | a bank, kerb, terrace edge, or a **wall** (width_m 0.05–0.1, height 2.5–3 m) | `line` [[x, z], …], `toward` [x, z] (a point on the high side), `height_m`, `width_m` |
| `ridge` | an embankment, a drift, a **skirting board** (height 0.07, width 0.05) | `line`, `height_m`, `width_m` (half-width) |
| `mound` | a hump; negative `height_m` makes a dip | `at` [x, z], `radius_m`, `height_m` |
| `slope` | the whole ground tilted | `grade_deg`, `toward_deg` |
| `area` | a patch of other ground: a path, a lawn, or a **block** of furniture (height_m 0.4–2, edge_m 0.02–0.03) | `poly` [[x, z], …], `height_m`, `edge_m` |

All take `colour` and `shine`. Base ground: `ground.colour`, `ground.patches`, `ground.shine` (shine also gives reflections; `ground.reflect: false` turns them off). Build furniture as `area` blocks rather than `box` props, which render as rounded blobs. For a room, set `extent_m` about 40, `far_cell_m` 2 and `centre` in the room. A bank h high filling a degrees above the walking surface is about h / tan(a) away. Keep `far` bands for skylines beyond the terrain.


## The world: a solid set round the subject

Far bands are a backdrop: from the video camera they read well, but they are painted round the eye, so in Orbit they travel with the view. `world` builds the near surroundings as geometry instead, within `radius_m` of the action (default 15; 4–60), so the place holds together from any side:

```json
"world": {
  "radius_m": 24,
  "stands": [
    { "kind": "pine", "area": [[-4, -24], [-24, -24], [-24, 30], [-4, 30]], "spacing_m": 2.6, "height_m": 20 },
    { "kind": "birch", "line": [[6, -24], [6, 30]], "width_m": 6, "spacing_m": 3.5, "height_m": 15 }
  ]
}
```

- `stands` are woods, planted one tree at a time on the terrain: `kind` is `pine` (tall reddish trunk, crown high up), `spruce` (a dark cone to the ground), `birch` (white trunk, purple-grey twigs), `bare` (a leafless broadleaf) or `shrub`. Give an `area` polygon or a `line` with `width_m`, a `spacing_m` between trees, `height_m` (each tree varies by ±20%), and optionally `gaps` (the share of empty spots, default 0.2), `lean_deg`, `trunk_colour` and `crown_colour`. Trees keep `clear_m` (1.2 m) off the walking path. Placement is deterministic: the same scene plants the same wood.
- `centre` defaults to the middle of the walk.
- With a world, each `far` band becomes a ring of its `distance_m` round the world's centre, fixed in place. Keep those distances beyond `radius_m`, so the backdrop starts where the solid set ends.
- Props stand on the terrain where they are.
- `sun.strength` (0–1) softens the light and the shadows: 0.2–0.3 under full cloud, so a wood doesn't throw hard shadows on an overcast day.

Place stands where the footage shows them, relative to the path: the tree line's side, how far back it starts and what kind of trees. The ground-edge fit (scene.md, step 6b) stops at the first band; trees in a stand hide the ground in the render but not in that fit.

## Footwear

### A library shoe (preferred)

```json
"footwear": { "model": "<library id or path/to/model.json>", "heel_cm": 16, "platform_cm": 4.5, "length_cm": 24.5,
              "heel_clear": true, "amplify": 1, "colours": "photo" }
```

| field | effect |
| --- | --- |
| `model` | a library id (looked up in a `shoes/` folder beside the scene, the plugin's own `shoes/`, the folders in `GB_SHOE_LIBS`, then `/home/claude/shoe-library`) or a `model.json` path relative to the scene |
| `heel_cm` | target heel height: stretches the heel-spike zone and lifts the rear; sets the walker's foot pitch |
| `platform_cm` | target platform: stretches the platform zone and lifts the forefoot |
| `length_cm` | scales the whole shoe first. Leave it out and the shoe is sized to the wearer (a foot of 0.152 × stature inside it); `check` notes the length it chose and warns when a given length is more than 8% off |
| `heel_clear` | draws the spike see-through (pale tint if the reference heel was solid) |
| `amplify` | thickens the spike and deepens the toe box by this factor; the shoe's length, heights and contacts are unchanged (default 1) |
| `colours` | `"photo"` (default) uses the traced colours; `"scene"` uses `figure.colours.shoes` / `sole` / `heel` |

Shoes with a platform thicker than 2.5 cm stay rigid; thinner soles bend at the ball as the walker rolls onto the toe. Open shoes (pump, sandal, mule, flat, slingback) show the bare instep over the opening.

### Capsule shoes (last resort: generic shapes, not real shoes)

Only with `"capsule": true`, or for socks. Otherwise a style name draws the nearest real model (`references/shoes.md`).

```json
"footwear": { "style": "pump", "heel_cm": 16, "platform_cm": 4.5, "heel_clear": true, "amplify": 1.3 }
```

- `style` with `"capsule": true`: one of the style names in `references/shoes.md`, drawn from an upper, a toe, a heel, a sole, a shaft and straps you can override one by one.
- `heel_cm` / `platform_cm` set the foot's pitch; take them from the side view (heel against the shin, platform against the toe box). Very high platform stilettos run 15–17 cm on 4–5 cm.
- **`amplify`** (default 1; use 1.3) enlarges what defines the category, the heel spike, the platform block, the arch and the toe box, and lengthens the shoe a little, while the shell stays slim. The category then reads at a glance in a small or distant figure. Check a still at the shoes: the side view should show the same silhouette as the footage (for a platform pump, a steep wedge from a high heel cup down to a round toe box on a thick platform, and a thin heel to the ground), not a flat bar.
- Colours: `shoes` (upper), `sole` (platform edge), `heel` (pale blue-grey for clear). `gloss.shoes`: suede 0.05, leather 0.3, patent 0.6.


## Activity

- `speed_mps` = step length × cadence / 60 from the anchors.
- `start_foot` + `step_offset_s`: strikes fall at step_offset_s + k × (60 / cadence), alternating from `start_foot`; choose them so strikes land within about 0.2 s of the observed footfalls. Put the footfalls you see in `contacts` (`references/scene.md`, step 7) and `check` works out the offset for you (with `pace`, on the walk's own clock).
- `pace`: `[[t, rate], …]` (1 = walking, 0 = holding still) for standing, pauses, slowing. Standing then walking at 2.8–3.4 s: `[[0, 0], [2.8, 0], [3.4, 1]]`; then set `step_offset_s` 0 so the held pose is a footfall (both feet down). Footfall, slip and twist times are then on the walk's own clock, which runs at `rate` × real time (it reads 0 while holding still).
- `slips`: `[{ "foot": "left", "from_s": 0.05, "to_s": 0.40, "kind": "glide" }, { "foot": "left", "from_s": 6.7, "to_s": 7.1, "kind": "skid", "distance_m": 0.22 }]`. A **glide** keeps a swinging foot on the ground as it slides to its next placement (a thrust forward along the ice instead of a lifted step; add `distance_m` for extra travel). A **skid** slides a planted foot, backward by default (`dir_deg` relative to the walking direction: 0 forward, 180 back, 90 right), and carries the offset until the foot next lifts. Sliding soles leave a streak from where the slip began.
- `twist`: `[[t, deg], …]` turns shoulders, arms and head relative to the hips (+ toward the figure's right; the head turns 1.25 × as far).
- `arms` and `gestures` with times from the hand markers; `observed`: 3–4 boxes across the clip.

## Engine "sim": a walker that balances

`activity.engine: "sim"` swaps the walker for one that balances, ported from the owner's ice-walk simulation (`lib/simwalker.mjs`). The kinematic walker (the default) plants each foot on a schedule and carries the body along a steady stroll; that is right for an easy walk on dry ground and wrong wherever balance is the story. The sim engine moves the body as an inverted pendulum over its feet:

- each foot lands where balance needs it (the capture point), so step length, width and timing vary step to step;
- each loaded foot shifts its pressure toward where the body is heading, only within the shoe (a high heel leaves little room);
- a foot breaks loose when the body asks more friction of it than the ground has (on a slope, plus the slope's own tan θ, downhill), shoots out and re-grips; the hips drop as the legs split;
- caution rises after a slip and ebbs; a little random sway; a reaction delay, then a quick catching step;
- the arms and trunk answer how far the body is off balance (arms out and flailing, trunk pitched and rolled), on top of the arms held out at rest that the balance demand calls for. Timed `gestures` steer the arms while they last; `arm_raise_deg` lifts or lowers one.

With this engine, `activity.mix` is the blend of footage and physics: **cap** trusts the footage, **sim** the ground. Below 1, a foot needs more than the surface's friction to slip by itself (nothing slipped where nothing was seen to), and the body is drawn toward where the reasoned walk puts it, harder the lower the mix; slips in `activity.slips` always happen in full and the physics answers them. At 1 it is the sim alone, steered by the path. `check` notes the slips, the catching steps and any moment the body left its base and had to be held up (a fall the footage doesn't show: a sign the grip, the slope or the pace is wrong).

Use it for slippery ground, high heels, slopes, stumbles: anything where the person is balancing rather than strolling. It also reasons back: if the sim slips a dozen times where the person slipped once, the ground is grippier, the slope gentler or the pace slower than the scene says.

## Friction and the cap/sim mix

The friction model comes from the owner's ice-walk simulation (`dev/reference/ice-walk-sim`).
- **The ground's grip.** Say what the ground is with `ground.surface`: `dry` (μ 0.6), `wet` (0.4), `grass` (0.35), `snow` (0.3), `ice` (0.15), `wet_ice` (0.07) or `black_ice` (0.05). Or give `ground.friction` directly. These are typical static friction for a shoe sole, a judgement and not a measurement; put how sure you are in `ground.confidence`.
- **What `check` tests.** It works out the friction each planted foot needs from the figure's own centre-of-mass motion, at 60 frames a second. The ratio is horizontal acceleration over vertical support, shared between the feet by load. A foot carrying over a quarter of the weight with a need above μ would break loose, as in the sim. `check` reports the peak need, how many planted steps exceed μ and how many of those have no slip in the scene. It also gives the careful gait for that ground: about 25 cm steps at 100/min on moderate ice.
- **`activity.mix`** runs from 0 (**cap**) to 1 (**sim**):
  - **0, the default**, keeps the walk exactly as reasoned from the clip.
  - **Above 0**, the physics joins in. The steps are pulled toward the careful gait for that ground, only ever shorter and slower, by the mix. Then skids are added wherever the adjusted walk still asks for more grip than the ground has. Each is sized with the sim's slide model (the foot driven out at load·g·(need − 0.75μ)·5 for about 0.15 s) and scaled by the mix, and slides the way the body pushes it: forward at heel strike, back at push-off.
  - **Slips you wrote from the footage** are kept at every mix and never doubled.
  - **The trade-off:** a higher mix is more physically plausible and less faithful to the capture, so footfall timing against `contacts` can drift. `check` says what the sim changed.
  - **The player** has the same Cap ↔ Sim slider.
- **When to use it.** Give `ground.surface` for every scene; it costs nothing. Raise `mix` when the clip is on a slippery surface and you can't see every slip (feet hidden, low frame rate), or when you want a plausible reference rather than a copy. Leave it at 0 when the clip clearly shows how each step went.

