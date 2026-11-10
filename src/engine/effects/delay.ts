import { DELAY, SYNC_DIVISIONS } from '../../model/boxes/effects';
import { paramReader } from '../../model/boxes/registry';
import { ticksPerSecond } from '../../model/time';
import type { BlockContext, EffectRuntime } from '../boxes/types';

const read = paramReader(DELAY);

/** Longest delay the buffer holds (a half note at 30 BPM). */
const MAX_SECONDS = 4;
/** How fast the delay time follows tempo changes (per sample), to avoid clicks. */
const TIME_SMOOTHING = 0.0005;

/**
 * Tempo-synced stereo echo. Mono mode echoes each channel in place; ping-pong bounces the
 * echoes between left and right. A low-pass ("Tone") in the feedback path darkens each repeat.
 */
export class Delay implements EffectRuntime {
  readonly #sampleRate: number;
  readonly #left: Float32Array;
  readonly #right: Float32Array;
  #write = 0;
  #divisionTicks: number = SYNC_DIVISIONS[6]!.ticks;
  #pingPong = true;
  #feedback = 0.4;
  #toneCoef = 0.5;
  #wet = 0.35;
  /** Current delay in samples (smoothed towards the tempo-synced target). */
  #delay = -1;
  #toneL = 0;
  #toneR = 0;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    const length = Math.ceil(MAX_SECONDS * sampleRate) + 2;
    this.#left = new Float32Array(length);
    this.#right = new Float32Array(length);
  }

  setParams(params: Readonly<Record<string, number>>): void {
    this.#divisionTicks =
      SYNC_DIVISIONS[Math.round(read(params, 'time'))]?.ticks ?? this.#divisionTicks;
    this.#pingPong = Math.round(read(params, 'mode')) === 1;
    this.#feedback = read(params, 'feedback');
    this.#toneCoef = 1 - Math.exp((-2 * Math.PI * read(params, 'tone')) / this.#sampleRate);
    this.#wet = read(params, 'wet');
  }

  process(left: Float32Array, right: Float32Array, frames: number, context: BlockContext): void {
    const bufferL = this.#left;
    const bufferR = this.#right;
    const length = bufferL.length;
    const seconds = this.#divisionTicks / ticksPerSecond(context.bpm);
    const target = Math.min(length - 2, Math.max(1, seconds * this.#sampleRate));
    if (this.#delay < 0) this.#delay = target;
    const feedback = this.#feedback;
    const tone = this.#toneCoef;
    const wet = this.#wet;
    let write = this.#write;
    let delay = this.#delay;
    let toneL = this.#toneL;
    let toneR = this.#toneR;

    for (let i = 0; i < frames; i++) {
      delay += (target - delay) * TIME_SMOOTHING;
      // Linear interpolation between the two samples around the read position.
      let read = write - delay;
      if (read < 0) read += length;
      const index = Math.floor(read);
      const frac = read - index;
      const next = index + 1 === length ? 0 : index + 1;
      const echoL = bufferL[index]! + (bufferL[next]! - bufferL[index]!) * frac;
      const echoR = bufferR[index]! + (bufferR[next]! - bufferR[index]!) * frac;
      toneL += (echoL - toneL) * tone;
      toneR += (echoR - toneR) * tone;

      const inL = left[i]!;
      const inR = right[i]!;
      if (this.#pingPong) {
        bufferL[write] = (inL + inR) * 0.5 + toneR * feedback;
        bufferR[write] = toneL * feedback;
      } else {
        bufferL[write] = inL + toneL * feedback;
        bufferR[write] = inR + toneR * feedback;
      }
      left[i] = inL + echoL * wet;
      right[i] = inR + echoR * wet;
      if (++write === length) write = 0;
    }
    this.#write = write;
    this.#delay = delay;
    this.#toneL = Math.abs(toneL) < 1e-20 ? 0 : toneL;
    this.#toneR = Math.abs(toneR) < 1e-20 ? 0 : toneR;
  }
}
