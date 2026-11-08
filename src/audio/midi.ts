import { parseMidiMessage, type MidiNoteMessage } from './midi-message';

export interface MidiDevice {
  id: string;
  name: string;
}

/** 'none' = ignore MIDI, 'all' = listen to every input, otherwise one input's id. */
export type MidiSelection = 'none' | 'all' | (string & {});

export function midiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

/**
 * Web MIDI input handling. Access is only requested on `enable()` (browsers may show a
 * permission prompt), so call it from a user action.
 */
export class MidiInputs {
  #access: MIDIAccess | null = null;
  #selection: MidiSelection = 'all';
  readonly #onMessage: (message: MidiNoteMessage) => void;
  readonly #onDevicesChange: (devices: MidiDevice[]) => void;

  constructor(
    onMessage: (message: MidiNoteMessage) => void,
    onDevicesChange: (devices: MidiDevice[]) => void,
  ) {
    this.#onMessage = onMessage;
    this.#onDevicesChange = onDevicesChange;
  }

  async enable(): Promise<MidiDevice[]> {
    if (!midiSupported()) throw new Error('Web MIDI is not supported in this browser.');
    if (!this.#access) {
      const access = await navigator.requestMIDIAccess();
      access.onstatechange = () => {
        this.#bind();
        this.#onDevicesChange(this.devices);
      };
      this.#access = access;
    }
    this.#bind();
    return this.devices;
  }

  get devices(): MidiDevice[] {
    if (!this.#access) return [];
    return [...this.#access.inputs.values()]
      .filter((input) => input.state === 'connected')
      .map((input) => ({ id: input.id, name: input.name || 'MIDI input' }));
  }

  select(selection: MidiSelection): void {
    this.#selection = selection;
    this.#bind();
  }

  #bind(): void {
    if (!this.#access) return;
    for (const input of this.#access.inputs.values()) {
      const listen = this.#selection === 'all' || this.#selection === input.id;
      input.onmidimessage = listen ? this.#handle : null;
    }
  }

  readonly #handle = (event: MIDIMessageEvent) => {
    if (!event.data) return;
    const message = parseMidiMessage(event.data);
    if (message) this.#onMessage(message);
  };
}
