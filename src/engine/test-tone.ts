import { SmoothedValue } from './dsp';
import type { TestToneSettings } from './protocol';

const AMPLITUDE = 0.25;

/** A plain oscillator used to verify the audio path before real synths exist. */
export class TestTone {
  settings: TestToneSettings = { enabled: false, frequency: 440, shape: 'square' };
  readonly #sampleRate: number;
  readonly #gain: SmoothedValue;
  #phase = 0;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.#gain = new SmoothedValue(0, sampleRate, 0.005);
  }

  next(): number {
    this.#gain.target = this.settings.enabled ? AMPLITUDE : 0;
    const gain = this.#gain.next();
    if (gain < 1e-6 && !this.settings.enabled) return 0;

    const phase = this.#phase;
    this.#phase = (phase + this.settings.frequency / this.#sampleRate) % 1;
    switch (this.settings.shape) {
      case 'square':
        return (phase < 0.5 ? 1 : -1) * gain;
      case 'triangle':
        return (phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase) * gain;
      case 'sine':
        return Math.sin(2 * Math.PI * phase) * gain;
    }
  }
}
