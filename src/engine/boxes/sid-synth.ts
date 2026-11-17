import { paramReader } from '../../model/boxes/registry';
import { SID_SYNTH, SidFilter, SidMod, SidWave } from '../../model/boxes/sid-synth';
import { SmoothedValue } from '../dsp';
import { Envelope, envelopeShape, setEnvelopeShape, type EnvelopeShape } from '../envelope';
import { noteFrequency, polyBlep, pulse, sine, stepLfsr } from '../oscillators';
import type { SynthRuntime } from './types';
import { VoicePool, type Voice } from './voice-pool';

const read = paramReader(SID_SYNTH);

const VOICE_COUNT = 8;
/** Headroom so several voices and tracks can play before the master soft-clipper. */
const OUTPUT_GAIN = 0.3;
/** Noise is perceived louder than tones at the same amplitude. */
const NOISE_GAIN = 0.7;
/** LFSR clock rate per Hz of note pitch, and its cap per sample (high notes). */
const NOISE_CLOCK_RATIO = 32;
const MAX_LFSR_STEPS = 64;
/** How far the PWM sweep moves the pulse width at full depth. */
const PWM_RANGE = 0.45;
/** Per-block glide of the filter cutoff towards its target, so sweeps don't click. */
const CUTOFF_GLIDE = 0.25;

/** Current settings, shared by all voices of one synth. */
interface SidSettings {
  wave: number;
  mod: number;
  /** Semitones, including fine tuning. */
  tuning: number;
  modPitch: number;
  width: number;
  pwmRate: number;
  pwmDepth: number;
  envelope: EnvelopeShape;
}

/** Band-limited saw, -1..1. */
const saw = (phase: number, dt: number) => 2 * phase - 1 - polyBlep(phase, dt);
const triangle = (phase: number) => 4 * Math.abs(phase - 0.5) - 1;

class SidVoice implements Voice {
  pitch = 0;
  readonly #settings: SidSettings;
  readonly #sampleRate: number;
  readonly #envelope = new Envelope();
  #velocity = 0;
  #phase = 0;
  /** The second oscillator: ring modulator, or the sync master. */
  #modPhase = 0;
  #lfoPhase = 0;
  #lfsr = 1;
  /** The noise generator's clock, in LFSR steps. */
  #noisePhase = 0;

  constructor(settings: SidSettings, sampleRate: number) {
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
    // A fresh voice starts from phase 0 (and its PWM sweep from the start) so every note sounds
    // the same; a stolen one keeps its phases to avoid a click.
    if (!this.#envelope.active) {
      this.#phase = 0;
      this.#modPhase = 0;
      this.#lfoPhase = 0;
    }
    this.pitch = pitch;
    this.#velocity = velocity / 127;
    this.#envelope.trigger();
  }

  release(): void {
    this.#envelope.release();
  }

  render(out: Float32Array, offset: number, frames: number): void {
    const settings = this.#settings;
    const sampleRate = this.#sampleRate;
    const { wave, mod, width, pwmDepth, envelope: shape } = settings;
    const note = noteFrequency(this.pitch + settings.tuning);
    const other = noteFrequency(this.pitch + settings.tuning + settings.modPitch);
    // Sync: the note's oscillator restarts the one you hear, which runs at Mod pitch (the
    // timbre sweeps with Mod pitch, the pitch stays the note's). Ring: the wave is multiplied
    // by a square at Mod pitch.
    const sync = mod === SidMod.Sync;
    const ring = mod === SidMod.Ring;
    const step = Math.min(0.5, (sync ? other : note) / sampleRate);
    const modStep = Math.min(0.5, (sync ? note : other) / sampleRate);
    const lfoStep = settings.pwmRate / sampleRate;
    const noiseClock = Math.min(MAX_LFSR_STEPS, (note * NOISE_CLOCK_RATIO) / sampleRate);
    const envelope = this.#envelope;
    const velocity = this.#velocity;
    let phase = this.#phase;
    let modPhase = this.#modPhase;
    let lfoPhase = this.#lfoPhase;
    let lfsr = this.#lfsr;
    let noisePhase = this.#noisePhase;

    const end = offset + frames;
    for (let i = offset; i < end; i++) {
      modPhase += modStep;
      if (modPhase >= 1) {
        modPhase -= 1;
        if (sync) phase = modPhase * (step / modStep);
      }
      let value: number;
      if (wave === SidWave.Pulse) {
        const sweep = pwmDepth > 0 ? pwmDepth * PWM_RANGE * sine(lfoPhase) : 0;
        const duty = Math.min(0.98, Math.max(0.02, width + sweep));
        value = pulse(phase, step, duty);
        lfoPhase += lfoStep;
        if (lfoPhase >= 1) lfoPhase -= 1;
      } else if (wave === SidWave.Saw) {
        value = saw(phase, step);
      } else if (wave === SidWave.Noise) {
        noisePhase += noiseClock;
        while (noisePhase >= 1) {
          noisePhase -= 1;
          lfsr = stepLfsr(lfsr, 1);
        }
        value = lfsr & 1 ? -NOISE_GAIN : NOISE_GAIN;
      } else {
        value = triangle(phase);
      }
      if (ring) value *= modPhase < 0.5 ? 1 : -1;
      out[i]! += value * envelope.next(shape) * velocity;
      phase += step;
      if (phase >= 1) phase -= 1;
      if (!envelope.active) break;
    }
    this.#phase = phase;
    this.#modPhase = modPhase;
    this.#lfoPhase = lfoPhase;
    this.#lfsr = lfsr;
    this.#noisePhase = noisePhase;
  }
}

/** Engine implementation of the "synth.sid" box. */
export class SidSynth implements SynthRuntime {
  readonly #sampleRate: number;
  readonly #settings: SidSettings;
  readonly #pool: VoicePool<SidVoice>;
  readonly #level: SmoothedValue;
  /** The first real setParams jumps straight to its level instead of fading from the default. */
  #snapLevel = true;
  #scratch = new Float32Array(128);

  // The shared filter (state-variable, Simper/Cytomics), like the chip's single filter.
  #filter: number = SidFilter.Off;
  #targetCutoff = 2000;
  #cutoff = -1;
  #k = 2;
  #ic1 = 0;
  #ic2 = 0;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.#settings = {
      wave: SidWave.Pulse,
      mod: SidMod.Off,
      tuning: 0,
      modPitch: 7,
      width: 0.5,
      pwmRate: 2,
      pwmDepth: 0,
      envelope: envelopeShape(0.002, 0.3, 0.7, 0.1, sampleRate),
    };
    this.#pool = new VoicePool(
      Array.from({ length: VOICE_COUNT }, () => new SidVoice(this.#settings, sampleRate)),
    );
    this.#level = new SmoothedValue(0, sampleRate);
    this.setParams({});
    this.#snapLevel = true;
  }

  /** Allocation-free: automation can call this every block. */
  setParams(params: Readonly<Record<string, number>>): void {
    const settings = this.#settings;
    settings.wave = Math.round(read(params, 'wave'));
    settings.mod = Math.round(read(params, 'mod'));
    settings.tuning = read(params, 'transpose') + read(params, 'fine') / 100;
    settings.modPitch = read(params, 'modPitch');
    settings.width = read(params, 'width');
    settings.pwmRate = read(params, 'pwmRate');
    settings.pwmDepth = read(params, 'pwmDepth');
    setEnvelopeShape(
      settings.envelope,
      read(params, 'attack'),
      read(params, 'decay'),
      read(params, 'sustain'),
      read(params, 'release'),
      this.#sampleRate,
    );
    this.#filter = Math.round(read(params, 'filter'));
    this.#targetCutoff = read(params, 'cutoff');
    this.#k = 2 - 1.96 * read(params, 'resonance');
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
    if (this.#filter !== SidFilter.Off) this.#applyFilter(scratch, offset, end);
    for (let i = offset; i < end; i++) {
      const sample = scratch[i]! * this.#level.next();
      left[i]! += sample;
      right[i]! += sample;
    }
  }

  /** The shared filter over the mixed voices, in place. Coefficients are set once per call. */
  #applyFilter(buffer: Float32Array, start: number, end: number): void {
    this.#cutoff =
      this.#cutoff < 0
        ? this.#targetCutoff
        : this.#cutoff + (this.#targetCutoff - this.#cutoff) * CUTOFF_GLIDE;
    const fc = Math.min(this.#cutoff, this.#sampleRate * 0.45);
    const g = Math.tan((Math.PI * fc) / this.#sampleRate);
    const k = this.#k;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const type = this.#filter;
    let ic1 = this.#ic1;
    let ic2 = this.#ic2;
    for (let i = start; i < end; i++) {
      const v0 = buffer[i]!;
      const v3 = v0 - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      buffer[i] =
        type === SidFilter.LowPass ? v2 : type === SidFilter.BandPass ? v1 : v0 - k * v1 - v2;
    }
    this.#ic1 = ic1;
    this.#ic2 = ic2;
  }
}
