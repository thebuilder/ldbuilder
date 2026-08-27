# LDraw Builder

Load an LDraw model, tip the bricks onto the floor, and watch it assemble itself
one build step at a time. Explode the finished model, slice it open layer by
layer, isolate a submodel, or click any single brick to find out what it is.

Or build it yourself. In **build mode** the bag lands as a live physics pile you
can dig through, shove and throw pieces out of; each step lights up the slots it
needs, and a piece dropped near the right one clicks into place. Switching over
from watching hands you the step you were watching, already built up to that
point, and progress is saved in the browser, so a set with eight hundred steps
in it can be picked up where you left off.

Or build something nobody designed. **Free build** is a floor, a box of two
hundred parts in any colour the library defines, and no instructions: take a
part or tip out fifty, turn them, stack them on the stud grid, and export the
result as an LDraw file you can open anywhere else.

Next.js 16 + three.js. No accounts, no server-side rendering of anything heavy,
no parts library needed to run it.

```bash
pnpm install
pnpm dev
pnpm test
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
pnpm ldraw:palette   # pack the free-build parts into public/parts
pnpm ldraw:demos     # regenerate the two generated demo models
pnpm ldraw:index     # rescrape the searchable OMR set list

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

Only two sets ship with the app. The rest are a search away: the gallery has an
**Open an official set** card that finds sets by number, name or theme, and
opens one through `/api/omr/[set]`, which proxies the OMR (it serves no CORS
headers) and packs the set on the way through.

The search runs against `public/omr-index.json`: 1,470 sets with name, theme and
year, 19 KB over the wire, fetched on first interaction rather than with the
page. The OMR has no API and no directory listing, so `pnpm ldraw:index` scrapes
the 59 pages of its set list and commits the result.

A [monthly workflow](.github/workflows/refresh-omr-index.yml) re-runs the scrape
and commits when the data has actually changed, which Vercel then deploys like
any other push. The file carries no timestamp and is written one set per line,
so an unchanged list produces an identical file and a changed one produces a
diff that reads as "these sets were added". A Vercel cron cannot do this job:
it triggers a request into the deployment, whose filesystem is read-only, so
there would be nowhere to put the result.

A set number typed in full opens whether or not the index knows about it, so
nothing breaks if it does go stale.

### The free-build palette

Free build needs a different kind of pack. A model pack holds the parts that
model uses; a palette pack holds the parts a person might reach for.

```bash
pnpm ldraw:palette   # public/parts/palette.mpd + palette.json
```

`scripts/lib/palette-select.mjs` picks them. The library has 20,000 real parts
in it, most of which are a printed variant of another part, a Duplo mould, or a
licensed minifigure, so selection is by rule rather than by a hand-written list
of part numbers: a list would go stale against a library that gains parts every
release, and would be a hundred numbers nobody could check. The rules read each
part's own description, which is where LDraw already records what something is
and how big it is, and they yield 194 parts across nine groups — 1.9MB packed,
280KB over the wire, loaded only when the sandbox is opened.

Every part goes in with colour 16, LDraw's "inherit from whoever used me", which
at the top level means nothing has decided yet. That is the point: one copy of
the geometry serves every colour, and a colour is chosen per instance at runtime
by redirecting the two materials that stand for an inherited surface and an
inherited edge.

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

## Tests

```bash
pnpm test              # 198 tests, about two seconds
pnpm test:watch
pnpm test:coverage     # writes coverage/coverage-final.json
```

Most run on node and cover pure logic: the packer's reference-naming rules, the
network resolver's fallback chain and caching, step synthesis, bag partitioning,
the search ranking, and the OMR scrapers. That is where the bugs have actually
been, and it is testable without a GPU.

The set field is the exception: it renders under happy-dom, because keyboard
navigation through a listbox is behaviour rather than a function, and
`aria-activedescendant` pointing at the wrong row is not something a unit test
of the search would catch. Suites opt into a DOM with a
`@vitest-environment happy-dom` docblock; the rest stay on node and stay fast.

The rendering path (`flatten`, `layout`, `loadModel`, `SceneController`) needs a
real scene and is not covered.

One suite checks the committed models rather than the code: every `.mpd` in
`public/models` must be self-contained and must still match the brick, step and
part counts in the manifest. That is what catches a bad re-pack getting
committed, which is the failure that would be invisible until someone opened
the model.

`pnpm audit` runs the suite with coverage first, because fallow reads
`coverage-final.json` to score CRAP. Without it that metric just measures the
absence of tests.

## CI

[CI](.github/workflows/ci.yml) runs lint, types, tests and the build on every
pull request, and on pushes to main. The checks use `!cancelled()` rather than
stopping at the first failure, so one run tells you everything that is broken.

fallow gates there too, on what a change *introduces* rather than what it
inherits. `pnpm audit` runs the same check locally, against the last commit
rather than against main.

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

**Free build.** Real LEGO connects stud to tube, and knowing where a given
part's studs are means connectivity data the LDraw library does not carry;
LDCad keeps a whole parallel set of "shadow" files for it. What the library does
guarantee is the grid the system is cut to: 20 units between studs, 8 for the
height of a plate, three plates to a brick. Snapping to that grid and resting
each part on whatever is under it gets stud-accurate building out of geometry
that is already there, and is wrong only for the parts that are themselves
off-grid, which are the same parts a person places by eye anyway.

Two details that are easy to get wrong. A part's origin is at the middle of its
footprint, so where that middle lands depends on whether the footprint is an odd
or an even number of studs across: a 2x4 brick straddles grid lines and a 1x1
sits on the middle of a stud. Rounding without accounting for that puts every
odd part half a stud out, which is the one error that makes a build impossible
to line up. And height is found by resting rather than rounding, because a slope
is not a whole number of plates tall and a brick placed on one should sit on its
top rather than at the nearest multiple of 8.

Rotations are held as quarter turns rather than as a quaternion, because they
are only ever quarter turns: it keeps the save small, keeps the arithmetic exact
however many times a part is turned, and means an exported model has clean
integers in it rather than 0.9999999.

**Exporting.** A `.ldr` is a list of type-1 lines, each one a colour, a 3x3
rotation, a translation and a part to apply them to. The only thing to get right
is the frame: the app turns every part upright when it loads it, so writing one
back out means turning it down again. That turn is a half turn about X, which is
its own inverse, so the same matrix does both jobs.

**Tests.** `pnpm test` runs vitest over the half of the app that is not a
renderer: the build state machine, the saved-game store, the live physics world,
the slot ghosts, and the scene-graph bookkeeping. three.js and rapier both work
headless as long as nothing asks for a `WebGLRenderer`, so the physics tests run
the real solver rather than a stand-in, and the scene controller is exercised in
jsdom against a renderer stub that draws nothing. What is left to the eye is the
part that genuinely needs a GPU.

Two bugs in this repo were found by writing those tests rather than by using the
app. A brick carried above its slot could sit outside its own snap radius, which
made small, tall parts the hardest thing in a model to place; and build mode fell
back to the watch scrubber for the frame before the first progress report, which
handed over a control that skips the whole point of the mode.

`pnpm test:coverage` writes `coverage/coverage-final.json`, which `fallow audit`
reads to score complexity. Without it every function is assumed untested and
CRAP collapses into a second, much stricter cyclomatic threshold.

**Performance.** Two thresholds, both measured rather than guessed.

- Above 800 bricks, vertex normals stay flat. Smoothing dominates the parse:
  14.9s of a 15.3s load on a 4,209-brick set, against 1.4s with it off.
- Above 1,500 bricks, edge lines and shadows go. Every part carries its own line
  and conditional-line object, which makes them most of the draw calls. Dropping
  them took the same set from 10,921 calls to 3,797, and 36 fps to 60.

Merging completed bags with `LDrawUtils.mergeObject` is the next thing to try,
since a finished bag never needs per-brick identity again. Not built yet.

**Build mode.** The watch flow bakes its pour and plays the recording back,
which works precisely because nothing in it is interactive. Build mode cannot:
the pile is whatever you have done to it, so `src/scene/liveWorld.ts` runs the
solver every frame. The cost is bounded by the same thing that bounds the pour,
since only one bag is ever loose, so the body count tops out around 170; a
settled pile sleeps, and the placed model is static colliders with no bodies at
all. Measured at 120 fps on a 368-brick set with 68 bricks on the floor.

A held brick is kinematic rather than dynamic. It shoves the pile out of the way
and never gets shoved, which is the difference between digging a brick out of a
heap and fighting a spring for it. Letting go hands the tracked hand velocity
back to a dynamic body, so a flick throws.

Slots are matched by **part, not identity**. A bag holds eight identical 1x2
plates and insisting on one particular plate would be a puzzle about nothing, so
any brick with the same part and colour fills the slot. What makes that
invisible is that placing swaps the two records' objects and bodies: identical
part and colour means identical geometry and materials, so nothing on screen
changes, and afterwards every record still owns exactly one brick.

Two smaller things worth knowing. A carried brick rides a horizontal plane at
the height of the slots being filled, not a camera-facing one, so dragging moves
it across the table rather than lofting it into the sky; the wheel raises and
lowers it, since orbiting is suspended while you are holding something. And two
presses on the same brick send it home by itself, because aiming in three
dimensions with a two-dimensional pointer is the one thing that can make the
mode unplayable on a trackpad.

**Saved builds.** `localStorage`, one entry per model, holding the step, the
filled slots, and where the loose bricks are lying. The first two are a couple
of hundred bytes. The third is the expensive one and it is kept anyway, because
a pile you have already sorted through is most of the work: re-pouring would
hand back a tidy heap you have never seen. Every read is defensive and every
write may fail, so a full or disabled store drops the pile first and the build
second. A save is checked against the model's brick and step counts, so
repacking a model invalidates it rather than corrupting it.

**State.** Anything you would want to share or keep across a refresh lives in
the URL via nuqs: `?flow=`, `?step=`, `?mode=`, `?explode=`, `?slice=`, `?sub=`,
`?sel=`. Build progress is the exception: it is far too big for a URL and is
meaningless to anyone else, so it lives in `localStorage` instead. A free build
is the same, minus the model to check it against; what it has instead is part
names, and a part that has since left the palette is dropped on the way back in.
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

In build mode:

| | |
| --- | --- |
| Drag a brick | Pick it up and carry it |
| Scroll while carrying | Raise or lower it |
| Flick and release | Throw it |
| Press a brick twice | Send it to its slot |
| F | Highlight the pieces this step still needs |

In free build:

| | |
| --- | --- |
| 1-9 | Reach for a hotbar slot |
| Click | Put down what is in hand, or pick up what is under the pointer |
| R / Shift R | Turn a quarter circle |
| T | Tip on its side |
| Arrows | Nudge a stud at a time |
| PgUp / PgDn | Raise or lower by a plate |
| Esc | Put it back |
| Del | Throw it away |

The arrows belong to the camera until something is being carried, at which point
they belong to the brick: a stud at a time is what "not quite there" needs, and
the camera can wait.

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
src/test/          fixtures and stubs shared by the unit tests
public/models/     committed self-contained .mpd files + manifest
public/ldraw/      LDConfig.ldr, the colour table
demo-models/       source for the generated demos
public/parts/      the free-build palette: one .mpd plus its catalogue
src/ldraw/         loading, flattening, steps, bags, floor layout, palette
src/scene/         renderer, assembly state machine, live physics, build rules
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
