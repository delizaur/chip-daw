import { PLUCK_SYNTH, PluckExcite } from '../../model/boxes/pluck-synth';
import { paramReader } from '../../model/boxes/registry';
import { SmoothedValue } from '../dsp';
import { noteFrequency } from '../oscillators';
import { Svf } from '../svf';
import type { SynthRuntime } from './types';
import { VoicePool, type Voice } from './voice-pool';

const read = paramReader(PLUCK_SYNTH);

const VOICE_COUNT = 8;
/**
 * Headroom so several voices and tracks can play before the master soft-clipper. Higher than
 * the chip synths' 0.3: a plucked note is mostly its attack, so it matches them by ear.
 */
const OUTPUT_GAIN = 0.6;
/** Below this a string counts as silent (-80 dB). */
const SILENCE = 1e-4;
/** Lowest note a string can play, in Hz (sizes its delay line). */
const LOWEST_FREQUENCY = 15;
/** Detune of the second string at full Double, in cents, and how far apart they're panned. */
const DOUBLE_CENTS = 12;
const DOUBLE_PAN = 0.7;
/** How hard the bow drives the string (sets a bowed note's level). */
const BOW_LEVEL = 1;
/** The wooden body's resonances (Hz, at middle Size), their Q and their levels. */
const BODY_FREQUENCIES = [110, 240, 520] as const;
const BODY_Q = [2.5, 3, 3.5] as const;
const BODY_GAINS = [1, 0.7, 0.45] as const;

/** Current settings, shared by all voices of one synth. */
interface PluckSettings {
  excite: number;
  brightness: number;
  position: number;
  decay: number;
  damping: number;
  stiffness: number;
  double: number;
  release: number;
  /** Semitones, including fine tuning. */
  tuning: number;
}

/** White noise, -1..1 (xorshift; allocation-free). */
class Noise {
  #state = 0x2545f491;
  next(): number {
    let s = this.#state;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.#state = s;
    return (s | 0) / 2147483648;
  }
}

/**
 * One string: a delay line one period long, looping through a damping filter (a two-point
 * average: the highs die first), optional stiffness (two all-pass filters that delay the
 * highs less, spreading the overtones), a fractional all-pass for exact tuning, and a gain
 * that sets how long it rings.
 */
class KsString {
  readonly #buffer: Float32Array;
  readonly #mask: number;
  #write = 0;
  /** Whole samples of delay, and the fractional all-pass making up the rest. */
  #length = 2;
  #fraction = 0;
  #fractionX = 0;
  #fractionY = 0;
  /** Two-point average weight (0: no damping in the loop, 0.5: most). */
  #blend = 0;
  #previous = 0;
  /** Stiffness all-pass coefficient (0: off) and its two stages' states. */
  #stiff = 0;
  #s1x = 0;
  #s1y = 0;
  #s2x = 0;
  #s2y = 0;
  /** Loop gain per sample. */
  gain = 0;
  frequency = 0;
  /** The damping filter's gain at the fundamental (see `tune`). */
  loss = 1;

  constructor(maxLength: number) {
    let size = 1;
    while (size < maxLength + 4) size *= 2;
    this.#buffer = new Float32Array(size);
    this.#mask = size - 1;
  }

  /** Tunes the string to `frequency` (call before exciting it, not while it rings). */
  tune(frequency: number, damping: number, stiffness: number, sampleRate: number): void {
    this.frequency = frequency;
    const period = sampleRate / frequency;
    // The damping filter takes its toll once per period, so the top notes (thousands of
    // periods a second) would die at once: ease it off on strings shorter than 40 samples.
    this.#blend = (0.05 + 0.45 * damping) * Math.min(1, (period / 40) ** 3);
    const w = (2 * Math.PI * frequency) / sampleRate;
    // What the damping filter lets through of the fundamental each period (made up for by the
    // loop gain, so Decay sets how long the note rings; damping only darkens it).
    this.loss = Math.hypot(1 - this.#blend + this.#blend * Math.cos(w), this.#blend * Math.sin(w));
    // Stiffness all-passes delay each up to (1 + c) / (1 - c) samples: on short (high)
    // strings, keep them to a quarter of the period between them.
    const quarter = period / 8;
    const c = Math.min(stiffness * 0.6, Math.max(0, (quarter - 1) / (quarter + 1)));
    this.#stiff = -c;
    // The loop's filters delay the note too: subtract their delay at the note's frequency
    // (exact, not their low-frequency delay, so the top octave stays in tune as well).
    const filters =
      phaseDelay(1 - this.#blend, this.#blend, 0, w) + (c > 0 ? 2 * phaseDelay(-c, 1, -c, w) : 0);
    const rest = Math.max(2.5, period - filters);
    // Keep the fractional delay around 0.5..1.5, where the all-pass is accurate and stable,
    // then refine its coefficient so its delay at this frequency is exactly what's left.
    const whole = Math.min(this.#mask - 2, Math.max(2, Math.floor(rest - 0.5)));
    const target = rest - whole;
    let d = target;
    let a = (1 - d) / (1 + d);
    for (let i = 0; i < 3; i++) {
      d = Math.min(1.95, Math.max(0.05, d + target - phaseDelay(a, 1, a, w)));
      a = (1 - d) / (1 + d);
    }
    this.#length = whole;
    this.#fraction = a;
  }

  /** Clears the string (a fresh voice). */
  silence(): void {
    this.#buffer.fill(0);
    this.#previous = 0;
    this.#fractionX = this.#fractionY = 0;
    this.#s1x = this.#s1y = this.#s2x = this.#s2y = 0;
  }

  /** Adds `shape` (its first `length` samples, one period) to what the string will play. */
  excite(shape: Float32Array): void {
    const mask = this.#mask;
    const start = this.#write - this.#length;
    for (let i = 0; i < this.#length; i++) this.#buffer[(start + i) & mask]! += shape[i]!;
  }

  get length(): number {
    return this.#length;
  }

  /** The next sample; `input` is fed into the string (a bow). */
  next(input: number): number {
    const mask = this.#mask;
    const out = this.#buffer[(this.#write - this.#length) & mask]!;
    let y = (1 - this.#blend) * out + this.#blend * this.#previous;
    this.#previous = out;
    const a = this.#stiff;
    if (a !== 0) {
      const y1 = a * y + this.#s1x - a * this.#s1y;
      this.#s1x = y;
      this.#s1y = y1;
      const y2 = a * y1 + this.#s2x - a * this.#s2y;
      this.#s2x = y1;
      this.#s2y = y2;
      y = y2;
    }
    const f = this.#fraction;
    const z = f * y + this.#fractionX - f * this.#fractionY;
    this.#fractionX = y;
    this.#fractionY = z;
    this.#buffer[this.#write] = z * this.gain + input;
    this.#write = (this.#write + 1) & mask;
    return out;
  }
}

/**
 * Phase delay in samples, at `w` radians per sample, of the first-order filter
 * (b0 + b1·z⁻¹) / (1 + a1·z⁻¹).
 */
function phaseDelay(b0: number, b1: number, a1: number, w: number): number {
  const phase =
    Math.atan2(-b1 * Math.sin(w), b0 + b1 * Math.cos(w)) -
    Math.atan2(-a1 * Math.sin(w), 1 + a1 * Math.cos(w));
  return -phase / w;
}

/** Loop gain per sample for a ring time (60 dB) of `seconds` at `frequency`. */
const loopGain = (seconds: number, frequency: number) =>
  Math.pow(10, -3 / (Math.max(1e-3, seconds) * frequency));

class PluckVoice implements Voice {
  pitch = 0;
  readonly #settings: PluckSettings;
  readonly #sampleRate: number;
  readonly #noise: Noise;
  /** Excitation shape scratch (one period), shared by the voices of one synth. */
  readonly #shape: Float32Array;
  readonly #a: KsString;
  readonly #b: KsString;
  #double = false;
  #active = false;
  #releasing = false;
  #velocity = 0;
  /** Output level follower, to tell when the strings have died away. */
  #level = 0;
  /** Bow: its pressure envelope and the filtered noise it feeds in. */
  #bow = 0;
  #bowNoise = 0;
  #time = 0;
  /** Stereo gains of string A (panned left by Double) and string B (right). */
  #aLeft = 1;
  #aRight = 1;
  #bLeft = 1;
  #bRight = 1;

  constructor(settings: PluckSettings, sampleRate: number, noise: Noise, shape: Float32Array) {
    this.#settings = settings;
    this.#sampleRate = sampleRate;
    this.#noise = noise;
    this.#shape = shape;
    const maxLength = Math.ceil(sampleRate / LOWEST_FREQUENCY);
    this.#a = new KsString(maxLength);
    this.#b = new KsString(maxLength);
  }

  get active(): boolean {
    return this.#active;
  }

  get releasing(): boolean {
    return this.#releasing;
  }

  start(pitch: number, velocity: number): void {
    const settings = this.#settings;
    const sampleRate = this.#sampleRate;
    const fresh = !this.#active;
    this.pitch = pitch;
    this.#velocity = velocity / 127;
    this.#active = true;
    this.#releasing = false;
    this.#time = 0;
    this.#bow = 0;
    this.#level = 1;
    const frequency = noteFrequency(pitch + settings.tuning);
    this.#double = settings.double > 0.001;
    // A string already ringing at another pitch can't be retuned mid-note without a click:
    // start it clean. Re-plucking the same pitch adds to what's still ringing.
    const retune = fresh || Math.abs(this.#a.frequency - frequency) > 1e-6;
    if (retune) {
      this.#a.tune(frequency, settings.damping, settings.stiffness, sampleRate);
      this.#a.silence();
      const detuned = frequency * Math.pow(2, (settings.double * DOUBLE_CENTS) / 1200);
      this.#b.tune(detuned, settings.damping, settings.stiffness, sampleRate);
      this.#b.silence();
    }
    // Equal-power pan, full level in the centre.
    const angle = ((1 - settings.double * DOUBLE_PAN) * Math.PI) / 4;
    this.#aLeft = this.#bRight = Math.cos(angle) * Math.SQRT2;
    this.#aRight = this.#bLeft = Math.sin(angle) * Math.SQRT2;
    if (settings.excite !== PluckExcite.Bow) {
      this.#excite(this.#a);
      if (this.#double) this.#excite(this.#b);
    }
  }

  release(): void {
    this.#releasing = true;
  }

  /** Writes one period of excitation into the string: a pluck or a mallet. */
  #excite(string: KsString): void {
    const settings = this.#settings;
    const shape = this.#shape;
    const length = string.length;
    // Harder notes are brighter.
    const brightness = Math.min(1, settings.brightness + (this.#velocity - 0.6) * 0.3);
    const amplitude = this.#velocity;
    if (settings.excite === PluckExcite.Strike) {
      // A soft mallet: a raised-cosine bump, wider (duller) at low brightness.
      const centre = settings.position * length;
      const half = Math.max(1.5, (0.04 + (1 - brightness) * 0.4) * length);
      for (let i = 0; i < length; i++) {
        const x = (i - centre) / half;
        shape[i] = Math.abs(x) < 1 ? 0.5 * (1 + Math.cos(Math.PI * x)) * amplitude : 0;
      }
    } else {
      // A pick: noise, low-passed by brightness, then the pick position's comb (plucking at
      // a fraction of the string cancels the overtones with a node there).
      const smooth = Math.pow(1 - brightness, 2) * 0.95;
      let low = 0;
      for (let i = 0; i < length; i++) {
        low = low * smooth + this.#noise.next() * (1 - smooth);
        shape[i] = low;
      }
      const offset = Math.max(1, Math.round(settings.position * length));
      for (let i = length - 1; i >= offset; i--) shape[i] = shape[i]! - shape[i - offset]!;
      // Noise loses level as it's low-passed; even it out.
      let peak = 1e-6;
      for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(shape[i]!));
      for (let i = 0; i < length; i++) shape[i] = (shape[i]! / peak) * amplitude;
    }
    // No DC: it would ring on as an offset.
    let mean = 0;
    for (let i = 0; i < length; i++) mean += shape[i]!;
    mean /= length;
    for (let i = 0; i < length; i++) shape[i] = shape[i]! - mean;
    string.excite(shape);
  }

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
    const a = this.#a;
    const b = this.#b;
    // Ring time per block (Decay can be automated); after release, the shorter of the two.
    const ring = this.#releasing ? Math.min(settings.decay, settings.release) : settings.decay;
    // Never above 1: the damping filter passes DC untouched, which mustn't build up.
    a.gain = Math.min(1, loopGain(ring, a.frequency) / a.loss);
    b.gain = Math.min(1, loopGain(ring, b.frequency) / b.loss);
    const bowing = settings.excite === PluckExcite.Bow;
    const bowTarget = bowing && !this.#releasing ? 1 : 0;
    const bowStep = 1 - Math.exp(-1 / (0.08 * sampleRate));
    // The bow feeds in about what the string loses each period, so the note holds steady.
    // Noise into a resonator builds up to about input / √(2·loss): feed it in proportion to
    // √loss, so the note holds the same level whatever its pitch and Decay.
    const bowGain = Math.sqrt(2 * Math.max(1e-6, 1 - a.gain * a.loss)) * BOW_LEVEL * this.#velocity;
    const bowSmooth = Math.pow(1 - settings.brightness, 2) * 0.9;
    const follow = Math.exp(-1 / (0.05 * sampleRate));
    const aLeft = this.#aLeft;
    const aRight = this.#aRight;
    const bLeft = this.#bLeft;
    const bRight = this.#bRight;
    const double = this.#double;
    const dt = 1 / sampleRate;
    let level = this.#level;

    const end = offset + frames;
    for (let i = offset; i < end; i++) {
      let input = 0;
      if (bowing) {
        this.#bow += (bowTarget - this.#bow) * bowStep;
        this.#bowNoise = this.#bowNoise * bowSmooth + this.#noise.next() * (1 - bowSmooth);
        input = this.#bowNoise * this.#bow * bowGain;
      }
      const sa = a.next(input);
      let l = sa * aLeft;
      let r = sa * aRight;
      let magnitude = Math.abs(sa);
      if (double) {
        const sb = b.next(input);
        l = (l + sb * bLeft) * 0.7;
        r = (r + sb * bRight) * 0.7;
        magnitude = Math.max(magnitude, Math.abs(sb));
      }
      left[i]! += l * gain;
      right[i]! += r * gain;
      level = Math.max(magnitude, level * follow);
      this.#time += dt;
    }
    this.#level = level;
    // Done once it has died away (a bowed note only after it's let go).
    const bowHeld = bowing && !this.#releasing;
    if (level < SILENCE && this.#time > 0.05 && !bowHeld) this.#active = false;
  }
}

/** Engine implementation of the "synth.pluck" box. */
export class PluckSynth implements SynthRuntime {
  readonly #sampleRate: number;
  readonly #settings: PluckSettings;
  readonly #pool: VoicePool<PluckVoice>;
  readonly #level: SmoothedValue;
  /** The first real setParams jumps straight to its level instead of fading from the default. */
  #snapLevel = true;
  #scratchLeft = new Float32Array(128);
  #scratchRight = new Float32Array(128);
  /** The body: three resonances per channel, and how much of them is heard. */
  readonly #bodyLeft = BODY_FREQUENCIES.map(() => new Svf());
  readonly #bodyRight = BODY_FREQUENCIES.map(() => new Svf());
  #body = 0;
  #bodySize = 0.5;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.#settings = {
      excite: PluckExcite.Pluck,
      brightness: 0.6,
      position: 0.15,
      decay: 2,
      damping: 0.4,
      stiffness: 0,
      double: 0,
      release: 0.15,
      tuning: 0,
    };
    const noise = new Noise();
    const shape = new Float32Array(Math.ceil(sampleRate / LOWEST_FREQUENCY) + 8);
    this.#pool = new VoicePool(
      Array.from(
        { length: VOICE_COUNT },
        () => new PluckVoice(this.#settings, sampleRate, noise, shape),
      ),
    );
    this.#level = new SmoothedValue(0, sampleRate);
    this.setParams({});
    this.#snapLevel = true;
  }

  /** Allocation-free: automation can call this every block. */
  setParams(params: Readonly<Record<string, number>>): void {
    const settings = this.#settings;
    settings.excite = Math.round(read(params, 'excite'));
    settings.brightness = read(params, 'brightness');
    settings.position = read(params, 'position');
    settings.decay = read(params, 'decay');
    settings.damping = read(params, 'damping');
    settings.stiffness = read(params, 'stiffness');
    settings.double = read(params, 'double');
    settings.release = read(params, 'release');
    settings.tuning = read(params, 'transpose') + read(params, 'fine') / 100;
    this.#body = read(params, 'body');
    const size = read(params, 'bodySize');
    if (size !== this.#bodySize || this.#snapLevel) {
      this.#bodySize = size;
      // Bigger bodies resonate lower (an octave either way).
      const scale = Math.pow(2, (0.5 - size) * 2);
      for (let k = 0; k < BODY_FREQUENCIES.length; k++) {
        const frequency = BODY_FREQUENCIES[k]! * scale;
        this.#bodyLeft[k]!.set(frequency, BODY_Q[k]!, this.#sampleRate);
        this.#bodyRight[k]!.set(frequency, BODY_Q[k]!, this.#sampleRate);
      }
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
    const body = this.#body;
    const dry = 1 - 0.6 * body;
    const wet = body * 1.6;
    const bodyLeft = this.#bodyLeft;
    const bodyRight = this.#bodyRight;
    // The body runs on silence too (cheap), so its own short tail rings out.
    for (let i = offset; i < end; i++) {
      let l = scratchLeft[i]!;
      let r = scratchRight[i]!;
      if (body > 0) {
        let resonanceLeft = 0;
        let resonanceRight = 0;
        for (let k = 0; k < bodyLeft.length; k++) {
          bodyLeft[k]!.process(l);
          bodyRight[k]!.process(r);
          resonanceLeft += bodyLeft[k]!.band * BODY_GAINS[k]!;
          resonanceRight += bodyRight[k]!.band * BODY_GAINS[k]!;
        }
        l = l * dry + resonanceLeft * wet;
        r = r * dry + resonanceRight * wet;
      }
      const level = this.#level.next();
      left[i]! += l * level;
      right[i]! += r * level;
    }
  }
}
