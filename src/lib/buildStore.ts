/**
 * Saved build progress, in localStorage.
 *
 * A build is worth resuming and cheap to describe: the step you are on, the
 * slots you have filled, and where the loose bricks are lying. The first two
 * are a couple of hundred bytes. The third is the expensive one, and it is kept
 * because a pile you have already sorted through is most of the work: throwing
 * it away and re-pouring would hand back a tidy heap you have never seen.
 *
 * Nothing here is load-bearing. Every read is defensive and every write may
 * fail, because localStorage can be disabled, full, or holding a save written
 * against a model that has since been repacked.
 */

const PREFIX = "ldraw:build:";
const VERSION = 1;

/** Saves kept before the least recently touched one is dropped. */
const MAX_SAVES = 12;

/** Loose poses are cosmetic, so they round hard. */
const POSITION_DP = 2;
const ROTATION_DP = 4;

export interface BuildSave {
  /** Brick count, checked against the model so a repack invalidates the save. */
  bricks: number;
  /** Flat [id, x, y, z, qx, qy, qz, qw] per loose brick. */
  loose: number[];
  placed: number[];
  slug: string;
  step: number;
  steps: number;
  title: string;
  updatedAt: number;
  v: number;
}

interface BuildSummary {
  slug: string;
  step: number;
  steps: number;
  title: string;
  updatedAt: number;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access itself throws when cookies are blocked entirely.
    return null;
  }
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function isSave(value: unknown): value is BuildSave {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const save = value as Partial<BuildSave>;
  return (
    save.v === VERSION &&
    typeof save.slug === "string" &&
    typeof save.step === "number" &&
    Array.isArray(save.placed) &&
    Array.isArray(save.loose)
  );
}

export function readBuild(slug: string): BuildSave | null {
  const store = storage();
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(PREFIX + slug);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isSave(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A save is only usable against the model it was written for. Bricks and steps
 * together are a good enough fingerprint: repacking a model changes at least
 * one of them, and if it changes neither the brick ids still line up.
 */
export function matchesModel(
  save: BuildSave,
  bricks: number,
  steps: number
): boolean {
  return save.bricks === bricks && save.steps === steps;
}

export function writeBuild(save: BuildSave): void {
  const store = storage();
  if (!store) {
    return;
  }

  const compact: BuildSave = {
    ...save,
    loose: save.loose.map((value, index) =>
      // [id, x, y, z, qx, qy, qz, qw]: the id is exact, positions are coarse,
      // rotations need a little more or bricks visibly tilt on resume.
      roundField(value, index % 8)
    ),
    v: VERSION,
  };

  const key = PREFIX + save.slug;
  const json = JSON.stringify(compact);

  if (tryWrite(store, key, json)) {
    return;
  }

  // Out of room. The pile is the big half of the file and the least important,
  // so drop it before dropping the build.
  const lean = JSON.stringify({ ...compact, loose: [] });
  if (tryWrite(store, key, lean)) {
    return;
  }

  evictOldest(store, 1);
  tryWrite(store, key, lean);
}

function roundField(value: number, field: number): number {
  if (field === 0) {
    return value;
  }
  return round(value, field <= 3 ? POSITION_DP : ROTATION_DP);
}

function tryWrite(store: Storage, key: string, json: string): boolean {
  try {
    store.setItem(key, json);
    return true;
  } catch {
    return false;
  }
}

export function clearBuild(slug: string): void {
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(PREFIX + slug);
  } catch {
    // Nothing to do: the save simply stays.
  }
}

/** Every saved build, most recently touched first. */
function listBuilds(): BuildSummary[] {
  const store = storage();
  if (!store) {
    return [];
  }

  const out: BuildSummary[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key === null || !key.startsWith(PREFIX)) {
        continue;
      }
      const save = readBuild(key.slice(PREFIX.length));
      if (save) {
        out.push({
          slug: save.slug,
          step: save.step,
          steps: save.steps,
          title: save.title,
          updatedAt: save.updatedAt,
        });
      }
    }
  } catch {
    return out;
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Keep the store from growing without bound as models are tried and left. */
export function pruneBuilds(): void {
  const store = storage();
  if (!store) {
    return;
  }
  const saves = listBuilds();
  if (saves.length <= MAX_SAVES) {
    return;
  }
  evictOldest(store, saves.length - MAX_SAVES);
}

function evictOldest(store: Storage, count: number): void {
  const saves = listBuilds();
  for (const save of saves.slice(-count)) {
    try {
      store.removeItem(PREFIX + save.slug);
    } catch {
      return;
    }
  }
}
