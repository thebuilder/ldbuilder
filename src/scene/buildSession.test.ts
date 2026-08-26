import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { makeModel } from "@/test/fixtures";
import { BuildSession } from "./buildSession";

/** Six bricks over three steps: two red, two blue, two of a different part. */
const model = () =>
  makeModel({
    bricks: [
      { at: [0, 24, 0], colorCode: 4, step: 0 },
      { at: [80, 24, 0], colorCode: 4, step: 0 },
      { at: [0, 48, 0], colorCode: 1, step: 1 },
      { at: [80, 48, 0], colorCode: 1, step: 1 },
      { at: [0, 72, 0], colorCode: 1, partFile: "3003.dat", step: 2 },
      { at: [80, 72, 0], colorCode: 1, partFile: "3003.dat", step: 2 },
    ],
  });

describe("BuildSession", () => {
  it("opens on the first step with that step's slots pending", () => {
    const session = new BuildSession(model());

    expect(session.step).toBe(0);
    expect(session.done).toBe(false);
    expect(session.pendingSlots).toEqual([0, 1]);
    expect(session.placedCount).toBe(0);
  });

  it("treats every brick of the open bag as loose until it is placed", () => {
    const session = new BuildSession(model());

    // The pile holds pieces for later steps too; that is the game.
    expect(session.looseIds()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(session.isLoose(4)).toBe(true);

    session.place(0, 0);
    expect(session.isLoose(0)).toBe(false);
    expect(session.looseIds()).toEqual([1, 2, 3, 4, 5]);
  });

  it("matches a slot by part and colour rather than by identity", () => {
    const session = new BuildSession(model());

    // Brick 1 is the same part and colour as brick 0, so it fills brick 0's slot.
    expect(session.findSlot(1, new Vector3(0, 24, 0), 30)).toBe(0);
    expect(session.slotsFor(1)).toEqual([0, 1]);
  });

  it("refuses a brick whose part or colour is wrong", () => {
    const session = new BuildSession(model());

    // Brick 2 is the right part but the wrong colour for step one's slots.
    expect(session.findSlot(2, new Vector3(0, 24, 0), 30)).toBeNull();
    expect(session.slotsFor(2)).toEqual([]);
  });

  it("takes the nearest slot when two would accept the same brick", () => {
    const session = new BuildSession(model());

    expect(session.findSlot(1, new Vector3(70, 24, 0), 200)).toBe(1);
    expect(session.findSlot(1, new Vector3(10, 24, 0), 200)).toBe(0);
  });

  it("ignores slots outside the snap radius", () => {
    const session = new BuildSession(model());

    expect(session.findSlot(1, new Vector3(0, 24, 400), 30)).toBeNull();
  });

  it("advances only once every slot in the step is filled", () => {
    const session = new BuildSession(model());

    session.place(0, 0);
    expect(session.advanceIfComplete()).toBe(false);
    expect(session.step).toBe(0);

    session.place(1, 0);
    expect(session.advanceIfComplete()).toBe(true);
    expect(session.step).toBe(1);
    expect(session.pendingSlots).toEqual([2, 3]);
  });

  it("finishes once the last step is filled", () => {
    const session = new BuildSession(model());

    for (const id of [0, 1, 2, 3, 4, 5]) {
      session.place(id, 0);
      session.advanceIfComplete();
    }

    expect(session.done).toBe(true);
    expect(session.pendingSlots).toEqual([]);
    expect(session.placedCount).toBe(6);
    // Nothing left to advance into.
    expect(session.advanceIfComplete()).toBe(false);
  });

  it("ignores a slot that is already filled", () => {
    const session = new BuildSession(model());

    session.place(0, 0);
    session.place(0, 0);

    expect(session.placedCount).toBe(1);
  });

  it("records what went in last, so it can be flashed", () => {
    const session = new BuildSession(model());

    session.place(1, 1234);

    expect(session.lastPlacedId).toBe(1);
    expect(session.lastPlacedAt).toBe(1234);
  });

  it("restores a saved build", () => {
    const session = new BuildSession(model());

    session.restore(1, [0, 1]);

    expect(session.step).toBe(1);
    expect(session.placedCount).toBe(2);
    expect(session.pendingSlots).toEqual([2, 3]);
  });

  it("drops slot ids a save should not contain", () => {
    const session = new BuildSession(model());

    session.restore(1, [0, 1, 0, -1, 99]);

    // The duplicate and the two out-of-range ids are all discarded.
    expect(session.placedCount).toBe(2);
  });

  it("clamps a step beyond the end of the build", () => {
    const session = new BuildSession(model());

    session.restore(99, []);

    expect(session.step).toBe(3);
    expect(session.done).toBe(true);
  });

  it("keys a brick by part and colour", () => {
    const session = new BuildSession(model());

    expect(session.keyOf(0)).toBe("3001.dat|4");
    expect(session.keyOf(4)).toBe("3003.dat|1");
    expect(session.keyOf(99)).toBe("");
  });

  it("places a brick with no geometry itself, rather than stalling", () => {
    const data = model();
    // A part the packer could not resolve has no box, so it has no collider and
    // could never be picked up.
    data.bricks[1].halfExtents.set(0, 0, 0);

    const session = new BuildSession(data);

    expect(session.pendingSlots).toEqual([0]);
    expect(session.placedCount).toBe(1);
  });
});
