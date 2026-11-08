import type { BoxDescriptor } from './types';

/** Waveform values of the chip synth's `wave` param. */
export const ChipWave = {
  Pulse12: 0,
  Pulse25: 1,
  Pulse50: 2,
  Triangle: 3,
  Noise: 4,
  MetalNoise: 5,
} as const;

/**
 * NES-style synth: pulse waves with three duty cycles, a 4-bit stepped triangle,
 * and LFSR noise (long "hiss" and short "metallic" modes). Polyphonic, with an ADSR envelope.
 */
export const CHIP_SYNTH: BoxDescriptor = {
  type: 'synth.chip',
  kind: 'synth',
  name: 'Chip',
  params: [
    {
      id: 'wave',
      name: 'Wave',
      min: 0,
      max: 5,
      default: ChipWave.Pulse50,
      scale: 'linear',
      step: 1,
      steps: ['12.5%', '25%', '50%', 'Tri', 'Noise', 'Metal'],
    },
    { id: 'attack', name: 'Attack', min: 0.001, max: 2, default: 0.002, scale: 'exp', unit: 's' },
    { id: 'decay', name: 'Decay', min: 0.001, max: 2, default: 0.2, scale: 'exp', unit: 's' },
    { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 0.6, scale: 'linear', unit: '%' },
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
