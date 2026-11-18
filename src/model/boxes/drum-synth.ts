import type { BoxDescriptor, ParamDescriptor } from './types';

/**
 * The drums, one per note of the octave (any octave): index = pitch class. Laid out after
 * General MIDI where it can be (kick on C, snare on D, clap on D♯, closed hat on F♯, open hat
 * on A♯), so drum parts from elsewhere land roughly right.
 */
export const DRUM_SOUNDS = [
  { id: 'kick', name: 'Kick', short: 'K' },
  { id: 'rim', name: 'Rim', short: 'R' },
  { id: 'snare', name: 'Snare', short: 'S' },
  { id: 'clap', name: 'Clap', short: 'C' },
  { id: 'tomLow', name: 'Low tom', short: 'T1' },
  { id: 'tomMid', name: 'Mid tom', short: 'T2' },
  { id: 'hatClosed', name: 'Closed hat', short: 'CH' },
  { id: 'tomHigh', name: 'High tom', short: 'T3' },
  { id: 'shaker', name: 'Shaker', short: 'SH' },
  { id: 'cowbell', name: 'Cowbell', short: 'CB' },
  { id: 'hatOpen', name: 'Open hat', short: 'OH' },
  { id: 'cymbal', name: 'Cymbal', short: 'CY' },
] as const;

export type DrumSound = (typeof DRUM_SOUNDS)[number]['id'];

/** The drum a note plays. */
export const drumForPitch = (pitch: number): DrumSound =>
  DRUM_SOUNDS[((Math.round(pitch) % 12) + 12) % 12]!.id;

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
  group,
  ...extra,
});

const seconds = { scale: 'exp', unit: 's' } as const;
const percent = { unit: '%' } as const;
const hertz = { scale: 'exp', unit: 'Hz' } as const;

/**
 * Drum synth: a whole kit, synthesized (no samples), one drum per note of the octave (see
 * `DRUM_SOUNDS`). Kick, snare, hats and toms have their own knobs; the rim, clap, shaker,
 * cowbell and cymbal follow the closest ones (the clap the snare's, the cymbal the hats').
 * One-shot: note-offs are ignored. The closed hat cuts off the open hat.
 */
export const DRUM_SYNTH: BoxDescriptor = {
  type: 'synth.drums',
  kind: 'synth',
  name: 'Drums',
  params: [
    knob('Kick', 'kickTune', 'Tune', 30, 120, 50, hertz),
    knob('Kick', 'kickDecay', 'Decay', 0.05, 2, 0.45, seconds),
    knob('Kick', 'kickPunch', 'Punch', 0, 1, 0.5, percent),
    knob('Kick', 'kickDrive', 'Drive', 0, 1, 0.2, percent),
    knob('Snare', 'snareTune', 'Tune', 100, 400, 190, hertz),
    knob('Snare', 'snareDecay', 'Decay', 0.05, 1, 0.2, seconds),
    knob('Snare', 'snareSnappy', 'Snappy', 0, 1, 0.6, percent),
    knob('Snare', 'snareTone', 'Tone', 1000, 12000, 4000, hertz),
    knob('Hats', 'hatClosed', 'Closed', 0.01, 0.4, 0.05, seconds),
    knob('Hats', 'hatOpen', 'Open', 0.1, 2, 0.4, seconds),
    knob('Hats', 'hatTone', 'Tone', 0, 1, 0.5, percent),
    knob('Toms', 'tomTune', 'Tune', 60, 240, 110, hertz),
    knob('Toms', 'tomDecay', 'Decay', 0.05, 1.5, 0.35, seconds),
    knob('Kit', 'level', 'Level', 0, 1, 0.8, percent),
    knob('Kit', 'pitch', 'Pitch', -12, 12, 0, { step: 1, unit: 'st' }),
    knob('Kit', 'width', 'Width', 0, 1, 0.5, percent),
  ],
};
