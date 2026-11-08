import { describe, expect, it } from 'vitest';
import { fromNormalized, quantize, toNormalized, valueForKey } from './scale';

describe('control scaling', () => {
  it('maps linear ranges both ways', () => {
    expect(toNormalized(5, 0, 10)).toBe(0.5);
    expect(fromNormalized(0.25, -1, 1)).toBe(-0.5);
  });

  it('maps exponential ranges so octaves are evenly spaced', () => {
    expect(toNormalized(220, 110, 440, 'exp')).toBeCloseTo(0.5);
    expect(fromNormalized(0.5, 110, 440, 'exp')).toBeCloseTo(220);
  });

  it('round-trips', () => {
    for (const n of [0, 0.1, 0.5, 0.9, 1]) {
      expect(toNormalized(fromNormalized(n, 20, 20000, 'exp'), 20, 20000, 'exp')).toBeCloseTo(n);
      expect(toNormalized(fromNormalized(n, -3, 7), -3, 7)).toBeCloseTo(n);
    }
  });

  it('clamps out-of-range input', () => {
    expect(toNormalized(50, 0, 10)).toBe(1);
    expect(fromNormalized(-1, 0, 10)).toBe(0);
  });

  it('handles empty ranges', () => {
    expect(toNormalized(3, 3, 3)).toBe(0);
  });

  it('steps values with the keyboard', () => {
    const range = { min: 0, max: 1 };
    expect(valueForKey('ArrowUp', false, 0.5, range)).toBeCloseTo(0.51);
    expect(valueForKey('ArrowLeft', true, 0.5, range)).toBeCloseTo(0.499);
    expect(valueForKey('PageDown', false, 0.05, range)).toBe(0);
    expect(valueForKey('End', false, 0.5, range)).toBe(1);
    expect(valueForKey('a', false, 0.5, range)).toBeNull();
  });

  it('steps stepped values one step at a time', () => {
    const range = { min: 0, max: 3, step: 1 };
    expect(valueForKey('ArrowUp', false, 1, range)).toBe(2);
    expect(valueForKey('ArrowUp', false, 3, range)).toBe(3);
  });

  it('quantizes to steps from the minimum', () => {
    expect(quantize(0.37, 0.25, 0)).toBe(0.25);
    expect(quantize(4.4, 2, 1)).toBe(5);
    expect(quantize(0.37, undefined, 0)).toBe(0.37);
  });
});
