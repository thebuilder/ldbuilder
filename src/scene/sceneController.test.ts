// @vitest-environment jsdom
import { Box3, Vector3 } from "three";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { BuildProgress, ModelData } from "@/ldraw/types";
import { readBuild, writeBuild } from "@/lib/buildStore";
import type { FakeRenderer } from "@/test/domStubs";
import { frames, stubBrowser, VIEWPORT } from "@/test/domStubs";
import { MemoryStorage, makeModel } from "@/test/fixtures";
import { loadPhysics } from "./physics";
import type { ControllerInput } from "./SceneController";
import { SceneController } from "./SceneController";

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

const input = (over: Partial<ControllerInput> = {}): ControllerInput => ({
  explode: 0,
  hint: null,
  isolate: null,
  mode: "assemble",
  playing: false,
  selected: null,
  session: "watch",
  slice: 1,
  speed: 1,
  step: 0,
  ...over,
});

/** Two steps of two identical bricks, so a slot always has a spare to fill it. */
const buildableModel = (): ModelData =>
  makeModel({
    bricks: [
      { at: [-40, 24, 0], step: 0 },
      { at: [40, 24, 0], step: 0 },
      { at: [-40, 48, 0], step: 1 },
      { at: [40, 48, 0], step: 1 },
    ],
    slug: "test-build",
  });

let canvas: HTMLCanvasElement;
let controller: SceneController;
let store: MemoryStorage;

beforeAll(async () => {
  await loadPhysics();
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
  controller = new SceneController(canvas);
  controller.resize(800, 600);
});

afterEach(() => {
  controller.dispose();
  canvas.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

/** Run the render loop for a few frames, which is what syncs physics to bricks. */
async function run(count = 3): Promise<void> {
  controller.start();
  await frames(count);
  controller.stop();
}

/** The last progress report the controller pushed out. */
function watchProgress(): () => BuildProgress | null {
  let latest: BuildProgress | null = null;
  controller.setCallbacks({
    onBuildProgress: (next) => {
      latest = next;
    },
  });
  return () => latest;
}

describe("SceneController build mode", () => {
  it("tips the bag out and reports the step it is on", () => {
    const latest = watchProgress();
    controller.setModel(buildableModel());
    controller.setInput(input({ session: "build" }));

    const progress = latest();
    expect(progress).toMatchObject({
      done: false,
      loose: 4,
      placedTotal: 0,
      resumed: false,
      step: 0,
      totalSteps: 2,
      unavailable: false,
    });
    expect(progress?.pending).toEqual([0, 1]);
  });

  it("waits for a model before it has anything to report", () => {
    const latest = watchProgress();
    controller.setInput(input({ session: "build" }));

    expect(latest()).toBeNull();
  });

  it("settles the pile and keeps rendering it", async () => {
    controller.setModel(buildableModel());
    controller.setInput(input({ session: "build" }));

    await run(4);

    expect(
      (controller as unknown as { renderer: FakeRenderer }).renderer.renders
    ).toBeGreaterThan(0);
  });

  it("picks a saved build up where it was left", async () => {
    const model = buildableModel();
    writeBuild({
      bricks: 4,
      // Spaced apart: two bricks restored on top of each other would shove
      // themselves off the spot the save recorded.
      loose: [2, 200, 24, 30, 0, 0, 0, 1, 3, -200, 24, 30, 0, 0, 0, 1],
      placed: [0, 1],
      slug: "test-build",
      step: 1,
      steps: 2,
      title: "Test Model",
      updatedAt: 1,
      v: 1,
    });

    const latest = watchProgress();
    controller.setModel(model);
    controller.setInput(input({ session: "build" }));
    await run();

    expect(latest()).toMatchObject({
      loose: 2,
      placedTotal: 2,
      resumed: true,
      step: 1,
    });
    // The pile came back where the save left it, rather than being re-poured.
    expect(model.bricks[2].object.position.x).toBeCloseTo(200, 0);
  });

  it("refuses a save written against a different model", () => {
    writeBuild({
      bricks: 99,
      loose: [],
      placed: [0, 1],
      slug: "test-build",
      step: 1,
      steps: 2,
      title: "Test Model",
      updatedAt: 1,
      v: 1,
    });

    const latest = watchProgress();
    controller.setModel(buildableModel());
    controller.setInput(input({ session: "build" }));

    expect(latest()).toMatchObject({ placedTotal: 0, resumed: false, step: 0 });
  });

  it("falls back to the floor layout when a save has no pile in it", async () => {
    const model = buildableModel();
    writeBuild({
      bricks: 4,
      loose: [],
      placed: [0, 1],
      slug: "test-build",
      step: 1,
      steps: 2,
      title: "Test Model",
      updatedAt: 1,
      v: 1,
    });

    controller.setModel(model);
    controller.setInput(input({ session: "build" }));
    await run();

    expect(model.bricks[2].object.position.x).toBeCloseTo(
      model.bricks[2].floorPose.position.x,
      0
    );
  });

  it("throws a build away and starts again", () => {
    const latest = watchProgress();
    controller.setModel(buildableModel());
    controller.setInput(input({ session: "build" }));
    writeBuild({
      bricks: 4,
      loose: [],
      placed: [0, 1],
      slug: "test-build",
      step: 1,
      steps: 2,
      title: "Test Model",
      updatedAt: 1,
      v: 1,
    });

    controller.resetBuild();

    expect(readBuild("test-build")).toBeNull();
    expect(latest()).toMatchObject({ placedTotal: 0, resumed: false, step: 0 });
  });

  it("never saves a dropped file, which could not be resumed anyway", () => {
    const model = makeModel({ bricks: [{ step: 0 }], slug: "local-abc123" });
    controller.setModel(model);
    controller.setInput(input({ session: "build" }));

    controller.dispose();

    expect(readBuild("local-abc123")).toBeNull();
  });

  it("hands the pile back to the watch flow when build mode is left", () => {
    const latest = watchProgress();
    controller.setModel(buildableModel());
    controller.setInput(input({ session: "build" }));

    controller.setInput(input({ session: "watch" }));

    expect(latest()).toMatchObject({ totalSteps: 0, unavailable: false });
    // The build was written out on the way past.
    expect(readBuild("test-build")).not.toBeNull();
  });

  it("ignores a scrub while a build is in progress", () => {
    const latest = watchProgress();
    controller.setModel(buildableModel());
    controller.setInput(input({ session: "build" }));

    controller.setInput(input({ session: "build", step: 5 }));

    expect(latest()?.step).toBe(0);
  });

  it("settles the pour outright when motion is not wanted", () => {
    vi.unstubAllGlobals();
    stubBrowser(true);
    const model = buildableModel();
    controller.setModel(model);
    controller.setInput(input({ session: "build" }));

    // No frames have run, yet the bricks are already down rather than mid-air.
    expect(model.bricks[0].object.position.y).toBeLessThan(60);
  });
});

/**
 * Aim the camera straight down at a point, so a pointer at the middle of the
 * canvas casts a ray through it. Framing normally puts the camera on a diagonal,
 * which makes "where does the middle of the screen land" a trigonometry problem
 * rather than a fact.
 */
function lookDownAt(x: number, y: number, z: number): void {
  const scene = controller as unknown as {
    camera: {
      lookAt: (x: number, y: number, z: number) => void;
      position: { set: (x: number, y: number, z: number) => void };
      updateMatrixWorld: (force: boolean) => void;
    };
    controls: { target: { set: (x: number, y: number, z: number) => void } };
  };
  scene.camera.position.set(x, y + 400, z);
  scene.controls.target.set(x, y, z);
  scene.camera.lookAt(x, y, z);
  scene.camera.updateMatrixWorld(true);
}

const pointer = (type: string, over: Partial<PointerEventInit> = {}) =>
  new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    cancelable: true,
    clientX: VIEWPORT.width / 2,
    clientY: VIEWPORT.height / 2,
    pointerId: 1,
    ...over,
  });

describe("SceneController dragging", () => {
  beforeEach(() => {
    // Settle the pour outright: these tests are about what happens once the
    // bricks are down, and a pile still in the air is a different test.
    vi.unstubAllGlobals();
    stubBrowser(true);
  });

  /** One brick, so the framing and the raycast both land on it. */
  const oneBrick = () => {
    const model = makeModel({ bricks: [{ at: [0, 24, 0], step: 0 }] });
    // Put the loose brick where the model is, so looking at one is looking at
    // the other and the ray hits whichever is there.
    model.bricks[0].floorPose.position.set(0, 24, 0);
    return model;
  };

  /**
   * Open a build and look straight down at where a brick actually came to rest.
   *
   * The pour is a physics simulation, so a brick lands near its layout spot
   * rather than on it. Aiming at the spot it was headed for would make these
   * tests depend on how the dice fell.
   */
  const startBuild = async (model = oneBrick(), lookAt = 0) => {
    controller.setModel(model);
    controller.setInput(input({ session: "build" }));
    await run();
    // Aim at the middle of the brick's box, not its origin: LDraw origins sit on
    // the top face, and a brick that landed on its side puts that face
    // edge-on to a ray coming straight down.
    const { x, y, z } = new Box3()
      .setFromObject(model.bricks[lookAt].object)
      .getCenter(new Vector3());
    lookDownAt(x, y, z);
    return model;
  };

  it("takes hold of the brick under the pointer", async () => {
    const model = await startBuild();

    canvas.dispatchEvent(pointer("pointerdown"));

    const held = controller as unknown as { drag: { brickId: number } | null };
    expect(held.drag?.brickId).toBe(0);
    expect(canvas.style.cursor).toBe("grabbing");
    window.dispatchEvent(pointer("pointerup"));
    expect(model.bricks[0].object.visible).toBe(true);
  });

  it("leaves the camera alone when the pointer misses every brick", async () => {
    await startBuild();
    lookDownAt(5000, 24, 5000);

    canvas.dispatchEvent(pointer("pointerdown"));

    const held = controller as unknown as { drag: unknown };
    expect(held.drag).toBeNull();
  });

  it("ignores anything but the primary button", async () => {
    await startBuild();

    canvas.dispatchEvent(pointer("pointerdown", { button: 2 }));

    expect((controller as unknown as { drag: unknown }).drag).toBeNull();
  });

  it("carries the brick to where the pointer went", async () => {
    const model = await startBuild();
    canvas.dispatchEvent(pointer("pointerdown"));

    window.dispatchEvent(
      pointer("pointermove", { clientX: VIEWPORT.width / 2 + 120 })
    );
    await run();

    expect(model.bricks[0].object.position.x).toBeGreaterThan(20);
    window.dispatchEvent(pointer("pointerup"));
  });

  it("raises and lowers what is being carried on the wheel", async () => {
    await startBuild();
    canvas.dispatchEvent(pointer("pointerdown"));
    const held = controller as unknown as { drag: { hover: number } };
    const before = held.drag.hover;

    window.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -1 })
    );

    expect(held.drag.hover).toBeGreaterThan(before);
    window.dispatchEvent(pointer("pointerup"));
  });

  it("drops a brick into the slot it is carried over", async () => {
    const latest = watchProgress();
    const model = await startBuild();

    canvas.dispatchEvent(pointer("pointerdown"));
    // Carry it over the slot. The pointer stays put and the camera moves, which
    // with a vertical ray is the same thing as dragging it there.
    lookDownAt(0, 24, 0);
    window.dispatchEvent(pointer("pointermove"));
    await run(8);
    window.dispatchEvent(pointer("pointerup"));

    expect(latest()).toMatchObject({ done: true, placedTotal: 1, step: 1 });
    expect(model.bricks[0].object.position.toArray()).toEqual([0, 24, 0]);
  });

  it("lets a brick go without placing it when it is nowhere near a slot", async () => {
    const latest = watchProgress();
    const model = makeModel({
      bricks: [
        { at: [0, 24, 0], step: 0 },
        { at: [4000, 24, 4000], step: 1 },
      ],
    });
    model.bricks[1].floorPose.position.set(4000, 24, 4000);
    await startBuild(model, 1);

    canvas.dispatchEvent(pointer("pointerdown"));
    await run();
    window.dispatchEvent(pointer("pointerup"));

    expect(latest()?.placedTotal).toBe(0);
  });

  it("sends a brick home when it is pressed twice", async () => {
    const latest = watchProgress();
    await startBuild();

    canvas.dispatchEvent(pointer("pointerdown"));
    window.dispatchEvent(pointer("pointerup"));
    canvas.dispatchEvent(pointer("pointerdown"));
    window.dispatchEvent(pointer("pointerup"));
    await run(40);

    expect(latest()?.placedTotal).toBe(1);
  });

  it("lights up the loose bricks a hint asks for", async () => {
    const model = makeModel({
      bricks: [
        { at: [0, 24, 0], colorCode: 4, step: 0 },
        { at: [80, 24, 0], colorCode: 4, step: 1 },
      ],
    });
    await startBuild(model);
    const plain = model.bricks[0].meshes[0].material;

    controller.setInput(input({ hint: "*", session: "build" }));
    await run();

    expect(model.bricks[0].meshes[0].material).not.toBe(plain);
  });

  it("lights up nothing when the hint is off", async () => {
    const model = await startBuild();
    const plain = model.bricks[0].meshes[0].material;

    controller.setInput(input({ hint: null, session: "build" }));
    await run();

    expect(model.bricks[0].meshes[0].material).toBe(plain);
  });
});

describe("SceneController watch mode", () => {
  it("frames the table while assembling and the model while inspecting", () => {
    controller.setModel(buildableModel());
    const { camera } = controller as unknown as {
      camera: { position: { length: () => number } };
    };

    controller.setInput(input({ mode: "assemble" }));
    const table = camera.position.length();
    controller.setInput(input({ mode: "explode" }));

    // The whole table is a bigger thing to fit on screen than the model alone.
    expect(camera.position.length()).not.toBeCloseTo(table, 3);
  });

  it("lands on a scrubbed step rather than replaying the drop into it", async () => {
    const model = buildableModel();
    controller.setModel(model);
    controller.setInput(input());
    await run();

    controller.setInput(input({ step: 2 }));
    await run();

    // Everything is in the model, and nothing is still falling towards it.
    for (const brick of model.bricks) {
      expect(brick.object.position.toArray()).toEqual(
        brick.builtPose.position.toArray()
      );
    }
  });

  it("plays the build forward and says which step it reached", async () => {
    const model = buildableModel();
    const steps: number[] = [];
    controller.setCallbacks({ onStepAdvance: (step) => steps.push(step) });
    controller.setModel(model);
    controller.setInput(input({ playing: true, speed: 4 }));

    await run(60);

    expect(steps.length).toBeGreaterThan(0);
  });

  it("reports when there is nothing left to play", async () => {
    // Skip the pour: playback does not start until the bricks are down.
    vi.unstubAllGlobals();
    stubBrowser(true);
    const finished = vi.fn();
    controller.setCallbacks({ onFinished: finished });
    controller.setModel(buildableModel());
    controller.setInput(input({ playing: true, step: 2 }));

    await run(20);

    expect(finished).toHaveBeenCalled();
  });

  it("re-frames on request, and toggles between the two framings", () => {
    controller.setModel(buildableModel());
    controller.setInput(input());
    const { camera } = controller as unknown as {
      camera: { position: { length: () => number } };
    };

    const before = camera.position.length();
    controller.frameModel(true);

    expect(camera.position.length()).not.toBeCloseTo(before, 3);
  });

  it("repaints the canvas for the theme it is asked for", () => {
    controller.setModel(buildableModel());

    expect(() => controller.setTheme()).not.toThrow();
  });

  it("takes hover from the parts list when the pointer is elsewhere", () => {
    const model = buildableModel();
    controller.setModel(model);
    controller.setInput(input());

    controller.setHovered(1);

    expect(
      (controller as unknown as { hoveredBrick: number | null }).hoveredBrick
    ).toBe(1);
  });

  it("survives being handed no model at all", () => {
    expect(() => controller.setModel(null)).not.toThrow();
    expect(() => controller.frameModel()).not.toThrow();
  });

  it("resizes, and ignores a window with no area", () => {
    expect(() => controller.resize(0, 0)).not.toThrow();
    expect(() => controller.resize(1024, 768)).not.toThrow();
  });
});

describe("SceneController without physics", () => {
  it("says so rather than pretending", async () => {
    const module = await import("./physics");
    const spy = vi.spyOn(module, "getPhysics").mockReturnValue(null);
    const latest = watchProgress();

    controller.setModel(buildableModel());
    controller.setInput(input({ session: "build" }));

    expect(latest()?.unavailable).toBe(true);
    spy.mockRestore();
  });
});
