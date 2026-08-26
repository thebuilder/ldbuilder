import { Color, type Material, type MeshStandardMaterial } from "three";

export type RenderState =
  | "normal"
  | "ghost"
  | "highlight"
  | "dim"
  /** An empty slot waiting for a brick, drawn where the brick will go. */
  | "slot"
  /** The same, for a slot the brick currently in hand would fill. */
  | "target";

/*
  Chosen to work against both themes. A translucent brick recedes into black on
  the dark theme and into white on the light one, and the light case is the
  harsher of the two: colour washes out to pastel and the brick loses its shape.
  These sit high enough to keep that form and low enough to still read as
  pushed back.
*/
const OPACITY: Record<string, number> = {
  dim: 0.32,
  ghost: 0.14,
  /*
    Slots are read rather than looked past, so they sit above the ghost used for
    slicing. They still have to lose against a real brick behind them, which is
    what stops a pending slot from looking like a piece that is already in.
  */
  slot: 0.26,
  target: 0.5,
};

/** Matches --color-accent-fg, so a slot reads as the same blue as progress does. */
const ACCENT = 0x6f_b2_f5;

const EMISSIVE: Record<string, number> = {
  highlight: 0.7,
  slot: 0.35,
  target: 0.85,
};

/**
 * Cached material variants.
 *
 * Ghosting and highlighting need altered materials, but cloning per brick would
 * mean thousands of materials and as many shader programs. LDrawLoader already
 * shares one material per colour, so caching variants keyed on the source
 * material bounds the total at (colours x states).
 */
export class MaterialVariants {
  private readonly caches = new Map<RenderState, Map<Material, Material>>();
  private readonly owned: Material[] = [];
  /** Kept separately so the pending slots can breathe without a per-brick pass. */
  private readonly slotMaterials: MeshStandardMaterial[] = [];
  private readonly slotGlow = EMISSIVE.slot;

  get(source: Material, state: RenderState): Material {
    if (state === "normal") {
      return source;
    }

    let cache = this.caches.get(state);
    if (!cache) {
      cache = new Map();
      this.caches.set(state, cache);
    }

    const existing = cache.get(source);
    if (existing) {
      return existing;
    }

    const variant = source.clone();
    variant.transparent = true;

    if (state === "highlight") {
      variant.opacity = 1;
      variant.depthWrite = true;
    } else {
      variant.opacity = OPACITY[state] ?? 0.5;
      variant.depthWrite = false;
    }

    // Emissive adds light rather than replacing the brick's own colour, so a
    // selected blue brick still stands out and a slot still shows which part
    // belongs in it.
    const glow = EMISSIVE[state];
    const standard = variant as MeshStandardMaterial;
    if (glow !== undefined && standard.isMeshStandardMaterial) {
      standard.emissive = new Color(ACCENT);
      standard.emissiveIntensity = glow;
    }

    cache.set(source, variant);
    this.owned.push(variant);
    if (
      state === "slot" &&
      glow !== undefined &&
      standard.isMeshStandardMaterial
    ) {
      this.slotMaterials.push(standard);
    }
    return variant;
  }

  /**
   * Pulse the pending slots.
   *
   * A slot that simply sits there is easy to lose against the model behind it,
   * and a slow breath is the cheapest way to say "here" without adding an
   * outline pass. One write per colour in use, not per slot.
   */
  setSlotGlow(scale: number): void {
    for (const material of this.slotMaterials) {
      material.emissiveIntensity = this.slotGlow * scale;
    }
  }

  dispose(): void {
    for (const material of this.owned) {
      material.dispose();
    }
    this.owned.length = 0;
    this.slotMaterials.length = 0;
    this.caches.clear();
  }
}
