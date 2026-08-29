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
  brickIds: number[];
  children: number[];
  name: string;
  parent: number;
}

export interface FlattenResult {
  bounds: Box3;
  bricks: Brick[];
  emptyBricks: number;
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
interface Collected {
  instance: number;
  matrix: Matrix4;
  object: Object3D;
  step: number;
  submodelPath: string[];
}

interface Collection {
  collected: Collected[];
  instances: InstanceNode[];
  nodeFor: (path: string[]) => SubmodelNode;
  submodelRoot: SubmodelNode;
}

/**
 * Walk the loaded hierarchy once, recording every brick with where it came
 * from: its step, its submodel path, and which occurrence of that submodel.
 *
 * Collect first, re-parent second. The caller re-parents each brick onto a flat
 * root, which mutates the very children arrays this is iterating.
 */
function collectBricks(raw: Object3D): Collection {
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

  /**
   * Enter a submodel: one more node in the file tree, and one more occurrence.
   * Returns the path and occurrence its children belong to, which is the
   * unchanged pair for anything that is not a submodel boundary.
   */
  function descend(
    object: Object3D,
    submodelPath: string[],
    instance: number
  ): [string[], number] {
    if (object === raw || !(object as Group).isGroup) {
      return [submodelPath, instance];
    }
    const name = fileNameOf(object);
    if (name === "unknown") {
      return [submodelPath, instance];
    }

    const path = [...submodelPath, name];
    nodeFor(path);

    const next = instances.length;
    instances.push({ brickIds: [], children: [], name, parent: instance });
    instances[instance]?.children.push(next);
    return [path, next];
  }

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

    const [nextPath, nextInstance] = descend(object, submodelPath, instance);
    for (const child of object.children) {
      walk(child, nextPath, step, nextInstance);
    }
  }

  walk(raw, [], 0, -1);
  return { collected, instances, nodeFor, submodelRoot };
}

const localBox = new Box3();
const geometryBox = new Box3();
const toLocal = new Matrix4();
const inverse = new Matrix4();
const size = new Vector3();

/**
 * Measure the brick's own box, in its own space, and record it as the collider.
 *
 * The world box taken alongside this is axis-aligned in assembly space, so it
 * changes shape with the brick's orientation and is useless to drop. This one
 * is constant whichever way the brick is turned, and the right size.
 */
function measureCollider(brick: Brick): void {
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

  if (localBox.isEmpty()) {
    return;
  }
  localBox.getSize(size);
  brick.halfExtents.set(
    Math.max(size.x / 2, 0.5),
    Math.max(size.y / 2, 0.5),
    Math.max(size.z / 2, 0.5)
  );
  localBox.getCenter(brick.localCenter);
}

export function flattenModel(
  raw: Object3D,
  partNames: Record<string, string>
): FlattenResult {
  raw.updateMatrixWorld(true);

  const root = new Group();
  root.name = "assembly";

  const { collected, instances, nodeFor, submodelRoot } = collectBricks(raw);

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
          // Only meshes are pickable.
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
      subassembly: -1,
      submodelPath: item.submodelPath,
    });

    nodeFor(item.submodelPath).brickIds.push(id);
    instances[item.instance]?.brickIds.push(id);
  }

  root.updateMatrixWorld(true);

  const bounds = new Box3();
  const box = new Box3();
  const sphere = new Sphere();
  let emptyBricks = 0;

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

    measureCollider(brick);
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
