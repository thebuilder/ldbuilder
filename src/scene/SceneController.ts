import {
  Box3,
  Group,
  Matrix4,
  type Mesh,
  Plane,
  Quaternion,
  Ray,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import type {
  Brick,
  BuildProgress,
  ModelData,
  SessionMode,
  ViewMode,
} from "@/ldraw/types";
import {
  clearBuild,
  matchesModel,
  pruneBuilds,
  readBuild,
  writeBuild,
} from "@/lib/buildStore";
import { prefersReducedMotion } from "@/lib/dom";
import { Assembly, type AssemblyState, type BuildFrame } from "./Assembly";
import { clamp01, damp, easeOutBackSoft } from "./animation";
import { BuildSession } from "./buildSession";
import { SlotGhosts } from "./ghosts";
import { LiveWorld } from "./liveWorld";
import { RenderLoop } from "./RenderLoop";
import { isLineSegments } from "./three-guards";
import { TARGET_SIZE, Viewport } from "./Viewport";

/** Above this brick count, shadows and edge lines cost more than they add. */
const HEAVY_MODEL_BRICKS = 1500;

const STEP_SECONDS = 1.1;

/** Used only when physics is unavailable; a baked drop plays at its own length. */
const FALLBACK_POUR_SECONDS = 2.1;

/**
 * How close a carried brick has to get before it drops into a slot, in LDraw
 * units, and it is deliberately not scaled by the model.
 *
 * A radius tied to the model's size would be a stud on a small model and half a
 * baseplate on a large one, and the thing being aimed at is the same size in
 * both cases: a brick. So it scales off the brick instead. The floor is a stud
 * and a half, because the smallest parts would otherwise have to be placed to
 * within a few units of exactly right, and in build mode there is nowhere else
 * for a brick to go anyway: snapping early costs nothing, and the nearest slot
 * still wins.
 */
const SNAP_MIN_RADIUS = 30;
const SNAP_RADIUS_FACTOR = 1.4;

/** How fast a carried brick eases into the slot it is over. */
const SNAP_LAMBDA = 14;

/** How fast the carry height follows the height of the work. */
const CARRY_LAMBDA = 5;

/** Wheel notches while carrying raise or lower it by this fraction of a stud. */
const CARRY_WHEEL_STEP = 8;

/** Two presses on the same brick inside this many ms send it home by itself. */
const ASSIST_DOUBLE_MS = 350;

/**
 * Solver steps run with nothing drawn, when a pour is not going to be watched.
 *
 * Enough for the tallest release to land and the pile under it to stop moving.
 * Gravity here is tuned for handling bricks rather than for watching them fall,
 * so a bag takes a couple of seconds of simulated time to come down.
 */
const REDUCED_MOTION_SETTLE_STEPS = 260;

/** How long a placed brick stays lit, in seconds. */
const PLACE_FLASH_SECONDS = 0.35;

/** Autosave is debounced by this many ms; a build changes a few times a minute. */
const SAVE_INTERVAL_MS = 1500;

/** Dropped files live only in this tab, so a save for one could never be resumed. */
const LOCAL_SLUG_PREFIX = "local-";

/** How long a brick takes to fly home when the placement assist is used. */
const ASSIST_SECONDS = 0.4;

export interface ControllerInput {
  explode: number;
  /**
   * Loose bricks to light up in build mode: a bill-of-materials key, `*` for
   * everything the step still needs, or null for none.
   */
  hint: string | null;
  isolate: string | null;
  mode: ViewMode;
  playing: boolean;
  selected: number | null;
  session: SessionMode;
  slice: number;
  speed: number;
  /** Step to place. Changing this from outside scrubs. */
  step: number;
}

export interface SceneCallbacks {
  onBuildProgress?: (progress: BuildProgress) => void;
  onFinished?: () => void;
  onHover?: (brickId: number | null) => void;
  onSelect?: (brickId: number | null) => void;
  onStepAdvance?: (step: number) => void;
}

/** A brick being carried, and where it is being carried to. */
/** Where a build begins, worked out before anything is put on the floor. */
interface BuildStart {
  /** Loose poses to put back, or null to tip the bag out fresh. */
  loose: number[] | null;
  /** Slots already filled inside the starting step. */
  placed: number[];
  /** Whether to say the build was picked up rather than started. */
  resumed: boolean;
  step: number;
}

interface DragState {
  /** Set when the brick is flying home on its own after a double press. */
  assisting: boolean;
  brickId: number;
  /** Orientation it was picked up at, kept until a slot takes it over. */
  carry: Quaternion;
  carryTargetY: number;
  /** Height the pointer ray is projected onto, eased towards the work. */
  carryY: number;
  /**
   * How far the brick's origin has to stay above the floor, given the angle it
   * happens to be held at. LDraw origins are not centred, so this is measured
   * rather than guessed.
   */
  clearance: number;
  /** How high it is carried above the work, and what the wheel adjusts. */
  hover: number;
  /** Pointer hit to brick origin, so a brick does not jump to the cursor. */
  offset: Vector3;
  /** 0 free, 1 fully seated in `slot`. */
  seat: number;
  slot: number | null;
  /** Every pending slot this brick could fill, lit up while it is in hand. */
  targets: number[];
}

export class SceneController {
  private readonly viewport: Viewport;
  private readonly modelSpace: Group;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  private assembly: Assembly | null = null;
  private model: ModelData | null = null;
  /** Framing targets in world space, computed from data rather than traversal. */
  private modelFrame: Box3 | null = null;
  private bagFrames: Box3[] = [];
  /**
   * The same framings, widened to take in where subassemblies are built.
   *
   * Kept apart from `bagFrames` because only the watch flow stages anything.
   * Building by hand puts every brick straight into the model, so framing the
   * empty ground a subassembly would have been built on there would just push
   * the model away from the viewer.
   */
  private stagedFrames: Box3[] = [];
  private framing: "table" | "model" = "table";
  /** Bag the camera was last framed for, so a new bag re-frames exactly once. */
  private framedBag = -1;
  private readonly loop = new RenderLoop((dt) => this.tick(dt));

  private input: ControllerInput = {
    explode: 0,
    hint: null,
    isolate: null,
    mode: "assemble",
    playing: false,
    selected: null,
    session: "watch",
    slice: 1,
    speed: 1,
    step: 0,
  };
  private callbacks: SceneCallbacks = {};

  /** Smoothed values so mode changes ease instead of snapping. */
  private explodeCurrent = 0;
  private sliceCurrent = 1;

  /** Steps finished. 0 is an untouched pile; steps.length is a finished model. */
  private step = 0;
  private stepProgress = 0;
  private pourProgress = 1;
  private activeBag = -1;
  /** Length of the current bag's drop, from the simulation that produced it. */
  private pourSeconds = FALLBACK_POUR_SECONDS;

  /**
   * Set once the viewer has taken the camera somewhere themselves, which stops
   * a bag opening from yanking the view back.
   */
  private userMoved = false;
  private hoveredBrick: number | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private pointerInside = false;

  /** Build mode. All null in the watch flow, and torn down when it is left. */
  private build: BuildSession | null = null;
  private world: LiveWorld | null = null;
  private ghosts: SlotGhosts | null = null;
  private drag: DragState | null = null;
  private pouredBag = -1;
  private buildResumed = false;
  private buildUnavailable = false;
  private lastProgress = "";
  private saveDirty = false;
  private lastSaveAt = 0;
  private lastGrabAt = 0;
  private lastGrabId = -1;
  private hinted: number[] = [];
  private hintDirty = true;

  /**
   * World-to-model-space, so a pointer ray can be intersected against the
   * bricks' own coordinates. Every pose in the model is in that space, and the
   * physics world runs in it too, so converting the ray once is cheaper than
   * converting everything else.
   */
  private readonly inverseModel = new Matrix4();
  private readonly modelRay = new Ray();
  private readonly dragPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly dragPoint = new Vector3();
  private readonly dragTarget = new Vector3();
  private readonly snapProbe = new Vector3();
  private readonly dragQuat = new Quaternion();

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.viewport = new Viewport(canvas);
    this.viewport.setOptions({
      onUserMove: () => {
        this.userMoved = true;
      },
    });

    this.modelSpace = new Group();
    this.viewport.scene.add(this.modelSpace);

    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);

    // Capture on the window, not on the canvas. OrbitControls is bound to the
    // canvas and was constructed first, so a listener there would run second
    // and the orbit would already have started. Capturing an ancestor runs
    // before the target's own listeners, so stopping propagation there is what
    // lets a brick be dragged without the camera swinging round with it.
    window.addEventListener("pointerdown", this.handleGrabDown, true);
    window.addEventListener("pagehide", this.handlePageHide);
    document.addEventListener("visibilitychange", this.handlePageHide);
  }

  /** The theme is the room's business; the canvas just has to be told. */
  setTheme(): void {
    this.viewport.setTheme();
  }

  setCallbacks(callbacks: SceneCallbacks): void {
    this.callbacks = callbacks;
  }

  setModel(model: ModelData | null): void {
    if (this.assembly) {
      this.assembly.dispose();
      this.modelSpace.clear();
      this.assembly = null;
    }
    this.model = model;
    if (!model) {
      return;
    }

    // Past a certain size the per-brick costs stop being affordable. Edge lines
    // are the biggest of them: LDrawLoader gives every part its own line and
    // conditional-line object, so they are the majority of the draw calls, and
    // they are the detail you least miss on a model this big.
    const heavy = model.bricks.length > HEAVY_MODEL_BRICKS;
    this.viewport.renderer.shadowMap.enabled = !heavy;
    for (const brick of model.bricks) {
      for (const mesh of brick.meshes) {
        mesh.castShadow = !heavy;
        mesh.receiveShadow = !heavy;
      }
      if (!heavy) {
        continue;
      }
      brick.object.traverse((object) => {
        if (isLineSegments(object)) {
          object.visible = false;
        }
      });
    }

    // Constructed after the above: the Assembly snapshots line visibility so it
    // can restore it when un-ghosting a brick, so the lines must already be in
    // their final state.
    const assembly = new Assembly(model);
    this.assembly = assembly;
    this.modelSpace.add(model.root);

    // Normalise scale so camera distances, light rigs and shadow bounds behave
    // the same whether the model is a 13-brick pyramid or a 3000-brick set.
    const size = new Vector3();
    model.bounds.getSize(size);
    const center = new Vector3();
    model.bounds.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const scale = TARGET_SIZE / maxDim;

    this.modelSpace.scale.setScalar(scale);
    this.modelSpace.position.set(
      -center.x * scale,
      -model.bounds.min.y * scale,
      -center.z * scale
    );

    this.computeFrames(model);

    this.step = 0;
    this.stepProgress = 0;
    this.pourProgress = 0;
    this.activeBag = -1;
    this.framing = "table";
    this.applyFraming(true);

    if (this.input.session === "build") {
      this.enterBuild(true);
    }
  }

  /**
   * Bounds for the two framings, in world space.
   *
   * These cannot come from `Box3.setFromObject(modelSpace)`: at this point the
   * Assembly has detached every brick so that future bags cost nothing, so the
   * group is empty and the box would come back empty. The data is all here
   * anyway, in the built and floor poses.
   */
  private computeFrames(model: ModelData): void {
    const matrix = new Matrix4().compose(
      this.modelSpace.position,
      this.modelSpace.quaternion,
      this.modelSpace.scale
    );
    this.inverseModel.copy(matrix).invert();
    const toWorld = (box: Box3) => box.applyMatrix4(matrix);

    this.modelFrame = toWorld(model.bounds.clone());

    // One box per bag: everything built by the end of that bag, plus the bricks
    // still loose on the floor for it. Framing the whole finished model instead
    // would put a 4000-brick set on screen at the size of a postage stamp while
    // you are working on the first hundred bricks of it.
    const point = new Vector3();
    const staged = new Vector3();
    const bagCount = Math.max(model.bags.length, 1);
    const boxes = Array.from({ length: bagCount }, () => new Box3());
    const stagedBoxes = Array.from({ length: bagCount }, () => new Box3());

    for (const brick of model.bricks) {
      const radius = Math.max(brick.radius, 1);
      for (let index = brick.bag; index < bagCount; index += 1) {
        boxes[index].expandByPoint(
          point.copy(brick.builtPose.position).addScalar(radius)
        );
        boxes[index].expandByPoint(
          point.copy(brick.builtPose.position).addScalar(-radius)
        );
      }
      const own = boxes[brick.bag];
      own.expandByPoint(point.copy(brick.floorPose.position).addScalar(radius));
      own.expandByPoint(
        point.copy(brick.floorPose.position).addScalar(-radius)
      );

      // A brick in a subassembly spends its own bag's steps out beyond the
      // model, which has to be on screen or the subassembly is built where it
      // cannot be watched.
      const subassembly = model.subassemblies[brick.subassembly];
      if (subassembly) {
        staged.copy(brick.builtPose.position).add(subassembly.offset);
        stagedBoxes[brick.bag].expandByPoint(
          point.copy(staged).addScalar(radius)
        );
        stagedBoxes[brick.bag].expandByPoint(
          point.copy(staged).addScalar(-radius)
        );
      }
    }

    // Widened copies first: `toWorld` transforms in place, so taking these off
    // clones is what keeps the plain framings from being transformed twice.
    // A bag with nothing staged unions an empty box, which changes nothing.
    this.stagedFrames = boxes.map((box, index) =>
      toWorld(box.clone().union(stagedBoxes[index]))
    );
    this.bagFrames = boxes.map(toWorld);
    this.framedBag = -1;
  }

  setInput(input: ControllerInput): void {
    const stepChanged = input.step !== this.input.step;
    const modeChanged = input.mode !== this.input.mode;
    const sessionChanged = input.session !== this.input.session;
    const hintChanged = input.hint !== this.input.hint;
    this.input = input;

    if (hintChanged) {
      this.hintDirty = true;
    }

    if (sessionChanged) {
      if (input.session === "build") {
        this.enterBuild(true);
      } else {
        this.exitBuild();
      }
      return;
    }

    // Build mode owns its own step and never scrubs, so the rest of this does
    // not apply: a scrub would let you skip past the pieces you have not found.
    if (this.build) {
      return;
    }

    // Assembling wants the whole table in view so you can see the loose bricks;
    // inspecting an exploded or sliced model wants the model filling the frame.
    if (modeChanged) {
      this.framing = input.mode === "assemble" ? "table" : "model";
      this.frameModel();
    }

    // Guard against our own advance echoing back. Playback increments the step
    // here and reports it upward; React writes it to the URL and hands it back
    // as new input. Without the `!== this.step` check that echo would be read
    // as a scrub and snap the step to finished, so nothing would ever animate.
    if (stepChanged && input.step !== this.step) {
      this.step = input.step;
      this.stepProgress = 0;
      this.pourProgress = 1;

      // Adopt the target bag here so the next tick does not read the jump as a
      // bag being opened and restart the pour. Scrubbing should land on a state,
      // not replay the bricks falling, and dragging across several bags would
      // otherwise leave them stuttering in mid-air.
      //
      // Except on the very first input after a model loads, when activeBag is
      // still -1: that jump is the model opening, and it should pour.
      if (this.activeBag !== -1) {
        const steps = this.model?.steps ?? [];
        const working = Math.min(this.step, Math.max(steps.length - 1, 0));
        this.activeBag = steps[working]?.bag ?? this.activeBag;
      }
    }
  }

  /**
   * Frame the camera. Alternates between the whole table (model plus the loose
   * bricks around it) and just the model, since one is right while building and
   * the other while inspecting.
   */
  frameModel(toggle = false): void {
    if (toggle) {
      this.framing = this.framing === "table" ? "model" : "table";
    }
    this.applyFraming(false);
  }

  /**
   * Point the camera at whichever framing is in force.
   *
   * `instant` places the camera rather than flying it there, for the one case
   * where flying makes no sense: a model that has only just been loaded, where
   * the camera is still looking at wherever the last one was.
   */
  private applyFraming(instant: boolean): void {
    this.userMoved = false;

    const steps = this.model?.steps ?? [];
    const bag =
      steps[Math.min(this.step, Math.max(steps.length - 1, 0))]?.bag ?? 0;
    this.framedBag = bag;
    const frames = this.build ? this.bagFrames : this.stagedFrames;
    const box =
      this.framing === "table"
        ? (frames[bag] ?? this.modelFrame)
        : this.modelFrame;
    if (box) {
      this.viewport.frameBox(box, instant);
    }
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  private tick(dt: number): void {
    if (this.build) {
      this.tickBuild(dt);
      this.viewport.updateCamera(dt);
      this.viewport.render();
      return;
    }

    this.advancePlayback(dt);

    // Ease mode-driven values rather than snapping between them.
    const targetExplode =
      this.input.mode === "explode" ? this.input.explode : 0;
    const targetSlice = this.input.mode === "slice" ? this.input.slice : 1;
    this.explodeCurrent = damp(this.explodeCurrent, targetExplode, 9, dt);
    this.sliceCurrent = damp(this.sliceCurrent, targetSlice, 9, dt);

    const { assembly } = this;
    if (assembly) {
      const state: AssemblyState = {
        explode: this.explodeCurrent,
        hovered: this.hoveredBrick === null ? EMPTY : [this.hoveredBrick],
        isolate: this.input.isolate,
        mode: this.input.mode,
        pourProgress: this.pourProgress,
        selected: this.input.selected,
        slice: this.sliceCurrent,
        step: this.step,
        stepProgress: this.stepProgress,
      };
      assembly.update(state);
    }

    this.viewport.updateCamera(dt);
    this.viewport.render();
  }

  private advancePlayback(dt: number): void {
    const { model } = this;
    if (!model || model.steps.length === 0) {
      return;
    }

    const totalSteps = model.steps.length;
    const workingStep = Math.min(this.step, Math.max(totalSteps - 1, 0));
    const bagOfStep = model.steps[workingStep]?.bag ?? 0;
    if (bagOfStep !== this.activeBag) {
      // Simulate the drop before showing any of it. A bag of ~110 bricks takes
      // around 60ms, which is inside one bag transition and hidden entirely by
      // the load screen for the first one.
      const baked = this.assembly?.bakeBag(bagOfStep, model.slug) ?? null;
      this.pourSeconds = baked ?? FALLBACK_POUR_SECONDS;
      // Bricks settle where physics put them, so the framing has to be redone
      // against the pile that actually exists.
      this.computeFrames(model);

      // A bag has been opened, including the first one when the model loads:
      // tip it onto the floor before anything gets placed. This does not wait
      // for playback, so opening a model is the bricks landing in front of you
      // rather than a pile that was already there.
      this.activeBag = bagOfStep;
      this.pourProgress = prefersReducedMotion() ? 1 : 0;
    }

    // Opening a bag moves the work to a different part of the model, so the
    // camera follows. Only while framing the table: if the viewer has switched
    // to the model framing they are inspecting, and being yanked around is not
    // what they asked for.
    if (
      bagOfStep !== this.framedBag &&
      this.framing === "table" &&
      !this.userMoved
    ) {
      this.frameModel();
    }

    const speed = Math.max(this.input.speed, 0.1);

    // The pour runs on its own clock. Gating it on `playing` was what stopped
    // the first bag from ever falling, since nothing is playing on load.
    if (this.pourProgress < 1) {
      this.pourProgress = clamp01(this.pourProgress + dt / this.pourSeconds);
      return;
    }

    if (!this.input.playing) {
      return;
    }

    if (this.step >= totalSteps) {
      this.callbacks.onFinished?.();
      return;
    }

    this.stepProgress = clamp01(
      this.stepProgress + dt / (STEP_SECONDS / speed)
    );
    if (this.stepProgress < 1) {
      return;
    }

    // The step just finished, so the count goes up and the next one starts from
    // nothing. The brick poses are identical either side of this line, so the
    // handover is invisible.
    this.step += 1;
    this.stepProgress = 0;
    this.callbacks.onStepAdvance?.(this.step);
  }

  // --------------------------------------------------------------- build mode

  /**
   * Start building by hand.
   *
   * The bag goes on the floor as a live rigid-body pile rather than a baked
   * recording, because from here on it is whatever the person does to it.
   */
  enterBuild(resume: boolean): void {
    const { model, assembly } = this;
    if (!(model && assembly)) {
      return;
    }
    this.teardownBuild();

    const world = LiveWorld.create(
      assembly.floor,
      assembly.dropHeight,
      assembly.centre
    );
    if (!world) {
      // Nothing to fall back to: build mode is the physics.
      this.buildUnavailable = true;
      this.reportBuild(true);
      return;
    }

    this.buildUnavailable = false;
    this.world = world;
    this.build = new BuildSession(model);
    this.ghosts = new SlotGhosts(model.root);

    const start = this.buildStart(resume, model);
    this.build.restore(start.step, start.placed);
    this.buildResumed = start.resumed;

    for (const brick of model.bricks) {
      if (this.build.placed[brick.id] === 1) {
        world.addStatic(brick);
      }
    }

    this.step = this.build.step;
    this.activeBag = -1;
    this.openBuildBag(this.build.bag, start.loose === null);

    if (start.loose) {
      this.restoreLoose(start.loose);
    }

    // The step is the build's from here on, so say so upward: the URL, and the
    // parts list reading off it, would otherwise still be describing whatever
    // step the watcher had left behind.
    if (this.step !== this.input.step) {
      this.callbacks.onStepAdvance?.(this.step);
    }

    this.framing = "table";
    this.userMoved = false;
    this.frameModel();
    this.hintDirty = true;
    this.refreshGhosts();
    this.reportBuild(true);
    pruneBuilds();
  }

  /**
   * Where a build begins.
   *
   * Two claims about how far in you are: the saved build, and the step you
   * were just watching. The further one wins. Switching to build mode after
   * watching thirty steps should hand you step thirty-one rather than an empty
   * floor, and scrubbing back to look at something should not quietly throw
   * away a build that had already reached step two hundred.
   *
   * The watched step stops one short of the end. Playing a model through and
   * then pressing build is a normal way to arrive here, and handing back a
   * finished model with nothing left to do is a dead end; the last step is
   * not. A build only finishes by being built.
   */
  private buildStart(resume: boolean, model: ModelData): BuildStart {
    const fresh: BuildStart = {
      loose: null,
      placed: [],
      resumed: false,
      step: 0,
    };
    if (!resume) {
      return fresh;
    }

    const last = Math.max(model.steps.length - 1, 0);
    const watched = Math.min(Math.max(this.input.step, 0), last);
    const save = this.savable ? readBuild(model.slug) : null;
    const usable =
      save !== null &&
      matchesModel(save, model.bricks.length, model.steps.length) &&
      (save.step > 0 || save.placed.length > 0);

    if (!(usable && save.step >= watched)) {
      return { ...fresh, step: watched };
    }

    return {
      loose: save.loose,
      placed: save.placed,
      // Say a build was picked up only when doing so moved you. The notice is
      // there to explain a jump, and being handed the step the URL already
      // named is not one.
      resumed: save.step !== this.input.step,
      step: save.step,
    };
  }

  /** Throw the saved build away and start this model again from step one. */
  resetBuild(): void {
    if (this.model && this.savable) {
      clearBuild(this.model.slug);
    }
    this.enterBuild(false);
  }

  exitBuild(): void {
    this.saveNow();
    this.teardownBuild();
    // Let the watch flow open the bag again rather than inheriting a pile it
    // has no recording for.
    this.activeBag = -1;
    this.pourProgress = 0;
    this.stepProgress = 0;
    this.reportBuild(true);
  }

  private teardownBuild(): void {
    this.releaseDrag();
    this.ghosts?.dispose();
    this.ghosts = null;
    this.world?.dispose();
    this.world = null;
    this.build = null;
    this.pouredBag = -1;
    this.buildResumed = false;
    this.saveDirty = false;
    this.hinted = [];
    this.viewport.controls.enabled = true;
  }

  /** Dropped files exist only in this tab, so a save for one could never be used. */
  private get savable(): boolean {
    return (
      this.model !== null && !this.model.slug.startsWith(LOCAL_SLUG_PREFIX)
    );
  }

  private openBuildBag(bagIndex: number, pour: boolean): void {
    const { model, world, assembly } = this;
    if (!(model && world && assembly)) {
      return;
    }
    const bag = model.bags[bagIndex];
    if (!bag) {
      return;
    }

    this.pouredBag = bagIndex;
    // Bricks have to be in the scene graph before they can be poured into it.
    assembly.setActiveBag(bagIndex);
    world.clearLoose();

    if (pour) {
      world.pour(bag, model.bricks, model.slug, this.build?.placed);
      if (prefersReducedMotion()) {
        // The falling is decorative; the pile is not. Run the solver forward
        // with nothing drawn so the bricks are simply already down.
        world.settleNow(REDUCED_MOTION_SETTLE_STEPS);
      }
    }

    this.userMoved = false;
    this.frameModel();
  }

  /** Put the loose pile back exactly as the save left it. */
  private restoreLoose(loose: number[]): void {
    const { model, world, build } = this;
    if (!(model && world && build)) {
      return;
    }

    const position = new Vector3();
    const quaternion = new Quaternion();
    const seen = new Set<number>();

    for (let i = 0; i + 7 < loose.length; i += 8) {
      const id = loose[i];
      const brick = model.bricks[id];
      if (!(brick && build.isLoose(id))) {
        continue;
      }
      position.set(loose[i + 1], loose[i + 2], loose[i + 3]);
      quaternion.set(loose[i + 4], loose[i + 5], loose[i + 6], loose[i + 7]);
      world.restore(brick, position, quaternion);
      seen.add(id);
    }

    // A save written after a quota failure has no pile in it, and a save can
    // predate a brick. Anything unaccounted for goes back to its floor layout.
    for (const id of build.looseIds()) {
      if (seen.has(id)) {
        continue;
      }
      const brick = model.bricks[id];
      if (brick) {
        world.restore(
          brick,
          brick.floorPose.position,
          brick.floorPose.quaternion
        );
      }
    }
  }

  private tickBuild(dt: number): void {
    const { build, world, assembly, model } = this;
    if (!(build && world && assembly && model)) {
      return;
    }

    this.updateDrag(dt);
    world.step(dt);
    world.sync(model.bricks);

    // biome-ignore lint/suspicious/noUnnecessaryConditions: cleared in refreshHints(); Biome infers the literal true from the initialiser
    if (this.hintDirty) {
      this.refreshHints();
    }

    const elapsed = (performance.now() - build.lastPlacedAt) / 1000;
    const frame: BuildFrame = {
      activeBag: build.bag,
      flash:
        build.lastPlacedId >= 0 && elapsed < PLACE_FLASH_SECONDS
          ? build.lastPlacedId
          : null,
      grabbed: this.drag?.brickId ?? null,
      hinted: this.hinted,
      hovered: this.hoveredBrick,
      placed: build.placed,
      selected: this.input.selected,
    };
    assembly.updateBuild(frame);
    this.ghosts?.update(dt);

    if (
      // biome-ignore lint/suspicious/noUnnecessaryConditions: set true on every placement; Biome infers the literal false from the initialiser
      this.saveDirty &&
      performance.now() - this.lastSaveAt > SAVE_INTERVAL_MS
    ) {
      this.saveNow();
    }
  }

  /**
   * Move the brick in hand.
   *
   * The pointer ray is intersected with a horizontal plane rather than one
   * facing the camera, so dragging moves a brick across the table instead of
   * lofting it into the sky. The plane's height eases towards the height of the
   * slots being filled, which is what makes carrying a piece up to the work
   * feel like one gesture rather than two.
   */
  private updateDrag(dt: number): void {
    const { build, drag, world, model, assembly } = this;
    if (!(drag && build && world && model && assembly)) {
      return;
    }
    const brick = model.bricks[drag.brickId];
    if (!brick) {
      this.releaseDrag();
      return;
    }

    // Carried at the height of the slots being filled, plus a little, so the
    // brick clears the pile without floating so far above the model that the
    // pointer and the brick stop agreeing about where the model is.
    drag.carryTargetY =
      Math.max(this.workHeight(), assembly.floor + drag.clearance) + drag.hover;
    drag.carryY = damp(drag.carryY, drag.carryTargetY, CARRY_LAMBDA, dt);

    if (drag.assisting) {
      drag.seat = clamp01(drag.seat + dt / ASSIST_SECONDS);
    } else {
      this.dragPlane.set(UP, -drag.carryY);
      if (this.modelRay.intersectPlane(this.dragPlane, this.dragPoint)) {
        this.dragTarget.copy(this.dragPoint).add(drag.offset);
        this.dragTarget.y = Math.max(
          this.dragTarget.y,
          assembly.floor + drag.clearance
        );
      }
      // Aim from the middle of the brick, lowered by however far it is being
      // carried above the work. The hover is there so the brick clears the pile
      // on the way over; counting it as distance would push a small, tall part
      // out of its own snap radius and make it the hardest thing to place.
      this.snapProbe
        .copy(brick.localCenter)
        .applyQuaternion(drag.carry)
        .add(this.dragTarget);
      this.snapProbe.y -= drag.hover;
      drag.slot = build.findSlot(
        drag.brickId,
        this.snapProbe,
        snapRadiusFor(brick)
      );
      drag.seat = damp(drag.seat, drag.slot === null ? 0 : 1, SNAP_LAMBDA, dt);
    }

    const slot = drag.slot === null ? null : model.bricks[drag.slot];
    if (slot && drag.seat > 0.001) {
      const t = easeOutBackSoft(drag.seat);
      this.dragTarget.lerp(slot.builtPose.position, t);
      this.dragQuat.copy(drag.carry).slerp(slot.builtPose.quaternion, t);
    } else {
      this.dragQuat.copy(drag.carry);
    }

    world.moveHeld(this.dragTarget, this.dragQuat, dt);

    // The assist drives itself all the way in and then lets go.
    if (drag.assisting && drag.seat >= 1) {
      this.endDrag();
    }
  }

  /** Mean height of the slots still open, which is where the work is. */
  private workHeight(): number {
    const { build, model, assembly } = this;
    if (!(build && model && assembly)) {
      return 0;
    }
    const pending = build.pendingSlots;
    if (pending.length === 0) {
      return assembly.floor;
    }
    let sum = 0;
    for (const id of pending) {
      sum += model.bricks[id]?.builtPose.position.y ?? 0;
    }
    return sum / pending.length;
  }

  private beginGrab(brickId: number, point: Vector3): void {
    const { build, world, model } = this;
    if (!(build && world && model)) {
      return;
    }
    const brick = model.bricks[brickId];
    if (
      !(
        brick &&
        world.grab(brickId, brick.object.position, brick.object.quaternion)
      )
    ) {
      return;
    }

    const assisting = this.wasDoubleGrab(brickId);
    const slot = assisting
      ? build.findSlot(brickId, brick.object.position, Number.POSITIVE_INFINITY)
      : null;

    const drag: DragState = {
      assisting: assisting && slot !== null,
      brickId,
      carry: brick.object.quaternion.clone(),
      carryTargetY: point.y,
      carryY: point.y,
      clearance: floorClearance(brick),
      hover: brick.halfExtents.y * 2,
      offset: brick.object.position.clone().sub(point),
      seat: 0,
      slot,
      targets: build.slotsFor(brickId),
    };
    this.drag = drag;
    this.dragTarget.copy(brick.object.position);
    this.dragQuat.copy(brick.object.quaternion);

    this.ghosts?.setTargets(drag.targets);
    this.viewport.controls.enabled = false;
    this.canvas.style.cursor = "grabbing";
  }

  /**
   * Two presses on the same brick send it home by itself.
   *
   * Aiming a brick in three dimensions with a two-dimensional pointer is the
   * hardest thing this mode asks for, and on a trackpad it can be the thing
   * that stops it being playable at all. The assist gives the placement away
   * and keeps the finding, which is the part worth doing.
   */
  private wasDoubleGrab(brickId: number): boolean {
    const now = performance.now();
    const repeat =
      this.lastGrabId === brickId && now - this.lastGrabAt < ASSIST_DOUBLE_MS;
    this.lastGrabAt = now;
    this.lastGrabId = brickId;
    return repeat;
  }

  /** Let go, and take the slot if the brick was over one. */
  private endDrag(): void {
    const { drag } = this;
    if (!drag) {
      return;
    }
    const { slot } = drag;
    const seated = slot !== null && (drag.assisting || drag.seat > 0.5);
    this.releaseDrag();
    if (seated && slot !== null) {
      this.placeBrick(slot, drag.brickId);
    }
  }

  private releaseDrag(): void {
    if (!this.drag) {
      return;
    }
    this.drag = null;
    this.world?.release();
    this.ghosts?.setTargets(EMPTY);
    this.viewport.controls.enabled = true;
    this.canvas.style.cursor = "grab";
    window.removeEventListener("pointermove", this.handleDragMove);
    window.removeEventListener("pointerup", this.handleDragUp);
    window.removeEventListener("pointercancel", this.handleDragUp);
  }

  /**
   * Put a brick in.
   *
   * `sourceId` is the brick that was carried and `slotId` the record that owns
   * the place it is going. They are almost never the same, because slots match
   * by part rather than by identity, so the two swap objects and bodies first.
   * After that the slot record owns the brick you dragged, and the record you
   * dragged owns a brick still lying in the pile.
   */
  private placeBrick(slotId: number, sourceId: number): void {
    const { build, world, assembly, model } = this;
    if (!(build && world && assembly && model)) {
      return;
    }

    if (slotId !== sourceId) {
      assembly.swapBrickObjects(slotId, sourceId);
      world.swapBodies(slotId, sourceId);
    }

    world.despawn(slotId);
    const brick = model.bricks[slotId];
    if (brick) {
      brick.object.position.copy(brick.builtPose.position);
      brick.object.quaternion.copy(brick.builtPose.quaternion);
      world.addStatic(brick);
    }

    build.place(slotId, performance.now());

    if (build.advanceIfComplete()) {
      this.step = build.step;
      this.callbacks.onStepAdvance?.(build.step);
      if (!build.done && build.bag !== this.pouredBag) {
        this.openBuildBag(build.bag, true);
      }
    }

    this.hintDirty = true;
    this.refreshGhosts();
    this.saveDirty = true;
    this.reportBuild();
  }

  private refreshGhosts(): void {
    const { build, model } = this;
    if (!(build && model)) {
      return;
    }
    this.ghosts?.set(build.pendingSlots, model.bricks);
  }

  /**
   * Loose bricks worth lighting up: the ones that would fill a slot this step
   * still needs. Recomputed on change rather than per frame.
   */
  private refreshHints(): void {
    this.hintDirty = false;
    const { build } = this;
    const key = this.input.hint;
    if (!build || key === null) {
      this.hinted = EMPTY;
      return;
    }

    const wanted = new Set(build.pendingSlots.map((id) => build.keyOf(id)));
    this.hinted = build
      .looseIds()
      .filter(
        (id) =>
          wanted.has(build.keyOf(id)) &&
          (key === "*" || build.keyOf(id) === key)
      );
  }

  private reportBuild(force = false): void {
    const { build, model } = this;
    const report = this.callbacks.onBuildProgress;
    if (!report) {
      return;
    }

    if (!(build && model)) {
      // biome-ignore lint/suspicious/noUnnecessaryConditions: set true in enterBuild(); Biome infers the literal false from the initialiser
      const empty = this.buildUnavailable ? "unavailable" : "off";
      if (force || this.lastProgress !== empty) {
        this.lastProgress = empty;
        report({
          bag: 0,
          done: false,
          loose: 0,
          pending: [],
          placedTotal: 0,
          resumed: false,
          step: 0,
          totalBags: 0,
          totalSteps: 0,
          unavailable: this.buildUnavailable,
        });
      }
      return;
    }

    const progress: BuildProgress = {
      bag: build.bag,
      done: build.done,
      loose: this.world?.looseCount ?? 0,
      pending: build.pendingSlots,
      placedTotal: build.placedCount,
      resumed: this.buildResumed,
      step: build.step,
      totalBags: model.bags.length,
      totalSteps: model.steps.length,
      unavailable: false,
    };
    const signature = `${progress.step}:${progress.bag}:${progress.placedTotal}:${progress.pending.length}:${progress.loose}:${progress.done}`;
    if (!force && signature === this.lastProgress) {
      return;
    }
    this.lastProgress = signature;
    report(progress);
  }

  private saveNow(): void {
    const { build, world, model } = this;
    this.saveDirty = false;
    if (!(build && world && model && this.savable)) {
      return;
    }
    this.lastSaveAt = performance.now();
    writeBuild({
      bricks: model.bricks.length,
      loose: world.snapshot(),
      placed: build.placedIds(),
      slug: model.slug,
      step: build.step,
      steps: model.steps.length,
      title: model.title,
      updatedAt: Date.now(),
      v: 1,
    });
  }

  /** A tab being hidden is the last chance to write; it may never come back. */
  private readonly handlePageHide = (): void => {
    if (this.build) {
      this.saveNow();
    }
  };

  /**
   * Take hold of a loose brick, if that is what was pressed.
   *
   * Runs in the capture phase on the window so it can decide before
   * OrbitControls does. Anything that is not a loose brick is left alone and
   * falls through to the camera.
   */
  private readonly handleGrabDown = (event: PointerEvent): void => {
    if (!this.build || event.button !== 0 || event.target !== this.canvas) {
      return;
    }
    this.updatePointer(event);
    const hit = this.pickHit();
    if (hit === null || !this.build.isLoose(hit.id)) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    this.updateModelRay();
    this.beginGrab(hit.id, hit.point);
    window.addEventListener("pointermove", this.handleDragMove);
    window.addEventListener("pointerup", this.handleDragUp);
    window.addEventListener("pointercancel", this.handleDragUp);
    window.addEventListener("wheel", this.handleDragWheel, { passive: false });
  };

  private readonly handleDragMove = (event: PointerEvent): void => {
    this.updatePointer(event);
    this.updateModelRay();
  };

  private readonly handleDragUp = (): void => {
    window.removeEventListener("wheel", this.handleDragWheel);
    this.endDrag();
  };

  /**
   * The wheel is free while a brick is held, because orbiting is suspended, so
   * it raises and lowers what you are carrying.
   */
  private readonly handleDragWheel = (event: WheelEvent): void => {
    const { drag } = this;
    if (!drag) {
      return;
    }
    event.preventDefault();
    drag.hover = Math.max(
      0,
      drag.hover - Math.sign(event.deltaY) * CARRY_WHEEL_STEP
    );
  };

  /** The pointer ray, in the model's own coordinates. */
  private updateModelRay(): void {
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    this.modelRay.copy(this.raycaster.ray).applyMatrix4(this.inverseModel);
  }

  /**
   * Raycast against brick meshes only; edge lines were opted out at flatten
   * time. The hit point comes back in model space, which is where the bricks'
   * own poses and the physics world both live.
   */
  private pickHit(): { id: number; point: Vector3 } | null {
    const { model } = this;
    if (!model) {
      return null;
    }

    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const meshes: Mesh[] = [];
    for (const brick of model.bricks) {
      if (!brick.object.visible || brick.object.parent === null) {
        continue;
      }
      meshes.push(...brick.meshes);
    }

    for (const hit of this.raycaster.intersectObjects(meshes, false)) {
      const id = hit.object.userData?.brickId;
      if (typeof id === "number") {
        return {
          id,
          point: hit.point.clone().applyMatrix4(this.inverseModel),
        };
      }
    }
    return null;
  }

  resize(width: number, height: number): void {
    this.viewport.resize(width, height);
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  /** Which brick is under the pointer, when where it was hit does not matter. */
  private pick(): number | null {
    return this.pickHit()?.id ?? null;
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.pointerInside = true;
    this.updatePointer(event);

    // Skip picking while orbiting or carrying; the hit result is meaningless
    // mid-drag and the raycast is the most expensive thing in the pointer path.
    if (this.pointerDown !== null || this.drag !== null) {
      return;
    }

    const hit = this.pick();
    if (hit !== this.hoveredBrick) {
      this.hoveredBrick = hit;
      this.canvas.style.cursor = this.cursorFor(hit);
      this.callbacks.onHover?.(hit);
    }
  };

  /** In build mode the cursor has to say which bricks can actually be picked up. */
  private cursorFor(hit: number | null): string {
    if (hit === null) {
      return "grab";
    }
    if (this.build?.isLoose(hit)) {
      return "grab";
    }
    return "pointer";
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down) {
      return;
    }

    // Treat it as a click only if the pointer barely moved, so ending an orbit
    // over a brick does not select it.
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > 4) {
      return;
    }

    this.updatePointer(event);
    this.callbacks.onSelect?.(this.pick());
  };

  private readonly handlePointerLeave = (): void => {
    this.pointerInside = false;
    if (this.hoveredBrick !== null) {
      this.hoveredBrick = null;
      this.callbacks.onHover?.(null);
    }
  };

  setHovered(brickId: number | null): void {
    // Hover driven from the parts list rather than the pointer.
    // biome-ignore lint/suspicious/noUnnecessaryConditions: set true in handlePointerMove; Biome infers the literal false from the initialiser
    if (this.pointerInside) {
      return;
    }
    this.hoveredBrick = brickId;
  }

  dispose(): void {
    this.loop.dispose();
    this.saveNow();
    this.teardownBuild();
    window.removeEventListener("pointerdown", this.handleGrabDown, true);
    window.removeEventListener("pointermove", this.handleDragMove);
    window.removeEventListener("pointerup", this.handleDragUp);
    window.removeEventListener("pointercancel", this.handleDragUp);
    window.removeEventListener("wheel", this.handleDragWheel);
    window.removeEventListener("pagehide", this.handlePageHide);
    document.removeEventListener("visibilitychange", this.handlePageHide);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.assembly?.dispose();
    this.viewport.dispose();
  }
}

const EMPTY: number[] = [];

const UP = new Vector3(0, 1, 0);

/**
 * How close a carried brick has to get to a slot before it drops in.
 *
 * Scaled off the brick rather than the model: the thing being aimed at is a
 * brick either way, and a radius tied to the model would be a stud on a pyramid
 * and half a baseplate on a Saturn V.
 */
function snapRadiusFor(brick: Brick): number {
  return Math.max(brick.radius * SNAP_RADIUS_FACTOR, SNAP_MIN_RADIUS);
}

/**
 * How far above the floor a brick's origin has to sit for the brick itself to
 * rest on it, at the angle it is currently held.
 *
 * LDraw puts a part's origin on its top face rather than in the middle of it,
 * and a brick picked out of a pile is at whatever angle it landed, so this is
 * the extent of the rotated bounding box below the origin. Guessing it from the
 * bounding radius instead floats a 2x4 brick most of a stud-and-a-half off the
 * table, which is enough to break the aim.
 */
function floorClearance(brick: Brick): number {
  const rotated = SCRATCH.copy(brick.localCenter).applyQuaternion(
    brick.object.quaternion
  );
  const m = SCRATCH_MATRIX.makeRotationFromQuaternion(
    brick.object.quaternion
  ).elements;
  const extent =
    Math.abs(m[1]) * brick.halfExtents.x +
    Math.abs(m[5]) * brick.halfExtents.y +
    Math.abs(m[9]) * brick.halfExtents.z;
  return Math.max(extent - rotated.y, 0);
}

const SCRATCH = new Vector3();
const SCRATCH_MATRIX = new Matrix4();
