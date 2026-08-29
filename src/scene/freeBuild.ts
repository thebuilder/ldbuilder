import { Matrix4, Quaternion, Vector3 } from "three";
import {
  contactHeight,
  lowestOf,
  type Profile,
  profilesCollide,
  type Standing,
} from "./heightField";

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

export const STUD = 20;
export const PLATE = 8;

const TOUCH_EPSILON = 0.5;

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

const LDRAW_TO_YUP = new Matrix4().makeRotationX(Math.PI);

export interface Placement {
  colorCode: number;
  file: string;
  id: number;
  position: Vector3;
  tip: number;
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

export interface SnapResult {
  blocked: boolean;
  position: Vector3;
  restingOn: number | null;
}

export interface SnapInput {
  built: Map<number, Standing>;
  center: Vector3;
  desired: Vector3;
  floorY: number;
  half: Vector3;
  nudge: { x: number; y: number; z: number };
  profile: Profile;
}

interface Level {
  on: number | null;
  y: number;
}

/**
 * Snap a carried part: onto the grid in X and Z, and down onto whatever is
 * under it in Y.
 *
 * Resting rather than rounding in Y is what makes this work for parts that are
 * not a whole number of plates tall. A slope's top is where its top is, and a
 * brick placed on it should sit there rather than at the nearest multiple of 8.
 */
export function snapPlacement(input: SnapInput, target: Vector3): SnapResult {
  const { desired, half, center, built, floorY, nudge, profile } = input;

  const x =
    snapCenterToGrid(desired.x + center.x, half.x * 2) +
    nudge.x * STUD -
    center.x;
  const z =
    snapCenterToGrid(desired.z + center.z, half.z * 2) +
    nudge.z * STUD -
    center.z;

  const lowest = lowestOf(profile);
  const levels = levelsUnder(profile, x, z, built, floorY - lowest);

  levels.sort(
    (a, b) =>
      Math.abs(a.y + lowest - desired.y) - Math.abs(b.y + lowest - desired.y)
  );

  const search = nudge.y === 0 ? levels : levels.slice(0, 1);
  const [nearest] = levels;
  let chosen = nearest;
  let blocked = true;

  for (const level of search) {
    target.set(x, level.y + nudge.y * PLATE, z);
    if (!obstructed(profile, target, built)) {
      chosen = level;
      blocked = false;
      break;
    }
  }
  if (blocked) {
    target.set(x, chosen.y + nudge.y * PLATE, z);
  }

  return { blocked, position: target, restingOn: chosen.on };
}

/**
 * Every height the part could come to rest at over this footprint.
 *
 * One per distinct height, because a wall of bricks all at the same level is
 * one place to put something down rather than twenty. Anything that would put
 * the part through the floor is not a place to put it down at all.
 */
function levelsUnder(
  profile: Profile,
  x: number,
  z: number,
  built: Map<number, Standing>,
  floorLevel: number
): Level[] {
  const levels: Level[] = [{ on: null, y: floorLevel }];

  for (const [id, standing] of built) {
    const y = contactHeight(profile, x, z, standing);
    if (y === null || y < floorLevel - TOUCH_EPSILON) {
      continue;
    }
    if (levels.some((level) => Math.abs(level.y - y) < TOUCH_EPSILON)) {
      continue;
    }
    levels.push({ on: id, y });
  }
  return levels;
}

function obstructed(
  profile: Profile,
  position: Vector3,
  built: Map<number, Standing>
): boolean {
  for (const [, standing] of built) {
    if (profilesCollide(profile, position, standing)) {
      return true;
    }
  }
  return false;
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

  // The user owns this model; add no author or license on their behalf.
  const lines = [
    `0 ${title}`,
    "0 Name: untitled.ldr",
    "0 !LDRAW_ORG Unofficial_Model",
    "",
  ];

  for (const placement of placements) {
    orientation(placement.yaw, placement.tip, quaternion);
    matrix.compose(placement.position, quaternion, scale);
    matrix.premultiply(LDRAW_TO_YUP);

    const e = matrix.elements;
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

function round(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
