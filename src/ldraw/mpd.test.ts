import { describe, expect, it } from "vitest";
import {
  isSelfContained,
  modelName,
  partNamesFromMpd,
  partNumber,
  slugFromFileName,
} from "./mpd";

const ref = (file: string) => `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${file}`;

describe("isSelfContained", () => {
  it("accepts an .mpd whose every reference is a block inside it", () => {
    // This is the whole point: a packed file loads straight from the browser
    // with no server round trip at all.
    const mpd = [
      "0 FILE main.ldr",
      ref("3001.dat"),
      "",
      "0 FILE 3001.dat",
      "0 Brick  2 x  4",
    ].join("\n");

    expect(isSelfContained(mpd)).toBe(true);
  });

  it("rejects an .mpd missing one of the parts it references", () => {
    const mpd = [
      "0 FILE main.ldr",
      ref("3001.dat"),
      ref("3002.dat"),
      "",
      "0 FILE 3001.dat",
      "0 Brick  2 x  4",
    ].join("\n");

    expect(isSelfContained(mpd)).toBe(false);
  });

  it("rejects a plain .ldr, which is nothing but external references", () => {
    expect(isSelfContained(ref("3001.dat"))).toBe(false);
  });

  it("normalizes references before matching, as the loader does", () => {
    // The file cites s\3001s01.dat; the block is named parts/s/3001s01.dat.
    const mpd = [
      "0 FILE main.ldr",
      ref("s\\3001s01.dat"),
      "",
      "0 FILE parts/s/3001s01.dat",
      "0 Stud",
    ].join("\n");

    expect(isSelfContained(mpd)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const mpd = [
      "0 FILE main.ldr",
      ref("STUD.DAT"),
      "",
      "0 FILE stud.dat",
      "0 Stud",
    ].join("\n");

    expect(isSelfContained(mpd)).toBe(true);
  });
});

describe("partNamesFromMpd", () => {
  it("reads each block's description from its first plain line", () => {
    const mpd = ["0 FILE 3001.dat", "0 Brick  2 x  4", "0 Name: 3001.dat"].join(
      "\n"
    );

    expect(partNamesFromMpd(mpd)["3001.dat"]).toBe("Brick  2 x  4");
  });

  it("ignores meta lines, which are not descriptions", () => {
    const mpd = ["0 FILE 3001.dat", "0 !LDRAW_ORG Part"].join("\n");

    expect(partNamesFromMpd(mpd)["3001.dat"]).toBeUndefined();
  });

  it("follows ~Moved to, so a retired number shows a real name", () => {
    const mpd = [
      "0 FILE 3023a.dat",
      "0 ~Moved to 3023",
      "",
      "0 FILE 3023.dat",
      "0 Plate  1 x  2",
    ].join("\n");

    expect(partNamesFromMpd(mpd)["3023a.dat"]).toBe("Plate  1 x  2");
  });

  it("strips the ~ = _ markers that flag alias parts", () => {
    const mpd = ["0 FILE x.dat", "0 =Stud Group"].join("\n");

    expect(partNamesFromMpd(mpd)["x.dat"]).toBe("Stud Group");
  });

  it("returns nothing for a file with no blocks", () => {
    expect(partNamesFromMpd(ref("3001.dat"))).toEqual({});
  });
});

describe("slugFromFileName", () => {
  it("lowercases and hyphenates", () => {
    expect(slugFromFileName("Galaxy Explorer.ldr")).toBe("galaxy-explorer");
  });

  it("drops the extension", () => {
    expect(slugFromFileName("car.mpd")).toBe("car");
  });

  it("collapses runs of punctuation into one hyphen", () => {
    expect(slugFromFileName("10179 -- UCS!!.ldr")).toBe("10179-ucs");
  });

  it("falls back to a usable slug when nothing survives", () => {
    expect(slugFromFileName("---.ldr")).toBe("model");
  });
});

describe("partNumber and modelName", () => {
  it("drops .dat from a part", () => {
    expect(partNumber("3001.dat")).toBe("3001");
  });

  it("leaves a name that is not a .dat alone", () => {
    expect(partNumber("tower.ldr")).toBe("tower.ldr");
  });

  it("drops any model extension", () => {
    expect(modelName("tower.ldr")).toBe("tower");
    expect(modelName("main.mpd")).toBe("main");
  });
});
