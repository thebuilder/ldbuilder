import {
  Box3,
  Group,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  Sphere,
  Vector3,
} from "three";
import { isMesh } from "@/scene/three-guards";
import { colorName } from "./colors.generated";
import type { BomEntry, Brick, Pose, SubmodelNode } from "./types";

/**
 * LDraw's Y axis points down. Rotating 180 degrees about X puts the model into
 * a conventional Y-up frame. Rather than parking this on a container we bake it
 * into every brick's matrix, so all downstream maths (floor scatter, explode
 * direction, height slicing) can assume Y-up without constantly compensating.
 */
const LDRAW_TO_YUP = new Matrix4().makeRotationX(Math.PI);
const UNOFFICIAL_PREFIX = /^Unofficial_/i;
const BRICK_TYPE = /^(Part|Shortcut)$/i;

/**
 * A file's `0 !LDRAW_ORG` header, as LDrawLoader records it: the first token
 * only, defaulting to 'Model' when the header is absent.
 *
 * A Part is one brick. A Shortcut is a pre-assembled group (a door in its
 * frame, a minifig) that is bought and handled as one piece, so it counts as
 * one brick too, and we must not descend into it or its constituent Parts
 * would each be counted again.
 */
function isBrickGroup(object: Object3D): boolean {
  const raw = object.userData.type;
  if (typeof raw !== "string") {
    return false;
  }
  const type = raw.replace(UNOFFICIAL_PREFIX, "");
  return BRICK_TYPE.test(type);
}

function fileNameOf(object: Object3D): string {
  const name = object.userData.fileName;
  if (typeof name === "string" && name.length > 0) {
    return name;
  }
  return object.name || "unknown";
}

/**
 * One *occurrence* of a submodel, as opposed to `SubmodelNode`, which is one
 * submodel *file*.
 *
 * The gatehouse references tower.ldr four times. Those are one node in the
 * submodel tree, because isolating "the towers" should light up all four, but
 * they are four separate things to build, each with its own steps and its own
 * place to be built. Staging needs the occurrences; the panel needs the files.
 */
export interface InstanceNode {
  /** Bricks directly in this occurrence, excluding those in nested ones. */
  brickIds: number[];
  children: number[];
  name: string;
  /** Index into the instances array. -1 for an occurrence at the top level. */
  parent: number;
}

export interface FlattenResult {
  bounds: Box3;
  bricks: Brick[];
  /** Bricks whose geometry was empty; usually a sign of an incomplete pack. */
  emptyBricks: number;
  /** Every submodel occurrence, parents before children. */
  instances: InstanceNode[];
  root: Group;
  submodels: SubmodelNode;
}

/**
 * Cut the loaded hierarchy into a flat list of independently transformable
 * bricks, while keeping the submodel structure as data.
 *
 * The scene graph cannot express what we need: a brick has to fly from a floor
 * position to its place in the model, which means its transform must be
 * absolute rather than relative to a submodel that is itself moving. So the
 * nesting is flattened away and the submodel tree is recorded separately.
 */
export function flattenModel(
  raw: Object3D,
  partNames: Record<string, string>
): FlattenResult {
  raw.updateMatrixWorld(true);

  const root = new Group();
  root.name = "assembly";

  interface Collected {
    /** Index into `instances`, or -1 when the brick sits in the main model. */
    instance: number;
    matrix: Matrix4;
    object: Object3D;
    step: number;
    submodelPath: string[];
  }

  const collected: Collected[] = [];
  const instances: InstanceNode[] = [];
  const submodelRoot: SubmodelNode = {
    brickIds: [],
    children: [],
    name: fileNameOf(raw),
    path: "",
    totalBricks: 0,
  };
  const nodeByPath = new Map<string, SubmodelNode>([["", submodelRoot]]);

  function nodeFor(path: string[]): SubmodelNode {
    const key = path.join("/");
    const existing = nodeByPath.get(key);
    if (existing) {
      return existing;
    }

    const parent = nodeFor(path.slice(0, -1));
    const node: SubmodelNode = {
      brickIds: [],
      children: [],
      name: path.at(-1) ?? "",
      path: key,
      totalBricks: 0,
    };
    parent.children.push(node);
    nodeByPath.set(key, node);
    return node;
  }

  // Collect first, re-parent second: re-parenting mutates the children arrays
  // we would otherwise be iterating.
  function walk(
    object: Object3D,
    submodelPath: string[],
    inheritedStep: number,
    instance: number
  ): void {
    const step =
      typeof object.userData.buildingStep === "number"
        ? (object.userData.buildingStep as number)
        : inheritedStep;

    if (object !== raw && isBrickGroup(object)) {
      collected.push({
        instance,
        matrix: new Matrix4().multiplyMatrices(
          LDRAW_TO_YUP,
          object.matrixWorld
        ),
        object,
        step,
        submodelPath,
      });
      return;
    }

    // A non-brick Group with its own file name is a submodel boundary. The
    // root itself is the main model, so it does not extend the path.
    let nextPath = submodelPath;
    let nextInstance = instance;
    if (object !== raw && (object as Group).isGroup) {
      const name = fileNameOf(object);
      if (name !== "unknown") {
        nextPath = [...submodelPath, name];
        nodeFor(nextPath);

        nextInstance = instances.length;
        instances.push({
          brickIds: [],
          children: [],
          name,
          parent: instance,
        });
        instances[instance]?.children.push(nextInstance);
      }
    }

    for (const child of object.children) {
      walk(child, nextPath, step, nextInstance);
    }
  }

  walk(raw, [], 0, -1);

  const bricks: Brick[] = [];
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();

  for (const item of collected) {
    const id = bricks.length;
    item.matrix.decompose(position, quaternion, scale);

    const { object } = item;
    object.matrixAutoUpdate = true;
    object.position.copy(position);
    object.quaternion.copy(quaternion);
    object.scale.copy(scale);
    root.add(object);

    const builtPose: Pose = {
      position: position.clone(),
      quaternion: quaternion.clone(),
      scale: scale.clone(),
    };

    const meshes: Mesh[] = [];
    object.traverse((child) => {
      child.userData.brickId = id;
      if (isMesh(child)) {
        meshes.push(child);
      } else {
        child.raycast = () => {
          // Only meshes are pickable; edge lines opt out here so the raycast
          // never has to filter them.
        };
      }
    });

    const partFile = fileNameOf(object);
    const colorCode = Number(object.userData.colorCode ?? 16);
    const category =
      typeof object.userData.category === "string"
        ? object.userData.category
        : null;

    bricks.push({
      bag: 0,
      builtPose,
      category,
      center: new Vector3(),
      colorCode,
      drop: {
        heightScale: 1,
        offsetX: 0,
        offsetZ: 0,
        spin: 0,
        spinAxis: new Vector3(0, 1, 0),
      },
      // Filled in by the layout pass once overall bounds are known.
      floorPose: {
        position: new Vector3(),
        quaternion: new Quaternion(),
        scale: scale.clone(),
      },
      halfExtents: new Vector3(),
      id,
      localCenter: new Vector3(),
      maxY: 0,
      meshes,
      minY: 0,
      object,
      partFile,
      partName: partNames[partFile.toLowerCase()] ?? partFile,
      radius: 0,
      step: item.step,
      // Filled in by the subassembly pass, which needs the steps first.
      subassembly: -1,
      submodelPath: item.submodelPath,
    });

    nodeFor(item.submodelPath).brickIds.push(id);
    instances[item.instance]?.brickIds.push(id);
  }

  root.updateMatrixWorld(true);

  // Per-brick bounds drive floor spacing, explode directions and height slicing.
  const bounds = new Box3();
  const box = new Box3();
  const sphere = new Sphere();
  let emptyBricks = 0;

  const localBox = new Box3();
  const geometryBox = new Box3();
  const toLocal = new Matrix4();
  const inverse = new Matrix4();
  const size = new Vector3();

  for (const brick of bricks) {
    box.setFromObject(brick.object, true);
    if (box.isEmpty()) {
      emptyBricks += 1;
      continue;
    }
    box.getCenter(brick.center);
    box.getBoundingSphere(sphere);
    brick.radius = sphere.radius;
    brick.minY = box.min.y;
    brick.maxY = box.max.y;
    bounds.union(box);

    // The box above is axis-aligned in assembly space, so it changes shape with
    // the brick's orientation and is useless as a collider. This one is in the
    // brick's own space: constant, and the right size to drop.
    localBox.makeEmpty();
    inverse.copy(brick.object.matrixWorld).invert();
    for (const mesh of brick.meshes) {
      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
      }
      const source = mesh.geometry.boundingBox;
      if (!source) {
        continue;
      }
      toLocal.multiplyMatrices(inverse, mesh.matrixWorld);
      geometryBox.copy(source).applyMatrix4(toLocal);
      localBox.union(geometryBox);
    }
    if (!localBox.isEmpty()) {
      localBox.getSize(size);
      brick.halfExtents.set(
        Math.max(size.x / 2, 0.5),
        Math.max(size.y / 2, 0.5),
        Math.max(size.z / 2, 0.5)
      );
      localBox.getCenter(brick.localCenter);
    }
  }

  function total(node: SubmodelNode): number {
    node.totalBricks =
      node.brickIds.length +
      node.children.reduce((sum, child) => sum + total(child), 0);
    return node.totalBricks;
  }
  total(submodelRoot);

  return {
    bounds,
    bricks,
    emptyBricks,
    instances,
    root,
    submodels: submodelRoot,
  };
}

/** Group bricks into a bill of materials, keyed by part and colour. */
export function buildBom(bricks: Brick[]): BomEntry[] {
  const map = new Map<string, BomEntry>();

  for (const brick of bricks) {
    const key = `${brick.partFile.toLowerCase()}|${brick.colorCode}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.brickIds.push(brick.id);
      existing.firstStep = Math.min(existing.firstStep, brick.step);
      continue;
    }
    map.set(key, {
      brickIds: [brick.id],
      colorCode: brick.colorCode,
      count: 1,
      firstStep: brick.step,
      key,
      partFile: brick.partFile,
      partName: brick.partName,
    });
  }

  return [...map.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.partName.localeCompare(b.partName) ||
      colorName(a.colorCode).localeCompare(colorName(b.colorCode))
  );
}
