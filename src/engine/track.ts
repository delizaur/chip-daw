import type { BoxInstance, Track } from '../model/types';
import { createSynth } from './boxes/registry';
import type { SynthRuntime } from './boxes/types';
import { SmoothedValue, volumeToGain } from './dsp';

/**
 * Audio-thread state for one track: its synth, gain, and buffers.
 * `sync` (on project changes) may allocate; `process` must not.
 */
export class TrackRuntime {
  readonly id: string;
  readonly #sampleRate: number;
  readonly #gain: SmoothedValue;
  #synth: SynthRuntime | null = null;
  /** The synth box the runtime was built from. Immer keeps unchanged objects identical. */
  #synthBox: BoxInstance | null = null;
  #left = new Float32Array(128);
  #right = new Float32Array(128);

  constructor(id: string, sampleRate: number) {
    this.id = id;
    this.#sampleRate = sampleRate;
    this.#gain = new SmoothedValue(0, sampleRate);
  }

  /** Updates the runtime from the project. `audible` accounts for mute and solo. */
  sync(track: Track, audible: boolean): void {
    this.#gain.target = audible ? volumeToGain(track.volume) : 0;

    // Phase 1 has no transport yet: the preset that sounds is the one at the start of the song.
    const box = track.segments[0]?.preset.synth ?? null;
    if (box === this.#synthBox) return;
    if (!box) {
      this.#synth = null;
    } else if (!this.#synth || this.#synthBox?.id !== box.id || this.#synthBox.type !== box.type) {
      this.#synth = createSynth(box.type, this.#sampleRate);
      this.#synth?.setParams(box.params);
    } else {
      this.#synth.setParams(box.params);
    }
    this.#synthBox = box;
  }

  noteOn(pitch: number, velocity: number): void {
    this.#synth?.noteOn(pitch, velocity);
  }

  noteOff(pitch: number): void {
    this.#synth?.noteOff(pitch);
  }

  allNotesOff(): void {
    this.#synth?.allNotesOff();
  }

  /** Renders the track and adds it, with its gain, to the mix buffers. */
  process(mixLeft: Float32Array, mixRight: Float32Array, frames: number): void {
    if (this.#left.length < frames) {
      this.#left = new Float32Array(frames);
      this.#right = new Float32Array(frames);
    }
    const left = this.#left;
    const right = this.#right;
    left.fill(0, 0, frames);
    right.fill(0, 0, frames);
    this.#synth?.process(left, right, frames);

    const gain = this.#gain;
    for (let i = 0; i < frames; i++) {
      const g = gain.next();
      mixLeft[i]! += left[i]! * g;
      mixRight[i]! += right[i]! * g;
    }
  }
}
