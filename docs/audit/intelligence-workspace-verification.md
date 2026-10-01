# Intelligence workspace verification — 2026-10-01

## 2.4 — Események / Events

- Kiadási fájlok tesztje: **182 teszt, 181 sikeres, 1 explicit opcionális skip**. Az eseménymodell 30 tesztje és a felület 18 DOM-viselkedési tesztje sikeres. JavaScript/locale, production dependency audit (0 ismert sérülékenység) és saját kód whitespace check sikeres; a vendor fájlok eredeti bájtjai megmaradnak.
- Valódi Chromium: eseménylista, hírszalag Enter, földrengésjelölő részletező, forráslink/idő/provenance, hostile text/link, fókuszcsapda, Escape/inert és fókusz-visszaállítás sikeres.
- 390×844 mobil: angol/magyar/francia részletező vízszintes túlcsordulás nélkül, belső görgetéssel. A meglévő teljes böngészős ellenőrzés is sikeres: 13 flat/globe réteg, valódi WebGL, beállítások, SSE reconnect, polling fallback, régi API-válasz verseny és blocked storage. Page/console error: 0; a szoftveres WebGL readback teljesítményüzenetei nem alkalmazáshibák.
- Reprodukálás: `node test/fixtures/dashboard-server.mjs`; másik terminálban `PLAYWRIGHT_MODULE` az opcionális Playwright telepítésre mutat, majd `node scripts/browser-qa.mjs` és `node scripts/intelligence-ui-qa.mjs`. Csak az azonosítható localhost fixture szolgál adatot; a provider/bot/modelleket nem terheli.

![Asztali eseményrészlet](images/intelligence-2.4-desktop.png)
![Magyar mobil eseményrészlet](images/intelligence-2.4-mobile-hu.png)

Validation uses a deterministic fixture, not live-source/account availability. Existing map/WebGL/SSE regression checks and the new accessible event flows pass.

## 2.5 — Történet/export/csoportok / History/export/groups

- **219 teszt: 218 pass, 1 explicit skip**; 31 journal/export viselkedési eset, HTTP auth/filter/HTML export, 32 eseménymodell- és 20 DOM-felületteszt.
- Valódi böngészős JSON/CSV/STIX letöltések, tartalom parse, q/kind/source/from/to szűrők megőrzése. HTML riportból Chromium valódi PDF-et generált; a termék a böngésző nyomtatását használja.
- Lapozás és ékezetes keresés, találatokhoz tartozó teljes idővonal, szűrők megőrzése részletezés után. Keresés utáni gombnyomást korábban elnyelő duplikált input/change kérés javítva és regresszióval védve.
- Tényleges síktérképes jelölőkattintás és földgömb canvas-kattintás nyitja a két külön forrású jelentéscsoportot; mindkét nézetben réteg- és csoportkapcsolás ellenőrizve. Ez rendezési funkció, nem automatikus megerősítés.
- [2.4 kiadás CI](https://github.com/mp3pintyo/Crucix/actions/runs/36916435943): mind a négy OS/Node kombináció, non-root írás és multiarch build/publikálás sikeres.

![Kereshető történet](images/intelligence-2.5-history.png)
![Térképes jelentéscsoport](images/intelligence-2.5-cluster.png)
