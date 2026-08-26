export const clamp01 = (value: number): number =>
  Math.min(Math.max(value, 0), 1);

/** Classic four-segment bounce, used so poured bricks land rather than glide. */
export function easeOutBounce(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) {
    return n * t * t;
  }
  if (t < 2 / d) {
    const u = t - 1.5 / d;
    return n * u * u + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d;
    return n * u * u + 0.9375;
  }
  const u = t - 2.625 / d;
  return n * u * u + 0.984_375;
}

/**
 * A small overshoot before settling. A flat ease puts the brick exactly where
 * it belongs and stops; the overshoot pushes past by a few percent and comes
 * back, which is what pressing a brick down actually looks like.
 */
export function easeOutBackSoft(t: number): number {
  const c = 1.15;
  const u = t - 1;
  return 1 + (c + 1) * u ** 3 + c * u ** 2;
}

/**
 * Spread `count` items across a 0-1 timeline so they animate in sequence but
 * overlap. `window` is the fraction of the timeline each item gets.
 */
export function staggered(
  t: number,
  index: number,
  count: number,
  window = 0.55
): number {
  if (count <= 1) {
    return clamp01(t);
  }
  const start = (index / (count - 1)) * (1 - window);
  return clamp01((t - start) / window);
}

/** Smooth follow that is frame-rate independent, unlike a raw lerp per frame. */
export function damp(
  current: number,
  target: number,
  lambda: number,
  dt: number
): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}
