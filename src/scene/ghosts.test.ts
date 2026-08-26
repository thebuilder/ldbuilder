import { Group, type Mesh } from "three";
import { describe, expect, it } from "vitest";
import { makeModel } from "@/test/fixtures";
import { SlotGhosts } from "./ghosts";
import { isMesh } from "./three-guards";

const materialsIn = (root: Group) => {
  const out: Mesh["material"][] = [];
  root.traverse((child) => {
    if (isMesh(child)) {
      const { material } = child;
      out.push(material);
    }
  });
  return out;
};

describe("SlotGhosts", () => {
  it("draws one ghost per open slot, where the brick will go", () => {
    const parent = new Group();
    const model = makeModel({
      bricks: [{ at: [0, 24, 0] }, { at: [80, 24, 0] }],
    });
    const ghosts = new SlotGhosts(parent);

    ghosts.set([0, 1], model.bricks);

    expect(parent.children).toHaveLength(2);
    expect(parent.children[0].position.toArray()).toEqual([0, 24, 0]);
    expect(parent.children[1].position.toArray()).toEqual([80, 24, 0]);
    ghosts.dispose();
  });

  it("adds and removes only what changed", () => {
    const parent = new Group();
    const model = makeModel({ bricks: [{}, {}, {}] });
    const ghosts = new SlotGhosts(parent);

    ghosts.set([0, 1], model.bricks);
    const [kept] = parent.children;

    ghosts.set([0, 2], model.bricks);

    expect(parent.children).toHaveLength(2);
    // The slot that survived is the same object, not a rebuilt one.
    expect(parent.children).toContain(kept);
    ghosts.dispose();
  });

  it("ignores a slot id the model does not have", () => {
    const parent = new Group();
    const model = makeModel({ bricks: [{}] });
    const ghosts = new SlotGhosts(parent);

    ghosts.set([0, 42], model.bricks);

    expect(parent.children).toHaveLength(1);
    ghosts.dispose();
  });

  it("never casts or catches a shadow, since a slot is not a thing", () => {
    const parent = new Group();
    const model = makeModel({ bricks: [{}] });
    const ghosts = new SlotGhosts(parent);

    ghosts.set([0], model.bricks);

    parent.children[0].traverse((child) => {
      expect(child.castShadow).toBe(false);
      expect(child.receiveShadow).toBe(false);
    });
    ghosts.dispose();
  });

  it("brightens the slots the brick in hand would fill", () => {
    const parent = new Group();
    const model = makeModel({ bricks: [{}, {}] });
    const ghosts = new SlotGhosts(parent);
    ghosts.set([0, 1], model.bricks);

    const resting = materialsIn(parent as Group);
    ghosts.setTargets([0]);
    const targeted = materialsIn(parent as Group);

    // The targeted slot swaps material; the other keeps the one it had.
    expect(targeted[0]).not.toBe(resting[0]);
    expect(targeted[1]).toBe(resting[1]);
    ghosts.dispose();
  });

  it("does no work when the targets have not changed", () => {
    const parent = new Group();
    const model = makeModel({ bricks: [{}, {}] });
    const ghosts = new SlotGhosts(parent);
    ghosts.set([0, 1], model.bricks);
    ghosts.setTargets([0]);

    const before = materialsIn(parent as Group);
    ghosts.setTargets([0]);

    expect(materialsIn(parent as Group)).toEqual(before);
    ghosts.dispose();
  });

  it("leaves a brick's own materials alone", () => {
    const parent = new Group();
    const model = makeModel({ bricks: [{}] });
    const original = model.bricks[0].meshes[0].material;
    const ghosts = new SlotGhosts(parent);

    ghosts.set([0], model.bricks);

    expect(model.bricks[0].meshes[0].material).toBe(original);
    ghosts.dispose();
  });

  it("breathes, but only while there is something to look at", () => {
    const parent = new Group();
    const model = makeModel({ bricks: [{}] });
    const ghosts = new SlotGhosts(parent);

    expect(() => ghosts.update(0.016)).not.toThrow();

    ghosts.set([0], model.bricks);
    const material = materialsIn(parent as Group)[0] as unknown as {
      emissiveIntensity: number;
    };
    const rest = material.emissiveIntensity;
    ghosts.update(0.6);

    expect(material.emissiveIntensity).not.toBe(rest);
    ghosts.dispose();
  });

  it("takes every ghost back out when the build is over", () => {
    const parent = new Group();
    const model = makeModel({ bricks: [{}, {}] });
    const ghosts = new SlotGhosts(parent);
    ghosts.set([0, 1], model.bricks);

    ghosts.clear();

    expect(parent.children).toHaveLength(0);
    ghosts.dispose();
  });
});
