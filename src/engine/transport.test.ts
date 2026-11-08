import { describe, expect, it } from 'vitest';
import { createClip } from '../model/clips';
import { placeClips, setTempo, type RecordedTake } from '../model/commands';
import { PPQ } from '../model/constants';
import { createProject } from '../model/defaults';
import { History } from '../model/history';
import type { Note } from '../model/types';
import { Engine } from './engine';
import type { EngineToUi } from './protocol';
import { BLOCK, peak, renderBlocks, SAMPLE_RATE } from './test-utils';

const note = (tick: number, durationTicks = PPQ, pitch = 69): Note => ({
  id: `n${tick}`,
  tick,
  durationTicks,
  pitch,
  velocity: 127,
});

function setup() {
  const messages: EngineToUi[] = [];
  const engine = new Engine(SAMPLE_RATE, (m) => messages.push(m));
  const history = new History(createProject());
  engine.handle({ type: 'loadProject', project: history.state });
  history.subscribe(({ patches }) => engine.handle({ type: 'applyPatches', patches }));
  const trackId = history.state.tracks[0]!.id;
  const render = (seconds: number) => renderBlocks((l, r) => engine.process(l, r), seconds).left;
  return { engine, history, messages, trackId, render };
}

/** Index of the first sample louder than `threshold`, or -1. */
const onset = (buffer: Float32Array, threshold = 0.01) =>
  buffer.findIndex((s) => Math.abs(s) > threshold);

describe('transport', () => {
  it('plays clip notes at their exact sample (120 BPM: a beat is 0.5 s)', () => {
    const { engine, history, trackId, render } = setup();
    history.run(placeClips([{ trackId, clip: createClip(0, 4 * PPQ, [note(PPQ)]) }]));
    engine.handle({ type: 'play' });
    const out = render(1);
    expect(onset(out)).toBeGreaterThanOrEqual(SAMPLE_RATE / 2);
    expect(onset(out)).toBeLessThan(SAMPLE_RATE / 2 + 16); // attack takes a few samples
  });

  it('ends notes after their duration', () => {
    const { engine, history, trackId, render } = setup();
    history.run(placeClips([{ trackId, clip: createClip(0, 8 * PPQ, [note(0, PPQ / 2)]) }]));
    engine.handle({ type: 'play' });
    const out = render(1.5);
    expect(peak(out.subarray(0, SAMPLE_RATE / 4))).toBeGreaterThan(0.05);
    expect(peak(out.subarray(SAMPLE_RATE))).toBe(0); // 0.25 s note + 0.1 s release
  });

  it('follows the tempo', () => {
    const { engine, history, trackId, render } = setup();
    history.run(setTempo(60)); // a beat is now 1 s
    history.run(placeClips([{ trackId, clip: createClip(0, 4 * PPQ, [note(PPQ)]) }]));
    engine.handle({ type: 'play' });
    const at = onset(render(1.5));
    expect(at).toBeGreaterThanOrEqual(SAMPLE_RATE);
    expect(at).toBeLessThan(SAMPLE_RATE + 16);
  });

  it('advances the position only while playing, and pauses in place', () => {
    const { engine, render } = setup();
    render(0.5);
    expect(engine.position).toBe(0);
    engine.handle({ type: 'play' });
    render(0.5);
    const at = engine.position;
    expect(at).toBeCloseTo(PPQ, -1); // 0.5 s at 120 BPM = one beat
    engine.handle({ type: 'pause' });
    render(0.5);
    expect(engine.position).toBe(at);
  });

  it('seeks, skipping notes that started before the new position', () => {
    const { engine, history, trackId, render } = setup();
    history.run(
      placeClips([{ trackId, clip: createClip(0, 8 * PPQ, [note(0, 2 * PPQ), note(4 * PPQ)]) }]),
    );
    engine.handle({ type: 'seek', tick: PPQ });
    engine.handle({ type: 'play' });
    const out = render(2);
    const at = onset(out);
    expect(at).toBeGreaterThanOrEqual((3 * SAMPLE_RATE) / 2); // the note at beat 4 (1.5 s later)
  });

  it('stops clip notes on pause', () => {
    const { engine, history, trackId, render } = setup();
    history.run(placeClips([{ trackId, clip: createClip(0, 16 * PPQ, [note(0, 16 * PPQ)]) }]));
    engine.handle({ type: 'play' });
    render(0.2);
    engine.handle({ type: 'pause' });
    const out = render(0.5);
    expect(peak(out.subarray(out.length - BLOCK))).toBe(0);
  });

  it('picks up clip edits during playback', () => {
    const { engine, history, trackId, render } = setup();
    engine.handle({ type: 'play' });
    const rendered = render(0.25).length; // rounded up to whole blocks
    history.run(placeClips([{ trackId, clip: createClip(0, 4 * PPQ, [note(PPQ)]) }]));
    const at = onset(render(0.5));
    const expected = SAMPLE_RATE / 2 - rendered; // the note is at 0.5 s in song time
    expect(at).toBeGreaterThanOrEqual(expected);
    expect(at).toBeLessThan(expected + 16);
  });

  it('clicks the metronome on every beat while playing', () => {
    const { engine, render } = setup();
    engine.handle({ type: 'setMetronome', enabled: true });
    expect(peak(render(0.3))).toBe(0); // stopped: silent
    engine.handle({ type: 'play' });
    const out = render(1.2);
    for (const beat of [0, 1, 2]) {
      const start = beat * (SAMPLE_RATE / 2);
      expect(peak(out.subarray(start, start + 256)), `beat ${beat}`).toBeGreaterThan(0.1);
      expect(
        peak(out.subarray(start + 0.1 * SAMPLE_RATE, start + 0.45 * SAMPLE_RATE)),
      ).toBeLessThan(0.01);
    }
  });

  it('reports the transport position while playing', () => {
    const { engine, messages, render } = setup();
    engine.handle({ type: 'play' });
    render(0.5);
    const reports = messages.filter((m) => m.type === 'transport');
    expect(reports.length).toBeGreaterThan(10);
    expect(reports.at(-1)).toMatchObject({ playing: true });
  });
});

describe('recording', () => {
  function takes(messages: EngineToUi[]): RecordedTake[] {
    return messages.flatMap((m) => (m.type === 'recorded' ? [m.take] : []));
  }

  it('captures live notes with their ticks while armed and playing', () => {
    const { engine, messages, trackId, render } = setup();
    engine.handle({ type: 'setRecord', armed: true });
    engine.handle({ type: 'play' });
    render(0.25); // 480 ticks
    engine.handle({ type: 'noteOn', trackId, pitch: 60, velocity: 90 });
    render(0.25);
    engine.handle({ type: 'noteOff', trackId, pitch: 60 });
    render(0.25);
    engine.handle({ type: 'pause' });

    const [take] = takes(messages);
    expect(take).toBeDefined();
    expect(take!.startTick).toBe(0);
    expect(take!.endTick).toBeCloseTo((3 * PPQ) / 2, -1);
    const [recorded] = take!.notes;
    expect(recorded).toMatchObject({ trackId, pitch: 60, velocity: 90 });
    expect(recorded!.startTick).toBeCloseTo(PPQ / 2, -1);
    expect(recorded!.endTick).toBeCloseTo(PPQ, -1);
  });

  it('compensates for output latency', () => {
    const { engine, messages, trackId, render } = setup();
    engine.handle({ type: 'setLatency', seconds: 0.05 }); // 96 ticks at 120 BPM
    engine.handle({ type: 'setRecord', armed: true });
    engine.handle({ type: 'play' });
    render(0.5);
    engine.handle({ type: 'noteOn', trackId, pitch: 60, velocity: 90 });
    engine.handle({ type: 'pause' });
    const note = takes(messages)[0]!.notes[0]!;
    expect(note.startTick).toBeCloseTo(PPQ - 96, -1);
  });

  it('ends held notes when recording stops', () => {
    const { engine, messages, trackId, render } = setup();
    engine.handle({ type: 'setRecord', armed: true });
    engine.handle({ type: 'play' });
    engine.handle({ type: 'noteOn', trackId, pitch: 64, velocity: 100 });
    render(0.5);
    engine.handle({ type: 'setRecord', armed: false });
    const note = takes(messages)[0]!.notes[0]!;
    expect(note.endTick).toBeCloseTo(PPQ, -1);
  });

  it('does not record when not armed, or when stopped', () => {
    const { engine, messages, trackId, render } = setup();
    engine.handle({ type: 'play' });
    engine.handle({ type: 'noteOn', trackId, pitch: 60, velocity: 90 });
    render(0.1);
    engine.handle({ type: 'pause' });
    engine.handle({ type: 'setRecord', armed: true });
    engine.handle({ type: 'noteOn', trackId, pitch: 62, velocity: 90 });
    engine.handle({ type: 'noteOff', trackId, pitch: 62 });
    expect(takes(messages)).toEqual([]);
  });
});
