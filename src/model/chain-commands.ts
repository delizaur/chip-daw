/**
 * Commands that edit a preset's box chain: sequencers → synth → effects.
 */
import type { Draft } from 'immer';
import { createBox, getBoxDescriptor } from './boxes/registry';
import type { BoxKind } from './boxes/types';
import type { ProjectCommand } from './commands';
import type { BoxInstance, Preset, Project } from './types';

export interface SegmentAddress {
  trackId: string;
  segmentId: string;
}

function findPreset(project: Draft<Project>, address: SegmentAddress): Draft<Preset> {
  const track = project.tracks.find((t) => t.id === address.trackId);
  const segment = track?.segments.find((s) => s.id === address.segmentId);
  if (!segment) throw new Error(`Segment ${address.segmentId} not found`);
  return segment.preset;
}

/** The list a sequencer or effect lives in (synths aren't in a list). */
function listOf(preset: Draft<Preset>, kind: BoxKind): Draft<BoxInstance>[] | null {
  if (kind === 'sequencer') return preset.sequencers;
  if (kind === 'effect') return preset.effects;
  return null;
}

function kindOf(type: string): BoxKind {
  const descriptor = getBoxDescriptor(type);
  if (!descriptor) throw new Error(`Unknown box type "${type}"`);
  return descriptor.kind;
}

/** Locates a box: its list (null for the synth) and index. */
function locate(preset: Draft<Preset>, boxId: string) {
  if (preset.synth.id === boxId) return { list: null, index: -1, box: preset.synth };
  for (const list of [preset.sequencers, preset.effects]) {
    const index = list.findIndex((b) => b.id === boxId);
    if (index >= 0) return { list, index, box: list[index]! };
  }
  throw new Error(`Box ${boxId} not found`);
}

/**
 * Adds a new sequencer or effect (with default params) at `index`, or at the end. Pass the
 * box from `createBox` so the caller knows its id.
 */
export function addBox(address: SegmentAddress, box: BoxInstance, index?: number): ProjectCommand {
  const descriptor = getBoxDescriptor(box.type);
  return {
    label: `Add ${descriptor?.name ?? 'box'}`,
    recipe: (project) => {
      const list = listOf(findPreset(project, address), kindOf(box.type));
      if (!list) throw new Error('A preset has exactly one synth; replace it instead');
      list.splice(index ?? list.length, 0, box);
    },
  };
}

export function removeBox(address: SegmentAddress, boxId: string): ProjectCommand {
  return {
    label: 'Remove box',
    recipe: (project) => {
      const { list, index } = locate(findPreset(project, address), boxId);
      if (!list) throw new Error("The synth can't be removed, only replaced");
      list.splice(index, 1);
    },
  };
}

/** Moves a sequencer or effect earlier (-1) or later (+1) in its list. */
export function moveBox(address: SegmentAddress, boxId: string, delta: number): ProjectCommand {
  return {
    label: 'Move box',
    recipe: (project) => {
      const { list, index } = locate(findPreset(project, address), boxId);
      if (!list) return;
      const target = Math.min(list.length - 1, Math.max(0, index + delta));
      if (target === index) return;
      const [box] = list.splice(index, 1);
      list.splice(target, 0, box!);
    },
  };
}

/** Swaps a box for a new one of another type of the same kind, keeping its place. */
export function replaceBox(address: SegmentAddress, boxId: string, type: string): ProjectCommand {
  return {
    label: `Replace with ${getBoxDescriptor(type)?.name ?? 'box'}`,
    recipe: (project) => {
      const preset = findPreset(project, address);
      const { list, index, box } = locate(preset, boxId);
      if (kindOf(box.type) !== kindOf(type))
        throw new Error('Boxes can only be replaced by the same kind');
      const replacement = createBox(type);
      if (list) list[index] = replacement;
      else preset.synth = replacement;
    },
  };
}

export function setBoxBypassed(
  address: SegmentAddress,
  boxId: string,
  bypassed: boolean,
): ProjectCommand {
  return {
    label: bypassed ? 'Bypass box' : 'Enable box',
    recipe: (project) => {
      const { box } = locate(findPreset(project, address), boxId);
      if (bypassed) box.bypassed = true;
      else delete box.bypassed;
    },
  };
}

/** Puts a preset (a fresh copy, e.g. from `instantiatePreset`) on a track's segment. */
export function loadPreset(address: SegmentAddress, preset: Preset): ProjectCommand {
  return {
    label: `Load ${preset.name}`,
    recipe: (project) => {
      const track = project.tracks.find((t) => t.id === address.trackId);
      const segment = track?.segments.find((s) => s.id === address.segmentId);
      if (!segment) throw new Error(`Segment ${address.segmentId} not found`);
      segment.preset = preset;
    },
  };
}

export function renameTrackPreset(address: SegmentAddress, name: string): ProjectCommand {
  return {
    label: 'Rename preset',
    recipe: (project) => {
      const preset = findPreset(project, address);
      preset.name = name.trim() || preset.name;
    },
  };
}
