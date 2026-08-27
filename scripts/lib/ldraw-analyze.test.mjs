import { describe, expect, it } from "vitest";
import { analyze } from "./ldraw-analyze.mjs";

const ref = (file) => `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${file}`;

/** A part file, as the packer inlines one: a type header plus geometry. */
const part = (name, type = "Part") =>
  [
    `0 FILE ${name}`,
    `0 ${name}`,
    `0 !LDRAW_ORG ${type}`,
    "4 16 0 0 0 1 1 1 2 2 2 3 3 3",
  ].join("\n");

const mpd = (...blocks) => blocks.join("\n\n");

describe("analyze", () => {
  it("counts each part reference as a brick", () => {
    const text = mpd(
      ["0 FILE main.ldr", ref("3001.dat"), ref("3001.dat")].join("\n"),
      part("3001.dat")
    );

    expect(analyze(text).bricks).toBe(2);
  });

  it("counts distinct parts separately from total bricks", () => {
    const text = mpd(
      [
        "0 FILE main.ldr",
        ref("3001.dat"),
        ref("3001.dat"),
        ref("3002.dat"),
      ].join("\n"),
      part("3001.dat"),
      part("3002.dat")
    );

    const { bricks, uniqueParts } = analyze(text);
    expect(bricks).toBe(3);
    expect(uniqueParts).toBe(2);
  });

  it("descends through submodels", () => {
    const text = mpd(
      ["0 FILE main.ldr", ref("tower.ldr"), ref("tower.ldr")].join("\n"),
      ["0 FILE tower.ldr", ref("3001.dat"), ref("3001.dat")].join("\n"),
      part("3001.dat")
    );

    expect(analyze(text).bricks).toBe(4);
  });

  it("stops at a Shortcut instead of counting its parts as well", () => {
    // A Shortcut is a pre-assembled group of real Part files. Descending would
    // count one brick twice, once as the shortcut and once as its contents.
    const text = mpd(
      ["0 FILE main.ldr", ref("shortcut.dat")].join("\n"),
      [
        "0 FILE shortcut.dat",
        "0 Some Assembly",
        "0 !LDRAW_ORG Shortcut",
        ref("3001.dat"),
        ref("3002.dat"),
      ].join("\n"),
      part("3001.dat"),
      part("3002.dat")
    );

    expect(analyze(text).bricks).toBe(1);
  });

  it("reports one step for a model with no STEP metas", () => {
    const text = mpd(
      ["0 FILE main.ldr", ref("3001.dat")].join("\n"),
      part("3001.dat")
    );

    expect(analyze(text).steps).toBe(1);
  });

  it("counts a STEP only once something follows it", () => {
    const text = mpd(
      ["0 FILE main.ldr", ref("3001.dat"), "0 STEP", ref("3001.dat")].join(
        "\n"
      ),
      part("3001.dat")
    );

    expect(analyze(text).steps).toBe(2);
  });

  it("ignores a trailing STEP at end of file", () => {
    // LDrawLoader does the same, and getting this wrong put every model's step
    // count one over what the loader would report.
    const text = mpd(
      ["0 FILE main.ldr", ref("3001.dat"), "0 STEP"].join("\n"),
      part("3001.dat")
    );

    expect(analyze(text).steps).toBe(1);
  });

  it("ignores consecutive STEPs with nothing between them", () => {
    const text = mpd(
      [
        "0 FILE main.ldr",
        ref("3001.dat"),
        "0 STEP",
        "0 STEP",
        ref("3001.dat"),
      ].join("\n"),
      part("3001.dat")
    );

    expect(analyze(text).steps).toBe(2);
  });

  it("skips references it cannot resolve", () => {
    const text = mpd(
      ["0 FILE main.ldr", ref("3001.dat"), ref("missing.dat")].join("\n"),
      part("3001.dat")
    );

    expect(analyze(text).bricks).toBe(1);
  });

  it("survives a submodel that references itself", () => {
    const text = mpd(
      ["0 FILE main.ldr", ref("loop.ldr")].join("\n"),
      ["0 FILE loop.ldr", ref("loop.ldr")].join("\n")
    );

    expect(() => analyze(text)).not.toThrow();
  });

  it("names the first block as the root", () => {
    const text = mpd(
      ["0 FILE main.ldr", ref("3001.dat")].join("\n"),
      part("3001.dat")
    );

    expect(analyze(text).root).toBe("main.ldr");
  });
});
