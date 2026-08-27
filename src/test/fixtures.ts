import {
  Box3,
  BoxGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { computeBags } from "@/ldraw/bags";
import type { Palette, PalettePart } from "@/ldraw/palette";
import { computeSteps } from "@/ldraw/steps";
import type { Brick, ModelData, Pose, Subassembly } from "@/ldraw/types";

/**
 * A model built from a description rather than from an LDraw file.
 *
 * Parsing a real `.mpd` would drag `LDrawLoader` and a fetch into every test to
 * establish facts that have nothing to do with parsing. What the code under
 * test actually needs is bricks with a part, a colour, a step and a box, so
 * that is what this makes.
 */

/** One stud is 20 LDraw units; a brick is 24 tall. Real numbers keep the
 * geometry maths honest. */
const STUD = 20;
const BRICK_HEIGHT = 24;
/** How far a stud stands above the plane a part's origin sits on. */
const STUD_HEIGHT = 4;

export interface BrickSpec {
  /** Where it sits in the finished model, in LDraw units. */
  at?: [number, number, number];
  colorCode?: number;
  partFile?: string;
  /** Stud footprint, defaulting to a 2x4. */
  size?: [number, number];
  step?: number;
  /** Index into the model's subassemblies; -1 to build straight into place. */
  subassembly?: number;
}

/**
 * One material per colour, which is what `LDrawLoader` produces and what
 * `MaterialVariants` is built to exploit. Sharing it here means a test can
 * compare against "the red material" the way the app does.
 */
const materials = new Map<number, MeshStandardMaterial>();

function materialFor(colorCode: number): MeshStandardMaterial {
  const existing = materials.get(colorCode);
  if (existing) {
    return existing;
  }
  const material = new MeshStandardMaterial();
  materials.set(colorCode, material);
  return material;
}

function boxGeometry(width: number, height: number, depth: number) {
  const geometry = new BoxGeometry(width, height, depth);
  // LDraw puts a part's origin on its top face, so the box hangs below it.
  geometry.translate(0, -height / 2, 0);
  geometry.computeBoundingBox();
  return geometry;
}

function pose(position: Vector3): Pose {
  return {
    position: position.clone(),
    quaternion: new Quaternion(),
    scale: new Vector3(1, 1, 1),
  };
}

export function makeBrick(id: number, spec: BrickSpec = {}): Brick {
  const [studsX, studsZ] = spec.size ?? [2, 4];
  const width = studsX * STUD;
  const depth = studsZ * STUD;
  const [x, y, z] = spec.at ?? [0, BRICK_HEIGHT, 0];

  const colorCode = spec.colorCode ?? 1;
  const object = new Object3D();
  const mesh = new Mesh(
    boxGeometry(width, BRICK_HEIGHT, depth),
    materialFor(colorCode)
  );
  object.add(mesh);
  object.position.set(x, y, z);
  object.updateMatrixWorld(true);
  for (const child of [object, mesh]) {
    child.userData.brickId = id;
  }

  const position = new Vector3(x, y, z);
  return {
    bag: 0,
    builtPose: pose(position),
    category: null,
    center: new Vector3(x, y - BRICK_HEIGHT / 2, z),
    colorCode,
    drop: {
      heightScale: 1,
      offsetX: 0,
      offsetZ: 0,
      spin: 0,
      spinAxis: new Vector3(0, 1, 0),
    },
    floorPose: pose(new Vector3(x + 200, BRICK_HEIGHT, z + 200)),
    halfExtents: new Vector3(width / 2, BRICK_HEIGHT / 2, depth / 2),
    id,
    // LDraw puts a brick's origin on its top face, so its box hangs below.
    localCenter: new Vector3(0, -BRICK_HEIGHT / 2, 0),
    maxY: y,
    meshes: [mesh],
    minY: y - BRICK_HEIGHT,
    object,
    partFile: spec.partFile ?? "3001.dat",
    partName: spec.partFile ?? "Brick 2 x 4",
    radius: Math.hypot(width, BRICK_HEIGHT, depth) / 2,
    step: spec.step ?? 0,
    subassembly: spec.subassembly ?? -1,
    submodelPath: [],
  };
}

export interface ModelSpec {
  bricks: BrickSpec[];
  slug?: string;
  subassemblies?: Subassembly[];
  title?: string;
}

export function makeModel(spec: ModelSpec): ModelData {
  const bricks = spec.bricks.map((brick, index) => makeBrick(index, brick));

  const root = new Group();
  const bounds = new Box3();
  for (const brick of bricks) {
    root.add(brick.object);
    bounds.expandByPoint(
      new Vector3(
        brick.builtPose.position.x,
        brick.minY,
        brick.builtPose.position.z
      )
    );
    bounds.expandByPoint(
      new Vector3(
        brick.builtPose.position.x,
        brick.maxY,
        brick.builtPose.position.z
      )
    );
  }

  const stepCount = new Set(bricks.map((brick) => brick.step)).size;
  const { steps, synthetic } = computeSteps(bricks, stepCount);
  const bags = computeBags(bricks, steps);

  return {
    bags,
    bom: [],
    bounds,
    bricks,
    expectedBricks: bricks.length,
    root,
    slug: spec.slug ?? "test-model",
    smoothNormals: true,
    steps,
    stepsAreSynthetic: synthetic,
    subassemblies: spec.subassemblies ?? [],
    submodels: {
      brickIds: bricks.map((brick) => brick.id),
      children: [],
      name: "test",
      path: "",
      totalBricks: bricks.length,
    },
    title: spec.title ?? "Test Model",
  };
}

export interface PaletteSpec extends BrickSpec {
  file?: string;
  group?: string;
}

/**
 * A parts palette without the 1.9MB pack behind it.
 *
 * `loadPalette` is a fetch, an LDraw parse and a flatten; none of that is what
 * free build's own logic is made of, and all of it would have to be stubbed to
 * get at the part records on the other side. So the records are built here
 * directly, in the same shape the real loader produces.
 */
/** One box of a part, between two heights in the part's own downward-Y frame. */
function slabAt(
  width: number,
  depth: number,
  from: number,
  to: number,
  material: Material
): Mesh {
  const geometry = new BoxGeometry(width, to - from, depth);
  geometry.translate(0, (from + to) / 2, 0);
  geometry.computeBoundingBox();
  return new Mesh(geometry, material);
}

export function makePalette(specs: PaletteSpec[]): Palette {
  const byFile = new Map<string, PalettePart>();
  const parts: PalettePart[] = [];

  for (const [index, spec] of specs.entries()) {
    const [studsX, studsZ] = spec.size ?? [1, 1];
    const width = studsX * STUD;
    const depth = studsZ * STUD;

    // A palette template is raw LDraw geometry: unposed, and still in the frame
    // where Y points down. A part's origin is its stud plane, so the body runs
    // from there to positive local Y, and the studs stand proud at negative
    // local Y. Modelling the studs matters: a part that rests on the bounding
    // box rather than on the body sits a stud's height clear of what is under
    // it, and a fixture without studs cannot catch that.
    //
    // Body and studs are separate boxes, as a real part's are. Fusing them into
    // one leaves no face at the stud plane, and a part measured column by column
    // then has no top surface to find between the two.
    const material = materialFor(spec.colorCode ?? 16);
    const body = slabAt(width, depth, 0, BRICK_HEIGHT, material);
    const studs = slabAt(width, depth, -STUD_HEIGHT, 0, material);

    const template = new Object3D();
    template.add(body, studs);
    template.updateMatrixWorld(true);

    const part: PalettePart = {
      file: spec.file ?? `${3000 + index}.dat`,
      group: spec.group ?? "brick",
      halfExtents: new Vector3(
        width / 2,
        (BRICK_HEIGHT + STUD_HEIGHT) / 2,
        depth / 2
      ),
      localCenter: new Vector3(0, (BRICK_HEIGHT - STUD_HEIGHT) / 2, 0),
      meshes: [body, studs],
      name: spec.partFile ?? `Part ${index}`,
      radius: Math.hypot(width, BRICK_HEIGHT, depth) / 2,
      size: spec.size ?? [1, 1],
      solidCenter: new Vector3(0, BRICK_HEIGHT / 2, 0),
      solidHalfExtents: new Vector3(width / 2, BRICK_HEIGHT / 2, depth / 2),
      template,
    };
    byFile.set(part.file.toLowerCase(), part);
    parts.push(part);
  }

  return {
    byFile,
    groups: [{ id: "brick", label: "Bricks", parts }],
    materials: (code: number) => ({
      edge: materialFor(code + 10_000),
      surface: materialFor(code),
    }),
  };
}

/** A localStorage that behaves like the real one, including throwing on quota. */
export class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();
  /** Set to make the next write fail the way a full store does. */
  full = false;

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: set by a test to make a write fail; Biome infers the literal false from the initialiser
    if (this.full) {
      throw new Error("QuotaExceededError");
    }
    this.entries.set(key, value);
  }
}
