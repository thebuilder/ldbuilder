// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePalette } from "@/test/fixtures";
import { ColorPicker } from "./ColorPicker";
import { Hotbar } from "./Hotbar";
import { PartsInventory } from "./PartsInventory";
import { StudIcon } from "./StudIcon";

afterEach(cleanup);

const palette = makePalette([
  { file: "3001.dat", partFile: "Brick 2 x 4", size: [2, 4] },
  { file: "3005.dat", partFile: "Brick 1 x 1", size: [1, 1] },
  { file: "3069b.dat", group: "tile", partFile: "Tile 1 x 2", size: [1, 2] },
]);

const inventory = (over: Record<string, unknown> = {}) => {
  const props = {
    colorCode: 4,
    groups: palette.groups,
    onColor: vi.fn(),
    onPin: vi.fn(),
    onPour: vi.fn(),
    onPourCount: vi.fn(),
    onTake: vi.fn(),
    pinned: [] as string[],
    pourCount: 5,
    ...over,
  };
  render(<PartsInventory {...props} />);
  return props;
};

describe("PartsInventory", () => {
  it("lists every part it is given", () => {
    inventory();

    expect(screen.getByText("Brick 2 x 4")).toBeDefined();
    expect(screen.getByText("Tile 1 x 2")).toBeDefined();
    expect(screen.getByText("3 of 3")).toBeDefined();
  });

  it("narrows by name or by part number", async () => {
    const user = userEvent.setup();
    inventory();

    await user.type(screen.getByPlaceholderText("Search parts"), "tile");
    expect(screen.queryByText("Brick 2 x 4")).toBeNull();
    expect(screen.getByText("Tile 1 x 2")).toBeDefined();

    await user.clear(screen.getByPlaceholderText("Search parts"));
    await user.type(screen.getByPlaceholderText("Search parts"), "3005");
    expect(screen.getByText("Brick 1 x 1")).toBeDefined();
    expect(screen.queryByText("Tile 1 x 2")).toBeNull();
  });

  it("narrows by footprint", async () => {
    const user = userEvent.setup();
    inventory();

    await user.click(screen.getByTitle("Parts with a side 4 studs across"));

    expect(screen.getByText("Brick 2 x 4")).toBeDefined();
    expect(screen.queryByText("Brick 1 x 1")).toBeNull();
  });

  it("says so rather than showing an empty list", async () => {
    const user = userEvent.setup();
    inventory();

    await user.type(screen.getByPlaceholderText("Search parts"), "sprocket");

    expect(screen.getByText(/No parts match/)).toBeDefined();
  });

  it("takes one out when a part is chosen", async () => {
    const user = userEvent.setup();
    const props = inventory();

    await user.click(screen.getByText("Brick 2 x 4"));

    expect(props.onTake).toHaveBeenCalledWith("3001.dat");
  });

  it("tips out however many the count says", async () => {
    const user = userEvent.setup();
    const props = inventory({ pourCount: 10 });

    await user.click(screen.getAllByTitle("Tip 10 onto the floor")[0]);

    expect(props.onPour).toHaveBeenCalledWith("3001.dat", 10);
  });

  it("pins a part to the hotbar", async () => {
    const user = userEvent.setup();
    const props = inventory();

    await user.click(screen.getAllByTitle(/hotbar/)[0]);

    expect(props.onPin).toHaveBeenCalledWith("3001.dat");
  });

  it("changes how many get tipped out", async () => {
    const user = userEvent.setup();
    const props = inventory();

    await user.click(screen.getByText("25"));

    expect(props.onPourCount).toHaveBeenCalledWith(25);
  });
});

describe("ColorPicker", () => {
  it("shows a dozen colours until more are asked for", async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    render(
      <ColorPicker
        expanded={false}
        onExpand={onExpand}
        onSelect={vi.fn()}
        selected={4}
      />
    );

    expect(screen.queryByText("Translucent")).toBeNull();
    await user.click(screen.getByText("More"));

    expect(onExpand).toHaveBeenCalledWith(true);
  });

  it("groups every colour once it is opened up", () => {
    render(
      <ColorPicker
        expanded={true}
        onExpand={vi.fn()}
        onSelect={vi.fn()}
        selected={4}
      />
    );

    expect(screen.getByText("Solid")).toBeDefined();
    expect(screen.getByText("Translucent")).toBeDefined();
    expect(screen.getByText("Metallic")).toBeDefined();
  });

  it("keeps an unusual colour on show while it is the chosen one", () => {
    render(
      <ColorPicker
        expanded={false}
        onExpand={vi.fn()}
        onSelect={vi.fn()}
        selected={47}
      />
    );

    expect(screen.getByLabelText("Trans Clear")).toBeDefined();
  });

  it("reports the colour that was picked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ColorPicker
        expanded={false}
        onExpand={vi.fn()}
        onSelect={onSelect}
        selected={4}
      />
    );

    await user.click(screen.getByLabelText("Yellow"));

    expect(onSelect).toHaveBeenCalledWith(14);
  });
});

describe("Hotbar", () => {
  const slots = [
    { colorCode: 4, file: "3001.dat" },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ];

  it("numbers every slot, so the keys mean something", () => {
    render(
      <Hotbar
        active={null}
        byFile={palette.byFile}
        onClear={vi.fn()}
        onSelect={vi.fn()}
        slots={slots}
      />
    );

    expect(screen.getByText("9")).toBeDefined();
    expect(screen.getByTitle(/Brick 2 x 4 in Red/)).toBeDefined();
  });

  it("says what an empty slot is for", () => {
    render(
      <Hotbar
        active={null}
        byFile={palette.byFile}
        onClear={vi.fn()}
        onSelect={vi.fn()}
        slots={slots}
      />
    );

    expect(screen.getByTitle(/Slot 2: pin a part/)).toBeDefined();
  });

  it("reaches for a slot", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Hotbar
        active={null}
        byFile={palette.byFile}
        onClear={vi.fn()}
        onSelect={onSelect}
        slots={slots}
      />
    );

    await user.click(screen.getByTitle(/Brick 2 x 4 in Red/));

    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("clears a slot, and offers nothing to clear on an empty one", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <Hotbar
        active={0}
        byFile={palette.byFile}
        onClear={onClear}
        onSelect={vi.fn()}
        slots={slots}
      />
    );

    expect(screen.queryByLabelText("Clear slot 2")).toBeNull();
    await user.click(screen.getByLabelText("Clear slot 1"));

    expect(onClear).toHaveBeenCalledWith(0);
  });
});

describe("StudIcon", () => {
  it("draws one stud per stud", () => {
    const { container } = render(<StudIcon colorCode={4} size={[2, 4]} />);

    expect(container.querySelectorAll("circle")).toHaveLength(8);
  });

  it("draws a plain tile for a part with no stated footprint", () => {
    const { container } = render(<StudIcon colorCode={4} size={[]} />);

    expect(container.querySelectorAll("circle")).toHaveLength(0);
    expect(container.querySelector("rect")).not.toBeNull();
  });

  it("does not try to draw sixty studs for a baseplate", () => {
    const { container } = render(<StudIcon colorCode={4} size={[32, 32]} />);

    expect(container.querySelectorAll("circle")).toHaveLength(36);
  });
});
