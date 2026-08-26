import {
  type LineSegments,
  type Material,
  type Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import type { Brick, ModelData, ViewMode } from "@/ldraw/types";
import {
  clamp01,
  easeOutBackSoft,
  easeOutBounce,
  staggered,
} from "./animation";
import { MaterialVariants, type RenderState } from "./materials";
import {
  applyRestingPoses,
  type SettleRecording,
  sampleRecording,
  simulateBag,
} from "./settle";
import { isLineSegments, isMesh } from "./three-guards";

/**
 * Release height, as a multiple of whichever is larger: the model's height or
 * how far the loose bricks spread across the floor. Both of those bound what
 * the camera frames, so scaling off them puts the release point above the top
 * of the viewport for any model. Bricks fall in from off-screen.
 */
const POUR_HEIGHT_FACTOR = 1.7;

/**
 * When the first bounce happens, on the normalised drop timeline.
 *
 * `easeOutBounce` accelerates as `n*t*t` until t = 1/2.75, which is the moment
 * of impact. Lateral travel and tumble are matched to it so a brick stops
 * moving sideways and stops spinning exactly when it hits the floor.
 */
const IMPACT_AT = 1 / 2.75;

/** How high a brick arcs on its way from the floor into the model. */
const ASSEMBLE_ARC_FACTOR = 0.22;

/** Everything a build-mode frame needs from outside the assembly. */
export interface BuildFrame {
  activeBag: number;
  /** A brick that has just gone in, flashed briefly so the placement registers. */
  flash: number | null;
  grabbed: number | null;
  /** Loose bricks matching a pending slot, lit up so they can be found. */
  hinted: number[];
  hovered: number | null;
  /** 1 where a slot has been filled. Indexed by brick id. */
  placed: Uint8Array;
  selected: number | null;
}

export interface AssemblyState {
  explode: number;
  hovered: number[];
  isolate: string | null;
  mode: ViewMode;
  /** 0-1 progress of pouring the active bag onto the floor. */
  pourProgress: number;
  selected: number | null;
  slice: number;
  step: number;
  /** 0-1 progress of the current step's placement. */
  stepProgress: number;
}

interface FrameSetup {
  bagBrickCount: number;
  bagIndex: number;
  completed: number;
  explodeDistance: number;
  placeIndex: Map<number, number>;
  pourIndex: Map<number, number>;
  sliceActive: boolean;
  sliceFade: number;
  sliceThreshold: number;
  stepIds: number[];
}

interface Renderable {
  /** Lines switched off for a heavy model must stay off. */
  enabled: boolean;
  isLine: boolean;
  object: Mesh | LineSegments;
  original: Material | Material[];
}

/**
 * Owns every brick's transform and appearance.
 *
 * This runs per frame over every brick, which is why it holds plain arrays and
 * scratch vectors rather than going through React. Nothing here allocates in
 * the update path.
 */
export class Assembly {
  readonly model: ModelData;
  private readonly variants = new MaterialVariants();
  private readonly renderables: Renderable[][] = [];
  private readonly renderState: RenderState[] = [];
  private readonly inScene: boolean[] = [];

  private readonly modelCenter = new Vector3();
  private readonly explodeDir: Vector3[] = [];
  private readonly modelRadius: number;
  private readonly pourHeight: number;
  private readonly floorY: number;
  private readonly modelHeight: number;

  /** Which bag's bricks are currently in the scene graph. */
  private activeBag = -1;

  /** Baked drop for the open bag. Only one is kept: they are ~500KB each. */
  private recording: SettleRecording | null = null;
  private recordedBag = -1;
  private readonly scratchQuatB = new Quaternion();

  private readonly scratchPos = new Vector3();
  private readonly scratchQuat = new Quaternion();

  constructor(model: ModelData) {
    this.model = model;

    const size = new Vector3();
    model.bounds.getSize(size);
    model.bounds.getCenter(this.modelCenter);
    this.modelRadius = Math.max(size.length() * 0.5, 1);
    this.floorY = model.bounds.min.y;
    this.modelHeight = Math.max(size.y, 1);

    for (const brick of model.bricks) {
      this.renderables.push(collectRenderables(brick.object));
      this.renderState.push("normal");
      this.inScene.push(false);

      const dir = brick.center.clone().sub(this.modelCenter);
      // A brick sitting exactly at the centre has no direction to explode
      // along, so give it a deterministic one rather than a zero vector.
      if (dir.lengthSq() < 1e-6) {
        dir.set(0, 1, 0);
      }
      this.explodeDir.push(dir.normalize());

      // Bricks start detached. `setActiveBag` adds only what is needed.
      brick.object.removeFromParent();
    }

    // How far the scatter reaches, which together with the model's height is
    // what the camera has to fit on screen.
    let reach = 0;
    for (const brick of model.bricks) {
      const dx = brick.floorPose.position.x - this.modelCenter.x;
      const dz = brick.floorPose.position.z - this.modelCenter.z;
      reach = Math.max(reach, Math.hypot(dx, dz));
    }
    this.pourHeight = Math.max(size.y, reach) * POUR_HEIGHT_FACTOR + 40;
  }

  /**
   * Add the given bag's bricks to the scene and remove everything from later
   * bags. Bricks from earlier bags stay: they are part of the model now.
   */
  setActiveBag(bagIndex: number): void {
    if (bagIndex === this.activeBag) {
      return;
    }
    this.activeBag = bagIndex;

    for (const brick of this.model.bricks) {
      const shouldBeInScene = brick.bag <= bagIndex;
      if (shouldBeInScene === this.inScene[brick.id]) {
        continue;
      }

      if (shouldBeInScene) {
        this.model.root.add(brick.object);
      } else {
        brick.object.removeFromParent();
      }

      this.inScene[brick.id] = shouldBeInScene;
    }
  }

  /**
   * Simulate this bag's drop, if it has not been simulated already, and take
   * the settled poses as its resting layout.
   *
   * Returns the recording's length in seconds so the caller can play it back at
   * the rate it was recorded, or null when physics is unavailable and the
   * scripted drop should be used instead.
   */
  bakeBag(bagIndex: number, seed: string): number | null {
    if (this.recordedBag === bagIndex) {
      return this.recording?.duration ?? null;
    }

    const bag = this.model.bags[bagIndex];
    if (!bag) {
      return null;
    }

    const recording = simulateBag(
      bag,
      this.model.bricks,
      this.floorY,
      this.pourHeight,
      seed
    );

    this.recordedBag = bagIndex;
    this.recording = recording;
    if (!recording) {
      return null;
    }

    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[ldraw] bag ${bagIndex + 1}: settled ${recording.order.length} bricks into ` +
          `${recording.frames} frames (${recording.duration.toFixed(2)}s)`
      );
    }

    // Where the bricks actually came to rest is now the floor layout, which is
    // what the flight into the model starts from and what the camera frames.
    applyRestingPoses(recording, this.model.bricks);
    return recording.duration;
  }

  /** Floor height in model space, which is where the physics ground sits. */
  get floor(): number {
    return this.floorY;
  }

  /** Release height, and the characteristic length the live world is scaled by. */
  get dropHeight(): number {
    return this.pourHeight;
  }

  get centre(): Vector3 {
    return this.modelCenter;
  }

  /**
   * Hand one brick's object to another record, and take its own back.
   *
   * Build mode matches slots by part rather than by identity, so the brick that
   * gets carried into a slot is almost never the record that owns it. Swapping
   * the two objects is what makes that invisible: identical part and colour
   * means identical geometry and materials, so nothing on screen changes, and
   * afterwards every record still owns exactly one object.
   *
   * The per-brick caches have to move with it, or styling would be applied to
   * the wrong meshes from here on.
   */
  swapBrickObjects(a: number, b: number): void {
    const first = this.model.bricks[a];
    const second = this.model.bricks[b];
    if (a === b || !(first && second)) {
      return;
    }

    const { meshes, object } = first;
    first.object = second.object;
    first.meshes = second.meshes;
    second.object = object;
    second.meshes = meshes;

    stampBrickId(first);
    stampBrickId(second);

    swap(this.renderables, a, b);
    swap(this.renderState, a, b);
    swap(this.inScene, a, b);
  }

  /**
   * Pose and style one build-mode frame.
   *
   * Loose bricks are deliberately not posed here: the live world owns them, and
   * writing over its output would be a fight the renderer wins one frame and
   * the solver wins the next.
   */
  updateBuild(frame: BuildFrame): void {
    this.setActiveBag(frame.activeBag);

    for (const brick of this.model.bricks) {
      if (!this.inScene[brick.id]) {
        continue;
      }

      if (frame.placed[brick.id] === 1) {
        brick.object.position.copy(brick.builtPose.position);
        brick.object.quaternion.copy(brick.builtPose.quaternion);
      }

      this.applyState(brick, buildStateOf(brick.id, frame));
    }
  }

  /** Bricks belonging to the step currently being placed, in placement order. */
  private stepBricks(step: number): number[] {
    return this.model.steps[step]?.brickIds ?? [];
  }

  /**
   * Everything the frame needs that is the same for every brick. Split out of
   * `update` so the per-brick loop below reads as one job rather than two.
   */
  private prepareFrame(state: AssemblyState): FrameSetup {
    const { bricks, steps } = this.model;

    // `state.step` counts steps already finished, so 0 is an untouched pile and
    // steps.length is a finished model. The step being worked on is the one at
    // that index, which does not exist once everything is placed.
    const totalSteps = steps.length;
    const completed = clamp(state.step, 0, totalSteps);
    const workingStep = Math.min(completed, Math.max(totalSteps - 1, 0));

    const bagIndex = steps[workingStep]?.bag ?? 0;
    const bag = this.model.bags[bagIndex];
    const stepIds =
      completed < totalSteps ? this.stepBricks(completed) : EMPTY_IDS;

    // Index within the bag drives the pour stagger; index within the step
    // drives the placement stagger.
    const pourIndex = new Map<number, number>();
    if (bag) {
      for (const [index, id] of bag.brickIds.entries()) {
        pourIndex.set(id, index);
      }
    }
    const placeIndex = new Map<number, number>();
    for (const [index, id] of stepIds.entries()) {
      placeIndex.set(id, index);
    }

    const explodeAmount = state.mode === "explode" ? state.explode : 0;

    return {
      bagBrickCount: bag?.brickIds.length ?? bricks.length,
      bagIndex,
      completed,
      explodeDistance: this.modelRadius * 1.1 * explodeAmount,
      placeIndex,
      pourIndex,
      sliceActive: state.mode === "slice" && state.slice < 0.999,
      sliceFade: this.modelHeight * 0.06,
      sliceThreshold: this.floorY + state.slice * this.modelHeight,
      stepIds,
    };
  }

  /** 0 while a brick is still in the pile, 1 once it is in place. */
  private static assemblyProgress(
    brick: Brick,
    frame: FrameSetup,
    stepProgress: number
  ): number {
    if (brick.bag < frame.bagIndex || brick.step < frame.completed) {
      return 1;
    }
    if (brick.bag !== frame.bagIndex || brick.step !== frame.completed) {
      return 0;
    }
    const index = frame.placeIndex.get(brick.id) ?? 0;
    return easeOutBackSoft(
      staggered(stepProgress, index, frame.stepIds.length)
    );
  }

  update(state: AssemblyState): void {
    const { bricks } = this.model;
    if (bricks.length === 0) {
      return;
    }

    const frame = this.prepareFrame(state);
    this.setActiveBag(frame.bagIndex);

    for (const brick of bricks) {
      if (!this.inScene[brick.id]) {
        continue;
      }

      const t = Assembly.assemblyProgress(brick, frame, state.stepProgress);

      this.poseBrick(brick, t, {
        explodeDistance: frame.explodeDistance,
        pourCount: frame.bagBrickCount,
        pourIndex: frame.pourIndex.get(brick.id) ?? 0,
        pourProgress: state.pourProgress,
      });

      this.styleBrick(brick, {
        assembledness: t,
        hovered: state.hovered,
        isolate: state.isolate,
        selected: state.selected,
        sliceActive: frame.sliceActive,
        sliceFade: frame.sliceFade,
        sliceThreshold: frame.sliceThreshold,
      });
    }
  }

  private poseBrick(
    brick: Brick,
    t: number,
    opts: {
      pourProgress: number;
      pourIndex: number;
      pourCount: number;
      explodeDistance: number;
    }
  ): void {
    const { object } = brick;
    const floor = brick.floorPose;
    const built = brick.builtPose;

    if (t >= 1) {
      object.position.copy(built.position);
      object.quaternion.copy(built.quaternion);
      if (opts.explodeDistance > 0) {
        object.position.addScaledVector(
          this.explodeDir[brick.id],
          opts.explodeDistance
        );
      }
      return;
    }

    // Still on, or falling towards, the floor.
    if (t <= 0) {
      this.dropBrick(brick, opts.pourProgress, opts.pourIndex, opts.pourCount);
      return;
    }

    // In flight from the floor into the model. The shallow arc is what
    // separates being lifted and set down from being dragged across the table.
    const from = this.scratchPos.copy(floor.position);
    object.position.lerpVectors(from, built.position, t);
    object.position.y +=
      Math.sin(Math.PI * t) * this.modelRadius * ASSEMBLE_ARC_FACTOR;

    object.quaternion.copy(
      this.scratchQuat.slerpQuaternions(floor.quaternion, built.quaternion, t)
    );

    if (opts.explodeDistance > 0) {
      object.position.addScaledVector(
        this.explodeDir[brick.id],
        opts.explodeDistance * t
      );
    }
  }

  /**
   * Place a brick that is still falling into the pile.
   *
   * Normally this replays the baked rigid-body simulation, which is where the
   * collisions and the uneven settling come from.
   *
   * The scripted fall below is the fallback for when the physics module fails
   * to load. It approximates the same shape with no solver: quadratic
   * acceleration, lateral travel that arrives with the brick, a tumble that
   * stops on impact, and a bounce whose height decays. Every brick bounces on
   * the same curve, which is exactly the tell the simulation removes.
   */
  private dropBrick(
    brick: Brick,
    progress: number,
    index: number,
    count: number
  ): void {
    const { recording } = this;
    if (recording) {
      const slot = recording.slotOf.get(brick.id);
      if (slot !== undefined) {
        sampleRecording(
          recording,
          slot,
          progress * (recording.frames - 1),
          brick.object.position,
          brick.object.quaternion,
          this.scratchQuatB
        );
        return;
      }
    }

    const u = staggered(progress, index, count, 0.45);
    const { drop } = brick;
    const floor = brick.floorPose;

    // 1 at release, 0 at rest, with the bounces on the way in.
    const height = 1 - easeOutBounce(u);
    brick.object.position.y =
      floor.position.y + this.pourHeight * drop.heightScale * height;

    // Lateral travel and tumble both finish at the first impact. After that the
    // brick is on the floor and only its bounce is still playing out.
    const landed = clamp01(u / IMPACT_AT);
    const remaining = (1 - landed) ** 2;

    brick.object.position.x = floor.position.x + drop.offsetX * remaining;
    brick.object.position.z = floor.position.z + drop.offsetZ * remaining;

    if (drop.spin > 0 && remaining > 0) {
      this.scratchQuat.setFromAxisAngle(
        drop.spinAxis,
        drop.spin * Math.PI * 2 * remaining
      );
      brick.object.quaternion.copy(this.scratchQuat).multiply(floor.quaternion);
    } else {
      brick.object.quaternion.copy(floor.quaternion);
    }
  }

  private styleBrick(
    brick: Brick,
    opts: {
      assembledness: number;
      sliceActive: boolean;
      sliceThreshold: number;
      sliceFade: number;
      isolate: string | null;
      selected: number | null;
      hovered: number[];
    }
  ): void {
    let next: RenderState | "hidden" = "normal";

    if (opts.selected === brick.id || opts.hovered.includes(brick.id)) {
      next = "highlight";
    } else if (opts.isolate !== null && !inSubmodel(brick, opts.isolate)) {
      next = "dim";
    } else if (opts.sliceActive && opts.assembledness >= 1) {
      // Only assembled bricks participate in slicing; loose bricks on the floor
      // are below the model anyway and hiding them would look like a bug.
      if (brick.minY > opts.sliceThreshold + opts.sliceFade) {
        next = "hidden";
      } else if (brick.minY > opts.sliceThreshold) {
        next = "ghost";
      }
    }

    this.applyState(brick, next);
  }

  private applyState(brick: Brick, next: RenderState | "hidden"): void {
    const visible = next !== "hidden";
    if (brick.object.visible !== visible) {
      brick.object.visible = visible;
    }
    if (!visible) {
      return;
    }

    const state = next;
    if (this.renderState[brick.id] === state) {
      return;
    }
    this.renderState[brick.id] = state;

    for (const renderable of this.renderables[brick.id]) {
      // A near-transparent brick keeps its edge lines at full strength, which
      // leaves a wireframe floating in mid-air, so the lines drop out instead.
      // Heavy models switch them off before we get here; do not turn them back on.
      if (renderable.isLine) {
        if (!renderable.enabled) {
          continue;
        }
        renderable.object.visible = state === "normal" || state === "highlight";
        continue;
      }
      renderable.object.material = mapMaterial(
        this.variants,
        renderable.original,
        state
      );
    }
  }

  dispose(): void {
    for (const list of this.renderables) {
      for (const renderable of list) {
        renderable.object.material = renderable.original;
      }
    }
    this.variants.dispose();
  }
}

function collectRenderables(root: Object3D): Renderable[] {
  const out: Renderable[] = [];
  root.traverse((object) => {
    if (isMesh(object)) {
      out.push({
        enabled: true,
        isLine: false,
        object,
        original: object.material,
      });
    } else if (isLineSegments(object)) {
      out.push({
        enabled: object.visible,
        isLine: true,
        object,
        original: object.material,
      });
    }
  });
  return out;
}

function mapMaterial(
  variants: MaterialVariants,
  original: Material | Material[],
  state: RenderState
): Material | Material[] {
  if (state === "normal") {
    return original;
  }
  if (Array.isArray(original)) {
    return original.map((item) => variants.get(item, state));
  }
  return variants.get(original, state);
}

function inSubmodel(brick: Brick, path: string): boolean {
  if (path === "") {
    return true;
  }
  const brickPath = brick.submodelPath.join("/");
  return brickPath === path || brickPath.startsWith(`${path}/`);
}

function buildStateOf(id: number, frame: BuildFrame): RenderState {
  if (
    frame.grabbed === id ||
    frame.hovered === id ||
    frame.selected === id ||
    frame.flash === id ||
    frame.hinted.includes(id)
  ) {
    return "highlight";
  }
  return "normal";
}

function stampBrickId(brick: Brick): void {
  brick.object.traverse((child) => {
    child.userData.brickId = brick.id;
  });
}

function swap<T>(list: T[], a: number, b: number): void {
  const held = list[a];
  list[a] = list[b];
  list[b] = held;
}

const EMPTY_IDS: number[] = [];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
