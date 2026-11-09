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

  it('gives every track its own track preset, in the project preset list', () => {
    const project = createProject();
    expect(project.presets).toHaveLength(project.tracks.length);
    project.tracks.forEach((track, i) => expect(track.presetId).toBe(project.presets[i]!.id));
  });

  it('uses unique ids', () => {
    const project = createProject();
    const ids = [
      ...project.tracks.map((t) => t.id),
      ...project.presets.flatMap((p) => [p.id, p.synth.id]),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is stamped with the current format version and starts tempo/meter maps at 0', () => {
    const project = createProject();
    expect(project.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(project.tempoMap.tempos[0]?.tick).toBe(0);
    expect(project.tempoMap.meters[0]?.tick).toBe(0);
  });
});
