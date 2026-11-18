import { describe, expect, it } from 'vitest';
import { createBox } from '../model/boxes/registry';
import { addBox } from '../model/chain-commands';
import { createClip } from '../model/clips';
import { placeClips } from '../model/commands';
import { PPQ } from '../model/constants';
import { createProject } from '../model/defaults';
import { History } from '../model/history';
import { Engine } from './engine';
import { litChanges, NoteLights } from './note-lights';
import type { EngineToUi } from './protocol';
import { renderBlocks, SAMPLE_RATE } from './test-utils';

describe('litChanges', () => {
  it('reports held and struck pitches only when they change', () => {
    const lights = new NoteLights();
    const last = new Uint8Array(128);
    expect(litChanges([lights], last)).toBeNull();
    lights.on(60);
    expect(litChanges([lights], last)).toEqual([60]);
    expect(litChanges([lights], last)).toBeNull();
    lights.off(60);
    expect(litChanges([lights], last)).toEqual([]);
  });

  it('a hit that is over before the report still lights once', () => {
    const lights = new NoteLights();
    const last = new Uint8Array(128);
    lights.on(36);
    lights.off(36);
    expect(litChanges([lights], last)).toEqual([36]);
    expect(litChanges([lights], last)).toEqual([]);
  });

  it('combines chains, and all-notes-off releases everything', () => {
    const a = new NoteLights();
    const b = new NoteLights();
    const last = new Uint8Array(128);
    a.on(60);
    b.on(64);
    b.on(64);
    expect(litChanges([a, b], last)).toEqual([60, 64]);
    b.off(64);
    expect(litChanges([a, b], last)).toBeNull();
    a.release();
    b.release();
    expect(litChanges([a, b], last)).toEqual([]);
  });
});

describe('note reports from the engine', () => {
  function setup() {
    const messages: EngineToUi[] = [];
    const engine = new Engine(SAMPLE_RATE, (m) => messages.push(m));
    const history = new History(createProject());
    engine.handle({ type: 'loadProject', project: history.state });
    history.subscribe(({ patches }) => engine.handle({ type: 'applyPatches', patches }));
    const track = history.state.tracks[0]!;
    const render = (seconds: number) => renderBlocks((l, r) => engine.process(l, r), seconds);
    /** Pitches of the last note report for the track. */
    const lit = () => {
      const reports = messages.flatMap((m) =>
        m.type === 'notes' ? m.tracks.filter((t) => t.trackId === track.id) : [],
      );
      return reports.at(-1)?.pitches;
    };
    return { engine, history, track, render, lit, messages };
  }

  it('reports live notes while held, then their release', () => {
    const { engine, track, render, lit } = setup();
    engine.handle({ type: 'noteOn', trackId: track.id, pitch: 60, velocity: 100 });
    engine.handle({ type: 'noteOn', trackId: track.id, pitch: 67, velocity: 100 });
    render(0.1);
    expect(lit()).toEqual([60, 67]);
    engine.handle({ type: 'noteOff', trackId: track.id, pitch: 60 });
    render(0.1);
    expect(lit()).toEqual([67]);
  });

  it('reports the notes of clips while playing', () => {
    const { engine, history, track, render, lit } = setup();
    history.run(
      placeClips([
        {
          trackId: track.id,
          clip: createClip(0, 4 * PPQ, track.presetId, [
            { id: 'a', tick: 0, durationTicks: PPQ, pitch: 38, velocity: 100 },
          ]),
        },
      ]),
    );
    engine.handle({ type: 'play' });
    render(0.2);
    expect(lit()).toEqual([38]);
    render(0.5); // a beat is 0.5 s at 120 BPM
    expect(lit()).toEqual([]);
  });

  it('reports what the arpeggiator plays, not the chord held into it', () => {
    const { engine, history, track, render, messages } = setup();
    history.run(addBox({ trackId: track.id }, createBox('seq.arp')));
    engine.handle({ type: 'noteOn', trackId: track.id, pitch: 60, velocity: 100 });
    engine.handle({ type: 'noteOn', trackId: track.id, pitch: 64, velocity: 100 });
    render(1);
    const reports = messages.flatMap((m) => (m.type === 'notes' ? m.tracks : []));
    // One note at a time, taking turns.
    expect(reports.every((r) => r.pitches.length <= 1)).toBe(true);
    expect(new Set(reports.flatMap((r) => r.pitches))).toEqual(new Set([60, 64]));
  });

  it('stays quiet when nothing plays', () => {
    const { render, messages } = setup();
    render(0.5);
    expect(messages.filter((m) => m.type === 'notes')).toEqual([]);
  });
});
