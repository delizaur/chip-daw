import { FM_RATIOS, FM_SYNTH } from '../../model/boxes/fm-synth';
import { paramReader } from '../../model/boxes/registry';
import { SmoothedValue } from '../dsp';
import { Envelope, envelopeShape, setEnvelopeShape, type EnvelopeShape } from '../envelope';
import { noteFrequency, sine } from '../oscillators';
import type { SynthRuntime } from './types';
import { VoicePool, type Voice } from './voice-pool';

const read = paramReader(FM_SYNTH);

const VOICE_COUNT = 8;
/** Headroom so several voices and tracks can play before the master soft-clipper. */
const OUTPUT_GAIN = 0.3;
/** Modulation index (in cycles of phase shift) at Amount 100%. */
const MAX_INDEX = 2;
/** Feedback phase shift (in cycles) at Feedback 100%: past this it turns to noise. */
const MAX_FEEDBACK = 0.25;
/** The modulator's envelope attacks instantly (FM brightness hits with the note). */
const MOD_ATTACK = 0.001;

/** Current settings, shared by all voices of one synth. */
interface FmSettings {
  /** Semitones, including fine tuning. */
  tuning: number;
  ratio: number;
  /** Modulation depth in cycles at full velocity and modulator envelope. */
  index: number;
  feedback: number;
  carrier: EnvelopeShape;
  modulator: EnvelopeShape;
}

class FmVoice implements Voice {
  pitch = 0;
  readonly #settings: FmSettings;
  readonly #sampleRate: number;
  readonly #carrierEnvelope = new Envelope();
  readonly #modulatorEnvelope = new Envelope();
  #velocity = 0;
  #carrierPhase = 0;
  #modulatorPhase = 0;
  /** The modulator's last two outputs, averaged for feedback (as on the YM2612). */
  #previous1 = 0;
  #previous2 = 0;

  constructor(settings: FmSettings, sampleRate: number) {
    this.#settings = settings;
    this.#sampleRate = sampleRate;
  }

  get active(): boolean {
    return this.#carrierEnvelope.active;
  }

  get releasing(): boolean {
    return this.#carrierEnvelope.releasing;
  }

  start(pitch: number, velocity: number): void {
    // A fresh voice starts from phase 0 so every note's attack sounds the same; a stolen one
    // keeps its phases to avoid a click.
    if (!this.#carrierEnvelope.active) {
      this.#carrierPhase = 0;
      this.#modulatorPhase = 0;
      this.#previous1 = 0;
      this.#previous2 = 0;
    }
    this.pitch = pitch;
    this.#velocity = velocity / 127;
    this.#carrierEnvelope.trigger();
    this.#modulatorEnvelope.trigger();
  }

  release(): void {
    this.#carrierEnvelope.release();
    this.#modulatorEnvelope.release();
  }

  render(out: Float32Array, offset: number, frames: number): void {
    const settings = this.#settings;
    const frequency = noteFrequency(this.pitch + settings.tuning);
    const carrierStep = frequency / this.#sampleRate;
    const modulatorStep = (frequency * settings.ratio) / this.#sampleRate;
    // Harder notes are brighter, as on a real FM keyboard.
    const index = settings.index * (0.4 + 0.6 * this.#velocity);
    const feedback = settings.feedback;
    const carrierShape = settings.carrier;
    const modulatorShape = settings.modulator;
    const carrierEnvelope = this.#carrierEnvelope;
    const modulatorEnvelope = this.#modulatorEnvelope;
    const velocity = this.#velocity;
    let carrierPhase = this.#carrierPhase;
    let modulatorPhase = this.#modulatorPhase;
    let previous1 = this.#previous1;
    let previous2 = this.#previous2;

    const end = offset + frames;
    for (let i = offset; i < end; i++) {
      const modulator = sine(modulatorPhase + feedback * (previous1 + previous2) * 0.5);
      previous2 = previous1;
      previous1 = modulator;
      const modulation = modulator * index * modulatorEnvelope.next(modulatorShape);
      out[i]! += sine(carrierPhase + modulation) * carrierEnvelope.next(carrierShape) * velocity;
      carrierPhase += carrierStep;
      if (carrierPhase >= 1) carrierPhase -= 1;
      modulatorPhase += modulatorStep;
      if (modulatorPhase >= 1) modulatorPhase -= Math.floor(modulatorPhase);
      if (!carrierEnvelope.active) break;
    }
    this.#carrierPhase = carrierPhase;
    this.#modulatorPhase = modulatorPhase;
    this.#previous1 = previous1;
    this.#previous2 = previous2;
  }
}

/** Engine implementation of the "synth.fm" box. */
export class FmSynth implements SynthRuntime {
  readonly #sampleRate: number;
  readonly #settings: FmSettings;
  readonly #pool: VoicePool<FmVoice>;
  readonly #level: SmoothedValue;
  /** The first real setParams jumps straight to its level instead of fading from the default. */
  #snapLevel = true;
  #scratch = new Float32Array(128);

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.#settings = {
      tuning: 0,
      ratio: 1,
      index: 0,
      feedback: 0,
      carrier: envelopeShape(0.002, 0.4, 0.6, 0.15, sampleRate),
      modulator: envelopeShape(MOD_ATTACK, 0.3, 0.3, 0.15, sampleRate),
    };
    this.#pool = new VoicePool(
      Array.from({ length: VOICE_COUNT }, () => new FmVoice(this.#settings, sampleRate)),
    );
    this.#level = new SmoothedValue(0, sampleRate);
    this.setParams({});
    this.#snapLevel = true;
  }

  /** Allocation-free: automation can call this every block. */
  setParams(params: Readonly<Record<string, number>>): void {
    const settings = this.#settings;
    const sampleRate = this.#sampleRate;
    settings.tuning = read(params, 'transpose') + read(params, 'fine') / 100;
    settings.ratio = FM_RATIOS[Math.round(read(params, 'ratio'))] ?? 1;
    const amount = read(params, 'amount');
    // Squared, so the low end of the knob has fine control over subtle brightness.
    settings.index = amount * amount * MAX_INDEX;
    const feedback = read(params, 'feedback');
    settings.feedback = feedback * feedback * MAX_FEEDBACK;
    const release = read(params, 'release');
    setEnvelopeShape(
      settings.carrier,
      read(params, 'attack'),
      read(params, 'decay'),
      read(params, 'sustain'),
      release,
      sampleRate,
    );
    setEnvelopeShape(
      settings.modulator,
      MOD_ATTACK,
      read(params, 'modDecay'),
      read(params, 'modSustain'),
      release,
      sampleRate,
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
