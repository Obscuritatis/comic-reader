# Comic Reader

Een comic-lezer in je browser, voor gsm, tablet en pc. Je comics blijven op je **OneDrive** staan;
de app maakt er een bibliotheek van die je kan sorteren en filteren op thema, character, serie en leesstatus.

- Leest **.cbz** en **.cbr** (ook als de extensie niet klopt, bv. een .cbz die eigenlijk RAR is)
- Bladeren door **tikken** (links/rechts), **vegen** of de pijltjestoetsen
- **Zoomen** met knijpen, dubbeltikken, Ctrl+scrollwiel of `+`/`-`; slepen om te verschuiven
- Weergave **passend op scherm** of **volle breedte**, en **dubbele pagina's** als je tablet/scherm liggend staat
- Onthoudt per comic waar je was; het scherm gaat niet uit tijdens het lezen
- Bij het toevoegen vraagt de app per map **onder welk thema en welke characters** de comics horen
  (met suggesties voor Marvel). Leest ook `ComicInfo.xml` als die in het bestand zit.
- De bibliotheek wordt bewaard in je OneDrive (map `Apps/Comic Reader`), zodat ze op al je toestellen gelijk is
- Recent geopende comics worden lokaal bewaard (max. 1 GB) zodat ze snel en offline openen
- Installeerbaar als app: in Safari/Chrome op tablet of gsm → *Delen* → *Zet op beginscherm*

## Eenmalig instellen

### 1. App registreren bij Microsoft (voor de OneDrive-toegang)

1. Ga naar [portal.azure.com](https://portal.azure.com) en meld je aan met je Microsoft-account.
   > Krijg je de melding dat je account geen directory heeft? Maak dan eerst een gratis Azure-account aan
   > (vraagt soms een kaart ter verificatie; een app-registratie kost niets).
2. Zoek **App registrations** → **New registration**.
   - **Name**: `Comic Reader`
   - **Supported account types**: *Accounts in any organizational directory and personal Microsoft accounts*
   - **Redirect URI**: kies platform **Single-page application (SPA)** en vul in:
     `https://obscuritatis.github.io/comic-reader/redirect.html`
   - Klik **Register**.
3. Kopieer op de overzichtspagina de **Application (client) ID**.
4. (Optioneel, voor ontwikkelen op je pc) **Authentication** → *Add URI* bij Single-page application:
   `http://localhost:5173/redirect.html`
5. **API permissions** → *Add a permission* → *Microsoft Graph* → *Delegated permissions* en vink aan:
   `Files.Read` en `Files.ReadWrite.AppFolder` (`User.Read` staat er al). Opslaan.
   De app vraagt alleen **lezen** van je bestanden; schrijven kan enkel in zijn eigen app-map (voor de bibliotheek).

### 2. Publiceren met GitHub Pages

1. In deze repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → tab Variables → New repository variable**
   - Name: `VITE_MSAL_CLIENT_ID`
   - Value: de Client ID uit stap 1.3
3. Ga naar **Actions → Publiceren op GitHub Pages → Run workflow** (of push iets naar `main`).
4. De app staat daarna op **https://obscuritatis.github.io/comic-reader/**

> Liever geen variabele instellen? Je kan de Client ID ook in de app zelf invullen via ⚙ *Instellingen*
> (wordt dan per toestel bewaard).

## Gebruik

1. Open de app en klik **Aanmelden** (Microsoft-login).
2. Klik **+ OneDrive**, blader naar je comics en vink mappen en/of bestanden aan. Een map neemt ook alle submappen mee.
3. Klik **Toevoegen**: per map vraagt de app het **thema** (bv. *Avengers*, *X-Men*, *Civil War*) en de **characters**
   (bv. *Spider-Man*, *Venom*). Serie, nummer en jaar worden uit de bestandsnaam gehaald
   (bv. `Amazing Spider-Man 001 (1963).cbz`) of je kiest de mapnaam als serie.
   Vink *Ook gebruiken voor de andere mappen* aan om niet bij elke map opnieuw te moeten kiezen.
4. In de bibliotheek kan je zoeken, filteren op thema/character/status, sorteren en groeperen.
   Met ✎ pas je één comic aan; met **Selecteren** pas je er meerdere tegelijk aan.
5. Covers worden gemaakt zodra je een comic opent. Via ⚙ → *Ontbrekende covers maken* doe je dat in één keer
   voor je hele bibliotheek (downloadt elke comic één keer).

### Bediening in de lezer

| Actie | Aanraken | Muis / toetsenbord |
|---|---|---|
| Volgende / vorige pagina | tik rechts / links, of veeg | `→` `←`, `PgDn` `PgUp`, scrollwiel |
| Menubalk tonen/verbergen | tik in het midden | klik in het midden |
| Zoomen | knijpen, dubbeltikken | `Ctrl`+scrollwiel, `+` `-`, dubbelklik; `0` = terug |
| Verschuiven bij zoom | slepen | slepen, scrollwiel, `↑` `↓` |
| Passend / volle breedte | ↔-knop | `W` |
| Dubbele pagina's aan/uit | ▯▯-knop | `D` |
| Volledig scherm | ⛶-knop | `F` |
| Terug naar bibliotheek | ←-knop of terugknop toestel | `Esc` |

## Ontwikkelen

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # productieversie in dist/
```

Gebouwd met Vite + TypeScript (geen framework), [MSAL](https://github.com/AzureAD/microsoft-authentication-library-for-js)
voor de Microsoft-login, Microsoft Graph voor OneDrive, [fflate](https://github.com/101arrowz/fflate) voor zip en
[node-unrar-js](https://github.com/YuJianrong/node-unrar.js) (WebAssembly) voor rar. Alles draait in de browser; er is geen server.

| Bestand | Inhoud |
|---|---|
| `src/reader.ts` | de lezer: zoom, gebaren, dubbele pagina's |
| `src/archive.ts` | cbz/cbr uitpakken, ComicInfo.xml, covers |
| `src/graph.ts`, `src/auth.ts` | OneDrive en Microsoft-login |
| `src/library.ts`, `src/db.ts` | bibliotheek, filteren/sorteren, opslag (IndexedDB) en sync naar OneDrive |
| `src/views/` | bibliotheekscherm, OneDrive-verkenner, dialoogvensters |

Nog niet ondersteund: .cb7 (7-Zip), met wachtwoord beveiligde RAR's, gedeelde OneDrive-mappen van iemand anders.
