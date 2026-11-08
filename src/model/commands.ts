import type { Draft } from 'immer';
import { constrainParam, getParamDescriptor } from './boxes/registry';
import type { Command } from './history';
import type { BoxInstance, Project, Track } from './types';

export type ProjectCommand = Command<Project>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function findTrack(project: Draft<Project>, trackId: string): Draft<Track> {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Track ${trackId} not found`);
  return track;
}

export interface BoxAddress {
  trackId: string;
  segmentId: string;
  boxId: string;
}

function findBox(project: Draft<Project>, address: BoxAddress): Draft<BoxInstance> {
  const segment = findTrack(project, address.trackId).segments.find(
    (s) => s.id === address.segmentId,
  );
  if (!segment) throw new Error(`Segment ${address.segmentId} not found`);
  const { preset } = segment;
  const box = [...preset.sequencers, preset.synth, ...preset.effects].find(
    (b) => b.id === address.boxId,
  );
  if (!box) throw new Error(`Box ${address.boxId} not found`);
  return box;
}

/** Sets a box parameter, clamped to its range and snapped to its step. */
export function setBoxParam(
  address: BoxAddress,
  paramId: string,
  value: number,
  label = 'Change parameter',
): ProjectCommand {
  return {
    label,
    recipe: (project) => {
      const box = findBox(project, address);
      const param = getParamDescriptor(box.type, paramId);
      if (!param) throw new Error(`Unknown param "${paramId}" for ${box.type}`);
      box.params[paramId] = constrainParam(param, value);
    },
  };
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
