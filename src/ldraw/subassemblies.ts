import { Box3, Vector3 } from "three";
import type { InstanceNode } from "./flatten";
import type { Brick, Subassembly } from "./types";

/**
 * Below this a submodel is not worth building off to the side: a handful of
 * bricks going on together reads as a handful of bricks going on, and moving
 * them out and back is more motion than the grouping is worth explaining.
 *
 * Measured on the Saturn V, which nests forty-six three-brick submodels: at
 * three this stages eighty per cent of the set in units too small to register
 * as units, and at five it stages two thirds of it in units you could pick up.
 */
const MIN_BRICKS = 5;

/**
 * Above this a submodel is a section of the model rather than a subassembly.
 * Real sets nest whole stages inside one file (a Saturn V stage is 200 bricks
 * across 300 steps), and building that off to the side would mean building most
 * of the model somewhere it does not belong.
 */
const MAX_BRICKS = 40;

/** The same limit again for small models, where 40 bricks could be all of it. */
const MAX_FRACTION = 0.25;

/**
 * A submodel placed in one step is not watched being built, so staging it would
 * only add a slide. Two steps is the point at which you see it take shape.
 */
const MIN_STEPS = 2;

/** How far above the model's lowest point still counts as standing on it. */
const GROUND_TOLERANCE = 2;

/** Clearance between the model's silhouette and the staged subassembly. */
const STAGING_GAP = 0.06;

/** Floor under that gap, for models small enough that 6% is nothing. */
const MIN_STAGING_GAP = 24;

const MODEL_EXTENSION = /\.(ldr|mpd|dat)$/i;

/**
 * Decide which submodel occurrences are built off-model, and where.
 *
 * Walks the occurrence tree from the top and takes the outermost thing that
 * looks like a subassembly, so a stage full of small assemblies contributes the
 * small assemblies rather than the stage. Taking the outermost is also what
 * keeps a brick in exactly one subassembly, which means one displacement to
 * apply rather than a chain of them.
 *
 * Mutates `brick.subassembly` to point back at the returned list.
 */
export function computeSubassemblies(
  bricks: Brick[],
  instances: InstanceNode[],
  bounds: Box3
): Subassembly[] {
  if (bricks.length === 0 || instances.length === 0) {
    return [];
  }

  const members = collectMembers(instances);
  const cap = Math.min(MAX_BRICKS, Math.floor(bricks.length * MAX_FRACTION));
  const groundY = bounds.min.y;

  const chosen: number[] = [];
  const visit = (index: number): void => {
    if (qualifies(members[index], bricks, cap, groundY)) {
      chosen.push(index);
      return;
    }
    for (const child of instances[index].children) {
      visit(child);
    }
  };
  for (const [index, node] of instances.entries()) {
    if (node.parent === -1) {
      visit(index);
    }
  }

  const modelSize = new Vector3();
  bounds.getSize(modelSize);
  const gap = Math.max(
    MIN_STAGING_GAP,
    Math.max(modelSize.x, modelSize.z) * STAGING_GAP
  );

  const out: Subassembly[] = [];
  for (const index of chosen) {
    const brickIds = [...members[index]].sort(
      (a, b) => bricks[a].step - bricks[b].step || a - b
    );
    const box = boundsOf(brickIds, bricks);

    const subassembly: Subassembly = {
      brickIds,
      installStep: Math.max(...brickIds.map((id) => bricks[id].step)),
      label: instances[index].name.replace(MODEL_EXTENSION, ""),
      offset: stagingOffset(box, bounds, gap),
    };

    for (const id of brickIds) {
      bricks[id].subassembly = out.length;
    }
    out.push(subassembly);
  }

  return out;
}

/** Every brick under each occurrence, its nested occurrences included. */
function collectMembers(instances: InstanceNode[]): number[][] {
  const members: number[][] = instances.map((node) => [...node.brickIds]);
  // Children always come after their parent, so one pass backwards rolls the
  // whole tree up without recursing.
  for (let index = instances.length - 1; index >= 0; index -= 1) {
    const { parent } = instances[index];
    if (parent >= 0) {
      members[parent].push(...members[index]);
    }
  }
  return members;
}

function qualifies(
  brickIds: number[],
  bricks: Brick[],
  cap: number,
  groundY: number
): boolean {
  if (brickIds.length < MIN_BRICKS || brickIds.length > cap) {
    return false;
  }

  const steps = new Set<number>();
  for (const id of brickIds) {
    const brick = bricks[id];
    // Something resting on the ground is a foundation, not a subassembly. It is
    // already supported where it stands, and lifting it out to build it would
    // read as the one thing in the model that had to be moved into place.
    if (brick.minY <= groundY + GROUND_TOLERANCE) {
      return false;
    }
    steps.add(brick.step);
  }

  return steps.size >= MIN_STEPS;
}

/**
 * A box around the subassembly, from each brick's bounding sphere.
 *
 * Spheres over-estimate, which is the safe direction here: the result is used
 * to push the subassembly clear of the model, so erring large means erring
 * towards more clearance.
 */
function boundsOf(brickIds: number[], bricks: Brick[]): Box3 {
  const box = new Box3();
  const corner = new Vector3();
  for (const id of brickIds) {
    const brick = bricks[id];
    const radius = Math.max(brick.radius, 1);
    box.expandByPoint(corner.copy(brick.center).addScalar(radius));
    box.expandByPoint(corner.copy(brick.center).addScalar(-radius));
  }
  return box;
}

/**
 * The five ways out of a model: any horizontal direction, or straight up.
 *
 * Down is missing on purpose. The floor is where the loose bricks are poured,
 * and a subassembly built among them would be one more thing to pick out of the
 * pile rather than something obviously already assembled.
 */
interface Escape {
  axis: "x" | "y" | "z";
  sign: 1 | -1;
}

const ESCAPES: Escape[] = [
  { axis: "x", sign: 1 },
  { axis: "x", sign: -1 },
  { axis: "z", sign: 1 },
  { axis: "z", sign: -1 },
  { axis: "y", sign: 1 },
];

/**
 * Where to build the subassembly: out of the model the short way.
 *
 * The subassembly has to end up clear of the model, or it is being built inside
 * the thing it is waiting to go onto, which is the confusion this whole
 * mechanism exists to remove. Clear of it in *any one* direction is enough, so
 * this takes whichever direction costs the least travel. That is usually
 * sideways, and towards the near edge, so a piece belonging to one end of the
 * model does not cross the whole of it to get home. For a piece sitting over
 * the middle of a wide, flat model, up wins, and it is lowered into place.
 */
function stagingOffset(box: Box3, bounds: Box3, gap: number): Vector3 {
  const [first] = ESCAPES;
  let best = first;
  let distance = Number.POSITIVE_INFINITY;

  for (const candidate of ESCAPES) {
    const { axis, sign } = candidate;
    const clear =
      sign > 0
        ? bounds.max[axis] - box.min[axis]
        : box.max[axis] - bounds.min[axis];
    const travel = Math.max(clear + gap, gap);
    if (travel < distance) {
      distance = travel;
      best = candidate;
    }
  }

  const offset = new Vector3();
  offset[best.axis] = distance * best.sign;
  return offset;
}
