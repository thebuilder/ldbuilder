import { describe, expect, it } from "vitest";
import { computeSteps } from "./steps";
import type { Brick } from "./types";

/**
 * A brick with only the fields computeSteps reads.
 *
 * The real type carries three.js meshes, bounding boxes and poses, none of
 * which the build order depends on. Constructing them would test the renderer,
 * not this.
 */
function brick(
  id: number,
  { minY = 0, step = 0, submodelPath = [] as string[] } = {}
): Brick {
  return { id, minY, step, submodelPath } as unknown as Brick;
}

/** The step index each brick ended up in, in brick id order. */
const assignments = (bricks: Brick[]) => bricks.map((b) => b.step);

describe("computeSteps with authored steps", () => {
  it("keeps the file's own build order", () => {
    const bricks = [
      brick(0, { step: 0 }),
      brick(1, { step: 1 }),
      brick(2, { step: 1 }),
    ];

    const { steps, synthetic } = computeSteps(bricks, 2);

    expect(synthetic).toBe(false);
    expect(steps.map((s) => s.brickIds)).toEqual([[0], [1, 2]]);
  });

  it("compacts sparse step numbers, which interleaved submodels produce", () => {
    const bricks = [
      brick(0, { step: 0 }),
      brick(1, { step: 5 }),
      brick(2, { step: 9 }),
    ];

    const { steps } = computeSteps(bricks, 10);

    expect(steps).toHaveLength(3);
    expect(assignments(bricks)).toEqual([0, 1, 2]);
  });

  it("drops steps no brick lands in, so the timeline has no dead positions", () => {
    // A `0 STEP` that only advanced a submodel leaves an empty step behind.
    const bricks = [brick(0, { step: 0 }), brick(1, { step: 2 })];

    const { steps } = computeSteps(bricks, 3);

    expect(steps).toHaveLength(2);
    expect(steps.every((s) => s.brickIds.length > 0)).toBe(true);
  });

  it("labels a step with its submodel when every brick agrees", () => {
    const bricks = [
      brick(0, { step: 0, submodelPath: ["tower.ldr"] }),
      brick(1, { step: 0, submodelPath: ["tower.ldr"] }),
    ];

    const { steps } = computeSteps(bricks, 2);

    expect(steps[0].submodel).toBe("tower.ldr");
  });

  it("leaves a step unlabelled when its bricks span submodels", () => {
    const bricks = [
      brick(0, { step: 0, submodelPath: ["tower.ldr"] }),
      brick(1, { step: 0, submodelPath: ["span.ldr"] }),
      brick(2, { step: 1, submodelPath: ["tower.ldr"] }),
    ];

    const { steps } = computeSteps(bricks, 2);

    expect(steps[0].submodel).toBeNull();
  });
});

describe("computeSteps without authored steps", () => {
  it("infers an order rather than showing everything at once", () => {
    // Most sample models carry no `0 STEP` at all, so this path is not an edge
    // case: without it the headline feature degrades to a single reveal.
    const bricks = Array.from({ length: 40 }, (_, i) => brick(i, { minY: i }));

    const { steps, synthetic } = computeSteps(bricks, 1);

    expect(synthetic).toBe(true);
    expect(steps.length).toBeGreaterThan(1);
  });

  it("builds bottom to top", () => {
    // Ids run opposite to height, so an order that ignored minY would show.
    const bricks = [
      brick(0, { minY: 300 }),
      brick(1, { minY: 200 }),
      brick(2, { minY: 100 }),
      brick(3, { minY: 0 }),
    ];

    computeSteps(bricks, 1);

    expect(bricks[3].step).toBeLessThan(bricks[0].step);
  });

  it("keeps a submodel's bricks together instead of interleaving them", () => {
    const bricks = [
      brick(0, { minY: 0, submodelPath: [] }),
      brick(1, { minY: 100, submodelPath: [] }),
      brick(2, { minY: 50, submodelPath: ["tower.ldr"] }),
      brick(3, { minY: 60, submodelPath: ["tower.ldr"] }),
    ];

    computeSteps(bricks, 1);

    const tower = [bricks[2].step, bricks[3].step];
    const main = [bricks[0].step, bricks[1].step];
    expect(Math.min(...tower)).toBeGreaterThanOrEqual(Math.max(...main));
  });

  it("does not go below four steps for a small model", () => {
    const bricks = Array.from({ length: 6 }, (_, i) => brick(i, { minY: i }));

    const { steps } = computeSteps(bricks, 1);

    expect(steps.length).toBeGreaterThanOrEqual(4);
  });

  it("does not go past forty steps for a large one", () => {
    const bricks = Array.from({ length: 5000 }, (_, i) =>
      brick(i, { minY: i })
    );

    const { steps } = computeSteps(bricks, 1);

    expect(steps.length).toBeLessThanOrEqual(40);
  });

  it("treats a single authored step as no build order at all", () => {
    const bricks = Array.from({ length: 20 }, (_, i) => brick(i, { minY: i }));

    const { synthetic } = computeSteps(bricks, 1);

    expect(synthetic).toBe(true);
  });

  it("handles an empty model without throwing", () => {
    expect(() => computeSteps([], 1)).not.toThrow();
  });
});
