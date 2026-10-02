import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortwatch, parsePortwatchPlaces, briefing } from '../apis/sources/portwatch.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import config from '../crucix.config.mjs';

const now = Date.parse('2026-10-02T19:00:00Z');
const DAY = 86400000;
const MIB = 1024 * 1024;
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

// Real n_total series (oldest first, 31 days ending 2026-09-27) captured from the live Daily_Chokepoints_Data layer on 2026-10-02.
const LIVE = {
  'chokepoint6|Strait of Hormuz': [7, 3, 6, 3, 4, 3, 2, 2, 2, 6, 5, 6, 3, 5, 8, 2, 8, 2, 2, 1, 3, 7, 6, 1, 2, 3, 4, 5, 3, 4, 1],
  'chokepoint1|Suez Canal': [39, 38, 53, 30, 51, 41, 41, 56, 42, 30, 39, 43, 37, 37, 48, 40, 21, 51, 32, 37, 37, 51, 43, 42, 38, 47, 32, 41, 37, 48, 37],
  'chokepoint4|Bab el-Mandeb Strait': [27, 20, 29, 24, 19, 38, 24, 32, 18, 23, 34, 22, 35, 27, 22, 20, 31, 25, 24, 19, 27, 27, 25, 26, 27, 22, 25, 31, 29, 29, 27],
  'chokepoint9|Dover Strait': [165, 152, 147, 126, 172, 146, 155, 142, 193, 180, 158, 162, 161, 169, 185, 186, 150, 166, 150, 147, 172, 163, 159, 181, 174, 148, 167, 177, 192, 186, 162],
  'chokepoint2|Panama Canal': [29, 30, 31, 29, 31, 30, 30, 30, 34, 26, 27, 30, 31, 34, 28, 29, 29, 23, 25, 25, 28, 27, 28, 27, 25, 32, 27, 26, 24, 25, 30],
};
const LAST = '2026-09-27';
const feature = (portid, portname, date, n_total) => ({ attributes: { date, portid, portname, n_total } });
// Layer query response shape: newest first, only the requested outFields.
function daily(series = LIVE, last = LAST) {
  const features = [];
  for (const [key, values] of Object.entries(series)) {
    const [portid, portname] = key.split('|');
    values.forEach((value, i) => features.push(feature(portid, portname, addDays(last, i - (values.length - 1)), value)));
  }
  return { objectIdFieldName: 'ObjectId', features: features.reverse() };
}
// Real rows of the PortWatch_chokepoints_database layer.
const PLACES = { features: [
  ['chokepoint6', 'Strait of Hormuz', 26.29685349, 56.85984844], ['chokepoint1', 'Suez Canal', 30.59334599, 32.43688221],
  ['chokepoint4', 'Bab el-Mandeb Strait', 12.78859715, 43.34954476], ['chokepoint9', 'Dover Strait', 51.03022414, 1.505839717],
  ['chokepoint2', 'Panama Canal', 9.120512367, -79.76723825],
].map(([portid, portname, lat, lon]) => ({ attributes: { portid, portname, lat, lon } })) };
const one = (values, last = LAST, name = 'Suez Canal', portid = 'chokepoint1') => daily({ [`${portid}|${name}`]: values }, last);
const flat = (n, count = 28) => Array(count).fill(n);
const parseOne = (values, extra = {}) => parsePortwatch(one(values), { now, chokepoints: ['Suez Canal'], ...extra });
const hormuz = result => result.observations.find(row => row.chokepoint === 'hormuz');
async function withFetch(impl, run) {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
}
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });
const route = (url, dailyBody = daily(), placesBody = PLACES) => String(url).includes('PortWatch_chokepoints_database') ? placesBody : dailyBody;

test('parse turns the latest day of each chokepoint into a maritime observation with its 28-day baseline', () => {
  const result = parsePortwatch(daily(), { now, chokepoints: ['Suez Canal', 'Bab el-Mandeb Strait', 'Strait of Hormuz'] });
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'IMF-PortWatch');
  assert.equal(result.observedAt, '2026-09-27T00:00:00.000Z');
  assert.equal(result.observations.length, 3);
  const row = hormuz(result);
  assert.equal(row.kind, 'maritime'); assert.equal(row.source, 'IMF-PortWatch');
  assert.equal(row.providerId, 'hormuz:2026-09-27'); assert.equal(row.observedAt, '2026-09-27T00:00:00.000Z');
  assert.equal(row.transitCalls, 1); assert.equal(row.baseline28d, 3); assert.equal(row.changePct, -66.7);
  assert.equal(row.severity, 'high');
  assert.equal(row.url, 'https://portwatch.imf.org/pages/chokepoint6');
  assert.equal(row.title, 'Strait of Hormuz: 1 ship transit on 2026-09-27');
  const suez = result.observations.find(r => r.chokepoint === 'suez');
  assert.equal(suez.transitCalls, 37); assert.equal(suez.baseline28d, 41); assert.equal(suez.changePct, -9.8); assert.equal(suez.severity, 'info');
  const bab = result.observations.find(r => r.chokepoint === 'bab_el_mandeb');
  assert.equal(bab.baseline28d, 25.5); assert.equal(bab.changePct, 5.9); assert.equal(bab.severity, 'info');
  assert.equal(bab.url, 'https://portwatch.imf.org/pages/chokepoint4');
  assert.deepEqual(result.observations.map(r => r.chokepoint), ['hormuz', 'suez', 'bab_el_mandeb'], 'the most severe observation first, then the configured order');
  for (const key of ['lat', 'lon', 'locationMethod', 'publishedAt']) assert.equal(key in row, false, `${key} is not invented`);
});

test('rows and the feed explain that counts are AIS-visible transits and that dark ships are missing', () => {
  const result = parsePortwatch(daily(), { now, chokepoints: ['Strait of Hormuz'] });
  assert.match(result.summary, /AIS/); assert.match(result.summary, /dark|AIS-off/i); assert.match(result.summary, /not counted/i);
  assert.match(hormuz(result).summary, /AIS-visible/); assert.match(hormuz(result).summary, /dark or AIS-off ships are not counted/i);
  assert.match(hormuz(result).summary, /median of the previous 28 days is 3/);
});

test('metrics carry the latest transits of hormuz, bab_el_mandeb and suez only', () => {
  const result = parsePortwatch(daily(), { now, chokepoints: ['Strait of Hormuz', 'Suez Canal', 'Bab el-Mandeb Strait', 'Dover Strait', 'Panama Canal'] });
  assert.deepEqual(result.metrics, { hormuz_transits: 1, suez_transits: 37, bab_el_mandeb_transits: 27 });
  assert.deepEqual(parsePortwatch(daily(), { now, chokepoints: ['Dover Strait'] }).metrics, {});
  assert.deepEqual(parsePortwatch({ features: [] }, { now }).metrics, {});
});

test('licence, rights and attribution come from the IMF terms and the PortWatch citation', () => {
  const result = parsePortwatch(daily(), { now });
  assert.equal(result.attribution, 'Sources: UN Global Platform; IMF PortWatch (portwatch.imf.org)');
  assert.match(result.rights, /non-?commercial/i); assert.match(result.rights, /resell or redistribute/i);
  assert.match(result.license, /IMF/); assert.match(result.license, /non-?commercial/i);
  assert.equal(result.licenseUrl, 'https://www.imf.org/external/terms.htm');
  for (const failed of [parsePortwatch(null, { now }), parsePortwatch({ features: [] }, { now })]) assert.equal(failed.licenseUrl, 'https://www.imf.org/external/terms.htm');
});

test('empty and wrong-shaped payloads never throw and never look current', () => {
  const empty = parsePortwatch({ features: [] }, { now });
  assert.equal(empty.status, 'stale'); assert.equal(empty.observedAt, null); assert.deepEqual(empty.observations, []);
  for (const payload of [[], null, undefined, 'features', 42, {}, { features: 'x' }, { features: {} }]) {
    const result = parsePortwatch(payload, { now });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
  }
  const arcgis = parsePortwatch({ error: { code: 400, message: 'Cannot perform query at https://services9.arcgis.com/x?token=secret', details: [] } }, { now });
  assert.equal(arcgis.status, 'error'); assert.equal(arcgis.error, 'ArcGIS error 400');
  assert.equal(parsePortwatch({ error: 'HTTP 503' }, { now }).status, 'error');
  assert.equal(parsePortwatch(daily(), { now, chokepoints: [] }).status, 'error');
});

test('rows with a bad shape are skipped one by one and cannot revive a stale series', () => {
  const payload = daily({ 'chokepoint1|Suez Canal': LIVE['chokepoint1|Suez Canal'] });
  const good = payload.features.length;
  payload.features.push(null, 'x', {}, { attributes: null }, feature('chokepoint1', 'Suez Canal', '2026-09-28', 'many'), feature('chokepoint1', 'Suez Canal', '2026-09-28', -4),
    feature('chokepoint1', 'Suez Canal', '2026-09-28', NaN), feature('chokepoint1', 'Suez Canal', 'bad', 5), feature('chokepoint1', 'Suez Canal', '2026-09-28T00:00:00Z', 5),
    feature('chokepoint1', 'Suez Canal', '2026-13-45', 5), feature('chokepoint1', 'Suez Canal', null, 5), feature('chokepoint1', 'Suez Canal', 1790000000000, 5),
    feature('../x', 'Suez Canal', '2026-09-28', 5), feature(null, 'Suez Canal', '2026-09-28', 5), feature('chokepoint1', null, '2026-09-28', 5));
  assert.ok(payload.features.length > good);
  const result = parsePortwatch(payload, { now, chokepoints: ['Suez Canal'] });
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].providerId, 'suez:2026-09-27', 'the invalid later days are not the latest day');
});

test('old, future and undated days are never current', () => {
  // The window is 240 h from the day start: 2026-09-22 is 10 d 19 h old, 2026-09-23 is 9 d 19 h old.
  const old = parsePortwatch(one(LIVE['chokepoint1|Suez Canal'], '2026-09-22'), { now, chokepoints: ['Suez Canal'] });
  assert.equal(old.status, 'stale'); assert.deepEqual(old.observations, []); assert.equal(old.freshness.reason, 'expired-provider-time');
  const edge = parsePortwatch(one(LIVE['chokepoint1|Suez Canal'], '2026-09-23'), { now, chokepoints: ['Suez Canal'] });
  assert.equal(edge.status, 'ok', 'nine days and 19 hours is still inside the window');
  // A day that has not happened yet is neither the latest day nor part of the baseline.
  const payload = one(LIVE['chokepoint1|Suez Canal']);
  payload.features.unshift(feature('chokepoint1', 'Suez Canal', '2026-10-03', 1), feature('chokepoint1', 'Suez Canal', '2026-12-31', 1));
  const future = parsePortwatch(payload, { now, chokepoints: ['Suez Canal'] });
  assert.equal(future.observations[0].providerId, 'suez:2026-09-27'); assert.equal(future.observedAt, '2026-09-27T00:00:00.000Z');
  const onlyFuture = parsePortwatch({ features: [feature('chokepoint1', 'Suez Canal', '2026-10-09', 3)] }, { now, chokepoints: ['Suez Canal'] });
  assert.equal(onlyFuture.status, 'stale'); assert.equal(onlyFuture.observedAt, null);
  const undated = parsePortwatch({ features: [feature('chokepoint1', 'Suez Canal', undefined, 3)] }, { now, chokepoints: ['Suez Canal'] });
  assert.equal(undated.status, 'stale'); assert.deepEqual(undated.observations, []);
  assert.deepEqual(parsePortwatch(one(LIVE['chokepoint1|Suez Canal'], '2026-09-27'), { now: now + 8 * DAY, chokepoints: ['Suez Canal'] }).observations, []);
});

test('a chokepoint whose own latest day is too old drops out while the others stay', () => {
  const series = { 'chokepoint1|Suez Canal': LIVE['chokepoint1|Suez Canal'] };
  const payload = daily(series);
  for (const f of daily({ 'chokepoint6|Strait of Hormuz': LIVE['chokepoint6|Strait of Hormuz'] }, '2026-09-10').features) payload.features.push(f);
  const result = parsePortwatch(payload, { now, chokepoints: ['Suez Canal', 'Strait of Hormuz'] });
  assert.equal(result.status, 'ok'); assert.deepEqual(result.observations.map(r => r.chokepoint), ['suez']);
  assert.equal(result.rejectedObservations, 1);
});

test('only the configured chokepoints become observations, hostile names are inert', () => {
  const all = daily({ ...LIVE, 'chokepoint3|Bosporus Strait': LIVE['chokepoint9|Dover Strait'], 'chokepoint5|Malacca Strait': LIVE['chokepoint9|Dover Strait'],
    'chokepoint8|Gibraltar Strait': LIVE['chokepoint9|Dover Strait'], 'chokepoint7|Cape of Good Hope': LIVE['chokepoint9|Dover Strait'],
    'chokepoint11|Taiwan Strait': LIVE['chokepoint9|Dover Strait'] });
  const named = new Set(all.features.map(f => f.attributes.portname)); assert.ok(named.size >= 10, 'ten chokepoints in the payload');
  const result = parsePortwatch(all, { now, chokepoints: ['Strait of Hormuz', 'Suez Canal', 'Panama Canal'] });
  assert.deepEqual(result.observations.map(r => r.chokepoint).sort(), ['hormuz', 'panama', 'suez']);
  const default8 = parsePortwatch(all, { now });
  assert.deepEqual(default8.observations.map(r => r.chokepoint).sort(), ['bab_el_mandeb', 'bosporus', 'dover', 'gibraltar', 'hormuz', 'malacca', 'panama', 'suez'], 'the defaults are the eight named chokepoints');
  const hostile = daily({ '<img src=x onerror=alert(1)>': flat(5, 31) });
  hostile.features.forEach(f => { f.attributes.portid = 'chokepoint1'; f.attributes.portname = '<img src=x onerror=alert(1)>\u202E\u0007'; });
  assert.deepEqual(parsePortwatch(hostile, { now }).observations, []);
  assert.equal(parsePortwatch(hostile, { now, chokepoints: ['<img src=x onerror=alert(1)>'] }).status, 'error', 'a markup name is not a valid chokepoint');
  for (const name of ['a', "Suez' OR 1=1 --", 'Suez\u0000Canal', 'x'.repeat(200), '', 7, null, {}, 'Suez Canal; DROP']) assert.equal(parsePortwatch(all, { now, chokepoints: [name] }).status, 'error', String(name));
  for (const row of default8.observations) assert.doesNotMatch(JSON.stringify(row), /[<>\u0000-\u0008\u202E]/);
});

test('a name from the layer is matched case-insensitively and shown as the provider spells it', () => {
  const result = parsePortwatch(one(LIVE['chokepoint6|Strait of Hormuz'], LAST, ' Strait of Hormuz ', 'chokepoint6'), { now, chokepoints: ['strait of HORMUZ'] });
  assert.equal(result.observations.length, 1); assert.equal(result.observations[0].providerId, 'hormuz:2026-09-27');
  assert.equal(result.observations[0].title, 'Strait of Hormuz: 1 ship transit on 2026-09-27');
  const custom = parsePortwatch(one(flat(120, 31), LAST, 'Korea Strait', 'chokepoint12'), { now, chokepoints: ['Korea Strait'] });
  assert.equal(custom.observations[0].providerId, 'korea_strait:2026-09-27'); assert.equal(custom.observations[0].url, 'https://portwatch.imf.org/pages/chokepoint12');
});

test('severity follows the change against the 28-day median at the exact boundaries', () => {
  const cases = [[50, -50, 'high'], [49, -51, 'high'], [0, -100, 'high'], [51, -49, 'moderate'], [75, -25, 'moderate'], [76, -24, 'info'], [100, 0, 'info'], [250, 150, 'info']];
  for (const [latest, pct, severity] of cases) {
    const row = parseOne([...flat(100), latest]).observations[0];
    assert.equal(row.baseline28d, 100); assert.equal(row.changePct, pct, `latest ${latest}`); assert.equal(row.severity, severity, `latest ${latest}`);
    assert.equal(row.transitCalls, latest);
  }
  assert.match(parseOne([...flat(100), 0]).observations[0].title, /0 ship transits/);
});

test('the baseline is the median of exactly the previous 28 days', () => {
  const base = [...flat(100, 14), ...flat(0, 14)];
  const row = parseOne([100, ...base, 40]).observations[0];
  assert.equal(row.baseline28d, 50, 'even count averages the middle pair; the 29th day back is not part of it');
  assert.equal(row.changePct, -20);
  assert.equal(parseOne([...flat(10, 27), 90, 10]).observations[0].baseline28d, 10, 'median, not mean');
  const withGap = one([...flat(100, 20), 50]); // 21 consecutive days
  withGap.features = withGap.features.filter(f => f.attributes.date !== '2026-09-20');
  assert.equal(parsePortwatch(withGap, { now, chokepoints: ['Suez Canal'] }).observations[0].baseline28d, 100, 'missing days shrink the sample instead of counting as zero');
});

test('with fewer than 14 baseline days or a zero baseline no change is computed and the severity is info', () => {
  for (const baseline of [flat(100, 13), []]) {
    const row = parseOne([...baseline, 1]).observations[0];
    assert.equal(row.severity, 'info'); assert.equal(row.transitCalls, 1);
    assert.equal('baseline28d' in row, false); assert.equal('changePct' in row, false);
    assert.match(row.summary, /fewer than 14 baseline days/);
  }
  const enough = parseOne([...flat(100, 14), 1]).observations[0];
  assert.equal(enough.severity, 'high'); assert.equal(enough.baseline28d, 100); assert.equal(enough.changePct, -99);
  const zero = parseOne([...flat(0, 28), 5]).observations[0];
  assert.equal(zero.severity, 'info'); assert.equal(zero.baseline28d, 0); assert.equal('changePct' in zero, false);
});

test('provider ids are stable across parses and change only with the day', () => {
  const ids = payload => parsePortwatch(payload, { now }).observations.map(row => row.providerId);
  assert.deepEqual(ids(daily()), ids(daily())); assert.deepEqual(ids(JSON.parse(JSON.stringify(daily()))), ids(daily()));
  const reversed = daily(); reversed.features.reverse();
  assert.deepEqual([...ids(reversed)].sort(), [...ids(daily())].sort(), 'row order in the payload does not matter');
  const next = parsePortwatch(daily(LIVE, '2026-09-28'), { now: now + DAY }).observations.map(row => row.providerId);
  assert.deepEqual(next, ids(daily()).map(id => id.replace('2026-09-27', '2026-09-28')));
  const revised = daily(); revised.features.forEach(f => { f.attributes.n_total += 1; });
  assert.deepEqual([...ids(revised)].sort(), [...ids(daily())].sort(), 'a revised count keeps the identity');
  assert.equal(new Set(ids(daily())).size, ids(daily()).length);
});

test('a duplicated day keeps the first value and never doubles the sample', () => {
  const payload = one([...flat(100), 60]);
  payload.features.push(feature('chokepoint1', 'Suez Canal', LAST, 5), feature('chokepoint1', 'Suez Canal', '2026-09-26', 5));
  const row = parsePortwatch(payload, { now, chokepoints: ['Suez Canal'] }).observations[0];
  assert.equal(row.transitCalls, 60); assert.equal(row.baseline28d, 100);
});

test('coordinates come from the provider chokepoint layer only and are optional', () => {
  const places = parsePortwatchPlaces(PLACES);
  assert.deepEqual(places.chokepoint6, { lat: 26.29685349, lon: 56.85984844 });
  const located = hormuz(parsePortwatch(daily(), { now, chokepoints: ['Strait of Hormuz'], locations: places }));
  assert.equal(located.lat, 26.29685349); assert.equal(located.lon, 56.85984844);
  assert.equal(located.locationMethod, 'provider'); assert.equal(located.locationPrecision, 'approximate');
  const bare = hormuz(parsePortwatch(daily(), { now, chokepoints: ['Strait of Hormuz'], locations: { chokepoint1: places.chokepoint1 } }));
  for (const key of ['lat', 'lon', 'locationMethod', 'locationPrecision']) assert.equal(key in bare, false, key);
  const bad = parsePortwatchPlaces({ features: [
    { attributes: { portid: 'chokepoint6', lat: 91, lon: 5 } }, { attributes: { portid: 'chokepoint1', lat: 'x', lon: 5 } }, { attributes: { portid: '__proto__', lat: 1, lon: 1 } },
    { attributes: { portid: 'chokepoint2', lat: 1, lon: 181 } }, { attributes: { portid: 'chokepoint3', lat: null, lon: null } }, null, { attributes: null }, { attributes: { portid: 'chokepoint4', lat: 12.5, lon: 43.3 } }] });
  assert.deepEqual(Object.keys(bad), ['chokepoint4']);
  for (const payload of [null, [], 'x', {}, { features: 'x' }]) assert.deepEqual(parsePortwatchPlaces(payload), {});
});

test('observations survive the server normalization with their facts, location and the registered facts and home', () => {
  assert.deepEqual(FACT_FIELDS['IMF-PortWatch'], ['transitCalls', 'baseline28d', 'changePct']);
  assert.equal(HOME['IMF-PortWatch'], 'https://portwatch.imf.org/');
  assert.deepEqual(POLICIES['IMF-PortWatch'], { maxAgeMs: 240 * 3600000, observationMaxAgeMs: 240 * 3600000 });
  const keys = Object.keys(POLICIES); assert.equal(keys.indexOf('EMSC'), keys.indexOf('IMF-PortWatch') + 1, 'registered in the fixed order, IMF-PortWatch then EMSC');
  const raw = parsePortwatch(daily(), { now, chokepoints: ['Strait of Hormuz'], locations: parsePortwatchPlaces(PLACES) });
  const [out] = normalizeLiveSources({ 'IMF-PortWatch': raw }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://portwatch.imf.org/');
  assert.equal(out.observations.length, 1);
  const row = out.observations[0];
  assert.equal(row.kind, 'maritime'); assert.equal(row.severity, 'high'); assert.equal(row.lat, 26.29685349);
  assert.deepEqual(row.facts, [{ label: 'transitCalls', value: 1 }, { label: 'baseline28d', value: 3 }, { label: 'changePct', value: -66.7 }]);
  assert.deepEqual(out.metrics, { hormuz_transits: 1 });
  assert.match(out.attribution, /IMF PortWatch/); assert.match(out.license, /non-?commercial/i); assert.equal(out.licenseUrl, 'https://www.imf.org/external/terms.htm');
  assert.equal('chokepoint' in row, false, 'internal fields are dropped');
  const [thin] = normalizeLiveSources({ 'IMF-PortWatch': parseOne([...flat(100, 5), 7]) }, now);
  assert.deepEqual(thin.observations[0].facts, [{ label: 'transitCalls', value: 7 }]);
});

test('the default chokepoints in the config are the eight named ones, with the names the layer really uses', () => {
  const expected = ['Strait of Hormuz', 'Bab el-Mandeb Strait', 'Suez Canal', 'Malacca Strait', 'Bosporus Strait', 'Panama Canal', 'Gibraltar Strait', 'Dover Strait'];
  assert.deepEqual(config.publicSources.portwatchChokepoints, expected);
  assert.deepEqual(config.publicSources.ooniCountries, ['HU'], 'existing publicSources untouched');
});

test('briefing asks the layers for the watched chokepoints in two bounded requests and returns observations with coordinates', async () => {
  const seen = [];
  const result = await briefing({ now, chokepoints: ['Strait of Hormuz', 'Suez Canal'], fetcher: async (url, options) => { seen.push({ url: new URL(url), options }); return route(url); } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 2);
  const [dailyCall] = seen.filter(call => call.url.pathname.includes('Daily_Chokepoints_Data'));
  const [placesCall] = seen.filter(call => call.url.pathname.includes('PortWatch_chokepoints_database'));
  assert.ok(dailyCall && placesCall);
  for (const { url, options } of seen) {
    assert.equal(url.hostname, 'services9.arcgis.com'); assert.equal(url.searchParams.get('f'), 'json'); assert.equal(url.searchParams.get('returnGeometry'), 'false');
    assert.deepEqual({ ...options }, { timeout: 10000, retries: 0, maxBytes: 2 * MIB });
  }
  const where = dailyCall.url.searchParams.get('where');
  assert.match(where, /^portname IN \('Strait of Hormuz','Suez Canal'\) AND date >= DATE '2026-08-23'$/, '40 days back from the request time');
  assert.equal(dailyCall.url.searchParams.get('outFields'), 'date,portid,portname,n_total');
  assert.equal(placesCall.url.searchParams.get('where'), "portname IN ('Strait of Hormuz','Suez Canal')");
  assert.equal(hormuz(result).lat, 26.29685349); assert.equal(hormuz(result).providerId, 'hormuz:2026-09-27');
  assert.deepEqual(result.metrics, { hormuz_transits: 1, suez_transits: 37 });
  assert.equal((await briefing({ now, fetcher: async url => route(url) })).observations.length, 5, 'no option -> the eight defaults, five of them are in the fixture');
});

test('briefing rejects an invalid or empty chokepoint list before any request', async () => {
  let requests = 0; const fetcher = async () => { requests++; return daily(); };
  for (const chokepoints of [[], ['x'], ["Suez' OR 1=1"], 'Suez Canal', null, {}]) {
    const result = await briefing({ now, fetcher, chokepoints });
    assert.equal(result.status, 'error', JSON.stringify(chokepoints)); assert.deepEqual(result.observations, []);
  }
  assert.equal(requests, 0);
  const many = Array.from({ length: 40 }, (_, i) => `Port ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + (i % 20))}`);
  let queried;
  await briefing({ now, fetcher: async url => { queried ??= new URL(url).searchParams.get('where'); return daily(); }, chokepoints: many });
  assert.ok(queried.split("','").length <= 12, 'the watched list is capped');
});

test('briefing degrades every transport failure to an error result without a URL', async () => {
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'Request timed out after 10000ms' }, { error: 'Invalid JSON response', status: 200 }, { error: 'Response exceeds 2097152 byte limit' },
    { error: 'connect failed for https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/x?token=secret' }, [], null, 'text', { error: { code: 498, message: 'Invalid token https://x' } }];
  for (const payload of failures) {
    const result = await briefing({ now, fetcher: async () => payload });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:|arcgis.com|token|secret/i);
  }
  const thrown = await briefing({ now, fetcher: async () => { throw new Error('connect ECONNREFUSED https://services9.arcgis.com/?token=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|arcgis.com|token|secret|ECONNREFUSED/i);
  const syncThrow = await briefing({ now, fetcher: () => { throw new Error('boom https://x'); } });
  assert.equal(syncThrow.status, 'error');
});

test('a failing coordinates request does not fail the observations', async () => {
  const result = await briefing({ now, chokepoints: ['Strait of Hormuz'], fetcher: async url => String(url).includes('PortWatch_chokepoints_database') ? { error: 'HTTP 503' } : daily() });
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 1); assert.equal('lat' in result.observations[0], false);
});

test('briefing over the real fetch helper degrades 503, timeout, an oversized body, invalid JSON and an ArcGIS error to error results', async () => {
  const cases = {
    '503': () => reply('down', { status: 503 }),
    'timeout': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    'oversized': () => reply('x'.repeat(2 * MIB + 1)),
    'invalid json': () => reply('<html>not json</html>'),
    'arcgis error': () => reply({ error: { code: 400, message: 'Unable to complete operation.', details: [] } }),
    'network': () => Promise.reject(new TypeError('fetch failed')),
  };
  for (const [name, impl] of Object.entries(cases)) {
    const result = await withFetch(impl, () => briefing({ now, timeout: 25, chokepoints: ['Suez Canal'] }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name);
    assert.doesNotMatch(result.error, /https?:|arcgis\.com/i, name);
  }
  const timed = await withFetch(cases.timeout, () => briefing({ now, timeout: 25, chokepoints: ['Suez Canal'] }));
  assert.match(timed.error, /timed out/i);
  const big = await withFetch(cases.oversized, () => briefing({ now, timeout: 1000, chokepoints: ['Suez Canal'] }));
  assert.match(big.error, /exceeds|limit/i);
  const requested = [];
  const ok = await withFetch(async (url, init) => { requested.push(String(url)); return reply(route(url)); }, () => briefing({ now, chokepoints: ['Strait of Hormuz', 'Suez Canal'], useCache: false }));
  assert.equal(ok.status, 'ok'); assert.equal(requested.length, 2); assert.equal(hormuz(ok).lat, 26.29685349);
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await briefing({ now, timeout, chokepoints: ['Suez Canal'], fetcher: async (url, options) => { seen.push(options.timeout); return route(url); } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000);
});

test('the cache serves a fresh result within six hours and refreshes after, remembers only ok results and revalidates age', async () => {
  const names = ['Strait of Hormuz', 'Panama Canal'];
  let requests = 0; const fetcher = async url => { requests++; return route(url); };
  const first = await briefing({ now, fetcher, useCache: true, chokepoints: names });
  assert.equal(first.status, 'ok'); assert.equal(requests, 2);
  const again = await briefing({ now: now + 5 * 3600000, fetcher, useCache: true, chokepoints: names });
  assert.equal(requests, 2, 'no request inside the TTL'); assert.equal(again.status, 'ok'); assert.deepEqual(again.observations.map(r => r.providerId), first.observations.map(r => r.providerId));
  assert.equal(again.timestamp, new Date(now + 5 * 3600000).toISOString(), 'the result is stamped with the current time');
  const refreshed = await briefing({ now: now + 6 * 3600000, fetcher, useCache: true, chokepoints: names });
  assert.equal(requests, 4, 'both layers are refreshed after the TTL'); assert.equal(refreshed.status, 'ok');
  const otherList = await briefing({ now: now + 6 * 3600000, fetcher, useCache: true, chokepoints: ['Suez Canal'] });
  assert.equal(requests, 6, 'another chokepoint list does not share an entry'); assert.equal(otherList.observations.length, 1);
  const expired = await briefing({ now: now + 11 * DAY, fetcher: async () => ({ error: 'HTTP 503' }), useCache: true, chokepoints: names });
  assert.equal(expired.status, 'error', 'an expired cache entry is never served as fresh fallback'); assert.deepEqual(expired.observations, []);
  const clock = await briefing({ now: now - 3600000, fetcher, useCache: true, chokepoints: names });
  assert.equal(requests >= 8, true, 'a clock that moved backwards does not trust the entry'); assert.equal(clock.status, 'ok');
});

test('failures and stale results are not cached, and an injected fetcher bypasses the cache by default', async () => {
  const names = ['Bab el-Mandeb Strait'];
  let requests = 0; let payload = { error: 'HTTP 503' };
  const fetcher = async url => { requests++; return String(url).includes('PortWatch_chokepoints_database') ? PLACES : payload; };
  assert.equal((await briefing({ now, fetcher, useCache: true, chokepoints: names })).status, 'error');
  payload = { features: [] };
  assert.equal((await briefing({ now, fetcher, useCache: true, chokepoints: names })).status, 'stale');
  payload = daily();
  const before = requests;
  assert.equal((await briefing({ now, fetcher, useCache: true, chokepoints: names })).status, 'ok');
  assert.equal(requests - before, 1, 'the failure and the empty answer left no daily entry behind (the coordinates are cached)');
  const bypass = requests;
  await briefing({ now, fetcher, chokepoints: names }); await briefing({ now, fetcher, chokepoints: names });
  assert.equal(requests - bypass, 4, 'an injected fetcher means no cache unless asked');
  const other = async url => { requests++; return route(url); };
  const beforeOther = requests;
  await briefing({ now, fetcher: other, useCache: true, chokepoints: names });
  assert.equal(requests - beforeOther, 2, 'a different fetcher does not read another fetcher\'s entry');
});

test('the cache is bounded and evicts the oldest entries first', async () => {
  const name = i => `Test Strait ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`;
  let requests = 0;
  const fetcher = async url => {
    requests++;
    const listed = /'([^']+)'/.exec(new URL(url).searchParams.get('where'))[1];
    return String(url).includes('PortWatch_chokepoints_database') ? { features: [{ attributes: { portid: 'chokepoint1', lat: 1, lon: 2 } }] } : daily({ [`chokepoint1|${listed}`]: flat(10, 31) });
  };
  for (let i = 0; i < 40; i++) assert.equal((await briefing({ now, useCache: true, fetcher, chokepoints: [name(i)] })).status, 'ok');
  requests = 0;
  await briefing({ now, useCache: true, fetcher, chokepoints: [name(39)] });
  assert.equal(requests, 0, 'the newest list is still cached');
  await briefing({ now, useCache: true, fetcher, chokepoints: [name(0)] });
  assert.ok(requests > 0, 'the oldest list was evicted');
});
