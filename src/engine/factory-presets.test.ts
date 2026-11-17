import { describe, expect, it } from 'vitest';
import { loadTrackPreset } from '../model/chain-commands';
import { createProject } from '../model/defaults';
import { factoryLibrary } from '../model/factory-presets';
import { History } from '../model/history';
import { instantiatePreset } from '../model/library';
import { Engine } from './engine';
import { peak, renderBlocks, SAMPLE_RATE } from './test-utils';

describe('starter presets', () => {
  // Every starter preset, played through the real engine: it must sound, without clipping
  // hard or blowing up.
  for (const entry of factoryLibrary().presets) {
    it(`"${entry.preset.name}" plays a clear, bounded sound`, () => {
      const engine = new Engine(SAMPLE_RATE, () => {});
      const history = new History(createProject(1));
      const trackId = history.state.tracks[0]!.id;
      history.run(loadTrackPreset(trackId, instantiatePreset(entry)));
      engine.handle({ type: 'loadProject', project: history.state });
      renderBlocks((l, r) => engine.process(l, r), 0.1); // master volume fade-in
      engine.handle({ type: 'noteOn', trackId, pitch: 60, velocity: 110 });
      const { left } = renderBlocks((l, r) => engine.process(l, r), 0.4);
      expect(left.every(Number.isFinite)).toBe(true);
      expect(peak(left)).toBeGreaterThan(0.02);
      expect(peak(left)).toBeLessThan(1);
    });
  }
});
