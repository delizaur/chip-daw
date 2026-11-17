import type { BoxDescriptor } from './types';

/** Waveform values of the SID synth's `wave` param. */
export const SidWave = { Triangle: 0, Saw: 1, Pulse: 2, Noise: 3 } as const;

/** Values of the `mod` param: what the second oscillator does. */
export const SidMod = { Off: 0, Ring: 1, Sync: 2 } as const;

/** Values of the `filter` param. */
export const SidFilter = { Off: 0, LowPass: 1, BandPass: 2, HighPass: 3 } as const;

/**
 * SID-style synth (the Commodore 64's sound chip): triangle, saw, pulse (with width and a
 * built-in PWM sweep) or noise; a second oscillator for ring modulation or hard sync; and a
 * resonant low/band/high-pass filter shared by all voices, like the chip's single filter.
 * Polyphonic, with an ADSR envelope.
 */
export const SID_SYNTH: BoxDescriptor = {
  type: 'synth.sid',
  kind: 'synth',
  name: 'SID',
  params: [
    {
      id: 'wave',
      name: 'Wave',
      min: 0,
      max: 3,
      default: SidWave.Pulse,
      scale: 'linear',
      step: 1,
      steps: ['Tri', 'Saw', 'Pulse', 'Noise'],
    },
    {
      id: 'mod',
      name: 'Mod',
      min: 0,
      max: 2,
      default: SidMod.Off,
      scale: 'linear',
      step: 1,
      steps: ['Off', 'Ring', 'Sync'],
    },
    {
      id: 'filter',
      name: 'Filter',
      min: 0,
      max: 3,
      default: SidFilter.Off,
      scale: 'linear',
      step: 1,
      steps: ['Off', 'Low', 'Band', 'High'],
    },
    { id: 'width', name: 'Width', min: 0.05, max: 0.95, default: 0.5, scale: 'linear', unit: '%' },
    { id: 'pwmRate', name: 'PWM rate', min: 0.1, max: 10, default: 2, scale: 'exp', unit: 'Hz' },
    { id: 'pwmDepth', name: 'PWM depth', min: 0, max: 1, default: 0, scale: 'linear', unit: '%' },
    {
      id: 'modPitch',
      name: 'Mod pitch',
      min: -24,
      max: 24,
      default: 7,
      scale: 'linear',
      step: 1,
      unit: 'st',
    },
    { id: 'cutoff', name: 'Cutoff', min: 30, max: 12000, default: 2000, scale: 'exp', unit: 'Hz' },
    { id: 'resonance', name: 'Reso', min: 0, max: 1, default: 0.3, scale: 'linear', unit: '%' },
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
