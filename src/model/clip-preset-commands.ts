/**
 * The clip preset buttons: Make unique, Use track preset and Load to track (see
 * design-principles.md, "Terminology").
 */
import type { Draft } from 'immer';
import type { ProjectCommand } from './commands';
import { findPresetById, forkPreset, nextPresetName, presetUsage, prunePresets } from './presets';
import type { Clip, Project, Track } from './types';

function clipsWithTracks(project: Draft<Project>, ids: ReadonlySet<string>) {
  const found: { track: Draft<Track>; clip: Draft<Clip> }[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) if (ids.has(clip.id)) found.push({ track, clip });
  }
  return found;
}

/**
 * Whether Make unique would do anything: some selected clip's preset is also used by a clip
 * outside the selection, or by a track.
 */
export function canMakeUnique(project: Project, clipIds: Iterable<string>): boolean {
  const ids = new Set(clipIds);
  const presetIds = new Set(
    project.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)).map((c) => c.presetId)),
  );
  return [...presetIds].some((presetId) => {
    const usage = presetUsage(project, presetId);
    return usage.trackIds.length > 0 || usage.clipIds.some((id) => !ids.has(id));
  });
}

/**
 * Gives the selected clips their own copy of their preset, so editing it doesn't change other
 * clips or the track preset. Selected clips that shared a preset share the one copy. The copy
 * keeps box ids (automation lanes still match), so nothing sounds different yet.
 */
export function makeClipsUnique(clipIds: Iterable<string>): ProjectCommand {
  const ids = new Set(clipIds);
  return {
    label: 'Make unique',
    recipe: (project) => {
      const selected = clipsWithTracks(project, ids);
      for (const presetId of new Set(selected.map((s) => s.clip.presetId))) {
        const usage = presetUsage(project, presetId);
        const sharedOutside = usage.trackIds.length > 0 || usage.clipIds.some((id) => !ids.has(id));
        const preset = findPresetById(project, presetId);
        if (!sharedOutside || !preset) continue;
        const copy = forkPreset(preset, nextPresetName(project, preset.name));
        project.presets.push(copy);
        for (const { clip } of selected) if (clip.presetId === presetId) clip.presetId = copy.id;
      }
    },
  };
}

/** Points the selected clips at their track's preset. Presets left unused are removed. */
export function useTrackPreset(clipIds: Iterable<string>): ProjectCommand {
  const ids = new Set(clipIds);
  return {
    label: 'Use track preset',
    recipe: (project) => {
      for (const { track, clip } of clipsWithTracks(project, ids)) clip.presetId = track.presetId;
      prunePresets(project);
    },
  };
}

/**
 * Makes a clip's preset its track's preset (shared), to play and record more with it. The old
 * track preset is removed if nothing else uses it.
 */
export function loadClipPresetToTrack(clipId: string): ProjectCommand {
  return {
    label: 'Load to track',
    recipe: (project) => {
      const [found] = clipsWithTracks(project, new Set([clipId]));
      if (!found) throw new Error(`Clip ${clipId} not found`);
      found.track.presetId = found.clip.presetId;
      prunePresets(project);
    },
  };
}
