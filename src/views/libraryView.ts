import { h, naturalCompare, uniqueSorted, debounce } from '../util';
import * as library from '../library';
import type { Filter } from '../library';
import { getCover } from '../db';
import type { Comic } from '../types';
import { openDialog, tagInput, knownThemes, knownCharacters, confirmDialog } from './dialogs';

type GroupBy = 'theme' | 'character' | 'series' | 'none';
interface ViewState extends Filter {
  group: GroupBy;
}

const STATE_KEY = 'comicreader.libraryView';
function loadState(): ViewState {
  const def: ViewState = { text: '', theme: '', character: '', status: 'all', sort: 'series', group: 'theme' };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}'), text: '' };
  } catch {
    return def;
  }
}

export interface LibraryActions {
  open(comic: Comic): void;
  addFromOneDrive(): void;
  openLocal(): void;
  account(): HTMLElement;
  settings(): void;
}

const coverUrls = new Map<string, string>();
export function forgetCover(id: string) {
  const u = coverUrls.get(id);
  if (u) URL.revokeObjectURL(u);
  coverUrls.delete(id);
}

export function mountLibrary(container: HTMLElement, actions: LibraryActions) {
  const state = loadState();
  const save = () => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      /* negeren */
    }
  };
  let selecting = false;
  const selection = new Set<string>();

  const search = h('input', {
    type: 'search',
    placeholder: 'Zoek titel, serie, character…',
    class: 'search',
    'aria-label': 'Zoeken',
  }) as HTMLInputElement;
  search.addEventListener('input', debounce(() => ((state.text = search.value), render()), 150));

  const mkSelect = (label: string, key: keyof ViewState, options: [string, string][]) => {
    const sel = h('select', { 'aria-label': label, title: label },
      ...options.map(([v, t]) => h('option', { value: v, selected: state[key] === v }, t)),
    ) as HTMLSelectElement;
    sel.addEventListener('change', () => {
      (state as any)[key] = sel.value;
      save();
      render();
    });
    return sel;
  };

  const header = h('header', { class: 'topbar' });
  const filters = h('div', { class: 'filters' });
  const selBar = h('div', { class: 'selbar' });
  const content = h('main', { class: 'content' });
  container.replaceChildren(header, filters, selBar, content);

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const img = e.target as HTMLImageElement;
        const id = img.dataset.id!;
        void getCover(id).then((blob) => {
          if (!blob) return;
          let url = coverUrls.get(id);
          if (!url) {
            url = URL.createObjectURL(blob);
            coverUrls.set(id, url);
          }
          img.src = url;
          img.closest('.cover')?.classList.add('has-img');
        });
      }
    },
    { rootMargin: '400px' },
  );

  function renderHeader() {
    const sync = library.getSyncState();
    const syncLabel = { offline: '', syncing: '⟳ synchroniseren…', synced: '☁ gesynchroniseerd', error: '⚠ sync mislukt' }[sync];
    header.replaceChildren(
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, '💥'), h('span', {}, 'Comics')),
      search,
      h('div', { class: 'top-actions' },
        h('span', { class: `sync sync-${sync}`, title: 'Je bibliotheek wordt bewaard op je OneDrive, zodat ze op al je toestellen gelijk is.' }, syncLabel),
        h('button', { class: 'btn primary', onclick: actions.addFromOneDrive }, '+ OneDrive'),
        h('button', { class: 'btn', onclick: actions.openLocal, title: 'Een bestand van dit toestel openen (wordt niet bewaard)' }, 'Bestand openen'),
        actions.account(),
        h('button', { class: 'icon-btn', title: 'Instellingen', onclick: actions.settings }, '⚙'),
      ),
    );
  }

  function renderFilters(all: Comic[]) {
    const themes = uniqueSorted(all.map((c) => c.theme));
    const chars = uniqueSorted(all.flatMap((c) => c.characters));
    if (state.theme && !themes.includes(state.theme)) state.theme = '';
    if (state.character && !chars.includes(state.character)) state.character = '';
    const count = (pred: (c: Comic) => boolean) => all.filter(pred).length;
    filters.replaceChildren(
      mkSelect('Thema', 'theme', [['', 'Alle thema\'s'], ...themes.map((t) => [t, `${t} (${count((c) => c.theme === t)})`] as [string, string])]),
      mkSelect('Character', 'character', [['', 'Alle characters'], ...chars.map((t) => [t, `${t} (${count((c) => c.characters.includes(t))})`] as [string, string])]),
      mkSelect('Status', 'status', [['all', 'Alles'], ['unread', 'Ongelezen'], ['reading', 'Bezig'], ['finished', 'Gelezen']]),
      mkSelect('Sorteren', 'sort', [['series', 'Sorteer: serie & nummer'], ['title', 'Sorteer: titel'], ['added', 'Sorteer: laatst toegevoegd'], ['read', 'Sorteer: laatst gelezen']]),
      mkSelect('Groeperen', 'group', [['theme', 'Groepeer: thema'], ['character', 'Groepeer: character'], ['series', 'Groepeer: serie'], ['none', 'Niet groeperen']]),
      h('button', { class: `btn ${selecting ? 'active' : ''}`, onclick: () => toggleSelecting() }, selecting ? 'Klaar' : 'Selecteren'),
    );
  }

  function renderSelBar() {
    selBar.hidden = !selecting;
    if (!selecting) return;
    selBar.replaceChildren(
      h('span', {}, `${selection.size} geselecteerd`),
      h('button', { class: 'btn', onclick: () => selectVisible() }, 'Alles zichtbare'),
      h('button', { class: 'btn primary', disabled: !selection.size, onclick: () => void editComics([...selection]) }, 'Thema/characters wijzigen'),
      h('button', { class: 'btn danger', disabled: !selection.size, onclick: () => void removeComics([...selection]) }, 'Verwijderen'),
    );
  }

  let visibleIds: string[] = [];
  function selectVisible() {
    visibleIds.forEach((id) => selection.add(id));
    render();
  }
  function toggleSelecting() {
    selecting = !selecting;
    selection.clear();
    render();
  }

  function card(c: Comic): HTMLElement {
    const status = library.statusOf(c);
    const progress = c.pageCount && c.lastPage !== undefined ? Math.round(((c.lastPage + 1) / c.pageCount) * 100) : 0;
    const img = h('img', { alt: '', 'data-id': c.id, loading: 'lazy' });
    io.observe(img);
    const el = h(
      'article',
      { class: `card ${selection.has(c.id) ? 'selected' : ''}`, tabindex: '0', title: c.fileName },
      h('div', { class: 'cover' },
        img,
        h('div', { class: 'cover-fallback' }, h('span', {}, c.series || c.title), c.issue !== undefined ? h('b', {}, `#${c.issue}`) : null),
        status === 'finished' ? h('span', { class: 'flag' }, '✓') : null,
        status === 'reading' ? h('div', { class: 'progress' }, h('div', { style: `width:${progress}%` })) : null,
        selecting ? h('span', { class: 'tick' }, selection.has(c.id) ? '☑' : '☐') : null,
      ),
      h('div', { class: 'card-meta' },
        h('div', { class: 'card-title' }, c.series || c.title, c.issue !== undefined ? ` #${c.issue}` : ''),
        h('div', { class: 'card-sub muted' }, [c.year, c.characters.slice(0, 2).join(', ')].filter(Boolean).join(' · ')),
      ),
      selecting ? null : h('button', { class: 'card-menu icon-btn', title: 'Bewerken', onclick: (e: Event) => (e.stopPropagation(), void editComics([c.id])) }, '✎'),
    );
    const activate = () => {
      if (selecting) {
        if (selection.has(c.id)) selection.delete(c.id);
        else selection.add(c.id);
        render();
      } else actions.open(c);
    };
    el.addEventListener('click', activate);
    el.addEventListener('keydown', (e) => e.key === 'Enter' && activate());
    return el;
  }

  function render() {
    renderHeader();
    const all = library.allComics();
    renderFilters(all);
    filters.hidden = !all.length;
    renderSelBar();
    if (!all.length) {
      content.replaceChildren(
        h('div', { class: 'empty-state' },
          h('div', { class: 'big' }, '📚'),
          h('h2', {}, 'Je bibliotheek is nog leeg'),
          h('p', {}, 'Meld je aan bij OneDrive en kies de mappen of bestanden met je comics. Per map vragen we onder welk thema en welke characters ze horen.'),
          h('p', {}, h('button', { class: 'btn primary', onclick: actions.addFromOneDrive }, '+ Comics toevoegen uit OneDrive')),
          h('p', { class: 'muted' }, 'Of open meteen een .cbz/.cbr van dit toestel met "Bestand openen".'),
        ),
      );
      return;
    }
    const list = library.applyFilter(all, state, naturalCompare);
    visibleIds = list.map((c) => c.id);
    if (!list.length) {
      content.replaceChildren(h('p', { class: 'muted empty-state' }, 'Geen comics gevonden met deze filters.'));
      return;
    }
    const groups = new Map<string, Comic[]>();
    const addTo = (key: string, c: Comic) => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    };
    for (const c of list) {
      if (state.group === 'theme') addTo(c.theme || 'Zonder thema', c);
      else if (state.group === 'series') addTo(c.series || 'Zonder serie', c);
      else if (state.group === 'character') {
        const cs = state.character ? [state.character] : c.characters;
        if (!cs.length) addTo('Zonder character', c);
        cs.forEach((ch) => addTo(ch, c));
      } else addTo('', c);
    }
    const keys = [...groups.keys()].sort(naturalCompare);
    content.replaceChildren(
      h('p', { class: 'muted count' }, `${list.length} comic${list.length === 1 ? '' : 's'}`),
      ...keys.map((k) =>
        h('section', { class: 'group' },
          k ? h('h3', { class: 'group-title' }, k, h('span', { class: 'muted' }, ` ${groups.get(k)!.length}`)) : null,
          h('div', { class: 'grid' }, ...groups.get(k)!.map(card)),
        ),
      ),
    );
  }

  async function removeComics(ids: string[]) {
    const ok = await confirmDialog(
      'Verwijderen uit bibliotheek',
      `${ids.length} comic(s) uit je bibliotheek halen? De bestanden op OneDrive blijven gewoon staan.`,
      'Verwijderen',
    );
    if (!ok) return;
    ids.forEach(forgetCover);
    selection.clear();
    await library.remove(ids);
  }

  async function editComics(ids: string[]) {
    const comics = ids.map((id) => library.getComic(id)!).filter(Boolean);
    if (!comics.length) return;
    const single = comics.length === 1 ? comics[0] : null;
    const result = await openDialog<Partial<Comic> & { charMode?: 'add' | 'replace' }>((done) => {
      const themesId = 'dl-edit-themes';
      const theme = h('input', { type: 'text', list: themesId, value: single?.theme ?? '', placeholder: single ? '' : '(ongewijzigd laten)' }) as HTMLInputElement;
      const chars = tagInput(single?.characters ?? [], knownCharacters(), 'Character toevoegen (Enter)');
      const charMode = h('select', {}, h('option', { value: 'add' }, 'toevoegen aan bestaande'), h('option', { value: 'replace' }, 'bestaande vervangen')) as HTMLSelectElement;
      const title = h('input', { type: 'text', value: single?.title ?? '' }) as HTMLInputElement;
      const series = h('input', { type: 'text', value: single?.series ?? '' }) as HTMLInputElement;
      const issue = h('input', { type: 'number', step: 'any', value: single?.issue ?? '' }) as HTMLInputElement;
      const year = h('input', { type: 'number', value: single?.year ?? '' }) as HTMLInputElement;
      const finished = h('input', { type: 'checkbox', checked: !!single?.finished }) as HTMLInputElement;
      const submit = () => {
        const patch: Partial<Comic> & { charMode?: 'add' | 'replace' } = { characters: chars.value() };
        if (theme.value.trim()) patch.theme = theme.value.trim();
        if (single) {
          Object.assign(patch, {
            title: title.value.trim() || single.title,
            series: series.value.trim(),
            issue: issue.value === '' ? undefined : Number(issue.value),
            year: year.value === '' ? undefined : Number(year.value),
            finished: finished.checked,
          });
          patch.charMode = 'replace';
        } else patch.charMode = charMode.value as 'add' | 'replace';
        done(patch);
      };
      const body = h('div', { class: 'form' },
        single ? null : h('p', { class: 'muted' }, `${comics.length} comics tegelijk aanpassen.`),
        h('label', {}, h('span', {}, 'Thema'), theme, h('datalist', { id: themesId }, ...knownThemes().map((t) => h('option', { value: t })))),
        h('label', {}, h('span', {}, 'Characters'), chars.el),
        single ? null : h('label', {}, h('span', {}, 'Characters'), charMode),
        single ? h('label', {}, h('span', {}, 'Titel'), title) : null,
        single ? h('div', { class: 'row3' },
          h('label', {}, h('span', {}, 'Serie'), series),
          h('label', {}, h('span', {}, 'Nummer'), issue),
          h('label', {}, h('span', {}, 'Jaar'), year)) : null,
        single ? h('label', { class: 'check' }, finished, h('span', {}, 'Gelezen')) : null,
        single ? h('p', { class: 'muted small' }, `Bestand: ${single.folderPath}/${single.fileName}`) : null,
      );
      return {
        title: single ? 'Comic bewerken' : 'Comics bewerken',
        body,
        actions: [
          single ? h('button', { type: 'button', class: 'btn danger left', onclick: () => (done(null), void removeComics([single.id])) }, 'Verwijderen') : null,
          h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'Annuleren'),
          h('button', { type: 'button', class: 'btn primary', onclick: submit }, 'Opslaan'),
        ].filter(Boolean) as Node[],
      };
    });
    if (!result) return;
    const { charMode, ...patch } = result;
    const updated = comics.map((c) => {
      const characters =
        charMode === 'add' ? uniqueSorted([...c.characters, ...(patch.characters ?? [])]) : patch.characters ?? c.characters;
      return { ...c, ...patch, characters };
    });
    await library.addOrUpdate(updated);
    if (selecting) {
      selecting = false;
      selection.clear();
      render();
    }
  }

  library.onChange(render);
  render();
  return { render, edit: editComics };
}
