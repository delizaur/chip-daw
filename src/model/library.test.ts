import { describe, expect, it } from 'vitest';
import { createBox, getParamDescriptor } from './boxes/registry';
import { factoryLibrary } from './factory-presets';
import { createPreset } from './defaults';
import {
  addFolder,
  addPreset,
  copyPreset,
  deleteFolder,
  deletePreset,
  duplicatePreset,
  emptyLibrary,
  instantiatePreset,
  movePreset,
  parsePresetFile,
  presetFileName,
  presetNameFromFile,
  presetsIn,
  renameFolder,
  renamePreset,
  serializePresetFile,
  sortedFolders,
  validateLibrary,
} from './library';
import type { Preset } from './types';

function preset(name = 'Lead'): Preset {
  const p = createPreset(name);
  p.effects.push({ ...createBox('fx.delay'), bypassed: true });
  p.sequencers.push(createBox('seq.arp'));
  return p;
}

describe('preset library', () => {
  it('copies presets deeply with fresh ids for the preset and every box', () => {
    const original = preset();
    const copy = copyPreset(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.synth.id).not.toBe(original.synth.id);
    expect(copy.effects[0]!.id).not.toBe(original.effects[0]!.id);
    expect(copy.effects[0]!.bypassed).toBe(true);
    copy.synth.params.level = 0;
    expect(original.synth.params.level).not.toBe(0);
  });

  it('instantiates a library preset for a track, remembering its origin', () => {
    const { entry } = addPreset(emptyLibrary(), preset(), null);
    const onTrack = instantiatePreset(entry);
    expect(onTrack.libraryOrigin).toBe(entry.preset.id);
    expect(onTrack.id).not.toBe(entry.preset.id);
  });

  it('adds, renames, duplicates, moves and deletes presets without changing the input', () => {
    const empty = emptyLibrary();
    const added = addPreset(empty, preset('Bass'), null);
    const { entry } = added;
    let { library } = added;
    expect(empty.presets).toEqual([]);

    const leads = addFolder(library, 'Leads');
    library = leads.library;
    library = renamePreset(library, entry.preset.id, '  Big bass ');
    expect(library.presets[0]!.preset.name).toBe('Big bass');

    const dup = duplicatePreset(library, entry.preset.id);
    library = dup.library;
    expect(dup.entry.preset.name).toBe('Big bass copy');
    expect(dup.entry.preset.id).not.toBe(entry.preset.id);

    library = movePreset(library, entry.preset.id, leads.folder.id);
    expect(presetsIn(library, leads.folder.id).map((p) => p.preset.name)).toEqual(['Big bass']);
    expect(presetsIn(library, null).map((p) => p.preset.name)).toEqual(['Big bass copy']);

    library = deletePreset(library, dup.entry.preset.id);
    expect(library.presets).toHaveLength(1);
  });

  it('keeps names non-empty', () => {
    const { library, entry } = addPreset(emptyLibrary(), preset(), null, '   ');
    expect(entry.preset.name).toBe('Preset');
    expect(renamePreset(library, entry.preset.id, '').presets[0]!.preset.name).toBe('Preset');
  });

  it('deleting a folder moves its presets to the top level', () => {
    const { library: withFolder, folder } = addFolder(emptyLibrary(), 'Drums');
    const { library } = addPreset(withFolder, preset('Kick'), folder.id);
    const after = deleteFolder(library, folder.id);
    expect(after.folders).toEqual([]);
    expect(after.presets[0]!.folderId).toBeNull();
  });

  it('renames folders and sorts folders and presets by name', () => {
    const first = addFolder(emptyLibrary(), 'b');
    const { folder } = first;
    let { library } = first;
    library = addFolder(library, 'a').library;
    library = renameFolder(library, folder.id, 'c');
    expect(sortedFolders(library).map((f) => f.name)).toEqual(['a', 'c']);
  });

  it('puts presets for unknown folders at the top level', () => {
    const { entry } = addPreset(emptyLibrary(), preset(), 'missing');
    expect(entry.folderId).toBeNull();
  });

  it('validates stored libraries', () => {
    const { library } = addPreset(addFolder(emptyLibrary(), 'x').library, preset(), null);
    expect(validateLibrary(JSON.parse(JSON.stringify(library)))).toEqual(library);
    expect(() =>
      validateLibrary({ formatVersion: 1, folders: [], presets: [{ folderId: null }] }),
    ).toThrow(/preset should be a preset/);
    expect(() => validateLibrary({ formatVersion: 7 })).toThrow(/format version/);
  });
});

describe('.chippreset files', () => {
  it('round-trip a preset (without its library origin)', () => {
    const original = { ...preset('Arp lead'), libraryOrigin: 'abc' };
    const parsed = parsePresetFile(serializePresetFile(original));
    const { libraryOrigin: _origin, ...expected } = original;
    expect(parsed).toEqual(expected);
  });

  it('reject other files clearly', () => {
    expect(() => parsePresetFile('nope')).toThrow(/not valid JSON/);
    expect(() => parsePresetFile('{"tracks": []}')).toThrow(/not a chip-daw preset/);
    const broken = JSON.parse(serializePresetFile(preset()));
    broken.preset.synth.params.wave = 'square';
    expect(() => parsePresetFile(JSON.stringify(broken))).toThrow(
      /preset\.synth\.params\.wave should be a number/,
    );
  });

  it('turn names into file names and back', () => {
    expect(presetFileName({ ...preset(), name: 'Lead: 12.5%' })).toBe('Lead- 12.5%.chippreset');
    expect(presetNameFromFile('Bass.chippreset')).toBe('Bass');
  });
});

describe('factory presets', () => {
  it('form a valid library whose params are all within range', () => {
    const library = factoryLibrary();
    expect(validateLibrary(JSON.parse(JSON.stringify(library)))).toEqual(library);
    expect(library.presets.length).toBeGreaterThanOrEqual(8);
    for (const { preset: p, folderId } of library.presets) {
      expect(library.folders.some((f) => f.id === folderId)).toBe(true);
      for (const box of [...p.sequencers, p.synth, ...p.effects]) {
        for (const [id, value] of Object.entries(box.params)) {
          const param = getParamDescriptor(box.type, id)!;
          expect(value, `${p.name} ${box.type}.${id}`).toBeGreaterThanOrEqual(param.min);
          expect(value, `${p.name} ${box.type}.${id}`).toBeLessThanOrEqual(param.max);
        }
      }
    }
  });
});
