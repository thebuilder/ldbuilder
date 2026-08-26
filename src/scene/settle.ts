import { Quaternion, Vector3 } from "three";
import type { BagInfo, Brick } from "@/ldraw/types";
import { hashString, makeRandom } from "@/lib/random";
import {
  BRICK_DENSITY,
  BRICK_FRICTION,
  BRICK_RESTITUTION,
  getPhysics,
  gravityFor,
} from "./physics";

/**
 * Rigid-body simulation of a bag being tipped onto the floor.
 *
 * The simulation is baked, not live. It runs once when a bag opens, records the
 * transform of every brick on every step, and the recording is played back
 * during the pour. That buys three things a live simulation would not:
 *
 *   - the same seed always produces the same pile,
 *   - the resting poses are known before the animation starts, which is what
 *     the camera framing and the scrubber both need,
 *   - playback is an array lookup, so a settled bag costs nothing per frame.
 *
 * Measured on a 110-brick bag: 64ms to settle, which fits inside the load
 * screen. Recording is roughly 500KB per bag, and only the open bag is kept.
 */

/** Floats per brick per frame: position (3) plus quaternion (4). */
const STRIDE = 7;

const STEP_HZ = 60;
const MAX_STEPS = 180;

export interface SettleRecording {
  /** frames x bricks x STRIDE, in bag order. */
  data: Float32Array;
  /** Seconds of wall-clock the recording represents. */
  duration: number;
  frames: number;
  /** Bag-order brick ids, so playback can find a brick's slot. */
  order: number[];
  slotOf: Map<number, number>;
}

/**
 * Drop a bag and record where everything ends up.
 *
 * Bricks are released above the layout position the spiral picked for them, so
 * the pile lands roughly where the camera was already framed, but they collide
 * on the way down and settle on top of each other rather than into slots.
 */
export function simulateBag(
  bag: BagInfo,
  bricks: Brick[],
  floorY: number,
  dropHeight: number,
  seed: string
): SettleRecording | null {
  const RAPIER = getPhysics();
  if (!RAPIER) {
    console.warn("[ldraw] settle: physics module not ready");
    return null;
  }

  const members = bag.brickIds
    .map((id) => bricks[id])
    .filter(
      (brick): brick is Brick => brick !== undefined && brick.halfExtents.x > 0
    );

  if (members.length === 0) {
    console.warn(
      `[ldraw] settle: no usable colliders in bag ${bag.index} of ${bag.brickIds.length} bricks`,
      bricks[bag.brickIds[0]]?.halfExtents
    );
    return null;
  }

  const random = makeRandom(hashString(`${seed}:settle${bag.index}`));

  const gravity = gravityFor(dropHeight);

  const world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
  world.timestep = 1 / STEP_HZ;

  // Rapier's internal thresholds assume a world measured in metres. LDraw units
  // are 0.4mm, so a brick is 40 units across and the solver quietly clamps its
  // velocity: bricks accelerate for a dozen frames and then fall at a constant
  // speed. Telling it how big a metre is here restores a real parabola.
  world.lengthUnit = dropHeight;

  const groundThickness = Math.max(dropHeight * 0.05, 10);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(dropHeight * 8, groundThickness, dropHeight * 8)
      .setTranslation(0, floorY - groundThickness, 0)
      .setRestitution(BRICK_RESTITUTION)
      .setFriction(1.2)
  );

  const bodies = members.map((brick) => {
    // Release above the spot the spiral chose, spread over a range of heights
    // so bricks arrive over a few tenths of a second rather than in one slab.
    // The spread is kept narrow: a wide one drags the tail of the animation out
    // waiting for the last brick to come down.
    const lift = dropHeight * (0.5 + random() * 0.5);
    const spread = Math.max(brick.radius, 8) * 1.5;
    const start = new Vector3(
      brick.floorPose.position.x + (random() - 0.5) * spread,
      floorY + lift,
      brick.floorPose.position.z + (random() - 0.5) * spread
    );
    const tilt = new Quaternion().setFromAxisAngle(
      new Vector3(
        random() * 2 - 1,
        random() * 2 - 1,
        random() * 2 - 1
      ).normalize(),
      random() * Math.PI
    );

    // The collider is centred on the brick's bounding box, which is not where
    // its origin sits: LDraw puts a brick's origin on its top face.
    const offset = brick.localCenter.clone().applyQuaternion(tilt);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          start.x + offset.x,
          start.y + offset.y,
          start.z + offset.z
        )
        .setRotation({ w: tilt.w, x: tilt.x, y: tilt.y, z: tilt.z })
        .setLinvel(
          (random() - 0.5) * dropHeight * 0.2,
          0,
          (random() - 0.5) * dropHeight * 0.2
        )
        .setAngvel({
          x: (random() - 0.5) * 6,
          y: (random() - 0.5) * 6,
          z: (random() - 0.5) * 6,
        })
        // No linear damping: it is drag, and drag is the one thing that would
        // stop a falling brick from accelerating. Angular damping stays, so
        // bricks stop spinning once they are down instead of pirouetting.
        .setLinearDamping(0)
        .setAngularDamping(0.6)
    );

    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        brick.halfExtents.x,
        brick.halfExtents.y,
        brick.halfExtents.z
      )
        .setRestitution(BRICK_RESTITUTION)
        .setFriction(BRICK_FRICTION)
        .setDensity(BRICK_DENSITY),
      body
    );

    return body;
  });

  const data = new Float32Array(MAX_STEPS * members.length * STRIDE);
  const centre = new Vector3();
  const rotation = new Quaternion();

  let frames = 0;
  let stillCount = 0;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    world.step();

    let moving = 0;
    for (let i = 0; i < bodies.length; i += 1) {
      const body = bodies[i];
      const t = body.translation();
      const r = body.rotation();

      rotation.set(r.x, r.y, r.z, r.w);
      // Back out the collider offset to get the brick's own origin again.
      centre.copy(members[i].localCenter).applyQuaternion(rotation);

      const base = (step * bodies.length + i) * STRIDE;
      data[base] = t.x - centre.x;
      data[base + 1] = t.y - centre.y;
      data[base + 2] = t.z - centre.z;
      data[base + 3] = rotation.x;
      data[base + 4] = rotation.y;
      data[base + 5] = rotation.z;
      data[base + 6] = rotation.w;

      const v = body.linvel();
      if (Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) > dropHeight * 0.05) {
        moving += 1;
      }
    }

    frames = step + 1;
    // Stop once everything has been still for a moment, so a bag that settles
    // early does not pad the animation with a second of nothing happening.
    stillCount = moving === 0 ? stillCount + 1 : 0;
    if (stillCount >= 6) {
      break;
    }
  }

  world.free();

  // Physics keeps solving long after there is anything to look at: bricks creep
  // and jitter by fractions of a unit for another second. Those frames still
  // cost playback time, so the recording is cut back to the last frame where
  // something moved far enough to see, plus a few to land on.
  frames = trimTail(data, frames, members.length, dropHeight * 0.012);

  const order = members.map((brick) => brick.id);
  const slotOf = new Map<number, number>();
  for (const [index, id] of order.entries()) {
    slotOf.set(id, index);
  }

  return {
    data: data.subarray(0, frames * members.length * STRIDE),
    duration: frames / STEP_HZ,
    frames,
    order,
    slotOf,
  };
}

/**
 * Find the last frame with visible motion and cut everything after it.
 * Returns the new frame count.
 */
function trimTail(
  data: Float32Array,
  frames: number,
  count: number,
  epsilon: number
): number {
  const squared = epsilon * epsilon;

  for (let frame = frames - 1; frame > 1; frame -= 1) {
    const current = frame * count * STRIDE;
    const previous = (frame - 1) * count * STRIDE;

    for (let i = 0; i < count; i += 1) {
      const a = current + i * STRIDE;
      const b = previous + i * STRIDE;
      const dx = data[a] - data[b];
      const dy = data[a + 1] - data[b + 1];
      const dz = data[a + 2] - data[b + 2];
      if (dx * dx + dy * dy + dz * dz > squared) {
        // Keep a short run-out so the pile does not stop dead on impact.
        return Math.min(frames, frame + 4);
      }
    }
  }
  return frames;
}

/** Copy the recording's last frame into each brick's resting pose. */
export function applyRestingPoses(
  recording: SettleRecording,
  bricks: Brick[]
): void {
  const count = recording.order.length;
  const base = (recording.frames - 1) * count * STRIDE;

  for (let i = 0; i < count; i += 1) {
    const brick = bricks[recording.order[i]];
    if (!brick) {
      continue;
    }
    const offset = base + i * STRIDE;
    brick.floorPose.position.set(
      recording.data[offset],
      recording.data[offset + 1],
      recording.data[offset + 2]
    );
    brick.floorPose.quaternion.set(
      recording.data[offset + 3],
      recording.data[offset + 4],
      recording.data[offset + 5],
      recording.data[offset + 6]
    );
  }
}

/** Read one brick's pose at a fractional frame, interpolating between steps. */
export function sampleRecording(
  recording: SettleRecording,
  slot: number,
  frame: number,
  position: Vector3,
  quaternion: Quaternion,
  scratch: Quaternion
): void {
  const count = recording.order.length;
  const last = recording.frames - 1;
  const clamped = Math.min(Math.max(frame, 0), last);
  const lower = Math.floor(clamped);
  const upper = Math.min(lower + 1, last);
  const mix = clamped - lower;

  const a = (lower * count + slot) * STRIDE;
  const b = (upper * count + slot) * STRIDE;
  const d = recording.data;

  position.set(
    d[a] + (d[b] - d[a]) * mix,
    d[a + 1] + (d[b + 1] - d[a + 1]) * mix,
    d[a + 2] + (d[b + 2] - d[a + 2]) * mix
  );

  quaternion.set(d[a + 3], d[a + 4], d[a + 5], d[a + 6]);
  if (mix > 0) {
    scratch.set(d[b + 3], d[b + 4], d[b + 5], d[b + 6]);
    quaternion.slerp(scratch, mix);
  }
}
