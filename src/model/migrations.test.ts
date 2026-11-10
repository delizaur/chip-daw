import { describe, expect, it } from 'vitest';
import { PPQ } from './constants';
import { createProject } from './defaults';
import { migrateProject, ProjectFormatError } from './migrations';

describe('migrateProject', () => {
  it('returns current-version projects unchanged', () => {
    const project = createProject();
    expect(migrateProject(structuredClone(project))).toEqual(project);
  });

  it('rejects non-projects and missing versions', () => {
    expect(() => migrateProject(null)).toThrow(ProjectFormatError);
    expect(() => migrateProject('nope')).toThrow(ProjectFormatError);
    expect(() => migrateProject({ name: 'x' })).toThrow(ProjectFormatError);
  });

  it('rejects projects from a newer build', () => {
    expect(() => migrateProject({ formatVersion: 999 })).toThrow(/newer version/);
  });

  it('applies migrations in order up to the target version', () => {
    const table = {
      1: (p: Record<string, unknown>) => ({ ...p, a: 'added in v2' }),
      2: (p: Record<string, unknown>) => ({ ...p, b: `${String(p.a)}, then v3` }),
    };
    const result = migrateProject({ formatVersion: 1 }, table, 3) as unknown as Record<
      string,
      unknown
    >;
    expect(result).toEqual({ formatVersion: 3, a: 'added in v2', b: 'added in v2, then v3' });
  });

  it('format 2 → 3 adds a loop over the first four bars of the meter', () => {
    const { loop: _loop, ...v2 } = { ...createProject(), formatVersion: 2 };
    expect(migrateProject(v2).loop).toEqual({ startTick: 0, endTick: 16 * PPQ });
    const waltz = {
      ...v2,
      tempoMap: {
        ...v2.tempoMap,
        meters: [{ tick: 0, numerator: 3, denominator: 4, subdivision: 16 }],
      },
    };
    expect(migrateProject(waltz).loop).toEqual({ startTick: 0, endTick: 12 * PPQ });
  });

  it('fails clearly when a migration step is missing', () => {
    expect(() => migrateProject({ formatVersion: 1 }, {}, 2)).toThrow(/No migration/);
  });
});
