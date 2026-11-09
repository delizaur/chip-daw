import { createBox, DEFAULT_SYNTH_TYPE } from './boxes/registry';
import { DEFAULT_BPM, DEFAULT_TRACK_COUNT, PROJECT_FORMAT_VERSION } from './constants';
import { createId } from './ids';
import type { Preset, Project, Track } from './types';

export function createPreset(name = 'Init'): Preset {
  return {
    id: createId(),
    name,
    sequencers: [],
    synth: createBox(DEFAULT_SYNTH_TYPE),
    effects: [],
  };
}

/** A track with the given track preset (which the caller adds to `Project.presets`). */
export function createTrack(index: number, presetId: string): Track {
  return {
    id: createId(),
    name: `Track ${index + 1}`,
    volume: 0.8,
    mute: false,
    solo: false,
    presetId,
    clips: [],
  };
}

export function createProject(trackCount = DEFAULT_TRACK_COUNT): Project {
  const presets = Array.from({ length: trackCount }, () => createPreset());
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name: 'Untitled',
    masterVolume: 0.8,
    tempoMap: {
      tempos: [{ tick: 0, bpm: DEFAULT_BPM, ramp: 'step' }],
      meters: [{ tick: 0, numerator: 4, denominator: 4, subdivision: 16 }],
    },
    presets,
    tracks: presets.map((preset, i) => createTrack(i, preset.id)),
  };
}
