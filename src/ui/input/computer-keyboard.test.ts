import { describe, expect, it } from 'vitest';
import { noteName, pianoPitch, PIANO_KEYS, shiftVelocity } from './computer-keyboard';

describe('computer keyboard piano', () => {
  it('maps A to C of the octave (octave 4 = middle C = 60)', () => {
    expect(pianoPitch('KeyA', 4)).toBe(60);
    expect(pianoPitch('KeyW', 4)).toBe(61);
    expect(pianoPitch('KeyK', 4)).toBe(72);
    expect(pianoPitch('Semicolon', 4)).toBe(76);
    expect(pianoPitch('KeyA', 0)).toBe(12);
  });

  it('covers a chromatic run without gaps', () => {
    const offsets = Object.values(PIANO_KEYS).sort((a, b) => a - b);
    expect(offsets).toEqual(Array.from({ length: offsets.length }, (_, i) => i));
  });

  it('ignores other keys and out-of-range pitches', () => {
    expect(pianoPitch('KeyQ', 4)).toBeNull();
    expect(pianoPitch('Digit1', 4)).toBeNull();
    expect(pianoPitch('Semicolon', 9)).toBeNull(); // 136 > 127
  });

  it('steps velocity through fixed levels', () => {
    expect(shiftVelocity(100, 1)).toBe(127);
    expect(shiftVelocity(127, 1)).toBe(127);
    expect(shiftVelocity(100, -1)).toBe(80);
    expect(shiftVelocity(20, -1)).toBe(20);
    expect(shiftVelocity(90, -1)).toBe(80);
  });

  it('names notes', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(noteName(13)).toBe('C#0');
  });
});
