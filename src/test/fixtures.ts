import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { computeBags } from "@/ldraw/bags";
import { computeSteps } from "@/ldraw/steps";
import type { Brick, ModelData, Pose } from "@/ldraw/types";

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

export interface BrickSpec {
  /** Where it sits in the finished model, in LDraw units. */
  at?: [number, number, number];
  colorCode?: number;
  partFile?: string;
  /** Stud footprint, defaulting to a 2x4. */
  size?: [number, number];
  step?: number;
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
    submodelPath: [],
  };
}

export interface ModelSpec {
  bricks: BrickSpec[];
  slug?: string;
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
