import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSelfContained } from "../../src/ldraw/mpd";
import { analyze } from "./ldraw-analyze.mjs";
import { PUBLIC_MODELS_DIR } from "./paths.mjs";

/**
 * The committed models are the shop window: they load with no parts library and
 * no server, so they must always work. These check the artifacts in the repo
 * rather than the code that made them, which is what catches a bad re-pack
 * getting committed.
 */
const manifest = JSON.parse(
  await readFile(path.join(PUBLIC_MODELS_DIR, "manifest.json"), "utf8")
);

const { models } = manifest;
const read = (slug) =>
  readFile(path.join(PUBLIC_MODELS_DIR, `${slug}.mpd`), "utf8");

describe("the committed models", () => {
  it("ships the five the gallery expects", () => {
    expect(models.map((m) => m.slug).sort()).toEqual([
      "car",
      "galaxy-explorer",
      "gatehouse",
      "pyramid",
      "saturn-v",
    ]);
  });

  it.each(models.map((m) => [m.slug, m]))(
    "%s is self-contained, so it needs no parts library",
    async (slug) => {
      expect(isSelfContained(await read(slug))).toBe(true);
    }
  );

  it.each(models.map((m) => [m.slug, m]))(
    "%s matches the brick and step counts in the manifest",
    async (slug, meta) => {
      const info = analyze(await read(slug));

      expect(info.bricks).toBe(meta.bricks);
      expect(info.steps).toBe(meta.steps);
      expect(info.uniqueParts).toBe(meta.uniqueParts);
    }
  );

  it.each(models.map((m) => [m.slug]))(
    "%s credits whoever built it, as CC BY requires",
    (slug) => {
      const meta = models.find((m) => m.slug === slug);
      expect(meta.credit).toBeTruthy();
    }
  );
});
