// biome-ignore-all lint/suspicious/noBitwiseOperators: a PRNG and a hash are
// defined by their bit mixing. Rewriting these without shifts and XOR would
// produce different numbers, and the whole point of both is that they produce
// the same numbers every time.

/**
 * Mulberry32. Seeded so a given model always scatters and settles identically,
 * which is what lets the physics simulation be baked and the camera framed from
 * the result before any of it is shown.
 */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** FNV-1a, for turning a model slug into a seed. */
export function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
