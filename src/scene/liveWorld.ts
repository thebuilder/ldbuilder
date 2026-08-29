import type { Collider, RigidBody, World } from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import type { BagInfo, Brick } from "@/ldraw/types";
import { hashString, makeRandom } from "@/lib/random";
import {
  BRICK_DENSITY,
  BRICK_FRICTION,
  BRICK_RESTITUTION,
  getPhysics,
  HANDLING_GRAVITY,
  type Rapier,
} from "./physics";

/**
 * A live rigid-body world for build mode.
 *
 * The watch flow bakes its pour and plays the recording back, because nothing
 * there is interactive and a recording is free to scrub. Build mode cannot do
 * that: the pile is whatever the person has done to it, so the solver has to
 * run every frame.
 *
 * What that costs is bounded by the same thing that bounds the pour: only one
 * bag is ever loose, so the body count tops out around 170. Rapier sleeps a
 * settled pile, so an untouched one is close to free, and the placed model is
 * static colliders with no bodies at all.
 *
 * Two details are worth knowing. Colliders carry a local translation of the
 * brick's `localCenter`, so a body's transform *is* the brick's transform and
 * nothing downstream has to keep backing the offset out. And a held brick is
 * kinematic rather than dynamic: it shoves the pile around and never gets
 * shoved, which is what makes sorting through a heap feel like sorting rather
 * than like fighting a spring.
 */

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 4;

const STRAY_CHECK_FRAMES = 30;

const STRAY_FACTOR = 1.2;

const THROW_SCALE = 1.3;

const MAX_THROW_SPEED = 4000;

const THROW_SPIN = 0.012;

const VELOCITY_LAMBDA = 22;

export interface SpawnOptions {
  angvel?: Vector3;
  linvel?: Vector3;
  position: Vector3;
  quaternion: Quaternion;
}

interface Held {
  brickId: number;
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
}

export class LiveWorld {
  private readonly rapier: Rapier;
  private readonly world: World;
  private readonly bodies = new Map<number, RigidBody>();
  private readonly statics = new Map<number, Collider>();
  private held: Held | null = null;

  private accumulator = 0;
  private frames = 0;

  private readonly floorY: number;
  private readonly unit: number;
  private readonly centre = new Vector3();

  private readonly scratch = new Vector3();

  private constructor(
    rapier: Rapier,
    floorY: number,
    unit: number,
    centre: Vector3
  ) {
    this.rapier = rapier;
    this.floorY = floorY;
    this.unit = unit;
    this.centre.copy(centre);

    this.world = new rapier.World({ x: 0, y: -HANDLING_GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    // Rapier's thresholds assume a world measured in metres, and LDraw units
    // are 0.4mm. Without this the solver clamps falling bricks to a constant
    // speed, which looks exactly like a bug in the animation code.
    this.world.lengthUnit = unit;

    const thickness = Math.max(unit * 0.05, 10);
    this.world.createCollider(
      rapier.ColliderDesc.cuboid(unit * 8, thickness, unit * 8)
        .setTranslation(centre.x, floorY - thickness, centre.z)
        .setRestitution(BRICK_RESTITUTION)
        .setFriction(1.2)
    );
  }

  static create(
    floorY: number,
    unit: number,
    centre: Vector3
  ): LiveWorld | null {
    const rapier = getPhysics();
    if (!rapier) {
      return null;
    }
    return new LiveWorld(rapier, floorY, unit, centre);
  }

  get looseCount(): number {
    return this.bodies.size;
  }

  spawn(brick: Brick, options: SpawnOptions): void {
    if (this.bodies.has(brick.id) || brick.halfExtents.x <= 0) {
      return;
    }
    const { rapier } = this;
    const { position, quaternion, linvel, angvel } = options;

    const body = this.world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({
          w: quaternion.w,
          x: quaternion.x,
          y: quaternion.y,
          z: quaternion.z,
        })
        .setLinvel(linvel?.x ?? 0, linvel?.y ?? 0, linvel?.z ?? 0)
        .setAngvel(angvel ?? ZERO)
        .setLinearDamping(0)
        .setAngularDamping(0.6)
    );

    this.world.createCollider(
      rapier.ColliderDesc.cuboid(
        brick.halfExtents.x,
        brick.halfExtents.y,
        brick.halfExtents.z
      )
        // The brick's origin is on its top face, not in the middle of its box,
        // so the collider is offset rather than the body.
        .setTranslation(
          brick.localCenter.x,
          brick.localCenter.y,
          brick.localCenter.z
        )
        .setRestitution(BRICK_RESTITUTION)
        .setFriction(BRICK_FRICTION)
        .setDensity(BRICK_DENSITY),
      body
    );

    this.bodies.set(brick.id, body);
  }

  /**
   * Tip a whole bag out above its floor layout and let it land live.
   *
   * `placed` marks bricks that are already in the model, which is what a build
   * begun partway into a bag looks like: those slots are filled, so there is
   * nothing left in the bag to tip out for them. Their turn of the random draw
   * is still taken, so every other brick lands exactly where it would have.
   */
  pour(bag: BagInfo, bricks: Brick[], seed: string, placed?: Uint8Array): void {
    const random = makeRandom(hashString(`${seed}:build${bag.index}`));
    const position = new Vector3();
    const tilt = new Quaternion();
    const axis = new Vector3();
    const linvel = new Vector3();
    const angvel = new Vector3();

    for (const id of bag.brickIds) {
      const brick = bricks[id];
      if (!brick) {
        continue;
      }

      const lift = this.unit * (0.5 + random() * 0.5);
      const spread = Math.max(brick.radius, 8) * 1.5;
      position.set(
        brick.floorPose.position.x + (random() - 0.5) * spread,
        this.floorY + lift,
        brick.floorPose.position.z + (random() - 0.5) * spread
      );
      axis
        .set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
        .normalize();
      tilt.setFromAxisAngle(axis, random() * Math.PI);
      linvel.set(
        (random() - 0.5) * this.unit * 0.2,
        0,
        (random() - 0.5) * this.unit * 0.2
      );
      angvel.set(
        (random() - 0.5) * 6,
        (random() - 0.5) * 6,
        (random() - 0.5) * 6
      );

      if (placed?.[id] === 1) {
        continue;
      }
      this.spawn(brick, { angvel, linvel, position, quaternion: tilt });
    }
  }

  restore(brick: Brick, position: Vector3, quaternion: Quaternion): void {
    this.spawn(brick, { position, quaternion });
  }

  drop(brick: Brick, velocity: Vector3): void {
    this.spawn(brick, {
      position: brick.object.position,
      quaternion: brick.object.quaternion,
    });
    const body = this.bodies.get(brick.id);
    if (body) {
      this.throwBody(body, velocity);
    }
  }

  despawn(brickId: number): void {
    const body = this.bodies.get(brickId);
    if (!body) {
      return;
    }
    if (this.held?.brickId === brickId) {
      this.held = null;
    }
    this.world.removeRigidBody(body);
    this.bodies.delete(brickId);
  }

  /**
   * Give a placed brick a static collider, so loose bricks pile against the
   * model instead of falling through what has already been built.
   */
  addStatic(brick: Brick): void {
    if (this.statics.has(brick.id) || brick.halfExtents.x <= 0) {
      return;
    }
    const { position, quaternion } = brick.builtPose;
    this.scratch
      .copy(brick.localCenter)
      .applyQuaternion(quaternion)
      .add(position);

    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(
        brick.halfExtents.x,
        brick.halfExtents.y,
        brick.halfExtents.z
      )
        .setTranslation(this.scratch.x, this.scratch.y, this.scratch.z)
        .setRotation({
          w: quaternion.w,
          x: quaternion.x,
          y: quaternion.y,
          z: quaternion.z,
        })
        .setRestitution(BRICK_RESTITUTION)
        .setFriction(BRICK_FRICTION)
    );
    this.statics.set(brick.id, collider);
  }

  removeStatic(brickId: number): void {
    const collider = this.statics.get(brickId);
    if (!collider) {
      return;
    }
    this.world.removeCollider(collider, false);
    this.statics.delete(brickId);
  }

  /**
   * Take hold of a brick.
   *
   * The body turns kinematic for as long as it is held. It then pushes the pile
   * out of the way and cannot be pushed itself, which is the difference between
   * dragging a brick out of a heap and watching it get stuck in one.
   */
  grab(brickId: number, position: Vector3, quaternion: Quaternion): boolean {
    const body = this.bodies.get(brickId);
    if (!body) {
      return false;
    }
    this.release();

    body.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true);
    body.enableCcd(true);
    this.held = {
      brickId,
      position: position.clone(),
      quaternion: quaternion.clone(),
      velocity: new Vector3(),
    };
    return true;
  }

  moveHeld(position: Vector3, quaternion: Quaternion, dt: number): void {
    const { held } = this;
    if (!held) {
      return;
    }

    if (dt > 0) {
      this.scratch.copy(position).sub(held.position).divideScalar(dt);
      const blend = 1 - Math.exp(-VELOCITY_LAMBDA * dt);
      held.velocity.lerp(this.scratch, blend);
    }

    held.position.copy(position);
    held.quaternion.copy(quaternion);

    const body = this.bodies.get(held.brickId);
    if (!body) {
      return;
    }
    body.setNextKinematicTranslation(held.position);
    body.setNextKinematicRotation({
      w: held.quaternion.w,
      x: held.quaternion.x,
      y: held.quaternion.y,
      z: held.quaternion.z,
    });
  }

  release(): void {
    const { held } = this;
    if (!held) {
      return;
    }
    this.held = null;

    const body = this.bodies.get(held.brickId);
    if (!body) {
      return;
    }
    body.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
    body.enableCcd(false);
    this.throwBody(body, held.velocity);
  }

  /**
   * Hand a body the speed it was let go at.
   *
   * Capped, because a pointer that jumps across the screen in one frame reports
   * a speed no arm could produce, and a brick that leaves at that speed is gone.
   */
  private throwBody(body: RigidBody, velocity: Vector3): void {
    this.scratch.copy(velocity).multiplyScalar(THROW_SCALE);
    if (this.scratch.length() > MAX_THROW_SPEED) {
      this.scratch.setLength(MAX_THROW_SPEED);
    }
    body.setLinvel(this.scratch, true);
    body.setAngvel(
      {
        x: this.scratch.z * THROW_SPIN,
        y: 0,
        z: -this.scratch.x * THROW_SPIN,
      },
      true
    );
  }

  step(dt: number): void {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.world.step();
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    // Never try to catch up on a long stall; a backlog only makes the next
    // frame longer still.
    if (steps === MAX_SUBSTEPS) {
      this.accumulator = 0;
    }

    this.frames += 1;
    if (this.frames % STRAY_CHECK_FRAMES === 0) {
      this.recoverStrays();
    }
  }

  sync(bricks: Brick[]): void {
    for (const [id, body] of this.bodies) {
      const brick = bricks[id];
      if (!brick) {
        continue;
      }
      // The held brick is posed from the hand rather than the body. They agree
      // to within a step, but the hand is what the pointer is actually on and
      // reading it back avoids a frame of lag on the thing being looked at.
      if (this.held?.brickId === id) {
        brick.object.position.copy(this.held.position);
        brick.object.quaternion.copy(this.held.quaternion);
        continue;
      }
      const t = body.translation();
      const r = body.rotation();
      brick.object.position.set(t.x, t.y, t.z);
      brick.object.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  snapshot(): number[] {
    const out: number[] = [];
    for (const [id, body] of this.bodies) {
      const t =
        this.held?.brickId === id ? this.held.position : body.translation();
      const r =
        this.held?.brickId === id ? this.held.quaternion : body.rotation();
      out.push(id, t.x, t.y, t.z, r.x, r.y, r.z, r.w);
    }
    return out;
  }

  /**
   * A brick thrown hard enough leaves the table, and a piece you cannot reach
   * is a piece the build cannot be finished without. Strays are dropped back
   * over the pile rather than deleted.
   */
  private recoverStrays(): void {
    const limit = this.unit * STRAY_FACTOR;
    const floor = this.floorY - this.unit;

    for (const [, body] of this.bodies) {
      const t = body.translation();
      const dx = t.x - this.centre.x;
      const dz = t.z - this.centre.z;
      if (Math.hypot(dx, dz) <= limit && t.y >= floor) {
        continue;
      }
      const angle = Math.atan2(dz, dx);
      const radius = this.unit * 0.5;
      body.setTranslation(
        {
          x: this.centre.x + Math.cos(angle) * radius,
          y: this.floorY + this.unit * 0.6,
          z: this.centre.z + Math.sin(angle) * radius,
        },
        true
      );
      body.setLinvel(ZERO, true);
      body.setAngvel(ZERO, true);
    }
  }

  settleNow(steps: number): void {
    for (let i = 0; i < steps; i += 1) {
      this.world.step();
    }
  }

  /**
   * Hand a body from one brick record to another.
   *
   * Placing a brick swaps the dragged object onto the slot's record, so the
   * bodies have to follow or the physics and the scene graph disagree about
   * which brick is which.
   */
  swapBodies(a: number, b: number): void {
    const bodyA = this.bodies.get(a);
    const bodyB = this.bodies.get(b);
    if (bodyA) {
      this.bodies.set(b, bodyA);
    } else {
      this.bodies.delete(b);
    }
    if (bodyB) {
      this.bodies.set(a, bodyB);
    } else {
      this.bodies.delete(a);
    }
    if (this.held?.brickId === a) {
      this.held.brickId = b;
    } else if (this.held?.brickId === b) {
      this.held.brickId = a;
    }
  }

  clearLoose(): void {
    this.held = null;
    for (const [, body] of this.bodies) {
      this.world.removeRigidBody(body);
    }
    this.bodies.clear();
  }

  dispose(): void {
    this.held = null;
    this.bodies.clear();
    this.statics.clear();
    this.world.free();
  }
}

const ZERO = { x: 0, y: 0, z: 0 } as const;
