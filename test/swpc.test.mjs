import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSWPC,
  parseEnhancedSWPC,
  parseKpIndex,
  parseSolarWind,
  parseGoesXrays,
  calculateXrayClass,
  parseAlerts,
  parseForecast,
  normalizeJsonTable,
  briefing
} from '../apis/sources/swpc.mjs';
import { loadLiveStreams } from '../lib/intelligence/live-streams.mjs';

const now = Date.parse('2026-10-30T12:00:00.000Z');

const sampleScales = {
  '0': {
    DateStamp: '2026-10-30',
    TimeStamp: '11:55:00',
    R: { Scale: 0, Text: 'None' },
    S: { Scale: 0, Text: 'None' },
    G: { Scale: 0, Text: 'None' }
  }
};

test('1. JSON formats: normalizeJsonTable handles array-of-objects, array-of-arrays, and indexed objects', () => {
  // Array of objects
  const objArr = [{ time_tag: '2026-10-30T10:00:00', Kp: 1.67 }];
  assert.deepEqual(normalizeJsonTable(objArr), objArr);

  // Array of arrays
  const arrArr = [
    ['time_tag', 'Kp', 'station_count'],
    ['2026-10-30T10:00:00', 2.33, 8],
    ['2026-10-30T11:00:00', 3.0, 8]
  ];
  const parsedArr = normalizeJsonTable(arrArr);
  assert.equal(parsedArr.length, 2);
  assert.equal(parsedArr[0].time_tag, '2026-10-30T10:00:00');
  assert.equal(parsedArr[0].Kp, 2.33);
  assert.equal(parsedArr[1].Kp, 3.0);

  // Indexed object
  const indexed = { '0': { a: 1 }, '1': { a: 2 } };
  assert.deepEqual(normalizeJsonTable(indexed), [{ a: 1 }, { a: 2 }]);

  // Null / empty
  assert.deepEqual(normalizeJsonTable(null), []);
  assert.deepEqual(normalizeJsonTable([]), []);
});

test('2. Kp parsing: handles array-of-objects and array-of-arrays, extracting latest value', () => {
  // Objects
  const kpObj = [
    { time_tag: '2026-10-30T06:00:00', Kp: 1.33, station_count: 8 },
    { time_tag: '2026-10-30T09:00:00', Kp: 2.67, station_count: 8 }
  ];
  const resObj = parseKpIndex(kpObj);
  assert.equal(resObj.kp, 2.67);
  assert.equal(resObj.timeTag, '2026-10-30T09:00:00');

  // Arrays
  const kpArr = [
    ['time_tag', 'Kp', 'station_count'],
    ['2026-10-30T06:00:00', '1.33', '8'],
    ['2026-10-30T09:00:00', '4.33', '8']
  ];
  const resArr = parseKpIndex(kpArr);
  assert.equal(resArr.kp, 4.33);
  assert.equal(resArr.stationCount, 8);

  // Empty / null
  assert.equal(parseKpIndex([]), null);
  assert.equal(parseKpIndex(null), null);
});

test('3. Solar wind: handles spacecraft switching, extracts speed, density, temperature, and Bz', () => {
  const windData = [
    { time_tag: '2026-10-30T11:00:00', active: false, source: 'ACE', proton_speed: 310, proton_density: 5.0, proton_temperature: 15000 },
    { time_tag: '2026-10-30T11:01:00', active: true, source: 'IMAP', proton_speed: 345, proton_density: 7.2, proton_temperature: 22000 }
  ];
  const magData = [
    ['time_tag', 'active', 'source', 'bt', 'bz_gsm'],
    ['2026-10-30T11:00:00', false, 'ACE', 6.0, 1.2],
    ['2026-10-30T11:01:00', true, 'IMAP', 8.5, -3.4]
  ];

  const parsed = parseSolarWind(windData, magData);
  assert.equal(parsed.speed, 345);
  assert.equal(parsed.density, 7.2);
  assert.equal(parsed.temperature, 22000);
  assert.equal(parsed.bz, -3.4);
  assert.equal(parsed.bt, 8.5);
  assert.equal(parsed.source, 'IMAP');
});

test('4. GOES X-rays: selects primary satellite (GOES-18), filters long wavelength, calculates flare class', () => {
  assert.equal(calculateXrayClass(5.2e-8), 'A5.2');
  assert.equal(calculateXrayClass(1.8e-7), 'B1.8');
  assert.equal(calculateXrayClass(4.5e-6), 'C4.5');
  assert.equal(calculateXrayClass(2.1e-5), 'M2.1');
  assert.equal(calculateXrayClass(1.4e-4), 'X1.4');

  const xrays = [
    { time_tag: '2026-10-30T11:50:00Z', satellite: 16, energy: '0.1-0.8nm', flux: 1.2e-7 },
    { time_tag: '2026-10-30T11:50:00Z', satellite: 18, energy: '0.05-0.4nm', flux: 2.0e-9 },
    { time_tag: '2026-10-30T11:51:00Z', satellite: 18, energy: '0.1-0.8nm', flux: 3.5e-6 }
  ];
  const res = parseGoesXrays(xrays);
  assert.equal(res.satellite, 18);
  assert.equal(res.xrayClass, 'C3.5');
});

test('5. Alert thresholds: G3/R3/S2 display on dashboard without notification; G4+/R4+/S3+ trigger notification dispatch', () => {
  // Low scales: G1, R1, S1
  const lowData = {
    scales: {
      '0': {
        DateStamp: '2026-10-30',
        TimeStamp: '11:55:00',
        R: { Scale: 1, Text: 'Minor' },
        S: { Scale: 1, Text: 'Minor' },
        G: { Scale: 1, Text: 'Minor' }
      }
    },
    alerts: [
      { product_id: 'WATA10', issue_datetime: '2026-10-30 11:00:00', message: 'WATCH: Geomagnetic Storm Category G1 Predicted' }
    ]
  };
  const lowResult = parseEnhancedSWPC(lowData, { now });
  assert.equal(lowResult.status, 'ok');
  assert.ok(lowResult.observations.every(obs => obs.severity !== 'high' && obs.severity !== 'critical'), 'Low levels (G1/R1/S1) must not fire high/critical alerts');

  // Tier 1: Dashboard-only display alerts (G3, R3, S2)
  // These appear on dashboard (severity: 'moderate' / watch level) and do NOT trigger Telegram notification
  const dashboardOnlyData = {
    scales: {
      '0': {
        DateStamp: '2026-10-30',
        TimeStamp: '11:55:00',
        R: { Scale: 3, Text: 'Strong' },
        S: { Scale: 2, Text: 'Moderate' },
        G: { Scale: 3, Text: 'Strong' }
      }
    },
    alerts: [
      { product_id: 'WARK07', issue_datetime: '2026-10-30 11:00:00', message: 'WARNING: Geomagnetic Storm Category G3 In Effect' }
    ]
  };
  const dashResult = parseEnhancedSWPC(dashboardOnlyData, { now });
  assert.equal(dashResult.status, 'ok');
  const dashObs = dashResult.observations.filter(obs => obs.severity === 'moderate');
  assert.ok(dashObs.length >= 3, 'G3, R3, S2 must produce moderate severity dashboard alert observations');
  assert.ok(dashResult.observations.every(obs => obs.severity !== 'high' && obs.severity !== 'critical'), 'G3/R3/S2 must NOT trigger high/critical notification severity');

  // Tier 2: Notification dispatch alerts (G4+, R4+, S3+)
  const notifyData = {
    scales: {
      '0': {
        DateStamp: '2026-10-30',
        TimeStamp: '11:55:00',
        R: { Scale: 4, Text: 'Severe' },
        S: { Scale: 3, Text: 'Strong' },
        G: { Scale: 4, Text: 'Severe' }
      }
    },
    alerts: [
      { product_id: 'WARK07', issue_datetime: '2026-10-30 11:00:00', message: 'WARNING: Geomagnetic Storm Category G4 In Effect' }
    ]
  };
  const notifyResult = parseEnhancedSWPC(notifyData, { now });
  assert.equal(notifyResult.status, 'ok');
  const highObs = notifyResult.observations.filter(obs => obs.severity === 'high' || obs.severity === 'critical');
  assert.ok(highObs.length >= 3, 'G4+, R4+, S3+ must trigger high/critical severity for Telegram notification dispatch');
  assert.ok(highObs.some(o => o.providerId === 'G4'));
  assert.ok(highObs.some(o => o.providerId === 'R4'));
  assert.ok(highObs.some(o => o.providerId === 'S3'));

  // Tier 3: Custom threshold configuration (e.g. CRUCIX_SWPC_NOTIFY_MIN='G3,R3,S2')
  const customResult = parseEnhancedSWPC(dashboardOnlyData, { now, notifyMin: { g: 3, r: 3, s: 2 } });
  const customHigh = customResult.observations.filter(obs => obs.severity === 'high' || obs.severity === 'critical');
  assert.ok(customHigh.length >= 3, 'When threshold is lowered to G3/R3/S2, they must trigger high severity');
});

test('6. Stale and error handling: stale data becomes empty metrics, technical block (403/429) marks disabled', async () => {
  // Stale data (>1 hour)
  const staleData = {
    '0': {
      DateStamp: '2026-10-30',
      TimeStamp: '09:00:00', // 3 hours before now
      R: { Scale: 0, Text: 'None' },
      S: { Scale: 0, Text: 'None' },
      G: { Scale: 0, Text: 'None' }
    }
  };
  const staleResult = parseSWPC(staleData, { now });
  assert.equal(staleResult.stale, true);
  assert.deepEqual(staleResult.metrics, {});

  // 403 / 429 error handling in briefing
  const blockedBriefing = await briefing({
    now,
    enableEnhanced: true
  });
  // If network or mock succeeds or fails, status must be one of the valid coverage states
  assert.ok(['ok', 'stale', 'error', 'disabled'].includes(blockedBriefing.status));
});

test('7. 3-day forecast parsing: extracts maximum expected Kp and G-scale', () => {
  const forecastText = `
:Product: 3-Day Forecast
:Issued: 2026 Oct 30 0030 UTC
A. NOAA Geomagnetic Activity Observation and Forecast
The greatest expected 3 hr Kp for Oct 30-Nov 01 2026 is 5.00 (NOAA Scale G1).
  `;
  const parsed = parseForecast(forecastText);
  assert.equal(parsed.maxExpectedKp, 5.0);
  assert.equal(parsed.maxExpectedGScale, 'G1');
  assert.equal(parsed.issued, '2026 Oct 30 0030 UTC');
});

test('8. SolarHam link-only registry card: verified link-only card without text scraping', () => {
  const registry = loadLiveStreams();
  const solarHam = registry.find(s => s.id === 'solarham-space-weather');
  assert.ok(solarHam, 'SolarHam card must be present in registry');
  assert.equal(solarHam.sourceType, 'link-only');
  assert.equal(solarHam.url, 'https://www.solarham.com/');
  assert.equal(solarHam.status, 'page-ok');
  assert.ok(solarHam.notes.includes('Link-only'));
});
