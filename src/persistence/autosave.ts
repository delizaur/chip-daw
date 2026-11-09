/**
 * Autosave of the current project in IndexedDB, so a reload or crash doesn't lose work.
 * The project is stored as serialized text and goes through the normal file parser on load,
 * so autosaves get the same migrations and validation as .chip files.
 */
import { readStored, writeStored } from './storage';

const KEY = 'autosave';

export async function loadAutosave(): Promise<string | null> {
  const value = await readStored(KEY);
  return typeof value === 'string' ? value : null;
}

export function writeAutosave(text: string): Promise<void> {
  return writeStored(KEY, text);
}

/** Debounced autosave: call `schedule` on every change, `flush` when the page is hidden. */
export class Autosaver {
  readonly #delayMs: number;
  readonly #serialize: () => string;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #failed = false;

  constructor(serialize: () => string, delayMs = 800) {
    this.#serialize = serialize;
    this.#delayMs = delayMs;
  }

  schedule(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), this.#delayMs);
  }

  async flush(): Promise<void> {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    try {
      await writeAutosave(this.#serialize());
      this.#failed = false;
    } catch (error) {
      // Private browsing or blocked storage: keep working, warn once.
      if (!this.#failed) console.warn('Autosave failed:', error);
      this.#failed = true;
    }
  }
}
