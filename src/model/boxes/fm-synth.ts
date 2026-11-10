import type { BoxDescriptor } from './types';

/** Modulator frequency ratios (Genesis-style multiples): param value i plays `FM_RATIOS[i]`. */
export const FM_RATIOS = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

/**
 * Two-operator FM synth (Sega Genesis / Mega Drive flavour): a modulator, at a multiple of the
 * note's frequency and with its own envelope and feedback, bends the phase of a sine carrier.
 * The modulator's envelope shapes the brightness over each note (bright attack fading to a
 * mellower sustain is most of FM's character); the carrier's envelope shapes its volume.
 * Polyphonic.
 */
export const FM_SYNTH: BoxDescriptor = {
  type: 'synth.fm',
  kind: 'synth',
  name: 'FM',
  params: [
    {
      id: 'ratio',
      name: 'Ratio',
      min: 0,
      max: FM_RATIOS.length - 1,
      default: 1,
      scale: 'linear',
      step: 1,
      steps: FM_RATIOS.map((r) => (r === 0.5 ? '×½' : `×${r}`)),
    },
    { id: 'amount', name: 'Amount', min: 0, max: 1, default: 0.4, scale: 'linear', unit: '%' },
    {
      id: 'modDecay',
      name: 'Mod decay',
      min: 0.005,
      max: 4,
      default: 0.3,
      scale: 'exp',
      unit: 's',
    },
    {
      id: 'modSustain',
      name: 'Mod sustain',
      min: 0,
      max: 1,
      default: 0.3,
      scale: 'linear',
      unit: '%',
    },
    { id: 'feedback', name: 'Feedback', min: 0, max: 1, default: 0, scale: 'linear', unit: '%' },
    { id: 'attack', name: 'Attack', min: 0.001, max: 2, default: 0.002, scale: 'exp', unit: 's' },
    { id: 'decay', name: 'Decay', min: 0.001, max: 2, default: 0.4, scale: 'exp', unit: 's' },
    { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 0.6, scale: 'linear', unit: '%' },
    { id: 'release', name: 'Release', min: 0.001, max: 4, default: 0.15, scale: 'exp', unit: 's' },
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
