import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { DOMAINS, DOMAIN_IDS, domainOfSource, domainOfEvent } from '../lib/domains.mjs';

// The domain registry behind the dashboard lenses: every source adapter sits in exactly one domain, the browser copy is identical.
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const adapters = [...read('apis/briefing.mjs').matchAll(/runSource\('([^']+)'/g)].map(match => match[1]);
const all = DOMAINS.flatMap(domain => domain.sources);
const browser = () => {
  const window = {};
  vm.runInNewContext(read('dashboard/public/domains.js'), { window, Object, Array, String, Number, JSON, Map });
  return window.CrucixDomains;
};
const event = name => ({ id: 'event-1', kind: 'earthquake', title: 'Quake', source: { name, url: '', hostname: '', status: 'ok' } });

test('the eight domains come in the fixed order and DOMAIN_IDS lists them', () => {
  assert.deepEqual(DOMAINS.map(domain => domain.id), ['security', 'hazards', 'space', 'cyber', 'economy', 'supply', 'sanctions', 'health']);
  assert.deepEqual(DOMAIN_IDS, DOMAINS.map(domain => domain.id));
  for (const domain of DOMAINS) assert.ok(domain.sources.length > 0 && domain.sources.every(source => typeof source === 'string' && source), domain.id);
});

test('every adapter registered in the briefing and every POLICIES source is in exactly one domain', () => {
  assert.ok(adapters.length >= 50, 'the briefing registers its adapters through runSource');
  assert.equal(new Set(adapters).size, adapters.length, 'no adapter is registered twice');
  assert.equal(new Set(all).size, all.length, 'no source is in two domains (or twice in one)');
  for (const name of adapters) assert.equal(all.filter(source => source === name).length, 1, `${name} is in exactly one domain`);
  for (const name of Object.keys(POLICIES)) assert.equal(all.filter(source => source === name).length, 1, `${name} (a live source) is in exactly one domain`);
});

test('no domain lists a source the briefing does not run', () => {
  assert.deepEqual([...all].sort(), [...adapters].sort());
  assert.equal(all.length, adapters.length);
});

test('domainOfSource maps adapter names, keeps near names apart and answers null otherwise', () => {
  assert.equal(domainOfSource('GDELT'), 'security');
  assert.equal(domainOfSource('NOAA'), 'hazards');
  assert.equal(domainOfSource('NOAA-SWPC'), 'space');
  assert.equal(domainOfSource('OpenSanctions'), 'sanctions');
  assert.equal(domainOfSource('OpenSanctions-Index'), 'sanctions');
  assert.equal(domainOfSource('ENTSOG-HU'), 'supply');
  assert.equal(domainOfSource('Safecast'), 'health');
  assert.equal(domainOfSource('nope'), null);
  assert.equal(domainOfSource(undefined), null);
  for (const value of [null, '', 7, {}, [], ['GDELT'], true]) assert.equal(domainOfSource(value), null, JSON.stringify(value));
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(domainOfSource(name), null, name);
  for (const domain of DOMAINS) for (const source of domain.sources) assert.equal(domainOfSource(source), domain.id, source);
});

test('domainOfEvent reads the source name of an event record and never throws', () => {
  assert.equal(domainOfEvent(event('USGS')), 'hazards');
  assert.equal(domainOfEvent(event('CISA-KEV')), 'cyber');
  assert.equal(domainOfEvent({ ...event('USGS'), sourceName: 'GDELT' }), 'hazards', 'the nested source wins over a flat export field');
  assert.equal(domainOfEvent({ sourceName: 'GDELT' }), 'security', 'a flat export record carries sourceName');
  assert.equal(domainOfEvent(event('Some News Wire')), null, 'a news or OSINT source has no domain');
  assert.equal(domainOfEvent(event('')), null);
  assert.equal(domainOfEvent({ id: 'x', title: 'no source' }), null);
  assert.equal(domainOfEvent({ source: null }), null);
  assert.equal(domainOfEvent({ source: 'USGS' }), null, 'a bare string is not an event source object');
  for (const value of [null, undefined, 'GDELT', 7, true, []]) assert.equal(domainOfEvent(value), null, String(value));
});

test('the browser copy holds identical data and behaves like the server module', () => {
  const copy = browser();
  assert.ok(copy, 'window.CrucixDomains is exposed');
  assert.deepEqual(plain(copy.DOMAINS), plain(DOMAINS));
  assert.deepEqual(plain(copy.DOMAIN_IDS), DOMAIN_IDS);
  for (const name of [...all, 'nope', 'constructor', '', undefined, null, 7]) assert.equal(copy.domainOfSource(name), domainOfSource(name), String(name));
  for (const value of [event('USGS'), event('Some News Wire'), { sourceName: 'GDELT' }, { source: 'USGS' }, { source: null }, {}, null, undefined, 'GDELT', 7]) {
    assert.equal(copy.domainOfEvent(value), domainOfEvent(value), JSON.stringify(value) ?? 'undefined');
  }
});

test('the browser copy is an IIFE with no regex lookbehind', () => {
  const source = read('dashboard/public/domains.js');
  assert.ok(/^\(function\(window\)\{/.test(source), 'IIFE like the other dashboard modules');
  assert.ok(!/\(\?<[=!]/.test(source), 'no regex lookbehind');
});

test('every domain has a non-empty en, hu and fr lens label', () => {
  for (const lang of ['en', 'hu', 'fr']) {
    const lenses = JSON.parse(read(`locales/${lang}.json`)).lenses;
    assert.ok(lenses && typeof lenses === 'object', `${lang}: the lenses group`);
    for (const id of [...DOMAIN_IDS, 'all', 'label']) assert.ok(typeof lenses[id] === 'string' && lenses[id].trim() !== '', `${lang}: lenses.${id}`);
  }
});
