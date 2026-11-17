import {
  ANALOG_SYNTH,
  AnalogFilter,
  AnalogLfoTarget,
  AnalogWave,
  MAX_UNISON,
} from '../../model/boxes/analog-synth';
import { paramReader } from '../../model/boxes/registry';
import { SmoothedValue } from '../dsp';
import { Envelope, envelopeShape, setEnvelopeShape, type EnvelopeShape } from '../envelope';
import { noteFrequency, polyBlep, pulse, sine } from '../oscillators';
import type { SynthRuntime } from './types';
import { VoicePool, type Voice } from './voice-pool';

const read = paramReader(ANALOG_SYNTH);

const VOICE_COUNT = 8;
/**
 * Headroom so several voices and tracks can play before the master soft-clipper. Higher than
 * the chip synths' 0.3: the filter takes out much of the level, so it matches them by ear.
 */
const OUTPUT_GAIN = 0.45;
/** Samples between updates of the filter coefficients, glide and LFO (control rate). */
const CONTROL_RATE = 16;
/** The filter envelope's attack (it has decay and sustain knobs; release follows the amp's). */
const FILTER_ATTACK = 0.003;
/** How far the filter envelope moves the cutoff at full amount, in octaves. */
const ENV_OCTAVES = 6;
/** Cutoff follows the keyboard by this fraction (higher notes stay as bright). */
const KEY_TRACK = 0.5;
/** Detune of the outermost unison copies at full spread, in cents. */
const SPREAD_CENTS = 30;
/** LFO range at full depth: pitch in semitones, filter in octaves. */
const LFO_PITCH = 2;
const LFO_FILTER = 3;
/** Resonance at the top of the knob: the ladder just self-oscillates. */
const MAX_RESONANCE = 4;

/** Current settings, shared by all voices of one synth. */
interface AnalogSettings {
  wave1: number;
  wave2: number;
  /** Copies of each oscillator per note. */
  unison: number;
  /** Semitones, including fine tuning. */
  tuning: number;
  osc2Pitch: number;
  /** Cents between the two oscillators. */
  detune: number;
  mix: number;
  sub: number;
  /** Per unison copy: frequency ratio and stereo gains (copy k of osc 2 uses the mirrored pan). */
  unisonRatio: Float64Array;
  panLeft: Float64Array;
  panRight: Float64Array;
  unisonGain: number;
  filterType: number;
  cutoff: number;
  /** Ladder feedback, 0..4. */
  resonance: number;
  /** Gain into the filter's saturation. */
  drive: number;
  envAmount: number;
  ampShape: EnvelopeShape;
  filterShape: EnvelopeShape;
  /** Per control step: how much of the way to its target a gliding pitch moves (1: no glide). */
  glideStep: number;
  lfoTarget: number;
  lfoDepth: number;
  /** LFO phase at the start of the current process call, and its step per sample. */
  lfoPhase: number;
  lfoStep: number;
  /** The last note played, where the next one glides from. */
  lastPitch: number;
}

function oscillator(wave: number, phase: number, dt: number): number {
  switch (wave) {
    case AnalogWave.Saw:
      return 2 * phase - 1 - polyBlep(phase, dt);
    case AnalogWave.Square:
      return pulse(phase, dt, 0.5);
    case AnalogWave.Triangle:
      return 1 - 4 * Math.abs(phase - 0.5);
    default:
      return sine(phase);
  }
}

/** A tiny deterministic random source for oscillator start phases (no allocation). */
let seed = 22222;
function random(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/** tanh, close enough for saturation (a Padé approximant, exact at the ±3 clip) and cheap. */
function softSaturate(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/**
 * Ladder filter coefficients for one control step, written by `setLadder`: the one-pole gain
 * g, the weights of the four stage states in the feedback estimate, g⁴, and 1 / (1 + k·g⁴).
 */
const enum Coef {
  G,
  W1,
  W2,
  W3,
  W4,
  G4,
  Norm,
}

function setLadder(c: Float64Array, g: number, k: number): void {
  const h = 1 - g;
  const g2 = g * g;
  const g3 = g2 * g;
  const g4 = g3 * g;
  c[Coef.G] = g;
  c[Coef.W1] = g3 * h;
  c[Coef.W2] = g2 * h;
  c[Coef.W3] = g * h;
  c[Coef.W4] = h;
  c[Coef.G4] = g4;
  c[Coef.Norm] = 1 / (1 + k * g4);
}

/**
 * One step of a 4-pole ladder filter (zero-delay feedback, one-pole stages in TPT form) with a
 * saturating input, on one channel. `s` holds the four stage states from `o`; `c` the
 * coefficients (see `setLadder`). Returns the output for `mode`.
 */
function ladder(
  x: number,
  s: Float64Array,
  o: number,
  c: Float64Array,
  k: number,
  drive: number,
  driveOut: number,
  mode: number,
): number {
  const s1 = s[o]!;
  const s2 = s[o + 1]!;
  const s3 = s[o + 2]!;
  const s4 = s[o + 3]!;
  const g = c[Coef.G]!;
  // Solve the feedback loop linearly, then saturate what goes into the first stage.
  const estimate =
    (c[Coef.G4]! * x + c[Coef.W1]! * s1 + c[Coef.W2]! * s2 + c[Coef.W3]! * s3 + c[Coef.W4]! * s4) *
    c[Coef.Norm]!;
  const u = softSaturate(drive * (x - k * estimate)) * driveOut;
  let v = (u - s1) * g;
  const y1 = v + s1;
  s[o] = y1 + v;
  v = (y1 - s2) * g;
  const y2 = v + s2;
  s[o + 1] = y2 + v;
  v = (y2 - s3) * g;
  const y3 = v + s3;
  s[o + 2] = y3 + v;
  v = (y3 - s4) * g;
  const y4 = v + s4;
  s[o + 3] = y4 + v;
  switch (mode) {
    case AnalogFilter.LowPass24:
      return y4;
    case AnalogFilter.LowPass12:
      return y2;
    case AnalogFilter.BandPass:
      return 2 * (y1 - y2);
    default:
      return u - 2 * y1 + y2;
  }
}

class AnalogVoice implements Voice {
  pitch = 0;
  readonly #settings: AnalogSettings;
  readonly #sampleRate: number;
  readonly #amp = new Envelope();
  readonly #filterEnvelope = new Envelope();
  #velocity = 0;
  /** The sounding pitch (it glides towards `pitch`). */
  #currentPitch = 0;
  readonly #phases1 = new Float64Array(MAX_UNISON);
  readonly #phases2 = new Float64Array(MAX_UNISON);
  #subPhase = 0;
  /** Ladder states: left channel 0..3, right 4..7. */
  readonly #filter = new Float64Array(8);
  readonly #coefficients = new Float64Array(7);

  constructor(settings: AnalogSettings, sampleRate: number) {
    this.#settings = settings;
    this.#sampleRate = sampleRate;
  }

  get active(): boolean {
    return this.#amp.active;
  }

  get releasing(): boolean {
    return this.#amp.releasing;
  }

  start(pitch: number, velocity: number): void {
    const settings = this.#settings;
    const gliding = settings.glideStep < 1 && settings.lastPitch >= 0;
    if (!this.active) {
      // A fresh voice: free-running oscillators (random phases make unison thick from the
      // first sample) and a quiet filter.
      for (let k = 0; k < MAX_UNISON; k++) {
        this.#phases1[k] = random();
        this.#phases2[k] = random();
      }
      this.#subPhase = 0;
      this.#filter.fill(0);
      this.#currentPitch = gliding ? settings.lastPitch : pitch;
    } else if (!gliding) {
      this.#currentPitch = pitch;
    }
    this.pitch = pitch;
    this.#velocity = velocity / 127;
    this.#amp.trigger();
    this.#filterEnvelope.trigger();
  }

  release(): void {
    this.#amp.release();
    this.#filterEnvelope.release();
  }

  /** Mono mixdown (the synth itself renders voices in stereo with `renderStereo`). */
  render(out: Float32Array, offset: number, frames: number): void {
    this.renderStereo(out, out, offset, frames, 0.5);
  }

  /** Adds `frames` samples to both channels from `offset`, times `gain`. */
  renderStereo(
    left: Float32Array,
    right: Float32Array,
    offset: number,
    frames: number,
    gain = 1,
  ): void {
    const settings = this.#settings;
    const sampleRate = this.#sampleRate;
    const { wave1, wave2, unison, unisonRatio, panLeft, panRight, filterType, ampShape } = settings;
    const filterShape = settings.filterShape;
    const phases1 = this.#phases1;
    const phases2 = this.#phases2;
    const state = this.#filter;
    const gain1 = (1 - settings.mix) * settings.unisonGain;
    const gain2 = settings.mix * settings.unisonGain;
    const subGain = settings.sub * 0.8;
    const k = settings.resonance;
    const drive = settings.drive;
    // Small signals pass at about unity gain times √drive (louder, more saturated with drive).
    const driveOut = 1 / Math.sqrt(drive);
    const coefficients = this.#coefficients;
    // Low-pass modes lose level as resonance rises; give some of it back.
    const makeUp =
      filterType === AnalogFilter.LowPass24 || filterType === AnalogFilter.LowPass12
        ? 1 + 0.5 * k
        : 1;
    const nyquistLimit = sampleRate * 0.45;
    const velocity = this.#velocity;
    const brightness = 0.5 + 0.5 * velocity;
    const amp = this.#amp;
    const filterEnvelope = this.#filterEnvelope;
    let subPhase = this.#subPhase;

    const end = offset + frames;
    for (let start = offset; start < end; start += CONTROL_RATE) {
      const stop = Math.min(end, start + CONTROL_RATE);
      // Control rate: glide, LFO, pitches and the filter's coefficient.
      this.#currentPitch += (this.pitch - this.#currentPitch) * settings.glideStep;
      const lfo =
        settings.lfoDepth > 0
          ? sine(settings.lfoPhase + (start - offset) * settings.lfoStep) * settings.lfoDepth
          : 0;
      const note =
        this.#currentPitch +
        settings.tuning +
        (settings.lfoTarget === AnalogLfoTarget.Pitch ? lfo * LFO_PITCH : 0);
      const dt1 = noteFrequency(note - settings.detune / 200) / sampleRate;
      const dt2 = noteFrequency(note + settings.osc2Pitch + settings.detune / 200) / sampleRate;
      const subStep = Math.min(0.45, dt1 / 2);
      const octaves =
        (KEY_TRACK * (note - 60)) / 12 +
        settings.envAmount * ENV_OCTAVES * filterEnvelope.level * brightness +
        (settings.lfoTarget === AnalogLfoTarget.Filter ? lfo * LFO_FILTER : 0);
      const cutoff = Math.min(nyquistLimit, Math.max(20, settings.cutoff * Math.pow(2, octaves)));
      const t = Math.tan((Math.PI * cutoff) / sampleRate);
      setLadder(coefficients, t / (1 + t), k);
      // `lfo` already includes the depth: tremolo dips by up to the depth, never above 1.
      const tremolo =
        settings.lfoTarget === AnalogLfoTarget.Amp ? 1 - 0.5 * (settings.lfoDepth + lfo) : 1;
      const level = velocity * gain * tremolo;

      for (let i = start; i < stop; i++) {
        let l = 0;
        let r = 0;
        for (let c = 0; c < unison; c++) {
          const ratio = unisonRatio[c]!;
          const step1 = Math.min(0.45, dt1 * ratio);
          const step2 = Math.min(0.45, dt2 * ratio);
          let p1 = phases1[c]!;
          let p2 = phases2[c]!;
          const a = oscillator(wave1, p1, step1) * gain1;
          const b = oscillator(wave2, p2, step2) * gain2;
          p1 += step1;
          if (p1 >= 1) p1 -= 1;
          p2 += step2;
          if (p2 >= 1) p2 -= 1;
          phases1[c] = p1;
          phases2[c] = p2;
          // Osc 2's copies take the mirrored places in the stereo field.
          const mirror = unison - 1 - c;
          l += a * panLeft[c]! + b * panLeft[mirror]!;
          r += a * panRight[c]! + b * panRight[mirror]!;
        }
        if (subGain > 0) {
          const sub = pulse(subPhase, subStep, 0.5) * subGain;
          l += sub;
          r += sub;
        }
        subPhase += subStep;
        if (subPhase >= 1) subPhase -= 1;

        const outL = ladder(l * makeUp, state, 0, coefficients, k, drive, driveOut, filterType);
        const outR = ladder(r * makeUp, state, 4, coefficients, k, drive, driveOut, filterType);
        const envelope = amp.next(ampShape) * level;
        filterEnvelope.next(filterShape);
        left[i]! += outL * envelope;
        right[i]! += outR * envelope;
      }
      if (!amp.active) break;
    }
    this.#subPhase = subPhase;
  }
}

/** Engine implementation of the "synth.analog" box. */
export class AnalogSynth implements SynthRuntime {
  readonly #sampleRate: number;
  readonly #settings: AnalogSettings;
  readonly #pool: VoicePool<AnalogVoice>;
  readonly #level: SmoothedValue;
  /** The first real setParams jumps straight to its level instead of fading from the default. */
  #snapLevel = true;
  #scratchLeft = new Float32Array(128);
  #scratchRight = new Float32Array(128);

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.#settings = {
      wave1: AnalogWave.Saw,
      wave2: AnalogWave.Saw,
      unison: 1,
      tuning: 0,
      osc2Pitch: 0,
      detune: 0,
      mix: 0.5,
      sub: 0,
      unisonRatio: new Float64Array(MAX_UNISON),
      panLeft: new Float64Array(MAX_UNISON),
      panRight: new Float64Array(MAX_UNISON),
      unisonGain: 1,
      filterType: AnalogFilter.LowPass24,
      cutoff: 2500,
      resonance: 0,
      drive: 1,
      envAmount: 0,
      ampShape: envelopeShape(0.003, 0.4, 0.7, 0.25, sampleRate),
      filterShape: envelopeShape(FILTER_ATTACK, 0.4, 0.2, 0.25, sampleRate),
      glideStep: 1,
      lfoTarget: AnalogLfoTarget.Filter,
      lfoDepth: 0,
      lfoPhase: 0,
      lfoStep: 0,
      lastPitch: -1,
    };
    this.#pool = new VoicePool(
      Array.from({ length: VOICE_COUNT }, () => new AnalogVoice(this.#settings, sampleRate)),
    );
    this.#level = new SmoothedValue(0, sampleRate);
    this.setParams({});
    this.#snapLevel = true;
  }

  /** Allocation-free: automation can call this every block. */
  setParams(params: Readonly<Record<string, number>>): void {
    const settings = this.#settings;
    const sampleRate = this.#sampleRate;
    settings.wave1 = Math.round(read(params, 'osc1Wave'));
    settings.wave2 = Math.round(read(params, 'osc2Wave'));
    settings.tuning = read(params, 'transpose') + read(params, 'fine') / 100;
    settings.osc2Pitch = read(params, 'osc2Pitch');
    settings.detune = read(params, 'detune');
    settings.mix = Math.min(1, Math.max(0, read(params, 'mix')));
    settings.sub = read(params, 'sub');

    // Unison copies: evenly detuned and panned across -1..1 by Spread.
    const count = Math.min(MAX_UNISON, Math.max(1, Math.round(read(params, 'unison'))));
    const spread = read(params, 'spread');
    settings.unison = count;
    settings.unisonGain = 1 / Math.sqrt(count);
    for (let c = 0; c < count; c++) {
      const position = count === 1 ? 0 : (c / (count - 1)) * 2 - 1;
      settings.unisonRatio[c] = Math.pow(2, (position * spread * SPREAD_CENTS) / 1200);
      // Equal-power pan, scaled so the centre gets full level on both sides.
      const angle = ((position * spread + 1) * Math.PI) / 4;
      settings.panLeft[c] = Math.cos(angle) * Math.SQRT2;
      settings.panRight[c] = Math.sin(angle) * Math.SQRT2;
    }

    settings.filterType = Math.round(read(params, 'filterType'));
    settings.cutoff = read(params, 'cutoff');
    settings.resonance = read(params, 'resonance') * MAX_RESONANCE * 0.985;
    settings.drive = 1 + read(params, 'drive') * 6;
    settings.envAmount = read(params, 'envAmount');
    const release = read(params, 'release');
    setEnvelopeShape(
      settings.ampShape,
      read(params, 'attack'),
      read(params, 'decay'),
      read(params, 'sustain'),
      release,
      sampleRate,
    );
    setEnvelopeShape(
      settings.filterShape,
      FILTER_ATTACK,
      read(params, 'filterDecay'),
      read(params, 'filterSustain'),
      release,
      sampleRate,
    );
    // Glide time ≈ time to (nearly) arrive: three time constants.
    const glide = read(params, 'glide');
    settings.glideStep =
      glide <= 0.001 ? 1 : 1 - Math.exp(-CONTROL_RATE / ((glide / 3) * sampleRate));
    settings.lfoTarget = Math.round(read(params, 'lfoTarget'));
    settings.lfoDepth = read(params, 'lfoDepth');
    settings.lfoStep = read(params, 'lfoRate') / sampleRate;

    this.#level.target = read(params, 'level') * OUTPUT_GAIN;
    if (this.#snapLevel) {
      this.#level.current = this.#level.target;
      this.#snapLevel = false;
    }
  }

  noteOn(pitch: number, velocity: number): void {
    this.#pool.noteOn(pitch, velocity);
    this.#settings.lastPitch = pitch;
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
    if (this.#scratchLeft.length < end) {
      this.#scratchLeft = new Float32Array(end);
      this.#scratchRight = new Float32Array(end);
    }
    const scratchLeft = this.#scratchLeft;
    const scratchRight = this.#scratchRight;
    scratchLeft.fill(0, offset, end);
    scratchRight.fill(0, offset, end);
    for (const voice of this.#pool.voices) {
      if (voice.active) voice.renderStereo(scratchLeft, scratchRight, offset, frames);
    }
    for (let i = offset; i < end; i++) {
      const level = this.#level.next();
      left[i]! += scratchLeft[i]! * level;
      right[i]! += scratchRight[i]! * level;
    }
    // The LFO runs freely, shared by all voices.
    const settings = this.#settings;
    settings.lfoPhase += frames * settings.lfoStep;
    settings.lfoPhase -= Math.floor(settings.lfoPhase);
  }
}
