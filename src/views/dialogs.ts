import { h, uniqueSorted } from '../util';
import { MARVEL_CHARACTERS, MARVEL_THEMES } from '../marvel';
import { allComics } from '../library';

/** Opent een <dialog>; resolve met de waarde die doorgegeven wordt aan done(). */
export function openDialog<T>(
  build: (done: (value: T | null) => void) => { title: string; body: Node; actions: Node[] },
): Promise<T | null> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dlg' });
    let finished = false;
    const done = (value: T | null) => {
      if (finished) return;
      finished = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const { title, body, actions } = build(done);
    const closeX = h('button', { class: 'icon-btn dlg-x', type: 'button', title: 'Sluiten', onclick: () => done(null) }, '✕');
    dialog.append(
      h('div', { class: 'dlg-head' }, h('h2', {}, title), closeX),
      h('div', { class: 'dlg-body' }, body),
      h('div', { class: 'dlg-actions' }, ...actions),
    );
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(null);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export const knownThemes = () => uniqueSorted([...allComics().map((c) => c.theme), ...MARVEL_THEMES]);
export const knownCharacters = () =>
  uniqueSorted([...allComics().flatMap((c) => c.characters), ...MARVEL_CHARACTERS]);

let datalistCounter = 0;
function datalist(options: string[]): { id: string; el: HTMLDataListElement } {
  const id = `dl-${++datalistCounter}`;
  return { id, el: h('datalist', { id }, ...options.map((o) => h('option', { value: o }))) };
}

/** Invoer voor meerdere tags (characters), met suggesties. */
export function tagInput(initial: string[], suggestions: string[], placeholder: string) {
  const tags = new Set(initial);
  const list = datalist(suggestions);
  const chips = h('div', { class: 'chips' });
  const input = h('input', { type: 'text', list: list.id, placeholder, class: 'tag-input', enterkeyhint: 'enter' }) as HTMLInputElement;
  const render = () => {
    chips.replaceChildren(
      ...[...tags].map((t) =>
        h(
          'span',
          { class: 'chip' },
          t,
          h('button', { type: 'button', class: 'chip-x', title: `${t} verwijderen`, onclick: () => (tags.delete(t), render()) }, '×'),
        ),
      ),
    );
  };
  const commit = () => {
    for (const part of input.value.split(',')) if (part.trim()) tags.add(part.trim());
    input.value = '';
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && tags.size) {
      tags.delete([...tags].pop()!);
      render();
    }
  });
  // kiezen uit de suggestielijst
  input.addEventListener('change', () => {
    if (suggestions.includes(input.value.trim())) commit();
  });
  render();
  return {
    el: h('div', { class: 'tag-field' }, chips, input, list.el),
    value: () => {
      commit();
      return [...tags];
    },
  };
}

export interface FilingChoice {
  theme: string;
  characters: string[];
  /** serie: undefined = uit bestandsnaam halen */
  series?: string;
  applyToAll: boolean;
}

/** "Onder welk thema / welke characters komen deze comics?" */
export function askFiling(opts: {
  heading: string;
  count: number;
  sample: string[];
  defaultTheme?: string;
  defaultSeries?: string;
  remainingGroups: number;
}): Promise<FilingChoice | null> {
  return openDialog<FilingChoice>((done) => {
    const themes = datalist(knownThemes());
    const themeInput = h('input', {
      type: 'text',
      list: themes.id,
      value: opts.defaultTheme ?? '',
      placeholder: 'bv. Avengers, X-Men, Civil War…',
      required: true,
    }) as HTMLInputElement;
    const chars = tagInput([], knownCharacters(), 'bv. Spider-Man (Enter om toe te voegen)');
    const seriesMode = h('select', {},
      h('option', { value: 'auto' }, 'Uit de bestandsnaam halen'),
      h('option', { value: 'folder' }, `Mapnaam gebruiken: "${opts.defaultSeries ?? ''}"`),
    ) as HTMLSelectElement;
    const applyAll = h('input', { type: 'checkbox' }) as HTMLInputElement;
    const error = h('p', { class: 'form-error' });

    const submit = () => {
      const theme = themeInput.value.trim();
      if (!theme) {
        error.textContent = 'Kies of typ een thema.';
        themeInput.focus();
        return;
      }
      done({
        theme,
        characters: chars.value(),
        series: seriesMode.value === 'folder' ? opts.defaultSeries : undefined,
        applyToAll: applyAll.checked,
      });
    };
    themeInput.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), submit()));
    setTimeout(() => themeInput.focus(), 50);

    const body = h('div', { class: 'form' },
      h('p', { class: 'muted' }, `${opts.count} comic${opts.count === 1 ? '' : 's'}: `, opts.sample.slice(0, 3).join(', '), opts.count > 3 ? ', …' : ''),
      h('label', {}, h('span', {}, 'Thema'), themeInput, themes.el),
      h('label', {}, h('span', {}, 'Characters'), chars.el),
      opts.defaultSeries ? h('label', {}, h('span', {}, 'Serie'), seriesMode) : null,
      opts.remainingGroups > 0
        ? h('label', { class: 'check' }, applyAll, h('span', {}, `Ook gebruiken voor de ${opts.remainingGroups} andere map(pen)`))
        : null,
      error,
    );
    return {
      title: opts.heading,
      body,
      actions: [
        h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'Annuleren'),
        h('button', { type: 'button', class: 'btn primary', onclick: submit }, 'Toevoegen'),
      ],
    };
  });
}

export function confirmDialog(title: string, message: string, okLabel = 'OK'): Promise<boolean> {
  return openDialog<boolean>((done) => ({
    title,
    body: h('p', {}, message),
    actions: [
      h('button', { type: 'button', class: 'btn', onclick: () => done(false) }, 'Annuleren'),
      h('button', { type: 'button', class: 'btn danger', onclick: () => done(true) }, okLabel),
    ],
  })).then((v) => !!v);
}
