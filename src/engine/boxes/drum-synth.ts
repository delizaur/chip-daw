import { DRUM_SOUNDS, DRUM_SYNTH, type DrumSound } from '../../model/boxes/drum-synth';
import { paramReader } from '../../model/boxes/registry';
import { SmoothedValue } from '../dsp';
import { sine } from '../oscillators';
import { Svf } from '../svf';
import type { SynthRuntime } from './types';

const read = paramReader(DRUM_SYNTH);

/** Drums peak hard and briefly: more headroom than the tonal synths' 0.3 would leave. */
const OUTPUT_GAIN = 0.4;
/** Below this a drum counts as silent (-80 dB). */
const SILENCE = 1e-4;
/** The 808's six hat oscillators (Hz): square waves at inharmonic ratios sound metallic. */
const METAL_FREQUENCIES = [205.3, 304.4, 369.6, 522.7, 540, 800] as const;
/** Stereo positions (-1 left … 1 right) at full Width. */
const PAN: Record<DrumSound, number> = {
  kick: 0,
  rim: -0.3,
  snare: 0,
  clap: 0.15,
  tomLow: -0.6,
  tomMid: 0,
  hatClosed: 0.45,
  tomHigh: 0.6,
  shaker: 0.55,
  cowbell: -0.4,
  hatOpen: 0.45,
  cymbal: -0.5,
};

/**
 * Level of each drum, balanced like a drum machine's: kick loudest, then snare, clap and toms,
 * with hats and percussion lower (measured as loudness over the first 100 ms of a hit).
 */
const GAIN: Record<DrumSound, number> = {
  kick: 1,
  rim: 1.7,
  snare: 1.4,
  clap: 1,
  tomLow: 0.8,
  tomMid: 0.8,
  hatClosed: 3,
  tomHigh: 0.8,
  shaker: 1,
  cowbell: 0.43,
  hatOpen: 1.6,
  cymbal: 0.8,
};

/** Per-sample multiplier for an exponential fall of 60 dB in `seconds`. */
const fall = (seconds: number, sampleRate: number) =>
  Math.exp(Math.log(1e-3) / (Math.max(seconds, 1e-4) * sampleRate));

/** Kit settings, shared by all drums of one synth. */
interface Kit {
  sampleRate: number;
  /** Frequency multiplier from the Pitch knob. */
  pitch: number;
  kickTune: number;
  kickDecay: number;
  kickPunch: number;
  kickDrive: number;
  snareTune: number;
  snareDecay: number;
  snareSnappy: number;
  snareTone: number;
  hatClosed: number;
  hatOpen: number;
  /** Multiplier of the metal oscillators' frequencies (and the hats' filter) from Hat tone. */
  hatTone: number;
  tomTune: number;
  tomDecay: number;
  width: number;
}

/** White noise, -1..1 (xorshift; allocation-free). */
class Noise {
  #state = 0x9e3779b9;
  next(): number {
    let s = this.#state;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.#state = s;
    return (s | 0) / 2147483648;
  }
}

/** One drum: triggered by a note, rings out on its own. */
abstract class Drum {
  active = false;
  /** Seconds since the hit. */
  protected time = 0;
  protected velocity = 0;
  protected panLeft = 1;
  protected panRight = 1;
  /** A short fade instead of the drum's own decay (the open hat cut off by the closed one). */
  #choke = 1;
  #choking = false;
  readonly #chokeStep: number;
  protected readonly kit: Kit;
  protected readonly noise: Noise;
  readonly sound: DrumSound;

  constructor(sound: DrumSound, kit: Kit, noise: Noise) {
    this.sound = sound;
    this.kit = kit;
    this.noise = noise;
    this.#chokeStep = fall(0.01, kit.sampleRate);
  }

  trigger(velocity: number): void {
    this.active = true;
    this.time = 0;
    this.velocity = (velocity / 127) * GAIN[this.sound];
    this.#choke = 1;
    this.#choking = false;
    // Equal-power pan, full level in the centre.
    const angle = ((PAN[this.sound] * this.kit.width + 1) * Math.PI) / 4;
    this.panLeft = Math.cos(angle) * Math.SQRT2;
    this.panRight = Math.sin(angle) * Math.SQRT2;
    this.prepare();
    this.start();
  }

  choke(): void {
    if (this.active) this.#choking = true;
  }

  /** Adds `frames` samples to both channels from `offset`. */
  render(left: Float32Array, right: Float32Array, offset: number, frames: number): void {
    // Coefficients once per block: the knobs (and automation) change them at most that often.
    this.prepare();
    const dt = 1 / this.kit.sampleRate;
    const end = offset + frames;
    for (let i = offset; i < end; i++) {
      let value = this.next();
      if (this.#choking) {
        this.#choke *= this.#chokeStep;
        value *= this.#choke;
        if (this.#choke < SILENCE) this.active = false;
      }
      value *= this.velocity;
      left[i]! += value * this.panLeft;
      right[i]! += value * this.panRight;
      this.time += dt;
      if (!this.active) break;
    }
  }

  /** Works out the drum's coefficients from the kit settings (per block and per hit). */
  protected abstract prepare(): void;
  /** Per hit: reset the drum's own state. */
  protected abstract start(): void;
  /** The next sample; sets `active` false once the drum has died away. */
  protected abstract next(): number;
}

/** Sine with a falling pitch (punch) and a click, through optional drive. */
class Kick extends Drum {
  #phase = 0;
  #amp = 0;
  #pitchEnvelope = 0;
  #click = 0;
  #ampStep = 1;
  #pitchStep = 1;
  #clickStep = 1;
  #drive = 1;
  #driveNorm = 1;
  #step = 0;
  #sweep = 0;
  #clickLevel = 0;

  protected prepare(): void {
    const kit = this.kit;
    const sampleRate = kit.sampleRate;
    this.#ampStep = fall(kit.kickDecay, sampleRate);
    this.#pitchStep = fall(0.04 + 0.08 * (1 - kit.kickPunch), sampleRate);
    this.#clickStep = fall(0.004, sampleRate);
    this.#drive = 1 + kit.kickDrive * 8;
    this.#driveNorm = 1 / Math.tanh(this.#drive);
    this.#step = (kit.kickTune * kit.pitch) / sampleRate;
    this.#sweep = kit.kickPunch * 7;
    this.#clickLevel = kit.kickPunch * 0.3;
  }

  protected start(): void {
    this.#phase = 0;
    this.#amp = 1;
    this.#pitchEnvelope = 1;
    this.#click = 1;
  }

  protected next(): number {
    this.#phase += this.#step * (1 + this.#sweep * this.#pitchEnvelope);
    const value =
      sine(this.#phase) * this.#amp + this.noise.next() * this.#click * this.#clickLevel;
    this.#amp *= this.#ampStep;
    this.#pitchEnvelope *= this.#pitchStep;
    this.#click *= this.#clickStep;
    if (this.#amp < SILENCE) this.active = false;
    return Math.tanh(value * this.#drive) * this.#driveNorm;
  }
}

/** Two tuned sines (the drum's body) plus filtered noise (the snares). */
class Snare extends Drum {
  #phase = 0;
  #body = 0;
  #rattle = 0;
  #drop = 0;
  #bodyStep = 1;
  #rattleStep = 1;
  #dropStep = 1;
  #step = 0;
  readonly #filter = new Svf();

  protected prepare(): void {
    const kit = this.kit;
    const sampleRate = kit.sampleRate;
    this.#bodyStep = fall(0.06 + kit.snareDecay * 0.4, sampleRate);
    this.#rattleStep = fall(kit.snareDecay, sampleRate);
    this.#dropStep = fall(0.03, sampleRate);
    this.#step = (kit.snareTune * kit.pitch) / sampleRate;
    this.#filter.set(kit.snareTone, 0.7, sampleRate);
  }

  protected start(): void {
    this.#phase = 0;
    this.#body = 1;
    this.#rattle = 1;
    this.#drop = 1;
    this.#filter.reset();
  }

  protected next(): number {
    this.#phase += this.#step * (1 + 0.5 * this.#drop);
    const body = (sine(this.#phase) + 0.5 * sine(this.#phase * 1.47)) * this.#body;
    this.#filter.process(this.noise.next());
    const rattle = (this.#filter.high + this.#filter.band) * this.#rattle;
    const snappy = this.kit.snareSnappy;
    this.#body *= this.#bodyStep;
    this.#rattle *= this.#rattleStep;
    this.#drop *= this.#dropStep;
    if (this.#body < SILENCE && this.#rattle < SILENCE) this.active = false;
    return body * (1 - 0.6 * snappy) * 0.8 + rattle * snappy * 1.1;
  }
}

/** Band-passed noise in a few quick bursts (hands), then a tail. */
class Clap extends Drum {
  #tail = 0;
  #tailStep = 1;
  readonly #filter = new Svf();

  protected prepare(): void {
    const kit = this.kit;
    this.#tailStep = fall(0.1 + kit.snareDecay * 0.6, kit.sampleRate);
    this.#filter.set(900 + kit.snareTone * 0.12, 1.6, kit.sampleRate);
  }

  protected start(): void {
    this.#tail = 1;
    this.#filter.reset();
  }

  protected next(): number {
    // Three short bursts 10 ms apart, then a longer one that rings out.
    let envelope: number;
    if (this.time < 0.03) {
      envelope = 1 - ((this.time % 0.01) / 0.01) * 0.95;
    } else {
      envelope = this.#tail;
      this.#tail *= this.#tailStep;
    }
    this.#filter.process(this.noise.next());
    if (this.#tail < SILENCE) this.active = false;
    return this.#filter.band * envelope * 2.2;
  }
}

/** A short knock: two high sines and a click. */
class Rim extends Drum {
  #phase = 0;
  #amp = 0;
  #ampStep = 1;
  #step = 0;

  protected prepare(): void {
    this.#ampStep = fall(0.03, this.kit.sampleRate);
    this.#step = (1700 * this.kit.pitch) / this.kit.sampleRate;
  }

  protected start(): void {
    this.#phase = 0;
    this.#amp = 1;
  }

  protected next(): number {
    this.#phase += this.#step;
    const value =
      (sine(this.#phase) * 0.6 + sine(this.#phase * 0.29) * 0.6 + this.noise.next() * 0.3) *
      this.#amp;
    this.#amp *= this.#ampStep;
    if (this.#amp < SILENCE) this.active = false;
    return value;
  }
}

/** A sine with a slight pitch drop and a noisy attack; `ratio` sets low, mid or high. */
class Tom extends Drum {
  #phase = 0;
  #amp = 0;
  #drop = 0;
  #ampStep = 1;
  #dropStep = 1;
  #step = 0;
  readonly #ratio: number;

  constructor(sound: DrumSound, kit: Kit, noise: Noise, ratio: number) {
    super(sound, kit, noise);
    this.#ratio = ratio;
  }

  protected prepare(): void {
    const kit = this.kit;
    // Higher toms ring a little shorter.
    this.#ampStep = fall(kit.tomDecay / Math.sqrt(this.#ratio), kit.sampleRate);
    this.#dropStep = fall(0.15, kit.sampleRate);
    this.#step = (kit.tomTune * this.#ratio * kit.pitch) / kit.sampleRate;
  }

  protected start(): void {
    this.#phase = 0;
    this.#amp = 1;
    this.#drop = 1;
  }

  protected next(): number {
    this.#phase += this.#step * (1 + 0.6 * this.#drop);
    const attack = this.time < 0.01 ? this.noise.next() * 0.25 * (1 - this.time / 0.01) : 0;
    const value = (sine(this.#phase) + attack) * this.#amp;
    this.#amp *= this.#ampStep;
    this.#drop *= this.#dropStep;
    if (this.#amp < SILENCE) this.active = false;
    return value;
  }
}

/** Six detuned squares (metal) and some noise, high-passed: hats and cymbal. */
class Metal extends Drum {
  readonly #phases = new Float64Array(METAL_FREQUENCIES.length);
  readonly #steps = new Float64Array(METAL_FREQUENCIES.length);
  readonly #filter = new Svf();
  #amp = 0;
  #ampStep = 1;
  readonly #kind: 'closed' | 'open' | 'cymbal';

  constructor(sound: DrumSound, kit: Kit, noise: Noise, kind: 'closed' | 'open' | 'cymbal') {
    super(sound, kit, noise);
    this.#kind = kind;
  }

  protected prepare(): void {
    const kit = this.kit;
    const sampleRate = kit.sampleRate;
    const tone = kit.hatTone * kit.pitch;
    for (let k = 0; k < METAL_FREQUENCIES.length; k++) {
      this.#steps[k] = (METAL_FREQUENCIES[k]! * tone) / sampleRate;
    }
    const cymbal = this.#kind === 'cymbal';
    this.#filter.set((cymbal ? 5000 : 7000) * kit.hatTone, 0.8, sampleRate);
    const decay =
      this.#kind === 'closed'
        ? kit.hatClosed
        : this.#kind === 'open'
          ? kit.hatOpen
          : Math.min(5, kit.hatOpen * 3);
    this.#ampStep = fall(decay, sampleRate);
  }

  protected start(): void {
    this.#amp = 1;
    this.#filter.reset();
  }

  protected next(): number {
    let metal = 0;
    for (let k = 0; k < METAL_FREQUENCIES.length; k++) {
      let phase = this.#phases[k]! + this.#steps[k]!;
      if (phase >= 1) phase -= 1;
      this.#phases[k] = phase;
      metal += phase < 0.5 ? 1 : -1;
    }
    const cymbal = this.#kind === 'cymbal';
    this.#filter.process(metal / 6 + this.noise.next() * (cymbal ? 0.6 : 0.3));
    const value = this.#filter.high * this.#amp;
    this.#amp *= this.#ampStep;
    if (this.#amp < SILENCE) this.active = false;
    return value * (cymbal ? 0.8 : 1);
  }
}

/** Two squares through a band-pass (the 808's cowbell): a quick drop, then a ringing tail. */
class Cowbell extends Drum {
  #phase1 = 0;
  #phase2 = 0;
  #amp = 0;
  #drop = 0;
  #ampStep = 1;
  #dropStep = 1;
  #step1 = 0;
  #step2 = 0;
  readonly #filter = new Svf();

  protected prepare(): void {
    const kit = this.kit;
    const sampleRate = kit.sampleRate;
    this.#ampStep = fall(0.35, sampleRate);
    this.#dropStep = fall(0.06, sampleRate);
    this.#step1 = (540 * kit.pitch) / sampleRate;
    this.#step2 = (800 * kit.pitch) / sampleRate;
    this.#filter.set(900 * kit.pitch, 2.5, sampleRate);
  }

  protected start(): void {
    this.#amp = 1;
    this.#drop = 1;
    this.#filter.reset();
  }

  protected next(): number {
    this.#phase1 += this.#step1;
    if (this.#phase1 >= 1) this.#phase1 -= 1;
    this.#phase2 += this.#step2;
    if (this.#phase2 >= 1) this.#phase2 -= 1;
    const source = (this.#phase1 < 0.5 ? 1 : -1) + (this.#phase2 < 0.5 ? 1 : -1);
    this.#filter.process(source * 0.5);
    const envelope = this.#amp * (0.4 + 0.6 * this.#drop);
    this.#amp *= this.#ampStep;
    this.#drop *= this.#dropStep;
    if (this.#amp < SILENCE) this.active = false;
    return this.#filter.band * envelope * 1.6;
  }
}

/** High-passed noise with a soft attack. */
class Shaker extends Drum {
  #amp = 0;
  #ampStep = 1;
  readonly #filter = new Svf();

  protected prepare(): void {
    this.#ampStep = fall(0.12, this.kit.sampleRate);
    this.#filter.set(6000 * this.kit.hatTone, 0.7, this.kit.sampleRate);
  }

  protected start(): void {
    this.#amp = 1;
    this.#filter.reset();
  }

  protected next(): number {
    this.#filter.process(this.noise.next());
    const attack = Math.min(1, this.time / 0.015);
    const value = this.#filter.high * this.#amp * attack * 0.7;
    if (this.time > 0.015) this.#amp *= this.#ampStep;
    if (this.#amp < SILENCE) this.active = false;
    return value;
  }
}

/** Index of the open hat in DRUM_SOUNDS (the closed hat chokes it). */
const OPEN_HAT = DRUM_SOUNDS.findIndex((d) => d.id === 'hatOpen');

/** Engine implementation of the "synth.drums" box. */
export class DrumSynth implements SynthRuntime {
  readonly #kit: Kit;
  /** One drum per pitch class (see DRUM_SOUNDS). */
  readonly #drums: Drum[];
  readonly #level: SmoothedValue;
  /** The first real setParams jumps straight to its level instead of fading from the default. */
  #snapLevel = true;
  #scratchLeft = new Float32Array(128);
  #scratchRight = new Float32Array(128);

  constructor(sampleRate: number) {
    this.#kit = {
      sampleRate,
      pitch: 1,
      kickTune: 50,
      kickDecay: 0.45,
      kickPunch: 0.5,
      kickDrive: 0.2,
      snareTune: 190,
      snareDecay: 0.2,
      snareSnappy: 0.6,
      snareTone: 4000,
      hatClosed: 0.05,
      hatOpen: 0.4,
      hatTone: 1,
      tomTune: 110,
      tomDecay: 0.35,
      width: 0.5,
    };
    const kit = this.#kit;
    const noise = new Noise();
    const create = (sound: DrumSound): Drum => {
      switch (sound) {
        case 'kick':
          return new Kick(sound, kit, noise);
        case 'snare':
          return new Snare(sound, kit, noise);
        case 'clap':
          return new Clap(sound, kit, noise);
        case 'rim':
          return new Rim(sound, kit, noise);
        case 'tomLow':
          return new Tom(sound, kit, noise, 1);
        case 'tomMid':
          return new Tom(sound, kit, noise, 1.33);
        case 'tomHigh':
          return new Tom(sound, kit, noise, 1.78);
        case 'hatClosed':
          return new Metal(sound, kit, noise, 'closed');
        case 'hatOpen':
          return new Metal(sound, kit, noise, 'open');
        case 'cymbal':
          return new Metal(sound, kit, noise, 'cymbal');
        case 'cowbell':
          return new Cowbell(sound, kit, noise);
        case 'shaker':
          return new Shaker(sound, kit, noise);
      }
    };
    this.#drums = DRUM_SOUNDS.map((d) => create(d.id));
    this.#level = new SmoothedValue(0, sampleRate);
    this.setParams({});
    this.#snapLevel = true;
  }

  /** Allocation-free: automation can call this every block. */
  setParams(params: Readonly<Record<string, number>>): void {
    const kit = this.#kit;
    kit.pitch = Math.pow(2, read(params, 'pitch') / 12);
    kit.kickTune = read(params, 'kickTune');
    kit.kickDecay = read(params, 'kickDecay');
    kit.kickPunch = read(params, 'kickPunch');
    kit.kickDrive = read(params, 'kickDrive');
    kit.snareTune = read(params, 'snareTune');
    kit.snareDecay = read(params, 'snareDecay');
    kit.snareSnappy = read(params, 'snareSnappy');
    kit.snareTone = read(params, 'snareTone');
    kit.hatClosed = read(params, 'hatClosed');
    kit.hatOpen = read(params, 'hatOpen');
    kit.hatTone = 0.7 + read(params, 'hatTone') * 0.9;
    kit.tomTune = read(params, 'tomTune');
    kit.tomDecay = read(params, 'tomDecay');
    kit.width = read(params, 'width');
    this.#level.target = read(params, 'level') * OUTPUT_GAIN;
    if (this.#snapLevel) {
      this.#level.current = this.#level.target;
      this.#snapLevel = false;
    }
  }

  noteOn(pitch: number, velocity: number): void {
    const drum = this.#drums[((Math.round(pitch) % 12) + 12) % 12]!;
    // The closed hat cuts off the open one, like on a real hi-hat.
    if (drum.sound === 'hatClosed') this.#drums[OPEN_HAT]!.choke();
    drum.trigger(velocity);
  }

  /** Drums are one-shots: they ring out whatever the note length. */
  noteOff(): void {}

  allNotesOff(): void {}

  get activeVoices(): number {
    let count = 0;
    for (const drum of this.#drums) if (drum.active) count++;
    return count;
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
    for (const drum of this.#drums) {
      if (drum.active) drum.render(scratchLeft, scratchRight, offset, frames);
    }
    for (let i = offset; i < end; i++) {
      const level = this.#level.next();
      left[i]! += scratchLeft[i]! * level;
      right[i]! += scratchRight[i]! * level;
    }
  }
}
