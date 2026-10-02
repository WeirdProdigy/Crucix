# Crucix rekordböngésző: Inspector panel és teljes képernyős böngésző — 2.9

A felhasználó azt kérte, hogy a Crucix a Palantir mintájára mindent figyeljen, jelezzen és előre gondolkodjon. Ehhez a 2026-10-02-i kutatás (hasonló projektek, Palantir-minták, UI/UX, új adatforrások, kódbázis-felmérés) alapján öt részprojektet választottak, mindegyik saját specet, tervet és GitHub release-t kap:

| Rész | Tartalom | Kiadás |
| --- | --- | --- |
| **A (ez a spec)** | Rekordböngésző: összegző kártyák, Inspector panel, teljes képernyős böngésző, közös súlyossági nyelv | 2.9.0 |
| B | Riasztási motor és felület: szabályok, életciklus, frissességi riasztás, a kilenc friss forrás bekötése | később |
| C | Új adatforrások, hullámokban | később |
| D | Dashboard-szerkezet: lensek, Ctrl+K, forrás-egészség mátrix, „mi változott", visszajátszás | később |
| E | Intelligencia: entitás/link, konvergencia, országkockázat, előrejelzés, AI-összefoglaló | később |

Sorrend: A, B, C (első hullám), D, E. Az A azért az első, mert a megnevezett fájdalompontot oldja meg, és a B-hez szükséges közös megjelenítési nyelvet adja.

## Probléma

A „Friss nyilvános adatok" blokk ([live-sources.js](../../../dashboard/public/live-sources.js)) forrásonként egy kártyát rajzol, és a „Rekordok megnyitása" gomb az összes rekordot soronként egy `<details>` elembe írja a kártyán belül. A GDACS megnyitva 100 sort tesz egy 340 pixeles jobb sávba, egy 540 pixeles görgetődobozban. Ezen felül:

- a súlyosság, az ország és a típus megvan az adatban, de nem jelenik meg;
- az adaptereknél számolt, forrásspecifikus mezők (EPSS-érték, árfolyam, hőmérséklet, szélsebesség) nem jutnak el a felületre;
- a rekord eseménypárját a panel minden rajzoláskor cím és időbélyeg alapján keresi (`events.find`), ez rekordok × események költségű;
- minden SSE-frissítés újraépíti a jobb sávot, ezért elvész a görgetési pozíció;
- az eredeti forráslink eseménypár esetén nem látszik, csak a felugró ablakban érhető el.

## Megőrzendő működés

A `window.CrucixLiveSources` felület `policies`, `state`, `observations`, `renderPanel(sources, t, events, now)` tagjai és a `policies` egyezése az `apis/utils/freshness.mjs` `POLICIES` listájával. A „csak friss adat" szabály: lejárt vagy ismeretlen idejű rekord nem jelenik meg. A hostile címek escape-elése, a csak http(s) link és a tokent hordozó query kizárása (`safeUrl`). A térképrétegek és a `jarvis.html` többi része, a meglévő eseményrészletező (`CrucixIntelligence.openEvent`) és a történet. Operátori `.env` és privát adat nem kerül tesztbe vagy kiadásba. Nincs új külső függőség.

Nem része az A-nak: riasztások (B), új források (C), lensek, Ctrl+K és visszajátszás (D), kilenc, ma sehol nem megjelenő adapter megjelenítése.

## Felépítés

### Kártya

A `renderPanel` forrásonként összegző kártyát ad: forrásnév (linkkel), állapot, életkor, rekordszám, súlyosság szerinti jelvények (alakzat, szám), a három legfontosabb rekord címe és egy „Megnyitás" gomb (`data-open-records`). Az inline `<details>` és a `setExpanded` megszűnik. Hibás vagy lejárt forrásnál a kártya az okot mutatja, rekordot nem.

### Új modulok: `record-core.js`, `record-inspector.js` és `record-inspector.css`

A tiszta logika a `record-core.js`-ben él (`window.CrucixRecords`), a HTML-sztringet előállító megjelenítés és a vékony DOM-vezérlő a `record-inspector.js`-ben (`window.CrucixRecordInspector`). Így a logika és a megjelenítés külön, vm-kontextusban tesztelhető. A tiszta függvények:

- `severityLevel(value)`: a hétfokú eseményskálát négy megjelenített szintre képezi (lásd lent).
- `filterRecords(records, filters)` és `sortRecords(records, key)`: súlyosság, időablak (1 ó, 6 ó, 24 ó, mind), szöveg (ékezetfüggetlen, legfeljebb 80 karakter) szerint; rendezés alapból súlyosság csökkenő, majd idő csökkenő, alternatíva idő vagy cím.
- `parseHash(string)` és `serializeHash(state)`: szigorú engedélylistával (forrás `policies` kulcs vagy `all`, súlyosság a négy szint egyike, szöveg korlátozva, rekordazonosító csak `event-` előtagú hash). Érvénytelen érték eldobódik.
- Egyetlen állapottároló: `{ source, record, filters, browserOpen }`. Az állapot változása URL-hash-t ír (`replaceState`, nem tölti a naplót ismételten), a `hashchange` visszaolvassa.

### Inspector

Külön `<aside id="record-inspector">`, a `body` gyermeke, a jobb sávon kívül. A jobb sáv újrarajzolása ezért nem érinti. Frissítéskor rekordazonosító alapján módosítja a listát, a görgetési pozíciót és a kijelölést megtartja. Tartalma:

1. fejléc: forrásnév, állapot, életkor, licenc és forrásmegjelölés, bezáró gomb, „Kibontás" gomb a böngészőhöz;
2. szűrők: súlyosság-jelvények (kapcsolhatók), időablak, szövegmező, rendezés;
3. rekordlista: lapozott, 25 elem, „még 25 mutatása"; minden sor súlyosság-jel, cím, hely vagy ország, relatív idő;
4. részlet a kiválasztott rekordról: teljes összefoglaló, a szolgáltatói, előrejelzési, kezdési és érvényességi idő, hely, `facts` lista, az eredeti link (mindig látható), és „Részletek" gomb, ami a meglévő eseményrészletezőt nyitja, ha van eseménypár.

Széles ablakon jobbról csúszó, 480 pixeles panel, a térkép és az oldalsáv látható marad. 700 pixel alatt alulról felcsúszó, teljes szélességű panel.

### Teljes képernyős böngésző

Natív `<dialog>` `showModal()`-lal, három oszlop: források (rekordszámmal és súlyosság-jelvényekkel, plusz „Minden forrás"), rekordlista ugyanazokkal a szűrőkkel, részlet. A „Minden forrás" a pillanatnyi snapshot `events` listáját használja, így a nem élő források rekordjai (USGS, NOAA, WHO, hírek és a többi) is böngészhetők. Keskeny ablakon az oszlopok egymás utánira váltanak. A szerveroldali történet és export a meglévő történetablakban marad, ezt a spec nem duplikálja.

### Adat

- **Rekord és esemény összekötése:** a szintézis után minden élő rekord `eventId` mezőt kap, ugyanabból az azonosítási logikából, amelyet az `events.mjs` használ (provider-azonosító, URL, vagy cím és idő). A kliens az azonosítóval indexel, a cím és idő szerinti keresés megszűnik. Az azonosítók stabilak maradnak az újraindulás után.
- **`facts`:** a `normalizeLiveSources` rekordonként legfeljebb 8 `{label, value}` párt állít elő (címke legfeljebb 40 karakter, érték legfeljebb 120 karakteres szöveg, véges szám vagy logikai érték), a többi mezővel azonos szűréssel. Az adapterek ezeket a mezőket (EPSS, ECB, MET-Norway, GDACS, EONET, OONI, RIPEstat, Meteoalarm) ma is rekordszinten adják át, csak a normalizálás dobja el őket. Ezért adapter nem változik: a `normalizeLiveSources` forrásonkénti engedélylistából emeli át a már kiszámolt mezőket, és a már normalizált `facts` listát újranormalizáláskor is megtartja. Amit az adapter nem ad, azt nem találjuk ki.
- **Súlyosság az eseménymodellben:** az `events.mjs` ma csak a `critical`, `high`, `moderate`, `low`, `elevated`, `monitor` szavakat és az `extreme`, `severe`, `minor` álneveket ismeri, minden mást `unknown`-ra képez. Így a GDACS `Red/Orange/Green` és az OONI `medium/info` szintje elvész. Az A kiegészíti az álneveket (lásd lent), hogy a súlyosság valóban használható legyen.
- A rekordok korlátja a mai szint marad: forrásonként legfeljebb 100.

### Közös súlyossági nyelv

Az eseményskála (`unknown < monitor < low < moderate < elevated < high < critical`) négy megjelenített szintre képződik, CSS-tokenekben, alakzattal és színnel együtt. A szolgáltatók saját szavait (`Red/Orange/Green`, `Extreme/Severe/Moderate/Minor`, `medium`, `info`) az `events.mjs` álnevei és a böngészőoldali `severityLevel` ugyanazzal a táblával kezeli, ezt teszt őrzi:

| Megjelenített | Eseményskála | Szolgáltatói álnevek | Jel | Szín (Okabe-Ito alapú) |
| --- | --- | --- | --- | --- |
| CRITICAL | critical | extreme, severe, red | ◆ | `#D55E00` |
| HIGH | high, elevated | orange | ▲ | `#E69F00` |
| WATCH | moderate | medium, yellow | ● | `#F0E442` (sötét témán olvasható) |
| INFO | monitor, low | minor, info, green | ○ | `#56B4E9` |
| (nincs jel) | unknown | minden más | – | halvány szürke |

A `monitor` a skála legalsó ismert szintje, ezért INFO: az ECB-árfolyamok és az előrejelzések nem jelenhetnek meg figyelmeztetésként.

A szín soha nem az egyedüli jelzés. A tokenek a `live-sources.css`-től független helyen, a `record-inspector.css` elején élnek, hogy a B riasztásai ugyanazokat használják.

## Viselkedés

- A kártya „Megnyitás" gombja az Inspectort nyitja az adott forrással. Ha a felhasználó bezárja, zárva marad, amíg újra nem nyitja; az SSE-frissítés nem nyitja vissza.
- Esc bezárja, a fókusz visszakerül a kártyára. A lista roving tabindexes, `aria-selected` jelöléssel. Billentyűk: `j` és `k` lépked, Enter részletet nyit, `/` a keresőre ugrik, `e` a teljes böngészőt nyitja.
- Ha a megnyitott rekord frissítés közben kiesik a friss körből, szürkén marad „már nem aktuális" címkével, amíg be nem zárják vagy másikat nem választanak. Nem tűnik el olvasás közben.
- Hibás vagy lejárt forrásnál az Inspector az okot és az utolsó sikeres időt mutatja, rekordot nem. Ha nincs aktuális rekord a figyelt körben, ezt kiírja.
- `prefers-reduced-motion` tiszteletben tartva: csúszás helyett azonnali megjelenés.
- Minimum 4,5:1 kontraszt a szövegre, 3:1 az ikonokra. Érintési célpontok mobilon legalább 44 pixelesek.

## Teljesítmény és biztonság

A hosszú listák soraira `content-visibility:auto` és `contain-intrinsic-size`, külső könyvtár nélkül. Minden szöveg escape-elt vagy `textContent`-tel kerül be, hostile címek, összefoglalók és `facts` értékek nem hajthatnak végre kódot. Link csak http(s), credential és tokenes query nélkül. Az URL-hash csak az engedélylistán átmenő értékeket fogadja. Nem kerül adat a böngészőtárolóba; az állapot a hash-ben és a memóriában él.

## i18n

Új szövegek mindhárom nyelvben (`locales/en.json`, `hu.json`, `fr.json`). Új teszt ellenőrzi, hogy a három fájl `liveSources.*` és az új `inspector.*` kulcskészlete egyezik. A `npm run check` továbbra is parse-olja a fájlokat.

## Tesztek

- `node:test`, vm-kontextus az új modulra: `severityLevel` minden eseményszintre, szűrés és rendezés, hash-szerializálás és érvénytelen hash eldobása, escape hostile címekre és `facts` értékekre, állapotok (ok, hibás, lejárt, üres).
- A meglévő `test/live-sources-integration.test.mjs` átíródik: a `setExpanded` és `<details open>` ellenőrzés a „kiválasztott forrás" állapotra vált, a `policies`-egyezés, az escape és a `renderPanel` aláírás megmarad.
- Szerveroldali teszt az `eventId` bélyegzésre és a `facts` normalizálásra (korlátok, típusok, kizárt mezők).
- A `intelligence-ui-qa` Playwright szkript kibővül az Inspector és a böngésző végigjátszásával desktop és mobil méreten, képernyőképekkel. A fixture nem olvas `.env`-t.
- Kiadás előtt `npm test` és `npm run check` zöld.

## Kiadás

2.9.0 (új felület, minor emelés): `package.json`, `package-lock.json`, `sw.js` cache (`crucix-shell-v2.9.0`), az új `record-inspector.js` és `record-inspector.css` a service worker `BASE` listájába és a `jarvis.html`-be. HU/EN kiadási jegyzet a `docs/releases/v2.9.0.md` alatt és CHANGELOG-bejegyzés, README-ben a funkció rövid leírása. Tag, push a `fork` remote-ra, `gh release create`, majd a CI-futások linkjeit rögzítő docs-commit `[skip ci]` jelöléssel.

## Kockázatok

- Az eseményazonosító-logika kettéválása az `events.mjs` és a bélyegzés között hibát okozhat. Mérséklés: egyetlen közös függvény, és teszt arra, hogy a bélyegzett azonosító egyezik az `events.mjs` által adott eseményével.
- A `facts` adapterenként eltérő mezőket hoz. Mérséklés: korlátos formátum és hiányzó érték esetén nincs kitaláció.
- A jobb sáv újrarajzolása és az Inspector állapotának szétválasztása. Mérséklés: az Inspector a sávon kívül él, és rekordazonosító szerint frissül.
