import {
  DEFAULT_LOOP_BARS,
  DEFAULT_SUBDIVISION,
  PPQ,
  PROJECT_FORMAT_VERSION,
  SUBDIVISIONS,
} from './constants';
import { createId } from './ids';
import type { Project } from './types';

type Json = Record<string, unknown>;
type Migration = (project: Json) => Json;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Format 1 → 2 (Phase 3C, clip presets): presets move out of each track's `segments` into one
 * `presets` list, and tracks and clips point at them by id. A track's preset becomes its first
 * segment's; each clip gets the preset of the segment it starts in (in practice there was only
 * ever one segment per track, so every clip shares its track's preset and sounds as before).
 * Malformed parts are passed through for validation to report.
 */
function presetsByReference(project: Json): Json {
  const presets: Json[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(project.tracks)) return { ...project, presets };
  const tracks = project.tracks.map((track: unknown) => {
    if (!isObject(track)) return track;
    const segments = (Array.isArray(track.segments) ? track.segments : [])
      .filter((s): s is Json => isObject(s) && isObject(s.preset))
      .map((s) => ({
        startTick: typeof s.startTick === 'number' ? s.startTick : 0,
        preset: s.preset as Json,
      }))
      .sort((a, b) => a.startTick - b.startTick);
    const ids = segments.map(({ preset }) => {
      let id = typeof preset.id === 'string' ? preset.id : createId();
      if (seen.has(id)) id = createId();
      seen.add(id);
      presets.push({ ...preset, id });
      return id;
    });
    const presetAt = (tick: unknown) => {
      let id = ids[0];
      segments.forEach((s, i) => {
        if (typeof tick === 'number' && s.startTick <= tick) id = ids[i];
      });
      return id;
    };
    const { segments: _segments, ...rest } = track;
    return {
      ...rest,
      presetId: ids[0],
      clips: Array.isArray(track.clips)
        ? track.clips.map((clip: unknown) =>
            isObject(clip) ? { ...clip, presetId: presetAt(clip.startTick) } : clip,
          )
        : track.clips,
    };
  });
  return { ...project, presets, tracks };
}

/** Format 2 → 3 (loop): adds the loop region, the first four bars of the song's meter. */
function addLoopRegion(project: Json): Json {
  const tempoMap = isObject(project.tempoMap) ? project.tempoMap : {};
  const meter =
    Array.isArray(tempoMap.meters) && isObject(tempoMap.meters[0]) ? tempoMap.meters[0] : {};
  const numerator = typeof meter.numerator === 'number' ? meter.numerator : 4;
  const denominator = typeof meter.denominator === 'number' ? meter.denominator : 4;
  const bar = numerator * ((4 * PPQ) / denominator);
  return { ...project, loop: { startTick: 0, endTick: DEFAULT_LOOP_BARS * bar } };
}

/**
 * Format 3 → 4 (editable subdivisions): a meter's `subdivision` was a note value (16 =
 * sixteenths); it becomes how many parts a beat is divided into (16 in 4/4 → 4; in 6/8 → 2),
 * the nearest allowed value.
 */
function subdivisionsPerBeat(project: Json): Json {
  const tempoMap = isObject(project.tempoMap) ? project.tempoMap : null;
  if (!tempoMap || !Array.isArray(tempoMap.meters)) return project;
  const meters = tempoMap.meters.map((meter: unknown) => {
    if (!isObject(meter)) return meter;
    const noteValue = typeof meter.subdivision === 'number' ? meter.subdivision : 16;
    const denominator = typeof meter.denominator === 'number' ? meter.denominator : 4;
    const parts = noteValue / Math.max(1, denominator);
    const nearest = SUBDIVISIONS.reduce<number>(
      (best, value) => (Math.abs(value - parts) < Math.abs(best - parts) ? value : best),
      DEFAULT_SUBDIVISION,
    );
    return { ...meter, subdivision: nearest };
  });
  return { ...project, tempoMap: { ...tempoMap, meters } };
}

/**
 * `migrations[n]` upgrades a project from format version n to n + 1.
 * When bumping PROJECT_FORMAT_VERSION, add an entry here and a test with an old fixture.
 */
const migrations: Record<number, Migration> = {
  1: presetsByReference,
  2: addLoopRegion,
  3: subdivisionsPerBeat,
};

export class ProjectFormatError extends Error {}

/** Upgrades a parsed project file of any supported version to the current format. */
export function migrateProject(
  raw: unknown,
  table: Record<number, Migration> = migrations,
  targetVersion: number = PROJECT_FORMAT_VERSION,
): Project {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectFormatError('Not a project file.');
  }
  let project = raw as Record<string, unknown>;
  let version = project.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectFormatError('Project file has no valid format version.');
  }
  if (version > targetVersion) {
    throw new ProjectFormatError(
      `Project was saved by a newer version of chip-daw (format ${version}, this build supports ${targetVersion}).`,
    );
  }
  while (version < targetVersion) {
    const migrate = table[version];
    if (!migrate) throw new ProjectFormatError(`No migration from format version ${version}.`);
    project = { ...migrate(project), formatVersion: version + 1 };
    version += 1;
  }
  return project as unknown as Project;
}
