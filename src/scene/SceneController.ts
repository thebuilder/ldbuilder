import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Matrix4,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShadowMaterial,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { ModelData, ViewMode } from "@/ldraw/types";
import { isTypingTarget } from "@/lib/dom";
import { Assembly, type AssemblyState } from "./Assembly";
import { clamp01, damp } from "./animation";
import { isLineSegments } from "./three-guards";

/** Every model is scaled so its longest dimension is this many world units. */
const TARGET_SIZE = 100;

/** Above this brick count, shadows and edge lines cost more than they add. */
const HEAVY_MODEL_BRICKS = 1500;

const STEP_SECONDS = 1.1;

/**
 * Movement speed as a fraction of the camera's distance from what it is looking
 * at, per second. Tying it to distance rather than to world units means the
 * same key press feels the same whether you are nose-to-nose with a 13-brick
 * pyramid or looking down at a 4,000-brick roller coaster.
 */
const MOVE_SPEED = 1.15;
const BOOST = 3;

/** How quickly movement reaches full speed and coasts to a stop. */
const MOVE_DAMPING = 14;

/** Keep the camera above the floor rather than letting it sink through. */
const MIN_CAMERA_HEIGHT = 2;

/** Used only when physics is unavailable; a baked drop plays at its own length. */
const FALLBACK_POUR_SECONDS = 2.1;

export interface ControllerInput {
  explode: number;
  isolate: string | null;
  mode: ViewMode;
  playing: boolean;
  selected: number | null;
  slice: number;
  speed: number;
  /** Step to place. Changing this from outside scrubs. */
  step: number;
}

export interface SceneCallbacks {
  onFinished?: () => void;
  onHover?: (brickId: number | null) => void;
  onSelect?: (brickId: number | null) => void;
  onStepAdvance?: (step: number) => void;
}

export class SceneController {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly modelSpace: Group;
  private readonly light: DirectionalLight;
  private grid: GridHelper;
  private readonly shadowPlane: Mesh;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  private assembly: Assembly | null = null;
  private model: ModelData | null = null;
  /** Framing targets in world space, computed from data rather than traversal. */
  private modelFrame: Box3 | null = null;
  private bagFrames: Box3[] = [];
  private framing: "table" | "model" = "table";
  /** Bag the camera was last framed for, so a new bag re-frames exactly once. */
  private framedBag = -1;
  private frameHandle = 0;
  private lastTime = 0;
  private disposed = false;

  private input: ControllerInput = {
    explode: 0,
    isolate: null,
    mode: "build",
    playing: false,
    selected: null,
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

  private themeObserver: MutationObserver | null = null;
  private readonly keysDown = new Set<string>();
  private readonly moveVelocity = new Vector3();
  private readonly moveForward = new Vector3();
  private readonly moveRight = new Vector3();
  private readonly moveInput = new Vector3();
  private readonly moveDelta = new Vector3();
  /**
   * Set once the viewer has taken the camera somewhere themselves, which stops
   * a bag opening from yanking the view back.
   */
  private userMoved = false;
  private hoveredBrick: number | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private pointerInside = false;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      antialias: true,
      canvas,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene = new Scene();

    // A room environment gives injection-moulded plastic the soft, broad
    // reflections it needs. Punctual lights alone make ABS look like chalk.
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmrem.dispose();

    this.camera = new PerspectiveCamera(38, 1, 0.5, 4000);
    this.camera.position.set(120, 90, 160);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 1200;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 20, 0);

    this.light = new DirectionalLight(0xff_ff_ff, 1.6);
    this.light.position.set(90, 160, 70);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0008;
    this.light.shadow.normalBias = 0.4;
    const shadowCam = this.light.shadow.camera;
    shadowCam.near = 10;
    shadowCam.far = 900;
    shadowCam.left = -260;
    shadowCam.right = 260;
    shadowCam.top = 260;
    shadowCam.bottom = -260;
    this.scene.add(this.light);

    // GridHelper bakes its two colours into vertex colours, so recolouring on a
    // theme change means rebuilding it. Cheap: one 60x60 line grid.
    this.grid = this.buildGrid();
    this.scene.add(this.grid);

    this.shadowPlane = new Mesh(
      new PlaneGeometry(2400, 2400),
      new ShadowMaterial({ opacity: 0.32 })
    );
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = -0.05;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);

    this.applyTheme();

    // Follow the theme by watching the class on <html> rather than being told.
    // next-themes writes that class from a provider effect, which React runs
    // after the effects of the components below it, so a child that reacts to
    // the theme value reads the stylesheet one swap behind. Watching the DOM
    // sidesteps the ordering entirely, and catches an OS-level change too.
    this.themeObserver = new MutationObserver(() => this.setTheme());
    this.themeObserver.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });

    this.modelSpace = new Group();
    this.scene.add(this.modelSpace);

    // Navigation is bound to the window, not the canvas: the canvas is never
    // focused, and requiring a click on it before the keys work is a puzzle.
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.controls.addEventListener("start", this.handleControlsStart);

    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
  }

  /**
   * Repaint the scene for the current theme.
   *
   * The values come from the same stylesheet the panels use, read off the root
   * element, rather than a second copy of the palette living in here. A canvas
   * cannot inherit CSS, but it can be told what the CSS says.
   */
  applyTheme(): void {
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;

    this.scene.background = new Color(token("--scene-ground", "#0e0f12"));
    this.scene.environmentIntensity = Number(token("--scene-env", "0.85"));

    const material = this.grid.material as { color?: Color; opacity: number };
    if (material.color) {
      material.color.set(token("--scene-grid-major", "#2a2f39"));
    }

    const shadow = this.shadowPlane.material as ShadowMaterial;
    shadow.opacity = Number(token("--scene-shadow", "0.32"));
  }

  setCallbacks(callbacks: SceneCallbacks): void {
    this.callbacks = callbacks;
  }

  private buildGrid(): GridHelper {
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;

    const grid = new GridHelper(
      1200,
      60,
      new Color(token("--scene-grid-major", "#2a2f39")),
      new Color(token("--scene-grid-minor", "#1b1e25"))
    );
    const material = grid.material as { transparent: boolean; opacity: number };
    material.transparent = true;
    material.opacity = 0.55;
    return grid;
  }

  setTheme(): void {
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    this.grid = this.buildGrid();
    this.scene.add(this.grid);
    this.applyTheme();
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
    this.renderer.shadowMap.enabled = !heavy;
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
    this.frameModel();
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
    const toWorld = (box: Box3) => box.applyMatrix4(matrix);

    this.modelFrame = toWorld(model.bounds.clone());

    // One box per bag: everything built by the end of that bag, plus the bricks
    // still loose on the floor for it. Framing the whole finished model instead
    // would put a 4000-brick set on screen at the size of a postage stamp while
    // you are working on the first hundred bricks of it.
    const point = new Vector3();
    const bagCount = Math.max(model.bags.length, 1);
    const boxes = Array.from({ length: bagCount }, () => new Box3());

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
    }

    this.bagFrames = boxes.map(toWorld);
    this.framedBag = -1;
  }

  setInput(input: ControllerInput): void {
    const stepChanged = input.step !== this.input.step;
    const modeChanged = input.mode !== this.input.mode;
    this.input = input;

    // Building wants the whole table in view so you can see the loose bricks;
    // inspecting an exploded or sliced model wants the model filling the frame.
    if (modeChanged) {
      this.framing = input.mode === "build" ? "table" : "model";
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
    this.userMoved = false;

    const steps = this.model?.steps ?? [];
    const bag =
      steps[Math.min(this.step, Math.max(steps.length - 1, 0))]?.bag ?? 0;
    this.framedBag = bag;
    const box =
      this.framing === "table"
        ? (this.bagFrames[bag] ?? this.modelFrame)
        : this.modelFrame;
    if (!box || box.isEmpty()) {
      return;
    }

    const sphere = box.getBoundingSphere(new Sphere());
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (sphere.radius / Math.sin(fov / 2)) * 1.08;

    const direction = new Vector3(0.72, 0.5, 1).normalize();
    this.camera.position
      .copy(sphere.center)
      .addScaledVector(direction, distance);
    this.controls.target.copy(sphere.center);
    this.camera.near = Math.max(distance / 800, 0.1);
    this.camera.far = distance * 10;
    this.controls.minDistance = sphere.radius * 0.25;
    this.controls.maxDistance = distance * 4;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  start(): void {
    if (this.frameHandle !== 0) {
      return;
    }
    this.lastTime = performance.now();
    const loop = (now: number) => {
      // biome-ignore lint/suspicious/noUnnecessaryConditions: set true in dispose(); Biome infers the literal false from the initialiser
      if (this.disposed) {
        return;
      }
      this.frameHandle = requestAnimationFrame(loop);
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      this.tick(dt);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.frameHandle !== 0) {
      cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = 0;
  }

  private tick(dt: number): void {
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

    this.updateNavigation(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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

  resize(width: number, height: number): void {
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  /** Raycast against brick meshes only. Edge lines were opted out at flatten time. */
  private pick(): number | null {
    const { model } = this;
    if (!model) {
      return null;
    }

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes: Mesh[] = [];
    for (const brick of model.bricks) {
      if (!brick.object.visible || brick.object.parent === null) {
        continue;
      }
      meshes.push(...brick.meshes);
    }

    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      const id = hit.object.userData?.brickId;
      if (typeof id === "number") {
        return id;
      }
    }
    return null;
  }

  private readonly handleControlsStart = (): void => {
    this.userMoved = true;
  };

  /** Keys that drive the camera. Everything else is somebody else's to handle. */
  private static readonly NAV_KEYS = new Set([
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyQ",
    "KeyE",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ]);

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // Shift only modifies the others, so it is recorded but never claimed.
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      this.keysDown.add(event.code);
      return;
    }
    if (!SceneController.NAV_KEYS.has(event.code)) {
      return;
    }

    // A focused slider or text field owns the arrow keys; taking them would
    // make the scrubber and the explode slider unusable from the keyboard.
    if (isTypingTarget(event.target)) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    this.keysDown.add(event.code);
    this.userMoved = true;
    event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code);
    if (event.key === "Shift") {
      this.keysDown.delete("ShiftLeft");
      this.keysDown.delete("ShiftRight");
    }
  };

  /** A key held while the window loses focus never sends its keyup. */
  private readonly handleBlur = (): void => {
    this.keysDown.clear();
  };

  /**
   * Walk the camera across the world.
   *
   * Both the camera and its orbit target move together, so this pans rather
   * than flies: wherever you stop, dragging still orbits around the point in
   * front of you. Forward is the view direction flattened onto the ground, so
   * looking down at the floor and pressing W travels along it instead of
   * burrowing into it.
   */
  private updateNavigation(dt: number): void {
    const held = (...codes: string[]) =>
      codes.some((code) => this.keysDown.has(code));

    this.camera.getWorldDirection(this.moveForward);
    this.moveForward.y = 0;
    if (this.moveForward.lengthSq() < 1e-6) {
      this.moveForward.set(0, 0, -1);
    }
    this.moveForward.normalize();
    this.moveRight.crossVectors(this.moveForward, UP).normalize();

    this.moveInput.set(0, 0, 0);
    if (held("KeyW", "ArrowUp")) {
      this.moveInput.add(this.moveForward);
    }
    if (held("KeyS", "ArrowDown")) {
      this.moveInput.sub(this.moveForward);
    }
    if (held("KeyD", "ArrowRight")) {
      this.moveInput.add(this.moveRight);
    }
    if (held("KeyA", "ArrowLeft")) {
      this.moveInput.sub(this.moveRight);
    }
    if (held("KeyE")) {
      this.moveInput.y += 1;
    }
    if (held("KeyQ")) {
      this.moveInput.y -= 1;
    }

    if (this.moveInput.lengthSq() > 0) {
      const distance = this.camera.position.distanceTo(this.controls.target);
      const boost =
        this.keysDown.has("ShiftLeft") || this.keysDown.has("ShiftRight")
          ? BOOST
          : 1;
      this.moveInput.normalize().multiplyScalar(distance * MOVE_SPEED * boost);
    }

    const blend = 1 - Math.exp(-MOVE_DAMPING * dt);
    this.moveVelocity.lerp(this.moveInput, blend);
    if (this.moveVelocity.lengthSq() < 1e-6) {
      return;
    }

    this.moveDelta.copy(this.moveVelocity).multiplyScalar(dt);
    this.camera.position.add(this.moveDelta);
    this.controls.target.add(this.moveDelta);

    if (this.camera.position.y < MIN_CAMERA_HEIGHT) {
      const lift = MIN_CAMERA_HEIGHT - this.camera.position.y;
      this.camera.position.y += lift;
      this.controls.target.y += lift;
      this.moveVelocity.y = 0;
    }
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.pointerInside = true;
    this.updatePointer(event);

    // Skip picking while orbiting; the hit result is meaningless mid-drag and
    // the raycast is the most expensive thing in the pointer path.
    if (this.pointerDown !== null) {
      return;
    }

    const hit = this.pick();
    if (hit !== this.hoveredBrick) {
      this.hoveredBrick = hit;
      this.canvas.style.cursor = hit === null ? "grab" : "pointer";
      this.callbacks.onHover?.(hit);
    }
  };

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
    this.disposed = true;
    this.stop();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.controls.removeEventListener("start", this.handleControlsStart);
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.assembly?.dispose();
    this.controls.dispose();
    this.grid.geometry.dispose();
    this.shadowPlane.geometry.dispose();
    (this.shadowPlane.material as ShadowMaterial).dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}

const EMPTY: number[] = [];

const UP = new Vector3(0, 1, 0);

/** Falling bricks are decorative; skip straight to the resting pose if asked. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
