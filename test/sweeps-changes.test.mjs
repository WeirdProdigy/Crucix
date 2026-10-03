import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHANGE_CAPS, buildChanges, mergeChanges } from '../lib/sweeps/changes.mjs';
import { SOURCE_STATES, SweepArchive } from '../lib/sweeps/archive.mjs';
import { DOMAIN_IDS } from '../lib/domains.mjs';

const BASE = Date.parse('2026-10-03T08:00:00.000Z');
const QUARTER = 15 * 60000;
const stamp = n => new Date(BASE + n * QUARTER).toISOString();
const hour = n => `2026-10-03T${String(n).padStart(2, '0')}:00:00.000Z`;
const eid = n => `event-${n.toString(16).padStart(32, '0')}`;

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  }
  return value;
}

// An event record the way lib/intelligence/events.mjs builds it (only the fields the changes look at).
function ev(n, extra = {}) {
  return { id: eid(n), kind: 'news', title: `Event ${n}`, summary: '', source: { name: 'USGS', url: null, hostname: null, status: 'ok' }, observedAt: null, severity: 'moderate', ...extra };
}

const row = (n, flags = {}) => ({ n, err: false, stale: false, disabled: false, ...flags });
const sweep = (n, { events = [], health = [], delta = null } = {}) => ({ meta: { timestamp: stamp(n) }, events, health, delta });
const ids = list => list.map(item => item.id);

test('CHANGE_CAPS holds the spec limits and cannot be changed', () => {
  assert.deepEqual({ ...CHANGE_CAPS }, { events: 40, sources: 30, signals: 20 });
  assert.equal(Object.isFrozen(CHANGE_CAPS), true);
});

test('new and expired events are found by id, once per id', () => {
  const previous = deepFreeze(sweep(0, { events: [ev(1), ev(2), ev(3)] }));
  const current = deepFreeze(sweep(1, { events: [ev(2), ev(3, { title: 'same id, new wording' }), ev(4), ev(4), ev(5)] }));
  const changes = buildChanges(previous, current);
  assert.equal(changes.baseline, false);
  assert.equal(changes.since, stamp(0));
  assert.equal(changes.at, stamp(1));
  assert.equal(changes.events.newTotal, 2);
  assert.equal(changes.events.expiredTotal, 1);
  assert.deepEqual(ids(changes.events.new).sort(), [eid(4), eid(5)]);
  assert.deepEqual(changes.events.new.find(item => item.id === eid(4)), {
    id: eid(4), title: 'Event 4', kind: 'news', source: 'USGS', domain: 'hazards', severity: 'watch', observedAt: null,
  });
  assert.deepEqual(Object.keys(changes), ['since', 'at', 'baseline', 'events', 'sources', 'signals', 'domains']);
  assert.deepEqual(Object.keys(changes.events), ['new', 'newTotal', 'expiredTotal']);
});

test('nothing changed gives empty lists and zero totals, not a baseline', () => {
  const same = [ev(1), ev(2)];
  const changes = buildChanges(deepFreeze(sweep(0, { events: same })), deepFreeze(sweep(1, { events: same })));
  assert.equal(changes.baseline, false);
  assert.deepEqual(changes.events, { new: [], newTotal: 0, expiredTotal: 0 });
  assert.deepEqual(changes.sources, []);
  assert.deepEqual(changes.signals, []);
  assert.deepEqual(changes.domains, {});
});

test('new events are ordered critical > high > watch > info > unknown, then newer first, on the shared level words', () => {
  const events = [
    ev(9, { severity: undefined }), ev(6, { severity: 'low', observedAt: hour(5) }), ev(3, { severity: 'elevated', observedAt: hour(2) }),
    ev(8, { severity: 'unknown', observedAt: hour(23) }), ev(1, { severity: 'critical', observedAt: hour(1) }), ev(10, { severity: 'critical' }),
    ev(5, { severity: 'moderate' }), ev(7, { severity: 'monitor', observedAt: hour(6) }), ev(2, { severity: 'critical', observedAt: hour(3) }),
    ev(4, { severity: 'high', observedAt: hour(4) }),
  ];
  const changes = buildChanges(deepFreeze(sweep(0)), deepFreeze(sweep(1, { events })));
  assert.deepEqual(ids(changes.events.new), [2, 1, 10, 4, 3, 5, 7, 6, 8, 9].map(eid));
  assert.deepEqual(changes.events.new.map(item => item.severity), ['critical', 'critical', 'critical', 'high', 'high', 'watch', 'info', 'info', null, null]);
  assert.deepEqual(changes.events.new.map(item => item.observedAt), [hour(3), hour(1), null, hour(4), hour(2), null, hour(6), hour(5), hour(23), null]);
});

test('events with equal level and time keep the order of the snapshot', () => {
  const events = [ev(5), ev(3), ev(9), ev(1)];
  const changes = buildChanges(deepFreeze(sweep(0)), deepFreeze(sweep(1, { events })));
  assert.deepEqual(ids(changes.events.new), [5, 3, 9, 1].map(eid));
});

test('the lists are capped at 40/30/20 while the totals stay real (5000 new events)', () => {
  const words = ['critical', 'high', 'moderate', 'low'];
  const events = Array.from({ length: 5000 }, (_, n) => ev(n + 1, { severity: words[n % 4] }));
  const sources = ['USGS', ...Array.from({ length: 39 }, (_, n) => `zz-${String(n).padStart(2, '0')}`)];
  const signals = Array.from({ length: 30 }, (_, n) => ({ key: `m${n}`, label: `Metric ${n}`, direction: 'up', severity: n === 29 ? 'critical' : 'moderate' }));
  const previous = deepFreeze(sweep(0, { health: sources.map(name => row(name)) }));
  const current = deepFreeze(sweep(1, { events, health: sources.map(name => row(name, { err: true })), delta: { signals: { new: [], escalated: signals, deescalated: [], unchanged: [] } } }));
  const changes = buildChanges(previous, current);
  assert.equal(changes.events.newTotal, 5000);
  assert.equal(changes.events.new.length, CHANGE_CAPS.events);
  assert.ok(changes.events.new.every(item => item.severity === 'critical'));
  assert.equal(changes.sources.length, CHANGE_CAPS.sources);
  assert.equal(changes.sources[0].source, 'USGS', 'a source with a domain sorts before the ones without');
  assert.equal(changes.sources.at(-1).source, 'zz-28');
  assert.equal(changes.signals.length, CHANGE_CAPS.signals);
  assert.equal(changes.signals[0].key, 'm29', 'the critical signal survives the cap');
  assert.equal(changes.domains.hazards, 5001, 'the domain tally counts every new event and transition, not just the listed ones');
});

test('a missing, empty or malformed previous snapshot is a baseline: no flood, no since', () => {
  const current = deepFreeze(sweep(1, { events: [ev(1), ev(2)], health: [row('USGS')], delta: { signals: { new: [{ key: 'a', label: 'A' }], escalated: [], deescalated: [] } } }));
  for (const previous of [null, undefined, {}, [], 'x', 5, true, { events: 'x' }, { events: { length: 2 } }, { events: null, meta: { timestamp: stamp(0) } }]) {
    const changes = buildChanges(deepFreeze(previous), current);
    assert.equal(changes.baseline, true, JSON.stringify(previous));
    assert.equal(changes.since, null);
    assert.equal(changes.at, stamp(1));
    assert.deepEqual(changes.events, { new: [], newTotal: 0, expiredTotal: 0 });
    assert.deepEqual(changes.sources, []);
    assert.deepEqual(changes.signals, []);
    assert.deepEqual(changes.domains, {});
  }
});

test('a current snapshot without an events array is also a baseline, so nothing is reported expired', () => {
  const previous = deepFreeze(sweep(0, { events: [ev(1), ev(2)], health: [row('USGS')] }));
  for (const current of [null, undefined, {}, { events: 'x' }, { events: { 0: ev(1) } }, 'x', 7]) {
    const changes = buildChanges(previous, deepFreeze(current), { now: () => BASE });
    assert.equal(changes.baseline, true, JSON.stringify(current));
    assert.deepEqual(changes.events, { new: [], newTotal: 0, expiredTotal: 0 });
    assert.equal(changes.at, new Date(BASE).toISOString());
  }
});

test('at is the snapshot time; without a usable time it falls back to the injected clock', () => {
  const previous = deepFreeze(sweep(0));
  assert.equal(buildChanges(previous, deepFreeze(sweep(1))).at, stamp(1));
  assert.equal(buildChanges(previous, deepFreeze({ meta: { timestamp: '2026-10-03T10:00:00+02:00' }, events: [] })).at, '2026-10-03T08:00:00.000Z');
  const fallback = new Date(BASE + 5).toISOString();
  for (const meta of [undefined, null, {}, { timestamp: 'not a time' }, { timestamp: 12 }, 'x']) {
    assert.equal(buildChanges(previous, deepFreeze({ meta, events: [] }), { now: () => BASE + 5 }).at, fallback);
  }
  assert.match(buildChanges(previous, deepFreeze({ events: [] })).at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(buildChanges(deepFreeze({ meta: { timestamp: 'nope' }, events: [] }), deepFreeze(sweep(1))).since, null, 'an unknown previous time is null, not a baseline');
  assert.equal(buildChanges(deepFreeze({ meta: { timestamp: 'nope' }, events: [] }), deepFreeze(sweep(1))).baseline, false);
});

test('events without a valid id are ignored, as new events and as expired ones', () => {
  const junk = [null, 5, 'x', [], {}, { id: 5 }, { id: 'x' }, { id: '../../etc/passwd' }, { id: `event-${'g'.repeat(32)}` }, { id: `event-${'a'.repeat(31)}` },
    { id: `${eid(1)}\n` }, { id: `${eid(1)}0` }, { id: `event-${'A'.repeat(32)}` }];
  const vanished = buildChanges(deepFreeze(sweep(0, { events: [ev(1), ...junk] })), deepFreeze(sweep(1, { events: [ev(2)] })));
  assert.deepEqual(ids(vanished.events.new), [eid(2)]);
  assert.equal(vanished.events.newTotal, 1);
  assert.equal(vanished.events.expiredTotal, 1);
  const appeared = buildChanges(deepFreeze(sweep(0, { events: [ev(1)] })), deepFreeze(sweep(1, { events: [ev(2), ...junk] })));
  assert.deepEqual(ids(appeared.events.new), [eid(2)]);
  assert.equal(appeared.events.newTotal, 1);
  assert.equal(appeared.events.expiredTotal, 1);
});

test('source transitions: ok to error, error to ok, a source that appears or vanishes is no transition', () => {
  const previous = deepFreeze(sweep(0, { health: [
    row('USGS'), row('GDELT'), row('FRED', { err: true }), row('OFAC', { stale: true }), row('WHO'), row('EPA'), row('Alpha-unknown'), row('Zeta-unknown'),
  ] }));
  const current = deepFreeze(sweep(1, { health: [
    row('USGS', { err: true }), row('GDELT'), row('FRED'), row('OFAC', { stale: true, disabled: true }), row('WHO', { err: true, stale: true }),
    row('Zeta-unknown', { stale: true }), row('Alpha-unknown', { err: true }), row('Brand-New', { err: true }),
  ] }));
  const changes = buildChanges(previous, current);
  assert.deepEqual(changes.sources, [
    { source: 'USGS', domain: 'hazards', from: 'ok', to: 'error' },
    { source: 'FRED', domain: 'economy', from: 'error', to: 'ok' },
    { source: 'OFAC', domain: 'sanctions', from: 'stale', to: 'disabled' },
    { source: 'WHO', domain: 'health', from: 'ok', to: 'error' },
    { source: 'Alpha-unknown', domain: null, from: 'ok', to: 'error' },
    { source: 'Zeta-unknown', domain: null, from: 'ok', to: 'stale' },
  ]);
  assert.deepEqual(changes.domains, { hazards: 1, economy: 1, sanctions: 1, health: 1 }, 'transitions without a domain are counted under no domain');
});

test('health rows: the first row of a name wins, unusable rows and names are skipped, odd names are plain keys', () => {
  const previous = deepFreeze(sweep(0, { health: [row('USGS'), row('USGS', { err: true }), row('constructor'), row('__proto__'), row('toString')] }));
  const current = deepFreeze(sweep(1, { health: [
    null, 5, 'x', [], {}, { n: 5 }, { n: '' }, { n: 'x'.repeat(65), err: true }, row('USGS', { stale: true }), row('USGS', { err: true }),
    row('constructor', { err: true }), row('__proto__', { err: true }), row('toString', { stale: true }),
  ] }));
  const changes = buildChanges(previous, current);
  assert.deepEqual(changes.sources.map(({ source, from, to }) => [source, from, to]), [
    ['USGS', 'ok', 'stale'], ['__proto__', 'ok', 'error'], ['constructor', 'ok', 'error'], ['toString', 'ok', 'stale'],
  ]);
  assert.ok(changes.sources.every(item => item.domain === (item.source === 'USGS' ? 'hazards' : null)));
  assert.equal(buildChanges(deepFreeze(sweep(0, { health: 'x' })), deepFreeze(sweep(1, { health: [row('USGS', { err: true })] }))).sources.length, 0);
  assert.equal(buildChanges(deepFreeze(sweep(0, { health: [row('USGS')] })), deepFreeze(sweep(1, { health: { USGS: 1 } }))).sources.length, 0);
});

test('the source state precedence is the archive one (disabled > error > stale > ok) for every flag combination', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-changes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const archive = new SweepArchive(dir, { logger: { warn() {}, error() {}, log() {} } });
  const combos = [];
  for (const err of [false, true]) for (const stale of [false, true]) for (const disabled of [false, true]) combos.push(row('USGS', { err, stale, disabled }));
  const expected = ['ok', 'disabled', 'stale', 'disabled', 'error', 'disabled', 'error', 'disabled'];
  combos.forEach((flags, index) => archive.add({ snapshot: { meta: { timestamp: stamp(index) }, health: [flags] } }));
  const cells = archive.healthSeries({ sweeps: combos.length }).sources[0].cells;
  assert.deepEqual(SOURCE_STATES, ['ok', 'stale', 'error', 'disabled']);
  assert.deepEqual(cells.map(cell => SOURCE_STATES[cell[0]]), expected, 'the archive codes');
  combos.forEach((flags, index) => {
    const from = expected[index] === 'ok' ? row('USGS', { err: true }) : row('USGS');
    const changes = buildChanges(deepFreeze(sweep(0, { health: [from] })), deepFreeze(sweep(1, { health: [flags] })));
    assert.deepEqual(changes.sources.map(entry => entry.to), [expected[index]], JSON.stringify(flags));
  });
});

test('delta signals are simplified, ordered by level then new/escalated/deescalated, and keep no provider text', () => {
  const delta = {
    timestamp: stamp(1), previous: stamp(0),
    signals: {
      new: [
        { key: 'tg_urgent:abc', text: '<img src=x onerror=alert(1)>', item: { text: 'hostile' }, reason: 'New urgent OSINT post' },
        { key: 'nuke_anomaly', reason: 'Nuclear anomaly detected', severity: 'critical' },
        { key: 'source_degradation', reason: '3 additional sources failing', severity: 'moderate' },
      ],
      escalated: [{ key: 'vix', label: 'VIX', from: 18, to: 21, pctChange: 16.7, direction: 'up', severity: 'high' }],
      deescalated: [
        { key: 'wti', label: 'WTI Crude', from: 80, to: 76, direction: 'down', severity: 'moderate' },
        { key: 'nuke_anomaly', label: 'Nuclear Anomaly', direction: 'resolved', severity: 'high' },
      ],
      unchanged: ['gold'],
    },
  };
  const changes = buildChanges(deepFreeze(sweep(0)), deepFreeze(sweep(1, { delta })));
  assert.deepEqual(changes.signals, [
    { key: 'nuke_anomaly', label: 'Nuclear anomaly detected', direction: null, severity: 'critical', type: 'new' },
    { key: 'vix', label: 'VIX', direction: 'up', severity: 'high', type: 'escalated' },
    { key: 'nuke_anomaly', label: 'Nuclear Anomaly', direction: 'resolved', severity: 'high', type: 'deescalated' },
    { key: 'source_degradation', label: '3 additional sources failing', direction: null, severity: 'watch', type: 'new' },
    { key: 'wti', label: 'WTI Crude', direction: 'down', severity: 'watch', type: 'deescalated' },
    { key: 'tg_urgent:abc', label: 'New urgent OSINT post', direction: null, severity: null, type: 'new' },
  ]);
  assert.doesNotMatch(JSON.stringify(changes), /onerror|hostile/);
  assert.deepEqual(changes.domains, {}, 'signals carry no domain');
});

test('a signal severity that is no event-scale word stays a short plain string; non-strings become null', () => {
  const entries = [
    { key: 'a', label: 'A', severity: 'Critical' }, { key: 'b', label: 'B', severity: 'severe' }, { key: 'c', label: 'C', severity: 'odd' },
    { key: 'd', label: 'D', severity: `  ${'x'.repeat(100)}` }, { key: 'e', label: 'E', severity: 7 }, { key: 'f', label: 'F', severity: '' },
    { key: 'g', label: 'G', severity: '<b>' }, { key: 'h', label: 'H' },
  ];
  const changes = buildChanges(deepFreeze(sweep(0)), deepFreeze(sweep(1, { delta: { signals: { new: [], escalated: entries, deescalated: [] } } })));
  const severity = Object.fromEntries(changes.signals.map(item => [item.key, item.severity]));
  assert.deepEqual(severity, { a: 'critical', b: 'high', c: 'odd', d: 'x'.repeat(18), e: null, f: null, g: '<b>', h: null });
  assert.ok(changes.signals.every(item => item.severity === null || item.severity.length <= 20));
});

test('signal labels fall back to the reason, then the key; unusable entries and delta shapes are skipped without throwing', () => {
  const entries = [{ key: 'k1', reason: 'because' }, { key: 'k2' }, { key: 'k3', label: 'L'.repeat(300) }, null, 5, 'x', [], {}, { key: 5 }, { key: '' }, { label: 'no key' }];
  const changes = buildChanges(deepFreeze(sweep(0)), deepFreeze(sweep(1, { delta: { signals: { new: entries, escalated: 'x', deescalated: null } } })));
  assert.deepEqual(changes.signals.map(item => [item.key, item.label.length, item.label.slice(0, 7)]), [['k1', 7, 'because'], ['k2', 2, 'k2'], ['k3', 200, 'LLLLLLL']]);
  for (const delta of [null, undefined, 'x', 5, [], {}, { signals: null }, { signals: 'x' }, { signals: [] }, { signals: { new: { length: 3 } } }]) {
    assert.deepEqual(buildChanges(deepFreeze(sweep(0)), deepFreeze(sweep(1, { delta }))).signals, [], JSON.stringify(delta));
  }
});

test('hostile titles and source names stay plain strings, cut at 200 and 120 characters without half a surrogate pair', () => {
  const html = '<img src=x onerror=alert(1)>"\'&';
  const events = [
    ev(1, { title: html, source: { name: '<b>GDELT</b>' } }),
    ev(2, { title: `${'a'.repeat(199)}\u{1F600}tail` }),
    ev(3, { title: 'x'.repeat(500), source: { name: 'n'.repeat(300) } }),
    ev(4, { title: 'ab\ud83d cd \ude00 ef' }),
    ev(5, { title: 42 }),
    ev(6, { title: `${'b'.repeat(198)}\u{1F600}more` }),
    ev(7, { title: { toString() { throw new Error('never called'); } }, source: { name: 7 }, kind: ['x'] }),
    ev(8, { title: '\u{1F600}'.repeat(150) }),
    ev(9, { source: 'bare string source', title: '__proto__' }),
  ];
  const changes = buildChanges(deepFreeze(sweep(0)), deepFreeze(sweep(1, { events })));
  const byId = Object.fromEntries(changes.events.new.map(item => [item.id, item]));
  assert.equal(byId[eid(1)].title, html);
  assert.equal(byId[eid(1)].source, '<b>GDELT</b>');
  assert.equal(byId[eid(2)].title, 'a'.repeat(199));
  assert.equal(byId[eid(3)].title, 'x'.repeat(200));
  assert.equal(byId[eid(3)].source.length, 120);
  assert.equal(byId[eid(4)].title, 'ab\ufffd cd \ufffd ef');
  assert.equal(byId[eid(5)].title, '');
  assert.equal(byId[eid(6)].title.length, 200);
  assert.ok(byId[eid(6)].title.endsWith('\u{1F600}'));
  assert.equal(byId[eid(7)].title, '');
  assert.equal(byId[eid(7)].source, '');
  assert.equal(byId[eid(7)].kind, '');
  assert.equal(byId[eid(8)].title, '\u{1F600}'.repeat(100));
  assert.equal(byId[eid(9)].title, '__proto__');
  assert.equal(byId[eid(9)].source, '');
  assert.equal(byId[eid(9)].domain, null);
  for (const item of changes.events.new) {
    for (const field of ['title', 'kind', 'source']) { assert.equal(typeof item[field], 'string'); assert.ok(item[field].isWellFormed(), field); }
    assert.ok(item.title.length <= 200 && item.source.length <= 120);
  }
});

test('observedAt is an ISO time or null; the domain follows the source name', () => {
  const events = [
    ev(1, { observedAt: '2026-10-03T10:00:00+02:00', source: { name: 'GDELT' } }), ev(2, { observedAt: 'yesterday', source: { name: 'Telegram' } }),
    ev(3, { observedAt: 17, source: { name: 'Unlisted feed' } }), ev(4, { source: null }), ev(5, { source: { name: null }, sourceName: 'FRED' }),
  ];
  const changes = buildChanges(deepFreeze(sweep(0)), deepFreeze(sweep(1, { events })));
  const byId = Object.fromEntries(changes.events.new.map(item => [item.id, item]));
  assert.equal(byId[eid(1)].observedAt, '2026-10-03T08:00:00.000Z');
  assert.equal(byId[eid(2)].observedAt, null);
  assert.equal(byId[eid(3)].observedAt, null);
  assert.deepEqual([eid(1), eid(2), eid(3), eid(4), eid(5)].map(id => byId[id].domain), ['security', 'security', null, null, 'economy']);
  assert.equal(byId[eid(5)].source, 'FRED');
  assert.deepEqual(changes.domains, { security: 2, economy: 1 });
});

test('domains count new events plus transitions in domain order and leave out empty domains', () => {
  const events = [ev(1), ev(2, { source: { name: 'FRED' } }), ev(3, { source: { name: 'GDELT' } }), ev(4, { source: { name: 'Nowhere' } }), ev(5, { source: { name: 'GDELT' } })];
  const previous = deepFreeze(sweep(0, { health: [row('USGS'), row('Nowhere')] }));
  const current = deepFreeze(sweep(1, { events, health: [row('USGS', { err: true }), row('Nowhere', { err: true })] }));
  const changes = buildChanges(previous, current);
  assert.deepEqual(changes.domains, { security: 2, hazards: 2, economy: 1 });
  assert.deepEqual(Object.keys(changes.domains), DOMAIN_IDS.filter(id => id in changes.domains));
});

test('buildChanges does not mutate its inputs and returns fresh objects', () => {
  const previous = sweep(0, { events: [ev(1), ev(2)], health: [row('USGS')] });
  const current = sweep(1, { events: [ev(2), ev(3, { title: 'x'.repeat(400) })], health: [row('USGS', { err: true })], delta: { signals: { new: [{ key: 'a', label: 'A', severity: 'high' }], escalated: [], deescalated: [] } } });
  const before = JSON.stringify([previous, current]);
  deepFreeze(previous); deepFreeze(current);
  const changes = buildChanges(previous, current);
  assert.equal(JSON.stringify([previous, current]), before);
  assert.ok(Object.isFrozen(previous.events[0]) && !Object.isFrozen(changes));
  assert.ok(!Object.isFrozen(changes.events.new[0]));
  changes.events.new[0].title = 'edited';
  assert.equal(current.events[1].title.length, 400);
});

test('buildChanges is deterministic and never throws on odd containers', () => {
  const previous = deepFreeze(sweep(0, { events: [ev(1)] }));
  const current = deepFreeze(sweep(1, { events: [ev(1), ev(2)] }));
  assert.deepEqual(buildChanges(previous, current), buildChanges(previous, current));
  for (const bad of [null, undefined, 0, '', 'x', [], [[]], {}, { events: [[]], health: [[]], delta: [] }, { events: [null], meta: [] }, Object.create(null), new Date(0), () => {}]) {
    assert.doesNotThrow(() => buildChanges(bad, bad));
    assert.doesNotThrow(() => buildChanges(previous, bad));
    assert.doesNotThrow(() => buildChanges(bad, current));
  }
});

// ─── mergeChanges ────────────────────────────────────────────────────────────

// A changes object by hand, in the shape buildChanges returns.
function shell(n, parts = {}) {
  const { events = [], newTotal = events.length, expiredTotal = 0, sources = [], signals = [], domains = {}, baseline = false, since = stamp(n - 1) } = parts;
  return { since, at: stamp(n), baseline, events: { new: events, newTotal, expiredTotal }, sources, signals, domains };
}
const item = (n, extra = {}) => ({ id: eid(n), title: `Event ${n}`, kind: 'news', source: 'USGS', domain: 'hazards', severity: 'watch', observedAt: null, ...extra });
const move = (source, from, to, domain = null) => ({ source, domain, from, to });

function sequence() {
  const chain = [
    sweep(0, { health: [row('USGS')] }),
    sweep(1, { events: [ev(1, { severity: 'high', observedAt: hour(1) }), ev(2, { severity: 'low', source: { name: 'GDELT' } })], health: [row('USGS', { err: true })] }),
    sweep(2, { events: [ev(1, { severity: 'high' }), ev(2, { severity: 'low', source: { name: 'GDELT' } }), ev(3, { severity: 'critical', observedAt: hour(2) })], health: [row('USGS')] }),
    sweep(3, { events: [ev(3, { severity: 'critical' }), ev(4, { severity: 'moderate' })], health: [row('USGS')] }),
    sweep(4, { events: [ev(3, { severity: 'critical' }), ev(4, { severity: 'moderate' }), ev(1, { severity: 'high', title: 'Event 1 again' })], health: [row('USGS')] }),
  ];
  return chain.slice(1).map((current, index) => buildChanges(deepFreeze(chain[index]), deepFreeze(current)));
}

test('mergeChanges unions a window: dedupe by id keeping the earliest, severity then recency, real totals, chronological sources', () => {
  const list = deepFreeze(sequence());
  const merged = mergeChanges(list);
  assert.equal(merged.baseline, false);
  assert.equal(merged.since, stamp(0));
  assert.equal(merged.at, stamp(4));
  assert.deepEqual(ids(merged.events.new), [3, 1, 4, 2].map(eid));
  assert.equal(merged.events.new[1].title, 'Event 1', 'the earliest sighting is kept');
  assert.equal(merged.events.newTotal, 4, 'five sightings, one of them a repeat');
  assert.equal(merged.events.expiredTotal, 2);
  assert.deepEqual(merged.sources, [
    { source: 'USGS', domain: 'hazards', from: 'ok', to: 'error' },
    { source: 'USGS', domain: 'hazards', from: 'error', to: 'ok' },
  ]);
  assert.deepEqual(merged.domains, { security: 1, hazards: 5 });
  assert.deepEqual(Object.keys(merged), ['since', 'at', 'baseline', 'events', 'sources', 'signals', 'domains']);
});

test('merging one changes object returns it, with baseline false', () => {
  const [first, second] = sequence();
  for (const single of [first, second]) {
    assert.deepEqual(mergeChanges(deepFreeze([single])), { ...single, baseline: false });
  }
});

test('mergeChanges caps the lists at 40/30/20 and keeps real totals; sources keep the newest transitions', () => {
  const crowd = (from, severity) => Array.from({ length: 40 }, (_, n) => item(from + n, { severity, observedAt: hour(1 + (n % 20)) }));
  const first = shell(1, { events: crowd(1, 'high'), newTotal: 90, domains: { hazards: 90 }, sources: Array.from({ length: 20 }, (_, n) => move(`a-${n}`, 'ok', 'error')) });
  const second = shell(2, { events: crowd(101, 'critical'), newTotal: 70, domains: { hazards: 70 }, sources: Array.from({ length: 20 }, (_, n) => move(`b-${n}`, 'ok', 'stale')) });
  const third = shell(3, {
    sources: Array.from({ length: 20 }, (_, n) => move(`c-${n}`, 'error', 'ok')),
    signals: Array.from({ length: 15 }, (_, n) => ({ key: `s${n}`, label: `S${n}`, direction: 'up', severity: 'watch', type: 'escalated' })),
  });
  const fourth = shell(4, { signals: Array.from({ length: 15 }, (_, n) => ({ key: `t${n}`, label: `T${n}`, direction: 'up', severity: n === 14 ? 'critical' : 'info', type: 'new' })) });
  const merged = mergeChanges(deepFreeze([first, second, third, fourth]));
  assert.equal(merged.events.new.length, 40);
  assert.ok(merged.events.new.every(entry => entry.severity === 'critical'));
  assert.equal(merged.events.newTotal, 160);
  assert.equal(merged.domains.hazards, 160);
  assert.equal(merged.sources.length, 30);
  assert.deepEqual(merged.sources.map(entry => entry.source), [...Array.from({ length: 10 }, (_, n) => `b-${n + 10}`), ...Array.from({ length: 20 }, (_, n) => `c-${n}`)]);
  assert.equal(merged.signals.length, 20);
  assert.equal(merged.signals[0].key, 't14');
  assert.equal(merged.signals[1].key, 's0', 'equal levels keep their chronological order');
});

test('mergeChanges takes since from the first entry and at from the last, and the limit keeps the newest entries', () => {
  const list = deepFreeze([1, 2, 3, 4].map(n => shell(n, { events: [item(n)] })));
  const all = mergeChanges(list);
  assert.deepEqual([all.since, all.at], [stamp(0), stamp(4)]);
  const two = mergeChanges(list, { limit: 2 });
  assert.deepEqual([two.since, two.at], [stamp(2), stamp(4)]);
  assert.deepEqual(ids(two.events.new).sort(), [eid(3), eid(4)]);
  for (const limit of [0, -3, 1.5, NaN, '2', null, undefined, Infinity]) assert.equal(mergeChanges(list, { limit }).events.newTotal, 4, String(limit));
  assert.equal(mergeChanges(list, null).events.newTotal, 4);
  assert.equal(mergeChanges(list, { limit: 1 }).events.newTotal, 1);
  const first = shell(1, { baseline: true, since: null, events: [] });
  assert.equal(mergeChanges(deepFreeze([first, shell(2, { events: [item(2)] })])).since, stamp(1), 'a baseline entry without since starts the window at its own time');
});

test('a window that holds only baseline entries, or nothing, is a baseline with nothing in it', () => {
  const nothing = { since: null, at: null, baseline: true, events: { new: [], newTotal: 0, expiredTotal: 0 }, sources: [], signals: [], domains: {} };
  for (const list of [[], undefined, null, 'x', 5, {}, [null, 5, 'x', [], {}]]) assert.deepEqual(mergeChanges(deepFreeze(list)), nothing, JSON.stringify(list));
  const only = mergeChanges(deepFreeze([buildChanges(deepFreeze(null), deepFreeze(sweep(1, { events: [ev(1)] })))]));
  assert.equal(only.baseline, true);
  assert.equal(only.at, stamp(1));
  assert.deepEqual(only.events, { new: [], newTotal: 0, expiredTotal: 0 });
});

test('mergeChanges skips malformed entries and items without throwing and cleans what it keeps', () => {
  const messy = {
    since: 'nope', at: stamp(2), baseline: 'yes',
    events: { new: [null, 5, { id: 'x' }, { id: `event-${'g'.repeat(32)}`, title: 'bad id' },{ id: eid(1), title: 7, kind: null, source: 'x', domain: 'bogus', severity: 'elevated', observedAt: 'later' }, item(2, { title: 'y'.repeat(500), severity: 'critical' })], newTotal: -4, expiredTotal: 'many' },
    sources: [null, 5, move('USGS', 'ok', 'ok'), move('USGS', 'ok', 'bogus'), move('', 'ok', 'error'), move('USGS', 'ok', 'error', 'bogus'), move('x'.repeat(65), 'ok', 'error')],
    signals: [null, 'x', { key: 'k', label: 'K', direction: 'up', severity: 'moderate', type: 'escalated' }, { key: 'k2', type: 'bogus' }, { key: 5, type: 'new' }, { key: 'k3', type: 'new', severity: 'high' }],
    domains: { hazards: 2, security: -1, economy: 1.5, health: '3', bogus: 9 },
  };
  const merged = mergeChanges(deepFreeze([null, {}, { events: 'x' }, { events: { new: 'x' } }, [], messy, { events: { new: [] }, domains: [] }]));
  assert.equal(merged.baseline, false);
  assert.equal(merged.since, stamp(2), 'an unusable since falls back to the entry time');
  assert.deepEqual(merged.events.new.map(entry => [entry.id, entry.title.length, entry.kind, entry.source, entry.domain, entry.severity, entry.observedAt]), [
    [eid(2), 200, 'news', 'USGS', 'hazards', 'critical', null],
    [eid(1), 0, '', 'x', null, null, null],
  ]);
  assert.equal(merged.events.newTotal, 2);
  assert.equal(merged.events.expiredTotal, 0);
  assert.deepEqual(merged.sources, [{ source: 'USGS', domain: 'hazards', from: 'ok', to: 'error' }], 'the domain is derived from the name, not trusted');
  assert.deepEqual(merged.signals, [
    { key: 'k3', label: 'k3', direction: null, severity: 'high', type: 'new' },
    { key: 'k', label: 'K', direction: 'up', severity: 'watch', type: 'escalated' },
  ]);
  assert.deepEqual(merged.domains, { hazards: 2 });
  for (const bad of [[Symbol.iterator], [{ events: { new: [{ id: eid(1), source: { name: Symbol('x') } }] } }], [{ events: { new: Array(5) } }]]) {
    assert.doesNotThrow(() => mergeChanges(bad));
  }
});

test('mergeChanges does not mutate its input and never shares objects with it', () => {
  const list = sequence();
  const before = JSON.stringify(list);
  deepFreeze(list);
  const merged = mergeChanges(list);
  assert.equal(JSON.stringify(list), before);
  assert.ok(!Object.isFrozen(merged.events.new[0]) && !Object.isFrozen(merged.sources[0]));
  assert.notEqual(merged.events.new[0], list[0].events.new[0]);
  assert.deepEqual(mergeChanges(list), merged);
});
