# Crucix események, történet és tematikus munkaterület

A felhasználó a korábbi teljes audit összegyűjtött termékfejlesztéseinek végrehajtását kérte. Elsődleges cél: az események eredetének megértése, visszakeresése és megosztható exportja, majd menthető tematikus nézetek. A natív wrapper helyett kifejezetten telepíthető PWA-t választott.

## Megőrzendő működés

Node 22/24, ESM, Express és az opcionális Discord függőség. A Jarvis-megjelenés, HU/EN/FR locale, WHO/HDX/IODA, 31 adapter, flat/globe rétegek, elmentett panelek és az előző kiadások védelmei megmaradnak. Operátori `.env`, privát botadat és felhasználói archívum nem kerül tesztbe vagy kiadásba. A munka közvetlenül a felhasználó által kért forkban készül; nincs új stack vagy külső runtime-szolgáltatás.

## 1. Esemény és eredet — 2.4

A szintetizált snapshot `events` listát kap. Az egyes `EventRecord` mezői: `id`, `kind`, `title`, `summary`, `source: {name,url,hostname,status}`, `observedAt`, `publishedAt`, `collectedAt`, `location: {lat,lon,method,label,precision}`, `severity`, `quality: {level,checks,explanationCodes}`, `relatedSources`. Az ismeretlen provider-idő `null`; a gyűjtési idő nem helyettesíti az observed/published időt. URL csak hiteles http(s), credential nélkül. Korlátos szövegek, stabil hash-azonosító, koordináták finite/range validációja szükséges.

Az eseményrészletező a hírből, kapcsolódó beszámolóból, jelzésből és mindkét térkép markeréből elérhető. Eredeti linket, három időpontot, helymeghatározási módszert, forrásállapotot és visszakövethetőségi ellenőrzéseket mutat. Akadálymentes, mobilon görgethető dialog, fókusz-visszaállítás, Escape, plain text renderelés. Nincs kitalált „bizalmi százalék”: a minőség a link/idő/hely adat meglétét jelöli, nem az állítás igazságát. Hasonló című, közeli és időben kapcsolódó külön források „kapcsolódó beszámolók”; közös feedből származó több cikk nem több független bizonyíték.

## 2. Előzmény, idővonal, export — 2.5

Új, atomi `runs/intelligence/history.json` tároló, alapból legfeljebb 10 000 esemény, 30 nap, 20 MiB. Nem írja át a meglévő raw/hot/cold archívumot. Újraindítás után megmarad, ismételt sweep URL/id alapján frissít és első/utolsó gyűjtési időt őriz. Hibás tároló valid backupból helyreállítható; validált bemenet, hard cap, monoton utolsó idő. A keresés normalizált szöveg, source, kind és ISO időtartomány alapján történik; lapméret 1–200, nem regex/SQL. A külső HTTP API-k ugyanazt a hitelesítési guardot használják.

`GET /api/history`, `GET /api/events/:id`, `GET /api/export?format=json|csv|html|stix`. A lekérdezés pontos szűrését az export is megtartja; maximum 2 000 exportált rekord, látható truncation. CSV formula-prefix semlegesítés, HTML teljes escaping és aktív script nélkül. STIX 2.1 bundle csak szabványos note/report jellegű objektumokkal, eredeti forrás external reference-ekkel; földrengés/hírcím nem lesz automatikusan cyber indicator vagy bizonyított threat. HTML riportból a böngésző nyomtatása PDF-et készíthet.

A történet dialog keresőmezőt, típus/forrás/dátum szűrőt, idővonal összesítést, lapozást és eredménydarabszámot tartalmaz. A földrajzi hírcsoportosítás 4° cellával és 24 órás ablakkal kapcsolható; az összesített jelölő az összetartozó beszámolók listájára nyit. A földrajzi közelség önmagában nem eseményazonosság.

## 3. Profilok, cache és PWA — 2.6

Kutatás/piac/infrastruktúra előre definiált panelek + rétegek + régió; legfeljebb 12 saját, névvel menthető profil. Alkalmazás előtt a jelenlegi állapot „Egyéni” marad, a profilváltás nem törli a felhasználó korábbi layoutját. Saját profil átnevezés/törlés csak saját bejegyzésre; érvénytelen/túlméretes storage normalizálás, tiltott storage mellett működő session fallback. HU/EN/FR UI.

A dashboard program-, térkép-, font- és textúrafüggőségei helyi, verziózott assetek, dokumentált licencekkel és hashokkal. Service worker csak ezeket és adatmentes offline shellt precache-el; `/api/*`, `/events`, auth header és online injektált HTML nem kerül CacheStorage-ba. Navigáció network-first, offline fallback. Az utolsó snapshot külön felhasználói opt-in IndexedDB mentés, állapot- és korjelzés, törlés. Telepítési gomb csak browser-támogatás esetén; localhost/HTTPS. Service worker update nem erőltet reloadot szerkesztés/dialog közben.

## Elfogadás és kiadások

Minden nagy egység regressziós teszteket és külön HU/EN changelogos GitHub release-t kap. Tényleges desktop/mobil böngészőpróba: forrás/idő/geolokáció, keresés/szűrő/pagination/export, reload utáni történet és profil, flat/globe csoport, script payload, tiltott storage, auth, offline indulás és locale. Node22/24 Windows/Linux + non-root Docker CI. A korábbi audit javaslatait végső megvalósítási jegyzék köti össze a kiadásokkal.

Inspiráció elsődleges dokumentáció alapján: [World Monitor](https://github.com/koala73/worldmonitor), [NEXUsint](https://github.com/Kit4Some/NEXUsint), [OASIS STIX 2.1](https://docs.oasis-open.org/cti/stix/v2.1/os/stix-v2.1-os.html). Funkcióminták saját implementációja; alternatív fork kódját nem futtatjuk/importáljuk.
