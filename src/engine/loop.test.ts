import { describe, expect, it } from 'vitest';
import { createClip } from '../model/clips';
import { placeClips, recordTake, setLoopRegion, type RecordedTake } from '../model/commands';
import { PPQ } from '../model/constants';
import { createProject } from '../model/defaults';
import { History } from '../model/history';
import type { Note } from '../model/types';
import { Engine } from './engine';
import type { EngineToUi } from './protocol';
import { renderBlocks, SAMPLE_RATE } from './test-utils';

// 120 BPM: a beat (PPQ ticks) is 0.5 s = 24000 samples.
const BEAT_SAMPLES = SAMPLE_RATE / 2;

function setup() {
  const messages: EngineToUi[] = [];
  const engine = new Engine(SAMPLE_RATE, (m) => messages.push(m));
  const history = new History(createProject(1));
  engine.handle({ type: 'loadProject', project: history.state });
  history.subscribe(({ patches }) => engine.handle({ type: 'applyPatches', patches }));
  const trackId = history.state.tracks[0]!.id;
  const render = (seconds: number) => renderBlocks((l, r) => engine.process(l, r), seconds).left;
  const takes = () =>
    messages.flatMap((m) => (m.type === 'recorded' ? [m.take] : ([] as RecordedTake[])));
  render(0.1); // let the master volume fade in
  return { engine, history, messages, trackId, render, takes };
}

/** Sample indices where the signal jumps from silence to clearly audible. */
function onsets(buffer: Float32Array, threshold = 0.05): number[] {
  const found: number[] = [];
  let quiet = true;
  let quietRun = 0;
  for (let i = 0; i < buffer.length; i++) {
    const loud = Math.abs(buffer[i]!) > threshold;
    if (loud && quiet) found.push(i);
    if (loud) {
      quiet = false;
      quietRun = 0;
    } else if (++quietRun > 2400) {
      quiet = true;
    }
  }
  return found;
}

const note = (tick: number): Note => ({
  id: `n${tick}`,
  tick,
  durationTicks: PPQ / 4,
  pitch: 69,
  velocity: 127,
});

describe('loop', () => {
  it('defaults to the first four bars', () => {
    const { history } = setup();
    expect(history.state.loop).toEqual({ startTick: 0, endTick: 16 * PPQ });
  });

  it('jumps from the loop end back to the loop start, on the exact sample', () => {
    const { engine, history, trackId, render } = setup();
    history.run(setLoopRegion(0, 2 * PPQ)); // one second
    const clip = createClip(0, 4 * PPQ, history.state.tracks[0]!.presetId, [
      note(0),
      note(2 * PPQ),
    ]);
    history.run(placeClips([{ trackId, clip }]));
    engine.handle({ type: 'setLoop', enabled: true });
    engine.handle({ type: 'play' });
    const out = render(3.2);
    // The note at the loop start plays every second; the one at beat 3 (outside) never does.
    const starts = onsets(out);
    expect(starts).toHaveLength(4);
    const periods = starts.slice(1).map((s, i) => s - starts[i]!);
    for (const period of periods)
      expect(Math.abs(period - 2 * BEAT_SAMPLES)).toBeLessThanOrEqual(1);
    expect(engine.position).toBeLessThan(2 * PPQ);
  });

  it('plays on past the loop when it is off, or when starting after its end', () => {
    const { engine, history, render } = setup();
    history.run(setLoopRegion(0, PPQ));
    engine.handle({ type: 'play' });
    render(1);
    expect(engine.position).toBeGreaterThan(PPQ);

    engine.handle({ type: 'setLoop', enabled: true });
    render(0.5);
    expect(engine.position).toBeGreaterThan(2 * PPQ); // already past the end: no jump back
  });

  it('handles the shortest loop (a sixteenth, 3000 samples) many times over', () => {
    const { engine, history, render } = setup();
    history.run(setLoopRegion(0, PPQ / 4));
    engine.handle({ type: 'setLoop', enabled: true });
    engine.handle({ type: 'play' });
    render(1);
    expect(engine.position).toBeGreaterThanOrEqual(0);
    expect(engine.position).toBeLessThan(PPQ / 4);
  });

  it('records each time around as its own pass', () => {
    const { engine, history, trackId, render, takes } = setup();
    history.run(setLoopRegion(0, 2 * PPQ));
    engine.handle({ type: 'setLoop', enabled: true });
    engine.handle({ type: 'play' });
    engine.handle({ type: 'setRecord', armed: true });
    render(0.25);
    engine.handle({ type: 'noteOn', trackId, pitch: 60, velocity: 100 });
    render(0.1);
    engine.handle({ type: 'noteOff', trackId, pitch: 60 });
    render(1); // past the loop end: the first pass is sent
    engine.handle({ type: 'noteOn', trackId, pitch: 64, velocity: 100 });
    render(0.1);
    engine.handle({ type: 'noteOff', trackId, pitch: 64 });
    render(0.1);
    engine.handle({ type: 'pause' });

    const [first, second] = takes();
    expect(first).toMatchObject({ startTick: 0, endTick: 2 * PPQ });
    expect(first!.notes.map((n) => n.pitch)).toEqual([60]);
    expect(second!.startTick).toBe(0);
    expect(second!.notes.map((n) => n.pitch)).toEqual([64]);

    // With overdub, the passes layer up into one clip.
    history.run(recordTake(first!, true));
    history.run(recordTake(second!, true));
    const clips = history.state.tracks[0]!.clips;
    expect(clips).toHaveLength(1);
    expect(clips[0]!.notes.map((n) => n.pitch).sort()).toEqual([60, 64]);
  });

  it('ends notes held across the loop end there', () => {
    const { engine, history, trackId, render, takes } = setup();
    history.run(setLoopRegion(0, PPQ));
    engine.handle({ type: 'setLoop', enabled: true });
    engine.handle({ type: 'play' });
    engine.handle({ type: 'setRecord', armed: true });
    render(0.25);
    engine.handle({ type: 'noteOn', trackId, pitch: 60, velocity: 100 });
    render(0.5); // across the loop end
    engine.handle({ type: 'pause' });
    const [first] = takes();
    expect(first!.notes[0]!.endTick).toBe(PPQ);
  });
});

describe('setLoopRegion', () => {
  it('keeps the loop at least a sixteenth long and never before the start', () => {
    const history = new History(createProject(1));
    history.run(setLoopRegion(-100, 4 * PPQ));
    expect(history.state.loop).toEqual({ startTick: 0, endTick: 4 * PPQ });
    history.run(setLoopRegion(4 * PPQ, 4 * PPQ, 'end')); // the start was dragged onto the end
    expect(history.state.loop).toEqual({ startTick: 4 * PPQ - PPQ / 4, endTick: 4 * PPQ });
    history.run(setLoopRegion(2 * PPQ, PPQ, 'start')); // the end was dragged before the start
    expect(history.state.loop).toEqual({ startTick: 2 * PPQ, endTick: 2 * PPQ + PPQ / 4 });
    expect(history.undoLabel).toBe('Move loop');
  });
});
