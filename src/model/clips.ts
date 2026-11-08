/**
 * Clip operations on (Immer draft or plain) tracks. They keep the invariant that clips on a
 * track never overlap: placing a clip trims, splits or removes whatever was underneath.
 */
import { createId } from './ids';
import type { Clip, Note, Tick, Track } from './types';

export const clipEnd = (clip: Clip): Tick => clip.startTick + clip.lengthTicks;

/** Notes as absolute song ticks, keeping only the ones inside the clip's bounds. */
export function absoluteNotes(clip: Clip): Note[] {
  return clip.notes
    .filter((n) => n.tick >= 0 && n.tick < clip.lengthTicks)
    .map((n) => ({ ...n, tick: clip.startTick + n.tick }));
}

/** Copy of `clip` cut to [start, end), keeping only notes that start inside. */
function cropped(clip: Clip, start: Tick, end: Tick, id: string): Clip {
  return {
    id,
    startTick: start,
    lengthTicks: end - start,
    notes: absoluteNotes(clip)
      .filter((n) => n.tick >= start && n.tick < end)
      .map((n) => ({ ...n, tick: n.tick - start })),
    automation: clip.automation.map((lane) => ({
      ...lane,
      points: lane.points
        .map((p) => ({ ...p, tick: p.tick + clip.startTick - start }))
        .filter((p) => p.tick >= 0 && p.tick <= end - start),
    })),
  };
}

/**
 * Removes clip material in [start, end) from a track, except clips in `keep`: clips inside are
 * deleted, clips sticking out are trimmed, and a clip spanning the whole range is split in two.
 */
export function clearRange(
  track: Track,
  start: Tick,
  end: Tick,
  keep: ReadonlySet<string> = new Set(),
) {
  const result: Clip[] = [];
  for (const clip of track.clips) {
    const clipStart = clip.startTick;
    const clipStop = clipEnd(clip);
    if (keep.has(clip.id) || clipStop <= start || clipStart >= end) {
      result.push(clip);
      continue;
    }
    if (clipStart < start) result.push(cropped(clip, clipStart, start, clip.id));
    if (clipStop > end)
      result.push(cropped(clip, end, clipStop, clipStart < start ? createId() : clip.id));
  }
  track.clips = result;
}

/** Adds a clip to a track, clearing whatever it overlaps. Keeps clips sorted by start. */
export function placeClip(track: Track, clip: Clip): void {
  clearRange(track, clip.startTick, clipEnd(clip), new Set([clip.id]));
  track.clips = track.clips.filter((c) => c.id !== clip.id);
  track.clips.push(clip);
  track.clips.sort((a, b) => a.startTick - b.startTick);
}

export function createClip(startTick: Tick, lengthTicks: Tick, notes: Note[] = []): Clip {
  return { id: createId(), startTick, lengthTicks, notes, automation: [] };
}

/** Deep copy with fresh ids (for copy/paste and duplicate). Pass plain objects, not drafts. */
export function cloneClip(clip: Clip, startTick: Tick = clip.startTick): Clip {
  return {
    id: createId(),
    startTick,
    lengthTicks: clip.lengthTicks,
    notes: clip.notes.map((n) => ({ ...n, id: createId() })),
    automation: clip.automation.map((lane) => ({
      target: { ...lane.target },
      paramId: lane.paramId,
      points: lane.points.map((p) => ({ ...p })),
    })),
  };
}

/**
 * Moves a clip's start edge to `startTick`, keeping notes and automation where they are in the
 * song (notes before the new start are hidden, not deleted, so trimming can be undone by
 * dragging the edge back).
 */
export function setClipStart(clip: Clip, startTick: Tick): void {
  const delta = startTick - clip.startTick;
  clip.startTick = startTick;
  clip.lengthTicks -= delta;
  for (const note of clip.notes) note.tick -= delta;
  for (const lane of clip.automation) for (const point of lane.points) point.tick -= delta;
}
