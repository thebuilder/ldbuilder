import type { BufferAttribute, InterleavedBufferAttribute, Mesh } from "three";
import { type Box3, Matrix4, Quaternion, Vector3 } from "three";

/**
 * What a part looks like from above and from below.
 *
 * A bounding box says a part is one slab: one height it rests at, one height
 * things rest on it. Half the parts in the library are not that. A bracket has
 * a plate at one level and a flange at another; a slope's top is a different
 * height at every stud; an arch is only solid at its legs. Resting those on a
 * box floats them, which is what "multiple levels only snap to their base"
 * looks like on screen.
 *
 * So each part is measured into columns instead: half a stud across, and for
 * each one the lowest and highest solid the part has there. Two parts meet at
 * whichever column binds first, which is how a real brick finds the thing under
 * it. Studs are left out for the same reason the box left them out, so bricks
 * stack flush rather than perched on the studs below.
 */

/** LDU across one column. Half a stud: fine enough for a bracket's flange. */
export const COLUMN = 10;

/** Overlaps under this are two parts touching, not two parts colliding. */
const TOUCH_EPSILON = 0.5;

/**
 * LDraw puts a part's origin on its stud plane and points Y downwards, so the
 * body runs from zero to positive Y and anything negative stands proud of that
 * plane. A stud stands exactly this far proud.
 */
const STUD_PLANE = 0;
const STUD_HEIGHT = 4;

/** Samples along a triangle's edges, so thin walls and rims are not missed. */
const EDGE_STEP = COLUMN / 2;

/**
 * How far a triangle is pulled in from its own edges before being measured.
 *
 * Parts are cut to the grid, so a step in one is a face that ends exactly on a
 * column boundary. Counted in the column it touches, the deep half of a bracket
 * bleeds into the shallow half's first column and the part rests a whole brick
 * too high, which is the thing this file exists to stop. Half a unit of inset
 * costs nothing at this resolution and puts each face in the columns it is
 * actually inside.
 */
const INSET = 0.5;

/**
 * A face flatter in plan than this is a wall, and is left out.
 *
 * A wall tells you nothing: whatever solid it bounds is already bounded above
 * and below by faces that do have a footprint. It only ever adds the column it
 * happens to stand on.
 */
const MIN_FOOTPRINT = 1;

export interface Profile {
  /** X of the left edge of column 0, relative to the part's origin. */
  anchorX: number;
  anchorZ: number;
  /** Lowest solid in each column, relative to the origin. Infinity if empty. */
  bottom: Float32Array;
  cols: number;
  rows: number;
  /** Highest solid in each column. -Infinity if empty. */
  top: Float32Array;
}

/** A profile that has been put somewhere. */
export interface Standing {
  position: Vector3;
  profile: Profile;
}

const scratchA = new Vector3();
const scratchB = new Vector3();
const scratchC = new Vector3();
const scratchMatrix = new Matrix4();
const scratchQuat = new Quaternion();

type Vertices = BufferAttribute | InterleavedBufferAttribute;

/**
 * Measure a part, turned this way, into columns.
 *
 * Two passes over the same triangles: one to find the footprint, one to fill
 * it. Cheap enough to do when a part is picked up or turned, which is the only
 * time the answer changes, and far cheaper than keeping a voxel grid per part.
 */
export function profileOf(meshes: Mesh[], quaternion: Quaternion): Profile {
  const bounds = measure(meshes, quaternion);
  const profile = blank(bounds);
  if (profile.cols === 0) {
    return profile;
  }
  eachTriangle(meshes, quaternion, (a, b, c) => rasterise(profile, a, b, c));
  return profile;
}

interface Bounds {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

function measure(meshes: Mesh[], quaternion: Quaternion): Bounds {
  const bounds: Bounds = {
    maxX: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    minX: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
  };
  eachTriangle(meshes, quaternion, (a, b, c) => {
    for (const point of [a, b, c]) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minZ = Math.min(bounds.minZ, point.z);
      bounds.maxZ = Math.max(bounds.maxZ, point.z);
    }
  });
  return bounds;
}

function blank(bounds: Bounds): Profile {
  if (!Number.isFinite(bounds.minX)) {
    return {
      anchorX: 0,
      anchorZ: 0,
      bottom: new Float32Array(0),
      cols: 0,
      rows: 0,
      top: new Float32Array(0),
    };
  }
  const anchorX = Math.floor(bounds.minX / COLUMN) * COLUMN;
  const anchorZ = Math.floor(bounds.minZ / COLUMN) * COLUMN;
  const cols = Math.max(Math.ceil((bounds.maxX - anchorX) / COLUMN), 1);
  const rows = Math.max(Math.ceil((bounds.maxZ - anchorZ) / COLUMN), 1);
  const bottom = new Float32Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  const top = new Float32Array(cols * rows).fill(Number.NEGATIVE_INFINITY);
  return { anchorX, anchorZ, bottom, cols, rows, top };
}

/**
 * Every triangle of every mesh, turned, and with its studs left out.
 *
 * Studs are left out because a stud goes inside the part above it rather than
 * holding it up: counted, every brick in a build sits a stud's height clear of
 * the one below, which is exactly the gap it looks like. What counts as a stud
 * is geometry that fits inside the stud band and nowhere else, so a bracket's
 * upstand, which starts at the same plane but keeps going, is kept.
 */
function eachTriangle(
  meshes: Mesh[],
  quaternion: Quaternion,
  visit: (a: Vector3, b: Vector3, c: Vector3) => void
): void {
  for (const mesh of meshes) {
    const vertices = mesh.geometry.getAttribute("position") as
      | Vertices
      | undefined;
    if (!vertices) {
      continue;
    }
    const indices = mesh.geometry.getIndex();
    const count = indices ? indices.count : vertices.count;
    scratchMatrix.copy(mesh.matrixWorld);
    scratchQuat.copy(quaternion);
    for (let i = 0; i + 2 < count; i += 3) {
      read(vertices, indices, i, scratchA);
      read(vertices, indices, i + 1, scratchB);
      read(vertices, indices, i + 2, scratchC);
      if (isStud(scratchA, scratchB, scratchC)) {
        continue;
      }
      scratchA.applyQuaternion(scratchQuat);
      scratchB.applyQuaternion(scratchQuat);
      scratchC.applyQuaternion(scratchQuat);
      visit(scratchA, scratchB, scratchC);
    }
  }
}

/** Inside the stud band, and reaching above the plane rather than only touching it. */
function isStud(a: Vector3, b: Vector3, c: Vector3): boolean {
  const lowest = Math.min(a.y, b.y, c.y);
  const highest = Math.max(a.y, b.y, c.y);
  return lowest >= -STUD_HEIGHT && highest <= STUD_PLANE && lowest < STUD_PLANE;
}

function read(
  vertices: Vertices,
  indices: BufferAttribute | null,
  at: number,
  target: Vector3
): void {
  target.fromBufferAttribute(vertices, indices ? indices.getX(at) : at);
  target.applyMatrix4(scratchMatrix);
}

function rasterise(profile: Profile, a: Vector3, b: Vector3, c: Vector3): void {
  const area = footprint(a, b, c);
  if (Math.abs(area) < MIN_FOOTPRINT) {
    return;
  }
  const midX = (a.x + b.x + c.x) / 3;
  const midZ = (a.z + b.z + c.z) / 3;
  for (const point of [a, b, c]) {
    inset(point, midX, midZ);
  }

  // Corners, then edges, then the inside. A rim is a face too narrow to hold a
  // column centre and is only ever caught by the first two; the middle of a
  // brick's underside is only caught by the third.
  cover(profile, a.x, a.z, a.y);
  cover(profile, b.x, b.z, b.y);
  cover(profile, c.x, c.z, c.y);
  edge(profile, a, b);
  edge(profile, b, c);
  edge(profile, c, a);
  // Recomputed from the pulled-in corners: the barycentric test below has to
  // divide by the area of the triangle it is actually testing.
  face(profile, a, b, c, footprint(a, b, c));
}

/** Twice the area the triangle covers in plan. Zero for a wall. */
function footprint(a: Vector3, b: Vector3, c: Vector3): number {
  return (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
}

function inset(point: Vector3, midX: number, midZ: number): void {
  const dx = point.x - midX;
  const dz = point.z - midZ;
  const span = Math.hypot(dx, dz);
  if (span <= INSET) {
    point.x = midX;
    point.z = midZ;
    return;
  }
  const scale = (span - INSET) / span;
  point.x = midX + dx * scale;
  point.z = midZ + dz * scale;
}

function cover(profile: Profile, x: number, z: number, y: number): void {
  const col = columnAt(x, profile.anchorX, profile.cols);
  const row = columnAt(z, profile.anchorZ, profile.rows);
  const at = row * profile.cols + col;
  profile.bottom[at] = Math.min(profile.bottom[at], y);
  profile.top[at] = Math.max(profile.top[at], y);
}

function columnAt(value: number, anchor: number, count: number): number {
  const raw = Math.floor((value - anchor) / COLUMN);
  return Math.min(Math.max(raw, 0), count - 1);
}

function edge(profile: Profile, from: Vector3, to: Vector3): void {
  const span = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.ceil(span / EDGE_STEP);
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    cover(
      profile,
      from.x + (to.x - from.x) * t,
      from.z + (to.z - from.z) * t,
      from.y + (to.y - from.y) * t
    );
  }
}

function face(
  profile: Profile,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  area: number
): void {
  if (area === 0) {
    return;
  }
  const from = { x: Math.min(a.x, b.x, c.x), z: Math.min(a.z, b.z, c.z) };
  const to = { x: Math.max(a.x, b.x, c.x), z: Math.max(a.z, b.z, c.z) };
  const col0 = columnAt(from.x, profile.anchorX, profile.cols);
  const col1 = columnAt(to.x, profile.anchorX, profile.cols);
  const row0 = columnAt(from.z, profile.anchorZ, profile.rows);
  const row1 = columnAt(to.z, profile.anchorZ, profile.rows);

  for (let col = col0; col <= col1; col += 1) {
    const x = profile.anchorX + (col + 0.5) * COLUMN;
    for (let row = row0; row <= row1; row += 1) {
      const z = profile.anchorZ + (row + 0.5) * COLUMN;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / area;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / area;
      if (u < 0 || v < 0 || u + v > 1) {
        continue;
      }
      cover(profile, x, z, u * a.y + v * b.y + (1 - u - v) * c.y);
    }
  }
}

/** The lowest solid anywhere in the part, relative to its origin. */
export function lowestOf(profile: Profile): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (const value of profile.bottom) {
    lowest = Math.min(lowest, value);
  }
  return Number.isFinite(lowest) ? lowest : 0;
}

/**
 * The origin height at which `moving`, put down at this footprint, would come
 * to rest on `fixed`. Null when the two do not share a column.
 *
 * Every shared column proposes a height, and the highest wins: that is the one
 * that would otherwise be passed through.
 */
export function contactHeight(
  moving: Profile,
  x: number,
  z: number,
  fixed: Standing
): number | null {
  let rest: number | null = null;
  each(moving, x, z, fixed, (theirs, mine) => {
    if (
      !(
        Number.isFinite(fixed.profile.top[theirs]) &&
        Number.isFinite(moving.bottom[mine])
      )
    ) {
      return;
    }
    const candidate =
      fixed.position.y + fixed.profile.top[theirs] - moving.bottom[mine];
    rest = rest === null ? candidate : Math.max(rest, candidate);
  });
  return rest;
}

/** True when `moving`, put down here, would share space with `fixed`. */
export function profilesCollide(
  moving: Profile,
  position: Vector3,
  fixed: Standing
): boolean {
  let hit = false;
  each(moving, position.x, position.z, fixed, (theirs, mine) => {
    if (hit) {
      return;
    }
    const low = position.y + moving.bottom[mine];
    const high = position.y + moving.top[mine];
    const theirLow = fixed.position.y + fixed.profile.bottom[theirs];
    const theirHigh = fixed.position.y + fixed.profile.top[theirs];
    if (low < theirHigh - TOUCH_EPSILON && high > theirLow + TOUCH_EPSILON) {
      hit = true;
    }
  });
  return hit;
}

/**
 * Walk the columns two parts share.
 *
 * Their grids are each anchored to their own part, so a column of one can
 * straddle two of the other; taking every column it touches keeps the answer on
 * the safe side of the truth rather than letting parts slide into each other.
 */
function each(
  moving: Profile,
  x: number,
  z: number,
  fixed: Standing,
  visit: (theirs: number, mine: number) => void
): void {
  const offsetX = x + moving.anchorX - fixed.position.x - fixed.profile.anchorX;
  const offsetZ = z + moving.anchorZ - fixed.position.z - fixed.profile.anchorZ;

  for (let col = 0; col < moving.cols; col += 1) {
    const cols = overlap(offsetX + col * COLUMN, fixed.profile.cols);
    if (!cols) {
      continue;
    }
    for (let row = 0; row < moving.rows; row += 1) {
      const rows = overlap(offsetZ + row * COLUMN, fixed.profile.rows);
      if (!rows) {
        continue;
      }
      const mine = row * moving.cols + col;
      for (let their = cols.from; their <= cols.to; their += 1) {
        for (let theirRow = rows.from; theirRow <= rows.to; theirRow += 1) {
          visit(theirRow * fixed.profile.cols + their, mine);
        }
      }
    }
  }
}

function overlap(
  offset: number,
  count: number
): { from: number; to: number } | null {
  // A column ends where the next begins, so a shared edge is not an overlap.
  const from = Math.max(Math.floor(offset / COLUMN), 0);
  const to = Math.min(Math.ceil((offset + COLUMN) / COLUMN) - 1, count - 1);
  return from > to ? null : { from, to };
}

/** The box a standing part fills, rounded out to its columns. */
export function boundsOf(standing: Standing, target: Box3): Box3 {
  const { profile, position } = standing;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let at = 0; at < profile.bottom.length; at += 1) {
    low = Math.min(low, profile.bottom[at]);
    high = Math.max(high, profile.top[at]);
  }
  if (!Number.isFinite(low)) {
    return target.makeEmpty();
  }
  target.min.set(
    position.x + profile.anchorX,
    position.y + low,
    position.z + profile.anchorZ
  );
  target.max.set(
    position.x + profile.anchorX + profile.cols * COLUMN,
    position.y + high,
    position.z + profile.anchorZ + profile.rows * COLUMN
  );
  return target;
}

/** A profile, and where it sits relative to whatever it is grouped with. */
export interface Member {
  offset: Vector3;
  profile: Profile;
}

/**
 * One profile for a group of parts held together.
 *
 * A subassembly lifted in one piece has to answer the same two questions a
 * single part does, what is under it and would it fit here, and merging its
 * members into one column grid means it answers them at a single part's cost
 * rather than at every member's cost against everything still built.
 *
 * A member column that straddles two of the merged grid's is counted in both,
 * which is the same safe-side rounding `each` uses: a group is treated as
 * filling a shade more than it does rather than a shade less.
 */
export function mergeProfiles(members: Member[]): Profile {
  const [only] = members;
  if (members.length === 1 && only.offset.lengthSq() === 0) {
    return only.profile;
  }

  const bounds: Bounds = {
    maxX: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    minX: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
  };
  for (const { offset, profile } of members) {
    if (profile.cols === 0) {
      continue;
    }
    const x = offset.x + profile.anchorX;
    const z = offset.z + profile.anchorZ;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x + profile.cols * COLUMN);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxZ = Math.max(bounds.maxZ, z + profile.rows * COLUMN);
  }

  const merged = blank(bounds);
  if (merged.cols === 0) {
    return merged;
  }
  for (const member of members) {
    fold(merged, member);
  }
  return merged;
}

function fold(merged: Profile, { offset, profile }: Member): void {
  for (let row = 0; row < profile.rows; row += 1) {
    const rows = overlap(
      offset.z + profile.anchorZ + row * COLUMN - merged.anchorZ,
      merged.rows
    );
    if (!rows) {
      continue;
    }
    for (let col = 0; col < profile.cols; col += 1) {
      const at = row * profile.cols + col;
      if (!Number.isFinite(profile.bottom[at])) {
        continue;
      }
      const cols = overlap(
        offset.x + profile.anchorX + col * COLUMN - merged.anchorX,
        merged.cols
      );
      if (!cols) {
        continue;
      }
      for (let into = rows.from; into <= rows.to; into += 1) {
        for (let across = cols.from; across <= cols.to; across += 1) {
          const cell = into * merged.cols + across;
          merged.bottom[cell] = Math.min(
            merged.bottom[cell],
            offset.y + profile.bottom[at]
          );
          merged.top[cell] = Math.max(
            merged.top[cell],
            offset.y + profile.top[at]
          );
        }
      }
    }
  }
}
