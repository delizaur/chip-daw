import { describe, expect, it } from 'vitest';
import { createClip } from '../model/clips';
import { placeClips } from '../model/commands';
import { PPQ } from '../model/constants';
import { createProject } from '../model/defaults';
import { History } from '../model/history';
import { COUNT_IN_BEATS, Engine } from './engine';
import type { EngineToUi } from './protocol';
import { peak, renderBlocks, SAMPLE_RATE } from './test-utils';

// 120 BPM, 4/4: a beat is 0.5 s, so the count-in lasts 2 s.
const BEAT_SAMPLES = SAMPLE_RATE / 2;
const COUNT_IN_SAMPLES = COUNT_IN_BEATS * BEAT_SAMPLES;

function setup() {
  const messages: EngineToUi[] = [];
  const engine = new Engine(SAMPLE_RATE, (m) => messages.push(m));
  const history = new History(createProject(1));
  engine.handle({ type: 'loadProject', project: history.state });
  history.subscribe(({ patches }) => engine.handle({ type: 'applyPatches', patches }));
  const trackId = history.state.tracks[0]!.id;
  const render = (seconds: number) => renderBlocks((l, r) => engine.process(l, r), seconds).left;
  const transports = () => messages.filter((m) => m.type === 'transport');
  render(0.1); // let the master volume fade in
  return { engine, history, messages, trackId, render, transports };
}

/** Index of the first sample louder than `threshold` from `from` on, or -1. */
const onsetFrom = (buffer: Float32Array, from: number, threshold = 0.05) => {
  for (let i = from; i < buffer.length; i++) if (Math.abs(buffer[i]!) > threshold) return i;
  return -1;
};

describe('count-in', () => {
  it('counts in 4 beats (with clicks) before playing and recording', () => {
    const { engine, messages, render, transports } = setup();
    engine.handle({ type: 'setRecord', armed: true });
    engine.handle({ type: 'play' });
    expect(transports().at(-1)).toMatchObject({ playing: false, countIn: 4, tick: 0 });

    const out = render(1.9);
    // A click on every count-in beat, even with the metronome off.
    for (let beat = 0; beat < COUNT_IN_BEATS; beat++) {
      const at = beat * BEAT_SAMPLES;
      expect(peak(out.subarray(at, at + 480))).toBeGreaterThan(0.1);
    }
    expect(engine.playing).toBe(false);
    expect(engine.position).toBe(0);
    expect(transports().some((m) => m.type === 'transport' && m.countIn === 2)).toBe(true);
    expect(messages.some((m) => m.type === 'takeStarted')).toBe(false);

    render(0.2);
    expect(engine.playing).toBe(true);
    expect(messages.some((m) => m.type === 'takeStarted' && m.startTick === 0)).toBe(true);
    expect(transports().at(-1)).toMatchObject({ playing: true, countIn: 0 });
  });

  it('starts the song at the exact sample where the count-in ends', () => {
    /** Sample (from pressing play) where a note at tick 0 becomes audible. */
    const noteOnset = (record: boolean) => {
      const { engine, history, trackId, render } = setup();
      const note = { id: 'n', tick: 0, durationTicks: PPQ, pitch: 69, velocity: 127 };
      const clip = createClip(0, 4 * PPQ, history.state.tracks[0]!.presetId, [note]);
      history.run(placeClips([{ trackId, clip }]));
      engine.handle({ type: 'setRecord', armed: record });
      engine.handle({ type: 'play' });
      // After a count-in, skip its clicks (the last one, at 1.5 s, has died away by 1.7 s).
      return onsetFrom(render(2.5), record ? Math.round(1.7 * SAMPLE_RATE) : 0);
    };
    // The synth's attack takes a few samples to cross the threshold either way.
    expect(noteOnset(true) - noteOnset(false)).toBe(COUNT_IN_SAMPLES);
  });

  it('pause cancels the count-in', () => {
    const { engine, render, transports } = setup();
    engine.handle({ type: 'setRecord', armed: true });
    engine.handle({ type: 'play' });
    render(1);
    engine.handle({ type: 'pause' });
    expect(transports().at(-1)).toMatchObject({ playing: false, countIn: 0 });
    render(2);
    expect(engine.playing).toBe(false);
    expect(engine.position).toBe(0);
  });

  it('echoes the last seek in transport reports (so the UI can ignore stale positions)', () => {
    const { engine, transports } = setup();
    engine.handle({ type: 'seek', tick: PPQ, seq: 7 });
    engine.handle({ type: 'play' });
    expect(transports().at(-1)).toMatchObject({ tick: PPQ, seekSeq: 7, playing: true });
  });

  it('plays without a count-in when not recording', () => {
    const { engine, render } = setup();
    engine.handle({ type: 'play' });
    render(0.1);
    expect(engine.playing).toBe(true);
    expect(engine.position).toBeGreaterThan(0);
  });

  it('records a note hit just before the downbeat at the start; earlier notes are not recorded', () => {
    const { engine, messages, trackId, render } = setup();
    engine.handle({ type: 'setRecord', armed: true });
    engine.handle({ type: 'play' });
    render(1);
    // Mid count-in: heard, but not recorded.
    engine.handle({ type: 'noteOn', trackId, pitch: 60, velocity: 100 });
    render(0.1);
    engine.handle({ type: 'noteOff', trackId, pitch: 60 });
    // Just before the downbeat (within a sixteenth = 0.125 s): an early hit, held into the take.
    render(0.85);
    engine.handle({ type: 'noteOn', trackId, pitch: 64, velocity: 90 });
    render(0.5);
    engine.handle({ type: 'noteOff', trackId, pitch: 64 });
    render(0.1);
    engine.handle({ type: 'pause' });

    const take = messages.find((m) => m.type === 'recorded');
    expect(take?.type === 'recorded' && take.take.notes).toEqual([
      expect.objectContaining({ pitch: 64, velocity: 90, startTick: 0 }),
    ]);
  });
});
