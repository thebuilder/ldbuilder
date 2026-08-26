import type { BagInfo, Brick, StepInfo } from "./types";

/**
 * How many loose bricks we are willing to have on the floor at once. Real sets
 * solve the same problem with numbered bags, and for the same reason: a few
 * thousand parts in one pile is neither findable nor, for us, cheap to render.
 */
const TARGET_BRICKS_PER_BAG = 110;
const MAX_BRICKS_PER_BAG = 170;
const MODEL_EXTENSION = /\.(ldr|mpd|dat)$/i;

/**
 * Partition the build into bags of contiguous steps.
 *
 * Submodel boundaries are preferred, because a subassembly is a natural unit of
 * work, and a cut through the middle of one lands nowhere in particular. Where
 * a submodel is too big, or there are no submodels at all, the split falls back
 * to brick count. A model small enough to fit in one bag gets exactly one, and behaves
 * as though the mechanism were not there.
 */
export function computeBags(bricks: Brick[], steps: StepInfo[]): BagInfo[] {
  if (steps.length === 0) {
    return [];
  }

  const totalBricks = bricks.length;
  if (totalBricks <= MAX_BRICKS_PER_BAG) {
    return [singleBag(steps, bricks)];
  }

  const bags: BagInfo[] = [];
  let current: StepInfo[] = [];
  let currentBricks = 0;

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    bags.push(makeBag(bags.length, current, bricks));
    current = [];
    currentBricks = 0;
  };

  for (const step of steps) {
    const previous = current.at(-1);

    // A change of submodel is a good seam to cut on, but only once the bag has
    // enough in it to be called one.
    const submodelChanged =
      previous !== undefined &&
      previous.submodel !== step.submodel &&
      currentBricks > 0;
    const wouldOverflow =
      currentBricks + step.brickIds.length > MAX_BRICKS_PER_BAG;

    if (
      (submodelChanged && currentBricks >= TARGET_BRICKS_PER_BAG / 2) ||
      wouldOverflow
    ) {
      flush();
    }

    current.push(step);
    currentBricks += step.brickIds.length;

    if (currentBricks >= TARGET_BRICKS_PER_BAG) {
      flush();
    }
  }
  flush();

  bags.forEach((bag, index) => {
    bag.index = index;
    for (const stepIndex of range(bag.firstStep, bag.lastStep)) {
      const step = steps[stepIndex];
      if (step) {
        step.bag = index;
      }
    }
    for (const id of bag.brickIds) {
      const brick = bricks[id];
      if (brick) {
        brick.bag = index;
      }
    }
  });

  return bags;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) {
    out.push(i);
  }
  return out;
}

function singleBag(steps: StepInfo[], bricks: Brick[]): BagInfo {
  const bag = makeBag(0, steps, bricks);
  for (const step of steps) {
    step.bag = 0;
  }
  for (const brick of bricks) {
    brick.bag = 0;
  }
  return bag;
}

function makeBag(index: number, steps: StepInfo[], _bricks: Brick[]): BagInfo {
  const brickIds = steps.flatMap((step) => step.brickIds);
  const submodels = new Set(
    steps.map((step) => step.submodel).filter(Boolean) as string[]
  );

  // Name it only when the bag covers exactly one submodel. Otherwise leave it
  // blank rather than repeat the number the UI already shows.
  let label = "";
  if (submodels.size === 1) {
    const [path] = [...submodels];
    label = path.split("/").pop()?.replace(MODEL_EXTENSION, "") ?? "";
  }

  return {
    brickIds,
    firstStep: steps[0]?.index ?? 0,
    index,
    label,
    lastStep: steps.at(-1)?.index ?? 0,
  };
}
