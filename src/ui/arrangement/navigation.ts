/**
 * Keyboard navigation between clips (pure functions over the track list): arrow keys move the
 * selection to a neighbouring clip, A/D jump the playhead along clip edges.
 */
import type { Clip, Tick, Track } from '../../model/types';

export interface ClipRef {
  trackIndex: number;
  clipId: string;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

const clipEnd = (clip: Clip) => clip.startTick + clip.lengthTicks;

/** Distance from `tick` to a clip (0 when inside it). */
function distanceTo(clip: Clip, tick: Tick): number {
  if (tick < clip.startTick) return clip.startTick - tick;
  if (tick >= clipEnd(clip)) return tick - clipEnd(clip) + 1;
  return 0;
}

/** The clip on `track` closest to `tick` (the earlier one on a tie), or null. */
function closestOnTrack(track: Track, tick: Tick): Clip | null {
  let best: Clip | null = null;
  for (const clip of track.clips) {
    if (!best || distanceTo(clip, tick) < distanceTo(best, tick)) best = clip;
  }
  return best;
}

/**
 * The clip closest to the playhead: on the selected track if it has clips, otherwise on the
 * nearest track that does.
 */
export function closestClip(
  tracks: readonly Track[],
  trackIndex: number,
  tick: Tick,
): ClipRef | null {
  const order = [...tracks.keys()].sort(
    (a, b) => Math.abs(a - trackIndex) - Math.abs(b - trackIndex) || a - b,
  );
  for (const index of order) {
    const clip = closestOnTrack(tracks[index]!, tick);
    if (clip) return { trackIndex: index, clipId: clip.id };
  }
  return null;
}

/**
 * The clip next to `from`: left/right is the previous/next clip on the same track; up/down is
 * the clip closest in time on the nearest track above/below that has clips. Null at an edge.
 */
export function adjacentClip(
  tracks: readonly Track[],
  from: ClipRef,
  direction: Direction,
): ClipRef | null {
  const track = tracks[from.trackIndex];
  const clip = track?.clips.find((c) => c.id === from.clipId);
  if (!track || !clip) return null;

  if (direction === 'left' || direction === 'right') {
    const sorted = [...track.clips].sort((a, b) => a.startTick - b.startTick);
    const next = sorted[sorted.indexOf(clip) + (direction === 'right' ? 1 : -1)];
    return next ? { trackIndex: from.trackIndex, clipId: next.id } : null;
  }

  const step = direction === 'down' ? 1 : -1;
  for (let index = from.trackIndex + step; index >= 0 && index < tracks.length; index += step) {
    const target = closestOnTrack(tracks[index]!, clip.startTick);
    if (target) return { trackIndex: index, clipId: target.id };
  }
  return null;
}

/** A clip edge A/D can stop at. */
interface Stop {
  tick: Tick;
  clipId: string;
  isStart: boolean;
}

/**
 * Where A (-1) or D (+1) moves the playhead on `track`: the clip edges are stops, walked in
 * order (D: each clip's start, then its end, then the next clip's start...). The stop you're
 * on is the edge at `tick` of the selected clip, so where one clip ends exactly where the next
 * starts, D from the end of the first only selects the second (its start is the same tick),
 * and the next D goes to its end; A mirrors that. With no stop matching, the walk starts from
 * the nearest edge past `tick`. Returns the new tick and the clip to select, or null at the
 * last edge.
 */
export function clipEdgeJump(
  track: Track,
  tick: Tick,
  direction: 1 | -1,
  selectedClipId?: string,
): { tick: Tick; clipId: string } | null {
  const stops: Stop[] = track.clips.flatMap((clip) => [
    { tick: clip.startTick, clipId: clip.id, isStart: true },
    { tick: clipEnd(clip), clipId: clip.id, isStart: false },
  ]);
  // In walking order: by tick, and at a shared tick the clip you leave before the one you enter.
  stops.sort((a, b) => a.tick - b.tick || Number(a.isStart) - Number(b.isStart));
  if (direction < 0) stops.reverse();

  const current = stops.findIndex((s) => s.tick === tick && s.clipId === selectedClipId);
  const next =
    current >= 0
      ? stops[current + 1]
      : stops.find((s) => (direction > 0 ? s.tick > tick : s.tick < tick));
  return next ? { tick: next.tick, clipId: next.clipId } : null;
}
