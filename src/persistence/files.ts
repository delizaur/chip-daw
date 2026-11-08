/**
 * Saving and opening .chip files. Saving uses the File System Access API where available
 * (Chromium: the user picks the location and name) and falls back to a download elsewhere.
 * Opening uses a plain file input, which works in every browser.
 */
import { PROJECT_EXTENSION } from '../model/project-file';

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

type WindowWithPickers = Window & {
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * Saves text to a file. Returns the file name used, or null if the user cancelled.
 */
export async function saveTextFile(text: string, suggestedName: string): Promise<string | null> {
  const picker = (window as WindowWithPickers).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [
          { description: 'chip-daw project', accept: { 'application/json': [PROJECT_EXTENSION] } },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return handle.name;
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return suggestedName;
}

/** Asks the user for a .chip file. Resolves null if they cancel. */
export function openTextFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_EXTENSION},application/json`;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((text) => resolve({ name: file.name, text }), reject);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
