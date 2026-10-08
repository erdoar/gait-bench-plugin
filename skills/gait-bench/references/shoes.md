# Shoes and feet

The feet are real models. Every library shoe is a real 3D model fitted to the same anatomically modelled human foot, from the MakeHuman base mesh (CC0). The one exception is a court shoe traced from photos. Scaled to the wearer, the foot inside is about 0.152 × stature, like real feet. `check` tests that against human proportions, and against the footage when you mark a shoe (below). `shoes/CREDITS.md` lists the authors and licences.

## Choosing the footwear

1. **A library model**, named in `figure.footwear.model` (the ids below), is the first choice. Pick the one closest in kind and silhouette to what you see, and set `heel_cm` and `platform_cm` from the side view. The heel and platform are stretched to those heights, and the shoe keeps its own shape.
2. **A style name** in `figure.footwear.style` (`gb.mjs shoes` lists them) picks the nearest library model for you, at the style's typical heel. `check` says which model it chose, and says when the library has nothing of that kind (a heeled sandal, a mule, a cowboy boot), so it drew the nearest real shoe instead. Mention that to the user.
3. **Capsule shapes** (`"capsule": true` with a style) are a last resort: generic geometry, not a real shoe. Socks are always capsules.

```json
"footwear": { "model": "block-heel-ankle-boot", "heel_cm": 8, "platform_cm": 1 }
"footwear": { "style": "chelsea" }
```

- **Size.** Leave `length_cm` out and the shoe is sized so the foot inside it is 0.152 × stature. Give `length_cm` only when something in the footage fixes the size.
- **Colours.** By default each model keeps its own colours. `"colours": "scene"` uses `figure.colours.shoes`, `sole` and `heel` instead; the bare foot in open shoes always takes `figure.colours.skin`.
- **Open shoes** (flats, Mary Janes, sandals, flip-flops) carry the real bare foot inside, so the instep and toes show as they would.
- **Unsure?** Mark `figure` weak or moderate and list the other candidates in `alternatives`, for example `{"about": "footwear", "instead": "riding-boot rather than tight-leather-boot", "because": "the shaft is in shadow"}`.

## Checking the foot against the person

`check` prints a foot line: the foot's length, its share of stature (people run 0.135 to 0.165), the shoe's length, the toe room, and the heel as a share of the foot. It warns when any of these leaves the human range.

To test the actual subject, read a shoe off the frames. In one or two frames where a foot is side-on, give its box in `observed`, with the foot it is: `{"t": 2.0, "foot": "left", "box": [x0, y0, x1, y1]}`. Add a whole-figure box within half a second of it. `check` then compares the shoe's size against the person's height, seen versus rendered. That comparison doesn't depend on the camera's distance. If the shoe is more than 20% off, either the stature or the shoe length is wrong, and `check` says which value would fix each.

## The library

### No shoe

| model | what it is | heel / platform as modelled | length as modelled | licence |
| --- | --- | --- | --- | --- |
| `barefoot` | Bare foot (MakeHuman base mesh) | 0.4 / 0.4 cm | 24.3 cm | CC0 |

### Flats

| model | what it is | heel / platform as modelled | length as modelled | licence |
| --- | --- | --- | --- | --- |
| `animal-print-flat` | Animal-print flat (real foot inside) | 1.2 / 1.1 cm | 26.7 cm | CC0 |
| `black-ballet-flat` | Black ballet flat (real foot inside) | 1.0 / 0.9 cm | 25.6 cm | CC0 |
| `canvas-slip-on` | Canvas slip-on (real foot inside) | 1.3 / 1.2 cm | 25.5 cm | CC-BY |
| `grey-ballet-flat` | Grey ballet flat (real foot inside) | 1.3 / 1.2 cm | 25.5 cm | CC-BY |
| `plain-flat` | Plain round-toe flat (real foot inside) | 1.8 / 1.7 cm | 28.7 cm | CC-BY |
| `pointed-flat` | Pointed-toe flat (real foot inside) | 1.8 / 1.6 cm | 31.1 cm | CC-BY |

### Mary Janes and T-bars

| model | what it is | heel / platform as modelled | length as modelled | licence |
| --- | --- | --- | --- | --- |
| `cloth-mary-jane` | Black cloth Mary Jane (real foot inside) | 1.8 / 1.7 cm | 25.4 cm | CC0 |
| `mary-jane` | Mary Jane (real foot inside) | 1.3 / 1.2 cm | 25.5 cm | CC-BY |
| `t-bar-shoe` | T-bar shoe (real foot inside) | 1.8 / 1.7 cm | 25.0 cm | CC0 |

### Lace-ups and monk straps

| model | what it is | heel / platform as modelled | length as modelled | licence |
| --- | --- | --- | --- | --- |
| `black-leather-derby` | Black leather derby | 0.8 / 0.7 cm | 25.2 cm | CC0 |
| `brown-leather-oxford` | Brown leather lace-up oxford | 0.8 / 0.7 cm | 25.2 cm | CC0 |
| `men-monk-strap` | Men's monk-strap shoe | 1.6 / 1.5 cm | 26.4 cm | CC-BY |
| `men-oxford` | Men's oxford | 2.1 / 2.0 cm | 28.5 cm | CC-BY |
| `saddle-shoe` | Two-tone saddle shoe | 3.5 / 3.4 cm | 28.6 cm | CC-BY |
| `women-monk-strap` | Women's monk-strap shoe | 2.6 / 2.5 cm | 29.9 cm | CC-BY |
| `women-oxford` | Women's pointed oxford | 1.2 / 1.1 cm | 30.8 cm | CC-BY |

### Trainers

| model | what it is | heel / platform as modelled | length as modelled | licence |
| --- | --- | --- | --- | --- |
| `blue-running-trainer` | Blue running trainer | 2.0 / 1.9 cm | 25.6 cm | CC0 |
| `casual-trainer` | Casual suede trainer | 2.0 / 1.9 cm | 25.6 cm | CC0 |
| `cycling-shoe` | Cycling shoe | 2.6 / 2.5 cm | 25.6 cm | CC-BY |
| `dark-running-shoe` | Dark running shoe | 2.1 / 2.0 cm | 26.1 cm | CC-BY |
| `red-high-top-trainer` | Red high-top trainer | 1.1 / 1.0 cm | 26.2 cm | CC-BY |
| `white-high-top-trainer` | White high-top tennis trainer | 2.4 / 2.3 cm | 26.0 cm | CC-BY |
| `white-running-trainer` | White running trainer | 2.0 / 1.9 cm | 25.6 cm | CC0 |
| `yellow-retro-trainer` | Yellow retro trainer | 1.7 / 1.6 cm | 25.9 cm | CC-BY |

### Sandals

| model | what it is | heel / platform as modelled | length as modelled | licence |
| --- | --- | --- | --- | --- |
| `flip-flop` | Flip-flop (real foot inside) | 1.1 / 1.0 cm | 27.4 cm | CC-BY |
| `gladiator-sandal` | Knee-high gladiator sandal (real foot inside) | 1.7 / 1.6 cm | 28.9 cm | CC-BY |
| `strappy-flat-sandal` | Strappy flat sandal (real foot inside) | 1.3 / 1.2 cm | 25.5 cm | CC-BY |

### Court shoes

| model | what it is | heel / platform as modelled | length as modelled | licence |
| --- | --- | --- | --- | --- |
| `black-suede-platform-gold-16` | Black suede platform pump, 16 cm gold metal stiletto | 16.0 / 5.0 cm | 23.4 cm | traced from the owner's photos |

### Boots

| model | what it is | heel / platform as modelled | length as modelled | licence |
| --- | --- | --- | --- | --- |
| `black-leather-ankle-boot` | Black leather ankle boot | 3.1 / 3.0 cm | 25.3 cm | CC0 |
| `brown-leather-boot` | Brown leather boot | 0.9 / 0.8 cm | 28.2 cm | CC-BY |
| `men-ankle-boot` | Men's suede ankle boot | 1.8 / 1.7 cm | 28.3 cm | CC0 |
| `men-biker-boot` | Men's biker boot | 2.7 / 2.6 cm | 29.0 cm | CC-BY |
| `rain-boot` | Rubber rain boot | 2.8 / 2.7 cm | 28.0 cm | CC0 |
| `riding-boot` | Riding boot | 3.4 / 3.3 cm | 28.0 cm | CC-BY |
| `slouch-over-knee-boot` | Slouchy over-the-knee boot | 1.9 / 1.8 cm | 26.8 cm | CC0 |
| `tight-leather-boot` | Fitted leather mid-calf boot | 1.7 / 1.5 cm | 26.8 cm | CC-BY |
| `winter-boot` | Fur-lined winter boot | 2.9 / 2.9 cm | 30.1 cm | CC-BY |
| `women-ankle-boot` | Women's low-heel ankle boot | 2.0 / 0.9 cm | 22.4 cm | CC0 |
| `women-biker-boot` | Women's biker boot | 2.8 / 2.7 cm | 28.4 cm | CC-BY |

### Heeled boots

| model | what it is | heel / platform as modelled | length as modelled | licence |
| --- | --- | --- | --- | --- |
| `block-heel-ankle-boot` | Block-heel ankle boot | 8.0 / 0.6 cm | 27.0 cm | CC-BY |
| `heeled-knee-boot` | Heeled knee boot | 6.8 / 0.7 cm | 24.3 cm | CC-BY |
| `knee-high-stiletto-boot` | Knee-high stiletto boot | 15.6 / 0.8 cm | 28.1 cm | CC-BY |
| `low-heel-tall-boot` | Low-heel tall boot | 4.4 / 0.9 cm | 26.1 cm | CC-BY |
| `platform-gogo-boot` | Platform go-go boot | 16.0 / 5.0 cm | 25.7 cm | CC0 |
| `stiletto-ankle-bootie` | Stiletto ankle bootie | 10.0 / 0.7 cm | 19.3 cm | CC0 |
| `tall-wedge-boot` | Tall wedge boot | 13.2 / 0.6 cm | 22.1 cm | CC-BY |

## Style names

`figure.footwear.style` takes any of these. Each draws its library model at the style's typical heel and platform; *nearest* means the library has nothing of that kind yet.

| style | what it is | typical heel / platform cm | drawn with |
| --- | --- | --- | --- |
| `barefoot` | bare feet | 0 / 0 | `barefoot` |
| `socks` | socks or tights only | 0 / 0 | capsule (no model) |
| `ballet_flat` | ballet flat: low-cut, bare instep, thin sole | 1 / 0.5 | `black-ballet-flat` |
| `loafer` | loafer: slip-on, covered instep, low stacked heel | 2.5 / 1 | `black-leather-derby`, nearest: no slip-on leather loafer in the library |
| `moccasin` | moccasin or driving shoe: soft, very thin sole | 1 / 0.5 | `canvas-slip-on`, nearest: no moccasin in the library |
| `boat_shoe` | boat shoe: laced moccasin on a pale sole | 2 / 1 | `brown-leather-oxford`, nearest: no boat shoe in the library |
| `oxford` | oxford or derby: laced leather shoe | 3 / 1 | `men-oxford` |
| `brogue` | brogue: laced, with a rounder wing-tip toe | 3 / 1.2 | `brown-leather-oxford` |
| `monk` | monk strap: buckled across the instep | 3 / 1 | `men-monk-strap` |
| `espadrille` | espadrille: canvas on a pale rope sole | 2 / 1.5 | `canvas-slip-on`, nearest: no rope sole in the library |
| `plimsoll` | plimsoll or canvas slip-on: thin rubber sole | 1.5 / 1 | `canvas-slip-on`, nearest: no plimsoll in the library |
| `trainer` | trainer or sneaker: padded upper, thick sole | 3 / 1.5 | `casual-trainer` |
| `running` | running shoe: light upper, thicker under the heel | 3.5 / 2.5 | `white-running-trainer` |
| `high_top` | high-top trainer: covers the ankle | 3 / 1.5 | `white-high-top-trainer` |
| `skate` | skate shoe: wide, padded, flat sole | 2.5 / 2 | `yellow-retro-trainer` |
| `chunky_trainer` | chunky or "dad" trainer: very deep sole | 5 / 3.5 | `dark-running-shoe`, nearest: no chunky sole in the library: the sole is raised |
| `platform_trainer` | platform trainer: flat platform all along | 6 / 5 | `dark-running-shoe`, nearest: no platform trainer in the library: the sole is raised |
| `sandal` | flat sandal: straps over a thin sole | 1 / 0.8 | `strappy-flat-sandal` |
| `flip_flop` | flip-flop: toe post and V strap | 1.5 / 1.5 | `flip-flop` |
| `slide` | slide or pool slider: one wide band, backless | 2.5 / 2 | `flip-flop`, nearest: no slide in the library |
| `sport_sandal` | sport sandal: webbing straps on a deep sole | 3 / 2 | `strappy-flat-sandal`, nearest: no sport sandal in the library |
| `gladiator` | gladiator: straps up the shin | 1 / 0.8 | `gladiator-sandal` |
| `heeled_sandal` | heeled sandal: straps on a stiletto | 10 / 0.5 | `strappy-flat-sandal`, nearest: no heeled sandal in the library: a flat sandal raised to the heel |
| `block_sandal` | block-heel sandal | 7 / 0.5 | `strappy-flat-sandal`, nearest: no heeled sandal in the library: a flat sandal raised to the heel |
| `platform_sandal` | platform sandal: straps on a deep platform and high heel | 14 / 4 | `strappy-flat-sandal`, nearest: no platform sandal in the library: a flat sandal raised |
| `wedge_sandal` | wedge sandal: straps on a wedge | 9 / 2 | `strappy-flat-sandal`, nearest: no wedge sandal in the library: a flat sandal raised |
| `mule` | flat mule: closed front, open back | 1.5 / 0.5 | `pointed-flat`, nearest: no mule in the library: a closed flat |
| `heeled_mule` | heeled mule | 7 / 0.5 | `black-suede-platform-gold-16`, nearest: no mule in the library: a court shoe |
| `clog` | clog: rounded closed front on a thick wooden or rubber sole | 5 / 3 | `canvas-slip-on`, nearest: no clog in the library |
| `pump` | court shoe or pump: bare instep, heel cup | 9 / 0.5 | `black-suede-platform-gold-16` |
| `stiletto` | pointed stiletto pump | 10 / 0.5 | `black-suede-platform-gold-16` |
| `kitten_heel` | kitten heel: short thin heel | 4 / 0.5 | `black-suede-platform-gold-16` |
| `block_heel` | block-heel court shoe | 7 / 0.5 | `black-suede-platform-gold-16`, nearest: a stiletto court shoe: no block-heel court in the library |
| `cone_heel` | cone heel: tapers to a small tip | 7 / 0.5 | `black-suede-platform-gold-16`, nearest: a stiletto court shoe: no cone heel in the library |
| `platform_pump` | platform pump: very high stiletto on a platform | 15 / 4.5 | `black-suede-platform-gold-16` |
| `peep_toe` | peep-toe pump | 10 / 1 | `black-suede-platform-gold-16`, nearest: a closed-toe court shoe |
| `slingback` | slingback: a strap round the back of the heel instead of a cup | 6 / 0.5 | `black-suede-platform-gold-16`, nearest: a court shoe: no slingback in the library |
| `mary_jane` | Mary Jane: strap across the instep | 5 / 1 | `mary-jane` |
| `ankle_strap` | ankle-strap heel | 10 / 0.5 | `black-suede-platform-gold-16`, nearest: a court shoe without the strap |
| `wedge` | closed wedge | 8 / 1.5 | `black-suede-platform-gold-16`, nearest: a court shoe: no closed wedge in the library |
| `boot` | heeled ankle boot (the 1.x boot) | 10 / 1 | `block-heel-ankle-boot` |
| `ankle_boot` | flat ankle boot | 3 / 1 | `black-leather-ankle-boot` |
| `chelsea` | Chelsea boot: elastic sides, low block heel | 3 / 1.2 | `black-leather-ankle-boot` |
| `heeled_ankle_boot` | heeled ankle boot on a block heel | 8 / 0.8 | `stiletto-ankle-bootie` |
| `combat` | combat boot: laced, on a deep cleated sole | 4 / 2.5 | `men-biker-boot` |
| `hiking` | hiking boot: padded, laced, cleated sole | 4 / 2.5 | `winter-boot`, nearest: no hiking boot in the library |
| `work_boot` | work boot: square, heavy, laced | 4 / 2.5 | `men-biker-boot`, nearest: no work boot in the library |
| `platform_boot` | platform boot: deep platform and heel | 15 / 5 | `platform-gogo-boot` |
| `cowboy` | cowboy or western boot: pointed toe, cuban heel | 5 / 1 | `brown-leather-boot`, nearest: no cowboy boot in the library |
| `mid_calf_boot` | mid-calf boot | 5 / 1 | `tight-leather-boot` |
| `knee_boot` | knee-high boot | 6 / 1 | `riding-boot` |
| `heeled_knee_boot` | knee-high stiletto boot | 10 / 0.8 | `heeled-knee-boot` |
| `riding` | riding boot: tall, fitted, low heel | 3 / 1 | `riding-boot` |
| `slouch_boot` | slouch boot: loose, gathered shaft | 5 / 1 | `slouch-over-knee-boot` |
| `over_knee` | over-the-knee boot | 8 / 1 | `slouch-over-knee-boot` |
| `thigh_high` | thigh-high boot | 11 / 1 | `knee-high-stiletto-boot`, nearest: the tallest heeled boot in the library |
| `wellington` | wellington or rain boot: wide rubber shaft | 3 / 1.5 | `rain-boot` |
| `snow_boot` | snow or sheepskin boot: wide, soft, round | 3 / 2 | `winter-boot` |

Other names are accepted too: `court`, `sneaker`, `heel`, `flat`, `derby`, `thong`, `sheepskin`, `rain_boot`, `western`.

The library has no heeled sandal, mule, clog, cowboy boot, hiking boot, slide or espadrille yet. The style names for those draw the nearest real shoe, and `check` says so. More models can be added with `dev/shoes/` (see its README) from any MakeHuman-compatible asset under CC0 or CC-BY, or traced from photos with the walk-scene plugin's shoe-library skill.
