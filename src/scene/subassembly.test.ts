import { BoxGeometry, Mesh, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { orientation } from "./freeBuild";
import { profileOf, type Standing } from "./heightField";
import { connectedTo, linksBetween, loadBearing, restsOn } from "./subassembly";

/**
 * Bricks are measured in LDraw's own frame, where Y points down and a part's
 * origin is its stud plane, so a body runs from 0 to 24 and standing it up
 * turns that over: a brick placed at y = 24 fills the floor to 24.
 */
const box = (width: number, depth: number): Mesh => {
  const geometry = new BoxGeometry(width, 24, depth);
  geometry.translate(0, 12, 0);
  const mesh = new Mesh(geometry);
  mesh.updateMatrixWorld(true);
  return mesh;
};

const shape = (studsX: number, studsZ: number) =>
  profileOf(
    [box(studsX * 20, studsZ * 20)],
    orientation(0, 0, new Quaternion())
  );

const at = (
  studsX: number,
  studsZ: number,
  [x, y, z]: [number, number, number]
): Standing => ({
  position: new Vector3(x, y, z),
  profile: shape(studsX, studsZ),
});

/** A brick on the floor, and one stacked square on top of it. */
const stack = () =>
  new Map<number, Standing>([
    [0, at(2, 4, [0, 24, 0])],
    [1, at(2, 4, [0, 48, 0])],
  ]);

/**
 * Two 1 x 1 legs a stud apart, with a 2 x 4 lying across both of them.
 */
const bridge = () =>
  new Map<number, Standing>([
    [0, at(1, 1, [-10, 24, 0])],
    [1, at(1, 1, [10, 24, 0])],
    [2, at(2, 4, [0, 48, 0])],
  ]);

describe("restsOn", () => {
  it("sees a brick standing on the one below it", () => {
    const built = stack();

    expect(restsOn(built.get(1) as Standing, built.get(0) as Standing)).toBe(
      true
    );
    expect(restsOn(built.get(0) as Standing, built.get(1) as Standing)).toBe(
      false
    );
  });

  it("does not join two bricks standing side by side", () => {
    // They share an edge and nothing else, and pulling one out leaves the other
    // exactly where it was. That is the whole reason contact is measured
    // vertically rather than as an overlap.
    const left = at(2, 4, [-40, 24, 0]);
    const right = at(2, 4, [0, 24, 0]);

    expect(restsOn(left, right)).toBe(false);
    expect(restsOn(right, left)).toBe(false);
  });

  it("does not join a brick to one it merely hangs over", () => {
    const low = at(2, 4, [0, 24, 0]);
    const high = at(2, 4, [0, 120, 0]);

    expect(restsOn(high, low)).toBe(false);
  });
});

describe("linksBetween", () => {
  it("records contact both ways round", () => {
    const links = linksBetween(stack());

    expect([...(links.under.get(1) ?? [])]).toEqual([0]);
    expect([...(links.over.get(0) ?? [])]).toEqual([1]);
    expect(links.under.get(0)?.size).toBe(0);
  });

  it("gives a part standing on two things two supports", () => {
    const links = linksBetween(bridge());

    expect([...(links.under.get(2) ?? [])].sort()).toEqual([0, 1]);
  });
});

describe("loadBearing", () => {
  it("brings up whatever the part alone was holding", () => {
    const links = linksBetween(stack());

    expect([...loadBearing(0, links)].sort()).toEqual([0, 1]);
  });

  it("brings up a whole column, one level at a time", () => {
    const tower = new Map<number, Standing>([
      [0, at(2, 4, [0, 24, 0])],
      [1, at(2, 4, [0, 48, 0])],
      [2, at(2, 4, [0, 72, 0])],
    ]);

    expect([...loadBearing(0, linksBetween(tower))].sort()).toEqual([0, 1, 2]);
    expect([...loadBearing(1, linksBetween(tower))].sort()).toEqual([1, 2]);
  });

  it("leaves a part that still has a leg under it", () => {
    const links = linksBetween(bridge());

    expect([...loadBearing(0, links)]).toEqual([0]);
  });

  it("takes what is above the picked part without taking what is below", () => {
    const roofed = new Map<number, Standing>([
      ...bridge(),
      [3, at(2, 4, [0, 72, 0])],
    ]);

    // The deck is the sole thing under the roof, so the roof comes with it. The
    // legs are under the deck rather than on it, and stay on the floor.
    expect([...loadBearing(2, linksBetween(roofed))].sort()).toEqual([2, 3]);
  });

  it("leaves a part standing on nothing where it is", () => {
    const apart = new Map<number, Standing>([
      [0, at(2, 4, [0, 24, 0])],
      [1, at(2, 4, [200, 24, 0])],
    ]);

    expect([...loadBearing(0, linksBetween(apart))]).toEqual([0]);
  });
});

describe("connectedTo", () => {
  it("reaches down as well as up", () => {
    const links = linksBetween(bridge());

    // Clicked the top: the legs come too, which is the difference between this
    // and only ever lifting what is above you.
    expect([...connectedTo(2, links)].sort()).toEqual([0, 1, 2]);
    expect([...connectedTo(0, links)].sort()).toEqual([0, 1, 2]);
  });

  it("stops at the edge of the piece it belongs to", () => {
    const two = new Map<number, Standing>([
      ...stack(),
      [2, at(2, 4, [200, 24, 0])],
    ]);

    expect([...connectedTo(0, linksBetween(two))].sort()).toEqual([0, 1]);
  });
});
