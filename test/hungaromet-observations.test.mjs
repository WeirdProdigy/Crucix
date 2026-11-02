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
