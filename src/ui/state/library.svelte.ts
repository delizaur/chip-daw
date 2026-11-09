import { loadPreset } from '../../model/chain-commands';
import { factoryLibrary } from '../../model/factory-presets';
import {
  addFolder,
  addPreset,
  deleteFolder,
  deletePreset,
  duplicatePreset,
  emptyLibrary,
  findPreset,
  instantiatePreset,
  movePreset,
  parsePresetFile,
  presetFileName,
  presetNameFromFile,
  renameFolder,
  renamePreset,
  serializePresetFile,
  validateLibrary,
  type Library,
} from '../../model/library';
import type { Preset } from '../../model/types';
import { openTextFile, PRESET_FILE, saveFile } from '../../persistence/files';
import { readStored, writeStored } from '../../persistence/storage';
import { session } from './session.svelte';

const STORAGE_KEY = 'library';

export type LibrarySelection = { kind: 'preset' | 'folder'; id: string } | null;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The preset library as UI state: loaded from browser storage on startup (seeded with the
 * starter presets the first time) and saved after every change. Library edits aren't part of
 * the project's undo history; deleting asks first.
 */
class LibraryStore {
  library = $state.raw<Library>(emptyLibrary());
  selection = $state.raw<LibrarySelection>(null);
  /** Folder ids shown open. */
  expanded = $state.raw<ReadonlySet<string>>(new Set());
  /** Id of the folder or preset being renamed inline. */
  renaming = $state<string | null>(null);
  /** False when the stored library couldn't be read: never overwrite it then. */
  #canSave = true;

  async load(): Promise<void> {
    try {
      const stored = await readStored(STORAGE_KEY);
      if (typeof stored === 'string') {
        this.library = validateLibrary(JSON.parse(stored));
      } else {
        this.#commit(factoryLibrary());
      }
    } catch (error) {
      this.#canSave = false;
      session.showNotice(`Couldn't open the preset library: ${errorText(error)}`, 'error');
    }
  }

  #commit(next: Library): void {
    this.library = next;
    if (!this.#canSave) return;
    writeStored(STORAGE_KEY, JSON.stringify(next)).catch((error) =>
      console.warn('Saving the preset library failed:', error),
    );
  }

  /** The folder new presets go into: the selected folder, or the selected preset's folder. */
  get targetFolderId(): string | null {
    const selection = this.selection;
    if (selection?.kind === 'folder') return selection.id;
    if (selection?.kind === 'preset')
      return findPreset(this.library, selection.id)?.folderId ?? null;
    return null;
  }

  select(selection: LibrarySelection): void {
    this.selection = selection;
    if (this.renaming && this.renaming !== selection?.id) this.renaming = null;
  }

  toggleFolder(folderId: string): void {
    const open = [...this.expanded];
    this.expanded = new Set(
      open.includes(folderId) ? open.filter((id) => id !== folderId) : [...open, folderId],
    );
  }

  #reveal(folderId: string | null): void {
    if (folderId && !this.expanded.has(folderId))
      this.expanded = new Set([...this.expanded, folderId]);
  }

  // --- Folders ----------------------------------------------------------------------------

  newFolder(): void {
    const { library, folder } = addFolder(this.library, 'New folder');
    this.#commit(library);
    this.select({ kind: 'folder', id: folder.id });
    this.renaming = folder.id;
  }

  renameFolder(folderId: string, name: string): void {
    this.#commit(renameFolder(this.library, folderId, name));
    this.renaming = null;
  }

  deleteFolder(folderId: string): void {
    this.#commit(deleteFolder(this.library, folderId));
    this.select(null);
  }

  // --- Presets ------------------------------------------------------------------------------

  #add(preset: Preset, name?: string): void {
    const folderId = this.targetFolderId;
    const { library, entry } = addPreset(this.library, preset, folderId, name);
    this.#commit(library);
    this.#reveal(entry.folderId);
    this.select({ kind: 'preset', id: entry.preset.id });
  }

  /** Saves a copy of the selected track's preset into the library. */
  saveTrackPreset(): void {
    const track = session.selectedTrack;
    const preset = track?.segments[0]?.preset;
    if (!track || !preset) return;
    this.#add(preset);
    session.showNotice(`Saved "${preset.name}" to the library`);
  }

  /** Loads a copy of a library preset onto the selected track (undoable). */
  loadToTrack(presetId: string): void {
    const entry = findPreset(this.library, presetId);
    const track = session.selectedTrack;
    const segment = track?.segments[0];
    if (!entry || !track || !segment) return;
    session.run(loadPreset({ trackId: track.id, segmentId: segment.id }, instantiatePreset(entry)));
  }

  renamePreset(presetId: string, name: string): void {
    this.#commit(renamePreset(this.library, presetId, name));
    this.renaming = null;
  }

  duplicatePreset(presetId: string): void {
    const { library, entry } = duplicatePreset(this.library, presetId);
    this.#commit(library);
    this.select({ kind: 'preset', id: entry.preset.id });
  }

  movePreset(presetId: string, folderId: string | null): void {
    this.#commit(movePreset(this.library, presetId, folderId));
    this.#reveal(folderId);
  }

  deletePreset(presetId: string): void {
    const entry = findPreset(this.library, presetId);
    if (!entry || !confirm(`Delete the preset "${entry.preset.name}" from the library?`)) return;
    this.#commit(deletePreset(this.library, presetId));
    this.select(null);
  }

  // --- Files --------------------------------------------------------------------------------

  async importPreset(): Promise<void> {
    try {
      const file = await openTextFile(PRESET_FILE);
      if (!file) return;
      const preset = parsePresetFile(file.text);
      // The name stored in the file can hold characters a file name can't; fall back to it.
      this.#add(preset, preset.name.trim() || presetNameFromFile(file.name));
      session.showNotice(`Imported ${file.name}`);
    } catch (error) {
      session.showNotice(errorText(error), 'error');
    }
  }

  /** Exports a library preset, or (with no id) the selected track's preset. */
  async exportPreset(presetId?: string): Promise<void> {
    const preset = presetId
      ? findPreset(this.library, presetId)?.preset
      : session.selectedTrack?.segments[0]?.preset;
    if (!preset) return;
    try {
      const name = await saveFile(serializePresetFile(preset), presetFileName(preset), PRESET_FILE);
      if (name) session.showNotice(`Saved ${name}`);
    } catch (error) {
      session.showNotice(`Couldn't save: ${errorText(error)}`, 'error');
    }
  }
}

export const libraryStore = new LibraryStore();
