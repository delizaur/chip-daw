/**
 * Track and clip presets: lookups, sharing, copy on write and cleanup. Tracks and clips point
 * at `Project.presets` by id, so a preset can be shared (see design-principles.md,
 * "Terminology"). Works on Immer drafts and plain projects alike.
 */
import type { Draft } from 'immer';
import { createId } from './ids';
import type { BoxInstance, Preset, Project, Track } from './types';

/**
 * Where a preset edit goes: a track's preset (copy on write: recorded clips never change), or
 * a preset by id (a clip preset: everything sharing it changes).
 */
export type PresetTarget = { trackId: string } | { presetId: string };

export function findPresetById<P extends Project | Draft<Project>>(
  project: P,
  presetId: string,
): P['presets'][number] | undefined {
  return project.presets.find((p) => p.id === presetId);
}

export function trackPresetOf(project: Project, track: Track): Preset | undefined {
  return findPresetById(project, track.presetId);
}

export interface PresetUsage {
  /** Tracks whose track preset it is. */
  trackIds: string[];
  /** Clips (on any track) that play with it. */
  clipIds: string[];
}

export function presetUsage(project: Project | Draft<Project>, presetId: string): PresetUsage {
  const usage: PresetUsage = { trackIds: [], clipIds: [] };
  for (const track of project.tracks) {
    if (track.presetId === presetId) usage.trackIds.push(track.id);
    for (const clip of track.clips) if (clip.presetId === presetId) usage.clipIds.push(clip.id);
  }
  return usage;
}

function copyBoxKeepingId(box: BoxInstance): BoxInstance {
  const copy: BoxInstance = { id: box.id, type: box.type, params: { ...box.params } };
  if (box.bypassed) copy.bypassed = true;
  return copy;
}

/**
 * A copy of a preset with a new id and name but the same box ids, so automation lanes that
 * point at its boxes still match the copy. Accepts drafts (the result is a plain object).
 */
export function forkPreset(preset: Preset, name: string): Preset {
  const copy: Preset = {
    id: createId(),
    name,
    sequencers: preset.sequencers.map(copyBoxKeepingId),
    synth: copyBoxKeepingId(preset.synth),
    effects: preset.effects.map(copyBoxKeepingId),
  };
  if (preset.libraryOrigin !== undefined) copy.libraryOrigin = preset.libraryOrigin;
  return copy;
}

/** The name for a copy: "Bass" → "Bass 2", "Bass 2" → "Bass 3" (the first one not taken). */
export function nextPresetName(project: Project | Draft<Project>, name: string): string {
  const base = name.replace(/\s+\d+$/, '') || name;
  const taken = new Set(project.presets.map((p) => p.name));
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Adds `preset` unless the project already has a preset with its id. */
export function ensurePreset(project: Draft<Project>, preset: Preset): void {
  if (!findPresetById(project, preset.id)) project.presets.push(preset);
}

/** Removes presets that no track or clip uses. */
export function prunePresets(project: Draft<Project>): void {
  const used = new Set<string>();
  for (const track of project.tracks) {
    used.add(track.presetId);
    for (const clip of track.clips) used.add(clip.presetId);
  }
  if (project.presets.some((p) => !used.has(p.id))) {
    project.presets = project.presets.filter((p) => used.has(p.id));
  }
}

function findTrack(project: Draft<Project>, trackId: string): Draft<Track> {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Track ${trackId} not found`);
  return track;
}

/**
 * Applies `edit` to the preset at `target`. For a track whose preset anything else uses (a clip,
 * or another track), the edit lands on a copy that becomes the track preset, so recorded clips
 * keep their sound. An edit that changes nothing never makes a copy.
 */
export function editPreset(
  project: Draft<Project>,
  target: PresetTarget,
  edit: (preset: Preset) => void,
): void {
  if ('presetId' in target) {
    const preset = findPresetById(project, target.presetId);
    if (!preset) throw new Error(`Preset ${target.presetId} not found`);
    edit(preset);
    return;
  }
  const track = findTrack(project, target.trackId);
  const preset = findPresetById(project, track.presetId);
  if (!preset) throw new Error(`Preset ${track.presetId} not found`);
  const usage = presetUsage(project, preset.id);
  if (usage.clipIds.length === 0 && usage.trackIds.length <= 1) {
    edit(preset);
    return;
  }
  const name = nextPresetName(project, preset.name);
  const copy = forkPreset(preset, preset.name);
  const before = JSON.stringify(copy);
  edit(copy);
  if (JSON.stringify(copy) === before) return;
  // A rename names the copy itself; otherwise the copy gets the next free name.
  if (copy.name === preset.name) copy.name = name;
  project.presets.push(copy);
  track.presetId = copy.id;
}

/** Resolves a target without copying anything (for reading, e.g. in the UI). */
export function resolvePresetTarget(project: Project, target: PresetTarget): Preset | undefined {
  if ('presetId' in target) return findPresetById(project, target.presetId);
  const track = project.tracks.find((t) => t.id === target.trackId);
  return track ? trackPresetOf(project, track) : undefined;
}
