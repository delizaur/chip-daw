import { describe, expect, it } from 'vitest';
import { DRUM_SOUNDS, drumForPitch } from '../../model/boxes/drum-synth';
import { estimateFrequency, peak, renderBlocks, rms, SAMPLE_RATE } from '../test-utils';
import { DrumSynth } from './drum-synth';
import { createSynth } from './registry';

const render = (s: DrumSynth, seconds: number) =>
  renderBlocks((l, r, n) => s.process(l, r, 0, n), seconds);

/** Hits the drum on `pitch` and renders `seconds`. */
function hit(pitch: number, params: Record<string, number> = {}, seconds = 0.5, velocity = 127) {
  const s = new DrumSynth(SAMPLE_RATE);
  s.setParams(params);
  s.noteOn(pitch, velocity);
  return { synth: s, ...render(s, seconds) };
}

/** Zero crossings per second, a rough brightness measure for noisy sounds. */
function crossingRate(buffer: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < buffer.length; i++) if (buffer[i - 1]! < 0 !== buffer[i]! < 0) crossings++;
  return (crossings * SAMPLE_RATE) / buffer.length;
}

describe('DrumSynth', () => {
  it('is registered as "synth.drums"', () => {
    expect(createSynth('synth.drums', SAMPLE_RATE)).toBeInstanceOf(DrumSynth);
  });

  it('maps every note of the octave to a drum, in any octave', () => {
    expect(drumForPitch(36)).toBe('kick');
    expect(drumForPitch(60)).toBe('kick');
    expect(drumForPitch(38)).toBe('snare');
    expect(drumForPitch(42)).toBe('hatClosed');
    expect(drumForPitch(46)).toBe('hatOpen');
    expect(new Set(Array.from({ length: 12 }, (_, i) => drumForPitch(i))).size).toBe(12);
  });

  it('is silent without hits', () => {
    expect(peak(render(new DrumSynth(SAMPLE_RATE), 0.1).left)).toBe(0);
  });

  it('every drum sounds, stays bounded and dies away', () => {
    for (let pitch = 0; pitch < 12; pitch++) {
      const name = DRUM_SOUNDS[pitch]!.name;
      const { synth, left, right } = hit(48 + pitch, {}, 3);
      expect(peak(left), name).toBeGreaterThan(0.02);
      expect(peak(left), name).toBeLessThan(1);
      expect(left.every(Number.isFinite) && right.every(Number.isFinite), name).toBe(true);
      expect(synth.activeVoices, `${name} still ringing`).toBe(0);
    }
  });

  it('note-offs do not cut the drums short', () => {
    const s = new DrumSynth(SAMPLE_RATE);
    s.noteOn(48, 127);
    s.noteOff();
    s.allNotesOff();
    expect(peak(render(s, 0.2).left)).toBeGreaterThan(0.05);
  });

  it('the kick settles at its Tune frequency, and Decay makes it longer', () => {
    const { left } = hit(36, { kickTune: 60, kickPunch: 0, kickDrive: 0, kickDecay: 1 });
    expect(estimateFrequency(left.subarray(9600, 24000))).toBeCloseTo(60, -1);
    const short = hit(36, { kickDecay: 0.1 }).left;
    const long = hit(36, { kickDecay: 1 }).left;
    expect(rms(long.subarray(12000))).toBeGreaterThan(rms(short.subarray(12000)) * 5);
  });

  it('the kick and snare follow the Pitch knob', () => {
    const at = (pitch: number) =>
      estimateFrequency(
        hit(36, { kickTune: 60, kickPunch: 0, kickDrive: 0, kickDecay: 1, pitch }).left.subarray(
          9600,
          24000,
        ),
      );
    expect(at(12) / at(0)).toBeCloseTo(2, 1);
  });

  it('a snappier snare is noisier', () => {
    const body = hit(38, { snareSnappy: 0 }).left.subarray(0, 4800);
    const snappy = hit(38, { snareSnappy: 1 }).left.subarray(0, 4800);
    expect(crossingRate(snappy)).toBeGreaterThan(crossingRate(body) * 2);
  });

  it('the closed hat cuts off the open hat', () => {
    const s = new DrumSynth(SAMPLE_RATE);
    s.setParams({ hatOpen: 2 });
    s.noteOn(46, 127);
    render(s, 0.1);
    s.noteOn(42, 127);
    render(s, 0.3);
    // Only the closed hat could still be ringing, and it has died away by now.
    expect(s.activeVoices).toBe(0);
  });

  it('Width spreads the toms and hats in stereo; at zero the kit is mono', () => {
    const difference = (width: number) => {
      const { left, right } = hit(40, { width });
      let sum = 0;
      for (let i = 0; i < left.length; i++) sum += Math.abs(left[i]! - right[i]!);
      return sum;
    };
    expect(difference(0)).toBe(0);
    expect(difference(1)).toBeGreaterThan(1);
  });

  it('softer hits are quieter', () => {
    expect(peak(hit(38, {}, 0.3, 40).left)).toBeLessThan(peak(hit(38, {}, 0.3, 127).left) * 0.5);
  });
});
