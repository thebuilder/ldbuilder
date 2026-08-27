import { describe, expect, it } from "vitest";
import { computeBags } from "./bags";
import type { Brick, StepInfo } from "./types";

/** Only the fields computeBags reads; see the note in steps.test.ts. */
const brick = (id: number, submodelPath: string[] = []): Brick =>
  ({ id, submodelPath }) as unknown as Brick;

const step = (
  index: number,
  brickIds: number[],
  submodel: string | null = null
): StepInfo => ({ bag: 0, brickIds, index, submodel });

/**
 * A build of `stepCount` steps with `perStep` bricks in each, optionally
 * grouped into submodels of `submodelEvery` steps.
 */
function build(stepCount: number, perStep: number, submodelEvery = 0) {
  const bricks: Brick[] = [];
  const steps: StepInfo[] = [];
  for (let s = 0; s < stepCount; s += 1) {
    const ids: number[] = [];
    const path =
      submodelEvery > 0 ? [`sub${Math.floor(s / submodelEvery)}.ldr`] : [];
    for (let b = 0; b < perStep; b += 1) {
      ids.push(bricks.length);
      bricks.push(brick(bricks.length, path));
    }
    // computeSteps labels each step with its submodel, and computeBags cuts on
    // that label, so the fixture has to carry it too.
    steps.push(step(s, ids, path[0] ?? null));
  }
  return { bricks, steps };
}

const bagSizes = (bags: { brickIds: number[] }[]) =>
  bags.map((bag) => bag.brickIds.length);

describe("computeBags", () => {
  it("returns nothing for a build with no steps", () => {
    expect(computeBags([], [])).toEqual([]);
  });

  it("puts a small model in a single bag, as if bags were not there", () => {
    const { bricks, steps } = build(4, 10);

    const bags = computeBags(bricks, steps);

    expect(bags).toHaveLength(1);
    expect(bags[0].firstStep).toBe(0);
    expect(bags[0].lastStep).toBe(3);
  });

  it("splits a large model into several bags", () => {
    const { bricks, steps } = build(100, 10);

    const bags = computeBags(bricks, steps);

    expect(bags.length).toBeGreaterThan(1);
  });

  it("keeps every bag near the target, so the floor stays readable", () => {
    const { bricks, steps } = build(100, 10);

    const bags = computeBags(bricks, steps);

    // The cap is what bounds how many loose bricks exist at once, which is the
    // whole reason bags exist. The last bag is whatever is left over.
    for (const size of bagSizes(bags).slice(0, -1)) {
      expect(size).toBeLessThanOrEqual(170);
    }
  });

  it("covers every brick exactly once", () => {
    const { bricks, steps } = build(100, 10);

    const bags = computeBags(bricks, steps);

    const covered = bags.flatMap((bag) => bag.brickIds);
    expect(covered).toHaveLength(bricks.length);
    expect(new Set(covered).size).toBe(bricks.length);
  });

  it("covers every step with no gaps and no overlap", () => {
    const { bricks, steps } = build(100, 10);

    const bags = computeBags(bricks, steps);

    expect(bags[0].firstStep).toBe(0);
    expect(bags.at(-1)?.lastStep).toBe(steps.length - 1);
    for (const [i, bag] of bags.slice(1).entries()) {
      expect(bag.firstStep).toBe(bags[i].lastStep + 1);
    }
  });

  it("numbers bags from zero in build order", () => {
    const { bricks, steps } = build(100, 10);

    const bags = computeBags(bricks, steps);

    expect(bags.map((bag) => bag.index)).toEqual(bags.map((_, index) => index));
  });

  it("cuts on submodel seams, because a subassembly is a unit of work", () => {
    // Ten submodels of ten steps, 100 bricks each: every boundary is a natural
    // place to stop, and a cut through the middle of one lands nowhere.
    const { bricks, steps } = build(100, 10, 10);

    const bags = computeBags(bricks, steps);

    for (const bag of bags) {
      const paths = new Set(
        bag.brickIds.map((id) => bricks[id].submodelPath.join("/"))
      );
      expect(paths.size).toBe(1);
    }
  });

  it("labels a bag that lines up with one submodel", () => {
    const { bricks, steps } = build(100, 10, 10);

    const bags = computeBags(bricks, steps);

    expect(bags[0].label).toContain("sub0");
  });

  it("still splits a submodel too big to be one bag", () => {
    const { bricks, steps } = build(100, 10, 100);

    const bags = computeBags(bricks, steps);

    expect(bags.length).toBeGreaterThan(1);
  });
});
