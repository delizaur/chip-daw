import { PPQ } from '../../model/constants';
import type { Clip, Note, Tick } from '../../model/types';

/** Layout of the piano roll canvas: keys on the left, ruler on top, velocities at the bottom. */
export const KEYS_WIDTH = 44;
export const RULER_HEIGHT = 20;
export const VELOCITY_HEIGHT = 56;
export const ROW_HEIGHT = 12;
/** Pointer distance from a note's end that grabs it for resizing. */
export const NOTE_EDGE_PX = 5;
/** Pointer distance from a velocity stem that grabs it. */
export const STEM_GRAB_PX = 6;

export const MIN_PIXELS_PER_TICK = 8 / PPQ;
export const MAX_PIXELS_PER_TICK = 400 / PPQ;

export interface RollView {
  pixelsPerTick: number;
  /** Song tick at the left edge of the note grid. */
  scrollTick: Tick;
  /** Pitch of the top row. */
  topPitch: number;
}

export const tickToX = (view: RollView, tick: Tick) =>
  KEYS_WIDTH + (tick - view.scrollTick) * view.pixelsPerTick;

export const xToTick = (view: RollView, x: number) =>
  view.scrollTick + (x - KEYS_WIDTH) / view.pixelsPerTick;

export const pitchToY = (view: RollView, pitch: number) =>
  RULER_HEIGHT + (view.topPitch - pitch) * ROW_HEIGHT;

export const yToPitch = (view: RollView, y: number) =>
  view.topPitch - Math.floor((y - RULER_HEIGHT) / ROW_HEIGHT);

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
export const isBlackKey = (pitch: number) => BLACK_KEYS.has(((pitch % 12) + 12) % 12);

export type RollArea = 'ruler' | 'keys' | 'grid' | 'velocity';

export function areaAt(x: number, y: number, height: number): RollArea {
  if (y < RULER_HEIGHT) return 'ruler';
  if (y >= height - VELOCITY_HEIGHT) return 'velocity';
  return x < KEYS_WIDTH ? 'keys' : 'grid';
}

/** Rows that fit in the note grid. */
export const visibleRows = (height: number) =>
  Math.max(1, Math.floor((height - RULER_HEIGHT - VELOCITY_HEIGHT) / ROW_HEIGHT));

/** The note under a point of the grid (topmost wins), and whether its end edge is grabbed. */
export function noteAt(
  clip: Clip,
  view: RollView,
  x: number,
  y: number,
): { note: Note; edge: 'end' | null } | null {
  const pitch = yToPitch(view, y);
  for (let i = clip.notes.length - 1; i >= 0; i--) {
    const note = clip.notes[i]!;
    if (note.pitch !== pitch) continue;
    const left = tickToX(view, clip.startTick + note.tick);
    const right = Math.max(
      left + 3,
      tickToX(view, clip.startTick + note.tick + note.durationTicks),
    );
    if (x < left || x >= right) continue;
    const grab = Math.min(NOTE_EDGE_PX, (right - left) / 3);
    return { note, edge: x >= right - grab ? 'end' : null };
  }
  return null;
}

/** The note whose velocity stem is nearest to `x` (within reach), preferring `preferred` ids. */
export function stemAt(
  clip: Clip,
  view: RollView,
  x: number,
  preferred: ReadonlySet<string>,
): Note | null {
  let best: Note | null = null;
  let bestScore = Infinity;
  for (const note of clip.notes) {
    const distance = Math.abs(tickToX(view, clip.startTick + note.tick) - x);
    if (distance > STEM_GRAB_PX) continue;
    const score = distance - (preferred.has(note.id) ? STEM_GRAB_PX : 0);
    if (score < bestScore) {
      best = note;
      bestScore = score;
    }
  }
  return best;
}

/** Velocity (1..127) for a y position in the velocity lane. */
export function velocityAtY(y: number, height: number): number {
  const top = height - VELOCITY_HEIGHT + 6;
  const bottom = height - 4;
  const t = (bottom - y) / (bottom - top);
  return Math.round(Math.min(127, Math.max(1, t * 127)));
}

/** A view showing the whole clip, centred on its notes (or around C4 when empty). */
export function fitView(clip: Clip, width: number, height: number): RollView {
  const usable = Math.max(100, width - KEYS_WIDTH - 24);
  const pixelsPerTick = Math.min(
    MAX_PIXELS_PER_TICK,
    Math.max(MIN_PIXELS_PER_TICK, usable / clip.lengthTicks),
  );
  const pitches = clip.notes.map((n) => n.pitch);
  const centre = pitches.length
    ? Math.round((Math.min(...pitches) + Math.max(...pitches)) / 2)
    : 66;
  const rows = visibleRows(height);
  return {
    pixelsPerTick,
    scrollTick: clip.startTick - 12 / pixelsPerTick,
    topPitch: Math.min(127, Math.max(rows - 1, centre + Math.floor(rows / 2))),
  };
}
