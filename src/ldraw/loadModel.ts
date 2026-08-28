import { Cache, type Group } from "three";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";
import { computeBags } from "./bags";
import { buildBom, flattenModel } from "./flatten";
import { layoutAllBags } from "./layout";
import { stopwatch, yieldToBrowser } from "./loading";
import { computeSteps } from "./steps";
import { computeSubassemblies } from "./subassemblies";
import type { LoadProgress, ModelData } from "./types";

/** Path to the colour table copied out of the LDraw library by `pnpm ldraw:setup`. */
const LDCONFIG_URL = "/ldraw/LDConfig.ldr";

const MPD_EXTENSION = /\.mpd$/i;

/**
 * Above this many bricks, vertex normals are left flat.
 *
 * Smoothing is by far the most expensive part of parsing, and the parse is one
 * synchronous block: whatever it costs is time the page is frozen with a
 * loading card on it that cannot even repaint. Measured on the bundled models,
 * everything up to the 128-brick set parses in about 100ms, while the 368-brick
 * one costs 3.6s, of which 3.4s is smoothing. Curved surfaces (studs,
 * cylinders, tyres) look faceted without it, which is a real loss on a small
 * model you are looking closely at, and one worth taking the moment the wait
 * becomes long enough to read as the page having hung.
 */
const SMOOTH_NORMALS_MAX_BRICKS = 200;

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

  const { root, bricks, bounds, instances, submodels, emptyBricks } =
    flattenModel(raw, partNames);

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
  // After the steps, because which submodels are worth staging depends on how
  // many steps they are built over, and before the bags, so a staged
  // subassembly is laid out with the bag it belongs to.
  const subassemblies = computeSubassemblies(bricks, instances, bounds);
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
    subassemblies,
    submodels,
    title,
  };
}

interface Disposable {
  dispose: () => void;
}

/**
 * Add whatever a mesh has on `material` to `into`.
 *
 * A mesh carries either one material or an array of them, and both shapes have
 * to end up in the same set: disposing is per resource, and a material shared
 * between meshes must only be disposed once.
 */
function collectMaterials(material: unknown, into: Set<Disposable>): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      into.add(item as Disposable);
    }
    return;
  }
  if (material) {
    into.add(material as Disposable);
  }
}

export function disposeModel(model: ModelData): void {
  const geometries = new Set<Disposable>();
  const materials = new Set<Disposable>();

  model.root.traverse((object) => {
    const mesh = object as { geometry?: Disposable; material?: unknown };
    if (mesh.geometry) {
      geometries.add(mesh.geometry);
    }
    collectMaterials(mesh.material, materials);
  });

  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
  model.root.clear();
}
