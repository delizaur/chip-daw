import type { Patch } from 'immer';
import type { Project } from '../model/types';

/** Messages from the main thread to the engine. */
export type UiToEngine =
  | { type: 'loadProject'; project: Project }
  | { type: 'applyPatches'; patches: Patch[] }
  /** Live input (computer keyboard, MIDI). Velocity is 1..127. */
  | { type: 'noteOn'; trackId: string; pitch: number; velocity: number }
  | { type: 'noteOff'; trackId: string; pitch: number }
  /** Releases every note on every track (e.g. when the window loses focus). */
  | { type: 'allNotesOff' };

/** Messages from the engine to the main thread. */
export type EngineToUi = {
  type: 'meters';
  /** Peak absolute sample value of the master output since the last report (0..1). */
  master: number;
};
