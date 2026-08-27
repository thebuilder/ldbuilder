#!/usr/bin/env node
// Writes the gatehouse demo model in demo-models/, then leaves packing to
// `pnpm ldraw:pack`.
//
// The LDraw library ships only two sample models (car and pyramid). Both are
// small, both are single-file, so nothing bundled exercises navigating a model
// made of submodels. Rather than redistribute somebody's recreation of a real
// set, this one is generated from library parts.
//
// LDraw geometry notes, verified by measuring the parts:
//   - Y points DOWN, so stacking upward means decreasing y.
//   - A part's origin is the centre of its TOP face. It extends downward from
//     there, occupying y 0..height. So a part landing on a surface at height h
//     is referenced at `h - ownHeight`, not at `h`. Getting that backwards
//     sinks the part through whatever it is supposed to be standing on, which
//     is the single easiest mistake to make in this file.
//   - Brick height 24, plate height 8, one stud pitch 20.
//   - Studs sit on odd multiples of 10 in x and z. A part is on-grid when its
//     own stud positions land on that lattice.
//
// `validate` at the bottom checks all of the above against the emitted file, so
// an arithmetic slip fails the run rather than shipping a model that cannot be
// built.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./lib/paths.mjs";

const OUT_DIR = path.join(ROOT, "demo-models");

const BRICK = 24;
const PLATE = 8;
const STUD = 20;

const IDENTITY = "1 0 0 0 1 0 0 0 1";

const STEP_LINE = /^0 STEP/;

const COLOR = {
  darkGrey: 72,
  green: 2,
  lightGrey: 71,
  red: 4,
  white: 15,
};

/**
 * Half-extents and height of every part this file places, in LDraw units.
 *
 * `x` and `z` are half-widths about the origin; `h` is how far the part reaches
 * below its origin. Only the body is described: studs are ignored, because two
 * stacked bricks are meant to share a plane at the stud line.
 */
const PARTS = {
  "3001.dat": { h: BRICK, x: 40, z: 20 },
  "3005.dat": { h: BRICK, x: 10, z: 10 },
  "3020.dat": { h: PLATE, x: 40, z: 20 },
  "3024.dat": { h: PLATE, x: 10, z: 10 },
};

/** One type-1 reference line. */
const ref = (colour, x, y, z, file, matrix = IDENTITY) =>
  `1 ${colour} ${x} ${y} ${z} ${matrix} ${file}`;

// ---------------------------------------------------------------------------
// A gatehouse built from named submodels, with real build steps.
//
// Four corner towers and a wall span, each its own submodel, so the submodel
// tree has something to isolate and bag labels have something to name
// themselves after. Every submodel is referenced one brick height above the
// courtyard's top face, which is what puts it on the plate rather than through
// it.
// ---------------------------------------------------------------------------

/** Levels of 1x1 bricks in a tower, before the battlements go on. */
const TOWER_LEVELS = 6;

/** Courses of 2x4 bricks in the wall span. */
const SPAN_COURSES = 3;

/** Half the courtyard, in plates: 3 columns of 2x4 across, 5 rows deep. */
const BASE_COLS = 1;
const BASE_ROWS = 2;

/**
 * Corner offsets for the four towers.
 *
 * A tower's columns sit at ±STUD from its origin, so the origin must land on
 * the stud lattice for the columns to as well. (±90, ±70) puts every column
 * inside the courtyard footprint of x ±120, z ±100, with its outer face flush
 * against the edge.
 */
const TOWER_CORNERS = [
  [-90, -70],
  [90, -70],
  [-90, 70],
  [90, 70],
];

function tower() {
  const lines = ["0 Tower", "0 Name: tower.ldr", "0 !LDRAW_ORG Model", ""];
  for (let level = 0; level < TOWER_LEVELS; level += 1) {
    const y = -level * BRICK;
    const colour = level < 4 ? COLOR.lightGrey : COLOR.darkGrey;
    lines.push(ref(colour, -STUD, y, -STUD, "3005.dat"));
    lines.push(ref(colour, STUD, y, -STUD, "3005.dat"));
    lines.push(ref(colour, -STUD, y, STUD, "3005.dat"));
    lines.push(ref(colour, STUD, y, STUD, "3005.dat"));
    // A step every two levels: enough steps to scrub through, few enough that
    // each one places a visible amount.
    if (level % 2 === 1) {
      lines.push("0 STEP");
    }
  }
  // Battlements. The top brick's own top face is one brick above the level
  // below it, and a plate hangs PLATE below its origin, so this is where a
  // plate lands on it. `-TOWER_LEVELS * BRICK` would be right for another
  // brick and leaves a plate floating by the difference of the two heights.
  const topY = -(TOWER_LEVELS - 1) * BRICK - PLATE;
  lines.push(ref(COLOR.darkGrey, -STUD, topY, -STUD, "3024.dat"));
  lines.push(ref(COLOR.darkGrey, STUD, topY, STUD, "3024.dat"));
  lines.push("0 STEP");
  return `${lines.join("\n")}\n`;
}

function span() {
  const lines = ["0 Wall Span", "0 Name: span.ldr", "0 !LDRAW_ORG Model", ""];
  for (let course = 0; course < SPAN_COURSES; course += 1) {
    const y = -course * BRICK;
    for (let i = -1; i <= 1; i += 1) {
      lines.push(
        ref(
          course === SPAN_COURSES - 1 ? COLOR.red : COLOR.white,
          i * 4 * STUD,
          y,
          0,
          "3001.dat"
        )
      );
    }
    lines.push("0 STEP");
  }
  return `${lines.join("\n")}\n`;
}

function base() {
  const lines = ["0 Courtyard", "0 Name: base.ldr", "0 !LDRAW_ORG Model", ""];
  for (let row = -BASE_ROWS; row <= BASE_ROWS; row += 1) {
    for (let col = -BASE_COLS; col <= BASE_COLS; col += 1) {
      lines.push(
        ref(COLOR.green, col * 4 * STUD, 0, row * 2 * STUD, "3020.dat")
      );
    }
    lines.push("0 STEP");
  }
  return `${lines.join("\n")}\n`;
}

function gatehouse() {
  const lines = [
    "0 Gatehouse",
    "0 Name: gatehouse.ldr",
    "0 Author: Generated by scripts/make-demos.mjs",
    "0 !LDRAW_ORG Model",
    "",
    ref(COLOR.white, 0, 0, 0, "base.ldr"),
    "0 STEP",
  ];

  // The courtyard's top face is y = 0, because a plate referenced at y = 0
  // hangs below its origin. Both submodels start with a brick, whose own origin
  // is its top face, so they are referenced one brick height above that.
  const onBase = -BRICK;

  for (const [x, z] of TOWER_CORNERS) {
    lines.push(ref(COLOR.white, x, onBase, z, "tower.ldr"));
    lines.push("0 STEP");
  }

  // The span runs the full width of the courtyard, down the middle where it
  // clears all four towers. Rotating it to run the other way would need 240 LDU
  // of a footprint only 200 deep, and half of it would hang off the edge.
  lines.push(ref(COLOR.white, 0, onBase, 0, "span.ldr"));
  lines.push("0 STEP");
  return `${lines.join("\n")}\n`;
}

function buildGatehouse() {
  // MPD ordering matters: the first `0 FILE` block is the model that gets loaded.
  const files = [
    ["gatehouse.ldr", gatehouse()],
    ["base.ldr", base()],
    ["tower.ldr", tower()],
    ["span.ldr", span()],
  ];

  return files.map(([name, body]) => `0 FILE ${name}\n${body}`).join("\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const REF_LINE = /^1\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(?:\S+\s+){9}(\S+)\s*$/;
const FILE_LINE = /^0\s+FILE\s+(.+)$/i;

/** Split an .mpd into `name -> body lines`. */
function splitFiles(text) {
  const files = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const match = FILE_LINE.exec(line.trim());
    if (match) {
      current = [];
      files.set(match[1].toLowerCase(), current);
      continue;
    }
    current?.push(line);
  }
  return files;
}

/**
 * Resolve every reference to a world-space box.
 *
 * Only the identity matrix is handled, which is all this file emits. A rotated
 * reference would need the box rotated with it, and silently treating one as
 * axis-aligned would make the check lie, so it throws instead.
 */
function placements(text) {
  const files = splitFiles(text);
  const [rootName] = [...files.keys()];
  const out = [];

  const walk = (name, ox, oy, oz, trail) => {
    const body = files.get(name);
    if (!body) {
      throw new Error(`${name} is referenced but not in the file`);
    }
    for (const line of body) {
      const match = REF_LINE.exec(line.trim());
      if (!match) {
        continue;
      }
      const [, , sx, sy, sz, target] = match;
      const x = ox + Number(sx);
      const y = oy + Number(sy);
      const z = oz + Number(sz);
      if (!line.trim().includes(IDENTITY)) {
        throw new Error(
          `${name} rotates ${target}; validation cannot check that`
        );
      }

      const part = PARTS[target.toLowerCase()];
      if (part) {
        out.push({
          bottom: y + part.h,
          name: `${trail}${target}`,
          top: y,
          x0: x - part.x,
          x1: x + part.x,
          z0: z - part.z,
          z1: z + part.z,
        });
        continue;
      }
      walk(target.toLowerCase(), x, y, z, `${trail}${target}/`);
    }
  };

  walk(rootName, 0, 0, 0, "");
  return out;
}

const overlaps = (a, b) =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

/** Every part stands on the ground or on the top face of another part. */
function unsupported(parts) {
  // Y points down, so the ground is the largest `bottom`.
  const ground = Math.max(...parts.map((p) => p.bottom));

  return parts
    .filter(
      (part) =>
        part.bottom !== ground &&
        !parts.some(
          (other) =>
            other !== part && other.top === part.bottom && overlaps(part, other)
        )
    )
    .map((part) => `${part.name} at y ${part.top} rests on nothing`);
}

/**
 * Every part lands on the stud lattice.
 *
 * Studs sit at odd multiples of half a pitch, and every part here has its own
 * studs half a pitch in from each edge. So a part is on-grid exactly when its
 * edges fall on multiples of the full pitch, whatever size the part is: a 1x1
 * centred on a stud reaches half a pitch either side of it, and a 2x4 spanning
 * four of them reaches half a pitch outside the two on its ends.
 */
function offGrid(parts) {
  const onLattice = (edge) => edge % STUD === 0;

  return parts
    .filter((part) => ![part.x0, part.x1, part.z0, part.z1].every(onLattice))
    .map(
      (part) =>
        `${part.name} is off the stud grid: x ${part.x0}..${part.x1}, z ${part.z0}..${part.z1}`
    );
}

/** No two parts share any space. */
function collisions(parts) {
  const problems = [];
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      const a = parts[i];
      const b = parts[j];
      if (overlaps(a, b) && a.top < b.bottom && b.top < a.bottom) {
        problems.push(`${a.name} and ${b.name} occupy the same space`);
      }
    }
  }
  return problems;
}

/** Everything above, reported together so one run names every fault. */
function validate(name, text) {
  const parts = placements(text);
  const problems = [
    ...unsupported(parts),
    ...offGrid(parts),
    ...collisions(parts),
  ];

  if (problems.length > 0) {
    const shown = problems.slice(0, 10).join("\n  ");
    const more =
      problems.length > 10 ? `\n  ...and ${problems.length - 10} more` : "";
    throw new Error(`${name} is not buildable:\n  ${shown}${more}`);
  }

  return parts.length;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const outputs = [["gatehouse.mpd", buildGatehouse()]];

  for (const [name, body] of outputs) {
    validate(name, body);
  }

  await Promise.all(
    outputs.map(([name, body]) => writeFile(path.join(OUT_DIR, name), body))
  );

  for (const [name, body] of outputs) {
    const refs = body.split("\n").filter((l) => l.startsWith("1 ")).length;
    const steps = body.split("\n").filter((l) => STEP_LINE.test(l)).length;
    console.log(
      `- ${name.padEnd(16)} ${String(refs).padStart(4)} refs, ${steps} STEP metas, buildable`
    );
  }
  console.log("\nNow run: pnpm ldraw:pack");
}

main().catch((err) => {
  console.error(`make-demos failed: ${err.message}`);
  process.exit(1);
});
