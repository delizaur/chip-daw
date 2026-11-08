import { describe, expect, it } from 'vitest';
import { createClip } from '../../model/clips';
import { PPQ } from '../../model/constants';
import { createTrack } from '../../model/defaults';
import {
  gridTicks,
  hitTest,
  LANE_HEIGHT,
  RULER_HEIGHT,
  tickToX,
  xToTick,
  zoomAround,
  type TimelineView,
} from './geometry';

const meter = { tick: 0, numerator: 4, denominator: 4, subdivision: 16 };
const view: TimelineView = { pixelsPerTick: 32 / PPQ, scrollTick: 0 }; // 32 px per beat

function tracks() {
  const a = createTrack(0);
  a.clips = [createClip(PPQ, 4 * PPQ)]; // x 32..160
  return [a, createTrack(1)];
}

describe('timeline geometry', () => {
  it('converts between ticks and pixels with scrolling', () => {
    const scrolled = { ...view, scrollTick: 4 * PPQ };
    expect(tickToX(scrolled, 5 * PPQ)).toBe(32);
    expect(xToTick(scrolled, 64)).toBe(6 * PPQ);
  });

  it('picks a grid for the zoom level', () => {
    expect(gridTicks({ ...view, pixelsPerTick: 80 / PPQ }, meter)).toBe(PPQ / 4);
    expect(gridTicks(view, meter)).toBe(PPQ);
    expect(gridTicks({ ...view, pixelsPerTick: 4 / PPQ }, meter)).toBe(4 * PPQ);
  });

  it('hits the ruler, lanes, clips and clip edges', () => {
    const t = tracks();
    const laneY = RULER_HEIGHT + LANE_HEIGHT / 2;
    expect(hitTest(t, view, 10, 5)).toMatchObject({ kind: 'ruler' });
    expect(hitTest(t, view, 10, laneY)).toMatchObject({ kind: 'lane', trackIndex: 0 });
    expect(hitTest(t, view, 100, laneY)).toMatchObject({ kind: 'clip', edge: null });
    expect(hitTest(t, view, 33, laneY)).toMatchObject({ kind: 'clip', edge: 'start' });
    expect(hitTest(t, view, 158, laneY)).toMatchObject({ kind: 'clip', edge: 'end' });
    expect(hitTest(t, view, 100, laneY + LANE_HEIGHT)).toMatchObject({
      kind: 'lane',
      trackIndex: 1,
    });
    expect(hitTest(t, view, 100, laneY + 5 * LANE_HEIGHT)).toEqual({ kind: 'none' });
  });

  it('zooms around the pointer', () => {
    const zoomed = zoomAround(view, 2, 64); // tick under x=64 is 2 beats
    expect(xToTick(zoomed, 64)).toBeCloseTo(2 * PPQ);
    expect(zoomed.pixelsPerTick).toBeCloseTo(64 / PPQ);
  });
});
