# HungaroMet Synoptic 10-Minute Fixture (`hungaromet-synop-fixture.csv`)

## Eredet és hitelesítés
- **Forrás:** HungaroMet Nonprofit Zrt. Open Data Portal (ODP)
- **Hivatalos végpont:** `https://odp.met.hu/weather/weather_reports/synoptic/hungary/10_minutes/csv/HABP_10M_SYNOP_LATEST.csv.zip`
- **Mérés időpontja (UTC):** 2026-11-02 13:00 UTC (14:00 Europe/Budapest helyi idő)
- **Letöltés időpontja:** 2026-11-02 13:12:45 GMT
- **Struktúra:** A valódi, éles szinoptikus CSV pontos fejléce és a 4 figyelt hajdú-bihari mérőállomás változatlan adatsorai:
  - `65305`: Berettyóújfalu (elsődleges állomás)
  - `64711`: Debrecen repülőtér
  - `64310`: Debrecen Kismacs
  - `64713`: Derecske Petőfi major
- **Cél:** Offline, determinisztikus tesztelés külső hálózati hívások nélkül.
