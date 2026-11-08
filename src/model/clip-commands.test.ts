import { describe, expect, it } from 'vitest';
import {
  deleteClips,
  moveClips,
  placeClips,
  recordTake,
  resizeClip,
  setTempo,
  type RecordedNote,
} from './commands';
import { createClip } from './clips';
import { PPQ } from './constants';
import { createProject } from './defaults';
import { History } from './history';
import { formatPosition } from './time';

const BAR = PPQ * 4;

function setup() {
  const h = new History(createProject());
  const id = (i: number) => h.state.tracks[i]!.id;
  const clips = (i: number) =>
    h.state.tracks[i]!.clips.map((c) => [c.startTick, c.startTick + c.lengthTicks]);
  return { h, id, clips };
}

describe('clip commands', () => {
  it('places, moves (across tracks) and deletes clips, all undoable', () => {
    const { h, id, clips } = setup();
    const a = createClip(0, BAR);
    const b = createClip(2 * BAR, BAR);
    h.run(
      placeClips([
        { trackId: id(0), clip: a },
        { trackId: id(0), clip: b },
      ]),
    );
    expect(clips(0)).toEqual([
      [0, BAR],
      [2 * BAR, 3 * BAR],
    ]);

    h.run(moveClips([a.id], BAR, 2));
    expect(clips(0)).toEqual([[2 * BAR, 3 * BAR]]);
    expect(clips(2)).toEqual([[BAR, 2 * BAR]]);

    h.run(deleteClips([b.id]));
    expect(clips(0)).toEqual([]);

    h.undo();
    h.undo();
    h.undo();
    expect(h.state.tracks.every((t) => t.clips.length === 0)).toBe(true);
  });

  it('clamps moves to the song start and the track list', () => {
    const { h, id, clips } = setup();
    const a = createClip(BAR, BAR);
    h.run(placeClips([{ trackId: id(6), clip: a }]));
    h.run(moveClips([a.id], -10 * BAR, 5));
    expect(clips(7)).toEqual([[0, BAR]]);
  });

  it('moved clips trim the clips they land on', () => {
    const { h, id, clips } = setup();
    const a = createClip(0, 2 * BAR);
    const b = createClip(4 * BAR, BAR);
    h.run(
      placeClips([
        { trackId: id(0), clip: a },
        { trackId: id(0), clip: b },
      ]),
    );
    h.run(moveClips([b.id], -3 * BAR, 0));
    expect(clips(0)).toEqual([
      [0, BAR],
      [BAR, 2 * BAR],
    ]);
  });

  it('resizes from either edge, keeping notes in place', () => {
    const { h, id } = setup();
    const a = createClip(BAR, 2 * BAR, [
      { id: 'n', tick: PPQ, durationTicks: PPQ, pitch: 60, velocity: 100 },
    ]);
    h.run(placeClips([{ trackId: id(0), clip: a }]));
    h.run(resizeClip(id(0), a.id, BAR + PPQ / 2, 4 * BAR));
    const clip = h.state.tracks[0]!.clips[0]!;
    expect([clip.startTick, clip.lengthTicks]).toEqual([BAR + PPQ / 2, 3 * BAR - PPQ / 2]);
    expect(clip.startTick + clip.notes[0]!.tick).toBe(BAR + PPQ);
  });

  it('sets the tempo within limits', () => {
    const { h } = setup();
    h.run(setTempo(90));
    expect(h.state.tempoMap.tempos[0]!.bpm).toBe(90);
    h.run(setTempo(5000));
    expect(h.state.tempoMap.tempos[0]!.bpm).toBe(400);
  });
});

describe('recordTake', () => {
  const take = (trackId: string, notes: [number, number, number][], start = 0, end = BAR) => ({
    startTick: start,
    endTick: end,
    notes: notes.map(([pitch, startTick, endTick]): RecordedNote => ({
      trackId,
      pitch,
      velocity: 100,
      startTick,
      endTick,
    })),
  });

  it('creates one clip per track, spanning whole bars, with notes relative to the clip', () => {
    const { h, id, clips } = setup();
    h.run(recordTake(take(id(1), [[60, BAR + 100, BAR + 500]], BAR + 50, 2 * BAR + 10), false));
    expect(clips(1)).toEqual([[BAR, 3 * BAR]]);
    const note = h.state.tracks[1]!.clips[0]!.notes[0]!;
    expect([note.tick, note.durationTicks, note.pitch]).toEqual([100, 400, 60]);
    expect(h.undoLabel).toBe('Record');
  });

  it('gives very short taps a minimum length', () => {
    const { h, id } = setup();
    h.run(recordTake(take(id(0), [[60, 100, 100]]), false));
    expect(h.state.tracks[0]!.clips[0]!.notes[0]!.durationTicks).toBeGreaterThan(0);
  });

  it('without overdub, replaces what was underneath', () => {
    const { h, id, clips } = setup();
    h.run(recordTake(take(id(0), [[60, 0, 100]], 0, 3 * BAR), false));
    h.run(recordTake(take(id(0), [[64, BAR, BAR + 100]], BAR, 2 * BAR), false));
    expect(clips(0)).toEqual([
      [0, BAR],
      [BAR, 2 * BAR],
      [2 * BAR, 3 * BAR],
    ]);
    expect(h.state.tracks[0]!.clips[1]!.notes.map((n) => n.pitch)).toEqual([64]);
  });

  it('with overdub, merges into the clips it overlaps', () => {
    const { h, id, clips } = setup();
    h.run(recordTake(take(id(0), [[60, 0, 100]], 0, 2 * BAR), false));
    h.run(recordTake(take(id(0), [[64, BAR, BAR + 100]], BAR, 3 * BAR), true));
    expect(clips(0)).toEqual([[0, 3 * BAR]]);
    expect(h.state.tracks[0]!.clips[0]!.notes.map((n) => [n.tick, n.pitch])).toEqual([
      [0, 60],
      [BAR, 64],
    ]);
    expect(h.undoLabel).toBe('Overdub');
  });

  it('ignores takes without notes and unknown tracks', () => {
    const { h, id } = setup();
    h.run(recordTake({ startTick: 0, endTick: BAR, notes: [] }, false));
    h.run(recordTake(take('missing', [[60, 0, 10]]), false));
    expect(h.canUndo).toBe(false);
    expect(id(0)).toBeTruthy();
  });
});

describe('formatPosition', () => {
  it('shows bar.beat.sixteenth, 1-based', () => {
    const { tempoMap } = createProject();
    expect(formatPosition(tempoMap, 0)).toBe('1.1.1');
    expect(formatPosition(tempoMap, BAR + PPQ + PPQ / 4)).toBe('2.2.2');
  });
});
