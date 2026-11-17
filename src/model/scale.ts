/**
 * Value scales shared by the UI (knobs, sliders) and the engine (automation ramps): values map
 * to 0..1 linearly or exponentially (`exp`, e.g. frequencies).
 */
export type Scale = 'linear' | 'exp';

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Maps a value in [min, max] to 0..1. `exp` scale needs min > 0 (e.g. frequencies). */
export function toNormalized(value: number, min: number, max: number, scale: Scale = 'linear') {
  if (max === min) return 0;
  const v = clamp(value, min, max);
  if (scale === 'exp') return Math.log(v / min) / Math.log(max / min);
  return (v - min) / (max - min);
}

/** Inverse of toNormalized. */
export function fromNormalized(n: number, min: number, max: number, scale: Scale = 'linear') {
  const t = clamp(n, 0, 1);
  if (scale === 'exp') return min * Math.pow(max / min, t);
  return min + t * (max - min);
}

/** Snaps a value to multiples of `step` counted from `min`. */
export function quantize(value: number, step: number | undefined, min: number) {
  if (!step) return value;
  return min + Math.round((value - min) / step) * step;
}
