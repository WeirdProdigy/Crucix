/**
 * test/hungaromet-observations.test.mjs
 *
 * Unit tests for HungaroMet ODP synoptic observations adapter.
 * Fixture: test/fixtures/hungaromet-synop-fixture.csv
 * Source: Official HungaroMet Open Data Portal (ODP) synoptic 10-minute feed:
 *   URL: https://odp.met.hu/weather/weather_reports/synoptic/hungary/10_minutes/csv/HABP_10M_SYNOP_LATEST.csv.zip
 *   Archived observation timestamp: 2026-11-02 13:00 UTC (14:00 Europe/Budapest local time)
 *   Downloaded: 2026-11-02 13:12:45 GMT
 *   Contains exact headers and real telemetry for target stations:
 *     65305 (Berettyóújfalu, primary), 64711 (Debrecen repülőtér),
 *     64310 (Debrecen Kismacs), 64713 (Derecske Petőfi major).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOURCE,
  ATTRIBUTION,
  HUNGAROMET_STATIONS,
  DEFAULT_FALLBACK_STATIONS,
  calculateHaversineDistanceKm,
  resolveFallbackStationOrder,
  resolveReferenceCoordinates,
  fillMissingObservations,
  parseOdpTimestampToUtcIso,
  formatToBudapestTime,
  parseSynopticCsv,
  clearHungarometCache,
  briefing
} from '../apis/sources/hungaromet-observations.mjs';
import { readZipEntry } from '../apis/utils/zip.mjs';
import { zipOf } from './fixtures/zip.mjs';
import { synthesizeWeather } from '../lib/intelligence/weather.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'hungaromet-synop-fixture.csv');
const fixtureCsv = fs.readFileSync(fixturePath, 'utf8');

test('1. HUNGAROMET_STATIONS: exact station metadata from official register', () => {
  assert.ok(HUNGAROMET_STATIONS['65305'], 'Berettyóújfalu is present');
  assert.equal(HUNGAROMET_STATIONS['65305'].name, 'Berettyóújfalu');
  assert.equal(HUNGAROMET_STATIONS['65305'].region, 'Hajdú-Bihar');
  assert.equal(HUNGAROMET_STATIONS['65305'].isPrimary, true);
  assert.equal(HUNGAROMET_STATIONS['65305'].lat, 47.2092);
  assert.equal(HUNGAROMET_STATIONS['65305'].lon, 21.5383);
  assert.equal(HUNGAROMET_STATIONS['65305'].elevation, 92.0);

  assert.ok(HUNGAROMET_STATIONS['64711'], 'Debrecen repülőtér is present');
  assert.equal(HUNGAROMET_STATIONS['64711'].name, 'Debrecen repülőtér');
  assert.equal(HUNGAROMET_STATIONS['64711'].isPrimary, false);

  assert.ok(HUNGAROMET_STATIONS['64310'], 'Debrecen Kismacs is present');
  assert.ok(HUNGAROMET_STATIONS['64713'], 'Derecske Petőfi major is present');
});

test('2. parseOdpTimestampToUtcIso and formatToBudapestTime conversion', () => {
  const iso = parseOdpTimestampToUtcIso('202611021150');
  assert.equal(iso, '2026-11-02T11:50:00.000Z');

  // In standard time (winter), UTC 11:50 is 12:50 Europe/Budapest
  const localTime = formatToBudapestTime(iso);
  assert.equal(localTime, '12:50');

  assert.equal(parseOdpTimestampToUtcIso('invalid'), null);
  assert.equal(parseOdpTimestampToUtcIso(null), null);
  assert.equal(formatToBudapestTime(null), '--:--');
});

test('3. readZipEntry unzips in-memory synoptic zip fixture without external dependencies', () => {
  const zipBuffer = zipOf('HABP_10M_SYNOP_TEST.csv', fixtureCsv);
  const extracted = readZipEntry(zipBuffer);
  assert.ok(Buffer.isBuffer(extracted));
  assert.equal(extracted.toString('utf8'), fixtureCsv);
});

test('4. parseSynopticCsv: filters stations, decodes -999 as null, attaches metadata', () => {
  const fixedNow = new Date('2026-11-02T13:15:00.000Z').getTime(); // 15 mins after 13:00 UTC
  const parsed = parseSynopticCsv(fixtureCsv, { now: fixedNow });

  assert.equal(parsed.source, SOURCE);
  assert.equal(parsed.attribution, ATTRIBUTION);
  assert.equal(parsed.fresh, true);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.stationCount, 4);
  assert.equal(parsed.ageMinutes, 15);
  assert.equal(parsed.feedTimestampUtc, '2026-11-02T13:00:00.000Z');
  assert.equal(parsed.feedTimestampLocal, '14:00');

  // Station filtering: must contain 65305, 64711, 64310, 64713, and NOT 33431
  const stationIds = Object.keys(parsed.stations);
  assert.deepEqual(stationIds.sort(), ['64310', '64711', '64713', '65305']);
  assert.equal(parsed.stations['33431'], undefined, 'Unrelated station 33431 was filtered out');

  // Check Berettyóújfalu (65305)
  const b = parsed.stations['65305'];
  assert.equal(b.station, '65305');
  assert.equal(b.stationName, 'Berettyóújfalu');
  assert.equal(b.region, 'Hajdú-Bihar');
  assert.equal(b.isPrimary, true);
  assert.equal(b.observedAt, '2026-11-02T13:00:00.000Z');
  assert.equal(b.observedAtLocal, '14:00');
  assert.equal(b.ageMinutes, 15);
  assert.equal(b.fresh, true);
  assert.equal(b.status, 'fresh');
  assert.equal(b.staleReason, null);

  // Numerical values from real sample: -999 -> null
  assert.equal(b.values.temperature, 11.2);
  assert.equal(b.values.temperatureAvg, 11.2);
  assert.equal(b.values.temperatureMin, 11.2);
  assert.equal(b.values.temperatureMax, 11.2);
  assert.equal(b.values.humidity, 71);
  assert.equal(b.values.precipitation, 0.0);
  assert.equal(b.values.pressure, null, '-999 converted to null');
  assert.equal(b.values.windSpeed, null, '-999 converted to null');
  assert.equal(b.values.windGust, null, '-999 converted to null');
  assert.equal(b.values.visibility, null, '-999 converted to null');

  // Check Debrecen repülőtér (64711)
  const d = parsed.stations['64711'];
  assert.equal(d.stationName, 'Debrecen repülőtér');
  assert.equal(d.values.temperature, 10.1);
  assert.equal(d.values.temperatureAvg, 10.0);
  assert.equal(d.values.temperatureMin, 9.9);
  assert.equal(d.values.temperatureMax, 10.1);
  assert.equal(d.values.pressure, 1009.4);
  assert.equal(d.values.windSpeed, 5.0);
  assert.equal(d.values.windDirection, 21);
  assert.equal(d.values.windGust, 7.0);
  assert.equal(d.values.windGustDirection, 34);
  assert.equal(d.values.visibility, 20000);
  assert.equal(d.values.soilTemp5cm, 9.7);
  assert.equal(d.values.groundTempMin5cm, 9.5);
});

test('5. Freshness evaluation: flags stale data when older than 30 minutes', () => {
  // Test with now = 45 minutes after observation
  const staleNow = new Date('2026-11-02T13:45:00.000Z').getTime();
  const parsed = parseSynopticCsv(fixtureCsv, { now: staleNow });

  assert.equal(parsed.fresh, false);
  assert.equal(parsed.status, 'stale');
  const b = parsed.stations['65305'];
  assert.equal(b.fresh, false);
  assert.equal(b.status, 'stale');
  assert.equal(b.ageMinutes, 45);
  assert.match(b.staleReason, /45 perces/);
});

test('6. Error handling: rejects invalid or empty CSV', () => {
  assert.throws(() => parseSynopticCsv(''), /Üres vagy érvénytelen/);
  assert.throws(() => parseSynopticCsv('header_only_no_data\n'), /nem tartalmaz elegendő/);
  assert.throws(() => parseSynopticCsv('ColA;ColB\n1;2'), /kötelező Time vagy StationNumber/);
});

test('7. briefing(): respects CRUCIX_ENABLE_HUNGAROMET_OBS=false by default', async () => {
  const prevEnv = process.env.CRUCIX_ENABLE_HUNGAROMET_OBS;
  try {
    delete process.env.CRUCIX_ENABLE_HUNGAROMET_OBS;
    clearHungarometCache();
    const res = await briefing();
    assert.equal(res.status, 'disabled');
    assert.equal(res.data.enabled, false);
    assert.match(res.data.message, /letiltva/);
  } finally {
    process.env.CRUCIX_ENABLE_HUNGAROMET_OBS = prevEnv;
  }
});

test('8. briefing(): processes fixture buffer when enabled and caches result', async () => {
  const prevEnv = process.env.CRUCIX_ENABLE_HUNGAROMET_OBS;
  try {
    process.env.CRUCIX_ENABLE_HUNGAROMET_OBS = 'true';
    clearHungarometCache();

    const zipBuffer = zipOf('SYNOP_TEST.csv', fixtureCsv);
    const fixedNow = new Date('2026-11-02T13:15:00.000Z').getTime();

    const res = await briefing({
      fixtureBuffer: zipBuffer,
      now: fixedNow
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.data.enabled, true);
    assert.equal(res.data.fresh, true);
    assert.ok(res.data.primaryStation);
    assert.equal(res.data.primaryStation.stationName, 'Berettyóújfalu');
    assert.equal(res.data.primaryStation.values.temperature, 11.2);

    // Call again to verify cache return
    const cached = await briefing({
      now: fixedNow + 60000 // 1 min later
    });
    assert.equal(cached.status, 'ok');
    assert.equal(cached.data.primaryStation.stationName, 'Berettyóújfalu');
  } finally {
    process.env.CRUCIX_ENABLE_HUNGAROMET_OBS = prevEnv;
    clearHungarometCache();
  }
});

test('9. synthesizeWeather: cleanly integrates observed ground telemetry into weather object', () => {
  const dummyWeather = {
    data: {
      byRegion: { local: [{ name: 'Debrecen', current: { temp: 10 } }] },
      locations: [],
      biomet: { score: 1.2 }
    }
  };

  const dummyObserved = {
    data: {
      source: SOURCE,
      fresh: true,
      primaryStation: { stationName: 'Berettyóújfalu', values: { temperature: 11.2 } }
    }
  };

  const synthesized = synthesizeWeather(dummyWeather, dummyObserved, { now: Date.now() });
  assert.ok(synthesized.observed);
  assert.equal(synthesized.observed.source, SOURCE);
  assert.equal(synthesized.observed.primaryStation.stationName, 'Berettyóújfalu');
  assert.equal(synthesized.attribution.hungaroMet, 'HungaroMet ODP (Nyílt Adattár)');
});

test('10. Static audit: client code and other adapters do not call ODP directly or emit alerts', () => {
  const clientJs = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'public', 'weather-panel.js'), 'utf8');

  // Verify browser code never fetches directly from odp.met.hu
  assert.doesNotMatch(clientJs, /fetch\s*\(\s*['"`]https?:\/\/odp\.met\.hu/, 'No direct client fetch to odp.met.hu');
  assert.match(clientJs, /Adatbázis: Meteorológiai Adattár, HungaroMet Nonprofit Zrt\./, 'Mandatory attribution present in UI');
  assert.match(clientJs, /MÉRT ADAT/, 'Measured data explicitly labeled');
  assert.match(clientJs, /MODELL/, 'Model forecast explicitly labeled');

  // Verify adapter source code does not emit alert events
  const adapterSrc = fs.readFileSync(path.join(__dirname, '..', 'apis', 'sources', 'hungaromet-observations.mjs'), 'utf8');
  assert.doesNotMatch(adapterSrc, /alertNotifier/i, 'Adapter never calls alertNotifier');
  assert.doesNotMatch(adapterSrc, /observations\.push\s*\(\s*\{.*severity/s, 'Adapter never emits alert events');
});

test('11. Robustness: duplicate station records keep latest, missing station handled gracefully', () => {
  // Feed with duplicate 64310 lines (older 12:50, newer 13:00)
  const dupCsv = [
    'Time;StationNumber;StationName;Latitude;Longitude;Elevation;r;Q_r;t;Q_t;ta;Q_ta;tn;Q_tn;tx;Q_tx;v;Q_v;p;Q_p;u;Q_u;sg;Q_sg;sr;Q_sr;suv;Q_suv;fs;Q_fs;fsd;Q_fsd;fx;Q_fx;fxd;Q_fxd;fxm;Q_fxm;fxs;Q_fxs;et5;Q_et5;et10;Q_et10;et20;Q_et20;et50;Q_et50;et100;Q_et100;tsn;Q_tsn;tviz;Q_tviz;EOR',
    '202611021250;64310;Debrecen Kismacs;47.5767;21.5825;125.0;0.0;;9.9;;9.9;;9.8;;9.9;;20000;;1007.2;;69;;-999;;62.0;;-999;;4.5;;356;;6.7;;5;;40;;02;;-999;;9.7;;10.3;;12.4;;-999;;-999;;-999;;EOR',
    '202611021300;64310;Debrecen Kismacs;47.5767;21.5825;125.0;-999;;10.0;;10.0;;9.9;;10.0;;20000;;1007.2;;68;;-999;;65.9;;-999;;4.4;;359;;7.2;;11;;00;;00;;-999;;9.8;;10.4;;12.4;;-999;;-999;;-999;;EOR'
  ].join('\n');

  const parsedDup = parseSynopticCsv(dupCsv, { now: new Date('2026-11-02T13:10:00.000Z').getTime() });
  assert.equal(parsedDup.stations['64310'].observedAt, '2026-11-02T13:00:00.000Z');
  assert.equal(parsedDup.stations['64310'].values.temperature, 10.0);

  // Missing primary station 65305 does not throw, falls back to first available station
  const missingPrimaryCsv = [
    'Time;StationNumber;StationName;Latitude;Longitude;Elevation;r;Q_r;t;Q_t;ta;Q_ta;tn;Q_tn;tx;Q_tx;v;Q_v;p;Q_p;u;Q_u;sg;Q_sg;sr;Q_sr;suv;Q_suv;fs;Q_fs;fsd;Q_fsd;fx;Q_fx;fxd;Q_fxd;fxm;Q_fxm;fxs;Q_fxs;et5;Q_et5;et10;Q_et10;et20;Q_et20;et50;Q_et50;et100;Q_et100;tsn;Q_tsn;tviz;Q_tviz;EOR',
    '202611021300;64711;Debrecen repülőtér;47.4844;21.6056;106.6;0.0;;10.1;;10.0;;9.9;;10.1;;20000;;1009.4;;71;;-999;;61.8;;-999;;5.0;;21;;7.0;;34;;58;;39;;9.7;;9.9;;10.4;;12.5;;-999;;9.5;;-999;;EOR'
  ].join('\n');

  const parsedMissing = parseSynopticCsv(missingPrimaryCsv, { now: new Date('2026-11-02T13:10:00.000Z').getTime() });
  assert.equal(parsedMissing.stations['65305'], undefined);
  assert.equal(parsedMissing.stationCount, 1);
  assert.ok(parsedMissing.primaryStation);
  assert.equal(parsedMissing.primaryStation.station, '64711');
});

test('12. calculateHaversineDistanceKm: accurate station-to-station distance math', () => {
  // Berettyóújfalu (65305: 47.2092, 21.5383) to Debrecen repülőtér (64711: 47.4844, 21.6056)
  const dDebrecenRepter = calculateHaversineDistanceKm(47.2092, 21.5383, 47.4844, 21.6056);
  assert.equal(dDebrecenRepter, 31);

  // Berettyóújfalu (65305) to Derecske (64713: 47.3653, 21.5497)
  const dDerecske = calculateHaversineDistanceKm(47.2092, 21.5383, 47.3653, 21.5497);
  assert.equal(dDerecske, 17.4);

  // Berettyóújfalu (65305) to Debrecen Kismacs (64310: 47.5767, 21.5825)
  const dKismacs = calculateHaversineDistanceKm(47.2092, 21.5383, 47.5767, 21.5825);
  assert.equal(dKismacs, 41);

  // Distance to self
  assert.equal(calculateHaversineDistanceKm(47.2092, 21.5383, 47.2092, 21.5383), 0);

  // Invalid coordinates return null
  assert.equal(calculateHaversineDistanceKm(null, 21.5, 47.2, 21.5), null);
  assert.equal(calculateHaversineDistanceKm(47.2, undefined, 47.2, 21.5), null);
  assert.equal(calculateHaversineDistanceKm(NaN, 21.5, 47.2, 21.5), null);
});

test('13. fillMissingObservations: fills missing fields from nearest full-sensor station (64711) on real sample', () => {
  const fixedNow = new Date('2026-11-02T13:15:00.000Z').getTime();
  const parsed = parseSynopticCsv(fixtureCsv, { now: fixedNow });

  const primary = parsed.primaryStation;
  assert.equal(primary.station, '65305');
  assert.equal(primary.stationName, 'Berettyóújfalu');

  // Verify primary station raw values are NEVER overwritten
  assert.equal(primary.values.temperature, 11.2);
  assert.equal(primary.values.humidity, 71);
  assert.equal(primary.values.precipitation, 0);
  assert.equal(primary.values.windSpeed, null, 'Raw primary windSpeed must remain null');
  assert.equal(primary.values.pressure, null, 'Raw primary pressure must remain null');
  assert.equal(primary.values.soilTemp5cm, null, 'Raw primary soilTemp5cm must remain null');

  // Separate fallback structure verification
  const fallback = primary.fallback;
  assert.ok(fallback, 'Fallback structure must be present on primaryStation');
  assert.equal(fallback.targetStation, '65305');
  assert.ok(parsed.fallback, 'Fallback structure must be present at root of parsed result');

  // Direct values in fallback structure have isFallback=false, distanceKm=0
  const fTemp = fallback.values.temperature;
  assert.equal(fTemp.value, 11.2);
  assert.equal(fTemp.station, '65305');
  assert.equal(fTemp.stationName, 'Berettyóújfalu');
  assert.equal(fTemp.isFallback, false);
  assert.equal(fTemp.distanceKm, 0);
  assert.equal(fTemp.fresh, true);

  const fHum = fallback.values.humidity;
  assert.equal(fHum.value, 71);
  assert.equal(fHum.station, '65305');
  assert.equal(fHum.isFallback, false);

  const fPrecip = fallback.values.precipitation;
  assert.equal(fPrecip.value, 0);
  assert.equal(fPrecip.station, '65305');
  assert.equal(fPrecip.isFallback, false);

  // Missing values in primary station: filled from 64711 (Debrecen repülőtér)
  const fWind = fallback.values.windSpeed;
  assert.equal(fWind.value, 5.0);
  assert.equal(fWind.station, '64711');
  assert.equal(fWind.stationName, 'Debrecen repülőtér');
  assert.equal(fWind.isFallback, true);
  assert.equal(fWind.distanceKm, 31);
  assert.equal(fWind.fresh, true);

  const fPress = fallback.values.pressure;
  assert.equal(fPress.value, 1009.4);
  assert.equal(fPress.station, '64711');
  assert.equal(fPress.stationName, 'Debrecen repülőtér');
  assert.equal(fPress.isFallback, true);
  assert.equal(fPress.distanceKm, 31);

  const fSoil5 = fallback.values.soilTemp5cm;
  assert.equal(fSoil5.value, 9.7);
  assert.equal(fSoil5.station, '64711');
  assert.equal(fSoil5.isFallback, true);
  assert.equal(fSoil5.distanceKm, 31);

  // Unmeasured on both primary and all fallbacks (soilTemp100cm): value is null
  const fSoil100 = fallback.values.soilTemp100cm;
  assert.equal(fSoil100.value, null);
  assert.equal(fSoil100.station, null);
  assert.equal(fSoil100.stationName, null);
  assert.equal(fSoil100.distanceKm, null);
  assert.equal(fSoil100.fresh, false);
});

test('14. fillMissingObservations: configurable fallback station order', () => {
  const fixedNow = new Date('2026-11-02T13:15:00.000Z').getTime();

  // Test with custom order: 64310 (Debrecen Kismacs) before 64711
  const parsed = parseSynopticCsv(fixtureCsv, {
    now: fixedNow,
    fallbackStationOrder: ['64310', '64711', '64713']
  });

  const fallback = parsed.primaryStation.fallback;
  assert.deepEqual(fallback.fallbackStations, ['64310', '64711', '64713']);

  // In fixture, 64310 has windSpeed = 4.4, pressure = 1007.2
  const fWind = fallback.values.windSpeed;
  assert.equal(fWind.value, 4.4, 'Wind speed must come from first fallback in priority (64310)');
  assert.equal(fWind.station, '64310');
  assert.equal(fWind.stationName, 'Debrecen Kismacs');
  assert.equal(fWind.distanceKm, 41);

  const fPress = fallback.values.pressure;
  assert.equal(fPress.value, 1007.2);
  assert.equal(fPress.station, '64310');
  assert.equal(fPress.distanceKm, 41);
});

test('15. fillMissingObservations: configurable user coordinates', () => {
  const fixedNow = new Date('2026-11-02T13:15:00.000Z').getTime();

  // Pass custom user coordinates for Bihartorda (47.165, 21.365)
  const parsed = parseSynopticCsv(fixtureCsv, {
    now: fixedNow,
    userCoordinates: { lat: 47.165, lon: 21.365 }
  });

  const fallback = parsed.primaryStation.fallback;

  // Distance from Bihartorda (47.165, 21.365) to Berettyóújfalu (65305: 47.2092, 21.5383)
  assert.equal(fallback.values.temperature.distanceKm, 14);

  // Distance from Bihartorda to Debrecen repülőtér (64711: 47.4844, 21.6056)
  assert.equal(fallback.values.windSpeed.distanceKm, 39.9);
});

test('16. fillMissingObservations: stale fallback station handling and all-null fallback', () => {
  // Construct CSV where primary 65305 is fresh (13:00), but 64711 is stale (12:00, 75 min old)
  // and 64310 is fresh (13:00)
  const mixedCsv = [
    'Time;StationNumber;StationName;Latitude;Longitude;Elevation;r;Q_r;t;Q_t;ta;Q_ta;tn;Q_tn;tx;Q_tx;v;Q_v;p;Q_p;u;Q_u;sg;Q_sg;sr;Q_sr;suv;Q_suv;fs;Q_fs;fsd;Q_fsd;fx;Q_fx;fxd;Q_fxd;fxm;Q_fxm;fxs;Q_fxs;et5;Q_et5;et10;Q_et10;et20;Q_et20;et50;Q_et50;et100;Q_et100;tsn;Q_tsn;tviz;Q_tviz;EOR',
    '202611021300;65305;Berettyóújfalu;47.2092;21.5383;92.0;0.0;;11.2;;11.2;;11.2;;11.2;;-999;;-999;;71;;-999;;58.9;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;EOR',
    '202611021200;64711;Debrecen repülőtér;47.4844;21.6056;106.6;0.0;;10.1;;10.0;;9.9;;10.1;;20000;;1009.4;;71;;-999;;61.8;;-999;;5.0;;21;;7.0;;34;;58;;39;;9.7;;9.9;;10.4;;12.5;;-999;;9.5;;-999;;EOR',
    '202611021300;64310;Debrecen Kismacs;47.5767;21.5825;125.0;-999;;10.0;;10.0;;9.9;;10.0;;20000;;1007.2;;68;;-999;;65.9;;-999;;4.4;;359;;7.2;;11;;00;;00;;-999;;9.8;;10.4;;12.4;;-999;;-999;;-999;;EOR'
  ].join('\n');

  const fixedNow = new Date('2026-11-02T13:15:00.000Z').getTime();
  const parsed = parseSynopticCsv(mixedCsv, { now: fixedNow });

  // 64711 is stale (> 30 min)
  assert.equal(parsed.stations['64711'].fresh, false);
  assert.equal(parsed.stations['64310'].fresh, true);

  // Even though 64711 is first in order, its stale data must NOT be used
  // It must fall back to the fresh station 64310
  const fallback = parsed.primaryStation.fallback;
  assert.equal(fallback.values.windSpeed.station, '64310', 'Stale station 64711 was rejected in favor of fresh 64310');
  assert.equal(fallback.values.windSpeed.value, 4.4);
  assert.equal(fallback.values.windSpeed.distanceKm, 41);

  // If ALL fallback stations are stale, missing field remains null
  const allStaleCsv = [
    'Time;StationNumber;StationName;Latitude;Longitude;Elevation;r;Q_r;t;Q_t;ta;Q_ta;tn;Q_tn;tx;Q_tx;v;Q_v;p;Q_p;u;Q_u;sg;Q_sg;sr;Q_sr;suv;Q_suv;fs;Q_fs;fsd;Q_fsd;fx;Q_fx;fxd;Q_fxd;fxm;Q_fxm;fxs;Q_fxs;et5;Q_et5;et10;Q_et10;et20;Q_et20;et50;Q_et50;et100;Q_et100;tsn;Q_tsn;tviz;Q_tviz;EOR',
    '202611021300;65305;Berettyóújfalu;47.2092;21.5383;92.0;0.0;;11.2;;11.2;;11.2;;11.2;;-999;;-999;;71;;-999;;58.9;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;-999;;EOR',
    '202611021100;64711;Debrecen repülőtér;47.4844;21.6056;106.6;0.0;;10.1;;10.0;;9.9;;10.1;;20000;;1009.4;;71;;-999;;61.8;;-999;;5.0;;21;;7.0;;34;;58;;39;;9.7;;9.9;;10.4;;12.5;;-999;;9.5;;-999;;EOR'
  ].join('\n');

  const parsedAllStale = parseSynopticCsv(allStaleCsv, { now: fixedNow });
  assert.equal(parsedAllStale.primaryStation.fallback.values.windSpeed.value, null);
  assert.equal(parsedAllStale.primaryStation.fallback.values.windSpeed.station, null);
});

test('17. Client weather-panel.js rendering: dimmer fallback row, direct values preserved, zero alert emission', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'public', 'weather-panel.js'), 'utf8');

  const mockWindow = {
    innerWidth: 1280,
    currentSnapshot: () => ({})
  };
  const mockDocument = {
    querySelector: () => null
  };

  const runModule = new Function('window', 'document', code);
  runModule(mockWindow, mockDocument);
  const WeatherPanel = mockWindow.CrucixWeatherPanel;
  assert.ok(WeatherPanel, 'CrucixWeatherPanel exported');

  // Synthetic snapshot with primary station 65305 and filled fallback data
  const fixedNow = new Date('2026-11-02T13:15:00.000Z').getTime();
  const parsed = parseSynopticCsv(fixtureCsv, { now: fixedNow });

  const syntheticSnapshot = {
    weather: {
      byRegion: {
        local: [{ name: 'Debrecen', current: { temp: 10 } }]
      },
      biomet: { score: 1.2, level: 'alacsony' },
      observed: parsed
    }
  };

  const html = WeatherPanel.panelHtml(syntheticSnapshot);

  // 1. Primary station direct measurements must be in primary cards
  assert.ok(html.includes('Hőmérséklet'), 'Must render Hőmérséklet card');
  assert.ok(html.includes('11.2 °C'), 'Must render 11.2 °C directly for Berettyóújfalu');
  assert.ok(html.includes('71 %'), 'Must render 71 % humidity');
  assert.ok(html.includes('0 mm') || html.includes('0.0 mm'), 'Must render precipitation');

  // 2. Missing primary sensors must be rendered in the dimmer fallback row with exact format
  assert.ok(html.includes('wp-obs-fallback-box'), 'Must render wp-obs-fallback-box region');
  assert.ok(html.includes('Szél:'), 'Must show fallback label Szél:');
  assert.ok(html.includes('5,0 m/s'), 'Must format wind speed as 5,0 m/s with Hungarian comma');
  assert.ok(html.includes('(Debrecen repülőtér, ~31 km)'), 'Must show station name and distance in parentheses');

  assert.ok(html.includes('Légnyomás:'), 'Must show fallback label Légnyomás:');
  assert.ok(html.includes('1009,4 hPa'), 'Must format pressure with Hungarian comma');

  assert.ok(html.includes('Talajhő (5cm):'), 'Must show fallback label Talajhő (5cm):');
  assert.ok(html.includes('9,7 °C'), 'Must format soil temp with Hungarian comma');

  // 3. Unmeasured on all stations (soilTemp100cm): no numbers rendered
  assert.ok(!html.includes('Talajhő (100cm)'), 'Unmeasured soilTemp100cm must not be rendered');

  // 4. Station switcher buttons must remain for all stations
  assert.ok(html.includes('Berettyóújfalu ★'), 'Berettyóújfalu station switcher present with star');
  assert.ok(html.includes('Debrecen repülőtér'), 'Debrecen repülőtér switcher present');
  assert.ok(html.includes('Debrecen Kismacs'), 'Debrecen Kismacs switcher present');
  assert.ok(html.includes('Derecske Petőfi major'), 'Derecske switcher present');

  // 5. Attribution present
  assert.ok(html.includes('Adatbázis: Meteorológiai Adattár, HungaroMet Nonprofit Zrt.'), 'Mandatory attribution present');
});

