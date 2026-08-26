import { Box3, Matrix4, Quaternion, Vector3 } from "three";

/**
 * Where a brick may go, and what a build of them looks like written down.
 *
 * Real LEGO connects stud to tube, and knowing exactly where a given part's
 * studs are means connectivity data the LDraw library does not carry; LDCad
 * keeps a whole parallel set of "shadow" files for it. What the library does
 * guarantee is the grid the whole system is cut to: 20 units between studs, 8
 * for the height of a plate, three plates to a brick. Snapping to that grid and
 * resting each part on whatever is under it gets stud-accurate building out of
 * geometry that is already there, and is wrong only for the parts that are
 * themselves off-grid, which are the same parts a person places by eye anyway.
 */

/** LDraw units between two studs. */
export const STUD = 20;
/** Height of one plate. A brick is three of them. */
export const PLATE = 8;

/** Overlaps under this are two parts touching, not two parts colliding. */
const TOUCH_EPSILON = 0.5;

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

/** The turn `flattenModel` bakes in so the rest of the app can assume Y is up. */
const LDRAW_TO_YUP = new Matrix4().makeRotationX(Math.PI);

export interface Placement {
  colorCode: number;
  /** `3001.dat`. */
  file: string;
  id: number;
  /** The part's own origin, in the same space the models are built in. */
  position: Vector3;
  /** Quarter turns about X, applied before the yaw. Tips a part on its side. */
  tip: number;
  /** Quarter turns about Y. */
  yaw: number;
}

const scratchQuat = new Quaternion();
const scratchMatrix = new Matrix4();

/**
 * The orientation of a placed part.
 *
 * Rotations are held as quarter turns rather than as a quaternion because they
 * are only ever quarter turns: it keeps a save file small, keeps the arithmetic
 * exact however many times a part is turned, and means an exported model has
 * clean integers in it rather than 0.9999999.
 */
export function orientation(
  yaw: number,
  tip: number,
  target: Quaternion
): Quaternion {
  target.setFromAxisAngle(X_AXIS, Math.PI + (tip * Math.PI) / 2);
  return target.premultiply(
    scratchQuat.setFromAxisAngle(Y_AXIS, (yaw * Math.PI) / 2)
  );
}

/**
 * The half-extents of an axis-aligned box after it has been turned.
 *
 * This is the support of the rotated box along each axis: the same sum that an
 * AABB-of-an-OBB uses, and exact rather than approximate for the quarter turns
 * that are the only ones a part ever gets.
 */
export function rotatedHalfExtents(
  half: Vector3,
  quaternion: Quaternion,
  target: Vector3
): Vector3 {
  const m = scratchMatrix.makeRotationFromQuaternion(quaternion).elements;
  return target.set(
    Math.abs(m[0]) * half.x + Math.abs(m[4]) * half.y + Math.abs(m[8]) * half.z,
    Math.abs(m[1]) * half.x + Math.abs(m[5]) * half.y + Math.abs(m[9]) * half.z,
    Math.abs(m[2]) * half.x + Math.abs(m[6]) * half.y + Math.abs(m[10]) * half.z
  );
}

/** Where a part's box sits relative to its origin, once turned. */
export function rotatedCenter(
  localCenter: Vector3,
  quaternion: Quaternion,
  target: Vector3
): Vector3 {
  return target.copy(localCenter).applyQuaternion(quaternion);
}

/**
 * Put a footprint on the stud grid.
 *
 * A part's origin is at the middle of its footprint, so where the middle lands
 * depends on whether the footprint is an odd or an even number of studs across.
 * A 2 x 4 brick straddles grid lines; a 1 x 1 sits on the middle of a stud.
 * Rounding the middle without accounting for that puts every odd part half a
 * stud out, which is the one error that makes a build impossible to line up.
 */
export function snapCenterToGrid(center: number, extent: number): number {
  const studs = Math.max(Math.round(extent / STUD), 1);
  const offset = studs % 2 === 0 ? 0 : STUD / 2;
  return Math.round((center - offset) / STUD) * STUD + offset;
}

/** The world box a part would fill at this pose. */
export function boxFor(
  position: Vector3,
  half: Vector3,
  center: Vector3,
  target: Box3
): Box3 {
  target.min.set(
    position.x + center.x - half.x,
    position.y + center.y - half.y,
    position.z + center.z - half.z
  );
  target.max.set(
    position.x + center.x + half.x,
    position.y + center.y + half.y,
    position.z + center.z + half.z
  );
  return target;
}

export interface SnapResult {
  /** True when the part would pass through something already built. */
  blocked: boolean;
  /** The placement this would become. */
  position: Vector3;
  /** The part it is resting on, so the UI can point at it. Null on the floor. */
  restingOn: number | null;
}

export interface SnapInput {
  /** Boxes of everything already built, by placement id. */
  built: Map<number, Box3>;
  center: Vector3;
  /** Where the pointer is asking for the part to be, before snapping. */
  desired: Vector3;
  floorY: number;
  half: Vector3;
  /** Lattice steps the person has nudged it by, after snapping. */
  nudge: { x: number; y: number; z: number };
}

const scratchBox = new Box3();

/**
 * Snap a carried part: onto the grid in X and Z, and down onto whatever is
 * under it in Y.
 *
 * Resting rather than rounding in Y is what makes this work for parts that are
 * not a whole number of plates tall. A slope's top is where its top is, and a
 * brick placed on it should sit there rather than at the nearest multiple of 8.
 */
export function snapPlacement(input: SnapInput, target: Vector3): SnapResult {
  const { desired, half, center, built, floorY, nudge } = input;

  const centerX =
    snapCenterToGrid(desired.x + center.x, half.x * 2) + nudge.x * STUD;
  const centerZ =
    snapCenterToGrid(desired.z + center.z, half.z * 2) + nudge.z * STUD;

  // The footprint is known before the height is, which is what lets the height
  // be read off whatever that footprint covers.
  const minX = centerX - half.x + TOUCH_EPSILON;
  const maxX = centerX + half.x - TOUCH_EPSILON;
  const minZ = centerZ - half.z + TOUCH_EPSILON;
  const maxZ = centerZ + half.z - TOUCH_EPSILON;

  let rest = floorY;
  let restingOn: number | null = null;
  for (const [id, box] of built) {
    if (box.max.x <= minX || box.min.x >= maxX) {
      continue;
    }
    if (box.max.z <= minZ || box.min.z >= maxZ) {
      continue;
    }
    if (box.max.y > rest) {
      rest = box.max.y;
      restingOn = id;
    }
  }

  target.set(
    centerX - center.x,
    rest + half.y - center.y + nudge.y * PLATE,
    centerZ - center.z
  );

  // Resting leaves the two boxes sharing a face, which `overlaps` does not
  // count, so the part it is standing on needs no special case here.
  boxFor(target, half, center, scratchBox);
  let blocked = false;
  for (const [, box] of built) {
    if (overlaps(scratchBox, box)) {
      blocked = true;
      break;
    }
  }

  return { blocked, position: target, restingOn };
}

function overlaps(a: Box3, b: Box3): boolean {
  return (
    a.min.x < b.max.x - TOUCH_EPSILON &&
    a.max.x > b.min.x + TOUCH_EPSILON &&
    a.min.y < b.max.y - TOUCH_EPSILON &&
    a.max.y > b.min.y + TOUCH_EPSILON &&
    a.min.z < b.max.z - TOUCH_EPSILON &&
    a.max.z > b.min.z + TOUCH_EPSILON
  );
}

/**
 * Write a build out as an LDraw file.
 *
 * A `.ldr` is a list of type-1 lines, each one a colour, a 3x3 rotation, a
 * translation and a part to apply them to. The only thing to get right is the
 * frame: the app turned every part upright when it loaded it, so writing one
 * back out means turning it down again. `LDRAW_TO_YUP` is a half turn about X,
 * which is its own inverse, so the same matrix does both jobs.
 */
export function toLdrawFile(placements: Placement[], title: string): string {
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);

  const lines = [
    `0 ${title}`,
    "0 Name: untitled.ldr",
    "0 Author: LDraw Builder",
    "0 !LDRAW_ORG Unofficial_Model",
    "0 !LICENSE Redistributable under CCAL version 2.0 : see CAreadme.txt",
    "",
  ];

  for (const placement of placements) {
    orientation(placement.yaw, placement.tip, quaternion);
    matrix.compose(placement.position, quaternion, scale);
    matrix.premultiply(LDRAW_TO_YUP);

    const e = matrix.elements;
    // three stores column-major; LDraw writes the rotation out by rows.
    const numbers = [
      e[12],
      e[13],
      e[14],
      e[0],
      e[4],
      e[8],
      e[1],
      e[5],
      e[9],
      e[2],
      e[6],
      e[10],
    ].map(round);

    lines.push(
      `1 ${placement.colorCode} ${numbers.join(" ")} ${placement.file}`
    );
  }

  lines.push("0 STEP", "");
  return lines.join("\n");
}

/** Trim floating-point noise: every value here is a grid step or a 0, 1 or -1. */
function round(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
