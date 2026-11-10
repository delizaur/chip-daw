import { describe, expect, it } from 'vitest';
import { createClip } from '../../model/clips';
import { PPQ } from '../../model/constants';
import { createTrack } from '../../model/defaults';
import {
  gridTicks,
  hitTest,
  loopMarkerAt,
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
  const a = createTrack(0, 'p');
  a.clips = [createClip(PPQ, 4 * PPQ, 'p')]; // x 32..160
  return [a, createTrack(1, 'p')];
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

describe('loop markers', () => {
  // 32 px per beat: a loop over beats 1..3 has markers at x = 32 and 96.
  const loop = { startTick: PPQ, endTick: 3 * PPQ };

  it('grabs a marker near it on the ruler only', () => {
    expect(loopMarkerAt(view, loop, 30, 10)).toBe('start');
    expect(loopMarkerAt(view, loop, 101, 10)).toBe('end');
    expect(loopMarkerAt(view, loop, 64, 10)).toBeNull(); // between them: the ruler seeks
    expect(loopMarkerAt(view, loop, 32, 40)).toBeNull(); // below the ruler: a lane
  });

  it('picks the nearer marker when both are in reach', () => {
    const short = { startTick: PPQ, endTick: PPQ + PPQ / 4 }; // 8 px apart
    expect(loopMarkerAt(view, short, 33, 10)).toBe('start');
    expect(loopMarkerAt(view, short, 39, 10)).toBe('end');
  });
});
