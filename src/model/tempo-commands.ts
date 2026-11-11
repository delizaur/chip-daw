/**
 * Commands for the song's time: tempo changes (with ramps), time-signature changes, and
 * inserting or deleting bars (everything after moves along).
 */
import { current, type Draft } from 'immer';
import { clearRange, splitClipsAt } from './clips';
import { MAX_BPM, MIN_BPM, MIN_LOOP_TICKS, type ProjectCommand } from './commands';
import { DEFAULT_SUBDIVISION, SUBDIVISIONS } from './constants';
import { bpmAt, meterAt, ticksPerBar } from './time';
import type { MeterEvent, Project, TempoEvent, TempoMap, Tick } from './types';

const clampBpm = (bpm: number) => Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) * 100) / 100;

/** Tempo events sorted, rounded, clamped, one per tick, the first at tick 0. */
function cleanTempos(events: readonly TempoEvent[]): TempoEvent[] {
  const sorted = [...events]
    .map((e) => ({ tick: Math.max(0, Math.round(e.tick)), bpm: clampBpm(e.bpm), ramp: e.ramp }))
    .sort((a, b) => a.tick - b.tick);
  const result: TempoEvent[] = [];
  for (const event of sorted) {
    if (result.length > 0 && result[result.length - 1]!.tick === event.tick) result.pop();
    result.push(event);
  }
  if (result.length === 0) return [{ tick: 0, bpm: 120, ramp: 'step' }];
  result[0]!.tick = 0;
  return result;
}

/**
 * Meter events sorted, the first at tick 0, each later one on a bar line of the meter before it
 * (moved to the next bar line if a change made it fall mid-bar), without repeats.
 */
export function cleanMeters(events: readonly MeterEvent[]): MeterEvent[] {
  const sorted = [...events].map((e) => ({ ...e })).sort((a, b) => a.tick - b.tick);
  const result: MeterEvent[] = [];
  for (const event of sorted) {
    const previous = result[result.length - 1];
    if (!previous) {
      result.push({ ...event, tick: 0 });
      continue;
    }
    const length = ticksPerBar(previous);
    const bars = Math.max(1, Math.ceil((event.tick - previous.tick) / length - 1e-9));
    const tick = previous.tick + bars * length;
    if (
      event.numerator === previous.numerator &&
      event.denominator === previous.denominator &&
      event.subdivision === previous.subdivision
    ) {
      continue; // no change
    }
    if (tick === previous.tick) result.pop();
    result.push({ ...event, tick });
  }
  return result;
}

/** Replaces the tempo events (the tempo lane's edits). The first is kept at tick 0. */
export function setTempoEvents(
  events: readonly TempoEvent[],
  label = 'Edit tempo',
): ProjectCommand {
  return {
    label,
    recipe: (project) => {
      project.tempoMap.tempos = cleanTempos(events);
    },
  };
}

/** Sets the tempo in effect at `tick` (the top bar's BPM field edits the tempo at the playhead). */
export function setTempoAt(tick: Tick, bpm: number): ProjectCommand {
  return {
    label: 'Change tempo',
    recipe: (project) => {
      const tempos = project.tempoMap.tempos;
      let current = tempos[0];
      for (const tempo of tempos) if (tempo.tick <= tick) current = tempo;
      if (current) current.bpm = clampBpm(bpm);
      else project.tempoMap.tempos = [{ tick: 0, bpm: clampBpm(bpm), ramp: 'step' }];
    },
  };
}

/**
 * Puts a time signature (and grid subdivision of the beat, kept from the meter there when
 * omitted) on the bar that starts at `tick`, replacing a change there. Later changes stay on
 * bar lines; a change that repeats the meter before it is dropped.
 */
export function setMeter(
  tick: Tick,
  numerator: number,
  denominator: number,
  subdivision?: number,
): ProjectCommand {
  return {
    label: 'Change time signature',
    recipe: (project) => {
      const meters = project.tempoMap.meters.filter((m) => m.tick !== tick);
      const current = meterAt(project.tempoMap as TempoMap, tick).subdivision;
      const parts = subdivision ?? current;
      meters.push({
        tick,
        numerator: Math.min(16, Math.max(1, Math.round(numerator))),
        denominator: [2, 4, 8, 16].includes(denominator) ? denominator : 4,
        subdivision: (SUBDIVISIONS as readonly number[]).includes(parts)
          ? parts
          : DEFAULT_SUBDIVISION,
      });
      project.tempoMap.meters = cleanMeters(meters);
    },
  };
}

/** Removes the time-signature change at `tick` (not the first one). */
export function deleteMeter(tick: Tick): ProjectCommand {
  return {
    label: 'Delete time signature',
    recipe: (project) => {
      if (tick <= 0) return;
      project.tempoMap.meters = cleanMeters(project.tempoMap.meters.filter((m) => m.tick !== tick));
    },
  };
}

/** Moves the loop's ends through `map` (where each tick ends up), keeping it a valid region. */
function remapLoop(project: Draft<Project>, map: (tick: Tick) => Tick): void {
  const start = map(project.loop.startTick);
  let end = map(project.loop.endTick);
  if (end - start < MIN_LOOP_TICKS) {
    end = start + ticksPerBar(meterAt(project.tempoMap as TempoMap, start));
  }
  project.loop.startTick = start;
  project.loop.endTick = end;
}

/**
 * Inserts `length` ticks of empty time at `start` (a bar line): clips that start there or later
 * move later, clips spanning it are split and their right part moves, and so do tempo and
 * time-signature changes and the loop. One undo step.
 */
export function insertBars(start: Tick, length: Tick): ProjectCommand {
  return {
    label: 'Insert bars',
    recipe: (project) => {
      if (length <= 0) return;
      for (const track of project.tracks) {
        splitClipsAt(track, start);
        for (const clip of track.clips) if (clip.startTick >= start) clip.startTick += length;
      }
      const map = project.tempoMap;
      for (const tempo of map.tempos)
        if (tempo.tick > 0 && tempo.tick >= start) tempo.tick += length;
      for (const meter of map.meters)
        if (meter.tick > 0 && meter.tick >= start) meter.tick += length;
      remapLoop(project, (tick) => (tick >= start ? tick + length : tick));
    },
  };
}

/**
 * Deletes the time from `start` to `end` (bar lines): clip material there is removed (clips
 * across the edges are trimmed or split), and everything after moves earlier to close the gap,
 * including tempo and time-signature changes and the loop. The tempo and meter playing at `end`
 * carry on from `start`. One undo step.
 */
export function deleteBars(start: Tick, end: Tick): ProjectCommand {
  return {
    label: 'Delete bars',
    recipe: (project) => {
      const length = end - start;
      if (length <= 0) return;
      const before: TempoMap = current(project.tempoMap);
      const shift = (tick: Tick) => (tick < start ? tick : tick < end ? start : tick - length);

      for (const track of project.tracks) {
        clearRange(track, start, end);
        for (const clip of track.clips) if (clip.startTick >= end) clip.startTick -= length;
      }

      // Tempo: drop changes inside, move later ones; the tempo at `end` resumes at `start`.
      const tempos = before.tempos.filter((t) => t.tick < start || t.tick >= end || t.tick === 0);
      const removedTempo = tempos.length !== before.tempos.length;
      const shifted = tempos.map((t) => ({ ...t, tick: shift(t.tick) }));
      if (removedTempo || shifted.some((t) => t.tick === start && start > 0)) {
        const atEnd = bpmAt(before, end);
        const rampAtEnd = [...before.tempos].reverse().find((t) => t.tick <= end)?.ramp ?? 'step';
        shifted.push({ tick: start, bpm: atEnd, ramp: rampAtEnd });
      }
      project.tempoMap.tempos = cleanTempos(shifted);

      // Meter: the same, keeping bar lines.
      const meterAtEnd = meterAt(before, end);
      const meters = before.meters
        .filter((m) => m.tick < start || m.tick >= end || m.tick === 0)
        .map((m) => ({ ...m, tick: shift(m.tick) }));
      if (meterAt({ ...before, meters }, start) !== meterAtEnd) {
        const same = meters.find((m) => m.tick === start);
        if (same) Object.assign(same, { ...meterAtEnd, tick: start });
        else meters.push({ ...meterAtEnd, tick: start });
      }
      project.tempoMap.meters = cleanMeters(meters);

      remapLoop(project, shift);
    },
  };
}
