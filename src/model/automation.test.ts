import { describe, expect, it } from 'vitest';
import { interpolate, laneValueAt, resolveTarget, targetFor } from './automation';
import { deleteLane, setLanePoints, writeRecordedMoves } from './automation-commands';
import { getParamDescriptor } from './boxes/registry';
import { createBox } from './boxes/registry';
import { addBox } from './chain-commands';
import { createClip } from './clips';
import { placeClips, recordTake, type RecordedTake } from './commands';
import { PPQ } from './constants';
import { createPreset, createProject } from './defaults';
import { History } from './history';
import type { AutomationPoint } from './types';

const BAR = 4 * PPQ;
const level = getParamDescriptor('synth.chip', 'level')!;
const wave = getParamDescriptor('synth.chip', 'wave')!;
const cutoff = getParamDescriptor('fx.filter', 'cutoff')!;
const point = (tick: number, value: number, curve: AutomationPoint['curve'] = 'linear') => ({
  tick,
  value,
  curve,
});

describe('linking lanes to boxes', () => {
  it('finds the box by id, else the same type at the same position', () => {
    const preset = createPreset();
    const first = createBox('fx.delay');
    const second = createBox('fx.delay');
    preset.effects = [first, second];
    expect(resolveTarget(preset, targetFor(preset, second))).toBe(second);

    // Another preset (e.g. after "Use track preset"): matched by type and position.
    const other = createPreset();
    const a = createBox('fx.delay');
    const b = createBox('fx.delay');
    other.effects = [a, b];
    expect(resolveTarget(other, targetFor(preset, second))).toBe(b);
    // No such box: unlinked.
    expect(resolveTarget(createPreset(), targetFor(preset, second))).toBeUndefined();
  });
});

describe('lane values', () => {
  it('is undefined before the first point, ramps between points and holds after the last', () => {
    const points = [point(100, 0.2), point(200, 0.6)];
    expect(laneValueAt(points, 50, level)).toBeUndefined();
    expect(laneValueAt(points, 100, level)).toBeCloseTo(0.2);
    expect(laneValueAt(points, 150, level)).toBeCloseTo(0.4);
    expect(laneValueAt(points, 999, level)).toBeCloseTo(0.6);
  });

  it('holds a step point until the next one, and always steps enum params', () => {
    expect(laneValueAt([point(0, 0.2, 'step'), point(100, 0.6)], 99, level)).toBeCloseTo(0.2);
    expect(laneValueAt([point(0, 0), point(100, 4)], 60, wave)).toBe(0);
  });

  it('ramps exponential params evenly in their own scale', () => {
    // Halfway between 100 Hz and 10 kHz on a log scale is 1 kHz.
    expect(interpolate(cutoff, 100, 10000, 0.5)).toBeCloseTo(1000, 0);
  });
});

describe('lane commands', () => {
  function setup() {
    const h = new History(createProject(1));
    const trackId = h.state.tracks[0]!.id;
    const clip = createClip(0, BAR, h.state.tracks[0]!.presetId);
    h.run(placeClips([{ trackId, clip }]));
    const preset = h.state.presets[0]!;
    const target = targetFor(preset, preset.synth);
    const address = { trackId, clipId: clip.id };
    const lanes = () => h.state.tracks[0]!.clips[0]!.automation;
    return { h, target, address, lanes };
  }

  it('creates, replaces and removes a lane, keeping points in the clip and the range', () => {
    const { h, target, address, lanes } = setup();
    h.run(setLanePoints(address, target, 'level', [point(500, 2), point(-10, 0.5)]));
    expect(lanes()).toEqual([{ target, paramId: 'level', points: [point(0, 0.5), point(500, 1)] }]);
    h.run(setLanePoints(address, target, 'level', [point(BAR + 100, 0.3)]));
    expect(lanes()[0]!.points).toEqual([point(BAR, 0.3)]);
    h.run(setLanePoints(address, target, 'level', []));
    expect(lanes()).toEqual([]);
    h.undo();
    expect(lanes()).toHaveLength(1);
    h.run(deleteLane(address, target.boxId, 'level'));
    expect(lanes()).toEqual([]);
  });
});

describe('recording knob moves', () => {
  it('turns moves into points, merged when closer than a 64th, replacing that stretch', () => {
    const preset = createPreset();
    const target = targetFor(preset, preset.synth);
    const clip = createClip(BAR, BAR, preset.id);
    clip.automation = [
      { target, paramId: 'level', points: [point(0, 0.1), point(500, 0.1), point(3000, 0.1)] },
    ];
    const move = (tick: number, value: number) => ({
      trackId: 't',
      target,
      paramId: 'level',
      tick: BAR + tick,
      value,
    });
    writeRecordedMoves(clip, [move(400, 0.3), move(405, 0.35), move(1000, 0.9), move(-50, 1)]);
    // 400 and 405 merge; the old point at 500 (inside 400..1000) is replaced; -50 is outside.
    expect(clip.automation[0]!.points).toEqual([
      point(0, 0.1),
      point(400, 0.35),
      point(1000, 0.9),
      point(3000, 0.1),
    ]);
  });

  it('replaces points up to where recording stopped: a moved knob holds until then', () => {
    const preset = createPreset();
    const target = targetFor(preset, preset.synth);
    const clip = createClip(0, BAR, preset.id);
    clip.automation = [
      { target, paramId: 'level', points: [point(100, 0.1), point(2000, 0.1), point(3000, 0.1)] },
    ];
    const move = { trackId: 't', target, paramId: 'level', tick: 500, value: 0.6 };
    writeRecordedMoves(clip, [move], 2500);
    expect(clip.automation[0]!.points).toEqual([
      point(100, 0.1),
      point(500, 0.6),
      point(3000, 0.1),
    ]);
  });

  it('writes moves into the clip under the take when no notes were played', () => {
    const h = new History(createProject(1));
    const track = () => h.state.tracks[0]!;
    const trackId = track().id;
    const note = { id: 'n', tick: 0, durationTicks: PPQ, pitch: 60, velocity: 100 };
    h.run(placeClips([{ trackId, clip: createClip(0, BAR, track().presetId, [note]) }]));
    const preset = h.state.presets[0]!;
    const target = targetFor(preset, preset.synth);
    const take: RecordedTake = {
      startTick: 0,
      endTick: BAR,
      notes: [],
      params: [{ trackId, target, paramId: 'level', tick: PPQ, value: 0.4 }],
    };
    h.run(recordTake(take, false));
    expect(track().clips).toHaveLength(1);
    expect(track().clips[0]!.notes).toHaveLength(1); // the notes stay
    expect(track().clips[0]!.automation[0]!.points).toEqual([point(PPQ, 0.4)]);
  });

  it('makes a clip for the moves when there is none', () => {
    const h = new History(createProject(1));
    const track = () => h.state.tracks[0]!;
    const preset = h.state.presets[0]!;
    const target = targetFor(preset, preset.synth);
    const take: RecordedTake = {
      startTick: BAR,
      endTick: 2 * BAR,
      notes: [],
      params: [{ trackId: track().id, target, paramId: 'level', tick: BAR + PPQ, value: 0.4 }],
    };
    h.run(recordTake(take, false));
    expect(track().clips[0]).toMatchObject({ startTick: BAR, lengthTicks: BAR, notes: [] });
    expect(track().clips[0]!.automation[0]!.points).toEqual([point(PPQ, 0.4)]);
  });

  it('keeps the automation of clips an overdub merges, moved with their notes', () => {
    const h = new History(createProject(1));
    const track = () => h.state.tracks[0]!;
    const trackId = track().id;
    const preset = h.state.presets[0]!;
    const target = targetFor(preset, preset.synth);
    const clip = createClip(BAR, BAR, preset.id);
    clip.automation = [{ target, paramId: 'level', points: [point(PPQ, 0.3)] }];
    h.run(placeClips([{ trackId, clip }]));
    const take: RecordedTake = {
      startTick: 0,
      endTick: BAR + PPQ,
      notes: [{ trackId, pitch: 60, velocity: 100, startTick: 0, endTick: PPQ }],
    };
    h.run(recordTake(take, true));
    expect(track().clips).toHaveLength(1);
    expect(track().clips[0]!.startTick).toBe(0);
    expect(track().clips[0]!.automation[0]!.points).toEqual([point(BAR + PPQ, 0.3)]);
  });

  it('lanes link to a box added later by the same id', () => {
    const h = new History(createProject(1));
    const trackId = h.state.tracks[0]!.id;
    const filter = createBox('fx.filter');
    h.run(addBox({ trackId }, filter));
    const preset = h.state.presets[0]!;
    expect(resolveTarget(preset, targetFor(preset, preset.effects[0]!))?.id).toBe(filter.id);
  });
});
