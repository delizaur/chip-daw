import { describe, expect, it } from 'vitest';
import { SidFilter, SidMod, SidWave } from '../../model/boxes/sid-synth';
import { estimateFrequency, peak, renderBlocks, SAMPLE_RATE } from '../test-utils';
import { createSynth } from './registry';
import { SidSynth } from './sid-synth';

function synth(params: Record<string, number> = {}) {
  const s = new SidSynth(SAMPLE_RATE);
  s.setParams({ attack: 0.001, sustain: 1, ...params });
  return s;
}

const render = (s: SidSynth, seconds: number) =>
  renderBlocks((l, r, n) => s.process(l, r, 0, n), seconds).left;

/**
 * High-frequency content: the RMS of the sample-to-sample change, relative to the RMS of the
 * signal (a pure sine scores low; a saw's jump scores high).
 */
function brightness(buffer: Float32Array): number {
  let change = 0;
  let level = 0;
  for (let i = 1; i < buffer.length; i++) {
    change += (buffer[i]! - buffer[i - 1]!) ** 2;
    level += buffer[i]! ** 2;
  }
  return Math.sqrt(change / Math.max(1e-12, level));
}

/** A note's steady part (after the attack). */
function play(params: Record<string, number>, pitch = 57, seconds = 0.5) {
  const s = synth(params);
  s.noteOn(pitch, 127);
  return render(s, seconds).subarray(4800);
}

describe('SidSynth', () => {
  it('is registered as "synth.sid"', () => {
    expect(createSynth('synth.sid', SAMPLE_RATE)).toBeInstanceOf(SidSynth);
  });

  it('is silent without notes', () => {
    expect(peak(render(synth(), 0.1))).toBe(0);
  });

  it('plays the tonal waves at the note pitch', () => {
    for (const wave of [SidWave.Triangle, SidWave.Saw, SidWave.Pulse]) {
      const out = play({ wave }, 69);
      expect(estimateFrequency(out), `wave ${wave}`).toBeCloseTo(440, -1);
      expect(peak(out), `wave ${wave}`).toBeGreaterThan(0.1);
    }
  });

  it('hard sync keeps the note pitch while Mod pitch changes the timbre', () => {
    const plain = play({ wave: SidWave.Saw }, 45);
    const synced = play({ wave: SidWave.Saw, mod: SidMod.Sync, modPitch: 10 }, 45);
    // The waveform repeats at the note's period (110 Hz) either way...
    const period = Math.round(SAMPLE_RATE / 110);
    let difference = 0;
    for (let i = 0; i < 4000; i++) difference += Math.abs(synced[i]! - synced[i + period]!);
    expect(difference / 4000).toBeLessThan(0.02);
    // ...but sounds different.
    expect(brightness(synced)).not.toBeCloseTo(brightness(plain), 2);
  });

  it('ring modulation changes the sound', () => {
    const plain = play({ wave: SidWave.Triangle });
    const ring = play({ wave: SidWave.Triangle, mod: SidMod.Ring, modPitch: 7 });
    expect(brightness(ring)).toBeGreaterThan(brightness(plain) * 1.5);
  });

  it('the low-pass filter darkens the sound', () => {
    const open = play({ wave: SidWave.Saw });
    const closed = play({ wave: SidWave.Saw, filter: SidFilter.LowPass, cutoff: 300 });
    expect(brightness(closed)).toBeLessThan(brightness(open) * 0.5);
  });

  it('PWM sweeps the pulse width over time', () => {
    const out = play({ wave: SidWave.Pulse, width: 0.5, pwmRate: 2, pwmDepth: 1 }, 57, 1);
    // The share of samples above zero follows the width: compare two moments of the sweep.
    const highShare = (from: number) => {
      const part = out.subarray(from, from + 2400);
      return part.filter((v) => v > 0).length / part.length;
    };
    expect(Math.abs(highShare(0) - highShare(SAMPLE_RATE / 4))).toBeGreaterThan(0.1);
  });

  it('stays bounded with noise, resonance and high notes', () => {
    const cases: Record<string, number>[] = [
      { wave: SidWave.Noise, filter: SidFilter.BandPass, resonance: 1 },
      {
        wave: SidWave.Saw,
        mod: SidMod.Sync,
        modPitch: 24,
        filter: SidFilter.HighPass,
        resonance: 1,
      },
    ];
    for (const params of cases) {
      const s = synth(params);
      for (const pitch of [36, 84, 120]) s.noteOn(pitch, 127);
      const out = render(s, 0.3);
      expect(out.every(Number.isFinite)).toBe(true);
      expect(peak(out)).toBeLessThan(2);
    }
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
