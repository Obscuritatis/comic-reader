import './style.css';
import { h, toast, errorMessage, formatBytes } from './util';
import * as auth from './auth';
import * as library from './library';
import * as db from './db';
import { downloadItem } from './graph';
import { openComic, makeThumbnail, type OpenedComic } from './archive';
import { openReader } from './reader';
import { mountLibrary, forgetCover } from './views/libraryView';
import { openBrowser } from './views/browser';
import { openDialog } from './views/dialogs';
import { getClientId, setClientId, redirectUri } from './config';
import type { Comic } from './types';
import { installButton, onInstallChange } from './install';

const app = document.getElementById('app')!;

function loadingOverlay(text: string) {
  const label = h('div', { class: 'load-label' }, text);
  const bar = h('div', { class: 'load-bar' }, h('div'));
  const cancel = h('button', { class: 'btn' }, 'Annuleren');
  const el = h('div', { class: 'loading' }, h('div', { class: 'spinner' }), label, bar, cancel);
  document.body.append(el);
  const ctrl = new AbortController();
  cancel.addEventListener('click', () => ctrl.abort());
  return {
    signal: ctrl.signal,
    set(text: string, fraction?: number) {
      label.textContent = text;
      (bar.firstChild as HTMLElement).style.width = fraction === undefined ? '0' : `${Math.round(fraction * 100)}%`;
      bar.classList.toggle('indeterminate', fraction === undefined);
    },
    close: () => el.remove(),
  };
}

async function fetchComicData(c: Comic, onProgress?: (l: number, t: number) => void, signal?: AbortSignal) {
  const cached = await db.getCachedFile(c.id);
  if (cached) return cached.arrayBuffer();
  const data = await downloadItem(c.driveId, c.itemId, onProgress, signal);
  void db.putCachedFile(c.id, new Blob([data]));
  return data;
}

/** Na het openen: cover bewaren en ontbrekende info uit ComicInfo.xml aanvullen. */
async function enrich(c: Comic, opened: OpenedComic) {
  if (!(await db.getCover(c.id))) {
    try {
      await db.putCover(c.id, await makeThumbnail(opened.pages[0].blob));
      forgetCover(c.id);
    } catch (err) {
      console.warn('cover', err);
    }
  }
  const info = opened.info;
  const patch: Partial<Comic> = { pageCount: opened.pages.length };
  if (info) {
    if (info.writer && !c.writer) patch.writer = info.writer;
    if (info.summary && !c.summary) patch.summary = info.summary;
    if (info.number !== undefined && c.issue === undefined) patch.issue = info.number;
    if (info.year && !c.year) patch.year = info.year;
    if (info.characters?.length && !c.characters.length) patch.characters = info.characters.slice(0, 12);
  }
  await library.update(c.id, patch, { sync: false });
}

async function openFromLibrary(c: Comic) {
  const overlay = loadingOverlay('Comic ophalen…');
  try {
    const data = await fetchComicData(
      c,
      (loaded, total) =>
        overlay.set(`Downloaden ${formatBytes(loaded)}${total ? ' / ' + formatBytes(total) : ''}`, total ? loaded / total : undefined),
      overlay.signal,
    );
    overlay.set('Uitpakken…');
    const opened = await openComic(data);
    overlay.close();
    await enrich(c, opened);
    const start = c.finished ? 0 : c.lastPage ?? 0;
    openReader({
      title: c.series ? `${c.series}${c.issue !== undefined ? ' #' + c.issue : ''}` : c.title,
      pages: opened.pages,
      startPage: start,
      onPageChange: (page, total) =>
        void library.update(c.id, {
          lastPage: page,
          lastReadAt: Date.now(),
          ...(page >= total - 1 ? { finished: true } : {}),
        }),
    });
  } catch (err) {
    overlay.close();
    if ((err as Error).name !== 'AbortError') toast(errorMessage(err), 'error', 6000);
  }
}

function openLocal() {
  const input = h('input', { type: 'file', accept: '.cbz,.cbr,.zip,.rar' }) as HTMLInputElement;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const overlay = loadingOverlay('Uitpakken…');
    try {
      const opened = await openComic(await file.arrayBuffer());
      overlay.close();
      openReader({ title: file.name.replace(/\.[^.]+$/, ''), pages: opened.pages, startPage: 0 });
    } catch (err) {
      overlay.close();
      toast(errorMessage(err), 'error', 6000);
    }
  });
  input.click();
}

function needLogin(): boolean {
  if (auth.currentAccount()) return false;
  if (!auth.isConfigured()) {
    toast('Vul eerst de Client ID van je Azure-app in bij de instellingen (⚙).', 'error', 6000);
    void openSettings();
  } else void auth.login().catch((e) => toast(errorMessage(e), 'error'));
  return true;
}

function accountButton(): HTMLElement {
  const acc = auth.currentAccount();
  if (!acc) {
    return h('button', { class: 'btn', onclick: () => needLogin() }, 'Aanmelden');
  }
  const name = acc.name || acc.username;
  return h('button', { class: 'btn account', title: `Aangemeld als ${acc.username}. Klik om af te melden.`, onclick: async () => {
    const ok = await openDialog<boolean>((done) => ({
      title: 'Afmelden',
      body: h('p', {}, `Je bent aangemeld als ${acc.username}. Afmelden? Je bibliotheek blijft bewaard op dit toestel en op OneDrive.`),
      actions: [
        h('button', { class: 'btn', onclick: () => done(false) }, 'Annuleren'),
        h('button', { class: 'btn danger', onclick: () => done(true) }, 'Afmelden'),
      ],
    }));
    if (ok) void auth.logout();
  } }, '👤 ', name.split(' ')[0]);
}

async function generateMissingCovers(progress: (msg: string) => void) {
  const todo: Comic[] = [];
  for (const c of library.allComics()) if (!(await db.getCover(c.id))) todo.push(c);
  let done = 0;
  for (const c of todo) {
    progress(`Covers maken: ${done + 1} / ${todo.length} (${c.fileName})`);
    try {
      const opened = await openComic(await fetchComicData(c));
      await enrich(c, opened);
    } catch (err) {
      console.warn(c.fileName, err);
    }
    done++;
  }
  return todo.length;
}

async function openSettings() {
  const stats = await db.cacheStats();
  await openDialog<void>((done) => {
    const clientId = h('input', { type: 'text', value: getClientId(), placeholder: '00000000-0000-0000-0000-000000000000', spellcheck: false }) as HTMLInputElement;
    const coverStatus = h('p', { class: 'muted small' });
    const coversBtn = h('button', { class: 'btn', type: 'button' }, 'Ontbrekende covers maken') as HTMLButtonElement;
    coversBtn.addEventListener('click', async () => {
      if (needLogin()) return;
      coversBtn.disabled = true;
      const n = await generateMissingCovers((m) => (coverStatus.textContent = m));
      coverStatus.textContent = n ? `Klaar: ${n} covers gemaakt.` : 'Alle comics hebben al een cover.';
      coversBtn.disabled = false;
    });
    const cacheLabel = h('span', {}, `${stats.count} comics, ${formatBytes(stats.bytes)}`);
    const exportBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
      const blob = new Blob([JSON.stringify({ version: 1, comics: library.allComics() }, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'comic-bibliotheek.json' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } }, 'Bibliotheek exporteren (JSON)');
    return {
      title: 'Instellingen',
      body: h('div', { class: 'form' },
        h('label', {}, h('span', {}, 'Client ID (Azure app-registratie)'), clientId),
        h('p', { class: 'muted small' }, 'Redirect URI om in Azure te registreren (type "Single-page application"): ', h('code', {}, redirectUri())),
        h('hr'),
        h('div', {}, h('b', {}, 'Covers'), h('p', { class: 'muted small' }, 'Covers worden gemaakt als je een comic opent. Met deze knop worden alle comics één keer gedownload om een cover te maken.'), coversBtn, coverStatus),
        h('hr'),
        h('div', {}, h('b', {}, 'Offline cache: '), cacheLabel, h('p', { class: 'muted small' }, 'Recent geopende comics worden op dit toestel bewaard (max. 1 GB) zodat ze sneller openen.'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { await db.clearFileCache(); cacheLabel.textContent = 'leeg'; } }, 'Cache leegmaken')),
        h('hr'),
        exportBtn,
      ),
      actions: [
        h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Sluiten'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => {
          const changed = clientId.value.trim() !== getClientId();
          setClientId(clientId.value);
          done(null);
          if (changed) location.reload();
        } }, 'Opslaan'),
      ],
    };
  });
}

async function start() {
  try {
    await auth.initAuth();
  } catch (err) {
    console.error(err);
    toast('Aanmelden bij Microsoft lukt niet: ' + errorMessage(err), 'error', 6000);
  }
  await library.loadLocal();
  const view = mountLibrary(app, {
    open: (c) => void openFromLibrary(c),
    addFromOneDrive: () => {
      if (needLogin()) return;
      openBrowser(() => view.render());
    },
    openLocal,
    account: accountButton,
    installButton,
    settings: () => void openSettings(),
  });
  onInstallChange(() => view.render());
  if (auth.currentAccount()) void library.sync();
  // als je terugkomt naar de app (bv. van tablet naar pc), opnieuw synchroniseren
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && auth.currentAccount() && !document.body.classList.contains('reading')) {
      void library.sync();
    }
  });
}

void start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('service worker', err));
}
