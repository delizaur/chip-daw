import type { BoxDescriptor, ParamDescriptor } from './types';

/** Values of the `excite` param: how the string is set vibrating. */
export const PluckExcite = { Pluck: 0, Strike: 1, Bow: 2 } as const;

const knob = (
  group: string,
  id: string,
  name: string,
  min: number,
  max: number,
  value: number,
  extra: Partial<ParamDescriptor> = {},
): ParamDescriptor => ({
  id,
  name,
  min,
  max,
  default: value,
  scale: 'linear',
  unit: '%',
  group,
  ...extra,
});

/**
 * Physical-model string synth (Karplus–Strong, extended): a burst of noise or a mallet hit
 * rings in a delay line tuned to the note, losing its highs as it decays, like a plucked or
 * struck string. Stiffness spreads the overtones (towards piano wire and bells), the pick
 * position shapes the tone, a bow keeps the string going while the key is held, and a wooden
 * body resonates under it all. Polyphonic, in stereo (Double adds a second, detuned string).
 */
export const PLUCK_SYNTH: BoxDescriptor = {
  type: 'synth.pluck',
  kind: 'synth',
  name: 'Pluck',
  params: [
    {
      id: 'excite',
      name: 'Mode',
      min: 0,
      max: 2,
      default: PluckExcite.Pluck,
      scale: 'linear',
      step: 1,
      steps: ['Pluck', 'Strike', 'Bow'],
      group: 'Excite',
    },
    knob('Excite', 'brightness', 'Bright', 0, 1, 0.6),
    knob('Excite', 'position', 'Position', 0.02, 0.5, 0.15),
    knob('String', 'decay', 'Decay', 0.1, 10, 2, { scale: 'exp', unit: 's' }),
    knob('String', 'damping', 'Damping', 0, 1, 0.4),
    knob('String', 'stiffness', 'Stiffness', 0, 1, 0),
    knob('Body', 'body', 'Body', 0, 1, 0.3),
    knob('Body', 'bodySize', 'Size', 0, 1, 0.5),
    knob('Body', 'double', 'Double', 0, 1, 0),
    knob('Output', 'release', 'Release', 0.02, 2, 0.15, { scale: 'exp', unit: 's' }),
    knob('Output', 'level', 'Level', 0, 1, 0.7),
    knob('Output', 'transpose', 'Transpose', -24, 24, 0, { step: 1, unit: 'st' }),
    knob('Output', 'fine', 'Fine', -100, 100, 0, { step: 1, unit: 'ct' }),
  ],
};
