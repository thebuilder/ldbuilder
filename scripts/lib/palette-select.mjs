// Chooses the parts that make up the free-build palette.
//
// The library has 20,000 real parts in it, most of which are a printed variant
// of another part, a Duplo mould, or a licensed minifigure. A palette is a
// different thing from a library: it is what you would tip out of a tub, so it
// wants the classic system elements and nothing else, grouped the way a tub is
// grouped rather than the way the library files are.
//
// Selection is by rule rather than by a hand-written list of part numbers. A
// list would go stale against a library that gains parts every release, and
// would be a hundred numbers nobody could check. The rules read each part's own
// description, which is where LDraw already records what something is and how
// big it is.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Only plain moulds: `3001`, `3062b`. `3001p01` is that brick with a print on. */
const PLAIN_MOULD = /^\d{1,6}[a-z]?$/;

/** Systems that are not what anyone means by "a box of bricks". */
const FOREIGN =
  /duplo|primo|znap|scala|belville|modulex|galidor|fabric|cloth|sticker|pattern|printed/i;

const DESCRIPTION_LINE = /^0\s+(?!!|\/\/)(.+)$/;
const LDRAW_ORG = /^0\s+!LDRAW_ORG\s+(\S+)/i;
const REAL_TYPE = /^(Unofficial_)?(Part|Shortcut)$/i;
const ALIAS_MARKER = /^[~=_]/;
const DAT_SUFFIX = /\.dat$/i;
const WHITESPACE = /\s+/g;
const CATEGORY_TAIL = /^0\s+!CATEGORY\s+(.+)$/i;
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * The groups, in the order the palette shows them.
 *
 * Each pattern's capture groups are the part's size in studs, which is what the
 * inventory filters on. A pattern with no captures still selects; it just has
 * no size to filter by, which is the right answer for a wheel.
 */
const GROUPS = [
  {
    id: "brick",
    label: "Bricks",
    patterns: [
      /^Brick (\d+) x (\d+)$/i,
      /^Brick (\d+) x (\d+) x (\d+(?:\.\d+)?)$/i,
      /^Brick (\d+) x (\d+) Round$/i,
      /^Brick (\d+) x (\d+) Corner$/i,
    ],
  },
  {
    id: "plate",
    label: "Plates",
    patterns: [
      /^Plate (\d+) x (\d+)$/i,
      /^Plate (\d+) x (\d+) Round$/i,
      /^Plate (\d+) x (\d+) Corner$/i,
      /^Plate (\d+) x (\d+) without Corner$/i,
    ],
  },
  {
    id: "tile",
    label: "Tiles",
    patterns: [
      /^Tile (\d+) x (\d+)$/i,
      /^Tile (\d+) x (\d+) with Groove$/i,
      /^Tile (\d+) x (\d+) Round$/i,
    ],
  },
  {
    id: "slope",
    label: "Slopes",
    patterns: [
      /^Slope Brick \d+ (\d+) x (\d+)$/i,
      /^Slope Brick \d+ (\d+) x (\d+) Inverted$/i,
      /^Slope Brick \d+ (\d+) x (\d+) Double$/i,
      /^Slope Brick Curved (\d+) x (\d+)$/i,
      /^Slope Brick \d+ (\d+) x (\d+) x (\d+(?:\.\d+)?)$/i,
    ],
  },
  {
    id: "round",
    label: "Round",
    patterns: [
      /^Cone (\d+) x (\d+) x (\d+(?:\.\d+)?)$/i,
      /^Cylinder (\d+) x (\d+) x (\d+(?:\.\d+)?)$/i,
      /^Dish (\d+) x (\d+) Inverted$/i,
    ],
  },
  {
    id: "angle",
    label: "Brackets & hinges",
    patterns: [
      /^Bracket (\d+) x (\d+) - (\d+) x (\d+)$/i,
      /^Hinge Plate (\d+) x (\d+)$/i,
      /^Hinge Brick (\d+) x (\d+) Base$/i,
      /^Hinge Brick (\d+) x (\d+) Top$/i,
      /^Plate (\d+) x (\d+) with Clip Horizontal$/i,
      /^Plate (\d+) x (\d+) with Handle$/i,
    ],
  },
  {
    id: "wall",
    label: "Panels, windows & doors",
    patterns: [
      /^Panel (\d+) x (\d+) x (\d+)$/i,
      /^Panel (\d+) x (\d+) x (\d+) Corner$/i,
      /^Window (\d+) x (\d+) x (\d+) Frame$/i,
      /^Door (\d+) x (\d+) x (\d+) Frame$/i,
      /^Brick (\d+) x (\d+) x (\d+) Arch$/i,
      /^Arch (\d+) x (\d+)$/i,
    ],
  },
  {
    id: "wheel",
    label: "Wheels",
    /** Wheels are a long tail of one-offs; a tub holds a couple of sizes. */
    limit: 14,
    patterns: [/^Wheel .+$/i, /^Tyre .+$/i],
  },
  {
    id: "base",
    label: "Baseplates",
    limit: 10,
    patterns: [/^Baseplate (\d+) x (\d+)$/i],
  },
];

function readHeader(text) {
  let description = null;
  let type = null;
  let category = null;

  for (const raw of text.split(LINE_BREAK)) {
    const line = raw.trim();
    if (line === "") {
      continue;
    }
    // The header is over once geometry starts.
    if (!line.startsWith("0 ")) {
      break;
    }

    const org = LDRAW_ORG.exec(line);
    if (org) {
      [, type] = org;
      continue;
    }
    const tagged = CATEGORY_TAIL.exec(line);
    if (tagged) {
      category = tagged[1].trim();
      continue;
    }

    if (description === null) {
      const desc = DESCRIPTION_LINE.exec(line);
      if (desc) {
        // Descriptions are space-aligned in the library ("Brick  1 x  2"), and
        // every pattern here would have to carry that formatting otherwise.
        description = desc[1].trim().replace(WHITESPACE, " ");
      }
    }
  }

  return { category, description, type };
}

function classify(description) {
  for (const group of GROUPS) {
    for (const pattern of group.patterns) {
      const match = pattern.exec(description);
      if (match) {
        const size = match
          .slice(1)
          .filter((value) => value !== undefined)
          .map(Number);
        return { group, size };
      }
    }
  }
  return null;
}

/**
 * How a part sorts within its group: smallest footprint first, so a palette
 * reads outwards from 1x1 rather than in part-number order.
 */
function sortKey(entry) {
  const [a = 99, b = 99, c = 0] = entry.size;
  return a * b * 1000 + (a + b) * 10 + c;
}

export async function selectPaletteParts(libraryDir) {
  const partsDir = path.join(libraryDir, "parts");
  const files = (await readdir(partsDir)).filter((name) =>
    DAT_SUFFIX.test(name)
  );

  const found = new Map(GROUPS.map((group) => [group.id, []]));

  await Promise.all(
    files.map(async (file) => {
      const base = file.replace(DAT_SUFFIX, "");
      if (!PLAIN_MOULD.test(base)) {
        return;
      }

      const text = await readFile(path.join(partsDir, file), "utf8");
      const { category, description, type } = readHeader(text);
      if (!(description && type && REAL_TYPE.test(type))) {
        return;
      }
      if (ALIAS_MARKER.test(description) || FOREIGN.test(description)) {
        return;
      }

      const hit = classify(description);
      if (!hit) {
        return;
      }

      found.get(hit.group.id).push({
        category: category ?? hit.group.label,
        file: `${base}.dat`,
        name: description,
        size: hit.size,
      });
    })
  );

  return GROUPS.map((group) => {
    const entries = found
      .get(group.id)
      .sort((a, b) => sortKey(a) - sortKey(b) || a.file.localeCompare(b.file));
    return {
      id: group.id,
      label: group.label,
      parts: group.limit ? entries.slice(0, group.limit) : entries,
    };
  });
}
