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

const OPACITY: Record<string, number> = {
  dim: 0.32,
  ghost: 0.14,
  slot: 0.26,
  target: 0.5,
};

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
