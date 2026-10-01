import test from 'node:test';
import assert from 'node:assert/strict';
import { briefing, getActiveAlerts } from '../apis/sources/noaa.mjs';

const collection = features => new Response(JSON.stringify({ type: 'FeatureCollection', features }), {
  headers: { 'content-type': 'application/geo+json' },
});

test('NOAA sends only supported active-alert filters and ignores the old limit option', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = new URL(url);
    assert.equal(request.origin, 'https://api.weather.gov');
    assert.equal(request.pathname, '/alerts/active');
    assert.equal(request.searchParams.get('status'), 'actual');
    assert.equal(request.searchParams.get('severity'), 'Extreme,Severe');
    assert.equal(request.searchParams.get('urgency'), 'Immediate');
    assert.equal(request.searchParams.get('event'), 'Tornado Warning');
    assert.equal(request.searchParams.has('limit'), false);
    assert.equal(options.headers.Accept, 'application/geo+json');
    return collection([]);
  });
  assert.deepEqual((await getActiveAlerts({ severity: 'Extreme,Severe', urgency: 'Immediate', event: 'Tornado Warning', limit: 1 })).features, []);
});

test('NOAA briefing counts every active severe alert while limiting display rows only', async t => {
  const features = Array.from({ length: 80 }, (_, index) => ({
    type: 'Feature',
    properties: { event: index < 2 ? 'Tornado Warning' : 'Flood Warning', severity: 'Severe', urgency: 'Immediate', headline: `Alert ${index}` },
    geometry: { type: 'Point', coordinates: [-89.5, 43.6] },
  }));
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(new URL(url).searchParams.has('limit'), false);
    return collection(features);
  });
  const result = await briefing();
  assert.equal(result.error, undefined);
  assert.equal(result.totalSevereAlerts, 80);
  assert.equal(result.summary.tornadoes, 2);
  assert.equal(result.summary.floods, 78);
  assert.equal(result.topAlerts.length, 15);
  assert.equal(result.topAlerts[0].lat, 43.6);
  assert.equal(result.topAlerts[0].lon, -89.5);
});

test('NOAA genuine empty collections remain a successful zero-alert result', async t => {
  t.mock.method(globalThis, 'fetch', async () => collection([]));
  const result = await briefing();
  assert.equal(result.error, undefined);
  assert.equal(result.totalSevereAlerts, 0);
  assert.deepEqual(result.topAlerts, []);
});

test('NOAA propagates request errors without reporting a false all-clear', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ title: 'Bad Request', parameterErrors: ['rejected request'] }), { status: 400 }));
  const result = await briefing();
  assert.equal(result.error, 'HTTP 400');
  assert.equal(result.status, 400);
  assert.equal(Object.hasOwn(result, 'totalSevereAlerts'), false);
  assert.equal(Object.hasOwn(result, 'summary'), false);
});

test('NOAA exposes invalid JSON as a failed source response', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{invalid json'));
  const result = await briefing();
  assert.equal(result.error, 'Invalid JSON response');
  assert.equal(Object.hasOwn(result, 'totalSevereAlerts'), false);
});

test('NOAA rejects missing or malformed feature collections', async t => {
  for (const payload of [{}, { features: {} }, { features: [null] }]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(payload)));
    const result = await briefing();
    assert.match(result.error, /expected a features array/);
    assert.equal(Object.hasOwn(result, 'totalSevereAlerts'), false);
    t.mock.restoreAll();
  }
});
