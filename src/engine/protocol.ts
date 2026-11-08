import type { Patch } from 'immer';
import type { Project } from '../model/types';

export type TestToneShape = 'square' | 'triangle' | 'sine';

export interface TestToneSettings {
  enabled: boolean;
  /** Hz */
  frequency: number;
  shape: TestToneShape;
}

/** Messages from the main thread to the engine. */
export type UiToEngine =
  | { type: 'loadProject'; project: Project }
  | { type: 'applyPatches'; patches: Patch[] }
  /** Temporary development aid until real synths exist (Phase 1). */
  | { type: 'testTone'; settings: TestToneSettings };

/** Messages from the engine to the main thread. */
export type EngineToUi = {
  type: 'meters';
  /** Peak absolute sample value of the master output since the last report (0..1). */
  master: number;
};
