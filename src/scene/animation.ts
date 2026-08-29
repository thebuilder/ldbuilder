export const clamp01 = (value: number): number =>
  Math.min(Math.max(value, 0), 1);

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

export function easeOutBackSoft(t: number): number {
  const c = 1.15;
  const u = t - 1;
  return 1 + (c + 1) * u ** 3 + c * u ** 2;
}

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

export function phase(t: number, from: number, to: number): number {
  return clamp01((t - from) / (to - from));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

export function damp(
  current: number,
  target: number,
  lambda: number,
  dt: number
): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}
