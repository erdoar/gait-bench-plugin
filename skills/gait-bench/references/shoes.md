# Shoes and feet

The feet are real models. Every library shoe is a real 3D model fitted to the same anatomically modelled human foot, from the MakeHuman base mesh (CC0). The one exception is a court shoe traced from photos. Scaled to the wearer, the foot inside is about 0.152 × stature, like real feet. `shoes/CREDITS.md` lists the authors and licences.

## Choosing the footwear

Name the library model closest in kind and silhouette to what you see in `figure.footwear.model` (the ids below), and set `heel_cm` and `platform_cm` from the side view. The heel and platform are stretched to those heights; the shoe keeps its own shape. If the library has nothing of that kind (a mule, a cowboy boot), pick the nearest real shoe and say so in `differs`.

```json
"footwear": { "model": "block-heel-ankle-boot", "heel_cm": 8, "platform_cm": 1 }
```

- **Size.** Leave `length_cm` out and the shoe is sized so the foot inside it is 0.152 × stature. Give `length_cm` only when something in the footage fixes the size.
- **Colours.** By default each model keeps its own colours. `"colours": "scene"` uses `figure.colours.shoes`, `sole` and `heel` instead; the bare foot in open shoes always takes `figure.colours.skin`.
- **Open shoes** (flats, Mary Janes, sandals, flip-flops) carry the real bare foot inside, so the instep and toes show as they would.
- **Unsure?** List the other candidates in `alternatives`, for example `{"about": "figure", "instead": "riding-boot rather than tight-leather-boot", "because": "the shaft is in shadow"}`.

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


The library has no heeled sandal, mule, clog, cowboy boot, hiking boot, slide or espadrille yet. Pick the nearest real shoe and say so in `differs`. More models can be added with `dev/shoes/` (see its README) from any MakeHuman-compatible asset under CC0 or CC-BY, or traced from photos with the walk-scene plugin's shoe-library skill.
