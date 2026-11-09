import { describe, expect, it } from 'vitest';
import { clearRange, cloneClip, createClip, placeClip, setClipStart } from './clips';
import { createTrack } from './defaults';
import type { Note, Track } from './types';

const note = (tick: number, pitch = 60, durationTicks = 100): Note => ({
  id: `n${tick}-${pitch}`,
  tick,
  durationTicks,
  pitch,
  velocity: 100,
});

function trackWith(...clips: [number, number, Note[]?][]): Track {
  const track = createTrack(0, 'p');
  track.clips = clips.map(([start, length, notes]) => createClip(start, length, 'p', notes ?? []));
  return track;
}

const spans = (track: Track) => track.clips.map((c) => [c.startTick, c.startTick + c.lengthTicks]);

describe('clip operations', () => {
  it('clearRange deletes clips inside the range and trims the ones sticking out', () => {
    const track = trackWith([0, 1000], [1000, 1000], [2000, 1000]);
    clearRange(track, 500, 2500);
    expect(spans(track)).toEqual([
      [0, 500],
      [2500, 3000],
    ]);
  });

  it('clearRange splits a clip that spans the range, keeping the notes on each side', () => {
    const track = trackWith([0, 4000, [note(100), note(2000), note(3500)]]);
    const originalId = track.clips[0]!.id;
    clearRange(track, 1000, 3000);
    expect(spans(track)).toEqual([
      [0, 1000],
      [3000, 4000],
    ]);
    expect(track.clips[0]!.id).toBe(originalId);
    expect(track.clips[1]!.id).not.toBe(originalId);
    expect(track.clips[0]!.notes.map((n) => n.tick)).toEqual([100]);
    expect(track.clips[1]!.notes.map((n) => n.tick)).toEqual([500]); // 3500 - 3000
    expect(track.clips.map((c) => c.presetId)).toEqual(['p', 'p']); // both halves keep the preset
  });

  it('placeClip trims what it overlaps and keeps clips sorted', () => {
    const track = trackWith([0, 2000], [3000, 1000]);
    placeClip(track, createClip(1500, 2000, 'p'));
    expect(spans(track)).toEqual([
      [0, 1500],
      [1500, 3500],
      [3500, 4000],
    ]);
  });

  it('setClipStart keeps notes in place in the song and hides the trimmed ones', () => {
    const clip = createClip(1000, 2000, 'p', [note(0), note(500)]);
    setClipStart(clip, 1200);
    expect(clip.startTick).toBe(1200);
    expect(clip.lengthTicks).toBe(1800);
    expect(clip.notes.map((n) => n.tick)).toEqual([-200, 300]); // still at song ticks 1000, 1500
  });

  it('cloneClip copies deeply with fresh ids', () => {
    const clip = createClip(0, 960, 'p', [note(0)]);
    const copy = cloneClip(clip, 1920);
    expect(copy.id).not.toBe(clip.id);
    expect(copy.startTick).toBe(1920);
    expect(copy.presetId).toBe('p'); // shares the preset
    expect(copy.notes[0]!.id).not.toBe(clip.notes[0]!.id);
    copy.notes[0]!.pitch = 72;
    expect(clip.notes[0]!.pitch).toBe(60);
  });
});
