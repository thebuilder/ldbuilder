import {
  Cache,
  type Group,
  type Material,
  type Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import { LDrawLoader } from "three/addons/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/addons/materials/LDrawConditionalLineMaterial.js";
import { isLineSegments, isMesh } from "@/scene/three-guards";
import { flattenModel } from "./flatten";
import type { Brick, Pose } from "./types";

/**
 * The parts a free build can draw on.
 *
 * A model pack contains the parts one model uses. This is the other kind: every
 * part somebody might reach for, packed once by `pnpm ldraw:palette` and loaded
 * only when the sandbox is opened. 194 parts come to 1.9MB, which is 280KB over
 * the wire, so it is worth not putting it in front of anyone who only wants to
 * watch a set build itself.
 *
 * Parts arrive in colour 16, LDraw's "inherit from whoever used me", which at
 * the top level means nothing has decided yet. That is the point: one copy of
 * the geometry serves every colour, and a colour is chosen per instance by
 * swapping the two materials that stand for "inherited surface" and "inherited
 * edge".
 */

const PALETTE_MPD = "/parts/palette.mpd";
const PALETTE_JSON = "/parts/palette.json";
const LDCONFIG_URL = "/ldraw/LDConfig.ldr";

/** LDraw's own codes for "the colour I was given" and its edge. */
const INHERITED_SURFACE = "16";
const INHERITED_EDGE = "24";

export interface PalettePart {
  /** `3001.dat`. */
  file: string;
  group: string;
  halfExtents: Vector3;
  localCenter: Vector3;
  meshes: Mesh[];
  name: string;
  radius: number;
  /** Size in studs as the part's own description states it, for filtering. */
  size: number[];
  /** Prototype, detached and never posed. Instances are clones of this. */
  template: Object3D;
}

export interface PaletteGroup {
  id: string;
  label: string;
  parts: PalettePart[];
}

export interface Palette {
  byFile: Map<string, PalettePart>;
  groups: PaletteGroup[];
  /**
   * Materials for one LDraw colour. Null for a code the library does not
   * define, which the caller should treat as "leave it in the colour it came
   * in" rather than as an error.
   */
  materials: (code: number) => {
    edge: Material | null;
    surface: Material | null;
  };
}

interface CatalogueEntry {
  file: string;
  name: string;
  size: number[];
}

interface Catalogue {
  groups: { id: string; label: string; parts: CatalogueEntry[] }[];
}

interface EdgeMaterialCache {
  edgeMaterialCache?: WeakMap<Material, Material>;
}

export async function loadPalette(): Promise<Palette> {
  Cache.enabled = true;

  const loader = new LDrawLoader();
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  await loader.preloadMaterials(LDCONFIG_URL);

  const [catalogueResponse, mpdResponse] = await Promise.all([
    fetch(PALETTE_JSON),
    fetch(PALETTE_MPD),
  ]);
  if (!(catalogueResponse.ok && mpdResponse.ok)) {
    throw new Error(
      "the parts palette is missing; run `pnpm ldraw:palette` to build it"
    );
  }
  const catalogue = (await catalogueResponse.json()) as Catalogue;
  const source = await mpdResponse.text();

  const raw = await new Promise<Group>((resolve, reject) => {
    loader.parse(source, resolve, reject);
  });

  // The palette is one model whose every reference is a part, so flattening it
  // hands back exactly one brick per palette entry, already measured.
  const { bricks } = flattenModel(raw, {});
  const byFile = new Map<string, PalettePart>();
  for (const brick of bricks) {
    const template = brick.object;
    template.removeFromParent();
    template.position.set(0, 0, 0);
    template.quaternion.identity();
    template.scale.set(1, 1, 1);
    template.updateMatrixWorld(true);

    byFile.set(brick.partFile.toLowerCase(), {
      file: brick.partFile,
      group: "",
      halfExtents: brick.halfExtents,
      localCenter: brick.localCenter,
      meshes: brick.meshes,
      name: brick.partName,
      // A part is turned in ninety-degree steps, so its bounding sphere is the
      // only radius that stays true whichever way up it ends.
      radius: brick.halfExtents.length(),
      size: [],
      template,
    });
  }

  const groups: PaletteGroup[] = [];
  for (const group of catalogue.groups) {
    const parts: PalettePart[] = [];
    for (const entry of group.parts) {
      const part = byFile.get(entry.file.toLowerCase());
      if (!part) {
        continue;
      }
      part.group = group.id;
      part.name = entry.name;
      part.size = entry.size;
      parts.push(part);
    }
    groups.push({ id: group.id, label: group.label, parts });
  }

  const cache = loader as unknown as EdgeMaterialCache;
  const materials = (code: number) => {
    const surface = loader.getMaterial(String(code));
    return {
      // The edge colour is per-colour in LDraw and the loader keeps it beside
      // the surface material rather than in the library, so it is looked up
      // through the surface one.
      edge: surface ? (cache.edgeMaterialCache?.get(surface) ?? null) : null,
      surface,
    };
  };

  return { byFile, groups, materials };
}

function pose(): Pose {
  return {
    position: new Vector3(),
    quaternion: new Quaternion(),
    scale: new Vector3(1, 1, 1),
  };
}

/**
 * Make one instance of a palette part, in a colour.
 *
 * `Object3D.clone` shares geometry and materials, so an instance is a handful
 * of nodes rather than a copy of the part. Recolouring then only has to
 * redirect the two materials that mean "inherited": everything else, like the
 * black of a tyre, is a colour the part itself chose and keeps.
 */
export function instantiate(
  part: PalettePart,
  colorCode: number,
  id: number,
  palette: Palette
): Brick {
  const object = part.template.clone(true);
  const { edge, surface } = palette.materials(colorCode);

  const meshes: Mesh[] = [];
  object.traverse((child) => {
    child.userData.brickId = id;
    if (isMesh(child)) {
      meshes.push(child);
      child.material = recolour(child.material, surface, edge);
      return;
    }
    // Only meshes are pickable; edge lines opt out so the raycast never has to
    // filter them.
    child.raycast = () => {
      // Deliberately empty.
    };
    // Edge lines carry a material too, and it is the one that says what colour
    // an outline is. `LineSegments` is not a `Mesh`, but the field is the same.
    if (isLineSegments(child)) {
      child.material = recolour(child.material, surface, edge);
    }
  });

  return {
    bag: 0,
    builtPose: pose(),
    category: null,
    center: new Vector3(),
    colorCode,
    drop: {
      heightScale: 1,
      offsetX: 0,
      offsetZ: 0,
      spin: 0,
      spinAxis: new Vector3(0, 1, 0),
    },
    floorPose: pose(),
    halfExtents: part.halfExtents.clone(),
    id,
    localCenter: part.localCenter.clone(),
    maxY: 0,
    meshes,
    minY: 0,
    object,
    partFile: part.file,
    partName: part.name,
    radius: part.radius,
    step: 0,
    submodelPath: [],
  };
}

function recolour(
  material: Material | Material[],
  surface: Material | null,
  edge: Material | null
): Material | Material[] {
  if (Array.isArray(material)) {
    return material.map((item) => swap(item, surface, edge));
  }
  return swap(material, surface, edge);
}

function swap(
  material: Material,
  surface: Material | null,
  edge: Material | null
): Material {
  const code = material.userData.code as string | undefined;
  if (code === INHERITED_SURFACE && surface) {
    return surface;
  }
  if (code === INHERITED_EDGE && edge) {
    return edge;
  }
  return material;
}
