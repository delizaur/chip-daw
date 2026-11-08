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

export type SynthFactory = (sampleRate: number) => SynthRuntime;
