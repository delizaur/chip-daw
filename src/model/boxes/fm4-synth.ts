import type { BoxDescriptor, ParamDescriptor } from './types';

/** Operator frequency ratios: param value i plays `FM4_RATIOS[i]` times the note. */
export const FM4_RATIOS = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;

/**
 * The algorithms (as on 4-operator FM chips): which operators modulate which, and which are
 * heard (carriers). Operators only modulate lower-numbered ones, so they're computed from 4
 * down to 1; operator 4 has feedback.
 */
export const FM4_ALGORITHMS: readonly {
  /** modulators[op - 1]: the operators modulating `op`. */
  modulators: readonly (readonly number[])[];
  carriers: readonly number[];
}[] = [
  // 1: one stack, 4 → 3 → 2 → 1.
  { modulators: [[2], [3], [4], []], carriers: [1] },
  // 2: 3 and 4 together → 2 → 1.
  { modulators: [[2], [3, 4], [], []], carriers: [1] },
  // 3: 3 → 2, and 2 and 4 together → 1.
  { modulators: [[2, 4], [3], [], []], carriers: [1] },
  // 4: 4 → 3, and 2 and 3 together → 1.
  { modulators: [[2, 3], [], [4], []], carriers: [1] },
  // 5: two pairs, 2 → 1 and 4 → 3.
  { modulators: [[2], [], [4], []], carriers: [1, 3] },
  // 6: 4 modulates 1, 2 and 3.
  { modulators: [[4], [4], [4], []], carriers: [1, 2, 3] },
  // 7: 4 → 3, with 1 and 2 on their own.
  { modulators: [[], [], [4], []], carriers: [1, 2, 3] },
  // 8: all four on their own (additive, like an organ's drawbars).
  { modulators: [[], [], [], []], carriers: [1, 2, 3, 4] },
];

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

const ratioLabel = (r: number) => (r === 0.5 ? '×½' : `×${r}`);

/** One operator's params, ids prefixed `op1`..`op4`. */
function operator(n: number, ratio: number, level: number, decay: number, sustain: number) {
  const group = `Op ${n}`;
  const id = (name: string) => `op${n}${name}`;
  return [
    knob(group, id('Ratio'), 'Ratio', 0, FM4_RATIOS.length - 1, FM4_RATIOS.indexOf(ratio as 1), {
      step: 1,
      steps: FM4_RATIOS.map(ratioLabel),
      control: 'knob',
      unit: undefined,
    }),
    knob(group, id('Detune'), 'Detune', -50, 50, 0, { step: 1, unit: 'ct' }),
    knob(group, id('Level'), 'Level', 0, 1, level),
    knob(group, id('Attack'), 'Attack', 0.001, 4, 0.002, { scale: 'exp', unit: 's' }),
    knob(group, id('Decay'), 'Decay', 0.001, 8, decay, { scale: 'exp', unit: 's' }),
    knob(group, id('Sustain'), 'Sustain', 0, 1, sustain),
  ];
}

/**
 * Four-operator FM synth (DX / Mega Drive style): four sine operators, each with its own
 * ratio, detune, level and envelope, wired by one of 8 algorithms; operator 4 has feedback.
 * A carrier's level is its volume; a modulator's is how much it bends the others (its
 * brightness). Polyphonic.
 */
export const FM4_SYNTH: BoxDescriptor = {
  type: 'synth.fm4',
  kind: 'synth',
  name: 'FM 4-op',
  params: [
    knob('Algorithm', 'algorithm', 'Algorithm', 0, FM4_ALGORITHMS.length - 1, 0, {
      step: 1,
      steps: FM4_ALGORITHMS.map((_, i) => String(i + 1)),
      control: 'knob',
      unit: undefined,
    }),
    knob('Algorithm', 'feedback', 'Feedback', 0, 1, 0),
    // Output next: the editor shows sections two to a column (Algorithm over Output, then
    // the operators in pairs).
    knob('Output', 'release', 'Release', 0.001, 8, 0.3, { scale: 'exp', unit: 's' }),
    knob('Output', 'level', 'Level', 0, 1, 0.7),
    knob('Output', 'transpose', 'Transpose', -24, 24, 0, { step: 1, unit: 'st' }),
    knob('Output', 'fine', 'Fine', -100, 100, 0, { step: 1, unit: 'ct' }),
    // A classic electric-piano-ish default: bright attack fading to a mellow tone.
    ...operator(1, 1, 0.8, 1.5, 0.4),
    ...operator(2, 1, 0.45, 0.6, 0.2),
    ...operator(3, 2, 0.3, 0.4, 0.1),
    ...operator(4, 1, 0.2, 0.3, 0),
  ],
};
