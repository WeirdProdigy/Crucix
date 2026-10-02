import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmsc, briefing } from '../apis/sources/emsc.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';

const now = Date.parse('2026-10-02T19:05:00Z');
const HOUR = 3600000;
const MIB = 1024 * 1024;
const iso = ms => new Date(ms).toISOString();
const rtl = String.fromCharCode(0x202e), zero = String.fromCharCode(0x200b), bell = String.fromCharCode(7), nul = String.fromCharCode(0);

// Real features captured from https://www.seismicportal.eu/fdsnws/event/1/query on 2026-10-02 (trimmed to this list, nothing edited).
const KAMCHATKA = { type: 'Feature', geometry: { type: 'Point', coordinates: [159.605, 51.8043, -21] }, id: '20261002_0000236', properties: { source_id: '2068615', source_catalog: 'EMSC-RTS', lastupdate: '2026-10-02T17:03:20.670148Z', time: '2026-10-02T16:34:39.96Z', flynn_region: 'OFF EAST COAST OF KAMCHATKA', lat: 51.8043, lon: 159.605, depth: 21, evtype: 'ke', auth: 'EMSC', mag: 5.8, magtype: 'mw', unid: '20261002_0000236' } };
const SANTA_CRUZ = { type: 'Feature', geometry: { type: 'Point', coordinates: [167.1498, -11.7163, -5.8] }, id: '20261001_0000315', properties: { source_id: '2068212', source_catalog: 'EMSC-RTS', lastupdate: '2026-10-02T06:31:15.578502Z', time: '2026-10-01T20:00:33.85Z', flynn_region: 'SANTA CRUZ ISLANDS', lat: -11.7163, lon: 167.1498, depth: 5.8, evtype: 'ke', auth: 'EMSC', mag: 5.1, magtype: 'mb', unid: '20261001_0000315' } };
const PARIA = { type: 'Feature', geometry: { type: 'Point', coordinates: [-62.4526, 10.4644, -10] }, id: '20261002_0000234', properties: { source_id: '2068612', source_catalog: 'EMSC-RTS', lastupdate: '2026-10-02T16:56:37.498422Z', time: '2026-10-02T16:31:26.79Z', flynn_region: 'GULF OF PARIA, VENEZUELA', lat: 10.4644, lon: -62.4526, depth: 10, evtype: 'ke', auth: 'EMSC', mag: 5, magtype: 'mb', unid: '20261002_0000234' } };
const FLORES = { type: 'Feature', geometry: { type: 'Point', coordinates: [121.0985, -7.9511, -10] }, id: '20261002_0000082', properties: { source_id: '2068408', source_catalog: 'EMSC-RTS', lastupdate: '2026-10-02T07:24:44.27051Z', time: '2026-10-02T06:48:06.954Z', flynn_region: 'FLORES SEA', lat: -7.9511, lon: 121.0985, depth: 10, evtype: 'ke', auth: 'NEIC', mag: 4.5, magtype: 'mb', unid: '20261002_0000082' } };
const TARAPACA_SE = { type: 'Feature', geometry: { type: 'Point', coordinates: [-70.0398, -20.7145, -11.9] }, id: '20260913_0000153', properties: { source_id: '2059778', source_catalog: 'EMSC-RTS', lastupdate: '2026-09-14T06:41:05.67606Z', time: '2026-09-13T12:55:23.11Z', flynn_region: 'TARAPACA, CHILE', lat: -20.7145, lon: -70.0398, depth: 11.9, evtype: 'se', auth: 'EMSC', mag: 4.6, magtype: 'ml', unid: '20260913_0000153' } };
const collection = features => ({ type: 'FeatureCollection', metadata: { count: features.length }, features });
const LIVE = collection([KAMCHATKA, SANTA_CRUZ, PARIA, FLORES]);

// A copy of the Kamchatka feature with overrides on the properties; the unid follows `n` unless given.
function quake(n, props = {}, geometry) {
  const unid = props.unid ?? `20261002_${String(n).padStart(7, '0')}`;
  const base = JSON.parse(JSON.stringify(KAMCHATKA));
  return { ...base, id: unid, ...(geometry === undefined ? {} : { geometry }), properties: { ...base.properties, unid, source_id: String(2070000 + n), ...props } };
}
const first = (payload, options) => parseEmsc(payload, { now, ...options }).observations[0];
const withFetch = async (impl, run) => {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
};
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });

test('parse turns the live feed into earthquake observations ranked by magnitude', () => {
  const result = parseEmsc(LIVE, { now });
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'EMSC');
  assert.equal(result.observedAt, '2026-10-02T16:34:39.960Z', 'the feed time is the newest event time');
  assert.deepEqual(result.observations.map(row => row.magnitude), [5.8, 5.1, 5, 4.5]);
  const row = result.observations[0];
  assert.equal(row.kind, 'earthquake'); assert.equal(row.source, 'EMSC');
  assert.equal(row.providerId, '20261002_0000236');
  assert.equal(row.title, 'M5.8 OFF EAST COAST OF KAMCHATKA');
  assert.equal(row.observedAt, '2026-10-02T16:34:39.960Z'); assert.equal(row.publishedAt, '2026-10-02T17:03:20.670Z');
  assert.equal(row.lat, 51.8043); assert.equal(row.lon, 159.605);
  assert.equal(row.locationMethod, 'provider'); assert.equal(row.locationPrecision, 'exact');
  assert.equal(row.severity, 'moderate'); assert.equal(row.magnitude, 5.8); assert.equal(row.depthKm, 21);
  assert.equal(row.url, 'https://www.seismicportal.eu/eventdetails.html?unid=20261002_0000236');
  assert.equal(row.region, 'OFF EAST COAST OF KAMCHATKA');
  assert.match(row.summary, /magnitude 5\.8 \(mw\)/i); assert.match(row.summary, /depth 21 km/); assert.match(row.summary, /preliminary/i);
  assert.equal(new Set(result.observations.map(r => r.url)).size, 4, 'every row has its own event page');
  assert.match(result.summary, /magnitude 4\.5/i); assert.match(result.summary, /24 hours/); assert.match(result.summary, /largest first|ranked by magnitude/i);
});

test('the feed time is the newest event time even when that event is small', () => {
  const small = quake(1, { mag: 4.6, time: iso(now - 20 * 60000) });
  const result = parseEmsc(collection([KAMCHATKA, small]), { now });
  assert.equal(result.observedAt, iso(now - 20 * 60000)); assert.equal(result.observations[0].magnitude, 5.8);
});

test('licence, rights and attribution come from the EMSC terms', () => {
  const result = parseEmsc(LIVE, { now });
  assert.match(result.attribution, /EMSC-CSEM SeismicPortal/); assert.match(result.attribution, /seismicportal\.eu/);
  assert.equal(result.license, 'CC BY 4.0'); assert.equal(result.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.match(result.rights, /CC BY 4\.0/); assert.match(result.rights, /incomplete|delayed|errors/i); assert.match(result.rights, /commercial reproduction/i);
  for (const failed of [parseEmsc(null, { now }), parseEmsc({ features: [] }, { now })]) { assert.equal(failed.license, 'CC BY 4.0'); assert.equal(failed.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/'); }
});

test('an empty list has no provider time and is never presented as current', () => {
  const empty = parseEmsc(collection([]), { now });
  assert.equal(empty.status, 'stale'); assert.equal(empty.observedAt, null); assert.deepEqual(empty.observations, []);
  assert.equal(empty.freshness.reason, 'unknown-provider-time');
  // The feed time is the newest event time and the feed limit is 12 h (a real quiet stretch of 9.2 h must not read as expired).
  for (const gap of [7 * HOUR, 9.2 * HOUR, 11 * HOUR + 59 * 60000, 12 * HOUR]) {
    const quiet = parseEmsc(collection([quake(1, { time: iso(now - gap) })]), { now });
    assert.equal(quiet.status, 'ok', `a ${gap / HOUR} h gap is still current`); assert.equal(quiet.observations.length, 1);
  }
  for (const gap of [12 * HOUR + 1000, 13 * HOUR, 20 * HOUR]) {
    const quiet = parseEmsc(collection([quake(1, { time: iso(now - gap) })]), { now });
    assert.equal(quiet.status, 'stale', `a ${gap / HOUR} h gap expires the feed`); assert.deepEqual(quiet.observations, []); assert.equal(quiet.freshness.reason, 'expired-provider-time');
  }
});

test('wrong shapes and provider errors never throw and give an error result', () => {
  for (const payload of [[], null, undefined, 'features', 42, {}, { features: 'x' }, { features: {} }, { type: 'FeatureCollection' }]) {
    const result = parseEmsc(payload, { now });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:/);
  }
  const failed = parseEmsc({ error: 'HTTP 503 from https://www.seismicportal.eu/fdsnws/event/1/query?start=x' }, { now });
  assert.equal(failed.status, 'error'); assert.doesNotMatch(failed.error, /https?:|seismicportal/i);
  assert.equal(parseEmsc({ error: { code: 1 } }, { now }).status, 'error');
});

test('features with a bad shape are skipped one by one and a valid sibling does not revive them', () => {
  const bad = [null, 'x', 7, {}, { properties: null }, { properties: [] },
    quake(1, { mag: '5.0' }), quake(2, { mag: null }), quake(3, { mag: NaN }), quake(4, { mag: -1 }), quake(5, { mag: 11 }), quake(6, { mag: undefined }),
    quake(7, { time: undefined }), quake(8, { time: 'yesterday' }), quake(9, { time: '2026-13-40T00:00:00Z' }), quake(10, { time: 1790000000000 }),
    quake(12, { unid: '../../x' }), quake(13, { unid: 'a b' }), quake(14, { unid: 'x'.repeat(100) }),
    quake(15, { evtype: 'kx' }), quake(16, { evtype: 'sx' }), quake(17, { evtype: undefined }), quake(18, { evtype: 'KE' })];
  const noId = quake(11); noId.id = undefined; noId.properties.unid = undefined; bad.push(noId);
  const result = parseEmsc(collection([...bad, PARIA]), { now });
  assert.equal(result.status, 'ok'); assert.deepEqual(result.observations.map(r => r.providerId), ['20261002_0000234']);
});

test('earthquakes and suspected earthquakes are kept, other event types are not', () => {
  const suspected = first(collection([quake(1, { evtype: 'se' })]));
  assert.equal(suspected.kind, 'earthquake'); assert.match(suspected.summary, /suspected earthquake/i);
  assert.doesNotMatch(first(collection([quake(1, { evtype: 'ke' })])).summary, /suspected/i);
  assert.equal(parseEmsc(collection([quake(1, { evtype: 'kx' })]), { now }).observations.length, 0);
});

test('hostile provider text is cleaned to inert plain text and capped', () => {
  const region = `<img src=x onerror=alert(1)>${rtl}${bell}${nul}<script>alert(1)</script>Evil${zero}  Coast\n\t of   "Mars" ${'A'.repeat(5000)}`;
  const row = first(collection([quake(1, { flynn_region: region, auth: '<b>NEIC</b>', magtype: 'mw<script>' })]));
  for (const value of [row.title, row.summary, row.region]) {
    assert.doesNotMatch(value, /[<>]/); assert.doesNotMatch(value, /onerror=alert\(1\)>/); assert.doesNotMatch(value, new RegExp(`[${rtl}${zero}${bell}${nul}]`)); assert.doesNotMatch(value, /[\n\t]/);
  }
  assert.match(row.title, /^M5\.8 alert\(1\)Evil Coast of "Mars" A+$/, 'tags are removed, the remaining text is inert'); assert.ok(row.title.length <= 140, `title length ${row.title.length}`); assert.ok(row.region.length <= 120);
  assert.doesNotMatch(row.summary, /NEIC|<b>|mw</); assert.ok(row.summary.length <= 500);
  for (const unclosed of ['COAST <img src=x onerror=alert(1)', 'COAST > <b', '<<img>>OFFSHORE', 'A<B>C<']) assert.doesNotMatch(first(collection([quake(1, { flynn_region: unclosed })])).title, /[<>]/, unclosed);
  const blank = first(collection([quake(1, { flynn_region: `<i></i>${rtl}   ` })]));
  assert.equal(blank.title, 'M5.8 Unknown region');
  for (const value of [undefined, null, 5, {}, []]) assert.equal(first(collection([quake(1, { flynn_region: value })])).title, 'M5.8 Unknown region');
});

// Standing rule for every adapter: cut the text to a fixed length first, then run regexes (a tag pattern that rescans from every '<' is quadratic).
test('hostile oversized provider text is cleaned in linear time', { timeout: 5000 }, () => {
  const started = Date.now();
  const floods = { lt: '<'.repeat(1000000), openTag: '<a '.repeat(300000), gt: '>'.repeat(1000000), nested: '<<>'.repeat(300000), spaces: ' '.repeat(1000000) + 'COAST', words: 'A'.repeat(1000000),
    controls: (bell + zero).repeat(500000), http: 'http://'.repeat(150000) };
  for (const [name, region] of Object.entries(floods)) {
    const row = first(collection([quake(1, { flynn_region: region, auth: region, magtype: region })]));
    assert.match(row.title, /^M5\.8 /, name); assert.doesNotMatch(row.title, /[<>]/, name); assert.ok(row.title.length <= 130, `${name} title length ${row.title.length}`);
    assert.ok(row.summary.length <= 500, name); assert.doesNotMatch(row.summary, /Solution from/, 'an oversized author tag is dropped');
  }
  assert.deepEqual(parseEmsc(collection([quake(1, { unid: 'a'.repeat(1000000) }), quake(2, { time: 'x'.repeat(1000000) }), quake(3, { evtype: 'k'.repeat(1000000) }), quake(4, { lastupdate: '9'.repeat(1000000) })]), { now }).observations.map(r => r.providerId), ['20261002_0000004'], 'only the oversized update time is merely dropped');
  assert.equal(first(collection([quake(1, { flynn_region: floods.lt })])).title, 'M5.8 Unknown region');
  assert.match(first(collection([quake(1, { flynn_region: floods.openTag })])).title, /^M5\.8 a a a /);
  assert.equal(first(collection([quake(1, { flynn_region: floods.words })])).region.length, 120);
  for (const error of ['http://'.repeat(150000), '<'.repeat(1000000), 'x'.repeat(1000000)]) {
    const failed = parseEmsc({ error }, { now });
    assert.equal(failed.status, 'error'); assert.ok(failed.error.length <= 300); assert.doesNotMatch(failed.error, /https?:/);
  }
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test('old, future and undated events are excluded and never fill the cap or set the feed time', () => {
  const fresh = Array.from({ length: 120 }, (_, i) => quake(i + 1, { mag: 5, time: iso(now - (i + 1) * 60000) }));
  const old = Array.from({ length: 60 }, (_, i) => quake(200 + i, { mag: 8, time: iso(now - 27 * HOUR - i * 60000) }));
  const future = Array.from({ length: 5 }, (_, i) => quake(300 + i, { mag: 9, time: iso(now + (10 + i) * 60000) }));
  const result = parseEmsc(collection([...old, ...future, ...fresh]), { now });
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 100);
  assert.ok(result.observations.every(r => Date.parse(r.observedAt) <= now && now - Date.parse(r.observedAt) <= 26 * HOUR));
  assert.ok(result.observations.every(r => r.magnitude === 5), 'the old M8 and the future M9 did not take a slot');
  assert.equal(result.observedAt, iso(now - 60000), 'the newest valid, non-future event');
  const edge = parseEmsc(collection([quake(1, { time: iso(now - 25 * HOUR - 59 * 60000) }), quake(2, { time: iso(now - 26 * HOUR - 60000) }), quake(3, { time: iso(now - 4 * HOUR) })]), { now });
  assert.deepEqual(edge.observations.map(r => r.providerId).sort(), ['20261002_0000001', '20261002_0000003'], '26 hours is the observation limit');
  const onlyFuture = parseEmsc(collection([quake(1, { time: iso(now + HOUR) })]), { now });
  assert.equal(onlyFuture.status, 'stale'); assert.equal(onlyFuture.observedAt, null);
  assert.equal(parseEmsc(collection([quake(1, { time: iso(now + 4 * 60000) })]), { now }).status, 'ok', 'a few minutes of clock skew are tolerated');
});

test('150 earthquakes are ranked by magnitude then time and capped at 100 before the freshness filter', () => {
  const quakes = Array.from({ length: 150 }, (_, i) => ({ n: i + 1, mag: Math.round((4.5 + (i % 45) / 10) * 10) / 10, time: now - (i + 1) * 5 * 60000 }));
  const payload = collection(quakes.map(q => quake(q.n, { mag: q.mag, time: iso(q.time) })));
  const result = parseEmsc(payload, { now });
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 100);
  const expected = [...quakes].sort((a, b) => b.mag - a.mag || b.time - a.time).slice(0, 100).map(q => `20261002_${String(q.n).padStart(7, '0')}`);
  assert.deepEqual(result.observations.map(r => r.providerId), expected);
  assert.equal(result.observations[0].magnitude, 8.9); assert.ok(result.observations.at(-1).magnitude >= 5.5);
  assert.equal(result.rejectedObservations, 0); assert.equal(result.truncatedRecords, 50); assert.equal(result.examinedRecords, 150);
  const shuffled = parseEmsc(collection([...payload.features].reverse()), { now });
  assert.deepEqual(shuffled.observations.map(r => r.providerId), expected, 'the order of the payload does not matter');
  const exactly = n => parseEmsc(collection(Array.from({ length: n }, (_, i) => quake(i + 1, { mag: 5, time: iso(now - 60000) }))), { now });
  assert.equal(exactly(100).observations.length, 100); assert.equal(exactly(100).truncatedRecords, 0, 'a provider answer of exactly 100 events is complete');
  assert.equal(exactly(101).observations.length, 100); assert.equal(exactly(101).truncatedRecords, 1, 'the 101st event (the request asks for 101) shows that the provider cut the list');
  const huge = parseEmsc(collection(Array.from({ length: 1200 }, (_, i) => quake(i + 1, { mag: 5, time: iso(now - 60000) }))), { now });
  assert.equal(huge.examinedRecords, 1000); assert.equal(huge.observations.length, 100); assert.ok(huge.truncatedRecords >= 200);
});

test('severity follows the magnitude table at its exact boundaries', () => {
  const cases = [[4.5, 'low'], [4.9, 'low'], [4.94, 'low'], [4.96, 'moderate'], [5, 'moderate'], [5.9, 'moderate'], [5.96, 'high'], [6, 'high'], [6.9, 'high'], [7, 'critical'], [7.4, 'critical'], [9.1, 'critical'], [10, 'critical']];
  for (const [mag, severity] of cases) {
    const row = first(collection([quake(1, { mag })]));
    assert.equal(row.severity, severity, `M${mag}`);
    assert.equal(row.magnitude, Math.round(mag * 10) / 10); assert.ok(row.title.startsWith(`M${(Math.round(mag * 10) / 10).toFixed(1)} `), row.title);
  }
  assert.equal(first(collection([quake(1, { mag: 4.96 })])).title.startsWith('M5.0 '), true, 'the displayed magnitude and the severity agree');
  assert.equal(first(collection([quake(1, { mag: 4.94 })])).title.startsWith('M4.9 '), true);
});

test('provider ids are the EMSC unid, stable across parses and updates', () => {
  const ids = payload => parseEmsc(payload, { now }).observations.map(row => row.providerId);
  assert.deepEqual(ids(LIVE), ids(LIVE)); assert.deepEqual(ids(JSON.parse(JSON.stringify(LIVE))), ids(LIVE));
  assert.deepEqual(ids(LIVE), ['20261002_0000236', '20261001_0000315', '20261002_0000234', '20261002_0000082']);
  const revised = JSON.parse(JSON.stringify(LIVE));
  revised.features[0].properties.mag = 6.1; revised.features[0].properties.lastupdate = '2026-10-02T18:45:00Z'; revised.features[0].properties.depth = 12;
  const [updated] = parseEmsc(revised, { now }).observations;
  assert.equal(updated.providerId, '20261002_0000236'); assert.equal(updated.severity, 'high'); assert.equal(updated.publishedAt, '2026-10-02T18:45:00.000Z');
  assert.equal(new Set(ids(LIVE)).size, 4);
  assert.deepEqual(ids(collection([KAMCHATKA, KAMCHATKA, PARIA])), ['20261002_0000236', '20261002_0000234'], 'a repeated event is listed once');
  const byId = first(collection([{ ...quake(1), id: '20261002_0000099', properties: { ...quake(1).properties, unid: undefined } }]));
  assert.equal(byId.providerId, '20261002_0000099', 'the feature id is used when the unid property is missing');
});

test('location comes from the geometry, falls back to the properties and is never invented', () => {
  const row = first(collection([KAMCHATKA]));
  assert.equal(row.lat, 51.8043); assert.equal(row.lon, 159.605);
  const swapped = first(collection([quake(1, { lat: 1, lon: 2 }, { type: 'Point', coordinates: [10.5, -20.25, -3] })]));
  assert.equal(swapped.lat, -20.25); assert.equal(swapped.lon, 10.5); assert.equal(swapped.depthKm, 21, 'depth comes from the depth property');
  for (const geometry of [null, {}, { type: 'Point' }, { type: 'Point', coordinates: [] }, { type: 'Point', coordinates: ['1', '2'] }, { type: 'Point', coordinates: [200, 10] }, { type: 'Point', coordinates: [10, 95] }]) {
    const fallback = first(collection([quake(1, { lat: 12.5, lon: -45.5 }, geometry)]));
    assert.equal(fallback.lat, 12.5, JSON.stringify(geometry)); assert.equal(fallback.lon, -45.5);
  }
  for (const props of [{ lat: 95, lon: 10 }, { lat: 10, lon: 190 }, { lat: 'x', lon: 'y' }, { lat: null, lon: null }, { lat: undefined, lon: undefined }]) {
    assert.equal(parseEmsc(collection([quake(1, props, { type: 'Point', coordinates: [500, 500] })]), { now }).observations.length, 0, JSON.stringify(props));
  }
});

test('the depth is a non-negative number of kilometres or absent', () => {
  assert.equal(first(collection([quake(1, { depth: 33.46 })])).depthKm, 33.5);
  assert.equal(first(collection([quake(1, { depth: 0 })])).depthKm, 0);
  for (const depth of [undefined, null, 'deep', -5, NaN, 5000]) {
    const row = first(collection([quake(1, { depth })]));
    assert.equal('depthKm' in row, false, String(depth)); assert.doesNotMatch(row.summary, /depth/i);
  }
});

test('a missing or invalid update time is left out and never replaced', () => {
  for (const lastupdate of [undefined, 'bad', null, iso(now + HOUR)]) {
    const row = first(collection([quake(1, { lastupdate })]));
    assert.equal('publishedAt' in row, false, String(lastupdate)); assert.equal(row.observedAt, '2026-10-02T16:34:39.960Z');
  }
});

test('observations survive the server normalization with facts, location, severity and the registered home and policy', () => {
  assert.deepEqual(FACT_FIELDS.EMSC, ['magnitude', 'depthKm']);
  assert.equal(HOME.EMSC, 'https://www.seismicportal.eu/');
  assert.deepEqual(POLICIES.EMSC, { maxAgeMs: 12 * HOUR, observationMaxAgeMs: 26 * HOUR });
  const [out] = normalizeLiveSources({ EMSC: parseEmsc(LIVE, { now }) }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://www.seismicportal.eu/'); assert.equal(out.observations.length, 4);
  const row = out.observations[0];
  assert.equal(row.kind, 'earthquake'); assert.equal(row.severity, 'moderate'); assert.equal(row.lat, 51.8043); assert.equal(row.lon, 159.605);
  assert.equal(row.locationMethod, 'provider'); assert.equal(row.region, 'OFF EAST COAST OF KAMCHATKA'); assert.equal(row.providerId, '20261002_0000236');
  assert.deepEqual(row.facts, [{ label: 'magnitude', value: 5.8 }, { label: 'depthKm', value: 21 }]);
  assert.equal(out.license, 'CC BY 4.0'); assert.match(out.attribution, /EMSC-CSEM/); assert.deepEqual(out.metrics, {});
  const events = buildEvents({ meta: { timestamp: iso(now) }, liveSources: [out] }, { now });
  assert.equal(events.length, 4); assert.ok(events.every(event => event.kind === 'earthquake'));
  const top = events.find(event => event.title === 'M5.8 OFF EAST COAST OF KAMCHATKA');
  assert.equal(top.severity, 'moderate'); assert.equal(top.location.lat, 51.8043); assert.equal(top.source.url, 'https://www.seismicportal.eu/eventdetails.html?unid=20261002_0000236');
  const ids = payload => buildEvents({ meta: { timestamp: iso(now) }, liveSources: normalizeLiveSources({ EMSC: parseEmsc(payload, { now }) }, now) }, { now }).map(event => event.id).sort();
  assert.deepEqual(ids(LIVE), ids(LIVE), 'event identities are stable across parses');
});

test('briefing asks for the last 24 hours of M4.5+ events largest first in one bounded request', async () => {
  const seen = [];
  const result = await briefing({ now, fetcher: async (url, options) => { seen.push({ url: new URL(url), options }); return LIVE; } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 1);
  const { url, options } = seen[0];
  assert.equal(url.origin + url.pathname, 'https://www.seismicportal.eu/fdsnws/event/1/query');
  assert.equal(url.searchParams.get('format'), 'json'); assert.equal(url.searchParams.get('minmag'), '4.5'); assert.equal(url.searchParams.get('limit'), '101', 'one more than we keep');
  assert.equal(url.searchParams.get('orderby'), 'magnitude'); assert.equal(url.searchParams.get('start'), iso(now - 24 * HOUR));
  assert.deepEqual({ ...options }, { timeout: 10000, retries: 0, maxBytes: 2 * MIB });
  assert.deepEqual(result.observations.map(r => r.magnitude), [5.8, 5.1, 5, 4.5]);
});

test('an empty answer (HTTP 204) is a stale result and not an error or a crash', async () => {
  const viaFetcher = await briefing({ now, fetcher: async () => ({ error: 'Invalid JSON response', status: 204 }) });
  assert.equal(viaFetcher.status, 'stale'); assert.deepEqual(viaFetcher.observations, []); assert.equal(viaFetcher.observedAt, null); assert.equal('error' in viaFetcher, false);
  const viaFetch = await withFetch(async () => new Response(null, { status: 204 }), () => briefing({ now }));
  assert.equal(viaFetch.status, 'stale'); assert.deepEqual(viaFetch.observations, []);
  const emptyOk = await withFetch(async () => reply(''), () => briefing({ now }));
  assert.equal(emptyOk.status, 'error', 'an empty body with HTTP 200 is not the no-events answer');
  const notEmpty = await briefing({ now, fetcher: async () => ({ error: 'Invalid JSON response', status: 200 }) });
  assert.equal(notEmpty.status, 'error');
});

test('briefing degrades every transport failure to an error result without a URL and never throws', async () => {
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'Request timed out after 10000ms' }, { error: 'Response exceeds 2097152 byte limit' },
    { error: 'connect failed for https://www.seismicportal.eu/fdsnws/event/1/query?start=2026&key=secret' }, [], null, 'text'];
  for (const payload of failures) {
    const result = await briefing({ now, fetcher: async () => payload });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:|seismicportal|secret/i);
  }
  const thrown = await briefing({ now, fetcher: async () => { throw new Error('connect ECONNREFUSED https://www.seismicportal.eu/?key=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|seismicportal|secret|ECONNREFUSED/i);
  assert.equal((await briefing({ now, fetcher: () => { throw new Error('sync https://x'); } })).status, 'error');
});

test('briefing over the real fetch helper degrades 503, timeout, an oversized body and invalid JSON to error results', async () => {
  const cases = {
    '503': () => reply('down', { status: 503 }),
    'timeout': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    'oversized': () => reply('x'.repeat(2 * MIB + 1)),
    'invalid json': () => reply('<html>not json</html>'),
    'network': () => Promise.reject(new TypeError('fetch failed')),
  };
  for (const [name, impl] of Object.entries(cases)) {
    const result = await withFetch(impl, () => briefing({ now, timeout: 25 }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name);
    assert.doesNotMatch(result.error, /https?:|seismicportal/i, name);
  }
  assert.match((await withFetch(cases.timeout, () => briefing({ now, timeout: 25 }))).error, /timed out/i);
  assert.match((await withFetch(cases.oversized, () => briefing({ now, timeout: 1000 }))).error, /exceeds|limit/i);
  const ok = await withFetch(async () => reply(LIVE), () => briefing({ now }));
  assert.equal(ok.status, 'ok'); assert.equal(ok.observations.length, 4); assert.equal(ok.observations[0].providerId, '20261002_0000236');
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await briefing({ now, timeout, fetcher: async (url, options) => { seen.push(options.timeout); return LIVE; } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000);
});

test('briefing has no cache: every call asks the provider, an injected clock moves the window', async () => {
  const starts = [];
  const fetcher = async url => { starts.push(new URL(url).searchParams.get('start')); return LIVE; };
  await briefing({ now, fetcher, useCache: true }); await briefing({ now: now + HOUR, fetcher, useCache: true });
  assert.deepEqual(starts, [iso(now - 24 * HOUR), iso(now - 23 * HOUR)]);
});
