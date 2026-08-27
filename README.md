# LDraw Builder

Load an LDraw model, tip the bricks onto the floor, and watch it assemble itself
one build step at a time. Explode the finished model, slice it open layer by
layer, isolate a submodel, or click any single brick to find out what it is.

Next.js 16 + three.js. No accounts, no server-side rendering of anything heavy,
no parts library needed to run it.

```bash
pnpm install
pnpm dev
```

That works straight from a checkout: the bundled models are committed as
self-contained files. You only need the setup below to pack *new* models.

## The problem this repo solves

An LDraw `.ldr` file is not a model. It is a list of transforms pointing at part
files (`3001.dat`) that live in the official LDraw parts library, which is a
138 MB download expanding to about 36,000 files. `LDrawLoader` resolves each
reference by trying `parts/`, then `p/`, then `models/` in turn, so serving that
library over HTTP means hundreds of requests per model, most of them 404s.

So the library never reaches the runtime. Instead a build-time packer inlines a
model and every part it uses into one self-contained `.mpd`, and that single file
is what the browser fetches.

The subtle part is naming. `LDrawLoader` normalizes every reference before it
looks it up, and keys its embedded-file cache on the lowercased result:

| reference in the file | what the loader looks up |
| --- | --- |
| `3001.dat` | `3001.dat`, searched as `parts/3001.dat` |
| `stud.dat` | `stud.dat`, searched as `p/stud.dat` |
| `s\4315s01.dat` | `parts/s/4315s01.dat` |
| `48\1-4edge.dat` | `p/48/1-4edge.dat` |
| `8\1-4cyli.dat` | `8/1-4cyli.dat`, searched as `p/8/...` |

The `0 FILE` name written into the packed output has to be the normalized
*reference* string, not the path the file sits at on disk. Get it wrong and the
loader silently renders nothing for that brick. `scripts/lib/ldraw-pack.mjs`
holds the rules.

Unresolved references are a hard error when packing the bundled models, because
a bundled model with holes in it is a build bug. For a file somebody drops in,
they are a warning: the missing reference lines are stripped, the rest of the
model builds, and the viewer is told which parts are absent.

## Working with models

```bash
pnpm ldraw:setup     # download + extract the parts library (138 MB, gitignored)
pnpm ldraw:colors    # LDConfig.ldr -> src/ldraw/colors.generated.ts
pnpm ldraw:pack      # pack the curated models into public/models
pnpm ldraw:demos     # regenerate the two generated demo models

pnpm ldraw:pack path/to/some-set.ldr    # add one more to the gallery
pnpm ldraw:pack x.ldr --skip-missing    # build it without the parts it is missing
pnpm ldraw:omr 928 21309                # check an official set exists, and who built it
```

Packing prints a brick and step count computed independently of the runtime, so
a mismatch between the two is caught rather than silently losing parts.

### Bundled models

| Model | Bricks | Steps | What it covers |
| --- | --- | --- | --- |
| Example Pyramid | 13 | 4 | The smallest thing with a real build order |
| Running Bond Wall | 38 | 1 | No `0 STEP` metas, so the order is inferred |
| Example Car | 61 | 8 | Authored steps, 26 different parts |
| Gatehouse | 128 | 24 | Submodels: four towers and a span |
| 928 Galaxy Explorer | 368 | 53 | A real set, 53 steps as its author wrote them |
| 21309 NASA Apollo Saturn V | 1,845 | 775 | 30 bags, deep submodels, the scale case |

The two examples ship inside the LDraw library. The wall and gatehouse are
generated from library parts by `scripts/make-demos.mjs`, to cover cases the
library samples do not. The two official sets come from the OMR, below.

### Official sets, and why they can ship here

The [LDraw Official Model Repository](https://library.ldraw.org/omr/sets) holds
around 1,470 official LEGO sets, each built and submitted by a named author.
The reason it is the source rather than one of the community mirrors is a single
line in every file:

```
0 !LICENSE Redistributable under CCAL version 2.0
```

That is the same Creative Commons Attribution licence as the parts library, so
OMR sets can be committed here provided their author is credited. Files found
elsewhere carry no stated licence, so none are redistributed in this repo.
`scripts/lib/omr.mjs` reads the licence header and refuses anything without it,
and lifts the author and theme out for the gallery card.

Only two sets ship with the app. The rest are a set number away: the gallery has
an **Open an official set** card, which goes through `/api/omr/[set]` because the
OMR serves no CORS headers and the set still has to be packed on the way
through.

### Bringing your own

Drag an `.ldr` or `.mpd` anywhere onto the page. A self-contained `.mpd` opens
straight from the browser with no server involved. A raw `.ldr` is posted to
`/api/pack`, which resolves its parts the same way `/api/omr` does.

Models that use unofficial parts will have references the library cannot
resolve. Those parts are skipped and the rest of the model still builds, with a
warning naming what is missing. Only a model where *nothing* resolves is
refused, since there would be nothing left to look at.

### Where parts come from at request time

The two packing routes need somewhere to resolve `3001.dat` from, and a
deployment has no parts library: 36,600 files and 612 MB does not fit in a
serverless bundle and has no business in git. So `src/server/parts-resolver.ts`
picks a source at startup:

| | used when | speed |
| --- | --- | --- |
| the local library | `pnpm ldraw:setup` has been run | instant |
| the network | anywhere else, including every deployment | 10-30 s cold, then cached |

The network resolver tries a [jsDelivr-hosted mirror][mirror] of the library
first and falls back to library.ldraw.org for anything the mirror lacks. The
order matters: the mirror is a CDN and does not rate limit, while the library
itself starts returning `429` at four concurrent requests, and a single set is
roughly 400 lookups. Going mirror-first means the origin is asked only for the
handful of parts added since the mirror was taken.

Both produce the same model. Packing three real sets, from 368 to 5,246 bricks,
against each source resolved every reference with nothing missing either way.
The mirror is an older snapshot, so some parts have since been re-subfiled and
the two outputs are not byte-identical, but no brick goes missing.

Packed sets are returned gzipped (about 6.4:1 on this content, so a 3.8 MB set
is 612 KB on the wire) with a one-year `s-maxage`. A published set never
changes, so only the first person to open one pays for it.

Set `LDRAW_PARTS_SOURCE=network` to exercise the deployment path on a machine
that does have the library installed.

[mirror]: https://github.com/gkjohnson/ldraw-parts-library

## How it works

**Flattening.** The loader hands back a nested group tree. That does not work
here, because a brick has to fly from a spot on the floor to its place in the
model, so its transform must be absolute rather than relative to a submodel that
is itself moving. `src/ldraw/flatten.ts` cuts the tree into a flat list and
keeps the submodel structure as data instead. A brick is any group whose
`0 !LDRAW_ORG` type is `Part` or `Shortcut`. Matching stops the descent: a
Shortcut contains real Part files, and walking into one counts the same brick
twice.

**Build steps.** The app takes real `0 STEP` metas as written. For a file with
none, it infers an order from how the model stacks up, keeping each submodel
together, and labels those steps `inferred` so nobody thinks the set ships that
way.

**Bags.** Four thousand bricks on the floor at once is unreadable and slow. Real
sets already solved this with numbered bags, so the build splits the same way,
into contiguous runs of steps of about 110 bricks, cut on submodel seams where
there are any. Future bags never enter the scene graph. Each bag lands on the
side of the model it builds, not scattered around a footprint that is mostly
still empty. Opening a model tips the first bag out, so you watch the bricks
arrive rather than finding a pile that was already there.

**The drop is simulated, then baked.** Bricks fall with a real rigid-body
solver (rapier), so they collide, land on each other and settle at whatever
angle they end up at. The simulation is not live: it runs once when a bag opens,
records every brick's transform on every step, and the recording is played back.
That keeps three things a live solver would cost. The same seed always produces
the same pile. The resting poses are known before the animation starts, which is
what the camera framing and the scrubber both need. And playback is an array
lookup, so a settled bag costs nothing per frame.

A 110-brick bag takes about 60ms to settle, which fits inside the load screen,
and the recording is roughly 500KB. Only the open bag is kept. A drop runs about
a second. If the physics module fails to load, a scripted fall stands in.

One trap worth knowing about. Rapier's internal thresholds assume a world
measured in metres, and LDraw units are 0.4mm, so a 2x4 brick is 80 units wide.
At that scale the solver quietly clamps velocity: bricks accelerate for a dozen
frames and then fall at a constant speed, which looks exactly like a bug in the
animation code and is not one. Setting `world.lengthUnit` to the drop height
restores a real parabola. Measured as drop per four frames, the clamped version
went 0.019, 0.044, 0.069, 0.077, 0.077, 0.077; with `lengthUnit` set it goes
0.019, 0.044, 0.069, 0.093, 0.118, 0.143.

The solver is not cheap to ship: rapier's compat build inlines its WebAssembly
as base64, which is a 2.7MB chunk. It is dynamically imported, so it is absent
from both the gallery and the builder's initial HTML and only downloads once a
model is opened, alongside the model itself. Switching to the non-compat build
would serve the wasm as its own cacheable file and drop the base64 overhead.

**Performance.** Two thresholds, both measured rather than guessed.

- Above 800 bricks, vertex normals stay flat. Smoothing dominates the parse:
  14.9s of a 15.3s load on a 4,209-brick set, against 1.4s with it off.
- Above 1,500 bricks, edge lines and shadows go. Every part carries its own line
  and conditional-line object, which makes them most of the draw calls. Dropping
  them took the same set from 10,921 calls to 3,797, and 36 fps to 60.

Merging completed bags with `LDrawUtils.mergeObject` is the next thing to try,
since a finished bag never needs per-brick identity again. Not built yet.

**State.** Anything you would want to share or keep across a refresh lives in
the URL via nuqs: `?step=`, `?mode=`, `?explode=`, `?slice=`, `?sub=`, `?sel=`.
`step` counts steps already finished, so `0` is an untouched pile and a value
equal to the step count is a finished model.
Per-frame playback state stays in the scene controller and never round-trips
through React. That split is also why the code drives three.js directly instead
of going through react-three-fiber.

## Controls

| | |
| --- | --- |
| W A S D / arrows | Move the camera across the floor |
| Q / E | Move down and up |
| Shift | Move faster |
| Drag / scroll | Orbit, zoom |
| Click a brick | Inspect it |
| Space | Play or pause the build |
| `[` `]` or `,` `.` | Step backwards or forwards |
| Escape | Clear the selection |
| Frame | Toggle between framing the table and framing the model |

The full list lives behind the `?` in the View panel. Movement pans the camera
and its orbit target together, so it is not walking: wherever you stop, dragging
still orbits around the point in front of you. Speed scales with how
far the camera is from what it is looking at, so the same key press feels the
same on a 13-brick pyramid and a 4,000-brick roller coaster. Once you have moved
the camera yourself, opening a new bag stops pulling the view back to it; Frame
hands that back.

Blue means selection and progress. Yellow means something is off but usable,
like an inferred build order or a missing part. Red means a failure. Yellow
never marks a selection, so when the UI turns yellow it is telling you
something. Every pairing is checked against WCAG AA, including the case where a
panel floats over a white brick.

## Colour

Light and dark, via next-themes with `attribute="class"`. Both themes are held
to the same bar: every text and fill pairing is checked against WCAG AA, in the
worst case as well as the ordinary one. Panels are 92% opaque, so the figure in
brackets is the same text with a brick showing through behind it, white on the
dark theme and black on the light one.

Two values could not just be reused across themes. `warn` is #f5c518 on dark and
a dark amber #8a5a00 on light, because yellow on white is 1.7:1. And `accent-fg`
goes lighter than the fill on dark, darker than it on light, which is why the
token is named for its job rather than its brightness.

The canvas is themed too, which CSS cannot reach on its own. Rather than keep a
second copy of the palette in the renderer, `globals.css` exposes `--scene-*`
custom properties and `SceneController.applyTheme()` reads them off the root
element with `getComputedStyle`. The background, grid, shadow strength and
environment intensity all come from the stylesheet, so the two cannot drift.

The numbers below are for the dark theme.

| Token | On a panel | Job |
| --- | --- | --- |
| `ink` #eceef2 | 15.4:1 (12.3:1) | Primary text |
| `muted` #b3bac6 | 9.2:1 (7.3:1) | Secondary text |
| `faint` #8d95a2 | 5.9:1 (4.7:1) | Labels and readouts, the smallest text here |
| `accent-lit` #6fb2f5 | 8.0:1 (6.4:1) | Links, icons, progress |
| `warn` #f5c518 | 11.0:1 (8.8:1) | Inferred steps, missing parts |
| `danger` #f2626a | 5.8:1 (4.6:1) | Failures |

The blue splits in two because one blue cannot do both jobs on a dark UI. A blue
light enough to read as text over graphite is too light to carry white text on
top of it. `accent` #1c6bd6 is the fill: white on it is 5.1:1, and the fill sits
3.2:1 against a resting button, so an active segment differs from its neighbours
by more than the colour of its label. Hovering it goes darker rather than
lighter, because lighter drops white text below 4.5:1.

## Layout

```
scripts/           setup, packing and demo generation (plain ESM, shared with /api/pack)
public/models/     committed self-contained .mpd files + manifest
public/ldraw/      LDConfig.ldr, the colour table
demo-models/       source for the generated demos
src/ldraw/         loading, flattening, steps, bags, floor layout
src/scene/         renderer, assembly state machine, materials, easing
src/components/    viewer stage and HUD panels
```

## Legal

LEGO® is a trademark of the LEGO Group of companies which does not sponsor,
authorize or endorse this site. This is an unofficial, non-commercial project
with no affiliation to the LEGO Group.

LDraw™ is a trademark owned and licensed by the Estate of James Jessiman. Part
geometry and colour definitions come from the LDraw Parts Library, used under
[CC BY 2.0](https://creativecommons.org/licenses/by/2.0/). See
[ldraw.org legal info](https://www.ldraw.org/docs-main/licenses/legal-info.html).
