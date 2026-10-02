import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { LIVE_KINDS, FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { normalizeHistoryEvent, validateHistoryFilters } from '../lib/intelligence/history.mjs';

// The framework behind the "Current public data" pipeline: every list that has to grow with a new source or kind.
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const NEW_KINDS = ['earthquake', 'maritime', 'aviation', 'sanctions', 'market', 'energy'];
const OTHER_KINDS = ['news', 'osint', 'health', 'outage', 'conflict', 'signal'];
const now = Date.parse('2026-10-01T21:00:00Z');
const keys = value => Object.keys(value).sort();
const browser = () => {
  const window = {};
  vm.runInContext(read('dashboard/public/live-sources.js'), vm.createContext({ window, Date, URL, Object, Array, Number, JSON, Set }));
  return window.CrucixLiveSources;
};
const listOf = (file, name) => { const match = read(file).match(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`)); assert(match, `${name} in ${file}`); return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]); };
const walk = (dir, pattern) => readdirSync(new URL(dir, root)).flatMap(name => {
  const path = join(dir, name);
  return statSync(new URL(path, root)).isDirectory() ? walk(path + '/', pattern) : pattern.test(name) ? [path] : [];
});

test('POLICIES, the browser policy copy, FACT_FIELDS and HOME describe the same sources', () => {
  const policies = keys(POLICIES);
  assert(policies.length >= 9, 'the registry is not empty');
  assert.deepEqual(keys(browser().policies), policies);
  assert.deepEqual(keys(FACT_FIELDS), policies);
  assert.deepEqual(keys(HOME), policies);
  for (const [source, home] of Object.entries(HOME)) assert.match(home, /^https:\/\//, source);
});

test('the live kinds are the pinned list and every kind list agrees with it', () => {
  assert.deepEqual(LIVE_KINDS, ['weather', 'disaster', 'space-weather', 'economic', 'forecast', 'network', 'cyber', ...NEW_KINDS]);
  assert.equal(new Set(LIVE_KINDS).size, LIVE_KINDS.length);
  for (const kind of LIVE_KINDS) assert.equal(validateHistoryFilters({ kind }).kind, kind, `history filter accepts ${kind}`);
  const eventKinds = listOf('dashboard/public/intelligence.js', 'EVENT_KINDS');
  assert.deepEqual([...eventKinds].sort(), [...new Set([...LIVE_KINDS, ...OTHER_KINDS])].sort(), 'intelligence.js EVENT_KINDS = live kinds + the non-live ones');
  for (const kind of eventKinds) assert.equal(validateHistoryFilters({ kind }).kind, kind, `history filter accepts ${kind}`);
  assert.throws(() => validateHistoryFilters({ kind: 'not-a-kind' }), { code: 'INVALID_FILTER' });
});

test('no hard nine-source limit is left in lib/ or dashboard/public/', () => {
  const files = [...walk('lib/', /\.mjs$/), ...walk('dashboard/public/', /\.(js|html)$/)];
  assert(files.length > 20 && files.includes(join('dashboard/public/', 'jarvis.html')) && files.includes(join('lib/intelligence/', 'live-sources.mjs')), 'the scan covers the modules');
  for (const file of files) assert.doesNotMatch(read(file), /slice\(\s*0\s*,\s*9\s*\)/, file);
});

test('the server keeps as many sources as there are policies and drops the rest', () => {
  const count = Object.keys(POLICIES).length, source = 'MET-Norway';
  const row = { providerId: 'f1', kind: 'forecast', title: 'Budapest forecast', observedAt: '2026-10-01T19:00:00Z', forecastAt: '2026-10-01T22:00:00Z', validUntil: '2026-10-01T23:00:00Z', lat: 47.5, lon: 19 };
  const live = { source, status: 'ok', observedAt: '2026-10-01T19:00:00Z', observations: [row] };
  const filler = n => Array.from({ length: n }, (_, i) => ({ source: 'Unknown-' + i, status: 'ok' }));
  assert.equal(normalizeLiveSources([...filler(count - 1), live], now).length, 1);
  assert.equal(normalizeLiveSources([...filler(count), live], now).length, 0, 'the bound is the policy count, not a literal');
});

test('the browser keeps as many sources as there are policies', () => {
  const api = browser(), t = (_, fallback) => fallback;
  for (const name of ['Extra-A', 'Extra-B', 'Extra-C']) api.policies[name] = { maxAgeMs: 3600000 };
  const count = Object.keys(api.policies).length, names = Object.keys(api.policies).filter(name => name !== 'MET-Norway');
  assert(names.length > 9, 'more sources than the old limit');
  // Five minutes old: the shortest policy (ADSB-Military) lets a row live for 25 minutes.
  const sources = names.map((name, i) => ({ source: name, status: 'ok', observedAt: '2026-10-01T20:55:00Z', observations: [{ providerId: 'r' + i, kind: 'disaster', title: 'Row ' + i, observedAt: '2026-10-01T20:55:00Z' }] }));
  assert.equal(api.observations(sources, now).length, names.length);
  assert.equal(api.renderPanel(sources, t, [], now).match(/data-live-source="/g).length, names.length);
  assert.equal(api.observations([...sources, ...sources], now).length, count, 'a bound is kept: it is the policy count');
  assert.equal(api.renderPanel([...sources, ...sources], t, [], now).match(/data-live-source="/g).length, count);
  assert.match(read('dashboard/public/jarvis.html'), /liveSources\.filter\([^\n]*\)\.slice\(0,Object\.keys\(CrucixLiveSources\.policies\)\.length\)/, 'normalizeSnapshot follows the same bound');
});

test('every new kind survives normalization, events and history', () => {
  for (const kind of NEW_KINDS) {
    const live = { source: 'GDACS', status: 'ok', observedAt: '2026-10-01T20:30:00Z', observations: [{ providerId: 'x-' + kind, kind, title: `A ${kind} record`, url: `https://example.org/${kind}`, observedAt: '2026-10-01T20:30:00Z', lat: 47.5, lon: 19 }] };
    const [normalized] = normalizeLiveSources({ GDACS: live }, now);
    assert.equal(normalized.status, 'ok', kind);
    assert.equal(normalized.observations[0].kind, kind, `${kind} is kept by normalizeLiveSources`);
    const events = buildEvents({ meta: { timestamp: new Date(now).toISOString() }, liveSources: [normalized] }, { now });
    assert.equal(events.length, 1, kind);
    assert.equal(events[0].kind, kind, `${kind} reaches the events`);
    assert.equal(normalizeHistoryEvent(events[0]).kind, kind, `${kind} survives history normalization`);
  }
  const [other] = normalizeLiveSources({ GDACS: { source: 'GDACS', status: 'ok', observedAt: '2026-10-01T20:30:00Z', observations: [{ kind: 'bogus', title: 'Unknown kind', observedAt: '2026-10-01T20:30:00Z' }] } }, now);
  assert.equal(other.observations[0].kind, 'signal', 'other kinds still become signal');
});

test('every live kind has a translated label in en, hu and fr', () => {
  for (const lang of ['en', 'hu', 'fr']) {
    const strings = JSON.parse(read(`locales/${lang}.json`)).intelligence;
    for (const kind of LIVE_KINDS) assert.ok(typeof strings['kind_' + kind] === 'string' && strings['kind_' + kind].trim(), `${lang}: intelligence.kind_${kind}`);
  }
  const en = JSON.parse(read('locales/en.json')).intelligence, hu = JSON.parse(read('locales/hu.json')).intelligence;
  for (const kind of ['aviation', 'sanctions', 'market', 'energy']) assert.notEqual(hu['kind_' + kind], en['kind_' + kind], `hu: ${kind} is translated`);
});

test('the map kind table sends located live rows to layer types that exist', () => {
  const html = read('dashboard/public/jarvis.html');
  const code = html.match(/const LIVE_MARKER_TYPE\s*=\s*\{[^}]*\};\s*const liveMarkerType=[^\n]*/);
  assert(code, 'LIVE_MARKER_TYPE and liveMarkerType are defined');
  const { table, pick } = vm.runInNewContext(code[0] + '\n({ table: LIVE_MARKER_TYPE, pick: liveMarkerType })');
  assert.deepEqual(JSON.parse(JSON.stringify(table)), { earthquake: 'earthquake', maritime: 'maritime', aviation: 'air', disaster: 'disaster', forecast: 'forecast', weather: 'weather' });
  const registry = html.slice(html.indexOf('const mapLayerRegistry'), html.indexOf('let mapLayers'));
  const layerTypes = new Set([...registry.matchAll(/types:\[([^\]]*)\]/g)].flatMap(item => [...item[1].matchAll(/'([^']+)'/g)].map(type => type[1])));
  for (const [kind, type] of Object.entries(table)) { assert(layerTypes.has(type), `${kind} -> ${type} is a layer type`); assert.equal(pick(kind), type); }
  for (const kind of ['sanctions', 'market', 'energy', 'signal', 'constructor', '__proto__', undefined]) assert.equal(pick(kind), 'weather', String(kind));
  assert.equal(html.match(/liveMarkerType\(row\.kind\)/g)?.length, 2, 'both marker sites use the table');
  assert.doesNotMatch(html, /row\.kind==='forecast'\?/);
});
