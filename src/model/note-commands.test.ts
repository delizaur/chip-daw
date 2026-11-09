import { describe, expect, it } from 'vitest';
import { createClip } from './clips';
import { placeClips } from './commands';
import { PPQ } from './constants';
import { createProject } from './defaults';
import { History } from './history';
import { addNotes, deleteNotes, quantizeNotes, updateNotes } from './note-commands';
import type { Note } from './types';

const note = (id: string, tick: number, pitch = 60): Note => ({
  id,
  tick,
  durationTicks: PPQ / 4,
  pitch,
  velocity: 100,
});

function setup(clipStart = 0) {
  const h = new History(createProject());
  const trackId = h.state.tracks[0]!.id;
  const clip = createClip(clipStart, 4 * PPQ, h.state.tracks[0]!.presetId);
  h.run(placeClips([{ trackId, clip }]));
  const address = { trackId, clipId: clip.id };
  const notes = () => h.state.tracks[0]!.clips[0]!.notes;
  return { h, address, notes };
}

describe('note commands', () => {
  it('adds, updates and deletes notes, undoably', () => {
    const { h, address, notes } = setup();
    h.run(addNotes(address, [note('a', 0), note('b', PPQ, 64)]));
    expect(notes().map((n) => n.id)).toEqual(['a', 'b']);

    h.run(updateNotes(address, [{ id: 'a', tick: 2 * PPQ, pitch: 67, durationTicks: PPQ }]));
    expect(notes()[0]).toMatchObject({ tick: 2 * PPQ, pitch: 67, durationTicks: PPQ });

    h.run(deleteNotes(address, ['b']));
    expect(notes().map((n) => n.id)).toEqual(['a']);

    h.undo();
    h.undo();
    h.undo();
    expect(notes()).toEqual([]);
  });

  it('clamps pitch, velocity, length and start', () => {
    const { h, address, notes } = setup();
    h.run(addNotes(address, [{ ...note('a', -50), pitch: 200, velocity: 0, durationTicks: 0 }]));
    expect(notes()[0]).toMatchObject({ tick: 0, pitch: 127, velocity: 1, durationTicks: 1 });
    h.run(updateNotes(address, [{ id: 'a', pitch: -3, velocity: 500 }]));
    expect(notes()[0]).toMatchObject({ pitch: 0, velocity: 127 });
  });

  it('ignores changes to notes that no longer exist', () => {
    const { h, address } = setup();
    const before = h.state;
    h.run(updateNotes(address, [{ id: 'gone', pitch: 70 }]));
    expect(h.state).toBe(before);
    expect(h.undoLabel).toBe('Add clip');
  });

  it('quantizes to the song grid, also for clips that start off-grid', () => {
    const { h, address, notes } = setup(100); // clip starts 100 ticks after a beat
    h.run(addNotes(address, [note('a', 50), note('b', PPQ - 150), note('c', 30)]));
    h.run(quantizeNotes(address, ['a', 'b'], PPQ));
    // a: song tick 150 → 0, clamped to the clip start; b: song tick 910 → 960
    expect(notes().map((n) => [n.id, 100 + n.tick])).toEqual([
      ['a', 100],
      ['b', PPQ],
      ['c', 130],
    ]);
  });
});
