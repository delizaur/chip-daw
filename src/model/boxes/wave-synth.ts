import type { BoxDescriptor } from './types';

/** Samples per wave cycle and the levels each sample can take (4-bit, like the Game Boy). */
export const WAVE_LENGTH = 32;
export const WAVE_LEVELS = 16;

const cycle = (fn: (x: number) => number) =>
  Array.from({ length: WAVE_LENGTH }, (_, i) => fn((2 * Math.PI * i) / WAVE_LENGTH));

/** Scales a cycle to 0..15 (4-bit) and rounds it. */
function quantize(values: number[]): number[] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return values.map((v) =>
    Math.round(((v - low) / Math.max(1e-9, high - low)) * (WAVE_LEVELS - 1)),
  );
}

/**
 * The preset waves, as 32 steps of 0..15. Param value i plays `WAVES[i]`; Morph blends towards
 * the next one.
 */
export const WAVES: readonly { name: string; steps: readonly number[] }[] = [
  { name: 'Sine', steps: quantize(cycle(Math.sin)) },
  { name: 'Triangle', steps: quantize(cycle((x) => Math.asin(Math.sin(x)))) },
  { name: 'Saw', steps: quantize(cycle((x) => -(((x / Math.PI + 1) % 2) - 1))) },
  { name: 'Square', steps: quantize(cycle((x) => (x < Math.PI ? 1 : -1))) },
  { name: 'Pulse 25%', steps: quantize(cycle((x) => (x < Math.PI / 2 ? 1 : -1))) },
  {
    name: 'Organ',
    steps: quantize(cycle((x) => Math.sin(x) + 0.5 * Math.sin(2 * x) + 0.3 * Math.sin(4 * x))),
  },
  {
    name: 'Vocal',
    steps: quantize(cycle((x) => Math.sin(x) + 0.7 * Math.sin(3 * x) + 0.5 * Math.sin(5 * x))),
  },
  {
    name: 'Bright',
    steps: quantize(
      cycle(
        (x) => Math.sin(x) + 0.6 * Math.sin(6 * x) + 0.4 * Math.sin(9 * x) + 0.3 * Math.sin(13 * x),
      ),
    ),
  },
];

/**
 * Game Boy-style wavetable synth: plays a 32-step, 4-bit wave (as on the Game Boy's wave
 * channel), chosen from preset waves, with Morph blending towards the next wave. Polyphonic,
 * with an ADSR envelope.
 */
export const WAVE_SYNTH: BoxDescriptor = {
  type: 'synth.wave',
  kind: 'synth',
  name: 'Wave',
  params: [
    {
      id: 'wave',
      name: 'Wave',
      min: 0,
      max: WAVES.length - 1,
      default: 0,
      scale: 'linear',
      step: 1,
      steps: WAVES.map((w) => w.name),
    },
    { id: 'morph', name: 'Morph', min: 0, max: 1, default: 0, scale: 'linear', unit: '%' },
    { id: 'attack', name: 'Attack', min: 0.001, max: 2, default: 0.002, scale: 'exp', unit: 's' },
    { id: 'decay', name: 'Decay', min: 0.001, max: 2, default: 0.3, scale: 'exp', unit: 's' },
    { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 0.7, scale: 'linear', unit: '%' },
    { id: 'release', name: 'Release', min: 0.001, max: 4, default: 0.1, scale: 'exp', unit: 's' },
    { id: 'level', name: 'Level', min: 0, max: 1, default: 0.7, scale: 'linear', unit: '%' },
    {
      id: 'transpose',
      name: 'Transpose',
      min: -24,
      max: 24,
      default: 0,
      scale: 'linear',
      step: 1,
      unit: 'st',
    },
    {
      id: 'fine',
      name: 'Fine',
      min: -100,
      max: 100,
      default: 0,
      scale: 'linear',
      step: 1,
      unit: 'ct',
    },
  ],
};
