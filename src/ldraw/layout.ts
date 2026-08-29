import { type Box3, Quaternion, Vector3 } from "three";
import { hashString, makeRandom } from "@/lib/random";
import type { BagInfo, Brick } from "./types";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const FLOOR_MARGIN = 34;

const SPACING_FACTOR = 1.25;

const SECTOR_ARC = Math.PI * 0.85;
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

  const ordered = [...bag.brickIds]
    .map((id) => bricks[id])
    .filter((brick): brick is Brick => brick !== undefined)
    .sort((a, b) => a.step - b.step || a.id - b.id);

  if (ordered.length === 0) {
    return;
  }

  const meanRadius =
    ordered.reduce((sum, brick) => sum + Math.max(brick.radius, 4), 0) /
    ordered.length;
  const spacing = meanRadius * 2 * SPACING_FACTOR;

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

  const growth =
    (spacing / Math.sqrt(Math.PI)) * Math.sqrt((Math.PI * 2) / arc);
  const axis = new Vector3(0, 1, 0);

  for (let i = 0; i < ordered.length; i += 1) {
    const brick = ordered[i];

    const radius = Math.sqrt(
      footprint * footprint + growth * growth * (i + 0.5)
    );
    const spread = ((i + 1) * GOLDEN_ANGLE) % arc;
    const angle = baseAngle - arc / 2 + spread;

    const jitter = 0.94 + random() * 0.12;
    const x = center.x + Math.cos(angle) * radius * jitter;
    const z = center.z + Math.sin(angle) * radius * jitter;

    const yaw = random() * Math.PI * 2;
    const quaternion = new Quaternion().setFromAxisAngle(axis, yaw);
    const restingY = floorY + (brick.builtPose.position.y - brick.minY);

    brick.floorPose.position.set(x, restingY, z);
    brick.floorPose.quaternion
      .copy(quaternion)
      .multiply(brick.builtPose.quaternion);
    brick.floorPose.scale.copy(brick.builtPose.scale);

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
