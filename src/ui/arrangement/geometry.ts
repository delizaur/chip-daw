import { PPQ } from '../../model/constants';
import { ticksPerBar, ticksPerBeat } from '../../model/time';
import type { Clip, LoopRegion, MeterEvent, TempoEvent, Tick, Track } from '../../model/types';

export const RULER_HEIGHT = 24;
/**
 * The tempo lane under the ruler: the tempo as a line with points, over a strip of
 * time-signature markers.
 */
export const LANE_HEIGHT = 56;
/** As tall as a track. It can be hidden (then the tracks start right under the ruler). */
export const TEMPO_LANE_HEIGHT = LANE_HEIGHT;
export const METER_STRIP_HEIGHT = 14;
export const TEMPO_LINE_HEIGHT = TEMPO_LANE_HEIGHT - METER_STRIP_HEIGHT;
/** Where the track lanes start with the tempo lane shown. */
export const TRACKS_TOP = RULER_HEIGHT + TEMPO_LANE_HEIGHT;

/** Where the track lanes start: under the tempo lane, or under the ruler when it's hidden. */
export const tracksTop = (tempoLane: boolean) => (tempoLane ? TRACKS_TOP : RULER_HEIGHT);
/** Pointer distance from a tempo point that grabs it. */
export const TEMPO_GRAB_PX = 7;
/** Pointer distance from a clip edge that grabs the edge (for resizing). */
export const EDGE_GRAB_PX = 6;
/** Pointer distance from a loop marker (on the ruler) that grabs it. */
export const LOOP_GRAB_PX = 8;

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

/** Top of a track's lane; `top` is where the lanes start (see `tracksTop`). */
export const laneTop = (trackIndex: number, top = TRACKS_TOP) => top + trackIndex * LANE_HEIGHT;

/**
 * Lane under `y`, or -1 above the tracks (ruler, tempo lane). May be ≥ track count below the
 * last lane.
 */
export const laneAt = (y: number, top = TRACKS_TOP) =>
  y < top ? -1 : Math.floor((y - top) / LANE_HEIGHT);

/**
 * Snap grid for the zoom level: the meter's subdivision of a beat when zoomed in (sixteenths
 * in 4/4 by default; thirds of a beat for triplets...), beats, or bars when zoomed out.
 */
export function gridTicks(view: TimelineView, meter: MeterEvent): Tick {
  const beat = ticksPerBeat(meter);
  const beatPixels = beat * view.pixelsPerTick;
  if (beatPixels >= 64) return beat / Math.max(1, meter.subdivision);
  if (beatPixels >= 14) return beat;
  return ticksPerBar(meter);
}

export type TimelineHit =
  | { kind: 'ruler'; tick: Tick }
  /** The tempo lane: its tempo line, or the time-signature strip under it. */
  | { kind: 'tempo'; part: 'line' | 'meter'; tick: Tick }
  | { kind: 'clip'; trackIndex: number; clip: Clip; edge: 'start' | 'end' | null; tick: Tick }
  | { kind: 'lane'; trackIndex: number; tick: Tick }
  | { kind: 'none' };

/** What's under a point of the timeline canvas. */
export function hitTest(
  tracks: readonly Track[],
  view: TimelineView,
  x: number,
  y: number,
  top = TRACKS_TOP,
): TimelineHit {
  const tick = xToTick(view, x);
  if (y < RULER_HEIGHT) return { kind: 'ruler', tick };
  if (y < top) {
    return { kind: 'tempo', part: y < RULER_HEIGHT + TEMPO_LINE_HEIGHT ? 'line' : 'meter', tick };
  }
  const lane = laneAt(y, top);
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

/**
 * The loop marker under a point on the ruler, if any. When both are in reach (a short loop,
 * zoomed out), the nearer one wins; on a tie, the end when right of the middle.
 */
export function loopMarkerAt(
  view: TimelineView,
  loop: LoopRegion,
  x: number,
  y: number,
): 'start' | 'end' | null {
  if (y >= RULER_HEIGHT) return null;
  const toStart = Math.abs(x - tickToX(view, loop.startTick));
  const toEnd = Math.abs(x - tickToX(view, loop.endTick));
  if (Math.min(toStart, toEnd) > LOOP_GRAB_PX) return null;
  if (toStart === toEnd) {
    const middle = (tickToX(view, loop.startTick) + tickToX(view, loop.endTick)) / 2;
    return x > middle ? 'end' : 'start';
  }
  return toStart < toEnd ? 'start' : 'end';
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

// --- Tempo lane ------------------------------------------------------------------------------

/**
 * The BPM range the tempo line shows: 60 to 180, widened when the song's tempos go beyond it.
 * Fixed rather than fitted to the points, so adding or moving a point doesn't rescale the line
 * (and move the other points) under the pointer.
 */
export interface TempoRange {
  low: number;
  high: number;
}

export function tempoRange(tempos: readonly TempoEvent[]): TempoRange {
  const bpms = tempos.map((t) => t.bpm);
  return {
    low: Math.max(1, Math.min(60, Math.min(...bpms) - 10)),
    high: Math.max(180, Math.max(...bpms) + 10),
  };
}

/** Y of a tempo on the tempo line. */
export function tempoY(bpm: number, range: TempoRange): number {
  const top = RULER_HEIGHT + 5;
  const bottom = RULER_HEIGHT + TEMPO_LINE_HEIGHT - 5;
  const t = (bpm - range.low) / (range.high - range.low);
  return bottom - Math.min(1, Math.max(0, t)) * (bottom - top);
}

/** The tempo at a y position of the tempo line (whole BPM). */
export function bpmAtY(y: number, range: TempoRange): number {
  const top = RULER_HEIGHT + 5;
  const bottom = RULER_HEIGHT + TEMPO_LINE_HEIGHT - 5;
  const t = (bottom - y) / (bottom - top);
  return Math.round(range.low + Math.min(1, Math.max(0, t)) * (range.high - range.low));
}

/** Index of the tempo point under a point of the tempo line (nearest in reach), or -1. */
export function tempoPointAt(
  tempos: readonly TempoEvent[],
  view: TimelineView,
  range: TempoRange,
  x: number,
  y: number,
): number {
  let best = -1;
  let bestDistance = TEMPO_GRAB_PX;
  tempos.forEach((tempo, i) => {
    const distance = Math.hypot(tickToX(view, tempo.tick) - x, tempoY(tempo.bpm, range) - y);
    if (distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}
