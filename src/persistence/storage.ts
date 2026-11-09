/**
 * Small key-value storage in IndexedDB for app data that lives in the browser: the project
 * autosave ("autosave") and the preset library ("library").
 */
const DB_NAME = 'chip-daw';
/** Named "projects" for historical reasons (it first held only the autosave). */
const STORE = 'projects';

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

export function readStored(key: string): Promise<unknown> {
  return withStore('readonly', (store) => store.get(key));
}

export async function writeStored(key: string, value: unknown): Promise<void> {
  await withStore('readwrite', (store) => store.put(value, key));
}
