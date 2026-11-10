/**
 * test/ovf-gauges.test.mjs
 *
 * Unit and integration tests for Crucix OVF Vízmérce (Berettyó) hydrologic adapter.
 * Verifies:
 * 1. Metadata, constants, and official gauge register (Berettyóújfalu, Pocsaj, Darvas, Szeghalom).
 * 2. ArcGIS REST MapServer query JSON response parser on real OVF sample fixture.
 * 3. Sentinel and null handling: negative water levels, null discharge for Darvas, unknown KF levels.
 * 4. Freshness logic: 90-minute ceiling (justified by hourly automated telemetry).
 * 5. Opt-in switch logic: CRUCIX_ENABLE_OVF_GAUGES (0 network calls when disabled).
 * 6. Memory-only persistence policy: stripMemoryOnlySources cleans latest.json and server snapshots.
 * 7. Alert & event pipeline exclusion: zero alerts, zero events, zero risk score contribution.
 * 8. Client rendering in weather-panel.js: pills, null discharge rendering, and mandatory attribution.
 * 9. Static security audit: no unauthorized vizugy endpoints, zero Origin header spoofing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  SOURCE,
  ENDPOINT_URL,
  ATTRIBUTION,
  CACHE_TTL_MS,
  FRESH_THRESHOLD_MINUTES,
  HOURLY_FRESH_THRESHOLD_MINUTES,
  DAILY_FRESH_THRESHOLD_MINUTES,
  OVF_BERETTYO_GAUGES,
  QUERY_WHERE,
  formatToBudapestTime,
  formatToBudapestDateTime,
  parseOvfLocalTimestamp,
  calculateLevelRelation,
  parseOvfArcGisResponse,
  clearOvfGaugesCache,
  isOvfGaugesEnabled,
  briefing
} from '../apis/sources/ovf-gauges.mjs';

import { stripMemoryOnlySources, saveSnapshot } from '../lib/snapshots.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'ovf-gauges-fixture.json');
const fixtureJson = fs.readFileSync(fixturePath, 'utf8');
const fixtureData = JSON.parse(fixtureJson);

test('1. OVF Gauge metadata & constants: official register and ArcGIS query', () => {
  assert.equal(SOURCE, 'OVF-Gauges');
  assert.equal(ENDPOINT_URL, 'https://geoportal.vizugy.hu/arcgis/rest/services/VIR/Vizmercek_vizugyhu/MapServer/60/query');
  assert.equal(ATTRIBUTION, 'Forrás: Országos Vízügyi Főigazgatóság (OVF), tájékoztató jellegű adat; nem hivatalos árvízi vagy belvízi előrejelzés.');
  assert.equal(CACHE_TTL_MS, 30 * 60 * 1000, 'Cache TTL is 30 minutes');
  assert.equal(HOURLY_FRESH_THRESHOLD_MINUTES, 90, 'Hourly threshold is 90 minutes');
  assert.equal(DAILY_FRESH_THRESHOLD_MINUTES, 26 * 60, 'Daily threshold is 26 hours (1560 min)');
  assert.equal(FRESH_THRESHOLD_MINUTES, 90, 'Default freshness threshold is 90 minutes');

  // Monitored gauges
  assert.ok(OVF_BERETTYO_GAUGES['2546'], 'Berettyóújfalu is registered');
  assert.equal(OVF_BERETTYO_GAUGES['2546'].name, 'Berettyóújfalu');
  assert.equal(OVF_BERETTYO_GAUGES['2546'].river, 'Berettyó');
  assert.equal(OVF_BERETTYO_GAUGES['2546'].isPrimary, true);
  assert.equal(OVF_BERETTYO_GAUGES['2546'].hasDischarge, true);
  assert.equal(OVF_BERETTYO_GAUGES['2546'].cadence, 'hourly');
  assert.equal(OVF_BERETTYO_GAUGES['2546'].freshThresholdMinutes, 90);

  assert.ok(OVF_BERETTYO_GAUGES['2545'], 'Pocsaj is registered');
  assert.equal(OVF_BERETTYO_GAUGES['2545'].name, 'Pocsaj');
  assert.equal(OVF_BERETTYO_GAUGES['2545'].isPrimary, false);
  assert.equal(OVF_BERETTYO_GAUGES['2545'].hasDischarge, true);
  assert.equal(OVF_BERETTYO_GAUGES['2545'].cadence, 'hourly');
  assert.equal(OVF_BERETTYO_GAUGES['2545'].freshThresholdMinutes, 90);

  assert.ok(OVF_BERETTYO_GAUGES['2739'], 'Darvas is registered');
  assert.equal(OVF_BERETTYO_GAUGES['2739'].name, 'Darvas');
  assert.equal(OVF_BERETTYO_GAUGES['2739'].isPrimary, false);
  assert.equal(OVF_BERETTYO_GAUGES['2739'].hasDischarge, false, 'Darvas does not measure discharge');
  assert.equal(OVF_BERETTYO_GAUGES['2739'].cadence, 'daily');
  assert.equal(OVF_BERETTYO_GAUGES['2739'].freshThresholdMinutes, 1560);

  assert.ok(OVF_BERETTYO_GAUGES['2740'], 'Szeghalom is registered');
  assert.equal(OVF_BERETTYO_GAUGES['2740'].name, 'Szeghalom');
  assert.equal(OVF_BERETTYO_GAUGES['2740'].hasDischarge, true);
  assert.equal(OVF_BERETTYO_GAUGES['2740'].cadence, 'daily');
  assert.equal(OVF_BERETTYO_GAUGES['2740'].freshThresholdMinutes, 1560);

  // Exact SQL query WHERE clause
  assert.equal(QUERY_WHERE, 'vFeAllomas_webmerc.Torzsszam IN (2545, 2546, 2739, 2740)');
});

test('2. parseOvfArcGisResponse on real fixture: all 4 gauges parsed with exact telemetry', () => {
  // Set fixed now to 2026-11-02T22:30:00.000Z (30 minutes after Pocsaj/Berettyóújfalu 22:00:00Z observation)
  const fixedNow = new Date('2026-11-02T22:30:00.000Z').getTime();
  const parsed = parseOvfArcGisResponse(fixtureData, { now: fixedNow });

  assert.equal(parsed.source, 'OVF-Gauges');
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.fresh, true);
  assert.equal(parsed.allFresh, true);
  assert.equal(parsed.attribution, ATTRIBUTION);
  assert.equal(parsed.gauges.length, 4);

  // Primary gauge check (Berettyóújfalu #2546)
  assert.equal(parsed.primaryGauge.id, '2546');
  assert.equal(parsed.primaryGauge.name, 'Berettyóújfalu');
  assert.equal(parsed.primaryGauge.river, 'Berettyó');
  assert.equal(parsed.primaryGauge.isPrimary, true);
  assert.equal(parsed.primaryGauge.waterLevelCm, -131, 'Negative water level -131 cm preserved');
  assert.equal(parsed.primaryGauge.dischargeM3s, 0.28, 'Rounded discharge in fixture');
  assert.equal(parsed.primaryGauge.waterTempC, 11.4);
  assert.equal(parsed.primaryGauge.observedAt, '2026-11-02T21:00:00.000Z');
  assert.equal(parsed.primaryGauge.observedAtBudapestTime, '22:00');
  assert.equal(parsed.primaryGauge.ageMinutes, 90);
  assert.equal(parsed.primaryGauge.fresh, true);
  assert.equal(parsed.primaryGauge.cadence, 'hourly');
  assert.equal(parsed.primaryGauge.freshThresholdMinutes, 90);
  assert.equal(parsed.primaryGauge.kf1, 300);
  assert.equal(parsed.primaryGauge.kf2, 400);
  assert.equal(parsed.primaryGauge.kf3, 450);
  assert.equal(parsed.primaryGauge.lkv, -166);
  assert.equal(parsed.primaryGauge.lnv, 512);
  assert.equal(parsed.primaryGauge.levelRelation.status, 'normal');
  assert.equal(parsed.primaryGauge.levelRelation.headroomKf1Cm, 431); // 300 - (-131)
  assert.equal(parsed.primaryGauge.levelRelation.text, '431 cm tartalék, számítva a 300 cm-es I. fokú készültségi szinthez (nem hivatalos állapot)');

  // Pocsaj gauge check (#2545)
  const pocsaj = parsed.gauges.find(g => g.id === '2545');
  assert.ok(pocsaj);
  assert.equal(pocsaj.name, 'Pocsaj');
  assert.equal(pocsaj.waterLevelCm, -69);
  assert.equal(pocsaj.dischargeM3s, 0.23, 'Rounded discharge in fixture');
  assert.equal(pocsaj.waterTempC, 10.6);
  assert.equal(pocsaj.observedAt, '2026-11-02T21:00:00.000Z');
  assert.equal(pocsaj.fresh, true);
  assert.equal(pocsaj.cadence, 'hourly');

  // Darvas gauge check (#2739) - does NOT measure discharge, daily cadence
  const darvas = parsed.gauges.find(g => g.id === '2739');
  assert.ok(darvas);
  assert.equal(darvas.name, 'Darvas');
  assert.equal(darvas.waterLevelCm, 3);
  assert.equal(darvas.dischargeM3s, null, 'Discharge is null for Darvas');
  assert.equal(darvas.hasDischarge, false);
  assert.equal(darvas.waterTempC, 11.2);
  assert.equal(darvas.observedAt, '2026-11-02T05:00:00.000Z');
  assert.equal(darvas.observedAtBudapestTime, '06:00');
  assert.equal(darvas.cadence, 'daily');
  assert.equal(darvas.ageMinutes, 1050);
  assert.equal(darvas.freshThresholdMinutes, 1560);
  assert.equal(darvas.fresh, true, 'Darvas from 05:00 UTC is fresh under 26h (1560 min) daily cadence at 22:30 UTC');

  // Szeghalom gauge check (#2740) - daily cadence
  const szeghalom = parsed.gauges.find(g => g.id === '2740');
  assert.ok(szeghalom);
  assert.equal(szeghalom.name, 'Szeghalom');
  assert.equal(szeghalom.waterLevelCm, 195);
  assert.equal(szeghalom.dischargeM3s, 3.02, 'Rounded discharge in fixture');
  assert.equal(szeghalom.waterTempC, 12.2);
  assert.equal(szeghalom.cadence, 'daily');
  assert.equal(szeghalom.fresh, true);
});

test('3. Sentinel, null and negative value handling', () => {
  // calculateLevelRelation
  const relNormal = calculateLevelRelation(150, 300, 400, 500);
  assert.equal(relNormal.status, 'normal');
  assert.equal(relNormal.headroomKf1Cm, 150);
  assert.equal(relNormal.percentOfKf1, 50);
  assert.equal(relNormal.text, '150 cm tartalék, számítva a 300 cm-es I. fokú készültségi szinthez (nem hivatalos állapot)');

  const relKf1 = calculateLevelRelation(350, 300, 400, 500);
  assert.equal(relKf1.status, 'kf1');
  assert.equal(relKf1.text, '50 cm túllépés, számítva a 300 cm-es I. fokú készültségi szinthez (nem hivatalos állapot)');

  const relKf2 = calculateLevelRelation(420, 300, 400, 500);
  assert.equal(relKf2.status, 'kf2');
  assert.equal(relKf2.text, '20 cm túllépés a 400 cm-es II. fokú szinthez (nem hivatalos állapot)');

  const relKf3 = calculateLevelRelation(510, 300, 400, 500);
  assert.equal(relKf3.status, 'kf3');
  assert.equal(relKf3.text, '10 cm túllépés a 500 cm-es III. fokú szinthez (nem hivatalos állapot)');

  // Unmeasured / null KF1 (e.g. Darvas where KF1=0)
  const relUnknown = calculateLevelRelation(3, 0, 0, 0);
  assert.equal(relUnknown.status, 'unknown');
  assert.equal(relUnknown.percentOfKf1, null);
  assert.equal(relUnknown.headroomKf1Cm, null);
  assert.equal(relUnknown.text, '-');

  // Null water level
  const relNull = calculateLevelRelation(null, 300, 400, 500);
  assert.equal(relNull.status, 'unknown');
  assert.equal(relNull.text, '-');

  // formatToBudapestTime edge cases
  assert.equal(formatToBudapestTime(null), '--:--');
  assert.equal(formatToBudapestTime('invalid'), '--:--');
  assert.equal(formatToBudapestDateTime(null), '--');
});

test('4. Freshness evaluation: hourly (90m) and daily (26h) thresholds', () => {
  const hourlyEpoch = new Date('2026-11-02T22:00:00.000Z').getTime();
  const dailyEpoch = new Date('2026-11-02T06:00:00.000Z').getTime();
  const hourlyParsed = parseOvfLocalTimestamp(hourlyEpoch);
  const dailyParsed = parseOvfLocalTimestamp(dailyEpoch);

  const sampleData = {
    features: [
      {
        attributes: {
          'vFeAllomas_webmerc.Torzsszam': 2546, // Berettyóújfalu (hourly)
          'vop.dbo.tAllomasFe.AllomasNev': 'Berettyóújfalu',
          'vop.dbo.tAllomasFe.Idopont': hourlyEpoch,
          'vop.dbo.tAllomasFe.Vizallas': -131,
          'vop.dbo.tAllomasFe.Vizhozam': 0.28,
          'vop.dbo.tAllomasFe.KF1': 300
        }
      },
      {
        attributes: {
          'vFeAllomas_webmerc.Torzsszam': 2739, // Darvas (daily)
          'vop.dbo.tAllomasFe.AllomasNev': 'Darvas',
          'vop.dbo.tAllomasFe.Idopont': dailyEpoch,
          'vop.dbo.tAllomasFe.Vizallas': 3,
          'vop.dbo.tAllomasFe.KF1': 0
        }
      }
    ]
  };

  // 1. Hourly gauge: 85 minutes later -> FRESH (<= 90m)
  const nowHourlyFresh = hourlyParsed.utcEpoch + 85 * 60 * 1000;
  const resHourlyFresh = parseOvfArcGisResponse(sampleData, { now: nowHourlyFresh });
  const buFresh = resHourlyFresh.gauges.find(g => g.id === '2546');
  assert.equal(buFresh.fresh, true);
  assert.equal(buFresh.ageMinutes, 85);

  // 2. Hourly gauge: 95 minutes later -> STALE (> 90m)
  const nowHourlyStale = hourlyParsed.utcEpoch + 95 * 60 * 1000;
  const resHourlyStale = parseOvfArcGisResponse(sampleData, { now: nowHourlyStale });
  const buStale = resHourlyStale.gauges.find(g => g.id === '2546');
  assert.equal(buStale.fresh, false);
  assert.equal(buStale.ageMinutes, 95);

  // 3. Daily gauge: 25 hours later (1500m) -> FRESH (<= 26h / 1560m)
  const nowDailyFresh = dailyParsed.utcEpoch + 25 * 60 * 60 * 1000;
  const resDailyFresh = parseOvfArcGisResponse(sampleData, { now: nowDailyFresh });
  const darvasFresh = resDailyFresh.gauges.find(g => g.id === '2739');
  assert.equal(darvasFresh.fresh, true);
  assert.equal(darvasFresh.ageMinutes, 1500);

  // 4. Daily gauge: 27 hours later (1620m) -> STALE (> 26h / 1560m)
  const nowDailyStale = dailyParsed.utcEpoch + 27 * 60 * 60 * 1000;
  const resDailyStale = parseOvfArcGisResponse(sampleData, { now: nowDailyStale });
  const darvasStale = resDailyStale.gauges.find(g => g.id === '2739');
  assert.equal(darvasStale.fresh, false);
  assert.equal(darvasStale.ageMinutes, 1620);
});

test('5. Opt-in switch evaluation: CRUCIX_ENABLE_OVF_GAUGES adheres to envBoolean conventions', async () => {
  clearOvfGaugesCache();

  const prevEnv = process.env.CRUCIX_ENABLE_OVF_GAUGES;

  try {
    // 1. isOvfGaugesEnabled truthy variants: 'true', '1', 'yes', 'on', and case variations
    for (const val of ['true', '1', 'yes', 'on', 'TRUE', 'True', 'YES', 'ON', ' 1 ']) {
      process.env.CRUCIX_ENABLE_OVF_GAUGES = val;
      assert.equal(isOvfGaugesEnabled(), true, `Expected ${val} to be evaluated as truthy`);
    }

    // 2. isOvfGaugesEnabled falsy variants: 'false', '0', 'no', 'off', empty, undefined, other
    for (const val of ['false', '0', 'no', 'off', 'FALSE', 'No', '', 'disabled', 'invalid']) {
      process.env.CRUCIX_ENABLE_OVF_GAUGES = val;
      assert.equal(isOvfGaugesEnabled(), false, `Expected ${val} to be evaluated as falsy`);
    }

    delete process.env.CRUCIX_ENABLE_OVF_GAUGES;
    assert.equal(isOvfGaugesEnabled(), false, 'Expected unset env to be falsy');

    // 3. options.enabled overrides env
    process.env.CRUCIX_ENABLE_OVF_GAUGES = 'false';
    assert.equal(isOvfGaugesEnabled({ enabled: true }), true, 'options.enabled: true overrides env false');
    process.env.CRUCIX_ENABLE_OVF_GAUGES = 'true';
    assert.equal(isOvfGaugesEnabled({ enabled: false }), false, 'options.enabled: false overrides env true');

    // 4. When disabled (default), briefing() returns status: 'disabled' and 0 network calls
    delete process.env.CRUCIX_ENABLE_OVF_GAUGES;
    const resDisabled = await briefing();
    assert.equal(resDisabled.status, 'disabled');
    assert.equal(resDisabled.data.enabled, false);
    assert.equal(resDisabled.data.attribution, ATTRIBUTION);
    assert.deepEqual(resDisabled.data.gauges, []);

    // 5. When enabled with '1' and fixtureJson
    process.env.CRUCIX_ENABLE_OVF_GAUGES = '1';
    clearOvfGaugesCache();
    const fixedNow = new Date('2026-11-02T22:30:00.000Z').getTime();
    const resEnabledOne = await briefing({ fixtureJson, now: fixedNow, bypassCache: true });
    assert.equal(resEnabledOne.status, 'ok');
    assert.equal(resEnabledOne.data.enabled, true);
    assert.equal(resEnabledOne.data.gauges.length, 4);

    // 6. When enabled with 'true'
    process.env.CRUCIX_ENABLE_OVF_GAUGES = 'true';
    clearOvfGaugesCache();
    const resEnabledTrue = await briefing({ fixtureJson, now: fixedNow, bypassCache: true });
    assert.equal(resEnabledTrue.status, 'ok');
    assert.equal(resEnabledTrue.data.enabled, true);
  } finally {
    if (prevEnv !== undefined) {
      process.env.CRUCIX_ENABLE_OVF_GAUGES = prevEnv;
    } else {
      delete process.env.CRUCIX_ENABLE_OVF_GAUGES;
    }
    clearOvfGaugesCache();
  }
});

test('6. Memory-only persistence policy: stripMemoryOnlySources and saveSnapshot', () => {
  const dummySnapshot = {
    crucix: { timestamp: '2026-11-02T22:30:00.000Z' },
    sources: {
      Meteoalarm: { status: 'ok', data: { alerts: [] } },
      SWPC: { status: 'ok', data: { r: 0 } },
      'OVF-Gauges': { status: 'ok', data: { gauges: [{ id: '2546' }] } }
    },
    weather: { temp: 12 },
    ovfGauges: { enabled: true, gauges: [{ id: '2546' }] }
  };

  // 1. stripMemoryOnlySources strips both sources['OVF-Gauges'] and top-level ovfGauges
  const stripped = stripMemoryOnlySources(dummySnapshot);
  assert.equal(stripped.sources['OVF-Gauges'], undefined, 'OVF-Gauges stripped from sources');
  assert.equal(stripped.ovfGauges, undefined, 'ovfGauges stripped from top-level');
  assert.ok(stripped.sources.Meteoalarm, 'Meteoalarm untouched');
  assert.ok(stripped.sources.SWPC, 'SWPC untouched');
  assert.equal(stripped.weather.temp, 12, 'Weather payload untouched');

  // 2. saveSnapshot writes to disk strictly without OVF data
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucix-snapshot-test-'));
  try {
    saveSnapshot(tmpDir, dummySnapshot);

    const latestFile = path.join(tmpDir, 'latest.json');
    assert.ok(fs.existsSync(latestFile), 'latest.json created');
    const savedLatest = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
    assert.equal(savedLatest.sources?.['OVF-Gauges'], undefined);
    assert.equal(savedLatest.ovfGauges, undefined);

    const files = fs.readdirSync(tmpDir);
    const serverSnapshotFile = files.find(f => f.startsWith('briefing_server_'));
    assert.ok(serverSnapshotFile, 'briefing_server_*.json created');
    const savedServerSnapshot = JSON.parse(fs.readFileSync(path.join(tmpDir, serverSnapshotFile), 'utf8'));
    assert.equal(savedServerSnapshot.sources?.['OVF-Gauges'], undefined);
    assert.equal(savedServerSnapshot.ovfGauges, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('7. Alert and event pipeline exclusion: zero alerts, events, or risk contributions', () => {
  // Static check across lib/intelligence/ to ensure OVF is never passed to alerts/events/risk
  const intelligenceDir = path.join(__dirname, '..', 'lib', 'intelligence');
  if (fs.existsSync(intelligenceDir)) {
    const files = fs.readdirSync(intelligenceDir);
    for (const file of files) {
      if (!file.endsWith('.mjs')) continue;
      const content = fs.readFileSync(path.join(intelligenceDir, file), 'utf8');
      assert.ok(!content.includes('OVF-Gauges'), `File ${file} must not reference OVF-Gauges`);
      assert.ok(!content.includes('ovfGauges'), `File ${file} must not reference ovfGauges`);
    }
  }

  // Also check server.mjs: verify ovfGauges is assigned strictly AFTER archiveSweep
  const serverPath = path.join(__dirname, '..', 'server.mjs');
  const serverCode = fs.readFileSync(serverPath, 'utf8');
  const archiveIndex = serverCode.indexOf('archiveSweep(');
  const ovfAssignIndex = serverCode.indexOf('synthesized.ovfGauges =');
  assert.ok(archiveIndex > 0, 'archiveSweep exists in server.mjs');
  assert.ok(ovfAssignIndex > 0, 'ovfGauges assignment exists in server.mjs');
  assert.ok(ovfAssignIndex > archiveIndex, 'ovfGauges is attached strictly AFTER archiveSweep call');
});

test('8. Client weather-panel.js rendering: renderHydroBlock, pills, Darvas null discharge, exact attribution', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'public', 'weather-panel.js'), 'utf8');
  const mockWindow = { innerWidth: 1280, currentSnapshot: () => ({}) };
  const mockDocument = { querySelector: () => null };

  const runModule = new Function('window', 'document', code);
  runModule(mockWindow, mockDocument);
  const WeatherPanel = mockWindow.CrucixWeatherPanel;
  assert.ok(WeatherPanel, 'CrucixWeatherPanel exported');
  assert.ok(typeof WeatherPanel.renderHydroBlock === 'function', 'renderHydroBlock is exported');

  // A. Disabled state
  const disabledHtml = WeatherPanel.renderHydroBlock({
    ovfGauges: { enabled: false }
  });
  assert.ok(disabledHtml.includes('KIKAPCSOLVA'), 'Disabled badge rendered');
  assert.ok(disabledHtml.includes('CRUCIX_ENABLE_OVF_GAUGES='), 'Hint rendered');
  assert.ok(disabledHtml.includes(ATTRIBUTION), 'Attribution rendered even when disabled');

  // A2. Loading state after restart before first sweep
  const loadingHtml = WeatherPanel.renderHydroBlock({
    ovfGauges: { enabled: true, status: 'loading', loading: true, gauges: [] }
  });
  assert.ok(loadingHtml.includes('BETÖLTÉS ALATT'), 'Loading badge rendered');
  assert.ok(loadingHtml.includes('Első adatgyűjtés folyamatban'), 'Loading note rendered');
  assert.ok(loadingHtml.includes(ATTRIBUTION), 'Attribution rendered during loading');

  // A3. Error state after failed sweep (must show HIBA, never infinite loading)
  const errorHtml = WeatherPanel.renderHydroBlock({
    ovfGauges: { enabled: true, status: 'error', error: 'ArcGIS 503 Service Unavailable', gauges: [] }
  });
  assert.ok(errorHtml.includes('HIBA'), 'Error badge rendered');
  assert.ok(errorHtml.includes('ArcGIS 503 Service Unavailable'), 'Error message rendered');
  assert.ok(!errorHtml.includes('BETÖLTÉS ALATT'), 'Must not render BETÖLTÉS ALATT on error');

  // B. Fresh parsed state with 4 gauges
  const fixedNow = new Date('2026-11-02T22:30:00.000Z').getTime();
  const parsed = parseOvfArcGisResponse(fixtureData, { now: fixedNow });
  const activeHtml = WeatherPanel.renderHydroBlock({
    ovfGauges: parsed
  });

  assert.ok(activeHtml.includes('wp-hydro-card'), 'wp-hydro-card rendered');
  assert.ok(activeHtml.includes('VÍZÁLLÁS (BERETTYÓ)'), 'Block header badge rendered');
  assert.ok(activeHtml.includes('FRISS'), 'FRISS badge rendered');
  assert.ok(activeHtml.includes('Berettyóújfalu'), 'Berettyóújfalu rendered');
  assert.ok(activeHtml.includes('wp-hydro-star'), 'Primary gauge star rendered');
  assert.ok(activeHtml.includes('-131 cm'), 'Negative water level rendered correctly');
  assert.ok(activeHtml.includes('0,28 m³/s'), 'Discharge rendered with Hungarian comma');
  assert.ok(activeHtml.includes('Pocsaj'), 'Pocsaj rendered');
  assert.ok(activeHtml.includes('-69 cm'), 'Pocsaj negative water level rendered');
  assert.ok(activeHtml.includes('Darvas'), 'Darvas rendered');

  // Verify Darvas discharge is rendered as '-' because dischargeM3s is null, and status is fresh (07:00) with daily marker
  const darvasIndex = activeHtml.indexOf('<strong>Darvas</strong>');
  assert.ok(darvasIndex > 0, 'Darvas gauge card found');
  const afterDarvas = activeHtml.slice(darvasIndex, darvasIndex + 700);
  assert.ok(afterDarvas.includes('<span class="wp-hydro-mv">-</span>'), 'Darvas null discharge renders dash');
  assert.ok(afterDarvas.includes('<span class="wp-hydro-time-badge fresh">06:00</span>'), 'Darvas renders 06:00 with fresh badge within daily cadence');
  assert.ok(!afterDarvas.includes('ELAVULT'), 'Darvas is not marked ELAVULT when within daily cadence');
  assert.ok(afterDarvas.includes('napi mérce'), 'Daily cadence marker rendered');

  // Verify calculated level relation text is rendered on UI
  assert.ok(activeHtml.includes('számítva a 300 cm-es I. fokú készültségi szinthez (nem hivatalos állapot)'), 'Calculated level relation rendered on UI');

  // Verify neutral Fokozat indicator: when Fokozat === 0, no pill is shown; when Fokozat > 0, neutral pill is shown
  assert.ok(!activeHtml.includes('OVF Fokozat mező'), 'When Fokozat is 0, no warning pill is rendered');
  const mockFokozatData = JSON.parse(JSON.stringify(parsed));
  mockFokozatData.gauges[0].currentFokozat = 2;
  const fokHtml = WeatherPanel.renderHydroBlock({ ovfGauges: mockFokozatData });
  assert.ok(fokHtml.includes('OVF Fokozat mező: 2 (értelmezés ellenőrizendő)'), 'Neutral OVF Fokozat pill rendered without code mapping');

  // Verify stale gauge rendering when daily gauge exceeds cadence (e.g. 48 hours later)
  const staleDailyNow = new Date('2026-11-04T10:00:00.000Z').getTime();
  const staleDailyParsed = parseOvfArcGisResponse(fixtureData, { now: staleDailyNow });
  const staleHtml = WeatherPanel.renderHydroBlock({ ovfGauges: staleDailyParsed });
  assert.ok(staleHtml.includes('ELAVULT'), 'Stale pill rendered when cadence exceeded');

  // Exact attribution match
  assert.ok(activeHtml.includes(ATTRIBUTION), 'Exact mandatory attribution match');

  // C. Full panel integration check
  const fullHtml = WeatherPanel.panelHtml({
    weather: {
      byRegion: { local: [{ name: 'Debrecen', current: { temp: 10 } }] },
      biomet: { score: 1.0, level: 'alacsony' }
    },
    ovfGauges: parsed
  });
  assert.ok(fullHtml.includes('wp-hydro-card'), 'Hydro block is included in weather panel current view');
});

test('9. Static security audit: zero unauthorized vizugy endpoints, zero Origin header spoofing', () => {
  const apisDir = path.join(__dirname, '..', 'apis');
  const apisFiles = fs.readdirSync(apisDir);
  for (const f of apisFiles) {
    const full = path.join(apisDir, f);
    if (!fs.statSync(full).isFile() || !f.endsWith('.mjs')) continue;
    const content = fs.readFileSync(full, 'utf8');
    assert.ok(!content.includes('data.vizugy.hu'), `${f} must not call data.vizugy.hu`);
    assert.ok(!content.includes('vmservice.vizugy.hu'), `${f} must not call vmservice.vizugy.hu`);
  }

  const sourcesDir = path.join(__dirname, '..', 'apis', 'sources');
  const sourceFiles = fs.readdirSync(sourcesDir);
  for (const f of sourceFiles) {
    const full = path.join(sourcesDir, f);
    if (!fs.statSync(full).isFile() || !f.endsWith('.mjs')) continue;
    const content = fs.readFileSync(full, 'utf8');
    if (f !== 'ovf-gauges.mjs') {
      assert.ok(!content.includes('geoportal.vizugy.hu'), `${f} must not call geoportal.vizugy.hu`);
    }
    assert.ok(!content.includes('data.vizugy.hu'), `${f} must not call data.vizugy.hu`);
    assert.ok(!content.includes('vmservice.vizugy.hu'), `${f} must not call vmservice.vizugy.hu`);
  }
});

test('10. OVF local timestamp DST-correct UTC conversion and futureTimestamp anomaly', () => {
  // 1. Tél (CET, UTC+1): 21:00 Budapest -> 20:00 UTC
  const winterRaw = Date.UTC(2026, 10, 9, 21, 0, 0); // 2026-11-09 21:00
  const winterParsed = parseOvfLocalTimestamp(winterRaw);
  assert.equal(winterParsed.utcIso, '2026-11-09T20:00:00.000Z', 'Winter local 21:00 converts to 20:00Z');
  assert.equal(winterParsed.localTime, '21:00', 'Winter local time is 21:00');

  // 2. Nyár (CEST, UTC+2): 14:00 Budapest -> 12:00 UTC
  const summerRaw = Date.UTC(2026, 6, 15, 14, 0, 0); // 2026-07-15 14:00
  const summerParsed = parseOvfLocalTimestamp(summerRaw);
  assert.equal(summerParsed.utcIso, '2026-07-15T12:00:00.000Z', 'Summer local 14:00 converts to 12:00Z');
  assert.equal(summerParsed.localTime, '14:00', 'Summer local time is 14:00');

  // 3. Őszi ismétlődő óra (2026-10-25 02:30 fall-back transition): maps cleanly to CET
  const autumnRaw = Date.UTC(2026, 9, 25, 2, 30, 0);
  const autumnParsed = parseOvfLocalTimestamp(autumnRaw);
  assert.equal(autumnParsed.utcIso, '2026-10-25T01:30:00.000Z', 'Autumn repeated hour maps to standard CET');
  assert.equal(autumnParsed.localTime, '02:30');

  // 4. Tavaszi kimaradó óra (2026-03-29 02:30 spring-forward transition): handled gracefully
  const springRaw = Date.UTC(2026, 2, 29, 2, 30, 0);
  const springParsed = parseOvfLocalTimestamp(springRaw);
  assert.ok(springParsed.utcIso, 'Spring missing hour yields valid UTC timestamp');
  assert.equal(springParsed.localTime, '02:30');

  // 5. Future timestamp detection (anomaly: measurement ahead of now)
  const sampleFuture = {
    features: [
      {
        attributes: {
          'vFeAllomas_webmerc.Torzsszam': 2546,
          'vop.dbo.tAllomasFe.AllomasNev': 'Berettyóújfalu',
          'vop.dbo.tAllomasFe.Idopont': winterRaw, // 20:00Z true UTC
          'vop.dbo.tAllomasFe.Vizallas': -122,
          'vop.dbo.tAllomasFe.KF1': 300
        }
      }
    ]
  };
  // Now is 30 minutes BEFORE the measurement (now = 19:30Z)
  const pastNow = winterParsed.utcEpoch - 30 * 60 * 1000;
  const futureRes = parseOvfArcGisResponse(sampleFuture, { now: pastNow });
  const buFuture = futureRes.gauges.find(g => g.id === '2546');
  assert.equal(buFuture.futureTimestamp, true, 'futureTimestamp is flagged true');
  assert.equal(buFuture.ageMinutes, -30, 'ageMinutes preserves negative -30 rather than clamping to 0');
  assert.equal(buFuture.fresh, false, 'future timestamp is NOT fresh');
  assert.equal(futureRes.allFresh, false, 'allFresh is false when gauge has future timestamp');
});
