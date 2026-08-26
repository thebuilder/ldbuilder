// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarriedInfo, FreeController } from "@/scene/FreeController";
import { stubBrowser } from "@/test/domStubs";
import { CarryHud } from "./CarryHud";
import { FreeStage } from "./FreeStage";
import { useFreeKeys } from "./useFreeKeys";

beforeEach(() => stubBrowser());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const carrying = (over: Partial<CarriedInfo> = {}): CarriedInfo => ({
  blocked: false,
  colorCode: 4,
  file: "3001.dat",
  name: "Brick 2 x 4",
  nudge: { x: 0, y: 0, z: 0 },
  tip: 0,
  yaw: 0,
  ...over,
});

describe("CarryHud", () => {
  it("says what is in hand and how it is turned", () => {
    render(<CarryHud carrying={carrying({ yaw: 2 })} loose={0} placed={3} />);

    expect(screen.getByText("Brick 2 x 4")).toBeDefined();
    expect(screen.getByText("Red")).toBeDefined();
    expect(screen.getByText("180°")).toBeDefined();
  });

  it("reads out a tip only when the part is tipped", () => {
    // "Tip" is also the label on the T key, so the readout is the thing to look
    // for rather than the word.
    render(<CarryHud carrying={carrying()} loose={0} placed={0} />);
    expect(screen.queryByText("90°")).toBeNull();
    cleanup();

    render(<CarryHud carrying={carrying({ tip: 1 })} loose={0} placed={0} />);
    expect(screen.getByText("90°")).toBeDefined();
  });

  it("warns rather than inviting a click when the part will not fit", () => {
    render(
      <CarryHud carrying={carrying({ blocked: true })} loose={0} placed={0} />
    );

    expect(screen.getByText("Will not fit here")).toBeDefined();
    expect(screen.queryByText("Click to place")).toBeNull();
  });

  it("counts the build when nothing is in hand", () => {
    render(<CarryHud carrying={null} loose={7} placed={12} />);

    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.getByText(/pick it up/)).toBeDefined();
  });

  it("counts nothing when the floor is clear", () => {
    render(<CarryHud carrying={null} loose={0} placed={1} />);

    // The hint below still mentions the floor, so count the numbers instead.
    expect(screen.getAllByText("1")).toHaveLength(1);
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("useFreeKeys", () => {
  const setup = (over: Partial<Parameters<typeof useFreeKeys>[0]> = {}) => {
    const scene = {
      cancelCarry: vi.fn(),
      deleteCarried: vi.fn(),
      nudge: vi.fn(),
      rotate: vi.fn(),
    } as unknown as FreeController;
    const ref = createRef<FreeController | null>() as {
      current: FreeController | null;
    };
    ref.current = scene;
    const onSlot = vi.fn();
    renderHook(() =>
      useFreeKeys({
        carrying: carrying(),
        controller: ref,
        onSlot,
        slots: 9,
        ...over,
      })
    );
    return { onSlot, scene };
  };

  const press = (code: string, init: KeyboardEventInit = {}) =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code,
        ...init,
      })
    );

  it("reaches for a hotbar slot on its number", () => {
    const { onSlot } = setup();

    press("Digit3");

    expect(onSlot).toHaveBeenCalledWith(2);
  });

  it("ignores a number past the end of the hotbar", () => {
    const { onSlot } = setup({ slots: 2 });

    press("Digit9");

    expect(onSlot).not.toHaveBeenCalled();
  });

  it("turns and tips, and reverses with shift", () => {
    const { scene } = setup();

    press("KeyR");
    expect(scene.rotate).toHaveBeenCalledWith(1, 0);

    press("KeyR", { shiftKey: true });
    expect(scene.rotate).toHaveBeenCalledWith(-1, 0);

    press("KeyT");
    expect(scene.rotate).toHaveBeenCalledWith(0, 1);
  });

  it("puts a part back, and throws one away", () => {
    const { scene } = setup();

    press("Escape");
    expect(scene.cancelCarry).toHaveBeenCalled();

    press("Delete");
    expect(scene.deleteCarried).toHaveBeenCalled();
  });

  it("nudges by the arrows and the page keys", () => {
    const { scene } = setup();

    press("ArrowLeft");
    expect(scene.nudge).toHaveBeenCalledWith(-1, 0, 0);

    press("PageUp");
    expect(scene.nudge).toHaveBeenCalledWith(0, 1, 0);
  });

  it("leaves the arrows to the camera when nothing is in hand", () => {
    const { scene } = setup({ carrying: null });

    press("ArrowLeft");

    expect(scene.nudge).not.toHaveBeenCalled();
  });

  it("stands aside for a focused control", () => {
    const { scene } = setup();
    const input = document.createElement("input");
    document.body.append(input);

    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "KeyR" })
    );

    expect(scene.rotate).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignores a browser shortcut", () => {
    const { scene } = setup();

    press("KeyR", { metaKey: true });

    expect(scene.rotate).not.toHaveBeenCalled();
  });
});

describe("FreeStage", () => {
  it("hands the controller up once it is open, and takes it back", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const dispose = vi.fn();
    const controller = {
      dispose,
      open,
      resize: vi.fn(),
      setCallbacks: vi.fn(),
      start: vi.fn(),
    };
    // `new` is what the stage calls, so the mock has to be constructible.
    const asController = function stub(this: Record<string, unknown>) {
      Object.assign(this, controller);
    } as unknown as new () => FreeController;
    vi.doMock("@/scene/FreeController", () => ({
      FreeController: asController,
    }));

    const seen: (FreeController | null)[] = [];
    const { unmount } = render(
      <FreeStage
        callbacks={{}}
        onController={(next) => seen.push(next)}
        palette={
          {
            byFile: new Map(),
            groups: [],
            materials: () => ({ edge: null, surface: null }),
          } as never
        }
      />
    );

    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    unmount();

    await vi.waitFor(() => expect(dispose).toHaveBeenCalled());
    expect(seen.at(-1)).toBeNull();
    vi.doUnmock("@/scene/FreeController");
  });
});
