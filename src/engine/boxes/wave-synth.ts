import { paramReader } from '../../model/boxes/registry';
import { WAVE_LENGTH, WAVE_LEVELS, WAVES, WAVE_SYNTH } from '../../model/boxes/wave-synth';
import { SmoothedValue } from '../dsp';
import { Envelope, envelopeShape, setEnvelopeShape, type EnvelopeShape } from '../envelope';
import { noteFrequency, polyBlep } from '../oscillators';
import type { SynthRuntime } from './types';
import { VoicePool, type Voice } from './voice-pool';

const read = paramReader(WAVE_SYNTH);

const VOICE_COUNT = 8;
/** Headroom so several voices and tracks can play before the master soft-clipper. */
const OUTPUT_GAIN = 0.3;
const MIDDLE = (WAVE_LEVELS - 1) / 2;

/** Current settings, shared by all voices of one synth. */
interface WaveSettings {
  /** Semitones, including fine tuning. */
  tuning: number;
  envelope: EnvelopeShape;
  /** The wave being played: 32 samples in -1..1 (4-bit levels, morphed). */
  samples: Float32Array;
  /** The jump into each sample from the one before it (for band-limiting the steps). */
  jumps: Float32Array;
}

class WaveVoice implements Voice {
  pitch = 0;
  readonly #settings: WaveSettings;
  readonly #sampleRate: number;
  readonly #envelope = new Envelope();
  #velocity = 0;
  /** Position in the wave, in steps (0..32). */
  #position = 0;

  constructor(settings: WaveSettings, sampleRate: number) {
    this.#settings = settings;
    this.#sampleRate = sampleRate;
  }

  get active(): boolean {
    return this.#envelope.active;
  }

  get releasing(): boolean {
    return this.#envelope.releasing;
  }

  start(pitch: number, velocity: number): void {
    // A fresh voice starts at the wave's start so every attack sounds the same; a stolen one
    // keeps its position to avoid a click.
    if (!this.#envelope.active) this.#position = 0;
    this.pitch = pitch;
    this.#velocity = velocity / 127;
    this.#envelope.trigger();
  }

  release(): void {
    this.#envelope.release();
  }

  /**
   * The wave is played as stairs, like the hardware: each step holds its level. Each jump
   * between steps is smoothed with a PolyBLEP so high notes don't alias (too much).
   */
  render(out: Float32Array, offset: number, frames: number): void {
    const { samples, jumps, envelope: shape } = this.#settings;
    const frequency = noteFrequency(this.pitch + this.#settings.tuning);
    const step = Math.min(WAVE_LENGTH / 2, (frequency * WAVE_LENGTH) / this.#sampleRate);
    // Below half a step per sample, the regions around each jump don't overlap.
    const smooth = step < 0.5;
    const envelope = this.#envelope;
    const velocity = this.#velocity;
    let position = this.#position;
    const end = offset + frames;
    for (let i = offset; i < end; i++) {
      const index = position | 0;
      const fraction = position - index;
      let value = samples[index]!;
      if (smooth) {
        // The jump into this step, just behind us, or into the next one, just ahead.
        if (fraction < step) {
          value += jumps[index]! * 0.5 * polyBlep(fraction, step);
        } else if (fraction > 1 - step) {
          value += jumps[(index + 1) % WAVE_LENGTH]! * 0.5 * polyBlep(fraction, step);
        }
      }
      out[i]! += value * envelope.next(shape) * velocity;
      position += step;
      if (position >= WAVE_LENGTH) position -= WAVE_LENGTH;
      if (!envelope.active) break;
    }
    this.#position = position;
  }
}

/** Engine implementation of the "synth.wave" box. */
export class WaveSynth implements SynthRuntime {
  readonly #sampleRate: number;
  readonly #settings: WaveSettings;
  readonly #pool: VoicePool<WaveVoice>;
  readonly #level: SmoothedValue;
  /** The first real setParams jumps straight to its level instead of fading from the default. */
  #snapLevel = true;
  /** The wave and morph the tables were built for (rebuilt only when they change). */
  #builtWave = -1;
  #builtMorph = -1;
  #scratch = new Float32Array(128);

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.#settings = {
      tuning: 0,
      envelope: envelopeShape(0.002, 0.3, 0.7, 0.1, sampleRate),
      samples: new Float32Array(WAVE_LENGTH),
      jumps: new Float32Array(WAVE_LENGTH),
    };
    this.#pool = new VoicePool(
      Array.from({ length: VOICE_COUNT }, () => new WaveVoice(this.#settings, sampleRate)),
    );
    this.#level = new SmoothedValue(0, sampleRate);
    this.setParams({});
    this.#snapLevel = true;
  }

  /**
   * Fills the wave tables: `wave` blended `morph` of the way towards the next wave, on the
   * 4-bit grid (so Morph moves in audible steps, as it would on the hardware).
   * Allocation-free.
   */
  #buildWave(wave: number, morph: number): void {
    if (wave === this.#builtWave && morph === this.#builtMorph) return;
    this.#builtWave = wave;
    this.#builtMorph = morph;
    const from = WAVES[wave]!.steps;
    const to = WAVES[(wave + 1) % WAVES.length]!.steps;
    const { samples, jumps } = this.#settings;
    for (let i = 0; i < WAVE_LENGTH; i++) {
      const level = Math.round(from[i]! + (to[i]! - from[i]!) * morph);
      samples[i] = (level - MIDDLE) / MIDDLE;
    }
    for (let i = 0; i < WAVE_LENGTH; i++) {
      jumps[i] = samples[i]! - samples[(i + WAVE_LENGTH - 1) % WAVE_LENGTH]!;
    }
  }

  /** Allocation-free: automation can call this every block. */
  setParams(params: Readonly<Record<string, number>>): void {
    const settings = this.#settings;
    settings.tuning = read(params, 'transpose') + read(params, 'fine') / 100;
    const wave = Math.min(WAVES.length - 1, Math.max(0, Math.round(read(params, 'wave'))));
    this.#buildWave(wave, Math.min(1, Math.max(0, read(params, 'morph'))));
    setEnvelopeShape(
      settings.envelope,
      read(params, 'attack'),
      read(params, 'decay'),
      read(params, 'sustain'),
      read(params, 'release'),
      this.#sampleRate,
    );
    this.#level.target = read(params, 'level') * OUTPUT_GAIN;
    if (this.#snapLevel) {
      this.#level.current = this.#level.target;
      this.#snapLevel = false;
    }
  }

  noteOn(pitch: number, velocity: number): void {
    this.#pool.noteOn(pitch, velocity);
  }

  noteOff(pitch: number): void {
    this.#pool.noteOff(pitch);
  }

  allNotesOff(): void {
    this.#pool.allNotesOff();
  }

  get activeVoices(): number {
    return this.#pool.activeCount;
  }

  process(left: Float32Array, right: Float32Array, offset: number, frames: number): void {
    const end = offset + frames;
    if (this.#scratch.length < end) this.#scratch = new Float32Array(end);
    const scratch = this.#scratch;
    scratch.fill(0, offset, end);
    this.#pool.render(scratch, offset, frames);
    for (let i = offset; i < end; i++) {
      const sample = scratch[i]! * this.#level.next();
      left[i]! += sample;
      right[i]! += sample;
    }
  }
}
