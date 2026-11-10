import { describe, expect, it } from 'vitest';
import { targetFor } from '../model/automation';
import { createBox } from '../model/boxes/registry';
import { createClip } from '../model/clips';
import { placeClips } from '../model/commands';
import { PPQ } from '../model/constants';
import { createPreset, createProject } from '../model/defaults';
import { History } from '../model/history';
import type { AutomationLane, Clip, Note } from '../model/types';
import { buildCurves } from './automation';
import { Engine } from './engine';
import type { EngineToUi } from './protocol';
import { peak, renderBlocks, SAMPLE_RATE } from './test-utils';

// 120 BPM: a beat (PPQ ticks) is 0.5 s = 24000 samples.
const BEAT = SAMPLE_RATE / 2;
const held = (length: number): Note => ({
  id: 'n',
  tick: 0,
  durationTicks: length,
  pitch: 69,
  velocity: 127,
});

function setup() {
  const messages: EngineToUi[] = [];
  const engine = new Engine(SAMPLE_RATE, (m) => messages.push(m));
  const history = new History(createProject(1));
  engine.handle({ type: 'loadProject', project: history.state });
  history.subscribe(({ patches }) => engine.handle({ type: 'applyPatches', patches }));
  const trackId = history.state.tracks[0]!.id;
  const preset = () =>
    history.state.presets.find((p) => p.id === history.state.tracks[0]!.presetId)!;
  /** A lane on the synth's level: silent (step) until `at`, then 0.7. */
  const levelLane = (at: number): AutomationLane => ({
    target: targetFor(preset(), preset().synth),
    paramId: 'level',
    points: [
      { tick: 0, value: 0, curve: 'step' },
      { tick: at, value: 0.7, curve: 'step' },
    ],
  });
  const place = (clip: Clip) => history.run(placeClips([{ trackId, clip }]));
  const render = (seconds: number) => renderBlocks((l, r) => engine.process(l, r), seconds).left;
  render(0.1); // let the master volume fade in
  return { engine, history, messages, trackId, preset, levelLane, place, render };
}

describe('automation playback', () => {
  it('moves a param while the clip plays', () => {
    const { engine, preset, levelLane, place, render } = setup();
    const clip = createClip(0, 4 * PPQ, preset().id, [held(4 * PPQ)]);
    clip.automation = [levelLane(PPQ)];
    place(clip);
    engine.handle({ type: 'play' });
    const out = render(1);
    expect(peak(out.subarray(2400, BEAT - 2400))).toBeLessThan(0.01); // level 0
    expect(peak(out.subarray(BEAT + 2400))).toBeGreaterThan(0.05); // level 0.7
  });

  it('chases: after a seek, the value automated up to there applies', () => {
    const { engine, trackId, preset, levelLane, place, render } = setup();
    const clip = createClip(0, 4 * PPQ, preset().id);
    clip.automation = [levelLane(PPQ)];
    place(clip);
    const audition = () => {
      const presetId = preset().id;
      engine.handle({ type: 'noteOn', trackId, pitch: 69, velocity: 127, record: false, presetId });
      const level = peak(render(0.3).subarray(4800));
      engine.handle({ type: 'noteOff', trackId, pitch: 69 });
      render(0.5);
      return level;
    };
    engine.handle({ type: 'seek', tick: 2 * PPQ }); // after the point: level 0.7
    expect(audition()).toBeGreaterThan(0.05);
    engine.handle({ type: 'seek', tick: PPQ / 2 }); // before it: level 0
    expect(audition()).toBeLessThan(0.01);
  });

  it('holds the last value into later clips with the same preset', () => {
    const { engine, preset, levelLane, place, render } = setup();
    const first = createClip(0, 2 * PPQ, preset().id);
    first.automation = [{ ...levelLane(PPQ), points: [{ tick: 0, value: 0, curve: 'step' }] }];
    place(first);
    place(createClip(2 * PPQ, 2 * PPQ, preset().id, [held(2 * PPQ)]));
    engine.handle({ type: 'play' });
    const out = render(2);
    expect(peak(out.subarray(2 * BEAT))).toBeLessThan(0.01); // still level 0
  });

  it('plays knob moves while recording on the live sound, records them, then lets go', () => {
    const { engine, messages, trackId, preset, render } = setup();
    engine.handle({ type: 'play' });
    engine.handle({ type: 'setRecord', armed: true });
    const target = targetFor(preset(), preset().synth);
    engine.handle({ type: 'paramMove', trackId, target, paramId: 'level', value: 0 });
    engine.handle({ type: 'noteOn', trackId, pitch: 69, velocity: 127 });
    expect(peak(render(0.3).subarray(4800))).toBeLessThan(0.01);
    engine.handle({ type: 'pause' });
    const recorded = messages.find((m) => m.type === 'recorded');
    expect(recorded?.type === 'recorded' && recorded.take.params).toEqual([
      expect.objectContaining({ trackId, paramId: 'level', value: 0 }),
    ]);
    // Recording stopped: the live sound is back to the preset's level.
    expect(peak(render(0.3).subarray(4800))).toBeGreaterThan(0.05);
  });
});

describe('knob moves while recording', () => {
  it('are heard on the clip that is playing, and let go when recording stops', () => {
    const { engine, trackId, preset, place, render } = setup();
    place(createClip(0, 16 * PPQ, preset().id, [held(16 * PPQ)]));
    engine.handle({ type: 'play' });
    engine.handle({ type: 'setRecord', armed: true });
    render(0.2);
    const target = targetFor(preset(), preset().synth);
    engine.handle({ type: 'paramMove', trackId, target, paramId: 'level', value: 0 });
    expect(peak(render(0.3).subarray(4800))).toBeLessThan(0.01); // the clip went quiet
    engine.handle({ type: 'setRecord', armed: false });
    expect(peak(render(0.3).subarray(4800))).toBeGreaterThan(0.05); // back to the preset
  });

  it('made during the count-in become the starting value of the recording', () => {
    const { engine, messages, trackId, preset, render } = setup();
    engine.handle({ type: 'setRecord', armed: true });
    engine.handle({ type: 'play' }); // counts in 4 beats (2 s)
    render(1);
    const target = targetFor(preset(), preset().synth);
    engine.handle({ type: 'paramMove', trackId, target, paramId: 'level', value: 0.2 });
    render(1.5);
    engine.handle({ type: 'pause' });
    const recorded = messages.find((m) => m.type === 'recorded');
    expect(recorded?.type === 'recorded' && recorded.take.params).toEqual([
      expect.objectContaining({ paramId: 'level', value: 0.2, tick: 0 }),
    ]);
  });
});

describe('buildCurves', () => {
  it('skips lanes whose box is not in the preset, and does not ramp across clips', () => {
    const preset = createPreset();
    const delay = createBox('fx.delay');
    const target = targetFor(preset, preset.synth);
    const a = createClip(0, PPQ, preset.id);
    a.automation = [
      { target, paramId: 'level', points: [{ tick: 0, value: 0, curve: 'linear' }] },
      {
        target: { boxId: delay.id, boxType: 'fx.delay', boxIndex: 0 },
        paramId: 'wet',
        points: [{ tick: 0, value: 1, curve: 'linear' }],
      },
    ];
    const b = createClip(2 * PPQ, PPQ, preset.id);
    b.automation = [{ target, paramId: 'level', points: [{ tick: 0, value: 1, curve: 'linear' }] }];
    const curves = buildCurves([b, a], preset);
    expect(curves).toHaveLength(1); // the delay lane is unlinked
    const [curve] = curves;
    expect(curve!.valueAt(-1)).toBeNaN();
    expect(curve!.valueAt(PPQ)).toBe(0); // holds between clips, no ramp to the next clip
    expect(curve!.valueAt(2 * PPQ)).toBe(1);
  });
});
