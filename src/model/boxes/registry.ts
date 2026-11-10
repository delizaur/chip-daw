import { createId } from '../ids';
import type { BoxInstance } from '../types';
import { CHIP_SYNTH } from './chip-synth';
import { ARPEGGIATOR, BITCRUSH, DELAY, FILTER, REVERB } from './effects';
import { FM_SYNTH } from './fm-synth';
import type { BoxDescriptor, BoxKind, ParamDescriptor } from './types';

/** Every box type, in the order the "add" menus list them. */
const DESCRIPTORS: BoxDescriptor[] = [
  CHIP_SYNTH,
  FM_SYNTH,
  ARPEGGIATOR,
  BITCRUSH,
  FILTER,
  DELAY,
  REVERB,
];

const BY_TYPE = new Map(DESCRIPTORS.map((d) => [d.type, d]));

export const DEFAULT_SYNTH_TYPE = CHIP_SYNTH.type;

export function getBoxDescriptor(type: string): BoxDescriptor | undefined {
  return BY_TYPE.get(type);
}

export function boxDescriptorsOfKind(kind: BoxKind): BoxDescriptor[] {
  return DESCRIPTORS.filter((d) => d.kind === kind);
}

export function getParamDescriptor(type: string, paramId: string): ParamDescriptor | undefined {
  return BY_TYPE.get(type)?.params.find((p) => p.id === paramId);
}

/** A new box of `type` with every param at its default. */
export function createBox(type: string): BoxInstance {
  const descriptor = BY_TYPE.get(type);
  if (!descriptor) throw new Error(`Unknown box type "${type}"`);
  return {
    id: createId(),
    type,
    params: Object.fromEntries(descriptor.params.map((p) => [p.id, p.default])),
  };
}

/** Clamps a value to the param's range and snaps it to its step. */
export function constrainParam(param: ParamDescriptor, value: number): number {
  let v = Math.min(param.max, Math.max(param.min, value));
  if (param.step) v = param.min + Math.round((v - param.min) / param.step) * param.step;
  return v;
}

export type ParamReader = (params: Readonly<Record<string, number>>, id: string) => number;

/**
 * Reads one box type's params: `read(params, id)` is the value, or the param's default when it's
 * missing, like `paramValue`. Allocation-free, for the engine, where automation can call a box's
 * `setParams` every block.
 */
export function paramReader(descriptor: BoxDescriptor): ParamReader {
  const defaults = new Map(descriptor.params.map((p) => [p.id, p.default]));
  return (params, id) => params[id] ?? defaults.get(id) ?? 0;
}

/** A box's value for `param`, falling back to the default (e.g. params added in a later version). */
export function paramValue(box: BoxInstance, param: ParamDescriptor): number {
  return box.params[param.id] ?? param.default;
}
