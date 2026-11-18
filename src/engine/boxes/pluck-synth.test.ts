import { describe, expect, it } from 'vitest';
import { PluckExcite } from '../../model/boxes/pluck-synth';
import { noteFrequency } from '../oscillators';
import { peak, renderBlocks, rms, SAMPLE_RATE } from '../test-utils';
import { PluckSynth } from './pluck-synth';
import { createSynth } from './registry';

/** A plain string: no body, no second string. */
const PLAIN = { body: 0, double: 0 };

function synth(params: Record<string, number> = {}) {
  const s = new PluckSynth(SAMPLE_RATE);
  s.setParams({ ...PLAIN, ...params });
  return s;
}

const render = (s: PluckSynth, seconds: number) =>
  renderBlocks((l, r, n) => s.process(l, r, 0, n), seconds);

function play(params: Record<string, number>, pitch = 57, seconds = 1) {
  const s = synth(params);
  s.noteOn(pitch, 110);
  return { synth: s, ...render(s, seconds) };
}

const window = (buffer: Float32Array, from: number, to: number) =>
  buffer.subarray(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE));

/** Fundamental from the autocorrelation peak near the expected period (robust to overtones). */
function pitchNear(buffer: Float32Array, expected: number): number {
  const period = SAMPLE_RATE / expected;
  let best = 0;
  let bestLag = period;
  for (let lag = Math.floor(period * 0.9); lag <= Math.ceil(period * 1.1); lag++) {
    let sum = 0;
    for (let i = 0; i + lag < buffer.length; i++) sum += buffer[i]! * buffer[i + lag]!;
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  // Parabolic interpolation around the best whole lag.
  const at = (lag: number) => {
    let sum = 0;
    for (let i = 0; i + lag < buffer.length; i++) sum += buffer[i]! * buffer[i + lag]!;
    return sum;
  };
  const a = at(bestLag - 1);
  const b = at(bestLag);
  const c = at(bestLag + 1);
  const shift = (a - c) / (2 * (a - 2 * b + c));
  return SAMPLE_RATE / (bestLag + (Number.isFinite(shift) ? shift : 0));
}

const cents = (measured: number, expected: number) => 1200 * Math.log2(measured / expected);

describe('PluckSynth', () => {
  it('is registered as "synth.pluck"', () => {
    expect(createSynth('synth.pluck', SAMPLE_RATE)).toBeInstanceOf(PluckSynth);
  });

  it('is silent without notes', () => {
    expect(peak(render(synth(), 0.1).left)).toBe(0);
  });

  it('plays in tune across the keyboard, within a few cents', () => {
    for (const pitch of [28, 40, 52, 64, 76, 88, 96]) {
      for (const damping of [0, 0.5, 1]) {
        const { left } = play({ damping, decay: 4 }, pitch, 0.4);
        const expected = noteFrequency(pitch);
        const measured = pitchNear(window(left, 0.1, 0.4), expected);
        expect(
          Math.abs(cents(measured, expected)),
          `pitch ${pitch}, damping ${damping}`,
        ).toBeLessThan(5);
      }
    }
  });

  it('stays close to pitch with stiffness (the overtones spread, not the note)', () => {
    const { left } = play({ stiffness: 0.6, decay: 4 }, 57, 0.4);
    const expected = noteFrequency(57);
    expect(Math.abs(cents(pitchNear(window(left, 0.1, 0.4), expected), expected))).toBeLessThan(15);
  });

  it('rings longer with more Decay', () => {
    const short = play({ decay: 0.3 }, 57, 1.5).left;
    const long = play({ decay: 5 }, 57, 1.5).left;
    expect(rms(window(long, 1, 1.5))).toBeGreaterThan(rms(window(short, 1, 1.5)) * 10);
  });

  it('more damping makes the tail darker', () => {
    const zeroCrossings = (buffer: Float32Array) => {
      let count = 0;
      for (let i = 1; i < buffer.length; i++) if (buffer[i - 1]! < 0 !== buffer[i]! < 0) count++;
      return count;
    };
    const bright = play({ damping: 0, brightness: 1 }, 45, 0.6).left;
    const dark = play({ damping: 1, brightness: 1 }, 45, 0.6).left;
    expect(zeroCrossings(window(dark, 0.3, 0.6))).toBeLessThan(
      zeroCrossings(window(bright, 0.3, 0.6)),
    );
  });

  it('releasing the key stops it ringing after Release', () => {
    const s = synth({ decay: 8, release: 0.1 });
    s.noteOn(57, 110);
    render(s, 0.2);
    s.noteOff(57);
    render(s, 0.5);
    expect(s.activeVoices).toBe(0);
  });

  it('a bowed string sustains while held and stops when let go', () => {
    const s = synth({ excite: PluckExcite.Bow, decay: 1, release: 0.1 });
    s.noteOn(57, 110);
    const held = render(s, 2).left;
    // Still going strong at the end, about as loud as early on.
    const early = rms(window(held, 0.5, 1));
    const late = rms(window(held, 1.5, 2));
    expect(late).toBeGreaterThan(0.02);
    expect(late).toBeGreaterThan(early * 0.5);
    expect(peak(held)).toBeLessThan(2);
    s.noteOff(57);
    render(s, 1);
    expect(s.activeVoices).toBe(0);
  });

  it('bowing works across the keyboard, at any damping', () => {
    for (const pitch of [33, 57, 84, 100]) {
      for (const damping of [0, 1]) {
        const s = synth({ excite: PluckExcite.Bow, decay: 2, damping });
        s.noteOn(pitch, 110);
        const out = render(s, 1.5).left;
        const late = rms(window(out, 1, 1.5));
        expect(late, `pitch ${pitch}, damping ${damping}`).toBeGreaterThan(0.015);
        expect(peak(out), `pitch ${pitch}, damping ${damping}`).toBeLessThan(2);
      }
    }
  });

  it('a mallet strike sounds and is in tune', () => {
    const { left } = play({ excite: PluckExcite.Strike, decay: 3 }, 64, 0.4);
    const expected = noteFrequency(64);
    expect(peak(left)).toBeGreaterThan(0.05);
    expect(Math.abs(cents(pitchNear(window(left, 0.1, 0.4), expected), expected))).toBeLessThan(5);
  });

  it('is mono with one string and wide with Double', () => {
    const difference = (double: number) => {
      const { left, right } = play({ double }, 57, 0.5);
      let sum = 0;
      for (let i = 0; i < left.length; i++) sum += Math.abs(left[i]! - right[i]!);
      return sum / left.length;
    };
    expect(difference(0)).toBe(0);
    expect(difference(1)).toBeGreaterThan(0.005);
  });

  it('the body adds its resonance', () => {
    const plain = play({ body: 0 }, 40, 0.5).left;
    const body = play({ body: 1 }, 40, 0.5).left;
    let difference = 0;
    for (let i = 0; i < plain.length; i++) difference += Math.abs(plain[i]! - body[i]!);
    expect(difference / plain.length).toBeGreaterThan(0.005);
  });

  it('stays finite and bounded when pushed hard', () => {
    const s = synth({ body: 1, double: 1, stiffness: 1, decay: 10, brightness: 1 });
    for (const pitch of [24, 36, 48, 60, 72, 84, 96, 108]) s.noteOn(pitch, 127);
    const { left, right } = render(s, 1);
    for (const buffer of [left, right]) {
      expect(buffer.every(Number.isFinite)).toBe(true);
      expect(peak(buffer)).toBeLessThan(4);
    }
  });

  it('goes idle once a note has died away', () => {
    const s = synth({ decay: 0.3 });
    s.noteOn(57, 110);
    render(s, 1.5);
    expect(s.activeVoices).toBe(0);
  });
});
