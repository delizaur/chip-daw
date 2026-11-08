import { CHIP_SYNTH, ChipWave } from '../../model/boxes/chip-synth';
import { paramValue } from '../../model/boxes/registry';
import { SmoothedValue } from '../dsp';
import { Envelope, envelopeShape, type EnvelopeShape } from '../envelope';
import { noteFrequency, pulse, steppedTriangle, stepLfsr } from '../oscillators';
import type { SynthRuntime } from './types';
import { VoicePool, type Voice } from './voice-pool';

const VOICE_COUNT = 8;
/** Headroom so several voices and tracks can play before the master soft-clipper. */
const OUTPUT_GAIN = 0.3;
/** Noise is perceived louder than tones at the same amplitude. */
const NOISE_GAIN = 0.7;
/** LFSR clock rate per Hz of note pitch. Metallic noise repeats every 93 steps, so ×93 makes it play the note's pitch. */
const NOISE_CLOCK_RATIO = 32;
const METAL_CLOCK_RATIO = 93;
/** Upper bound of LFSR steps per sample, so very high notes can't stall the audio thread. */
const MAX_LFSR_STEPS = 64;

const DUTY: Record<number, number> = {
  [ChipWave.Pulse12]: 0.125,
  [ChipWave.Pulse25]: 0.25,
  [ChipWave.Pulse50]: 0.5,
};

/** Current settings, shared by all voices of one synth. */
interface ChipSettings {
  wave: number;
  /** Semitones, including fine tuning. */
  tuning: number;
  envelope: EnvelopeShape;
}

class ChipVoice implements Voice {
  pitch = 0;
  readonly #settings: ChipSettings;
  readonly #sampleRate: number;
  readonly #envelope = new Envelope();
  #velocity = 0;
  #phase = 0;
  #lfsr = 1;

  constructor(settings: ChipSettings, sampleRate: number) {
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
    // A fresh voice starts at phase 0 so every note's attack sounds the same; a stolen one
    // keeps its phase to avoid a click.
    if (!this.#envelope.active) this.#phase = 0;
    this.pitch = pitch;
    this.#velocity = velocity / 127;
    this.#envelope.trigger();
  }

  release(): void {
    this.#envelope.release();
  }

  render(out: Float32Array, frames: number): void {
    const settings = this.#settings;
    const shape = settings.envelope;
    const frequency = noteFrequency(this.pitch + settings.tuning);
    const dt = Math.min(0.5, frequency / this.#sampleRate);
    const wave = settings.wave;
    const envelope = this.#envelope;
    let phase = this.#phase;

    if (wave === ChipWave.Noise || wave === ChipWave.MetalNoise) {
      const metal = wave === ChipWave.MetalNoise;
      const tap = metal ? 6 : 1;
      const clock =
        (frequency * (metal ? METAL_CLOCK_RATIO : NOISE_CLOCK_RATIO)) / this.#sampleRate;
      let lfsr = this.#lfsr;
      for (let i = 0; i < frames; i++) {
        phase += clock;
        let steps = 0;
        while (phase >= 1 && steps < MAX_LFSR_STEPS) {
          phase -= 1;
          lfsr = stepLfsr(lfsr, tap);
          steps++;
        }
        if (phase >= 1) phase %= 1;
        const sample = lfsr & 1 ? -NOISE_GAIN : NOISE_GAIN;
        out[i]! += sample * envelope.next(shape) * this.#velocity;
        if (!envelope.active) break;
      }
      this.#lfsr = lfsr;
    } else if (wave === ChipWave.Triangle) {
      for (let i = 0; i < frames; i++) {
        out[i]! += steppedTriangle(phase) * envelope.next(shape) * this.#velocity;
        phase += dt;
        if (phase >= 1) phase -= 1;
        if (!envelope.active) break;
      }
    } else {
      const duty = DUTY[wave] ?? 0.5;
      for (let i = 0; i < frames; i++) {
        out[i]! += pulse(phase, dt, duty) * envelope.next(shape) * this.#velocity;
        phase += dt;
        if (phase >= 1) phase -= 1;
        if (!envelope.active) break;
      }
    }
    this.#phase = phase;
  }
}

/** Engine implementation of the "synth.chip" box. */
export class ChipSynth implements SynthRuntime {
  readonly #sampleRate: number;
  readonly #settings: ChipSettings;
  readonly #pool: VoicePool<ChipVoice>;
  readonly #level: SmoothedValue;
  #scratch = new Float32Array(128);

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.#settings = {
      wave: ChipWave.Pulse50,
      tuning: 0,
      envelope: envelopeShape(0.002, 0.2, 0.6, 0.1, sampleRate),
    };
    this.#pool = new VoicePool(
      Array.from({ length: VOICE_COUNT }, () => new ChipVoice(this.#settings, sampleRate)),
    );
    this.#level = new SmoothedValue(0, sampleRate);
    this.setParams({});
    this.#snapLevel = true;
  }

  /** The first real setParams jumps straight to its level instead of fading from the default. */
  #snapLevel = true;

  setParams(params: Readonly<Record<string, number>>): void {
    const box = { id: '', type: CHIP_SYNTH.type, params };
    const value = (id: string) =>
      paramValue(
        box,
        CHIP_SYNTH.params.find((p) => p.id === id)!,
      );
    this.#settings.wave = value('wave');
    this.#settings.tuning = value('transpose') + value('fine') / 100;
    this.#settings.envelope = envelopeShape(
      value('attack'),
      value('decay'),
      value('sustain'),
      value('release'),
      this.#sampleRate,
    );
    this.#level.target = value('level') * OUTPUT_GAIN;
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

  process(left: Float32Array, right: Float32Array, frames: number): void {
    if (this.#scratch.length < frames) this.#scratch = new Float32Array(frames);
    const scratch = this.#scratch;
    scratch.fill(0, 0, frames);
    this.#pool.render(scratch, frames);
    for (let i = 0; i < frames; i++) {
      const sample = scratch[i]! * this.#level.next();
      left[i]! += sample;
      right[i]! += sample;
    }
  }
}
