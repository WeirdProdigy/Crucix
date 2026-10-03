# Műszerfal-szerkezet: témalencsék, Ctrl+K, forrás-egészség mátrix, változások, söprés-visszajátszás (2.12.0)

Dátum: 2026-10-03. Részprojekt: **D** a Palantir-szerű ütemtervből (A: rekord-vizsgáló v2.9.0, B: riasztómotor v2.10.x, C: új források v2.11.0 készen; E: intelligencia később). A döntéseket önállóan hoztam meg (a felhasználó kérése: „ne kérdezz, mindig azt fogadd el, amit ajánlasz”); minden döntés indoklással szerepel.

## 1. Cél és sikerkritériumok

A műszerfal ma ~50 forrást, 19 élő forrás-kártyát és tucatnyi panelt mutat, de **nem segít eligazodni**: az élő panel ~3900 px magas, nincs téma szerinti szűrés, nincs globális keresés/parancs, a forrás-egészség egy lapos lista (múlt nélkül), a „mi változott” csak a delta-panel néhány jelzése, és az elmúlt söprések nem nézhetők vissza.

Sikerkritériumok (mérhetők, a QA-fázis és a tesztek ellenőrzik):

1. **Lencsék**: egy kattintással a műszerfal egy téma (domain) köré szűkül: élő forrás-kártyák, forrás-egészség, változás-lista, rekord-böngésző és a térképen az élő rekord-jelölők. „Mind” az alapállapot. A választás böngészőnként megmarad.
2. **Tömör élő panel**: a 19 kártya témánként csoportosítva, alapból összecsukva (1 sor/forrás-csoport); minden csukott állapotban a panel ≤ 420 px magas asztali szélességen (mért), a figyelmet igénylő (nem-ok vagy ≥ HIGH) csoportok automatikusan nyitva.
3. **Ctrl+K / Cmd+K parancspaletta** bárhonnan: akciók (lencse váltás, riasztó-fiók, beállítások, mátrix, visszajátszás…), források megnyitása és élő keresés a rekord-előzményben; teljes billentyűzetes használat, képernyőolvasó-barát.
4. **Forrás-egészség mátrix**: az összes forrás × az utolsó N söprés rácsa (ok / elavult / hiba / kikapcsolva / nincs adat), forrásonként az utolsó futásidővel, téma szerint csoportosítva; a cellák a söprés időpontjára mutatnak.
5. **„Mi változott az előző söprés óta”**: új rekordok (súlyosság szerint), forrás-állapotváltások, delta-jelzések, témánkénti darabszámmal; ablak: előző söprés / 1 óra / 6 óra / 24 óra; fejléc-chip a változások számával.
6. **Söprés-visszajátszás**: időcsúszkával visszalépés a tárolt söprésekre; a műszerfal az akkori állapotot rajzolja újra, az élő frissítés szünetel, egyértelmű „VISSZAJÁTSZÁS” sáv és „Vissza az élőhöz” gomb; semmi sem kerül az offline gyorsítótárba.

Nem cél (YAGNI, indoklással): térképes idő-animáció (a csúszka söpréseket lépked, nem folytonos); a régi, nem-élő térképrétegek lencse-szűrése (a saját réteg-kapcsolóik maradnak); lencse-kombinációk (egyszerre egy téma); a riasztások visszajátszása (a riasztási állapot élő marad, a sáv ezt kimondja); az offline pillanatkép méretvédelmének átalakítása (a mérés szerint a valós adat ~1,8 MiB, a határ 5 MiB; a további kezelés E-ben/javításban).

## 2. Témák (domain-regiszter)

Új, közös adatforrás a szerveren és a böngészőben: `lib/domains.mjs` (a böngészőmásolat: `dashboard/public/domains.js`, **azonos** tartalommal, a `POLICIES` mintájára JSON-egyenlőség-teszttel). Nyolc téma, minden adapter pontosan egyben:

| id | Téma | Források (adapter-nevek az `apis/briefing.mjs`-ből) |
|---|---|---|
| security | Biztonság és konfliktus | GDELT, ACLED, ReliefWeb, ADSB-Military, ADS-B, OpenSky, Maritime, Telegram, Bluesky, Reddit, KiwiSDR |
| hazards | Természeti veszélyek és időjárás | USGS, EMSC, GDACS, Copernicus-EMS, NASA-EONET, FIRMS, Meteoalarm, MET-Norway, Aviation-SIGMET, NOAA |
| space | Világűr | NOAA-SWPC, Space |
| cyber | Kiber és internet | CISA-KEV, FIRST-EPSS, OONI, IODA, Cloudflare-Radar, RIPEstat |
| economy | Piacok és gazdaság | FRED, Treasury, BLS, ECB, YFinance, USAspending, Prediction-Markets, Patents |
| supply | Energia és ellátási lánc | EIA, Energy-Charts-HU, ENTSOG-HU, IMF-PortWatch, GSCPI, Comtrade |
| sanctions | Szankciók és szabályozás | OFAC, OpenSanctions, OpenSanctions-Index, Federal-Register |
| health | Egészség és környezet | WHO, EPA, Safecast |

Összesen 11+10+2+6+8+6+4+3 = 50 adapter. Az export: `DOMAINS` (rendezett tömb `{id, sources}`), `domainOfSource(name)` (ismeretlen → `null`), `domainOfEvent(event)` (a forrás neve szerint, `event.source.name`/`event.sourceName`; ha nincs → `null`). Az eseménytípusok (news, osint, signal) téma nélküliek: csak a „Mind” lencsében látszanak (indok: az általános hírekről nem állítunk témát, amit nem tudunk).

Tesztek: minden `runSource('…')` név és minden `POLICIES` kulcs pontosan egy témában van; minden téma-azonosítónak van en/hu/fr felirata a `lenses` locale-csoportban (új, **kulcsra és sorrendre azonos** parity-teszttel); a böngészőmásolat egyenlő.

## 3. Söprés-archívum (szerver)

A visszajátszás és a mátrix **eltárolt, szintetizált** pillanatképeket igényel (a nyers `briefing_server_*.json` nem újraszintetizálható determinisztikusan: a hírek élő RSS-ből jönnek, az ötletek/delta nincsenek benne, `Date.now()` is szerepel – lásd az Explore-eredményt a munkafájlokban). Ezért új tároló: `lib/sweeps/archive.mjs`, könyvtár: `<RUNS_DIR>/sweeps/`.

- Egy söprés = egy fájl: `sweep-<YYYYMMDDTHHMMSSZ>.json.gz` (a szintetizált objektum **pontosan úgy, ahogy a söprés végén `currentData` lesz**, a `freshLiveSnapshot` előtt; benne a `changes` is), atomi írással (ideiglenes fájl + átnevezés, a `lib/atomic-json.mjs` mintájára).
- Index: `sweeps/index.json` (`writeJsonAtomic`), söprésenként `{id, timestamp, file, bytes, ok, total, health: {<forrás>: [kód, ms]}, changeCounts}`; a `kód`: 0 ok, 1 elavult, 2 hiba, 3 kikapcsolva (a „nincs adat” a hiányzó kulcs). Az `ms` a nyers `timing`-ból jön. Az index **gyorsítótár**: ha hiányzik, sérült vagy nem egyezik a fájlokkal, a tároló a fájlokból újraépíti (a `health` ilyenkor a pillanatkép `health[]`-jából, `ms` nélkül, `null`-lal).
- Megőrzés: `SWEEP_ARCHIVE_COUNT` (alap **96** = 24 óra 15 perces söpréssel; 2–672) és `SWEEP_ARCHIVE_MAX_MB` (alap **64**; 4–512); a régebbi söprések törlődnek, az új fájl és az index sérülése nem érintheti a régit. Indoklás a méretre: a szintetizált objektum mért ~96 KB (hírek nélkül), gzip-pel nagyságrendileg tizedére nő össze; ezt a feladat méri és a kiadási jegyzet a valós számot közli.
- Hiba soha nem állítja le a söprést: az archiválás hibája naplózódik, `archiveStatus` = `unavailable` az `/api/health`-ben (a `historyStatus` mintájára).
- Indításkor a legutóbbi archivált pillanatkép a „változások” alapja (különben az első söprés újraindítás után mindent „újnak” mutatna).

## 4. Változás-számítás (szerver)

`lib/sweeps/changes.mjs`: `buildChanges(previous, current)` tiszta függvény; az eredmény a `current.changes` mező (a söprés végén, az események építése **után**, az archiválás előtt):

```
{ since: <előző söprés ISO ideje | null>, at: <mostani idő>,
  baseline: true|false,            // true: nincs előző pillanatkép -> nem sorolunk fel új rekordokat
  events: { new: [{id,title,kind,source,domain,severity,observedAt}], newTotal, expiredTotal },
  sources: [{source, domain, from, to}],        // forrás-állapotváltások (ok|stale|error|disabled)
  signals: [{key,label,direction,severity,type}],// a current.delta.signals.new/escalated/deescalated egyszerűsítve
  domains: { <témaid>: <darabszám> } }
```

Korlátok (a SSE/PWA méret védelmében): `events.new` ≤ 40 (súlyosság szerint csökkenő, majd újabb előre), `sources` ≤ 30, `signals` ≤ 20; a `*Total` mezők a valós darabszámot mutatják. Új esemény = olyan `id`, amely az előző pillanatképben nem volt; lejárt = volt, most nincs. `baseline: true` esetén a listák üresek (nincs csöndes „árvíz” az első futásnál).

`GET /api/changes?window=last|1h|6h|24h` (alap `last`): a megőrzött söprések `changes`-eit egyesíti az ablakban (esemény-azonosító szerint egyszer, a legkorábbi megjelenéssel; források állapotváltásai időrendben), ugyanazokkal a korlátokkal.

## 5. API (új, csak olvasó, az `intelligence/routes.mjs` mintájára)

Az autentikáció utáni middleware után, szigorú lekérdezés-engedélylistával, hibák: `400 {error, code, field}`, egyéb `503` általános üzenettel, verem nélkül; minden válasz `no-store` (a globális middleware adja).

| Útvonal | Válasz |
|---|---|
| `GET /api/sweeps?limit=` | `{sweeps:[{id,timestamp,ok,total,changeCounts}], retention:{count,maxMb}}`, legújabb elöl, `limit` ≤ 672 |
| `GET /api/sweeps/:id` | a tárolt szintetizált objektum (`id` szigorú minta: `sweep-\d{8}T\d{6}Z`; ismeretlen → 404; **nem** megy át a `freshLiveSnapshot`-on) |
| `GET /api/changes?window=` | lásd 4. pont |
| `GET /api/source-health?sweeps=` | `{sweeps:[{id,timestamp}], sources:[{source,domain,cells:[[kód,ms]|null,…]}]}`, `sweeps` ≤ megőrzés (alap 48), a cellák a `sweeps` sorrendjében (legrégebbi → legújabb) |

## 6. Böngésző

Új modulok (IIFE, `window.CrucixX`, mint a meglévők; mind bekerül a `sw.js` `BASE` listájába; `no regex lookbehind`):

- `clock.js` – `CrucixClock.now()` (valós idő, visszajátszás alatt a pillanatkép ideje), `freeze(ms)`, `release()`. A meglévő `Date.now()`-használatok (élő-forrás frissesség, `sourceState`, `getAge`, `updateRuntimeStatus`, élő-panel frissítő) az órán át mennek; ezek nélkül a visszajátszott élő források „lejártnak” látszanának.
- `lens.js` + `lens-core.js` (tiszta logika) – aktív lencse (`all` | témaid), `localStorage` (`crucix.lens`, try/catch), `matches(item)`, a fejléc alatti **lencse-sáv** (nyolc téma + Mind; gombok `aria-pressed`). A lencse hatása: élő panel csoportjai, forrás-egészség, változás-lista, rekord-böngésző forráslistája, élő jelölők a térképen.
- Az **élő panel tömörítése** (`live-sources.js`): témánkénti csoportok; a fejléc gomb (`aria-expanded`) a téma nevét, a forrás- és rekord-számot, a legrosszabb súlyosságot (A szintjelzők) és a nem-ok forrásokat mutatja; a csoport tartalma a mai kártya változatlanul. Alap: figyelmet igénylő csoport nyitva, a többi zárva; az állapot JS-ben és `localStorage`-ban él (a rail-ek minden frissítéskor újraépülnek). Lencse alatt csak az adott csoport, nyitva.
- `health-matrix.js` – `<dialog>` a mátrixszal (`/api/source-health`), téma szerint csoportosítva, a cella státusza **jellel és szöveggel is** (nem csak színnel: ✓ ok, ◔ elavult, ✕ hiba, – kikapcsolva, · nincs adat), oszlopfejlécben időpont, sorfejlécben az utolsó ms; cellára kattintva a visszajátszás az adott söpréshez ugrik. Megnyitás: a forrás-egészség panel gombja, paletta.
- `changes.js` – „Változások” panel (jobb sáv elejére) + fejléc-chip („Δ 12”, lencse szerint szűrve); ablak-választó (gombok); az esemény-sorok a rekord-vizsgálóban nyílnak (a meglévő nyitási úton), a forrás-sorok a mátrixot nyitják.
- `palette-core.js` (tiszta: pontozás, szűrés, billentyű-logika) + `palette.js` + `palette.css` – Ctrl+K / Cmd+K (a `/` nem, mert a vizsgálóé), `<dialog>` + ARIA combobox/listbox minta (`aria-activedescendant`), ↑↓/Enter/Esc, Tab a bemeneten marad; a gomb-fókusz visszaáll. Találatok: **akciók**, **források** („rekordok megnyitása” / mátrix-sor), **élő keresés** (`≥ 2` karakternél `/api/history?q=…&limit=6`, 200 ms debounce, `AbortController` és kérés-sorszám, hogy a késő válasz ne írja felül az újat). Egy lekérdezés legfeljebb 12 találatot mutat.
- `replay.js` + `replay-core.js` – a visszajátszás állapotgépe: `live` → `loading` → `replay(id)` → `live`. Belépés: fejléc-gomb „Visszajátszás”, mátrix-cella, paletta. A csúszka (`<input type=range>`, `aria-valuetext` az időpontból) és ←/→ léptetés a `/api/sweeps` listán; a söprés betöltése `/api/sweeps/:id`; a betöltés alatt az előző állapot marad. Visszajátszás alatt: `CrucixClock.freeze(pillanatkép ideje)`, az SSE `update` és a 60 s-os lekérdezés **nem alkalmazódik** (a legutóbbi élő pillanatkép félre van téve, a sáv mutatja, hogy van új), az offline gyorsítótárba (`cacheLive`/`markLive`) **nem** ír semmi; a rekord-előzmény/export `/api/history` hívásai tiltottak, helyette a sáv jelzi, hogy a visszajátszott pillanatkép saját rekordjai látszanak; a riasztási sáv/fiók élő marad, a sáv ezt kimondja. Kilépéskor a félretett élő pillanatkép alkalmazódik, `CrucixClock.release()`. Hibánál (404/hálózat) hibaüzenet a sávban, az előző állapot marad.

Hozzáférhetőség: minden új vezérlő billentyűzettel elérhető, látható fókusz, `aria-*` szerepkörök, `prefers-reduced-motion` tiszteletben tartva, szín mellett mindig jel/szöveg, 390 px-en nincs vízszintes görgetés; a lencse-sáv szűk szélességen vízszintesen görgethető vagy törik.

Nyelvek: új locale-csoportok `lenses`, `palette`, `matrix`, `changes`, `replay` en/hu/fr (kulcs- és sorrend-parity-tesztek, mint a `liveSources`/`inspector`/`alerts` csoportoknál).

## 7. Konfiguráció

`SWEEP_ARCHIVE_COUNT` (alap 96, 2–672), `SWEEP_ARCHIVE_MAX_MB` (alap 64, 4–512); az `.env.example`, `docs/OPERATIONS.md`, README konfigurációs táblája frissül. Új kulcs nincs más.

## 8. Hibakezelés és határesetek

- Sérült/hiányzó archívum-fájl: a söprés lista 404-gyel hagyja ki, az index újraépül, a mátrix a hiányzó söprést „nincs adat”-ként mutatja.
- Üres archívum (friss telepítés): a visszajátszás gomb letiltva magyarázattal; a mátrix az aktuális söpréssel mutat egyetlen oszlopot; a „változások” első futáskor `baseline`.
- Óra visszaugrás: az azonosító időbélyegből jön, ütközésnél (azonos másodperc) számláló-utótag nem kell, mert a söprések ≥ 1 percesek; az ütköző fájl felülírása helyett a tároló kihagyja az archiválást és naplóz.
- Hatalmas/hamis pillanatkép: az `/api/sweeps/:id` csak a saját, gzip-ből olvasott, `maxBytes`-korlátos fájlt adja.
- Visszajátszás alatt SSE-kiesés/újracsatlakozás nem lépteti ki a módot.

## 9. Teszt- és ellenőrzési terv

Egységtesztek (node:test; vm a böngészőmodulokra): domain-lefedettség és parity; archívum (írás, megőrzés darab/bájt szerint, index-újraépítés, sérült fájl, ütközés, a kimeneti pillanatkép bájt-azonos); változás-számítás (új/lejárt, baseline, korlátok, állapotváltások, ablak-egyesítés); útvonalak valódi HTTP-n (engedélylista, 400/404/503, útvonal-bejárási kísérlet `id`-ban, `no-store`); órán át a frissesség (befagyasztott idő mellett a régi pillanatkép forrásai `ok`); lencse-logika; paletta-pontozás, versenyhelyzet (késő válasz eldobása), billentyűk; replay állapotgép (SSE alatt nem alkalmaz, kilépéskor igen, a PWA-írás kimarad). Böngésző-QA (Playwright, a fixture-rel): új `structure` fázis az `intelligence-ui-qa.mjs`-ben (lencse, összecsukott panel magassága ≤ 420 px, Ctrl+K, mátrix, változások, visszajátszás belépés/kilépés, 390 px nincs vízszintes görgetés, XSS-es címek). A régi QA-állítások (19 kártya, 19 „megnyitás” gomb) a csoportok kibontása után érvényesek.

Kiadás előtt: `npm test`, `npm run check`, `npm audit --omit=dev`, a teljes tesztcsomag **Node 22**-n is, valós söprés + archiválás mérés.
