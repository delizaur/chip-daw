import { describe, expect, it } from 'vitest';
import {
  setBoxParam,
  setMasterVolume,
  setTrackMute,
  setTrackSolo,
  setTrackVolume,
} from '../model/commands';
import { ChipWave } from '../model/boxes/chip-synth';
import { createProject } from '../model/defaults';
import { History } from '../model/history';
import { Engine } from './engine';
import type { EngineToUi } from './protocol';
import { estimateFrequency, peak, renderBlocks, SAMPLE_RATE } from './test-utils';

function setup() {
  const messages: EngineToUi[] = [];
  const engine = new Engine(SAMPLE_RATE, (m) => messages.push(m));
  const history = new History(createProject());
  engine.handle({ type: 'loadProject', project: history.state });
  history.subscribe(({ patches }) => engine.handle({ type: 'applyPatches', patches }));
  const trackId = (i: number) => history.state.tracks[i]!.id;
  const noteOn = (track: number, pitch = 69, velocity = 127) =>
    engine.handle({ type: 'noteOn', trackId: trackId(track), pitch, velocity });
  const noteOff = (track: number, pitch = 69) =>
    engine.handle({ type: 'noteOff', trackId: trackId(track), pitch });
  const render = (seconds: number) => renderBlocks((l, r) => engine.process(l, r), seconds);
  return { engine, history, messages, trackId, noteOn, noteOff, render };
}

describe('Engine', () => {
  it('is silent without notes', () => {
    const { render } = setup();
    expect(peak(render(0.1).left)).toBe(0);
  });

  it('plays live notes on a track, within -1..1', () => {
    const { noteOn, render } = setup();
    noteOn(0);
    const { left, right } = render(0.3);
    expect(peak(left)).toBeGreaterThan(0.05);
    expect(peak(left)).toBeLessThanOrEqual(1);
    expect(right).toEqual(left);
    expect(estimateFrequency(left.subarray(4800))).toBeCloseTo(440, -1);
  });

  it('releases notes on note-off', () => {
    const { noteOn, noteOff, render } = setup();
    noteOn(0);
    render(0.1);
    noteOff(0);
    const { left } = render(1);
    expect(peak(left.subarray(left.length - 1024))).toBe(0);
  });

  it('allNotesOff silences every track', () => {
    const { engine, noteOn, render } = setup();
    noteOn(0, 60);
    noteOn(3, 64);
    render(0.1);
    engine.handle({ type: 'allNotesOff' });
    const { left } = render(1);
    expect(peak(left.subarray(left.length - 1024))).toBe(0);
  });

  it('applies synth param changes from the history, including undo', () => {
    const { history, noteOn, render } = setup();
    const track = history.state.tracks[0]!;
    const segment = track.segments[0]!;
    const address = { trackId: track.id, segmentId: segment.id, boxId: segment.preset.synth.id };

    history.run(setBoxParam(address, 'transpose', 12));
    noteOn(0, 57);
    expect(estimateFrequency(render(0.4).left.subarray(4800))).toBeCloseTo(440, -1);

    history.run(setBoxParam(address, 'wave', ChipWave.Triangle));
    history.undo(); // back to pulse, still transposed
    history.undo(); // transpose 0: the held A3 now plays at 220 Hz
    expect(estimateFrequency(render(0.4).left.subarray(4800))).toBeCloseTo(220, -1);
  });

  it('follows track volume, mute and solo', () => {
    const { history, noteOn, trackId, render } = setup();
    noteOn(0);
    noteOn(1, 64);
    render(0.1);
    const both = peak(render(0.1).left);

    history.run(setTrackMute(trackId(0), true));
    history.run(setTrackMute(trackId(1), true));
    render(0.5);
    expect(peak(render(0.1).left)).toBe(0);

    history.run(setTrackMute(trackId(0), false));
    history.run(setTrackMute(trackId(1), false));
    history.run(setTrackSolo(trackId(1), true));
    render(0.1);
    const solo = peak(render(0.1).left);
    expect(solo).toBeGreaterThan(0);
    expect(solo).toBeLessThan(both);

    history.run(setTrackSolo(trackId(1), false));
    history.run(setTrackVolume(trackId(0), 0));
    history.run(setTrackVolume(trackId(1), 0));
    render(0.5);
    expect(peak(render(0.1).left)).toBe(0);
  });

  it('follows master volume', () => {
    const { history, noteOn, render } = setup();
    noteOn(0);
    render(0.1);
    history.run(setMasterVolume(0));
    render(0.5);
    expect(peak(render(0.1).left)).toBe(0);
  });

  it('ignores notes for unknown tracks', () => {
    const { engine, render } = setup();
    engine.handle({ type: 'noteOn', trackId: 'missing', pitch: 60, velocity: 100 });
    expect(peak(render(0.1).left)).toBe(0);
  });

  it('reports meters while sound plays and stays quiet when idle', () => {
    const { messages, noteOn, render } = setup();
    render(0.5);
    expect(messages.length).toBeLessThanOrEqual(1);
    noteOn(0);
    render(0.5);
    const meters = messages.flatMap((m) => (m.type === 'meters' ? [m.master] : []));
    expect(meters.length).toBeGreaterThan(10);
    expect(Math.max(...meters)).toBeGreaterThan(0.05);
  });
});
