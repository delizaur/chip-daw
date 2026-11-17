/**
 * Musical time: ticks, the tempo map (tempo changes, with steps or linear ramps between them)
 * and the meter map (time-signature changes, each starting on a bar line).
 */
import { PPQ } from './constants';
import type { MeterEvent, TempoMap, Tick } from './types';

/** Ticks in one beat of the meter (a quarter note in x/4, an eighth in x/8). */
export function ticksPerBeat(meter: Pick<MeterEvent, 'denominator'>): number {
  return (PPQ * 4) / meter.denominator;
}

export function ticksPerBar(meter: Pick<MeterEvent, 'numerator' | 'denominator'>): number {
  return meter.numerator * ticksPerBeat(meter);
}

/** The meter in effect at `tick`. */
export function meterAt(map: TempoMap, tick: Tick): MeterEvent {
  let current = map.meters[0]!;
  for (const meter of map.meters) if (meter.tick <= tick) current = meter;
  return current;
}

/**
 * Tempo in BPM (quarter notes per minute) at `tick`. A tempo event holds until the next one
 * (`step`), or ramps linearly towards it (`linear`, in ticks).
 */
export function bpmAt(map: TempoMap, tick: Tick): number {
  const tempos = map.tempos;
  if (tempos.length === 0) return 120;
  let index = 0;
  for (let i = 0; i < tempos.length; i++) if (tempos[i]!.tick <= tick) index = i;
  const tempo = tempos[index]!;
  const next = tempos[index + 1];
  if (tempo.ramp !== 'linear' || !next || next.tick <= tempo.tick || tick <= tempo.tick) {
    return tempo.bpm;
  }
  const t = Math.min(1, (tick - tempo.tick) / (next.tick - tempo.tick));
  return tempo.bpm + (next.bpm - tempo.bpm) * t;
}

/** Ticks per second at a tempo. */
export function ticksPerSecond(bpm: number): number {
  return (bpm / 60) * PPQ;
}

export function snapTick(tick: Tick, grid: Tick): Tick {
  return Math.round(tick / grid) * grid;
}

export function floorTo(tick: Tick, grid: Tick): Tick {
  return Math.floor(tick / grid) * grid;
}

export function ceilTo(tick: Tick, grid: Tick): Tick {
  return Math.ceil(tick / grid) * grid;
}

/** A bar: its 0-based number, where it starts, its length and its meter. */
export interface Bar {
  index: number;
  start: Tick;
  length: Tick;
  meter: MeterEvent;
}

/** The bar containing `tick` (bars before 0 count as bar 0). */
export function barAt(map: TempoMap, tick: Tick): Bar {
  const meters = map.meters;
  let index = 0;
  for (let m = 0; m < meters.length; m++) {
    const meter = meters[m]!;
    const next = meters[m + 1];
    const length = ticksPerBar(meter);
    if (!next || tick < next.tick) {
      const bars = Math.max(0, Math.floor((tick - meter.tick) / length));
      return { index: index + bars, start: meter.tick + bars * length, length, meter };
    }
    index += Math.round((next.tick - meter.tick) / length);
  }
  const meter = meters[0]!;
  return { index: 0, start: 0, length: ticksPerBar(meter), meter };
}

/** Where 0-based bar `index` starts. */
export function barStart(map: TempoMap, index: number): Tick {
  const meters = map.meters;
  let first = 0;
  for (let m = 0; m < meters.length; m++) {
    const meter = meters[m]!;
    const next = meters[m + 1];
    const length = ticksPerBar(meter);
    const count = next ? Math.round((next.tick - meter.tick) / length) : Infinity;
    if (index < first + count) return meter.tick + (index - first) * length;
    first += count;
  }
  return 0;
}

/** The bars overlapping `from`..`to`, in order (for drawing rulers and grids). */
export function barsBetween(map: TempoMap, from: Tick, to: Tick): Bar[] {
  const bars: Bar[] = [];
  let bar = barAt(map, Math.max(0, from));
  while (bar.start < to && bars.length < 10000) {
    bars.push(bar);
    bar = barAt(map, bar.start + bar.length);
  }
  return bars;
}

/**
 * `tick` snapped to a grid of `grid` ticks counted from the start of its meter's span (meter
 * changes sit on bar lines, so bars and beats of the new meter line up from there).
 */
export function snapInMeter(map: TempoMap, tick: Tick, grid: Tick): Tick {
  const meter = meterAt(map, tick);
  return Math.max(0, meter.tick + Math.round((tick - meter.tick) / grid) * grid);
}

/** Like `snapInMeter`, rounding down. */
export function floorInMeter(map: TempoMap, tick: Tick, grid: Tick): Tick {
  const meter = meterAt(map, tick);
  return Math.max(0, meter.tick + Math.floor((tick - meter.tick) / grid) * grid);
}

/** Musical position "bar.beat.sixteenth", 1-based, like "1.1.1", following meter changes. */
export function formatPosition(map: TempoMap, tick: Tick): string {
  const t = Math.max(0, tick);
  const bar = barAt(map, t);
  const beat = ticksPerBeat(bar.meter);
  const into = t - bar.start;
  const beats = Math.floor(into / beat);
  const sixteenths = Math.floor((into - beats * beat) / (PPQ / 4));
  return `${bar.index + 1}.${beats + 1}.${sixteenths + 1}`;
}
