export interface Voice {
  pitch: number;
  /** True from note-on until the release tail has ended. */
  readonly active: boolean;
  readonly releasing: boolean;
  start(pitch: number, velocity: number): void;
  release(): void;
  /** Adds `frames` mono samples to `out`, starting at `offset`. */
  render(out: Float32Array, offset: number, frames: number): void;
}

/**
 * Polyphonic voice allocation for any synth. A new note takes a free voice, else the oldest
 * releasing voice, else the oldest voice overall.
 */
export class VoicePool<V extends Voice> {
  readonly voices: readonly V[];
  readonly #startOrder: number[];
  #counter = 0;

  constructor(voices: V[]) {
    this.voices = voices;
    this.#startOrder = voices.map(() => 0);
  }

  noteOn(pitch: number, velocity: number): void {
    const index = this.#pick();
    this.#startOrder[index] = ++this.#counter;
    this.voices[index]!.start(pitch, velocity);
  }

  noteOff(pitch: number): void {
    for (const voice of this.voices) {
      if (voice.active && !voice.releasing && voice.pitch === pitch) voice.release();
    }
  }

  allNotesOff(): void {
    for (const voice of this.voices) voice.release();
  }

  render(out: Float32Array, offset: number, frames: number): void {
    for (const voice of this.voices) if (voice.active) voice.render(out, offset, frames);
  }

  get activeCount(): number {
    let count = 0;
    for (const voice of this.voices) if (voice.active) count++;
    return count;
  }

  #pick(): number {
    let oldestReleasing = -1;
    let oldest = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i]!;
      if (!voice.active) return i;
      const order = this.#startOrder[i]!;
      if (voice.releasing && (oldestReleasing < 0 || order < this.#startOrder[oldestReleasing]!)) {
        oldestReleasing = i;
      }
      if (order < this.#startOrder[oldest]!) oldest = i;
    }
    return oldestReleasing >= 0 ? oldestReleasing : oldest;
  }
}
