/**
 * Commands that edit clip automation lanes, and the helpers recording uses to write knob moves
 * into clips.
 */
import type { Draft } from 'immer';
import { defaultCurve, sortPoints } from './automation';
import { constrainParam, getParamDescriptor } from './boxes/registry';
import type { ProjectCommand } from './commands';
import { findClip, type ClipAddress } from './note-commands';
import type { AutomationLane, AutomationPoint, AutomationTarget, Clip, Tick } from './types';

/** A knob move captured while recording, in absolute song ticks. */
export interface RecordedParamMove {
  trackId: string;
  target: AutomationTarget;
  paramId: string;
  tick: Tick;
  value: number;
}

/** Recorded moves closer together than this (a 64th note) are merged into one point. */
const MIN_POINT_SPACING = 15;

const sameLane = (lane: AutomationLane, boxId: string, paramId: string) =>
  lane.target.boxId === boxId && lane.paramId === paramId;

/** Points constrained to the param's range and to the clip, sorted. */
function cleanPoints(
  points: readonly AutomationPoint[],
  boxType: string,
  paramId: string,
  length: Tick,
): AutomationPoint[] {
  const param = getParamDescriptor(boxType, paramId);
  if (!param) throw new Error(`Unknown param "${paramId}" for ${boxType}`);
  return sortPoints(
    points.map((p) => ({
      tick: Math.min(length, Math.max(0, Math.round(p.tick))),
      value: constrainParam(param, p.value),
      curve: p.curve,
    })),
  );
}

/**
 * Replaces the points of a clip's lane for `target` + `paramId` (the lane is created if
 * needed, removed when no points are left). Ticks are relative to the clip start and kept
 * inside the clip; values are constrained to the param.
 */
export function setLanePoints(
  clipAddress: ClipAddress,
  target: AutomationTarget,
  paramId: string,
  points: readonly AutomationPoint[],
  label = 'Edit automation',
): ProjectCommand {
  return {
    label,
    recipe: (project) => {
      const clip = findClip(project, clipAddress);
      const clean = cleanPoints(points, target.boxType, paramId, clip.lengthTicks);
      const index = clip.automation.findIndex((l) => sameLane(l, target.boxId, paramId));
      if (clean.length === 0) {
        if (index >= 0) clip.automation.splice(index, 1);
      } else if (index >= 0) {
        clip.automation[index]!.points = clean;
      } else {
        clip.automation.push({ target: { ...target }, paramId, points: clean });
      }
    },
  };
}

/** Removes a clip's lane (e.g. one left unlinked after its box was removed). */
export function deleteLane(
  clipAddress: ClipAddress,
  boxId: string,
  paramId: string,
): ProjectCommand {
  return {
    label: 'Delete automation',
    recipe: (project) => {
      const clip = findClip(project, clipAddress);
      clip.automation = clip.automation.filter((l) => !sameLane(l, boxId, paramId));
    },
  };
}

/**
 * Writes recorded knob moves into a clip: per lane, the moves inside the clip become points
 * (relative ticks, merged when closer than a 64th) that replace the lane's existing points
 * between the first and last move. Moves outside the clip are ignored.
 */
export function writeRecordedMoves(clip: Draft<Clip>, moves: readonly RecordedParamMove[]): void {
  const lanes = new Map<string, RecordedParamMove[]>();
  for (const move of moves) {
    const relative = move.tick - clip.startTick;
    if (relative < 0 || relative > clip.lengthTicks) continue;
    const key = `${move.target.boxId}\u0000${move.paramId}`;
    lanes.set(key, [...(lanes.get(key) ?? []), move]);
  }
  for (const laneMoves of lanes.values()) {
    const { target, paramId } = laneMoves[0]!;
    const param = getParamDescriptor(target.boxType, paramId);
    if (!param) continue;
    const curve = defaultCurve(param);
    const points: AutomationPoint[] = [];
    for (const move of [...laneMoves].sort((a, b) => a.tick - b.tick)) {
      const tick = Math.round(move.tick - clip.startTick);
      const value = constrainParam(param, move.value);
      const last = points[points.length - 1];
      if (last && tick - last.tick < MIN_POINT_SPACING) last.value = value;
      else points.push({ tick, value, curve });
    }
    const from = points[0]!.tick;
    const to = points[points.length - 1]!.tick;
    let lane = clip.automation.find((l) => sameLane(l, target.boxId, paramId));
    if (!lane) {
      clip.automation.push({ target: { ...target }, paramId, points: [] });
      lane = clip.automation[clip.automation.length - 1]!;
    }
    lane.points = sortPoints([
      ...lane.points.filter((p) => p.tick < from || p.tick > to),
      ...points,
    ]);
  }
}

/**
 * Lanes of clips merged into one starting at `start` (overdub): points move with their notes,
 * and lanes for the same box param are combined.
 */
export function mergeLanes(clips: readonly Clip[], start: Tick): AutomationLane[] {
  const merged: AutomationLane[] = [];
  for (const clip of clips) {
    const offset = clip.startTick - start;
    for (const lane of clip.automation) {
      const points = lane.points
        .filter((p) => p.tick >= 0 && p.tick <= clip.lengthTicks)
        .map((p) => ({ ...p, tick: p.tick + offset }));
      const existing = merged.find((l) => sameLane(l, lane.target.boxId, lane.paramId));
      if (existing) existing.points = sortPoints([...existing.points, ...points]);
      else merged.push({ target: { ...lane.target }, paramId: lane.paramId, points });
    }
  }
  return merged;
}
