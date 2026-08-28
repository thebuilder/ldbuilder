import {
  Box3,
  type Mesh,
  Plane,
  Quaternion,
  Ray,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import {
  instantiate,
  loadPalette,
  type Palette,
  type PalettePart,
} from "@/ldraw/palette";
import type { Brick } from "@/ldraw/types";
import { readFreeBuild, writeFreeBuild } from "@/lib/freeStore";
import {
  orientation,
  type Placement,
  rotatedCenter,
  rotatedHalfExtents,
  STUD,
  snapPlacement,
  toLdrawFile,
} from "./freeBuild";
import {
  boundsOf,
  type Member,
  mergeProfiles,
  type Profile,
  profileOf,
  type Standing,
} from "./heightField";
import { LiveWorld } from "./liveWorld";
import { loadPhysics } from "./physics";
import { RenderLoop } from "./RenderLoop";
import { connectedTo, linksBetween, loadBearing } from "./subassembly";
import { Viewport } from "./Viewport";

/**
 * Free build: a floor, a box of parts, and nothing telling you what to make.
 *
 * The difference from the guided flow is not the rendering, which is the same
 * room, but what a brick can be. There, a brick is one of a model's parts and
 * the only question is whether it is in yet. Here a brick is created on demand,
 * can be picked back up, and goes wherever the grid allows.
 *
 * Three states, and every brick is in exactly one. **Loose** bricks are dynamic
 * bodies lying on the floor, which is what "tip fifty onto the ground" makes.
 * A **carried** brick has left physics and follows the pointer, snapped. A
 * **placed** brick is at an exact grid pose with a static collider, so the pile
 * piles against the model.
 */

/** Height the loose pile is dropped from, and what gravity is scaled by. */
const WORLD_UNIT = 400;
const FLOOR_Y = 0;

/** Half the floor an empty build opens onto, in LDraw units: ten studs each way. */
const DEFAULT_VIEW = STUD * 10;

/** Bricks tipped out land in a patch this wide, so they do not stack into a tower. */
const POUR_SPREAD = 120;

/** The most that can be tipped out at once; a pile past this is unsearchable. */
const MAX_POUR = 50;

/** How fast a carried brick eases to the pose the grid picked for it. */
const CARRY_LAMBDA = 22;

/** Smoothing on the speed a carried brick is tracked at, for throwing it. */
const CARRY_VELOCITY_LAMBDA = 18;

const SAVE_INTERVAL_MS = 1500;

export interface Armed {
  colorCode: number;
  file: string;
}

export interface CarriedInfo {
  blocked: boolean;
  colorCode: number;
  /** How many parts are in hand. More than one is a subassembly. */
  count: number;
  file: string;
  name: string;
  /** Grid steps the person has nudged it by. */
  nudge: { x: number; y: number; z: number };
  tip: number;
  yaw: number;
}

export interface FreeProgress {
  carrying: CarriedInfo | null;
  loose: number;
  placed: number;
  /** Set when the palette could not be loaded or physics is missing. */
  problem: string | null;
  ready: boolean;
}

export interface FreeCallbacks {
  onProgress?: (progress: FreeProgress) => void;
}

/** One part in hand, and where it sits relative to the one that was grabbed. */
interface Piece {
  brick: Brick;
  offset: Vector3;
  part: PalettePart;
  tip: number;
  yaw: number;
}

interface Carried {
  blocked: boolean;
  /** Where it came from, so cancelling can put it back. */
  from: "inventory" | "loose" | "placed";
  nudge: { x: number; y: number; z: number };
  /**
   * Everything in hand. The first is the part that was clicked: the pointer
   * holds that one, and the rest hang off it at the offsets they were built at.
   */
  parts: Piece[];
  /** The whole group measured as one shape, remeasured when it is turned. */
  profile: Profile;
  /** False until the hand has a previous position to measure against. */
  tracked: boolean;
  /**
   * How fast the part is actually moving, smoothed. Kept so that letting one go
   * throws it rather than dropping it: the momentum of the gesture is the whole
   * difference between putting a brick down and lobbing it across the floor.
   */
  velocity: Vector3;
}

/**
 * Turn an offset a quarter circle at a time about the upright.
 *
 * Done as integers rather than through a quaternion because these are grid
 * offsets: a build turned four times has to come back to the build it was,
 * and 19.999999 studs from the anchor is a part that no longer lines up.
 */
function turnAboutY(offset: Vector3, steps: 0 | 1 | 2 | 3): void {
  for (let step = 0; step < steps; step += 1) {
    const { x } = offset;
    offset.x = offset.z;
    offset.z = -x;
  }
}

export class FreeController {
  private readonly viewport: Viewport;
  private readonly canvas: HTMLCanvasElement;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  private palette: Palette | null = null;
  private world: LiveWorld | null = null;
  private callbacks: FreeCallbacks = {};

  /** Every instance ever made, by id. Holes are instances that were deleted. */
  private readonly instances: (Brick | undefined)[] = [];
  private readonly placements = new Map<number, Placement>();
  private readonly placed = new Map<number, Standing>();
  /**
   * Column profiles, by part and orientation.
   *
   * Measuring one costs a walk over the part's triangles, and the answer only
   * changes when the part is turned, so the same handful are reused all session.
   */
  private readonly profiles = new Map<string, Profile>();
  private readonly loose = new Set<number>();
  private carried: Carried | null = null;
  private armed: Armed | null = null;

  private nextId = 0;
  private readonly loop = new RenderLoop((dt) => this.tick(dt));
  private problem: string | null = null;
  private lastReport = "";
  private saveDirty = false;
  private lastSaveAt = 0;

  private readonly ray = new Ray();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), -FLOOR_Y);
  private readonly desired = new Vector3();
  private readonly snapped = new Vector3();
  private readonly halfExtents = new Vector3();
  private readonly center = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly lastCarried = new Vector3();
  private readonly carryStep = new Vector3();
  /** Its own pair, because the group is walked while the anchor's pose is held. */
  private readonly pieceQuaternion = new Quaternion();
  private readonly piecePosition = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.viewport = new Viewport(canvas);
    // The arrows nudge whatever is being carried, and only fall back to the
    // camera when nothing is in hand.
    this.viewport.setOptions({ wantsArrows: () => this.carried === null });

    canvas.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerdown", this.handlePointerDown, true);
    window.addEventListener("pagehide", this.handlePageHide);
    document.addEventListener("visibilitychange", this.handlePageHide);
  }

  setCallbacks(callbacks: FreeCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Load the parts and open the floor. Reports what went wrong if it cannot. */
  async open(palette: Palette | null, resume: boolean): Promise<void> {
    if (palette) {
      this.palette = palette;
    } else {
      try {
        this.palette = await loadPalette();
      } catch (error) {
        this.problem =
          error instanceof Error ? error.message : "the parts could not load";
        this.report(true);
        return;
      }
    }

    // The solver is a WebAssembly module loaded on demand. Free build cannot
    // do without it: the loose pile is the physics.
    await loadPhysics();
    const world = LiveWorld.create(FLOOR_Y, WORLD_UNIT, new Vector3());
    if (!world) {
      this.problem = "the physics engine could not load";
      this.report(true);
      return;
    }
    this.world = world;

    if (resume) {
      this.restore();
    }
    // Nothing to fly from on the first framing: the camera is being placed.
    this.frame(true);
    this.report(true);
  }

  get ready(): boolean {
    return this.palette !== null && this.world !== null;
  }

  // ------------------------------------------------------------- inventory

  arm(armed: Armed | null): void {
    this.armed = armed;
    // Changing the colour while something is in hand recolours it, which is
    // what "try it in red" has to mean when a brick is already on the pointer.
    // Only ever one part at a time: recolouring a subassembly is a different
    // thing to ask for, and not the thing an armed colour is asking for.
    const { carried } = this;
    const [only] = carried?.parts ?? [];
    if (
      carried?.parts.length === 1 &&
      armed &&
      armed.file === only.brick.partFile
    ) {
      this.recolourCarried(armed.colorCode);
    }
  }

  /** Take one out of the box and put it on the pointer. */
  takeOut(file: string, colorCode: number): void {
    const part = this.palette?.byFile.get(file.toLowerCase());
    if (!(part && this.palette)) {
      return;
    }
    this.cancelCarry();

    const brick = this.makeInstance(part, colorCode);
    this.viewport.scene.add(brick.object);
    this.hold("inventory", [
      { brick, offset: new Vector3(), part, tip: 0, yaw: 0 },
    ]);
    this.report();
  }

  /**
   * Tip a handful onto the floor.
   *
   * They arrive as a physical pile rather than in a neat row, because a box of
   * parts is a pile and picking through one is half of building.
   */
  pourOut(file: string, colorCode: number, count: number): void {
    const part = this.palette?.byFile.get(file.toLowerCase());
    const { world } = this;
    if (!(part && world && this.palette)) {
      return;
    }

    const wanted = Math.max(1, Math.min(Math.round(count), MAX_POUR));
    const origin = this.viewport.controls.target;
    const position = new Vector3();
    const tilt = new Quaternion();

    for (let i = 0; i < wanted; i += 1) {
      const brick = this.makeInstance(part, colorCode);
      this.viewport.scene.add(brick.object);
      position.set(
        origin.x + (Math.random() - 0.5) * POUR_SPREAD,
        FLOOR_Y + WORLD_UNIT * (0.4 + Math.random() * 0.4),
        origin.z + (Math.random() - 0.5) * POUR_SPREAD
      );
      tilt.setFromAxisAngle(
        new Vector3(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1
        ).normalize(),
        Math.random() * Math.PI
      );
      world.spawn(brick, { position, quaternion: tilt });
      this.loose.add(brick.id);
    }
    this.saveDirty = true;
    this.report();
  }

  // -------------------------------------------------------------- carrying

  /**
   * Turn what is in hand a quarter circle at a time.
   *
   * A single part turns both ways. A subassembly only turns about the upright,
   * because tipping one cannot be written down: a pose here is a yaw and a tip,
   * sixteen of the twenty-four ways a part can sit square to the grid, and
   * tipping a group takes its members out of those sixteen. Turning it about Y
   * keeps every member in them, so that is the turn a group gets.
   */
  rotate(yawSteps: number, tipSteps: number): void {
    const { carried } = this;
    if (!carried) {
      return;
    }
    const steps = (((yawSteps % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    if (carried.parts.length === 1) {
      const [only] = carried.parts;
      only.yaw = (only.yaw + yawSteps + 4) % 4;
      only.tip = (only.tip + tipSteps + 4) % 4;
    } else {
      for (const piece of carried.parts) {
        turnAboutY(piece.offset, steps);
        piece.yaw = (piece.yaw + steps) % 4;
      }
    }
    carried.profile = this.groupProfile(carried.parts);
    // Work out where that leaves it before saying anything: reporting first
    // describes the pose before the turn, so the HUD is a move behind and
    // "will not fit" arrives once you have already fixed it.
    this.resolveSnap(carried);
    this.report();
  }

  /** Shift the snapped pose by whole grid steps, for the placements a grid misses. */
  nudge(x: number, y: number, z: number): void {
    const { carried } = this;
    if (!carried) {
      return;
    }
    carried.nudge.x += x;
    carried.nudge.y += y;
    carried.nudge.z += z;
    this.resolveSnap(carried);
    this.report();
  }

  /** Put the carried brick down where the grid says, if it fits. */
  place(): void {
    const { carried } = this;
    if (!(carried && this.world)) {
      return;
    }
    // Snap once more from the pointer as it is now, so a part lands where the
    // click was rather than wherever the easing had reached.
    this.resolveSnap(carried);
    if (carried.blocked) {
      return;
    }

    // Each member is written down at its own pose rather than as a child of the
    // one that was carried: a subassembly is a way of moving parts, not a thing
    // the build knows about, so putting it down leaves ordinary placements.
    for (const piece of carried.parts) {
      const { brick } = piece;
      const position = this.snapped.clone().add(piece.offset);
      brick.object.position.copy(position);
      brick.object.quaternion.copy(
        orientation(piece.yaw, piece.tip, this.pieceQuaternion)
      );

      this.placements.set(brick.id, {
        colorCode: brick.colorCode,
        file: brick.partFile,
        id: brick.id,
        position,
        tip: piece.tip,
        yaw: piece.yaw,
      });
      this.placed.set(brick.id, {
        position,
        profile: this.profileFor(piece.part, piece.yaw, piece.tip),
      });
      this.world.addStatic(brick);
    }
    this.carried = null;

    // Putting one down usually means putting another down, so the same part
    // comes straight back out rather than making you go and fetch it.
    if (carried.from === "inventory" && this.armed) {
      this.takeOut(this.armed.file, this.armed.colorCode);
    }
    this.saveDirty = true;
    this.report();
  }

  /** Stop carrying: back to the floor if it came from there, gone if it did not. */
  cancelCarry(): void {
    const { carried } = this;
    if (!carried) {
      return;
    }
    this.carried = null;

    for (const piece of carried.parts) {
      if (carried.from === "inventory") {
        this.destroy(piece.brick.id);
      } else {
        this.dropLoose(piece.brick, carried.velocity);
      }
    }
    this.report();
  }

  /** Throw away whatever is in hand. */
  deleteCarried(): void {
    const { carried } = this;
    if (!carried) {
      return;
    }
    this.carried = null;
    for (const piece of carried.parts) {
      this.destroy(piece.brick.id);
    }
    this.saveDirty = true;
    this.report();
  }

  // ------------------------------------------------------------------ bulk

  /** Sweep the floor: everything loose goes back in the box. */
  clearLoose(): void {
    for (const id of [...this.loose]) {
      this.destroy(id);
    }
    this.saveDirty = true;
    this.report();
  }

  /** Start again with an empty floor. */
  clearAll(): void {
    this.cancelCarry();
    for (const id of [...this.placements.keys()]) {
      this.destroy(id);
    }
    this.clearLoose();
    this.saveDirty = true;
    this.report(true);
  }

  /** The build, as a file a person can open in any LDraw tool. */
  toLdraw(title: string): string {
    return toLdrawFile([...this.placements.values()], title);
  }

  frame(instant = false): void {
    const box = new Box3();
    const standing = new Box3();
    for (const entry of this.placed.values()) {
      box.union(boundsOf(entry, standing));
    }
    if (box.isEmpty()) {
      // An empty floor still needs a sensible amount of it on screen: about
      // twenty studs across, which is a baseplate's worth of somewhere to
      // start rather than a close-up of nothing.
      box.set(
        new Vector3(-DEFAULT_VIEW, FLOOR_Y, -DEFAULT_VIEW),
        new Vector3(DEFAULT_VIEW, FLOOR_Y + STUD * 4, DEFAULT_VIEW)
      );
    } else {
      // Leave room around what is already built, so there is floor to build on
      // rather than the build filling the frame edge to edge.
      box.expandByScalar(STUD * 4);
    }
    this.viewport.frameBox(box, instant);
  }

  // --------------------------------------------------------------- running

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  resize(width: number, height: number): void {
    this.viewport.resize(width, height);
  }

  private tick(dt: number): void {
    const { world } = this;
    if (world) {
      this.updateCarried(dt);
      world.step(dt);
      world.sync(this.instances as Brick[]);
    }
    this.viewport.updateCamera(dt);
    this.viewport.render();

    if (
      // biome-ignore lint/suspicious/noUnnecessaryConditions: set true on every change; Biome infers the literal false from the initialiser
      this.saveDirty &&
      performance.now() - this.lastSaveAt > SAVE_INTERVAL_MS
    ) {
      this.save();
    }
  }

  /**
   * Move whatever is in hand to where the pointer says, via the grid.
   *
   * The ray is cast at the build itself rather than at a plane, so pointing at
   * the top of a tower means building on the top of the tower. The grid then
   * decides the rest: where the studs are, and what the part is standing on.
   */
  private updateCarried(dt: number): void {
    const { carried } = this;
    if (!carried) {
      return;
    }
    this.resolveSnap(carried);

    this.trackHand(carried, dt);

    // Eased rather than teleported: at grid resolution a jump of a whole stud
    // is a jump, and following it is what tells you the snap happened. Only the
    // drawing is eased; the pose that gets recorded is the exact one.
    const blend = 1 - Math.exp(-CARRY_LAMBDA * dt);
    for (const piece of carried.parts) {
      const { object } = piece.brick;
      object.position.lerp(
        this.piecePosition.copy(this.snapped).add(piece.offset),
        blend
      );
      object.quaternion.slerp(
        orientation(piece.yaw, piece.tip, this.pieceQuaternion),
        blend
      );
    }
  }

  /**
   * Work out exactly where the carried part would go.
   *
   * Kept apart from the easing above because the two want different answers.
   * What is drawn should slide into place; what is written down has to be on
   * the grid to the unit, or an exported model is 158.13 studs from the origin
   * and lines up with nothing.
   */
  private resolveSnap(carried: Carried): void {
    this.poseOf(carried);

    if (!this.pointerTarget(this.desired)) {
      return;
    }
    const result = snapPlacement(
      {
        built: this.placed,
        center: this.center,
        desired: this.desired,
        floorY: FLOOR_Y,
        half: this.halfExtents,
        nudge: carried.nudge,
        profile: carried.profile,
      },
      this.snapped
    );
    carried.blocked = result.blocked;
  }

  /**
   * How fast the hand is moving over the table.
   *
   * Taken from the pointer rather than from the brick, because the brick is
   * eased towards the grid and picking one up moves it a stud or two on its
   * own. Counting that as a throw means every part let go where it was picked
   * up shoots off across the floor.
   */
  private trackHand(carried: Carried, dt: number): void {
    if (!carried.tracked) {
      carried.tracked = true;
      this.lastCarried.copy(this.desired);
      return;
    }
    if (dt <= 0) {
      return;
    }
    this.carryStep.copy(this.desired).sub(this.lastCarried).divideScalar(dt);
    this.lastCarried.copy(this.desired);
    carried.velocity.lerp(
      this.carryStep,
      1 - Math.exp(-CARRY_VELOCITY_LAMBDA * dt)
    );
  }

  /** Where the pointer meets the build, or the floor if it meets nothing. */
  private pointerTarget(target: Vector3): boolean {
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    this.ray.copy(this.raycaster.ray);

    const meshes: Mesh[] = [];
    for (const id of this.placements.keys()) {
      const brick = this.instances[id];
      if (brick) {
        meshes.push(...brick.meshes);
      }
    }
    const [hit] = this.raycaster.intersectObjects(meshes, false);
    if (hit) {
      target.copy(hit.point);
      return true;
    }
    return this.ray.intersectPlane(this.groundPlane, target) !== null;
  }

  // ---------------------------------------------------------------- pointer

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  };

  /**
   * A press is either putting down what is in hand, or picking something up.
   *
   * Capturing on the window is what lets a press on a brick avoid starting an
   * orbit: OrbitControls is bound to the canvas and would otherwise see the
   * event first. See the same trick in SceneController.
   */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.target !== this.canvas || !this.ready) {
      return;
    }
    this.handlePointerMove(event);

    if (this.carried) {
      if (!this.carried.blocked) {
        event.stopPropagation();
        event.preventDefault();
        this.place();
      }
      return;
    }

    const hit = this.pick();
    if (hit === null) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    this.pickUp(hit, event.shiftKey);
  };

  private pick(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera);
    const meshes: Mesh[] = [];
    for (const brick of this.instances) {
      if (brick?.object.parent) {
        meshes.push(...brick.meshes);
      }
    }
    for (const hit of this.raycaster.intersectObjects(meshes, false)) {
      const id = hit.object.userData?.brickId;
      if (typeof id === "number") {
        return id;
      }
    }
    return null;
  }

  /**
   * Take a brick back off the build, or out of the pile, and carry it.
   *
   * A brick out of the pile is a brick. A brick out of the build brings company:
   * whatever it alone was holding up, because taking it out is what would bring
   * that down anyway, and with `whole` the entire piece of the build it belongs
   * to, because sometimes the thing you want to move is the turret and not the
   * brick you happened to click on.
   */
  private pickUp(id: number, whole: boolean): void {
    const brick = this.instances[id];
    const part = brick
      ? this.palette?.byFile.get(brick.partFile.toLowerCase())
      : undefined;
    if (!(brick && part && this.world)) {
      return;
    }

    const anchor = this.placements.get(id);
    if (!anchor) {
      this.world.despawn(id);
      this.loose.delete(id);
      this.hold("loose", [
        { brick, offset: new Vector3(), part, tip: 0, yaw: 0 },
      ]);
      this.snapped.copy(brick.object.position);
      this.saveDirty = true;
      this.report();
      return;
    }

    const parts: Piece[] = [];
    for (const memberId of this.groupAround(id, whole)) {
      const piece = this.lift(memberId, anchor.position);
      if (piece) {
        parts.push(piece);
      }
    }
    this.hold("placed", parts);
    this.snapped.copy(anchor.position);
    this.saveDirty = true;
    this.report();
  }

  /**
   * The placed parts a click on this one should bring with it, clicked one
   * first: the pointer holds that part, and the offsets are measured from it.
   */
  private groupAround(id: number, whole: boolean): number[] {
    const links = linksBetween(this.placed);
    const group = whole ? connectedTo(id, links) : loadBearing(id, links);
    return [id, ...[...group].filter((other) => other !== id)];
  }

  /** Take one placed part off the build, as a piece of a group. */
  private lift(id: number, from: Vector3): Piece | null {
    const brick = this.instances[id];
    const placement = this.placements.get(id);
    const part = brick
      ? this.palette?.byFile.get(brick.partFile.toLowerCase())
      : undefined;
    if (!(brick && placement && part)) {
      return null;
    }
    this.placements.delete(id);
    this.placed.delete(id);
    this.world?.removeStatic(id);
    return {
      brick,
      offset: placement.position.clone().sub(from),
      part,
      tip: placement.tip,
      yaw: placement.yaw,
    };
  }

  /** Put a group on the pointer, measured as one shape. */
  private hold(from: Carried["from"], parts: Piece[]): void {
    if (parts.length === 0) {
      return;
    }
    this.carried = {
      blocked: false,
      from,
      nudge: { x: 0, y: 0, z: 0 },
      parts,
      profile: this.groupProfile(parts),
      tracked: false,
      velocity: new Vector3(),
    };
  }

  /**
   * The group as one column grid.
   *
   * Merged rather than kept as a list because everything downstream, resting
   * and fitting alike, then costs what one part costs however many parts are in
   * hand. A single part is its own profile and this is a no-op for it.
   */
  private groupProfile(parts: Piece[]): Profile {
    const members: Member[] = parts.map((piece) => ({
      offset: piece.offset,
      profile: this.profileFor(piece.part, piece.yaw, piece.tip),
    }));
    return mergeProfiles(members);
  }

  // ----------------------------------------------------------- bookkeeping

  private makeInstance(part: PalettePart, colorCode: number): Brick {
    const id = this.nextId;
    this.nextId += 1;
    const { palette } = this;
    if (!palette) {
      throw new Error("no palette");
    }
    const brick = instantiate(part, colorCode, id, palette);
    for (const mesh of brick.meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.instances[id] = brick;
    return brick;
  }

  private recolourCarried(colorCode: number): void {
    const { carried } = this;
    const { palette } = this;
    if (!(carried && palette)) {
      return;
    }
    const [only] = carried.parts;
    const replacement = this.makeInstance(only.part, colorCode);
    this.viewport.scene.add(replacement.object);
    replacement.object.position.copy(only.brick.object.position);
    replacement.object.quaternion.copy(only.brick.object.quaternion);
    this.destroy(only.brick.id);
    only.brick = replacement;
  }

  private dropLoose(brick: Brick, velocity: Vector3): void {
    if (!this.world) {
      return;
    }
    this.world.drop(brick, velocity);
    this.loose.add(brick.id);
  }

  private destroy(id: number): void {
    const brick = this.instances[id];
    if (!brick) {
      return;
    }
    this.world?.despawn(id);
    this.world?.removeStatic(id);
    brick.object.removeFromParent();
    this.placements.delete(id);
    this.placed.delete(id);
    this.loose.delete(id);
    this.instances[id] = undefined;
  }

  /**
   * Load the scratch vectors with the pose a carried part currently has: its
   * orientation, and the box that orientation gives it.
   */
  private poseOf(carried: Carried): void {
    // The part under the pointer sets the grid the group lands on. Everything
    // else keeps the offset it was built at, which was already on that grid.
    const [anchor] = carried.parts;
    orientation(anchor.yaw, anchor.tip, this.quaternion);
    // The solid box, not the whole part: a brick lands on the body of the one
    // below it, and its own studs go inside whatever is put on top later.
    rotatedHalfExtents(
      anchor.part.solidHalfExtents,
      this.quaternion,
      this.halfExtents
    );
    rotatedCenter(anchor.part.solidCenter, this.quaternion, this.center);
  }

  /**
   * The part's columns at this orientation, measured once and kept.
   */
  private profileFor(part: PalettePart, yaw: number, tip: number): Profile {
    const key = `${part.file}|${yaw}|${tip}`;
    const known = this.profiles.get(key);
    if (known) {
      return known;
    }
    // Its own quaternion, not the shared scratch one: this is called in the
    // middle of posing a part, and posing it is what the scratch one is for.
    const profile = profileOf(
      part.meshes,
      orientation(yaw, tip, new Quaternion())
    );
    this.profiles.set(key, profile);
    return profile;
  }

  private report(force = false): void {
    const report = this.callbacks.onProgress;
    if (!report) {
      return;
    }
    const { carried } = this;
    // The part under the pointer speaks for the group: it is the one that was
    // clicked, and the one the turn and the nudge are described relative to.
    const anchor = carried?.parts[0];
    const progress: FreeProgress = {
      carrying:
        carried && anchor
          ? {
              blocked: carried.blocked,
              colorCode: anchor.brick.colorCode,
              count: carried.parts.length,
              file: anchor.brick.partFile,
              name: anchor.part.name,
              nudge: { ...carried.nudge },
              tip: anchor.tip,
              yaw: anchor.yaw,
            }
          : null,
      loose: this.loose.size,
      placed: this.placements.size,
      problem: this.problem,
      ready: this.ready,
    };
    const signature = `${progress.placed}:${progress.loose}:${progress.ready}:${progress.problem}:${anchor?.brick.id ?? -1}:${carried?.parts.length}:${anchor?.yaw}:${anchor?.tip}:${carried?.blocked}:${carried?.nudge.x},${carried?.nudge.y},${carried?.nudge.z}`;
    if (!force && signature === this.lastReport) {
      return;
    }
    this.lastReport = signature;
    report(progress);
  }

  // ------------------------------------------------------------------ save

  private save(): void {
    this.saveDirty = false;
    if (!this.world) {
      return;
    }
    this.lastSaveAt = performance.now();
    writeFreeBuild({
      loose: this.world.snapshot(),
      looseParts: [...this.loose].map((id) => ({
        colorCode: this.instances[id]?.colorCode ?? 0,
        file: this.instances[id]?.partFile ?? "",
        id,
      })),
      placed: [...this.placements.values(), ...this.inHand()].map(
        (placement) => ({
          c: placement.colorCode,
          f: placement.file,
          p: [placement.position.x, placement.position.y, placement.position.z],
          t: placement.tip,
          y: placement.yaw,
        })
      ),
      updatedAt: Date.now(),
      v: 1,
    });
  }

  /**
   * Where the parts in hand would land, written into the save with the rest.
   *
   * Anything being carried has already left `placements`, so a save taken while
   * somebody is holding something, and one is taken the moment a tab goes to
   * the background, would otherwise be a save with that hole in it. One brick
   * short of a build is an annoyance; a subassembly short of one is a loss.
   */
  private inHand(): Placement[] {
    const { carried } = this;
    if (carried?.from !== "placed") {
      return [];
    }
    return carried.parts.map((piece) => ({
      colorCode: piece.brick.colorCode,
      file: piece.brick.partFile,
      id: piece.brick.id,
      position: this.snapped.clone().add(piece.offset),
      tip: piece.tip,
      yaw: piece.yaw,
    }));
  }

  private restore(): void {
    const save = readFreeBuild();
    const { palette } = this;
    if (!(save && palette && this.world)) {
      return;
    }

    for (const entry of save.placed) {
      const part = palette.byFile.get(entry.f.toLowerCase());
      if (!part) {
        continue;
      }
      const brick = this.makeInstance(part, entry.c);
      this.viewport.scene.add(brick.object);
      const position = new Vector3(entry.p[0], entry.p[1], entry.p[2]);
      orientation(entry.y, entry.t, this.quaternion);
      brick.object.position.copy(position);
      brick.object.quaternion.copy(this.quaternion);

      const placement: Placement = {
        colorCode: entry.c,
        file: entry.f,
        id: brick.id,
        position,
        tip: entry.t,
        yaw: entry.y,
      };
      this.placements.set(brick.id, placement);
      this.placed.set(brick.id, {
        position,
        profile: this.profileFor(part, entry.y, entry.t),
      });
      this.world.addStatic(brick);
    }

    // The pile is restored by part, then by pose, because ids do not survive a
    // reload: a saved instance is only ever "one of these, lying there".
    const poses = new Map<number, number[]>();
    for (let i = 0; i + 7 < save.loose.length; i += 8) {
      poses.set(save.loose[i], save.loose.slice(i + 1, i + 8));
    }
    const position = new Vector3();
    const quaternion = new Quaternion();
    for (const entry of save.looseParts) {
      const part = palette.byFile.get(entry.file.toLowerCase());
      const pose = poses.get(entry.id);
      if (!(part && pose)) {
        continue;
      }
      const brick = this.makeInstance(part, entry.colorCode);
      this.viewport.scene.add(brick.object);
      position.set(pose[0], pose[1], pose[2]);
      quaternion.set(pose[3], pose[4], pose[5], pose[6]);
      this.world.spawn(brick, { position, quaternion });
      this.loose.add(brick.id);
    }
  }

  private readonly handlePageHide = (): void => {
    if (this.world) {
      this.save();
    }
  };

  dispose(): void {
    this.loop.dispose();
    this.save();
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerdown", this.handlePointerDown, true);
    window.removeEventListener("pagehide", this.handlePageHide);
    document.removeEventListener("visibilitychange", this.handlePageHide);
    this.world?.dispose();
    this.world = null;
    this.viewport.dispose();
  }
}
