# Intelligence workspace verification — 2026-10-01

## 2.4 — Események / Events

- Kiadási fájlok tesztje: **182 teszt, 181 sikeres, 1 explicit opcionális skip**. Az eseménymodell 30 tesztje és a felület 18 DOM-viselkedési tesztje sikeres. JavaScript/locale, production dependency audit (0 ismert sérülékenység) és saját kód whitespace check sikeres; a vendor fájlok eredeti bájtjai megmaradnak.
- Valódi Chromium: eseménylista, hírszalag Enter, földrengésjelölő részletező, forráslink/idő/provenance, hostile text/link, fókuszcsapda, Escape/inert és fókusz-visszaállítás sikeres.
- 390×844 mobil: angol/magyar/francia részletező vízszintes túlcsordulás nélkül, belső görgetéssel. A meglévő teljes böngészős ellenőrzés is sikeres: 13 flat/globe réteg, valódi WebGL, beállítások, SSE reconnect, polling fallback, régi API-válasz verseny és blocked storage. Page/console error: 0; a szoftveres WebGL readback teljesítményüzenetei nem alkalmazáshibák.
- Reprodukálás: `node test/fixtures/dashboard-server.mjs`; másik terminálban `PLAYWRIGHT_MODULE` az opcionális Playwright telepítésre mutat, majd `node scripts/browser-qa.mjs` és `node scripts/intelligence-ui-qa.mjs`. Csak az azonosítható localhost fixture szolgál adatot; a provider/bot/modelleket nem terheli.

![Asztali eseményrészlet](images/intelligence-2.4-desktop.png)
![Magyar mobil eseményrészlet](images/intelligence-2.4-mobile-hu.png)

Validation uses a deterministic fixture, not live-source/account availability. Existing map/WebGL/SSE regression checks and the new accessible event flows pass.
