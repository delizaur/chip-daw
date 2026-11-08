import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_COUNT, PROJECT_FORMAT_VERSION } from './constants';
import { createProject } from './defaults';

describe('createProject', () => {
  it('creates DEFAULT_TRACK_COUNT tracks by default', () => {
    expect(createProject().tracks).toHaveLength(DEFAULT_TRACK_COUNT);
  });

  it('supports other track counts', () => {
    expect(createProject(3).tracks).toHaveLength(3);
    expect(createProject(12).tracks).toHaveLength(12);
  });

  it('gives every track one segment starting at tick 0', () => {
    for (const track of createProject().tracks) {
      expect(track.segments).toHaveLength(1);
      expect(track.segments[0]?.startTick).toBe(0);
    }
  });

  it('uses unique ids', () => {
    const project = createProject();
    const ids = project.tracks.flatMap((t) => [
      t.id,
      ...t.segments.flatMap((s) => [s.id, s.preset.id, s.preset.synth.id]),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is stamped with the current format version and starts tempo/meter maps at 0', () => {
    const project = createProject();
    expect(project.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(project.tempoMap.tempos[0]?.tick).toBe(0);
    expect(project.tempoMap.meters[0]?.tick).toBe(0);
  });
});
