import {
  ACESFilmicToneMapping,
  type Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { isTypingTarget } from "@/lib/dom";

/**
 * The room the bricks are in: renderer, lighting, floor, camera, and the keys
 * that move it.
 *
 * None of this knows what is being looked at. Both flows that draw bricks, the
 * one that plays a model out and the one that hands you a box of parts, need
 * exactly the same room, and the alternative to sharing it is two copies of a
 * lighting rig and a navigation scheme that then drift.
 */

/** Every model is scaled so its longest dimension is this many world units. */
export const TARGET_SIZE = 100;

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

const UP = new Vector3(0, 1, 0);

/** Keys that drive the camera. Everything else is somebody else's to handle. */
const NAV_KEYS = new Set([
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

export interface ViewportOptions {
  /** Called when the viewer takes the camera somewhere themselves. */
  onUserMove?: () => void;
  /**
   * Whether the arrow keys belong to the camera right now. Free build lends
   * them to whatever is being carried.
   */
  wantsArrows?: () => boolean;
}

export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;

  private readonly light: DirectionalLight;
  private grid: GridHelper;
  private readonly shadowPlane: Mesh;
  private themeObserver: MutationObserver | null = null;

  private readonly keysDown = new Set<string>();
  private readonly moveVelocity = new Vector3();
  private readonly moveForward = new Vector3();
  private readonly moveRight = new Vector3();
  private readonly moveInput = new Vector3();
  private readonly moveDelta = new Vector3();

  private options: ViewportOptions = {};

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

    // Navigation is bound to the window, not the canvas: the canvas is never
    // focused, and requiring a click on it before the keys work is a puzzle.
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.controls.addEventListener("start", this.handleControlsStart);
  }

  setOptions(options: ViewportOptions): void {
    this.options = options;
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

  setTheme(): void {
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    this.grid = this.buildGrid();
    this.scene.add(this.grid);
    this.applyTheme();
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

  /** Put a box on screen, whatever it happens to contain. */
  frameBox(box: Box3): void {
    if (box.isEmpty()) {
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

  resize(width: number, height: number): void {
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private readonly handleControlsStart = (): void => {
    this.options.onUserMove?.();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // Shift only modifies the others, so it is recorded but never claimed.
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      this.keysDown.add(event.code);
      return;
    }
    if (!NAV_KEYS.has(event.code)) {
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
    // Something on screen may be borrowing the arrows, like a brick being
    // nudged into place a stud at a time.
    if (
      event.code.startsWith("Arrow") &&
      this.options.wantsArrows?.() === false
    ) {
      return;
    }

    this.keysDown.add(event.code);
    this.options.onUserMove?.();
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
  updateNavigation(dt: number): void {
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

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.controls.removeEventListener("start", this.handleControlsStart);
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.controls.dispose();
    this.grid.geometry.dispose();
    this.shadowPlane.geometry.dispose();
    (this.shadowPlane.material as ShadowMaterial).dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
