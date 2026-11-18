/**
 * What the synth screens draw: one cycle of a synth's oscillator and its ADSR envelope, worked
 * out from the box's params (pure functions, so they're testable without a DOM).
 */
import { FM_RATIOS } from '../../model/boxes/fm-synth';
import { getBoxDescriptor, paramValue } from '../../model/boxes/registry';
import { WAVE_LENGTH, WAVES } from '../../model/boxes/wave-synth';
import { toNormalized } from '../../model/scale';
import type { BoxInstance } from '../../model/types';
import { sine, steppedTriangle, stepLfsr } from '../../engine/oscillators';

/** A point on a screen, both coordinates 0..1 (y: 0 bottom, 1 top). */
export interface Point {
  x: number;
  y: number;
}

/** Reads a param of `box` by id (its default when unset), or `fallback` if the box has none. */
function reader(box: BoxInstance) {
  const descriptor = getBoxDescriptor(box.type);
  return (id: string, fallback = 0) => {
    const param = descriptor?.params.find((p) => p.id === id);
    return param ? paramValue(box, param) : fallback;
  };
}

const frac = (x: number) => x - Math.floor(x);
/** -1..1 to the 0..1 screen range, with a little headroom. */
const toY = (v: number) => 0.5 + Math.max(-1, Math.min(1, v)) * 0.45;

/** Samples `fn` (phase 0..1 → -1..1) as a smooth line. */
function sampled(fn: (phase: number) => number, count = 160): Point[] {
  return Array.from({ length: count + 1 }, (_, i) => ({ x: i / count, y: toY(fn(i / count)) }));
}

/** Steps through `values` (-1..1) as a staircase, each value held for an equal width. */
function stepped(values: readonly number[]): Point[] {
  const points: Point[] = [];
  values.forEach((v, i) => {
    const y = toY(v);
    points.push({ x: i / values.length, y }, { x: (i + 1) / values.length, y });
  });
  return points;
}

/** Hard-edged pulse with duty `duty` (high, then low). */
function pulseLine(duty: number): Point[] {
  const high = toY(1);
  const low = toY(-1);
  return [
    { x: 0, y: low },
    { x: 0, y: high },
    { x: duty, y: high },
    { x: duty, y: low },
    { x: 1, y: low },
    { x: 1, y: high },
  ];
}

/** A run of LFSR noise as ±1 steps (`tap` 1 hiss, 6 metallic), from a fixed seed. */
function noise(tap: number, count: number): number[] {
  let register = 1;
  return Array.from({ length: count }, () => {
    register = stepLfsr(register, tap);
    return register & 1 ? -0.8 : 0.8;
  });
}

/**
 * One cycle of the synth's oscillator as a line across the screen (noise: a short run of it),
 * or null for a box that isn't a synth this knows.
 */
export function waveShape(box: BoxInstance): Point[] | null {
  const read = reader(box);
  switch (box.type) {
    case 'synth.chip': {
      const wave = Math.round(read('wave', 2));
      if (wave <= 2) return pulseLine([0.125, 0.25, 0.5][wave]!);
      if (wave === 3) return stepped(Array.from({ length: 32 }, (_, i) => steppedTriangle(i / 32)));
      return stepped(noise(wave === 4 ? 1 : 6, 40));
    }
    case 'synth.wave': {
      const index = Math.round(read('wave'));
      const morph = Math.min(1, Math.max(0, read('morph')));
      const from = WAVES[index]?.steps ?? WAVES[0]!.steps;
      const to = WAVES[(index + 1) % WAVES.length]!.steps;
      const levels = Array.from({ length: WAVE_LENGTH }, (_, i) =>
        Math.round(from[i]! + (to[i]! - from[i]!) * morph),
      );
      return stepped(levels.map((l) => l / 7.5 - 1));
    }
    case 'synth.fm': {
      // The carrier at the start of a note (modulator envelope at its peak, full velocity).
      const ratio = FM_RATIOS[Math.round(read('ratio', 1))] ?? 1;
      const amount = read('amount');
      const index = amount * amount * 2;
      const feedback = read('feedback') ** 2 * 0.25;
      const count = 240;
      let previous1 = 0;
      let previous2 = 0;
      return Array.from({ length: count + 1 }, (_, i) => {
        const phase = i / count;
        const modulator = sine(phase * ratio + feedback * (previous1 + previous2) * 0.5);
        previous2 = previous1;
        previous1 = modulator;
        return { x: phase, y: toY(sine(phase + modulator * index)) };
      });
    }
    case 'synth.sid': {
      const wave = Math.round(read('wave', 2));
      if (wave === 3) return stepped(noise(1, 40));
      const width = read('width', 0.5);
      const mod = Math.round(read('mod'));
      const ratio = 2 ** (read('modPitch', 7) / 12);
      const shape = (phase: number) =>
        wave === 0
          ? 4 * Math.abs(phase - 0.5) - 1
          : wave === 1
            ? 2 * phase - 1
            : phase < width
              ? 1
              : -1;
      if (mod === 2) return sampled((t) => shape(frac(t * ratio)), 240);
      if (mod === 1) return sampled((t) => shape(t) * (frac(t * ratio) < 0.5 ? 1 : -1), 240);
      if (wave === 2) return pulseLine(width);
      return sampled(shape);
    }
    case 'synth.analog': {
      // Two cycles of osc 1 (so the sub, an octave down, shows a whole cycle), mixed with osc 2.
      const shape = (wave: number, phase: number) =>
        wave === 0
          ? 2 * phase - 1
          : wave === 1
            ? phase < 0.5
              ? 1
              : -1
            : wave === 2
              ? 1 - 4 * Math.abs(phase - 0.5)
              : Math.sin(2 * Math.PI * phase);
      const wave1 = Math.round(read('osc1Wave'));
      const wave2 = Math.round(read('osc2Wave'));
      const ratio = 2 ** (read('osc2Pitch') / 12);
      const mix = read('mix', 0.5);
      const sub = read('sub') * 0.8;
      const scale = 1 / (1 + sub);
      return sampled((t) => {
        const phase = 2 * t;
        const value =
          (1 - mix) * shape(wave1, frac(phase)) +
          mix * shape(wave2, frac(phase * ratio)) +
          sub * (t < 0.5 ? 1 : -1);
        return value * scale;
      }, 320);
    }
    default:
      return null;
  }
}

/** The envelope's four stages, each a line to draw in its knob's color. */
export interface EnvelopeShape {
  attack: Point[];
  decay: Point[];
  sustain: Point[];
  release: Point[];
}

/** Widths of the stages: each grows with its knob position, so short times stay visible. */
const MIN_STAGE = 0.05;
const STAGE_RANGE = 0.25;
const CURVE_POINTS = 32;

/** An exponential fall from `from` to `to` (60 dB over the stage), like the engine's. */
function fall(x0: number, width: number, from: number, to: number): Point[] {
  return Array.from({ length: CURVE_POINTS + 1 }, (_, i) => {
    const t = i / CURVE_POINTS;
    // Scaled so the curve lands exactly on `to` at the end.
    const k = (Math.pow(1e-3, t) - 1e-3) / (1 - 1e-3);
    return { x: x0 + t * width, y: to + (from - to) * k };
  });
}

/**
 * The ADSR envelope from params `ids` (attack, decay, sustain, release) of `box`, or null if
 * it lacks one of them. Times are placed by knob position (their exp scale), not to scale.
 */
export function envelopeShape(
  box: BoxInstance,
  ids: { attack: string; decay: string; sustain: string; release: string } = {
    attack: 'attack',
    decay: 'decay',
    sustain: 'sustain',
    release: 'release',
  },
  /** For an envelope with a fixed attack (FM's modulator): its attack time. */
  fixedAttack?: number,
): EnvelopeShape | null {
  const descriptor = getBoxDescriptor(box.type);
  const param = (id: string) => descriptor?.params.find((p) => p.id === id);
  const decay = param(ids.decay);
  const sustain = param(ids.sustain);
  const release = param(ids.release);
  const attack = fixedAttack === undefined ? param(ids.attack) : param('attack');
  if (!attack || !decay || !sustain || !release) return null;
  const width = (p: typeof attack, value = paramValue(box, p)) =>
    MIN_STAGE + STAGE_RANGE * toNormalized(value, p.min, p.max, p.scale);

  const a = width(attack, fixedAttack);
  const d = width(decay);
  const r = width(release);
  const level = Math.min(1, Math.max(0, paramValue(box, sustain)));
  const top = 0.95;
  const s = level * top;
  const sustainEnd = 1 - r;
  return {
    attack: [
      { x: 0, y: 0 },
      { x: a, y: top },
    ],
    decay: fall(a, d, top, s),
    sustain: [
      { x: a + d, y: s },
      { x: sustainEnd, y: s },
    ],
    release: fall(sustainEnd, r, s, 0),
  };
}

/** An SVG path through `points`, mapped onto a `width`×`height` box. */
export function svgPath(points: readonly Point[], width: number, height: number): string {
  return points
    .map((p, i) => `${i ? 'L' : 'M'}${(p.x * width).toFixed(1)} ${((1 - p.y) * height).toFixed(1)}`)
    .join('');
}

/**
 * A tiny icon for a wave choice (an SVG path in a 24×12 box), or undefined when the param
 * isn't a waveform this knows. Used on the wave selector buttons.
 */
export function waveIcon(boxType: string, paramId: string, value: number): string | undefined {
  const saw = 'M2 10L12 2V10L22 2V10';
  if (boxType === 'synth.analog' && (paramId === 'osc1Wave' || paramId === 'osc2Wave')) {
    return [
      saw,
      'M2 10V2H12V10H22V2',
      'M2 10L7 2L12 10L17 2L22 10',
      'M2 6C5 -1 9 -1 12 6S19 13 22 6',
    ][value];
  }
  if (paramId !== 'wave') return undefined;
  const pulse = (duty: number) => `M2 10V2H${(2 + 20 * duty).toFixed(1)}V10H22V2`;
  const tri = 'M2 10L7 2L12 10L17 2L22 10';
  const noiseIcon = 'M2 6H4V2H6V9H8V4H10V10H12V3H14V7H16V2H18V9H20V5H22';
  if (boxType === 'synth.chip') {
    return [
      pulse(0.125),
      pulse(0.25),
      pulse(0.5),
      'M2 10H4V8H6V6H8V4H10V2H12V4H14V6H16V8H18V10H20V8H22',
      noiseIcon,
      'M2 6H4V2H6V10H8V2H10V10H12V6H14V2H16V10H18V2H20V10H22V6',
    ][value];
  }
  if (boxType === 'synth.sid') {
    return [tri, saw, pulse(0.5), noiseIcon][value];
  }
  return undefined;
}
