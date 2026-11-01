/**
 * Instellingen voor de Microsoft-login (OneDrive).
 *
 * De Client ID komt uit de build (VITE_MSAL_CLIENT_ID, zie README) of uit
 * het instellingenscherm in de app (bewaard in localStorage op dat toestel).
 * Een Client ID is geen geheim: het mag gewoon in de publieke code staan.
 */
const CLIENT_ID_KEY = 'comicreader.clientId';

export function getClientId(): string {
  try {
    const local = localStorage.getItem(CLIENT_ID_KEY);
    if (local) return local;
  } catch {
    /* geen localStorage */
  }
  return (import.meta.env.VITE_MSAL_CLIENT_ID as string | undefined)?.trim() ?? '';
}

export function setClientId(id: string) {
  try {
    if (id.trim()) localStorage.setItem(CLIENT_ID_KEY, id.trim());
    else localStorage.removeItem(CLIENT_ID_KEY);
  } catch {
    /* negeren */
  }
}

/** "common" = zowel persoonlijke als werk/school-accounts. */
export const AUTHORITY =
  (import.meta.env.VITE_MSAL_AUTHORITY as string | undefined) ||
  'https://login.microsoftonline.com/common';

export const SCOPES = ['User.Read', 'Files.Read', 'Files.ReadWrite.AppFolder'];

/** Map van de app (index.html) en de redirect-pagina, bv. https://x.github.io/comic-reader/ */
export function appBaseUrl(): string {
  const url = new URL('.', window.location.href);
  url.hash = '';
  url.search = '';
  return url.toString();
}

export const redirectUri = () => new URL('redirect.html', appBaseUrl()).toString();

/** Hoeveel MB aan gedownloade comics we lokaal bewaren voor snel (her)openen. */
export const FILE_CACHE_LIMIT_BYTES = 1024 * 1024 * 1024;
