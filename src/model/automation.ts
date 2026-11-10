/**
 * Clip automation: lanes of points that move a box parameter while the clip plays. A lane
 * belongs to a clip (times are relative to the clip start) and targets a box in the clip's
 * preset. Shared by the UI (drawing, editing) and the engine (playback).
 */
import { constrainParam, getParamDescriptor } from './boxes/registry';
import type { ParamDescriptor } from './boxes/types';
import { fromNormalized, toNormalized } from './scale';
import type {
  AutomationLane,
  AutomationPoint,
  AutomationTarget,
  BoxInstance,
  Clip,
  Preset,
  Tick,
} from './types';

/** A preset's boxes in chain order: sequencers, synth, effects. */
export function boxesInOrder(preset: Preset): BoxInstance[] {
  return [...preset.sequencers, preset.synth, ...preset.effects];
}

/** The target for a box of `preset`: its id, plus its type and position as a fallback. */
export function targetFor(preset: Preset, box: BoxInstance): AutomationTarget {
  const sameType = boxesInOrder(preset).filter((b) => b.type === box.type);
  return { boxId: box.id, boxType: box.type, boxIndex: Math.max(0, sameType.indexOf(box)) };
}

/**
 * The box a lane controls in `preset`: the box with its id; failing that (the clip's preset
 * changed, e.g. "Use track preset"), the `boxIndex`-th box of the same type. Undefined when
 * there's none: the lane is kept but inactive.
 */
export function resolveTarget(preset: Preset, target: AutomationTarget): BoxInstance | undefined {
  const boxes = boxesInOrder(preset);
  return (
    boxes.find((b) => b.id === target.boxId) ??
    boxes.filter((b) => b.type === target.boxType)[target.boxIndex]
  );
}

/** The lane of `clip` that controls `paramId` of `box` (in the clip's preset), if any. */
export function findLane(
  clip: Clip,
  preset: Preset,
  box: BoxInstance,
  paramId: string,
): AutomationLane | undefined {
  return clip.automation.find(
    (lane) => lane.paramId === paramId && resolveTarget(preset, lane.target)?.id === box.id,
  );
}

/** Enum params (wave shape, filter type...) jump between points instead of ramping. */
export const isSteppedParam = (param: ParamDescriptor) => param.steps !== undefined;

/** The curve new points get for `param`. */
export const defaultCurve = (param: ParamDescriptor): AutomationPoint['curve'] =>
  isSteppedParam(param) ? 'step' : 'linear';

/**
 * Value between two points: `t` of the way (0..1) from `a` to `b`, interpolated in the param's
 * own scale (so a cutoff sweep on an exponential scale sounds even), then snapped to its step.
 */
export function interpolate(param: ParamDescriptor, a: number, b: number, t: number): number {
  const { min, max, scale } = param;
  const n = toNormalized(a, min, max, scale);
  const m = toNormalized(b, min, max, scale);
  return constrainParam(param, fromNormalized(n + (m - n) * t, min, max, scale));
}

/**
 * The value of a lane at `tick` (relative to the clip start), or undefined before its first
 * point. A point with a `linear` curve ramps to the next one; `step` (and every point of a
 * stepped param) holds until the next. After the last point its value holds.
 */
export function laneValueAt(
  points: readonly AutomationPoint[],
  tick: Tick,
  param: ParamDescriptor,
): number | undefined {
  let index = -1;
  for (let i = 0; i < points.length && points[i]!.tick <= tick; i++) index = i;
  if (index < 0) return undefined;
  const point = points[index]!;
  const next = points[index + 1];
  if (!next || point.curve === 'step' || isSteppedParam(param) || next.tick === point.tick) {
    return point.value;
  }
  return interpolate(
    param,
    point.value,
    next.value,
    (tick - point.tick) / (next.tick - point.tick),
  );
}

/** Points sorted by tick (stable: points at the same tick keep their order). */
export const sortPoints = (points: readonly AutomationPoint[]): AutomationPoint[] =>
  [...points].sort((a, b) => a.tick - b.tick);

/** The param a lane controls, through its target's box type. */
export const laneParam = (lane: AutomationLane): ParamDescriptor | undefined =>
  getParamDescriptor(lane.target.boxType, lane.paramId);
