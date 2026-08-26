import { Cache, type Group } from "three";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";
import { computeBags } from "./bags";
import { buildBom, flattenModel } from "./flatten";
import { layoutAllBags } from "./layout";
import { computeSteps } from "./steps";
import type { LoadProgress, ModelData } from "./types";

/** Path to the colour table copied out of the LDraw library by `pnpm ldraw:setup`. */
const LDCONFIG_URL = "/ldraw/LDConfig.ldr";

const MPD_EXTENSION = /\.mpd$/i;

/**
 * Above this many bricks, vertex normals are left flat.
 *
 * Smoothing is by far the most expensive part of parsing: measured on a
 * 4200-brick set it accounts for roughly four fifths of a 15 second parse, and
 * on the 61-brick sample it is 82ms of 130ms. Curved surfaces (studs, cylinders,
 * tyres) look faceted without it, which is a real loss on a small model where
 * you are looking closely, and a negligible one on a large model you are mostly
 * seeing from a distance. Trading it away past this threshold is what keeps big
 * sets openable at all.
 */
const SMOOTH_NORMALS_MAX_BRICKS = 800;

/** Cheap upper bound on brick count: every part reference is a type-1 line. */
function countReferences(text: string): number {
  let count = 0;
  let index = text.indexOf("\n1 ");
  while (index !== -1) {
    count += 1;
    index = text.indexOf("\n1 ", index + 3);
  }
  return count;
}

// three's FileLoader cache keeps LDConfig and any re-opened model in memory, so
// switching between models does not refetch. Keyed by URL, so blob URLs from
// uploads stay distinct.
Cache.enabled = true;

/**
 * Phase timings. Loading a large model is the slowest thing the app does, and
 * without these it is guesswork which phase is responsible.
 */
function stopwatch() {
  const marks: [string, number][] = [];
  let last = performance.now();
  return {
    log(slug: string) {
      if (process.env.NODE_ENV === "production") {
        return;
      }
      const total = marks.reduce((sum, [, ms]) => sum + ms, 0);
      console.info(
        `[ldraw] ${slug} loaded in ${total.toFixed(0)}ms:`,
        marks.map(([name, ms]) => `${name} ${ms.toFixed(0)}ms`).join(", ")
      );
    },
    mark(name: string) {
      const now = performance.now();
      marks.push([name, now - last]);
      last = now;
    },
  };
}

interface SchedulerWithYield {
  yield?: () => Promise<void>;
}

/**
 * Hand control back to the event loop so the progress UI can update between
 * phases. The parse itself is one synchronous block and cannot be split.
 *
 * Not requestAnimationFrame. Browsers throttle rAF to a crawl, or stop it, when
 * the tab is hidden or otherwise not painting, which turned a 250ms load into an
 * eight second one. `scheduler.yield` and `setTimeout` run either way.
 */
function yieldToBrowser(): Promise<void> {
  const { scheduler } = globalThis as { scheduler?: SchedulerWithYield };
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface LoadModelOptions {
  /** Brick count from the manifest, used to sanity-check the flatten pass. */
  expectedBricks?: number | null;
  onProgress?: (progress: LoadProgress) => void;
  /** Part descriptions from the packer, keyed by lowercase part file name. */
  partNames?: Record<string, string>;
  slug: string;
  /** Packed .mpd source, for uploads. */
  text?: string;
  title: string;
  /** URL of a packed .mpd. Ignored when `text` is given. */
  url?: string;
}

export async function loadModel(options: LoadModelOptions): Promise<ModelData> {
  const { slug, title, url, text, expectedBricks = null, onProgress } = options;
  const report = (progress: LoadProgress) => onProgress?.(progress);
  const timer = stopwatch();

  report({ detail: "colour table", fraction: null, phase: "fetching" });

  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);

  // Without this the loader knows only colour 16 and 24 and every brick comes
  // out magenta. See LDrawLoader.addDefaultMaterials.
  await loader.preloadMaterials(LDCONFIG_URL);
  timer.mark("colours");

  let partNames = options.partNames ?? {};
  let source = text;

  if (source === undefined) {
    if (!url) {
      throw new Error("loadModel needs either a url or model text");
    }
    report({ detail: "model", fraction: null, phase: "fetching" });

    const [modelResponse, namesResponse] = await Promise.all([
      fetch(url),
      options.partNames
        ? Promise.resolve(null)
        : fetch(url.replace(MPD_EXTENSION, ".parts.json")).catch(() => null),
    ]);

    if (!modelResponse.ok) {
      throw new Error(`could not load ${url} (${modelResponse.status})`);
    }
    source = await modelResponse.text();

    if (namesResponse?.ok) {
      partNames = (await namesResponse.json()) as Record<string, string>;
    }
  }

  timer.mark("fetch");

  // The manifest knows the exact count; an upload has to be estimated from the
  // file, which over-counts (submodel references are type-1 lines too) and so
  // errs towards the fast path.
  const estimatedBricks = expectedBricks ?? countReferences(source);
  const smoothNormals = estimatedBricks <= SMOOTH_NORMALS_MAX_BRICKS;
  loader.smoothNormals = smoothNormals;

  report({ detail: "building geometry", fraction: null, phase: "parsing" });
  await yieldToBrowser();

  const raw = await new Promise<Group>((resolve, reject) => {
    loader.parse(source as string, resolve, reject);
  });

  timer.mark("parse");
  report({ fraction: null, phase: "flattening" });
  await yieldToBrowser();

  const { root, bricks, bounds, submodels, emptyBricks } = flattenModel(
    raw,
    partNames
  );

  if (expectedBricks !== null && bricks.length !== expectedBricks) {
    // Not fatal, but it means the runtime brick predicate and the packer's
    // disagree, and a disagreement there loses bricks without saying so.
    console.warn(
      `[ldraw] ${slug}: flattened ${bricks.length} bricks but the manifest expects ${expectedBricks}`
    );
  }
  if (emptyBricks > 0) {
    console.warn(`[ldraw] ${slug}: ${emptyBricks} brick(s) have no geometry`);
  }

  timer.mark("flatten");
  report({ fraction: null, phase: "laying-out" });
  await yieldToBrowser();

  const numBuildingSteps = Number(raw.userData?.numBuildingSteps ?? 1);
  const { steps, synthetic } = computeSteps(bricks, numBuildingSteps);
  const bags = computeBags(bricks, steps);
  layoutAllBags(bags, bricks, bounds, slug);
  const bom = buildBom(bricks);

  timer.mark("layout");
  timer.log(slug);
  report({ fraction: 1, phase: "ready" });

  return {
    bags,
    bom,
    bounds,
    bricks,
    expectedBricks,
    root,
    slug,
    smoothNormals,
    steps,
    stepsAreSynthetic: synthetic,
    submodels,
    title,
  };
}

export function disposeModel(model: ModelData): void {
  const geometries = new Set<{ dispose: () => void }>();
  const materials = new Set<{ dispose: () => void }>();

  model.root.traverse((object) => {
    const mesh = object as {
      geometry?: { dispose: () => void };
      material?: unknown;
    };
    if (mesh.geometry) {
      geometries.add(mesh.geometry);
    }
    const { material } = mesh;
    if (Array.isArray(material)) {
      for (const item of material) {
        materials.add(item as { dispose: () => void });
      }
    } else if (material) {
      materials.add(material as { dispose: () => void });
    }
  });

  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
  model.root.clear();
}
