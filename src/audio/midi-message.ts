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

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteLabel = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

/** System real-time messages (clock, active sensing...) that some devices send constantly. */
export function isRealtimeMessage(data: ArrayLike<number>): boolean {
  return (data[0] ?? 0) >= 0xf8;
}

/** Human-readable description of a MIDI message, for the activity light's tooltip. */
export function describeMidiMessage(data: ArrayLike<number>): string {
  const status = data[0] ?? 0;
  const channel = `ch ${(status & 0x0f) + 1}`;
  const data1 = (data[1] ?? 0) & 0x7f;
  const data2 = (data[2] ?? 0) & 0x7f;
  switch (status & 0xf0) {
    case 0x90:
      return data2 > 0
        ? `Note on ${noteLabel(data1)} vel ${data2} · ${channel}`
        : `Note off ${noteLabel(data1)} · ${channel}`;
    case 0x80:
      return `Note off ${noteLabel(data1)} · ${channel}`;
    case 0xb0:
      return `Control ${data1} = ${data2} · ${channel}`;
    case 0xc0:
      return `Program ${data1 + 1} · ${channel}`;
    case 0xe0:
      return `Pitch bend ${((data2 << 7) | data1) - 8192} · ${channel}`;
    default:
      return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' ');
  }
}
