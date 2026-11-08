/**
 * Autosave of the current project in IndexedDB, so a reload or crash doesn't lose work.
 * The project is stored as serialized text and goes through the normal file parser on load,
 * so autosaves get the same migrations and validation as .chip files.
 */
const DB_NAME = 'chip-daw';
const STORE = 'projects';
const KEY = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open storage'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Storage request failed'));
    });
  } finally {
    db.close();
  }
}

export async function loadAutosave(): Promise<string | null> {
  const value = await withStore('readonly', (store) => store.get(KEY));
  return typeof value === 'string' ? value : null;
}

export function writeAutosave(text: string): Promise<IDBValidKey> {
  return withStore('readwrite', (store) => store.put(text, KEY));
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
