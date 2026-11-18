import { FM4_ALGORITHMS, FM4_RATIOS, FM4_SYNTH } from '../../model/boxes/fm4-synth';
import { paramReader } from '../../model/boxes/registry';
import { SmoothedValue } from '../dsp';
import { Envelope, envelopeShape, setEnvelopeShape, type EnvelopeShape } from '../envelope';
import { noteFrequency, sine } from '../oscillators';
import type { SynthRuntime } from './types';
import { VoicePool, type Voice } from './voice-pool';

const read = paramReader(FM4_SYNTH);

const VOICE_COUNT = 8;
const OPERATORS = 4;
/** Headroom so several voices and tracks can play before the master soft-clipper. */
const OUTPUT_GAIN = 0.3;
/** A modulator's phase shift (in cycles) at Level 100%. */
const MAX_INDEX = 2;
/** Operator 4's feedback phase shift (in cycles) at Feedback 100%: past this it's noise. */
const MAX_FEEDBACK = 0.25;

/** Current settings, shared by all voices of one synth. */
interface Fm4Settings {
  /** Semitones, including fine tuning. */
  tuning: number;
  /** Per operator: frequency multiple of the note (ratio and detune). */
  multiple: Float64Array;
  /** Per operator: level (a carrier's volume, or a modulator's depth in cycles). */
  level: Float64Array;
  /** Per operator: does it go to the output? */
  carrier: Uint8Array;
  /** modulates[target * 4 + source]: does `source` modulate `target` (0-based)? */
  modulates: Uint8Array;
  /** Carriers are summed at this gain, so algorithms with more of them aren't louder. */
  carrierGain: number;
  feedback: number;
  envelopes: EnvelopeShape[];
}

class Fm4Voice implements Voice {
  pitch = 0;
  readonly #settings: Fm4Settings;
  readonly #sampleRate: number;
  readonly #envelopes = Array.from({ length: OPERATORS }, () => new Envelope());
  readonly #phases = new Float64Array(OPERATORS);
  /** Each operator's output this sample (modulators feed the ones after them). */
  readonly #outputs = new Float64Array(OPERATORS);
  #velocity = 0;
  /** Operator 4's last two outputs, averaged for feedback (as on the YM2612). */
  #previous1 = 0;
  #previous2 = 0;

  constructor(settings: Fm4Settings, sampleRate: number) {
    this.#settings = settings;
    this.#sampleRate = sampleRate;
  }

  /** Sounding while any carrier's envelope is (modulators alone are silent). */
  get active(): boolean {
    const carrier = this.#settings.carrier;
    for (let op = 0; op < OPERATORS; op++) {
      if (carrier[op] && this.#envelopes[op]!.active) return true;
    }
    return false;
  }

  get releasing(): boolean {
    return this.#envelopes[0]!.releasing;
  }

  start(pitch: number, velocity: number): void {
    // A fresh voice starts from phase 0 so every note's attack sounds the same; a stolen one
    // keeps its phases to avoid a click.
    if (!this.active) {
      this.#phases.fill(0);
      this.#previous1 = 0;
      this.#previous2 = 0;
    }
    this.pitch = pitch;
    this.#velocity = velocity / 127;
    for (const envelope of this.#envelopes) envelope.trigger();
  }

  release(): void {
    for (const envelope of this.#envelopes) envelope.release();
  }

  render(out: Float32Array, offset: number, frames: number): void {
    const settings = this.#settings;
    const { multiple, level, carrier, modulates, envelopes: shapes } = settings;
    const frequency = noteFrequency(this.pitch + settings.tuning) / this.#sampleRate;
    const phases = this.#phases;
    const outputs = this.#outputs;
    const envelopes = this.#envelopes;
    // Harder notes are brighter (deeper modulation) as well as louder.
    const velocity = this.#velocity;
    const depth = (0.4 + 0.6 * velocity) * MAX_INDEX;
    const gain = settings.carrierGain * velocity;
    const feedback = settings.feedback;
    let previous1 = this.#previous1;
    let previous2 = this.#previous2;

    const end = offset + frames;
    for (let i = offset; i < end; i++) {
      let sum = 0;
      // From operator 4 down: modulators always have higher numbers than what they modulate.
      for (let op = OPERATORS - 1; op >= 0; op--) {
        let modulation = 0;
        for (let source = op + 1; source < OPERATORS; source++) {
          if (modulates[op * OPERATORS + source]) modulation += outputs[source]!;
        }
        if (op === OPERATORS - 1) modulation += feedback * (previous1 + previous2) * 0.5;
        const envelope = envelopes[op]!.next(shapes[op]!);
        const value = sine(phases[op]! + modulation) * envelope;
        if (op === OPERATORS - 1) {
          previous2 = previous1;
          previous1 = value;
        }
        if (carrier[op]) {
          outputs[op] = 0;
          sum += value * level[op]!;
        } else {
          outputs[op] = value * level[op]! * depth;
        }
        let phase = phases[op]! + frequency * multiple[op]!;
        if (phase >= 1) phase -= Math.floor(phase);
        phases[op] = phase;
      }
      out[i]! += sum * gain;
      if (!this.active) break;
    }
    this.#previous1 = previous1;
    this.#previous2 = previous2;
  }
}

/** Engine implementation of the "synth.fm4" box. */
export class Fm4Synth implements SynthRuntime {
  readonly #sampleRate: number;
  readonly #settings: Fm4Settings;
  readonly #pool: VoicePool<Fm4Voice>;
  readonly #level: SmoothedValue;
  /** The first real setParams jumps straight to its level instead of fading from the default. */
  #snapLevel = true;
  #scratch = new Float32Array(128);

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.#settings = {
      tuning: 0,
      multiple: new Float64Array(OPERATORS).fill(1),
      level: new Float64Array(OPERATORS),
      carrier: new Uint8Array(OPERATORS),
      modulates: new Uint8Array(OPERATORS * OPERATORS),
      carrierGain: 1,
      feedback: 0,
      envelopes: Array.from({ length: OPERATORS }, () =>
        envelopeShape(0.002, 0.5, 0.5, 0.3, sampleRate),
      ),
    };
    this.#pool = new VoicePool(
      Array.from({ length: VOICE_COUNT }, () => new Fm4Voice(this.#settings, sampleRate)),
    );
    this.#level = new SmoothedValue(0, sampleRate);
    this.setParams({});
    this.#snapLevel = true;
  }

  /** Allocation-free: automation can call this every block. */
  setParams(params: Readonly<Record<string, number>>): void {
    const settings = this.#settings;
    settings.tuning = read(params, 'transpose') + read(params, 'fine') / 100;
    const feedback = read(params, 'feedback');
    settings.feedback = feedback * feedback * MAX_FEEDBACK;
    const algorithm = FM4_ALGORITHMS[Math.round(read(params, 'algorithm'))] ?? FM4_ALGORITHMS[0]!;
    settings.carrier.fill(0);
    settings.modulates.fill(0);
    for (const op of algorithm.carriers) settings.carrier[op - 1] = 1;
    for (let target = 0; target < OPERATORS; target++) {
      for (const source of algorithm.modulators[target]!) {
        settings.modulates[target * OPERATORS + source - 1] = 1;
      }
    }
    settings.carrierGain = 1 / Math.sqrt(algorithm.carriers.length);
    const release = read(params, 'release');
    for (let op = 0; op < OPERATORS; op++) {
      const n = op + 1;
      const ratio = FM4_RATIOS[Math.round(read(params, `op${n}Ratio`))] ?? 1;
      settings.multiple[op] = ratio * Math.pow(2, read(params, `op${n}Detune`) / 1200);
      const level = read(params, `op${n}Level`);
      // Modulators: squared, so the low end of the knob has fine control over brightness.
      settings.level[op] = settings.carrier[op] ? level : level * level;
      setEnvelopeShape(
        settings.envelopes[op]!,
        read(params, `op${n}Attack`),
        read(params, `op${n}Decay`),
        read(params, `op${n}Sustain`),
        release,
        this.#sampleRate,
      );
    }
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
