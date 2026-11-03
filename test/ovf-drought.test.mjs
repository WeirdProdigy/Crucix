import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOvfDroughtData, parseOvfDroughtResponse } from '../apis/sources/ovf-drought.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ovf-drought-fixture.json', import.meta.url), 'utf8'));
const fixtureNow = 1793664000000;

test('parses OVF drought fixture values and depths', () => {
  const result = parseOvfDroughtResponse(fixture, { now: fixtureNow });
  assert.deepEqual(result.station, {
    id: '22676D52-3F45-48BF-A75C-8024905FD3D4',
    name: 'Mezősas',
    distanceKm: 11.9
  });
  assert.deepEqual(result.soilMoisture, {
    '10cm': 23, '20cm': 24.6, '30cm': 27.6, '45cm': 26.9, '60cm': 28.7, '75cm': 37.3,
    unit: 'V/V %', timestamp: '2026-11-03T00:00:00.000Z', fresh: true
  });
  assert.deepEqual(result.soilTemperature, {
    '10cm': 10.2, '20cm': 10.9, '30cm': 11.5, '45cm': 12.1, '60cm': 12.7, '75cm': 13.5,
    unit: '°C', timestamp: '2026-11-03T00:00:00.000Z', fresh: true
  });
  assert.equal(result.droughtIndex.value, 2.04626);
  assert.deepEqual(result.waterDeficit, {
    '35cm': 51.3, '80cm': 33.13, unit: 'mm', timestamp: '2026-11-03T00:00:00.000Z', fresh: true
  });
  assert.equal(result.precipitation.value, 0);
  assert.equal(result.airTemperature.value, 7.9);
  assert.equal(result.relativeHumidity.value, 76);
  assert.equal(result.isFresh, true);
});

test('applies hourly and daily freshness windows', () => {
  const fresh = parseOvfDroughtResponse(fixture, { now: fixtureNow + 180 * 60 * 1000 });
  const staleHourly = parseOvfDroughtResponse(fixture, { now: fixtureNow + 180 * 60 * 1000 + 1 });
  const freshDaily = parseOvfDroughtResponse(fixture, { now: fixtureNow + 36 * 60 * 60 * 1000 });
  const staleDaily = parseOvfDroughtResponse(fixture, { now: fixtureNow + 36 * 60 * 60 * 1000 + 1 });
  assert.equal(fresh.airTemperature.fresh, true);
  assert.equal(fresh.droughtIndex.fresh, true);
  assert.equal(staleHourly.airTemperature.fresh, false);
  assert.equal(staleDaily.droughtIndex.fresh, false);
  assert.equal(freshDaily.droughtIndex.fresh, true);
});

test('resists missing and malformed JSON', () => {
  for (const input of [null, {}, { entries: {} }, '{"broken"']) {
    const result = parseOvfDroughtResponse(input, { now: fixtureNow });
    assert.equal(result.station.name, 'Mezősas');
    assert.equal(result.airTemperature.value, null);
    assert.equal(result.isFresh, false);
  }
});

test('disabled opt-in returns without fetching', async () => {
  const previous = process.env.CRUCIX_ENABLE_OVF_DROUGHT;
  delete process.env.CRUCIX_ENABLE_OVF_DROUGHT;
  try {
    const result = await fetchOvfDroughtData({ fixtureData: fixture });
    assert.equal(result.status, 'disabled');
    assert.equal(result.enabled, false);
  } finally {
    if (previous === undefined) delete process.env.CRUCIX_ENABLE_OVF_DROUGHT;
    else process.env.CRUCIX_ENABLE_OVF_DROUGHT = previous;
  }
});

test('server strips drought data before persistence', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /delete cloned\.sources\.ovfDrought/);
  assert.match(server, /saveSnapshot\(RUNS_DIR, stripMemoryOnlySources\(rawData\)\)/);
});
