import type { BlockEvents } from '../note-schedule';

/**
 * Engine-side implementation of a synth box. Created per preset instance on a track.
 * `process` runs on the audio thread and must not allocate.
 */
export interface SynthRuntime {
  /** Applies all params (called on creation and whenever the box's params change). */
  setParams(params: Readonly<Record<string, number>>): void;
  noteOn(pitch: number, velocity: number): void;
  noteOff(pitch: number): void;
  /** Releases every held note (their release tails still play). */
  allNotesOff(): void;
  /**
   * Adds `frames` samples to both channels, starting at `offset`. Called once per stretch of
   * the block between note events, so notes start on their exact sample.
   */
  process(left: Float32Array, right: Float32Array, offset: number, frames: number): void;
}

/** Timing information every box gets for the current block. */
export interface BlockContext {
  bpm: number;
  /**
   * Tick at the block's first sample on the box clock: the song position while playing,
   * otherwise a free-running clock (so tempo-synced boxes keep time when stopped too).
   */
  clockTick: number;
  ticksPerSample: number;
  playing: boolean;
}

/** An effect box: processes a stereo buffer in place. */
export interface EffectRuntime {
  setParams(params: Readonly<Record<string, number>>): void;
  process(left: Float32Array, right: Float32Array, frames: number, context: BlockContext): void;
}

/**
 * A sequencer box: turns incoming notes into outgoing notes. Incoming notes arrive through
 * `noteOn`/`noteOff` in time order (offset = sample in the coming block); `render` then writes
 * the block's outgoing notes. Must not allocate after construction.
 */
export interface SequencerRuntime {
  setParams(params: Readonly<Record<string, number>>): void;
  noteOn(pitch: number, velocity: number, offset: number): void;
  noteOff(pitch: number, offset: number): void;
  render(frames: number, context: BlockContext, output: BlockEvents): void;
  /** Forgets every held note without emitting anything (the synth is silenced separately). */
  reset(): void;
}

export type SynthFactory = (sampleRate: number) => SynthRuntime;
export type EffectFactory = (sampleRate: number) => EffectRuntime;
export type SequencerFactory = () => SequencerRuntime;
