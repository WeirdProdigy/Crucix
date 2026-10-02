import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpensanctionsIndex, briefing } from '../apis/sources/opensanctions-index.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const now = Date.parse('2026-10-02T22:10:00Z');
const HOUR = 3600000, DAY = 24 * HOUR, MINUTE = 60000;
const MIB = 1024 * 1024;
const iso = ms => new Date(ms).toISOString();
// The index writes UTC without a zone designator.
const bare = ms => iso(ms).slice(0, 19);
const rtl = String.fromCharCode(0x202e), zero = String.fromCharCode(0x200b), bell = String.fromCharCode(7), nul = String.fromCharCode(0);

// Real dataset records captured from https://data.opensanctions.org/datasets/latest/index.json on 2026-10-02 (index run_time 2026-10-02T22:01:55,
// 485 datasets, 2,097,762 bytes). Trimmed to the fields the adapter can use; the values are not edited.
const US_OFAC_SDN = {"name":"us_ofac_sdn","title":"US OFAC Specially Designated Nationals (SDN) List","updated_at":"2026-10-02T20:10:05","last_export":"2026-10-02T20:10:05","entity_count":72739,"thing_count":38426,"version":"20261002201005-cav","type":"source","last_change":"2026-10-02T16:10:04"};
const EU_FSF = {"name":"eu_fsf","title":"EU Financial Sanctions Files (FSF)","updated_at":"2026-10-02T20:57:04","last_export":"2026-10-02T20:57:04","entity_count":15965,"thing_count":8264,"version":"20261002205704-fsg","type":"source","last_change":"2026-09-22T18:57:01"};
const UN_SC_SANCTIONS = {"name":"un_sc_sanctions","title":"UN Security Council Consolidated Sanctions","updated_at":"2026-10-02T20:01:05","last_export":"2026-10-02T20:01:05","entity_count":2926,"thing_count":1407,"version":"20261002200105-gvp","type":"source","last_change":"2026-10-01T00:01:01"};
const GB_FCDO_SANCTIONS = {"name":"gb_fcdo_sanctions","title":"UK FCDO Sanctions List","updated_at":"2026-10-02T20:40:04","last_export":"2026-10-02T20:40:04","entity_count":18646,"thing_count":7007,"version":"20261002204004-nbw","type":"source","last_change":"2026-10-02T09:30:30"};
const US_BIS_DENIED = {"name":"us_bis_denied","title":"US BIS Denied Persons List","updated_at":"2026-10-02T16:57:04","last_export":"2026-10-02T16:57:04","entity_count":896,"thing_count":385,"version":"20261002165704-nlr","type":"source","last_change":"2026-09-28T12:53:59"};
const US_TRADE_CSL = {"name":"us_trade_csl","title":"US Trade Consolidated Screening List (CSL)","updated_at":"2026-10-02T21:53:04","last_export":"2026-10-02T21:53:04","entity_count":30594,"thing_count":24328,"version":"20261002215304-ify","type":"source","last_change":"2026-10-02T18:53:06"};
// Datasets that are not watched: a list that did not change for 18 days, a small list and an external dataset about OFAC press releases.
const US_OFAC_CONS = {"name":"us_ofac_cons","title":"US OFAC Consolidated (non-SDN) List","updated_at":"2026-10-02T20:35:04","last_export":"2026-10-02T20:35:04","entity_count":2046,"thing_count":1256,"version":"20261002203504-mpj","type":"source","last_change":"2026-09-14T20:35:01"};
const US_BIS_MIEU = {"name":"us_bis_mieu","title":"US BIS Military-Intelligence End Users","updated_at":"2026-10-02T07:30:01","last_export":"2026-10-02T07:30:01","entity_count":26,"thing_count":13,"version":"20261002073001-kxe","type":"source","last_change":"2026-07-27T10:56:38"};
const EXT_US_OFAC_PRESS_RELEASES = {"name":"ext_us_ofac_press_releases","title":"US OFAC Press Releases","updated_at":"2026-10-02T16:04:05","last_export":"2026-10-02T16:04:05","entity_count":18017,"thing_count":9095,"version":"20261002160405-dff","type":"external","last_change":"2026-09-27T16:05:30"};
const RUN_TIME = '2026-10-02T22:01:55';
const WATCHED = [US_OFAC_SDN, EU_FSF, UN_SC_SANCTIONS, GB_FCDO_SANCTIONS, US_BIS_DENIED, US_TRADE_CSL];
const LIVE = { run_time: RUN_TIME, datasets: [US_OFAC_CONS, US_OFAC_SDN, EXT_US_OFAC_PRESS_RELEASES, EU_FSF, UN_SC_SANCTIONS, GB_FCDO_SANCTIONS, US_BIS_MIEU, US_BIS_DENIED, US_TRADE_CSL] };
const NEWEST_FIRST = ['us_trade_csl', 'us_ofac_sdn', 'gb_fcdo_sanctions', 'un_sc_sanctions', 'us_bis_denied', 'eu_fsf'];

const index = (datasets, extra = {}) => ({ run_time: RUN_TIME, datasets, ...extra });
const copy = (entry, props = {}) => ({ ...JSON.parse(JSON.stringify(entry)), ...props });
const parse = (payload, options) => parseOpensanctionsIndex(payload, { now, previous: new Map(), ...options });
const only = (entry, props, options) => parse(index([copy(entry, props)]), { datasets: [entry.name], ...options });
const first = (entry, props, options) => only(entry, props, options).observations[0];
const brief = options => briefing({ now, previous: new Map(), useCache: false, ...options });
const ids = result => result.observations.map(row => row.providerId.split(':')[1]);
const withFetch = async (impl, run) => {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
};
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });

test('parse turns the live index into one observation per watched list that changed in the last 14 days, newest change first', () => {
  const result = parse(LIVE);
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'OpenSanctions-Index');
  assert.equal(result.observedAt, '2026-10-02T22:01:55.000Z', 'the feed time is the index generation time');
  assert.deepEqual(ids(result), NEWEST_FIRST, 'unwatched lists are ignored');
  const row = result.observations.find(r => r.providerId.includes('us_ofac_sdn'));
  assert.equal(row.kind, 'sanctions'); assert.equal(row.source, 'OpenSanctions-Index');
  assert.equal(row.providerId, 'os:us_ofac_sdn:20261002T161004Z');
  assert.equal(row.title, 'US OFAC Specially Designated Nationals (SDN) List: list updated');
  assert.equal(row.observedAt, '2026-10-02T16:10:04.000Z', 'the change time is read as UTC');
  assert.equal(row.severity, 'info'); assert.equal(row.thingCount, 38426); assert.equal('deltaSinceLast' in row, false, 'the first sweep has no change count');
  assert.equal(row.url, 'https://www.opensanctions.org/datasets/us_ofac_sdn/?change=20261002T161004Z');
  assert.match(row.summary, /2026-10-02 16:10 UTC/); assert.match(row.summary, /38426 entries/); assert.match(row.summary, /OpenSanctions/); assert.doesNotMatch(row.summary, /since the previous sweep/);
  assert.equal(new Set(result.observations.map(r => r.url)).size, 6, 'every list has its own link');
  assert.equal(new Set(result.observations.map(r => r.providerId)).size, 6);
  assert.match(result.summary, /14 days/); assert.match(result.summary, /OpenSanctions/);
  assert.equal(result.rejectedObservations, 0); assert.equal(result.examinedRecords, 9); assert.equal(result.truncatedRecords, 0);
});

test('licence, rights and attribution come from the OpenSanctions terms and survive every state', () => {
  const result = parse(LIVE);
  assert.match(result.attribution, /OpenSanctions/); assert.equal(result.license, 'CC BY-NC 4.0'); assert.equal(result.licenseUrl, 'https://creativecommons.org/licenses/by-nc/4.0/');
  assert.match(result.rights, /Attribution-NonCommercial/); assert.match(result.rights, /commercial use needs/i); assert.match(result.rights, /not the issuers/i);
  for (const state of [parse(null), parse({ datasets: [] }), parse({ run_time: '2026-09-01T00:00:00', datasets: WATCHED }), parse({ error: 'HTTP 503' }), parse(LIVE, { datasets: [] })]) {
    assert.equal(state.license, 'CC BY-NC 4.0'); assert.equal(state.licenseUrl, 'https://creativecommons.org/licenses/by-nc/4.0/'); assert.match(state.attribution, /OpenSanctions/);
  }
});

test('the change count comes from the previous sweep: it is 10 or more for moderate and never invented', () => {
  const previous = new Map([['us_ofac_sdn', 38426 - 12], ['us_trade_csl', 24328 - 9], ['gb_fcdo_sanctions', 7007 + 3], ['un_sc_sanctions', 1407], ['eu_fsf', 8264 - 10]]);
  const result = parse(LIVE, { previous });
  const by = name => result.observations.find(row => row.providerId.includes(name));
  assert.equal(by('us_ofac_sdn').deltaSinceLast, 12); assert.equal(by('us_ofac_sdn').severity, 'moderate'); assert.match(by('us_ofac_sdn').summary, /\+12 entries since the previous sweep/);
  assert.equal(by('eu_fsf').deltaSinceLast, 10); assert.equal(by('eu_fsf').severity, 'moderate', 'exactly 10 is moderate');
  assert.equal(by('us_trade_csl').deltaSinceLast, 9); assert.equal(by('us_trade_csl').severity, 'info', '9 is not');
  assert.equal(by('gb_fcdo_sanctions').deltaSinceLast, -3); assert.equal(by('gb_fcdo_sanctions').severity, 'info'); assert.match(by('gb_fcdo_sanctions').summary, /-3 entries since the previous sweep/);
  assert.equal(by('un_sc_sanctions').deltaSinceLast, 0); assert.match(by('un_sc_sanctions').summary, /has not changed since the previous sweep/);
  assert.equal('deltaSinceLast' in by('us_bis_denied'), false, 'no previous count, no change count');
  assert.deepEqual(ids(result), ['us_ofac_sdn', 'eu_fsf', 'us_trade_csl', 'gb_fcdo_sanctions', 'un_sc_sanctions', 'us_bis_denied'], 'moderate rows first, then the newest change');
  assert.match(parse(LIVE, { previous: new Map([['us_ofac_sdn', 38425]]) }).observations.find(row => row.providerId.includes('us_ofac_sdn')).summary, /\+1 entry since/);
  assert.equal(parse(LIVE, { previous: new Map([['us_ofac_sdn', -5], ['us_trade_csl', 'x'], ['eu_fsf', {}], ['un_sc_sanctions', null]]) }).observations.length, 6, 'a bad seed is no reason to fail');
});

test('the first sweep has no change count, the next one measures it and looking at one list state again never changes the answer', () => {
  const previous = new Map();
  const row = payload => parse(payload, { previous }).observations.find(r => r.providerId.includes('us_ofac_sdn'));
  assert.equal('deltaSinceLast' in row(LIVE), false); assert.equal(previous.size, 6, 'every watched list is remembered, changed or not');
  assert.equal('deltaSinceLast' in row(LIVE), false, 'a second look at the same state still has no change count');
  const grown = index(WATCHED.map(entry => entry.name === 'us_ofac_sdn' ? copy(entry, { thing_count: 38441, last_change: '2026-10-02T21:00:00' }) : entry));
  assert.equal(row(grown).deltaSinceLast, 15); assert.equal(row(grown).severity, 'moderate');
  assert.equal(row(grown).deltaSinceLast, 15, 'the same state keeps the same change count, a cached or repeated payload does not turn +15 into 0');
  assert.equal(row(grown).providerId, 'os:us_ofac_sdn:20261002T210000Z');
  const shrunk = index(WATCHED.map(entry => entry.name === 'us_ofac_sdn' ? copy(entry, { thing_count: 38430, last_change: '2026-10-02T21:30:00' }) : entry));
  assert.equal(row(shrunk).deltaSinceLast, -11); assert.equal(row(shrunk).severity, 'info', 'only additions are rated');
  const restarted = parse(grown, { previous: new Map() }).observations.find(r => r.providerId.includes('us_ofac_sdn'));
  assert.equal('deltaSinceLast' in restarted, false, 'a restart forgets the baseline');
  // A count that moves without a new change time is measured too.
  const quiet = new Map([['us_ofac_sdn', { count: 38426, change: '2026-10-02T16:10:04.000Z', delta: undefined }]]);
  assert.equal(parse(index([copy(US_OFAC_SDN, { thing_count: 38429 })]), { datasets: ['us_ofac_sdn'], previous: quiet }).observations[0].deltaSinceLast, 3);
  // A list outside the 14 day window still moves the baseline, so its next change has a count.
  const old = new Map();
  parse(index([copy(US_OFAC_SDN, { last_change: '2026-08-01T00:00:00', thing_count: 100 })]), { datasets: ['us_ofac_sdn'], previous: old });
  assert.equal(old.size, 1);
  assert.equal(parse(index([copy(US_OFAC_SDN, { thing_count: 130 })]), { datasets: ['us_ofac_sdn'], previous: old }).observations[0].deltaSinceLast, 30);
});

test('the remembered counts are bounded and the briefing remembers across calls', async () => {
  const previous = new Map();
  const see = (n, props) => parse(index([copy(US_OFAC_SDN, { name: `zz_list_${n}`, ...props })]), { datasets: [`zz_list_${n}`], previous });
  for (let n = 0; n < 64; n++) see(n);
  assert.equal(previous.size, 64);
  see(10, { thing_count: 5 });
  assert.equal(previous.size, 64); assert.equal(previous.has('zz_list_0'), true, 'seeing a known list again evicts nothing');
  see(64);
  assert.equal(previous.size, 64); assert.equal(previous.has('zz_list_0'), false, 'the oldest memory goes first');
  for (let n = 65; n < 100; n++) see(n);
  assert.ok(previous.size <= 64, `size ${previous.size}`); assert.equal(previous.has('zz_list_99'), true); assert.equal(previous.has('zz_list_2'), false);
  assert.equal(previous.has('zz_list_10'), true, 'a list seen again is the newest memory and outlives the older ones');
  // Without an injected map the briefing uses the module memory (a name nothing else uses).
  const call = (count, change) => briefing({ now, datasets: ['zz_memory_list'], fetcher: async () => index([copy(US_OFAC_SDN, { name: 'zz_memory_list', thing_count: count, last_change: change })]), useCache: false });
  const firstSweep = (await call(100, '2026-10-02T10:00:00')).observations[0];
  assert.equal('deltaSinceLast' in firstSweep, false);
  const second = (await call(112, '2026-10-02T12:00:00')).observations[0];
  assert.equal(second.deltaSinceLast, 12); assert.equal(second.severity, 'moderate');
  assert.doesNotThrow(() => parseOpensanctionsIndex(index([copy(US_OFAC_SDN, { name: 'zz_plain_list' })]), { now, datasets: ['zz_plain_list'], previous: {} }), 'a map that is not a Map is ignored');
});

test('lists outside the watch list are ignored, the watch list can be changed and a missing list is mentioned', () => {
  assert.deepEqual(ids(parse(LIVE, { datasets: ['us_ofac_sdn'] })), ['us_ofac_sdn']);
  const custom = parse(index([copy(US_OFAC_CONS, { last_change: bare(now - 2 * DAY) }), US_BIS_MIEU, US_OFAC_SDN]), { datasets: ['us_ofac_cons', 'us_bis_mieu'] });
  assert.equal(custom.status, 'ok'); assert.deepEqual(ids(custom), ['us_ofac_cons'], 'us_bis_mieu changed in July and is outside the window');
  const missing = parse(LIVE, { datasets: ['us_ofac_sdn', 'does_not_exist'] });
  assert.equal(missing.status, 'ok'); assert.deepEqual(ids(missing), ['us_ofac_sdn']); assert.match(missing.summary, /1 watched dataset is not in the index/);
  assert.doesNotMatch(parse(LIVE).summary, /not in the index/);
  const gone = parse(LIVE, { datasets: ['does_not_exist'] });
  assert.equal(gone.status, 'error'); assert.match(gone.error, /none of the watched datasets/); assert.deepEqual(gone.observations, []);
  for (const datasets of [[], ['Bad Name'], ['../x'], [5, null, {}], 'us_ofac_sdn', {}, ['us_ofac_sdn'.padEnd(80, 'x')]]) {
    const bad = parse(LIVE, { datasets }); assert.equal(bad.status, 'error', JSON.stringify(datasets)); assert.match(bad.error, /No valid datasets/);
  }
  const many = Array.from({ length: 30 }, (_, n) => `zz_many_${n}`);
  // Later names changed more recently: only the first 12 names are watched, so the newer ones never show.
  const manyRows = parse(index(many.map((name, n) => copy(US_OFAC_SDN, { name, last_change: bare(now - (30 - n) * HOUR) }))), { datasets: many });
  assert.deepEqual(ids(manyRows), Array.from({ length: 12 }, (_, n) => `zz_many_${11 - n}`), 'at most 12 lists are watched, the first 12 of the configured names');
  assert.deepEqual(parse(index([US_OFAC_SDN, US_OFAC_SDN, copy(US_OFAC_SDN, { thing_count: 1 })]), { datasets: ['us_ofac_sdn', 'us_ofac_sdn'] }).observations.map(row => row.thingCount), [38426], 'a repeated dataset is listed once, the first entry wins');
});

test('only a change within the last 14 days counts, never an old, future or undated one', () => {
  const at = ms => only(US_OFAC_SDN, { last_change: bare(ms) });
  assert.equal(at(now - 14 * DAY).observations.length, 1, 'exactly 14 days old is still current');
  assert.equal(at(now - 14 * DAY - 1000).observations.length, 0, 'a second older is not');
  assert.equal(at(now - 14 * DAY - 1000).status, 'ok', 'a quiet list does not make the feed stale');
  assert.equal(at(now + 4 * MINUTE).observations.length, 1, 'a few minutes of clock skew are tolerated');
  assert.equal(at(now + 10 * MINUTE).observations.length, 0, 'a future change is not current');
  assert.equal(at(now - 30 * DAY).observations.length, 0);
  for (const last_change of [undefined, null, 5, '', '2026-10-02', 'yesterday', '2026-13-40T00:00:00', '2026-10-02T25:00:00', 'x'.repeat(1000000), {}, []]) {
    assert.equal(only(US_OFAC_SDN, { last_change }).observations.length, 0, String(last_change).slice(0, 30));
  }
  for (const thing_count of [undefined, null, '5', -1, 1.5, NaN, 1e9, Infinity, {}]) assert.equal(only(US_OFAC_SDN, { thing_count }).observations.length, 0, String(thing_count));
  assert.equal(only(US_OFAC_SDN, { thing_count: 0 }).observations[0].thingCount, 0, 'an empty list is still a list');
  assert.equal(only(US_OFAC_SDN, { last_change: `${bare(now - HOUR)}Z` }).observations.length, 1, 'a zone designator is accepted when the provider writes one');
});

test('the feed time is the index generation time, with the newest watched change as the fallback', () => {
  assert.equal(parse(index(WATCHED)).observedAt, '2026-10-02T22:01:55.000Z');
  const noRun = parse({ datasets: WATCHED });
  assert.equal(noRun.status, 'ok'); assert.equal(noRun.observedAt, '2026-10-02T18:53:06.000Z', 'the newest watched change');
  assert.equal(parse(index(WATCHED, { run_time: 'soon' })).observedAt, '2026-10-02T18:53:06.000Z');
  const futureChange = parse({ datasets: [US_BIS_DENIED, copy(US_OFAC_SDN, { last_change: bare(now + HOUR) })] });
  assert.equal(futureChange.observedAt, '2026-09-28T12:53:59.000Z', 'a future change never sets the feed time');
  const future = parse(index(WATCHED, { run_time: bare(now + HOUR) }));
  assert.equal(future.status, 'stale'); assert.equal(future.freshness.reason, 'future-provider-time'); assert.deepEqual(future.observations, []);
  assert.equal(parse(index(WATCHED, { run_time: bare(now - 48 * HOUR) })).status, 'ok', 'the index may be 48 hours old');
  const old = parse(index(WATCHED, { run_time: bare(now - 48 * HOUR - 1000) }));
  assert.equal(old.status, 'stale'); assert.equal(old.freshness.reason, 'expired-provider-time'); assert.deepEqual(old.observations, []);
  const undated = parse({ datasets: [copy(US_OFAC_SDN, { last_change: 'x' })] });
  assert.equal(undated.status, 'stale'); assert.equal(undated.observedAt, null); assert.equal(undated.freshness.reason, 'unknown-provider-time');
  const oldOnly = parse({ datasets: [copy(US_OFAC_SDN, { last_change: bare(now - 3 * DAY) })] });
  assert.equal(oldOnly.status, 'stale', 'without a run_time the newest change is the feed time: 3 days is expired');
});

test('wrong shapes and provider errors never throw and give an error result', () => {
  for (const payload of [[], null, undefined, 'datasets', 42, {}, { datasets: 'x' }, { datasets: {} }, { run_time: RUN_TIME }]) {
    const result = parse(payload);
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:/);
  }
  const failed = parse({ error: 'HTTP 503 from https://data.opensanctions.org/datasets/latest/index.json?key=secret' });
  assert.equal(failed.status, 'error'); assert.doesNotMatch(failed.error, /https?:|opensanctions\.org|secret/i);
  assert.equal(parse({ error: { code: 1 } }).status, 'error');
  const skipped = parse(index([null, 'x', 7, [], { name: 5 }, { name: ['us_ofac_sdn'] }, {}, US_OFAC_SDN]));
  assert.equal(skipped.status, 'ok'); assert.deepEqual(ids(skipped), ['us_ofac_sdn']);
});

test('hostile provider text is cleaned to inert plain text and capped', () => {
  const title = `<img src=x onerror=alert(1)>${rtl}${bell}${nul}<script>alert(1)</script>Evil${zero}  List\n\t of   "Mars" ${'A'.repeat(5000)}`;
  const row = first(US_OFAC_SDN, { title });
  for (const value of [row.title, row.summary]) { assert.doesNotMatch(value, /[<>]/); assert.doesNotMatch(value, /onerror=alert\(1\)>/); assert.doesNotMatch(value, new RegExp(`[${rtl}${zero}${bell}${nul}]`)); assert.doesNotMatch(value, /[\n\t]/); }
  assert.match(row.title, /^alert\(1\)Evil List of "Mars" A+: list updated$/, 'tags are removed, the remaining text is inert'); assert.ok(row.title.length <= 140, `title length ${row.title.length}`);
  for (const unclosed of ['LIST <img src=x onerror=alert(1)', 'LIST > <b', '<<img>>SDN', 'A<B>C<']) assert.doesNotMatch(first(US_OFAC_SDN, { title: unclosed }).title, /[<>]/, unclosed);
  for (const value of [undefined, null, 5, {}, [], '', `<i></i>${rtl}   `]) assert.equal(first(US_OFAC_SDN, { title: value }).title, 'us_ofac_sdn: list updated', 'the dataset name stands in for an empty title');
  assert.equal(parse(index([copy(US_OFAC_SDN, { name: `us_ofac_sdn${nul}` }), copy(US_OFAC_SDN, { name: 'US_OFAC_SDN' }), copy(US_OFAC_SDN, { name: 'us_ofac_sdn<b>' })])).status, 'error', 'a name must match exactly');
});

// Standing rule for every adapter: cut the text to a fixed length first, then run regexes (a tag pattern that rescans from every '<' is quadratic).
test('hostile oversized provider text is cleaned in linear time', { timeout: 5000 }, () => {
  const started = Date.now();
  const floods = { lt: '<'.repeat(30000), openTag: '<a '.repeat(10000), gt: '>'.repeat(30000), nested: '<<>'.repeat(10000), spaces: ' '.repeat(30000) + 'LIST', words: 'A'.repeat(30000), controls: (bell + zero).repeat(15000), http: 'http://'.repeat(5000) };
  for (const [name, flood] of Object.entries(floods)) {
    const row = first(US_OFAC_SDN, { title: flood });
    assert.doesNotMatch(row.title, /[<>]/, name); assert.ok(row.title.length <= 140, `${name} title length ${row.title.length}`); assert.ok(row.summary.length <= 700, `${name} summary length ${row.summary.length}`);
  }
  assert.equal(first(US_OFAC_SDN, { title: floods.lt }).title, 'us_ofac_sdn: list updated');
  assert.match(first(US_OFAC_SDN, { title: floods.openTag }).title, /^a a a /);
  assert.equal(only(US_OFAC_SDN, { last_change: 'x'.repeat(30000) }).observations.length, 0);
  assert.equal(only(US_OFAC_SDN, { name: 'x'.repeat(30000) }, { datasets: ['us_ofac_sdn'] }).status, 'error', 'an oversized name is no match');
  const flooded = parse(index(WATCHED, { run_time: '9'.repeat(30000) }));
  assert.equal(flooded.observedAt, '2026-10-02T18:53:06.000Z', 'an oversized run_time is dropped, not parsed');
  for (const error of ['http://'.repeat(5000), '<'.repeat(30000), 'x'.repeat(30000)]) {
    const failed = parse({ error });
    assert.equal(failed.status, 'error'); assert.ok(failed.error.length <= 300); assert.doesNotMatch(failed.error, /https?:/);
  }
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
});

test('an index of 300 or more datasets is processed in bounded time and only the first 2000 entries are examined', { timeout: 5000 }, () => {
  const filler = n => ({ name: `zz_filler_${n}`, title: `Filler ${n}`, thing_count: n, last_change: bare(now - n * HOUR), description: 'x'.repeat(2000), resources: Array.from({ length: 10 }, (_, i) => ({ name: `r${i}` })) });
  const started = Date.now();
  const three = parse(index([...Array.from({ length: 300 }, (_, n) => filler(n)), ...WATCHED]));
  assert.equal(three.status, 'ok'); assert.deepEqual(ids(three), NEWEST_FIRST); assert.equal(three.examinedRecords, 306);
  const fillers = count => Array.from({ length: count }, (_, n) => filler(n));
  const huge = parse(index([...fillers(1995), ...WATCHED, ...fillers(400)]));
  assert.deepEqual(ids(huge), ['us_ofac_sdn', 'gb_fcdo_sanctions', 'un_sc_sanctions', 'us_bis_denied', 'eu_fsf'], 'the sixth watched list sits at position 2001 and is not examined');
  assert.match(huge.summary, /1 watched dataset is not in the index/); assert.equal(huge.examinedRecords, 2000); assert.equal(huge.truncatedRecords, 401);
  const edge = parse(index([...Array.from({ length: 1999 }, (_, n) => filler(n)), US_OFAC_SDN]));
  assert.equal(edge.observations.length, 1, 'the 2000th entry is still examined'); assert.equal(edge.truncatedRecords, 0);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
});

test('provider ids and links carry the change time, so every change is a separate record and the same change is the same record', () => {
  const idsOf = payload => parse(payload).observations.map(row => row.providerId);
  assert.deepEqual(idsOf(LIVE), idsOf(LIVE)); assert.deepEqual(idsOf(JSON.parse(JSON.stringify(LIVE))), idsOf(LIVE));
  assert.deepEqual(idsOf(LIVE), ['os:us_trade_csl:20261002T185306Z', 'os:us_ofac_sdn:20261002T161004Z', 'os:gb_fcdo_sanctions:20261002T093030Z', 'os:un_sc_sanctions:20261001T000101Z', 'os:us_bis_denied:20260928T125359Z', 'os:eu_fsf:20260922T185701Z']);
  const later = first(US_OFAC_SDN, { last_change: '2026-10-02T21:00:00' });
  const earlier = first(US_OFAC_SDN, {});
  assert.notEqual(later.providerId, earlier.providerId); assert.notEqual(later.url, earlier.url);
  assert.equal(later.url, 'https://www.opensanctions.org/datasets/us_ofac_sdn/?change=20261002T210000Z');
  assert.equal(first(US_OFAC_SDN, { thing_count: 99999 }).providerId, earlier.providerId, 'a count that moves without a new change keeps the identity');
  assert.deepEqual(first(US_OFAC_SDN, { updated_at: '2026-10-03T00:00:00', version: 'x' }).providerId, earlier.providerId, 'a new export of an unchanged list keeps the identity');
});

test('history keeps one record per list change: no growth between sweeps, a new change is a new record', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-opensanctions-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = new HistoryStore(dir, { now: () => now + 3 * HOUR });
  const eventsFor = (payload, at = now, edit = row => row) => {
    const raw = parse(payload, { now: at });
    return buildEvents({ meta: { timestamp: iso(at) }, liveSources: normalizeLiveSources({ 'OpenSanctions-Index': { ...raw, observations: raw.observations.map(edit) } }, at) }, { now: at });
  };
  const second = index(WATCHED.map(entry => entry.name === 'us_ofac_sdn' ? copy(entry, { last_change: '2026-10-02T21:40:00', thing_count: 38430 }) : entry));
  // Two changes of one list share one dataset page, and history merges records of one kind and one URL ...
  const barePage = row => ({ ...row, url: 'https://www.opensanctions.org/datasets/us_ofac_sdn/' });
  const sdnOnly = payload => ({ ...payload, datasets: payload.datasets.filter(entry => entry.name === 'us_ofac_sdn') });
  const collapsedDir = mkdtempSync(join(tmpdir(), 'crucix-opensanctions-')); t.after(() => rmSync(collapsedDir, { recursive: true, force: true }));
  const collapsed = new HistoryStore(collapsedDir, { now: () => now + 3 * HOUR });
  collapsed.add(eventsFor(sdnOnly(index(WATCHED)), now, barePage)); collapsed.add(eventsFor(sdnOnly(second), now + 2 * HOUR, barePage));
  assert.equal(collapsed.query({ source: 'OpenSanctions-Index', kind: 'sanctions' }).total, 1, 'without the change in the link two changes would be one record');
  // ... so the adapter puts the change time into the link.
  const live = eventsFor(LIVE);
  assert.equal(live.length, 6); assert.equal(new Set(live.map(event => event.id)).size, 6); assert.equal(new Set(live.map(event => event.source.url)).size, 6); assert.ok(live.every(event => event.kind === 'sanctions'));
  assert.deepEqual(history.add(live), { added: 6, updated: 0, ignored: 0, total: 6 });
  assert.deepEqual(history.add(eventsFor(LIVE, now + 15 * MINUTE)), { added: 0, updated: 6, ignored: 0, total: 6 }, 'the next sweep updates the same records and does not grow the history');
  const next = eventsFor(second, now + 2 * HOUR);
  assert.deepEqual(history.add(next), { added: 1, updated: 5, ignored: 0, total: 7 }, 'a new change of the SDN list is a new record');
  assert.equal(history.query({ source: 'OpenSanctions-Index', kind: 'sanctions' }).total, 7);
});

test('observations survive the server normalization with facts, severity and the registered home and policy', () => {
  assert.deepEqual(FACT_FIELDS['OpenSanctions-Index'], ['thingCount', 'deltaSinceLast']);
  assert.equal(HOME['OpenSanctions-Index'], 'https://www.opensanctions.org/');
  assert.deepEqual(POLICIES['OpenSanctions-Index'], { maxAgeMs: 48 * HOUR, observationMaxAgeMs: 336 * HOUR });
  const raw = parse(LIVE, { previous: new Map([['us_ofac_sdn', 38400]]) });
  const [out] = normalizeLiveSources({ 'OpenSanctions-Index': raw }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://www.opensanctions.org/'); assert.equal(out.observations.length, 6);
  const sdn = out.observations.find(row => row.providerId === 'os:us_ofac_sdn:20261002T161004Z');
  assert.equal(sdn.kind, 'sanctions'); assert.equal(sdn.severity, 'moderate'); assert.equal(sdn.observedAt, '2026-10-02T16:10:04.000Z');
  assert.deepEqual(sdn.facts, [{ label: 'thingCount', value: 38426 }, { label: 'deltaSinceLast', value: 26 }]);
  assert.deepEqual(out.observations.find(row => row.providerId.includes('eu_fsf')).facts, [{ label: 'thingCount', value: 8264 }], 'no change count, no fact');
  assert.equal(sdn.lat, undefined); assert.equal(out.license, 'CC BY-NC 4.0'); assert.deepEqual(out.metrics, {});
  const events = buildEvents({ meta: { timestamp: iso(now) }, liveSources: [out] }, { now });
  assert.equal(events.length, 6); assert.ok(events.every(event => event.kind === 'sanctions'));
  const top = events.find(event => event.title === 'US OFAC Specially Designated Nationals (SDN) List: list updated');
  assert.equal(top.severity, 'moderate'); assert.equal(top.source.url, 'https://www.opensanctions.org/datasets/us_ofac_sdn/?change=20261002T161004Z');
  const eventIds = payload => buildEvents({ meta: { timestamp: iso(now) }, liveSources: normalizeLiveSources({ 'OpenSanctions-Index': parse(payload) }, now) }, { now }).map(event => event.id).sort();
  assert.deepEqual(eventIds(LIVE), eventIds(LIVE), 'event identities are stable across parses');
  assert.equal(new Set(eventIds(LIVE)).size, 6);
});

test('briefing asks for the index once, with a 3 MiB limit, and returns the parsed result', async () => {
  const seen = [];
  const result = await brief({ fetcher: async (url, options) => { seen.push({ url, options }); return LIVE; } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://data.opensanctions.org/datasets/latest/index.json');
  assert.deepEqual({ ...seen[0].options }, { timeout: 10000, retries: 0, maxBytes: 3 * MIB });
  assert.deepEqual(ids(result), NEWEST_FIRST);
  assert.equal((await brief({ datasets: ['Bad Name'], fetcher: async () => { throw new Error('must not be asked'); } })).status, 'error');
});

test('the live index is 610 bytes over 2 MiB, so a 2 MiB limit would fail and the 3 MiB limit holds', async () => {
  const padded = bytes => { const base = JSON.stringify({ run_time: RUN_TIME, datasets: [...WATCHED, { name: 'zz_pad', description: '' }] }); return base.replace('"description":""', `"description":"${'x'.repeat(bytes - Buffer.byteLength(base))}"`); };
  const live = padded(2 * MIB + 610);
  assert.equal(Buffer.byteLength(live), 2 * MIB + 610);
  const ok = await withFetch(async () => reply(live), () => brief({ timeout: 5000 }));
  assert.equal(ok.status, 'ok'); assert.equal(ok.observations.length, 6, 'a body the size of the live index is accepted');
  const grown = await withFetch(async () => reply(padded(3 * MIB)), () => brief({ timeout: 5000 }));
  assert.equal(grown.status, 'ok', 'exactly 3 MiB is still accepted');
  const tooBig = await withFetch(async () => reply('x'.repeat(3 * MIB + 1)), () => brief({ timeout: 5000 }));
  assert.equal(tooBig.status, 'error'); assert.match(tooBig.error, /exceeds|limit/i); assert.deepEqual(tooBig.observations, []);
});

test('briefing degrades every transport failure to an error result without a URL and never throws', async () => {
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'Request timed out after 10000ms' }, { error: 'Response exceeds 3145728 byte limit' }, { error: 'Invalid JSON response', status: 200 },
    { error: 'connect failed for https://data.opensanctions.org/datasets/latest/index.json?key=secret' }, [], null, 'text'];
  for (const payload of failures) {
    const result = await brief({ fetcher: async () => payload });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:|opensanctions\.org|secret/i);
  }
  const thrown = await brief({ fetcher: async () => { throw new Error('connect ECONNREFUSED https://data.opensanctions.org/?key=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|opensanctions\.org|secret|ECONNREFUSED/i);
  assert.equal((await brief({ fetcher: () => { throw new Error('sync https://x'); } })).status, 'error');
});

test('briefing over the real fetch helper degrades 503, timeout, an oversized body and invalid JSON to error results', async () => {
  const cases = {
    '503': () => reply('down', { status: 503 }),
    'timeout': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    'oversized': () => reply('x'.repeat(3 * MIB + 1)),
    'invalid json': () => reply('<html>not json</html>'),
    'network': () => Promise.reject(new TypeError('fetch failed')),
  };
  for (const [name, impl] of Object.entries(cases)) {
    const result = await withFetch(impl, () => brief({ timeout: 25 }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name);
    assert.doesNotMatch(result.error, /https?:|opensanctions\.org/i, name);
  }
  assert.match((await withFetch(cases.timeout, () => brief({ timeout: 25 }))).error, /timed out/i);
  const ok = await withFetch(async () => reply(LIVE), () => brief({}));
  assert.equal(ok.status, 'ok'); assert.equal(ok.observations.length, 6);
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await brief({ timeout, fetcher: async (url, options) => { seen.push(options.timeout); return LIVE; } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000);
});

test('briefing caches ok answers for an hour per fetcher and watch list, and never caches a failure', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return LIVE; };
  const cached = options => brief({ fetcher, useCache: true, datasets: ['us_ofac_sdn', 'us_trade_csl'], ...options });
  const firstCall = await cached({ previous: new Map() });
  assert.equal(firstCall.status, 'ok'); assert.equal(calls, 1);
  const hit = await cached({ now: now + 59 * MINUTE });
  assert.equal(calls, 1, 'inside the hour nothing is asked'); assert.deepEqual(hit.observations.map(r => r.providerId), firstCall.observations.map(r => r.providerId));
  assert.equal(hit.timestamp, iso(now + 59 * MINUTE), 'a cached answer is evaluated at the current time');
  await cached({ now: now + 60 * MINUTE }); assert.equal(calls, 2, 'after an hour it is asked again');
  await brief({ fetcher, useCache: true, datasets: ['us_ofac_sdn'] }); assert.equal(calls, 3, 'another watch list is another cache entry');
  await brief({ fetcher: async () => { calls++; return LIVE; }, useCache: true, datasets: ['us_ofac_sdn', 'us_trade_csl'] }); assert.equal(calls, 4, 'another fetcher does not read the cache');
  let failing = 0;
  const flaky = async () => { failing++; return failing === 1 ? { error: 'HTTP 503' } : LIVE; };
  assert.equal((await brief({ fetcher: flaky, useCache: true, datasets: ['us_bis_denied'] })).status, 'error');
  assert.equal((await brief({ fetcher: flaky, useCache: true, datasets: ['us_bis_denied'] })).status, 'ok', 'the failure was not cached');
  assert.equal((await brief({ fetcher: flaky, useCache: true, datasets: ['us_bis_denied'] })).status, 'ok'); assert.equal(failing, 2, 'the ok answer was served from the cache');
  // With an injected fetcher the cache is off unless asked for, with the real fetch helper it is on.
  let plain = 0; const counting = async () => { plain++; return LIVE; };
  await brief({ fetcher: counting, datasets: ['eu_fsf'] }); await brief({ fetcher: counting, datasets: ['eu_fsf'] }); assert.equal(plain, 2);
  let network = 0;
  await withFetch(async () => { network++; return reply(LIVE); }, async () => { await briefing({ now, previous: new Map(), datasets: ['un_sc_sanctions'] }); await briefing({ now, previous: new Map(), datasets: ['un_sc_sanctions'] }); });
  assert.equal(network, 1, 'the second call is served from the cache');
  // The cache keeps a small copy of the watched lists, not the provider's 2 MB payload.
  const source = JSON.parse(JSON.stringify(LIVE));
  const sourceFetcher = async () => source;
  const aliased = options => brief({ fetcher: sourceFetcher, useCache: true, datasets: ['us_bis_denied'], ...options });
  assert.equal((await aliased()).observations[0].thingCount, 385);
  source.datasets.find(entry => entry.name === 'us_bis_denied').thing_count = 1;
  assert.equal((await aliased({ now: now + MINUTE })).observations[0].thingCount, 385, 'a change to the provider object after the call does not reach the cached answer');
  // A cached answer keeps the change count: the second look at the same list state is not "0".
  const memory = new Map([['us_ofac_sdn', 38426 - 12]]);
  const withDelta = await brief({ fetcher, useCache: true, datasets: ['us_ofac_sdn'], previous: memory, now: now + 5 * MINUTE });
  assert.equal(withDelta.observations[0].deltaSinceLast, 12);
  const again = await brief({ fetcher, useCache: true, datasets: ['us_ofac_sdn'], previous: memory, now: now + 20 * MINUTE });
  assert.equal(again.observations[0].deltaSinceLast, 12); assert.equal(again.observations[0].severity, 'moderate');
});

test('the cache keeps at most 16 watch lists', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return LIVE; };
  const names = WATCHED.map(entry => entry.name);
  const sets = Array.from({ length: 17 }, (_, n) => names.filter((name, bit) => ((n + 1) >> bit) & 1));
  for (const datasets of sets) await brief({ fetcher, useCache: true, datasets });
  assert.equal(calls, 17);
  await brief({ fetcher, useCache: true, datasets: sets[1] }); assert.equal(calls, 17, 'the second oldest of 17 entries is still cached');
  await brief({ fetcher, useCache: true, datasets: sets.at(-1) }); assert.equal(calls, 17, 'the newest entry is still cached');
  await brief({ fetcher, useCache: true, datasets: sets[0] }); assert.equal(calls, 18, 'the 17th entry pushed the oldest one out');
});
