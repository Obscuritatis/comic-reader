import { getToken } from './auth';
import { isComicFile } from './util';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  folder?: { childCount: number };
  file?: { mimeType?: string };
  parentReference?: { driveId?: string; id?: string; path?: string };
  '@microsoft.graph.downloadUrl'?: string;
}

async function graphFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const res = await fetch(url.startsWith('http') ? url : GRAPH + url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message ?? '';
    } catch {
      /* geen json */
    }
    throw new Error(`OneDrive-fout ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return res;
}

async function graphJson<T>(url: string): Promise<T> {
  const res = await graphFetch(url);
  if (res.status === 404) throw new Error('Niet gevonden op OneDrive.');
  return res.json();
}

const SELECT = '$select=id,name,size,folder,file,parentReference&$top=500';

/** Inhoud van een map ('root' = hoofdmap). */
export async function listChildren(itemId: string): Promise<DriveItem[]> {
  const base = itemId === 'root' ? '/me/drive/root' : `/me/drive/items/${itemId}`;
  let url: string | undefined = `${base}/children?${SELECT}`;
  const items: DriveItem[] = [];
  while (url) {
    const page: { value: DriveItem[]; '@odata.nextLink'?: string } = await graphJson(url);
    items.push(...page.value);
    url = page['@odata.nextLink'];
  }
  return items;
}

export async function getItem(itemId: string): Promise<DriveItem> {
  return graphJson(`/me/drive/items/${itemId}?$select=id,name,size,folder,file,parentReference`);
}

/** Alle comics (cbz/cbr) in een map en submappen. */
export async function listComicsRecursive(
  folder: DriveItem,
  onProgress?: (found: number) => void,
): Promise<{ item: DriveItem; folderName: string }[]> {
  const result: { item: DriveItem; folderName: string }[] = [];
  const queue: DriveItem[] = [folder];
  while (queue.length) {
    const current = queue.shift()!;
    const children = await listChildren(current.id);
    for (const child of children) {
      if (child.folder) queue.push(child);
      else if (isComicFile(child.name)) result.push({ item: child, folderName: current.name });
    }
    onProgress?.(result.length);
  }
  return result;
}

/** Leesbaar pad van een item, bv. "Comics/Marvel/Spider-Man". */
export function itemFolderPath(item: DriveItem): string {
  const path = item.parentReference?.path ?? '';
  return decodeURIComponent(path.replace(/^\/drive\/root:?\/?/, ''));
}

/** Download een bestand met voortgang. */
export async function downloadItem(
  driveId: string | undefined,
  itemId: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const path = driveId ? `/drives/${driveId}/items/${itemId}` : `/me/drive/items/${itemId}`;
  const meta = await graphJson<DriveItem>(path);
  const url = meta['@microsoft.graph.downloadUrl'];
  if (!url) throw new Error('Geen downloadlink gekregen van OneDrive.');
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Download mislukt (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || meta.size || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}

// ---- Bibliotheek bewaren in de app-map op OneDrive (Apps/<app-naam>/library.json) ----

const LIBRARY_PATH = '/me/drive/special/approot:/library.json:/content';

export async function readRemoteLibrary<T>(): Promise<T | null> {
  const res = await graphFetch(LIBRARY_PATH);
  if (res.status === 404) return null;
  return res.json();
}

export async function writeRemoteLibrary(data: unknown): Promise<void> {
  await graphFetch(LIBRARY_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
