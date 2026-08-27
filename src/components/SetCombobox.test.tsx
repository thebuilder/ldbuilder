// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetCombobox } from "./SetCombobox";

/**
 * The index the component fetches on first focus.
 *
 * Rows are tuples in the same order public/omr-index.json declares, which is
 * the convention loadOmrIndex unpacks by position.
 */
const INDEX = {
  columns: ["setId", "name", "theme", "year"],
  sets: [
    ["928-1", "Galaxy Explorer", "Space > Classic Space", 1979],
    ["4488-1", "Millennium Falcon - Mini", "Star Wars", 2003],
    ["10179-1", "Millennium Falcon", "Star Wars > UCS", 2007],
    ["6074-1", "Black Falcon's Fortress", "Castle > Black Falcons", 1986],
  ],
};

const field = () => screen.getByRole("combobox");
const options = () => screen.queryAllByRole("option");
const highlighted = () =>
  options().find((o) => o.getAttribute("aria-selected") === "true");

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(INDEX)))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Render with a controlled value, the way OpenSetCard drives it. */
function setup(overrides: Partial<Parameters<typeof SetCombobox>[0]> = {}) {
  const onChange = vi.fn();
  const onPick = vi.fn();
  const props = { disabled: false, onChange, onPick, value: "", ...overrides };
  const view = render(<SetCombobox {...props} />);
  const rerenderWith = (value: string) =>
    view.rerender(<SetCombobox {...props} value={value} />);
  return { onChange, onPick, rerenderWith, user: userEvent.setup() };
}

/** Focus, type, and reflect the controlled value back, as the parent does. */
async function search(
  query: string,
  ctx: ReturnType<typeof setup>
): Promise<void> {
  await ctx.user.click(field());
  await ctx.user.type(field(), query);
  ctx.rerenderWith(query);
  await waitFor(() => expect(options().length).toBeGreaterThan(0));
}

describe("SetCombobox", () => {
  it("does not fetch the index until someone interacts with it", () => {
    setup();

    // 19KB that most visitors never need: they open a bundled model instead.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches the index on first focus", async () => {
    const ctx = setup();

    await ctx.user.click(field());

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/omr-index.json"));
  });

  it("shows no list before anything is typed", async () => {
    const ctx = setup();

    await ctx.user.click(field());

    expect(options()).toHaveLength(0);
  });

  it("suggests sets matching what was typed", async () => {
    const ctx = setup();

    await search("millennium", ctx);

    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining("4488-1"),
      expect.stringContaining("10179-1"),
    ]);
  });

  it("reports every keystroke to its parent", async () => {
    const ctx = setup();

    await ctx.user.click(field());
    await ctx.user.type(field(), "928");

    expect(ctx.onChange).toHaveBeenCalled();
  });

  it("marks itself expanded only while there is a list", async () => {
    const ctx = setup();
    expect(field()).toHaveAttribute("aria-expanded", "false");

    await search("millennium", ctx);

    expect(field()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("SetCombobox keyboard navigation", () => {
  it("highlights the first option on arrow down", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.keyboard("{ArrowDown}");

    expect(highlighted()).toHaveTextContent("4488-1");
  });

  it("points aria-activedescendant at the highlighted option", async () => {
    // Focus stays in the field, so this attribute is the only thing telling a
    // screen reader which row the arrow keys are on.
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.keyboard("{ArrowDown}");

    expect(field()).toHaveAttribute(
      "aria-activedescendant",
      highlighted()?.id ?? ""
    );
  });

  it("moves down the list", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.keyboard("{ArrowDown}{ArrowDown}");

    expect(highlighted()).toHaveTextContent("10179-1");
  });

  it("returns to the field when arrowing back off the top", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.keyboard("{ArrowDown}{ArrowUp}");

    expect(highlighted()).toBeUndefined();
    expect(field()).not.toHaveAttribute("aria-activedescendant");
  });

  it("wraps to the end when arrowing up past the field", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.keyboard("{ArrowUp}");

    expect(highlighted()).toHaveTextContent("10179-1");
  });

  it("closes the list on escape", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.keyboard("{Escape}");

    expect(options()).toHaveLength(0);
  });

  it("opens the list from the keyboard alone", async () => {
    const ctx = setup();
    await search("millennium", ctx);
    await ctx.user.keyboard("{Escape}");

    await ctx.user.keyboard("{ArrowDown}");

    expect(options().length).toBeGreaterThan(0);
  });
});

describe("SetCombobox picking", () => {
  it("opens the highlighted set on enter", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.keyboard("{ArrowDown}{Enter}");

    expect(ctx.onPick).toHaveBeenCalledWith("4488-1");
  });

  it("leaves enter to the form when nothing is highlighted", async () => {
    // That is how a set number the index has never heard of still opens.
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.keyboard("{Enter}");

    expect(ctx.onPick).not.toHaveBeenCalled();
  });

  it("opens a set clicked with the mouse", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.click(options()[1]);

    expect(ctx.onPick).toHaveBeenCalledWith("10179-1");
  });

  it("fills the field with the set number it picked", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.click(options()[0]);

    expect(ctx.onChange).toHaveBeenLastCalledWith("4488-1");
  });

  it("closes the list after picking", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.click(options()[0]);

    expect(options()).toHaveLength(0);
  });

  it("highlights whatever the mouse is over", async () => {
    const ctx = setup();
    await search("millennium", ctx);

    await ctx.user.hover(options()[1]);

    expect(highlighted()).toHaveTextContent("10179-1");
  });
});

describe("SetCombobox when busy", () => {
  it("disables the field while a set is being opened", () => {
    setup({ disabled: true });

    expect(field()).toBeDisabled();
  });
});
