# Crucix üzemeltetési útmutató

Ez a fork Node.js 22 vagy 24 alatt, natív Windows/Linux környezetben és Dockerben ellenőrzött. A [teljes audit](audit/full-review-2026-10-01.md) és a [változásnapló](../CHANGELOG.md) részletezi a javításokat.

## Indítás és hozzáférés

`npm ci`, majd `.env.example` másolása `.env`-re és `npm run dev`. PowerShellben a másolás: `Copy-Item .env.example .env`. A gyári cím `http://127.0.0.1:3117`. A felület első adat nélkül várakozó állapotot mutat; a sweep legfeljebb 30 másodpercet vár egy forrásra, majd külön folytatja az ötletgenerálást. A modell határideje ettől független.

LAN-on natív indításhoz `HOST=0.0.0.0`, Compose-hoz `BIND_ADDRESS=0.0.0.0` szükséges. A másik gépen a szerver LAN-címét használd. A botlinkeket a `PUBLIC_URL=http://<LAN-IP>:3117` vezérli. Internetes használathoz HTTPS reverse proxy és `AUTH_USER`/`AUTH_PASSWORD` együtt állítandó be. A HTTP Basic önmagában nem titkosít. `/healthz` minimális, nyilvános liveness végpont; `/api/health`, `/api/data`, a HTML és az SSE hitelesítést kér, ha a credential-pár be van állítva.

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

## Ellenőrzés és támogatási adatok

`npm run check`, `npm test`, `npm audit --omit=dev`. Hibajegyhez Node-verzió, OS, indítási mód, sanitized hibaüzenet, érintett forrás és snapshot-idő szükséges. A teljes `.env`, botqueue, üzleti adatok vagy kulcsot tartalmazó URL helyett csak a szükséges, kitakart részletet add meg.
