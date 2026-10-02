# Crucix riasztási motor és riasztási felület — 2.10

A „Palantir-szerű" ütemterv B része (lásd az [A spec](2026-10-02-record-inspector-design.md) elejét). A felhasználó a teljes B–E sort önállóan, kérdés nélkül kérte; a tervezési döntéseket az ajánlásom szerint rögzítem. Cél: a rendszer ne csak gyűjtsön, hanem **figyeljen**: szabályok alapján kiemelten jelezzen, ha valami bekövetkezik, és ez a felületen, a böngészőfülön és telefonon is látszódjon.

## Probléma

- A kilenc „friss nyilvános adat" forrás (GDACS, SWPC, EPSS, OONI, Meteoalarm, ...) nem megy át a delta-motoron, ezért ma egyik sem tud riasztást kiváltani.
- A meglévő riasztás (`lib/delta/engine.mjs`, Telegram/Discord) csak 13 számszerű és 9 darabszám-mutatót, új sürgős Telegram-posztot, atom-anomáliát és forrásromlást figyel. A küszöbök csak a kódban állíthatók, nincs felhasználói szabály, figyelőlista, nyugtázás, szundi, életciklus és nincs dashboard-oldali riasztási felület. A hír-eseményeket, a hely- és eseménytípus-egybeesést és a források elhallgatását senki nem figyeli.
- Nincs HTTP-oldali módosító útvonal (POST/PUT/DELETE), body parser, CSRF-védelem vagy rátakorlát (`lib/http-security.mjs` csak a Basic auth-ot és a fejléceket adja; hitelesítés nélkül a localhost kitett).

## Megőrzendő működés

A meglévő Telegram/Discord riasztó, a delta-motor és a sweep-ciklus viselkedése változatlan. A riasztási motor **kiegészít**, nem helyettesít: a delta-jelzésekből a dashboardnak is készül riasztás, de a Telegram/Discord felé ezeket nem küldi újra. A sweep sosem szakadhat meg a riasztási motor hibája miatt. Az A kiadás jelölései (`--sev-*` tokenek, ◆▲●○ és a négy szint: CRITICAL, HIGH, WATCH, INFO), a Rekordvizsgáló és az eseményrészletező marad. Titok, `.env`, bot-adat nem kerül tesztbe vagy kiadásba. Nincs új futásidejű függőség.

## Szabályok

Egy szabály JSON-objektum: `{id, name, kind, enabled, severity, notify, forSweeps, cooldownMinutes, scope, params}`.

- `id`: `[a-z0-9-]{1,40}`; `name` ≤ 80 karakter; `severity`: `critical|high|watch|info`, eseményszabálynál `auto` is (az esemény szintje lesz a riasztásé); `notify`: logikai; `forSweeps` 1–10 (hiszterézis: ennyi egymást követő sweepen át kell teljesülnie, alap 1, küszöbnél 2); `cooldownMinutes` 0–1440 (alap 30; ennyi ideig nem nyílik újra ugyanaz a riasztás a lezárás után).
- `scope` (csak eseményszabálynál használható): `kinds` (eseménytípusok listája), `sources` (forrásnevek), `keywords` (legfeljebb 10, egyenként ≤ 40 karakter, sima, ékezet- és kisbetű-független részsztring, nem regex), `radius` `{lat, lon, km}` (lat ±90, lon ±180, km 1–3000, haversine).

Hat szabálytípus (`kind`):

| kind | params | Mikor teljesül | Dedupe-kulcs |
| --- | --- | --- | --- |
| `event` | `minLevel` (`info\|watch\|high\|critical`) | `snapshot.events` egy eleme (a `signal` típus kivételével) legalább `minLevel` szintű és illeszkedik a scope-ra | `szabály\|event.id` |
| `threshold` | `metric`, `op` (`>`, `>=`, `<`, `<=`), `value`, `clearValue?` | a mutató értéke átlépi a küszöböt; a lezáráshoz `clearValue` (vagy a küszöb) másik oldalán kell lennie | `szabály\|metric` |
| `change` | `metric`, `pct` (0,1–100) | az előző sweephez képest legalább `pct` százalékos abszolút változás | `szabály\|metric` |
| `absence` | `source` (név vagy `any`), `minFailSweeps` (1–50), `maxAgeMinutes?` | a forrás `err` vagy `stale` egymás utáni `minFailSweeps` sweepen át, vagy az adata `maxAgeMinutes` percnél öregebb; letiltott forrást kihagy | `szabály\|forrás` |
| `convergence` | `cellDegrees` (1, 2, 4; alap 2), `windowHours` (6–72; alap 24), `minKinds` (2–6; alap 3), `minLevel` (alap `watch`), `kinds?` | egy rácscellában az ablakon belül (szolgáltatói idő) legalább `minKinds` különböző eseménytípus van érvényes koordinátával és `minLevel` szinttel; alap típusok: `conflict, earthquake, weather, disaster, outage, health` (hír, jelzés, előrejelzés, gazdasági nem) | `szabály\|cella` |
| `delta` | `minSeverity` (`high\|critical`) | a delta-motor `signals.new/escalated` bejegyzése legalább ilyen súlyos (critical→critical, high→high) | `szabály\|jel.key` |

**Mutatóregiszter** (`lib/alerts/metrics.mjs`): kulcs, címke, egység, kinyerő. Számszerű: `vix`, `hy_spread`, `t10y2y`, `wti`, `brent`, `natgas`, `gold`, `silver`, `y10`, `usd_index`, `mortgage`, `fed_funds`, `unemployment`, `btc`, `eth`, `eurhuf`; darabszám: `urgent_posts`, `who_alerts`, `conflict_events`, `conflict_fatalities`, `sources_ok`, `sources_failed`, `sources_stale`. A delta-motor kinyerőit újrahasznosítja (exportálni kell), a hiányzókat (`btc`, `eth`, `eurhuf` = ECB `metrics.HUF`) hozzáadja. A korábbi értékeket a riasztási motor maga őrzi (a `memory.mjs` tömörítése eldobja a piaci adatot).

**Beépített szabálycsomag** (a felhasználó felülírhatja vagy letilthatja azonos `id`-val): `events-critical` (event, critical, `auto`, notify), `events-high` (event, high, `auto`, notify, `forSweeps` 1), `convergence-default` (high, notify), `source-stale` (absence, any, 3 sweep, watch, nem notify), `vix-spike` (threshold `vix > 30`, high, notify), `hy-spread-wide` (threshold `hy_spread > 5`, watch), `delta-critical` (delta, critical, nem notify: a meglévő Telegram/Discord már értesít), `hungary-region` (event, radius 47,5; 19,0; 500 km, `minLevel` watch, `auto`, nem notify).

Felhasználói szabály legfeljebb 50 lehet (`runs/alerts/rules.json`). A szabályszerkesztés szigorú validációval megy (engedélylista, tartományok, hossz, ismeretlen mező elutasítva); a `metric` a regiszterből való.

## Riasztás és életciklus

Riasztás: `{id, ruleId, ruleName, dedupKey, kind, severity, state, title, summary, entity, evidence[≤8], metric?, firstSeenAt, lastSeenAt, resolvedAt?, count, ack?, snooze?, notified?, log[≤20]}`. Állapotok: `firing`, `acked`, `snoozed`, `resolved`. Egy dedupe-kulcsra egy epizód tartozik; újranyitás új riasztás új azonosítóval.

- **Új riasztás:** a hit `forSweeps` egymás utáni sweepen át teljesül (belső `pending` számláló), és a cooldown nem tart. Eseményszabályonként legfeljebb 50 aktív riasztás (a többit a szabály összegzésében számoljuk: „+N további").
- **Fennmaradás:** frissíti `lastSeenAt`, `count`, `evidence`. Ha a súlyosság nőtt, a `acked` és `snoozed` riasztás visszaáll `firing`-re (eszkaláció), és újra értesíthet.
- **Lezárás:** ha a hit `resolveAfterSweeps` (alap 2) egymás utáni sweepen nem teljesül, `resolved` lesz; a szabály letiltása vagy törlése is lezárja (naplóval). Kézi `resolve` is lehet; ha a feltétel fennmarad, a cooldown után újranyílik.
- **Nyugtázás/szundi:** `ack` megjegyzi az időt; `snooze` 15 perc – 7 nap, opcionális ok (≤ 120 karakter); lejáratkor visszaáll `firing`-re, ha a feltétel még fennáll.
- **Alapállapot (bootstrap):** az első kiértékeléskor (nincs tárolt állapot) a létrejövő riasztások `silent` jelzést kapnak, értesítés nem megy. Az indulási `latest.json`-ból épített snapshotra a motor **nem** értékel (nincs delta, elavult adat), csak a tárolt riasztásokat adja vissza.
- **Árvíz elleni védelem:** egy sweepben legfeljebb 5 egyedi értesítés megy ki (`ALERT_MAX_NOTIFICATIONS_PER_SWEEP`), a többi egyetlen „+N további riasztás" összegző üzenetben; a felületen 5-nél több azonos szabályú riasztás csoportként jelenik meg.
- **Megőrzés:** legfeljebb 1000 riasztás és 30 nap (a lezártakat vágjuk előbb), riasztásonként 20 naplóbejegyzés.

**Fenyegetettségi szint (1–5):** csak a `firing` riasztásokból: 1, ha nincs; különben a legsúlyosabb szint (`info`→2, `watch`→3, `high`→4, `critical`→5). A nyugtázott és szundizott riasztás nem emeli. A meghajtó riasztások (legfeljebb 5) a válaszban és a felületen kattintásra kibonthatók, hogy a szám sosem átlátszatlan.

## Perzisztencia

`lib/atomic-json.mjs` (új, kicsi): ideiglenes fájl + fsync + átnevezés + `.bak`, 0o600; a két új fájl (`runs/alerts/alerts.json`, `runs/alerts/rules.json`) használja. Betöltéskor elsődlegesen a fő fájl, hibánál a `.bak`; hibás vagy túlméretes fájl nem állítja le a szervert (üres állapottal indul, jelzi). `version: 1`. A meglévő három atomi írás nem módosul.

## Értesítési csatornák

`lib/alerts/notify.mjs`: a meglévő `TelegramAlerter`/`DiscordAlerter` `sendMessage`-ét hívja egyszerű szöveggel (nem Markdown, így nincs escape-hiba), plusz két új csatorna, csak környezeti változóból:

- **ntfy:** `ALERT_NTFY_URL` (teljes témaurl, http(s), hitelesítési adat nélkül az urlben), opcionális `ALERT_NTFY_TOKEN` (Bearer); fejlécek: `Title`, `Priority` (critical=5, high=4, watch=3, info=2), `Tags`.
- **Webhook:** `ALERT_WEBHOOK_URL`, JSON test `{event:'alert', alert:{...}}`.
- **Szabályok:** `ALERT_NOTIFY_MIN_SEVERITY` (alap `high`), `ALERT_QUIET_HOURS` (`HH:MM-HH:MM` helyi idő; csendben a `critical` átmegy, a többi a csend végén egy összegző üzenetben), `ALERT_MAX_NOTIFICATIONS_PER_SWEEP` (alap 5), `ALERT_PUBLIC_URL` (opcionális; ha van, link kerül az üzenetbe). Csatornánként csak akkor küld, ha be van állítva. Időkorlát 10 s, hibánál naplóz és tovább lép; a titkok nem kerülnek naplóba. Egy riasztás epizódonként csatornánként egyszer értesít, eszkalációkor újra. A `silent` riasztás nem értesít. A küldés a sweepet nem blokkolja (fire-and-forget `catch`-csel).

## HTTP és SSE

Minden útvonal a meglévő `installHttpSecurity` után regisztrálódik (Basic auth automatikusan érvényes). Mivel nincs CSRF-védelem, a módosító útvonalakra új, szűk védelem kerül: kötelező `Content-Type: application/json` (különben 415), `Origin` fejléc esetén egyeznie kell a kérés eredetével, `Sec-Fetch-Site` esetén `same-origin` vagy `none` kell (különben 403); törzs legfeljebb 8 KB (`express.json` csak ezeken); hibás JSON → 400 `{error, code, field}` (nem Express HTML).

- `GET /api/alerts?state=active|all|resolved&severity=&rule=&limit=` (limit 1–200) → `{alerts, counts, threat:{level, drivers}, generatedAt}`; `GET /api/alerts/summary`.
- `POST /api/alerts/:id/ack`, `/snooze` (`{minutes, reason?}`), `/resolve`; `POST /api/alerts/ack-all` (`{severity?}`).
- `GET /api/alerts/rules` → hatályos szabályok (`source: builtin|user|override`), a mutatóregiszter az aktuális értékekkel, a támogatott típusok; `PUT /api/alerts/rules/:id`; `DELETE /api/alerts/rules/:id` (felhasználói szabály törlése vagy a beépített felülírásának visszaállítása).
- SSE: a `update` üzenet `data.alerts` összegzést hordoz (számlálók, szint, legfeljebb 5 aktív riasztás), módosító hívás után külön `{type:'alerts', data: összegzés, newIds}` üzenet. A böngésző kezeli; a `pwa.js` `KEYS` listája kiegészül az `alerts` kulccsal.

## Integráció a sweepbe

A `runSweepCycle()`-ben az események építése (`recordSnapshotEvents`) után és a `currentData` beállítása előtt, **saját try/catch-csel**: `synthesized.alerts = (await engine.evaluate(synthesized, {delta})).summary`; hiba esetén a sweep folytatódik és a hiba naplózódik. Az értesítések a kiértékelés után, aszinkron mennek. Indításkor a motor betölti a tárolt állapotot, és a `latest.json`-ból épített snapshotra csak az összegzést teszi rá.

## Felület

- **Riasztássáv** (`#alertStrip`, a `#topbar` alatt, a `renderTopbar` újrarajzolása nem érinti): fenyegetettségi jelvény (`THREAT n/5`, kattintásra a meghajtó riasztások és szabályok), szintenkénti számlálók (alak + szám), a legsúlyosabb aktív riasztás szövege, **Nyugtáz**, **Szundi** (1 ó / 8 ó / 24 ó), **Megnyitás** gombok. Riasztás nélkül is látszik, egy halk sorként („Nincs aktív riasztás · utolsó kiértékelés HH:MM"). A Rekordvizsgáló dokkolási magassága a sáv alatt kezdődjön (`--ri-top` méri a sávot is).
- **Riasztási fiók:** harang gomb a felső sávban és a sávból nyílik, jobb oldali, nem modális panel (z-index 950); fülek: Aktív, Nyugtázott/szundizott, Lezárt, Szabályok; lista szint szerint, azonos szabályból 5-nél több csoportosítva; riasztásonként: jel, cím, szabály, kor, darabszám, bizonyíték-hivatkozások (`CrucixIntelligence.openEvent`), Nyugtáz / Szundi ▾ / Lezár; „Összes nyugtázása" (szint szerint szűrhető). Billentyűzettel teljesen kezelhető, `aria` szerepekkel; 700 px alatt alsó lap.
- **Toast:** csak új `critical` és `high` riasztásra (nem `silent`), a `critical` `role="alert"`, a többi `role="status"`; nincs időzítő (nyugtázásig vagy bezárásig marad), egyszerre legfeljebb 3; `prefers-reduced-motion` tiszteletben tartva.
- **Fülcím:** `(n) Crucix`, ahol `n` az aktív `critical`+`high` riasztások száma; nulla esetén visszaáll.
- **Szabályszerkesztő** (a fiók „Szabályok" füle): lista bekapcsolóval (`enabled`, `notify`), súlyossággal és a paraméterek összefoglalójával; „Új szabály" űrlap típusonként (mutató-választó a regiszterből az aktuális értékkel, operátor, érték; eseményszabálynál szint, kulcsszavak, sugár, típusok; konvergenciánál cella, ablak, minKinds; hiánynál forrás és sweepszám); szerkesztés; törlés/visszaállítás. Szerveroldali validációs hiba a mező mellett jelenik meg.
- Hang nincs (később). A szövegek en/hu/fr nyelven (`alerts.*`), a kulcsegyezést teszt őrzi.

## Biztonság

Szabálymezők szigorúan validáltak és korlátosak; nincs regex, eval vagy fájl/hálózati elérés a szabályból; a webhook/ntfy url csak környezeti változóból jön (nem az API-ból), http(s), hitelesítési adat nélkül. Az API csak a meglévő hitelesítés mögött fut, módosítás csak azonos eredetről, JSON-nal. Minden felületi szöveg escape-elt; a riasztás címe és összefoglalója a forrásadatból származik, ezért a Telegram/Discord/ntfy felé sima szövegként megy, a webhook JSON-ban.

## Tesztek

`node:test`: minden szabálytípus kiértékelője (határesetekkel), hiszterézis, dedupe, cooldown, eszkaláció, szundi lejárat, alapállapot (silent), árvíz-összegzés, szint-számítás, perzisztencia (helyreállítás `.bak`-ból, hibás fájl, korlátok), szabályvalidáció (hostile bemenet, ismeretlen mező, tartományok, prototípus-kulcsok), értesítők (szöveg, csendes órák, ntfy/webhook mockolt hálózattal, titok nem kerül naplóba), útvonalak (401 hitelesítés nélkül, 415, 403 idegen eredet, 400 validáció, 404, tömeges nyugtázás), sweep-integráció (a motor hibája nem állítja meg a sweepet), kliens-megjelenítés vm-ben (escape, állapotok, csoportosítás), nyelvi kulcsegyezés. A Playwright QA új fázissal bővül (sáv, fiók, nyugtázás, szundi, toast, szabály létrehozása, mobil), a fixture kapja a `/api/alerts*` útvonalakat.

## Kiadás

2.10.0, HU/EN kiadási jegyzet, README/OPERATIONS/`.env.example` bővítés, `sw.js` gyorsítótár `crucix-shell-v2.10.0` és az új statikus fájlok a `BASE` listában, tag, push a `fork`-ra, `gh release create`, CI-linkek rögzítése.

## Nem része a B-nek

Új adatforrások (C), lensek és Ctrl+K (D), entitás/kapcsolat, országkockázat, előrejelzés és AI-összefoglaló (E); hangjelzés; több felhasználós nyugtázás (egy operátor van).
