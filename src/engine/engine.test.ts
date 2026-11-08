import { describe, expect, it } from 'vitest';
import { setMasterVolume } from '../model/commands';
import { createProject } from '../model/defaults';
import { History } from '../model/history';
import { Engine } from './engine';
import type { EngineToUi, UiToEngine } from './protocol';

const SAMPLE_RATE = 48_000;
const BLOCK = 128;

/** Renders `seconds` of audio in worklet-sized blocks and returns the left channel. */
function render(engine: Engine, seconds: number): Float32Array {
  const frames = Math.ceil((seconds * SAMPLE_RATE) / BLOCK) * BLOCK;
  const left = new Float32Array(frames);
  const right = new Float32Array(BLOCK);
  for (let offset = 0; offset < frames; offset += BLOCK) {
    engine.process(left.subarray(offset, offset + BLOCK), right);
  }
  return left;
}

const peak = (buffer: Float32Array) => buffer.reduce((max, s) => Math.max(max, Math.abs(s)), 0);

function setup() {
  const messages: EngineToUi[] = [];
  const engine = new Engine(SAMPLE_RATE, (m) => messages.push(m));
  const history = new History(createProject());
  engine.handle({ type: 'loadProject', project: history.state });
  history.subscribe(({ patches }) => engine.handle({ type: 'applyPatches', patches }));
  return { engine, history, messages };
}

const tone = (enabled: boolean): UiToEngine => ({
  type: 'testTone',
  settings: { enabled, frequency: 440, shape: 'square' },
});

describe('Engine', () => {
  it('is silent by default', () => {
    const { engine } = setup();
    expect(peak(render(engine, 0.1))).toBe(0);
  });

  it('plays the test tone within -1..1', () => {
    const { engine } = setup();
    engine.handle(tone(true));
    const out = render(engine, 0.2);
    expect(peak(out)).toBeGreaterThan(0.05);
    expect(peak(out)).toBeLessThanOrEqual(1);
    expect(out.every(Number.isFinite)).toBe(true);
  });

  it('writes the same signal to both channels', () => {
    const { engine } = setup();
    engine.handle(tone(true));
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    for (let i = 0; i < 100; i++) engine.process(left, right);
    expect(right).toEqual(left);
  });

  it('follows master volume patches from the history, including undo', () => {
    const { engine, history } = setup();
    engine.handle(tone(true));
    render(engine, 0.2);
    const loud = peak(render(engine, 0.05));

    history.run(setMasterVolume(0));
    render(engine, 0.2); // let smoothing settle
    expect(peak(render(engine, 0.05))).toBeLessThan(1e-4);

    history.undo();
    render(engine, 0.2);
    expect(peak(render(engine, 0.05))).toBeCloseTo(loud, 3);
  });

  it('fades out to silence when the tone stops', () => {
    const { engine } = setup();
    engine.handle(tone(true));
    render(engine, 0.1);
    engine.handle(tone(false));
    const out = render(engine, 0.1);
    expect(peak(out.subarray(0, 16))).toBeGreaterThan(0); // no hard cut
    expect(peak(out.subarray(out.length - BLOCK))).toBe(0);
  });

  it('reports meters while sound plays and stays quiet when idle', () => {
    const { engine, messages } = setup();
    render(engine, 0.5);
    expect(messages.length).toBeLessThanOrEqual(1);

    engine.handle(tone(true));
    render(engine, 0.5);
    expect(messages.length).toBeGreaterThan(10);
    expect(Math.max(...messages.map((m) => m.master))).toBeGreaterThan(0.05);
  });
});
