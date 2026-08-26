import { Color, type Material, type MeshStandardMaterial } from "three";

export type RenderState = "normal" | "ghost" | "highlight" | "dim";

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
      const standard = variant as MeshStandardMaterial;
      if (standard.isMeshStandardMaterial) {
        // Matches --color-accent-fg. Emissive adds light rather than replacing
        // the brick's own colour, so a selected blue brick still stands out.
        standard.emissive = new Color(0x6f_b2_f5);
        standard.emissiveIntensity = 0.7;
      }
    } else {
      variant.opacity = OPACITY[state] ?? 0.5;
      variant.depthWrite = false;
    }

    cache.set(source, variant);
    this.owned.push(variant);
    return variant;
  }

  dispose(): void {
    for (const material of this.owned) {
      material.dispose();
    }
    this.owned.length = 0;
    this.caches.clear();
  }
}
