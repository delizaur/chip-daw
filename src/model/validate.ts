import { ProjectFormatError } from './migrations';
import type { Preset, Project } from './types';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function fail(path: string, expected: string): never {
  throw new ProjectFormatError(`Invalid file: ${path} should be ${expected}.`);
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'a list');
  return value;
}

function requireNumber(value: unknown, path: string): void {
  if (!isNumber(value)) fail(path, 'a number');
}

function requireString(value: unknown, path: string): void {
  if (!isString(value)) fail(path, 'text');
}

function checkBox(value: unknown, path: string): void {
  if (!isObject(value)) fail(path, 'a box');
  requireString(value.id, `${path}.id`);
  requireString(value.type, `${path}.type`);
  if (!isObject(value.params)) fail(`${path}.params`, 'a set of parameters');
  for (const [key, param] of Object.entries(value.params)) {
    requireNumber(param, `${path}.params.${key}`);
  }
  if (value.bypassed !== undefined && typeof value.bypassed !== 'boolean') {
    fail(`${path}.bypassed`, 'true or false');
  }
}

/** Checks the shape of a Preset (its box chain) found at `path`. */
export function checkPreset(value: unknown, path: string): Preset {
  if (!isObject(value)) fail(path, 'a preset');
  requireString(value.id, `${path}.id`);
  requireString(value.name, `${path}.name`);
  checkBox(value.synth, `${path}.synth`);
  requireArray(value.sequencers, `${path}.sequencers`).forEach((b, i) =>
    checkBox(b, `${path}.sequencers[${i}]`),
  );
  requireArray(value.effects, `${path}.effects`).forEach((b, i) =>
    checkBox(b, `${path}.effects[${i}]`),
  );
  return value as unknown as Preset;
}

/**
 * Checks that parsed, migrated JSON has the shape of a Project, so a damaged or foreign file
 * fails with a clear message instead of breaking the app later. Extra fields are allowed.
 */
export function validateProject(value: unknown): Project {
  if (!isObject(value)) fail('the file', 'a project');
  requireNumber(value.formatVersion, 'formatVersion');
  requireString(value.name, 'name');
  requireNumber(value.masterVolume, 'masterVolume');

  if (!isObject(value.tempoMap)) fail('tempoMap', 'a tempo map');
  const tempos = requireArray(value.tempoMap.tempos, 'tempoMap.tempos');
  const meters = requireArray(value.tempoMap.meters, 'tempoMap.meters');
  if (tempos.length === 0) fail('tempoMap.tempos', 'non-empty');
  if (meters.length === 0) fail('tempoMap.meters', 'non-empty');
  tempos.forEach((t, i) => {
    if (!isObject(t) || !isNumber(t.tick) || !isNumber(t.bpm) || t.bpm <= 0) {
      fail(`tempoMap.tempos[${i}]`, 'a tempo');
    }
  });
  meters.forEach((m, i) => {
    if (!isObject(m) || !isNumber(m.tick) || !isNumber(m.numerator) || !isNumber(m.denominator)) {
      fail(`tempoMap.meters[${i}]`, 'a time signature');
    }
  });

  if (!isObject(value.loop)) fail('loop', 'a loop region');
  requireNumber(value.loop.startTick, 'loop.startTick');
  requireNumber(value.loop.endTick, 'loop.endTick');
  const loop = value.loop as { startTick: number; endTick: number };
  if (loop.startTick < 0 || loop.endTick <= loop.startTick) {
    fail('loop', 'a region with its end after its start');
  }

  const presetIds = new Set<string>();
  requireArray(value.presets, 'presets').forEach((preset, p) => {
    const { id } = checkPreset(preset, `presets[${p}]`);
    if (presetIds.has(id)) fail(`presets[${p}].id`, 'unique');
    presetIds.add(id);
  });
  const requirePresetRef = (ref: unknown, path: string) => {
    requireString(ref, path);
    if (!presetIds.has(ref as string)) fail(path, 'the id of a preset in the project');
  };

  const tracks = requireArray(value.tracks, 'tracks');
  if (tracks.length === 0) fail('tracks', 'non-empty');
  tracks.forEach((track, t) => {
    const path = `tracks[${t}]`;
    if (!isObject(track)) fail(path, 'a track');
    requireString(track.id, `${path}.id`);
    requireString(track.name, `${path}.name`);
    requireNumber(track.volume, `${path}.volume`);
    requirePresetRef(track.presetId, `${path}.presetId`);
    requireArray(track.clips, `${path}.clips`).forEach((clip, c) => {
      const cp = `${path}.clips[${c}]`;
      if (!isObject(clip)) fail(cp, 'a clip');
      requireString(clip.id, `${cp}.id`);
      requireNumber(clip.startTick, `${cp}.startTick`);
      requireNumber(clip.lengthTicks, `${cp}.lengthTicks`);
      requirePresetRef(clip.presetId, `${cp}.presetId`);
      requireArray(clip.automation, `${cp}.automation`);
      requireArray(clip.notes, `${cp}.notes`).forEach((note, n) => {
        const np = `${cp}.notes[${n}]`;
        if (!isObject(note)) fail(np, 'a note');
        for (const key of ['tick', 'durationTicks', 'pitch', 'velocity']) {
          requireNumber(note[key], `${np}.${key}`);
        }
      });
    });
  });
  return value as unknown as Project;
}
