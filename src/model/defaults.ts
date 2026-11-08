import { DEFAULT_BPM, DEFAULT_TRACK_COUNT, PROJECT_FORMAT_VERSION } from './constants';
import { createId } from './ids';
import type { Preset, Project, Track } from './types';

export function createPreset(name = 'Init'): Preset {
  return {
    id: createId(),
    name,
    sequencers: [],
    // Params are filled from the box descriptor once the box registry exists (Phase 1).
    synth: { id: createId(), type: 'synth.pulse', params: {} },
    effects: [],
  };
}

export function createTrack(index: number): Track {
  return {
    id: createId(),
    name: `Track ${index + 1}`,
    volume: 0.8,
    mute: false,
    solo: false,
    segments: [{ id: createId(), startTick: 0, preset: createPreset() }],
    clips: [],
  };
}

export function createProject(trackCount = DEFAULT_TRACK_COUNT): Project {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name: 'Untitled',
    masterVolume: 0.8,
    tempoMap: {
      tempos: [{ tick: 0, bpm: DEFAULT_BPM, ramp: 'step' }],
      meters: [{ tick: 0, numerator: 4, denominator: 4, subdivision: 16 }],
    },
    tracks: Array.from({ length: trackCount }, (_, i) => createTrack(i)),
  };
}
