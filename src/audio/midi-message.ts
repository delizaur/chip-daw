export type MidiNoteMessage =
  | { type: 'noteOn'; pitch: number; velocity: number }
  | { type: 'noteOff'; pitch: number }
  | { type: 'allNotesOff' };

/**
 * Parses the MIDI messages chip-daw uses, on any channel (omni). Note-on with velocity 0
 * means note-off. CC 120 (all sound off) and 123 (all notes off) release everything.
 */
export function parseMidiMessage(data: ArrayLike<number>): MidiNoteMessage | null {
  const status = (data[0] ?? 0) & 0xf0;
  const data1 = (data[1] ?? 0) & 0x7f;
  const data2 = (data[2] ?? 0) & 0x7f;
  switch (status) {
    case 0x90:
      return data2 > 0
        ? { type: 'noteOn', pitch: data1, velocity: data2 }
        : { type: 'noteOff', pitch: data1 };
    case 0x80:
      return { type: 'noteOff', pitch: data1 };
    case 0xb0:
      return data1 === 120 || data1 === 123 ? { type: 'allNotesOff' } : null;
    default:
      return null;
  }
}
