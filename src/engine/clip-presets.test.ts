import { describe, expect, it } from 'vitest';
import { makeClipsUnique } from '../model/clip-preset-commands';
import { createClip } from '../model/clips';
import { placeClips, setBoxParam } from '../model/commands';
import { PPQ } from '../model/constants';
import { createPreset, createProject } from '../model/defaults';
import { History } from '../model/history';
import type { Note } from '../model/types';
import type { BlockContext } from './boxes/types';
import { Engine } from './engine';
import { estimateFrequency, peak, renderBlocks, SAMPLE_RATE, BLOCK } from './test-utils';
import { PresetChain } from './track';

const A4 = 69;
const note = (tick: number, durationTicks: number): Note => ({
  id: `n${tick}`,
  tick,
  durationTicks,
  pitch: A4,
  velocity: 127,
});

function setup() {
  const engine = new Engine(SAMPLE_RATE, () => {});
  const history = new History(createProject(1));
  engine.handle({ type: 'loadProject', project: history.state });
  history.subscribe(({ patches }) => engine.handle({ type: 'applyPatches', patches }));
  const trackId = history.state.tracks[0]!.id;
  const track = () => history.state.tracks[0]!;
  const presetOf = (id: string) => history.state.presets.find((p) => p.id === id)!;
  const render = (seconds: number) => renderBlocks((l, r) => engine.process(l, r), seconds).left;
  /** Transposes a preset's synth: the track preset (copy on write) or a clip preset. */
  const transpose = (target: { trackId: string } | { presetId: string }, semitones: number) => {
    const preset = 'presetId' in target ? presetOf(target.presetId) : presetOf(track().presetId);
    history.run(
      setBoxParam({ target, boxId: preset.synth.id }, 'transpose', semitones, 'Transpose'),
    );
  };
  const addClip = (start: number, length: number, notes: Note[] = []) => {
    const clip = createClip(start, length, track().presetId, notes);
    history.run(placeClips([{ trackId, clip }]));
    return clip;
  };
  render(0.1); // let the master volume fade in
  return { engine, history, trackId, track, render, transpose, addClip };
}

describe('clip presets in the engine', () => {
  it('a recorded clip keeps its sound when the track preset changes afterwards', () => {
    const { engine, trackId, render, transpose, addClip } = setup();
    addClip(0, 4 * PPQ, [note(0, 4 * PPQ)]);
    transpose({ trackId }, 12); // the track switches to a copy; the clip keeps the original

    engine.handle({ type: 'play' });
    expect(estimateFrequency(render(0.5).subarray(4800))).toBeCloseTo(440, -1);
    engine.handle({ type: 'pause' });
    render(0.5);

    // Live notes play the (transposed) track preset.
    engine.handle({ type: 'noteOn', trackId, pitch: A4, velocity: 127 });
    expect(estimateFrequency(render(0.4).subarray(4800))).toBeCloseTo(880, -1);
  });

  it('consecutive clips with different presets each play through their own', () => {
    const { engine, history, track, render, transpose, addClip } = setup();
    addClip(0, 2 * PPQ, [note(0, 2 * PPQ)]);
    const second = addClip(2 * PPQ, 2 * PPQ, [note(0, 2 * PPQ)]);
    history.run(makeClipsUnique([second.id]));
    transpose({ presetId: track().clips[1]!.presetId }, 12);

    engine.handle({ type: 'play' });
    const out = render(2); // 120 BPM: each clip lasts 1 s
    expect(estimateFrequency(out.subarray(4800, 43200))).toBeCloseTo(440, -1);
    expect(estimateFrequency(out.subarray(52800, 91200))).toBeCloseTo(880, -1);
  });

  it('piano roll auditions play through the clip preset', () => {
    const { engine, trackId, track, render, transpose, addClip } = setup();
    const clip = addClip(0, 4 * PPQ);
    transpose({ trackId }, 12);
    const presetId = track().clips[0]!.presetId;
    expect(presetId).toBe(clip.presetId);

    engine.handle({ type: 'noteOn', trackId, pitch: A4, velocity: 127, record: false, presetId });
    expect(estimateFrequency(render(0.4).subarray(4800))).toBeCloseTo(440, -1);
    // The note-off reaches the same (clip) chain, so nothing keeps sounding.
    engine.handle({ type: 'noteOff', trackId, pitch: A4 });
    render(1);
    expect(peak(render(0.1))).toBe(0);
  });

  it('overdubbing plays live notes through the clip under the playhead', () => {
    const { engine, trackId, render, transpose, addClip } = setup();
    addClip(0, 8 * PPQ); // an empty clip: only the live note sounds
    transpose({ trackId }, 12);
    engine.handle({ type: 'setRecord', armed: true });
    engine.handle({ type: 'play' });
    render(0.2);

    engine.handle({ type: 'setOverdub', enabled: true });
    engine.handle({ type: 'noteOn', trackId, pitch: A4, velocity: 127 });
    expect(estimateFrequency(render(0.4).subarray(4800))).toBeCloseTo(440, -1);
    engine.handle({ type: 'noteOff', trackId, pitch: A4 });
    render(0.5);

    // Without overdub, a new recording uses the track preset, and that's what you hear.
    engine.handle({ type: 'setOverdub', enabled: false });
    engine.handle({ type: 'noteOn', trackId, pitch: A4, velocity: 127 });
    expect(estimateFrequency(render(0.4).subarray(4800))).toBeCloseTo(880, -1);
  });

  it('a held live note keeps sounding when an edit makes the track switch to a copy', () => {
    const { engine, trackId, render, transpose, addClip } = setup();
    addClip(4 * PPQ, 4 * PPQ);
    engine.handle({ type: 'noteOn', trackId, pitch: A4, velocity: 127 });
    render(0.2);
    transpose({ trackId }, 12); // copy on write: same box ids, so the runtime is kept
    expect(peak(render(0.2))).toBeGreaterThan(0.05);
  });
});

describe('PresetChain', () => {
  const context: BlockContext = {
    bpm: 120,
    clockTick: 0,
    ticksPerSample: (2 * PPQ) / SAMPLE_RATE,
    playing: false,
  };

  function renderChain(chain: PresetChain, seconds: number): Float32Array {
    return renderBlocks((left, right) => {
      chain.process(left, right, BLOCK, context);
      chain.input.clear();
    }, seconds).left;
  }

  it('sleeps after a few silent seconds and wakes on the next note', () => {
    const chain = new PresetChain(SAMPLE_RATE);
    chain.sync(createPreset());
    renderChain(chain, 1);
    expect(chain.asleep).toBe(false);
    renderChain(chain, 5);
    expect(chain.asleep).toBe(true);

    chain.input.add(0, true, A4, 127);
    const left = new Float32Array(BLOCK);
    chain.process(left, new Float32Array(BLOCK), BLOCK, context);
    chain.input.clear();
    expect(chain.asleep).toBe(false);
    expect(peak(renderChain(chain, 0.2))).toBeGreaterThan(0.05);
  });

  it('never sleeps while a note is held', () => {
    const chain = new PresetChain(SAMPLE_RATE);
    const preset = createPreset();
    preset.synth.params.sustain = 0; // silent while held
    chain.sync(preset);
    chain.noteOn(A4, 127);
    renderChain(chain, 6);
    expect(chain.asleep).toBe(false);
  });
});
