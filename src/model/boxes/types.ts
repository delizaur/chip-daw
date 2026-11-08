export type BoxKind = 'sequencer' | 'synth' | 'effect';

export interface ParamDescriptor {
  id: string;
  name: string;
  min: number;
  max: number;
  default: number;
  /** How the control maps to the range. `exp` needs min > 0 (times, frequencies). */
  scale: 'linear' | 'exp';
  /** Snap to multiples of this (from min). Omit for continuous params. */
  step?: number;
  /**
   * Labels for enum params: value i (from min, in `step`s) is `steps[i]`.
   * Present only for enum params, which the UI shows as a segmented selector.
   */
  steps?: string[];
  /**
   * For display: 's' (seconds), '%' (0..1 shown as percent), 'st' (semitones), 'ct' (cents),
   * 'Hz' (frequency).
   */
  unit?: 's' | '%' | 'st' | 'ct' | 'Hz';
}

/**
 * Static description of a box type. Shared by the engine (defaults, ranges) and the UI
 * (the preset editor is rendered from it), so a new box needs no UI code.
 */
export interface BoxDescriptor {
  /** Registry key, e.g. "synth.chip". Stored in BoxInstance.type, so never rename one. */
  type: string;
  kind: BoxKind;
  name: string;
  params: ParamDescriptor[];
}
