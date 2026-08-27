import { describe, expect, it } from "vitest";
import { hashString, makeRandom } from "./random";

describe("makeRandom", () => {
  it("gives the same sequence for the same seed", () => {
    // The floor scatter is seeded by model slug so a model always drops the
    // same way. If this drifts, every model's layout changes silently.
    const a = makeRandom(12_345);
    const b = makeRandom(12_345);

    const first = Array.from({ length: 10 }, () => a());
    const second = Array.from({ length: 10 }, () => b());

    expect(first).toEqual(second);
  });

  it("gives different sequences for different seeds", () => {
    const a = makeRandom(1);
    const b = makeRandom(2);

    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const next = makeRandom(99);

    for (let i = 0; i < 1000; i += 1) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("does not get stuck on one value", () => {
    const next = makeRandom(7);
    const seen = new Set(Array.from({ length: 100 }, () => next()));

    expect(seen.size).toBeGreaterThan(90);
  });
});

describe("hashString", () => {
  it("is stable for the same input", () => {
    expect(hashString("galaxy-explorer")).toBe(hashString("galaxy-explorer"));
  });

  it("separates the model slugs actually in the gallery", () => {
    const slugs = [
      "car",
      "galaxy-explorer",
      "gatehouse",
      "pyramid",
      "saturn-v",
    ];

    expect(new Set(slugs.map(hashString)).size).toBe(slugs.length);
  });

  it("returns a number a seed can use", () => {
    const hash = hashString("anything");

    expect(Number.isFinite(hash)).toBe(true);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it("handles the empty string", () => {
    expect(Number.isFinite(hashString(""))).toBe(true);
  });
});
