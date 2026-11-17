import type { BoxDescriptor, ParamDescriptor } from './types';

/** Waveform values of the analog synth's `osc1Wave` and `osc2Wave` params. */
export const AnalogWave = { Saw: 0, Square: 1, Triangle: 2, Sine: 3 } as const;

/** Values of the `filterType` param. */
export const AnalogFilter = { LowPass24: 0, LowPass12: 1, BandPass: 2, HighPass: 3 } as const;

/** Values of the `lfoTarget` param. */
export const AnalogLfoTarget = { Pitch: 0, Filter: 1, Amp: 2 } as const;

/** Most copies of each oscillator per note (the `unison` param: 1, 3, 5 or 7). */
export const MAX_UNISON = 7;

const WAVE_NAMES = ['Saw', 'Square', 'Tri', 'Sine'];

const enumParam = (id: string, name: string, steps: string[], value: number, group: string) =>
  ({
    id,
    name,
    min: 0,
    max: steps.length - 1,
    default: value,
    scale: 'linear',
    step: 1,
    steps,
    group,
  }) satisfies ParamDescriptor;

/**
 * Virtual-analog (subtractive) synth, beyond chiptune: two oscillators (saw, square, triangle
 * or sine) with detune, a sub oscillator, "supersaw" unison spread across the stereo field, a
 * resonant 4-pole ladder filter with drive and its own envelope, an LFO and glide.
 * Polyphonic, in stereo.
 */
export const ANALOG_SYNTH: BoxDescriptor = {
  type: 'synth.analog',
  kind: 'synth',
  name: 'Analog',
  params: [
    // Oscillators.
    enumParam('osc1Wave', 'Osc 1', WAVE_NAMES, AnalogWave.Saw, 'Osc'),
    enumParam('osc2Wave', 'Osc 2', WAVE_NAMES, AnalogWave.Saw, 'Osc'),
    {
      id: 'osc2Pitch',
      name: 'Osc 2 pitch',
      min: -24,
      max: 24,
      default: 0,
      scale: 'linear',
      step: 1,
      unit: 'st',
      group: 'Osc',
    },
    {
      id: 'detune',
      name: 'Detune',
      min: 0,
      max: 50,
      default: 8,
      scale: 'linear',
      unit: 'ct',
      group: 'Osc',
    },
    {
      id: 'mix',
      name: 'Mix',
      min: 0,
      max: 1,
      default: 0.5,
      scale: 'linear',
      unit: '%',
      group: 'Osc',
    },
    {
      id: 'sub',
      name: 'Sub',
      min: 0,
      max: 1,
      default: 0,
      scale: 'linear',
      unit: '%',
      group: 'Osc',
    },
    {
      id: 'unison',
      name: 'Unison',
      min: 1,
      max: MAX_UNISON,
      default: 1,
      scale: 'linear',
      step: 2,
      group: 'Osc',
    },
    {
      id: 'spread',
      name: 'Spread',
      min: 0,
      max: 1,
      default: 0.4,
      scale: 'linear',
      unit: '%',
      group: 'Osc',
    },
    // Filter.
    enumParam(
      'filterType',
      'Filter',
      ['LP24', 'LP12', 'BP', 'HP'],
      AnalogFilter.LowPass24,
      'Filter',
    ),
    {
      id: 'cutoff',
      name: 'Cutoff',
      min: 30,
      max: 18000,
      default: 2500,
      scale: 'exp',
      unit: 'Hz',
      group: 'Filter',
    },
    {
      id: 'resonance',
      name: 'Reso',
      min: 0,
      max: 1,
      default: 0.2,
      scale: 'linear',
      unit: '%',
      group: 'Filter',
    },
    {
      id: 'drive',
      name: 'Drive',
      min: 0,
      max: 1,
      default: 0.1,
      scale: 'linear',
      unit: '%',
      group: 'Filter',
    },
    {
      id: 'envAmount',
      name: 'Env amt',
      min: -1,
      max: 1,
      default: 0.3,
      scale: 'linear',
      unit: '%',
      group: 'Filter',
    },
    {
      id: 'filterDecay',
      name: 'F decay',
      min: 0.001,
      max: 4,
      default: 0.4,
      scale: 'exp',
      unit: 's',
      group: 'Filter',
    },
    {
      id: 'filterSustain',
      name: 'F sustain',
      min: 0,
      max: 1,
      default: 0.2,
      scale: 'linear',
      unit: '%',
      group: 'Filter',
    },
    // Amp.
    {
      id: 'attack',
      name: 'Attack',
      min: 0.001,
      max: 4,
      default: 0.003,
      scale: 'exp',
      unit: 's',
      group: 'Amp',
    },
    {
      id: 'decay',
      name: 'Decay',
      min: 0.001,
      max: 4,
      default: 0.4,
      scale: 'exp',
      unit: 's',
      group: 'Amp',
    },
    {
      id: 'sustain',
      name: 'Sustain',
      min: 0,
      max: 1,
      default: 0.7,
      scale: 'linear',
      unit: '%',
      group: 'Amp',
    },
    {
      id: 'release',
      name: 'Release',
      min: 0.001,
      max: 8,
      default: 0.25,
      scale: 'exp',
      unit: 's',
      group: 'Amp',
    },
    {
      id: 'level',
      name: 'Level',
      min: 0,
      max: 1,
      default: 0.7,
      scale: 'linear',
      unit: '%',
      group: 'Amp',
    },
    // Modulation and tuning.
    enumParam('lfoTarget', 'LFO to', ['Pitch', 'Filter', 'Amp'], AnalogLfoTarget.Filter, 'Mod'),
    {
      id: 'lfoRate',
      name: 'LFO rate',
      min: 0.05,
      max: 20,
      default: 4,
      scale: 'exp',
      unit: 'Hz',
      group: 'Mod',
    },
    {
      id: 'lfoDepth',
      name: 'LFO depth',
      min: 0,
      max: 1,
      default: 0,
      scale: 'linear',
      unit: '%',
      group: 'Mod',
    },
    {
      id: 'glide',
      name: 'Glide',
      min: 0,
      max: 1,
      default: 0,
      scale: 'linear',
      unit: 's',
      group: 'Mod',
    },
    {
      id: 'transpose',
      name: 'Transpose',
      min: -24,
      max: 24,
      default: 0,
      scale: 'linear',
      step: 1,
      unit: 'st',
      group: 'Mod',
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
      group: 'Mod',
    },
  ],
};
