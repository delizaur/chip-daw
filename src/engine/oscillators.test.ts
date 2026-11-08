import { describe, expect, it } from 'vitest';
import { noteFrequency, pulse, steppedTriangle, stepLfsr } from './oscillators';

describe('oscillators', () => {
  it('maps MIDI notes to frequencies', () => {
    expect(noteFrequency(69)).toBe(440);
    expect(noteFrequency(81)).toBeCloseTo(880);
    expect(noteFrequency(60)).toBeCloseTo(261.626, 2);
  });

  it('pulse waves have no DC offset at any duty cycle', () => {
    for (const duty of [0.125, 0.25, 0.5]) {
      const n = 4800;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += pulse((i / 100) % 1, 0.01, duty);
      expect(Math.abs(sum / n)).toBeLessThan(0.01);
    }
  });

  it('pulse stays bounded with band-limiting', () => {
    for (let i = 0; i < 1000; i++) {
      const v = pulse((i * 0.037) % 1, 0.037, 0.125);
      expect(Math.abs(v)).toBeLessThanOrEqual(2);
    }
  });

  it('triangle has 16 levels spanning -1..1', () => {
    const levels = new Set<number>();
    for (let i = 0; i < 32; i++) levels.add(steppedTriangle(i / 32 + 0.001));
    expect(levels.size).toBe(16);
    expect(Math.min(...levels)).toBe(-1);
    expect(Math.max(...levels)).toBe(1);
  });

  it('metallic LFSR mode repeats every 93 steps; long mode does not', () => {
    const period = (tap: number) => {
      let r = 1;
      for (let i = 0; i < 200; i++) r = stepLfsr(r, tap); // settle into the cycle
      const start = r;
      for (let i = 1; i <= 40000; i++) {
        r = stepLfsr(r, tap);
        if (r === start) return i;
      }
      return Infinity;
    };
    expect(period(6)).toBe(93);
    expect(period(1)).toBe(32767);
  });
});
