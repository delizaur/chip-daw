import type { Draft } from 'immer';
import { constrainParam, getParamDescriptor } from './boxes/registry';
import { absoluteNotes, clipEnd, createClip, placeClip, setClipStart } from './clips';
import type { Command } from './history';
import { PPQ } from './constants';
import { createId } from './ids';
import { mergeLanes, writeRecordedMoves, type RecordedParamMove } from './automation-commands';
import { editPreset, ensurePreset, prunePresets, type PresetTarget } from './presets';
import type { BoxInstance, Clip, Note, Preset, Project, Tick, Track } from './types';

export type ProjectCommand = Command<Project>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function findTrack(project: Draft<Project>, trackId: string): Draft<Track> {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Track ${trackId} not found`);
  return track;
}

export interface BoxAddress {
  /** The track preset (copy on write) or a clip preset. */
  target: PresetTarget;
  boxId: string;
}

function findBox(preset: Preset, boxId: string): BoxInstance {
  const box = [...preset.sequencers, preset.synth, ...preset.effects].find((b) => b.id === boxId);
  if (!box) throw new Error(`Box ${boxId} not found`);
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
    recipe: (project) =>
      editPreset(project, address.target, (preset) => {
        const box = findBox(preset, address.boxId);
        const param = getParamDescriptor(box.type, paramId);
        if (!param) throw new Error(`Unknown param "${paramId}" for ${box.type}`);
        box.params[paramId] = constrainParam(param, value);
      }),
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

// --- Tempo -------------------------------------------------------------------------------

export const MIN_BPM = 20;
export const MAX_BPM = 400;

/** Sets the song tempo (the first tempo event; tempo changes arrive in Phase 4). */
export function setTempo(bpm: number): ProjectCommand {
  return {
    label: 'Change tempo',
    recipe: (project) => {
      const first = project.tempoMap.tempos[0];
      const value = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) * 100) / 100;
      if (first) first.bpm = value;
      else project.tempoMap.tempos.push({ tick: 0, bpm: value, ramp: 'step' });
    },
  };
}

// --- Loop --------------------------------------------------------------------------------

/** Shortest loop the markers can make (a sixteenth). */
export const MIN_LOOP_TICKS = PPQ / 4;

/**
 * Sets the loop region. Pass the edge that moved (`fixed` = the other one stays put), so the
 * moving edge is the one kept at least MIN_LOOP_TICKS away; the start never goes before 0.
 */
export function setLoopRegion(
  startTick: Tick,
  endTick: Tick,
  fixed: 'start' | 'end' = 'start',
): ProjectCommand {
  return {
    label: 'Move loop',
    recipe: (project) => {
      let start = Math.max(0, Math.round(startTick));
      let end = Math.round(endTick);
      if (end - start < MIN_LOOP_TICKS) {
        if (fixed === 'start') end = start + MIN_LOOP_TICKS;
        else start = Math.max(0, end - MIN_LOOP_TICKS);
        end = Math.max(end, start + MIN_LOOP_TICKS);
      }
      if (project.loop.startTick !== start) project.loop.startTick = start;
      if (project.loop.endTick !== end) project.loop.endTick = end;
    },
  };
}

// --- Clips -------------------------------------------------------------------------------

export interface ClipPlacement {
  trackId: string;
  /** A plain (non-draft) clip, typically from cloneClip or createClip. */
  clip: Clip;
  /**
   * The clip's preset, added to the project if it isn't there (pasting clips whose preset was
   * removed after copying, or copied from another project).
   */
  preset?: Preset;
}

/**
 * Adds clips, trimming whatever they overlap. Used for new clips, paste and duplicate. Presets
 * no longer used by anything (clips trimmed away) are removed, as in every command that can
 * drop the last use of a preset.
 */
export function placeClips(placements: ClipPlacement[], label = 'Add clip'): ProjectCommand {
  return {
    label,
    recipe: (project) => {
      for (const { trackId, clip, preset } of placements) {
        if (preset) ensurePreset(project, preset);
        placeClip(findTrack(project, trackId), clip);
      }
      prunePresets(project);
    },
  };
}

export function deleteClips(clipIds: Iterable<string>): ProjectCommand {
  const ids = new Set(clipIds);
  return {
    label: ids.size === 1 ? 'Delete clip' : 'Delete clips',
    recipe: (project) => {
      for (const track of project.tracks) track.clips = track.clips.filter((c) => !ids.has(c.id));
      prunePresets(project);
    },
  };
}

/**
 * Moves clips by `deltaTicks` and `deltaTracks` (all by the same amount, clamped so none goes
 * before the song start or off the track list). Moved clips trim whatever they land on.
 */
export function moveClips(
  clipIds: Iterable<string>,
  deltaTicks: Tick,
  deltaTracks: number,
): ProjectCommand {
  const ids = new Set(clipIds);
  return {
    label: ids.size === 1 ? 'Move clip' : 'Move clips',
    recipe: (project) => {
      const moving: { clip: Draft<Clip>; from: number }[] = [];
      project.tracks.forEach((track, index) => {
        for (const clip of track.clips) if (ids.has(clip.id)) moving.push({ clip, from: index });
      });
      if (moving.length === 0) return;
      const minStart = Math.min(...moving.map((m) => m.clip.startTick));
      const minTrack = Math.min(...moving.map((m) => m.from));
      const maxTrack = Math.max(...moving.map((m) => m.from));
      const dt = Math.max(deltaTicks, -minStart);
      const dTracks = Math.min(
        project.tracks.length - 1 - maxTrack,
        Math.max(deltaTracks, -minTrack),
      );

      for (const track of project.tracks) track.clips = track.clips.filter((c) => !ids.has(c.id));
      for (const { clip, from } of moving) {
        clip.startTick += dt;
        placeClip(project.tracks[from + dTracks]!, clip);
      }
      prunePresets(project);
    },
  };
}

/**
 * Sets a clip's start and end. Moving the start keeps notes where they are in the song
 * (notes outside the clip are hidden, not deleted). The clip trims neighbours it grows into.
 */
export function resizeClip(
  trackId: string,
  clipId: string,
  start: Tick,
  end: Tick,
): ProjectCommand {
  return {
    label: 'Resize clip',
    recipe: (project) => {
      const track = findTrack(project, trackId);
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) throw new Error(`Clip ${clipId} not found`);
      const newStart = Math.max(0, Math.min(start, end - 1));
      setClipStart(clip, newStart);
      clip.lengthTicks = Math.max(1, end - newStart);
      placeClip(track, clip);
      prunePresets(project);
    },
  };
}

// --- Recording -----------------------------------------------------------------------------

/** A note captured by the engine while recording, in absolute song ticks. */
export interface RecordedNote {
  trackId: string;
  pitch: number;
  velocity: number;
  startTick: Tick;
  endTick: Tick;
}

export interface RecordedTake {
  /** Where recording started and stopped. */
  startTick: Tick;
  endTick: Tick;
  notes: RecordedNote[];
  /** Knob moves made while recording (automation). */
  params?: RecordedParamMove[];
}

/** Shortest note a take can produce (a 64th note), so tapped keys aren't zero-length. */
const MIN_NOTE_TICKS = 15;

/**
 * Turns a recorded take into clips, one per track that received notes. Each clip spans exactly
 * the time that was recorded (from where recording started to where it stopped, stretched only
 * to fit notes played slightly early), so nothing outside it is touched. Without overdub, the new
 * clip replaces what was underneath. With overdub, it merges with every clip it overlaps into one
 * clip containing all their notes.
 *
 * A new clip gets the track preset (shared, not copied: copy on write keeps it safe). A merged
 * clip keeps the preset of the first clip it merged with, since overdubbed notes are heard
 * through that clip's preset while recording, and the automation of the clips it merged.
 *
 * Knob moves (`take.params`) become automation: on a track that got notes, in the clip the take
 * makes; on a track that only got moves, in the clips already under the recorded time (notes
 * untouched), or in a new empty clip spanning the take when there are none. Each lane's moves
 * replace its points from the first move to where recording stopped (a moved knob holds its
 * value until then, as heard).
 */
export function recordTake(take: RecordedTake, overdub: boolean): ProjectCommand {
  return {
    label: overdub ? 'Overdub' : 'Record',
    recipe: (project) => {
      const byTrack = new Map<string, RecordedNote[]>();
      for (const note of take.notes) {
        byTrack.set(note.trackId, [...(byTrack.get(note.trackId) ?? []), note]);
      }
      const movesByTrack = new Map<string, RecordedParamMove[]>();
      for (const move of take.params ?? []) {
        movesByTrack.set(move.trackId, [...(movesByTrack.get(move.trackId) ?? []), move]);
      }

      // Tracks with only knob moves: into the clips under the recorded time, or a new clip.
      for (const [trackId, moves] of movesByTrack) {
        const track = project.tracks.find((t) => t.id === trackId);
        if (!track || byTrack.has(trackId)) continue;
        const start = Math.max(0, Math.floor(take.startTick));
        const end = Math.max(start + MIN_NOTE_TICKS, Math.ceil(take.endTick));
        const under = track.clips.filter((c) => c.startTick < end && clipEnd(c) > start);
        if (under.length === 0) {
          const clip = createClip(start, end - start, track.presetId);
          writeRecordedMoves(clip, moves, take.endTick);
          placeClip(track, clip);
        } else {
          for (const clip of under) writeRecordedMoves(clip, moves, take.endTick);
        }
      }

      for (const [trackId, recorded] of byTrack) {
        const track = project.tracks.find((t) => t.id === trackId);
        if (!track) continue;
        const firstNote = Math.min(take.startTick, ...recorded.map((n) => n.startTick));
        let start = Math.max(0, Math.floor(firstNote));
        let end = Math.ceil(
          Math.max(take.endTick, start + MIN_NOTE_TICKS, ...recorded.map((n) => n.endTick)),
        );

        const notes: Note[] = recorded.map((n) => {
          const tick = Math.max(start, Math.round(n.startTick));
          return {
            id: createId(),
            tick,
            durationTicks: Math.max(MIN_NOTE_TICKS, Math.round(n.endTick) - tick),
            pitch: n.pitch,
            velocity: n.velocity,
          };
        });

        let presetId = track.presetId;
        let overlapping: Clip[] = [];
        if (overdub) {
          overlapping = track.clips.filter((c) => c.startTick < end && clipEnd(c) > start);
          if (overlapping[0]) presetId = overlapping[0].presetId;
          for (const clip of overlapping) {
            start = Math.min(start, clip.startTick);
            end = Math.max(end, clipEnd(clip));
            notes.push(...absoluteNotes(clip));
          }
          const merged = new Set(overlapping.map((c) => c.id));
          track.clips = track.clips.filter((c) => !merged.has(c.id));
        }

        notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
        const clip = createClip(
          start,
          end - start,
          presetId,
          notes.map((n) => ({ ...n, tick: n.tick - start })),
        );
        clip.automation = mergeLanes(overlapping, start);
        writeRecordedMoves(clip, movesByTrack.get(trackId) ?? [], take.endTick);
        placeClip(track, clip);
      }
      prunePresets(project);
    },
  };
}

// --- Project -------------------------------------------------------------------------------

export function setProjectName(name: string): ProjectCommand {
  return {
    label: 'Rename project',
    recipe: (project) => {
      project.name = name.trim() || 'Untitled';
    },
  };
}
