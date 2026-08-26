import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@/test/fixtures";
import {
  clearFreeBuild,
  type FreeSave,
  freeBuildSummary,
  readFreeBuild,
  readHotbar,
  writeFreeBuild,
  writeHotbar,
} from "./freeStore";

let store: MemoryStorage;

const save = (over: Partial<FreeSave> = {}): FreeSave => ({
  loose: [],
  looseParts: [],
  placed: [{ c: 4, f: "3001.dat", p: [20, 24, -40], t: 0, y: 1 }],
  updatedAt: 1_700_000_000_000,
  v: 1,
  ...over,
});

beforeEach(() => {
  store = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: store,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("freeStore", () => {
  it("writes a build and reads it back", () => {
    writeFreeBuild(save());

    expect(readFreeBuild()?.placed[0]).toMatchObject({ c: 4, f: "3001.dat" });
  });

  it("returns null when nothing has been built", () => {
    expect(readFreeBuild()).toBeNull();
    expect(freeBuildSummary()).toBeNull();
  });

  it("rounds positions, since a grid step is 20 units and not 20.0001", () => {
    writeFreeBuild(
      save({
        placed: [
          {
            c: 4,
            f: "3001.dat",
            p: [20.000_004, 23.9999, -40.1267],
            t: 0,
            y: 0,
          },
        ],
      })
    );

    expect(readFreeBuild()?.placed[0].p).toEqual([20, 24, -40.13]);
  });

  it("keeps brick ids exact while rounding the pile around them", () => {
    writeFreeBuild(save({ loose: [7, 1.234_56, 2, 3, 0.123_456_7, 0, 0, 1] }));

    const loose = readFreeBuild()?.loose ?? [];
    expect(loose[0]).toBe(7);
    expect(loose[1]).toBe(1.23);
    expect(loose[4]).toBe(0.1235);
  });

  it("drops the pile rather than the build when the store is full", () => {
    let attempt = 0;
    const original = store.setItem.bind(store);
    store.setItem = (key: string, value: string) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("QuotaExceededError");
      }
      original(key, value);
    };

    writeFreeBuild(
      save({
        loose: [0, 1, 2, 3, 0, 0, 0, 1],
        looseParts: [{ colorCode: 4, file: "3001.dat", id: 0 }],
      })
    );

    const back = readFreeBuild();
    expect(back?.placed).toHaveLength(1);
    expect(back?.loose).toEqual([]);
    expect(back?.looseParts).toEqual([]);
  });

  it("survives a store that is not there at all", () => {
    Reflect.deleteProperty(globalThis, "localStorage");

    expect(() => writeFreeBuild(save())).not.toThrow();
    expect(readFreeBuild()).toBeNull();
    expect(() => clearFreeBuild()).not.toThrow();
    expect(readHotbar()).toBeNull();
    expect(() => writeHotbar([])).not.toThrow();
  });

  it("ignores a build that is not valid JSON", () => {
    store.setItem("ldraw:free", "{ not json");

    expect(readFreeBuild()).toBeNull();
  });

  it("ignores a build from an older schema", () => {
    store.setItem("ldraw:free", JSON.stringify({ ...save(), v: 0 }));

    expect(readFreeBuild()).toBeNull();
  });

  it("ignores a build missing the fields it needs", () => {
    store.setItem("ldraw:free", JSON.stringify({ placed: [], v: 1 }));

    expect(readFreeBuild()).toBeNull();
  });

  it("clears the build", () => {
    writeFreeBuild(save());

    clearFreeBuild();

    expect(readFreeBuild()).toBeNull();
  });

  it("summarises what is on the floor, and says nothing about an empty one", () => {
    writeFreeBuild(save());
    expect(freeBuildSummary()).toMatchObject({ placed: 1 });

    writeFreeBuild(save({ placed: [] }));
    expect(freeBuildSummary()).toBeNull();
  });

  it("remembers the hotbar, holes and all", () => {
    writeHotbar([{ colorCode: 4, file: "3001.dat" }, null, null]);

    expect(readHotbar()).toEqual([
      { colorCode: 4, file: "3001.dat" },
      null,
      null,
    ]);
  });

  it("ignores a hotbar that is not a list of slots", () => {
    store.setItem("ldraw:free:hotbar", JSON.stringify({ nope: true }));
    expect(readHotbar()).toBeNull();

    store.setItem("ldraw:free:hotbar", JSON.stringify([{ file: 3 }, "x"]));
    expect(readHotbar()).toEqual([null, null]);
  });
});
