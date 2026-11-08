/** Short decaying blip on every beat: higher and louder on the first beat of the bar. */
export class Metronome {
  enabled = false;
  readonly #sampleRate: number;
  readonly #decay: number;
  #phase = 0;
  #frequency = 0;
  #level = 0;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    // About 40 ms to fade by 60 dB.
    this.#decay = Math.exp(Math.log(1e-3) / (0.04 * sampleRate));
  }

  /**
   * Adds the click to the mix. `triggerOffset` is the sample where a beat starts in this block
   * (-1 for none); `accent` marks a downbeat.
   */
  process(
    left: Float32Array,
    right: Float32Array,
    frames: number,
    triggerOffset: number,
    accent: boolean,
  ) {
    for (let i = 0; i < frames; i++) {
      if (i === triggerOffset) {
        this.#phase = 0;
        this.#frequency = accent ? 1760 : 1320;
        this.#level = accent ? 0.35 : 0.22;
      }
      if (this.#level < 1e-4) continue;
      const sample = (this.#phase < 0.5 ? 1 : -1) * this.#level;
      this.#phase = (this.#phase + this.#frequency / this.#sampleRate) % 1;
      this.#level *= this.#decay;
      left[i]! += sample;
      right[i]! += sample;
    }
  }
}
