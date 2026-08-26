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
