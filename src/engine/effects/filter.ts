import { FILTER, FilterType } from '../../model/boxes/effects';
import { paramReader } from '../../model/boxes/registry';
import type { BlockContext, EffectRuntime } from '../boxes/types';

const read = paramReader(FILTER);

/** Per-block smoothing of the cutoff, so knob moves don't click. */
const CUTOFF_SMOOTHING = 0.25;

/**
 * State-variable filter (Simper / Cytomics "SVF" topology): stable under fast modulation,
 * with low-pass, high-pass and band-pass outputs. Resonance 0..1 maps to Q ≈ 0.5..25.
 */
export class Filter implements EffectRuntime {
  readonly #sampleRate: number;
  #type: number = FilterType.LowPass;
  #targetCutoff = 2000;
  #cutoff = 2000;
  #k = 1.6;
  // Integrator states, left and right.
  #ic1L = 0;
  #ic2L = 0;
  #ic1R = 0;
  #ic2R = 0;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.#type = Math.round(read(params, 'type'));
    this.#targetCutoff = read(params, 'cutoff');
    this.#k = 2 - 1.96 * read(params, 'resonance');
  }

  process(left: Float32Array, right: Float32Array, frames: number, _context: BlockContext): void {
    this.#cutoff += (this.#targetCutoff - this.#cutoff) * CUTOFF_SMOOTHING;
    const fc = Math.min(this.#cutoff, this.#sampleRate * 0.45);
    const g = Math.tan((Math.PI * fc) / this.#sampleRate);
    const k = this.#k;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const type = this.#type;

    let ic1 = this.#ic1L;
    let ic2 = this.#ic2L;
    for (let i = 0; i < frames; i++) {
      const v0 = left[i]!;
      const v3 = v0 - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      left[i] =
        type === FilterType.LowPass ? v2 : type === FilterType.HighPass ? v0 - k * v1 - v2 : v1;
    }
    this.#ic1L = Math.abs(ic1) < 1e-20 ? 0 : ic1;
    this.#ic2L = Math.abs(ic2) < 1e-20 ? 0 : ic2;

    ic1 = this.#ic1R;
    ic2 = this.#ic2R;
    for (let i = 0; i < frames; i++) {
      const v0 = right[i]!;
      const v3 = v0 - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      right[i] =
        type === FilterType.LowPass ? v2 : type === FilterType.HighPass ? v0 - k * v1 - v2 : v1;
    }
    this.#ic1R = Math.abs(ic1) < 1e-20 ? 0 : ic1;
    this.#ic2R = Math.abs(ic2) < 1e-20 ? 0 : ic2;
  }
}
