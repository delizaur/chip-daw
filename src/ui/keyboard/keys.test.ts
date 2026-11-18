import { describe, expect, it } from 'vitest';
import {
  isBlack,
  keyLight,
  layoutKeys,
  pitchName,
  scaleNotes,
  SCALES,
  whiteKeyCount,
} from './keys';

describe('layoutKeys', () => {
  it('lays out a full piano: 88 keys, 52 white', () => {
    const keys = layoutKeys();
    expect(keys).toHaveLength(88);
    expect(whiteKeyCount()).toBe(52);
    expect(keys[0]).toMatchObject({ pitch: 21, black: false, x: 0 }); // A0
    expect(keys.at(-1)).toMatchObject({ pitch: 108, black: false, x: 51 }); // C8
  });

  it('puts black keys across the line between white keys', () => {
    const [c, cSharp, d] = layoutKeys(60, 62);
    expect(c).toMatchObject({ x: 0, width: 1 });
    expect(cSharp).toMatchObject({ black: true, x: 0.7, width: 0.6 });
    expect(d).toMatchObject({ x: 1 });
  });
});

describe('names and colors', () => {
  it('knows black keys and names', () => {
    expect([60, 61, 63, 64, 66, 70, 71].map(isBlack)).toEqual([
      false,
      true,
      true,
      false,
      true,
      true,
      false,
    ]);
    expect(pitchName(60)).toBe('C4');
    expect(pitchName(70)).toBe('A♯4');
    expect(pitchName(21)).toBe('A0');
  });
});

describe('scaleNotes', () => {
  it('builds each scale on a root', () => {
    expect([...scaleNotes(0, 'major')]).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect([...scaleNotes(9, 'minor')].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleNotes(2, 'dorian')).toEqual(scaleNotes(0, 'major')); // D dorian = C major
    expect(scaleNotes(11, 'locrian')).toEqual(scaleNotes(0, 'major'));
    expect(scaleNotes(7, 'mixolydian')).toEqual(scaleNotes(0, 'major'));
    expect(scaleNotes(5, 'lydian')).toEqual(scaleNotes(0, 'major'));
    expect(scaleNotes(4, 'phrygian')).toEqual(scaleNotes(0, 'major'));
    expect(scaleNotes(9, 'harmonicMinor').has(8)).toBe(true); // G♯ in A harmonic minor
    expect(scaleNotes(9, 'melodicMinor').has(6)).toBe(true); // F♯ in A melodic minor
  });

  it('has seven notes in every scale', () => {
    for (const scale of SCALES) expect(scaleNotes(3, scale.id).size).toBe(7);
  });
});

describe('keyLight', () => {
  const sounding = [new Set([60]), undefined, new Set([60, 62]), new Set([62])];

  it('is bright in the live track color when played live', () => {
    expect(keyLight(60, new Map([[60, 1]]), sounding, 0)).toEqual({ tracks: [1], live: true });
  });

  it('is dim in the colors of the tracks playing it, the selected track first', () => {
    expect(keyLight(60, new Map(), sounding, 0)).toEqual({ tracks: [0, 2], live: false });
    expect(keyLight(62, new Map(), sounding, 3)).toEqual({ tracks: [3, 2], live: false });
    expect(keyLight(64, new Map(), sounding, 0)).toBeNull();
  });
});
