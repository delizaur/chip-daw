import { describe, expect, it } from 'vitest';
import { SmoothedValue } from './dsp';

describe('SmoothedValue', () => {
  it('moves towards the target and lands on it exactly', () => {
    const v = new SmoothedValue(1, 48_000, 0.02);
    v.target = 0;
    expect(v.next()).toBeLessThan(1);
    for (let i = 0; i < 48_000; i++) v.next();
    expect(v.current).toBe(0);
  });
});
