/**
 * Automation playback: a track's clip lanes, flattened per box param into curves over song
 * time. Built when clips or presets change (may allocate); read every block (must not).
 */
import { interpolate, isSteppedParam, resolveTarget } from '../model/automation';
import { getParamDescriptor } from '../model/boxes/registry';
import type { ParamDescriptor } from '../model/boxes/types';
import type { Clip, Preset, Tick } from '../model/types';

/** One box param's automation across a track's clips that share one preset. */
export class AutomationCurve {
  readonly boxId: string;
  readonly paramId: string;
  readonly param: ParamDescriptor;
  readonly #ticks: Float64Array;
  readonly #values: Float64Array;
  /** 1 where the point ramps to the next one (linear, and the next point is in the same clip). */
  readonly #ramps: Uint8Array;

  constructor(
    boxId: string,
    paramId: string,
    param: ParamDescriptor,
    points: readonly { tick: Tick; value: number; ramp: boolean }[],
  ) {
    this.boxId = boxId;
    this.paramId = paramId;
    this.param = param;
    this.#ticks = Float64Array.from(points, (p) => p.tick);
    this.#values = Float64Array.from(points, (p) => p.value);
    this.#ramps = Uint8Array.from(points, (p) => (p.ramp ? 1 : 0));
  }

  /**
   * The value at `tick`: the last point at or before it, ramping towards the next one where it
   * should. Between clips it holds; NaN before the first point (the preset's own value applies).
   */
  valueAt(tick: Tick): number {
    const ticks = this.#ticks;
    let low = 0;
    let high = ticks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (ticks[mid]! <= tick) low = mid + 1;
      else high = mid;
    }
    const index = low - 1;
    if (index < 0) return NaN;
    const value = this.#values[index]!;
    if (this.#ramps[index] === 0 || index + 1 >= ticks.length) return value;
    const span = ticks[index + 1]! - ticks[index]!;
    if (span <= 0) return value;
    return interpolate(this.param, value, this.#values[index + 1]!, (tick - ticks[index]!) / span);
  }
}

/**
 * Curves for the clips of one track that play with `preset`: each lane is linked to a box of
 * the preset (by id, else by type and position); lanes with no matching box are skipped
 * (inactive). Points outside their clip (hidden by trimming) don't play.
 */
export function buildCurves(clips: readonly Clip[], preset: Preset): AutomationCurve[] {
  const byParam = new Map<
    string,
    {
      boxId: string;
      paramId: string;
      param: ParamDescriptor;
      points: { tick: Tick; value: number; ramp: boolean }[];
    }
  >();
  const sorted = [...clips].sort((a, b) => a.startTick - b.startTick);
  for (const clip of sorted) {
    for (const lane of clip.automation) {
      const box = resolveTarget(preset, lane.target);
      const param = box && getParamDescriptor(box.type, lane.paramId);
      if (!box || !param) continue;
      const inside = lane.points
        .filter((p) => p.tick >= 0 && p.tick <= clip.lengthTicks)
        .sort((a, b) => a.tick - b.tick);
      const key = `${box.id}\u0000${lane.paramId}`;
      let entry = byParam.get(key);
      if (!entry) {
        entry = { boxId: box.id, paramId: lane.paramId, param, points: [] };
        byParam.set(key, entry);
      }
      inside.forEach((p, i) => {
        entry.points.push({
          tick: clip.startTick + p.tick,
          value: p.value,
          ramp: p.curve === 'linear' && !isSteppedParam(param) && i + 1 < inside.length,
        });
      });
    }
  }
  return [...byParam.values()]
    .filter((e) => e.points.length > 0)
    .map((e) => new AutomationCurve(e.boxId, e.paramId, e.param, e.points));
}
