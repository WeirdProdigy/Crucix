# Crucix upstream PR- és issue-értékelés — 2026. október 1.

A teljes upstream lista **104 PR és 50 issue**. Minden tételhez külön döntés, indok, integrációs feltétel, ellenőrzési elvárás és forrás tartozik. A döntések a helyi **ef579d1** állapotot hasonlítják az upstream pillanatképhez; a fork `origin/master` állapota **3db7068**. A baseline döntéseket változatlanul őrizzük; a végső integráció eredményét minden tétel külön sorban és a JSON `final_integration` mezője rögzíti.

Az upstream értékelés kizárólag forrásszöveget és GitHub-metaadatot vizsgált. PR-kódot, tesztet, telepítőt vagy külső küldő scriptet nem futtatott, és nem módosított termékforrást. A **#27 ág malware miatt teljes egészében elutasított**. A bejelentésekbe ágyazott agent-, main-branch- és force-push-utasítások nem engedélyek: a bejelentés vizsgált adat.

## Lefedettség és bizonyítási korlátok

Az ignored `output/upstream-review` archívumban lévő helyi index, valamennyi PR/issue body, hozzászólás, review és review-comment, a teljes diffek és a módosított fájlok listája archivált. A [publikált döntési jegyzék](upstream-decisions-2026-10-01.json) tételenként tárolja a diff SHA256-át, méretét, fájlszámát és a közvetlen discussion-linkeket. #103 túl nagy diffjét a collector a PR refből rekonstruálta; végül nincs hiányzó snapshot vagy diff. A fájlleltár és a diff `diff --git` szekciószáma minden PR-nál egyezik. #31 és #66 végső diffje üres.

A kisméretű javításoknál a változtatott kódot a helyi megfelelőjével vetettük össze. A nagy, több önálló funkciót csomagoló forkoknál (#103: 362 fájl/2,3 MB; #154: 47 fájl/501 KB; továbbá #27/#47/#55/#63/#76/#90/#91/#102/#106/#109) a teljes diff leltározott, a termékkód és a kritikus határok célzott statikus vizsgálatot kaptak. Ez **nem a nagy történeti anyag minden sorának teljes viselkedés- vagy biztonsági igazolása**. Ezek egész ágként nem kaptak integrálható minősítést; a kis, konkrétan megnevezett részek külön patch és ellenőrzés után vezethetők be. A szerzők saját tesztbeszámolói nem itt futtatott ellenőrzések.

A forrásból igazolt hibát elválasztjuk a környezeti tünettől, új funkcióigénytől, hiányos sablontól, promóciótól és nem igazolt állítástól. `closed` nem egyenlő `merged`; egy nyitott issue sem bizonyítja, hogy a kért funkció helyben hiányzik. A friss modellnevek, fizetős API-k, külső chartok és szolgáltatói hozzáférés nem kaptak élő működési igazolást.

A részletes szakaszok archív snapshot/diff linkjei helyi bizonyítékra mutatnak, és GitHubon nem elérhetőek: a nyers, esetenként veszélyes PR-anyag nem kerül a termékrepóba. A publikus GitHub body/discussion-linkek és teljes diff-hashok a publikált jegyzékben megmaradnak.

## Végső integráció

- `already_present_retained`: 40 tétel.
- `covered_by_existing_or_selected_fix`: 5 tétel.
- `deferred_optional`: 17 tétel.
- `environment_dependent_documented`: 4 tétel.
- `implemented`: 58 tétel.
- `no_actionable_code_change`: 8 tétel.
- `partially_adapted`: 8 tétel.
- `rejected`: 11 tétel.
- `rejected_unsafe`: 2 tétel.
- `risk_reduced_external_claim_unverified`: 1 tétel.

Mindhárom nagy változás külön HU/EN changelogot és GitHub release-t kap: [2.1.0](../releases/v2.1.0.md), [2.2.0](../releases/v2.2.0.md), [2.3.0](../releases/v2.3.0.md). A `partially_adapted` státusz az egyedileg megnevezett hasznos rész beépítését jelenti; az egész összecsomagolt forkét nem.

## Megőrzendő saját funkciók

A magyar felület, `TRADE_IDEAS_LANG`, helyi WHO rangsorolás és helyfelismerés, ReliefWeb/HDX kiegészítő egészséginformáció, IODA, élő adat-injektálás/no-cache, mozgatható és mentett panelbeállítások, valamint a saját Discord-ready/flag/render javítások kötelezően megmaradnak. A baseline 30 forrásból áll. A régi upstream 26/27/29 feliratok másolása regresszió lenne; a számláló a végső forrásregisztrációból származzon.

## Elsőként integrálandó, forrásból igazolt változások

| Prioritás | Upstream tételek | Konkrét helyi teendő | Fontos feltétel |
| --- | --- | --- | --- |
| P0 | #135, #134; #150 alternatíva elutasítva | `jarvis.html`, `server.mjs`, `inject.mjs`: külső text/attribute/URL és inline JSON biztonságos renderelése | A saját WHO/HDX/IODA/settings popupok is; tényleges DOM payload-ellenőrzés |
| P0 | #27, #142 | Veszélyes ág kizárása | Semmit nem futtatni/importálni belőle; attribúciót nem túlállítani |
| P1 | #133, #132, #153 | Egy közös rules fallback a szerverben és CLI-ben | HU nyelv átadása, chronological WTI helyes iránya, normalizált idea típus/eredet |
| P1 | #84, #121 | `apis/utils/fetch.mjs`: teljes body-deadline, timer cleanup, bounded retries | Retry-After szám és HTTP-date, body cancel, teljes forrásbudget |
| P1 | #130, #101 | OFAC egyszeri, korlátos meta/minta letöltés | Range-t figyelmen kívül hagyó szervernél is byte cap és cancel; első minta nem latest entries |
| P1 | #129 | NOAA nem támogatott query-paraméter elhagyása, hibák forrásegészségben | API error ne legyen üres siker |
| P1 | #147, #113 | OpenSky korlátos cache-életkor és látható stale jelzés | Érvénytelen/jövőbeli idő és fájlnévsorrend nem kerülheti meg |
| P1 | #148, #115 | GDELT valódi publikálási idő | Compact/ISO UTC validáció; ismeretlen idő `null`, nem now |
| P1 | #145/#149, #112/#116 | RSS jitter és régió-centroid eseménypont eltávolítása | Regionális ticker megmarad; inferred hely nem pontos mért adat |
| P1 | #144, #114 | BBC World/Science HTTPS | Két tényleges feed URL |
| P1 | #124 | LLM delta `from/to/pctChange` mezők | Nulla/null és magyar prompt |
| P1 | #136/#88, #87 | Konfigurálható ideas/alerts timeout és tokenkeret | A call-site tényleg használja; empty length finish és rules fallback |
| P1 | #95/#96/#98 | Páros env idézőjelek | Existing env elsőbbség és mismatched quote megőrzése |
| P1 | #127/#92/#143, #100/#119/#139 | API shape-ellenőrzés, egy SSE és fallback/reconnect | Az alap inline HTTP boot már megvan; `file:` mód statikus |
| P1 | #128/#39 | Banner és szigorú port | 5 jegyű porttal is indul; non-root külön volume-jog ellenőrzés |
| P1 | #151/#70 | Országnevek pan/zoom alatt is látszanak | Scale compensation és magyar felirat megmarad |
| P1 | #152/#56 | Yahoo hibánál symbol/name megőrzése | HTML200 nem ár és nem unknown instrumentum |
| P1/P2 | #55/#21/#24, #117 | Generikus OpenAI-compatible provider | Helyi keyless explicit; Ollama régi env, remote auth, URL normalizálás |
| P2 | #97/#98 | `PUBLIC_URL` | Validált http(s), LAN/proxy értesítési link |

## Hasznos, külön választható bővítések

#76 rétegkapcsolói jól illenek a saját panelbeállításokhoz; a főváros-adathalmaz külön döntés. #81 USGS kulcs nélkül új jelzést adhat, de `significant_day` nem az összes M4+ esemény, a tsunami flag nem kiadott hatósági riasztás. #50 két kis Arctic chokepoint, #37 mérhető animációs/marker javítás, #58 csak ötletgenerálást ritkító cadence, #75 forráslinkes és érthetőbb botriasztás szintén értékes lehet.

Cursor (#20), Novita (#94), Requesty (#140), Feishu (#137), Bedrock/chat (#122), Adanos (#10), DeepSeek/ZH (#106/#138) önálló provider-, régió- vagy kommunikációs igényhez kötött. A generikus compatible adapter több szolgáltatót külön SDK nélkül lefedhet; nincs indok minden szolgáltatót és új függőséget alapból hozzáadni. #154-ből a health-állapotok, közös botparancsok és korlátos cache/history önállóan adaptálhatók; AIS/orbit/OAuth külön életciklus- és hitelességvizsgálatot igényel.

## Upstream merge-stratégia

Az upstream **31 merge-elt PR-jából 29 merge commit már a helyi ef579d1 őse**. Két későbbi merge hiányzik: [#98](https://github.com/calesthio/Crucix/pull/98), `96863bff53c2e552d33082f33f081b114cdab3f9`, és [#99](https://github.com/calesthio/Crucix/pull/99), `3db7068817e0c815df353fa0f19657c85142789d`. #98 környezeti/Discord részeinek egy része saját commitból már jelen van; a Gemini thought-part és ideas parser még külön értékelendő. #99 #98-ra épül és új pénzügyi Discord ötlet-riasztásokat csomagol. **A merge commitok vak cherry-pickje nem javasolt**: csak a hiányzó részek szelektív átvezetése, a helyi HU/WHO/IODA/settings/Discord különbségek megőrzésével. #109 upstream nem merge-elt, de a saját változásai már helyben vannak.

## Szolgáltatói állítások ellenőrzése

#108 Reddit unauthenticated `.json` fallbackot helyesen azonosít. Az aktuális [Reddit Data API Terms 2.8](https://redditinc.com/policies/data-api-terms) dokumentált hozzáférési információ használatát írja elő és az identitás maszkolását tiltja. Ez valós szolgáltatói megfelelési kockázat; az audit nem általános jogi ítélet. A stale rész csak részben igaz: a helyi szerver már küld `sweep_error` eseményt és health `lastSweep` időt, de látható frissességjelzés tovább javítható.

#110 Telegram scraper és böngésző User-Agent tény, de a hivatkozott „4.3” szakasz az ellenőrzött aktuális [Telegram EU ToS](https://telegram.org/tos/eu) oldalon nem található. A [Bot API dokumentáció](https://core.telegram.org/bots/api#getting-updates) szerint a `getUpdates` bejövő update-eket ad, legfeljebb 24 órás queue-ból; ebből az audit arra következtet, hogy tetszőleges nyilvános csatornatörténet nem cserélhető erre egy az egyben. A kötelező token és a preview-funkció törlése ezért nem igazolt általános javítás.

## Tételes PR-döntések

| PR | Állapot | Döntés | Prioritás |
| --- | --- | --- | --- |
| [#1 — feat(i18n): Add internationalization support with English and French locales](https://github.com/calesthio/Crucix/pull/1) | merged | Már jelen van | P3 |
| [#2 — feat: pin Node 22, add npm start/clean scripts, and Jarvis loading page for first run ](https://github.com/calesthio/Crucix/pull/2) | merged | Már jelen van | P3 |
| [#4 — feat: 3D WebGL globe, CelesTrak space tracking, AGPLv3 license](https://github.com/calesthio/Crucix/pull/4) | merged | Már jelen van | P3 |
| [#5 — Add clickable article links to Live News Ticker](https://github.com/calesthio/Crucix/pull/5) | merged | Már jelen van | P3 |
| [#6 — Fix .env.example inline comments breaking Docker](https://github.com/calesthio/Crucix/pull/6) | merged | Már jelen van | P3 |
| [#8 — feat: add MiniMax as LLM provider](https://github.com/calesthio/Crucix/pull/8) | merged | Már jelen van | P3 |
| [#9 — feat: add news sources, 30-day filter, and fix ticker crash](https://github.com/calesthio/Crucix/pull/9) | merged | Már jelen van | P3 |
| [#10 — feat: add Adanos social sentiment source](https://github.com/calesthio/Crucix/pull/10) | open / nem merged | Opcionális, külön igényhez | P2 |
| [#11 — Suprression du readme.md](https://github.com/calesthio/Crucix/pull/11) | closed / nem merged | Elutasítva | P3 |
| [#12 — docs: add contributor and security scaffolding](https://github.com/calesthio/Crucix/pull/12) | merged | Már jelen van | P3 |
| [#14 — Add Mistral AI as LLM provider](https://github.com/calesthio/Crucix/pull/14) | merged | Már jelen van | P3 |
| [#16 — feat: add openrouter support](https://github.com/calesthio/Crucix/pull/16) | merged | Már jelen van | P3 |
| [#17 — Small setup friction improvement and correction](https://github.com/calesthio/Crucix/pull/17) | closed / nem merged | Duplikátum | P3 |
| [#18 — Small setup friction improvement and correction](https://github.com/calesthio/Crucix/pull/18) | merged | Már jelen van | P3 |
| [#19 — fix(security): patch undici CVEs, restore discord.js@14](https://github.com/calesthio/Crucix/pull/19) | merged | Már jelen van | P2 |
| [#20 — feat(llm): add Cursor provider via cursor-api-proxy](https://github.com/calesthio/Crucix/pull/20) | open / nem merged | Opcionális, külön igényhez | P2 |
| [#21 — Add support for custom OpenAI APIs](https://github.com/calesthio/Crucix/pull/21) | closed / nem merged | Részben adaptálandó | P2 |
| [#22 — Add introductory note to CONTRIBUTING.md](https://github.com/calesthio/Crucix/pull/22) | open / nem merged | Nincs termékváltozás | P3 |
| [#24 — feat(llm): add support for custom OpenAI-compatible API base URL](https://github.com/calesthio/Crucix/pull/24) | closed / nem merged | Részben adaptálandó | P2 |
| [#26 — Fix Al Jazeera RSS feed URL](https://github.com/calesthio/Crucix/pull/26) | merged | Már jelen van | P3 |
| [#27 — feat(ui): add custom scrollbaar to dashboard](https://github.com/calesthio/Crucix/pull/27) | open / nem merged | Elutasítva | P0 |
| [#28 — Fix telegram](https://github.com/calesthio/Crucix/pull/28) | closed / nem merged | Duplikátum | P2 |
| [#29 — Fix telegram](https://github.com/calesthio/Crucix/pull/29) | merged | Már jelen van | P3 |
| [#31 — feat: support for openrouter added](https://github.com/calesthio/Crucix/pull/31) | closed / nem merged | Duplikátum | P3 |
| [#32 — fix: prevent infinite loading screen by adding sweep timeouts](https://github.com/calesthio/Crucix/pull/32) | merged | Már jelen van | P2 |
| [#34 — Add zoom-aware symbology, fix globe popovers, expand geo coverage](https://github.com/calesthio/Crucix/pull/34) | merged | Már jelen van | P3 |
| [#35 — Add prebuilt Docker image publishing to GHCR](https://github.com/calesthio/Crucix/pull/35) | merged | Már jelen van | P2 |
| [#36 — feat: upgrade MiniMax default model to M2.7](https://github.com/calesthio/Crucix/pull/36) | open / nem merged | Opcionális, külön igényhez | P2 |
| [#37 — Feature: optimize map rendering](https://github.com/calesthio/Crucix/pull/37) | open / nem merged | Részben adaptálandó | P2 |
| [#38 — Add Ollama provider for self-hosted LLM inference](https://github.com/calesthio/Crucix/pull/38) | merged | Már jelen van | P2 |
| [#39 — Security hardening - prevent command injection, limit SSE connections, harden container](https://github.com/calesthio/Crucix/pull/39) | open / nem merged | Részben adaptálandó | P2 |
| [#42 — Add signal guide glossary to dashboard](https://github.com/calesthio/Crucix/pull/42) | merged | Már jelen van | P3 |
| [#43 — Added the Strait of Gibraltar into CHOKEPOINTS](https://github.com/calesthio/Crucix/pull/43) | merged | Már jelen van | P3 |
| [#44 — Improve mobile globe loading and low perf behavior](https://github.com/calesthio/Crucix/pull/44) | merged | Már jelen van | P3 |
| [#45 — docs: add helm/kubernetes install instructions](https://github.com/calesthio/Crucix/pull/45) | open / nem merged | Opcionális, külön igényhez | P3 |
| [#46 — feat(llm): add Mistral provider](https://github.com/calesthio/Crucix/pull/46) | open / nem merged | Elutasítva | P2 |
| [#47 — Add Groq LLM](https://github.com/calesthio/Crucix/pull/47) | closed / nem merged | Részben adaptálandó | P2 |
| [#49 — Feat/ethos aegis integration](https://github.com/calesthio/Crucix/pull/49) | closed / nem merged | Elutasítva | P2 |
| [#50 — Added Chokepoints for the Northwest Passage](https://github.com/calesthio/Crucix/pull/50) | open / nem merged | Opcionális, külön igényhez | P3 |
| [#53 — Fix dashboard regressions and add OpenSky fallback](https://github.com/calesthio/Crucix/pull/53) | merged | Már jelen van | P2 |
| [#55 — feat: add openai-compatible provider for local LLMs (LM Studio, Ollama)](https://github.com/calesthio/Crucix/pull/55) | open / nem merged | Részben adaptálandó | P1 |
| [#57 — docs: add comprehensive architecture report](https://github.com/calesthio/Crucix/pull/57) | open / nem merged | Részben adaptálandó | P3 |
| [#58 — feat: add LLM_EVERY_N_SWEEPS to reduce API costs](https://github.com/calesthio/Crucix/pull/58) | open / nem merged | Részben adaptálandó | P2 |
| [#59 — Add regional RSS feeds for South America, India, and Australia](https://github.com/calesthio/Crucix/pull/59) | merged | Már jelen van | P3 |
| [#60 — Support Ollama](https://github.com/calesthio/Crucix/pull/60) | closed / nem merged | Duplikátum | P3 |
| [#61 — feat: add xAI Grok as LLM provider](https://github.com/calesthio/Crucix/pull/61) | closed / nem merged | Duplikátum | P3 |
| [#62 — feat: LLM provider for Grok](https://github.com/calesthio/Crucix/pull/62) | merged | Már jelen van | P3 |
| [#63 — feat: UK-centric edition — replace 8 US sources with UK/European equi…](https://github.com/calesthio/Crucix/pull/63) | closed / nem merged | Elutasítva | P2 |
| [#65 — fix: resolve horizontal overflow on mobile control panel](https://github.com/calesthio/Crucix/pull/65) | merged | Már jelen van | P3 |
| [#66 — OpenAI / Open WebUI](https://github.com/calesthio/Crucix/pull/66) | closed / nem merged | Nincs termékváltozás | P3 |
| [#68 — Fix remaining OSINT signal text truncation](https://github.com/calesthio/Crucix/pull/68) | merged | Már jelen van | P3 |
| [#69 — Add CISA-KEV and Cloudflare Radar source adapters](https://github.com/calesthio/Crucix/pull/69) | merged | Már jelen van | P3 |
| [#71 — Omega ](https://github.com/calesthio/Crucix/pull/71) | closed / nem merged | Elutasítva | P2 |
| [#73 — Revert "Add regional RSS feeds for South America, India, and Australia"🇦🇺 ](https://github.com/calesthio/Crucix/pull/73) | closed / nem merged | Elutasítva | P3 |
| [#76 — feat: add layer toggles and world capitals to dashboard](https://github.com/calesthio/Crucix/pull/76) | closed / nem merged | Részben adaptálandó | P2 |
| [#81 — Add USGS Earthquake Hazards API source](https://github.com/calesthio/Crucix/pull/81) | closed / nem merged | Részben adaptálandó | P2 |
| [#82 — Enforce JSON schema for Gemini responses](https://github.com/calesthio/Crucix/pull/82) | open / nem merged | Elutasítva | P1 |
| [#83 — chore/security(package-lock): bump path-to-regexp 8.3.0 - 8.4.0](https://github.com/calesthio/Crucix/pull/83) | open / nem merged | Már jelen van | P1 |
| [#84 — fix: safeFetch timer leak, env quote stripping, source count](https://github.com/calesthio/Crucix/pull/84) | open / nem merged | Részben adaptálandó | P1 |
| [#85 — feat: add gold and silver to macro + markets context](https://github.com/calesthio/Crucix/pull/85) | merged | Már jelen van | P3 |
| [#88 — Ollama time out](https://github.com/calesthio/Crucix/pull/88) | open / nem merged | Részben adaptálandó | P1 |
| [#89 — Fix live market index symbols](https://github.com/calesthio/Crucix/pull/89) | merged | Már jelen van | P3 |
| [#90 — repo-health: add tests, error handling, security, and CI](https://github.com/calesthio/Crucix/pull/90) | closed / nem merged | Elutasítva | P2 |
| [#91 — Feature/adsb live feed and mobile fixes](https://github.com/calesthio/Crucix/pull/91) | open / nem merged | Opcionális, külön igényhez | P2 |
| [#92 — fix: always fetch live API data in server mode](https://github.com/calesthio/Crucix/pull/92) | open / nem merged | Már jelen van | P1 |
| [#94 — feat: add Novita AI as LLM provider](https://github.com/calesthio/Crucix/pull/94) | closed / nem merged | Opcionális, külön igényhez | P2 |
| [#95 — fix(env): strip surrounding quotes from .env values](https://github.com/calesthio/Crucix/pull/95) | open / nem merged | Részben adaptálandó | P1 |
| [#96 — fix(discord): register slash commands after client is ready](https://github.com/calesthio/Crucix/pull/96) | open / nem merged | Részben adaptálandó | P1 |
| [#97 — feat(config): add PUBLIC_URL for bot status dashboard link](https://github.com/calesthio/Crucix/pull/97) | open / nem merged | Részben adaptálandó | P2 |
| [#98 — fix(llm): Gemini 2.5 compatibility — thinking parts and response parsing](https://github.com/calesthio/Crucix/pull/98) | merged | Részben adaptálandó | P1 |
| [#99 — feat(discord): actionable trade idea alerts for prediction markets](https://github.com/calesthio/Crucix/pull/99) | merged | Részben adaptálandó | P2 |
| [#102 — feat(i18n): add Chinese locale + real-time LLM translation](https://github.com/calesthio/Crucix/pull/102) | closed / nem merged | Elutasítva | P2 |
| [#103 — Add first-class X social lead intake](https://github.com/calesthio/Crucix/pull/103) | open / nem merged | Elutasítva | P1 |
| [#106 — feat(i18n): full Chinese (zh) localization with DeepSeek LLM translation](https://github.com/calesthio/Crucix/pull/106) | closed / nem merged | Részben adaptálandó | P2 |
| [#109 — Carry local changes to fork](https://github.com/calesthio/Crucix/pull/109) | closed / nem merged | Már jelen van | P1 |
| [#120 — feat(llm): upgrade MiniMax default model to M3](https://github.com/calesthio/Crucix/pull/120) | open / nem merged | Opcionális, külön igényhez | P2 |
| [#121 — fix(safeFetch): exponential backoff, HTTP 429 awareness, Retry-After support](https://github.com/calesthio/Crucix/pull/121) | open / nem merged | Részben adaptálandó | P1 |
| [#122 — feat: bedrock support + latest data sources](https://github.com/calesthio/Crucix/pull/122) | open / nem merged | Opcionális, külön igényhez | P2 |
| [#123 — ci: pin GitHub Actions to full commit SHAs](https://github.com/calesthio/Crucix/pull/123) | open / nem merged | Részben adaptálandó | P1 |
| [#124 — fix: wrong delta property names in LLM prompt, stale source counts](https://github.com/calesthio/Crucix/pull/124) | open / nem merged | Részben adaptálandó | P1 |
| [#126 — feat(llm): add MiniMax-M3 and MiniMax-M2.7 text model coverage](https://github.com/calesthio/Crucix/pull/126) | open / nem merged | Opcionális, külön igényhez | P2 |
| [#127 — Fix #119: always fetch live /api/data in server mode + SSE reconnect/…](https://github.com/calesthio/Crucix/pull/127) | open / nem merged | Részben adaptálandó | P1 |
| [#128 — fix(server): crash on startup when PORT is 10000 or higher](https://github.com/calesthio/Crucix/pull/128) | open / nem merged | Részben adaptálandó | P1 |
| [#129 — fix(noaa): severe weather always reported zero — /alerts/active rejects `limit`](https://github.com/calesthio/Crucix/pull/129) | open / nem merged | Bevezetendő | P1 |
| [#130 — fix(ofac): stop downloading 267 MB per sweep; source always timed out](https://github.com/calesthio/Crucix/pull/130) | open / nem merged | Részben adaptálandó | P1 |
| [#133 — fix(ideas): wire up rule-based idea engine as LLM fallback](https://github.com/calesthio/Crucix/pull/133) | open / nem merged | Részben adaptálandó | P1 |
| [#135 — fix(dashboard): escape untrusted feed and LLM text before innerHTML](https://github.com/calesthio/Crucix/pull/135) | open / nem merged | Részben adaptálandó | P0 |
| [#136 — fix: harden Ollama provider for reasoning models + configurable LLM budgets](https://github.com/calesthio/Crucix/pull/136) | closed / nem merged | Részben adaptálandó | P1 |
| [#137 — feat(alerts): add Feishu (Lark) alerter with rich card messages](https://github.com/calesthio/Crucix/pull/137) | open / nem merged | Opcionális, külön igényhez | P2 |
| [#138 — feat(i18n): add Chinese (zh) locale with full 281-key coverage](https://github.com/calesthio/Crucix/pull/138) | open / nem merged | Opcionális, külön igényhez | P3 |
| [#140 — feat(llm): add Requesty provider (OpenAI-compatible unified API)](https://github.com/calesthio/Crucix/pull/140) | open / nem merged | Opcionális, külön igényhez | P2 |
| [#141 — docs: add source operations guides starting with OpenSky](https://github.com/calesthio/Crucix/pull/141) | open / nem merged | Részben adaptálandó | P2 |
| [#143 — Fix dashboard never fetching live data on load](https://github.com/calesthio/Crucix/pull/143) | open / nem merged | Duplikátum | P1 |
| [#144 — Use HTTPS for core BBC RSS feeds](https://github.com/calesthio/Crucix/pull/144) | open / nem merged | Bevezetendő | P1 |
| [#145 — Stop randomizing news marker coordinates on the map](https://github.com/calesthio/Crucix/pull/145) | open / nem merged | Bevezetendő | P1 |
| [#146 — Fix naive substring match causing false urgent-keyword flags](https://github.com/calesthio/Crucix/pull/146) | open / nem merged | Részben adaptálandó | P1 |
| [#147 — Add freshness bound to OpenSky historical fallback](https://github.com/calesthio/Crucix/pull/147) | open / nem merged | Részben adaptálandó | P1 |
| [#148 — Preserve GDELT article publication time instead of synthesizing 'now'](https://github.com/calesthio/Crucix/pull/148) | open / nem merged | Részben adaptálandó | P1 |
| [#149 — Don't plot regional RSS fallback items at a fabricated source centroid](https://github.com/calesthio/Crucix/pull/149) | open / nem merged | Részben adaptálandó | P1 |
| [#150 — Fix stored XSS in jarvis.html popup/panel rendering](https://github.com/calesthio/Crucix/pull/150) | open / nem merged | Elutasítva | P0 |
| [#151 — Fix flat-map marker labels vanishing on pan](https://github.com/calesthio/Crucix/pull/151) | open / nem merged | Bevezetendő | P1 |
| [#152 — Fix Macro+Markets panel going empty when Yahoo Finance blocks requests](https://github.com/calesthio/Crucix/pull/152) | open / nem merged | Bevezetendő | P1 |
| [#153 — Wire rule-based idea engine as fallback when LLM is not configured](https://github.com/calesthio/Crucix/pull/153) | open / nem merged | Duplikátum | P1 |
| [#154 — Deploy](https://github.com/calesthio/Crucix/pull/154) | closed / nem merged | Részben adaptálandó | P2 |

### PR #1 — feat(i18n): Add internationalization support with English and French locales

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/1) · [archivált snapshot](../../output/upstream-review/pr-1.json)

**Már jelen van · P3 · Új funkció.** Az EN/FR locale és getLocale alapja már helyi őscommit; a végső diff nem tartalmazza a leírásban említett öt új forrást.

**Integrációs feltétel:** Megőrizni a helyi HU/getLocaleForLanguage/TRADE_IDEAS_LANG bővítést; nincs import.

**Ellenőrzés / korlát:** HU/EN/FR locale smoke; a leírás nem forrásbővítés-bizonyíték.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`, `lib/i18n.mjs`, `locales/en.json`, `locales/fr.json`, `server.mjs`.

**Bizonyíték:** 53 453 karakter teljes diff  5 fájl; 6 hozzászólás  3 review  0 review-comment. Merge `3fed206e594cbf1f0c226067364854a0f698ff59`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #2 — feat: pin Node 22, add npm start/clean scripts, and Jarvis loading page for first run

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/2) · [archivált snapshot](../../output/upstream-review/pr-2.json)

**Már jelen van · P3 · Hiba.** Node22, loading/indulási javítások és időkorlátok beolvadtak.

**Integrációs feltétel:** Saját indulási változásokat és Node22 engine-t megőrizni.

**Ellenőrzés / korlát:** Végső ágon startup smoke; nincs új cherry-pick.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`, `dashboard/public/loading.html`, `package.json`, `scripts/clean.mjs`, `server.mjs`, `.nvmrc`.

**Bizonyíték:** 10 392 karakter teljes diff  6 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `d09ecc72a103f9b85ec0bc452c78db09912e5310`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #4 — feat: 3D WebGL globe, CelesTrak space tracking, AGPLv3 license

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/4) · [archivált snapshot](../../output/upstream-review/pr-4.json)

**Már jelen van · P3 · Új funkció.** Földgömb, Space és AGPL már helyi őscommit.

**Integrációs feltétel:** HU térképfelirat és draggable panelek nem felülírhatók.

**Ellenőrzés / korlát:** Map/Space regressziós smoke.

**Helyi érintettség (ef579d1):** `apis/briefing.mjs`, `apis/sources/space.mjs`, `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `package.json`, `LICENSE`, `README.md`.

**Bizonyíték:** 106 310 karakter teljes diff  8 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `35658ac6a10b00d33106690d551e4d0cd872a928`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #5 — Add clickable article links to Live News Ticker

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/5) · [archivált snapshot](../../output/upstream-review/pr-5.json)

**Már jelen van · P3 · Hiba.** Kattintható hírlink és http(s) URL-szűrés már megvan.

**Integrációs feltétel:** Safe link-szűrés az XSS-javítás mellett is maradjon.

**Ellenőrzés / korlát:** javascript:/data: tiltott; https link működik.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték:** 5 488 karakter teljes diff  2 fájl; 4 hozzászólás  1 review  0 review-comment. Merge `183702e688ed7eabf8eb187de2dafb40afe27c4a`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #6 — Fix .env.example inline comments breaking Docker

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/6) · [archivált snapshot](../../output/upstream-review/pr-6.json)

**Már jelen van · P3 · Hiba.** .env.example inline kommentek külön sorra kerültek; #7 megoldott.

**Integrációs feltétel:** #95 idézőjel-parser külön adaptálható.

**Ellenőrzés / korlát:** Példakulcsba nem kerül komment.

**Helyi érintettség (ef579d1):** `.env.example`.

**Bizonyíték:** 2 459 karakter teljes diff  1 fájl; 2 hozzászólás  1 review  0 review-comment. Merge `5c746d930a36c28ce7ae6494bd9f44ed41e89a88`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #8 — feat: add MiniMax as LLM provider

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/8) · [archivált snapshot](../../output/upstream-review/pr-8.json)

**Már jelen van · P3 · Új funkció.** MiniMax provider megvan.

**Integrációs feltétel:** Defaultmodellt #36/#120/#126 versengés miatt nem váltani igazolás nélkül.

**Ellenőrzés / korlát:** Adapter regresszió; aktuális távoli modell külön igazolandó.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/minimax.mjs`, `README.md`.

**Bizonyíték:** 14 477 karakter teljes diff  7 fájl; 0 hozzászólás  1 review  0 review-comment. Merge `1959cc1199f8905bbb14515ecfc9631e28450b57`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #9 — feat: add news sources, 30-day filter, and fix ticker crash

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/9) · [archivált snapshot](../../output/upstream-review/pr-9.json)

**Már jelen van · P3 · Új funkció.** RSS ticker és 30napos szűrés megvan.

**Integrációs feltétel:** Forrásidő/provenance javítás mellett a ticker megmarad.

**Ellenőrzés / korlát:** Régi/idő nélküli hír smoke.

**Helyi érintettség (ef579d1):** `apis/sources/who.mjs`, `dashboard/inject.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték:** 6 258 karakter teljes diff  3 fájl; 4 hozzászólás  1 review  0 review-comment. Merge `8f260e7196d1fa3790c8b3d0d4eb1d11621afe71`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #10 — feat: add Adanos social sentiment source

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/10) · [archivált snapshot](../../output/upstream-review/pr-10.json)

**Opcionális, külön igényhez · P2 · Új funkció.** Adanos új API-key sentiment forrás. Number(null)=0 miatt hiányzó érték neutral lehet, APIhiba üres sikernek tűnik.

**Integrációs feltétel:** Opt-in; null maradjon null, hibák source-health, nearzero sentiment ne kapjon pct thresholdot; rules #133 után.

**Ellenőrzés / korlát:** Mock key/401/429/null/empty/schema; élő szolgáltatói igazolás hiányzik.

**Helyi érintettség (ef579d1):** `.env.example`, `apis/briefing.mjs`, `apis/sources/adanos.mjs` (a baseline-ban nincs), `dashboard/inject.mjs`, `lib/delta/engine.mjs`.

**Bizonyíték:** 11 975 karakter teljes diff  5 fájl; 3 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #11 — Suprression du readme.md

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/11) · [archivált snapshot](../../output/upstream-review/pr-11.json)

**Elutasítva · P3 · Hiányos/érvénytelen.** Lezárt, nem merge-elt PR README-t témán kívüli placeholderre cserél.

**Integrációs feltétel:** Nem importálni.

**Ellenőrzés / korlát:** Nincs termékteszt.

**Helyi érintettség (ef579d1):** `README.md`.

**Bizonyíték:** 25 301 karakter teljes diff  1 fájl; 1 hozzászólás  1 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #12 — docs: add contributor and security scaffolding

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/12) · [archivált snapshot](../../output/upstream-review/pr-12.json)

**Már jelen van · P3 · Dokumentáció.** CONTRIBUTING/SECURITY/sablonok már helyi őscommit.

**Integrációs feltétel:** Helyi munkafolyamatot megőrizni.

**Ellenőrzés / korlát:** Linkellenőrzés elegendő.

**Helyi érintettség (ef579d1):** `.github/ISSUE_TEMPLATE/config.yml`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/pull_request_template.md`, `.gitignore`, `CONTRIBUTING.md`, `README.md`, `SECURITY.md`.

**Bizonyíték:** 9 204 karakter teljes diff  8 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `07d1a25942944b2e636f1b4b1cf3c44041f38384`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #14 — Add Mistral AI as LLM provider

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/14) · [archivált snapshot](../../output/upstream-review/pr-14.json)

**Már jelen van · P3 · Új funkció.** Mistral raw-fetch provider megvan; deprecatedmodell review a végső diffben javult.

**Integrációs feltétel:** #46 SDK duplikációját nem hozzáadni.

**Ellenőrzés / korlát:** Provider/ideas JSON mock.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/mistral.mjs`, `README.md`.

**Bizonyíték:** 13 999 karakter teljes diff  7 fájl; 4 hozzászólás  3 review  0 review-comment. Merge `6514d7c00dc16bfe346bbae577ecbea80250bcf3`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #16 — feat: add openrouter support

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/16) · [archivált snapshot](../../output/upstream-review/pr-16.json)

**Már jelen van · P3 · Új funkció.** OpenRouter provider már megvan, #13 lezárt.

**Integrációs feltétel:** Nem újraimplementálni.

**Ellenőrzés / korlát:** Key/model hiány és adapter tesztek.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/openrouter.mjs`, `README.md`.

**Bizonyíték:** 11 680 karakter teljes diff  7 fájl; 1 hozzászólás  2 review  0 review-comment. Merge `71959519970922ecade60f30d3dd43c27788b46f`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #17 — Small setup friction improvement and correction

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/17) · [archivált snapshot](../../output/upstream-review/pr-17.json)

**Duplikátum · P3 · Dokumentáció.** Lezárt korábbi Compose patch, végleges #18 már beolvadt.

**Integrációs feltétel:** #18 helyi állapotát megtartani.

**Ellenőrzés / korlát:** Nincs új teszt.

**Helyi érintettség (ef579d1):** `docker-compose.yml`, `README.md`.

**Bizonyíték:** 816 karakter teljes diff  2 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `covered_by_existing_or_selected_fix` — Nem kapott külön merge-et; a jelentésben azonosított végleges vagy kiválasztott megoldás fedi. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #18 — Small setup friction improvement and correction

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/18) · [archivált snapshot](../../output/upstream-review/pr-18.json)

**Már jelen van · P3 · Dokumentáció.** Compose version eltávolítás és README útvonal megvan.

**Integrációs feltétel:** Helyi Windows/Compose saját részek megmaradnak.

**Ellenőrzés / korlát:** docker compose config ha Compose módosul.

**Helyi érintettség (ef579d1):** `docker-compose.yml`, `README.md`.

**Bizonyíték:** 816 karakter teljes diff  2 fájl; 0 hozzászólás  1 review  0 review-comment. Merge `4761c3d221d593d356bf35810c175536fc9b69b0`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #19 — fix(security): patch undici CVEs, restore discord.js@14

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/19) · [archivált snapshot](../../output/upstream-review/pr-19.json)

**Már jelen van · P2 · Biztonság.** Undici override/Discord kompatibilis frissítés megvan; helyi Discord újabb14.26.4.

**Integrációs feltétel:** Pontos helyi lockhoz aktuális npm audit, nem régi patch.

**Ellenőrzés / korlát:** Current audit és Discord adapter; régi audit nem mai bizonyíték.

**Helyi érintettség (ef579d1):** `package-lock.json`, `package.json`.

**Bizonyíték:** 15 056 karakter teljes diff  2 fájl; 0 hozzászólás  1 review  0 review-comment. Merge `83a7c3b59460e8ff73303589d7e0f31b41bb03a6`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #20 — feat(llm): add Cursor provider via cursor-api-proxy

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/20) · [archivált snapshot](../../output/upstream-review/pr-20.json)

**Opcionális, külön igényhez · P2 · Új funkció.** Cursor SDK feltétlen import és automatikus proxy; megbízható timeout/offline teszt hiányzik.

**Integrációs feltétel:** Külön opt-in adapter explicit proxy lifecycle/abort/SDK ellenőrzéssel; compatible út előbb.

**Ellenőrzés / korlát:** Import ne indítson proxyt; timeout/sessionhiba/cleanup; egész ág nem.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/cursor.mjs` (a baseline-ban nincs), `lib/llm/index.mjs`, `package.json`, `README.md`.

**Bizonyíték:** 12 719 karakter teljes diff  7 fájl; 2 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #21 — Add support for custom OpenAI APIs

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/21) · [archivált snapshot](../../output/upstream-review/pr-21.json)

**Részben adaptálandó · P2 · Új funkció.** Custom OpenAI endpoint hasznos, de lezárt PR lockfile törlést is hoz.

**Integrációs feltétel:** Csak endpoint ötlet #55 szerint, lockfile megőrzésével.

**Ellenőrzés / korlát:** URL/keyless compatible/remote OpenAI; egész PR elutasítva.

**Helyi érintettség (ef579d1):** `crucix.config.mjs`, `docker-compose.yml`, `lib/llm/index.mjs`, `lib/llm/openai.mjs`, `package-lock.json`, `.gitignore`.

**Bizonyíték:** 32 535 karakter teljes diff  6 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Külön keyless openai-compatible provider, független LLM_BASE_URL valid origin/v1/fullchat endpointtel. Ollama és cloud provider endpointjai megmaradtak, lockfile nem törölt. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #22 — Add introductory note to CONTRIBUTING.md

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/22) · [archivált snapshot](../../output/upstream-review/pr-22.json)

**Nincs termékváltozás · P3 · Hiányos/érvénytelen.** Intro cím mellett a végső diff csak üres sort ad.

**Integrációs feltétel:** Nincs integrálandó tartalom.

**Ellenőrzés / korlát:** Nincs teszt.

**Helyi érintettség (ef579d1):** `CONTRIBUTING.md`.

**Bizonyíték:** 382 karakter teljes diff  1 fájl; 3 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `no_actionable_code_change` — Nem reprodukálható kódhiba vagy nincs érdemi patch/követelmény; nincs indokolt termékmódosítás. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #24 — feat(llm): add support for custom OpenAI-compatible API base URL

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/24) · [archivált snapshot](../../output/upstream-review/pr-24.json)

**Részben adaptálandó · P2 · Új funkció.** Custom endpoint LLM_BASE_URL az OLLAMA_BASE_URL helyére kerül, OpenAI továbbra is keyt követel.

**Integrációs feltétel:** #55 külön compatible provider, régi Ollama env megőrzésével.

**Ellenőrzés / korlát:** Ollama env/custom URL/keyless mock; PR nem bizonyít keyless utat.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/openai.mjs`.

**Bizonyíték:** 2 498 karakter teljes diff  4 fájl; 2 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Külön keyless openai-compatible provider, független LLM_BASE_URL valid origin/v1/fullchat endpointtel. Ollama és cloud provider endpointjai megmaradtak, lockfile nem törölt. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #26 — Fix Al Jazeera RSS feed URL

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/26) · [archivált snapshot](../../output/upstream-review/pr-26.json)

**Már jelen van · P3 · Hiba.** Al Jazeera RSS endpoint javítás megvan.

**Integrációs feltétel:** BBC/geo javítás külön.

**Ellenőrzés / korlát:** RSS fixture smoke.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték:** 725 karakter teljes diff  1 fájl; 1 hozzászólás  1 review  0 review-comment. Merge `d63c69bb057444acf071c610dde3d6e1bda57e50`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #27 — feat(ui): add custom scrollbaar to dashboard

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/27) · [archivált snapshot](../../output/upstream-review/pr-27.json)

**Elutasítva · P0 · Biztonság.** Scrollbar cím mögött config obfuszkált távoli kódfuttató payload, whole-file/lock zaj és .env ignore eltávolítás. #142 konkrét malware-t jelez, szerző kompromittálódást ismer el.

**Integrációs feltétel:** Ebből az ágból semmilyen kód/dependency/patch nem futtatható/importálható; scrollbar tiszta baseline CSS-ként újraírható.

**Ellenőrzés / korlát:** Csak statikus szövegvizsgálat. Támadó/DPRK attribúció nem önállóan igazolt; payload elég az elutasításhoz.

**Helyi érintettség (ef579d1):** `crucix.config.mjs`, `dashboard/public/jarvis.html`, `package-lock.json`, `.gitignore`.

**Bizonyíték:** 252 564 karakter teljes diff  4 fájl; 4 hozzászólás  1 review  3 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected_unsafe` — Az obfuszkált remote-code payload statikusan igazolt; az egész ág kizárva és soha nem futtatva. Támadó-/kampányattribúció nincs igazolva. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #28 — Fix telegram

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/28) · [archivált snapshot](../../output/upstream-review/pr-28.json)

**Duplikátum · P2 · Új funkció.** Telegram korábbi változat DM-jogosultsági regresszióval; végső #29 javítja.

**Integrációs feltétel:** Beolvadt #29 authorized-chat viselkedését megőrizni.

**Ellenőrzés / korlát:** Idegen chat tiltva; chunk limit.

**Helyi érintettség (ef579d1):** `lib/alerts/telegram.mjs`.

**Bizonyíték:** 10 863 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `covered_by_existing_or_selected_fix` — Nem kapott külön merge-et; a jelentésben azonosított végleges vagy kiválasztott megoldás fedi. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #29 — Fix telegram

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/29) · [archivált snapshot](../../output/upstream-review/pr-29.json)

**Már jelen van · P3 · Új funkció.** Scoped Telegram command+4096 chunk megvan; review kifogás végső diffben javult.

**Integrációs feltétel:** Azonos authorized chatre korlátozott választ megtartani.

**Ellenőrzés / korlát:** Chat auth/chunk/command regresszió.

**Helyi érintettség (ef579d1):** `lib/alerts/telegram.mjs`.

**Bizonyíték:** 10 890 karakter teljes diff  1 fájl; 2 hozzászólás  2 review  0 review-comment. Merge `2c9174bdae50b00f69487647629a580f8cf65d07`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #31 — feat: support for openrouter added

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/31) · [archivált snapshot](../../output/upstream-review/pr-31.json)

**Duplikátum · P3 · Új funkció.** Lezárt OpenRouter végső diff üres, #16 lefedi.

**Integrációs feltétel:** Nem importálni.

**Ellenőrzés / korlát:** 0bájt diff, nincs kód.

**Helyi érintettség:** nincs konkrét integrálandó termékkód ebben a bejelentésben.

**Bizonyíték:** 0 karakter teljes diff  0 fájl; 2 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `covered_by_existing_or_selected_fix` — Nem kapott külön merge-et; a jelentésben azonosított végleges vagy kiválasztott megoldás fedi. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #32 — fix: prevent infinite loading screen by adding sweep timeouts

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/32) · [archivált snapshot](../../output/upstream-review/pr-32.json)

**Már jelen van · P2 · Hiba.** 30s source Promise.race guard+cleanup/loading poll megvan; underlying hálózatot nem abortálja.

**Integrációs feltétel:** #84/#121 body-deadline+abort mellett megtartani.

**Ellenőrzés / korlát:** Lassú forrás nem blokkol sweepet; háttérkérés is véges.

**Helyi érintettség (ef579d1):** `apis/briefing.mjs`, `apis/sources/bls.mjs`, `dashboard/public/loading.html`, `server.mjs`.

**Bizonyíték:** 5 744 karakter teljes diff  4 fájl; 2 hozzászólás  2 review  0 review-comment. Merge `bed928b6ed0640ea0fe14dcd990acf3b6d97fd6c`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #34 — Add zoom-aware symbology, fix globe popovers, expand geo coverage

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/34) · [archivált snapshot](../../output/upstream-review/pr-34.json)

**Már jelen van · P3 · Új funkció.** Zoom/hotspot/null guard/Space estimated megvan.

**Integrációs feltétel:** Helyi WHO/HDX geo megmarad.

**Ellenőrzés / korlát:** Null geo=no marker; estimated label megmarad.

**Helyi érintettség (ef579d1):** `apis/sources/epa.mjs`, `apis/sources/gdelt.mjs`, `apis/sources/noaa.mjs`, `apis/sources/opensky.mjs`, `dashboard/inject.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték:** 30 629 karakter teljes diff  6 fájl; 4 hozzászólás  0 review  0 review-comment. Merge `a8682c50d05b8e0ca3af02fa30dd31c904a9caa9`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #35 — Add prebuilt Docker image publishing to GHCR

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/35) · [archivált snapshot](../../output/upstream-review/pr-35.json)

**Már jelen van · P2 · Új funkció.** GHCR multiarch workflow/.dockerignore megvan; nem bizonyít friss fork image publikálást.

**Integrációs feltétel:** Parent release után saját GHCR run/tag/jog igazolása; #123 pin-only.

**Ellenőrzés / korlát:** Tényleges Actions run/image smoke szükséges; itt nincs publikálás.

**Helyi érintettség (ef579d1):** `.github/workflows/docker-publish.yml`, `.dockerignore`, `.gitignore`.

**Bizonyíték:** 2 768 karakter teljes diff  3 fájl; 2 hozzászólás  1 review  0 review-comment. Merge `203f359028a78cb6bb55cc1ff0d2199fa1e2b0a1`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #36 — feat: upgrade MiniMax default model to M2.7

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/36) · [archivált snapshot](../../output/upstream-review/pr-36.json)

**Opcionális, külön igényhez · P2 · Új funkció.** MiniMaxM2.7 default, versengő #120/#126 más név; stringteszt nem modellbizonyíték.

**Integrációs feltétel:** Explicit LLM_MODEL megmarad, default csak hivatalos catalog/kompatibilitás után.

**Ellenőrzés / korlát:** Távoli elérhetőség/költség nincs élőben igazolva.

**Helyi érintettség (ef579d1):** `.env.example`, `lib/llm/minimax.mjs`, `README.md`.

**Bizonyíték:** 5 877 karakter teljes diff  5 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #37 — Feature: optimize map rendering

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/37) · [archivált snapshot](../../output/upstream-review/pr-37.json)

**Részben adaptálandó · P2 · Teljesítmény.** Marker batching/visibility pause/lowperf hasznos, #44 részben lefedi; nagy UI diff saját paneleket felülírna.

**Integrációs feltétel:** Csak hiányzó pause/batching kicsi patch, saját settings megőrzésével és méréssel.

**Ellenőrzés / korlát:** Hidden tab/mobil/map switch/tooltip; szerző mérése nem saját.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték:** 25 913 karakter teljes diff  1 fájl; 3 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `partially_adapted` — Meglévő FULL/LITE és háttér-inaktivitás optimalizálás megmaradt; rétegkapcsolók és reduced motion hozzáadva. A teljes marker-batching refaktor nem importált, nincs összehasonlító GPU benchmark. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #38 — Add Ollama provider for self-hosted LLM inference

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/38) · [archivált snapshot](../../output/upstream-review/pr-38.json)

**Már jelen van · P2 · Új funkció.** Ollama compatible adapter megvan; 120s defaultot valódi caller90s/30s felülírja.

**Integrációs feltétel:** #136 call budgettel kiegészíteni; régi URL megmarad.

**Ellenőrzés / korlát:** Timeout forwarding/URL mock; #87 nincs teljesen megoldva.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/ollama.mjs`.

**Bizonyíték:** 15 907 karakter teljes diff  6 fájl; 2 hozzászólás  2 review  0 review-comment. Merge `a081cda16a260135797b2cd8e5f61d72e4608ad8`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #39 — Security hardening - prevent command injection, limit SSE connections, harden container

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/39) · [archivált snapshot](../../output/upstream-review/pr-39.json)

**Részben adaptálandó · P2 · Biztonság.** Tényleges diff strict port+nonroot Docker; leírt SSE limit nincs benne. Shell PORT injection nem igazolt, baseline parseInt.

**Integrációs feltétel:** 1..65535 port, dinamikus health URL, nonroot runs/cache jogosultság; safe opener argumentumok.

**Ellenőrzés / korlát:** Invalid/5jegyű port/banner, bindmount írhatóság; hiányzó SSE védelem nem állítható.

**Helyi érintettség (ef579d1):** `Dockerfile`, `crucix.config.mjs`.

**Bizonyíték:** 1 575 karakter teljes diff  2 fájl; 2 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Szigorú port, localhost/optional auth, biztonságos opener, SSE-korlát és non-root konténer. A hiányzó auth önmagában nem volt igazolt titokszivárgás; a publikálás operátori döntés. Kiadás: v2.1.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #42 — Add signal guide glossary to dashboard

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/42) · [archivált snapshot](../../output/upstream-review/pr-42.json)

**Már jelen van · P3 · Dokumentáció.** Glossary megvan.

**Integrációs feltétel:** HU fogalommagyarázatok megőrzése.

**Ellenőrzés / korlát:** Dokumentációs ellenőrzés.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték:** 15 826 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `c29ec93350ff3e93a324587e55dd55bd4ed6eb0b`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #43 — Added the Strait of Gibraltar into CHOKEPOINTS

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/43) · [archivált snapshot](../../output/upstream-review/pr-43.json)

**Már jelen van · P3 · Új funkció.** Gibraltar chokepoint megvan, #40 lefedett.

**Integrációs feltétel:** Statikus marker nem forgalommérés.

**Ellenőrzés / korlát:** Koordináta/címke smoke.

**Helyi érintettség (ef579d1):** `apis/sources/ships.mjs`.

**Bizonyíték:** 872 karakter teljes diff  1 fájl; 1 hozzászólás  1 review  0 review-comment. Merge `8d99cd22a0f7b330ba250c60a98a01b6c6e7049f`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #44 — Improve mobile globe loading and low perf behavior

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/44) · [archivált snapshot](../../output/upstream-review/pr-44.json)

**Már jelen van · P3 · Teljesítmény.** Mobil lazy build/inactive animációpause megvan.

**Integrációs feltétel:** #37 overlap után csak új részek.

**Ellenőrzés / korlát:** Mobil/map-space smoke.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték:** 15 888 karakter teljes diff  1 fájl; 0 hozzászólás  1 review  0 review-comment. Merge `26a64712699df83cdda5a57537500116dab64ab9`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #45 — docs: add helm/kubernetes install instructions

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/45) · [archivált snapshot](../../output/upstream-review/pr-45.json)

**Opcionális, külön igényhez · P3 · Dokumentáció.** Külső Helm chart README link; PR nem tartalmaz chartot.

**Integrációs feltétel:** K8s igényre külső chart forrásread-only review után.

**Ellenőrzés / korlát:** Chart lint/render/volumes/image security külön; itt nincs deployment.

**Helyi érintettség (ef579d1):** `README.md`.

**Bizonyíték:** 1 367 karakter teljes diff  1 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #46 — feat(llm): add Mistral provider

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/46) · [archivált snapshot](../../output/upstream-review/pr-46.json)

**Elutasítva · P2 · Új funkció.** Mistral #14 duplikáció, SDK és minden generate-re JSON object kényszer; ideas array elvárást tör.

**Integrációs feltétel:** Létező raw-fetch; schema csak call-site opt-in.

**Ellenőrzés / korlát:** Ideas array/alerts object regresszió.

**Helyi érintettség (ef579d1):** `.env.example`, `lib/llm/index.mjs`, `lib/llm/mistral.mjs`, `package.json`, `README.md`.

**Bizonyíték:** 7 936 karakter teljes diff  5 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #47 — Add Groq LLM

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/47) · [archivált snapshot](../../output/upstream-review/pr-47.json)

**Részben adaptálandó · P2 · Új funkció.** Lezárt Groq PR véletlenül crypto/ccxt/Cloudflare/RSS/UI/server változásokat csomagol, szerző elismerte.

**Integrációs feltétel:** Kis Groq raw adapter vagy #55 generic; egész diff nem.

**Ellenőrzés / korlát:** Key/model/timeout/error mock; unrelated ccxt nem követelmény.

**Helyi érintettség (ef579d1):** `.env.example`, `apis/briefing.mjs`, `apis/sources/cloudflare.mjs` (a baseline-ban nincs), `apis/sources/crypto.mjs` (a baseline-ban nincs), `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `lib/llm/groq.mjs` (a baseline-ban nincs), `lib/llm/ideas.mjs`.

**Bizonyíték:** 247 441 karakter teljes diff  11 fájl; 2 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `partially_adapted` — Groq az OpenAI-compatible adapterrel és hivatalos endpointtal konfigurálható; dedicated alias és a PR unrelated crypto/server/UI részei nem kerültek be. Éles Groq hívás nincs igazolva. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #49 — Feat/ethos aegis integration

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/49) · [archivált snapshot](../../output/upstream-review/pr-49.json)

**Elutasítva · P2 · Új funkció.** Aegis hiányzó ./ethos-aegis/sdk/node/src/index.js import, hibás score API, local-dev-key; nincs működő integráció.

**Integrációs feltétel:** Nem importálni, nincs indok új SDK-ra külön igény nélkül.

**Ellenőrzés / korlát:** Statikus import/API hiba, nem futtatott.

**Helyi érintettség (ef579d1):** `sdk/aegis-adapter.mjs` (a baseline-ban nincs), `feat/aegis-sdk-integration` (a baseline-ban nincs).

**Bizonyíték:** 5 053 karakter teljes diff  2 fájl; 3 hozzászólás  3 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #50 — Added Chokepoints for the Northwest Passage

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/50) · [archivált snapshot](../../output/upstream-review/pr-50.json)

**Opcionális, külön igényhez · P3 · Új funkció.** Bering66,-169 és Lancaster74.2,-84 két független statikus chokepoint.

**Integrációs feltétel:** Additív Arctic bővítés; Bering gateway/Northwest Passage fogalom ne mosódjon össze.

**Ellenőrzés / korlát:** Koordináta/címke smoke; nincs élő forgalom.

**Helyi érintettség (ef579d1):** `apis/sources/ships.mjs`.

**Bizonyíték:** 1 208 karakter teljes diff  1 fájl; 3 hozzászólás  1 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Bering Strait és Lancaster Sound két statikus referenciapontként hozzáadva; a helyek hozzávetőlegesek, nem élő hajóadat. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #53 — Fix dashboard regressions and add OpenSky fallback

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/53) · [archivált snapshot](../../output/upstream-review/pr-53.json)

**Már jelen van · P2 · Hiba.** Map/GSAP/OpenSky cache fallback megvan, életkort nem korlátozza.

**Integrációs feltétel:** #147 TTL+eredeti idő megjelenítés.

**Ellenőrzés / korlát:** Fresh/stale cache és map-space smoke.

**Helyi érintettség (ef579d1):** `apis/sources/opensky.mjs`, `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `README.md`.

**Bizonyíték:** 17 890 karakter teljes diff  4 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `c3c06ff586c67991b372e70cf1190f1eabe4d796`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #55 — feat: add openai-compatible provider for local LLMs (LM Studio, Ollama)

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/55) · [archivált snapshot](../../output/upstream-review/pr-55.json)

**Részben adaptálandó · P1 · Új funkció.** Generic compatible értékes llama.cpp/LMStudio/vLLM-hez, de full chat URL és OpenAI módosítás, /Users/... gépspecifikus teszt/ignore zaj.

**Integrációs feltétel:** Explicit compatible provider, http(s) teljes/alap URL normalizálás, keyless csak ehhez, Ollama env megmarad, max_tokens kompatibilitás.

**Ellenőrzés / korlát:** Mock keylesslocal/remotebearer/base-fullURL/timeout/null/ideas; author-machine teszt nem átvehető.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/openai.mjs`, `package.json`, `.gitignore`, `README.md`.

**Bizonyíték:** 258 962 karakter teljes diff  54 fájl; 2 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Külön keyless openai-compatible provider, független LLM_BASE_URL valid origin/v1/fullchat endpointtel. Ollama és cloud provider endpointjai megmaradtak, lockfile nem törölt. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #57 — docs: add comprehensive architecture report

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/57) · [archivált snapshot](../../output/upstream-review/pr-57.json)

**Részben adaptálandó · P3 · Dokumentáció.** Architektúra ábra hasznos, 27forrás és régi állapot; helyben30/IODA/HU/WHO/settings.

**Integrációs feltétel:** Végső helyi listából frissíteni, régi számokat nem másolni.

**Ellenőrzés / korlát:** Import registry/count/link egyezés.

**Helyi érintettség:** nincs konkrét integrálandó termékkód ebben a bejelentésben.

**Bizonyíték:** 19 096 karakter teljes diff  1 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — A végső 31 forrásos adatút, delta/model/memory/SSE architektúra diagram a főauditban; régi sourcecount nem másolt. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #58 — feat: add LLM_EVERY_N_SWEEPS to reduce API costs

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/58) · [archivált snapshot](../../output/upstream-review/pr-58.json)

**Részben adaptálandó · P2 · Teljesítmény.** Cadence N>1 kihagyhat első ötletgenerálást és egész alert callt; carry-forward memória sorrendje problémás.

**Integrációs feltétel:** Csak ideas ritkítható; első sweep fut, delta/rules alert minden ciklusban; régi idea timestamp/eredet.

**Ellenőrzés / korlát:** N1/2/3 első/skip ciklus; risk alert megérkezik, carried idea stale látható.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `server.mjs`.

**Bizonyíték:** 3 253 karakter teljes diff  3 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Cadence első sweeppel, majd N-edik sweepek; eredeti cached timestamp, model failure fresh rules, delta-alert every sweep, ötletek után mentett memory. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #59 — Add regional RSS feeds for South America, India, and Australia

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/59) · [archivált snapshot](../../output/upstream-review/pr-59.json)

**Már jelen van · P3 · Új funkció.** Regionális RSS bővítés megvan.

**Integrációs feltétel:** #73 revert helyett #145/#149 geo precision.

**Ellenőrzés / korlát:** Region hírek megmaradnak, fake point eltűnik.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték:** 4 948 karakter teljes diff  2 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `e4537de62a66a55201752bf2cdca331955e7771d`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #60 — Support Ollama

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/60) · [archivált snapshot](../../output/upstream-review/pr-60.json)

**Duplikátum · P3 · Új funkció.** Lezárt natív Ollama /api/chat redundant #38 mellett, más default.

**Integrációs feltétel:** Meglévő compatible adapter marad.

**Ellenőrzés / korlát:** Nincs második adapter; URL mock.

**Helyi érintettség (ef579d1):** `.env.example`, `lib/llm/index.mjs`, `lib/llm/ollama.mjs`.

**Bizonyíték:** 4 587 karakter teljes diff  3 fájl; 3 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `covered_by_existing_or_selected_fix` — Nem kapott külön merge-et; a jelentésben azonosított végleges vagy kiválasztott megoldás fedi. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #61 — feat: add xAI Grok as LLM provider

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/61) · [archivált snapshot](../../output/upstream-review/pr-61.json)

**Duplikátum · P3 · Új funkció.** Lezárt Grok változatot #62 fedi; xai alias kicsi opcionális.

**Integrációs feltétel:** Meglévő adapter marad; alias additív.

**Ellenőrzés / korlát:** Provider név validálás.

**Helyi érintettség (ef579d1):** `.env.example`, `lib/llm/index.mjs`, `lib/llm/xai.mjs` (a baseline-ban nincs), `README.md`.

**Bizonyíték:** 12 835 karakter teljes diff  5 fájl; 2 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `covered_by_existing_or_selected_fix` — Nem kapott külön merge-et; a jelentésben azonosított végleges vagy kiválasztott megoldás fedi. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #62 — feat: LLM provider for Grok

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/62) · [archivált snapshot](../../output/upstream-review/pr-62.json)

**Már jelen van · P3 · Új funkció.** Grok budget/null adapter megvan.

**Integrációs feltétel:** Explicit modell és meglévő adapter.

**Ellenőrzés / korlát:** Provider timeout/null mock.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/grok.mjs`, `lib/llm/index.mjs`, `README.md`.

**Bizonyíték:** 12 871 karakter teljes diff  6 fájl; 1 hozzászólás  1 review  0 review-comment. Merge `3f3d050382c75f65856423d4dfc0743300cf05b9`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #63 — feat: UK-centric edition — replace 8 US sources with UK/European equi…

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/63) · [archivált snapshot](../../output/upstream-review/pr-63.json)

**Elutasítva · P2 · Új funkció.** UK fork nyolc US source-t cserél, synthesis FRED/BLS kontextust vár; globális/helyi funkcióvesztés.

**Integrációs feltétel:** Csak additív régiós profil külön contracttal; teljes patch nem.

**Ellenőrzés / korlát:** Region/no-source synthesis teszt egy külön projektben.

**Helyi érintettség (ef579d1):** `.env.example`, `apis/briefing.mjs`, `apis/sources/adsb.mjs`, `apis/sources/boe.mjs` (a baseline-ban nincs), `apis/sources/eurdep.mjs` (a baseline-ban nincs), `apis/sources/metoffice.mjs` (a baseline-ban nincs), `apis/sources/ofac.mjs`, `apis/sources/ons.mjs` (a baseline-ban nincs).

**Bizonyíték:** 95 220 karakter teljes diff  17 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #65 — fix: resolve horizontal overflow on mobile control panel

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/65) · [archivált snapshot](../../output/upstream-review/pr-65.json)

**Már jelen van · P3 · Hiba.** Mobil top-row wrap megvan, #64 lezárt.

**Integrációs feltétel:** HU hosszú címke megmarad.

**Ellenőrzés / korlát:** Keskeny viewport smoke.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték:** 583 karakter teljes diff  1 fájl; 3 hozzászólás  1 review  0 review-comment. Merge `2d040cbe855aa14629d5933bb3fc8ea8756f28f5`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #66 — OpenAI / Open WebUI

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/66) · [archivált snapshot](../../output/upstream-review/pr-66.json)

**Nincs termékváltozás · P3 · Új funkció.** Lezárt OpenWebUI végső diff üres.

**Integrációs feltétel:** Compatible #55 külön lefedheti igényre.

**Ellenőrzés / korlát:** 0bájt nem integrálható.

**Helyi érintettség:** nincs konkrét integrálandó termékkód ebben a bejelentésben.

**Bizonyíték:** 0 karakter teljes diff  0 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `no_actionable_code_change` — Nem reprodukálható kódhiba vagy nincs érdemi patch/követelmény; nincs indokolt termékmódosítás. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #68 — Fix remaining OSINT signal text truncation

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/68) · [archivált snapshot](../../output/upstream-review/pr-68.json)

**Már jelen van · P3 · Hiba.** Headline truncate fix/stabil post identity/prompt caps/Markdown megvan.

**Integrációs feltétel:** #146 csak urgent matching; teljes headline marad.

**Ellenőrzés / korlát:** Longheadline/dedup/Telegramdelta.

**Helyi érintettség (ef579d1):** `apis/sources/telegram.mjs`, `lib/alerts/telegram.mjs`, `lib/delta/engine.mjs`, `lib/delta/memory.mjs`, `lib/llm/ideas.mjs`.

**Bizonyíték:** 8 935 karakter teljes diff  5 fájl; 4 hozzászólás  4 review  5 review-comment. Merge `53f6d81d5ed790c3106471f42ac4e983e5dc1ce9`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #69 — Add CISA-KEV and Cloudflare Radar source adapters

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/69) · [archivált snapshot](../../output/upstream-review/pr-69.json)

**Már jelen van · P3 · Új funkció.** CISA+Radar megvan, IODA helyi30.forrás.

**Integrációs feltétel:** Valós registryből count, sources megmaradnak.

**Ellenőrzés / korlát:** Optional key és source-health smoke.

**Helyi érintettség (ef579d1):** `.env.example`, `apis/briefing.mjs`, `apis/sources/cisa-kev.mjs`, `apis/sources/cloudflare-radar.mjs`.

**Bizonyíték:** 13 956 karakter teljes diff  4 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `8c1ea379c46484d4be1860d7bcc3daffd5a0ddef`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #71 — Omega

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/71) · [archivált snapshot](../../output/upstream-review/pr-71.json)

**Elutasítva · P2 · Új funkció.** Aegis #49 új envvel, azonos hiányzó SDK/import/API.

**Integrációs feltétel:** Nem importálni, env nem működő funkció.

**Ellenőrzés / korlát:** Statikus útvonal/API hiba.

**Helyi érintettség (ef579d1):** `.env.example`, `sdk/aegis-adapter.mjs` (a baseline-ban nincs), `feat/aegis-sdk-integration` (a baseline-ban nincs).

**Bizonyíték:** 5 836 karakter teljes diff  3 fájl; 0 hozzászólás  1 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #73 — Revert "Add regional RSS feeds for South America, India, and Australia"🇦🇺

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/73) · [archivált snapshot](../../output/upstream-review/pr-73.json)

**Elutasítva · P3 · Új funkció.** Indokolatlan lezárt revert #59 RSS-t töröl.

**Integrációs feltétel:** Sources marad, geo #145/#149.

**Ellenőrzés / korlát:** Region ticker megmarad.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték:** 4 948 karakter teljes diff  2 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #76 — feat: add layer toggles and world capitals to dashboard

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/76) · [archivált snapshot](../../output/upstream-review/pr-76.json)

**Részben adaptálandó · P2 · Új funkció.** Lezárt nem merge-elt layertoggles+guarded storage hasznos,245capitals összecsomagolva.

**Integrációs feltétel:** Additív kapcsolók a saját settingsben, storage version/guard; flights/Space megmarad; capitals külön opcionális.

**Ellenőrzés / korlát:** Toggles/reload/invalid-quota storage/HU/panelállapot.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték:** 51 685 karakter teljes diff  1 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `partially_adapted` — 13 logikai réteg közös flat/globe beállítással, guardolt storage és billentyűzetes settings. A nagy Sensorgrid igény részletező nézete/története külön következő funkció; 245 capital bundle nem importált. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #81 — Add USGS Earthquake Hazards API source

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/81) · [archivált snapshot](../../output/upstream-review/pr-81.json)

**Részben adaptálandó · P2 · Új funkció.** USGS keyless hasznos; significant_day nem mindenM4+, tsunami flag nem issued warning; errors/array/place escaping javítandó.

**Integrációs feltétel:** Valós feed-scope címke, source-health/nullsafe; tsunami potential, nem hatósági alert; localgeo megmarad.

**Ellenőrzés / korlát:** Mock significant/empty/badHTTP/HTMLplace/coord/time; hamis alert nem.

**Helyi érintettség (ef579d1):** `apis/briefing.mjs`, `apis/sources/usgs.mjs` (a baseline-ban nincs), `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `locales/en.json`, `locales/fr.json`, `README.md`.

**Bizonyíték:** 14 374 karakter teljes diff  7 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — USGS significant-day adapter finite/range/date/url normalizálással és hibajelzéssel; földrengésréteg mindkét térképen. Tsunami flag nem issued warning. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #82 — Enforce JSON schema for Gemini responses

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/82) · [archivált snapshot](../../output/upstream-review/pr-82.json)

**Elutasítva · P1 · Hiba.** Minden Gemini call ideas ARRAY schema és BLOCK_NONE minden safety kategóriára; alerts object törik/raw log.

**Integrációs feltétel:** #98 thoughtfilter/flexible parse; schema call-site opt-in, safety nem lazul.

**Ellenőrzés / korlát:** Ideas array+alertsobject/thought/emptylength; érzékeny raw log nincs.

**Helyi érintettség (ef579d1):** `lib/llm/gemini.mjs`.

**Bizonyíték:** 3 029 karakter teljes diff  1 fájl; 0 hozzászólás  1 review  3 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #83 — chore/security(package-lock): bump path-to-regexp 8.3.0 - 8.4.0

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/83) · [archivált snapshot](../../output/upstream-review/pr-83.json)

**Már jelen van · P1 · Biztonság.** path-to-regexp8.3→8.4 releváns DoS, helyi lock később already8.4.

**Integrációs feltétel:** Current teljes audit, nem régi diff.

**Ellenőrzés / korlát:** Lock resolution/current npm audit.

**Helyi érintettség (ef579d1):** `package-lock.json`.

**Bizonyíték:** 760 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #84 — fix: safeFetch timer leak, env quote stripping, source count

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/84) · [archivált snapshot](../../output/upstream-review/pr-84.json)

**Részben adaptálandó · P1 · Hiba.** safeFetch timer kivételnél marad és header után törlődik, body deadline nélkül; env+29count csomagolt.

**Integrációs feltétel:** Finally cleanup/body parsingig deadline; #95 külön, count dynamic30.

**Ellenőrzés / korlát:** Network/abort/slowbody/timer cleanup és underlying body abort.

**Helyi érintettség (ef579d1):** `apis/utils/env.mjs`, `apis/utils/fetch.mjs`, `server.mjs`.

**Bizonyíték:** 2 451 karakter teljes diff  3 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `apis/utils/fetch.mjs:14`.

**Végső eredmény:** `implemented` — Teljes body-deadline, bounded stream, finally cleanup, HTTP 429 és Retry-After seconds/HTTP-date. Hosszú Retry-After esetén nem történik túl korai újrapróbálás. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #85 — feat: add gold and silver to macro + markets context

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/85) · [archivált snapshot](../../output/upstream-review/pr-85.json)

**Már jelen van · P3 · Új funkció.** Metals/commodities tickerek megvannak.

**Integrációs feltétel:** Helyi listát/currency sémát megtartani.

**Ellenőrzés / korlát:** Index/metals display smoke.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `lib/alerts/discord.mjs`, `lib/alerts/telegram.mjs`, `lib/delta/engine.mjs`, `lib/llm/ideas.mjs`, `server.mjs`.

**Bizonyíték:** 11 043 karakter teljes diff  7 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `212fefd3e2750da0bab13dd2aa5c317c50ed14ae`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #88 — Ollama time out

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/88) · [archivált snapshot](../../output/upstream-review/pr-88.json)

**Részben adaptálandó · P1 · Hiba.** OLLAMA_TIMEOUT defaultot caller90s/30s felülírja, #87-et magában nem oldja.

**Integrációs feltétel:** #136 call budget+validált pozitív ms.

**Ellenőrzés / korlát:** Valódi requestben configured timeout, nem hatástalan env.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/ollama.mjs`, `README.md`.

**Bizonyíték:** 3 237 karakter teljes diff  5 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Valós ideas/alerts call-site token- és időkeret, validated range, reasoning-only exhaustion diagnózis és rules fallback. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #89 — Fix live market index symbols

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/89) · [archivált snapshot](../../output/upstream-review/pr-89.json)

**Már jelen van · P3 · Hiba.** ^GSPC/^IXIC/^DJI/^RUT valós index és noUSD flag megvan.

**Integrációs feltétel:** Quote bővítések és #152 attribúció.

**Ellenőrzés / korlát:** Index nem ETF; nincs dollárjel pontszám mögött.

**Helyi érintettség (ef579d1):** `apis/sources/yfinance.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték:** 62 943 karakter teljes diff  2 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `7a5015e430293bfcd8c4f9e6c9424ce713c53b2e`; helyi baseline őse: igen. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #90 — repo-health: add tests, error handling, security, and CI

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/90) · [archivált snapshot](../../output/upstream-review/pr-90.json)

**Elutasítva · P2 · Minőség.** Lezárt, nagy logger/test/CI refaktor; a szerző visszalépett. A curl hibáját echo ággal elfedő CI rossz portot (3000 a 3117 helyett) használ, sok teszt az implementációt ismétli; a NOAA egészséghibája marad.

**Integrációs feltétel:** Valós helyi regressziókra írjunk tesztet, a CI hibás HTTP válasszal bukjon el; az egész refaktor nem szükséges.

**Ellenőrzés / korlát:** Rossz szerverrel a smoke ne mehessen át; érdemi fixture és body-timeout teszt.

**Helyi érintettség (ef579d1):** `.github/workflows/ci.yml` (a baseline-ban nincs), `apis/sources/fred.mjs`, `apis/sources/gdelt.mjs`, `apis/sources/noaa.mjs`, `apis/sources/who.mjs`, `apis/utils/fetch.mjs`, `eslint.config.mjs` (a baseline-ban nincs), `lib/errors.mjs` (a baseline-ban nincs).

**Bizonyíték:** 427 826 karakter teljes diff  65 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #91 — Feature/adsb live feed and mobile fixes

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/91) · [archivált snapshot](../../output/upstream-review/pr-91.json)

**Opcionális, külön igényhez · P2 · Új funkció.** ADSB+HTMLsplit nagy UI átírás; dist99999 global proxy/4000aircraft30s poll/boundedstale/deadline hiányos.

**Integrációs feltétel:** Külön geográfiailag bounded réteg, TTL/coord/deadline/singleflight/capacity; split refaktor külön.

**Ellenőrzés / korlát:** Fresh/stale/429/invalidcoord/HU/settings/WHO/IODA; egész patch nem.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`, `server.mjs`, `dashboard/public/app.css` (a baseline-ban nincs), `dashboard/public/app.js` (a baseline-ban nincs).

**Bizonyíték:** 281 392 karakter teljes diff  4 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #92 — fix: always fetch live API data in server mode

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/92) · [archivált snapshot](../../output/upstream-review/pr-92.json)

**Már jelen van · P1 · Hiba.** InlineHTTP mellett API/SSE boot core és r.ok már helyi ef579d1; meta guard/reconnect remaining.

**Integrációs feltétel:** #127 shape/singleSSE/fallback; nem jarvis rewrite sweepenként.

**Ellenőrzés / korlát:** InlineHTTP frissül, file statikus, invalidJSON nem töröl jó adatot.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték:** 490 karakter teljes diff  1 fájl; 2 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Meglévő HTTP boot megtartva, valid APIshape, egyetlen SSE natív reconnecttel, fallback polling és offline/waiting állapot. file módban statikus működés. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #94 — feat: add Novita AI as LLM provider

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/94) · [archivált snapshot](../../output/upstream-review/pr-94.json)

**Opcionális, külön igényhez · P2 · Új funkció.** Lezárt Novita raw-fetch provider kimi-k2.5 defaulttal; csak saját key/igény esetén új érték.

**Integrációs feltétel:** #55 compatible endpoint előbb; alias csak dokumentált provider különbséghez.

**Ellenőrzés / korlát:** Key/model/error/timeout mock; live modell nincs tesztelve.

**Helyi érintettség (ef579d1):** `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/novita.mjs` (a baseline-ban nincs), `README.md`.

**Bizonyíték:** 12 638 karakter teljes diff  5 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #95 — fix(env): strip surrounding quotes from .env values

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/95) · [archivált snapshot](../../output/upstream-review/pr-95.json)

**Részben adaptálandó · P1 · Hiba.** Baseline env loader megtartja külső idézőjelet; patch egyező páros quote-ot levesz.

**Integrációs feltétel:** Trim után csak egyező külső single/double quote, valós env precedence; nem shell-eval.

**Ellenőrzés / korlát:** Single/double/mismatch/empty/innerquote/comments/existingenv.

**Helyi érintettség (ef579d1):** `apis/utils/env.mjs`.

**Bizonyíték:** 723 karakter teljes diff  1 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Matching env quotes, export/comments, meglévő külső env elsőbbsége; Discord saját ready fix megmaradt. Kiadás: v2.1.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #96 — fix(discord): register slash commands after client is ready

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/96) · [archivált snapshot](../../output/upstream-review/pr-96.json)

**Részben adaptálandó · P1 · Hiba.** Quote fix hasznos; Discord-ready már saját24c2aa0-ból megvan.

**Integrációs feltétel:** Csak #95 rész; ready nem újrajavítandó.

**Ellenőrzés / korlát:** Env regresszió és meglévő Discord listener.

**Helyi érintettség (ef579d1):** `apis/utils/env.mjs`, `lib/alerts/discord.mjs`.

**Bizonyíték:** 2 087 karakter teljes diff  2 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Matching env quotes, export/comments, meglévő külső env elsőbbsége; Discord saját ready fix megmaradt. Kiadás: v2.1.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #97 — feat(config): add PUBLIC_URL for bot status dashboard link

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/97) · [archivált snapshot](../../output/upstream-review/pr-97.json)

**Részben adaptálandó · P2 · Új funkció.** Quote/ready overlap mellett hiányzó PUBLIC_URL LAN/proxy botlinknek hasznos.

**Integrációs feltétel:** Validált http(s), trailing slash konzisztens/default localhost; csak hiányzó részek.

**Ellenőrzés / korlát:** LAN/https/default/invalidURL és formatter link.

**Helyi érintettség (ef579d1):** `apis/utils/env.mjs`, `crucix.config.mjs`, `lib/alerts/discord.mjs`, `server.mjs`.

**Bizonyíték:** 3 372 karakter teljes diff  4 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — PUBLIC_URL valid HTTP(S) botlink, quote fix és meglévő saját Discord ready viselkedés. Kiadás: v2.1.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #98 — fix(llm): Gemini 2.5 compatibility — thinking parts and response parsing

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/98) · [archivált snapshot](../../output/upstream-review/pr-98.json)

**Részben adaptálandó · P1 · Hiba.** Merged96863bff nem helyi ős; Gemini thought filter/thinking budget/ideas tokens hasznos; quote/ready részleges helyi overlap, raw1000char log privacy-kockázat.

**Integrációs feltétel:** Missing Gemini/flexible parser/PUBLIC_URL/env szelektíven, HU prompt marad, model-specific thinkingConfig; rawoutput log nem.

**Ellenőrzés / korlát:** Thought+text/array/wrapped/fenced/alertsobject/emptylength; nincs teljes merge.

**Helyi érintettség (ef579d1):** `apis/utils/env.mjs`, `crucix.config.mjs`, `lib/alerts/discord.mjs`, `lib/llm/gemini.mjs`, `lib/llm/ideas.mjs`, `server.mjs`.

**Bizonyíték:** 6 388 karakter teljes diff  6 fájl; 0 hozzászólás  0 review  0 review-comment. Merge `96863bff53c2e552d33082f33f081b114cdab3f9`; helyi baseline őse: nem. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Gemini thought filter/concat és valódi request budget; env és ready megfelelő változatai. Nyers modellválasz nem logolt. Kiadás: v2.1.0, v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #99 — feat(discord): actionable trade idea alerts for prediction markets

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/99) · [archivált snapshot](../../output/upstream-review/pr-99.json)

**Részben adaptálandó · P2 · Új funkció.** Merged3db7068 nem helyi ős; #98 plusz actionable Discord idea alert,6h dedup pruning nélkül és idea._alertKey mutáció.

**Integrációs feltétel:** Explicit opt-in; type/horizon normalization, bounded map/copy-not-mutate/rate/success-afterdedup; saját Discord refaktor marad.

**Ellenőrzés / korlát:** Fail újrapróbálható,6h expiry/memorybound/embedlimits; nem validált pénzügyi predikció.

**Helyi érintettség (ef579d1):** `apis/utils/env.mjs`, `crucix.config.mjs`, `lib/alerts/discord.mjs`, `lib/llm/gemini.mjs`, `lib/llm/ideas.mjs`, `server.mjs`.

**Bizonyíték:** 13 196 karakter teljes diff  6 fájl; 1 hozzászólás  1 review  0 review-comment. Merge `3db7068817e0c815df353fa0f19657c85142789d`; helyi baseline őse: nem. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Discord actionable HIGH rövid horizon idea alert, max kettő, 6h dedup prune, successful-send commit, mute és input immutability. A #98 részei külön biztonságosan adaptálva. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #102 — feat(i18n): add Chinese locale + real-time LLM translation

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/102) · [archivált snapshot](../../output/upstream-review/pr-102.json)

**Elutasítva · P2 · Új funkció.** ZH locale runtime MiniMax fordítással és global api.minimax.io→api.minimaxi.com cserével; régió/privacy/költség/HU regresszió.

**Integrációs feltétel:** ZH igényre #138 statikus; provider régió explicit különconfig, nem háttérfordítás.

**Ellenőrzés / korlát:** HU/EN megmarad, nem implicit fizetős call; teljes patch nem.

**Helyi érintettség (ef579d1):** `lib/i18n.mjs`, `lib/llm/index.mjs`, `lib/llm/minimax.mjs`, `lib/translation/index.mjs` (a baseline-ban nincs), `lib/translation/llm.mjs` (a baseline-ban nincs), `locales/zh.json` (a baseline-ban nincs), `server.mjs`.

**Bizonyíték:** 29 377 karakter teljes diff  7 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #103 — Add first-class X social lead intake

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/103) · [archivált snapshot](../../output/upstream-review/pr-103.json)

**Elutasítva · P1 · Új funkció.** 362fájl/2.3MB egész fork a kis Xsociallead leírás mögött,7600+server/settings/sourceops/restart/192cycle terv. Admin írás többség local-only+nonce, context telemetry reset/delete guard nélkül.

**Integrációs feltétel:** Teljes fork nem; feature-k külön design/patch. Loopback proxy locality/nonce/concurrency/storequota/publicLLM cost különreview.

**Ellenőrzés / korlát:** Full diff archive/inventory+célzott production boundary review; nem állít teljes2.3MBruntime/security validálást vagy release-érettséget.

**Helyi érintettség (ef579d1):** `.env.example`, `apis/sources/opensky.mjs`, `apis/sources/ships.mjs`, `apis/sources/yfinance.mjs`, `apis/utils/env.mjs`, `crucix.config.mjs`, `dashboard/inject.mjs`, `dashboard/public/admin-settings.html` (a baseline-ban nincs).

**Bizonyíték:** 2 308 602 karakter teljes diff  362 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #106 — feat(i18n): full Chinese (zh) localization with DeepSeek LLM translation

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/106) · [archivált snapshot](../../output/upstream-review/pr-106.json)

**Részben adaptálandó · P2 · Új funkció.** Lezárt Chinese/DeepSeek/translation/Dockerhostnetwork bundle HU/Windows/Compose regressziót hozna.

**Integrációs feltétel:** Csak igényelt DeepSeek generic/raw adapter és statikus ZH külön; hostnetwork nemdefault.

**Ellenőrzés / korlát:** Provider schema/timeout+localeparity; runtimefordítás nemimplicit.

**Helyi érintettség (ef579d1):** `.env.example`, `Dockerfile`, `crucix.config.mjs`, `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `dashboard/public/loading.html`, `docker-compose.yml`, `lib/alerts/telegram.mjs`.

**Bizonyíték:** 101 661 karakter teljes diff  20 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `partially_adapted` — Compatible endpoint képesség megvalósítva; Chinese/DeepSeek/translation/hostnetwork csomag nem importált, HU és Windows Compose megmaradt. Dedicated DeepSeek/model live support nem állított. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #109 — Carry local changes to fork

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/109) · [archivált snapshot](../../output/upstream-review/pr-109.json)

**Már jelen van · P1 · Új funkció.** Upstream closed/unmerged, de helyi ef579d1 saját430a834 őse tartalmazza HU/TRADE_IDEAS_LANG/WHO/ReliefWeb/HDX/live injectiont.

**Integrációs feltétel:** Saját funkciók kifejezett megőrzése; merged=false nem helyi hiány.

**Ellenőrzés / korlát:** HU prompt/WHO rang/geo/supplementalhealth/no-cache/live regresszió.

**Helyi érintettség (ef579d1):** `.env.example`, `apis/sources/reliefweb.mjs`, `apis/sources/who.mjs`, `crucix.config.mjs`, `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `lib/i18n.mjs`, `lib/llm/ideas.mjs`.

**Bizonyíték:** 51 285 karakter teljes diff  11 fájl; 0 hozzászólás  1 review  3 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #120 — feat(llm): upgrade MiniMax default model to M3

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/120) · [archivált snapshot](../../output/upstream-review/pr-120.json)

**Opcionális, külön igényhez · P2 · Új funkció.** MiniMaxM3latest default, verseng36/126; string nem catalogbizonyíték.

**Integrációs feltétel:** Default csak hivatalos aktuális support, explicit modell marad.

**Ellenőrzés / korlát:** Nincs fizetős livepróba; catalogigazolás kell.

**Helyi érintettség (ef579d1):** `.env.example`, `lib/llm/minimax.mjs`, `README.md`.

**Bizonyíték:** 5 942 karakter teljes diff  5 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #121 — fix(safeFetch): exponential backoff, HTTP 429 awareness, Retry-After support

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/121) · [archivált snapshot](../../output/upstream-review/pr-121.json)

**Részben adaptálandó · P1 · Hiba.** Rövid exp backoff+jitter/RetryAfter jobb, HTTPdate unsupported, timer bodyelőtt clear és429body nemcancel; OpenSky2retry budgetet túlléphet.

**Integrációs feltétel:** #84 közös deadline/bodycancel, bounded numeric/date RetryAfter; idempotent transient retry összbudget30s-on belül.

**Ellenőrzés / korlát:** 429number/date/bad/500/abort/slowbody/budget/no4xxretry; nem kvótakerülés.

**Helyi érintettség (ef579d1):** `apis/sources/opensky.mjs`, `apis/utils/fetch.mjs`.

**Bizonyíték:** 14 056 karakter teljes diff  3 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Teljes body-deadline, bounded stream, finally cleanup, HTTP 429 és Retry-After seconds/HTTP-date. Hosszú Retry-After esetén nem történik túl korai újrapróbálás. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #122 — feat: bedrock support + latest data sources

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/122) · [archivált snapshot](../../output/upstream-review/pr-122.json)

**Opcionális, külön igényhez · P2 · Új funkció.** Bedrock+chat+baseinterface bundle, temporaryAWS/sessiontoken/credentialchain hiányos, userhistory role/size/cost validation nincs; GDELTcompactdate hibás.

**Integrációs feltétel:** Adapter/chat külön, SigV4/region/model/session creds; chat auth/rate/size/role/cost kontrollal.

**Ellenőrzés / korlát:** Hivatalos SigV4fixture+mockerrors/schema; AWS live nincs, wholePR nem.

**Helyi érintettség (ef579d1):** `crucix.config.mjs`, `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `lib/llm/bedrock.mjs` (a baseline-ban nincs), `lib/llm/index.mjs`, `lib/llm/provider.mjs`, `server.mjs`.

**Bizonyíték:** 25 351 karakter teljes diff  7 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #123 — ci: pin GitHub Actions to full commit SHAs

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/123) · [archivált snapshot](../../output/upstream-review/pr-123.json)

**Részben adaptálandó · P1 · Biztonság.** Action SHA pin hasznos, Irongate rebrand unrelated csomagolva.

**Integrációs feltétel:** Csak workflowpin és officialaction provenance; Crucix/fork név/publishpath marad.

**Ellenőrzés / korlát:** MindenSHA repo/tag ellenőrzés,syntax; release actualrun parent.

**Helyi érintettség (ef579d1):** `.github/workflows/docker-publish.yml`, `dashboard/public/jarvis.html`, `dashboard/public/loading.html`.

**Bizonyíték:** 5 273 karakter teljes diff  3 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Elsődleges forrás alapján action SHA pin; unrelated rebrand kizárva. Node22/24 Windows/Linux CI és non-root Docker smoke ténylegesen futott. Kiadás: v2.1.0, v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #124 — fix: wrong delta property names in LLM prompt, stale source counts

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/124) · [archivált snapshot](../../output/upstream-review/pr-124.json)

**Részben adaptálandó · P1 · Hiba.** LLM delta previous/current/changePct-t olvas valós from/to/pctChange helyett, undefined prompt. UA/29count unrelated.

**Integrációs feltétel:** Schema render/zero-null fix, valós30count; HU prompt marad.

**Ellenőrzés / korlát:** from/to/pctChange0 és pricedelta, nincs undefined.

**Helyi érintettség (ef579d1):** `apis/utils/fetch.mjs`, `dashboard/public/loading.html`, `lib/llm/ideas.mjs`, `server.mjs`.

**Bizonyíték:** 2 646 karakter teljes diff  4 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `lib/llm/ideas.mjs:131`.

**Végső eredmény:** `implemented` — LLM valódi from/to/pctChange delta-mezőket és dinamikus forráslétszámot kap, bounded prompttal. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #126 — feat(llm): add MiniMax-M3 and MiniMax-M2.7 text model coverage

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/126) · [archivált snapshot](../../output/upstream-review/pr-126.json)

**Opcionális, külön igényhez · P2 · Új funkció.** MiniMaxM3default/M2.7IDs, literal-list teszt nem supportbizonyíték; allowlist jövőbeli modellt kizárhat.

**Integrációs feltétel:** 36/120egy ellenőrzött döntés, user custommodel nem indokolatlanul tiltott.

**Ellenőrzés / korlát:** Official catalog/API compatibility, nem auto latest.

**Helyi érintettség (ef579d1):** `.env.example`, `lib/llm/minimax.mjs`, `README.md`.

**Bizonyíték:** 7 854 karakter teljes diff  5 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #127 — Fix #119: always fetch live /api/data in server mode + SSE reconnect/…

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/127) · [archivált snapshot](../../output/upstream-review/pr-127.json)

**Részben adaptálandó · P1 · Hiba.** Boot+SSE fallbackpoll60s/safety10s hasznos, core márlocal; connection/timer lifecycle guard kell.

**Integrációs feltétel:** EgyEventSource+egytimer, shape+r.ok/reconnect/visibilitycleanup/no-store; jó inline hibára marad.

**Ellenőrzés / korlát:** InlineHTTP/file/503/malformed/metaless/disconnect/reconnect; nincs duplikált listener/poll.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték:** 2 484 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Meglévő HTTP boot megtartva, valid APIshape, egyetlen SSE natív reconnecttel, fallback polling és offline/waiting állapot. file módban statikus működés. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #128 — fix(server): crash on startup when PORT is 10000 or higher

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/128) · [archivált snapshot](../../output/upstream-review/pr-128.json)

**Részben adaptálandó · P1 · Hiba.** 5jegyű port banner repeat(4-len) RangeError valós baseline; count szöveg fix külön nem elég.

**Integrációs feltétel:** Dynamicbanner és #39 strictport; count registryből.

**Ellenőrzés / korlát:** 1/3117/10000/65535/invalidport ténylegesstartup.

**Helyi érintettség (ef579d1):** `server.mjs`.

**Bizonyíték:** 2 776 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `server.mjs:421`.

**Végső eredmény:** `implemented` — Szigorú port, localhost/optional auth, biztonságos opener, SSE-korlát és non-root konténer. A hiányzó auth önmagában nem volt igazolt titokszivárgás; a publikálás operátori döntés. Kiadás: v2.1.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #129 — fix(noaa): severe weather always reported zero — /alerts/active rejects `limit`

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/129) · [archivált snapshot](../../output/upstream-review/pr-129.json)

**Bevezetendő · P1 · Hiba.** NOAA unsupported limit query és API error üres sikernek kezelése valós.

**Integrációs feltétel:** Querylimit elhagyás, lokalslice; HTTP/errorbody source-health.

**Ellenőrzés / korlát:** 400/errorbody/fetcherror/validfeaturecollection, failed nő.

**Helyi érintettség (ef579d1):** `apis/sources/noaa.mjs`.

**Bizonyíték:** 1 488 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Nem támogatott NOAA limit eltávolítva, APIhiba és üres válasz elkülönítve. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #130 — fix(ofac): stop downloading 267 MB per sweep; source always timed out

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/130) · [archivált snapshot](../../output/upstream-review/pr-130.json)

**Részben adaptálandó · P1 · Teljesítmény.** OFAC3teljesXML,ADVANCEDkétszer; #101 bandwidth valós ok. Range64KB stream hasznos, ignoráltRange/chunk/cancel javítandó.

**Integrációs feltétel:** Egyszeri meta, exactbytecap+slice/deadline/finallycancel; firstchunk sample nem latestentries; hibák láthatók.

**Ellenőrzés / korlát:** IgnoredRange/nagychunk se teljesdownload, cancel/timeout/XMLdate/badHTTPfixture.

**Helyi érintettség (ef579d1):** `apis/sources/ofac.mjs`.

**Bizonyíték:** 5 804 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `apis/sources/ofac.mjs:53`, `apis/sources/ofac.mjs:111`.

**Végső eredmény:** `implemented` — Két legfeljebb 64 KiB-os OFAC exportminta; ignorált Range/oversized chunk/unbounded stream megszakítása, hiteles partial metadata. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #133 — fix(ideas): wire up rule-based idea engine as LLM fallback

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/133) · [archivált snapshot](../../output/upstream-review/pr-133.json)

**Részben adaptálandó · P1 · Hiba.** Shared resolveIdeas server+CLI dead rules fallbackot élővé teszi, goodtests. WTIrecent[0]latest assumption helyi chronologicalYahoo-n fordít, HUlanguage elvész.

**Integrációs feltétel:** Sharedresolver HU/TRADE_IDEAS_LANG átadás, newesttimestamp/valóssorrend; rules type/horizon normalize és source=rules.

**Ellenőrzés / korlát:** Disabled/error/empty/badLLM,HUlanguange,chrono/reversedWTI,nullprice,threshold; nemduplicate.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `locales/en.json`, `locales/fr.json`, `package.json`, `server.mjs`, `README.md`.

**Bizonyíték:** 31 599 karakter teljes diff  8 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `server.mjs:13`, `server.mjs:16`, `server.mjs:351`.

**Végső eredmény:** `implemented` — Közös HU/EN szabályfallback szerverben és CLI-ben, valid shape, helyes WTI sorrend, nincs missing/zero adatból kitalált jel. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #135 — fix(dashboard): escape untrusted feed and LLM text before innerHTML

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/135) · [archivált snapshot](../../output/upstream-review/pr-135.json)

**Részben adaptálandó · P0 · Biztonság.** Tárolt XSS javítása széles körű HTML-escape és inline JSON védelemmel; #150-nél alaposabb. A PR nem tartalmazza a saját WHO/HDX/IODA/settings popupokat; szövegminta-teszt nem bizonyít teljes böngészővédelmet.

**Integrációs feltétel:** Minden külső adatot a text/attribute/URL kontextushoz megfelelően kezelni. JSON < és <!-- ellen biztonságos \u003c szerializáció, kontrollált <br> formázás; valamennyi saját renderfelület áttekintése.

**Ellenőrzés / korlát:** Valódi DOM/böngésző payload headline, LLM type, region, nuclear site, WHO és IODA mezőkben; inline </script><!--; normál https link működik. PR-kódot nem futtattunk.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték:** 31 289 karakter teljes diff  3 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `server.mjs:247`, `server.mjs:249`, `dashboard/public/jarvis.html:776`, `dashboard/public/jarvis.html:809`, `dashboard/public/jarvis.html:813`.

**Végső eredmény:** `implemented` — Közös inline JSON védelem és kontextusos DOM escaping a saját WHO/HDX/IODA felületeken is. Normalizált LLM schema és böngészős hostile-text ellenőrzés. Kiadás: v2.1.0, v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #136 — fix: harden Ollama provider for reasoning models + configurable LLM budgets

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/136) · [archivált snapshot](../../output/upstream-review/pr-136.json)

**Részben adaptálandó · P1 · Hiba.** Lezárt, nem merge-elt konfigurálható ideas/alerts token- és timeoutkeret, valamint üres length-finish felismerés. A tényleges 90s/30s híváskeretet kezeli; #88 önmagában nem.

**Integrációs feltétel:** Validált pozitív token/ms env hívástípusonként, kompatibilis default, explicit finish-reason hiba és rules fallback. A HU prompt maradjon.

**Ellenőrzés / korlát:** A valódi request opts legyen konfigurált; hibás env/default, length+empty, error→rules esetek. Helyi GPU-inference külön ellenőrzendő.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/alerts/discord.mjs`, `lib/alerts/telegram.mjs`, `lib/llm/ideas.mjs`, `lib/llm/index.mjs`, `lib/llm/ollama.mjs`, `README.md`.

**Bizonyíték:** 12 963 karakter teljes diff  9 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Valós ideas/alerts call-site token- és időkeret, validated range, reasoning-only exhaustion diagnózis és rules fallback. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #137 — feat(alerts): add Feishu (Lark) alerter with rich card messages

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/137) · [archivált snapshot](../../output/upstream-review/pr-137.json)

**Opcionális, külön igényhez · P2 · Új funkció.** Feishu opcionális webhook; manualtest valódi üzenetet küldene, ezért nem futott.

**Integrációs feltétel:** Igényre opt-in URL/secret/signature/timeout/rate/error/formatter, alerter sajátfunkciók maradnak.

**Ellenőrzés / korlát:** OfflineHMAC+mockwebhook/network/rate; nincs másnak üzenet.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/alerts/feishu.mjs` (a baseline-ban nincs), `server.mjs`, `test-feishu.mjs` (a baseline-ban nincs).

**Bizonyíték:** 19 333 karakter teljes diff  5 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #138 — feat(i18n): add Chinese (zh) locale with full 281-key coverage

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/138) · [archivált snapshot](../../output/upstream-review/pr-138.json)

**Opcionális, külön igényhez · P3 · Új funkció.** StatikusZH jobb runtimefordító102/106-nál; upstreamEN281key parity nem sajátbővítettlocale parity.

**Integrációs feltétel:** ZH igényre helyi kulcsok és fallback/list frissítés.

**Ellenőrzés / korlát:** HU/EN/FR/ZHparity/missingfallback; nincs fizetőscall.

**Helyi érintettség (ef579d1):** `lib/i18n.mjs`, `locales/zh.json` (a baseline-ban nincs).

**Bizonyíték:** 10 335 karakter teljes diff  2 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #140 — feat(llm): add Requesty provider (OpenAI-compatible unified API)

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/140) · [archivált snapshot](../../output/upstream-review/pr-140.json)

**Opcionális, külön igényhez · P2 · Új funkció.** Requesty raw-fetch sajátkeynél hasznos; EU dokumentáció ellenére hardcoded global endpoint.

**Integrációs feltétel:** #55 genericbase előbb, namedalias csakigényre regionexplicit.

**Ellenőrzés / korlát:** Global/EU/customURL/timeouterror; defaulttal nincs adatrezidenciaigazolás.

**Helyi érintettség (ef579d1):** `.env.example`, `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/requesty.mjs` (a baseline-ban nincs), `README.md`.

**Bizonyíték:** 13 104 karakter teljes diff  7 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #141 — docs: add source operations guides starting with OpenSky

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/141) · [archivált snapshot](../../output/upstream-review/pr-141.json)

**Részben adaptálandó · P2 · Dokumentáció.** OpenSky opsguide hasznos #52-höz, age/retry leírás147/121után változik.

**Integrációs feltétel:** Végső token/no-key/retrycap/cacheage/staleUI szerint írni.

**Ellenőrzés / korlát:** Docs/config/health mezők egyeznek.

**Helyi érintettség (ef579d1):** `README.md`.

**Bizonyíték:** 7 772 karakter teljes diff  3 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Aktuális source/LAN/port/container/model üzemeltetési útmutató. Portütközés folyamat-azonosítással, idegen process nem leállítandó; OpenSky valódi egyórás TTL és rate-limit leírás. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #143 — Fix dashboard never fetching live data on load

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/143) · [archivált snapshot](../../output/upstream-review/pr-143.json)

**Duplikátum · P1 · Hiba.** #92-vel azonos, egysoros inline HTTP boot javítás már a helyi baseline-ban megvan.

**Integrációs feltétel:** Nincs új alapjavítás; #127 shape/reconnect/fallback részeit külön adaptálni.

**Ellenőrzés / korlát:** Inline HTTP SSE frissítés; jarvis.html sweepenkénti újraírása nem szükséges.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték:** 490 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `dashboard/public/jarvis.html:2461`, `dashboard/public/jarvis.html:2463`.

**Végső eredmény:** `implemented` — Meglévő HTTP boot megtartva, valid APIshape, egyetlen SSE natív reconnecttel, fallback polling és offline/waiting állapot. file módban statikus működés. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #144 — Use HTTPS for core BBC RSS feeds

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/144) · [archivált snapshot](../../output/upstream-review/pr-144.json)

**Bevezetendő · P1 · Biztonság.** BBC World és Science feed baseline URL-je HTTP; ez valós integritási hiány.

**Integrációs feltétel:** Mindkét BBC URL HTTPS-re állítása.

**Ellenőrzés / korlát:** Statikus URL-ellenőrzés és RSS fixture; élő elérhetőség külön.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték:** 1 036 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `dashboard/inject.mjs:366`, `dashboard/inject.mjs:372`.

**Végső eredmény:** `implemented` — Mindkét BBC feed HTTPS. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #145 — Stop randomizing news marker coordinates on the map

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/145) · [archivált snapshot](../../output/upstream-review/pr-145.json)

**Bevezetendő · P1 · Adathitelesség.** RSS jitter véletlenül eltolja a becsült pontokat, hamis koordinátapontosságot sugall.

**Integrációs feltétel:** Eltávolítani #149-cel együtt; sourceRegion és inferred megjelölés maradjon.

**Ellenőrzés / korlát:** Azonos bemenetből stabil koordináta; hely nélküli cikkhez nem kerül pont.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték:** 476 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Random jitter és kiadó-centroid eltávolítva; stabil headline-inferred pont, ismeretlen helyű cikk a tickerben marad. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #146 — Fix naive substring match causing false urgent-keyword flags

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/146) · [archivált snapshot](../../output/upstream-review/pr-146.json)

**Részben adaptálandó · P1 · Hiba.** URGENT_KEYWORDS substring falsepositive és lowercaseinput/uppercasekeyword mismatch; escapedwordboundary jóirány.

**Integrációs feltétel:** Compile egyszer/case-insensitive szó-phrase, Unicodehatár átgondolva; headline változatlan.

**Ellenőrzés / korlát:** war/forward,kill/skill,ICBM,F-16,phrase/punct/emoji/Unicode.

**Helyi érintettség (ef579d1):** `apis/sources/telegram.mjs`.

**Bizonyíték:** 1 240 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Escaped case-insensitive word-boundary urgencia és eredeti postlink megőrzése; a teljes headline korábbi javítása megmaradt. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #147 — Add freshness bound to OpenSky historical fallback

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/147) · [archivált snapshot](../../output/upstream-review/pr-147.json)

**Részben adaptálandó · P1 · Adathitelesség.** OpenSky korlátlan cache-fallback valós hiba, a 4 órás TTL jó irány. InvalidDate/NaN átcsúszhat; fájlnévsorrend nem időbélyegsorrend; age csak meta-ban nem elég.

**Integrációs feltétel:** Véges, érvényes idő/kor; valódi timestamp szerinti kiválasztás; korlátos konfigurálható TTL és látható stale/age jelzés. Régi pont nem tűnhet frissnek.

**Ellenőrzés / korlát:** Friss/pontosan TTL/régi/jövőbeli/hibás cache és fájlnév-idő eltérés; friss forrás nélkül üres adat és degraded health.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték:** 2 605 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `dashboard/inject.mjs:699`, `dashboard/inject.mjs:700`, `dashboard/inject.mjs:887`, `dashboard/inject.mjs:890`, `dashboard/inject.mjs:891`.

**Végső eredmény:** `implemented` — Egyórás valid observation TTL, nem fájlnévsorrend; friss részadat megmarad, stale UI jelölt. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #148 — Preserve GDELT article publication time instead of synthesizing 'now'

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/148) · [archivált snapshot](../../output/upstream-review/pr-148.json)

**Részben adaptálandó · P1 · Adathitelesség.** GDELT now értéke kitalált publikálási idő. Kompakt dátum feldolgozása javít, de Date az érvénytelen naptári napot normalizálhatja.

**Integrációs feltétel:** UTC roundtrip validálás; ISO és compact formátum; hibás/hiányzó idő→null. Az eredeti publikálási idő maradjon.

**Ellenőrzés / korlát:** Compact/ISO/szökőnap/Feb30/hiány; ismeretlen dátum és rendezés helyes.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték:** 1 345 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `dashboard/inject.mjs:925`.

**Végső eredmény:** `implemented` — Valódi GDELT publikálási idő compact/ISO formátumból; érvénytelen naptári dátum null, nem now. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #149 — Don't plot regional RSS fallback items at a fabricated source centroid

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/149) · [archivált snapshot](../../output/upstream-review/pr-149.json)

**Részben adaptálandó · P1 · Adathitelesség.** Region-centroid fallback cikkesemény helyét fabrikálja. Unresolved lat/lon→null jó, de mapped jitter #145 nélkül megmarad.

**Integrációs feltétel:** #145-tel közösen; sourceRegion tickerben marad, keyword geo inferred és bizonytalan; hiányzó pontos helyhez nincs marker.

**Ellenőrzés / korlát:** Régiót megadó/hely nélküli/városnévvel bíró hírek, null-safe térkép, regionális hírek megmaradnak.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték:** 2 768 karakter teljes diff  2 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Random jitter és kiadó-centroid eltávolítva; stabil headline-inferred pont, ismeretlen helyű cikk a tickerben marad. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #150 — Fix stored XSS in jarvis.html popup/panel rendering

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/150) · [archivált snapshot](../../output/upstream-review/pr-150.json)

**Elutasítva · P0 · Biztonság.** #135 gyengébb XSS alternatívája: idea.type class attribútum, SDR region és nuclear site raw marad. <!-- JS identity escape JSON.parse-kompatibilitása kétséges.

**Integrációs feltétel:** #135 teljes helyi kontextusvédelmét adaptálni; #150 teljes patch nem megfelelő védelem.

**Ellenőrzés / korlát:** Attribute/body/inline JSON payload böngészőben; részleges escape nem lezárt XSS-javítás.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték:** 18 125 karakter teljes diff  2 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `rejected` — Nem integrált; az egyedi biztonsági, regressziós vagy scope-indok továbbra is érvényes. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #151 — Fix flat-map marker labels vanishing on pan

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/151) · [archivált snapshot](../../output/upstream-review/pr-151.json)

**Bevezetendő · P1 · Hiba.** k<2.5 országfelirat-cutoff baseline kódja eltünteti a neveket pan/zoom közben.

**Integrációs feltétel:** Cutoff eltávolítása, scale compensation és magyar feliratok megőrzésével.

**Ellenőrzés / korlát:** Pan és több zoomszint: DOM visibility/screenshot, olvashatóság és átfedés.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték:** 656 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Baseline kódhely:** `dashboard/public/jarvis.html:9`, `dashboard/public/jarvis.html:111`, `dashboard/public/jarvis.html:112`, `dashboard/public/jarvis.html:339`, `dashboard/public/jarvis.html:340`.

**Végső eredmény:** `implemented` — Országfeliratok pan/zoom alatt megmaradnak. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #152 — Fix Macro+Markets panel going empty when Yahoo Finance blocks requests

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/152) · [archivált snapshot](../../output/upstream-review/pr-152.json)

**Bevezetendő · P1 · Hiba.** Yahoo HTML200/missing chart hibaválaszából symbol/name eltűnik, ezért a hiba unknown instrumentumhoz kötődik; #56 releváns.

**Integrációs feltétel:** Minden hibaválasz őrizze a szimbólumot/nevet; HTML és hiányzó chart legyen hiba, ne ár.

**Ellenőrzés / korlát:** HTML200/null chart/HTTP hiba/valós quote; health a megfelelő instrumentumot jelöli.

**Helyi érintettség (ef579d1):** `apis/sources/yfinance.mjs`.

**Bizonyíték:** 543 karakter teljes diff  1 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Yahoo HTML/missing chart hibája megtartja name/symbol mezőt. Hálózati upstream blokkolás ettől nem kerülhető meg. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #153 — Wire rule-based idea engine as fallback when LLM is not configured

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/153) · [archivált snapshot](../../output/upstream-review/pr-153.json)

**Duplikátum · P1 · Hiba.** Dead-rules probléma helyesen azonosított, de #133 kevésbé robusztus alternatívája; array-shape és érdemi automatizált teszt hiányzik.

**Integrációs feltétel:** #133 shared resolver és helyi HU/WTI javítás; ne legyen két fallback út.

**Ellenőrzés / korlát:** #133 regressziók; szerző böngészős állítása nem saját ellenőrzés.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`, `server.mjs`.

**Bizonyíték:** 8 844 karakter teljes diff  3 fájl; 0 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

**Végső eredmény:** `implemented` — Közös HU/EN szabályfallback szerverben és CLI-ben, valid shape, helyes WTI sorrend, nincs missing/zero adatból kitalált jel. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### PR #154 — Deploy

[PR és teljes discussion](https://github.com/calesthio/Crucix/pull/154) · [archivált snapshot](../../output/upstream-review/pr-154.json)

**Részben adaptálandó · P2 · Új funkció.** Lezárt, nem merge-elt Deploy: 47 fájl/501KB, szerző: Accident. Source-health, orbit, AIS, OpenSky OAuth, history, cards és shared bot commands egész forkot alkot.

**Integrációs feltétel:** Egész ág nem. Külön adaptálható health állapotok/shared bot commands/korlátos Space és history cache. Orbit estimated és eredetjelzés; AIS lifecycle és OAuth singleflight/expiry külön vizsgálat.

**Ellenőrzés / korlát:** Célzott termékkód-vizsgálat és teljes fájlleltár; nem teljes fork runtime/security tanúsítása. HU/IODA/WHO/draggable/Discord saját funkciók maradnak.

**Helyi érintettség (ef579d1):** `.env.example`, `.github/workflows/docker-publish.yml`, `apis/briefing.mjs`, `apis/sources/cisa-kev.mjs`, `apis/sources/cloudflare-radar.mjs`, `apis/sources/firms.mjs`, `apis/sources/opensky.mjs`, `apis/sources/ships.mjs`.

**Bizonyíték:** 501 544 karakter teljes diff  47 fájl; 1 hozzászólás  0 review  0 review-comment. Upstream nem merge-elt. Diff-hash és valamennyi discussion URL a JSON-ban.

## Tételes issue-döntések

| Issue | Típus | Döntés | Prioritás |
| --- | --- | --- | --- |
| [#3 — The page remains black](https://github.com/calesthio/Crucix/issues/3) | Hiba | Már jelen van | P3 |
| [#7 — Added Anthropic API but still getting LLM not configured](https://github.com/calesthio/Crucix/issues/7) | Konfiguráció | Már jelen van | P3 |
| [#13 — [Feature] Add OpenRouter support to LLM providers](https://github.com/calesthio/Crucix/issues/13) | Új funkció | Már jelen van | P3 |
| [#15 — [Feature] Add Mistral AI LLM provider](https://github.com/calesthio/Crucix/issues/15) | Új funkció | Már jelen van | P3 |
| [#23 — From dashboard to intelligence engine — Crucix learns, remembers, and predicts](https://github.com/calesthio/Crucix/issues/23) | Új funkció | Opcionális, külön igényhez | P2 |
| [#25 — Prebuilt docker images on ghcr / dockerhub](https://github.com/calesthio/Crucix/issues/25) | Új funkció | Már jelen van | P2 |
| [#30 — [Feature] Add Ollama Provider Support for Selft-Hosted Options](https://github.com/calesthio/Crucix/issues/30) | Új funkció | Már jelen van | P2 |
| [#33 — [Bug] ACLED CONFLICT LAYER: DEGRADED](https://github.com/calesthio/Crucix/issues/33) | Konfiguráció | További diagnózis | P2 |
| [#40 — [Feature] Add Strait of Gibraltar as a Monitored Choke Point](https://github.com/calesthio/Crucix/issues/40) | Új funkció | Már jelen van | P3 |
| [#41 — GeoStats — frontend fork with full-screen layout + Wallpaper Engine support](https://github.com/calesthio/Crucix/issues/41) | Új funkció | Opcionális, külön igényhez | P3 |
| [#48 — [Feature] Add GROQ for more LLMs](https://github.com/calesthio/Crucix/issues/48) | Új funkció | Részben adaptálandó | P2 |
| [#51 — [Feature] Toggle Space Station Display: Static Icons vs Orbital Overlays](https://github.com/calesthio/Crucix/issues/51) | Új funkció | Opcionális, külön igényhez | P2 |
| [#52 — Add source-specific operational docs starting with OpenSky](https://github.com/calesthio/Crucix/issues/52) | Dokumentáció | Részben adaptálandó | P2 |
| [#54 — Add xAI Grok as an LLM provider](https://github.com/calesthio/Crucix/issues/54) | Új funkció | Már jelen van | P3 |
| [#56 — [Bug] Macro + Markets section unpopulated](https://github.com/calesthio/Crucix/issues/56) | Hiba | Bevezetendő | P1 |
| [#64 — [Bug] Horizontal overflow in the top control panel on mobile view](https://github.com/calesthio/Crucix/issues/64) | Hiba | Már jelen van | P3 |
| [#67 — [Bug] site seems down](https://github.com/calesthio/Crucix/issues/67) | Üzemeltetés | Nincs termékváltozás | P3 |
| [#70 — [Bug] Map Icon Names Not Regenerating](https://github.com/calesthio/Crucix/issues/70) | Hiba | Bevezetendő | P1 |
| [#72 — [Feature] Make Sensor Grid sidebar items interactive: toggles / highlighters for focusing data layers](https://github.com/calesthio/Crucix/issues/72) | Új funkció | Részben adaptálandó | P2 |
| [#74 — dashboard no address](https://github.com/calesthio/Crucix/issues/74) | Konfiguráció | Részben adaptálandó | P3 |
| [#75 — Telegram briefing is too cryptic; missing source links and verification context](https://github.com/calesthio/Crucix/issues/75) | Új funkció | Részben adaptálandó | P2 |
| [#77 — Stuck in FINALIZING... and EST. READY IN](https://github.com/calesthio/Crucix/issues/77) | Hiba | További diagnózis | P1 |
| [#78 — [Feature]  CasaOS integration using docker -  Includes my docker file for anyone interested.](https://github.com/calesthio/Crucix/issues/78) | Dokumentáció | Opcionális, külön igényhez | P3 |
| [#79 — [Bug] ](https://github.com/calesthio/Crucix/issues/79) | Hiányos/érvénytelen | Nincs termékváltozás | P3 |
| [#80 — [Feature] ](https://github.com/calesthio/Crucix/issues/80) | Hiányos/érvénytelen | Nincs termékváltozás | P3 |
| [#86 — [Bug] Localhost not loading](https://github.com/calesthio/Crucix/issues/86) | Konfiguráció | Részben adaptálandó | P3 |
| [#87 — [Feature] LLm timeout](https://github.com/calesthio/Crucix/issues/87) | Hiba | Részben adaptálandó | P1 |
| [#93 — is there a usecase for this](https://github.com/calesthio/Crucix/issues/93) | Vita | Nincs termékváltozás | P3 |
| [#100 — [Bug] inject.mjs is not running](https://github.com/calesthio/Crucix/issues/100) | Hiba | Részben adaptálandó | P1 |
| [#101 — [Feature] Insights into network traffic](https://github.com/calesthio/Crucix/issues/101) | Teljesítmény | Részben adaptálandó | P1 |
| [#104 — [Telegram] Poll error: fetch failed](https://github.com/calesthio/Crucix/issues/104) | Üzemeltetés | További diagnózis | P2 |
| [#105 — What's going on? I'm using Docker to set it up. It opens normally, but the content isn't being updated.](https://github.com/calesthio/Crucix/issues/105) | Hiba | További diagnózis | P1 |
| [#107 — Inorganic fork-inflation pattern: 1,560 forks, 0/1560 issues-enabled, burst of 222 on day 4](https://github.com/calesthio/Crucix/issues/107) | Vita | Nincs termékváltozás | P3 |
| [#108 — Reddit unauthenticated .json scraping violates API ToS; failed sweeps silently serve stale data](https://github.com/calesthio/Crucix/issues/108) | Szolgáltatói szabályok/megbízhatóság | Részben adaptálandó | P2 |
| [#110 — Telegram feed scrapes t.me/s/* with spoofed Chrome User-Agent — Bot API fallback is ToS-violating browser impersonation](https://github.com/calesthio/Crucix/issues/110) | Szolgáltatói szabályok/megbízhatóság | További diagnózis | P2 |
| [#111 — All API endpoints unauthenticated — /api/data, /api/health, /events open to any caller on public deployments](https://github.com/calesthio/Crucix/issues/111) | Biztonság | Részben adaptálandó | P2 |
| [#112 — News map randomizes article coordinates with Math.random instead of rendering real locations](https://github.com/calesthio/Crucix/issues/112) | Adathitelesség | Bevezetendő | P1 |
| [#113 — OpenSky fallback silently replays historical run files as current air hotspot data](https://github.com/calesthio/Crucix/issues/113) | Adathitelesség | Részben adaptálandó | P1 |
| [#114 — Core RSS feed list still includes plaintext HTTP BBC feeds](https://github.com/calesthio/Crucix/issues/114) | Biztonság | Bevezetendő | P1 |
| [#115 — Unified ticker rewrites GDELT article times to the current clock instead of preserving article timestamps](https://github.com/calesthio/Crucix/issues/115) | Adathitelesség | Részben adaptálandó | P1 |
| [#116 — Regional RSS fallback pins unmatched stories to hardcoded source-level centroids](https://github.com/calesthio/Crucix/issues/116) | Adathitelesség | Részben adaptálandó | P1 |
| [#117 — [Feature] Support openai compatible LLM running in private host](https://github.com/calesthio/Crucix/issues/117) | Új funkció | Részben adaptálandó | P1 |
| [#118 — Avoid using substring check on headline](https://github.com/calesthio/Crucix/issues/118) | Hiba | Részben adaptálandó | P1 |
| [#119 — SSE live updates never connect when server injects inline data, dashboard stays frozen on bundled date](https://github.com/calesthio/Crucix/issues/119) | Hiba | Részben adaptálandó | P1 |
| [#125 — Your project is on StackMap — a curated map of the AI stack](https://github.com/calesthio/Crucix/issues/125) | Promóció | Nincs termékváltozás | P3 |
| [#131 — Fork with RSS Manager, Geopolitical Map, and AI Chat](https://github.com/calesthio/Crucix/issues/131) | Új funkció | Opcionális, külön igényhez | P2 |
| [#132 — Rule-based idea engine is dead code — Ideas panel is permanently empty without an LLM key](https://github.com/calesthio/Crucix/issues/132) | Hiba | Részben adaptálandó | P1 |
| [#134 — Dashboard renders untrusted feed and LLM text into innerHTML with no HTML escaping (stored XSS)](https://github.com/calesthio/Crucix/issues/134) | Biztonság | Részben adaptálandó | P0 |
| [#139 — Bug: Dashboard permanently shows stale hardcoded demo data (never fetches live data or connects SSE)](https://github.com/calesthio/Crucix/issues/139) | Hiba | Duplikátum | P1 |
| [#142 — Security: PolinRider malware detected in open PR #27](https://github.com/calesthio/Crucix/issues/142) | Biztonság | Elutasítva | P0 |

**Végső eredmény:** `partially_adapted` — Source-health és korlátos saját snapshot/cache életciklus adaptálva. Orbit/AIS/OAuth/history-card teljes fork nem importált; a meglévő estimated satellite megjelölés megmaradt. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #3 — The page remains black

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/3) · [archivált snapshot](../../output/upstream-review/issue-3.json)

**Már jelen van · P3 · Hiba.** Docker távoli host fekete dashboard: localhostra kötött boot feltétel hibája, maintainer megoldást igazol; helyi protocol alapú boot már javított.

**Integrációs feltétel:** #127 validáció/reconnect remaining; host-IP/localhost külön teszt.

**Ellenőrzés / korlát:** HTTP host-IP/localhost+inline/SSE smoke; closed állapot önmagában nem bizonyíték, jelen kód is lefedi.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`, `server.mjs`.

**Bizonyíték / státusz:** 4 hozzászólás; `baseline_present`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #7 — Added Anthropic API but still getting LLM not configured

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/7) · [archivált snapshot](../../output/upstream-review/issue-7.json)

**Már jelen van · P3 · Konfiguráció.** Anthropic kulcs mögötti inline .env comment volt a hozzászólás szerint; #6 külön sorral megoldott. Generálás várakozása külön állapot.

**Integrációs feltétel:** Példaconfig és quote parser megőrzése; kulcsot ne logoljuk.

**Ellenőrzés / korlát:** Példakulcs normál érték; nem minden lassú call konfigurációs hiba.

**Helyi érintettség (ef579d1):** `.env.example`, `apis/utils/env.mjs`.

**Bizonyíték / státusz:** 5 hozzászólás; `baseline_present`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #13 — [Feature] Add OpenRouter support to LLM providers

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/13) · [archivált snapshot](../../output/upstream-review/issue-13.json)

**Már jelen van · P3 · Új funkció.** OpenRouter igény #16-tal teljesült.

**Integrációs feltétel:** Meglévő adapter marad.

**Ellenőrzés / korlát:** Provider mock; nincs új provider.

**Helyi érintettség (ef579d1):** `lib/llm/index.mjs`, `lib/llm/openrouter.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `baseline_present`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #15 — [Feature] Add Mistral AI LLM provider

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/15) · [archivált snapshot](../../output/upstream-review/issue-15.json)

**Már jelen van · P3 · Új funkció.** Mistral igény #14-tal teljesült.

**Integrációs feltétel:** #46 duplikáció nem.

**Ellenőrzés / korlát:** Ideas/alerts provider regresszió.

**Helyi érintettség (ef579d1):** `lib/llm/mistral.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `baseline_present`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #23 — From dashboard to intelligence engine — Crucix learns, remembers, and predicts

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/23) · [archivált snapshot](../../output/upstream-review/issue-23.json)

**Opcionális, külön igényhez · P2 · Új funkció.** Hosszú távú intelligence memory/prediction/SQLite/vector projekt, több új dependency és pontossági elvárás; nem konkrét javítás. Meglévő delta-memory részben előzménykezelés.

**Integrációs feltétel:** Külön design: retention/schema/provenance/értékelés; forecast ne legyen igazolt tényként; no wholesale dependency import.

**Ellenőrzés / korlát:** Snapshot migráció/retention és unseen-data forecast evaluation; nincs kész upstream implementation.

**Helyi érintettség (ef579d1):** `lib/delta/memory.mjs`, `lib/delta/index.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #25 — Prebuilt docker images on ghcr / dockerhub

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/25) · [archivált snapshot](../../output/upstream-review/issue-25.json)

**Már jelen van · P2 · Új funkció.** Prebuilt Docker igény #35 workflow-val lefedett, friss fork publication még külön bizonyítandó.

**Integrációs feltétel:** Parent release saját run/tag/artifact ellenőrzés.

**Ellenőrzés / korlát:** Image tényleges pull/start; audit nem publikált.

**Helyi érintettség (ef579d1):** `.github/workflows/docker-publish.yml`, `Dockerfile`.

**Bizonyíték / státusz:** 2 hozzászólás; `baseline_present`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #30 — [Feature] Add Ollama Provider Support for Selft-Hosted Options

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/30) · [archivált snapshot](../../output/upstream-review/issue-30.json)

**Már jelen van · P2 · Új funkció.** Ollama provider #38-ban megvan, timeout #87 külön nyitott.

**Integrációs feltétel:** Valós call budgets #136.

**Ellenőrzés / korlát:** Provider URL és timeout forwarding.

**Helyi érintettség (ef579d1):** `lib/llm/ollama.mjs`.

**Bizonyíték / státusz:** 3 hozzászólás; `baseline_present`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #33 — [Bug] ACLED CONFLICT LAYER: DEGRADED

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/33) · [archivált snapshot](../../output/upstream-review/issue-33.json)

**További diagnózis · P2 · Konfiguráció.** ACLED OAuth token sikere nem bizonyít data endpoint jogosultságot; local OAuth+cookie fallback van. Report Node9.2.0-at ír, engine22; környezetadat tisztázandó.

**Integrációs feltétel:** ACLED account entitlement/data403 és Node verzió diagnózis, redacted error docs; ne találjunk ki credentials-bypass javítást.

**Ellenőrzés / korlát:** Mock401/403/token/cookie; valós fiók-hozzáférés auditban nem igazolt.

**Helyi érintettség (ef579d1):** `apis/sources/acled.mjs`, `package.json`.

**Bizonyíték / státusz:** 2 hozzászólás; `not_reproduced_environment`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `environment_dependent_documented` — Hiányos vagy környezeti reprodukció. Bounded source/model határidő, biztonságos opener, current ready/boot, auth és DNS/egress diagnosztika rendelkezésre áll. Account/container hálózati hibát nem jelentünk univerzálisan megoldottnak. Kiadás: v2.1.0, v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #40 — [Feature] Add Strait of Gibraltar as a Monitored Choke Point

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/40) · [archivált snapshot](../../output/upstream-review/issue-40.json)

**Már jelen van · P3 · Új funkció.** Gibraltar kérés #43-ban megvan; geopolitikai százalékállításokat nem teszteli a patch.

**Integrációs feltétel:** Statikus marker megmarad.

**Ellenőrzés / korlát:** Koordináta/label smoke, nem forgalomstatisztika.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték / státusz:** 2 hozzászólás; `baseline_present`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #41 — GeoStats — frontend fork with full-screen layout + Wallpaper Engine support

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/41) · [archivált snapshot](../../output/upstream-review/issue-41.json)

**Opcionális, külön igényhez · P3 · Új funkció.** GeoStats/WallpaperEngine külső fork inspiráció, mellékelt integrálandó patch nincs; saját draggable UI már van.

**Integrációs feltétel:** Fullscreen/desktop mód külön igényre, külső kód külön review.

**Ellenőrzés / korlát:** Local panels megmarad; nincs külső fork automatikus merge.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #48 — [Feature] Add GROQ for more LLMs

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/48) · [archivált snapshot](../../output/upstream-review/issue-48.json)

**Részben adaptálandó · P2 · Új funkció.** Groq igény értékes provider-választék; #47 closed/unmerged és túlcsomagolt, issue még open.

**Integrációs feltétel:** #55 generic route vagy kis adapter, nem ccxt/UI bundle.

**Ellenőrzés / korlát:** Groq request/schema/error mock; élő model/key nincs.

**Helyi érintettség (ef579d1):** `lib/llm/index.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `partially_adapted` — Groq az OpenAI-compatible adapterrel és hivatalos endpointtal konfigurálható; dedicated alias és a PR unrelated crypto/server/UI részei nem kerültek be. Éles Groq hívás nincs igazolva. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #51 — [Feature] Toggle Space Station Display: Static Icons vs Orbital Overlays

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/51) · [archivált snapshot](../../output/upstream-review/issue-51.json)

**Opcionális, külön igényhez · P2 · Új funkció.** Műhold orbit/toggle kérés új funkció, #154 részben orbit számítást tartalmaz; teljes fork nem importálható.

**Integrációs feltétel:** Valódi orbital elements és estimated accuracy/provenance, click/details/visibility külön; nem koholt mozgás.

**Ellenőrzés / korlát:** Időfüggő propagáció/plausibleposition/visibleestimated; számított orbit nem mért aktuális koordináta.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #52 — Add source-specific operational docs starting with OpenSky

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/52) · [archivált snapshot](../../output/upstream-review/issue-52.json)

**Részben adaptálandó · P2 · Dokumentáció.** Forrásüzemeltetés dokumentációigény, #141 OpenSky jó részleges válasz.

**Integrációs feltétel:** Végső token/cache/retry/health és valós30source szerint docs.

**Ellenőrzés / korlát:** Dokumentáció/config egyezés, más sources sem fedettek teljesen csak141-gyel.

**Helyi érintettség (ef579d1):** `apis/briefing.mjs`, `apis/sources/opensky.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Aktuális source/LAN/port/container/model üzemeltetési útmutató. Portütközés folyamat-azonosítással, idegen process nem leállítandó; OpenSky valódi egyórás TTL és rate-limit leírás. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #54 — Add xAI Grok as an LLM provider

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/54) · [archivált snapshot](../../output/upstream-review/issue-54.json)

**Már jelen van · P3 · Új funkció.** Grok kérés #62-tal lefedett, issue open maradt.

**Integrációs feltétel:** Meglévő provider marad.

**Ellenőrzés / korlát:** Open issue nem automatikus hiány.

**Helyi érintettség (ef579d1):** `lib/llm/grok.mjs`.

**Bizonyíték / státusz:** 2 hozzászólás; `baseline_present`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #56 — [Bug] Macro + Markets section unpopulated

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/56) · [archivált snapshot](../../output/upstream-review/issue-56.json)

**Bevezetendő · P1 · Hiba.** Piacüres YahooHTML200; #152 error symbol/name elvesztést korrigál, a hálózati blokkolásnak nem általános gyógyszere.

**Integrációs feltétel:** Hiba attribúció/HTTPschema/error egészség, upstream egress/APIhiba látszódjon.

**Ellenőrzés / korlát:** HTML200/missingchart/validquote; nem hamis ár/adat.

**Helyi érintettség (ef579d1):** `apis/sources/yfinance.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Yahoo HTML/missing chart hibája megtartja name/symbol mezőt. Hálózati upstream blokkolás ettől nem kerülhető meg. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #64 — [Bug] Horizontal overflow in the top control panel on mobile view

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/64) · [archivált snapshot](../../output/upstream-review/issue-64.json)

**Már jelen van · P3 · Hiba.** Mobil wrap #65-ban javult.

**Integrációs feltétel:** HU hosszabb felirat megmarad.

**Ellenőrzés / korlát:** Keskeny viewport.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték / státusz:** 0 hozzászólás; `baseline_present`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `already_present_retained` — A baseline-ban jelen lévő viselkedés megmaradt; az eredeti PR egész ágának újraimportálása nem szükséges. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #67 — [Bug] site seems down

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/67) · [archivált snapshot](../../output/upstream-review/issue-67.json)

**Nincs termékváltozás · P3 · Üzemeltetés.** Nyilvános webhely kiesését maintainer20perces karbantartásként írta; nem helyi repo bug.

**Integrációs feltétel:** Nincs termékpatch.

**Ellenőrzés / korlát:** Távoli szolgáltatás múltbeli elérhetősége nem helyi regresszió.

**Helyi érintettség:** nincs konkrét integrálandó termékkód ebben a bejelentésben.

**Bizonyíték / státusz:** 1 hozzászólás; `not_a_confirmed_product_defect`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `no_actionable_code_change` — Nem reprodukálható kódhiba vagy nincs érdemi patch/követelmény; nincs indokolt termékmódosítás. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #70 — [Bug] Map Icon Names Not Regenerating

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/70) · [archivált snapshot](../../output/upstream-review/issue-70.json)

**Bevezetendő · P1 · Hiba.** Pan/zoom map labels eltűnés #151 konkrét baseline cutoff.

**Integrációs feltétel:** Cutoff elhagyás, scale compensation marad.

**Ellenőrzés / korlát:** Több zoom/pan/HU label screenshot.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Országfeliratok pan/zoom alatt megmaradnak. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #72 — [Feature] Make Sensor Grid sidebar items interactive: toggles / highlighters for focusing data layers

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/72) · [archivált snapshot](../../output/upstream-review/issue-72.json)

**Részben adaptálandó · P2 · Új funkció.** Sensorgrid rétegkapcsolók+focus/details/delta/ticker tág kérés, #76 csak toggles részét fedi.

**Integrációs feltétel:** Layer toggles saját settingsben, többi interakció külön; nem állítani teljes request kész.

**Ellenőrzés / korlát:** Layer persistence/nullsafe/detail és panelstate; focusspec még nem teljes implementation.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `partially_adapted` — 13 logikai réteg közös flat/globe beállítással, guardolt storage és billentyűzetes settings. A nagy Sensorgrid igény részletező nézete/története külön következő funkció; 245 capital bundle nem importált. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #74 — dashboard no address

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/74) · [archivált snapshot](../../output/upstream-review/issue-74.json)

**Részben adaptálandó · P3 · Konfiguráció.** LAN dashboard címének használata kevéssé részletezett install kérdés; nem megerősített codebug.

**Integrációs feltétel:** PUBLIC_URL/dokumentált hostIP/port/firewall és loading-state diagnózis.

**Ellenőrzés / korlát:** LAN URL smoke; idegen folyamat/host nem módosított.

**Helyi érintettség (ef579d1):** `crucix.config.mjs`, `server.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `closed`.

**Végső eredmény:** `implemented` — Aktuális source/LAN/port/container/model üzemeltetési útmutató. Portütközés folyamat-azonosítással, idegen process nem leállítandó; OpenSky valódi egyórás TTL és rate-limit leírás. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #75 — Telegram briefing is too cryptic; missing source links and verification context

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/75) · [archivált snapshot](../../output/upstream-review/issue-75.json)

**Részben adaptálandó · P2 · Új funkció.** Telegram riasztások kriptikusak; forráslink/eredet/integrity/id/verbosity hiány valódi UX lehetőség, de részletes reprodukció nincs.

**Integrációs feltétel:** Formatter link/forrás/id és opt-in verbosity, adat eredet/idő; Telegram escape/4096/rate megmarad.

**Ellenőrzés / korlát:** Formatter fixture hosszú/missing/safelink/HU; élő üzenetet audit nem küldött.

**Helyi érintettség (ef579d1):** `lib/alerts/telegram.mjs`, `lib/alerts/telegram.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `partially_adapted` — Egységes normalizált alert/idea schema, olvasható confidence/origin és források megőrzése; teljes felhasználói verbosity/provenance részletező nézet új feature marad. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #77 — Stuck in FINALIZING... and EST. READY IN

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/77) · [archivált snapshot](../../output/upstream-review/issue-77.json)

**További diagnózis · P1 · Hiba.** K8s finalizing log több problémát mutat: RSS egress, Discord application_id=me, régi ready; xdg-open hiánya nemfatal. Timeout/ready/boot részben márlocal.

**Integrációs feltétel:** Nem egy rootcause; APIhealth/sourceerrors/Node/containerimage és valódi Discord application ID diagnózis; #127/84 jó remaining.

**Ellenőrzés / korlát:** Offline startup/protocol/timeout; upstream deployment external manifest nincs futtatva.

**Helyi érintettség (ef579d1):** `server.mjs`, `lib/alerts/discord.mjs`, `dashboard/public/loading.html`.

**Bizonyíték / státusz:** 0 hozzászólás; `not_reproduced_environment`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `environment_dependent_documented` — Hiányos vagy környezeti reprodukció. Bounded source/model határidő, biztonságos opener, current ready/boot, auth és DNS/egress diagnosztika rendelkezésre áll. Account/container hálózati hibát nem jelentünk univerzálisan megoldottnak. Kiadás: v2.1.0, v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #78 — [Feature]  CasaOS integration using docker -  Includes my docker file for anyone interested.

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/78) · [archivált snapshot](../../output/upstream-review/issue-78.json)

**Opcionális, külön igényhez · P3 · Dokumentáció.** CasaOS compose hardcoded /home/alien,üres env eltakar env_file-t,8GB hostspecifikus.

**Integrációs feltétel:** Opcionális CasaOS guide paraméteres path/env/resources, nem localdefault replace.

**Ellenőrzés / korlát:** compose config/env precedence; nem szükséges host deployment.

**Helyi érintettség (ef579d1):** `docker-compose.yml`, `.env.example`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #79 — [Bug]

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/79) · [archivált snapshot](../../output/upstream-review/issue-79.json)

**Nincs termékváltozás · P3 · Hiányos/érvénytelen.** Kitöltetlen bug template, nincs symptom/env/repro.

**Integrációs feltétel:** Nincs megerősített javítandó hiba.

**Ellenőrzés / korlát:** Invalid report, nem confirmed bug.

**Helyi érintettség:** nincs konkrét integrálandó termékkód ebben a bejelentésben.

**Bizonyíték / státusz:** 0 hozzászólás; `not_a_confirmed_product_defect`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `no_actionable_code_change` — Nem reprodukálható kódhiba vagy nincs érdemi patch/követelmény; nincs indokolt termékmódosítás. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #80 — [Feature]

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/80) · [archivált snapshot](../../output/upstream-review/issue-80.json)

**Nincs termékváltozás · P3 · Hiányos/érvénytelen.** Kitöltetlen feature és malformed link, nincs követelmény.

**Integrációs feltétel:** Nincs integrálandó funkció.

**Ellenőrzés / korlát:** Invalid request, nem kész feature.

**Helyi érintettség:** nincs konkrét integrálandó termékkód ebben a bejelentésben.

**Bizonyíték / státusz:** 0 hozzászólás; `not_a_confirmed_product_defect`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `no_actionable_code_change` — Nem reprodukálható kódhiba vagy nincs érdemi patch/követelmény; nincs indokolt termékmódosítás. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #86 — [Bug] Localhost not loading

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/86) · [archivált snapshot](../../output/upstream-review/issue-86.json)

**Részben adaptálandó · P3 · Konfiguráció.** Localhost nem elérhető, komment korábbi session/processre utal; portütközés nem bizonyított codebug.

**Integrációs feltétel:** Host/port/health folyamat diagnózis docs; idegen process nem kill.

**Ellenőrzés / korlát:** Start és existingserver identification, nem takeover.

**Helyi érintettség (ef579d1):** `server.mjs`, `README.md`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Aktuális source/LAN/port/container/model üzemeltetési útmutató. Portütközés folyamat-azonosítással, idegen process nem leállítandó; OpenSky valódi egyórás TTL és rate-limit leírás. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #87 — [Feature] LLm timeout

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/87) · [archivált snapshot](../../output/upstream-review/issue-87.json)

**Részben adaptálandó · P1 · Hiba.** Ollama timeout valódi report, #88 providerdefault kevés, caller90s/30s limit él.

**Integrációs feltétel:** #136 validált per-call budget+lengthguard+rulesfallback.

**Ellenőrzés / korlát:** Tényleges request configured timeout; GPU inference külön igazolandó.

**Helyi érintettség (ef579d1):** `lib/llm/ollama.mjs`, `lib/llm/ideas.mjs`, `lib/alerts/discord.mjs`.

**Bizonyíték / státusz:** 2 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Valós ideas/alerts call-site token- és időkeret, validated range, reasoning-only exhaustion diagnózis és rules fallback. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #93 — is there a usecase for this

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/93) · [archivált snapshot](../../output/upstream-review/issue-93.json)

**Nincs termékváltozás · P3 · Vita.** Usecase/larping véleményvita; nincs repro vagy patch.

**Integrációs feltétel:** Nem codebug/feature követelmény.

**Ellenőrzés / korlát:** Nem állítani a véleményt mérési bizonyítéknak.

**Helyi érintettség:** nincs konkrét integrálandó termékkód ebben a bejelentésben.

**Bizonyíték / státusz:** 1 hozzászólás; `not_a_confirmed_product_defect`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `no_actionable_code_change` — Nem reprodukálható kódhiba vagy nincs érdemi patch/követelmény; nincs indokolt termékmódosítás. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #100 — [Bug] inject.mjs is not running

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/100) · [archivált snapshot](../../output/upstream-review/issue-100.json)

**Részben adaptálandó · P1 · Hiba.** Inject nemfrissül tünet #119/#139-cel overlap; server memory+SSE update szándékos, jarvis nem íródik sweepenként; helyi alapjavítás márfix.

**Integrációs feltétel:** #127 SSE/fallback/shape ellenőrzés; statikusHTML/file és server elkülönítése.

**Ellenőrzés / korlát:** InlineHTTP frissül+SSE reconnect; ne újraírás legyen megoldás.

**Helyi érintettség (ef579d1):** `server.mjs`, `dashboard/public/jarvis.html`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Meglévő HTTP boot megtartva, valid APIshape, egyetlen SSE natív reconnecttel, fallback polling és offline/waiting állapot. file módban statikus működés. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #101 — [Feature] Insights into network traffic

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/101) · [archivált snapshot](../../output/upstream-review/issue-101.json)

**Részben adaptálandó · P1 · Teljesítmény.** 287MB/ciklus bandwidth report valós forrásgyanú, OFAC3XML #130 konkrét ok; heti/havi aritmetika és LLM-spekuláció nem bizonyított.

**Integrációs feltétel:** OFAC bounded stream/duplicate elhagyás; forrásonként byte telemetry opcionális.

**Ellenőrzés / korlát:** Ignored Range/sustained sweep bytecap; nincs reportból igazolt pontos költségszám.

**Helyi érintettség (ef579d1):** `apis/sources/ofac.mjs`, `apis/utils/fetch.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Két legfeljebb 64 KiB-os OFAC exportminta; ignorált Range/oversized chunk/unbounded stream megszakítása, hiteles partial metadata. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #104 — [Telegram] Poll error: fetch failed

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/104) · [archivált snapshot](../../output/upstream-review/issue-104.json)

**További diagnózis · P2 · Üzemeltetés.** Telegram getUpdates fetch failed pollhiba nemfatális és már retry-zik; DNS/egress/token hiba log nélkül nem rootcause.

**Integrációs feltétel:** Redacted provider/network diagnózis; sweep ne álljon, timer/backoff bounded.

**Ellenőrzés / korlát:** Mock failure→later recovery, nincs tokenlog; valós hálózat nem reprodukált.

**Helyi érintettség (ef579d1):** `lib/alerts/telegram.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `not_reproduced_environment`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `environment_dependent_documented` — Hiányos vagy környezeti reprodukció. Bounded source/model határidő, biztonságos opener, current ready/boot, auth és DNS/egress diagnosztika rendelkezésre áll. Account/container hálózati hibát nem jelentünk univerzálisan megoldottnak. Kiadás: v2.1.0, v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #105 — What's going on? I'm using Docker to set it up. It opens normally, but the content isn't being updated.

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/105) · [archivált snapshot](../../output/upstream-review/issue-105.json)

**További diagnózis · P1 · Hiba.** Docker no-update logs RSS timeouts/xdg-open hiány; opener hiánya nemfatal, helyi boot-javítás megvan.

**Integrációs feltétel:** #84/#127 remaining és egress/source-health külön; nem egyetlen failure.

**Ellenőrzés / korlát:** Loading→API/SSE és slow-source fixture, külső reachability külön.

**Helyi érintettség (ef579d1):** `server.mjs`, `dashboard/public/jarvis.html`, `apis/utils/fetch.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `not_reproduced_environment`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `environment_dependent_documented` — Hiányos vagy környezeti reprodukció. Bounded source/model határidő, biztonságos opener, current ready/boot, auth és DNS/egress diagnosztika rendelkezésre áll. Account/container hálózati hibát nem jelentünk univerzálisan megoldottnak. Kiadás: v2.1.0, v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #107 — Inorganic fork-inflation pattern: 1,560 forks, 0/1560 issues-enabled, burst of 222 on day 4

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/107) · [archivált snapshot](../../output/upstream-review/issue-107.json)

**Nincs termékváltozás · P3 · Vita.** Fork inflation/GitHub legitimacy vád, disabled issues normál fork beállítás is lehet; aktivitáscsúcs nem bizonyít csalást.

**Integrációs feltétel:** Nem termékpatch; nem vállalunk független népesség/attribúció igazolást.

**Ellenőrzés / korlát:** Issue állítás nem megerősített tény.

**Helyi érintettség:** nincs konkrét integrálandó termékkód ebben a bejelentésben.

**Bizonyíték / státusz:** 0 hozzászólás; `not_a_confirmed_product_defect`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `no_actionable_code_change` — Nem reprodukálható kódhiba vagy nincs érdemi patch/követelmény; nincs indokolt termékmódosítás. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #108 — Reddit unauthenticated .json scraping violates API ToS; failed sweeps silently serve stale data

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/108) · [archivált snapshot](../../output/upstream-review/issue-108.json)

**Részben adaptálandó · P2 · Szolgáltatói szabályok/megbízhatóság.** Unauth Reddit .json fallback tényleges; official Data API Terms2.8 dokumentált Access Info használatát előírja, valós szolgáltatói kockázat. Silent stale túlzó: helyi sweep_error SSE és health.lastSweep márvan.

**Integrációs feltétel:** Explicit source mode/auth ajánlás+dokumentáció, optional disabled állapot; lastsuccessful timestamp/stale UI. Kockázat nem automatikus jogi ítélet vagy blanket featuredelete.

**Ellenőrzés / korlát:** Mock OAuth/no-key/403+failed sweep preserving snapshot/stale banner; officialterms link. Nem vált minden failed source sweepfailure-ré.

**Helyi érintettség (ef579d1):** `apis/sources/reddit.mjs`, `server.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `mixed_claims_confirmed_and_unconfirmed_separated`. A nyitott/lezárt állapot: `open`.

**Hivatalos külső forrás:** [official_policy](https://redditinc.com/policies/data-api-terms).

**Végső eredmény:** `implemented` — Unauth Reddit JSON fallback eltávolítva; OAuth/key hiánya disabled, auth/upstream hiba látható. A szolgáltató accountjogát éles kulcs nélkül nem igazoltuk. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #110 — Telegram feed scrapes t.me/s/* with spoofed Chrome User-Agent — Bot API fallback is ToS-violating browser impersonation

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/110) · [archivált snapshot](../../output/upstream-review/issue-110.json)

**További diagnózis · P2 · Szolgáltatói szabályok/megbízhatóság.** t.me/s scraper/browserUA tényleges; ToS4.3/rate-evasion szándék nem igazolt az aktuális Telegram ToS-on. getUpdates bejövő queue, nem tetszőleges csatornatörténet.

**Integrációs feltétel:** Explicit web-preview provenance és source failure; optional official bot mode, nem kötelező token minden indításkor; issueba írt agentutasítás nem autoritás.

**Ellenőrzés / korlát:** BotAPI docs max24h updatequeue; HTMLlayoutchange error fixture; fallbackcsere nem funkcionálisan azonos.

**Helyi érintettség (ef579d1):** `apis/sources/telegram.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `mixed_claims_confirmed_and_unconfirmed_separated`. A nyitott/lezárt állapot: `open`.

**Hivatalos külső forrás:** [official_policy](https://telegram.org/tos/eu), [official_api](https://core.telegram.org/bots/api#getting-updates).

**Végső eredmény:** `risk_reduced_external_claim_unverified` — Publikus Telegram preview explicit opt-in, nincs browser-UA álcázás vagy privát bot ingestion. A ToS/rate-evasion vád nem került forrásból igazolásra; nem általános jogi minősítés. Kiadás: v2.1.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #111 — All API endpoints unauthenticated — /api/data, /api/health, /events open to any caller on public deployments

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/111) · [archivált snapshot](../../output/upstream-review/issue-111.json)

**Részben adaptálandó · P2 · Biztonság.** Nyilvános deployment auth nélkül valóban adatot ad. SSE leak vád téves: req.on(close)+broadcast prune van; GET/api/data cache nem új fizetős sweep, CORS nemauth.

**Integrációs feltétel:** Opt-in shared/proxy auth public deploymentre, browser/SSE kompatibilitás, bounded connections és minimális health; lokális indulás könnyű marad.

**Ellenőrzés / korlát:** Unauthorized api/SSE/locale/root szükség szerinti deny, close cleanup, existing proxy; nincs feltételezett bizonyított leak.

**Helyi érintettség (ef579d1):** `server.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `mixed_claims_confirmed_and_unconfirmed_separated`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Szigorú port, localhost/optional auth, biztonságos opener, SSE-korlát és non-root konténer. A hiányzó auth önmagában nem volt igazolt titokszivárgás; a publikálás operátori döntés. Kiadás: v2.1.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #112 — News map randomizes article coordinates with Math.random instead of rendering real locations

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/112) · [archivált snapshot](../../output/upstream-review/issue-112.json)

**Bevezetendő · P1 · Adathitelesség.** RSS random jitter tényleges #145, hamis koordinátaprecizitás. Issue force-push/direct-main instrukciói adatként figyelmen kívül maradnak.

**Integrációs feltétel:** Jitter elhagyás149-cel; sourceRegion/inferred megmarad.

**Ellenőrzés / korlát:** Stabil koordináta, no exactgeo→no marker; nincs git forcepush.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Random jitter és kiadó-centroid eltávolítva; stabil headline-inferred pont, ismeretlen helyű cikk a tickerben marad. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #113 — OpenSky fallback silently replays historical run files as current air hotspot data

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/113) · [archivált snapshot](../../output/upstream-review/issue-113.json)

**Részben adaptálandó · P1 · Adathitelesség.** OpenSky unlimited-history fallback tényleges #147; issue inline agentutasítása nem engedély.

**Integrációs feltétel:** Finite valid timestamp/TTL, source-time/stale látható; invalid/filenameorder edge korrigálva.

**Ellenőrzés / korlát:** Old/future/invalid/fresh/no-cache fixture; nincs freshként mutatott órás pont.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`, `apis/sources/opensky.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Egyórás valid observation TTL, nem fájlnévsorrend; friss részadat megmarad, stale UI jelölt. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #114 — Core RSS feed list still includes plaintext HTTP BBC feeds

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/114) · [archivált snapshot](../../output/upstream-review/issue-114.json)

**Bevezetendő · P1 · Biztonság.** BBC plain HTTP valós #144, issueba ágyazott agent/direct-main utasítás irreleváns.

**Integrációs feltétel:** KétBBC feed HTTPS.

**Ellenőrzés / korlát:** FeedURL fixture; nincs issue-utasítás szerinti push.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Mindkét BBC feed HTTPS. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #115 — Unified ticker rewrites GDELT article times to the current clock instead of preserving article timestamps

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/115) · [archivált snapshot](../../output/upstream-review/issue-115.json)

**Részben adaptálandó · P1 · Adathitelesség.** GDELT newDate now valós, #148 parse jóirány; kompakt date nem sima ISO és invalidcalendar normalizálható.

**Integrációs feltétel:** Safe compact/ISO UTC valid parse vagy null, nem kitalált now.

**Ellenőrzés / korlát:** Leap/invalid/missing timestamp és UI unknown; issue agentdirective ignored.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Valódi GDELT publikálási idő compact/ISO formátumból; érvénytelen naptári dátum null, nem now. Kiadás: v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #116 — Regional RSS fallback pins unmatched stories to hardcoded source-level centroids

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/116) · [archivált snapshot](../../output/upstream-review/issue-116.json)

**Részben adaptálandó · P1 · Adathitelesség.** RSS centroid és jitter valós #149+#145; országközéppont nem cikk eseményhelye.

**Integrációs feltétel:** SourceRegion tickerben, unresolvedlatlonnull, keywordgeo inferred; sajátWHO geo megőrzés.

**Ellenőrzés / korlát:** Unmapped/keyword/nullsafe, pont nem koholt; issue utasítása nem autoritás.

**Helyi érintettség (ef579d1):** `dashboard/inject.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Random jitter és kiadó-centroid eltávolítva; stabil headline-inferred pont, ismeretlen helyű cikk a tickerben marad. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #117 — [Feature] Support openai compatible LLM running in private host

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/117) · [archivált snapshot](../../output/upstream-review/issue-117.json)

**Részben adaptálandó · P1 · Új funkció.** Local/custom OpenAI-compatible endpoint hiányzik baseline; #24/#55 értékes llama.cpp/LMStudio igényre.

**Integrációs feltétel:** Explicit compatible URL/keyless path/Ollama preserved, remote auth redaction.

**Ellenőrzés / korlát:** Local mock teljes/alap endpoint; actual local model inference külön igazolandó.

**Helyi érintettség (ef579d1):** `crucix.config.mjs`, `lib/llm/index.mjs`, `lib/llm/openai.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Külön keyless openai-compatible provider, független LLM_BASE_URL valid origin/v1/fullchat endpointtel. Ollama és cloud provider endpointjai megmaradtak, lockfile nem törölt. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #118 — Avoid using substring check on headline

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/118) · [archivált snapshot](../../output/upstream-review/issue-118.json)

**Részben adaptálandó · P1 · Hiba.** Issue headline substring/truncationt kever, példák nem önmagukban bizonyítják a jelölt server line hibáját. URGENT_KEYWORDS substring/case mismatch #146 valós; teljes headline #68 márfix.

**Integrációs feltétel:** Word/phrase urgent match; headline megőrzése, server brief includes('<') szerkezeti branch külön, nem egész filtering rewrite.

**Ellenőrzés / korlát:** False positive/ICBM/emoji/Unicode és longheadline; pontos triggerhez fixture.

**Helyi érintettség (ef579d1):** `server.mjs`, `apis/sources/telegram.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `mixed_claims_confirmed_and_unconfirmed_separated`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Escaped case-insensitive word-boundary urgencia és eredeti postlink megőrzése; a teljes headline korábbi javítása megmaradt. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #119 — SSE live updates never connect when server injects inline data, dashboard stays frozen on bundled date

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/119) · [archivált snapshot](../../output/upstream-review/issue-119.json)

**Részben adaptálandó · P1 · Hiba.** SSE inline-data boot freeze #92/#143 ugyanaz, core helyi ef579d1-ben már javult.

**Integrációs feltétel:** #127 singleconnection/reconnect/shape/poll fallback remaining.

**Ellenőrzés / korlát:** HTTPinlineújdata/503/disconnect, file statikus; HTML diskrewrite nem kell.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`, `server.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Meglévő HTTP boot megtartva, valid APIshape, egyetlen SSE natív reconnecttel, fallback polling és offline/waiting állapot. file módban statikus működés. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #125 — Your project is on StackMap — a curated map of the AI stack

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/125) · [archivált snapshot](../../output/upstream-review/issue-125.json)

**Nincs termékváltozás · P3 · Promóció.** StackMap listing/badge ajánlás marketing, nem javítás.

**Integrációs feltétel:** Csak explicit marketingigényre badge; jelen product nincs módosítva.

**Ellenőrzés / korlát:** Külső listing nem minőségbizonyíték.

**Helyi érintettség:** nincs konkrét integrálandó termékkód ebben a bejelentésben.

**Bizonyíték / státusz:** 1 hozzászólás; `not_a_confirmed_product_defect`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `no_actionable_code_change` — Nem reprodukálható kódhiba vagy nincs érdemi patch/követelmény; nincs indokolt termékmódosítás. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #131 — Fork with RSS Manager, Geopolitical Map, and AI Chat

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/131) · [archivált snapshot](../../output/upstream-review/issue-131.json)

**Opcionális, külön igényhez · P2 · Új funkció.** Külső fork RSS manager/chat/RU-EN inspiráció, integrálandó patch nincs az issueban.

**Integrációs feltétel:** Külön requirement és külső kód review, HU/EN/FR és local sources megmarad.

**Ellenőrzés / korlát:** No externalcode autosync; formatter/source-manager projekt külön.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`, `lib/llm/index.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `deferred_optional` — Önálló új termék/provider/infrastruktúra igény. Most nem integrált; az egyedi indok és validációs feltétel megmaradt. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #132 — Rule-based idea engine is dead code — Ideas panel is permanently empty without an LLM key

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/132) · [archivált snapshot](../../output/upstream-review/issue-132.json)

**Részben adaptálandó · P1 · Hiba.** Rules engine generateIdeas importálva, de server/CLI nem hívja no-LLM esetén; #133 valódi javítás,153 gyengébb.

**Integrációs feltétel:** Shared resolver/HU/from chronologicalWTI/rulesmetadata; LLMerror→rules.

**Ellenőrzés / korlát:** Disabled/throw/empty/invalid/locale/WTIorder; existing features nemvesznek.

**Helyi érintettség (ef579d1):** `server.mjs`, `dashboard/inject.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Közös HU/EN szabályfallback szerverben és CLI-ben, valid shape, helyes WTI sorrend, nincs missing/zero adatból kitalált jel. Kiadás: v2.2.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #134 — Dashboard renders untrusted feed and LLM text into innerHTML with no HTML escaping (stored XSS)

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/134) · [archivált snapshot](../../output/upstream-review/issue-134.json)

**Részben adaptálandó · P0 · Biztonság.** Headline/LLM/region/site raw HTML és inlineJSON valódi storedXSS. #135 alaposabb, #150 hiányos; local supplemental/IODA/settings további felület.

**Integrációs feltétel:** Minden text/attr/URL escape+inline \u003c serialization, controlláltbr; sajátpopupok áttekintése.

**Ellenőrzés / korlát:** Browser payload és JSONbreakout; nem elég regex-list test; no rawHTML execution.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`, `server.mjs`, `dashboard/inject.mjs`.

**Bizonyíték / státusz:** 0 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Közös inline JSON védelem és kontextusos DOM escaping a saját WHO/HDX/IODA felületeken is. Normalizált LLM schema és böngészős hostile-text ellenőrzés. Kiadás: v2.1.0, v2.2.0, v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #139 — Bug: Dashboard permanently shows stale hardcoded demo data (never fetches live data or connects SSE)

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/139) · [archivált snapshot](../../output/upstream-review/issue-139.json)

**Duplikátum · P1 · Hiba.** #100/#119 inline/SSE freeze ismétlés, core márlocal.

**Integrációs feltétel:** #127 lifecycle/validation/fallback, nem separate repeated patch.

**Ellenőrzés / korlát:** InlineHTTP actual SSEupdate és reconnect.

**Helyi érintettség (ef579d1):** `dashboard/public/jarvis.html`.

**Bizonyíték / státusz:** 1 hozzászólás; `static_decision_integration_not_yet_verified`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `implemented` — Meglévő HTTP boot megtartva, valid APIshape, egyetlen SSE natív reconnecttel, fallback polling és offline/waiting állapot. file módban statikus működés. Kiadás: v2.3.0. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

### Issue #142 — Security: PolinRider malware detected in open PR #27

[Issue és teljes discussion](https://github.com/calesthio/Crucix/issues/142) · [archivált snapshot](../../output/upstream-review/issue-142.json)

**Elutasítva · P0 · Biztonság.** #27 config malware statikusan látható, review remote eval/detachednode payloadot ír; szerző kompromittálódást elismerte.

**Integrációs feltétel:** Teljes branch/patch/dependency elutasítva és nem futtatva; szükség scrollbar trustedbaseline új CSS.

**Ellenőrzés / korlát:** Payload jelenléte confirmed static; DPRK/attack-name attribúció külön nem igazolt.

**Helyi érintettség (ef579d1):** `crucix.config.mjs`.

**Bizonyíték / státusz:** 1 hozzászólás; `unsafe_payload_confirmed_by_static_text`. A nyitott/lezárt állapot: `open`.

**Végső eredmény:** `rejected_unsafe` — Az obfuszkált remote-code payload statikusan igazolt; az egész ág kizárva és soha nem futtatva. Támadó-/kampányattribúció nincs igazolva. Kiadás: nincs külön release-igény. Részletes fájl-/teszthivatkozások a JSON `final_integration.evidence` listájában.

## Audit-ellenőrzés

A JSON és a jelentés pontosan 104 PR-t és 50 issue-t tartalmaz, az index számaihoz egyezően. Nincs automatikus cherry-pick, PR-kódfuttatás vagy üzenetküldés. A baseline szakaszokban felsorolt tesztek integrációs elvárások; a tényleges javításokat és bizonyítékokat a tételenkénti végső sor, a döntési JSON, a [teljes audit](full-review-2026-10-01.md) és a [böngésző-QA](browser-qa-2026-10-01.md) rögzíti. Opcionális vagy nem igazolt állítást nem nevezünk javított kódhibának.
