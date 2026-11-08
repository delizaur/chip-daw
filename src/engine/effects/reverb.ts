import { REVERB } from '../../model/boxes/effects';
import { paramValue } from '../../model/boxes/registry';
import type { BlockContext, EffectRuntime } from '../boxes/types';

/** Freeverb tunings (in samples at 44.1 kHz), scaled to the sample rate. */
const COMB_TUNINGS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNINGS = [556, 441, 341, 225];
const STEREO_SPREAD = 23;
const INPUT_GAIN = 0.015;
const WET_SCALE = 3;

const flush = (x: number) => (Math.abs(x) < 1e-20 ? 0 : x);

class Comb {
  readonly #buffer: Float32Array;
  #index = 0;
  #store = 0;
  feedback = 0.84;
  damp = 0.2;

  constructor(length: number) {
    this.#buffer = new Float32Array(length);
  }

  process(input: number): number {
    const output = this.#buffer[this.#index]!;
    this.#store = flush(output * (1 - this.damp) + this.#store * this.damp);
    this.#buffer[this.#index] = input + this.#store * this.feedback;
    if (++this.#index === this.#buffer.length) this.#index = 0;
    return output;
  }
}

class Allpass {
  readonly #buffer: Float32Array;
  #index = 0;

  constructor(length: number) {
    this.#buffer = new Float32Array(length);
  }

  process(input: number): number {
    const buffered = this.#buffer[this.#index]!;
    this.#buffer[this.#index] = flush(input + buffered * 0.5);
    if (++this.#index === this.#buffer.length) this.#index = 0;
    return buffered - input;
  }
}

/** Freeverb: 8 parallel damped combs into 4 series allpasses, per channel. */
export class Reverb implements EffectRuntime {
  readonly #combsL: Comb[];
  readonly #combsR: Comb[];
  readonly #allpassesL: Allpass[];
  readonly #allpassesR: Allpass[];
  #wet1 = 0;
  #wet2 = 0;

  constructor(sampleRate: number) {
    const scale = (n: number) => Math.max(1, Math.round((n * sampleRate) / 44100));
    this.#combsL = COMB_TUNINGS.map((n) => new Comb(scale(n)));
    this.#combsR = COMB_TUNINGS.map((n) => new Comb(scale(n + STEREO_SPREAD)));
    this.#allpassesL = ALLPASS_TUNINGS.map((n) => new Allpass(scale(n)));
    this.#allpassesR = ALLPASS_TUNINGS.map((n) => new Allpass(scale(n + STEREO_SPREAD)));
  }

  setParams(params: Readonly<Record<string, number>>): void {
    const value = (id: string) =>
      paramValue(
        { id: '', type: REVERB.type, params },
        REVERB.params.find((p) => p.id === id)!,
      );
    const feedback = 0.7 + value('size') * 0.28;
    const damp = value('damping') * 0.4;
    for (const comb of [...this.#combsL, ...this.#combsR]) {
      comb.feedback = feedback;
      comb.damp = damp;
    }
    const wet = value('wet') * WET_SCALE;
    const width = value('width');
    this.#wet1 = wet * (width / 2 + 0.5);
    this.#wet2 = wet * ((1 - width) / 2);
  }

  process(left: Float32Array, right: Float32Array, frames: number, _context: BlockContext): void {
    const combsL = this.#combsL;
    const combsR = this.#combsR;
    const allpassesL = this.#allpassesL;
    const allpassesR = this.#allpassesR;
    for (let i = 0; i < frames; i++) {
      const input = (left[i]! + right[i]!) * INPUT_GAIN;
      let outL = 0;
      let outR = 0;
      for (let c = 0; c < combsL.length; c++) {
        outL += combsL[c]!.process(input);
        outR += combsR[c]!.process(input);
      }
      for (let a = 0; a < allpassesL.length; a++) {
        outL = allpassesL[a]!.process(outL);
        outR = allpassesR[a]!.process(outR);
      }
      left[i] = left[i]! + outL * this.#wet1 + outR * this.#wet2;
      right[i] = right[i]! + outR * this.#wet1 + outL * this.#wet2;
    }
  }
}
