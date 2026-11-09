/**
 * Saving and opening files. Saving uses the File System Access API where available
 * (Chromium: the user picks the location and name) and falls back to a download elsewhere.
 * Opening uses a plain file input, which works in every browser.
 */
import { PROJECT_EXTENSION } from '../model/project-file';
import { PRESET_EXTENSION } from '../model/library';

export interface FileKind {
  description: string;
  mime: string;
  extension: string;
}

export const PROJECT_FILE: FileKind = {
  description: 'chip-daw project',
  mime: 'application/json',
  extension: PROJECT_EXTENSION,
};

export const PRESET_FILE: FileKind = {
  description: 'chip-daw preset',
  mime: 'application/json',
  extension: PRESET_EXTENSION,
};

export const WAV_FILE: FileKind = {
  description: 'WAV audio',
  mime: 'audio/wav',
  extension: '.wav',
};

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

type WindowWithPickers = Window & {
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** Where a file will be written: picked by the user (or a download), written later. */
export interface SaveTarget {
  name: string;
  write(data: Blob | string): Promise<void>;
}

const toBlob = (data: Blob | string, kind: FileKind) =>
  typeof data === 'string' ? new Blob([data], { type: kind.mime }) : data;

/**
 * Asks where to save (when the browser has a save dialog) and returns a target to write to
 * later, or null if the user cancelled. Call it straight from a click: browsers only open the
 * dialog during a user gesture, so slow work (like rendering audio) must come after this.
 */
export async function chooseSaveTarget(
  suggestedName: string,
  kind: FileKind,
): Promise<SaveTarget | null> {
  const picker = (window as WindowWithPickers).showSaveFilePicker;
  if (picker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({
        suggestedName,
        types: [{ description: kind.description, accept: { [kind.mime]: [kind.extension] } }],
      });
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
    return {
      name: handle.name,
      async write(data) {
        const writable = await handle.createWritable();
        await writable.write(toBlob(data, kind));
        await writable.close();
      },
    };
  }
  // No save dialog (e.g. Firefox): download the file.
  return {
    name: suggestedName,
    async write(data) {
      const url = URL.createObjectURL(toBlob(data, kind));
      const link = document.createElement('a');
      link.href = url;
      link.download = suggestedName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

/** Saves data to a file. Returns the file name used, or null if the user cancelled. */
export async function saveFile(
  data: Blob | string,
  suggestedName: string,
  kind: FileKind,
): Promise<string | null> {
  const target = await chooseSaveTarget(suggestedName, kind);
  if (!target) return null;
  await target.write(data);
  return target.name;
}

/** Asks the user for a file of `kind`. Resolves null if they cancel. */
export function openTextFile(kind: FileKind): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${kind.extension},${kind.mime}`;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((text) => resolve({ name: file.name, text }), reject);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
