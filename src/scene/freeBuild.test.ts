import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  orientation,
  PLATE,
  type Placement,
  rotatedCenter,
  rotatedHalfExtents,
  STUD,
  snapCenterToGrid,
  snapPlacement,
  toLdrawFile,
} from "./freeBuild";
import { COLUMN, type Profile, type Standing } from "./heightField";

/**
 * A 2 x 4 brick: 40 x 24 x 80 LDraw units.
 *
 * The origin is the stud face and LDraw's Y points down, so the body sits at
 * positive local Y, which is above the origin once the part is stood up.
 */
const brick2x4 = {
  halfExtents: new Vector3(20, 12, 40),
  localCenter: new Vector3(0, 12, 0),
};

/** A 2 x 2 brick: the footprint the stepped fixtures below are cut to. */
const brick2x2 = {
  halfExtents: new Vector3(20, 12, 20),
  localCenter: new Vector3(0, 12, 0),
};

/** A 1 x 1 brick, the odd-footprint case. */
const brick1x1 = {
  halfExtents: new Vector3(10, 12, 10),
  localCenter: new Vector3(0, 12, 0),
};

const upright = () => orientation(0, 0, new Quaternion());

/** A part that really is one slab, which is what a plain brick is. */
const slab = (part = brick2x4): Profile => {
  const q = upright();
  const half = rotatedHalfExtents(part.halfExtents, q, new Vector3());
  const center = rotatedCenter(part.localCenter, q, new Vector3());
  const cols = Math.round((half.x * 2) / COLUMN);
  const rows = Math.round((half.z * 2) / COLUMN);
  return {
    anchorX: center.x - half.x,
    anchorZ: center.z - half.z,
    bottom: new Float32Array(cols * rows).fill(center.y - half.y),
    cols,
    rows,
    top: new Float32Array(cols * rows).fill(center.y + half.y),
  };
};

/**
 * A 2 x 2 part with a step in it: `levels` gives one [bottom, top] pair per
 * column along X, repeated across Z. Enough shape to stand in for the two parts
 * a bounding box gets wrong, a bracket and a slope.
 */
const stepped = (levels: [number, number][]): Profile => {
  const cols = levels.length;
  const rows = 4;
  const bottom = new Float32Array(cols * rows);
  const top = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      bottom[row * cols + col] = levels[col][0];
      top[row * cols + col] = levels[col][1];
    }
  }
  return { anchorX: -20, anchorZ: -20, bottom, cols, rows, top };
};

/** Deep along half its length, shallow along the other: a bracket. */
const BRACKET: [number, number][] = [
  [-24, 0],
  [-24, 0],
  [-8, 0],
  [-8, 0],
];

/** Low along half its length, full height along the other: a slope. */
const WEDGE: [number, number][] = [
  [-24, -12],
  [-24, -12],
  [-24, 0],
  [-24, 0],
];

const placed = (position: Vector3, part = brick2x4): Standing => ({
  position,
  profile: slab(part),
});

const standing = (position: Vector3, profile: Profile): Standing => ({
  position,
  profile,
});

const snap = (
  desired: Vector3,
  part = brick2x4,
  built = new Map<number, Standing>(),
  nudge = { x: 0, y: 0, z: 0 },
  profile = slab(part)
) => {
  const q = upright();
  return snapPlacement(
    {
      built,
      center: rotatedCenter(part.localCenter, q, new Vector3()),
      desired,
      floorY: 0,
      half: rotatedHalfExtents(part.halfExtents, q, new Vector3()),
      nudge,
      profile,
    },
    new Vector3()
  );
};

describe("orientation", () => {
  it("stands a part up, because LDraw draws them upside down", () => {
    const up = orientation(0, 0, new Quaternion());
    const down = new Vector3(0, 1, 0).applyQuaternion(up);

    expect(down.y).toBeCloseTo(-1, 6);
  });

  it("turns in exact quarter circles", () => {
    const quarter = orientation(1, 0, new Quaternion());
    const along = new Vector3(1, 0, 0).applyQuaternion(quarter);

    expect(along.x).toBeCloseTo(0, 6);
    expect(Math.abs(along.z)).toBeCloseTo(1, 6);
  });

  it("comes back to where it started after four turns", () => {
    const full = orientation(4, 0, new Quaternion());
    const start = orientation(0, 0, new Quaternion());

    expect(Math.abs(full.dot(start))).toBeCloseTo(1, 6);
  });
});

describe("rotatedHalfExtents", () => {
  it("swaps a footprint's sides when the part is turned a quarter", () => {
    const turned = rotatedHalfExtents(
      brick2x4.halfExtents,
      orientation(1, 0, new Quaternion()),
      new Vector3()
    );

    expect(turned.x).toBeCloseTo(40, 6);
    expect(turned.z).toBeCloseTo(20, 6);
    expect(turned.y).toBeCloseTo(12, 6);
  });

  it("stands a part on its end when it is tipped", () => {
    const tipped = rotatedHalfExtents(
      brick2x4.halfExtents,
      orientation(0, 1, new Quaternion()),
      new Vector3()
    );

    expect(tipped.y).toBeCloseTo(40, 6);
    expect(tipped.z).toBeCloseTo(12, 6);
  });
});

describe("snapCenterToGrid", () => {
  it("puts an even footprint on the grid lines", () => {
    expect(snapCenterToGrid(3, 2 * STUD)).toBe(0);
    expect(snapCenterToGrid(17, 2 * STUD)).toBe(20);
  });

  it("puts an odd footprint on the middle of a stud", () => {
    expect(snapCenterToGrid(3, STUD)).toBe(10);
    expect(snapCenterToGrid(28, STUD)).toBe(30);
  });

  it("treats anything smaller than a stud as one stud wide", () => {
    expect(snapCenterToGrid(3, 0)).toBe(10);
  });
});

describe("snapPlacement", () => {
  it("drops a part onto the floor when there is nothing under it", () => {
    const result = snap(new Vector3(7, 300, -3));

    // The origin is the stud face, so a brick standing on the floor has its
    // origin one brick height up.
    expect(result.position.y).toBeCloseTo(24, 6);
    expect(result.restingOn).toBeNull();
    expect(result.blocked).toBe(false);
  });

  it("lines a part up with the grid", () => {
    const result = snap(new Vector3(7, 0, -33));

    expect(result.position.x).toBe(0);
    expect(result.position.z).toBe(-40);
  });

  it("stacks a part on the one below it", () => {
    const built = new Map([[1, placed(new Vector3(0, 24, 0))]]);

    const result = snap(new Vector3(3, 24, 3), brick2x4, built);

    expect(result.position.y).toBeCloseTo(48, 6);
    expect(result.restingOn).toBe(1);
    expect(result.blocked).toBe(false);
  });

  it("leaves a part on the floor when it only sits beside another", () => {
    const built = new Map([[1, placed(new Vector3(0, 24, 0))]]);

    // Far enough along that the two footprints do not overlap at all.
    const result = snap(new Vector3(40, 0, 0), brick2x4, built);

    expect(result.position.y).toBeCloseTo(24, 6);
    expect(result.restingOn).toBeNull();
  });

  it("rests on the surface nearest to where the pointer is pointing", () => {
    // Two bricks with a brick-sized gap between them: floors at 0, 24 and 72.
    const built = new Map([
      [1, placed(new Vector3(0, 24, 0))],
      [2, placed(new Vector3(0, 72, 0))],
    ]);

    // Pointing at the top of the stack builds on the top of the stack.
    expect(snap(new Vector3(0, 72, 0), brick2x4, built).position.y).toBeCloseTo(
      96,
      6
    );
    // Pointing at the top of the lower brick builds there instead, which is the
    // only way to put something into a gap rather than always on top.
    expect(snap(new Vector3(0, 24, 0), brick2x4, built).position.y).toBeCloseTo(
      48,
      6
    );
  });

  it("passes over a surface the part will not fit on", () => {
    const built = new Map([
      [1, placed(new Vector3(0, 24, 0))],
      [2, placed(new Vector3(0, 72, 0))],
    ]);

    // The floor is nearest to the pointer and full, so the next one up wins.
    const result = snap(new Vector3(0, 0, 0), brick2x4, built);

    expect(result.position.y).toBeCloseTo(48, 6);
    expect(result.blocked).toBe(false);
    expect(result.restingOn).toBe(1);
  });

  it("ignores a stack beside the footprint, however tall it is", () => {
    const built = new Map([[1, placed(new Vector3(400, 240, 0))]]);

    // Pointing high up does not lift a part onto something it is not over.
    const result = snap(new Vector3(0, 240, 0), brick2x4, built);

    expect(result.position.y).toBeCloseTo(24, 6);
    expect(result.restingOn).toBeNull();
  });

  it("says so when a part would pass through what is already built", () => {
    const built = new Map([[1, placed(new Vector3(0, 24, 0))]]);

    // It would rest on top; nudged down two plates it is inside instead. A
    // height set by hand is a decision, so it is put where it was asked for and
    // reported as not fitting rather than quietly moved somewhere it does.
    const result = snap(new Vector3(0, 24, 0), brick2x4, built, {
      x: 0,
      y: -2,
      z: 0,
    });

    expect(result.blocked).toBe(true);
  });

  it("moves by whole studs and whole plates when nudged", () => {
    const plain = snap(new Vector3(0, 0, 0));
    const nudged = snap(new Vector3(0, 0, 0), brick2x4, new Map(), {
      x: 2,
      y: 1,
      z: -1,
    });

    expect(nudged.position.x - plain.position.x).toBeCloseTo(2 * STUD, 6);
    expect(nudged.position.z - plain.position.z).toBeCloseTo(-STUD, 6);
    expect(nudged.position.y - plain.position.y).toBeCloseTo(PLATE, 6);
  });

  it("puts an odd footprint half a stud off the grid, where its stud is", () => {
    const result = snap(new Vector3(0, 0, 0), brick1x1);

    expect(Math.abs(result.position.x)).toBe(10);
  });
});

describe("toLdrawFile", () => {
  const place = (over: Partial<Placement> = {}): Placement => ({
    colorCode: 4,
    file: "3001.dat",
    id: 1,
    position: new Vector3(0, 24, 0),
    tip: 0,
    yaw: 0,
    ...over,
  });

  it("writes a header a reader can identify the file from", () => {
    const text = toLdrawFile([], "My build");

    expect(text).toContain("0 My build");
    expect(text).toContain("0 !LDRAW_ORG Unofficial_Model");
  });

  it("claims neither authorship of nor a licence over the person's model", () => {
    const text = toLdrawFile([place()], "My build");

    expect(text).not.toContain("0 Author:");
    expect(text).not.toContain("!LICENSE");
  });

  it("writes an unturned part with an identity rotation", () => {
    const text = toLdrawFile([place({ position: new Vector3(0, 24, 0) })], "x");

    // The app turned it upright on the way in; writing it out turns it back.
    expect(text).toContain("1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat");
  });

  it("flips back into LDraw's own frame, where Y points down", () => {
    const text = toLdrawFile(
      [place({ position: new Vector3(20, 48, 60) })],
      "x"
    );

    expect(text).toContain("1 4 20 -48 -60 ");
  });

  it("writes a quarter turn as whole numbers", () => {
    const text = toLdrawFile([place({ yaw: 1 })], "x");
    const line = text.split("\n").find((l) => l.startsWith("1 "));

    expect(line).toBeDefined();
    for (const value of (line as string).split(" ").slice(5, 14)) {
      expect(["0", "1", "-1"]).toContain(value);
    }
  });

  it("keeps the colour each part was placed in", () => {
    const text = toLdrawFile(
      [place({ colorCode: 4 }), place({ colorCode: 14, id: 2 })],
      "x"
    );

    expect(text).toContain("1 4 ");
    expect(text).toContain("1 14 ");
  });

  it("ends on a step, so a reader shows the whole thing", () => {
    expect(toLdrawFile([place()], "x").trimEnd().endsWith("0 STEP")).toBe(true);
  });
});

describe("snapPlacement, parts with more than one level", () => {
  it("rests a brick on the low end of a slope, not on its high end", () => {
    // Without columns the slope is one box 24 tall, and anything put on it sits
    // at the top of that box: the floating brick this is all here to stop.
    const built = new Map([
      [1, standing(new Vector3(0, 24, 0), stepped(WEDGE))],
    ]);

    const result = snap(new Vector3(-20, 12, 0), brick2x2, built);

    expect(result.position.y).toBeCloseTo(36, 6);
    expect(result.restingOn).toBe(1);
    expect(result.blocked).toBe(false);
  });

  it("rests a bracket on the step that reaches what is under it", () => {
    // The support only reaches the shallow half, so the shallow half is what
    // takes the weight and the deep half hangs clear.
    const built = new Map([[1, placed(new Vector3(40, 24, 0), brick2x2)]]);

    const result = snap(
      new Vector3(20, 24, 0),
      brick2x2,
      built,
      undefined,
      stepped(BRACKET)
    );

    expect(result.position.y).toBeCloseTo(32, 6);
    expect(result.restingOn).toBe(1);
  });

  it("rests the same bracket lower when the deep step is the one supported", () => {
    const built = new Map([[1, placed(new Vector3(-40, 24, 0), brick2x2)]]);

    const result = snap(
      new Vector3(-20, 24, 0),
      brick2x2,
      built,
      undefined,
      stepped(BRACKET)
    );

    expect(result.position.y).toBeCloseTo(48, 6);
    expect(result.restingOn).toBe(1);
  });

  it("lets a brick sit beside a slope's high end without calling it blocked", () => {
    const built = new Map([
      [1, standing(new Vector3(0, 24, 0), stepped(WEDGE))],
    ]);

    const result = snap(new Vector3(-20, 12, 0), brick2x2, built);

    expect(result.blocked).toBe(false);
  });
});
