import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@/test/fixtures";
import {
  type BuildSave,
  clearBuild,
  matchesModel,
  pruneBuilds,
  readBuild,
  writeBuild,
} from "./buildStore";

let store: MemoryStorage;

const save = (over: Partial<BuildSave> = {}): BuildSave => ({
  bricks: 13,
  loose: [],
  placed: [0, 1],
  slug: "pyramid",
  step: 2,
  steps: 4,
  title: "Example Pyramid",
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

describe("buildStore", () => {
  it("writes a build and reads it back", () => {
    writeBuild(save());

    expect(readBuild("pyramid")).toMatchObject({ placed: [0, 1], step: 2 });
  });

  it("returns null for a model with no saved build", () => {
    expect(readBuild("nothing-here")).toBeNull();
  });

  it("rounds the pile but keeps brick ids exact", () => {
    writeBuild(
      save({
        loose: [7, 12.345_67, -3.2111, 0.5, 0.123_456_7, 0, 0, 0.992_345],
      })
    );

    const [id, x, y, z, qx] = readBuild("pyramid")?.loose ?? [];
    expect(id).toBe(7);
    expect(x).toBe(12.35);
    expect(y).toBe(-3.21);
    expect(z).toBe(0.5);
    // Rotations keep more digits: two decimal places is a visible tilt.
    expect(qx).toBe(0.1235);
  });

  it("drops the pile rather than the build when the store is full", () => {
    store.full = true;
    writeBuild(save({ loose: [0, 1, 2, 3, 4, 5, 6, 7] }));
    expect(readBuild("pyramid")).toBeNull();

    // A store with room for the small version keeps the build and loses the pile.
    let attempt = 0;
    const original = store.setItem.bind(store);
    store.setItem = (key: string, value: string) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("QuotaExceededError");
      }
      original(key, value);
    };
    store.full = false;
    writeBuild(save({ loose: [0, 1, 2, 3, 4, 5, 6, 7] }));

    expect(readBuild("pyramid")?.loose).toEqual([]);
  });

  it("survives a store that is not there at all", () => {
    Reflect.deleteProperty(globalThis, "localStorage");

    expect(() => writeBuild(save())).not.toThrow();
    expect(readBuild("pyramid")).toBeNull();
    expect(() => clearBuild("pyramid")).not.toThrow();
    expect(() => pruneBuilds()).not.toThrow();
  });

  it("ignores a saved build that is not valid JSON", () => {
    store.setItem("ldraw:build:pyramid", "{ not json");

    expect(readBuild("pyramid")).toBeNull();
  });

  it("ignores a saved build from an older schema", () => {
    store.setItem("ldraw:build:pyramid", JSON.stringify({ ...save(), v: 0 }));

    expect(readBuild("pyramid")).toBeNull();
  });

  it("ignores a saved build missing the fields it needs", () => {
    store.setItem("ldraw:build:pyramid", JSON.stringify({ slug: "x", v: 1 }));
    expect(readBuild("pyramid")).toBeNull();

    store.setItem("ldraw:build:pyramid", "null");
    expect(readBuild("pyramid")).toBeNull();
  });

  it("only accepts a save written against the same model", () => {
    const written = save();

    expect(matchesModel(written, 13, 4)).toBe(true);
    // A repack that changes the brick or step count renumbers the slots.
    expect(matchesModel(written, 14, 4)).toBe(false);
    expect(matchesModel(written, 13, 5)).toBe(false);
  });

  it("clears one build without touching the others", () => {
    writeBuild(save());
    writeBuild(save({ slug: "car" }));

    clearBuild("pyramid");

    expect(readBuild("pyramid")).toBeNull();
    expect(readBuild("car")).not.toBeNull();
  });

  it("evicts the least recently touched builds past the cap", () => {
    for (let i = 0; i < 15; i += 1) {
      writeBuild(save({ slug: `model-${i}`, updatedAt: 1000 + i }));
    }

    pruneBuilds();

    // The three oldest go; the twelve most recent stay.
    expect(readBuild("model-0")).toBeNull();
    expect(readBuild("model-2")).toBeNull();
    expect(readBuild("model-3")).not.toBeNull();
    expect(readBuild("model-14")).not.toBeNull();
  });

  it("leaves the store alone when it is under the cap", () => {
    writeBuild(save());
    pruneBuilds();

    expect(readBuild("pyramid")).not.toBeNull();
  });

  it("ignores keys that belong to something else", () => {
    store.setItem("unrelated", "hello");
    writeBuild(save());

    pruneBuilds();

    expect(store.getItem("unrelated")).toBe("hello");
  });
});
