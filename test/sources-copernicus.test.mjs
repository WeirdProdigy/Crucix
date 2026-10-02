import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCopernicus, briefing } from '../apis/sources/copernicus-ems.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const now = Date.parse('2026-10-02T19:05:00Z');
const HOUR = 3600000, DAY = 24 * HOUR;
const MIB = 1024 * 1024;
const iso = ms => new Date(ms).toISOString();
// The provider writes UTC times without a zone designator.
const naive = ms => iso(ms).slice(0, 19);
const rtl = String.fromCharCode(0x202e), zero = String.fromCharCode(0x200b), bell = String.fromCharCode(7), nul = String.fromCharCode(0);

// Real activations captured from https://mapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/ on 2026-10-02
// (nothing edited; the list is newest code first, EMSR877 and EMSR858 come from a larger page of the same endpoint).
const R932 = { code: 'EMSR932', countries: ['Spain'], eventTime: '2026-09-15T13:00:00', name: 'Wildfire in Huelva Province, Spain', centroid: 'POINT (-7.213497 37.789542)', activationTime: '2026-09-15T16:58:00', category: 'Wildfire', lastUpdate: '2026-09-17T12:50:19.784825', closed: true, gdacsId: null, n_aois: 1, n_products: 1 };
const R931 = { code: 'EMSR931', countries: ['Croatia'], eventTime: '2026-09-10T20:15:00', name: 'Wildfire in Island of Brac, Croatia', centroid: 'POINT (16.511327265522922 43.32315366146852)', activationTime: '2026-09-12T07:01:00', category: 'Wildfire', lastUpdate: '2026-09-16T16:15:31.791614', closed: true, gdacsId: null, n_aois: 1, n_products: 3 };
const R930 = { code: 'EMSR930', countries: ['Italy'], eventTime: '2026-09-02T13:00:00', name: 'Storm in Basilicata, Italy.', centroid: 'POINT (16.688524454669405 40.230673340667245)', activationTime: '2026-09-07T14:44:00', category: 'Storm', lastUpdate: '2026-09-15T14:01:14.382140', closed: true, gdacsId: null, n_aois: 2, n_products: 3 };
const R929 = { code: 'EMSR929', countries: ['Greece'], eventTime: '2026-08-31T13:00:00', name: 'Wildfire in Trapezitsa Mountain, Greece', centroid: 'POINT (20.798279972113534 40.033694823201664)', activationTime: '2026-09-06T09:07:00', category: 'Wildfire', lastUpdate: '2026-09-22T13:48:27.708693', closed: true, gdacsId: null, n_aois: 1, n_products: 9 };
const R928 = { code: 'EMSR928', countries: ['Italy'], eventTime: '2026-08-28T15:00:00', name: 'Storm in Lombardy, Italy', centroid: 'POINT (10.08183610452019 45.164037169774694)', activationTime: '2026-09-02T08:00:00', category: 'Storm', lastUpdate: '2026-09-14T08:13:55.900279', closed: true, gdacsId: null, n_aois: 4, n_products: 8 };
const R927 = { code: 'EMSR927', countries: ['Nepal'], eventTime: '2026-08-25T22:00:00', name: 'Flood in Nepal', centroid: 'POINT (85.35376299877846 28.212231792029492)', activationTime: '2026-08-26T09:53:00', category: 'Flood', lastUpdate: '2026-09-14T07:16:09.150534', closed: true, gdacsId: 'FL1104124', n_aois: 6, n_products: 6 };
const R926 = { code: 'EMSR926', countries: ['Latvia', 'Lithuania'], eventTime: '2026-08-21T21:00:00', name: 'Flood in Latvia and Lithuania', centroid: 'POINT (22.205348517547684 56.87281291182868)', activationTime: '2026-08-22T15:45:00', category: 'Flood', lastUpdate: '2026-08-28T07:27:36.345506', closed: true, gdacsId: null, n_aois: 4, n_products: 9 };
const R877 = { code: 'EMSR877', countries: ['Austria'], eventTime: '2026-06-11T12:00:00', name: 'Public Event in Burgenland, Austria', centroid: 'POINT (17.093001327819394 47.91828989150362)', activationTime: '2026-05-26T14:32:00', category: 'Other', lastUpdate: '2026-06-16T13:40:32.152008', closed: true, gdacsId: null, n_aois: 1, n_products: 6 };
const R858 = { code: 'EMSR858', countries: ['Italy'], eventTime: '2026-01-20T00:00:00', name: 'Flood in  Southern Italy', centroid: 'POINT (13.360408116455249 38.36763697419224)', activationTime: '2026-01-19T10:40:00', category: 'Flood', lastUpdate: '2026-02-02T15:44:20.731288', closed: true, gdacsId: null, n_aois: 14, n_products: 21 };
const page = results => ({ count: 265, next: 'https://mapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=30&offset=30', previous: null, results });
const LIVE = page([R932, R931, R930, R929, R928, R927, R926]);
const CURRENT = ['EMSR932', 'EMSR931', 'EMSR930', 'EMSR929'];

// A copy of EMSR932 with overrides; the code follows `n` unless given.
function act(n, props = {}) {
  const code = props.code ?? `EMSR${1000 + n}`;
  return { ...JSON.parse(JSON.stringify(R932)), code, ...props };
}
const first = (payload, options) => parseCopernicus(payload, { now, ...options }).observations[0];
const withFetch = async (impl, run) => {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
};
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });

test('parse turns the live list into disaster observations, newest activation first, within the 30-day window', () => {
  const result = parseCopernicus(LIVE, { now });
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'Copernicus-EMS');
  assert.equal(result.observedAt, '2026-09-15T16:58:00.000Z', 'the feed time is the newest activation time, read as UTC');
  assert.deepEqual(result.observations.map(row => row.providerId), CURRENT, 'EMSR928, EMSR927 and EMSR926 were activated more than 30 days ago');
  const row = result.observations[0];
  assert.equal(row.kind, 'disaster'); assert.equal(row.source, 'Copernicus-EMS');
  assert.equal(row.providerId, 'EMSR932'); assert.equal(row.title, 'Wildfire in Huelva Province, Spain');
  assert.equal(row.observedAt, '2026-09-15T16:58:00.000Z', 'the activation time');
  assert.equal(row.publishedAt, '2026-09-17T12:50:19.784Z', 'the provider last-update time');
  assert.equal(row.lat, 37.789542); assert.equal(row.lon, -7.213497);
  assert.equal(row.locationMethod, 'provider'); assert.equal(row.locationPrecision, 'approximate');
  assert.equal(row.severity, 'moderate'); assert.equal(row.category, 'Wildfire'); assert.equal(row.countries, 'Spain'); assert.equal(row.region, 'Spain');
  assert.equal(row.url, 'https://mapping.emergency.copernicus.eu/activations/EMSR932');
  assert.match(row.summary, /EMSR932/); assert.match(row.summary, /Wildfire/); assert.match(row.summary, /Spain/);
  assert.match(row.summary, /activated 2026-09-15 16:58 UTC/i); assert.match(row.summary, /event time 2026-09-15 13:00 UTC/i);
  assert.match(row.summary, /1 area of interest/); assert.match(row.summary, /1 product\b/); assert.match(row.summary, /no severity/i);
  assert.equal(new Set(result.observations.map(r => r.url)).size, 4, 'every row has its own activation page');
  assert.match(result.summary, /30 days/); assert.match(result.summary, /closed/i); assert.match(result.summary, /no severity/i);
  assert.equal(result.rejectedObservations, 0); assert.equal(result.examinedRecords, 7);
});

test('the rows are ordered by activation time, not by the order or the code of the payload', () => {
  const older = act(1, { activationTime: naive(now - 3 * DAY) }), newer = act(2, { activationTime: naive(now - 2 * DAY) }), newest = act(3, { activationTime: naive(now - HOUR) });
  const ids = payload => parseCopernicus(page(payload), { now }).observations.map(row => row.providerId);
  assert.deepEqual(ids([older, newest, newer]), ['EMSR1003', 'EMSR1002', 'EMSR1001']);
  assert.deepEqual(ids([newest, newer, older]), ['EMSR1003', 'EMSR1002', 'EMSR1001']);
  const tie = [act(4, { activationTime: naive(now - DAY) }), act(5, { activationTime: naive(now - DAY) })];
  assert.deepEqual(ids(tie), ['EMSR1005', 'EMSR1004'], 'the higher code first on an equal time');
  assert.deepEqual(ids([...tie].reverse()), ['EMSR1005', 'EMSR1004']);
  assert.equal(parseCopernicus(page([older, newest, newer]), { now }).observedAt, iso(now - HOUR));
});

test('times without a zone are UTC on any machine, fractions are cut to milliseconds and an event may follow the activation', () => {
  const row = first(page([act(1, { eventTime: '2026-06-11T12:00:00', activationTime: naive(now - 5 * DAY), lastUpdate: naive(now - 4 * DAY) + '.123456' })]));
  assert.equal(row.observedAt, iso(now - 5 * DAY)); assert.equal(row.publishedAt, iso(now - 4 * DAY + 123));
  // Real data has 36 activations whose event time is later than their activation time (anticipated events); the activation time stays the observation.
  assert.match(row.summary, /event time 2026-06-11 12:00 UTC/i); assert.equal(row.observedAt < '2026-06-11', false);
  for (const eventTime of [undefined, null, 'soon', '2026-13-40T00:00:00', 12345, '2026-09-15']) {
    const bare = first(page([act(2, { eventTime })]));
    assert.doesNotMatch(bare.summary, /event time/i, String(eventTime)); assert.equal(bare.observedAt, '2026-09-15T16:58:00.000Z');
  }
  for (const lastUpdate of [undefined, null, 'bad', naive(now + HOUR)]) assert.equal('publishedAt' in first(page([act(3, { lastUpdate })])), false, String(lastUpdate));
});

test('licence, rights and attribution come from the Copernicus EMS terms', () => {
  const result = parseCopernicus(LIVE, { now });
  assert.match(result.attribution, /Copernicus Emergency Management Service/); assert.match(result.attribution, /European Union/); assert.match(result.attribution, /mapping\.emergency\.copernicus\.eu/);
  assert.match(result.license, /free, full and open/i); assert.match(result.license, /2021\/696/);
  assert.equal(result.licenseUrl, 'https://mapping.emergency.copernicus.eu/terms-and-conditions/');
  assert.match(result.rights, /without any express or implied warranty/i); assert.match(result.rights, /name the source|source/i); assert.match(result.rights, /undocumented/i);
  for (const failed of [parseCopernicus(null, { now }), parseCopernicus({ results: [] }, { now })]) assert.equal(failed.licenseUrl, 'https://mapping.emergency.copernicus.eu/terms-and-conditions/');
});

test('an empty list has no provider time, and an expired newest activation expires the feed at exactly 30 days', () => {
  const empty = parseCopernicus(page([]), { now });
  assert.equal(empty.status, 'stale'); assert.equal(empty.observedAt, null); assert.deepEqual(empty.observations, []); assert.equal(empty.freshness.reason, 'unknown-provider-time');
  for (const age of [29 * DAY, 30 * DAY]) {
    const ok = parseCopernicus(page([act(1, { activationTime: naive(now - age) })]), { now });
    assert.equal(ok.status, 'ok', `${age / DAY} days`); assert.equal(ok.observations.length, 1);
  }
  for (const age of [30 * DAY + 1000, 40 * DAY]) {
    const stale = parseCopernicus(page([act(1, { activationTime: naive(now - age) })]), { now });
    assert.equal(stale.status, 'stale', `${age / DAY} days`); assert.deepEqual(stale.observations, []); assert.equal(stale.freshness.reason, 'expired-provider-time'); assert.equal(stale.observedAt, iso(now - age));
  }
  // The real list: on 2026-10-02 the newest activation is 17 days old; 13 days later the feed has expired and shows no rows.
  assert.equal(parseCopernicus(LIVE, { now: now + 12 * DAY }).status, 'ok');
  assert.equal(parseCopernicus(LIVE, { now: now + 14 * DAY }).status, 'stale');
});

test('wrong shapes and provider errors never throw and give an error result', () => {
  for (const payload of [[], null, undefined, 'results', 42, {}, { results: 'x' }, { results: {} }, { count: 3 }]) {
    const result = parseCopernicus(payload, { now });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:/);
  }
  const failed = parseCopernicus({ error: 'HTTP 503 from https://mapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=30' }, { now });
  assert.equal(failed.status, 'error'); assert.doesNotMatch(failed.error, /https?:|emergency.copernicus/i);
  assert.equal(parseCopernicus({ error: { code: 1 } }, { now }).status, 'error');
});

test('activations with a bad shape are skipped one by one and a valid sibling does not revive them', () => {
  const bad = [null, 'x', 7, [], {}, { code: 'EMSR1' },
    act(1, { code: 'EMSN123' }), act(2, { code: 'emsr123' }), act(3, { code: '../x' }), act(4, { code: 'EMSR' }), act(5, { code: 'EMSR1234567' }), act(6, { code: 932 }), act(7, { code: undefined }), act(8, { code: 'EMSR12 3' }),
    act(9, { activationTime: undefined }), act(10, { activationTime: null }), act(11, { activationTime: 'yesterday' }), act(12, { activationTime: '2026-13-40T00:00:00' }), act(13, { activationTime: 1790000000000 }), act(14, { activationTime: '2026-09-15' }),
    act(15, { activationTime: naive(now + HOUR) })];
  const result = parseCopernicus(page([...bad, R931]), { now });
  assert.equal(result.status, 'ok'); assert.deepEqual(result.observations.map(r => r.providerId), ['EMSR931']);
});

test('only whitelisted fields reach the row and no severity is invented or taken from the payload', () => {
  const row = first(page([act(1, { severity: 'critical', alertLevel: 'red', priority: 'high', secret: 'x', url: 'https://evil.example/', link: 'https://evil.example/', kind: 'cyber', lat: 1, lon: 2, observedAt: '2020-01-01T00:00:00Z' })]));
  assert.equal(row.severity, 'moderate'); assert.equal(row.kind, 'disaster'); assert.equal(row.url, 'https://mapping.emergency.copernicus.eu/activations/EMSR1001');
  assert.equal(row.lat, 37.789542, 'the location is the activation centroid'); assert.equal(row.observedAt, '2026-09-15T16:58:00.000Z');
  assert.equal('secret' in row, false); assert.equal('alertLevel' in row, false);
  for (const category of ['Wildfire', 'Flood', 'Earthquake', 'Volcanic activity', 'Storm', 'Other', 'Mass movement', 'Transport accident', 'Industrial accident']) assert.equal(first(page([act(2, { category })])).severity, 'moderate', category);
});

test('hostile provider text is cleaned to inert plain text and capped', () => {
  const name = `<img src=x onerror=alert(1)>${rtl}${bell}${nul}<script>alert(1)</script>Evil${zero}  Fire\n\t of   "Mars" ${'A'.repeat(5000)}`;
  const row = first(page([act(1, { name, category: '<b>Wildfire</b>', countries: ['<i>Spain</i>', `Fr${rtl}ance${bell}`, 'x'.repeat(500)] })]));
  for (const value of [row.title, row.summary, row.category, row.countries, row.region]) {
    assert.doesNotMatch(value, /[<>]/); assert.doesNotMatch(value, /onerror=alert\(1\)>/); assert.doesNotMatch(value, new RegExp(`[${rtl}${zero}${bell}${nul}]`)); assert.doesNotMatch(value, /[\n\t]/);
  }
  assert.match(row.title, /^alert\(1\)Evil Fire of "Mars" A+$/, 'tags are removed, the remaining text is inert'); assert.ok(row.title.length <= 140, `title length ${row.title.length}`);
  assert.equal(row.category, 'Wildfire'); assert.match(row.countries, /^Spain, France, x+$/); assert.ok(row.countries.length <= 120, `countries length ${row.countries.length}`);
  assert.ok(row.summary.length <= 700, `summary length ${row.summary.length}`);
  for (const unclosed of ['FIRE <img src=x onerror=alert(1)', 'FIRE > <b', '<<img>>FLOOD', 'A<B>C<']) assert.doesNotMatch(first(page([act(1, { name: unclosed })])).title, /[<>]/, unclosed);
  assert.equal(first(page([act(1, { name: `<i></i>${rtl}   ` })])).title, 'Copernicus EMS activation EMSR1001', 'a blank name falls back to the code');
  for (const value of [undefined, null, 5, {}, []]) assert.equal(first(page([act(1, { name: value })])).title, 'Copernicus EMS activation EMSR1001');
  assert.equal(first(page([act(1, { name: 'Flood in  Southern Italy' })])).title, 'Flood in Southern Italy', 'runs of spaces collapse (the real EMSR858 name has two)');
  const noCategory = first(page([act(1, { category: undefined })]));
  assert.equal('category' in noCategory, false); assert.doesNotMatch(noCategory.summary, /\(\)|undefined/);
});

test('countries are a short list of plain names; anything else is dropped', () => {
  assert.equal(first(page([act(1, { countries: ['Latvia', 'Lithuania'] })])).countries, 'Latvia, Lithuania');
  assert.equal(first(page([act(1, { countries: ['Spain', 'Spain', ' spain ', 'Portugal'] })])).countries, 'Spain, spain, Portugal', 'only exact repeats collapse');
  assert.equal(first(page([act(1, { countries: Array.from({ length: 30 }, (_, i) => `Country${i}`) })])).countries.split(', ').length <= 8, true);
  for (const countries of [undefined, null, 'Spain', {}, 5, [], [null, 7, {}, '', '  ']]) {
    const row = first(page([act(1, { countries })]));
    assert.equal('countries' in row, false, JSON.stringify(countries)); assert.equal('region' in row, false); assert.doesNotMatch(row.summary, / for \.|undefined/);
  }
});

// Standing rule for every adapter: cut the text to a fixed length first, then run regexes (a tag pattern that rescans from every '<' is quadratic).
// A flood of 30k is far above any field; a quadratic pattern needs seconds for it (a linear one milliseconds), so a regression fails the elapsed check instead of hanging CI.
test('hostile oversized provider text is handled in linear time', { timeout: 20000 }, () => {
  const started = Date.now();
  const N = 30000;
  const floods = { lt: '<'.repeat(N), openTag: '<a '.repeat(N), gt: '>'.repeat(N), nested: '<<>'.repeat(N), spaces: ' '.repeat(N) + 'FIRE', words: 'A'.repeat(N), controls: (bell + zero).repeat(N / 2), http: 'http://'.repeat(N / 7), dots: '.'.repeat(N) };
  for (const [flood, value] of Object.entries(floods)) {
    const row = first(page([act(1, { name: value, category: value, countries: [value, value], centroid: value, code: value, activationTime: value, eventTime: value, lastUpdate: value })]));
    assert.equal(row, undefined, `${flood}: an oversized code or time drops the row`);
    const kept = first(page([act(2, { name: value, category: value, countries: [value, value], centroid: value, eventTime: value, lastUpdate: value, n_aois: value, n_products: value })]));
    assert.ok(kept, flood); assert.doesNotMatch(kept.title, /[<>]/, flood); assert.ok(kept.title.length <= 140, `${flood} title length ${kept.title.length}`);
    assert.ok(kept.summary.length <= 700, flood); assert.equal('lat' in kept, false, `${flood}: an oversized centroid is dropped`); assert.ok((kept.category || '').length <= 60, flood); assert.ok((kept.countries || '').length <= 120, flood);
  }
  assert.equal(first(page([act(1, { name: floods.lt })])).title, 'Copernicus EMS activation EMSR1001');
  assert.match(first(page([act(1, { name: floods.openTag })])).title, /^a a a /);
  assert.equal(first(page([act(1, { name: floods.words })])).title.length, 140);
  for (const error of ['http://'.repeat(N / 7), '<'.repeat(N), 'x'.repeat(N)]) {
    const failed = parseCopernicus({ error }, { now });
    assert.equal(failed.status, 'error'); assert.ok(failed.error.length <= 300); assert.doesNotMatch(failed.error, /https?:/);
  }
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `took ${elapsed} ms`);
});

test('old, future and undated activations are excluded and never fill the cap or set the feed time', () => {
  const fresh = Array.from({ length: 30 }, (_, i) => act(i + 1, { activationTime: naive(now - (i + 1) * HOUR) }));
  const old = Array.from({ length: 30 }, (_, i) => act(100 + i, { activationTime: naive(now - 31 * DAY - i * HOUR) }));
  const future = Array.from({ length: 5 }, (_, i) => act(200 + i, { activationTime: naive(now + (10 + i) * 60000) }));
  const undated = [act(300, { activationTime: undefined }), act(301, { activationTime: 'x' })];
  const result = parseCopernicus(page([...old, ...future, ...undated, ...fresh]), { now });
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 20);
  assert.ok(result.observations.every(r => Date.parse(r.observedAt) <= now && now - Date.parse(r.observedAt) <= 30 * DAY));
  assert.deepEqual(result.observations.map(r => r.providerId), fresh.slice(0, 20).map(r => r.code), 'the 20 newest valid activations');
  assert.equal(result.observedAt, iso(now - HOUR), 'the newest valid, non-future activation');
  const onlyFuture = parseCopernicus(page([act(1, { activationTime: naive(now + HOUR) })]), { now });
  assert.equal(onlyFuture.status, 'stale'); assert.equal(onlyFuture.observedAt, null);
  assert.equal(parseCopernicus(page([act(1, { activationTime: naive(now + 4 * 60000) })]), { now }).status, 'ok', 'a few minutes of clock skew are tolerated');
  const edge = parseCopernicus(page([act(1, { activationTime: naive(now - 30 * DAY + 60000) }), act(2, { activationTime: naive(now - 30 * DAY - 60000) }), act(3, { activationTime: naive(now - DAY) })]), { now });
  assert.deepEqual(edge.observations.map(r => r.providerId), ['EMSR1003', 'EMSR1001'], '30 days is the observation limit');
});

test('thirty activations are ranked and capped at 20 before the freshness filter, and repeated codes are listed once', () => {
  const rows = Array.from({ length: 30 }, (_, i) => act(i + 1, { activationTime: naive(now - (i + 1) * 6 * HOUR) }));
  const result = parseCopernicus(page(rows), { now });
  assert.equal(result.observations.length, 20); assert.deepEqual(result.observations.map(r => r.providerId), rows.slice(0, 20).map(r => r.code));
  assert.equal(result.truncatedRecords, 10); assert.equal(result.examinedRecords, 30); assert.equal(result.rejectedObservations, 0);
  assert.deepEqual(parseCopernicus(page([...rows].reverse()), { now }).observations.map(r => r.providerId), rows.slice(0, 20).map(r => r.code), 'the order of the payload does not matter');
  const exactly = n => parseCopernicus(page(rows.slice(0, n)), { now });
  assert.equal(exactly(20).truncatedRecords, 0); assert.equal(exactly(21).truncatedRecords, 1);
  const repeated = parseCopernicus(page([R932, R932, act(1, { code: 'EMSR932', activationTime: naive(now - 2 * DAY) }), R931]), { now });
  assert.deepEqual(repeated.observations.map(r => r.providerId), ['EMSR932', 'EMSR931']);
  assert.equal(repeated.observations[0].observedAt, iso(now - 2 * DAY), 'of a repeated code the newest sighting is kept');
  const huge = parseCopernicus(page(Array.from({ length: 700 }, (_, i) => act(i + 1, { activationTime: naive(now - HOUR) }))), { now });
  assert.equal(huge.examinedRecords, 200); assert.equal(huge.observations.length, 20); assert.ok(huge.truncatedRecords >= 500);
});

test('provider ids are the activation codes, stable across parses, updates and key order', () => {
  const ids = payload => parseCopernicus(payload, { now }).observations.map(row => row.providerId);
  assert.deepEqual(ids(LIVE), ids(LIVE)); assert.deepEqual(ids(JSON.parse(JSON.stringify(LIVE))), CURRENT);
  const updated = JSON.parse(JSON.stringify(LIVE));
  updated.results[0].lastUpdate = '2026-09-30T10:00:00.5'; updated.results[0].n_products = 12; updated.results[0].name = 'Wildfire in Huelva Province, Spain (updated)';
  const [row] = parseCopernicus(updated, { now }).observations;
  assert.equal(row.providerId, 'EMSR932'); assert.equal(row.url, 'https://mapping.emergency.copernicus.eu/activations/EMSR932'); assert.equal(row.publishedAt, '2026-09-30T10:00:00.500Z');
  const reordered = { ...LIVE, results: LIVE.results.map(r => Object.fromEntries(Object.entries(r).reverse())) };
  assert.deepEqual(ids(reordered), CURRENT);
  const eventIds = payload => buildEvents({ meta: { timestamp: iso(now) }, liveSources: normalizeLiveSources({ 'Copernicus-EMS': parseCopernicus(payload, { now }) }, now) }, { now }).map(event => event.id).sort();
  assert.deepEqual(eventIds(LIVE), eventIds(JSON.parse(JSON.stringify(LIVE)))); assert.deepEqual(eventIds(updated), eventIds(LIVE), 'an updated activation keeps its event identity');
  assert.equal(new Set(eventIds(LIVE)).size, 4);
});

test('the centroid is a WKT point (longitude first), and a missing or unusable one leaves the row without a location', () => {
  const row = first(page([R931]));
  assert.equal(row.lat, 43.32315366146852); assert.equal(row.lon, 16.511327265522922);
  assert.equal(first(page([act(1, { centroid: 'POINT (-6.29 41.375)' })])).lon, -6.29);
  assert.equal(first(page([act(1, { centroid: 'POINT(8 -9)' })])).lat, -9, 'no space after POINT is fine');
  assert.equal(first(page([act(1, { centroid: ' POINT ( 10.5   -20.25 ) ' })])).lat, -20.25, 'whitespace is tolerated');
  assert.equal(first(page([act(1, { centroid: 'POINT (180 90)' })])).lon, 180); assert.equal(first(page([act(1, { centroid: 'POINT (-180 -90)' })])).lat, -90);
  for (const centroid of [null, undefined, '', 'POINT EMPTY', 'POINT (1)', 'POINT (1 2 3)', 'POINT Z (1 2 3)', 'POINT (a b)', 'POINT (1e3 2)', 'POINT (181 10)', 'POINT (10 91)', 'POINT (-181 10)', 'POINT (10 -91)', 'POINT (NaN 1)',
    'POINT (1 2) POINT (3 4)', 'MULTIPOINT ((1 2))', 'POLYGON ((0 0, 1 1, 1 0, 0 0))', 'point (1 2)', [1, 2], { lon: 1, lat: 2 }, 12, true, 'POINT (+1 2)', 'POINT (1, 2)']) {
    const kept = first(page([act(1, { centroid })]));
    assert.ok(kept, `the row is kept: ${JSON.stringify(centroid)}`);
    for (const key of ['lat', 'lon', 'locationMethod', 'locationPrecision']) assert.equal(key in kept, false, `${key} for ${JSON.stringify(centroid)}`);
    assert.equal(kept.providerId, 'EMSR1001');
  }
});

test('a row without a location still survives the server normalization and reaches the events without coordinates', () => {
  const raw = parseCopernicus(page([act(1, { centroid: null }), R932]), { now });
  const [out] = normalizeLiveSources({ 'Copernicus-EMS': raw }, now);
  assert.equal(out.observations.length, 2);
  const events = buildEvents({ meta: { timestamp: iso(now) }, liveSources: [out] }, { now });
  const unlocated = events.find(event => event.title === 'Wildfire in Huelva Province, Spain' && event.location.lat === null);
  assert.ok(unlocated, 'an event without coordinates'); assert.equal(unlocated.location.method, 'unknown');
  assert.equal(events.find(event => event.location.lat === 37.789542).location.precision, 'approximate');
});

test('observations survive the server normalization with facts, location, severity and the registered home and policy', () => {
  assert.deepEqual(FACT_FIELDS['Copernicus-EMS'], ['category', 'countries']);
  assert.equal(HOME['Copernicus-EMS'], 'https://mapping.emergency.copernicus.eu/');
  assert.deepEqual(POLICIES['Copernicus-EMS'], { maxAgeMs: 720 * HOUR, observationMaxAgeMs: 720 * HOUR });
  const keys = Object.keys(POLICIES); assert.equal(keys.indexOf('Copernicus-EMS'), keys.indexOf('EMSC') + 1, 'registered in the fixed order, EMSC then Copernicus-EMS');
  const [out] = normalizeLiveSources({ 'Copernicus-EMS': parseCopernicus(LIVE, { now }) }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://mapping.emergency.copernicus.eu/'); assert.equal(out.observations.length, 4);
  const row = out.observations[0];
  assert.equal(row.kind, 'disaster'); assert.equal(row.severity, 'moderate'); assert.equal(row.lat, 37.789542); assert.equal(row.lon, -7.213497);
  assert.equal(row.locationMethod, 'provider'); assert.equal(row.locationPrecision, 'approximate'); assert.equal(row.region, 'Spain'); assert.equal(row.providerId, 'EMSR932');
  assert.deepEqual(row.facts, [{ label: 'category', value: 'Wildfire' }, { label: 'countries', value: 'Spain' }]);
  assert.match(out.license, /free, full and open/i); assert.match(out.attribution, /Copernicus/); assert.deepEqual(out.metrics, {});
  const events = buildEvents({ meta: { timestamp: iso(now) }, liveSources: [out] }, { now });
  assert.equal(events.length, 4); assert.ok(events.every(event => event.kind === 'disaster'));
  const top = events.find(event => event.title === 'Wildfire in Huelva Province, Spain');
  assert.equal(top.severity, 'moderate'); assert.equal(top.location.lat, 37.789542); assert.equal(top.source.url, 'https://mapping.emergency.copernicus.eu/activations/EMSR932'); assert.equal(top.observedAt, '2026-09-15T16:58:00.000Z');
});

test('history keeps one record per activation: each deep link is its own page', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-copernicus-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = new HistoryStore(dir, { now: () => now + HOUR });
  const events = at => buildEvents({ meta: { timestamp: iso(at) }, liveSources: normalizeLiveSources({ 'Copernicus-EMS': parseCopernicus(LIVE, { now: at }) }, at) }, { now: at });
  assert.deepEqual(history.add(events(now)), { added: 4, updated: 0, ignored: 0, total: 4 });
  assert.deepEqual(history.add(events(now + 1000)), { added: 0, updated: 4, ignored: 0, total: 4 }, 'the same activations again update, they do not grow the history');
  assert.equal(history.query({ source: 'Copernicus-EMS' }).total, 4);
});

test('briefing asks for the 30 newest activations in one bounded request', async () => {
  const seen = [];
  const result = await briefing({ now, fetcher: async (url, options) => { seen.push({ url: new URL(url), options }); return LIVE; } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 1);
  const { url, options } = seen[0];
  assert.equal(url.origin + url.pathname, 'https://mapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/'); assert.equal(url.searchParams.get('limit'), '30'); assert.equal([...url.searchParams.keys()].length, 1);
  assert.deepEqual({ ...options }, { timeout: 10000, retries: 0, maxBytes: 2 * MIB });
  assert.deepEqual(result.observations.map(r => r.providerId), CURRENT);
});

test('the cache serves a result for one hour, refreshes after, keeps only ok results and re-checks the age on every read', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return LIVE; };
  const base = now + 100 * DAY; // a clock of its own: no other test shares this cache slot
  const baseLive = page([act(1, { activationTime: naive(base - 2 * DAY) })]);
  const lively = async () => { requests++; return baseLive; };
  const first = await briefing({ now: base, fetcher: lively, useCache: true });
  assert.equal(first.status, 'ok'); assert.equal(requests, 1);
  const again = await briefing({ now: base + 59 * 60000, fetcher: lively, useCache: true });
  assert.equal(requests, 1, 'served from the cache within an hour'); assert.equal(again.status, 'ok'); assert.deepEqual(again.observations.map(r => r.providerId), ['EMSR1001']);
  assert.equal(again.timestamp, iso(base), 'a cached answer is labelled with the time it was collected, not with the time it was served');
  assert.equal(first.timestamp, iso(base));
  const refreshed = await briefing({ now: base + 60 * 60000, fetcher: lively, useCache: true });
  assert.equal(requests, 2, 'the entry is one hour old: asked again'); assert.equal(refreshed.timestamp, iso(base + 60 * 60000));
  const other = await briefing({ now: base + 61 * 60000, fetcher: fetcher, useCache: true });
  assert.equal(requests, 3, 'a different fetcher never shares the entry'); assert.equal(other.observations.length, 0, 'EMSR932 is far older than 30 days at that clock'); assert.equal(other.status, 'stale');
  const clockBack = await briefing({ now: base + 30 * 60000, fetcher: lively, useCache: true });
  assert.equal(requests, 4, 'an entry from the future is never served'); assert.equal(clockBack.status, 'ok');
  // The age is checked again at every read: a cached payload whose newest activation has meanwhile passed 30 days is stale, not served as current.
  const lateStart = base + 200 * DAY;
  const old = async () => { requests++; return page([act(1, { activationTime: naive(lateStart - 30 * DAY + 20 * 60000) })]); };
  assert.equal((await briefing({ now: lateStart, fetcher: old, useCache: true })).status, 'ok');
  const before = requests;
  assert.equal((await briefing({ now: lateStart + 30 * 60000, fetcher: old, useCache: true })).status, 'stale', 'the cache does not keep an expired feed alive'); assert.equal(requests, before);
});

test('failures, stale and empty answers are not cached, and an injected fetcher bypasses the cache by default', async () => {
  let calls = 0, body = { error: 'HTTP 503', status: 503 };
  const fetcher = async () => { calls++; return body; };
  const base = now + 300 * DAY;
  assert.equal((await briefing({ now: base, fetcher, useCache: true })).status, 'error');
  body = page([]); assert.equal((await briefing({ now: base, fetcher, useCache: true })).status, 'stale');
  body = page([act(1, { activationTime: naive(base - 40 * DAY) })]); assert.equal((await briefing({ now: base, fetcher, useCache: true })).status, 'stale');
  assert.equal(calls, 3, 'a failure, an empty list and an expired list each left nothing behind');
  body = page([act(1, { activationTime: naive(base - DAY) })]); assert.equal((await briefing({ now: base, fetcher, useCache: true })).status, 'ok');
  assert.equal(calls, 4); assert.equal((await briefing({ now: base + 1000, fetcher, useCache: true })).status, 'ok'); assert.equal(calls, 4, 'now it is cached');
  const bypass = calls;
  await briefing({ now: base, fetcher }); await briefing({ now: base, fetcher });
  assert.equal(calls - bypass, 2, 'an injected fetcher means no cache unless asked');
  const failing = async () => { calls++; return { error: 'HTTP 503', status: 503 }; };
  assert.equal((await briefing({ now: base + 2000, fetcher: failing, useCache: true })).status, 'error', 'a failure is not hidden behind an entry that belongs to another fetcher');
});

test('briefing degrades every transport failure to an error result without a URL and never throws', async () => {
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'Request timed out after 10000ms' }, { error: 'Response exceeds 2097152 byte limit' }, { error: 'Invalid JSON response', status: 200 },
    { error: 'connect failed for https://mapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=30&key=secret' }, [], null, 'text'];
  for (const payload of failures) {
    const result = await briefing({ now, fetcher: async () => payload });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:|emergency.copernicus|secret/i);
  }
  const thrown = await briefing({ now, fetcher: async () => { throw new Error('connect ECONNREFUSED https://mapping.emergency.copernicus.eu/?key=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|emergency.copernicus|secret|ECONNREFUSED/i);
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
    const result = await withFetch(impl, () => briefing({ now, timeout: 25, useCache: false }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name);
    assert.doesNotMatch(result.error, /https?:|emergency.copernicus/i, name);
  }
  assert.match((await withFetch(cases.timeout, () => briefing({ now, timeout: 25, useCache: false }))).error, /timed out/i);
  assert.match((await withFetch(cases.oversized, () => briefing({ now, timeout: 1000, useCache: false }))).error, /exceeds|limit/i);
  const ok = await withFetch(async () => reply(LIVE), () => briefing({ now, useCache: false }));
  assert.equal(ok.status, 'ok'); assert.equal(ok.observations.length, 4); assert.equal(ok.observations[0].providerId, 'EMSR932');
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await briefing({ now, timeout, fetcher: async (url, options) => { seen.push(options.timeout); return LIVE; } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000);
});
