// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewControls, type ViewControlsProps } from "./ViewControls";

afterEach(cleanup);

const controls = (over: Partial<ViewControlsProps> = {}) => {
  const props: ViewControlsProps = {
    explode: 0.5,
    mode: "assemble",
    onExplode: vi.fn(),
    onFrame: vi.fn(),
    onMode: vi.fn(),
    onSession: vi.fn(),
    onSlice: vi.fn(),
    session: "watch",
    slice: 1,
    ...over,
  };
  return { ...render(<ViewControls {...props} />), props };
};

describe("ViewControls", () => {
  it("offers both flows and says which one is running", () => {
    controls({ session: "build" });

    const build = screen.getByTitle(/put the model together yourself/);
    expect(build.dataset.active).toBe("true");
    expect(screen.getByTitle(/assemble itself/).dataset.active).toBe("false");
  });

  it("switches flow", async () => {
    const user = userEvent.setup();
    const { props } = controls();

    await user.click(screen.getByTitle(/put the model together yourself/));

    expect(props.onSession).toHaveBeenCalledWith("build");
  });

  it("offers the view modes only while watching", () => {
    controls();
    expect(screen.getByText("Explode")).toBeDefined();
    cleanup();

    // In build mode the model is the thing you are in the middle of making.
    controls({ session: "build" });
    expect(screen.queryByText("Explode")).toBeNull();
  });

  it("switches view mode", async () => {
    const user = userEvent.setup();
    const { props } = controls();

    await user.click(screen.getByText("Slice"));

    expect(props.onMode).toHaveBeenCalledWith("slice");
  });

  it("shows a separation slider only when exploding", () => {
    controls({ mode: "explode" });

    expect(screen.getByLabelText("Separation")).toBeDefined();
    expect(screen.queryByLabelText("Cut height")).toBeNull();
  });

  it("shows a cut-height slider only when slicing", () => {
    controls({ mode: "slice" });

    expect(screen.getByLabelText("Cut height")).toBeDefined();
    expect(screen.queryByLabelText("Separation")).toBeNull();
  });

  it("hides both sliders in build mode, whatever the view mode was", () => {
    controls({ mode: "explode", session: "build" });

    expect(screen.queryByLabelText("Separation")).toBeNull();
  });

  it("reports a change to the separation", () => {
    const { props } = controls({ mode: "explode" });

    fireEvent.change(screen.getByLabelText("Separation"), {
      target: { value: "0.25" },
    });

    expect(props.onExplode).toHaveBeenCalledWith(0.25);
  });

  it("re-frames the camera", async () => {
    const user = userEvent.setup();
    const { props } = controls();

    await user.click(screen.getByText("Frame"));

    expect(props.onFrame).toHaveBeenCalledOnce();
  });

  it("lists the shortcuts for both flows", () => {
    controls();

    expect(screen.getByText("Shortcuts")).toBeDefined();
    expect(screen.getByText("In build mode")).toBeDefined();
    expect(screen.getByText("Throw it")).toBeDefined();
    expect(screen.getByText("Orbit")).toBeDefined();
  });
});
