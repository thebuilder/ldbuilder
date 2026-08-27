import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localResolver, normalizeRef, packModel } from "./ldraw-pack.mjs";

/** A type-1 line: 1 <colour> x y z a..i <file>. Only the file name matters here. */
const ref = (file, colour = 16) =>
  `1 ${colour} 0 0 0 1 0 0 0 1 0 0 0 1 ${file}`;

/** Resolve from a plain object, and record what was asked for. */
function fakeLibrary(files) {
  const asked = [];
  const resolve = (key) => {
    asked.push(key);
    return Promise.resolve(files[key] ?? null);
  };
  return { asked, resolve };
}

const pack = (text, files, options = {}) =>
  packModel({
    name: "model.ldr",
    resolve: fakeLibrary(files).resolve,
    text,
    ...options,
  });

/** The `0 FILE <name>` headers of a packed .mpd, in order. */
const fileNames = (mpd) =>
  [...mpd.matchAll(/^0 FILE (.+)$/gm)].map(([, name]) => name.trim());

describe("normalizeRef", () => {
  it("rewrites backslashes, which LDraw files use for subparts", () => {
    expect(normalizeRef("s\\3001s01.dat")).toBe("parts/s/3001s01.dat");
  });

  it("moves s/ under parts/ and 48/ under p/, as the loader does", () => {
    expect(normalizeRef("s/foo.dat")).toBe("parts/s/foo.dat");
    expect(normalizeRef("48/foo.dat")).toBe("p/48/foo.dat");
  });

  it("leaves 8/ alone, because the loader does too", () => {
    // The loader rewrites 48/ but not 8/, and finds the latter by searching p/.
    // Rewriting it here would emit a name the loader never looks up.
    expect(normalizeRef("8/3-8cyli.dat")).toBe("8/3-8cyli.dat");
  });

  it("leaves a bare part number alone", () => {
    expect(normalizeRef("3001.dat")).toBe("3001.dat");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeRef("  3001.dat  ")).toBe("3001.dat");
  });
});

describe("packModel", () => {
  it("inlines a referenced part under its normalized name", async () => {
    const { mpd, missing } = await pack(ref("3001.dat"), {
      "3001.dat": "0 Brick  2 x  4\n4 16 0 0 0 1 1 1 2 2 2 3 3 3",
    });

    expect(missing).toEqual([]);
    // The header must be the reference string, not the disk path: 3001.dat
    // lives at parts/3001.dat but the loader looks it up as 3001.dat.
    expect(fileNames(mpd)).toEqual(["model.ldr", "3001.dat"]);
  });

  it("follows references recursively", async () => {
    const { missing, mpd } = await pack(ref("3001.dat"), {
      "3001.dat": ref("s/3001s01.dat"),
      "parts/s/3001s01.dat": ref("stud.dat"),
      "stud.dat": "4 16 0 0 0 1 1 1 2 2 2 3 3 3",
    });

    expect(missing).toEqual([]);
    expect(fileNames(mpd)).toEqual([
      "model.ldr",
      "3001.dat",
      "parts/s/3001s01.dat",
      "stud.dat",
    ]);
  });

  it("asks for each part once, however many times it is referenced", async () => {
    const library = fakeLibrary({ "3001.dat": "0 Brick  2 x  4" });
    await packModel({
      name: "model.ldr",
      resolve: library.resolve,
      text: [ref("3001.dat"), ref("3001.dat"), ref("3001.dat")].join("\n"),
    });

    expect(library.asked).toEqual(["3001.dat"]);
  });

  it("matches references case-insensitively", async () => {
    // Real files cite STUD.DAT and stud.dat interchangeably.
    const { missing } = await pack(ref("STUD3A.DAT"), {
      "stud3a.dat": "0 Stud",
    });

    expect(missing).toEqual([]);
  });

  it("reports an unresolvable reference once, not once per use", async () => {
    const { missing } = await pack(
      [ref("nope.dat"), ref("nope.dat"), ref("3001.dat")].join("\n"),
      { "3001.dat": "0 Brick  2 x  4" }
    );

    expect(missing).toEqual(["nope.dat"]);
  });

  it("leaves missing references in place by default", async () => {
    const { mpd, stats } = await pack(ref("nope.dat"), {});

    expect(mpd).toContain("nope.dat");
    expect(stats.skipped).toBe(0);
  });

  it("drops missing references under skipMissing, keeping the rest", async () => {
    const { mpd, stats } = await pack(
      [ref("3001.dat"), ref("nope.dat")].join("\n"),
      { "3001.dat": "0 Brick  2 x  4" },
      { skipMissing: true }
    );

    // An unresolved reference left in makes the loader reach for a parts
    // library that is not there, six failed requests before it gives up.
    expect(mpd).not.toContain("nope.dat");
    expect(mpd).toContain("3001.dat");
    expect(stats.skipped).toBe(1);
  });

  it("collects part descriptions from each file's first line", async () => {
    const { partNames } = await pack(ref("3001.dat"), {
      "3001.dat": "0 Brick  2 x  4\n0 Name: 3001.dat",
    });

    expect(partNames["3001.dat"]).toBe("Brick  2 x  4");
  });

  it("ignores meta and comment lines when reading a description", async () => {
    const { partNames } = await pack(ref("3001.dat"), {
      "3001.dat": "0 !LDRAW_ORG Part\n0 // a comment",
    });

    expect(partNames["3001.dat"]).toBeUndefined();
  });

  it("follows ~Moved to, so the parts bin shows a real name", async () => {
    const { partNames } = await pack(ref("3023a.dat"), {
      "3023.dat": "0 Plate  1 x  2",
      "3023a.dat": `0 ~Moved to 3023\n${ref("3023.dat")}`,
    });

    expect(partNames["3023a.dat"]).toBe("Plate  1 x  2");
  });

  it("survives a ~Moved to cycle instead of hanging", async () => {
    const { partNames } = await pack(ref("a.dat"), {
      "a.dat": `0 ~Moved to b\n${ref("b.dat")}`,
      "b.dat": `0 ~Moved to a\n${ref("a.dat")}`,
    });

    expect(partNames["a.dat"]).toBeDefined();
  });

  it("strips the ~ = _ markers that flag alias parts", async () => {
    const { partNames } = await pack(ref("x.dat"), {
      "x.dat": "0 ~Stud for rendering",
    });

    expect(partNames["x.dat"]).toBe("Stud for rendering");
  });

  it("reports files using !TEXMAP, which LDrawLoader ignores", async () => {
    const { stats } = await pack(ref("3001.dat"), {
      "3001.dat": "0 !TEXMAP START PLANAR 0 0 0 1 1 1 2 2 2 x.png",
    });

    expect(stats.texmapFiles).toEqual(["3001.dat"]);
  });

  it("counts the root plus every inlined file", async () => {
    const { stats } = await pack(ref("3001.dat"), {
      "3001.dat": ref("stud.dat"),
      "stud.dat": "0 Stud",
    });

    expect(stats.files).toBe(3);
  });
});

describe("packModel with an .mpd input", () => {
  const mpdSource = [
    "0 FILE main.ldr",
    ref("tower.ldr"),
    "",
    "0 FILE tower.ldr",
    ref("3001.dat"),
  ].join("\n");

  it("keeps embedded subfiles instead of resolving them externally", async () => {
    const library = fakeLibrary({ "3001.dat": "0 Brick  2 x  4" });
    const { missing } = await packModel({
      name: "main.ldr",
      resolve: library.resolve,
      text: mpdSource,
    });

    expect(missing).toEqual([]);
    // tower.ldr came in the file, so only the part is looked up.
    expect(library.asked).toEqual(["3001.dat"]);
  });

  it("still resolves what the embedded subfiles reference", async () => {
    const { mpd } = await packModel({
      name: "main.ldr",
      resolve: fakeLibrary({ "3001.dat": "0 Brick  2 x  4" }).resolve,
      text: mpdSource,
    });

    expect(fileNames(mpd)).toEqual(["main.ldr", "tower.ldr", "3001.dat"]);
  });

  it("treats the first embedded block as the root", async () => {
    const { mpd } = await packModel({
      name: "main.ldr",
      resolve: fakeLibrary({}).resolve,
      text: mpdSource,
    });

    expect(fileNames(mpd)[0]).toBe("main.ldr");
  });
});

describe("packModel concurrency", () => {
  it("resolves a round in parallel rather than one at a time", async () => {
    let live = 0;
    let peak = 0;
    const resolve = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
      return "0 Part";
    };
    const text = Array.from({ length: 10 }, (_, i) => ref(`part${i}.dat`)).join(
      "\n"
    );

    await packModel({ concurrency: 5, name: "m.ldr", resolve, text });

    expect(peak).toBeGreaterThan(1);
  });

  it("never exceeds the concurrency it was given", async () => {
    let live = 0;
    let peak = 0;
    const resolve = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((done) => setTimeout(done, 1));
      live -= 1;
      return "0 Part";
    };
    const text = Array.from({ length: 20 }, (_, i) => ref(`part${i}.dat`)).join(
      "\n"
    );

    await packModel({ concurrency: 4, name: "m.ldr", resolve, text });

    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("localResolver", () => {
  it("reads the file an index points at", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ldraw-pack-"));
    const file = path.join(dir, "3001.dat");
    await writeFile(file, "0 Brick  2 x  4");

    const resolve = localResolver(new Map([["3001.dat", file]]));

    await expect(resolve("3001.dat")).resolves.toBe("0 Brick  2 x  4");
  });

  it("returns null for a name the index does not have", async () => {
    const resolve = localResolver(new Map());
    await expect(resolve("nope.dat")).resolves.toBeNull();
  });
});
