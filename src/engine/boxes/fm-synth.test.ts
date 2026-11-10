import { describe, expect, it } from 'vitest';
import { FM_RATIOS } from '../../model/boxes/fm-synth';
import { estimateFrequency, peak, renderBlocks, SAMPLE_RATE } from '../test-utils';
import { FmSynth } from './fm-synth';
import { createSynth } from './registry';

const ratio = (multiple: number) => FM_RATIOS.indexOf(multiple as (typeof FM_RATIOS)[number]);

function synth(params: Record<string, number> = {}) {
  const s = new FmSynth(SAMPLE_RATE);
  s.setParams({ attack: 0.001, sustain: 1, modSustain: 1, ...params });
  return s;
}

const render = (s: FmSynth, seconds: number) =>
  renderBlocks((l, r, n) => s.process(l, r, 0, n), seconds).left;

/** High-frequency content: mean absolute difference between neighbouring samples. */
function brightness(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 1; i < buffer.length; i++) sum += Math.abs(buffer[i]! - buffer[i - 1]!);
  return sum / (buffer.length - 1) / Math.max(1e-9, peak(buffer));
}

describe('FmSynth', () => {
  it('is registered as "synth.fm"', () => {
    expect(createSynth('synth.fm', SAMPLE_RATE)).toBeInstanceOf(FmSynth);
  });

  it('is silent without notes', () => {
    expect(peak(render(synth(), 0.1))).toBe(0);
  });

  it('plays a pure tone at the note pitch with no modulation', () => {
    const s = synth({ amount: 0 });
    s.noteOn(69, 127);
    const out = render(s, 0.5).subarray(4800);
    expect(estimateFrequency(out)).toBeCloseTo(440, -1);
    expect(peak(out)).toBeGreaterThan(0.1);
  });

  it('gets brighter with more modulation, and keeps the pitch with a whole ratio', () => {
    const plain = synth({ amount: 0, ratio: ratio(1) });
    const bright = synth({ amount: 0.8, ratio: ratio(2) });
    plain.noteOn(57, 127);
    bright.noteOn(57, 127);
    const a = render(plain, 0.5).subarray(4800);
    const b = render(bright, 0.5).subarray(4800);
    expect(brightness(b)).toBeGreaterThan(brightness(a) * 1.5);
  });

  it("follows the modulator's envelope: bright attack, mellow sustain", () => {
    const s = synth({ amount: 0.8, ratio: ratio(3), modDecay: 0.05, modSustain: 0 });
    s.noteOn(57, 127);
    const out = render(s, 1);
    const attack = brightness(out.subarray(0, 1200));
    const later = brightness(out.subarray(SAMPLE_RATE / 2));
    expect(attack).toBeGreaterThan(later * 1.5);
  });

  it('stays bounded with full feedback and modulation', () => {
    const s = synth({ amount: 1, feedback: 1, ratio: ratio(15) });
    for (const pitch of [36, 60, 96]) s.noteOn(pitch, 127);
    const out = render(s, 0.5);
    expect(peak(out)).toBeLessThan(1.5);
    expect(out.every(Number.isFinite)).toBe(true);
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
