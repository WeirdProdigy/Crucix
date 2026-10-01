# Ingyenesen beköthető adatforrások — 2026-10-01

> Aktuális döntés: csak naprakész forrás engedélyezett. A kilenc jóváhagyott adapter a v2.7.0 része; **World Bank kizárva** az éves/korábbi adatai miatt. [Megvalósítás és élő adatidejű ellenőrzés](fresh-data-implementation-2026-10-01.md). Az alábbi rész az eredeti jelöltkutatást őrzi.

A Crucix 2.6.0 jelenlegi 31 adapterét az `apis/briefing.mjs` alapján ellenőriztem. Az alábbi forrásokhoz még nincs külön adapter. A rangsor a projektben hozzáadott értékre és a bekötés egyszerűségére vonatkozó fejlesztői javaslat; nem szolgáltatói minőségi benchmark. Hivatalos dokumentációt és kis méretű, hitelesítési kulcs nélküli olvasási próbákat használtam. Éles Crucix sweep, operátori `.env` vagy bot nem futott.

## Elsőként ajánlott, kulcs nélküli források

| Forrás | Mit adna a Crucixhoz? | Ingyenesség / feltétel | Javasolt frissítés és bekötés |
| --- | --- | --- | --- |
| **[Meteoalarm Atom](https://feeds.meteoalarm.org/)** | Magyar és európai hivatalos időjárási figyelmeztetések; a jelenlegi NOAA/NWS adapter US-lefedettségét egészítené ki | Publikus Atom, kulcs nélkül; CC BY 4.0 forrásjelöléssel | 15 perc, kiválasztott országok; weather események, eredeti kibocsátó, érvényesség és érintett terület |
| **[GDACS](https://www.gdacs.org/About/overview.aspx)** | Globális árvíz-, ciklon-, földrengés- és egyéb katasztrófa-események, szolgáltatói hatás-/riasztási szint | Publikusan elérhető RSS, kulcs és fizetés nélkül; a saját felhasználási feltételeket meg kell őrizni | 15–30 perc; új katasztrófa-réteg, stabil event ID, frissített és megszűnt események kezelése |
| **[NOAA SWPC](https://www.spaceweather.gov/content/data-access)** | Geomágneses viharok, napkitörések, rádiózavarok; műhold-/GNSS-/rádió-infrastruktúra kontextus | Publikus NOAA JSON szolgáltatás, kulcs nélkül | 5–15 perc; űridőjárás-panel és események. A jelenlegi Space adapter CelesTrak pályaadatait egészíti ki |
| **[Eurostat](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-introduction)** | Magyar/EU infláció, munkanélküliség, GDP, ipari termelés és energiaadatok; csökkentené az amerikai makroadatok túlsúlyát | Ingyenes REST API; a [reuse feltételek](https://ec.europa.eu/eurostat/about-us/communicating-disseminating-statistics) forrásjelölést és módosításjelölést írnak elő, lehetnek dataset-kivételek | Napi cache; JSON-stat dimenziók/mértékegység/referenciaidőszak explicit feldolgozása. Nem 15 percenként új makroesemény |
| **[ECB Data Portal](https://data.ecb.europa.eu/help/getting-data-web-services-sdmx-0)** | EUR/HUF referenciaárfolyam, európai kamat-/pénzügyi indikátorok, történeti összevetés | Az [ESCB reuse policy](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.de.html) ingyenes hozzáférést/újrafelhasználást enged saját nyilvános statisztikára, forrásjelöléssel; harmadik fél adata kivétel | Napi cache, SDMX-CSV kezdetnek; a referenciaárfolyamot napi adatként, saját dátumával kell jelölni |
| **[NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3)** | Strukturált globális természeti események: vulkánok, viharok, tüzek; ID, kategória, időben változó geometria és eredeti források | Nyilvános, kulcs nélküli API. Az [EONET disclaimer](https://eonet.gsfc.nasa.gov/what-is-eonet) a tér-/időbeli leírást közelítésként kezeli | 30–60 perc, limit/days/status szűrés; GDACS/FIRMS/USGS átfedést kapcsolni, nem független bizonyítékként duplázni |
| **[RIPEstat](https://stat.ripe.net/docs/data-api/ripestat-data-api)** | BGP láthatóság és útvonalváltozás figyelt hálózatok/ASN-ek mentén; IODA kimaradásokhoz hálózati kontextus | Publikus Data API; max. 8 párhuzamos kérés/IP, rendszeres >1000 kérés/nap esetén regisztrációt kérnek; [szolgáltatási feltételek](https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions/) | 15–60 perc, kis watchlist és `sourceapp`; ASN-/országkontextus, nem kitalált pontos hely. A tényleges `query_time` és warning megőrzendő |
| **[FIRST EPSS](https://www.first.org/epss/data)** | A már meglévő CISA-KEV adapter CVE-adatai mellé kihasználási modellbecslés és változás; közös cyber/infrastruktúra panel | Naponta publikált ingyenes adat, regisztráció nélkül; attribúció kért. API kis CVE-batchre, teljes adatállományhoz napi CSV | Napi cache, CVE-ID alapú összekapcsolás. EPSS modellbecslés; alacsony érték nem írhatja felül a KEV-ben dokumentált kihasználást |
| **[MET Norway Locationforecast](https://api.met.no/)** | Globális helyalapú előrejelzés: szél, csapadék, hőmérséklet; figyelt városok/kikötők mellett | CC BY 4.0, kereskedelmi használat is megengedett; a [feltételek](https://api.met.no/doc/TermsOfService) azonosítható User-Agentet és cache-t kérnek | 1–6 óra, rögzített helylista; előrejelzésként és érvényességi idővel. A Crucix általános User-Agentjét itt projekt-/kapcsolatlinkkel kell felülírni |
| **[OONI](https://api.ooni.io/)** | Weboldal-/szolgáltatás-elérési anomáliák és blokkolási mérések ország/ASN szerint; IODA-tól eltérő alkalmazásszintű nézet | Publikus olvasási API; szerény kérésrátát kér, bulkhoz külön adatút. Adatlicenc a szolgáltatás saját linkjén ellenőrzendő | 1–6 óra, figyelt ország/domain/időablak. Az `anomaly`, `confirmed`, `failure` állapotok külön látszanak; [anomália nem feltétlenül cenzúra](https://ooni.org/documents/2021-ooni-partner-training-resources/interpreting-ooni-data.pdf) |
| **[World Bank Indicators](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation)** | Országadatlap: GDP, népesség, gazdasági/szociális háttér; regionális kontextus a kutatásprofilhoz | A próbában kulcs nélküli API; az [alaplicenc](https://data.worldbank.org/summary-terms-of-use) CC BY 4.0, dataset-kivételekkel | Heti cache; többnyire éves/lassú adat, világosan jelölt referenciaévvel |

## Ingyenes hozzáférés, regisztrációval

**OpenAQ v3**: globális állomási PM2.5/PM10/NO2/O3 stb. adatok, új levegőminőség-rétegként. Az [ingyenes keret](https://docs.openaq.org/using-the-api/rate-limits) 60 kérés/perc és 2000/óra; [account és API-kulcs](https://docs.openaq.org/using-the-api/api-key) kell. V3 használandó, a [v1/v2 2025-ben megszűnt](https://docs.openaq.org/about/about). A [feltételek](https://docs.openaq.org/about/terms) OpenAQ- és eredetiforrás-attribúciót, harmadik fél feltételeinek betartását kérik, a hosted API közvetlen versenytársi reprodukálását tiltják. Javaslat: kevés kiválasztott állomás, 30–60 perces cache, eredeti fizikai egységek; AQI csak megnevezett módszertannal. Kulcsos végpontot nem próbáltam.

**ENTSO-E Transparency Platform**: európai villamosenergia-termelés, terhelés, határkeresztező áramlás, kiesések és piaci adatok; infrastruktúra/energia profilhoz különösen hasznos. Az [adat-hozzáférési platform](https://www.entsoe.eu/data/transparency-platform/) és [szabad újrafelhasználási adatkör](https://transparency.entsoe.eu/content/static_content/Static%20content/terms%20and%20conditions/201030_TP%20list%20of%20data.pdf) alapján jó jelölt, de az adatkör/ország kivételeit a kiválasztott termékre ellenőrizni kell. A [2026-os tokenútmutató](https://transparencyplatform.zendesk.com/hc/en-us/articles/12845911031188-How-to-get-security-token) regisztrációt, hozzáférésigénylést és tokent kér. Javaslat: HU + szomszédos országok, 15–60 perc, XML, EIC zónák és piacfüggő időfelbontás. Kulcsos végpontot nem próbáltam.

## Feltételesen ingyenes alternatívák

- **[Open-Meteo](https://open-meteo.com/en/pricing)**: időjárás, levegőminőség-modell, árvíz-/folyóvízhozam-előrejelzés. A hosted free API csak nem kereskedelmi használatra ingyenes; 600/perc, 5000/óra, 10 000/nap, 300 000/hó. A nyílt adatlicenc nem jelent automatikusan ingyenes üzleti API-hozzáférést. Általános, üzleti célra is használható Crucix alapadapternek előbb MET Norway ajánlott.
- **[Global Fishing Watch](https://api-doc.globalfishingwatch.org/our-apis/documentation/)**: hajóazonosság, becsült halászati aktivitás, kikötőlátogatás és AIS-kimaradási események. Ingyenes token kérhető, de az API csak nem kereskedelmi célra érhető el. Az [AIS aktivitás közel valós idejű adata](https://globalfishingwatch.org/faqs/when-should-i-use-an-api/) háromnapos késésű; nem globális élő AIS helyettesítő. A [modellezett aktivitás](https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats) bizonytalansága és a lefedettség jelölendő. Külön opt-in kutatásrétegként hasznos.

## Ellenőrzött mintavégpontok

Olvasási próbák: 2026-10-01, kb. 22:45–22:49 Europe/Budapest. Mindegyik alábbi szolgáltatás legalább egy HTTP 200, parse-olható mintaválaszt adott, API-kulcs nélkül. Ez pillanatnyi elérhetőségi/séma-próba, nem rendelkezésreállási vagy éles adapterteszt.

| Forrás | Minta és eredmény |
| --- | --- |
| Meteoalarm HU | `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-hungary` — érvényes Atom, 0 aktív bejegyzés |
| GDACS | `https://www.gdacs.org/xml/rss.xml` — XML/RSS, 223 bejegyzés |
| EONET | `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=3` — 3 esemény |
| SWPC | `https://services.swpc.noaa.gov/products/noaa-scales.json` — JSON skála-/időállapotok |
| RIPEstat | `https://stat.ripe.net/data/routing-status/data.json?resource=AS5483&sourceapp=Crucix-research` — `status=ok`, routing/visibility; a szolgáltató a lekérdezési időt elérhető adatidejére igazította |
| EPSS | `https://api.first.org/data/v1/epss?cve=CVE-2021-44228` — 1 CVE-adat |
| ECB | `https://data-api.ecb.europa.eu/service/data/EXR/D.HUF.EUR.SP00.A?lastNObservations=3&format=csvdata` — 3 CSV-megfigyelés, utolsó: 2026-10-01; Node 24 alatt is sikeres |
| Eurostat aktuális séma | `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?lang=EN&geo=HU&coicop18=TOTAL&unit=RCH_A&freq=M&lastTimePeriod=3` — 3 HU-megfigyelés: 2026-06/07/08; Node 24 alatt sikeres |
| MET Norway | `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=47.4979&lon=19.0402` — 91 előrejelzési időlépés, azonosító User-Agenttel |
| World Bank | `https://api.worldbank.org/v2/country/HUN/indicator/NY.GDP.MKTP.CD?format=json&mrnev=1` — 1 legutolsó nem üres éves rekord |
| OONI | `https://api.ooni.io/api/v1/measurements?probe_cc=HU&test_name=web_connectivity&since=2026-09-30&until=2026-10-01&limit=3` — 3 mérés, külön anomaly/confirmed/failure mezőkkel |

Két konkrét integrációs csapda is előkerült:

- A Meteoalarm régi **RSS** feedjeit 2026-01-14-én leállították; [Atomot kell használni](https://feeds.meteoalarm.org/), még ha a feed URL-jében a `legacy-atom` szerepel is.
- A korábbi Eurostat `prc_hicp_manr` és `coicop=CP00` példák archivált sorra mutatnak. A [2026-os HICP módszertani váltás](https://ec.europa.eu/eurostat/web/hicp/information-data) után `prc_hicp_minr`, `coicop18=TOTAL` szükséges a fenti aktuális teljes inflációs sorhoz. A hibás `coicop18=CP00` HTTP 200 mellett is 0 megfigyelést adhat. A HTTP-siker önmagában ezért nem elég.

A Python-próba helyi CA-problémába futott az ECB/Eurostat domaineken; natív Windows és a projekt Node 24 runtime-ja változatlan TLS-ellenőrzéssel sikeresen olvasta mindkettőt. Nem kapcsoltam ki tanúsítványellenőrzést. A kezdeti próbák gépi adatai az ignorált `output/free-source-probes-2026-10-01.json` fájlban maradnak; a táblázat a későbbi sikeres próbákat is tartalmazza.

## Bekötési sorrend a meglévő kódhoz

1. **Meteoalarm + GDACS + SWPC**: a legnagyobb új eseménylefedettség kevés hozzáférési súrlódással. Új `apis/sources/*.mjs` adapterek a meglévő `safeFetch` határidő-/méretkorlátjaival; RSS/Atom namespace/CAP adatokhoz valódi XML-feldolgozás szükséges.
2. **Eurostat + ECB**: magyar/európai makropanel, indikátoronként cache és helyes időszak/egység. A napi/havi mutató nem lesz pusztán egy sweep miatt új esemény.
3. **EPSS + RIPEstat + OONI**: figyelt CVE/ASN/domain listák, új cyber/hálózati panel; a meglévő CISA-KEV és IODA adatot együtt kell megjeleníteni. CISA lekérdezés már van, külön CVE-részletezőt még ki kell építeni.
4. **EONET + MET Norway + World Bank**, majd regisztrációval **OpenAQ + ENTSO-E**: kiegészítő természeti réteg, helyalapú előrejelzés, országadatlap, levegőminőség és energia.

Az adapterregisztráció után a `dashboard/inject.mjs`, `lib/intelligence/events.mjs`, delta logika, history/export szűrők és HU/EN/FR felület is bővítendő: új forrás puszta lekérdezése nem teszi automatikusan láthatóvá az adatot. Új eseménytípusoknál a validatorokat és a PWA snapshot mezőlistáját is módosítani kell. A provider idő, gyűjtési idő, érvényesség és helymeghatározási módszer megmarad; globális űridőjárási eseményhez nem találunk ki földi koordinátát. Azonos eredeti adatra építő aggregátorok nem számítanak több független megerősítésnek.

Ez a kör forráskutatás és bekötési javaslat; új adapter vagy alkalmazáskiadás még nem készült.
