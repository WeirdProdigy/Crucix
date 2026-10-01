import test from 'node:test';
import assert from 'node:assert/strict';
import { briefing, getRecentEarthquakes } from '../apis/sources/usgs.mjs';

const time = Date.UTC(2026, 9, 1, 12);
const event = (overrides = {}) => ({
  type: 'Feature', id: 'usgs-fixture',
  properties: { mag: 5.2, place: 'Fixture region', title: 'M 5.2 - Fixture region', time, tsunami: 0,
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/usgs-fixture', felt: 0, cdi: 0, ...overrides.properties },
  geometry: { type: 'Point', coordinates: [-122.4, 37.8, 12.5], ...overrides.geometry },
});
const response = features => new Response(JSON.stringify({
  type: 'FeatureCollection', metadata: { generated: time, count: features.length }, features,
}), { headers: { 'content-type': 'application/geo+json' } });

test('USGS fetch uses the fixed keyless significant-day feed', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, undefined);
    return response([]);
  });
  assert.deepEqual((await getRecentEarthquakes({ retries: 0 })).features, []);
});

test('USGS normalizes coordinates, timestamps, magnitude, links, and optional zero values', async t => {
  t.mock.method(globalThis, 'fetch', async () => response([event()]));
  const result = await briefing();
  assert.equal(result.feed, 'significant_day');
  assert.equal(result.feedLabel, 'USGS significant earthquakes in the past day');
  assert.equal(result.generated, '2026-10-01T12:00:00.000Z');
  assert.equal(result.totalEarthquakes, 1);
  assert.equal(result.validEarthquakes, 1);
  assert.equal(result.discardedFeatures, 0);
  assert.deepEqual(result.earthquakes[0], {
    id: 'usgs-fixture', magnitude: 5.2, place: 'Fixture region', title: 'M 5.2 - Fixture region',
    time: '2026-10-01T12:00:00.000Z', lat: 37.8, lon: -122.4,
    coordinates: [-122.4, 37.8, 12.5], depth: 12.5, tsunamiFlag: false,
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/usgs-fixture', felt: 0, cdi: 0,
  });
});

test('USGS retains significant-feed events below magnitude four and sorts events by magnitude', async t => {
  t.mock.method(globalThis, 'fetch', async () => response([event({ properties: { mag: 3.1 } }), event({ properties: { mag: 6.5 } })]));
  const result = await briefing();
  assert.equal(result.earthquakes.length, 2);
  assert.deepEqual(result.earthquakes.map(eq => eq.magnitude), [6.5, 3.1]);
  assert.equal(result.signals.some(signal => /M3\.1/.test(signal)), true);
});

test('USGS tsunami flags do not imply an issued tsunami alert', async t => {
  t.mock.method(globalThis, 'fetch', async () => response([event({ properties: { tsunami: 1 } })]));
  const result = await briefing();
  assert.equal(result.earthquakes[0].tsunamiFlag, true);
  assert.match(result.signals[0], /USGS tsunami flag set/);
  assert.equal(result.signals[0].includes('WARNING'), false);
  assert.match(result.tsunamiFlagNote, /issued tsunami warning is not established/);
});

test('USGS rejects malformed coordinates, dates, and magnitude while reporting discarded counts', async t => {
  const invalid = [
    event({ geometry: { coordinates: [181, 0, 1] } }),
    event({ geometry: { coordinates: [0, -91, 1] } }),
    event({ geometry: { coordinates: [null, 0, 1] } }),
    event({ geometry: { type: 'Polygon' } }),
    event({ properties: { time: null } }),
    event({ properties: { time: '2026-10-01' } }),
    event({ properties: { time: 9e20 } }),
    event({ properties: { mag: null } }),
    event({ properties: { mag: '5.2' } }),
    null,
  ];
  t.mock.method(globalThis, 'fetch', async () => response([event(), ...invalid]));
  const result = await briefing();
  assert.equal(result.totalEarthquakes, 11);
  assert.equal(result.validEarthquakes, 1);
  assert.equal(result.discardedFeatures, 10);
  assert.equal(result.earthquakes.length, 1);
});

test('USGS only forwards valid HTTP or HTTPS article links', async t => {
  const links = ['javascript:alert(1)', 'data:text/html,fixture', '/relative-event', 'https://earthquake.usgs.gov/example', 'http://example.com/event'];
  t.mock.method(globalThis, 'fetch', async () => response(links.map(url => event({ properties: { url } }))));
  const result = await briefing();
  assert.deepEqual(result.earthquakes.map(eq => eq.url), [null, null, null, 'https://earthquake.usgs.gov/example', 'http://example.com/event']);
});

test('USGS empty feed succeeds without claiming an all-earthquake magnitude cutoff', async t => {
  t.mock.method(globalThis, 'fetch', async () => response([]));
  const result = await briefing();
  assert.equal(result.error, undefined);
  assert.equal(result.totalEarthquakes, 0);
  assert.deepEqual(result.earthquakes, []);
  assert.match(result.signals[0], /significant earthquakes feed/);
  assert.equal(result.signals[0].includes('M'), false);
});

test('USGS HTTP failures are visible rather than converted to an empty successful feed', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('not available', { status: 404 }));
  const result = await briefing();
  assert.equal(result.error, 'HTTP 404');
  assert.equal(result.status, 404);
  assert.equal(Object.hasOwn(result, 'totalEarthquakes'), false);
  assert.equal(Object.hasOwn(result, 'signals'), false);
});

test('USGS rejects invalid JSON, malformed collections, and entirely invalid features', async t => {
  const payloads = ['{invalid json', JSON.stringify({ features: [] }), JSON.stringify({ type: 'FeatureCollection', features: {} }),
    JSON.stringify({ type: 'FeatureCollection', features: [event({ properties: { mag: null } })] })];
  for (const payload of payloads) {
    t.mock.method(globalThis, 'fetch', async () => new Response(payload));
    const result = await briefing();
    assert.equal(typeof result.error, 'string');
    assert.equal(Object.hasOwn(result, 'totalEarthquakes'), false);
    t.mock.restoreAll();
  }
});
