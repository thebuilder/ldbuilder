import { vi } from "vitest";

/**
 * The bits of a browser that jsdom does not have but the scene controller does
 * not work without.
 *
 * A canvas in jsdom reports a zero-sized rect, which turns every pointer
 * coordinate into NaN, and `matchMedia` is absent entirely, which the
 * reduced-motion check needs.
 */
export const VIEWPORT = { height: 600, width: 800 };

export function stubBrowser(reducedMotion = false): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: reducedMotion && query.includes("reduce"),
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }));

  // OrbitControls captures the pointer on mousedown; jsdom has no such thing.
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.hasPointerCapture = () => false;

  // jsdom has no ResizeObserver, and every canvas here lives inside one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect(): void {
        // Nothing observed.
      }
      observe(): void {
        // Nothing to report: tests drive resize() directly.
      }
      unobserve(): void {
        // Nothing observed.
      }
    }
  );

  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({
      bottom: VIEWPORT.height,
      height: VIEWPORT.height,
      left: 0,
      right: VIEWPORT.width,
      toJSON: () => ({}),
      top: 0,
      width: VIEWPORT.width,
      x: 0,
      y: 0,
    }) as DOMRect;
}

/**
 * A `WebGLRenderer` that draws nothing.
 *
 * Everything under test is transforms, physics and state; the one thing that
 * genuinely needs a GPU is the part that puts pixels on the screen, and that is
 * checked by looking at it rather than by asserting on it.
 */
export class FakeRenderer {
  readonly domElement: HTMLCanvasElement;
  readonly shadowMap = { enabled: false, type: 0 };
  toneMapping = 0;
  toneMappingExposure = 1;
  renders = 0;

  constructor(parameters: { canvas: HTMLCanvasElement }) {
    this.domElement = parameters.canvas;
  }

  dispose(): void {
    // Nothing to release.
  }

  render(): void {
    this.renders += 1;
  }

  setPixelRatio(): void {
    // Nothing to scale.
  }

  setSize(): void {
    // Nothing to resize.
  }
}

/** Prefiltering an environment map needs a real renderer, and buys nothing here. */
export class FakePmrem {
  dispose(): void {
    // Nothing to release.
  }

  fromScene(): { texture: null } {
    return { texture: null };
  }
}

/** Wait for a handful of animation frames to run. */
export function frames(count = 3): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
