# Crucix 2.3 – böngészős ellenőrzés, 2026-10-01

Az alábbi ellenőrzések a módosított dashboardon sikeresek. A teszt a helyi, determinisztikus [fixture szervert](../../test/fixtures/dashboard-server.mjs) használta; nem olvasott operátori `.env` fájlt, mentett futásokat vagy élő adatforrásokat. A képek a fixture adatait mutatják, köztük korábbi demonstrációs megfigyeléseket; nem aktuális világhelyzetet igazolnak.

## Környezet és futtatás

- Windows, Node.js **24.13.0**, Playwright **1.62.1**, telepített Chromium **1234**; elkülönített, headless böngészőprofil.
- Cél: `http://127.0.0.1:3199/`. Desktop: **1440 × 1000**; mobil: **390 × 844**; API/fallback szélső eset: **1100 × 850**.
- A fő teszt `prefers-reduced-motion: reduce` beállítást használ. Külön context ellenőrzi a normál animációs indítást is.
- A böngészőplugin és annak külön skillje ebben a környezetben nem volt elérhető; a frontend testing skill alapellenőrzéseit a rendelkezésre álló Playwrighttal végeztük el.

Első terminál:

```powershell
node test/fixtures/dashboard-server.mjs
```

Második terminál, elérhető Playwright modul és hozzá telepített Chromium mellett:

```powershell
node scripts/browser-qa.mjs
```

Az opcionális QA-függőség egy már telepített modulját a `PLAYWRIGHT_MODULE` környezeti változóval is meg lehet adni. A [QA-script](../../scripts/browser-qa.mjs) nem tartalmaz géphez kötött cache-útvonalat, és nem ad új futásidejű függőséget az alkalmazáshoz. A `QA_URL` csak helyi HTTP fixture-címet fogad el; a vezérlőhívások előtt ellenőrzi a fixture azonosítóját. A teszt után visszaállítja az online fixture-állapotot, és hibánál is bezárja a böngészőjét.

Csak a célzott headline/ötlet/popup regressziós körhöz: `$env:QA_SUITE='xss'; node scripts/browser-qa.mjs`. A `race` a snapshot-versenyt, az `edge` a szélső eseteket és a race/XSS köröket futtatja; az alapértelmezett `all` mindent. Az adat-fixture módosítása után a szervert újra kell indítani; a dashboard HTML-jének módosításához elég reload.

## Eredmények

| Ellenőrzés | Konkrét próba és eredmény |
| --- | --- |
| Oldalazonosság és megjelenés | A helyi URL és a magyar „CRUCIX — Hírszerzési Terminál” cím helyes. A dashboard nem üres; a panelek és a térkép megjelennek, a boot réteg eltűnik. **PASS** |
| Hibák | A fő desktop/mobil körben **0 page error**, **0 console error**. Négy headless WebGL driver warning jelent meg: `GPU stall due to ReadPixels`; a screenshotolás során mért szoftveres renderelés teljesítményjelzése, nem alkalmazáskivétel. **PASS** |
| Beállítások megnyitása | A dialog látható, `aria-hidden=false`, a háttér dashboard `inert`. A nyitó gomb visszakapja a fókuszt bezáráskor. **PASS** |
| Billentyűzetes modal | A close gombon Shift+Tab az utolsó elérhető vezérlőre, onnan Tab az elsőre fordul. Escape és a háttérre kattintás bezárja a dialogot; a háttér ismét interaktív. **PASS** |
| Panelrendezés | Alt+le a kiválasztott panelt egy hellyel lejjebb viszi és megőrzi a fókuszt. Valódi egérrel végzett HTML drag/drop balról a középső zónába helyez panelt; a zónaválasztó visszamozgatja. A kereskedési ötletek jobbra helyezése reload után is megmarad. **PASS** |
| Rétegkapcsolók | **13 logikai kapcsoló**: légi, hő/tűz, SDR, tengeri, nukleáris/RadNet, konfliktus, OSINT, egészség, internet, hírek/GDELT, időjárás, űr, földrengés. Mindegyik kapcsoló kikapcsolva eltávolítja saját markertípusait a síktérképről és a tényleges WebGL-földgömbről; visszakapcsolható. **PASS** |
| USGS jelölő | A fixture egy földrengése mindkét nézetben jelen van, kapcsolóval eltűnik/visszatér. A UI a jelentős események 24 órás feedjét jelzi, nem az összes M4+ földrengést. **PASS** |
| Pan és zoom | D3 zoom/pan transzformáció után a síktérképi `.marker-label` feliratok nem kapnak `display:none` értéket. **PASS** |
| Csökkentett mozgás | A boot gyorsan átadja a helyet a dashboardnak; a földgömb `autoRotate=false`. A normál animációs contextben a boot is végigfut és a fő UI teljesen látható. **PASS** |
| Élő adatfolyam | A fixture SSE-frissítése megjelenik a hírsávban. A kapcsolat „Élő adatfolyam”; offline vezérlés után „Megszakadt”, online visszaállítás után natív SSE újracsatlakozással ismét „Élő”. **PASS** |
| Fallback polling | SSE 503 mellett több API-kérés indul. Érvényes API-válasz visszahozza az adatokat és a „Lekérdezés” állapotot. A 60 másodperces intervallumot kizárólag a teszt context gyorsítja 100 ms-ra. **PASS** |
| Sérült API-adat | Hibás dátum és hibás array mező nem cseréli le a használható inline snapshotot; a fixture 31 forrásos alapadata megmarad. **PASS** |
| Lassú API / újabb SSE verseny | A böngésző valódi EventSource üzenetként megkapja a frissebb, 222 forrásos snapshotot; 500 ms késéssel érkező régi API-válasz 111 forrásos snapshotja nem írja felül. Azonos időbélyegű frissítést továbbra is elfogad. A teszt a javítás előtt 111 ≠ 222 eredménnyel elbukott. **PASS a javítás után** |
| Adat- és ötletkor | Egyórás snapshot „Elavult”. Az egyórás, cache-ből megtartott ötlet külön „Korábbi” korjelzést kap; az új snapshot nem teszi látszólag frissen generálttá. **PASS** |
| Forrásállapotok | A fixture hibás, elavult és nem konfigurált forrása külön, egy-egy megfelelő állapotjelölést kap; az egészséges forrás is látható. **PASS** |
| Ötlettípus és rules | Az uppercase `HEDGE` a `hedge` CSS-osztályt kapja. A szabályalapú út „SZABÁLYOK”; sikeres, üres rules esetén nincs megfelelő szabályjelzés, nem LLM-konfigurációs hiba. **PASS** |
| HTML-tartalmú külső szöveg | Az eredeti unterminated headline regressziós payload megmaradt; külön teljes `<img … onerror>` headline és ötletindoklás, valamint ténylegesen megnyitott news-marker popup is tesztelve. Nem jön létre DOM `img` elem a hírsávban, az ötletben vagy a popupban; `window.__injected` nincs, nincs page error. Az SSE külön sort frissít, így a két headline a frissítés után is ellenőrizhető marad. **PASS a tesztelt payloadokra** |
| Tiltott localStorage | A getter `SecurityError` kivételt dob; a dashboard, rétegkapcsolás és teljesítménykapcsolás tovább működik alkalmazáskivétel nélkül. **PASS** |
| Üres és hiányzó adat | Minimális üres snapshot kirenderel, az üres rules jelzés érthető. `D=null`, API 503 és SSE 503 mellett sincs renderelési kivétel. Ez a próba javította a hiányzó treasury mező korábbi üresadat-hibáját is. **PASS** |
| Mobil | **390 px** szélességnél nincs vízszintes dokumentumtúlfutás. A beállítások panel a viewporton belül marad, belső görgetéssel elérhető; a rétegkapcsolók és zárógomb olvashatók. **PASS** |
| Statikus és moduláris ellenőrzés | `npm run check`: **97 JavaScript program**, szintaxis és locale-ellenőrzés sikeres. `npm test`: **132 teszt / 11 suite; 131 PASS, 0 FAIL, 1 SKIP**. Az opcionális élőprovider-próba kihagyása nem jelent igazolt élő LLM-integrációt. **PASS** |

A végső scriptfutás `All requested browser QA checks passed.` eredménnyel, **0** kilépési kóddal zárult. A desktop képen a teljes szélességű térkép és a panelrács, a mobil képeken a tördelés és a dialog vizuálisan is ellenőrizve lett.

## Képek

- [Desktop, 1440 × 1000](images/browser-desktop-2026-10-01.png)
- [Mobil beállítások, 390 × 844](images/browser-mobile-settings-2026-10-01.png)
- [Mobil dashboard, 390 × 844](images/browser-mobile-2026-10-01.png)

## Az igazolás határai

Ez Chromium-ellenőrzés; Firefox, Safari, fizikai telefon, valódi érintéses drag/drop és képernyőolvasó nem lett külön kipróbálva. A magyar UI-t ellenőriztük böngészőben, az angol/francia kulcsokat a locale-ellenőrzés vizsgálta. A fixture-ben üres markertípusoknál a szűrés helyességét, nem minden lehetséges adatforrás pozitív élő markerét bizonyítottuk. A zoompróba markerfeliratokra vonatkozik; nem hoz létre új ország/capital felirat-adatbázist.

A fallback próbája a handler és az állapotváltás ellenőrzése, nem egyperces várakozást vagy tartós terheléses futást igazoló soak teszt. A geometria, WebGL-könyvtárak és fontok jelenlegi CDN-függősége miatt ez nem teljes offline térképpróba. Élő külső API-k, valódi LLM-válaszminőség, kiadott tsunami-riasztás vagy teljes XSS/security tanúsítás nem következik ezekből az eredményekből; a részletes kódvizsgálatot a külön auditok tartalmazzák.
