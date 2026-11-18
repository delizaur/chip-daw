/** Keyboard navigation along clips: A/D jump the playhead along clip edges. */
import type { Clip, Tick, Track } from '../../model/types';

const clipEnd = (clip: Clip) => clip.startTick + clip.lengthTicks;

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
