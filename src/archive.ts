import { unzip, type Unzipped } from 'fflate';
import { naturalCompare } from './util';

export interface Page {
  name: string;
  blob: Blob;
}

export interface ComicInfo {
  series?: string;
  number?: number;
  year?: number;
  title?: string;
  writer?: string;
  summary?: string;
  characters?: string[];
  teams?: string[];
}

export interface OpenedComic {
  pages: Page[];
  info?: ComicInfo;
}

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
};

const isJunk = (name: string) => /(^|\/)(__MACOSX|\.)/.test(name);
const mimeOf = (name: string) => MIME[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

/** Herkent het formaat aan de inhoud: veel ".cbz" zijn eigenlijk RAR en omgekeerd. */
export function detectFormat(data: Uint8Array): 'zip' | 'rar' | '7z' | 'unknown' {
  if (data[0] === 0x50 && data[1] === 0x4b) return 'zip';
  if (data[0] === 0x52 && data[1] === 0x61 && data[2] === 0x72 && data[3] === 0x21) return 'rar';
  if (data[0] === 0x37 && data[1] === 0x7a && data[2] === 0xbc && data[3] === 0xaf) return '7z';
  return 'unknown';
}

export async function openComic(buffer: ArrayBuffer): Promise<OpenedComic> {
  const data = new Uint8Array(buffer);
  const format = detectFormat(data);
  let files: { name: string; data: Uint8Array }[];
  if (format === 'zip') files = await readZip(data);
  else if (format === 'rar') files = await readRar(buffer);
  else if (format === '7z') throw new Error('Dit is een 7-Zip-archief (.cb7); dat wordt (nog) niet ondersteund.');
  else throw new Error('Onbekend bestandsformaat: dit lijkt geen .cbz of .cbr te zijn.');

  const pages = files
    .filter((f) => IMAGE_RE.test(f.name) && !isJunk(f.name))
    .sort((a, b) => naturalCompare(a.name, b.name))
    .map((f) => ({ name: f.name, blob: new Blob([f.data as BlobPart], { type: mimeOf(f.name) }) }));
  if (!pages.length) throw new Error('Geen afbeeldingen gevonden in dit bestand.');

  const xml = files.find((f) => /(^|\/)comicinfo\.xml$/i.test(f.name));
  return { pages, info: xml ? parseComicInfo(new TextDecoder().decode(xml.data)) : undefined };
}

function readZip(data: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
  return new Promise((resolve, reject) => {
    unzip(
      data,
      { filter: (f) => IMAGE_RE.test(f.name) || /comicinfo\.xml$/i.test(f.name) },
      (err: Error | null, result: Unzipped) => {
        if (err) reject(new Error('Kon het zip-bestand niet lezen: ' + err.message));
        else resolve(Object.entries(result).map(([name, d]) => ({ name, data: d })));
      },
    );
  });
}

let wasmPromise: Promise<ArrayBuffer> | null = null;

async function readRar(buffer: ArrayBuffer): Promise<{ name: string; data: Uint8Array }[]> {
  const [{ createExtractorFromData }, { default: wasmUrl }] = await Promise.all([
    import('node-unrar-js'),
    import('node-unrar-js/esm/js/unrar.wasm?url'),
  ]);
  wasmPromise ??= fetch(wasmUrl).then((r) => r.arrayBuffer());
  const wasmBinary = await wasmPromise;
  try {
    const extractor = await createExtractorFromData({ wasmBinary, data: buffer });
    const { files } = extractor.extract({
      files: (h) => !h.flags.directory && (IMAGE_RE.test(h.name) || /comicinfo\.xml$/i.test(h.name)),
    });
    const out: { name: string; data: Uint8Array }[] = [];
    for (const f of files) {
      if (f.extraction) out.push({ name: f.fileHeader.name, data: f.extraction });
    }
    return out;
  } catch (err) {
    const reason = (err as { reason?: string }).reason;
    if (reason === 'ERAR_MISSING_PASSWORD') throw new Error('Dit RAR-bestand is met een wachtwoord beveiligd.');
    throw new Error('Kon het RAR-bestand niet lezen: ' + ((err as Error).message ?? reason));
  }
}

export function parseComicInfo(xml: string): ComicInfo | undefined {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const get = (tag: string) => doc.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;
    const list = (tag: string) =>
      get(tag)?.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const num = (tag: string) => {
      const v = get(tag);
      return v && !isNaN(Number(v)) ? Number(v) : undefined;
    };
    return {
      series: get('Series'),
      number: num('Number'),
      year: num('Year'),
      title: get('Title'),
      writer: get('Writer'),
      summary: get('Summary'),
      characters: list('Characters'),
      teams: list('Teams'),
    };
  } catch {
    return undefined;
  }
}

/** Maak een kleine cover (JPEG) van de eerste pagina. */
export async function makeThumbnail(blob: Blob, maxWidth = 360): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('thumbnail'))), 'image/jpeg', 0.8),
  );
}
