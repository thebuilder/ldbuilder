import type { Vector3 } from "three";
import type { Brick, ModelData } from "@/ldraw/types";

/**
 * The rules of build mode, with no rendering and no physics in them.
 *
 * A build is one number and one bit array: how many steps are finished, and
 * which slots have been filled. Everything else the UI shows is derived from
 * those, which is also why a save file is so small.
 *
 * The one idea worth stating outright is that slots are matched by *part*, not
 * by identity. A bag of a hundred bricks holds eight identical 1x2 plates, and
 * insisting on one particular plate would be a puzzle about nothing. So any
 * brick with the same part and colour fills the slot, and `place` swaps the two
 * records so the brick that was dragged is the one that ends up in the model.
 */
export class BuildSession {
  readonly model: ModelData;
  /** 1 once a slot has been filled. Indexed by brick id. */
  readonly placed: Uint8Array;

  step = 0;
  placedCount = 0;
  /** The last brick to go in, and when, so it can flash as it lands. */
  lastPlacedId = -1;
  lastPlacedAt = 0;

  private pending: number[] = [];
  private readonly keys: string[];

  constructor(model: ModelData) {
    this.model = model;
    this.placed = new Uint8Array(model.bricks.length);
    this.keys = model.bricks.map(
      (brick) => `${brick.partFile.toLowerCase()}|${brick.colorCode}`
    );
    this.refresh();
  }

  get totalSteps(): number {
    return this.model.steps.length;
  }

  get done(): boolean {
    return this.step >= this.totalSteps;
  }

  get bag(): number {
    const working = Math.min(this.step, Math.max(this.totalSteps - 1, 0));
    return this.model.steps[working]?.bag ?? 0;
  }

  /** Slots of the current step that are still empty. */
  get pendingSlots(): number[] {
    return this.pending;
  }

  keyOf(brickId: number): string {
    return this.keys[brickId] ?? "";
  }

  /** A brick is loose if its bag is open and it has not been used as a slot. */
  isLoose(brickId: number): boolean {
    const brick = this.model.bricks[brickId];
    if (!brick) {
      return false;
    }
    return brick.bag === this.bag && this.placed[brickId] === 0;
  }

  looseIds(): number[] {
    const bag = this.model.bags[this.bag];
    if (!bag) {
      return [];
    }
    return bag.brickIds.filter((id) => this.placed[id] === 0);
  }

  /**
   * The slot this brick would drop into, or null.
   *
   * `centre` is the middle of the carried brick, and what it is measured
   * against is the middle of the slot. Neither is the part's origin, which
   * LDraw puts on the stud face: a brick picked up upside down out of the pile
   * has its origin a whole brick away from where the brick appears to be, so
   * aiming by origins means lining up something you cannot see and overshooting
   * the thing you can.
   *
   * Nearest wins, so two adjacent slots taking the same part do not fight over
   * a brick hovering between them.
   */
  findSlot(brickId: number, centre: Vector3, radius: number): number | null {
    const key = this.keyOf(brickId);
    let best: number | null = null;
    let bestDistance = radius * radius;

    for (const slotId of this.pending) {
      if (this.keys[slotId] !== key) {
        continue;
      }
      const distance = centre.distanceToSquared(
        this.model.bricks[slotId].center
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = slotId;
      }
    }
    return best;
  }

  /** Every pending slot this brick could fill, for highlighting the targets. */
  slotsFor(brickId: number): number[] {
    const key = this.keyOf(brickId);
    return this.pending.filter((slotId) => this.keys[slotId] === key);
  }

  /**
   * Fill a slot. The caller has already swapped the dragged brick's object onto
   * this record, so the brick that lands is the one that was carried.
   */
  place(slotId: number, now: number): void {
    if (this.placed[slotId] === 1) {
      return;
    }
    this.placed[slotId] = 1;
    this.placedCount += 1;
    this.lastPlacedId = slotId;
    this.lastPlacedAt = now;
    this.refresh();
  }

  /** True when the step just finished, so the caller can react to a new bag. */
  advanceIfComplete(): boolean {
    if (this.done || this.pending.length > 0) {
      return false;
    }
    this.step += 1;
    this.refresh();
    return true;
  }

  /** Reinstate a saved build. Slot ids that no longer exist are ignored. */
  restore(step: number, placedIds: number[]): void {
    this.placed.fill(0);
    this.placedCount = 0;
    for (const id of placedIds) {
      if (id >= 0 && id < this.placed.length && this.placed[id] === 0) {
        this.placed[id] = 1;
        this.placedCount += 1;
      }
    }
    this.step = Math.min(Math.max(step, 0), this.totalSteps);

    // Everything in an earlier bag is in the model by definition: a bag cannot
    // be left until every slot in it is filled. Deriving that here rather than
    // trusting the save keeps a truncated one from stranding bricks between the
    // floor, where they are no longer loose, and the model, where they are not
    // yet placed.
    const { bag } = this;
    for (const brick of this.model.bricks) {
      if (brick.bag < bag && this.placed[brick.id] === 0) {
        this.placed[brick.id] = 1;
        this.placedCount += 1;
      }
    }

    this.refresh();
  }

  placedIds(): number[] {
    const out: number[] = [];
    for (let id = 0; id < this.placed.length; id += 1) {
      if (this.placed[id] === 1) {
        out.push(id);
      }
    }
    return out;
  }

  /**
   * Recompute the open slots.
   *
   * A brick with no geometry has no collider and so can never be picked up.
   * There are a handful in incompletely packed models, and one of them sitting
   * in a step would stall the build for good, so they place themselves.
   */
  private refresh(): void {
    if (this.done) {
      this.pending = [];
      return;
    }
    const ids = this.model.steps[this.step]?.brickIds ?? [];
    const open: number[] = [];
    for (const id of ids) {
      if (this.placed[id] === 1) {
        continue;
      }
      if (!hasCollider(this.model.bricks[id])) {
        this.placed[id] = 1;
        this.placedCount += 1;
        continue;
      }
      open.push(id);
    }
    this.pending = open;
  }
}

function hasCollider(brick: Brick | undefined): boolean {
  return brick !== undefined && brick.halfExtents.x > 0;
}
