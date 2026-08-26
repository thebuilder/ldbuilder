import { Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { makeBrick, makeModel } from "@/test/fixtures";
import { LiveWorld } from "./liveWorld";
import { loadPhysics } from "./physics";

/** Release height for the test world; the model-space unit everything scales by. */
const UNIT = 400;
const FLOOR = 0;
const CENTRE = new Vector3();

/** Long enough for a brick released near the floor to land and settle. */
const SETTLE_STEPS = 150;

beforeAll(async () => {
  await loadPhysics();
});

const world = () => {
  const live = LiveWorld.create(FLOOR, UNIT, CENTRE);
  if (!live) {
    throw new Error("physics failed to load");
  }
  return live;
};

describe("LiveWorld", () => {
  it("drops a brick onto the floor and lets it come to rest", () => {
    const live = world();
    const brick = makeBrick(0);

    live.spawn(brick, {
      position: new Vector3(0, 300, 0),
      quaternion: new Quaternion(),
    });
    live.settleNow(SETTLE_STEPS);
    live.sync([brick]);

    // The brick's origin is on its top face, so at rest it sits one brick
    // height above the floor rather than on it.
    expect(brick.object.position.y).toBeCloseTo(24, 0);
    live.dispose();
  });

  it("counts what is loose, and stops counting once it is placed", () => {
    const live = world();
    const model = makeModel({ bricks: [{}, {}, {}] });

    live.pour(model.bags[0], model.bricks, "seed");
    expect(live.looseCount).toBe(3);

    live.despawn(1);
    expect(live.looseCount).toBe(2);
    live.dispose();
  });

  it("pours the same pile for the same seed", () => {
    const settle = (seed: string) => {
      const live = world();
      const model = makeModel({ bricks: [{}, {}, {}, {}] });
      live.pour(model.bags[0], model.bricks, seed);
      live.settleNow(SETTLE_STEPS);
      live.sync(model.bricks);
      const out = model.bricks.map((b) => b.object.position.clone());
      live.dispose();
      return out;
    };

    const first = settle("same");
    const second = settle("same");
    for (const [index, position] of first.entries()) {
      expect(position.x).toBeCloseTo(second[index].x, 4);
      expect(position.z).toBeCloseTo(second[index].z, 4);
    }
  });

  it("holds a brick exactly where the hand is, against gravity", () => {
    const live = world();
    const brick = makeBrick(0);
    const held = new Vector3(10, 200, -30);

    live.spawn(brick, {
      position: new Vector3(0, 200, 0),
      quaternion: new Quaternion(),
    });
    expect(live.grab(0, brick.object.position, brick.object.quaternion)).toBe(
      true
    );

    live.moveHeld(held, new Quaternion(), 1 / 60);
    live.settleNow(60);
    live.sync([brick]);

    expect(brick.object.position.distanceTo(held)).toBeLessThan(0.001);
    live.dispose();
  });

  it("cannot take hold of a brick that is not in the world", () => {
    const live = world();

    expect(live.grab(7, new Vector3(), new Quaternion())).toBe(false);
    live.dispose();
  });

  it("throws a released brick along the way the hand was moving", () => {
    const live = world();
    const brick = makeBrick(0);
    live.spawn(brick, {
      position: new Vector3(0, 200, 0),
      quaternion: new Quaternion(),
    });
    live.grab(0, brick.object.position, brick.object.quaternion);

    // A flick: several frames of travel in one direction, then let go.
    for (let frame = 1; frame <= 6; frame += 1) {
      live.moveHeld(new Vector3(frame * 20, 200, 0), new Quaternion(), 1 / 60);
      live.step(1 / 60);
    }
    live.release();
    live.settleNow(30);
    live.sync([brick]);

    expect(brick.object.position.x).toBeGreaterThan(120);
    live.dispose();
  });

  it("releasing nothing is not an error", () => {
    const live = world();

    expect(() => live.release()).not.toThrow();
    live.dispose();
  });

  it("keeps a loose brick from falling through a placed one", () => {
    const live = world();
    const floorBrick = makeBrick(0, { at: [0, 200, 0] });
    const falling = makeBrick(1);

    live.addStatic(floorBrick);
    live.spawn(falling, {
      position: new Vector3(0, 400, 0),
      quaternion: new Quaternion(),
    });
    live.settleNow(SETTLE_STEPS);
    live.sync([floorBrick, falling]);

    // It comes to rest on top of the static brick, not on the floor.
    expect(falling.object.position.y).toBeGreaterThan(200);
    live.dispose();
  });

  it("hands a body from one record to the other when a brick is placed", () => {
    const live = world();
    const carried = makeBrick(0);
    const slot = makeBrick(1);
    live.spawn(carried, {
      position: new Vector3(100, 200, 0),
      quaternion: new Quaternion(),
    });
    live.spawn(slot, {
      position: new Vector3(-100, 200, 0),
      quaternion: new Quaternion(),
    });
    // The hand is taken from the brick's object, which a frame has already
    // synced from its body.
    live.sync([carried, slot]);
    live.grab(0, carried.object.position, carried.object.quaternion);

    live.swapBodies(0, 1);
    live.sync([carried, slot]);

    // Record 1 now owns the body that was being carried, and the hand with it.
    expect(slot.object.position.x).toBeCloseTo(100, 0);
    expect(carried.object.position.x).toBeCloseTo(-100, 0);
    live.dispose();
  });

  it("reads the pile back as a flat array the save can hold", () => {
    const live = world();
    const brick = makeBrick(3);
    live.spawn(brick, {
      position: new Vector3(1, 2, 3),
      quaternion: new Quaternion(0, 0, 0, 1),
    });

    const snapshot = live.snapshot();

    expect(snapshot).toHaveLength(8);
    expect(snapshot[0]).toBe(3);
    expect(snapshot[1]).toBeCloseTo(1, 5);
    expect(snapshot[3]).toBeCloseTo(3, 5);
    live.dispose();
  });

  it("puts a brick back exactly where a save left it", () => {
    const live = world();
    const brick = makeBrick(0);

    live.restore(brick, new Vector3(5, 30, -7), new Quaternion());
    live.sync([brick]);

    expect(brick.object.position.toArray()).toEqual([5, 30, -7]);
    live.dispose();
  });

  it("brings back a brick thrown off the table", () => {
    const live = world();
    const brick = makeBrick(0);
    live.spawn(brick, {
      position: new Vector3(UNIT * 20, 100, 0),
      quaternion: new Quaternion(),
    });

    // The sweep runs on a frame count, so step long enough to reach one.
    for (let frame = 0; frame < 40; frame += 1) {
      live.step(1 / 60);
    }
    live.sync([brick]);

    expect(Math.abs(brick.object.position.x)).toBeLessThan(UNIT * 2);
    live.dispose();
  });

  it("clears the pile but keeps what has been built", () => {
    const live = world();
    const model = makeModel({ bricks: [{}, {}] });
    live.addStatic(model.bricks[0]);
    live.pour(model.bags[0], model.bricks, "seed");

    live.clearLoose();

    expect(live.looseCount).toBe(0);
    // The static collider survives, so a new bag still lands on the model.
    const falling = makeBrick(9, { at: [0, 600, 0] });
    live.spawn(falling, {
      position: new Vector3(
        model.bricks[0].builtPose.position.x,
        600,
        model.bricks[0].builtPose.position.z
      ),
      quaternion: new Quaternion(),
    });
    live.settleNow(SETTLE_STEPS);
    live.sync([falling]);
    expect(falling.object.position.y).toBeGreaterThan(24);
    live.dispose();
  });

  it("refuses to give a brick with no box a collider", () => {
    const live = world();
    const brick = makeBrick(0);
    brick.halfExtents.set(0, 0, 0);

    live.spawn(brick, {
      position: new Vector3(),
      quaternion: new Quaternion(),
    });
    live.addStatic(brick);

    expect(live.looseCount).toBe(0);
    live.dispose();
  });

  it("ignores a second spawn of the same brick", () => {
    const live = world();
    const brick = makeBrick(0);
    const spawn = () =>
      live.spawn(brick, {
        position: new Vector3(),
        quaternion: new Quaternion(),
      });

    spawn();
    spawn();

    expect(live.looseCount).toBe(1);
    live.dispose();
  });

  it("catches up with a long stall without simulating every frame of it", () => {
    const live = world();
    const brick = makeBrick(0);
    live.spawn(brick, {
      position: new Vector3(0, 300, 0),
      quaternion: new Quaternion(),
    });

    // A tab that was hidden for ten seconds must not run ten seconds of solver.
    live.step(10);
    live.sync([brick]);

    expect(brick.object.position.y).toBeGreaterThan(280);
    live.dispose();
  });
});
