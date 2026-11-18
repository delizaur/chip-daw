import { describe, expect, it } from 'vitest';
import { AnalogFilter, AnalogLfoTarget, AnalogWave } from '../../model/boxes/analog-synth';
import { estimateFrequency, peak, renderBlocks, rms, SAMPLE_RATE } from '../test-utils';
import { AnalogSynth } from './analog-synth';
import { createSynth } from './registry';

/** A plain, open patch: one oscillator, no unison, filter wide open, no envelope on it. */
const OPEN = {
  attack: 0.001,
  sustain: 1,
  mix: 0,
  detune: 0,
  cutoff: 18000,
  resonance: 0,
  drive: 0,
  envAmount: 0,
  spread: 0,
};

function synth(params: Record<string, number> = {}) {
  const s = new AnalogSynth(SAMPLE_RATE);
  s.setParams({ ...OPEN, ...params });
  return s;
}

const render = (s: AnalogSynth, seconds: number) =>
  renderBlocks((l, r, n) => s.process(l, r, 0, n), seconds);

/** A note's steady part (after the attack), both channels. */
function play(params: Record<string, number>, pitch = 69, seconds = 0.5) {
  const s = synth(params);
  s.noteOn(pitch, 127);
  const { left, right } = render(s, seconds);
  return { left: left.subarray(4800), right: right.subarray(4800) };
}

/** High-frequency content relative to level (see sid-synth.test). */
function brightness(buffer: Float32Array): number {
  let change = 0;
  let level = 0;
  for (let i = 1; i < buffer.length; i++) {
    change += (buffer[i]! - buffer[i - 1]!) ** 2;
    level += buffer[i]! ** 2;
  }
  return Math.sqrt(change / Math.max(1e-12, level));
}

describe('AnalogSynth', () => {
  it('is registered as "synth.analog"', () => {
    expect(createSynth('synth.analog', SAMPLE_RATE)).toBeInstanceOf(AnalogSynth);
  });

  it('is silent without notes', () => {
    expect(peak(render(synth(), 0.1).left)).toBe(0);
  });

  it('plays every wave at the note pitch', () => {
    for (const wave of Object.values(AnalogWave)) {
      const { left } = play({ osc1Wave: wave });
      expect(estimateFrequency(left), `wave ${wave}`).toBeCloseTo(440, -1);
      expect(peak(left), `wave ${wave}`).toBeGreaterThan(0.05);
    }
  });

  it('osc 2 plays at its own pitch', () => {
    const { left } = play({ mix: 1, osc2Wave: AnalogWave.Sine, osc2Pitch: 12 }, 57);
    expect(estimateFrequency(left)).toBeCloseTo(440, -1);
  });

  it('is mono without unison spread, and wide with it', () => {
    const mono = play({ unison: 1 });
    let difference = 0;
    for (let i = 0; i < mono.left.length; i++)
      difference += Math.abs(mono.left[i]! - mono.right[i]!);
    expect(difference).toBe(0);

    const wide = play({ unison: 3, spread: 1, mix: 0.5 });
    difference = 0;
    for (let i = 0; i < wide.left.length; i++)
      difference += Math.abs(wide.left[i]! - wide.right[i]!);
    expect(difference / wide.left.length).toBeGreaterThan(0.01);
  });

  it('a lower cutoff makes it darker, and the low-pass modes cut highs', () => {
    const open = play({ cutoff: 18000 }).left;
    const closed = play({ cutoff: 400 }).left;
    expect(brightness(closed)).toBeLessThan(brightness(open) * 0.5);
    const twelve = play({ cutoff: 400, filterType: AnalogFilter.LowPass12 }).left;
    expect(brightness(twelve)).toBeGreaterThan(brightness(closed));
  });

  it('the high-pass removes a low note', () => {
    const low = play(
      { filterType: AnalogFilter.HighPass, cutoff: 5000, osc1Wave: AnalogWave.Sine },
      45,
    );
    const open = play({ osc1Wave: AnalogWave.Sine }, 45);
    expect(rms(low.left)).toBeLessThan(rms(open.left) * 0.1);
  });

  it('the filter envelope opens the filter at the start of the note', () => {
    const s = synth({ cutoff: 200, envAmount: 1, filterDecay: 0.1, filterSustain: 0 });
    s.noteOn(57, 127);
    const { left } = render(s, 0.6);
    const early = left.subarray(240, 2640);
    const late = left.subarray(24000, 26400);
    expect(brightness(early)).toBeGreaterThan(brightness(late) * 1.5);
  });

  it('glides from the previous note', () => {
    const s = synth({ osc1Wave: AnalogWave.Sine, glide: 0.5 });
    s.noteOn(57, 127);
    render(s, 0.1);
    s.noteOff(57);
    s.noteOn(69, 127);
    const { left } = render(s, 0.1);
    // Still well below 440 Hz shortly after the new note.
    expect(estimateFrequency(left)).toBeLessThan(330);
  });

  it('the LFO on the amp makes a tremolo', () => {
    const { left } = play(
      { osc1Wave: AnalogWave.Sine, lfoTarget: AnalogLfoTarget.Amp, lfoDepth: 1, lfoRate: 4 },
      69,
      1,
    );
    const window = 2400;
    const levels: number[] = [];
    for (let i = 0; i + window <= left.length; i += window) {
      levels.push(rms(left.subarray(i, i + window)));
    }
    expect(Math.min(...levels)).toBeLessThan(Math.max(...levels) * 0.3);
  });

  it('stays finite and bounded when pushed hard', () => {
    const s = synth({
      unison: 7,
      spread: 1,
      sub: 1,
      mix: 0.5,
      cutoff: 1000,
      resonance: 1,
      drive: 1,
      envAmount: 1,
    });
    for (const pitch of [36, 48, 55, 60, 64, 67, 72, 84]) s.noteOn(pitch, 127);
    const { left, right } = render(s, 1);
    for (const buffer of [left, right]) {
      expect(buffer.every(Number.isFinite)).toBe(true);
      expect(peak(buffer)).toBeLessThan(4);
    }
  });

  it('releases and goes idle', () => {
    const s = synth({ release: 0.05 });
    s.noteOn(60, 100);
    render(s, 0.1);
    s.noteOff(60);
    render(s, 0.5);
    expect(s.activeVoices).toBe(0);
  });

  it('renders 8 voices of 7-voice unison faster than real time', () => {
    const s = synth({ unison: 7, spread: 0.5, mix: 0.5, sub: 0.5, resonance: 0.5 });
    for (let n = 0; n < 8; n++) s.noteOn(48 + n * 3, 100);
    const start = performance.now();
    render(s, 1);
    const elapsed = performance.now() - start;
    // Only catches pathological slowdowns: Vitest runs this several times slower than the
    // browser's audio thread (about 50 ms per second of audio there for this patch).
    expect(elapsed).toBeLessThan(1000);
  });
});
