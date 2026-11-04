/** Blobs de imágenes del asistente en IndexedDB (no en localStorage). */

const DB_NAME = 'galv2.assistant.images';
const STORE = 'images';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB.'));
  });
  return dbPromise;
}

function runRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Error de IndexedDB.'));
      }),
  );
}

export async function putImage(id: string, blob: Blob): Promise<void> {
  await openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Error de IndexedDB.'));
        tx.onabort = () => reject(tx.error ?? new Error('Error de IndexedDB.'));
      }),
  );
}

export async function getImage(id: string): Promise<Blob | null> {
  const value = await runRequest<Blob | undefined>('readonly', (store) => store.get(id));
  return value ?? null;
}

export async function deleteImage(id: string): Promise<void> {
  await runRequest('readwrite', (store) => store.delete(id));
}

export async function deleteImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const id of ids) store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Error de IndexedDB.'));
      }),
  );
}
