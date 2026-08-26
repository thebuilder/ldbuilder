// @vitest-environment jsdom
import { Box3, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { frames, stubBrowser } from "@/test/domStubs";
import type { Viewport as ViewportClass } from "./Viewport";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  const stubs = await import("@/test/domStubs");
  return {
    ...actual,
    PMREMGenerator: stubs.FakePmrem,
    WebGLRenderer: stubs.FakeRenderer,
  };
});

let canvas: HTMLCanvasElement;
let viewport: ViewportClass;
let Viewport: typeof ViewportClass;

beforeEach(async () => {
  stubBrowser();
  ({ Viewport } = await import("./Viewport"));
  canvas = document.createElement("canvas");
  document.body.append(canvas);
  viewport = new Viewport(canvas);
  viewport.resize(800, 600);
});

afterEach(() => {
  viewport.dispose();
  canvas.remove();
  vi.unstubAllGlobals();
});

const press = (code: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code,
      ...init,
    })
  );

const release = (code: string) =>
  window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, code }));

/** How far the camera has travelled after a few frames of a key being held. */
function travel(code: string, init: KeyboardEventInit = {}) {
  const from = viewport.camera.position.clone();
  press(code, init);
  for (let i = 0; i < 6; i += 1) {
    viewport.updateNavigation(1 / 60);
  }
  release(code);
  return viewport.camera.position.distanceTo(from);
}

describe("Viewport", () => {
  it("puts a box on screen with room around it", () => {
    const box = new Box3(new Vector3(-50, 0, -50), new Vector3(50, 40, 50));

    viewport.frameBox(box);

    const { camera, controls } = viewport;
    expect(controls.target.x).toBeCloseTo(0, 5);
    expect(camera.position.distanceTo(controls.target)).toBeGreaterThan(50);
  });

  it("ignores a box with nothing in it", () => {
    const before = viewport.camera.position.clone();

    viewport.frameBox(new Box3());

    expect(viewport.camera.position).toEqual(before);
  });

  it("walks the camera across the floor", () => {
    expect(travel("KeyW")).toBeGreaterThan(0);
    expect(travel("KeyA")).toBeGreaterThan(0);
  });

  it("goes further with shift held", () => {
    const plain = travel("KeyW");
    const boosted = travel("KeyW", { shiftKey: true });

    // Shift is recorded from its own keydown, so hold it for real.
    press("ShiftLeft");
    const held = travel("KeyW");
    release("ShiftLeft");

    expect(boosted).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(plain);
  });

  it("keeps the camera above the floor", () => {
    viewport.camera.position.set(0, 1, 0);
    viewport.controls.target.set(0, 0, 0);
    press("KeyQ");
    for (let i = 0; i < 30; i += 1) {
      viewport.updateNavigation(1 / 60);
    }
    release("KeyQ");

    expect(viewport.camera.position.y).toBeGreaterThanOrEqual(2);
  });

  it("stands aside for a focused control", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const before = viewport.camera.position.clone();

    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "ArrowUp" })
    );
    viewport.updateNavigation(1 / 60);

    expect(viewport.camera.position).toEqual(before);
    input.remove();
  });

  it("leaves the arrows alone when something else is using them", () => {
    viewport.setOptions({ wantsArrows: () => false });
    const before = viewport.camera.position.clone();

    press("ArrowUp");
    viewport.updateNavigation(1 / 60);
    release("ArrowUp");

    expect(viewport.camera.position).toEqual(before);
    // The letter keys still belong to the camera.
    expect(travel("KeyW")).toBeGreaterThan(0);
  });

  it("ignores a browser shortcut", () => {
    const before = viewport.camera.position.clone();

    press("KeyW", { metaKey: true });
    viewport.updateNavigation(1 / 60);

    expect(viewport.camera.position).toEqual(before);
  });

  it("forgets keys held while the window loses focus", () => {
    press("KeyW");
    window.dispatchEvent(new Event("blur"));
    const before = viewport.camera.position.clone();

    for (let i = 0; i < 10; i += 1) {
      viewport.updateNavigation(1 / 60);
    }

    expect(viewport.camera.position.distanceTo(before)).toBeLessThan(0.001);
  });

  it("says when the viewer has taken the camera themselves", () => {
    const onUserMove = vi.fn();
    viewport.setOptions({ onUserMove });

    press("KeyW");
    release("KeyW");

    expect(onUserMove).toHaveBeenCalled();
  });

  it("rebuilds the floor for a theme change", () => {
    const before = viewport.scene.children.length;

    viewport.setTheme();

    expect(viewport.scene.children).toHaveLength(before);
  });

  it("ignores a window with no area", () => {
    expect(() => viewport.resize(0, 0)).not.toThrow();
  });

  it("draws when asked", async () => {
    const renderer = viewport.renderer as unknown as { renders: number };
    const before = renderer.renders;

    viewport.render();
    await frames(1);

    expect(renderer.renders).toBe(before + 1);
  });
});
