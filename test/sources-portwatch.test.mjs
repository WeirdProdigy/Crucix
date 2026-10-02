import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortwatch, parsePortwatchPlaces, briefing } from '../apis/sources/portwatch.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import config from '../crucix.config.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('parse turns the latest day of each chokepoint into a maritime observation with its 7-day mean and 28-day baseline', () => {
  const result = parsePortwatch(daily(), { now, chokepoints: ['Suez Canal', 'Bab el-Mandeb Strait', 'Strait of Hormuz'] });
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'IMF-PortWatch');
  assert.equal(result.observedAt, '2026-09-27T00:00:00.000Z');
  assert.equal(result.observations.length, 3);
  const row = hormuz(result);
  assert.equal(row.kind, 'maritime'); assert.equal(row.source, 'IMF-PortWatch');
  assert.equal(row.providerId, 'hormuz:2026-09-27'); assert.equal(row.observedAt, '2026-09-27T00:00:00.000Z');
  // Real Hormuz series: 1 transit on the latest day, but a 7-day mean of 3.1 against a median of 3: no alarm (the single day alone looked like -66.7 %).
  assert.equal(row.transitCalls, 1); assert.equal(row.mean7d, 3.1); assert.equal(row.baseline28d, 3); assert.equal(row.changePct, 3.3);
  assert.equal(row.severity, 'info');
  assert.equal(row.url, 'https://portwatch.imf.org/pages/chokepoint6?date=2026-09-27');
  assert.equal(row.title, 'Strait of Hormuz: 1 ship transit on 2026-09-27');
  const suez = result.observations.find(r => r.chokepoint === 'suez');
  assert.equal(suez.transitCalls, 37); assert.equal(suez.mean7d, 40); assert.equal(suez.baseline28d, 40.5); assert.equal(suez.changePct, -1.2); assert.equal(suez.severity, 'info');
  const bab = result.observations.find(r => r.chokepoint === 'bab_el_mandeb');
  assert.equal(bab.transitCalls, 27); assert.equal(bab.mean7d, 27.1); assert.equal(bab.baseline28d, 25); assert.equal(bab.changePct, 8.4); assert.equal(bab.severity, 'info');
  assert.equal(bab.url, 'https://portwatch.imf.org/pages/chokepoint4?date=2026-09-27');
  assert.deepEqual(result.observations.map(r => r.chokepoint), ['suez', 'bab_el_mandeb', 'hormuz'], 'equal severities keep the configured order');
  for (const key of ['lat', 'lon', 'locationMethod', 'publishedAt']) assert.equal(key in row, false, `${key} is not invented`);
});

test('the most severe observation comes first, then the configured order', () => {
  const series = { 'chokepoint1|Suez Canal': flat(100, 35), 'chokepoint4|Bab el-Mandeb Strait': [...flat(100, 28), ...flat(70, 7)], 'chokepoint6|Strait of Hormuz': [...flat(100, 28), ...flat(40, 7)], 'chokepoint2|Panama Canal': flat(100, 35) };
  const result = parsePortwatch(daily(series), { now, chokepoints: ['Suez Canal', 'Bab el-Mandeb Strait', 'Panama Canal', 'Strait of Hormuz'] });
  assert.deepEqual(result.observations.map(r => `${r.chokepoint}:${r.severity}`), ['hormuz:high', 'bab_el_mandeb:moderate', 'suez:info', 'panama:info']);
});

test('rows and the feed explain that counts are AIS-visible transits and that dark ships are missing', () => {
  const result = parsePortwatch(daily(), { now, chokepoints: ['Strait of Hormuz'] });
  assert.match(result.summary, /AIS/); assert.match(result.summary, /dark|AIS-off/i); assert.match(result.summary, /not counted/i);
  assert.match(result.summary, /7-day mean against the previous 28-day median/);
  assert.match(hormuz(result).summary, /AIS-visible/); assert.match(hormuz(result).summary, /dark or AIS-off ships are not counted/i);
  assert.match(hormuz(result).summary, /7-day mean is 3\.1 against a median of 3 over the previous 28 days \(\+3\.3%\)/);
});

test('metrics carry the 7-day mean of every configured chokepoint and nothing when the window is thin', () => {
  const result = parsePortwatch(daily(), { now, chokepoints: ['Strait of Hormuz', 'Suez Canal', 'Bab el-Mandeb Strait', 'Dover Strait', 'Panama Canal'] });
  assert.deepEqual(result.metrics, { hormuz_transits: 3.1, suez_transits: 40, bab_el_mandeb_transits: 27.1, dover_transits: 172.3, panama_transits: 27 });
  assert.deepEqual(parsePortwatch(daily(), { now, chokepoints: ['Dover Strait'] }).metrics, { dover_transits: 172.3 });
  assert.deepEqual(parsePortwatch({ features: [] }, { now }).metrics, {});
  assert.deepEqual(parsePortwatch(one(flat(10, 4)), { now, chokepoints: ['Suez Canal'] }).metrics, {}, 'fewer than 5 days: no metric, not a guess');
  assert.deepEqual(parsePortwatch(one(flat(10, 5)), { now, chokepoints: ['Suez Canal'] }).metrics, { suez_transits: 10 });
  assert.deepEqual(parsePortwatch(one(flat(10, 40), '2026-09-21'), { now, chokepoints: ['Suez Canal'] }).metrics, {}, 'an expired series has no metric');
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
  assert.equal(custom.observations[0].providerId, 'korea_strait:2026-09-27'); assert.equal(custom.observations[0].url, 'https://portwatch.imf.org/pages/chokepoint12?date=2026-09-27');
});

// Seven daily values after 28 baseline days: the window is the last 7 calendar days, the baseline the 28 before it.
const rate = (mean, base = 100) => parseOne([...flat(base, 28), ...flat(mean, 7)]).observations[0];

test('severity follows the 7-day mean against the previous 28-day median at the exact boundaries', () => {
  const cases = [[50, -50, 'high'], [49, -51, 'high'], [0, -100, 'high'], [51, -49, 'moderate'], [75, -25, 'moderate'], [76, -24, 'info'], [100, 0, 'info'], [250, 150, 'info']];
  for (const [mean, pct, severity] of cases) {
    const row = rate(mean);
    assert.equal(row.baseline28d, 100); assert.equal(row.mean7d, mean); assert.equal(row.changePct, pct, `mean ${mean}`); assert.equal(row.severity, severity, `mean ${mean}`);
    assert.equal(row.transitCalls, mean);
  }
  assert.match(rate(0).title, /0 ship transits/);
});

test('one bad day does not rate a chokepoint: the window mean does', () => {
  const row = parseOne([...flat(100, 28), ...flat(100, 6), 0]).observations[0];
  assert.equal(row.transitCalls, 0); assert.equal(row.mean7d, 85.7); assert.equal(row.changePct, -14.3); assert.equal(row.severity, 'info');
  assert.match(row.title, /0 ship transits/);
  const week = parseOne([...flat(100, 28), 100, 100, 0, 0, 0, 0, 0]).observations[0];
  assert.equal(week.transitCalls, 0); assert.equal(week.mean7d, 28.6); assert.equal(week.severity, 'high');
});

test('no severity is rated when the baseline is below 3 transits a day', () => {
  const low = [[3, 1, -66.7, 'high'], [2.5, 0, -100, 'info'], [2, 0, -100, 'info'], [1, 0, -100, 'info']];
  for (const [baseline, mean, pct, severity] of low) {
    const base = baseline === 2.5 ? [...flat(2, 14), ...flat(3, 14)] : flat(baseline, 28);
    const row = parseOne([...base, ...flat(mean, 7)]).observations[0];
    assert.equal(row.baseline28d, baseline); assert.equal(row.changePct, pct, `baseline ${baseline}`); assert.equal(row.severity, severity, `baseline ${baseline}`);
    if (severity === 'info') assert.match(row.summary, /baseline is below 3 transits a day, too low to rate a change/);
    else assert.doesNotMatch(row.summary, /too low to rate/);
  }
  assert.equal(parseOne([...flat(3, 28), ...flat(2, 7)]).observations[0].severity, 'moderate', 'a baseline of exactly 3 is rated');
});

test('the window is the last 7 calendar days and the baseline the 28 days before it', () => {
  const edge = parseOne([...flat(100, 27), 10000, ...flat(10, 7)]).observations[0];
  assert.equal(edge.mean7d, 10, 'the day just before the window belongs to the baseline'); assert.equal(edge.baseline28d, 100); assert.equal(edge.changePct, -90);
  const base = [...flat(100, 14), ...flat(0, 14)];
  const row = parseOne([100, ...base, ...flat(40, 7)]).observations[0];
  assert.equal(row.baseline28d, 50, 'even count averages the middle pair; the 35th day back is not part of the baseline');
  assert.equal(row.mean7d, 40); assert.equal(row.changePct, -20);
  assert.equal(parseOne([...flat(10, 27), 90, ...flat(10, 7)]).observations[0].baseline28d, 10, 'median, not mean');
  const withGap = one([...flat(100, 20), ...flat(100, 7)]);
  withGap.features = withGap.features.filter(f => f.attributes.date !== '2026-09-10');
  assert.equal(parsePortwatch(withGap, { now, chokepoints: ['Suez Canal'] }).observations[0].baseline28d, 100, 'missing days shrink the sample instead of counting as zero');
});

test('a window needs at least 5 of its 7 days and a baseline at least 14 days, else nothing is computed', () => {
  const drop = (series, ...days) => { const payload = one(series); payload.features = payload.features.filter(f => !days.includes(f.attributes.date)); return payload; };
  const parse = payload => parsePortwatch(payload, { now, chokepoints: ['Suez Canal'] }).observations[0];
  const full = [...flat(100, 28), ...flat(10, 7)];
  const five = parse(drop(full, '2026-09-26', '2026-09-24'));
  assert.equal(five.mean7d, 10); assert.equal(five.severity, 'high');
  const four = parse(drop(full, '2026-09-26', '2026-09-24', '2026-09-23'));
  assert.equal('mean7d' in four, false); assert.equal('changePct' in four, false); assert.equal(four.baseline28d, 100); assert.equal(four.severity, 'info');
  assert.equal(four.transitCalls, 10); assert.match(four.summary, /fewer than 5 of the last 7 days/);
  for (const baseline of [flat(100, 13), []]) {
    const row = parseOne([...baseline, ...flat(1, 7)]).observations[0];
    assert.equal(row.severity, 'info'); assert.equal(row.transitCalls, 1); assert.equal(row.mean7d, 1);
    assert.equal('baseline28d' in row, false); assert.equal('changePct' in row, false);
    assert.match(row.summary, /fewer than 14 baseline days/);
  }
  const enough = parseOne([...flat(100, 14), ...flat(1, 7)]).observations[0];
  assert.equal(enough.severity, 'high'); assert.equal(enough.baseline28d, 100); assert.equal(enough.changePct, -99);
  const zero = parseOne([...flat(0, 28), ...flat(5, 7)]).observations[0];
  assert.equal(zero.severity, 'info'); assert.equal(zero.baseline28d, 0); assert.equal(zero.mean7d, 5); assert.equal('changePct' in zero, false);
});

test('custom slugs never collide with the fixed ones or with each other', () => {
  const series = {
    'chokepoint6|Strait of Hormuz': flat(10, 35), 'chokepoint21|Hormuz': flat(11, 35), 'chokepoint22|Foo-Bar': flat(12, 35), 'chokepoint23|Foo Bar': flat(13, 35), 'chokepoint24|Foo.Bar': flat(14, 35),
  };
  const names = ['Hormuz', 'Strait of Hormuz', 'Foo-Bar', 'Foo Bar', 'Foo.Bar'];
  const result = parsePortwatch(daily(series), { now, chokepoints: names });
  const ids = result.observations.map(row => row.providerId);
  assert.deepEqual(ids, ['hormuz_2:2026-09-27', 'hormuz:2026-09-27', 'foo_bar:2026-09-27', 'foo_bar_2:2026-09-27', 'foo_bar_3:2026-09-27'], 'the fixed slug stays with the real Hormuz even when a custom name comes first');
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual(Object.keys(result.metrics), ['hormuz_2_transits', 'hormuz_transits', 'foo_bar_transits', 'foo_bar_2_transits', 'foo_bar_3_transits']);
  assert.equal(result.metrics.hormuz_transits, 10, 'the hormuz metric is the real Strait of Hormuz');
  assert.deepEqual(parsePortwatch(daily(series), { now, chokepoints: names }).observations.map(row => row.providerId), ids, 'deterministic');
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
  const payload = one([...flat(100, 34), 60]);
  payload.features.push(feature('chokepoint1', 'Suez Canal', LAST, 5), feature('chokepoint1', 'Suez Canal', '2026-09-26', 5));
  const row = parsePortwatch(payload, { now, chokepoints: ['Suez Canal'] }).observations[0];
  assert.equal(row.transitCalls, 60); assert.equal(row.mean7d, 94.3); assert.equal(row.baseline28d, 100);
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
  assert.deepEqual(FACT_FIELDS['IMF-PortWatch'], ['transitCalls', 'mean7d', 'baseline28d', 'changePct']);
  assert.equal(HOME['IMF-PortWatch'], 'https://portwatch.imf.org/');
  assert.deepEqual(POLICIES['IMF-PortWatch'], { maxAgeMs: 240 * 3600000, observationMaxAgeMs: 240 * 3600000 });
  const keys = Object.keys(POLICIES); assert.equal(keys.indexOf('EMSC'), keys.indexOf('IMF-PortWatch') + 1, 'registered in the fixed order, IMF-PortWatch then EMSC');
  const raw = parsePortwatch(one([...flat(100, 28), ...flat(40, 7)], LAST, 'Strait of Hormuz', 'chokepoint6'), { now, chokepoints: ['Strait of Hormuz'], locations: parsePortwatchPlaces(PLACES) });
  const [out] = normalizeLiveSources({ 'IMF-PortWatch': raw }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://portwatch.imf.org/');
  assert.equal(out.observations.length, 1);
  const row = out.observations[0];
  assert.equal(row.kind, 'maritime'); assert.equal(row.severity, 'high'); assert.equal(row.lat, 26.29685349);
  assert.equal(row.url, 'https://portwatch.imf.org/pages/chokepoint6?date=2026-09-27');
  assert.deepEqual(row.facts, [{ label: 'transitCalls', value: 40 }, { label: 'mean7d', value: 40 }, { label: 'baseline28d', value: 100 }, { label: 'changePct', value: -60 }]);
  assert.deepEqual(out.metrics, { hormuz_transits: 40 });
  assert.match(out.attribution, /IMF PortWatch/); assert.match(out.license, /non-?commercial/i); assert.equal(out.licenseUrl, 'https://www.imf.org/external/terms.htm');
  assert.equal('chokepoint' in row, false, 'internal fields are dropped');
  const [thin] = normalizeLiveSources({ 'IMF-PortWatch': parseOne([...flat(100, 3), 7]) }, now);
  assert.deepEqual(thin.observations[0].facts, [{ label: 'transitCalls', value: 7 }], 'no mean, baseline or change from a thin series');
  assert.deepEqual(thin.metrics, {});
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
  assert.match(where, /^portname IN \('Strait of Hormuz','Suez Canal'\) AND date >= DATE '2026-08-17'$/, '46 days back from the request time: 7-day window + 28-day baseline + up to ~10 days of provider lag');
  assert.equal(dailyCall.url.searchParams.get('outFields'), 'date,portid,portname,n_total');
  assert.equal(placesCall.url.searchParams.get('where'), "portname IN ('Strait of Hormuz','Suez Canal')");
  assert.equal(hormuz(result).lat, 26.29685349); assert.equal(hormuz(result).providerId, 'hormuz:2026-09-27');
  assert.deepEqual(result.metrics, { hormuz_transits: 3.1, suez_transits: 40 });
  assert.equal((await briefing({ now, fetcher: async url => route(url) })).observations.length, 5, 'no option -> the eight defaults, five of them are in the fixture');
});

test('briefing rejects an invalid or empty chokepoint list before any request', async () => {
  let requests = 0; const fetcher = async () => { requests++; return daily(); };
  for (const chokepoints of [[], ['x'], ["Suez' OR 1=1"], ["Foo' OR 'a"], ["Foo'Bar"], ['Foo" OR "a'], 'Suez Canal', null, {}]) {
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

test('the cache holds exactly 16 entries (8 chokepoint lists of two layers) and evicts the oldest first', async () => {
  const name = i => `Test Strait ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`;
  let requests = 0;
  const fetcher = async url => {
    requests++;
    const listed = /'([^']+)'/.exec(new URL(url).searchParams.get('where'))[1];
    return String(url).includes('PortWatch_chokepoints_database') ? { features: [{ attributes: { portid: 'chokepoint1', lat: 1, lon: 2 } }] } : daily({ [`chokepoint1|${listed}`]: flat(10, 35) });
  };
  const call = i => briefing({ now, useCache: true, fetcher, chokepoints: [name(i)] });
  for (let i = 0; i < 9; i++) assert.equal((await call(i)).status, 'ok');
  assert.equal(requests, 18);
  requests = 0;
  for (let i = 1; i < 9; i++) await call(i);
  assert.equal(requests, 0, 'the eight newest lists (16 entries) are all still cached: the bound is not smaller than 16');
  await call(0);
  assert.equal(requests, 2, 'the oldest list was evicted by the ninth: the bound is not larger than 16');
});

test('a failing or empty coordinates answer is not cached and the next call asks again', async () => {
  const names = ['Gibraltar Strait'], log = [];
  let places = { error: 'HTTP 503' };
  const fetcher = async url => {
    const layer = String(url).includes('PortWatch_chokepoints_database') ? 'places' : 'daily'; log.push(layer);
    return layer === 'places' ? places : daily({ 'chokepoint8|Gibraltar Strait': flat(100, 35) });
  };
  const call = () => briefing({ now, fetcher, useCache: true, chokepoints: names });
  const first = await call();
  assert.equal(first.status, 'ok'); assert.equal('lat' in first.observations[0], false); assert.deepEqual(log.sort(), ['daily', 'places']);
  log.length = 0; places = { features: [] };
  const second = await call();
  assert.equal(second.status, 'ok'); assert.equal('lat' in second.observations[0], false); assert.deepEqual(log, ['places'], 'the daily answer is cached, the failed coordinates are asked again');
  log.length = 0; places = { features: [{ attributes: { portid: 'chokepoint8', lat: 35.94227416, lon: -5.754895722 } }] };
  const third = await call();
  assert.equal(third.observations[0].lat, 35.94227416); assert.deepEqual(log, ['places']);
  log.length = 0;
  const fourth = await call();
  assert.equal(fourth.observations[0].lat, 35.94227416); assert.deepEqual(log, [], 'the good coordinates are cached now');
});

test('twelve watched chokepoints over the whole history window stay under the layer page size and the examined cap', async () => {
  const names = Array.from({ length: 12 }, (_, i) => `Test ${String.fromCharCode(65 + i)} Strait`);
  let since;
  const series = {};
  names.forEach((name, i) => { series[`chokepoint${i + 1}|${name}`] = flat(20 + i, 47); });
  const payload = daily(series, '2026-10-02');
  const result = await briefing({ now, chokepoints: names, fetcher: async url => {
    const where = new URL(url).searchParams.get('where'); since ??= /date >= DATE '([\d-]+)'/.exec(where)?.[1];
    return route(url, payload);
  } });
  const days = (Date.parse('2026-10-02') - Date.parse(since)) / DAY + 1;
  assert.equal(days, 47); assert.equal(payload.features.length, 12 * days);
  assert.ok(payload.features.length < 1000, 'under the layer page size (maxRecordCount 1000)'); assert.ok(payload.features.length < 2000, 'under the examined cap');
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 12);
  assert.ok(result.observations.every(row => row.mean7d !== undefined && row.baseline28d !== undefined), 'every chokepoint has its full window and baseline');
});

test('history keeps one record per chokepoint and day: the deep link and the identity are day-specific', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-portwatch-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { value: now + 5 * DAY };
  const history = new HistoryStore(dir, { now: () => clock.value });
  const series = { 'chokepoint1|Suez Canal': flat(40, 35), 'chokepoint2|Panama Canal': flat(25, 35) };
  const eventsFor = (last, at) => {
    const raw = parsePortwatch(daily(series, last), { now: at, chokepoints: ['Suez Canal', 'Panama Canal'] });
    return buildEvents({ meta: { timestamp: new Date(at).toISOString() }, liveSources: normalizeLiveSources({ 'IMF-PortWatch': raw }, at) }, { now: at });
  };
  const dayOne = eventsFor('2026-09-27', now), dayTwo = eventsFor('2026-09-28', now + DAY), sameDayLater = eventsFor('2026-09-28', now + DAY + 3600000);
  assert.equal(dayOne.length, 2); assert.equal(dayTwo.length, 2);
  assert.deepEqual(dayOne.map(event => event.source.url).sort(), ['https://portwatch.imf.org/pages/chokepoint1?date=2026-09-27', 'https://portwatch.imf.org/pages/chokepoint2?date=2026-09-27']);
  assert.equal(new Set([...dayOne, ...dayTwo].map(event => event.id)).size, 4, 'four different event ids');
  assert.equal(new Set([...dayOne, ...dayTwo].map(event => event.source.url)).size, 4, 'four different deep links');
  assert.deepEqual(history.add(dayOne), { added: 2, updated: 0, ignored: 0, total: 2 });
  assert.deepEqual(history.add(dayTwo), { added: 2, updated: 0, ignored: 0, total: 4 }, 'the next day adds records instead of overwriting the first');
  assert.deepEqual(history.add(sameDayLater), { added: 0, updated: 2, ignored: 0, total: 4 }, 'the same day again updates the same two records');
  assert.equal(history.query({ source: 'IMF-PortWatch' }).total, 4);
  assert.deepEqual(sameDayLater.map(event => event.id).sort(), dayTwo.map(event => event.id).sort(), 'the event id of a day is stable across sweeps');
});

test('hostile oversized strings cannot stall the parser', { timeout: 10000 }, () => {
  const started = Date.now();
  const huge = 2000000;
  parsePortwatch({ error: 'http://'.repeat(huge / 7) }, { now });
  parsePortwatch({ error: '<'.repeat(huge) }, { now });
  parsePortwatch({ error: 'x'.repeat(huge) }, { now });
  const features = [feature('chokepoint1', 'Suez Canal' + ' '.repeat(huge), LAST, 5), feature('chokepoint1', '_'.repeat(huge), LAST, 5), feature('chokepoint1', '<a '.repeat(huge / 3), LAST, 5)];
  assert.equal(parsePortwatch({ features }, { now, chokepoints: ['Suez Canal'] }).status, 'stale');
  for (const name of ['_'.repeat(huge) + 'a', '<a '.repeat(huge / 3), 'a'.repeat(huge), ' '.repeat(huge) + 'Suez Canal']) assert.equal(parsePortwatch(daily(), { now, chokepoints: [name] }).status, 'error');
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});
