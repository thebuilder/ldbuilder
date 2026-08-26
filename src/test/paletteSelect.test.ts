import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { selectPaletteParts } from "../../scripts/lib/palette-select.mjs";

/**
 * The selection rules, run against a library small enough to read.
 *
 * These rules decide what a couple of hundred people-facing parts are out of
 * twenty thousand files, and every one of them is a judgement about what
 * belongs in a box of bricks. Getting them wrong is not a crash, it is a
 * palette full of Duplo, so they are worth pinning down.
 */

interface FakePart {
  category?: string;
  description: string;
  file: string;
  type?: string;
}

const PARTS: FakePart[] = [
  { description: "Brick  1 x  2", file: "3004.dat" },
  { description: "Brick  2 x  4", file: "3001.dat" },
  { description: "Brick  1 x  1", file: "3005.dat" },
  { description: "Plate  1 x  2", file: "3023.dat" },
  { description: "Plate  6 x  8", file: "3036.dat" },
  { description: "Tile  1 x  2 with Groove", file: "3069b.dat" },
  { description: "Slope Brick 45  2 x  4", file: "3037.dat" },
  { description: "Baseplate 16 x 16", file: "3867.dat" },
  { description: "Wheel 8 x 6", file: "4266.dat" },

  // Everything below should be left out, and for a different reason each time.
  { description: "Brick  1 x  2 with Blue Pattern", file: "3004p01.dat" },
  { description: "Duplo Brick  2 x  4", file: "3011.dat" },
  { description: "Brick  1 x  2", file: "3004a.dat", type: "Subpart" },
  { description: "~Moved to 3004", file: "3004old.dat" },
  { description: "Sticker  1 x  2", file: "3005s.dat" },
  { description: "Minifig Hair Tousled", file: "10048.dat" },
  { description: "Brick  1 x  2", file: "u9021.dat" },
];

let library: string;

beforeAll(async () => {
  library = await mkdtemp(path.join(tmpdir(), "ldraw-palette-"));
  await mkdir(path.join(library, "parts"), { recursive: true });

  await Promise.all(
    PARTS.map((part) =>
      writeFile(
        path.join(library, "parts", part.file),
        [
          `0 ${part.description}`,
          `0 Name: ${part.file}`,
          `0 !LDRAW_ORG ${part.type ?? "Part"}`,
          part.category ? `0 !CATEGORY ${part.category}` : "0 BFC CERTIFY CCW",
          "4 16 -10 0 -10 10 0 -10 10 24 10 -10 24 10",
        ].join("\n")
      )
    )
  );
});

afterAll(async () => {
  await rm(library, { force: true, recursive: true });
});

const flat = (groups: { id: string; parts: { file: string }[] }[]) =>
  groups.flatMap((group) => group.parts.map((part) => part.file));

describe("selectPaletteParts", () => {
  it("keeps the classic system parts", async () => {
    const files = flat(await selectPaletteParts(library));

    expect(files).toContain("3001.dat");
    expect(files).toContain("3023.dat");
    expect(files).toContain("3069b.dat");
    expect(files).toContain("3037.dat");
  });

  it("leaves out everything that is not a part in a box of bricks", async () => {
    const files = flat(await selectPaletteParts(library));

    // A print, another system, a subpart, a retired number, a sticker, a
    // licensed minifigure, and an unofficial mould.
    expect(files).not.toContain("3004p01.dat");
    expect(files).not.toContain("3011.dat");
    expect(files).not.toContain("3004a.dat");
    expect(files).not.toContain("3004old.dat");
    expect(files).not.toContain("3005s.dat");
    expect(files).not.toContain("10048.dat");
    expect(files).not.toContain("u9021.dat");
  });

  it("sorts each group from the smallest footprint outwards", async () => {
    const groups = await selectPaletteParts(library);
    const plates = groups.find((group) => group.id === "plate");

    expect(plates?.parts.map((part) => part.file)).toEqual([
      "3023.dat",
      "3036.dat",
    ]);
  });

  it("reads the footprint out of the part's own description", async () => {
    const groups = await selectPaletteParts(library);
    const bricks = groups.find((group) => group.id === "brick");

    expect(
      bricks?.parts.find((part) => part.file === "3001.dat")?.size
    ).toEqual([2, 4]);
  });

  it("normalises the column-aligned descriptions the library ships", async () => {
    const groups = await selectPaletteParts(library);
    const bricks = groups.find((group) => group.id === "brick");

    expect(bricks?.parts.find((part) => part.file === "3004.dat")?.name).toBe(
      "Brick 1 x 2"
    );
  });

  it("files each part under the group it belongs to", async () => {
    const groups = await selectPaletteParts(library);
    const byId = new Map(groups.map((group) => [group.id, flat([group])]));

    expect(byId.get("tile")).toEqual(["3069b.dat"]);
    expect(byId.get("base")).toEqual(["3867.dat"]);
    expect(byId.get("wheel")).toEqual(["4266.dat"]);
  });

  it("returns every group, even the ones this library cannot fill", async () => {
    const groups = await selectPaletteParts(library);

    expect(groups.map((group) => group.id)).toContain("round");
    expect(groups.find((group) => group.id === "round")?.parts).toEqual([]);
  });
});
