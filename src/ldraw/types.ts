import type { Box3, Mesh, Object3D, Quaternion, Vector3 } from "three";

/** A rigid transform, kept decomposed so we can tween position and rotation independently. */
export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
}

/**
 * One physical brick: a single Part or Shortcut instance, detached from the
 * loaded hierarchy so its transform can be animated independently.
 */
/**
 * How one brick enters when its bag is tipped out. Seeded once at layout time
 * so a model always pours the same way, and so nothing has to be randomised
 * inside the per-frame loop.
 */
export interface BrickDrop {
  /** Multiplier on the release height, so they do not all leave one plane. */
  heightScale: number;
  /** Horizontal offset it is released from, relative to where it lands. */
  offsetX: number;
  offsetZ: number;
  /** Turns it makes before it hits the floor. */
  spin: number;
  /** Axis it tumbles about on the way down. */
  spinAxis: Vector3;
}

export interface Brick {
  bag: number;
  builtPose: Pose;
  category: string | null;
  /** Bounding box centre in assembly space, used for explode direction. */
  center: Vector3;
  colorCode: number;
  drop: BrickDrop;
  floorPose: Pose;
  /** Half the brick's own bounding box, in its local space: the collider size. */
  halfExtents: Vector3;
  id: number;
  /** Where that box sits relative to the brick's origin, which LDraw puts on
   * the top face rather than the middle. */
  localCenter: Vector3;
  maxY: number;
  /** Meshes only, for raycasting. Edge lines are excluded so picking stays cheap. */
  meshes: Mesh[];
  minY: number;
  object: Object3D;
  /** Normalized LDraw reference, e.g. `3001.dat`. */
  partFile: string;
  /** Human description from the packed parts.json, falling back to partFile. */
  partName: string;
  /** Bounding sphere radius, used to space out the floor scatter. */
  radius: number;
  step: number;
  /**
   * Index into `ModelData.subassemblies`, or -1 when the brick is built
   * straight into the model.
   */
  subassembly: number;
  /** Enclosing submodel file names, outermost first. Empty for the main model. */
  submodelPath: string[];
}

/**
 * A submodel occurrence that gets built off to the side and then attached.
 *
 * This is what an instruction booklet does when it takes you off to a corner of
 * the page to build a subassembly before showing you where it goes, and it is
 * the only honest way to show one: an LDraw file records every brick at its
 * final position in the finished model, so replaying the steps literally builds
 * a subassembly in mid-air, inside the silhouette of a model that does not
 * exist yet.
 */
export interface Subassembly {
  /** Every brick in it, nested submodels included. */
  brickIds: number[];
  /** Step at which the last of it goes on, and so the step it slides in during. */
  installStep: number;
  /** Submodel file name, without its extension. */
  label: string;
  /**
   * Displacement from where the bricks belong to where they are built, applied
   * to every brick in the subassembly. A pure translation, so the thing being
   * built off-model is recognisably the thing that will slot in.
   */
  offset: Vector3;
}

export interface StepInfo {
  bag: number;
  brickIds: number[];
  index: number;
  /** Submodel this step belongs to, for the HUD readout. */
  submodel: string | null;
}

export interface BagInfo {
  brickIds: number[];
  firstStep: number;
  index: number;
  /** Set when the bag lines up with a single submodel, used as its label. */
  label: string;
  lastStep: number;
}

export interface BomEntry {
  brickIds: number[];
  colorCode: number;
  count: number;
  /** First step this part is used in, so the bin can sort by build order. */
  firstStep: number;
  key: string;
  partFile: string;
  partName: string;
}

export interface SubmodelNode {
  brickIds: number[];
  children: SubmodelNode[];
  name: string;
  /** Path joined with '/', unique. Empty string is the root. */
  path: string;
  /** Includes descendants. */
  totalBricks: number;
}

export interface ModelData {
  bags: BagInfo[];
  bom: BomEntry[];
  bounds: Box3;
  bricks: Brick[];
  /**
   * Who to credit for the model itself, shown in the viewer.
   *
   * The parts library's attribution is in the footer on every route, but that
   * covers the bricks, not the person who built the thing out of them. CC BY
   * wants the author of an OMR set named wherever the set is shown, and the
   * viewer is where a deep link lands.
   */
  credit: string | null;
  /** Brick count reported by the packer, for cross-checking the flatten pass. */
  expectedBricks: number | null;
  /** Container holding every brick. Sits under the scale/centre transform. */
  root: Object3D;
  slug: string;
  /** False on large models, where normal smoothing is traded away for load time. */
  smoothNormals: boolean;
  steps: StepInfo[];
  /** True when no `0 STEP` metas existed and the order was inferred from height. */
  stepsAreSynthetic: boolean;
  /** Submodel occurrences built off-model. Empty when nothing qualifies. */
  subassemblies: Subassembly[];
  submodels: SubmodelNode;
  title: string;
}

export type ViewMode = "assemble" | "explode" | "slice";

/**
 * The two flows.
 *
 * `watch` plays the model out step by step. `build` drops the bag on the floor
 * and makes you find the pieces and put them in yourself.
 */
export type SessionMode = "build" | "watch";

/** What build mode reports back for the HUD. Derived state, recomputed on change. */
export interface BuildProgress {
  bag: number;
  done: boolean;
  /** Bricks still loose on the floor for the open bag. */
  loose: number;
  /** Slots of the current step still to fill, so the HUD can name the parts. */
  pending: number[];
  placedTotal: number;
  /** True when the session picked a saved build up rather than starting fresh. */
  resumed: boolean;
  step: number;
  totalBags: number;
  totalSteps: number;
  /** Set when build mode could not start at all, e.g. physics failed to load. */
  unavailable: boolean;
}

export interface LoadProgress {
  detail?: string;
  /** 0-1, or null when the phase has no meaningful fraction. */
  fraction: number | null;
  phase: "fetching" | "parsing" | "flattening" | "laying-out" | "ready";
}
