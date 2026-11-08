/**
 * Commands that edit the notes of one clip (the piano roll). Note ticks are relative to the
 * clip start. Notes are kept in insertion order; playback sorts them.
 */
import type { Draft } from 'immer';
import type { ProjectCommand } from './commands';
import type { Clip, Note, Project, Tick } from './types';

export interface ClipAddress {
  trackId: string;
  clipId: string;
}

export interface NoteChange {
  id: string;
  tick?: Tick;
  durationTicks?: Tick;
  pitch?: number;
  velocity?: number;
}

const clampPitch = (pitch: number) => Math.min(127, Math.max(0, Math.round(pitch)));
const clampVelocity = (velocity: number) => Math.min(127, Math.max(1, Math.round(velocity)));

export function findClip(project: Draft<Project> | Project, address: ClipAddress) {
  const track = project.tracks.find((t) => t.id === address.trackId);
  const clip = track?.clips.find((c) => c.id === address.clipId);
  if (!clip) throw new Error(`Clip ${address.clipId} not found`);
  return clip as Draft<Clip>;
}

/** Adds notes (plain objects with fresh ids), clamped to valid ranges. */
export function addNotes(address: ClipAddress, notes: Note[], label = 'Add note'): ProjectCommand {
  return {
    label,
    recipe: (project) => {
      const clip = findClip(project, address);
      for (const note of notes) {
        clip.notes.push({
          ...note,
          tick: Math.max(0, Math.round(note.tick)),
          durationTicks: Math.max(1, Math.round(note.durationTicks)),
          pitch: clampPitch(note.pitch),
          velocity: clampVelocity(note.velocity),
        });
      }
    },
  };
}

/** Sets fields of existing notes. Unknown ids are ignored (the note may have been deleted). */
export function updateNotes(
  address: ClipAddress,
  changes: NoteChange[],
  label = 'Edit notes',
): ProjectCommand {
  return {
    label,
    recipe: (project) => {
      const clip = findClip(project, address);
      const byId = new Map(clip.notes.map((n) => [n.id, n]));
      for (const change of changes) {
        const note = byId.get(change.id);
        if (!note) continue;
        if (change.tick !== undefined) note.tick = Math.max(0, Math.round(change.tick));
        if (change.durationTicks !== undefined) {
          note.durationTicks = Math.max(1, Math.round(change.durationTicks));
        }
        if (change.pitch !== undefined) note.pitch = clampPitch(change.pitch);
        if (change.velocity !== undefined) note.velocity = clampVelocity(change.velocity);
      }
    },
  };
}

export function deleteNotes(address: ClipAddress, ids: Iterable<string>): ProjectCommand {
  const remove = new Set(ids);
  return {
    label: remove.size === 1 ? 'Delete note' : 'Delete notes',
    recipe: (project) => {
      const clip = findClip(project, address);
      clip.notes = clip.notes.filter((n) => !remove.has(n.id));
    },
  };
}

/**
 * Moves note starts to the nearest grid line of the song (not of the clip, which may start
 * off-grid). `ids` null quantizes every note in the clip.
 */
export function quantizeNotes(
  address: ClipAddress,
  ids: Iterable<string> | null,
  grid: Tick,
): ProjectCommand {
  const only = ids ? new Set(ids) : null;
  return {
    label: 'Quantize',
    recipe: (project) => {
      const clip = findClip(project, address);
      for (const note of clip.notes) {
        if (only && !only.has(note.id)) continue;
        const absolute = clip.startTick + note.tick;
        note.tick = Math.max(0, Math.round(absolute / grid) * grid - clip.startTick);
      }
    },
  };
}
