// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildProgress } from "@/ldraw/types";
import { makeModel } from "@/test/fixtures";
import { BuildPanel } from "./BuildPanel";

afterEach(cleanup);

const model = makeModel({
  bricks: [
    { at: [0, 24, 0], colorCode: 4, step: 0 },
    { at: [80, 24, 0], colorCode: 4, step: 0 },
    { at: [0, 48, 0], colorCode: 1, partFile: "3003.dat", step: 1 },
  ],
});

const progress = (over: Partial<BuildProgress> = {}): BuildProgress => ({
  bag: 0,
  done: false,
  loose: 3,
  pending: [0, 1, 2],
  placedTotal: 0,
  resumed: false,
  step: 0,
  totalBags: 1,
  totalSteps: 2,
  unavailable: false,
  ...over,
});

const panel = (over: Partial<BuildProgress> = {}, props = {}) =>
  render(
    <BuildPanel
      bricks={model.bricks}
      hint={null}
      onHint={vi.fn()}
      onReset={vi.fn()}
      progress={progress(over)}
      totalBricks={3}
      {...props}
    />
  );

describe("BuildPanel", () => {
  it("names the step and how far in the build is", () => {
    panel({ placedTotal: 1, step: 1 });

    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText(/\/ 2/)).toBeDefined();
    expect(screen.getByText(/placed/)).toBeDefined();
  });

  it("collapses the pending slots into one row per part and colour", () => {
    panel();

    // Two identical bricks are one thing to go and find, not two.
    expect(screen.getByText("2×")).toBeDefined();
    expect(screen.getByText("1×")).toBeDefined();
  });

  it("shows the bag only when there is more than one", () => {
    panel();
    expect(screen.queryByText(/Bag/)).toBeNull();
    cleanup();

    panel({ totalBags: 4 });
    expect(screen.getByText(/Bag/)).toBeDefined();
  });

  it("says how many bricks are still on the floor", () => {
    panel({ loose: 7 });

    expect(screen.getByText(/on the floor/)).toBeDefined();
  });

  it("says nothing about the floor once it is clear", () => {
    panel({ loose: 0 });

    expect(screen.queryByText(/on the floor/)).toBeNull();
  });

  it("reports a finished build instead of a step", () => {
    panel({ done: true, pending: [], placedTotal: 3, step: 2 });

    expect(screen.getByText("Finished")).toBeDefined();
    expect(screen.getByText(/Every brick is in/)).toBeDefined();
  });

  it("turns the hint on and off again", async () => {
    const onHint = vi.fn();
    const user = userEvent.setup();
    panel({}, { onHint });

    await user.click(screen.getByTitle(/Light up every brick/));
    expect(onHint).toHaveBeenCalledWith("*");

    cleanup();
    panel({}, { hint: "*", onHint });
    await user.click(screen.getByTitle(/Light up every brick/));
    expect(onHint).toHaveBeenLastCalledWith(null);
  });

  it("cannot ask for a hint once there is nothing left to find", () => {
    panel({ done: true, pending: [] });

    expect(
      screen.getByTitle(/Light up every brick/).hasAttribute("disabled")
    ).toBe(true);
  });

  it("highlights one part when its row is hovered, and stops on the way out", async () => {
    const onHint = vi.fn();
    const user = userEvent.setup();
    const { rerender } = panel({}, { onHint });

    await user.hover(screen.getByText("1×"));
    expect(onHint).toHaveBeenCalledWith("3003.dat|1");

    rerender(
      <BuildPanel
        bricks={model.bricks}
        hint="3003.dat|1"
        onHint={onHint}
        onReset={vi.fn()}
        progress={progress()}
        totalBricks={3}
      />
    );
    await user.unhover(screen.getByText("1×"));
    expect(onHint).toHaveBeenLastCalledWith(null);
  });

  it("pins a part when its row is clicked", async () => {
    const onHint = vi.fn();
    const user = userEvent.setup();
    panel({}, { onHint });

    await user.click(screen.getByText("2×"));

    expect(onHint).toHaveBeenCalledWith("3001.dat|4");
  });

  it("offers to start the build again", async () => {
    const onReset = vi.fn();
    const user = userEvent.setup();
    panel({}, { onReset });

    await user.click(screen.getByText("Start over"));

    expect(onReset).toHaveBeenCalledOnce();
  });

  it("ignores a pending slot the model does not have", () => {
    panel({ pending: [0, 99] });

    expect(screen.getByText("1×")).toBeDefined();
  });
});
