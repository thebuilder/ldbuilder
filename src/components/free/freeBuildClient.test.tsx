// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Palette } from "@/ldraw/palette";
import type { FreeController, FreeProgress } from "@/scene/FreeController";
import { stubBrowser } from "@/test/domStubs";
import { MemoryStorage, makePalette } from "@/test/fixtures";
import { FreeBuildClient } from "./FreeBuildClient";

const palette: { value: Palette | null; error: Error | null } = {
  error: null,
  value: null,
};

vi.mock("@/ldraw/palette", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ldraw/palette")>()),
  loadPalette: () =>
    palette.error
      ? Promise.reject(palette.error)
      : Promise.resolve(palette.value),
}));

/** The scene, reduced to what the page can ask it to do. */
const scene = {
  arm: vi.fn(),
  clearAll: vi.fn(),
  clearLoose: vi.fn(),
  frame: vi.fn(),
  pourOut: vi.fn(),
  takeOut: vi.fn(),
  toLdraw: vi.fn(() => "0 empty\n"),
} as unknown as FreeController;

let report: ((progress: FreeProgress) => void) | null = null;

vi.mock("./FreeStage", () => ({
  FreeStage: (props: {
    callbacks: { onProgress?: (progress: FreeProgress) => void };
    onController: (controller: FreeController | null) => void;
  }) => {
    report = props.callbacks.onProgress ?? null;
    props.onController(scene);
    return <div data-testid="stage" />;
  },
}));

const progress = (over: Partial<FreeProgress> = {}): FreeProgress => ({
  carrying: null,
  loose: 0,
  placed: 0,
  problem: null,
  ready: true,
  ...over,
});

beforeEach(() => {
  stubBrowser();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  report = null;
  palette.error = null;
  palette.value = makePalette([
    { file: "3001.dat", partFile: "Brick 2 x 4", size: [2, 4] },
    { file: "3005.dat", partFile: "Brick 1 x 1", size: [1, 1] },
  ]);
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

const open = async () => {
  render(<FreeBuildClient />);
  await screen.findByText("Free build");
  // The stage hands its reporter up during render; nothing may use it before.
  await waitFor(() => expect(report).not.toBeNull());
};

describe("FreeBuildClient", () => {
  it("waits for the parts before showing a floor", () => {
    render(<FreeBuildClient />);

    expect(screen.getByText("The parts box")).toBeDefined();
  });

  it("says so when the parts cannot be unpacked", async () => {
    palette.error = new Error("run pnpm ldraw:palette");

    render(<FreeBuildClient />);

    expect(await screen.findByText(/pnpm ldraw:palette/)).toBeDefined();
    expect(screen.getByText("Free build is unavailable")).toBeDefined();
  });

  it("passes the scene's own problem through", async () => {
    await open();

    report?.(
      progress({ problem: "the physics engine could not load", ready: false })
    );

    expect(
      await screen.findByText(/the physics engine could not load/)
    ).toBeDefined();
  });

  it("opens onto the parts box and an empty build", async () => {
    await open();

    expect(screen.getByText("2 parts available")).toBeDefined();
    expect(screen.getByText("Brick 2 x 4")).toBeDefined();
    expect(screen.getByTestId("stage")).toBeDefined();
  });

  it("takes a part out in the chosen colour", async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByLabelText("Yellow"));
    await user.click(screen.getByText("Brick 2 x 4"));

    expect(scene.takeOut).toHaveBeenCalledWith("3001.dat", 14);
  });

  it("forgets what was armed when the colour changes", async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByLabelText("Blue"));

    expect(scene.arm).toHaveBeenCalledWith(null);
  });

  it("tips a handful onto the floor", async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByText("10"));
    await user.click(screen.getAllByTitle("Tip 10 onto the floor")[0]);

    expect(scene.pourOut).toHaveBeenCalledWith("3001.dat", 4, 10);
  });

  it("pins a part to the hotbar and reaches for it on its number", async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getAllByTitle(/hotbar/)[0]);
    expect(screen.getByTitle(/Brick 2 x 4 in Red/)).toBeDefined();

    await user.keyboard("1");

    expect(scene.takeOut).toHaveBeenCalledWith("3001.dat", 4);
  });

  it("keeps the hotbar across a visit", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getAllByTitle(/hotbar/)[0]);
    cleanup();

    await open();

    expect(screen.getByTitle(/Brick 2 x 4 in Red/)).toBeDefined();
  });

  it("counts the build as the scene reports it", async () => {
    await open();

    report?.(progress({ loose: 12, placed: 34 }));

    // The count appears both in the build panel and along the bottom.
    await waitFor(() => expect(screen.getAllByText("34")).toHaveLength(2));
    expect(screen.getAllByText("12")).toHaveLength(2);
  });

  it("says what is in hand", async () => {
    await open();

    report?.(
      progress({
        carrying: {
          blocked: false,
          colorCode: 4,
          file: "3001.dat",
          name: "Brick 2 x 4",
          nudge: { x: 0, y: 0, z: 0 },
          tip: 0,
          yaw: 1,
        },
      })
    );

    expect(await screen.findByText("Click to place")).toBeDefined();
    expect(screen.getByText("90°")).toBeDefined();
  });

  it("frames the build on request", async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByText("Frame"));

    expect(scene.frame).toHaveBeenCalled();
  });

  it("only offers to export and sweep once there is something to act on", async () => {
    await open();
    const disabled = (text: string) =>
      (screen.getByText(text).closest("button") as HTMLButtonElement).disabled;

    expect(disabled("Export")).toBe(true);
    expect(disabled("Sweep")).toBe(true);

    report?.(progress({ loose: 2, placed: 1 }));

    await waitFor(() => expect(disabled("Export")).toBe(false));
    expect(disabled("Sweep")).toBe(false);
  });

  it("asks before throwing a build away", async () => {
    const user = userEvent.setup();
    await open();
    report?.(progress({ placed: 3 }));

    await user.click(await screen.findByText("Clear"));
    expect(screen.getByText("Sure?")).toBeDefined();
    await user.click(screen.getByText("Sure?"));

    expect(scene.clearAll).toHaveBeenCalled();
  });

  it("sweeps the floor without asking, since nothing built is lost", async () => {
    const user = userEvent.setup();
    await open();
    report?.(progress({ loose: 4 }));

    await user.click(await screen.findByText("Sweep"));

    expect(scene.clearLoose).toHaveBeenCalled();
  });
});
