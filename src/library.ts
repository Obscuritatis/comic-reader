import * as db from './db';
import { readRemoteLibrary, writeRemoteLibrary } from './graph';
import { currentAccount } from './auth';
import type { Comic, RemoteLibrary } from './types';
import { debounce, errorMessage, toast } from './util';

type Listener = () => void;

const comics = new Map<string, Comic>();
let deleted: Record<string, number> = {};
const listeners = new Set<Listener>();
export type SyncState = 'offline' | 'syncing' | 'synced' | 'error';
let syncState: SyncState = 'offline';

export const onChange = (fn: Listener) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((fn) => fn());

export const allComics = () => [...comics.values()];
export const getComic = (id: string) => comics.get(id);
export const has = (id: string) => comics.has(id);
export const getSyncState = () => syncState;

export async function loadLocal() {
  for (const c of await db.getAllComics()) comics.set(c.id, c);
  deleted = (await db.getMeta<Record<string, number>>('deleted')) ?? {};
  emit();
}

export async function addOrUpdate(list: Comic[]) {
  const now = Date.now();
  for (const c of list) {
    c.updatedAt = now;
    comics.set(c.id, c);
    delete deleted[c.id];
  }
  await db.putComics(list);
  await db.setMeta('deleted', deleted);
  emit();
  scheduleSync();
}

export async function update(id: string, patch: Partial<Comic>, { sync = true } = {}) {
  const c = comics.get(id);
  if (!c) return;
  Object.assign(c, patch, { updatedAt: Date.now() });
  await db.putComics([c]);
  emit();
  if (sync) scheduleSync();
}

export async function remove(ids: string[]) {
  const now = Date.now();
  for (const id of ids) {
    comics.delete(id);
    deleted[id] = now;
  }
  await db.deleteComics(ids);
  await db.setMeta('deleted', deleted);
  emit();
  scheduleSync();
}

/** Samenvoegen: per comic wint de meest recente wijziging; verwijderingen ook. */
export function merge(
  local: Comic[],
  localDeleted: Record<string, number>,
  remote: RemoteLibrary,
): { comics: Comic[]; deleted: Record<string, number> } {
  const map = new Map<string, Comic>();
  for (const c of [...local, ...remote.comics]) {
    const existing = map.get(c.id);
    if (!existing || c.updatedAt > existing.updatedAt) map.set(c.id, c);
  }
  const del: Record<string, number> = { ...remote.deleted };
  for (const [id, t] of Object.entries(localDeleted)) del[id] = Math.max(del[id] ?? 0, t);
  for (const [id, t] of Object.entries(del)) {
    const c = map.get(id);
    if (c && t >= c.updatedAt) map.delete(id);
  }
  return { comics: [...map.values()], deleted: del };
}

function setSync(state: SyncState) {
  syncState = state;
  emit();
}

/** Haal de bibliotheek van OneDrive op, voeg samen, en schrijf terug. */
export async function sync() {
  if (!currentAccount()) return setSync('offline');
  setSync('syncing');
  try {
    const remote = await readRemoteLibrary<RemoteLibrary>();
    let result = { comics: allComics(), deleted };
    if (remote?.version === 1) result = merge(allComics(), deleted, remote);
    const removedIds = [...comics.keys()].filter((id) => !result.comics.some((c) => c.id === id));
    comics.clear();
    for (const c of result.comics) comics.set(c.id, c);
    deleted = result.deleted;
    await db.deleteComics(removedIds);
    await db.putComics(result.comics);
    await db.setMeta('deleted', deleted);
    const payload: RemoteLibrary = { version: 1, updatedAt: Date.now(), comics: result.comics, deleted };
    await writeRemoteLibrary(payload);
    setSync('synced');
  } catch (err) {
    console.error(err);
    setSync('error');
    toast('Synchroniseren met OneDrive mislukt: ' + errorMessage(err), 'error');
  }
}

export const scheduleSync = debounce(() => void sync(), 2500);

// Bij het sluiten van de pagina nog snel synchroniseren
window.addEventListener('pagehide', () => scheduleSync.flush());

// ---- filteren en sorteren ----

export type SortKey = 'series' | 'title' | 'added' | 'read';
export type Status = 'all' | 'unread' | 'reading' | 'finished';

export interface Filter {
  text: string;
  theme: string;
  character: string;
  status: Status;
  sort: SortKey;
}

export function statusOf(c: Comic): Exclude<Status, 'all'> {
  if (c.finished) return 'finished';
  if (c.lastPage && c.lastPage > 0) return 'reading';
  return 'unread';
}

export function applyFilter(list: Comic[], f: Filter, compare: (a: string, b: string) => number): Comic[] {
  const text = f.text.trim().toLowerCase();
  const out = list.filter((c) => {
    if (f.theme && c.theme !== f.theme) return false;
    if (f.character && !c.characters.includes(f.character)) return false;
    if (f.status !== 'all' && statusOf(c) !== f.status) return false;
    if (text) {
      const hay = [c.title, c.series, c.theme, c.fileName, c.folderPath, c.writer ?? '', ...c.characters]
        .join(' ')
        .toLowerCase();
      if (!text.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const bySeries = (a: Comic, b: Comic) =>
    compare(a.series, b.series) || (a.year ?? 0) - (b.year ?? 0) || (a.issue ?? 0) - (b.issue ?? 0) || compare(a.title, b.title);
  const sorters: Record<SortKey, (a: Comic, b: Comic) => number> = {
    series: bySeries,
    title: (a, b) => compare(a.title, b.title),
    added: (a, b) => b.addedAt - a.addedAt || bySeries(a, b),
    read: (a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || bySeries(a, b),
  };
  return out.sort(sorters[f.sort]);
}
