# Intelligencia-réteg: országkockázat, naplózott előrejelzések, entitás-kapcsolatok, konfliktus-előrejelzés és hivatkozott AI-összefoglaló (2.13.0)

Dátum: 2026-10-03. Részprojekt: **E** a Palantir-szerű ütemtervből (A rekord-vizsgáló 2.9.0, B riasztómotor 2.10.x, C új források 2.11.x, D műszerfal-szerkezet 2.12.x készen). A döntéseket önállóan hoztam meg (a felhasználó kérése: „ne kérdezz, mindig azt fogadd el, amit ajánlasz”); minden döntés indoklással szerepel. A kutatási és kód-tényeket a `.superpowers/sdd/e-facts-code.md` és az `e-facts-forecast-sources.md` őrzi (helyi, git-en kívüli).

## 1. Cél és sikerkritériumok

A műszerfal ma jól mutatja, **mi történt**, de nem mondja meg, **hol** gyűlik a baj, **mennyire megbízhatóan** jelezzük előre, és **mire hivatkozva** állítunk bármit. Az E részprojekt egy átlátható, ellenőrizhető intelligencia-réteget ad:

1. **Országkockázat 0–100**, minden országra, teljesen átlátható felbontással (összetevők, súlyok, lefedettség), a mért adatból; nincs kitalált összetevő: ami hiányzik, azt nem pótoljuk, hanem a lefedettség jelzi.
2. **Naplózott előrejelzések**: a rendszer naponta országonként felírja, hogy „a következő 7 napban lesz-e legalább egy új, ≥ MAGAS szintű fizikai esemény az országban”, 7 nap után a tárolt adatból kiértékeli, és mutatja a **mérhető hatékonyságot** (Brier-pontszám, megbízhatósági táblázat, az alap-gyakoriságos előrejelzőhöz mért „skill”). Az elején őszintén „még nincs elég kiértékelt előrejelzés (n=…)”.
3. **Országhoz kötött entitás- és kapcsolat-réteg**: minden eseményt országhoz kötünk (ahol a hely megbízható, ott a koordinátából, egyébként csak a címben nevesített országhoz), és az országok közötti közös említésekből kapcsolatokat számolunk („kapcsolódó országok”).
4. **Konfliktus-előrejelzés**: a VIEWS (Uppsala/PRIO) nyílt, kulcs nélküli országszintű előrejelzése és az INFORM Risk Index (EU JRC) alapkockázati mutatója új forrásként, az országkockázat egy-egy összetevőjeként és az országlapon megjelenítve. (Az ACLED CAST **nem** használható: ingyenes/Gmail-fiókhoz nincs API-hozzáférés, az EULA a saját műszerfalon való megjelenítést nem engedi; bizonyíték a kiadási jegyzetben.)
5. **Hivatkozott AI-összefoglaló** (globális vagy országonkénti): minden állítás legalább egy **valódi** rekordra hivatkozik, a szerver a hivatkozásokat ellenőrzi és eldobja az érvénytelent; LLM nélkül (vagy hibánál) determinisztikus, szabály-alapú összefoglaló ugyanebben a formában.
6. **Műszerfal**: „Országkockázat” panel (rangsor, változás, lefedettség, konvergencia-jelzés, „teljesítmény”-szakasz), országlap-párbeszédablak (összetevők, sparkline, előrejelzés, alapkockázat, friss rekordok, kapcsolódó országok), összefoglaló-ablak; belépési pontok: panel, térkép-kattintás az országra, Ctrl+K paletta.
7. **Riasztás**: két új mérőszám (`risk_max_score`, `risk_countries_high`), amelyekre a meglévő küszöb-/változás-szabályok működnek.

Nem cél (YAGNI, indoklással): szervezet/szereplő felismerés (NER) – nincs megbízható, függőségmentes módszer, a hamis kapcsolat rosszabb, mint a hiány; ACLED CAST; admin1/rács szintű előrejelzés; a VIEWS-előrejelzés utólagos pontozása (nincs hozzá tényadatunk); több felhasználós figyelőlisták; országok lencse-szűrése (az országnak nincs „témája”: a panel a lencsétől független, ezt a jegyzet kimondja).

## 2. Országazonosítás (alap)

Az események ma **nem hordoznak országot** (`location.label` keveri), és nincs gazetteer. Új, függőségmentes modulok:

- `lib/intelligence/countries.mjs`: az ISO 3166-1 országok (kb. 249 bejegyzés): `iso3`, `iso2`, `num` (ISO numerikus), `name` (angol), `aliases` (gyakori és hivatalos nevek), `ambiguous` (igaz, ha a név szövegben félreérthető: Georgia, Jordan, Chad, Niger-Nigeria határeset, Guinea-változatok, Korea önmagában, Congo önmagában, Dominica…). Kiadott függvények: `COUNTRIES`, `countryByIso3`, `countryByIso2`, `countryByNum`, `countriesInText(text, {limit:3})`. A szövegkeresés **soha nem épít reguláris kifejezést bemenetből**, a szöveget keresés előtt 600 karakterre vágja, szavakra bontja, 1–3 szavas, nagybetűvel kezdődő sorozatokat keres a névtáblában (leghosszabb találat előre); az `ambiguous` nevek **nem** illeszkednek címekből (csak strukturált mezőből).
- `lib/intelligence/geo.mjs`: a már mellékelt `dashboard/public/vendor/countries-110m-2.0.2.json` (world-atlas, 177 alakzat, ISO numerikus azonosítóval) betöltése és dekódolása Node-ban (TopoJSON ívek), `countryAt(lat, lon)` → `iso3|null` (befoglaló doboz-előszűrés + ray casting; hosszúság normalizálás; a kis országok/szigetek, amelyek nincsenek a 110m rétegben, `null`-t adnak). Teszt: minden alakzat feloldódik a gazetteerben.

Esemény → ország kapcsolat (`lib/intelligence/entities.mjs`):
- **`located`** (fizikai hely): ha `location.method` megbízható (`provider`, `polygon-centroid`, `polygon-vertex-mean`, `configured-point`, `forecast-grid`), akkor `countryAt(lat, lon)`; emellett a `location.label` országnevei is `located`-nek számítanak.
- **`mentioned`**: a hírek/osint/jel típusú és a nem megbízható helyű (`headline-keyword`, `country-centroid`, `theater-centre`, `unknown`) események címéből/összefoglalójából `countriesInText`. A kulcsszavas elhelyezés **nem** számít országhelynek (a mért hiba: a „World” 0,0-ra, a „Trump” Washingtonra teszi).
- Egy esemény legfeljebb 3 országhoz kötődik. A hozzárendelés **determinisztikus**, az esemény azonosítóján gyorsítótárazott.

## 3. Entitás-tároló és kapcsolatok

`runs/intelligence/countries.json` (atomi írás, `{version, events, series, links}`): eseményenként `{c:[iso3], m:'l'|'m', l:szint, k:fajta, o:megfigyelés ideje, t:először látva}`; országonként idősor; országpárok közös említés-számlálója (7 nap). Megőrzés: `RISK_RETENTION_DAYS` (alap **35**, 14–90), legfeljebb 20 000 eseményhivatkozás; a lejárt hivatkozások és a rájuk épülő kapcsolatok törlődnek. Betöltési hiba → üres tároló, a szerver nem áll le.

## 4. Kockázati modell (`lib/intelligence/risk.mjs`, `RISK_MODEL_VERSION`)

Országonként 0–100 pontszám, hat összetevő (mindegyik 0–100), a hiányzót kihagyjuk és a többit újranormáljuk, a `coverage` a rendelkezésre álló súlyok összege:

| összetevő | súly | tartalom |
|---|---|---|
| events | 0,35 | `located` események az utolsó 24 órában, súlyozva: kritikus 8, magas 4, figyelmeztető (watch) 1, info 0,25, az idő szerinti csengő-lecsengéssel, telítődő leképezéssel (100·(1−e^(−x/k))) |
| persistence | 0,15 | hány különböző napon volt ≥ MAGAS `located` esemény az utolsó 7-ből (/7) |
| diversity | 0,15 | hány különböző fajta (kind) volt ≥ MAGAS az utolsó 24 órában (/4, max 100) |
| attention | 0,10 | a `mentioned` hírek 24 órás száma a megelőző 6 nap átlagához képest (csak a többletet számoljuk) |
| forecast | 0,15 | VIEWS `main_dich` × 100 az aktuális hónapra (ha van) |
| baseline | 0,10 | INFORM × 10 (ha van) |

`RISK_KINDS` (fizikai tevékenység): conflict, disaster, earthquake, weather, health, outage, cyber. A repülési, piaci, energia-, szankciós, gazdasági és előrejelzés-fajták nem számítanak. **Konvergencia**: ha egy országban 24 órán belül ≥ 3 különböző `RISK_KINDS` fajta ≥ MAGAS szinten van, az ország konvergens (jelzés + a fajták listája). A mutatott `change24h` az idősorból jön (nincs adat → `null`, nem 0).

## 5. Naplózott előrejelzések (`lib/intelligence/predictions.mjs`)

- **Előrejelzés** (országonként legfeljebb naponta egy, csak ha az országnak pontszáma ≥ 10 vagy az utolsó 7 napban volt `located` `RISK_KINDS` eseménye): „a következő 7 napban lesz-e legalább egy ÚJ (az előrejelzés után először látott), ≥ MAGAS szintű, `RISK_KINDS` fajtájú, `located` esemény az országban”.
- **Mondott valószínűség**: a pontszám-sáv (10 széles) eddig kiértékelt előrejelzéseinek tényleges gyakorisága, ha a sávban ≥ 20 kiértékelt van, különben `pontszám/100` és `uncalibrated` jelzés.
- **Kiértékelés**: a horizont (7 nap) lejárta után a tárolt eseményhivatkozásokból, rögzítve a kimenetet; a kiértékeltek 90 napig maradnak. Tároló: `runs/intelligence/predictions.json` (atomi, korlátos: legfeljebb 20 000 sor).
- **Mérőszámok**: kiértékelt/nyitott darabszám, alap-gyakoriság, Brier-pontszám, az alap-gyakoriságos előrejelző Brier-pontszáma, `skill = 1 − Brier/BrierAlap`, sávonkénti megbízhatósági táblázat. Amíg a kiértékeltek száma < 30, a felület „még nincs elég adat”-ot mutat.

## 6. Új források (kulcs nélkül, sima források, nincs élő-sor/POLICIES)

- **`VIEWS-Forecast`** (`apis/sources/views.mjs`): a gyökérlista (`GET https://api.viewsforecasting.org/`) legnagyobb `^fatalities\d+_\d{4}_\d{2}_t\d+$` azonosítójú futása (a `current` alias 422-t ad), majd `GET /{run}/cm/sb?month=…&month=…&month=…` a futás adathónapját követő három hónapra (`month_id = (év−1980)·12+hónap`; az ismétlődő `month` VAGY-kapcsolat). Megtartott mezők: `isoab, name, month_id, year, month, main_dich, main_mean`. Gyorsítótár: a lista 24 óra, az adat a futás azonosítójához kötve; utolsó jó válasz 45 napig (`stale` jelzéssel), a futás azonosítója a felületen látszik. Hozzárendelés: legfeljebb 2 kérés/briefing-hívás.
  Hivatkozás: „Conflict forecasts: VIEWS (Uppsala University and PRIO), run <futás>. Hegre et al. 2022, 'Forecasting fatalities'; Hegre et al. 2021, J. Peace Research 58(3).” **Licenc:** az API-adatra nincs közzétett licenc (a kód CC BY-NC 4.0); nem kereskedelmi használat összhangban van vele; a jegyzet ezt szó szerint közli, CC BY 4.0-ról nem állít.
- **`INFORM-Risk`** (`apis/sources/inform.mjs`): `GET …/Workflows/GetByYear/<év>` az aktuális kiadás `WorkflowId`-jához (a legutóbb közzétett), majd `GET …/Countries/Scores/?WorkflowId=<id>&IndicatorId=INFORM` (191 sor, ~24 KB). Gyorsítótár 7 nap. Hivatkozás: „INFORM Risk Index, European Commission Joint Research Centre (DRMKC) / INFORM partnership, <kiadás>.” Licenc: az oldalon csak „INFORM is open-source”; a jegyzet ezt idézi.
- Mindkettő bekerül a témaregiszterbe (D: `security`), a `runSource` hívásokba, az adapterszámokba (50 → 52), és az országkockázat a nyers `rawData.sources`-ból olvassa őket (nem az élő-sor úton); hiba esetén az összetevő hiányzik, a lefedettség ezt mutatja.

## 7. Szerver és API

A söprés sorrendje (a D archívum előtt, a riasztások előtt): események (`recordSnapshotEvents`) → **kockázati lépés** (`synthesized.risk`) → riasztási lépés → archiválás → `currentData`. A kockázati lépés **soha nem dob**, hibánál naplóz és `risk` nélkül megy tovább (`riskStatus: 'unavailable'` a `/api/health`-ben). `synthesized.risk = {version, at, top:[≤15 {iso3,name,score,change24h,coverage,convergence}], counts:{scored,high}, calibration:{n,brier,skill}|null}` (kicsi: a PWA/SSE terhe nem nő; az archivált pillanatkép is tartalmazza, a visszajátszás ezt mutatja).

Új, csak olvasó útvonalak (a `lib/intelligence/routes.mjs` mintájára, szigorú engedélylista, `/api` JSON hibakezelő a D-ből): `GET /api/countries`, `GET /api/countries/:iso3` (szigorú ISO3-minta, ismeretlen → 404), `GET /api/predictions`. **`POST /api/briefing`** `{scope:'global'|<ISO3>}` – `requireSameOriginJson` (mint a riasztó-útvonalak, azonos gazdagép-védelem), 1 KB-os törzs, `scope` ellenőrzése a gazetteer ellen.

Riasztási mérőszámok (`lib/alerts/metrics.mjs`): `risk_max_score` (a legmagasabb pontszám, `snapshot.risk.top[0]`), `risk_countries_high` (a ≥ 70 pontszámú országok száma); felirat en/hu/fr, mértékegység-kulcs; null, ha a `risk` hiányzik.

Konfiguráció: `RISK_ENABLED` (alap `true`), `RISK_RETENTION_DAYS` (alap 35, 14–90), `LLM_BRIEFING_MAX_TOKENS` (alap 1200), `LLM_BRIEFING_TIMEOUT_MS` (alap 60000); `.env.example`, `docs/OPERATIONS.md`, README.

## 8. Hivatkozott összefoglaló (`lib/llm/briefing.mjs`)

- Bemenet: globális hatókörnél az utolsó 24 óra legjelentősebb (szint szerint, majd frissesség szerint) legfeljebb 40 eseménye és a top 5 ország pontszámai; országhatókörnél az ország `located`/`mentioned` eseményei (legfeljebb 40). Minden sor `[n]` sorszámot kap (n=1..N); a modell **a sorszámokat** idézi, a szerver képezi le eseményazonosítóra.
- Kimenet (a modelltől JSON): legfeljebb 8 pont `{text, refs:[n…]}`; a szerver eldobja az érvénytelen sorszámot, az érvényes hivatkozás nélküli pontot, a jelölőnyelvet eltávolítja, a szöveget 400 karakterre vágja (surrogát-biztosan), a HTML-t a böngésző escape-eli. A modell kimenete nem megbízható (a prompt a meglévő „untrusted observations” védelmet használja).
- Szabály-alapú tartalék (ugyanaz az alak, `source:'rules'`): a legjelentősebb események és a pontszámváltozások sablonmondatokkal, mindegyik valódi hivatkozással. LLM nélkül, időtúllépésnél, hibánál vagy érvénytelen kimenetnél ez fut.
- Gyorsítótár `scope|nyelv|söprés` kulccsal; azonos kulcsra egyszerre egy generálás; nyelv a `CRUCIX_LANG`-ból; a `purpose: 'briefing'` a `lib/llm/budgets.mjs`-ben új bejegyzés (`LLM_BRIEFING_*`).

## 9. Böngésző

Új modulok (IIFE `window.CrucixX`, a `sw.js` `BASE` listájába, nincs lookbehind, escape mindenhol, nincs inline kezelő): `risk.js` (+`risk.css`): **Országkockázat panel** (id `countryRisk`, az `changes` után a jobb sávban; a három helyen regisztrálva + a profilokban + `panels.countryRisk`; a D-ben bevezetett „soha nem látott elrendezés → felülre” szabály érvényes rá is); rangsor top 10 (név gomb, pontszám sáv + szám, változás ▲/▼/– jellel és szöveggel, lefedettség, ◆ konvergencia), „Teljesítmény” szakasz (kiértékelt n, Brier, skill, megbízhatósági táblázat vagy „még nincs elég adat”); `country.js` (+`country.css`): **országlap `<dialog>`** (`GET /api/countries/:iso3`: pontszám és összetevő-táblázat súllyal és elérhetőséggel, sparkline SVG szöveges alternatívával, VIEWS 3 hónap + futás azonosító + hivatkozás, INFORM + hivatkozás, konvergencia, friss rekordok (megnyitás a vizsgálóban a meglévő `CrucixIntelligence.openEvent` úton), kapcsolódó országok (gomb → másik országlap)); `briefing.js` (+`briefing.css`): **összefoglaló-ablak** (hatókör-választó, „Készítés” gomb, betöltés/hiba/tartalék állapot, a pontok hivatkozás-chipekkel `[n]` → rekord megnyitása; jelölés „AI által készítve a hivatkozott rekordokból” / „Szabály-alapú összefoglaló”; az ország-hatókör a top országokból és a palettából választható).
Belépési pontok: a panel sorai; **térképkattintás** a lapos térkép országalakzatára (ma nincs kezelő); a **paletta** (D `paletteActions`): „Ország megnyitása: <név>” a top országokra és a begépelt országnévre (gazetteer), „Összefoglaló”.
**Visszajátszás alatt** (D): az országlap és az összefoglaló a jelenlegi tárolót olvassa → tiltva, a visszajátszás-jegyzettel; a panel az archivált pillanatkép saját `risk` mezőjét mutatja. Az `D.risk` a `normalizeSnapshot`-ba és a PWA `KEYS`-be kerül (kicsi).
Hozzáférhetőség/nyelvek: mint D (glyph + szöveg, billentyűzet, 390 px, kényszerített színek, redukált mozgás); locale csoportok `risk`, `country`, `briefing` en/hu/fr kulcs- és sorrend-parity-teszttel.

## 10. Hibakezelés és határesetek

Üres/sérült tároló → üres állapot; VIEWS/INFORM kiesés → hiányzó összetevő + lefedettség; `risk` hiányzik a pillanatképből (indításkor) → a panel nyugodt „még nincs adat”; ismeretlen/kamu ISO3 → 404; az események országhozzárendelése hamis pozitívat kerül (nincs `ambiguous` név a címekből, nincs kulcsszavas hely); LLM hiba → szabály-alapú; túl hosszú/rosszindulatú cím → vágás + escape; óraugrás → az idősor monoton marad (visszalépő időbélyeg kihagyva).

## 11. Teszt- és ellenőrzési terv

Egységtesztek: gazetteer (lefedettség a világ-alakzatokra, ambiguity, hostile/1e6 karakteres szöveg időkorláttal), geo (PIP: ismert pontok, antimeridián, óceán → null), entitások (located/mentioned szabályok, kulcsszavas hely kizárva, limitek, megőrzés, kapcsolatok), kockázat (összetevők, újranormálás, konvergencia, monotonitás, determinizmus), előrejelzések (naplózás, kiértékelés, kalibráció, Brier, határesetek), források (rögzített mintákkal, alakváltozás → hiba, gyorsítótár, licenc-mezők), útvonalak valódi HTTP-n, összefoglaló (érvénytelen hivatkozás eldobva, hivatkozás nélküli pont eldobva, jelölőnyelv eltávolítva, tartalék, versenyhelyzet), böngészőmodulok (vm). Böngésző-QA: új `intelligence` fázis (panel, országlap, térképkattintás, paletta, összefoglaló, visszajátszás-tiltás, 390 px, XSS). Kiadás előtt: `npm test`, `npm run check`, `npm audit --omit=dev`, a teljes csomag **Node 22**-n, **CRLF-klónban** (Windows CI) és valós söprés (országhozzárendelési arány, pontszámok, VIEWS/INFORM valós válasz) – mért számokkal.
