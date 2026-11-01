import { h, isComicFile, naturalCompare, formatBytes, toast, errorMessage } from '../util';
import { listChildren, listComicsRecursive, itemFolderPath, type DriveItem } from '../graph';
import * as library from '../library';
import { askFiling, type FilingChoice } from './dialogs';
import { parseComicFileName } from '../filename';
import type { Comic } from '../types';

const comicId = (item: DriveItem) => `${item.parentReference?.driveId ?? 'me'}!${item.id}`;

/** Bladeren door OneDrive en mappen/bestanden aanvinken om toe te voegen. */
export function openBrowser(onClose: () => void) {
  const trail: { id: string; name: string }[] = [{ id: 'root', name: 'OneDrive' }];
  const selected = new Map<string, DriveItem>();
  let items: DriveItem[] = [];

  const crumbs = h('nav', { class: 'crumbs' });
  const list = h('ul', { class: 'drive-list' });
  const status = h('div', { class: 'muted drive-status' });
  const addBtn = h('button', { class: 'btn primary', disabled: true }) as HTMLButtonElement;
  const selectAllBtn = h('button', { class: 'btn' }, 'Alles in deze map');
  const root = h(
    'div',
    { class: 'panel' },
    h('header', { class: 'panel-head' },
      h('button', { class: 'icon-btn', title: 'Terug', onclick: () => close() }, '←'),
      h('h2', {}, 'Toevoegen uit OneDrive'),
    ),
    h('p', { class: 'muted hint' }, 'Vink mappen of .cbz/.cbr-bestanden aan. Een map voegt ook alle submappen toe.'),
    crumbs,
    list,
    status,
    h('footer', { class: 'panel-foot' }, selectAllBtn, addBtn),
  );
  document.body.append(root);

  function updateFooter() {
    const n = selected.size;
    addBtn.disabled = n === 0;
    addBtn.textContent = n ? `Toevoegen (${n} geselecteerd)` : 'Toevoegen';
  }

  function renderCrumbs() {
    crumbs.replaceChildren(
      ...trail.flatMap((c, i) => [
        ...(i ? [h('span', { class: 'sep' }, '›')] : []),
        h('button', { class: 'crumb', onclick: () => navigate(i) }, c.name),
      ]),
    );
  }

  function renderList() {
    const visible = items
      .filter((i) => i.folder || isComicFile(i.name))
      .sort((a, b) => Number(!!b.folder) - Number(!!a.folder) || naturalCompare(a.name, b.name));
    if (!visible.length) {
      list.replaceChildren(h('li', { class: 'muted empty' }, 'Geen mappen of comics hier.'));
      return;
    }
    list.replaceChildren(
      ...visible.map((item) => {
        const inLib = !item.folder && library.has(comicId(item));
        const cb = h('input', {
          type: 'checkbox',
          checked: selected.has(item.id),
          disabled: inLib,
          'aria-label': `${item.name} selecteren`,
          onchange: (e: Event) => {
            if ((e.target as HTMLInputElement).checked) selected.set(item.id, item);
            else selected.delete(item.id);
            updateFooter();
          },
        });
        const label = item.folder
          ? h('button', { class: 'drive-name folder', onclick: () => enter(item) }, '📁 ', item.name,
              h('span', { class: 'muted' }, ` ${item.folder.childCount} items`))
          : h('span', { class: 'drive-name' }, '📖 ', item.name,
              h('span', { class: 'muted' }, ` ${formatBytes(item.size ?? 0)}`),
              inLib ? h('span', { class: 'badge' }, 'in bibliotheek') : null);
        return h('li', { class: 'drive-row' }, h('label', { class: 'cb' }, cb), label);
      }),
    );
  }

  async function load() {
    const current = trail[trail.length - 1];
    renderCrumbs();
    list.replaceChildren(h('li', { class: 'muted empty' }, 'Laden…'));
    try {
      items = await listChildren(current.id);
      renderList();
    } catch (err) {
      list.replaceChildren(h('li', { class: 'form-error empty' }, errorMessage(err)));
    }
  }

  function enter(folder: DriveItem) {
    trail.push({ id: folder.id, name: folder.name });
    void load();
  }
  function navigate(i: number) {
    trail.length = i + 1;
    void load();
  }

  selectAllBtn.addEventListener('click', () => {
    for (const i of items) if ((i.folder || isComicFile(i.name)) && !library.has(comicId(i))) selected.set(i.id, i);
    renderList();
    updateFooter();
  });

  addBtn.addEventListener('click', async () => {
    addBtn.disabled = true;
    try {
      const added = await addSelection([...selected.values()], (msg) => (status.textContent = msg));
      if (added === null) return;
      selected.clear();
      toast(`${added} comic${added === 1 ? '' : 's'} toegevoegd aan je bibliotheek.`);
      close();
    } catch (err) {
      toast(errorMessage(err), 'error', 6000);
    } finally {
      status.textContent = '';
      updateFooter();
    }
  });

  function close() {
    root.remove();
    onClose();
  }

  updateFooter();
  void load();
}

/** Groepeer selectie per map, vraag per groep thema/characters, en voeg toe. */
async function addSelection(selection: DriveItem[], progress: (msg: string) => void): Promise<number | null> {
  const groups: { name: string; files: DriveItem[] }[] = [];
  const looseByFolder = new Map<string, DriveItem[]>();
  for (const item of selection) {
    if (item.folder) {
      progress(`Map "${item.name}" doorzoeken…`);
      const found = await listComicsRecursive(item, (n) => progress(`Map "${item.name}": ${n} comics gevonden…`));
      groups.push({ name: item.name, files: found.map((f) => f.item) });
    } else {
      const folder = itemFolderPath(item).split('/').pop() || 'OneDrive';
      if (!looseByFolder.has(folder)) looseByFolder.set(folder, []);
      looseByFolder.get(folder)!.push(item);
    }
  }
  for (const [name, files] of looseByFolder) groups.push({ name, files });

  const now = Date.now();
  const comics: Comic[] = [];
  let skipped = 0;
  let reuse: FilingChoice | null = null;
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const fresh = group.files.filter((f) => !library.has(comicId(f)));
    skipped += group.files.length - fresh.length;
    if (!fresh.length) continue;
    const choice: FilingChoice | null =
      reuse ??
      (await askFiling({
        heading: `Waar hoort "${group.name}" bij?`,
        count: fresh.length,
        sample: fresh.map((f) => f.name),
        defaultTheme: guessTheme(group.name),
        defaultSeries: group.name,
        remainingGroups: groups.length - g - 1,
      }));
    if (!choice) return null;
    if (choice.applyToAll) reuse = choice;
    for (const f of fresh) {
      const parsed = parseComicFileName(f.name);
      comics.push({
        id: comicId(f),
        driveId: f.parentReference?.driveId,
        itemId: f.id,
        fileName: f.name,
        folderPath: itemFolderPath(f),
        size: f.size ?? 0,
        title: parsed.title,
        series: choice.series ? group.name : parsed.series,
        issue: parsed.issue,
        year: parsed.year,
        theme: choice.theme,
        characters: [...choice.characters],
        addedAt: now,
        updatedAt: now,
      });
    }
  }
  if (skipped) toast(`${skipped} comic(s) stonden al in je bibliotheek en zijn overgeslagen.`);
  await library.addOrUpdate(comics);
  return comics.length;
}

/** Bestaand thema met dezelfde naam als de map? Dan dat voorstellen. */
function guessTheme(folderName: string): string | undefined {
  const lower = folderName.toLowerCase();
  return library.allComics().find((c) => c.theme.toLowerCase() === lower)?.theme;
}
