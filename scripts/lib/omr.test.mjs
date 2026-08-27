import { describe, expect, it } from "vitest";
import { normalizeSetId, readMetadata } from "./omr.mjs";

const header = (...lines) => lines.join("\n");

describe("normalizeSetId", () => {
  it("adds the default variant to a bare number", () => {
    expect(normalizeSetId("928")).toBe("928-1");
  });

  it("leaves an id that already names its variant", () => {
    expect(normalizeSetId("928-2")).toBe("928-2");
  });

  it("trims whatever was typed into the field", () => {
    expect(normalizeSetId("  10179  ")).toBe("10179-1");
  });

  it("accepts a number, not just a string", () => {
    expect(normalizeSetId(21_309)).toBe("21309-1");
  });
});

describe("readMetadata", () => {
  it("reads the author the CC BY licence requires us to credit", () => {
    const text = header(
      "0 Galaxy Explorer",
      "0 Author: Willy Tschager [Holly-Wood]"
    );

    expect(readMetadata(text).author).toBe("Willy Tschager [Holly-Wood]");
  });

  it("accepts a file carrying the CCAL header as redistributable", () => {
    // This is the gate that decides what may be committed to the repo at all.
    const text = "0 !LICENSE Redistributable under CCAL version 2.0";

    expect(readMetadata(text).redistributable).toBe(true);
  });

  it("refuses a file with no licence header", () => {
    expect(readMetadata("0 Some Model").redistributable).toBe(false);
  });

  it("refuses a licence that is not CCAL", () => {
    const text = "0 !LICENSE All rights reserved";

    expect(readMetadata(text).redistributable).toBe(false);
  });

  it("prefers !THEME over !CATEGORY", () => {
    const text = header("0 !THEME Space", "0 !CATEGORY Spaceship");

    expect(readMetadata(text).theme).toBe("Space");
  });

  it("falls back to !CATEGORY when there is no theme", () => {
    expect(readMetadata("0 !CATEGORY Spaceship").theme).toBe("Spaceship");
  });

  it("returns nulls rather than undefined for an empty file", () => {
    expect(readMetadata("")).toEqual({
      author: null,
      keywords: null,
      license: null,
      redistributable: false,
      theme: null,
    });
  });

  it("finds headers anywhere in the file, not only on line one", () => {
    const text = header(
      "0 Model",
      "1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat",
      "0 Author: Someone"
    );

    expect(readMetadata(text).author).toBe("Someone");
  });
});
