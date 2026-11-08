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
 * Tempo in BPM (quarter notes per minute) at `tick`. Phase 2 treats every tempo event as a step;
 * linear ramps arrive with tempo automation (Phase 4).
 */
export function bpmAt(map: TempoMap, tick: Tick): number {
  let bpm = map.tempos[0]?.bpm ?? 120;
  for (const tempo of map.tempos) if (tempo.tick <= tick) bpm = tempo.bpm;
  return bpm;
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

/**
 * Musical position "bar.beat.sixteenth", 1-based, like "1.1.1". Uses the first meter
 * (meter changes arrive in Phase 4).
 */
export function formatPosition(map: TempoMap, tick: Tick): string {
  const meter = map.meters[0]!;
  const bar = ticksPerBar(meter);
  const beat = ticksPerBeat(meter);
  const t = Math.max(0, tick);
  const bars = Math.floor(t / bar);
  const beats = Math.floor((t - bars * bar) / beat);
  const sixteenths = Math.floor((t - bars * bar - beats * beat) / (PPQ / 4));
  return `${bars + 1}.${beats + 1}.${sixteenths + 1}`;
}
