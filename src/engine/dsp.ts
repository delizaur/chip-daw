/** Maps a 0..1 volume control to linear gain with a perceptual (squared) taper. */
export function volumeToGain(volume: number): number {
  const v = Math.min(1, Math.max(0, volume));
  return v * v;
}

/** Distance at which smoothing snaps to its target (an exponential never quite arrives). */
const SNAP = 1e-6;

/**
 * One-pole smoothing towards a target value, to avoid zipper noise when
 * parameters change. Allocation-free once constructed. Snaps to the target once within
 * 1e-6, so a fade to 0 really reaches silence (and avoids denormal numbers).
 */
export class SmoothedValue {
  current: number;
  target: number;
  readonly #coefficient: number;

  constructor(initial: number, sampleRate: number, timeSeconds = 0.02) {
    this.current = initial;
    this.target = initial;
    this.#coefficient = 1 - Math.exp(-1 / (timeSeconds * sampleRate));
  }

  next(): number {
    const difference = this.target - this.current;
    this.current =
      Math.abs(difference) < SNAP ? this.target : this.current + difference * this.#coefficient;
    return this.current;
  }
}

/** Gentle saturation that keeps the master output inside -1..1. */
export function softClip(sample: number): number {
  return Math.tanh(sample);
}
