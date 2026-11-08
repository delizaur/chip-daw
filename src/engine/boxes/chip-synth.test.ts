import { describe, expect, it } from 'vitest';
import { CHIP_SYNTH, ChipWave } from '../../model/boxes/chip-synth';
import { boxDescriptorsOfKind } from '../../model/boxes/registry';
import { estimateFrequency, peak, renderBlocks, rms, SAMPLE_RATE } from '../test-utils';
import { ChipSynth } from './chip-synth';
import { SYNTH_FACTORIES } from './registry';

function synth(params: Record<string, number> = {}) {
  const s = new ChipSynth(SAMPLE_RATE);
  s.setParams({ attack: 0.001, sustain: 1, ...params });
  return s;
}

const render = (s: ChipSynth, seconds: number) =>
  renderBlocks((l, r, n) => s.process(l, r, n), seconds);

describe('ChipSynth', () => {
  it('is silent without notes', () => {
    expect(peak(render(synth(), 0.1).left)).toBe(0);
  });

  it('plays notes at the right pitch for each tonal wave', () => {
    for (const wave of [ChipWave.Pulse12, ChipWave.Pulse25, ChipWave.Pulse50, ChipWave.Triangle]) {
      const s = synth({ wave });
      s.noteOn(69, 127);
      const { left } = render(s, 0.5);
      expect(estimateFrequency(left.subarray(4800)), `wave ${wave}`).toBeCloseTo(440, -1);
    }
  });

  it('applies transpose and fine tuning', () => {
    const s = synth({ transpose: 12, fine: 0 });
    s.noteOn(57, 127); // A3 + 12 = A4
    expect(estimateFrequency(render(s, 0.5).left.subarray(4800))).toBeCloseTo(440, -1);

    const sharp = synth({ fine: 100 });
    sharp.noteOn(68, 127); // G#4 + 100 ct = A4
    expect(estimateFrequency(render(sharp, 0.5).left.subarray(4800))).toBeCloseTo(440, -1);
  });

  it('pitches the metallic noise to the note', () => {
    const s = synth({ wave: ChipWave.MetalNoise });
    s.noteOn(69, 127);
    const { left } = render(s, 0.5);
    // The 93-step sequence repeats at the note frequency: compare one period apart.
    const period = Math.round(SAMPLE_RATE / 440);
    let similar = 0;
    for (let i = 4800; i < 4800 + 2000; i++)
      if (Math.sign(left[i]!) === Math.sign(left[i + period]!)) similar++;
    expect(similar / 2000).toBeGreaterThan(0.85);
  });

  it('produces broadband noise in long-noise mode', () => {
    const s = synth({ wave: ChipWave.Noise });
    s.noteOn(60, 127);
    const { left } = render(s, 0.3);
    expect(rms(left)).toBeGreaterThan(0.05);
  });

  it('scales with velocity and level', () => {
    const loud = synth();
    loud.noteOn(60, 127);
    const quiet = synth();
    quiet.noteOn(60, 32);
    const silent = synth({ level: 0 });
    silent.noteOn(60, 127);
    const a = rms(render(loud, 0.2).left);
    expect(rms(render(quiet, 0.2).left)).toBeCloseTo(a * (32 / 127), 2);
    expect(peak(render(silent, 0.2).left)).toBe(0);
  });

  it('releases notes to silence and frees voices', () => {
    const s = synth({ release: 0.05 });
    s.noteOn(60, 100);
    render(s, 0.1);
    s.noteOff(60);
    const { left } = render(s, 0.3);
    expect(peak(left.subarray(left.length - 512))).toBe(0);
    expect(s.activeVoices).toBe(0);
  });

  it('is polyphonic up to 8 voices, then steals', () => {
    const s = synth();
    for (let i = 0; i < 8; i++) s.noteOn(60 + i, 100);
    expect(s.activeVoices).toBe(8);
    s.noteOn(80, 100);
    expect(s.activeVoices).toBe(8);
  });

  it('stays finite and bounded with every wave and extreme notes', () => {
    for (const wave of Object.values(ChipWave)) {
      const s = synth({ wave, transpose: 24 });
      s.noteOn(127, 127);
      s.noteOn(0, 127);
      const { left } = render(s, 0.1);
      expect(left.every(Number.isFinite)).toBe(true);
      expect(peak(left)).toBeLessThan(2);
    }
  });
});

describe('synth registry', () => {
  it('has an engine implementation for every synth descriptor', () => {
    for (const d of boxDescriptorsOfKind('synth')) expect(SYNTH_FACTORIES[d.type]).toBeDefined();
    expect(SYNTH_FACTORIES[CHIP_SYNTH.type]).toBeDefined();
  });
});
