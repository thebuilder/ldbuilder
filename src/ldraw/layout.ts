import { type Box3, Quaternion, Vector3 } from "three";
import { hashString, makeRandom } from "@/lib/random";
import type { BagInfo, Brick } from "./types";

/** Golden angle, for spreading points over a disc without visible banding. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Gap between the model footprint and the innermost ring of loose bricks, in LDU. */
const FLOOR_MARGIN = 34;

/** Multiplier on a brick's own size when spacing it from its neighbours. */
const SPACING_FACTOR = 1.25;

/** Angular width of the patch a bag is tipped out into, when there are several. */
const SECTOR_ARC = Math.PI * 0.85;

/**
 * Lay every brick of a bag out on the floor around the model.
 *
 * Bricks are placed per bag rather than per model: only one bag is ever loose
 * at a time, so each bag gets the whole floor and small bags do not end up
 * scattered to the far edges of a footprint sized for the largest one.
 *
 * Placement walks a golden-angle spiral outward, advancing by each brick's own
 * radius, so large pieces claim more floor than small ones and overlap stays
 * rare without needing collision resolution.
 */
function layoutBagOnFloor(
  bag: BagInfo,
  bricks: Brick[],
  bounds: Box3,
  seed: string,
  bagCount: number
): void {
  const random = makeRandom(hashString(`${seed}:bag${bag.index}`));

  const size = new Vector3();
  bounds.getSize(size);
  const center = new Vector3();
  bounds.getCenter(center);

  const footprint = Math.max(size.x, size.z) * 0.5 + FLOOR_MARGIN;
  const floorY = bounds.min.y;

  // Earliest-needed bricks land closest to the model, so the parts you reach
  // for first are the ones nearest to hand.
  const ordered = [...bag.brickIds]
    .map((id) => bricks[id])
    .filter((brick): brick is Brick => brick !== undefined)
    .sort((a, b) => a.step - b.step || a.id - b.id);

  if (ordered.length === 0) {
    return;
  }

  // Mean footprint of a brick in this bag, used as the target spacing. Sizing
  // the spiral from the actual parts keeps a bag of tiny plates from being
  // flung as far as a bag of large panels.
  const meanRadius =
    ordered.reduce((sum, brick) => sum + Math.max(brick.radius, 4), 0) /
    ordered.length;
  const spacing = meanRadius * 2 * SPACING_FACTOR;

  // Which way this bag's bricks are headed. On a multi-bag build the bag is
  // tipped out on the side of the model it actually builds, rather than ringed
  // around a footprint most of which does not exist yet. A single-bag model
  // gets the full ring, which reads better when the whole model is in view.
  const heading = new Vector3();
  for (const brick of ordered) {
    heading.add(brick.builtPose.position);
  }
  heading.divideScalar(ordered.length).sub(center);
  heading.y = 0;

  const baseAngle =
    heading.lengthSq() < 1e-6
      ? random() * Math.PI * 2
      : Math.atan2(heading.z, heading.x);
  const arc = bagCount <= 1 ? Math.PI * 2 : SECTOR_ARC;

  // Vogel spiral, confined to the sector. Radius grows with the square root of
  // the index, which keeps density constant: a linear spiral piles bricks up
  // near the middle and flings the last ones so far that the model is a speck.
  // The sector is narrower than a full circle, so density is scaled to match.
  const growth =
    (spacing / Math.sqrt(Math.PI)) * Math.sqrt((Math.PI * 2) / arc);
  const axis = new Vector3(0, 1, 0);

  for (let i = 0; i < ordered.length; i += 1) {
    const brick = ordered[i];

    const radius = Math.sqrt(
      footprint * footprint + growth * growth * (i + 0.5)
    );
    // Golden-angle stepping wrapped into the sector keeps neighbours in the
    // build order from landing on top of each other.
    const spread = ((i + 1) * GOLDEN_ANGLE) % arc;
    const angle = baseAngle - arc / 2 + spread;

    const jitter = 0.94 + random() * 0.12;
    const x = center.x + Math.cos(angle) * radius * jitter;
    const z = center.z + Math.sin(angle) * radius * jitter;

    // Bricks lie where they fell: a seeded yaw, and dropped so the lowest point
    // of the brick rests on the floor rather than its origin.
    const yaw = random() * Math.PI * 2;
    const quaternion = new Quaternion().setFromAxisAngle(axis, yaw);
    const restingY = floorY + (brick.builtPose.position.y - brick.minY);

    brick.floorPose.position.set(x, restingY, z);
    brick.floorPose.quaternion
      .copy(quaternion)
      .multiply(brick.builtPose.quaternion);
    brick.floorPose.scale.copy(brick.builtPose.scale);

    // Entry parameters. Bricks are released outward from the middle of the
    // pile, so they arc in rather than dropping down a vertical shaft into the
    // exact hole they end up in.
    const throwOut = spacing * (0.8 + random() * 1.6);
    brick.drop.offsetX = Math.cos(angle) * throwOut;
    brick.drop.offsetZ = Math.sin(angle) * throwOut;
    brick.drop.spinAxis
      .set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
      .normalize();
    brick.drop.spin = 0.6 + random() * 1.8;
    brick.drop.heightScale = 0.8 + random() * 0.55;
  }
}

/** Lay out every bag. Cheap enough to do up front for models of any size. */
export function layoutAllBags(
  bags: BagInfo[],
  bricks: Brick[],
  bounds: Box3,
  seed: string
): void {
  for (const bag of bags) {
    layoutBagOnFloor(bag, bricks, bounds, seed, bags.length);
  }
}
