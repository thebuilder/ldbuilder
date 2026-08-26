import type { Material, Mesh, Object3D } from "three";
import type { Brick } from "@/ldraw/types";
import { MaterialVariants } from "./materials";
import { isLineSegments, isMesh } from "./three-guards";

/**
 * The empty slots of the step being built, drawn where the bricks will go.
 *
 * A slot is a clone of the brick that belongs in it. `Object3D.clone` shares
 * geometry and materials, so a clone is a handful of nodes rather than a
 * duplicated mesh, and only the current step is ever cloned: a step is a
 * handful of bricks even in a set with eight hundred of them.
 *
 * Showing the actual part, rather than a generic marker, is the whole point.
 * Shape and colour together are what let you go and find the piece, which is
 * the thing build mode is asking you to do.
 */

/** Seconds for one breath of the pending slots. */
const PULSE_PERIOD = 2.4;
const PULSE_DEPTH = 0.3;

export class SlotGhosts {
  private readonly parent: Object3D;
  private readonly variants = new MaterialVariants();
  private readonly ghosts = new Map<number, Object3D>();
  private readonly sources = new Map<Object3D, Material | Material[]>();
  private targets: number[] = [];
  private elapsed = 0;

  constructor(parent: Object3D) {
    this.parent = parent;
  }

  /**
   * Show exactly these slots. Called whenever a brick goes in or the step
   * changes, so it diffs rather than rebuilding.
   */
  set(slotIds: number[], bricks: Brick[]): void {
    for (const [id, ghost] of this.ghosts) {
      if (!slotIds.includes(id)) {
        this.remove(id, ghost);
      }
    }
    for (const id of slotIds) {
      if (this.ghosts.has(id)) {
        continue;
      }
      const brick = bricks[id];
      if (brick) {
        this.add(id, brick);
      }
    }
  }

  /**
   * Light up the slots the brick in hand could fill.
   *
   * Without this you can be carrying the right piece and have no idea where it
   * goes; with it the model says so the moment you pick one up.
   */
  setTargets(slotIds: number[]): void {
    if (sameIds(this.targets, slotIds)) {
      return;
    }
    this.targets = [...slotIds];
    for (const [id, ghost] of this.ghosts) {
      this.paint(ghost, slotIds.includes(id) ? "target" : "slot");
    }
  }

  update(dt: number): void {
    if (this.ghosts.size === 0) {
      return;
    }
    this.elapsed += dt;
    const phase = (this.elapsed / PULSE_PERIOD) * Math.PI * 2;
    this.variants.setSlotGlow(1 + Math.sin(phase) * PULSE_DEPTH);
  }

  clear(): void {
    for (const [id, ghost] of this.ghosts) {
      this.remove(id, ghost);
    }
    this.targets = [];
  }

  dispose(): void {
    this.clear();
    this.variants.dispose();
  }

  private add(id: number, brick: Brick): void {
    const ghost = brick.object.clone(true);
    ghost.position.copy(brick.builtPose.position);
    ghost.quaternion.copy(brick.builtPose.quaternion);
    ghost.scale.copy(brick.builtPose.scale);

    ghost.traverse((child) => {
      // A slot is not a thing that exists, so it neither casts a shadow nor
      // catches one. Either would read as a brick already in place.
      child.castShadow = false;
      child.receiveShadow = false;
      if (isMesh(child) || isLineSegments(child)) {
        this.sources.set(child, (child as Mesh).material);
      }
    });

    this.paint(ghost, this.targets.includes(id) ? "target" : "slot");
    this.parent.add(ghost);
    this.ghosts.set(id, ghost);
  }

  private remove(id: number, ghost: Object3D): void {
    ghost.removeFromParent();
    ghost.traverse((child) => this.sources.delete(child));
    this.ghosts.delete(id);
  }

  private paint(ghost: Object3D, state: "slot" | "target"): void {
    ghost.traverse((child) => {
      const original = this.sources.get(child);
      if (!original) {
        return;
      }
      const mesh = child as Mesh;
      mesh.material = Array.isArray(original)
        ? original.map((item) => this.variants.get(item, state))
        : this.variants.get(original, state);
    });
  }
}

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}
