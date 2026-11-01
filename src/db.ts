import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Comic } from './types';
import { FILE_CACHE_LIMIT_BYTES } from './config';

interface CachedFile {
  id: string;
  data: Blob;
  size: number;
  lastUsed: number;
}

interface Schema extends DBSchema {
  comics: { key: string; value: Comic };
  covers: { key: string; value: Blob };
  files: { key: string; value: CachedFile; indexes: { lastUsed: number } };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
  dbPromise ??= openDB<Schema>('comic-reader', 1, {
    upgrade(d) {
      d.createObjectStore('comics', { keyPath: 'id' });
      d.createObjectStore('covers');
      const files = d.createObjectStore('files', { keyPath: 'id' });
      files.createIndex('lastUsed', 'lastUsed');
      d.createObjectStore('meta');
    },
  });
  return dbPromise;
}

export async function getAllComics(): Promise<Comic[]> {
  return (await db()).getAll('comics');
}

export async function putComics(comics: Comic[]) {
  const tx = (await db()).transaction('comics', 'readwrite');
  await Promise.all([...comics.map((c) => tx.store.put(c)), tx.done]);
}

export async function deleteComics(ids: string[]) {
  const d = await db();
  const tx = d.transaction(['comics', 'covers', 'files'], 'readwrite');
  for (const id of ids) {
    tx.objectStore('comics').delete(id);
    tx.objectStore('covers').delete(id);
    tx.objectStore('files').delete(id);
  }
  await tx.done;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('meta', key) as Promise<T | undefined>;
}

export async function setMeta(key: string, value: unknown) {
  await (await db()).put('meta', value, key);
}

export async function getCover(id: string): Promise<Blob | undefined> {
  return (await db()).get('covers', id);
}

export async function putCover(id: string, blob: Blob) {
  await (await db()).put('covers', blob, id);
}

export async function getCachedFile(id: string): Promise<Blob | undefined> {
  const d = await db();
  const entry = await d.get('files', id);
  if (!entry) return undefined;
  entry.lastUsed = Date.now();
  await d.put('files', entry);
  return entry.data;
}

/** Bewaar een gedownloade comic; oudste worden verwijderd als de limiet bereikt is. */
export async function putCachedFile(id: string, data: Blob) {
  const d = await db();
  try {
    await d.put('files', { id, data, size: data.size, lastUsed: Date.now() });
  } catch (err) {
    console.warn('Kon comic niet bewaren in cache', err);
    return;
  }
  const all = await d.getAllFromIndex('files', 'lastUsed');
  let total = all.reduce((sum, f) => sum + f.size, 0);
  for (const f of all) {
    if (total <= FILE_CACHE_LIMIT_BYTES || f.id === id) continue;
    await d.delete('files', f.id);
    total -= f.size;
  }
}

export async function cacheStats(): Promise<{ count: number; bytes: number }> {
  const all = await (await db()).getAll('files');
  return { count: all.length, bytes: all.reduce((s, f) => s + f.size, 0) };
}

export async function clearFileCache() {
  await (await db()).clear('files');
}
