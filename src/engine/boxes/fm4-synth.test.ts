import { describe, expect, it } from 'vitest';
import { FM4_ALGORITHMS, FM4_RATIOS } from '../../model/boxes/fm4-synth';
import { estimateFrequency, peak, renderBlocks, rms, SAMPLE_RATE } from '../test-utils';
import { Fm4Synth } from './fm4-synth';
import { createSynth } from './registry';

/** Every operator flat out (no decay) at ratio 1, all levels 0: switch on what a test needs. */
const FLAT: Record<string, number> = {};
for (let n = 1; n <= 4; n++) {
  FLAT[`op${n}Ratio`] = FM4_RATIOS.indexOf(1);
  FLAT[`op${n}Level`] = 0;
  FLAT[`op${n}Detune`] = 0;
  FLAT[`op${n}Attack`] = 0.001;
  FLAT[`op${n}Sustain`] = 1;
}

/** Algorithm 8: every operator is a carrier. */
const ADDITIVE = FM4_ALGORITHMS.length - 1;

function synth(params: Record<string, number> = {}) {
  const s = new Fm4Synth(SAMPLE_RATE);
  s.setParams({ ...FLAT, ...params });
  return s;
}

const render = (s: Fm4Synth, seconds: number) =>
  renderBlocks((l, r, n) => s.process(l, r, 0, n), seconds).left;

function play(params: Record<string, number>, pitch = 57, seconds = 0.5) {
  const s = synth(params);
  s.noteOn(pitch, 127);
  return render(s, seconds).subarray(2400);
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

describe('Fm4Synth', () => {
  it('is registered as "synth.fm4"', () => {
    expect(createSynth('synth.fm4', SAMPLE_RATE)).toBeInstanceOf(Fm4Synth);
  });

  it('is silent without notes', () => {
    expect(peak(render(synth(), 0.1))).toBe(0);
  });

  it('a lone carrier is a sine at the note, and its ratio multiplies the pitch', () => {
    const plain = play({ algorithm: 0, op1Level: 1 }, 57);
    expect(estimateFrequency(plain)).toBeCloseTo(220, -1);
    const doubled = play({ algorithm: 0, op1Level: 1, op1Ratio: FM4_RATIOS.indexOf(2) }, 57);
    expect(estimateFrequency(doubled)).toBeCloseTo(440, -1);
    const half = play({ algorithm: 0, op1Level: 1, op1Ratio: FM4_RATIOS.indexOf(0.5) }, 57);
    expect(estimateFrequency(half)).toBeCloseTo(110, -1);
  });

  it('modulation brightens the carrier; more level, more brightness', () => {
    const base = { algorithm: 0, op1Level: 1 };
    const pure = brightness(play(base));
    const some = brightness(play({ ...base, op2Level: 0.4 }));
    const lots = brightness(play({ ...base, op2Level: 1 }));
    expect(some).toBeGreaterThan(pure * 1.2);
    expect(lots).toBeGreaterThan(some);
  });

  it('only the carriers of each algorithm are heard', () => {
    for (let algorithm = 0; algorithm < FM4_ALGORITHMS.length; algorithm++) {
      const { carriers } = FM4_ALGORITHMS[algorithm]!;
      for (let op = 1; op <= 4; op++) {
        // Just this operator up: heard if it's a carrier, silent otherwise.
        const out = play({ algorithm, [`op${op}Level`]: 1 });
        if (carriers.includes(op))
          expect(rms(out), `alg ${algorithm + 1} op ${op}`).toBeGreaterThan(0.05);
        else expect(peak(out), `alg ${algorithm + 1} op ${op}`).toBe(0);
      }
    }
  });

  it('additive: every operator sounds at its own ratio', () => {
    const out = play({
      algorithm: ADDITIVE,
      op1Level: 1,
      op2Level: 0.3,
      op2Ratio: FM4_RATIOS.indexOf(2),
    });
    // Fundamental still the note (the octave is quieter, so zero crossings count the note);
    // louder than the fundamental alone.
    expect(estimateFrequency(out)).toBeCloseTo(220, -1);
    expect(rms(out)).toBeGreaterThan(rms(play({ algorithm: ADDITIVE, op1Level: 1 })));
  });

  it('feedback on operator 4 brightens it', () => {
    const plain = play({ algorithm: ADDITIVE, op4Level: 1 });
    const fed = play({ algorithm: ADDITIVE, op4Level: 1, feedback: 1 });
    expect(brightness(fed)).toBeGreaterThan(brightness(plain) * 1.5);
  });

  it('a decaying modulator makes the note mellow over time', () => {
    const s = synth({ algorithm: 0, op1Level: 1, op2Level: 1, op2Decay: 0.2, op2Sustain: 0 });
    s.noteOn(57, 127);
    const out = render(s, 1.5);
    const early = brightness(out.subarray(480, 4800));
    const late = brightness(out.subarray(SAMPLE_RATE, SAMPLE_RATE + 4800));
    expect(late).toBeLessThan(early * 0.7);
  });

  it('ends when the carriers have released, whatever the modulators do', () => {
    const s = synth({ algorithm: 0, op1Level: 1, op2Level: 1, op2Sustain: 1, release: 0.05 });
    s.noteOn(57, 100);
    render(s, 0.2);
    s.noteOff(57);
    render(s, 0.5);
    expect(s.activeVoices).toBe(0);
  });

  it('stays finite and bounded when pushed hard', () => {
    const loud: Record<string, number> = { feedback: 1 };
    for (let n = 1; n <= 4; n++) loud[`op${n}Level`] = 1;
    for (let algorithm = 0; algorithm < FM4_ALGORITHMS.length; algorithm++) {
      const s = synth({ ...loud, algorithm });
      for (const pitch of [36, 48, 60, 72, 84, 96, 100, 108]) s.noteOn(pitch, 127);
      const out = render(s, 0.3);
      expect(out.every(Number.isFinite)).toBe(true);
      expect(peak(out), `alg ${algorithm + 1}`).toBeLessThan(4);
    }
  });
});
