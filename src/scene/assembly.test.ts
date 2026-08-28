import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { makeModel } from "@/test/fixtures";
import type { AssemblyState } from "./Assembly";
import { Assembly, type BuildFrame } from "./Assembly";

const watch = (over: Partial<AssemblyState> = {}): AssemblyState => ({
  explode: 0,
  hovered: [],
  isolate: null,
  mode: "assemble",
  pourProgress: 1,
  selected: null,
  slice: 1,
  step: 0,
  stepProgress: 0,
  ...over,
});

const frame = (over: Partial<BuildFrame> = {}): BuildFrame => ({
  activeBag: 0,
  flash: null,
  grabbed: null,
  hinted: [],
  hovered: null,
  placed: new Uint8Array(8),
  selected: null,
  ...over,
});

describe("Assembly in build mode", () => {
  it("poses a placed brick into the model and leaves a loose one to physics", () => {
    const model = makeModel({
      bricks: [{ at: [0, 24, 0] }, { at: [80, 24, 0] }],
    });
    const assembly = new Assembly(model);
    const placed = new Uint8Array(2);
    placed[0] = 1;

    // The live world would have put the loose brick somewhere of its own.
    model.bricks[1].object.position.set(999, 999, 999);
    assembly.updateBuild(frame({ placed }));

    expect(model.bricks[0].object.position.toArray()).toEqual([0, 24, 0]);
    expect(model.bricks[1].object.position.toArray()).toEqual([999, 999, 999]);
    assembly.dispose();
  });

  it("puts the open bag's bricks in the scene and holds the rest back", () => {
    const model = makeModel({ bricks: [{}, {}] });
    model.bricks[1].bag = 1;
    const assembly = new Assembly(model);

    assembly.updateBuild(frame());

    expect(model.bricks[0].object.parent).toBe(model.root);
    expect(model.bricks[1].object.parent).toBeNull();
    assembly.dispose();
  });

  it("swaps two bricks' objects without disturbing where they belong", () => {
    const model = makeModel({
      bricks: [{ at: [0, 24, 0] }, { at: [80, 24, 0] }],
    });
    const assembly = new Assembly(model);
    const carried = model.bricks[1].object;

    assembly.swapBrickObjects(0, 1);

    // Record 0 now owns the object that was being carried...
    expect(model.bricks[0].object).toBe(carried);
    // ...and it still belongs where record 0 belongs.
    expect(model.bricks[0].builtPose.position.toArray()).toEqual([0, 24, 0]);
    assembly.dispose();
  });

  it("restamps the brick id on the meshes it moved, so picking still works", () => {
    const model = makeModel({ bricks: [{}, {}] });
    const assembly = new Assembly(model);

    assembly.swapBrickObjects(0, 1);

    for (const brick of model.bricks) {
      for (const mesh of brick.meshes) {
        expect(mesh.userData.brickId).toBe(brick.id);
      }
    }
    assembly.dispose();
  });

  it("ignores a swap that is not one", () => {
    const model = makeModel({ bricks: [{}, {}] });
    const assembly = new Assembly(model);
    const before = model.bricks[0].object;

    assembly.swapBrickObjects(0, 0);
    assembly.swapBrickObjects(0, 99);

    expect(model.bricks[0].object).toBe(before);
    assembly.dispose();
  });

  it("lights up the brick in hand, the one under the pointer and the hints", () => {
    const model = makeModel({ bricks: [{}, {}, {}, {}] });
    const assembly = new Assembly(model);
    const original = model.bricks[0].meshes[0].material;

    assembly.updateBuild(
      frame({ grabbed: 0, hinted: [2], hovered: 1, selected: 3 })
    );

    for (const id of [0, 1, 2, 3]) {
      expect(model.bricks[id].meshes[0].material).not.toBe(original);
    }
    assembly.dispose();
  });

  it("leaves everything else in its own colour", () => {
    const model = makeModel({ bricks: [{}, {}] });
    const assembly = new Assembly(model);
    const original = model.bricks[1].meshes[0].material;

    assembly.updateBuild(frame({ grabbed: 0 }));

    expect(model.bricks[1].meshes[0].material).toBe(original);
    assembly.dispose();
  });

  it("flashes the brick that has just gone in", () => {
    const model = makeModel({ bricks: [{}, {}] });
    const assembly = new Assembly(model);
    const original = model.bricks[0].meshes[0].material;

    assembly.updateBuild(frame({ flash: 0 }));

    expect(model.bricks[0].meshes[0].material).not.toBe(original);
    assembly.dispose();
  });

  it("hands every brick its own materials back when it is torn down", () => {
    const model = makeModel({ bricks: [{}] });
    const original = model.bricks[0].meshes[0].material;
    const assembly = new Assembly(model);
    assembly.updateBuild(frame({ grabbed: 0 }));

    assembly.dispose();

    expect(model.bricks[0].meshes[0].material).toBe(original);
  });

  it("reports the floor, the release height and the middle of the model", () => {
    const model = makeModel({
      bricks: [{ at: [0, 24, 0] }, { at: [0, 240, 0] }],
    });
    const assembly = new Assembly(model);

    expect(assembly.floor).toBe(model.bounds.min.y);
    expect(assembly.dropHeight).toBeGreaterThan(model.bounds.max.y);
    expect(assembly.centre.y).toBeCloseTo(
      (model.bounds.min.y + model.bounds.max.y) / 2,
      5
    );
    assembly.dispose();
  });
});

describe("Assembly in watch mode", () => {
  it("leaves a brick still on the floor where the pour put it", () => {
    const model = makeModel({ bricks: [{ at: [0, 24, 0] }] });
    const assembly = new Assembly(model);

    assembly.update(watch());

    expect(model.bricks[0].object.position.x).toBeCloseTo(
      model.bricks[0].floorPose.position.x,
      5
    );
    assembly.dispose();
  });

  it("puts a brick in the model once its step is done", () => {
    const model = makeModel({
      bricks: [{ at: [0, 24, 0] }, { at: [80, 24, 0] }],
    });
    const assembly = new Assembly(model);

    assembly.update(watch({ step: 1 }));

    expect(model.bricks[0].object.position.toArray()).toEqual([0, 24, 0]);
    assembly.dispose();
  });

  it("pushes the finished model apart when it is exploded", () => {
    const model = makeModel({
      bricks: [{ at: [-80, 24, 0] }, { at: [80, 24, 0] }],
    });
    const assembly = new Assembly(model);

    assembly.update(watch({ explode: 1, mode: "explode", step: 1 }));

    // Each brick moves away from the middle, so they end up further apart.
    const gap = Math.abs(
      model.bricks[0].object.position.x - model.bricks[1].object.position.x
    );
    expect(gap).toBeGreaterThan(160);
    assembly.dispose();
  });

  it("hides what a slice cuts away", () => {
    const model = makeModel({
      bricks: [
        { at: [0, 24, 0], step: 0 },
        { at: [0, 240, 0], step: 1 },
      ],
    });
    const assembly = new Assembly(model);
    const original = model.bricks[1].meshes[0].material;

    assembly.update(watch({ mode: "slice", slice: 0.1, step: 2 }));

    expect(model.bricks[0].object.visible).toBe(true);
    expect(model.bricks[1].object.visible).toBe(false);
    expect(model.bricks[1].meshes[0].material).toBe(original);
    assembly.dispose();
  });

  it("lights the selected brick and the one under the pointer", () => {
    const model = makeModel({
      bricks: [{ step: 0 }, { step: 0 }, { step: 0 }],
    });
    const assembly = new Assembly(model);
    const original = model.bricks[0].meshes[0].material;

    assembly.update(watch({ hovered: [1], selected: 0, step: 1 }));

    expect(model.bricks[0].meshes[0].material).not.toBe(original);
    expect(model.bricks[1].meshes[0].material).not.toBe(original);
    expect(model.bricks[2].meshes[0].material).toBe(original);
    assembly.dispose();
  });

  it("dims everything outside the submodel being isolated", () => {
    const model = makeModel({ bricks: [{ step: 0 }, { step: 0 }] });
    model.bricks[0].submodelPath = ["tower.ldr"];
    const assembly = new Assembly(model);
    const original = model.bricks[1].meshes[0].material;

    assembly.update(watch({ isolate: "tower.ldr", step: 1 }));

    expect(model.bricks[0].meshes[0].material).toBe(original);
    expect(model.bricks[1].meshes[0].material).not.toBe(original);
    assembly.dispose();
  });

  it("does nothing at all for a model with no bricks", () => {
    const model = makeModel({ bricks: [] });
    const assembly = new Assembly(model);

    expect(() => assembly.update(watch())).not.toThrow();
    assembly.dispose();
  });
});

describe("Assembly staging a subassembly", () => {
  /**
   * Three bricks in a subassembly built over steps 0-1 and fitted at step 1,
   * then one brick of the parent model at step 2. The offset is along x so the
   * assertions can read it off one axis.
   */
  const staged = () =>
    makeModel({
      bricks: [
        { at: [0, 24, 0], step: 0, subassembly: 0 },
        { at: [0, 48, 0], step: 1, subassembly: 0 },
        { at: [0, 72, 0], step: 1, subassembly: 0 },
        { at: [200, 24, 0], step: 2 },
      ],
      subassemblies: [
        {
          brickIds: [0, 1, 2],
          installStep: 1,
          label: "tower",
          offset: new Vector3(500, 0, 0),
        },
      ],
    });

  it("builds it off to the side rather than where it belongs", () => {
    const model = staged();
    const assembly = new Assembly(model);

    // Step 0 is done, so brick 0 is placed; the subassembly does not go on
    // until step 1, so that placement is out at the staging offset.
    assembly.update(watch({ step: 1 }));

    expect(model.bricks[0].object.position.x).toBeCloseTo(500, 5);
    expect(model.bricks[0].object.position.y).toBeCloseTo(24, 5);
    assembly.dispose();
  });

  it("finishes it before it starts moving it", () => {
    const model = staged();
    const assembly = new Assembly(model);

    // Half way through the install step: the last bricks have gone on, and the
    // move has not started.
    assembly.update(watch({ step: 1, stepProgress: 0.5 }));

    expect(model.bricks[0].object.position.x).toBeCloseTo(500, 5);
    expect(model.bricks[2].object.position.x).toBeCloseTo(500, 5);
    assembly.dispose();
  });

  it("moves the whole subassembly together, not brick by brick", () => {
    const model = staged();
    const assembly = new Assembly(model);

    assembly.update(watch({ step: 1, stepProgress: 0.75 }));

    const [a, b, c] = model.bricks;
    // Part way in, and all three the same distance along: they travel as one.
    expect(a.object.position.x).toBeGreaterThan(0);
    expect(a.object.position.x).toBeLessThan(500);
    expect(b.object.position.x).toBeCloseTo(a.object.position.x, 5);
    expect(c.object.position.x).toBeCloseTo(a.object.position.x, 5);
    assembly.dispose();
  });

  it("has it on the model once the install step is behind it", () => {
    const model = staged();
    const assembly = new Assembly(model);

    assembly.update(watch({ step: 2 }));

    for (const id of [0, 1, 2]) {
      expect(model.bricks[id].object.position.x).toBeCloseTo(0, 5);
    }
    assembly.dispose();
  });

  it("keeps an early brick waiting for the rest of its subassembly", () => {
    // Four bricks over steps 0-2, so at the end of step 0 there is a brick that
    // is placed, in a subassembly that is nowhere near going on yet.
    const model = makeModel({
      bricks: [
        { at: [0, 24, 0], step: 0, subassembly: 0 },
        { at: [0, 48, 0], step: 1, subassembly: 0 },
        { at: [0, 72, 0], step: 2, subassembly: 0 },
        { at: [0, 96, 0], step: 2, subassembly: 0 },
        { at: [200, 24, 0], step: 3 },
      ],
      subassemblies: [
        {
          brickIds: [0, 1, 2, 3],
          installStep: 2,
          label: "tower",
          offset: new Vector3(500, 0, 0),
        },
      ],
    });
    const assembly = new Assembly(model);

    assembly.update(watch({ step: 1 }));

    // Its own step is behind it, but the subassembly's is not, so it waits out
    // at the staging offset rather than going on alone.
    expect(model.bricks[0].object.position.x).toBeCloseTo(500, 5);
    assembly.dispose();
  });

  it("leaves a brick outside any subassembly on the ordinary path", () => {
    const model = staged();
    const assembly = new Assembly(model);

    assembly.update(watch({ step: 3 }));

    expect(model.bricks[3].object.position.toArray()).toEqual([200, 24, 0]);
    assembly.dispose();
  });

  it("flies a staged brick to the staging area, not through the model", () => {
    const model = staged();
    const assembly = new Assembly(model);

    // Mid-flight on its own step, so it is between the floor and where that
    // step leaves it, which is out at the offset.
    assembly.update(watch({ step: 0, stepProgress: 0.99 }));

    const { x } = model.bricks[0].object.position;
    const floorX = model.bricks[0].floorPose.position.x;
    expect(x).toBeGreaterThan(Math.min(floorX, 500) - 1);
    expect(x).toBeCloseTo(500, 0);
    assembly.dispose();
  });
});
