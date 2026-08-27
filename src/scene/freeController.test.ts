// @vitest-environment jsdom
import type { Vector3 } from "three";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFreeBuild, writeFreeBuild } from "@/lib/freeStore";
import { frames, stubBrowser, VIEWPORT } from "@/test/domStubs";
import { MemoryStorage, makePalette } from "@/test/fixtures";
import type { FreeController, FreeProgress } from "./FreeController";
import { loadPhysics } from "./physics";

// The factory is hoisted above every import, so the stubs are pulled in here
// rather than referenced from module scope.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  const stubs = await import("@/test/domStubs");
  return {
    ...actual,
    PMREMGenerator: stubs.FakePmrem,
    WebGLRenderer: stubs.FakeRenderer,
  };
});

/** Two parts: a 2x4 brick and a 1x1, so odd and even footprints both appear. */
const palette = () =>
  makePalette([
    { file: "3001.dat", partFile: "Brick 2 x 4", size: [2, 4] },
    { file: "3005.dat", partFile: "Brick 1 x 1", size: [1, 1] },
  ]);

const RED = 4;

let canvas: HTMLCanvasElement;
let controller: FreeController;
let store: MemoryStorage;
let Controller: typeof FreeController;

beforeAll(async () => {
  await loadPhysics();
  ({ FreeController: Controller } = await import("./FreeController"));
});

beforeEach(() => {
  stubBrowser();
  store = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: store,
  });
  canvas = document.createElement("canvas");
  document.body.append(canvas);
  controller = new Controller(canvas);
  controller.resize(VIEWPORT.width, VIEWPORT.height);
});

afterEach(() => {
  controller.dispose();
  canvas.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

function watch(): () => FreeProgress | null {
  let latest: FreeProgress | null = null;
  controller.setCallbacks({
    onProgress: (next) => {
      latest = next;
    },
  });
  return () => latest;
}

/** Point straight down at the floor, so a click lands where it looks. */
function lookDown(): void {
  const { viewport } = controller as unknown as {
    viewport: {
      camera: {
        lookAt: (x: number, y: number, z: number) => void;
        position: { set: (x: number, y: number, z: number) => void };
        updateMatrixWorld: (force: boolean) => void;
      };
      controls: { target: { set: (x: number, y: number, z: number) => void } };
    };
  };
  viewport.camera.position.set(0, 600, 0);
  viewport.controls.target.set(0, 0, 0);
  viewport.camera.lookAt(0, 0, 0);
  viewport.camera.updateMatrixWorld(true);
}

const pointer = (
  type: string,
  x = VIEWPORT.width / 2,
  y = VIEWPORT.height / 2
) =>
  new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
  });

/**
 * Move the pointer across the floor a frame at a time, without stopping.
 *
 * The frames have to be interleaved with the moves, or the hand jumped once and
 * then held still, which is the opposite of a throw. And the loop has to stay
 * running across the whole swing: the first frame after a start has no previous
 * frame to measure against, so restarting it per move means every frame is a
 * first frame and nothing ever appears to move at all.
 */
async function swing(): Promise<void> {
  controller.start();
  await [1, 2, 3, 4, 5, 6, 7, 8].reduce(
    (previous, step) =>
      previous.then(() => {
        canvas.dispatchEvent(
          pointer("pointermove", VIEWPORT.width / 2 + step * 30)
        );
        return frames(2);
      }),
    Promise.resolve()
  );
  controller.stop();
}

async function run(count = 3): Promise<void> {
  controller.start();
  await frames(count);
  controller.stop();
}

const open = async () => {
  await controller.open(palette(), false);
  await run();
  lookDown();
};

describe("FreeController", () => {
  it("opens onto an empty floor", async () => {
    const latest = watch();
    await open();

    expect(controller.ready).toBe(true);
    expect(latest()).toMatchObject({
      carrying: null,
      loose: 0,
      placed: 0,
      problem: null,
      ready: true,
    });
  });

  it("says so when the parts cannot be found", async () => {
    const latest = watch();
    vi.spyOn(await import("@/ldraw/palette"), "loadPalette").mockRejectedValue(
      new Error("no palette here")
    );

    await controller.open(null, false);

    expect(latest()?.problem).toBe("no palette here");
    expect(controller.ready).toBe(false);
  });

  it("puts a part on the pointer when one is taken out", async () => {
    const latest = watch();
    await open();

    controller.takeOut("3001.dat", RED);

    expect(latest()?.carrying).toMatchObject({
      blocked: false,
      colorCode: RED,
      file: "3001.dat",
      tip: 0,
      yaw: 0,
    });
  });

  it("ignores a part the palette does not have", async () => {
    const latest = watch();
    await open();

    controller.takeOut("9999.dat", RED);

    expect(latest()?.carrying).toBeNull();
  });

  it("puts a carried part down on the grid", async () => {
    const latest = watch();
    await open();
    controller.takeOut("3001.dat", RED);
    await run();

    canvas.dispatchEvent(pointer("pointerdown"));

    expect(latest()?.placed).toBe(1);
    const text = controller.toLdraw("test");
    const line = text.split("\n").find((row) => row.startsWith("1 "));
    const [, , x, y, z] = (line as string).split(" ");
    // On the stud grid in x and z, and resting on the floor in y.
    expect(Number(x) % 20).toBe(0);
    expect(Number(z) % 20).toBe(0);
    expect(Number(y)).toBe(-24);
  });

  it("reaches for another of the same part once one is down", async () => {
    const latest = watch();
    await open();
    controller.arm({ colorCode: RED, file: "3001.dat" });
    controller.takeOut("3001.dat", RED);
    await run();

    canvas.dispatchEvent(pointer("pointerdown"));

    // Building a wall should not mean going back to the box every brick.
    expect(latest()?.carrying).not.toBeNull();
  });

  it("turns and tips what is in hand, in quarter circles", async () => {
    const latest = watch();
    await open();
    controller.takeOut("3001.dat", RED);

    controller.rotate(1, 0);
    expect(latest()?.carrying).toMatchObject({ tip: 0, yaw: 1 });

    controller.rotate(-2, 1);
    expect(latest()?.carrying).toMatchObject({ tip: 1, yaw: 3 });
  });

  it("nudges by whole grid steps", async () => {
    const latest = watch();
    await open();
    controller.takeOut("3001.dat", RED);

    controller.nudge(1, 0, -2);
    controller.nudge(1, 3, 0);

    expect(latest()?.carrying?.nudge).toEqual({ x: 2, y: 3, z: -2 });
  });

  it("stacks one part on another rather than through it", async () => {
    await open();
    controller.arm({ colorCode: RED, file: "3001.dat" });
    controller.takeOut("3001.dat", RED);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));

    const heights = controller
      .toLdraw("test")
      .split("\n")
      .filter((row) => row.startsWith("1 "))
      .map((row) => Number(row.split(" ")[3]));

    expect(heights).toHaveLength(2);
    // One brick is 24 units tall, and LDraw counts downwards.
    expect(Math.abs(heights[0] - heights[1])).toBe(24);
  });

  it("says a part will not fit as soon as it is nudged there", async () => {
    const latest = watch();
    await open();
    controller.arm({ colorCode: RED, file: "3001.dat" });
    controller.takeOut("3001.dat", RED);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));
    await run();
    expect(latest()?.carrying?.blocked).toBe(false);

    // Two plates down from resting on the brick below is inside it. The answer
    // has to be in the report this nudge produces, not the one after it, or the
    // warning arrives once you have already moved back out.
    controller.nudge(0, -2, 0);

    expect(latest()?.carrying?.blocked).toBe(true);

    controller.nudge(0, 2, 0);
    expect(latest()?.carrying?.blocked).toBe(false);
  });

  it("says a part will not fit as soon as it is turned into something", async () => {
    const latest = watch();
    await open();
    controller.takeOut("3001.dat", RED);
    await run();

    // Turning changes the footprint, so it changes what the part runs into.
    controller.rotate(1, 0);

    expect(latest()?.carrying?.yaw).toBe(1);
    expect(latest()?.carrying?.blocked).toBe(false);
  });

  it("tips a handful onto the floor as loose bricks", async () => {
    const latest = watch();
    await open();

    controller.pourOut("3001.dat", RED, 6);

    expect(latest()?.loose).toBe(6);
    expect(latest()?.placed).toBe(0);
  });

  it("will not tip out more than a floor can hold", async () => {
    const latest = watch();
    await open();

    controller.pourOut("3001.dat", RED, 5000);

    expect(latest()?.loose).toBe(50);
  });

  it("sweeps the floor without touching the build", async () => {
    const latest = watch();
    await open();
    controller.takeOut("3001.dat", RED);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));
    controller.cancelCarry();
    controller.pourOut("3005.dat", RED, 3);

    controller.clearLoose();

    expect(latest()).toMatchObject({ loose: 0, placed: 1 });
  });

  it("picks a placed part back up, and puts it back", async () => {
    const latest = watch();
    await open();
    controller.takeOut("3001.dat", RED);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));
    controller.cancelCarry();
    await run();

    canvas.dispatchEvent(pointer("pointerdown"));
    expect(latest()).toMatchObject({ placed: 0 });
    expect(latest()?.carrying).not.toBeNull();

    canvas.dispatchEvent(pointer("pointerdown"));
    expect(latest()?.placed).toBe(1);
  });

  it("gives a part back to the floor when carrying is cancelled", async () => {
    const latest = watch();
    await open();
    controller.pourOut("3001.dat", RED, 1);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));
    expect(latest()?.loose).toBe(0);

    controller.cancelCarry();

    // It came off the floor, so that is where it goes back to.
    expect(latest()?.loose).toBe(1);
  });

  it("hands a dropped part the speed it was moving at", async () => {
    await open();
    const { world } = controller as unknown as {
      world: { drop: (brick: unknown, velocity: Vector3) => void };
    };
    const drop = vi.spyOn(world, "drop");

    controller.pourOut("3001.dat", RED, 1);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));
    await swing();
    controller.cancelCarry();

    // How far it then travels is the world's business, and is tested there.
    // What has to be true here is that the swing reaches it at all.
    expect(drop).toHaveBeenCalledOnce();
    expect(drop.mock.calls[0][1].length()).toBeGreaterThan(1);
  });

  it("drops a part that was standing still without throwing it", async () => {
    await open();
    const { world } = controller as unknown as {
      world: { drop: (brick: unknown, velocity: Vector3) => void };
    };
    const drop = vi.spyOn(world, "drop");

    controller.pourOut("3001.dat", RED, 1);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));
    await run(12);
    controller.cancelCarry();

    expect(drop.mock.calls[0][1].length()).toBeLessThan(1);
  });

  it("throws away a part taken from the box when it is cancelled", async () => {
    const latest = watch();
    await open();
    controller.takeOut("3001.dat", RED);

    controller.cancelCarry();

    expect(latest()).toMatchObject({ carrying: null, loose: 0, placed: 0 });
  });

  it("deletes what is in hand", async () => {
    const latest = watch();
    await open();
    controller.pourOut("3001.dat", RED, 1);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));

    controller.deleteCarried();

    expect(latest()).toMatchObject({ carrying: null, loose: 0, placed: 0 });
  });

  it("clears the whole floor", async () => {
    const latest = watch();
    await open();
    controller.takeOut("3001.dat", RED);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));
    controller.pourOut("3005.dat", RED, 4);

    controller.clearAll();

    expect(latest()).toMatchObject({ carrying: null, loose: 0, placed: 0 });
    expect(controller.toLdraw("test")).not.toContain("\n1 ");
  });

  it("writes the build out and reads it back", async () => {
    await open();
    controller.takeOut("3001.dat", RED);
    await run();
    canvas.dispatchEvent(pointer("pointerdown"));
    controller.dispose();

    const saved = readFreeBuild();
    expect(saved?.placed).toHaveLength(1);
    expect(saved?.placed[0]).toMatchObject({ c: RED, f: "3001.dat" });
  });

  it("picks a saved build back up", async () => {
    writeFreeBuild({
      loose: [],
      looseParts: [],
      placed: [{ c: 14, f: "3001.dat", p: [20, 24, -40], t: 0, y: 1 }],
      updatedAt: 1,
      v: 1,
    });

    const latest = watch();
    await controller.open(palette(), true);
    await run();

    expect(latest()?.placed).toBe(1);
    expect(controller.toLdraw("test")).toContain("1 14 20 -24 40 ");
  });

  it("drops a saved part the palette no longer has", async () => {
    writeFreeBuild({
      loose: [],
      looseParts: [],
      placed: [{ c: 4, f: "gone.dat", p: [0, 0, 0], t: 0, y: 0 }],
      updatedAt: 1,
      v: 1,
    });

    const latest = watch();
    await controller.open(palette(), true);

    expect(latest()?.placed).toBe(0);
  });

  it("puts the loose pile back where it was left", async () => {
    writeFreeBuild({
      loose: [0, 100, 24, -60, 0, 0, 0, 1],
      looseParts: [{ colorCode: 4, file: "3001.dat", id: 0 }],
      placed: [],
      updatedAt: 1,
      v: 1,
    });

    const latest = watch();
    await controller.open(palette(), true);

    expect(latest()?.loose).toBe(1);
  });
});
