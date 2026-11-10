import { describe, expect, it } from 'vitest';
import { WAVE_LEVELS, WAVE_LENGTH, WAVES } from '../../model/boxes/wave-synth';
import { estimateFrequency, peak, renderBlocks, SAMPLE_RATE } from '../test-utils';
import { createSynth } from './registry';
import { WaveSynth } from './wave-synth';

const named = (name: string) => WAVES.findIndex((w) => w.name === name);

function synth(params: Record<string, number> = {}) {
  const s = new WaveSynth(SAMPLE_RATE);
  s.setParams({ attack: 0.001, sustain: 1, ...params });
  return s;
}

const render = (s: WaveSynth, seconds: number) =>
  renderBlocks((l, r, n) => s.process(l, r, 0, n), seconds).left;

describe('wave tables', () => {
  it('are 32 steps of 4-bit levels, using the full range', () => {
    for (const wave of WAVES) {
      expect(wave.steps, wave.name).toHaveLength(WAVE_LENGTH);
      expect(wave.steps.every((v) => Number.isInteger(v) && v >= 0 && v < WAVE_LEVELS)).toBe(true);
      expect(Math.min(...wave.steps), wave.name).toBe(0);
      expect(Math.max(...wave.steps), wave.name).toBe(WAVE_LEVELS - 1);
    }
  });
});

describe('WaveSynth', () => {
  it('is registered as "synth.wave"', () => {
    expect(createSynth('synth.wave', SAMPLE_RATE)).toBeInstanceOf(WaveSynth);
  });

  it('is silent without notes', () => {
    expect(peak(render(synth(), 0.1))).toBe(0);
  });

  it('plays notes at the right pitch', () => {
    for (const name of ['Sine', 'Square', 'Saw']) {
      const s = synth({ wave: named(name) });
      s.noteOn(69, 127);
      const out = render(s, 0.5).subarray(4800);
      expect(estimateFrequency(out), name).toBeCloseTo(440, -1);
      expect(peak(out), name).toBeGreaterThan(0.1);
    }
  });

  it('morphs towards the next wave: Morph 100% sounds like the next wave', () => {
    const morphed = synth({ wave: named('Sine'), morph: 1 });
    const next = synth({ wave: named('Sine') + 1, morph: 0 });
    const plain = synth({ wave: named('Sine'), morph: 0 });
    for (const s of [morphed, next, plain]) s.noteOn(57, 127);
    const a = render(morphed, 0.2);
    const b = render(next, 0.2);
    const c = render(plain, 0.2);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('wraps around: the last wave morphs towards the first', () => {
    const last = synth({ wave: WAVES.length - 1, morph: 1 });
    const first = synth({ wave: 0 });
    last.noteOn(57, 127);
    first.noteOn(57, 127);
    expect(render(last, 0.1)).toEqual(render(first, 0.1));
  });

  it('stays bounded at high notes', () => {
    const s = synth({ wave: named('Square') });
    s.noteOn(120, 127);
    const out = render(s, 0.2);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(peak(out)).toBeLessThan(1);
  });

  it('releases notes', () => {
    const s = synth({ release: 0.05 });
    s.noteOn(60, 100);
    render(s, 0.2);
    s.noteOff(60);
    const out = render(s, 0.5);
    expect(peak(out.subarray(out.length - 1024))).toBe(0);
    expect(s.activeVoices).toBe(0);
  });
});
