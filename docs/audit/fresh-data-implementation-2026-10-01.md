# Friss adatforrások — megvalósítás és ellenőrzés

Felhasználói feltétel: csak naprakész adatú forrás integrálható. A korábbi [forráskutatás](free-data-sources-2026-10-01.md) jelöltlistájából kilenc adapter készült. World Bank éves adata nem került be; Eurostat és a kulcsos/feltételesen ingyenes jelöltek sem részei ennek a kiadásnak.

## Élő ellenőrzés

2026-10-01 23:30–23:36 Europe/Budapest (21:30–21:36 UTC), közvetlen adapterhívásokkal, operator `.env`, botok, LLM és teljes sweep futtatása nélkül. Ez pillanatnyi szolgáltatói próba; a folyamatos működést frissességi ellenőrzés védi.

| Forrás | Szolgáltatói adatidő UTC | Elfogadott rekord | Szűrés / ütem |
| --- | --- | ---: | --- |
| Meteoalarm HU/AT/DE | 2026-10-01 21:05:24 | 84 | Feed ≤3h; figyelmeztetés ≤48h, még érvényes. HU/AT külön friss, üres feed |
| GDACS | Feed 2026-10-01 21:25:01 | 100 | Feed ≤6h; eseményfrissítés ≤72h; `iscurrent`, jövőbeli kezdés kizárva; 223 vizsgált bejegyzés |
| NOAA SWPC | 2026-10-01 21:28 | 0 riasztás | ≤1h; R0/S0/G0 értékek láthatók, riasztást nem találunk ki |
| ECB | 2026-10-01, napi pontosság | 4 | Napi EUR referenciaárfolyam; ≤5 nap hétvége/ünnep miatt. EUR/HUF 367.18 |
| NASA EONET | Legfrissebb geometria 2026-10-01 12:00 | 8 | ≤72h; legutolsó geometria, nem az esemény első napja |
| RIPEstat | 2026-10-01 16:00 | 1 | 00/08/16 UTC BGP-pillanatkép, ≤8h; AS5483 |
| FIRST EPSS | 2026-10-01, napi pontosság | 20 | ≤48h; az elmúlt 7 napban először pontozott CVE-k, következő 30 napra vonatkozó modellbecslés |
| MET Norway | Modell 2026-10-01 19:21:15 | 1 | Modell ≤8h; célóra ±1h, még érvényes 1/6/12 órás intervallum. Budapest cél 22:00, 14.6 Celsius |
| OONI HU | 2026-10-01 21:12:26 | 5 | ≤24h; web-connectivity minták, országos blokkolás nem következtethető belőlük |

A RIPEstat első összevont próbája átmeneti hibás állapotot adott, régi adatok nélkül; az ismételt próba sikeres. A teljes folyamat 223 normalizált eseményt hozott. A válaszok és a próba JSON-ja az ignored `output/fresh-sources-live-proof.json` fájlban maradnak, nem kerülnek a kiadásba.

**Kizárt World Bank:** HUN `NY.GDP.MKTP.CD` legutolsó nem üres rekord 2025; API `lastupdated=2026-07-13`. A friss HTTP Last-Modified dátum nem teszi az éves adatot aktuális megfigyeléssé.

## Adatút és korlátok

- Kilenc adapter → `safeFetch` → `freshResult` → sanitizált `liveSources` → panel / EventRecord / előzmény / export / térkép. 40 adapter szerepel az orchestratorban.
- Kérésenként legfeljebb 2 MiB, 10 másodperces deadline; forrásonként legfeljebb 100 megjelenített megfigyelés, 500 vizsgált hazard-rekord; kis konfigurálható figyelőlisták.
- Frissesség újraellenőrzése adapterben/cache-olvasáskor, szintézisnél, HTTP snapshot-olvasáskor és böngészőben 30 másodpercenként. Ismeretlen/hibás idő és 5 percnél távolabbi jövőbeli megfigyelés kizárt. Előrejelzési célt nem használunk megfigyelési időként.
- A MET előrejelzési intervallum lejáratakor a régi értékek/összefoglalók is eltűnnek. Vegyes friss/lejárt pontokból kizárólag a friss pontok jelennek meg; aggregált szöveg nem őrizhet lejárt értéket.
- Biztonságos, pinelt XML parser: nincs DTD/entity deklaráció; mélység 50; csak ismert végpontok, nincs tetszőleges CAP-link követése. Hitelesítési adatot hordozó URL-ek és ismeretlen nyers objektumok nem kerülnek az EventRecordba. Publikus metrics összesen 50 elemre korlátozott.
- PWA csak opt-in snapshotot tárol; az új JS/CSS a 2.7.0 statikus shell része. Előzmények/export továbbra is történeti adatok lehetnek, külön gyűjtési/időmezőkkel.
- Az eredeti [Meteoalarm Atom](https://feeds.meteoalarm.org/) aktív; a régi RSS 2026-01-14 óta nem frissül. A [MET szolgáltatási feltételei](https://api.met.no/doc/TermsOfService) szerinti User-Agent/cache/attribúció és CC BY 4.0 licenclink megmarad. Az [ECB referenciaadat](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) napi, információs célú adat; az [EPSS API dokumentáció](https://api.first.org/epss/) aktuális URL-je használatos.

## Ellenőrzési eredmények

- 285 Node-teszt: 284 sikeres, 1 explicit opcionális skip. Új érdemi tesztek: idő-/forecast-határok, régi cache, sikertelen/üres feed, kérések/body korlátok, XML, lokáció és OONI/EPSS jelentések, sanitizálás, teljes metrics budget, licencek.
- 139 JavaScript-program syntax/locale, vendor SHA-256 és production dependency audit sikeres; 0 ismert sérülékenység.
- Browser plugin nem érhető el a sessionben; Playwright 1.62.1 Chromium, izolált localhost fixture 3199. Desktop 1440×1000 és mobil 390×844: 9 kártya, magyar szöveg, megnyitható előrejelzés-részletező, UTC cél/érvényesség, lejárt értékek/rekordok/események eltűnése, inert hostile text, nincs horizontális túlcsordulás vagy page error/forrás-API-kérés.
- A nyitott rekordlisták megmaradnak SSE/adatfrissítés után. A meglévő regresszió vizsgálja a 14 réteget, WebGL, SSE reconnect/polling, snapshot-verseny, hibás API, XSS és blocked storage viselkedését.
- PWA/offline: alapértelmezetten nincs snapshot, opt-in tárolás, monotón mentés, offline flat/globe/események, API cache tiltása, törlés és blocked storage sikeres. Az új 9 forrás mentett, mesterségesen lejárt snapshotjának valódi offline újratöltésekor mind a 9 kártya lejárt, 0 élő rekord és 0 régi érték jelenik meg.
- Képek és az új QA-script a gép Temp `crucix-fresh-source-qa` könyvtárában; éles szolgáltatói adatoknak nem álcázott fixture bizonyíték. Az alkalmazás éles szerverét nem indítottuk újra.

GitHub kiadás: [v2.7.0](https://github.com/mp3pintyo/Crucix/releases/tag/v2.7.0). A hozzá tartozó CI eredménye a közzététel után kerül ebbe a jelentésbe.
