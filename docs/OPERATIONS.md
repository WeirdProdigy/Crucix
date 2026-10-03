# Crucix üzemeltetési útmutató

Ez a fork Node.js 22 vagy 24 alatt, natív Windows/Linux környezetben és Dockerben ellenőrzött. A [teljes audit](audit/full-review-2026-10-01.md) és a [változásnapló](../CHANGELOG.md) részletezi a javításokat.

## Indítás és hozzáférés

`npm ci`, majd `.env.example` másolása `.env`-re és `npm run dev`. PowerShellben a másolás: `Copy-Item .env.example .env`. A gyári cím `http://127.0.0.1:3117`. A felület első adat nélkül várakozó állapotot mutat; a sweep legfeljebb 30 másodpercet vár egy forrásra, majd külön folytatja az ötletgenerálást. A modell határideje ettől független.

LAN-on natív indításhoz `HOST=0.0.0.0`, Compose-hoz `BIND_ADDRESS=0.0.0.0` szükséges. A másik gépen a szerver LAN-címét használd. A botlinkeket a `PUBLIC_URL=http://<LAN-IP>:3117` vezérli. LAN-hosztnévvel (nem IP-címmel) használt, hitelesítés nélküli példánynál a riasztások módosításához `ALERT_ALLOWED_HOSTS` vagy `ALERT_PUBLIC_URL` kell, lásd a [Riasztási motor](#riasztási-motor) szakaszt. Internetes használathoz HTTPS reverse proxy és `AUTH_USER`/`AUTH_PASSWORD` együtt állítandó be. A HTTP Basic önmagában nem titkosít. `/healthz` minimális, nyilvános liveness végpont; `/api/health`, `/api/data`, a HTML és az SSE hitelesítést kér, ha a credential-pár be van állítva.

Portütközésnél nézd meg a `Get-NetTCPConnection -LocalPort 3117` vagy `netstat -ano` eredményét, és azonosítsd a folyamatot. Meglévő saját Crucix példányt használhatsz; másik alkalmazást ne állíts le. Alternatíva: `PORT=3118`. A `node diag.mjs` az importokat és a portot is ellenőrzi. Headless/container indításkor `NO_AUTO_OPEN=1` használható; a hiányzó `xdg-open` nem adatgyűjtési hiba.

Linux bind mountnál a konténer UID 1000-ének írnia kell a `runs/` könyvtárat. Új könyvtár: `mkdir -p runs && sudo chown 1000:1000 runs`. Meglévő futási archívumot őrizz meg. Ne futtasd a clean parancsot hibakeresés helyett: az futási adatokat töröl.

## Forrásállapot és frissesség

| Állapot | Jelentés | Teendő |
| --- | --- | --- |
| `ok` | A forrás feldolgozható választ adott; lehet valóban üres | Az üres feed nem feltétlenül hiba |
| `disabled` | Nincs szükséges kulcs vagy a gyűjtés kikapcsolt | Add meg a kulcsot, ha kell a forrás |
| `error` | Hálózati, hitelesítési, schema vagy részforráshiba | Ellenőrizd a forrás üzenetét, egress/DNS-t és jogosultságot |
| `stale` | Korábbi, eredeti időbélyegű adat | Nézd meg az observation idejét; ne tekintsd élőnek |

A dashboard a kapcsolatot és a snapshot korát külön jelzi: működő SSE mellett is lehet régi adat. Sikertelen sweep nem kap új adat-időbélyeget. Hálózatkimaradáskor az utolsó érvényes adat megmarad, az SSE saját reconnectje és a korlátos polling helyreállítja az élő frissítést.

OpenSky: tíz hotspot publikus, korlátozott lekérdezése. HTTP 429-nél nincs limitmegkerülés; a friss, sikeres régiók megmaradnak. Teljes hiba esetén legfeljebb egyórás érvényes megfigyelés használható. Hiányzó, jövőbeli vagy lejárt timestamp nem fogadható el fallbacknek. A proxy/egress és upstream limit továbbra is befolyásolja az elérhetőséget.

Yahoo: HTML/hibás chart esetén a műszer neve megmarad, ár nem található ki. ACLED: sikeres OAuth nem bizonyít adat-hozzáférést; külön ellenőrizd az account endpointjogát. Reddit csak OAuth hozzáféréssel aktív. A Telegram publikus preview külön `TELEGRAM_OSINT_ENABLED=true` opt-in; a kontrollbot privát üzenete nem OSINT-forrás. OFAC korlátos exportminta, USGS significant-day feed, Maritime statikus referenciapontok: ezek nem teljes sanctions-történet, minden földrengés vagy élő AIS.

**Új élő források (2.11):** a **Friss nyilvános adatok** panel 19 kulcs nélküli forrást mutat. Az újak: IMF PortWatch (hajóáthaladás nyolc szorosban, a legutóbb közölt nap 2–9 napos késéssel, 7 napos átlag a megelőző 28 nap mediánjához mérve), EMSC (M4,5+ földrengések az utolsó 24 órából), Copernicus EMS (gyorstérképezési aktiválások), Aviation SIGMET (nemzetközi repülésmeteorológiai figyelmeztetések), ADSB-Military (katonai gépek száma figyelt dobozonként az adsb.lol hálózatból, ez összesítés a doboz közepén, nem pozíció; plusz 7700/7600/7500 vészjelzések), OpenSanctions-index (hat szankciós lista utolsó változása és tételszáma), Federal Register (OFAC és BIS dokumentumok), Energy-Charts HU (magyar másnapi áramár, hálózati frekvencia, megújuló részarány), ENTSOG HU (fizikai gázáramlás a hét magyar határponton, az utolsó lezárt gáznap) és Manifold előrejelzési piacok (játékpénzes piacok a figyelt szavakra). A figyelt listák a `crucix.config.mjs` `publicSources` részében állíthatók: `portwatchChokepoints` (a szorosok neve pontosan úgy, ahogy a PortWatch írja), `adsbTheaters` (legfeljebb 12 doboz; egy gép az első olyan dobozba számít, amely tartalmazza) és `marketQueries` (egyszavas keresések; minden szónak a kérdés egy szavának elejével kell egyeznie). Az adsb.lol szigorúan korlátozza a kérések ütemét: a kézi `/sweep` egy ütemezett sweep után egy percen belül 429-et kaphat, ilyenkor a forrás a következő sweepig hibát mutat. A térképen a helyhez kötött rekordok a saját rétegük színével jelennek meg (földrengés, tengeri, légi, természeti esemény, időjárás); az a földrengés, amelyet a USGS és az EMSC is jelent (60 másodpercen és 100 km-en belül), egyszer, USGS-jelölőként látszik, de mindkét esemény megmarad a listákban. Új riasztási mutatók: `<szoros>_transits` (PortWatch 7 napos átlag, áthaladás/nap), `hu_power_price` (EUR/MWh), `grid_frequency_hz` és `mil_aircraft_total` (katonai gépek világszerte, levegőben, 2 percen belüli pozícióval); a mutató üres, amíg a forrása elavult vagy hibás. A magyar másnapi áramár magas (medián kb. 194 EUR/MWh 2026.09.19. és 10.02. között), ezért a `hu_power_price` küszöbszabályhoz külön szintet érdemes választani.

## Modell és riasztások

Helyi llama.cpp/LM Studio példa:

```dotenv
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=http://127.0.0.1:8080/v1
LLM_MODEL=<a-szerver-model-azonositoja>
TRADE_IDEAS_LANG=hu
```

Dockerben a localhost a konténert jelenti; Docker Desktopon a hostszolgáltatás címe például `http://host.docker.internal:8080/v1`. A modell szerverének ténylegesen elérhető címen kell hallgatnia. `OLLAMA_BASE_URL` a külön Ollama adapterhez tartozik.

Groq is a generic adapterrel konfigurálható: `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_API_KEY` és az accountban elérhető `LLM_MODEL`. Ezt a [Groq hivatalos OpenAI compatibility dokumentációja](https://console.groq.com/docs/openai) támogatja; nincs szükség a #47 PR teljes crypto/UI csomagjára. Éles Groq modellhívást az audit nem végzett. Más compatible szolgáltatóhoz az endpointot, authot és modellnevet külön kell ellenőrizni.

A timeout és tokenkeret a `.env.example` négy `LLM_*_TIMEOUT_MS` / `LLM_*_MAX_TOKENS` változójával állítható. A nagyobb timeout nem javítja az üres thinking-only választ: a válasz ellenőrzést kap, és szabályötletek jelennek meg hiba esetén. A `LLM_IDEAS_EVERY_N_SWEEPS` ritkítja a modellhívást; a cache megtartja az eredeti időt, a delta-riasztás minden sweepben működik.

Discord sweep/mute/unmute: megfelelő guild és channel, valamint Manage Server/Admin vagy `DISCORD_ALLOWED_USER_IDS` szükséges. A botnak a csatornában Send Messages és Embed Links jog kell. Telegram csak a beállított `TELEGRAM_CHAT_ID` parancsait fogadja. A botadatokat és tokeneket ne másold hibajegybe. DNS/egress vagy a szolgáltató saját 401/403 hibája környezeti vizsgálatot igényel; a forrás hibája nem állítja le a többi adaptert.

## Események, történet és profilok

Az **Események** listából, hírszalagból vagy támogatott térképjelölőből nyitható a részletező: eredeti link, observed/published/collected idő, helymeghatározás és forrásállapot. Az ismeretlen idő/hely ismeretlen marad. A kapcsolódó beszámolók és térképes csoportok rendezési segítségek; nem igazolják automatikusan az eseményt.

Az **Előzmények** szöveget, típust, forrást és UTC gyűjtési dátumot szűr. A napló `runs/intelligence/history.json` és `.bak`, legfeljebb 30 nap / 10 000 rekord / 20 MiB. Az utolsó snapshot és a későbbi sweep-ek kerülnek be; a meglévő archívumot nem tölti vissza tömegesen. A napló írási hibája külön látszik a health válaszban, a friss adatközlést nem állítja le. A keresés és export a meglévő hitelesítés alatt, no-store API-val működik. Az export a szűrést követi, maximum 2000 rekord, csonkolásjelzéssel. PDF: nyomtatható HTML → böngésző Nyomtatás → Mentés PDF-ként.

**Profilok:** kutatás, piac, infrastruktúra; saját panel/réteg/régió állapot legfeljebb 12 néven menthető. Saját profil átnevezhető és törölhető. A váltás előtti egyéni állapot visszaállítható. A mentés böngésző/origin függő; tiltott localStorage esetén csak az adott munkamenetben él.

**Friss nyilvános adatok és Rekordvizsgáló:** a panel kártyái összegzést adnak (állapot, adatidő, rekordszám, súlyossági jelvények: Kritikus ◆, Magas ▲, Figyelendő ●, Tájékoztató ○, a három legfontosabb cím). A **Rekordok megnyitása** gomb jobb oldali panelt nyit, 700 px alatt alsó lapot; ez súlyosság, időablak és szöveg szerint szűr, rendez, és 25-ösével lapoz. Az **Esemény részletei** a szokásos eseményablakot nyitja; a kibontás teljes képernyős böngészőt ad, ahol a **Minden forrás** nézet az egész eseménylistát (hírek, USGS, NOAA, WHO is) fedi. A nézet linkben osztható, például `#src=GDACS&sev=high`. Billentyűk (akkor működnek, ha a fókusz a panelben vagy a böngészőben van; a **Rekordok megnyitása** gomb oda viszi): `j`/`k` mozgás, `Enter` részletek, `/` keresés, `e` kibontás, `Esc` bezárás. Hibás vagy lejárt forrásnál nincs rekordlista, csak az ok és az utolsó sikeres frissítés ideje. A panel széles képernyőn eltakarja a jobb oldali sávot, amíg nyitva van.

## Riasztási motor

**Működés:** minden sweep után a szerver kiértékeli a riasztási szabályokat. Hat szabálytípus van: esemény, küszöb, változás, kiesés, összetorlódás (convergence) és változásjelzés (delta). Alapból nyolc beépített szabály fut (`events-critical`, `events-high`, `convergence-default`, `source-stale`, `vix-spike`, `hy-spread-wide`, `delta-critical`, `hungary-region`), saját szabályból legfeljebb 50 vehető fel. A riasztás lehet aktív, nyugtázott, halasztott (szundi) vagy lezárt; a paramétereket és a korlátokat a [2.10.0 kiadási jegyzet](releases/v2.10.0.md) sorolja fel. A riasztási motor hibája nem állítja meg a sweepet, a delta-motort és a meglévő Telegram/Discord riasztásokat.

**Felület:** a felső sáv alatt riasztási sáv mutatja a fenyegetettségi szintet (1–5, csak az aktív riasztásokból: TÁJÉKOZTATÓ 2, FIGYELENDŐ 3, MAGAS 4, KRITIKUS 5, aktív riasztás nélkül 1), a súlyosságonkénti darabszámot és a legfontosabb aktív riasztást. A harang az aktív riasztások számát mutatja, a böngészőfül címe `(n) ` előtagot kap (aktív kritikus + magas). A tálca fülei: **Aktív**, **Kezelt**, **Lezárt**, **Szabályok**; a fenyegetettségi jelvény a szintet meghatározó riasztásokat mutatja. Toast csak új kritikus vagy magas riasztásról jön, időzítő nélkül, legfeljebb három, és nyitott tálca mellett rejtett. `Esc` előbb a szundi menüt, majd a tálcát zárja. Az offline shellben és fájlból megnyitva a sáv csak olvasható.

**Nyugtázás, szundi, lezárás:** a **Nyugtázás** a riasztást a **Kezelt** fülre teszi és kiveszi a fenyegetettségi szintből; nyugtázott marad, amíg a feltétel meg nem szűnik, vagy súlyosabb szintet nem kap (ekkor újra aktív). A **Szundi** a sávban és a tálcában 1 / 8 / 24 óra, az API 15 perctől 7 napig fogad. Lejártakor a riasztás újra aktív, ha a szabály még találja, különben lezárul. A **Lezárás** kézi: ha a feltétel fennáll, a riasztás a szabály várakozási ideje (alap 30 perc) után új riasztásként nyílik. Az **Összes nyugtázása** az aktív riasztásokra hat, súlyosság szerint is szűkíthető. A találat `forSweeps` egymás utáni sweep után nyit riasztást; a riasztás 2 egymás utáni, találat nélküli sweep után zárul.

**Szabályok szerkesztése:** a **Szabályok** fülön szabálytípusonként űrlap van. A beépített szabály csak felülírással módosítható (bekapcsolás, értesítés, súlyosság, `forSweeps`, várakozás, paraméterek, hatókör), a név, az azonosító és a típus rögzített; a **Visszaállítás alapértelmezettre** törli a felülírást. Beépített szabály nem törölhető, csak kikapcsolható; a kikapcsolt vagy törölt szabály nyitott riasztásait a motor lezárja. A felülírás a paramétereket egészében cseréli (az `events-high` felülírásakor a felső szint is kell). A kulcsszó sima részszöveg, nem regex, kis- és nagybetűre, valamint ékezetre érzéketlen. A küszöbszabály `clearValue` mezője hiszterézis: a már nyitott riasztás addig marad, amíg az érték át nem lép a tiszta oldalra.

**Első indítás:** az első kiértékelés néma alapállapot. A már meglévő eseményekből nyíló riasztások „Kezdeti alapállapot” jelölést kapnak, nem értesítenek és nem hoznak toastot, ezért telepítés vagy frissítés után nincs értesítési áradat. A később létrehozott vagy visszakapcsolt szabály mindent értesít, amit talál (az alapállapotban lévő események kivételével). A riasztások és szabályok a `runs/alerts/alerts.json` és `rules.json` fájlban élnek `.bak` másolattal (legfeljebb 1000 riasztás, a lezártak 30 napig). Hibás vagy túl nagy fájl nem állítja le a szervert: előbb a `.bak` másolatára esik vissza, és csak ha mindkettő használhatatlan, indul üres állapottal, ilyenkor az alapállapot újra némán épül fel. A teljes törléshez állítsd le a szervert, és töröld a `runs/alerts/` fájljait.

**Értesítési csatornák:** a riasztás mindig látszik a dashboardon; kiküldés csak akkor történik, ha a szabály `notify` jelzője be van kapcsolva, a riasztás eléri az `ALERT_NOTIFY_MIN_SEVERITY` szintet (alap `high`), és nem „kezdeti alapállapot”. Az **ntfy** (`ALERT_NTFY_URL`, opcionális `ALERT_NTFY_TOKEN`) és az általános **webhook** (`ALERT_WEBHOOK_URL`, JSON POST) a változó beállításakor él. A **Telegram és a Discord opt-in**: a meglévő bot- vagy webhook-beállítások mellett az `ALERT_NOTIFY_CHANNELS=telegram,discord` is kell, különben a motor semmit sem küld oda (a meglévő delta-riasztások ettől függetlenül mennek). Ezeken a csatornákon a `/mute` minden súlyosságra érvényes; az ntfy-ra és a webhookra nem hat. A `delta-critical` szabály alapból nem értesít, mert a delta-riasztó már elküldi ezeket.

```dotenv
ALERT_NOTIFY_CHANNELS=telegram,discord
ALERT_NOTIFY_MIN_SEVERITY=high
ALERT_QUIET_HOURS=22:00-07:00
ALERT_NTFY_URL=https://ntfy.sh/<sajat-topic>
```

Sweepenként legfeljebb `ALERT_MAX_NOTIFICATIONS_PER_SWEEP` (alap 5, 1–50) üzenet megy egyenként, a legsúlyosabbak előre; a többi egyetlen `+N more alerts` összegzés. Riasztásonként és csatornánként egy értesítés megy, súlyosbodáskor újra. Az `ALERT_PUBLIC_URL` linket tesz az üzenetekbe (a `PUBLIC_URL`-től független beállítás). Az üzenetek angol nyelvűek és egyszerű szövegűek (Telegram: nincs Markdown; Discord: escape-elt, említések tiltva, legfeljebb 2000 karakter, kb. 500 ms távolsággal). A csatornák URL-je http(s), hitelesítő adat nélkül, pontosan a végpontot kell megadni: a záró perjelet a konfiguráció levágja, az átirányítást hibának veszi. Az ntfy és a webhook 10 s, a Telegram és a Discord hívásonként 20 s időkorlátot kap. A sikertelen küldés naplózott (csatorna és hibaosztály vagy HTTP-státusz, URL és token nélkül), de nem ismétlődik.

**Csendes órák:** az `ALERT_QUIET_HOURS` (`HH:MM-HH:MM`, a szerver helyi ideje, éjfélen átnyúlhat) alatt csak a KRITIKUS megy ki. A többit a motor visszatartja, és az ablak után az első sweepben egyetlen `N alerts held during quiet hours` összegzésben jelzi (csak a darabszámot). A visszatartott riasztások csak a memóriában élnek, újraindításkor elvesznek.

**Hosztlista és reverse proxy:** a módosító kérések (`POST`, `PUT`, `DELETE`) `Content-Type: application/json`, azonos származás és legfeljebb 8 KB törzs nélkül elutasítottak (415 / 403 / 413 / 400, JSON hibával). **Hitelesítés nélkül** (nincs `AUTH_USER`/`AUTH_PASSWORD`) a `Host` fejléc ezen felül IP-cím, `localhost` / `*.localhost`, az `ALERT_PUBLIC_URL` hosztja vagy az `ALERT_ALLOWED_HOSTS` listán szereplő név kell legyen, különben 403 `HOST_NOT_ALLOWED` jön (DNS-rebinding elleni védelem). Ha tehát hitelesítés nélkül LAN-hosztnévvel (például `http://crucix.lan:3117`) nyitod meg a dashboardot, állítsd be: `ALERT_ALLOWED_HOSTS=crucix.lan`; az IP-címes elérés változatlanul működik. A lista hosztnevei port és séma nélküliek, aláhúzásos név nem vehető fel. HTTPS reverse proxy mögött őrizd meg a `Host` fejlécet (nginx: `proxy_set_header Host $host;`), vagy állítsd be az `ALERT_PUBLIC_URL`-t, például `https://crucix.example.com`: ennek származása elfogadott. Hitelesítés nélkül a megőrzött `Host`-nak (a nyilvános hosztnévnek) emellett szerepelnie kell az `ALERT_ALLOWED_HOSTS` listán vagy az `ALERT_PUBLIC_URL` hosztjaként, ezért ott az `ALERT_PUBLIC_URL` beállítása a legegyszerűbb. Ha a proxy a `Host`-ot aláhúzásos upstream-névre írja át, őrizd meg az eredeti `Host`-ot, használj IP-című upstreamet, vagy kapcsold be a hitelesítést. A felület ilyenkor „Ezen a címen nem engedélyezett” hibát mutat a művelet helyén.

**Ismert korlátok:** nincs hang, és a nyugtázás egyetlen operátorra szól. A `source-stale` szabály a tartósan hibás forrást (például az EPA RadNetet, ha 403-at ad) addig mutatja, amíg nem nyugtázod vagy ki nem kapcsolod. A fenyegetettségi szint magas maradhat, amíg valódi magas vagy kritikus riasztás aktív (a CAP „Severe” is magas); a nyugtázás csökkenti. Két egymás utáni sweepben üres vagy hiányzó eseménylista lezárja az eseményalapú riasztásokat, és a visszatérő események a várakozás után új riasztásként értesítenek (forráskiesés után ez várható). Az `/api/alerts` útvonalakon kívüli hibás URL az Express alapértelmezett hibaoldalát adja. A Telegram/Discord `/mute` nem hat az ntfy-ra és a webhookra, a sikertelen küldés nem ismétlődik.

## PWA és offline használat

1. Indítsd el a szervert, és egyszer nyisd meg a `http://localhost:3117` címet online. A shell, térkép, font és textúra helyi fájlokból töltődik. A service worker localhoston vagy HTTPS alatt működik; egy HTTP LAN-cím ehhez nem elég.
2. Telepíts a böngésző alkalmazástelepítési menüjéből, vagy a **PWA** beállítás Telepítés gombjával, ha az adott böngésző felajánlja. Windows alatt Chrome/Edge használható; külön natív csomag nincs.
3. A statikus felület offline újratölthető. Az utolsó eseményadat mentését külön engedélyezd a PWA-beállításban: alapból kikapcsolt, IndexedDB-be kerül, legfeljebb 5 MiB. Offline induláskor gyűjtési idővel és mentettadat-címkével jelenik meg.
4. **Helyi pillanatkép törlése** eltávolítja a snapshotot és letiltja a további mentést. Következő offline induláskor üres felületet kapsz. A böngésző teljes webhelyadat-törlése a shellt és profilokat is eltávolíthatja.
5. Friss gyűjtés, előzménykeresés és export továbbra is futó szervert/hálózatot igényel. Új verzió telepítésekor a letöltött worker a kifejezett frissítésre vár; a gomb újratölti az oldalt.

CacheStorage-ba csak engedélyezett statikus fájl és adatmentes shell kerül; az élő HTML, API, SSE és hitelesítési fejléc nem. A külön engedélyezett snapshot a böngészőprofilban megmarad törlésig. Megosztott gépen a mentett adatok elérését a böngészőprofil hozzáférése határozza meg. Hibás vagy tiltott tárolás esetén a felület visszajelez; az online dashboard használható marad.

## Kiadási assetek és ellenőrzés

A 27 helyi vendor fájl forrása, licence, mérete és SHA-256 hash-e a `dashboard/public/vendor/manifest.json` jegyzékben szerepel. `python scripts/vendor-assets.py --verify` hálózat nélkül ellenőriz, a letöltési mód csak tudatos assetfrissítéskor használandó. A `npm run check` szintén ellenőrzi a jegyzéket. Az eredeti vendor bájtokat a `.gitattributes` őrzi; licenceik a konténerbe is bekerülnek. PWA-változtatáskor a `sw.js` cache-verzióját is emeld, majd ellenőrizd az online és offline shellt.

Valódi böngészős reprodukálás: külön terminálban `node test/fixtures/dashboard-server.mjs`, majd opcionális Playwright 1.62.1 telepítéssel `node scripts/browser-qa.mjs`, `QA_PHASE=all` mellett `node scripts/intelligence-ui-qa.mjs` (fázisai: detail, history, profiles, inspector, live, alerts), végül `node scripts/pwa-qa.mjs`. PowerShellben `$env:QA_PHASE='all'`; a `PLAYWRIGHT_MODULE` egy meglévő modul könyvtárára is mutathat. Ezek kizárólag a localhost:3199 fixture-t használják, operátori konfiguráció nélkül. A teljes [jegyzőkönyv](audit/intelligence-workspace-verification.md) és [megvalósítási jegyzék](audit/intelligence-workspace-implementation.md) tartalmazza az eredményeket.

## Ellenőrzés és támogatási adatok

`npm run check`, `npm test`, `npm audit --omit=dev`. Hibajegyhez Node-verzió, OS, indítási mód, sanitized hibaüzenet, érintett forrás és snapshot-idő szükséges. A teljes `.env`, botqueue, üzleti adatok vagy kulcsot tartalmazó URL helyett csak a szükséges, kitakart részletet add meg.
