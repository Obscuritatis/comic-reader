import { h } from './util';
import { openDialog } from './views/dialogs';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((fn) => fn());
});

export const onInstallChange = (fn: () => void) => listeners.add(fn);

/** Draait de app al als geïnstalleerde app (vanaf het beginscherm)? */
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS doet zich voor als Mac

export async function install() {
  if (deferred) {
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    listeners.forEach((fn) => fn());
    return;
  }
  // Geen automatische installatie mogelijk: uitleg tonen
  const steps = isIOS()
    ? [
        'Open deze pagina in Safari (niet in Chrome of een andere app).',
        'Tik op de Deel-knop (vierkantje met pijl omhoog).',
        'Kies "Zet op beginscherm" en tik op "Voeg toe".',
      ]
    : /Android/i.test(navigator.userAgent)
      ? ['Open het menu van de browser (⋮ rechtsboven).', 'Kies "App installeren" of "Toevoegen aan startscherm".']
      : [
          'Gebruik Chrome of Edge.',
          'Klik op het installatie-icoon rechts in de adresbalk, of open het menu (⋮ of …) en kies "App installeren" / "Apps → Deze site installeren als app".',
        ];
  await openDialog<void>((done) => ({
    title: 'App installeren',
    body: h('div', { class: 'form' },
      h('ol', { class: 'steps' }, ...steps.map((s) => h('li', {}, s))),
      h('p', { class: 'muted small' }, 'Daarna open je Comics gewoon vanaf je beginscherm, schermvullend en zonder adresbalk.'),
    ),
    actions: [h('button', { class: 'btn primary', type: 'button', onclick: () => done(null) }, 'OK')],
  }));
}

export function installButton(): HTMLElement | null {
  if (isInstalled()) return null;
  return h('button', { class: 'btn', title: 'Op je beginscherm zetten als app', onclick: () => void install() }, '📲 App installeren');
}
