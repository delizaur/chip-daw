import { clamp, fromNormalized, quantize, toNormalized, type Scale } from '../../model/scale';

export { clamp, fromNormalized, quantize, toNormalized, type Scale };

export interface RangeOptions {
  min: number;
  max: number;
  step?: number;
  scale?: Scale;
}

/** Converts a 0..1 position to a value in range, snapped to `step`. */
export function valueAt(n: number, { min, max, step, scale }: RangeOptions): number {
  return clamp(quantize(fromNormalized(n, min, max, scale), step, min), min, max);
}

/**
 * Keyboard stepping for range controls. Returns the new value, or null if the key isn't handled.
 * Arrows move 1% (0.1% with Shift) or one step; PageUp/PageDown move 10%; Home/End jump to the ends.
 */
export function valueForKey(key: string, shift: boolean, value: number, range: RangeOptions) {
  const n = toNormalized(value, range.min, range.max, range.scale);
  const small = range.step ? null : shift ? 0.001 : 0.01;
  const nudge = (direction: 1 | -1) =>
    small === null
      ? clamp(value + direction * range.step!, range.min, range.max)
      : valueAt(n + direction * small, range);
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return nudge(1);
    case 'ArrowDown':
    case 'ArrowLeft':
      return nudge(-1);
    case 'PageUp':
      return valueAt(n + 0.1, range);
    case 'PageDown':
      return valueAt(n - 0.1, range);
    case 'Home':
      return range.min;
    case 'End':
      return range.max;
    default:
      return null;
  }
}
