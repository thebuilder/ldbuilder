// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildProgress, ModelData } from "@/ldraw/types";
import type { SceneCallbacks } from "@/scene/SceneController";
import { makeModel } from "@/test/fixtures";
import { BuilderClient } from "./BuilderClient";

/** Handed to the fake stage so a test can drive the scene's callbacks. */
const scene: {
  callbacks: SceneCallbacks | null;
  buildReset: number;
  session: string;
  hint: string | null;
} = { buildReset: 0, callbacks: null, hint: null, session: "watch" };

vi.mock("./Stage", () => ({
  Stage: (props: {
    buildReset: number;
    callbacks: SceneCallbacks;
    input: { hint: string | null; session: string };
  }) => {
    scene.callbacks = props.callbacks;
    scene.buildReset = props.buildReset;
    scene.session = props.input.session;
    scene.hint = props.input.hint;
    return <div data-testid="stage" />;
  },
}));

const loaded: { model: ModelData | null; error: Error | null } = {
  error: null,
  model: null,
};

vi.mock("@/ldraw/loadModel", () => ({
  disposeModel: vi.fn(),
  loadModel: () => {
    if (loaded.error) {
      return Promise.reject(loaded.error);
    }
    return Promise.resolve(loaded.model);
  },
}));

vi.mock("@/scene/physics", () => ({ loadPhysics: () => Promise.resolve({}) }));

const model = () =>
  makeModel({
    bricks: [
      { at: [0, 24, 0], colorCode: 4, step: 0 },
      { at: [80, 24, 0], colorCode: 4, step: 1 },
    ],
    slug: "pyramid",
    title: "Example Pyramid",
  });

const meta = {
  blurb: "",
  bricks: 2,
  bytes: 0,
  credit: "",
  slug: "pyramid",
  steps: 2,
  title: "Example Pyramid",
  uniqueParts: 1,
  userSupplied: false,
};

const wrapper = (search: string) => (props: { children: ReactNode }) => (
  <NuqsTestingAdapter searchParams={search}>
    {props.children}
  </NuqsTestingAdapter>
);

const open = async (search = "") => {
  const view = render(<BuilderClient meta={meta} slug="pyramid" />, {
    wrapper: wrapper(search),
  });
  await screen.findByText("Example Pyramid");
  return view;
};

const progress = (over: Partial<BuildProgress> = {}): BuildProgress => ({
  bag: 0,
  done: false,
  loose: 2,
  pending: [0],
  placedTotal: 0,
  resumed: false,
  step: 0,
  totalBags: 1,
  totalSteps: 2,
  unavailable: false,
  ...over,
});

beforeEach(() => {
  loaded.model = model();
  loaded.error = null;
  scene.callbacks = null;
});

afterEach(cleanup);

describe("BuilderClient", () => {
  it("shows a load screen until the model arrives", async () => {
    render(<BuilderClient meta={meta} slug="pyramid" />, {
      wrapper: wrapper(""),
    });

    expect(screen.getByText("Loading")).toBeDefined();
    await screen.findByText("Example Pyramid");
  });

  it("opens in the watch flow with a scrubber", async () => {
    await open();

    expect(screen.getByLabelText("Build step")).toBeDefined();
    expect(scene.session).toBe("watch");
  });

  it("opens straight into build mode when the url says so", async () => {
    await open("?flow=build");

    expect(scene.session).toBe("build");
    expect(screen.queryByLabelText("Build step")).toBeNull();
  });

  it("switches flow, and drops the scrubber on the way", async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByTitle(/put the model together yourself/));

    await waitFor(() => expect(scene.session).toBe("build"));
    expect(screen.queryByLabelText("Build step")).toBeNull();
  });

  it("opens the parts list on the step when the build starts", async () => {
    const user = userEvent.setup();
    await open();

    // Watching is a question about the model, so the list starts on all of it.
    expect(screen.getByText("All").dataset.active).toBe("true");

    await user.click(screen.getByTitle(/put the model together yourself/));

    // Building is a question about one step: what am I looking for now.
    await waitFor(() =>
      expect(screen.getByText("Step").dataset.active).toBe("true")
    );
  });

  it("shows what the step needs once the scene reports progress", async () => {
    await open("?flow=build");

    scene.callbacks?.onBuildProgress?.(progress());

    expect(await screen.findByText(/on the floor/)).toBeDefined();
  });

  it("says a build was picked up, and lets the notice be dismissed", async () => {
    const user = userEvent.setup();
    await open("?flow=build");

    scene.callbacks?.onBuildProgress?.(progress({ resumed: true, step: 1 }));
    const notice = await screen.findByText(/Picked your build up/);
    expect(notice).toBeDefined();

    await user.click(screen.getByLabelText("Dismiss"));

    expect(screen.queryByText(/Picked your build up/)).toBeNull();
  });

  it("asks the scene to start the build again", async () => {
    const user = userEvent.setup();
    await open("?flow=build");
    scene.callbacks?.onBuildProgress?.(progress());
    const before = scene.buildReset;

    await user.click(await screen.findByTitle(/Throw the build away/));

    await waitFor(() => expect(scene.buildReset).toBe(before + 1));
  });

  it("offers a way out when the physics engine is missing", async () => {
    const user = userEvent.setup();
    await open("?flow=build");

    scene.callbacks?.onBuildProgress?.(progress({ unavailable: true }));
    await user.click(await screen.findByText("Watch instead"));

    await waitFor(() => expect(scene.session).toBe("watch"));
  });

  it("turns the hint on and off with the F key", async () => {
    const user = userEvent.setup();
    await open("?flow=build");
    scene.callbacks?.onBuildProgress?.(progress());

    await user.keyboard("f");
    await waitFor(() => expect(scene.hint).toBe("*"));

    await user.keyboard("f");
    await waitFor(() => expect(scene.hint).toBeNull());
  });

  it("leaves F alone in the watch flow", async () => {
    const user = userEvent.setup();
    await open();

    await user.keyboard("f");

    expect(scene.hint).toBeNull();
  });

  it("steps back and forward on the bracket keys", async () => {
    const user = userEvent.setup();
    await open();

    await user.keyboard("{PageDown}");
    expect(await screen.findByText("2")).toBeDefined();

    await user.keyboard("{PageUp}");
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
  });

  it("ignores the step keys while building", async () => {
    const user = userEvent.setup();
    await open("?flow=build");
    scene.callbacks?.onBuildProgress?.(progress());

    await user.keyboard("{PageDown}");

    // Build mode reaches a step by building up to it.
    expect(screen.queryByLabelText("Build step")).toBeNull();
  });

  it("plays and pauses on the space bar", async () => {
    const user = userEvent.setup();
    await open();

    await user.keyboard(" ");

    expect(await screen.findByText("Pause")).toBeDefined();
  });

  it("stands aside for a focused control", async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByLabelText("Build step"));
    await user.keyboard(" ");

    // The scrubber owns its own keys.
    expect(screen.queryByText("Pause")).toBeNull();
  });

  it("advances the step when the scene says a step is done", async () => {
    await open();

    scene.callbacks?.onStepAdvance?.(1);

    expect(await screen.findByText("2")).toBeDefined();
  });

  it("stops playing when the scene reaches the end", async () => {
    const user = userEvent.setup();
    await open();
    await user.keyboard(" ");
    await screen.findByText("Pause");

    scene.callbacks?.onFinished?.();

    await waitFor(() => expect(screen.queryByText("Pause")).toBeNull());
  });

  it("inspects the brick under the pointer", async () => {
    await open();

    scene.callbacks?.onHover?.(0);

    expect(await screen.findByText("Brick 2 x 4")).toBeDefined();
  });

  it("says so when the model will not load", async () => {
    loaded.error = new Error("could not load pyramid.mpd");

    render(<BuilderClient meta={meta} slug="pyramid" />, {
      wrapper: wrapper(""),
    });

    expect(await screen.findByText("Could not load")).toBeDefined();
    expect(screen.getByText(/could not load pyramid.mpd/)).toBeDefined();
  });

  it("tells someone who reloaded a dropped file what happened", async () => {
    render(<BuilderClient meta={null} slug="local-abc" />, {
      wrapper: wrapper(""),
    });

    expect(await screen.findByText(/no longer in memory/)).toBeDefined();
  });
});
