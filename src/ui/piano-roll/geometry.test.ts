import { describe, expect, it } from 'vitest';
import { createClip } from '../../model/clips';
import { PPQ } from '../../model/constants';
import {
  areaAt,
  fitView,
  isBlackKey,
  KEYS_WIDTH,
  noteAt,
  pitchToY,
  ROW_HEIGHT,
  RULER_HEIGHT,
  stemAt,
  tickToX,
  velocityAtY,
  VELOCITY_HEIGHT,
  xToTick,
  yToPitch,
  type RollView,
} from './geometry';

const view: RollView = { pixelsPerTick: 40 / PPQ, scrollTick: 0, topPitch: 72 }; // 40 px/beat
const clip = createClip(PPQ, 4 * PPQ, 'p', [
  { id: 'a', tick: 0, durationTicks: PPQ, pitch: 60, velocity: 100 }, // x 84..124
  { id: 'b', tick: PPQ / 8, durationTicks: PPQ, pitch: 64, velocity: 50 }, // stem x 89
]);

describe('piano roll geometry', () => {
  it('maps ticks and pitches to the grid', () => {
    expect(tickToX(view, PPQ)).toBe(KEYS_WIDTH + 40);
    expect(xToTick(view, KEYS_WIDTH + 80)).toBe(2 * PPQ);
    expect(pitchToY(view, 72)).toBe(RULER_HEIGHT);
    expect(yToPitch(view, RULER_HEIGHT + ROW_HEIGHT * 12 + 3)).toBe(60);
  });

  it('knows the black keys', () => {
    expect([60, 61, 62, 63, 64, 65, 66].map(isBlackKey)).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it('splits the canvas into areas', () => {
    expect(areaAt(100, 5, 400)).toBe('ruler');
    expect(areaAt(10, 100, 400)).toBe('keys');
    expect(areaAt(100, 100, 400)).toBe('grid');
    expect(areaAt(100, 400 - VELOCITY_HEIGHT + 1, 400)).toBe('lane');
  });

  it('finds notes and their end edges', () => {
    const y = pitchToY(view, 60) + 4;
    expect(noteAt(clip, view, 100, y)).toMatchObject({ note: { id: 'a' }, edge: null });
    expect(noteAt(clip, view, 122, y)).toMatchObject({ note: { id: 'a' }, edge: 'end' });
    expect(noteAt(clip, view, 130, y)).toBeNull();
    expect(noteAt(clip, view, 100, y - ROW_HEIGHT)).toBeNull();
  });

  it('finds velocity stems, preferring selected notes', () => {
    expect(stemAt(clip, view, 85, new Set())?.id).toBe('a');
    expect(stemAt(clip, view, 86, new Set(['b']))?.id).toBe('b');
    expect(stemAt(clip, view, 200, new Set())).toBeNull();
  });

  it('maps the velocity lane to 1..127', () => {
    expect(velocityAtY(400 - VELOCITY_HEIGHT, 400)).toBe(127);
    expect(velocityAtY(399, 400)).toBe(1);
  });

  it('fits the clip and centres on its notes', () => {
    const fitted = fitView(clip, 44 + 24 + 400, 400);
    expect(tickToX(fitted, clip.startTick + clip.lengthTicks)).toBeCloseTo(44 + 12 + 400, 0);
    const middleRow = Math.floor((400 - RULER_HEIGHT - VELOCITY_HEIGHT) / ROW_HEIGHT / 2);
    expect(fitted.topPitch - middleRow).toBe(62);
  });
});
