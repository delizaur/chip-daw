import { describe, expect, it } from 'vitest';
import { emptyLibrary, type Library, type LibraryPreset } from '../../model/library';
import { libraryRows, stepFolder, stepRow, type LibraryRow } from './navigation';

const preset = (id: string, folderId: string | null): LibraryPreset => ({
  folderId,
  preset: {
    id,
    name: id,
    sequencers: [],
    synth: { id: 's', type: 'synth.chip', params: {} },
    effects: [],
  },
});

// Folders sort by name (Bass before Leads), presets by name within a folder.
const library: Library = {
  ...emptyLibrary(),
  folders: [
    { id: 'leads', name: 'Leads' },
    { id: 'bass', name: 'Bass' },
  ],
  presets: [
    preset('b2', 'bass'),
    preset('b1', 'bass'),
    preset('l1', 'leads'),
    preset('loose', null),
  ],
};

const folder = (id: string): LibraryRow => ({ kind: 'folder', id });
const p = (id: string): LibraryRow => ({ kind: 'preset', id });

describe('libraryRows', () => {
  it('lists folders, the presets of open ones, then loose presets', () => {
    expect(libraryRows(library, new Set())).toEqual([folder('bass'), folder('leads'), p('loose')]);
    expect(libraryRows(library, new Set(['bass']))).toEqual([
      folder('bass'),
      p('b1'),
      p('b2'),
      folder('leads'),
      p('loose'),
    ]);
  });
});

describe('stepRow', () => {
  const rows = libraryRows(library, new Set(['bass']));

  it('moves up and down, staying put at the ends', () => {
    expect(stepRow(rows, p('b1'), 1)).toEqual(p('b2'));
    expect(stepRow(rows, p('b2'), 1)).toEqual(folder('leads'));
    expect(stepRow(rows, folder('bass'), -1)).toEqual(folder('bass'));
    expect(stepRow(rows, p('loose'), 1)).toEqual(p('loose'));
  });

  it('starts at the first row with nothing (or a hidden row) selected', () => {
    expect(stepRow(rows, null, 1)).toEqual(folder('bass'));
    expect(stepRow(rows, p('l1'), -1)).toEqual(folder('bass'));
    expect(stepRow([], null, 1)).toBeNull();
  });
});

describe('stepFolder', () => {
  const rows = libraryRows(library, new Set(['bass']));

  it('skips to the previous or next folder', () => {
    expect(stepFolder(rows, folder('bass'), 1)).toEqual(folder('leads'));
    expect(stepFolder(rows, p('b2'), 1)).toEqual(folder('leads'));
    expect(stepFolder(rows, p('b2'), -1)).toEqual(folder('bass'));
    expect(stepFolder(rows, p('loose'), -1)).toEqual(folder('leads'));
  });

  it('returns null with no folder that way; the first folder with nothing selected', () => {
    expect(stepFolder(rows, folder('leads'), 1)).toBeNull();
    expect(stepFolder(rows, folder('bass'), -1)).toBeNull();
    expect(stepFolder(rows, null, 1)).toEqual(folder('bass'));
  });
});
