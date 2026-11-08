import { describe, expect, it } from 'vitest';
import { parseMidiMessage } from './midi-message';

describe('parseMidiMessage', () => {
  it('parses note on/off on any channel', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({ type: 'noteOn', pitch: 60, velocity: 100 });
    expect(parseMidiMessage([0x9f, 61, 1])).toEqual({ type: 'noteOn', pitch: 61, velocity: 1 });
    expect(parseMidiMessage([0x80, 60, 64])).toEqual({ type: 'noteOff', pitch: 60 });
    expect(parseMidiMessage([0x85, 60, 0])).toEqual({ type: 'noteOff', pitch: 60 });
  });

  it('treats note-on with velocity 0 as note-off', () => {
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: 'noteOff', pitch: 60 });
  });

  it('maps all-notes-off and all-sound-off controllers', () => {
    expect(parseMidiMessage([0xb0, 123, 0])).toEqual({ type: 'allNotesOff' });
    expect(parseMidiMessage([0xb3, 120, 0])).toEqual({ type: 'allNotesOff' });
    expect(parseMidiMessage([0xb0, 1, 64])).toBeNull();
  });

  it('ignores everything else', () => {
    expect(parseMidiMessage([0xf8])).toBeNull(); // clock
    expect(parseMidiMessage([0xe0, 0, 64])).toBeNull(); // pitch bend
    expect(parseMidiMessage([])).toBeNull();
  });
});
