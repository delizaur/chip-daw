/** Envelope times and level, precomputed per sample rate. Shared by all voices of a synth. */
export interface EnvelopeShape {
  /** Level added per sample during attack. */
  attackStep: number;
  /** Per-sample multiplier for the decay towards sustain. */
  decayCoef: number;
  sustain: number;
  /** Per-sample multiplier during release. */
  releaseCoef: number;
}

/** Below this the envelope counts as silent (-80 dB). */
const SILENCE = 1e-4;

/** Per-sample coefficient for an exponential fall of 60 dB in `seconds`. */
function sixtyDbCoef(seconds: number, sampleRate: number): number {
  return Math.exp(Math.log(1e-3) / (Math.max(seconds, 1e-4) * sampleRate));
}

export function envelopeShape(
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  sampleRate: number,
): EnvelopeShape {
  return {
    attackStep: 1 / Math.max(1, attack * sampleRate),
    decayCoef: sixtyDbCoef(decay, sampleRate),
    sustain: Math.min(1, Math.max(0, sustain)),
    releaseCoef: sixtyDbCoef(release, sampleRate),
  };
}

const enum Stage {
  Idle,
  Attack,
  Decay,
  Sustain,
  Release,
}

/**
 * ADSR envelope: linear attack, exponential decay and release (times are to -60 dB).
 * Retriggering starts the attack from the current level, so stolen voices don't click.
 */
export class Envelope {
  level = 0;
  #stage = Stage.Idle;

  get active(): boolean {
    return this.#stage !== Stage.Idle;
  }

  get releasing(): boolean {
    return this.#stage === Stage.Release;
  }

  trigger(): void {
    this.#stage = Stage.Attack;
  }

  release(): void {
    if (this.#stage !== Stage.Idle) this.#stage = Stage.Release;
  }

  next(shape: EnvelopeShape): number {
    switch (this.#stage) {
      case Stage.Attack:
        this.level += shape.attackStep;
        if (this.level >= 1) {
          this.level = 1;
          this.#stage = Stage.Decay;
        }
        break;
      case Stage.Decay:
        this.level = shape.sustain + (this.level - shape.sustain) * shape.decayCoef;
        if (this.level - shape.sustain < SILENCE) {
          this.level = shape.sustain;
          this.#stage = Stage.Sustain;
        }
        break;
      case Stage.Sustain:
        this.level = shape.sustain;
        break;
      case Stage.Release:
        this.level *= shape.releaseCoef;
        if (this.level < SILENCE) {
          this.level = 0;
          this.#stage = Stage.Idle;
        }
        break;
      case Stage.Idle:
        break;
    }
    return this.level;
  }
}
