import { describe, expect, it } from 'vitest';
import { createClip } from './clips';
import { placeClips } from './commands';
import { PPQ } from './constants';
import { createProject } from './defaults';
import { History } from './history';
import {
  cleanMeters,
  deleteBars,
  deleteMeter,
  insertBars,
  setMeter,
  setTempoAt,
  setTempoEvents,
} from './tempo-commands';
import { barAt, barsBetween, barStart, bpmAt, formatPosition, meterAt, snapInMeter } from './time';
import type { MeterEvent, TempoMap } from './types';

const BAR = 4 * PPQ; // a 4/4 bar
const WALTZ = 3 * PPQ; // a 3/4 bar
const meter = (tick: number, numerator: number, denominator = 4): MeterEvent => ({
  tick,
  numerator,
  denominator,
  subdivision: 4,
});

/** 4/4 for two bars, then 3/4. */
const map: TempoMap = {
  tempos: [
    { tick: 0, bpm: 100, ramp: 'linear' },
    { tick: 2 * BAR, bpm: 140, ramp: 'step' },
  ],
  meters: [meter(0, 4), meter(2 * BAR, 3)],
};

describe('bars across time-signature changes', () => {
  it('numbers and sizes bars by the meter in effect', () => {
    expect(barAt(map, BAR + 10)).toMatchObject({ index: 1, start: BAR, length: BAR });
    expect(barAt(map, 2 * BAR + WALTZ + 1)).toMatchObject({
      index: 3,
      start: 2 * BAR + WALTZ,
      length: WALTZ,
    });
    expect(barStart(map, 3)).toBe(2 * BAR + WALTZ);
    expect(barsBetween(map, 0, 2 * BAR + 2 * WALTZ).map((b) => b.length)).toEqual([
      BAR,
      BAR,
      WALTZ,
      WALTZ,
    ]);
  });

  it('formats positions as bar.beat.sixteenth', () => {
    expect(formatPosition(map, 0)).toBe('1.1.1');
    expect(formatPosition(map, 2 * BAR + WALTZ + PPQ + PPQ / 4)).toBe('4.2.2');
  });

  it('snaps to the grid of the meter in effect', () => {
    expect(snapInMeter(map, 2 * BAR + WALTZ + 100, WALTZ)).toBe(2 * BAR + WALTZ);
    expect(meterAt(map, 2 * BAR).numerator).toBe(3);
  });
});

describe('tempo', () => {
  it('ramps linearly towards the next change, and steps after a step', () => {
    expect(bpmAt(map, 0)).toBe(100);
    expect(bpmAt(map, BAR)).toBeCloseTo(120);
    expect(bpmAt(map, 2 * BAR)).toBe(140);
    expect(bpmAt(map, 10 * BAR)).toBe(140);
  });

  it('keeps tempo events sorted, one per tick, the first at 0', () => {
    const h = new History(createProject(1));
    h.run(
      setTempoEvents([
        { tick: BAR, bpm: 1000, ramp: 'step' },
        { tick: 50, bpm: 90, ramp: 'linear' },
        { tick: BAR, bpm: 130, ramp: 'step' },
      ]),
    );
    expect(h.state.tempoMap.tempos).toEqual([
      { tick: 0, bpm: 90, ramp: 'linear' },
      { tick: BAR, bpm: 130, ramp: 'step' },
    ]);
    h.run(setTempoAt(BAR + 10, 150));
    expect(h.state.tempoMap.tempos[1]!.bpm).toBe(150);
  });
});

describe('time signatures', () => {
  it('keeps later changes on bar lines and drops repeats', () => {
    // 3/4 at bar 3, then 4/4 two 3/4-bars later; changing bar 2 to 7/8 moves that 4/4 to a bar
    // line of the 7/8 bars.
    const meters = [meter(0, 4), meter(BAR, 7, 8), meter(2 * BAR + 100, 4), meter(5 * BAR, 4)];
    const clean = cleanMeters(meters);
    const seven = (7 * PPQ) / 2;
    expect(clean).toEqual([meter(0, 4), meter(BAR, 7, 8), meter(BAR + 2 * seven, 4)]);
  });

  it('sets and deletes changes, undoably', () => {
    const h = new History(createProject(1));
    h.run(setMeter(2 * BAR, 3, 4));
    expect(h.state.tempoMap.meters.map((m) => [m.tick, m.numerator])).toEqual([
      [0, 4],
      [2 * BAR, 3],
    ]);
    h.run(deleteMeter(2 * BAR));
    expect(h.state.tempoMap.meters).toHaveLength(1);
    h.undo();
    expect(h.state.tempoMap.meters).toHaveLength(2);
  });
});

describe('inserting and deleting bars', () => {
  function song() {
    const h = new History(createProject(1));
    const track = () => h.state.tracks[0]!;
    const presetId = track().presetId;
    const note = (tick: number) => ({
      id: `n${tick}`,
      tick,
      durationTicks: 100,
      pitch: 60,
      velocity: 100,
    });
    // A clip across bars 1-2 (notes in both), and one in bar 4.
    h.run(
      placeClips([
        { trackId: track().id, clip: createClip(0, 2 * BAR, presetId, [note(0), note(BAR + 10)]) },
        { trackId: track().id, clip: createClip(3 * BAR, BAR, presetId, [note(0)]) },
      ]),
    );
    h.run(
      setTempoEvents([
        { tick: 0, bpm: 120, ramp: 'step' },
        { tick: 3 * BAR, bpm: 90, ramp: 'step' },
      ]),
    );
    h.run(setMeter(3 * BAR, 3, 4));
    const spans = () => track().clips.map((c) => [c.startTick, c.lengthTicks, c.notes.length]);
    return { h, spans };
  }

  it('inserting splits clips at the point and moves everything after it', () => {
    const { h, spans } = song();
    h.run(insertBars(BAR, 2 * BAR));
    expect(spans()).toEqual([
      [0, BAR, 1],
      [3 * BAR, BAR, 1],
      [5 * BAR, BAR, 1],
    ]);
    expect(h.state.tempoMap.tempos[1]!.tick).toBe(5 * BAR);
    expect(h.state.tempoMap.meters[1]!.tick).toBe(5 * BAR);
    expect(h.state.loop).toEqual({ startTick: 0, endTick: 6 * BAR });
    expect(h.undoLabel).toBe('Insert bars');
  });

  it('deleting removes the material, closes the gap, and keeps later tempo and meter', () => {
    const { h, spans } = song();
    h.run(deleteBars(BAR, 3 * BAR)); // bars 2-3
    expect(spans()).toEqual([
      [0, BAR, 1],
      [BAR, BAR, 1],
    ]);
    expect(h.state.tempoMap.tempos).toEqual([
      { tick: 0, bpm: 120, ramp: 'step' },
      { tick: BAR, bpm: 90, ramp: 'step' },
    ]);
    expect(h.state.tempoMap.meters.map((m) => [m.tick, m.numerator])).toEqual([
      [0, 4],
      [BAR, 3],
    ]);
    expect(h.state.loop).toEqual({ startTick: 0, endTick: 2 * BAR });
    h.undo();
    expect(spans()).toHaveLength(2);
  });

  it('deleting across a tempo change carries the tempo playing at the end', () => {
    const { h } = song();
    h.run(deleteBars(2 * BAR, 4 * BAR)); // bars 3-4: the 90 BPM change at bar 4 is inside
    expect(h.state.tempoMap.tempos).toEqual([
      { tick: 0, bpm: 120, ramp: 'step' },
      { tick: 2 * BAR, bpm: 90, ramp: 'step' },
    ]);
  });
});
