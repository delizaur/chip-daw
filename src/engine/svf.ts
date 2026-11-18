/**
 * State-variable filter (TPT / Cytomics form): one call gives the low-, band- and high-pass
 * of the same input. Set the cutoff once per block with `set` (it calls tan); `process` is
 * cheap and allocation-free.
 */
export class Svf {
  low = 0;
  band = 0;
  high = 0;
  #ic1 = 0;
  #ic2 = 0;
  #a1 = 0;
  #a2 = 0;
  #a3 = 0;
  #k = 1;

  /** `q` above ~0.7 resonates (the band-pass peaks at 1 whatever the q). */
  set(cutoff: number, q: number, sampleRate: number): void {
    const g = Math.tan((Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
    this.#k = 1 / q;
    this.#a1 = 1 / (1 + g * (g + this.#k));
    this.#a2 = g * this.#a1;
    this.#a3 = g * this.#a2;
  }

  process(x: number): void {
    const v3 = x - this.#ic2;
    const v1 = this.#a1 * this.#ic1 + this.#a2 * v3;
    const v2 = this.#ic2 + this.#a2 * this.#ic1 + this.#a3 * v3;
    this.#ic1 = 2 * v1 - this.#ic1;
    this.#ic2 = 2 * v2 - this.#ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - this.#k * v1 - v2;
  }

  reset(): void {
    this.#ic1 = 0;
    this.#ic2 = 0;
  }
}
