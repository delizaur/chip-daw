import { BITCRUSH } from '../../model/boxes/effects';
import { paramReader } from '../../model/boxes/registry';
import type { BlockContext, EffectRuntime } from '../boxes/types';

const read = paramReader(BITCRUSH);

/** Bit-depth reduction plus sample-and-hold rate reduction (the classic lo-fi "crunch"). */
export class Bitcrush implements EffectRuntime {
  readonly #sampleRate: number;
  #step = 2 / 64;
  #increment = 0.25;
  #mix = 1;
  #phase = 1;
  #holdLeft = 0;
  #holdRight = 0;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.#step = 2 / Math.pow(2, Math.round(read(params, 'bits')));
    this.#increment = Math.min(1, read(params, 'rate') / this.#sampleRate);
    this.#mix = read(params, 'mix');
  }

  process(left: Float32Array, right: Float32Array, frames: number, _context: BlockContext): void {
    const step = this.#step;
    const mix = this.#mix;
    const dry = 1 - mix;
    let phase = this.#phase;
    for (let i = 0; i < frames; i++) {
      phase += this.#increment;
      if (phase >= 1) {
        phase -= 1;
        this.#holdLeft = Math.round(left[i]! / step) * step;
        this.#holdRight = Math.round(right[i]! / step) * step;
      }
      left[i] = left[i]! * dry + this.#holdLeft * mix;
      right[i] = right[i]! * dry + this.#holdRight * mix;
    }
    this.#phase = phase;
  }
}
