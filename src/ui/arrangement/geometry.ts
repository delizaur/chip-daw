import { PPQ } from '../../model/constants';
import { ticksPerBar, ticksPerBeat } from '../../model/time';
import type { Clip, MeterEvent, Tick, Track } from '../../model/types';

export const RULER_HEIGHT = 24;
export const LANE_HEIGHT = 56;
/** Pointer distance from a clip edge that grabs the edge (for resizing). */
export const EDGE_GRAB_PX = 6;

export const MIN_PIXELS_PER_TICK = 2 / PPQ;
export const MAX_PIXELS_PER_TICK = 256 / PPQ;
export const DEFAULT_PIXELS_PER_TICK = 28 / PPQ;

/** The visible part of the timeline. */
export interface TimelineView {
  pixelsPerTick: number;
  /** Tick at the left edge. */
  scrollTick: Tick;
}

export const tickToX = (view: TimelineView, tick: Tick) =>
  (tick - view.scrollTick) * view.pixelsPerTick;

export const xToTick = (view: TimelineView, x: number) => view.scrollTick + x / view.pixelsPerTick;

export const laneTop = (trackIndex: number) => RULER_HEIGHT + trackIndex * LANE_HEIGHT;

/** Lane under `y`, or -1 in the ruler. May be ≥ track count below the last lane. */
export const laneAt = (y: number) =>
  y < RULER_HEIGHT ? -1 : Math.floor((y - RULER_HEIGHT) / LANE_HEIGHT);

/** Snap grid for the zoom level: sixteenths when zoomed in, beats, or bars when zoomed out. */
export function gridTicks(view: TimelineView, meter: MeterEvent): Tick {
  const beat = ticksPerBeat(meter);
  const beatPixels = beat * view.pixelsPerTick;
  if (beatPixels >= 64) return beat / 4;
  if (beatPixels >= 14) return beat;
  return ticksPerBar(meter);
}

export type TimelineHit =
  | { kind: 'ruler'; tick: Tick }
  | { kind: 'clip'; trackIndex: number; clip: Clip; edge: 'start' | 'end' | null; tick: Tick }
  | { kind: 'lane'; trackIndex: number; tick: Tick }
  | { kind: 'none' };

/** What's under a point of the timeline canvas. */
export function hitTest(
  tracks: readonly Track[],
  view: TimelineView,
  x: number,
  y: number,
): TimelineHit {
  const tick = xToTick(view, x);
  const lane = laneAt(y);
  if (lane < 0) return { kind: 'ruler', tick };
  const track = tracks[lane];
  if (!track) return { kind: 'none' };
  for (const clip of track.clips) {
    const left = tickToX(view, clip.startTick);
    const right = tickToX(view, clip.startTick + clip.lengthTicks);
    if (x < left || x >= right) continue;
    const grab = Math.min(EDGE_GRAB_PX, (right - left) / 3);
    const edge = x < left + grab ? 'start' : x >= right - grab ? 'end' : null;
    return { kind: 'clip', trackIndex: lane, clip, edge, tick };
  }
  return { kind: 'lane', trackIndex: lane, tick };
}

/** New zoom, keeping the tick under `anchorX` in place. */
export function zoomAround(view: TimelineView, factor: number, anchorX: number): TimelineView {
  const anchor = xToTick(view, anchorX);
  const pixelsPerTick = Math.min(
    MAX_PIXELS_PER_TICK,
    Math.max(MIN_PIXELS_PER_TICK, view.pixelsPerTick * factor),
  );
  return { pixelsPerTick, scrollTick: Math.max(0, anchor - anchorX / pixelsPerTick) };
}
