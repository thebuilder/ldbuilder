import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { disposeModel, loadModel } from "@/ldraw/loadModel";
import type { Brick, ModelData } from "@/ldraw/types";
import { clamp01, damp, staggered } from "./animation";
import { RenderLoop } from "./RenderLoop";

/**
 * The model behind the front page.
 *
 * It is the real thing: a packed LDraw file put through the same loader the
 * builder uses, assembled in the order its author wrote the steps in. A
 * hand-made stand-in would have been cheaper and would have been a claim the
 * app could not cash, which is the one thing a hero must not do.
 *
 * What it leaves out is everything the builder adds around that: no physics, no
 * orbit controls, no picking, no step HUD. It builds itself on a loop and turns
 * slowly, and a drag turns it faster. That is the whole surface.
 */

/** Longest dimension of the model in world units, matching the builder. */
const TARGET_SIZE = 100;

/** Seconds each authored build step gets. */
const STEP_SECONDS = 0.9;

/** Seconds the finished model is held before it comes apart again. */
const HOLD_SECONDS = 3;

/** Seconds the model takes to lift back apart before rebuilding. */
const UNBUILD_SECONDS = 1.6;

/** Fraction of a step's slot that one brick's own drop takes. */
const DROP_WINDOW = 0.55;

/** How far above its place a brick starts, as a fraction of model height. */
const DROP_RISE = 0.55;

/** Radians per second of idle turntable drift. */
const SPIN_SPEED = 0.11;

/** Air left around the model when the camera is fitted to it. */
const FRAME_MARGIN = 1.2;

/** How far a pointer may move and still not count as a drag. */
const DRAG_SLOP = 4;

const MIN_ELEVATION = 0.12;
const MAX_ELEVATION = 0.95;

const UP = new Vector3(0, 1, 0);

export interface HeroModelSpec {
  slug: string;
  title: string;
  url: string;
}

interface BrickView {
  brick: Brick;
  /** Index of this brick within its own step, for the stagger. */
  indexInStep: number;
  siblings: number;
}

/**
 * A brick decelerating into place, with nothing after the arrival.
 *
 * Not the bounce the poured bag uses: a brick pushed onto a stud is held there
 * by the stud, so anything that moves after contact reads as the piece not
 * having gone on properly.
 */
const easeOutQuart = (t: number): number => 1 - (1 - t) ** 4;

export class HeroScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly loop: RenderLoop;
  private readonly modelSpace = new Group();
  private readonly light: DirectionalLight;
  private readonly floor: Mesh;
  private themeObserver: MutationObserver | null = null;

  private model: ModelData | null = null;
  private views: BrickView[] = [];
  private rise = 0;
  private cycle = 1;
  private buildSeconds = 0;
  private elapsed = 0;

  private azimuth = 0.85;
  private azimuthTarget = 0.85;
  private elevation = 0.32;
  private elevationTarget = 0.32;
  private radius = 260;
  private focus = 0;
  /** Where the model sits in the frame, 0.5 / 0.5 being dead centre. */
  private biasX = 0.5;
  private biasY = 0.5;

  private dragging = false;
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;

  private readonly reduced: boolean;
  private readonly canvas: HTMLCanvasElement;
  private readonly scratch = {
    forward: new Vector3(),
    quaternion: new Quaternion(),
    right: new Vector3(),
    target: new Vector3(),
    up: new Vector3(),
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    // Transparent: the model stands on the page's own background, so the hero
    // is the header rather than a picture pasted into it.
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;

    // The same room probe the builder's viewport uses. Punctual light alone
    // leaves the vertical face of a brick nearly black, which reads as chalk
    // rather than as the shiny side of a piece of ABS.
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmrem.dispose();

    this.camera = new PerspectiveCamera(32, 1, 1, 2000);

    this.light = new DirectionalLight(0xff_ff_ff, 1.6);
    this.light.position.set(80, 190, 120);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.bias = -0.0009;
    this.light.shadow.normalBias = 0.5;
    this.light.shadow.radius = 3;
    const shadowCam = this.light.shadow.camera;
    shadowCam.near = 40;
    shadowCam.far = 700;
    shadowCam.left = -130;
    shadowCam.right = 130;
    shadowCam.top = 130;
    shadowCam.bottom = -130;
    this.scene.add(this.light);

    this.floor = new Mesh(
      new PlaneGeometry(1600, 1600),
      new ShadowMaterial({ opacity: 0.3 })
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.1;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.scene.add(this.modelSpace);

    this.applyTheme();
    this.themeObserver = new MutationObserver(() => this.applyTheme());
    this.themeObserver.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });

    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerEnd);
    canvas.addEventListener("pointercancel", this.handlePointerEnd);

    this.loop = new RenderLoop((dt) => this.frame(dt));
  }

  /**
   * Load the model and take its build order apart.
   *
   * Part names are passed in empty on purpose: nothing here is going to tell
   * anybody what a brick is called, and the packer's names are a second fetch.
   */
  async open(spec: HeroModelSpec): Promise<void> {
    const model = await loadModel({
      partNames: {},
      slug: spec.slug,
      title: spec.title,
      url: spec.url,
    });

    this.model = model;
    this.modelSpace.add(model.root);

    // Normalise scale so the camera rig does not have to know how big the
    // model it was handed is.
    const size = new Vector3();
    const center = new Vector3();
    model.bounds.getSize(size);
    model.bounds.getCenter(center);
    const scale = TARGET_SIZE / Math.max(size.x, size.y, size.z, 1);
    this.modelSpace.scale.setScalar(scale);
    this.modelSpace.position.set(
      -center.x * scale,
      -model.bounds.min.y * scale,
      -center.z * scale
    );

    // Tall models want a long drop and flat ones would look dropped from orbit
    // with the same rule, so the rise is taken from the larger of the two.
    this.rise = Math.max(size.y, size.x * 0.45) * DROP_RISE;
    this.focus = (size.y * scale) / 2;
    this.radius = this.fitDistance((size.length() / 2) * scale);

    for (const brick of model.bricks) {
      for (const mesh of brick.meshes) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    }

    this.views = orderBricks(model);
    this.buildSeconds = model.steps.length * STEP_SECONDS;
    this.cycle = this.buildSeconds + HOLD_SECONDS + UNBUILD_SECONDS;
    this.elapsed = 0;
    this.settle(0);
    this.updateCamera(0);
    this.render();
  }

  /**
   * Where the model sits in the frame: 0.5 / 0.5 centred, higher meaning
   * further right and further down.
   *
   * Wide headers put the model beside the type; narrow ones stack it under.
   */
  setBias(x: number, y: number): void {
    this.biasX = x;
    this.biasY = y;
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  resize(width: number, height: number): void {
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.model) {
      const size = new Vector3();
      this.model.bounds.getSize(size);
      this.radius = this.fitDistance(
        (size.length() / 2) * this.modelSpace.scale.x
      );
    }
    this.updateCamera(0);
    this.render();
  }

  /** Distance at which a sphere of `radius` fills the shorter axis of the frame. */
  private fitDistance(radius: number): number {
    const vertical = (this.camera.fov * Math.PI) / 360;
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    return (radius / Math.sin(Math.min(vertical, horizontal))) * FRAME_MARGIN;
  }

  private applyTheme(): void {
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;

    this.scene.environmentIntensity = Number(token("--scene-env", "0.85"));
    const shadow = this.floor.material as ShadowMaterial;
    shadow.opacity = Number(token("--scene-shadow", "0.3"));
    shadow.color = new Color(token("--scene-grid-major", "#2a2f39"));
    this.render();
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.pointerId = event.pointerId;
    this.dragging = false;
    this.moved = 0;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.moved += Math.hypot(dx, dy);
    if (this.moved < DRAG_SLOP) {
      return;
    }
    this.dragging = true;
    this.azimuthTarget -= dx * 0.008;
    this.elevationTarget = Math.min(
      Math.max(this.elevationTarget - dy * 0.005, MIN_ELEVATION),
      MAX_ELEVATION
    );
  };

  private readonly handlePointerEnd = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) {
      return;
    }
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.pointerId = null;
    this.dragging = false;
  };

  private frame(dt: number): void {
    this.elapsed = (this.elapsed + dt) % this.cycle;
    this.settle(this.elapsed);
    this.updateCamera(dt);
    this.render();
  }

  /**
   * How far into place one brick is at `now`: 0 waiting above, 1 seated.
   *
   * Build, hold and unbuild share one function because they are one motion read
   * forwards and then backwards. Bricks go on in the order the author wrote and
   * come off in the reverse of it, which is the only order that never leaves a
   * brick in the air with nothing under it.
   */
  private progressFor(view: BrickView, now: number): number {
    const steps = this.model?.steps.length ?? 1;
    /** How far into its own slice of the timeline a step is. */
    const slice = (step: number, share: number, at: number) => {
      const width = (1 / steps) * share;
      return clamp01((at - (step / steps) * (1 - width)) / width);
    };

    if (now < this.buildSeconds) {
      const inStep = slice(
        view.brick.step,
        DROP_WINDOW,
        clamp01(now / this.buildSeconds)
      );
      return easeOutQuart(
        staggered(inStep, view.indexInStep, view.siblings, 0.7)
      );
    }

    const held = now - this.buildSeconds;
    if (held < HOLD_SECONDS) {
      return 1;
    }

    const local = clamp01((held - HOLD_SECONDS) / UNBUILD_SECONDS);
    return 1 - slice(steps - 1 - view.brick.step, 0.8, local);
  }

  /** Put every brick where the timeline says it is. */
  private settle(now: number): void {
    for (const view of this.views) {
      const t = this.reduced ? 1 : this.progressFor(view, now);
      const { object, builtPose } = view.brick;
      object.visible = t > 0.001;
      if (!object.visible) {
        continue;
      }
      object.position.set(
        builtPose.position.x,
        builtPose.position.y + this.rise * (1 - t),
        builtPose.position.z
      );
      // A few degrees of tilt on the way down, gone by the time it seats.
      this.scratch.quaternion.setFromAxisAngle(
        view.brick.drop.spinAxis,
        (1 - t) * 0.22
      );
      object.quaternion
        .copy(builtPose.quaternion)
        .premultiply(this.scratch.quaternion);
    }
  }

  /**
   * Orbit, with the model held off centre.
   *
   * The camera and the point it looks at are panned together along the camera's
   * own axes, so the model keeps its place in the frame however far round the
   * turntable has gone. Sliding only the target would swing the model across
   * the frame as it turned.
   */
  private updateCamera(dt: number): void {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: set true while a drag is in flight; Biome sees only the initialiser
    if (!(this.dragging || this.reduced)) {
      this.azimuthTarget += SPIN_SPEED * dt;
    }
    this.azimuth = damp(this.azimuth, this.azimuthTarget, 6, dt);
    this.elevation = damp(this.elevation, this.elevationTarget, 6, dt);

    const cos = Math.cos(this.elevation);
    const { right, up, forward, target } = this.scratch;

    this.camera.position.set(
      Math.sin(this.azimuth) * this.radius * cos,
      Math.sin(this.elevation) * this.radius + this.focus,
      Math.cos(this.azimuth) * this.radius * cos
    );
    target.set(0, this.focus, 0);

    // The camera's own basis, taken from where it is rather than from the
    // angles, so the offset below is measured in the frame the viewer sees.
    right.set(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    forward.subVectors(target, this.camera.position).normalize();
    up.crossVectors(right, forward).normalize();

    const vertical = (this.camera.fov * Math.PI) / 360;
    const height = 2 * this.radius * Math.tan(vertical);
    const panX = -(this.biasX - 0.5) * height * this.camera.aspect;
    const panY = (this.biasY - 0.5) * height;

    this.camera.position.addScaledVector(right, panX).addScaledVector(up, panY);
    target.addScaledVector(right, panX).addScaledVector(up, panY);

    this.camera.up.copy(UP);
    this.camera.lookAt(target);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.loop.dispose();
    this.themeObserver?.disconnect();
    this.themeObserver = null;

    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerEnd);
    this.canvas.removeEventListener("pointercancel", this.handlePointerEnd);

    if (this.model) {
      disposeModel(this.model);
      this.model = null;
    }
    this.views = [];
    this.modelSpace.clear();
    this.floor.geometry.dispose();
    (this.floor.material as ShadowMaterial).dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}

/** Group the bricks by step, so a step's worth can land together. */
function orderBricks(model: ModelData): BrickView[] {
  const counts = new Map<number, number>();
  for (const brick of model.bricks) {
    counts.set(brick.step, (counts.get(brick.step) ?? 0) + 1);
  }

  const seen = new Map<number, number>();
  return model.bricks.map((brick) => {
    const index = seen.get(brick.step) ?? 0;
    seen.set(brick.step, index + 1);
    return { brick, indexInStep: index, siblings: counts.get(brick.step) ?? 1 };
  });
}
