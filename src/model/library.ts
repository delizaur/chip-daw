/**
 * The preset library: presets organised in folders, stored in the browser (not in projects).
 * All functions are pure: they return a new Library and never modify the one passed in.
 *
 * Presets in the library and on tracks are independent copies. Loading a library preset onto
 * a track copies it with fresh ids (`instantiatePreset`); saving a track's preset to the
 * library copies it the other way.
 */
import { createId } from './ids';
import { ProjectFormatError } from './migrations';
import type { BoxInstance, Preset } from './types';
import { checkPreset } from './validate';

export const LIBRARY_FORMAT_VERSION = 1;

export interface LibraryFolder {
  id: string;
  name: string;
}

export interface LibraryPreset {
  /** The folder it's in, or null for the top level. */
  folderId: string | null;
  preset: Preset;
}

export interface Library {
  formatVersion: number;
  folders: LibraryFolder[];
  presets: LibraryPreset[];
  /**
   * Names of the starter presets this library has been given, so newer starter presets (a new
   * synth's) can be added once, and ones the user deleted don't come back. Absent in libraries
   * from before it existed.
   */
  starters?: string[];
}

export function emptyLibrary(): Library {
  return { formatVersion: LIBRARY_FORMAT_VERSION, folders: [], presets: [] };
}

const cleanName = (name: string, fallback: string) => name.trim() || fallback;

function copyBox(box: BoxInstance): BoxInstance {
  const copy: BoxInstance = { id: createId(), type: box.type, params: { ...box.params } };
  if (box.bypassed) copy.bypassed = true;
  return copy;
}

/** Deep copy of a preset with fresh ids for it and every box. */
export function copyPreset(preset: Preset, overrides: Partial<Preset> = {}): Preset {
  const copy: Preset = {
    id: createId(),
    name: preset.name,
    sequencers: preset.sequencers.map(copyBox),
    synth: copyBox(preset.synth),
    effects: preset.effects.map(copyBox),
    ...overrides,
  };
  if (copy.libraryOrigin === undefined) delete copy.libraryOrigin;
  return copy;
}

/** A copy of a library preset to put on a track, remembering where it came from. */
export function instantiatePreset(entry: LibraryPreset): Preset {
  return copyPreset(entry.preset, { libraryOrigin: entry.preset.id });
}

export function findPreset(library: Library, presetId: string): LibraryPreset | undefined {
  return library.presets.find((p) => p.preset.id === presetId);
}

/** Library presets sorted by name, in one folder (null = top level). */
export function presetsIn(library: Library, folderId: string | null): LibraryPreset[] {
  return library.presets
    .filter((p) => p.folderId === folderId)
    .sort((a, b) => a.preset.name.localeCompare(b.preset.name));
}

export function sortedFolders(library: Library): LibraryFolder[] {
  return [...library.folders].sort((a, b) => a.name.localeCompare(b.name));
}

// --- Folders ------------------------------------------------------------------------------

export function addFolder(
  library: Library,
  name: string,
): { library: Library; folder: LibraryFolder } {
  const folder = { id: createId(), name: cleanName(name, 'New folder') };
  return { library: { ...library, folders: [...library.folders, folder] }, folder };
}

export function renameFolder(library: Library, folderId: string, name: string): Library {
  return {
    ...library,
    folders: library.folders.map((f) =>
      f.id === folderId ? { ...f, name: cleanName(name, f.name) } : f,
    ),
  };
}

/** Deletes a folder. Its presets aren't lost: they move to the top level. */
export function deleteFolder(library: Library, folderId: string): Library {
  return {
    ...library,
    folders: library.folders.filter((f) => f.id !== folderId),
    presets: library.presets.map((p) => (p.folderId === folderId ? { ...p, folderId: null } : p)),
  };
}

// --- Presets ------------------------------------------------------------------------------

/** Adds a copy of `preset` (fresh ids) to a folder. Returns the new entry. */
export function addPreset(
  library: Library,
  preset: Preset,
  folderId: string | null,
  name = preset.name,
): { library: Library; entry: LibraryPreset } {
  const folder = folderId && library.folders.some((f) => f.id === folderId) ? folderId : null;
  const entry: LibraryPreset = {
    folderId: folder,
    preset: copyPreset(preset, { name: cleanName(name, 'Preset'), libraryOrigin: undefined }),
  };
  return { library: { ...library, presets: [...library.presets, entry] }, entry };
}

export function duplicatePreset(library: Library, presetId: string) {
  const entry = findPreset(library, presetId);
  if (!entry) throw new Error(`Preset ${presetId} not found`);
  return addPreset(library, entry.preset, entry.folderId, `${entry.preset.name} copy`);
}

function updatePreset(
  library: Library,
  presetId: string,
  change: (entry: LibraryPreset) => LibraryPreset,
) {
  return {
    ...library,
    presets: library.presets.map((p) => (p.preset.id === presetId ? change(p) : p)),
  };
}

export function renamePreset(library: Library, presetId: string, name: string): Library {
  return updatePreset(library, presetId, (p) => ({
    ...p,
    preset: { ...p.preset, name: cleanName(name, p.preset.name) },
  }));
}

export function movePreset(library: Library, presetId: string, folderId: string | null): Library {
  const folder = folderId && library.folders.some((f) => f.id === folderId) ? folderId : null;
  return updatePreset(library, presetId, (p) => ({ ...p, folderId: folder }));
}

export function deletePreset(library: Library, presetId: string): Library {
  return { ...library, presets: library.presets.filter((p) => p.preset.id !== presetId) };
}

// --- Storage and files ----------------------------------------------------------------------

/** Checks a stored library's shape (a damaged one fails with a readable message). */
export function validateLibrary(value: unknown): Library {
  const fail = (what: string) => {
    throw new ProjectFormatError(`Invalid preset library: ${what}.`);
  };
  if (typeof value !== 'object' || value === null) fail('not a library');
  const library = value as Record<string, unknown>;
  if (library.formatVersion !== LIBRARY_FORMAT_VERSION) fail('unknown format version');
  if (!Array.isArray(library.folders) || !Array.isArray(library.presets)) fail('missing lists');
  for (const folder of library.folders as unknown[]) {
    const f = folder as Record<string, unknown>;
    if (typeof f?.id !== 'string' || typeof f.name !== 'string') fail('a folder is damaged');
  }
  (library.presets as unknown[]).forEach((entry, i) => {
    const e = entry as Record<string, unknown>;
    if (typeof e !== 'object' || e === null) fail(`preset ${i} is damaged`);
    if (e.folderId !== null && typeof e.folderId !== 'string') fail(`preset ${i} has a bad folder`);
    checkPreset(e.preset, `presets[${i}].preset`);
  });
  if (
    library.starters !== undefined &&
    (!Array.isArray(library.starters) || library.starters.some((n) => typeof n !== 'string'))
  ) {
    fail('the starter list is damaged');
  }
  return value as Library;
}

/**
 * Adds the starter presets of `factory` that this library hasn't been given yet, each into the
 * folder of the same name (created if missing), and records them as given. Returns the same
 * library when there's nothing new. A library from before `starters` existed counts only the
 * starter presets it still holds as given.
 */
export function addNewStarters(library: Library, factory: Library): Library {
  const given = new Set(library.starters ?? library.presets.map((p) => p.preset.name));
  const all = factory.presets.map((p) => p.preset.name);
  const fresh = factory.presets.filter((p) => !given.has(p.preset.name));
  if (fresh.length === 0) {
    return library.starters && all.every((name) => given.has(name))
      ? library
      : { ...library, starters: [...new Set([...given, ...all])] };
  }
  const folders = [...library.folders];
  const presets = [...library.presets];
  for (const entry of fresh) {
    const folderName = factory.folders.find((f) => f.id === entry.folderId)?.name;
    let folderId: string | null = null;
    if (folderName) {
      let folder = folders.find((f) => f.name === folderName);
      if (!folder) {
        folder = { id: createId(), name: folderName };
        folders.push(folder);
      }
      folderId = folder.id;
    }
    presets.push({ folderId, preset: entry.preset });
  }
  return { ...library, folders, presets, starters: [...new Set([...given, ...all])] };
}

export const PRESET_EXTENSION = '.chippreset';
const PRESET_FILE_TAG = 'chip-daw-preset';

/** A .chippreset file: one preset with a small header. */
export function serializePresetFile(preset: Preset): string {
  const { libraryOrigin: _origin, ...plain } = preset;
  return JSON.stringify({ format: PRESET_FILE_TAG, formatVersion: 1, preset: plain });
}

export function parsePresetFile(text: string): Preset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('This file is not a chip-daw preset (it is not valid JSON).');
  }
  const file = raw as Record<string, unknown>;
  if (file?.format !== PRESET_FILE_TAG) {
    throw new ProjectFormatError('This file is not a chip-daw preset.');
  }
  if (file.formatVersion !== 1) {
    throw new ProjectFormatError('This preset was saved by a newer version of chip-daw.');
  }
  return checkPreset(file.preset, 'preset');
}

/** "Bass.chippreset" → "Bass". */
export function presetNameFromFile(fileName: string): string {
  return fileName.replace(/\.chippreset$/i, '').trim() || 'Preset';
}

export function presetFileName(preset: Preset): string {
  const base = preset.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Preset';
  return `${base}${PRESET_EXTENSION}`;
}
