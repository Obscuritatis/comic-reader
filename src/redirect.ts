// Deze pagina vangt de terugkeer van de Microsoft-login op en stuurt je door naar de app.
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

broadcastResponseToMainFrame().catch((err) => {
  console.error(err);
  document.body.textContent = 'Aanmelden mislukt. Ga terug naar de app en probeer opnieuw.';
});
