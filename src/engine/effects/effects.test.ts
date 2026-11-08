import { describe, expect, it } from 'vitest';
import { FilterType, SYNC_DIVISIONS } from '../../model/boxes/effects';
import { boxDescriptorsOfKind } from '../../model/boxes/registry';
import { PPQ } from '../../model/constants';
import type { BlockContext, EffectRuntime } from '../boxes/types';
import { EFFECT_FACTORIES, SEQUENCER_FACTORIES } from '../boxes/registry';
import { BLOCK, peak, rms, SAMPLE_RATE } from '../test-utils';
import { Bitcrush } from './bitcrush';
import { Delay } from './delay';
import { Filter } from './filter';
import { Reverb } from './reverb';

const context: BlockContext = { bpm: 120, clockTick: 0, ticksPerSample: 0, playing: false };

/** Runs a stereo signal through an effect in worklet-sized blocks (in place). */
function run(effect: EffectRuntime, left: Float32Array, right = left.slice()) {
  for (let offset = 0; offset < left.length; offset += BLOCK) {
    effect.process(
      left.subarray(offset, offset + BLOCK),
      right.subarray(offset, offset + BLOCK),
      BLOCK,
      context,
    );
  }
  return { left, right };
}

const sine = (frequency: number, seconds: number, amplitude = 0.5) =>
  Float32Array.from(
    { length: Math.round((seconds * SAMPLE_RATE) / BLOCK) * BLOCK },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE),
  );

const impulse = (seconds: number) => {
  const buffer = new Float32Array(Math.round((seconds * SAMPLE_RATE) / BLOCK) * BLOCK);
  buffer[0] = 1;
  return buffer;
};

describe('Bitcrush', () => {
  it('quantizes to 2^bits levels', () => {
    const crush = new Bitcrush(SAMPLE_RATE);
    crush.setParams({ bits: 2, rate: SAMPLE_RATE, mix: 1 });
    const { left } = run(crush, sine(440, 0.1));
    const levels = new Set(Array.from(left, (v) => Math.round(v * 1000) / 1000));
    expect(levels.size).toBeLessThanOrEqual(5);
    for (const level of levels)
      expect(Math.abs(level / 0.5 - Math.round(level / 0.5))).toBeLessThan(1e-6);
  });

  it('holds samples to reduce the sample rate', () => {
    const crush = new Bitcrush(SAMPLE_RATE);
    crush.setParams({ bits: 16, rate: SAMPLE_RATE / 8, mix: 1 });
    const { left } = run(crush, sine(100, 0.05));
    let changes = 0;
    for (let i = 1; i < left.length; i++) if (left[i] !== left[i - 1]) changes++;
    expect(changes).toBeLessThanOrEqual(Math.ceil(left.length / 8) + 1);
  });

  it('passes the dry signal at mix 0', () => {
    const crush = new Bitcrush(SAMPLE_RATE);
    crush.setParams({ bits: 1, rate: 500, mix: 0 });
    const input = sine(440, 0.05);
    expect(run(crush, input.slice()).left).toEqual(input);
  });
});

describe('Filter', () => {
  const level = (type: number, frequency: number, cutoff = 1000) => {
    const filter = new Filter(SAMPLE_RATE);
    filter.setParams({ type, cutoff, resonance: 0 });
    run(filter, sine(frequency, 0.2)); // let the cutoff smoothing settle
    return rms(run(filter, sine(frequency, 0.2)).left);
  };

  it('low-pass keeps lows and cuts highs', () => {
    expect(level(FilterType.LowPass, 100)).toBeGreaterThan(0.3);
    expect(level(FilterType.LowPass, 8000)).toBeLessThan(0.03);
  });

  it('high-pass does the opposite', () => {
    expect(level(FilterType.HighPass, 100)).toBeLessThan(0.03);
    expect(level(FilterType.HighPass, 8000)).toBeGreaterThan(0.3);
  });

  it('band-pass keeps frequencies near the cutoff', () => {
    const near = level(FilterType.BandPass, 1000);
    expect(near).toBeGreaterThan(level(FilterType.BandPass, 100) * 3);
    expect(near).toBeGreaterThan(level(FilterType.BandPass, 10000) * 3);
  });

  it('stays stable with full resonance', () => {
    const filter = new Filter(SAMPLE_RATE);
    filter.setParams({ type: FilterType.LowPass, cutoff: 15000, resonance: 1 });
    const { left } = run(filter, sine(15000, 0.5));
    expect(left.every(Number.isFinite)).toBe(true);
    expect(peak(left)).toBeLessThan(50);
  });
});

describe('Delay', () => {
  it('echoes after the tempo-synced time, then repeats with feedback', () => {
    const delay = new Delay(SAMPLE_RATE);
    const quarter = SYNC_DIVISIONS.findIndex((d) => d.ticks === PPQ);
    delay.setParams({ time: quarter, mode: 0, feedback: 0.5, tone: 18000, wet: 1 });
    const { left } = run(delay, impulse(1.2));
    const beat = SAMPLE_RATE / 2; // a quarter note at 120 BPM
    const around = (at: number) => peak(left.subarray(at - 3, at + 4));
    expect(around(beat)).toBeGreaterThan(0.5);
    expect(around(2 * beat)).toBeGreaterThan(0.2);
    expect(around(2 * beat)).toBeLessThan(around(beat));
    expect(peak(left.subarray(100, beat - 100))).toBe(0);
  });

  it('ping-pong alternates between the channels', () => {
    const delay = new Delay(SAMPLE_RATE);
    const quarter = SYNC_DIVISIONS.findIndex((d) => d.ticks === PPQ);
    delay.setParams({ time: quarter, mode: 1, feedback: 0.6, tone: 18000, wet: 1 });
    const input = impulse(1.2);
    const { left, right } = run(delay, input, input.slice());
    const beat = SAMPLE_RATE / 2;
    const at = (buffer: Float32Array, n: number) =>
      peak(buffer.subarray(n * beat - 3, n * beat + 4));
    expect(at(left, 1)).toBeGreaterThan(0.3);
    expect(at(right, 1)).toBeLessThan(0.01);
    expect(at(right, 2)).toBeGreaterThan(0.1);
  });
});

describe('Reverb', () => {
  it('turns an impulse into a decaying tail', () => {
    const reverb = new Reverb(SAMPLE_RATE);
    reverb.setParams({ size: 0.6, damping: 0.5, width: 1, wet: 0.5 });
    const { left } = run(reverb, impulse(3));
    const early = rms(left.subarray(SAMPLE_RATE * 0.1, SAMPLE_RATE * 0.4));
    const late = rms(left.subarray(SAMPLE_RATE * 2, SAMPLE_RATE * 2.5));
    expect(early).toBeGreaterThan(0.001);
    expect(late).toBeLessThan(early / 10);
    expect(left.every(Number.isFinite)).toBe(true);
  });

  it('adds nothing at wet 0', () => {
    const reverb = new Reverb(SAMPLE_RATE);
    reverb.setParams({ size: 1, damping: 0, width: 1, wet: 0 });
    const input = sine(440, 0.2);
    expect(run(reverb, input.slice()).left).toEqual(input);
  });
});

describe('box registry (engine)', () => {
  it('has an engine implementation for every effect and sequencer descriptor', () => {
    for (const d of boxDescriptorsOfKind('effect')) expect(EFFECT_FACTORIES[d.type]).toBeDefined();
    for (const d of boxDescriptorsOfKind('sequencer')) {
      expect(SEQUENCER_FACTORIES[d.type]).toBeDefined();
    }
  });
});
