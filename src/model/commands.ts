import type { Draft } from 'immer';
import type { Command } from './history';
import type { Project, Track } from './types';

export type ProjectCommand = Command<Project>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function findTrack(project: Draft<Project>, trackId: string): Draft<Track> {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Track ${trackId} not found`);
  return track;
}

export function setMasterVolume(volume: number): ProjectCommand {
  return {
    label: 'Change master volume',
    recipe: (project) => {
      project.masterVolume = clamp01(volume);
    },
  };
}

export function setTrackVolume(trackId: string, volume: number): ProjectCommand {
  return {
    label: 'Change track volume',
    recipe: (project) => {
      findTrack(project, trackId).volume = clamp01(volume);
    },
  };
}

export function setTrackMute(trackId: string, mute: boolean): ProjectCommand {
  return {
    label: mute ? 'Mute track' : 'Unmute track',
    recipe: (project) => {
      findTrack(project, trackId).mute = mute;
    },
  };
}

export function setTrackSolo(trackId: string, solo: boolean): ProjectCommand {
  return {
    label: solo ? 'Solo track' : 'Unsolo track',
    recipe: (project) => {
      findTrack(project, trackId).solo = solo;
    },
  };
}
