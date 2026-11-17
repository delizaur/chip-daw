import { describe, expect, it } from 'vitest';
import type { BoxInstance } from '../../model/types';
import { envelopeShape, svgPath, waveIcon, waveShape } from './synth-visuals';

const box = (type: string, params: Record<string, number> = {}): BoxInstance => ({
  id: 'b',
  type,
  params,
});

describe('waveShape', () => {
  it('draws the chip pulse with its duty cycle', () => {
    const points = waveShape(box('synth.chip', { wave: 1 }))!;
    // Rises at 0, falls at 25%.
    expect(points[2]!.x).toBe(0.25);
    expect(points[2]!.y).toBeGreaterThan(points[3]!.y);
  });

  it('draws every synth, and nothing for other boxes', () => {
    for (const type of ['synth.chip', 'synth.wave', 'synth.fm', 'synth.sid']) {
      const points = waveShape(box(type))!;
      expect(points.length).toBeGreaterThan(4);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
    expect(waveShape(box('fx.delay'))).toBeNull();
  });

  it('FM amount bends the sine', () => {
    const plain = waveShape(box('synth.fm', { amount: 0 }))!;
    const bright = waveShape(box('synth.fm', { amount: 1 }))!;
    const eighth = Math.round((plain.length - 1) / 8);
    const sineAt = 0.5 + 0.45 * Math.SQRT1_2;
    expect(plain[eighth]!.y).toBeCloseTo(sineAt, 2);
    expect(bright[eighth]!.y).not.toBeCloseTo(sineAt, 2);
  });
});

describe('envelopeShape', () => {
  it('rises, falls to the sustain level, holds and releases to zero', () => {
    const env = envelopeShape(box('synth.chip', { sustain: 0.5 }))!;
    expect(env.attack[0]).toEqual({ x: 0, y: 0 });
    const peak = env.attack.at(-1)!;
    expect(env.decay[0]).toEqual(peak);
    expect(env.decay.at(-1)!.y).toBeCloseTo(0.475);
    expect(env.sustain[0]!.y).toBeCloseTo(0.475);
    expect(env.release.at(-1)!.x).toBeCloseTo(1);
    expect(env.release.at(-1)!.y).toBeCloseTo(0);
  });

  it('longer attacks take more width', () => {
    const short = envelopeShape(box('synth.chip', { attack: 0.001 }))!;
    const long = envelopeShape(box('synth.chip', { attack: 2 }))!;
    expect(long.attack[1]!.x).toBeGreaterThan(short.attack[1]!.x);
  });

  it('is null for boxes without an envelope', () => {
    expect(envelopeShape(box('fx.delay'))).toBeNull();
  });
});

describe('svgPath', () => {
  it('flips y so 1 is the top', () => {
    expect(
      svgPath(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        10,
        4,
      ),
    ).toBe('M0.0 4.0L10.0 0.0');
  });
});

describe('waveIcon', () => {
  it('has an icon for each chip and SID wave, none for other params', () => {
    for (let v = 0; v < 6; v++) expect(waveIcon('synth.chip', 'wave', v)).toBeTruthy();
    for (let v = 0; v < 4; v++) expect(waveIcon('synth.sid', 'wave', v)).toBeTruthy();
    expect(waveIcon('synth.chip', 'mode', 0)).toBeUndefined();
    expect(waveIcon('synth.wave', 'wave', 0)).toBeUndefined();
  });
});
