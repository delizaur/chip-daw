/**
 * Commands that edit a preset's box chain: sequencers → synth → effects. They target the track
 * preset (copy on write: if clips use it, the edit lands on a copy that becomes the track
 * preset, so recorded clips keep their sound) or a clip preset by id (everything sharing it
 * changes). See `editPreset`.
 */
import { createBox, getBoxDescriptor } from './boxes/registry';
import type { BoxKind } from './boxes/types';
import type { ProjectCommand } from './commands';
import { editPreset, prunePresets, type PresetTarget } from './presets';
import type { BoxInstance, Preset } from './types';

/** The list a sequencer or effect lives in (synths aren't in a list). */
function listOf(preset: Preset, kind: BoxKind): BoxInstance[] | null {
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
function locate(preset: Preset, boxId: string) {
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
export function addBox(target: PresetTarget, box: BoxInstance, index?: number): ProjectCommand {
  const descriptor = getBoxDescriptor(box.type);
  return {
    label: `Add ${descriptor?.name ?? 'box'}`,
    recipe: (project) =>
      editPreset(project, target, (preset) => {
        const list = listOf(preset, kindOf(box.type));
        if (!list) throw new Error('A preset has exactly one synth; replace it instead');
        list.splice(index ?? list.length, 0, { ...box, params: { ...box.params } });
      }),
  };
}

export function removeBox(target: PresetTarget, boxId: string): ProjectCommand {
  return {
    label: 'Remove box',
    recipe: (project) =>
      editPreset(project, target, (preset) => {
        const { list, index } = locate(preset, boxId);
        if (!list) throw new Error("The synth can't be removed, only replaced");
        list.splice(index, 1);
      }),
  };
}

/** Moves a sequencer or effect earlier (-1) or later (+1) in its list. */
export function moveBox(target: PresetTarget, boxId: string, delta: number): ProjectCommand {
  return {
    label: 'Move box',
    recipe: (project) =>
      editPreset(project, target, (preset) => {
        const { list, index } = locate(preset, boxId);
        if (!list) return;
        const to = Math.min(list.length - 1, Math.max(0, index + delta));
        if (to === index) return;
        const [box] = list.splice(index, 1);
        list.splice(to, 0, box!);
      }),
  };
}

/** Swaps a box for a new one of another type of the same kind, keeping its place. */
export function replaceBox(target: PresetTarget, boxId: string, type: string): ProjectCommand {
  return {
    label: `Replace with ${getBoxDescriptor(type)?.name ?? 'box'}`,
    recipe: (project) =>
      editPreset(project, target, (preset) => {
        const { list, index, box } = locate(preset, boxId);
        if (kindOf(box.type) !== kindOf(type))
          throw new Error('Boxes can only be replaced by the same kind');
        const replacement = createBox(type);
        if (list) list[index] = replacement;
        else preset.synth = replacement;
      }),
  };
}

export function setBoxBypassed(
  target: PresetTarget,
  boxId: string,
  bypassed: boolean,
): ProjectCommand {
  return {
    label: bypassed ? 'Bypass box' : 'Enable box',
    recipe: (project) =>
      editPreset(project, target, (preset) => {
        const { box } = locate(preset, boxId);
        if (bypassed) box.bypassed = true;
        else delete box.bypassed;
      }),
  };
}

/**
 * Makes a preset (a fresh copy, e.g. from `instantiatePreset`) the track preset. Recorded clips
 * keep theirs; the old track preset is removed if nothing else uses it.
 */
export function loadTrackPreset(trackId: string, preset: Preset): ProjectCommand {
  return {
    label: `Load ${preset.name}`,
    recipe: (project) => {
      const track = project.tracks.find((t) => t.id === trackId);
      if (!track) throw new Error(`Track ${trackId} not found`);
      project.presets.push(preset);
      track.presetId = preset.id;
      prunePresets(project);
    },
  };
}

/** Renames a preset. Renaming a shared track preset names the copy the track switches to. */
export function renamePreset(target: PresetTarget, name: string): ProjectCommand {
  return {
    label: 'Rename preset',
    recipe: (project) =>
      editPreset(project, target, (preset) => {
        preset.name = name.trim() || preset.name;
      }),
  };
}
