import { readJson, removeKey, round, writeRaw } from "./localStore";

/**
 * The free build, in localStorage.
 *
 * There is only ever one, because a sandbox is a place rather than a document:
 * you come back to the floor you left. Saving it is the same shape as saving a
 * guided build, minus the model to check it against, because a free build has
 * no model. What it has instead is part names, and a part that has since left
 * the palette is simply dropped on the way back in.
 */

const KEY = "ldraw:free";
const VERSION = 1;

const POSITION_DP = 2;
const ROTATION_DP = 4;

export interface PlacedEntry {
  /** Colour code. Short keys: a big build writes this line a thousand times. */
  c: number;
  /** Part file. */
  f: string;
  /** Position of the part's origin. */
  p: [number, number, number];
  /** Quarter turns about X. */
  t: number;
  /** Quarter turns about Y. */
  y: number;
}

export interface LoosePart {
  colorCode: number;
  file: string;
  id: number;
}

export interface FreeSave {
  /** Flat [id, x, y, z, qx, qy, qz, qw] per loose brick, as the world reports it. */
  loose: number[];
  /** What each loose id actually is, which the physics snapshot does not know. */
  looseParts: LoosePart[];
  placed: PlacedEntry[];
  updatedAt: number;
  v: number;
}

function isSave(value: unknown): value is FreeSave {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const save = value as Partial<FreeSave>;
  return (
    save.v === VERSION &&
    Array.isArray(save.placed) &&
    Array.isArray(save.loose) &&
    Array.isArray(save.looseParts)
  );
}

export function readFreeBuild(): FreeSave | null {
  return readJson(KEY, isSave);
}

export function writeFreeBuild(save: FreeSave): void {
  const compact: FreeSave = {
    ...save,
    loose: save.loose.map((value, index) =>
      // [id, x, y, z, qx, qy, qz, qw]: the id is exact, positions are coarse,
      // rotations need a little more or bricks visibly tilt on resume.
      index % 8 === 0
        ? value
        : round(value, index % 8 <= 3 ? POSITION_DP : ROTATION_DP)
    ),
    placed: save.placed.map((entry) => ({
      ...entry,
      p: [
        round(entry.p[0], POSITION_DP),
        round(entry.p[1], POSITION_DP),
        round(entry.p[2], POSITION_DP),
      ],
    })),
    v: VERSION,
  };

  if (writeRaw(KEY, JSON.stringify(compact))) {
    return;
  }
  // The pile is the big half of the file and the least important: a build you
  // have made matters more than a heap you have not sorted yet.
  writeRaw(KEY, JSON.stringify({ ...compact, loose: [], looseParts: [] }));
}

export function clearFreeBuild(): void {
  removeKey(KEY);
}

const HOTBAR_KEY = "ldraw:free:hotbar";

export interface HotbarEntry {
  colorCode: number;
  file: string;
}

/**
 * The hotbar outlives a session because the parts somebody reaches for are a
 * property of how they build, not of what they are building today.
 */
export function readHotbar(): (HotbarEntry | null)[] | null {
  const parsed = readJson(HOTBAR_KEY, Array.isArray);
  if (!parsed) {
    return null;
  }
  return parsed.map((entry: unknown) =>
    entry &&
    typeof entry === "object" &&
    typeof (entry as HotbarEntry).file === "string"
      ? {
          colorCode: Number((entry as HotbarEntry).colorCode) || 0,
          file: (entry as HotbarEntry).file,
        }
      : null
  );
}

export function writeHotbar(slots: (HotbarEntry | null)[]): void {
  writeRaw(HOTBAR_KEY, JSON.stringify(slots));
}

/** How much is on the floor, for the gallery card. Null when there is nothing. */
export function freeBuildSummary(): {
  placed: number;
  updatedAt: number;
} | null {
  const save = readFreeBuild();
  if (!save || save.placed.length === 0) {
    return null;
  }
  return { placed: save.placed.length, updatedAt: save.updatedAt };
}
