import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { makeBrick } from "@/test/fixtures";
import type { InstanceNode } from "./flatten";
import { computeSubassemblies } from "./subassemblies";
import type { Brick } from "./types";

const BRICK_HEIGHT = 24;

/**
 * A model of `total` bricks, one per step, all of them well clear of the
 * ground.
 *
 * The total matters: a subassembly is capped at a quarter of the model, so a
 * model has to be a few times the size of the group under test for that group
 * to be eligible at all. Everything here is 200 bricks so the cap never binds
 * by accident.
 */
const MODEL_BRICKS = 200;

function makeBricks(total = MODEL_BRICKS): Brick[] {
  return Array.from({ length: total }, (_, id) => {
    const y = 100;
    const brick = makeBrick(id, { at: [0, y, 0], step: id });
    brick.center.set(0, y - BRICK_HEIGHT / 2, 0);
    brick.minY = y - BRICK_HEIGHT;
    brick.radius = 10;
    return brick;
  });
}

/** Ids `from` up to but not including `to`. */
const ids = (from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, i) => i + from);

function occurrence(
  name: string,
  brickIds: number[],
  parent = -1
): InstanceNode {
  return { brickIds, children: [], name, parent };
}

const bounds = new Box3(new Vector3(-200, 0, -200), new Vector3(200, 400, 200));

describe("computeSubassemblies", () => {
  it("stages a submodel big enough to be a subassembly", () => {
    const bricks = makeBricks();
    const instances = [occurrence("tower.ldr", ids(0, 8))];

    const subs = computeSubassemblies(bricks, instances, bounds);

    expect(subs).toHaveLength(1);
    expect(subs[0].label).toBe("tower");
    expect(subs[0].brickIds).toEqual(ids(0, 8));
    expect(bricks.slice(0, 8).every((b) => b.subassembly === 0)).toBe(true);
    // Everything outside it is still built straight into place.
    expect(bricks.slice(8).every((b) => b.subassembly === -1)).toBe(true);
  });

  it("leaves a model with no submodels alone", () => {
    const bricks = makeBricks();

    expect(computeSubassemblies(bricks, [], bounds)).toEqual([]);
    expect(bricks.every((b) => b.subassembly === -1)).toBe(true);
  });

  it("skips a submodel too small to read as a unit", () => {
    const bricks = makeBricks();
    const instances = [occurrence("clip.ldr", ids(0, 4))];

    expect(computeSubassemblies(bricks, instances, bounds)).toEqual([]);
  });

  it("skips a submodel too big to be anything but a section of the model", () => {
    const bricks = makeBricks();
    const instances = [occurrence("stage.ldr", ids(0, 41))];

    expect(computeSubassemblies(bricks, instances, bounds)).toEqual([]);
  });

  it("skips a submodel that is a quarter of a small model", () => {
    // Twelve bricks of a thirty-brick model: under the absolute cap, over the
    // share of the model one subassembly is allowed to be.
    const bricks = makeBricks(30);
    const instances = [occurrence("half.ldr", ids(0, 12))];

    expect(computeSubassemblies(bricks, instances, bounds)).toEqual([]);
  });

  it("skips a submodel placed all in one step, which is not watched being built", () => {
    const bricks = makeBricks();
    for (const id of ids(0, 8)) {
      bricks[id].step = 3;
    }
    const instances = [occurrence("badge.ldr", ids(0, 8))];

    expect(computeSubassemblies(bricks, instances, bounds)).toEqual([]);
  });

  it("skips a submodel standing on the ground, which is a foundation", () => {
    const bricks = makeBricks();
    // One brick reaching the floor is enough: the group already stands up where
    // it is, so there is nothing to lift into place.
    bricks[3].minY = bounds.min.y;
    const instances = [occurrence("base.ldr", ids(0, 8))];

    expect(computeSubassemblies(bricks, instances, bounds)).toEqual([]);
  });

  it("descends past a submodel too big, and takes the assemblies inside it", () => {
    const bricks = makeBricks();
    const instances: InstanceNode[] = [
      { brickIds: [], children: [1, 2], name: "stage.ldr", parent: -1 },
      occurrence("engine.ldr", ids(0, 30), 0),
      occurrence("nozzle.ldr", ids(30, 60), 0),
    ];

    const subs = computeSubassemblies(bricks, instances, bounds);

    expect(subs.map((s) => s.label)).toEqual(["engine", "nozzle"]);
    expect(bricks[0].subassembly).toBe(0);
    expect(bricks[30].subassembly).toBe(1);
  });

  it("keeps a brick in one subassembly, taking the outermost that qualifies", () => {
    const bricks = makeBricks();
    const instances: InstanceNode[] = [
      { brickIds: ids(0, 12), children: [1], name: "hatch.ldr", parent: -1 },
      occurrence("hinge.ldr", ids(12, 20), 0),
    ];

    const subs = computeSubassemblies(bricks, instances, bounds);

    expect(subs).toHaveLength(1);
    expect(subs[0].label).toBe("hatch");
    // The nested occurrence comes along rather than staging on its own.
    expect(subs[0].brickIds).toEqual(ids(0, 20));
    expect(bricks.slice(0, 20).every((b) => b.subassembly === 0)).toBe(true);
  });

  it("installs on the last step any of its bricks is placed in", () => {
    const bricks = makeBricks();
    const instances = [occurrence("tower.ldr", ids(0, 8))];

    const [sub] = computeSubassemblies(bricks, instances, bounds);

    expect(sub.installStep).toBe(7);
  });

  it("moves it clear of the model, the short way out", () => {
    const bricks = makeBricks();
    const instances = [occurrence("tower.ldr", ids(0, 8))];

    // The model is 400 wide and 400 deep but only 400 tall, and the bricks sit
    // at the middle of it, so a horizontal escape is the cheapest way out.
    const [sub] = computeSubassemblies(bricks, instances, bounds);
    const { offset } = sub;

    expect(offset.y).toBe(0);

    // Displaced by that much, the subassembly no longer overlaps the model.
    const moved = new Box3(
      new Vector3(-10, 66, -10).add(offset),
      new Vector3(10, 110, 10).add(offset)
    );
    expect(moved.intersectsBox(bounds)).toBe(false);
  });

  it("lifts a subassembly out of a model too wide to leave sideways", () => {
    const bricks = makeBricks();
    const flat = new Box3(
      new Vector3(-2000, 0, -2000),
      new Vector3(2000, 120, 2000)
    );
    const instances = [occurrence("roof.ldr", ids(0, 8))];

    const [sub] = computeSubassemblies(bricks, instances, flat);

    expect(sub.offset.y).toBeGreaterThan(0);
    expect(sub.offset.x).toBe(0);
    expect(sub.offset.z).toBe(0);
  });
});
