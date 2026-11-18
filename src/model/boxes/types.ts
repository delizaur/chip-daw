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
   * How an enum param is shown: a selector (the default) or a stepped knob that shows its
   * labels (for long lists, such as ratios, where a row of buttons wouldn't fit).
   */
  control?: 'knob';
  /**
   * For display: 's' (seconds), '%' (0..1 shown as percent), 'st' (semitones), 'ct' (cents),
   * 'Hz' (frequency).
   */
  unit?: 's' | '%' | 'st' | 'ct' | 'Hz';
  /**
   * Section of the box this param is shown in (e.g. "Osc", "Filter"). Boxes with many params
   * group them; params of a box without groups are shown together.
   */
  group?: string;
}

/**
 * Static description of a box type. Shared by the engine (defaults, ranges) and the UI
 * (the preset editor is rendered from it), so a new box needs no UI code.
 */
/** Puts each param in its section (`groups`: param id → section name). */
export function inGroups(params: ParamDescriptor[], groups: Record<string, string>) {
  return params.map((p) => (groups[p.id] ? { ...p, group: groups[p.id] } : p));
}

export interface BoxDescriptor {
  /** Registry key, e.g. "synth.chip". Stored in BoxInstance.type, so never rename one. */
  type: string;
  kind: BoxKind;
  name: string;
  params: ParamDescriptor[];
}
