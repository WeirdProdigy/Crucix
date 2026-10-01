# Korábbi javaslatok megvalósítása — Crucix 2.4–2.6

A [teljes audit](full-review-2026-10-01.md) termékjavaslatait a meglévő Jarvis felületben valósítottuk meg. A kutatásból funkciómintákat alkalmaztunk saját kóddal; másik projekt teljes stackjét vagy ellenőrizetlen kockázati modelljét nem importáltuk. A felhasználó telepíthető PWA-t választott, ezért külön Tauri-csomag nincs.

| Javaslat / elsődleges inspiráció | Elkészült viselkedés | Kód és kiadás |
| --- | --- | --- |
| Eseményrészletező és eredet | Eredeti URL, observed/published/collected idő, forrásállapot, helymeghatározási módszer/pontosság, kapcsolódó beszámolók; tickerből, eseménylistából és támogatott térképjelölőkből megnyitható | `lib/intelligence/events.mjs`, `dashboard/public/intelligence.js`, `dashboard/inject.mjs`; [2.4.0](https://github.com/mp3pintyo/Crucix/releases/tag/v2.4.0) |
| Kereshető történet | Tartós napló, ékezetfüggetlen szöveg, típus/forrás/UTC gyűjtési dátum szűrés, lapozás, teljes szűrt halmaz idővonala; újraindítás és valid backupból helyreállítás | `lib/intelligence/history.mjs`, `routes.mjs`; [2.5.0](https://github.com/mp3pintyo/Crucix/releases/tag/v2.5.0) |
| [World Monitor](https://github.com/koala73/worldmonitor): közös rétegek, panelváltozatok, helyi AI | Közös flat/globe rétegek már 2.3-ban, helyi OpenAI-compatible modell/rule fallback 2.2-ben; kutatás/piac/infrastruktúra és saját mentett profilok 2.6-ban | `dashboard/public/jarvis.html`, `intelligence.js`, `lib/llm/openai-compatible.mjs`; [2.6.0](https://github.com/mp3pintyo/Crucix/releases/tag/v2.6.0) |
| [World Monitor architektúra](https://github.com/koala73/worldmonitor#tech-stack): cache és telepíthető alkalmazás | Korlátos szerver snapshot/forrás TTL, PWA manifest, verziózott helyi assetek, adatmentes offline shell és külön opt-in utolsóadat-mentés; kézi frissítés | `lib/offline-shell.mjs`, `dashboard/public/pwa.js`, `sw.js`, `manifest.webmanifest`, `vendor/manifest.json`; 2.6.0 |
| [NEXUsint vizualizáció](https://github.com/Kit4Some/NEXUsint#visualization): forrásállapot, rétegek, hírcsoportok, idővonal | Forrásállapot és rétegek már 2.3-ban; választható térbeli/időbeli csoportok mindkét térképen, külön megnyitható eredeti események, kereshető idővonal | `clusterEvents`, `intelligence.js`, `jarvis.html`; 2.5.0 |
| [NEXUsint riportok](https://github.com/Kit4Some/NEXUsint#report-generation): JSON/HTML/PDF/STIX és információminőség | Szűrésazonos JSON/CSV/HTML/STIX export; PDF a böngésző nyomtatásából. A minőség link/idő/hely/forrásállapot lefedettségét jelzi, nem állít igazságvalószínűséget | `lib/intelligence/export.mjs`, `events.mjs`; 2.4–2.5 |

A STIX export [OASIS STIX 2.1](https://docs.oasis-open.org/cti/stix/v2.1/os/stix-v2.1-os.html) report/note objektumokat használ forráshivatkozásokkal. Általános hírekből vagy földrengésekből nem képez kitalált cyber indicatorokat. A kapcsolódó URL-ek és külön hostnevek száma sem bizonyít független megerősítést. A térképes csoport térbeli és időbeli rendezés, nem eseményazonossági ítélet.

## Korlátok és adatvédelem

- Napló: 30 nap, 10 000 rekord, 20 MiB; API-lap: 1–200; export: legfeljebb 2000, jelzett csonkolással. Az utolsó snapshot és az új sweep-ek kerülnek be, meglévő archívumok tömeges visszatöltése nélkül.
- Profil: legfeljebb 12 saját bejegyzés, 64 karakteres név; korlátozott és normalizált browser storage. Tiltott localStorage mellett az aktuális munkamenetben használható.
- PWA: localhost vagy HTTPS, első online látogatás szükséges. A statikus cache nem tartalmaz élő HTML/API/SSE/adatot vagy auth fejléceket. IndexedDB-be csak felhasználói engedély után kerül legfeljebb 5 MiB publikálható snapshot, kulcsokat és privát konfigurációt kizáró mezőlistával. Törlés letiltja a következő mentést is. Megosztott gépen a böngészőprofilhoz kötött mentést kezeld ennek megfelelően.
- Offline: a helyi shell/térkép és engedélyezett utolsó adat működik; friss feed, szervertörténet és export szervert/hálózatot igényel. A mentett adat jól látható időt és offline címkét kap, nem minősül élő megfigyelésnek.
- A [service worker útmutató](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) és [PWA cache útmutató](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching) alapján csak a szükséges statikus erőforrások szerepelnek az allowlistben. A verziófrissítéshez felhasználói művelet kell.

## Ellenőrzés

Az egyes kiadások két nyelvű leírást és külön CI-t kaptak. A [teszt- és böngészős jegyzőkönyv](intelligence-workspace-verification.md) tartalmazza a konkrét eredményeket/képeket. A fixture nem olvas operátori `.env`-t, privát botadatot vagy user archívumot; éles szolgáltatói/modellelfogadást ezek a tesztek nem állítanak.
