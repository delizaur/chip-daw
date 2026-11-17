import { describe, expect, it } from 'vitest';
import type { BoxInstance } from '../../model/types';
import { arpPattern, effectScreen, filterGain } from './effect-visuals';

const box = (type: string, params: Record<string, number> = {}): BoxInstance => ({
  id: 'b',
  type,
  params,
});

describe('filterGain', () => {
  it('passes lows and cuts highs (low-pass), the reverse for high-pass', () => {
    expect(filterGain(0, 1000, 0, 50)).toBeCloseTo(1, 1);
    expect(filterGain(0, 1000, 0, 10000)).toBeLessThan(0.05);
    expect(filterGain(1, 1000, 0, 50)).toBeLessThan(0.01);
    expect(filterGain(1, 1000, 0, 10000)).toBeCloseTo(1, 1);
  });

  it('band-pass peaks at the cutoff, and resonance raises the peak', () => {
    expect(filterGain(2, 1000, 0, 1000)).toBeCloseTo(1);
    expect(filterGain(0, 1000, 0.9, 1000)).toBeGreaterThan(filterGain(0, 1000, 0.1, 1000));
  });
});

describe('arpPattern', () => {
  it('goes up, down and up-down through the chord', () => {
    expect(arpPattern(0, 1, 3)).toEqual([0, 4 / 7, 1]);
    expect(arpPattern(1, 1, 3)).toEqual([1, 4 / 7, 0]);
    expect(arpPattern(2, 1, 4)).toEqual([0, 4 / 7, 1, 4 / 7]);
  });

  it('spans more octaves', () => {
    expect(Math.max(...arpPattern(0, 2, 6))).toBe(1);
    expect(arpPattern(0, 2, 6)[3]).toBeCloseTo(12 / 19);
  });
});

describe('effectScreen', () => {
  it('draws every effect and the arp, with points on the screen', () => {
    for (const type of ['fx.filter', 'fx.delay', 'fx.bitcrush', 'fx.reverb', 'seq.arp']) {
      const screen = effectScreen(box(type))!;
      expect(screen.lines.length).toBeGreaterThan(0);
      for (const line of screen.lines) {
        for (const p of line.points) {
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(effectScreen(box('synth.chip'))).toBeNull();
  });

  it('more delay feedback gives more echoes', () => {
    const echoes = (feedback: number) =>
      effectScreen(box('fx.delay', { feedback, time: 0 }))!.lines.length;
    expect(echoes(0.9)).toBeGreaterThan(echoes(0.2));
  });
});
