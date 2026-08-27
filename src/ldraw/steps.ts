import type { Brick, StepInfo } from "./types";

/** Sample models often have no `0 STEP` metas at all; these bound the inferred count. */
const MIN_SYNTHETIC_STEPS = 4;
const MAX_SYNTHETIC_STEPS = 40;

export interface StepResult {
  steps: StepInfo[];
  synthetic: boolean;
}

/**
 * Derive the build order.
 *
 * When the file carries real `0 STEP` metas we use them verbatim. When it does
 * not, we infer an order rather than dropping the whole model into a single
 * step, because "everything appears at once" is not a build. Inferred order is
 * flagged so the UI can say so instead of implying the set ships this way.
 */
export function computeSteps(
  bricks: Brick[],
  numBuildingSteps: number
): StepResult {
  const authored =
    numBuildingSteps > 1 && new Set(bricks.map((b) => b.step)).size > 1;

  if (authored) {
    // Step numbers can be sparse if a submodel's steps interleave, so compact
    // them to a contiguous 0..n-1 range while preserving order.
    const used = [...new Set(bricks.map((b) => b.step))].sort((a, b) => a - b);
    const remap = new Map(used.map((step, index) => [step, index]));
    for (const brick of bricks) {
      brick.step = remap.get(brick.step) ?? 0;
    }
    return { steps: groupIntoSteps(bricks, used.length), synthetic: false };
  }

  synthesize(bricks);
  const count = new Set(bricks.map((b) => b.step)).size;
  return { steps: groupIntoSteps(bricks, count), synthetic: true };
}

/**
 * Infer a build order: bottom to top, keeping each submodel together so the
 * result still builds one subassembly at a time.
 */
function synthesize(bricks: Brick[]): void {
  if (bricks.length === 0) {
    return;
  }

  const target = Math.min(
    MAX_SYNTHETIC_STEPS,
    Math.max(MIN_SYNTHETIC_STEPS, Math.round(Math.sqrt(bricks.length)))
  );

  // Submodels are ordered by how low they sit, then their bricks by height
  // within the submodel. Sorting by submodel first is what keeps a subassembly
  // from being interleaved with the rest of the model.
  const groupLowest = new Map<string, number>();
  for (const brick of bricks) {
    const key = brick.submodelPath.join("/");
    const current = groupLowest.get(key);
    if (current === undefined || brick.minY < current) {
      groupLowest.set(key, brick.minY);
    }
  }

  const ordered = [...bricks].sort((a, b) => {
    const aKey = a.submodelPath.join("/");
    const bKey = b.submodelPath.join("/");
    if (aKey !== bKey) {
      const diff = (groupLowest.get(aKey) ?? 0) - (groupLowest.get(bKey) ?? 0);
      if (diff !== 0) {
        return diff;
      }
      return aKey.localeCompare(bKey);
    }
    return a.minY - b.minY || a.id - b.id;
  });

  // Spread across `target` steps rather than chunking by a computed size.
  // Chunking rounds the size up and so can undershoot: six bricks at a target
  // of four gave three steps, below the minimum this is supposed to hold to.
  ordered.forEach((brick, index) => {
    brick.step = Math.floor((index * target) / ordered.length);
  });
}

function groupIntoSteps(bricks: Brick[], count: number): StepInfo[] {
  const steps: StepInfo[] = Array.from(
    { length: Math.max(count, 1) },
    (_, index) => ({
      bag: 0,
      brickIds: [],
      index,
      submodel: null,
    })
  );

  for (const brick of bricks) {
    const step = steps[brick.step];
    if (step) {
      step.brickIds.push(brick.id);
    }
  }

  // Label each step with its submodel when every brick in it agrees.
  for (const step of steps) {
    const paths = new Set(
      step.brickIds.map((id) => bricks[id]?.submodelPath.join("/") ?? "")
    );
    step.submodel = paths.size === 1 ? [...paths][0] || null : null;
  }

  // A model can legitimately produce empty steps (a `0 STEP` that only advanced
  // a submodel). Dropping them keeps the timeline from having dead positions.
  const populated = steps.filter((step) => step.brickIds.length > 0);
  populated.forEach((step, index) => {
    step.index = index;
    for (const id of step.brickIds) {
      const brick = bricks[id];
      if (brick) {
        brick.step = index;
      }
    }
  });

  return populated;
}
