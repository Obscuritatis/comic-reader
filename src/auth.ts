import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
} from '@azure/msal-browser';
import { AUTHORITY, SCOPES, appBaseUrl, getClientId, redirectUri } from './config';

let pca: PublicClientApplication | null = null;
let account: AccountInfo | null = null;

export const isConfigured = () => !!getClientId();
export const currentAccount = () => account;

/** Moet bij het starten van de app één keer lopen: verwerkt ook de terugkeer na het inloggen. */
export async function initAuth(): Promise<AccountInfo | null> {
  const clientId = getClientId();
  if (!clientId) return null;
  pca = new PublicClientApplication({
    auth: {
      clientId,
      authority: AUTHORITY,
      redirectUri: redirectUri(),
      postLogoutRedirectUri: appBaseUrl(),
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();
  try {
    const result = await pca.handleRedirectPromise();
    if (result?.account) pca.setActiveAccount(result.account);
  } catch (err) {
    console.error('Inloggen mislukt', err);
  }
  account = pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
  if (account) pca.setActiveAccount(account);
  return account;
}

export async function login() {
  if (!pca) throw new Error('Geen Client ID ingesteld. Open de instellingen (⚙) en vul de Client ID in.');
  await pca.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}

export async function logout() {
  if (!pca) return;
  await pca.logoutRedirect({ account: account ?? undefined });
}

export async function getToken(): Promise<string> {
  if (!pca || !account) throw new Error('Niet aangemeld bij OneDrive.');
  try {
    const res = await pca.acquireTokenSilent({ scopes: SCOPES, account });
    return res.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ scopes: SCOPES, account });
      // de pagina navigeert weg; deze promise lost niet op
      return new Promise<string>(() => {});
    }
    throw err;
  }
}
