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
  const fixedNow = new Date('2026-11-02T12:05:00.000Z').getTime(); // 15 mins after 11:50 UTC
  const parsed = parseSynopticCsv(fixtureCsv, { now: fixedNow });

  assert.equal(parsed.source, SOURCE);
  assert.equal(parsed.attribution, ATTRIBUTION);
  assert.equal(parsed.fresh, true);

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
  assert.equal(b.observedAt, '2026-11-02T11:50:00.000Z');
  assert.equal(b.observedAtLocal, '12:50');
  assert.equal(b.ageMinutes, 15);
  assert.equal(b.fresh, true);
  assert.equal(b.status, 'fresh');
  assert.equal(b.staleReason, null);

  // Numerical values: -999 -> null
  assert.equal(b.values.temperature, 11.0);
  assert.equal(b.values.temperatureAvg, 11.1);
  assert.equal(b.values.humidity, 73);
  assert.equal(b.values.precipitation, 0.0);
  assert.equal(b.values.pressure, null, '-999 converted to null');
  assert.equal(b.values.windSpeed, null, '-999 converted to null');
  assert.equal(b.values.windGust, null, '-999 converted to null');
  assert.equal(b.values.visibility, null, '-999 converted to null');

  // Check Debrecen repülőtér (64711)
  const d = parsed.stations['64711'];
  assert.equal(d.stationName, 'Debrecen repülőtér');
  assert.equal(d.values.temperature, 9.5);
  assert.equal(d.values.pressure, 1010.0);
  assert.equal(d.values.windSpeed, 5.7);
  assert.equal(d.values.windDirection, 23);
  assert.equal(d.values.windGust, 7.8);
  assert.equal(d.values.visibility, 20000);
  assert.equal(d.values.soilTemp5cm, 9.7);
  assert.equal(d.values.groundTempMin5cm, 9.3);
});

test('5. Freshness evaluation: flags stale data when older than 30 minutes', () => {
  // Test with now = 45 minutes after observation
  const staleNow = new Date('2026-11-02T12:35:00.000Z').getTime();
  const parsed = parseSynopticCsv(fixtureCsv, { now: staleNow });

  assert.equal(parsed.fresh, false);
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
    const fixedNow = new Date('2026-11-02T12:05:00.000Z').getTime();

    const res = await briefing({
      fixtureBuffer: zipBuffer,
      now: fixedNow
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.data.enabled, true);
    assert.equal(res.data.fresh, true);
    assert.ok(res.data.primaryStation);
    assert.equal(res.data.primaryStation.stationName, 'Berettyóújfalu');
    assert.equal(res.data.primaryStation.values.temperature, 11.0);

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
      primaryStation: { stationName: 'Berettyóújfalu', values: { temperature: 11.0 } }
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
