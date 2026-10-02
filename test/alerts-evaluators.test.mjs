import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRule, haversineKm, cellOf, matchesScope } from '../lib/alerts/evaluators.mjs';
import { validateRule, DEFAULT_RULES } from '../lib/alerts/rules.mjs';

const HOUR = 3600000;
const NOW = Date.parse('2026-10-02T12:00:00Z');
const iso = ms => new Date(ms).toISOString();

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

// Rules go through the real validator, so the evaluators only ever see shapes the engine will give them.
function rule(input) {
  const result = validateRule({ name: 'Test rule', ...input });
  assert.equal(result.ok, true, result.ok ? '' : `${result.error.field}: ${result.error.message}`);
  return result.rule;
}
const eventRule = (params, extra = {}) => rule({ id: 'ev', kind: 'event', severity: 'auto', params, ...extra });
const thresholdRule = (params, extra = {}) => rule({ id: 'th', kind: 'threshold', severity: 'high', params: { metric: 'vix', op: '>', value: 30, ...params }, ...extra });
const changeRule = (params, extra = {}) => rule({ id: 'ch', kind: 'change', severity: 'watch', params: { metric: 'wti', pct: 5, ...params }, ...extra });
const absenceRule = (params, extra = {}) => rule({ id: 'ab', kind: 'absence', severity: 'watch', params: { source: 'any', minFailSweeps: 3, ...params }, ...extra });
const convergenceRule = (params = {}, extra = {}) => rule({ id: 'cv', kind: 'convergence', severity: 'high', params, ...extra });
const deltaRule = (params, extra = {}) => rule({ id: 'dl', kind: 'delta', severity: 'critical', params, ...extra });

// Every evaluation runs against a deep-frozen context: a write to it would throw in these strict modules.
function run(target, parts = {}) {
  return evaluateRule(target, deepFreeze({
    snapshot: {}, events: [], metrics: {}, previousMetrics: {}, health: [],
    failStreak: () => 0, isActive: () => false, now: NOW, ...parts,
  }));
}

let counter = 0;
const place = (lat, lon, label = null) => ({ lat, lon, method: 'provider', label, precision: 'exact' });
function ev(overrides = {}) {
  counter += 1;
  return {
    id: `event-${String(counter).padStart(32, '0')}`, kind: 'conflict', title: `Event ${counter}`, summary: '',
    source: { name: 'ACLED', url: null, hostname: null, status: 'ok' },
    observedAt: iso(NOW - HOUR), publishedAt: null,
    location: { lat: null, lon: null, method: 'unknown', label: null, precision: 'unknown' },
    severity: 'high', ...overrides,
  };
}
const keysOf = hits => hits.map(hit => hit.dedupKey);

// ─── haversineKm, cellOf, matchesScope ───────────────────────────────────────

test('haversineKm: Budapest to Vienna is about 215 km, and it is symmetric', () => {
  const budapest = { lat: 47.4979, lon: 19.0402 };
  const vienna = { lat: 48.2082, lon: 16.3738 };
  assert.ok(Math.abs(haversineKm(budapest, vienna) - 215) <= 5, String(haversineKm(budapest, vienna)));
  assert.equal(haversineKm(budapest, vienna), haversineKm(vienna, budapest));
  assert.equal(haversineKm(budapest, budapest), 0);
  assert.ok(Math.abs(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }) - 20015) < 20, 'half the globe');
  assert.ok(Math.abs(haversineKm({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }) - 22.2) < 0.5, 'across the antimeridian');
});

test('haversineKm is NaN for anything that is not a coordinate pair, so a comparison against a radius is false', () => {
  for (const bad of [null, undefined, {}, { lat: 'x', lon: 1 }, { lat: NaN, lon: 1 }, { lat: 1, lon: Infinity }, 5]) {
    assert.ok(Number.isNaN(haversineKm(bad, { lat: 1, lon: 1 })), JSON.stringify(bad));
    assert.ok(Number.isNaN(haversineKm({ lat: 1, lon: 1 }, bad)), JSON.stringify(bad));
  }
});

test('cellOf is stable inside a cell, differs across a boundary, and includes the cell size', () => {
  const cell = cellOf(47.9, 19.1, 2);
  assert.equal(typeof cell, 'string');
  assert.equal(cellOf(47.9, 19.1, 2), cell, 'stable');
  assert.equal(cellOf(47.1, 19.9, 2), cell, 'same 2 degree cell');
  assert.equal(cellOf(46.0, 18.0, 2), cell, 'the south-west corner belongs to the cell');
  assert.notEqual(cellOf(48.0, 19.1, 2), cell, 'north across the boundary');
  assert.notEqual(cellOf(47.9, 20.0, 2), cell, 'east across the boundary');
  assert.notEqual(cellOf(45.9, 19.1, 2), cell, 'south across the boundary');
  assert.notEqual(cellOf(47.9, 17.9, 2), cell, 'west across the boundary');
  assert.notEqual(cellOf(47.9, 19.1, 1), cell, 'a different cell size is a different cell');
  assert.notEqual(cellOf(47.9, 19.1, 4), cellOf(47.9, 19.1, 2));
  assert.equal(cellOf(47.9, 19.1, 4), cellOf(46.1, 16.1, 4), '4 degree cells start at multiples of 4 from -90/-180');
  assert.notEqual(cellOf(47.9, 19.1, 4), cellOf(45.9, 19.1, 4));
  assert.match(cell, /^[A-Za-z0-9:,._-]+$/, 'a plain key, safe inside a dedupKey');
});

test('cellOf handles the poles, the antimeridian and negative coordinates', () => {
  assert.equal(cellOf(90, 10, 2), cellOf(89.5, 10, 2), 'the pole belongs to the last cell');
  assert.equal(cellOf(10, 180, 2), cellOf(10, 179.5, 2), 'lon 180 belongs to the last cell');
  assert.equal(cellOf(-90, -180, 2), cellOf(-89.5, -179.5, 2));
  assert.notEqual(cellOf(-0.5, -0.5, 2), cellOf(0.5, 0.5, 2));
  assert.notEqual(cellOf(-0.5, 0.5, 2), cellOf(0.5, 0.5, 2));
  for (const bad of [[NaN, 0, 2], [0, NaN, 2], [91, 0, 2], [0, 181, 2], [0, 0, 0], [0, 0, -2], [0, 0, NaN], ['1', 0, 2], [null, null, 2]]) assert.equal(cellOf(...bad), null, JSON.stringify(bad));
});

test('matchesScope: no scope matches every event, a non-event matches nothing', () => {
  const event = ev();
  for (const scope of [undefined, null, {}, 5]) assert.equal(matchesScope(event, scope), true, String(scope));
  for (const bad of [null, undefined, 'event', 5, []]) assert.equal(matchesScope(bad, {}), false);
});

// ─── evaluateRule: dispatch ──────────────────────────────────────────────────

test('evaluateRule returns [] for an unknown kind, a non-rule or a missing context', () => {
  const base = { id: 'x', name: 'X', enabled: true, severity: 'high', notify: false, forSweeps: 1, cooldownMinutes: 30, params: {} };
  for (const kind of ['banana', 'toString', '__proto__', 'constructor', '', undefined, null, 5, ['event']]) assert.deepEqual(run({ ...base, kind }, { events: [ev()] }), [], String(kind));
  const context = deepFreeze({ events: [ev()], metrics: {}, now: NOW });
  for (const bad of [null, undefined, 5, 'rule', [], { kind: 'event' }, { kind: 'event', params: null }]) assert.deepEqual(evaluateRule(bad, context), []);
  for (const bad of [null, undefined, 5, 'ctx']) assert.deepEqual(evaluateRule(eventRule({ minLevel: 'info' }), bad), []);
});

test('evaluateRule copes with a context that is missing its parts', () => {
  assert.deepEqual(evaluateRule(eventRule({ minLevel: 'info' }), {}), []);
  assert.deepEqual(evaluateRule(thresholdRule({}), {}), []);
  assert.deepEqual(evaluateRule(changeRule({}), {}), []);
  assert.deepEqual(evaluateRule(absenceRule({}), {}), []);
  assert.deepEqual(evaluateRule(convergenceRule(), {}), []);
  assert.deepEqual(evaluateRule(deltaRule({ minSeverity: 'high' }), {}), []);
  assert.deepEqual(evaluateRule(eventRule({ minLevel: 'info' }), { events: 'not a list', now: NOW }), []);
  assert.deepEqual(evaluateRule(absenceRule({}), { health: { n: 'GDACS', err: true }, now: NOW }), []);
});

test('the built-in pack evaluates without throwing on an empty context', () => {
  for (const builtin of DEFAULT_RULES) assert.deepEqual(run(structuredClone(builtin)), [], builtin.id);
});

// ─── event ───────────────────────────────────────────────────────────────────

test('event: only events at or above minLevel hit, in order, with dedupKey rule|event.id', () => {
  const events = ['critical', 'high', 'elevated', 'moderate', 'monitor', 'low', 'unknown'].map(severity => ev({ severity }));
  const hits = run(eventRule({ minLevel: 'high' }), { events });
  assert.deepEqual(keysOf(hits), [`ev|${events[0].id}`, `ev|${events[1].id}`, `ev|${events[2].id}`]);
  assert.deepEqual(keysOf(run(eventRule({ minLevel: 'watch' }), { events })), events.slice(0, 4).map(event => `ev|${event.id}`));
  assert.deepEqual(keysOf(run(eventRule({ minLevel: 'info' }), { events })), events.slice(0, 6).map(event => `ev|${event.id}`), 'unknown severity raises nothing even at info');
  assert.deepEqual(keysOf(run(eventRule({ minLevel: 'critical' }), { events })), [`ev|${events[0].id}`]);
});

test('event: maxLevel caps the level, so events-high and events-critical never both match one event', () => {
  const events = ['critical', 'high', 'elevated', 'moderate', 'low'].map(severity => ev({ severity }));
  assert.deepEqual(keysOf(run(eventRule({ minLevel: 'high', maxLevel: 'high' }), { events })), [`ev|${events[1].id}`, `ev|${events[2].id}`]);
  assert.deepEqual(keysOf(run(eventRule({ minLevel: 'watch', maxLevel: 'high' }), { events })), [1, 2, 3].map(index => `ev|${events[index].id}`));
  assert.deepEqual(keysOf(run(eventRule({ minLevel: 'high', maxLevel: 'critical' }), { events })), [0, 1, 2].map(index => `ev|${events[index].id}`));
  const high = DEFAULT_RULES.find(item => item.id === 'events-high');
  const critical = DEFAULT_RULES.find(item => item.id === 'events-critical');
  const matching = event => [high, critical].filter(item => run(structuredClone(item), { events: [event] }).length === 1).map(item => item.id);
  assert.deepEqual(events.map(matching), [['events-critical'], ['events-high'], ['events-high'], [], []], 'each critical or high event matches exactly one built-in rule');
});

test('event: severity auto takes the level of the event, a fixed severity overrides it', () => {
  const events = [ev({ severity: 'critical' }), ev({ severity: 'elevated' }), ev({ severity: 'moderate' })];
  assert.deepEqual(run(eventRule({ minLevel: 'watch' }), { events }).map(hit => hit.severity), ['critical', 'high', 'watch']);
  assert.deepEqual(run(eventRule({ minLevel: 'watch' }, { severity: 'info' }), { events }).map(hit => hit.severity), ['info', 'info', 'info']);
  assert.deepEqual(run(eventRule({ minLevel: 'watch' }, { severity: 'critical' }), { events }).map(hit => hit.severity), ['critical', 'critical', 'critical']);
});

test('event: signal events are ignored; so are non-events, events without an id and repeated ids', () => {
  const real = ev();
  const events = [ev({ kind: 'signal', severity: 'critical' }), null, 'event', 5, [], { ...ev(), id: '' }, { ...ev(), id: 7 }, { ...ev(), id: undefined }, { ...ev(), severity: undefined }, real, { ...real }];
  const hits = run(eventRule({ minLevel: 'info' }), { events });
  assert.deepEqual(keysOf(hits), [`ev|${real.id}`]);
});

test('event: a hit carries the event as entity and as its only evidence', () => {
  const event = ev({ id: 'event-abc', kind: 'earthquake', title: 'M6.1 earthquake', summary: 'Near the coast', source: { name: 'USGS', url: 'https://example.org/x', hostname: 'example.org', status: 'ok' }, location: place(35.5, 139.7, 'Tokyo'), severity: 'critical' });
  const [hit] = run(eventRule({ minLevel: 'high' }), { events: [event] });
  assert.deepEqual(hit, {
    dedupKey: 'ev|event-abc', severity: 'critical', title: 'M6.1 earthquake', summary: 'Near the coast',
    entity: { type: 'event', id: 'event-abc', label: 'M6.1 earthquake', lat: 35.5, lon: 139.7 },
    evidence: [{ type: 'event', id: 'event-abc', title: 'M6.1 earthquake', source: 'USGS', level: 'critical' }],
  });
});

test('event: an event without coordinates has an entity without lat/lon, and an empty summary gets a description', () => {
  const [hit] = run(eventRule({ minLevel: 'info' }), { events: [ev({ kind: 'outage', summary: '', source: { name: 'IODA' }, location: { lat: null, lon: null, label: 'Iraq' }, severity: 'monitor' })] });
  assert.deepEqual(Object.keys(hit.entity).sort(), ['id', 'label', 'type']);
  assert.equal(hit.summary, 'outage event from IODA (Iraq)');
  assert.equal(hit.severity, 'info');
});

test('event scope: kinds', () => {
  const events = [ev({ kind: 'conflict' }), ev({ kind: 'earthquake' }), ev({ kind: 'news' })];
  assert.deepEqual(run(eventRule({ minLevel: 'info' }, { scope: { kinds: ['earthquake', 'news'] } }), { events }).map(hit => hit.entity.id), [events[1].id, events[2].id]);
  assert.deepEqual(run(eventRule({ minLevel: 'info' }, { scope: { kinds: ['outage'] } }), { events }), []);
});

test('event scope: sources match event.source.name regardless of case', () => {
  const events = [ev({ source: { name: 'GDACS' } }), ev({ source: { name: 'USGS' } }), ev({ source: { name: 'gdacs-feed' } }), ev({ source: null }), ev({ source: 'GDACS' })];
  assert.deepEqual(run(eventRule({ minLevel: 'info' }, { scope: { sources: ['gdacs'] } }), { events }).map(hit => hit.entity.id), [events[0].id]);
  assert.deepEqual(run(eventRule({ minLevel: 'info' }, { scope: { sources: ['USGS', 'GDACS'] } }), { events }).map(hit => hit.entity.id), [events[0].id, events[1].id]);
});

test('event scope: keywords ignore accents and case and look at title, summary and location label', () => {
  const byTitle = ev({ title: 'Árvíz Budapesten' });
  const bySummary = ev({ title: 'Report', summary: 'Heavy FLOODING expected' });
  const byLabel = ev({ title: 'Report', location: place(1, 1, 'Dél-Dunántúl') });
  const none = ev({ title: 'Quiet day' });
  const events = [byTitle, bySummary, byLabel, none];
  const ids = scope => run(eventRule({ minLevel: 'info' }, { scope }), { events }).map(hit => hit.entity.id);
  assert.deepEqual(ids({ keywords: ['arviz'] }), [byTitle.id], 'plain "arviz" finds "Árvíz"');
  assert.deepEqual(ids({ keywords: ['Árvíz'] }), [byTitle.id], 'accented keyword finds itself');
  assert.deepEqual(ids({ keywords: ['ÁRVÍZ'] }), [byTitle.id]);
  assert.deepEqual(ids({ keywords: ['flooding'] }), [bySummary.id]);
  assert.deepEqual(ids({ keywords: ['dunantul'] }), [byLabel.id]);
  assert.deepEqual(ids({ keywords: ['arviz', 'flooding'] }), [byTitle.id, bySummary.id], 'any keyword matches');
  assert.deepEqual(ids({ keywords: ['zzz'] }), [], 'no match');
  assert.deepEqual(run(eventRule({ minLevel: 'info' }, { scope: { keywords: ['tuzvesz'] } }), { events: [ev({ title: 'Tűzvész a városban' })] }).length, 1, 'double acute (ő/ű) folds too');
});

test('event scope: a keyword never matches across the boundary between title and summary', () => {
  const event = ev({ title: 'first', summary: 'second' });
  assert.deepEqual(run(eventRule({ minLevel: 'info' }, { scope: { keywords: ['first second', 'firstsecond', 'first-second'] } }), { events: [event] }), []);
});

test('event scope: a regex-looking keyword is matched literally', () => {
  const events = [ev({ title: 'plain words' }), ev({ title: 'literal .* here' }), ev({ title: 'nested (a+)+$ shape' }), ev({ title: 'open [ bracket' }), ev({ title: 'caret ^start' })];
  const ids = keyword => run(eventRule({ minLevel: 'info' }, { scope: { keywords: [keyword] } }), { events }).map(hit => hit.entity.id);
  assert.deepEqual(ids('.*'), [events[1].id]);
  assert.deepEqual(ids('(a+)+$'), [events[2].id]);
  assert.deepEqual(ids('['), [events[3].id]);
  assert.deepEqual(ids('^start'), [events[4].id]);
  assert.deepEqual(ids('p.ain'), []);
});

test('event scope: a pathological keyword against a long text finishes at once', () => {
  const event = ev({ title: 'a'.repeat(300), summary: `${'a'.repeat(1900)}!` });
  const started = process.hrtime.bigint();
  assert.deepEqual(run(eventRule({ minLevel: 'info' }, { scope: { keywords: ['(a+)+$', '(a|aa)+$', '.*.*.*x'] } }), { events: [event] }), []);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 500);
});

test('event scope: a keyword made only of combining marks matches nothing instead of everything', () => {
  const events = [ev({ title: 'anything at all' })];
  assert.deepEqual(run(eventRule({ minLevel: 'info' }, { scope: { keywords: ['́'] } }), { events }), []);
  assert.equal(run(eventRule({ minLevel: 'info' }, { scope: { keywords: ['́', 'anything'] } }), { events }).length, 1, 'other keywords still work');
});

test('event scope: radius needs valid coordinates inside the circle', () => {
  const budapest = ev({ title: 'in', location: place(47.4979, 19.0402) });
  const vienna = ev({ title: 'edge', location: place(48.2082, 16.3738) });
  const tokyo = ev({ title: 'out', location: place(35.68, 139.69) });
  const unknown = ev({ title: 'no coordinates' });
  const broken = [ev({ location: place(NaN, 19) }), ev({ location: place(95, 19) }), ev({ location: place(47, 190) }), ev({ location: { lat: '47', lon: '19' } }), ev({ location: null }), ev({ location: place(Infinity, 19) })];
  const events = [budapest, vienna, tokyo, unknown, ...broken];
  const ids = km => run(eventRule({ minLevel: 'info' }, { scope: { radius: { lat: 47.5, lon: 19, km } } }), { events }).map(hit => hit.entity.id);
  assert.deepEqual(ids(50), [budapest.id]);
  assert.deepEqual(ids(300), [budapest.id, vienna.id]);
  assert.deepEqual(ids(3000), [budapest.id, vienna.id], 'still no Tokyo, no unknown or invalid coordinates');
  assert.deepEqual(ids(1), [], 'Budapest centre is about 3 km from the circle centre');
});

test('event scope: every filter has to match', () => {
  const near = place(47.5, 19);
  const events = [ev({ kind: 'weather', title: 'Flood near the river', location: near }), ev({ kind: 'conflict', title: 'Flood near the river', location: near }), ev({ kind: 'weather', title: 'Flood near the river', location: place(10, 10) }), ev({ kind: 'weather', title: 'Storm', location: near }), ev({ kind: 'weather', title: 'Flood', source: { name: 'Other' }, location: near }), ev({ kind: 'weather', title: 'Flood near the river', source: { name: 'NOAA' }, location: near })];
  const scope = { kinds: ['weather'], sources: ['NOAA'], keywords: ['flood'], radius: { lat: 47.5, lon: 19, km: 100 } };
  const hits = run(eventRule({ minLevel: 'info' }, { scope }), { events });
  assert.deepEqual(hits.map(hit => hit.entity.id), [events[5].id]);
  assert.equal(matchesScope(events[5], scope), true);
  assert.equal(matchesScope(events[0], scope), false);
});

test('event: title and summary are length-capped and stripped of control and bidi characters', () => {
  const [long] = run(eventRule({ minLevel: 'info' }), { events: [ev({ title: 'T'.repeat(500), summary: 'S'.repeat(2000) })] });
  assert.equal(long.title.length, 160);
  assert.ok(long.title.endsWith('…'));
  assert.equal(long.summary.length, 600);
  assert.equal(long.evidence[0].title.length, 160);
  assert.equal(long.entity.label.length, 160);
  const [dirty] = run(eventRule({ minLevel: 'info' }), { events: [ev({ title: 'a\u202eb\u0000c\nd\u2028e\u0085f\u2067g\tHi', summary: 'x\r\ny\u2029z', source: { name: 'S\u0007rc' }, location: place(1, 2, 'La\nbel') })] });
  assert.equal(dirty.title, 'ab c d e fg Hi');
  assert.doesNotMatch(`${dirty.title}${dirty.summary}${dirty.evidence[0].source}${dirty.entity.label}`, /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
  assert.equal(dirty.summary, 'x y z');
  assert.equal(dirty.evidence[0].source, 'S rc');
  const [multibyte] = run(eventRule({ minLevel: 'info' }), { events: [ev({ title: `${'x'.repeat(158)}😀😀` })] });
  assert.ok(multibyte.title.length <= 160);
  assert.doesNotMatch(multibyte.title, /[\ud800-\udbff](?![\udc00-\udfff])/, 'no cut surrogate pair');
});

test('event: an event whose title is only control characters still gets a usable title', () => {
  const [hit] = run(eventRule({ minLevel: 'info' }), { events: [ev({ title: '\u0000\u202e\n' })] });
  assert.ok(hit.title.length > 0);
});

test('event: a large batch is evaluated quickly', () => {
  const events = Array.from({ length: 2000 }, (_, index) => ev({ title: `Report ${index} about the flooding`, summary: 'x'.repeat(1500), location: place(index % 90, index % 180) }));
  const started = process.hrtime.bigint();
  const hits = run(eventRule({ minLevel: 'info' }, { scope: { keywords: ['no-such-word', 'flooding'], radius: { lat: 0, lon: 0, km: 3000 } } }), { events });
  assert.ok(hits.length > 0);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 2000);
});

// ─── threshold ───────────────────────────────────────────────────────────────

test('threshold: all four operators, including the tie', () => {
  const fires = (op, value, metric) => run(thresholdRule({ op, value }), { metrics: { vix: metric } }).length === 1;
  assert.deepEqual([29, 30, 31].map(metric => fires('>', 30, metric)), [false, false, true]);
  assert.deepEqual([29, 30, 31].map(metric => fires('>=', 30, metric)), [false, true, true]);
  assert.deepEqual([29, 30, 31].map(metric => fires('<', 30, metric)), [true, false, false]);
  assert.deepEqual([29, 30, 31].map(metric => fires('<=', 30, metric)), [true, true, false]);
  assert.deepEqual([-1, 0, 1].map(metric => fires('<', 0, metric)), [true, false, false], 'negative thresholds');
});

test('threshold: a hit carries the metric, its value and the threshold', () => {
  const [hit] = run(thresholdRule({}), { metrics: { vix: 31.4, wti: 70 } });
  assert.deepEqual(hit, {
    dedupKey: 'th|vix', severity: 'high', title: 'VIX 31.4 > 30',
    summary: 'VIX is 31.4 index; the rule fires when it is > 30.',
    entity: { type: 'metric', id: 'vix', label: 'VIX' },
    evidence: [], metric: { key: 'vix', value: 31.4, threshold: 30 },
  });
});

test('threshold: a null, missing, non-numeric or non-finite metric never hits', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '40', {}, [], true]) assert.deepEqual(run(thresholdRule({}), { metrics: { vix: value } }), [], String(value));
  assert.deepEqual(run(thresholdRule({}), { metrics: {} }), []);
  assert.deepEqual(run(thresholdRule({}), { metrics: { wti: 99 } }), []);
  assert.deepEqual(run(thresholdRule({ op: '<', value: 5 }), { metrics: { vix: null } }), [], 'null is not below anything');
  assert.deepEqual(run(thresholdRule({}), { metrics: null }), []);
});

test('threshold: an active alert continues until the value is on the clear side of clearValue', () => {
  const asked = [];
  const rising = thresholdRule({ op: '>', value: 30, clearValue: 28 });
  const hits = (metric, active) => run(rising, { metrics: { vix: metric }, isActive: key => { asked.push(key); return active; } }).length;
  assert.equal(hits(31, true), 1, 'above the threshold');
  assert.equal(hits(29, true), 1, 'active at 31 stays active at 29');
  assert.equal(hits(28.01, true), 1);
  assert.equal(hits(28, true), 0, 'the value of clearValue itself has cleared (strict complement)');
  assert.equal(hits(27, true), 0, 'clears at 27');
  assert.equal(hits(29, false), 0, 'a quiet alert does not start in the dead band');
  assert.equal(hits(30, false), 0);
  assert.equal(hits(31, false), 1);
  assert.ok(asked.every(key => key === 'th|vix'), 'isActive is asked about rule|metric');
  const falling = thresholdRule({ op: '<', value: 5, clearValue: 6 });
  const fallingHits = (metric, active) => run(falling, { metrics: { vix: metric }, isActive: () => active }).length;
  assert.equal(fallingHits(4, true), 1);
  assert.equal(fallingHits(5.5, true), 1, 'stays in the dead band');
  assert.equal(fallingHits(6, true), 0, 'clears at the clear value');
  assert.equal(fallingHits(7, true), 0);
  assert.equal(fallingHits(5.5, false), 0);
});

test('threshold: without clearValue, or when clearValue equals value, the clear side is the exact complement of firing', () => {
  const cases = [
    ['>', 30, [29.99, 30, 30.01]], ['>=', 30, [29.99, 30, 30.01]], ['<', 30, [29.99, 30, 30.01]], ['<=', 30, [29.99, 30, 30.01]],
  ];
  for (const [op, value, metrics] of cases) {
    for (const clearValue of [undefined, value]) {
      const target = thresholdRule({ op, value, ...(clearValue === undefined ? {} : { clearValue }) });
      for (const metric of metrics) {
        const quiet = run(target, { metrics: { vix: metric }, isActive: () => false }).length;
        const active = run(target, { metrics: { vix: metric }, isActive: () => true }).length;
        assert.equal(active, quiet, `${op} ${value} clear ${clearValue} at ${metric}: an active alert holds exactly while it would fire`);
      }
    }
  }
  const ge = thresholdRule({ op: '>=', value: 30, clearValue: 30 });
  assert.equal(run(ge, { metrics: { vix: 30 }, isActive: () => true }).length, 1, '>= ties fire and hold');
  assert.equal(run(ge, { metrics: { vix: 29.9999 }, isActive: () => true }).length, 0);
  const gt = thresholdRule({ op: '>', value: 30, clearValue: 30 });
  assert.equal(run(gt, { metrics: { vix: 30 }, isActive: () => true }).length, 0, '> ties do not hold');
  const le = thresholdRule({ op: '<=', value: 5, clearValue: 5 });
  assert.equal(run(le, { metrics: { vix: 5 }, isActive: () => true }).length, 1);
  assert.equal(run(le, { metrics: { vix: 5.0001 }, isActive: () => true }).length, 0);
});

test('threshold: a hysteresis hit while held reports the rule threshold, and isActive is not required to exist', () => {
  const [held] = run(thresholdRule({ op: '>', value: 30, clearValue: 28 }), { metrics: { vix: 29 }, isActive: () => true });
  assert.equal(held.metric.threshold, 30);
  assert.match(held.summary, /holds while it stays > 28/);
  assert.equal(run(thresholdRule({}), { metrics: { vix: 31 }, isActive: undefined }).length, 1);
});

test('threshold: the metric registry label and unit appear in the text, an unknown key is shown safely', () => {
  const [hit] = run(thresholdRule({ metric: 'natgas', op: '<', value: 2.5 }), { metrics: { natgas: 2.25 } });
  assert.equal(hit.title, 'Natural gas 2.25 < 2.5');
  assert.match(hit.summary, /USD\/MMBtu/);
  assert.equal(hit.entity.label, 'Natural gas');
  const forged = { ...thresholdRule({}), params: { metric: 'evil\nkey', op: '>', value: 1 } };
  const [odd] = run(forged, { metrics: { 'evil\nkey': 5 } });
  assert.doesNotMatch(odd.title, /\n/);
});

// ─── change ──────────────────────────────────────────────────────────────────

test('change: +5.1 percent hits a 5 percent rule, so does -5.1, 4.9 does not, and exactly 5 does', () => {
  const hit = (cur, prev) => run(changeRule({ pct: 5 }), { metrics: { wti: cur }, previousMetrics: { wti: prev } });
  assert.equal(hit(105.1, 100).length, 1);
  assert.equal(hit(94.9, 100).length, 1);
  assert.equal(hit(104.9, 100).length, 0);
  assert.equal(hit(95.1, 100).length, 0);
  assert.equal(hit(105, 100).length, 1, 'exactly the threshold');
  assert.equal(hit(95, 100).length, 1);
  assert.equal(hit(100, 100).length, 0);
  assert.equal(hit(-10.6, -10).length, 1, 'a negative previous value uses its magnitude');
  assert.equal(hit(-10.4, -10).length, 0);
  assert.equal(hit(0.3, 0.1).length, 1, 'tiny values still work');
});

test('change: a hit carries current and previous value and says which way it moved', () => {
  const [up] = run(changeRule({ pct: 5 }), { metrics: { wti: 105.5 }, previousMetrics: { wti: 100 } });
  assert.deepEqual(up, {
    dedupKey: 'ch|wti', severity: 'watch', title: 'WTI crude up 5.5%',
    summary: 'WTI crude moved from 100 to 105.5 USD/bbl between sweeps (threshold 5%).',
    entity: { type: 'metric', id: 'wti', label: 'WTI crude' },
    evidence: [], metric: { key: 'wti', value: 105.5, previous: 100 },
  });
  const [down] = run(changeRule({ pct: 5 }), { metrics: { wti: 90 }, previousMetrics: { wti: 100 } });
  assert.equal(down.title, 'WTI crude down 10%');
});

test('change: no hit when either side is null or missing, or when the previous value is 0', () => {
  const cases = [[null, 100], [105, null], [null, null], [undefined, 100], [105, undefined], [105, 0], [0, 0], [NaN, 100], [105, NaN], ['105', 100], [Infinity, 100]];
  for (const [cur, prev] of cases) assert.deepEqual(run(changeRule({ pct: 5 }), { metrics: { wti: cur }, previousMetrics: { wti: prev } }), [], `${cur} vs ${prev}`);
  assert.deepEqual(run(changeRule({ pct: 5 }), { metrics: { wti: 105 }, previousMetrics: {} }), []);
  assert.deepEqual(run(changeRule({ pct: 5 }), { metrics: { wti: 105 }, previousMetrics: null }), []);
});

test('change: a growing move through zero is a hit, a tiny move on a 0.1 percent rule too', () => {
  assert.equal(run(changeRule({ pct: 100 }), { metrics: { wti: -1 }, previousMetrics: { wti: 1 } }).length, 1);
  assert.equal(run(changeRule({ pct: 0.1 }), { metrics: { wti: 100.2 }, previousMetrics: { wti: 100 } }).length, 1);
});

// ─── absence ─────────────────────────────────────────────────────────────────

const streaks = table => name => table[name] ?? 0;

test('absence: a failing or stale source hits once its streak reaches minFailSweeps', () => {
  const health = [{ n: 'GDACS', err: true }];
  const hits = streak => run(absenceRule({ minFailSweeps: 3 }), { health, failStreak: streaks({ GDACS: streak }) });
  assert.equal(hits(1).length, 0);
  assert.equal(hits(2).length, 0, 'below the threshold');
  assert.equal(hits(3).length, 1, 'at the threshold');
  assert.equal(hits(9).length, 1);
  const stale = run(absenceRule({ minFailSweeps: 3 }), { health: [{ n: 'GDACS', stale: true }], failStreak: streaks({ GDACS: 3 }) });
  assert.equal(stale.length, 1);
  assert.match(stale[0].title, /stale/);
  assert.match(hits(3)[0].title, /failing/);
});

test('absence: a healthy source does not hit whatever its streak says', () => {
  assert.deepEqual(run(absenceRule({ minFailSweeps: 1 }), { health: [{ n: 'GDACS', err: false, stale: false }, { n: 'USGS' }], failStreak: () => 99 }), []);
});

test('absence: a disabled source is ignored, even when it errs or is stale', () => {
  const health = [{ n: 'GDACS', err: true, disabled: true }, { n: 'USGS', stale: true, disabled: true, freshness: { ageMs: 99 * HOUR } }];
  assert.deepEqual(run(absenceRule({ minFailSweeps: 1, maxAgeMinutes: 10 }), { health, failStreak: () => 99 }), []);
});

test('absence: any yields one hit per failing source, a name yields only that source', () => {
  const health = [{ n: 'GDACS', err: true }, { n: 'USGS', stale: true }, { n: 'ECB', err: true }, { n: 'NOAA' }];
  const failStreak = () => 5;
  const hits = run(absenceRule({ source: 'any' }), { health, failStreak });
  assert.deepEqual(keysOf(hits), ['ab|GDACS', 'ab|USGS', 'ab|ECB']);
  assert.deepEqual(hits.map(hit => hit.entity), [{ type: 'source', id: 'GDACS', label: 'GDACS' }, { type: 'source', id: 'USGS', label: 'USGS' }, { type: 'source', id: 'ECB', label: 'ECB' }]);
  assert.deepEqual(keysOf(run(absenceRule({ source: 'USGS' }), { health, failStreak })), ['ab|USGS']);
  assert.deepEqual(keysOf(run(absenceRule({ source: 'usgs' }), { health, failStreak })), ['ab|USGS'], 'names match regardless of case');
  assert.deepEqual(run(absenceRule({ source: 'NOAA' }), { health, failStreak }), [], 'a healthy named source');
  assert.deepEqual(run(absenceRule({ source: 'Nonexistent' }), { health, failStreak }), [], 'an unknown named source');
});

test('absence: the streak is asked per source', () => {
  const asked = [];
  run(absenceRule({}), { health: [{ n: 'GDACS', err: true }, { n: 'USGS', err: true }], failStreak: name => { asked.push(name); return 3; } });
  assert.deepEqual(asked.sort(), ['GDACS', 'USGS']);
  const mixed = run(absenceRule({ minFailSweeps: 3 }), { health: [{ n: 'GDACS', err: true }, { n: 'USGS', err: true }], failStreak: streaks({ GDACS: 3, USGS: 2 }) });
  assert.deepEqual(keysOf(mixed), ['ab|GDACS']);
});

test('absence: maxAgeMinutes flags old provider data without needing a failing streak', () => {
  const rows = age => [{ n: 'GDACS', err: false, stale: false, freshness: { ageMs: age } }];
  const target = absenceRule({ minFailSweeps: 3, maxAgeMinutes: 120 });
  assert.equal(run(target, { health: rows(3 * HOUR) }).length, 1);
  assert.equal(run(target, { health: rows(2 * HOUR) }).length, 0, 'exactly at the limit is fine');
  assert.equal(run(target, { health: rows(2 * HOUR + 1) }).length, 1);
  assert.equal(run(target, { health: rows(HOUR) }).length, 0);
  for (const age of [null, undefined, NaN, Infinity, -5 * HOUR, '999999999']) assert.equal(run(target, { health: rows(age) }).length, 0, String(age));
  assert.equal(run(absenceRule({ minFailSweeps: 3 }), { health: rows(99 * HOUR) }).length, 0, 'no maxAgeMinutes, no age rule');
  assert.equal(run(target, { health: [{ n: 'GDACS' }] }).length, 0, 'no freshness data');
  const [hit] = run(target, { health: rows(3 * HOUR) });
  assert.match(hit.summary, /3(\.0)? h/);
  assert.match(hit.title, /GDACS/);
});

test('absence: a source that is both failing and old is one hit that explains both', () => {
  const [hit, ...rest] = run(absenceRule({ minFailSweeps: 2, maxAgeMinutes: 60 }), { health: [{ n: 'GDACS', err: true, freshness: { ageMs: 5 * HOUR } }], failStreak: () => 4 });
  assert.equal(rest.length, 0);
  assert.match(hit.summary, /4 consecutive sweeps/);
  assert.match(hit.summary, /5(\.0)? h/);
});

test('absence: rows that are not rows, and repeated rows for one source, are tolerated', () => {
  const health = [null, 'GDACS', 5, [], {}, { n: 5, err: true }, { n: '', err: true }, { n: 'GDACS', err: true }, { n: 'GDACS', stale: true }];
  assert.deepEqual(keysOf(run(absenceRule({}), { health, failStreak: () => 9 })), ['ab|GDACS']);
  assert.deepEqual(run(absenceRule({}), { health: [{ n: 'GDACS', err: true }], failStreak: () => 'many' }), []);
  assert.deepEqual(run(absenceRule({}), { health: [{ n: 'GDACS', err: true }], failStreak: undefined }), []);
});

test('absence: a hostile source name is cleaned in the text', () => {
  const [hit] = run(absenceRule({}), { health: [{ n: 'Evil\n\u202eName', err: true }], failStreak: () => 3 });
  assert.doesNotMatch(`${hit.title}${hit.summary}${hit.entity.label}`, /[\u0000-\u001f\u202a-\u202e]/);
});

// ─── convergence ─────────────────────────────────────────────────────────────

// Budapest area, inside the 2 degree cell with its south-west corner at 46, 18.
const HU = { lat: 47.5, lon: 19.0 };
const hu = (kind, overrides = {}) => ev({ kind, severity: 'moderate', location: place(HU.lat, HU.lon, 'Budapest'), ...overrides });
const THREE = ['conflict', 'earthquake', 'weather'];

test('convergence: two kinds do not hit, three do, and the hit describes the cell', () => {
  assert.deepEqual(run(convergenceRule(), { events: [hu('conflict'), hu('earthquake')] }), []);
  const events = THREE.map(kind => hu(kind));
  const hits = run(convergenceRule(), { events });
  assert.equal(hits.length, 1);
  const [hit] = hits;
  assert.equal(hit.dedupKey, `cv|${cellOf(HU.lat, HU.lon, 2)}`);
  assert.equal(hit.severity, 'high', 'the rule severity');
  assert.deepEqual(hit.entity, { type: 'cell', id: cellOf(HU.lat, HU.lon, 2), label: 'Budapest', lat: 47, lon: 19 });
  assert.equal(hit.title, '3 event kinds converge near Budapest');
  assert.match(hit.summary, /conflict, earthquake, weather/);
  assert.match(hit.summary, /2° cell/);
  assert.match(hit.summary, /24 h/);
  assert.deepEqual(hit.evidence.map(item => item.id).sort(), events.map(event => event.id).sort());
  assert.deepEqual(hit.evidence[0], { type: 'event', id: hit.evidence[0].id, title: hit.evidence[0].title, source: 'ACLED', level: 'watch' });
});

test('convergence: repeats of one kind do not count, and an excluded kind does not make up the numbers', () => {
  assert.deepEqual(run(convergenceRule(), { events: [hu('conflict'), hu('conflict'), hu('conflict'), hu('conflict')] }), []);
  assert.deepEqual(run(convergenceRule(), { events: [hu('conflict'), hu('earthquake'), hu('news')] }), [], 'news is not a default kind');
});

test('convergence: the default kinds are conflict, earthquake, weather, disaster, outage and health', () => {
  const kinds = ['conflict', 'earthquake', 'weather', 'disaster', 'outage', 'health'];
  assert.equal(run(convergenceRule({ minKinds: 6 }), { events: kinds.map(kind => hu(kind)) }).length, 1);
  for (const excluded of ['news', 'osint', 'signal', 'forecast', 'economic', 'cyber', 'network', 'space-weather', 'other']) {
    assert.deepEqual(run(convergenceRule({ minKinds: 3 }), { events: [hu('conflict'), hu('earthquake'), hu(excluded)] }), [], excluded);
  }
});

test('convergence: an explicit kinds list replaces the default one', () => {
  const events = [hu('news'), hu('osint'), hu('conflict')];
  assert.equal(run(convergenceRule({ kinds: ['news', 'osint', 'conflict'] }), { events }).length, 1);
  assert.deepEqual(run(convergenceRule({ kinds: ['news', 'osint', 'cyber'] }), { events }), []);
  assert.equal(run(convergenceRule({ kinds: ['news', 'osint'], minKinds: 2 }), { events }).length, 1);
});

test('convergence: minKinds is honoured', () => {
  const four = ['conflict', 'earthquake', 'weather', 'outage'].map(kind => hu(kind));
  assert.equal(run(convergenceRule({ minKinds: 4 }), { events: four }).length, 1);
  assert.equal(run(convergenceRule({ minKinds: 5 }), { events: four }).length, 0);
  assert.equal(run(convergenceRule({ minKinds: 2 }), { events: four.slice(0, 2) }).length, 1);
});

test('convergence: events outside the window, without coordinates or time, or below minLevel are excluded', () => {
  const good = [hu('conflict'), hu('earthquake')];
  const third = overrides => run(convergenceRule(), { events: [...good, hu('weather', overrides)] }).length;
  assert.equal(third({}), 1, 'control: the third event counts');
  assert.equal(third({ observedAt: iso(NOW - 25 * HOUR) }), 0, 'older than 24 h');
  assert.equal(third({ observedAt: iso(NOW - 24 * HOUR) }), 1, 'exactly at the window edge');
  assert.equal(third({ observedAt: iso(NOW - 24 * HOUR - 1) }), 0);
  assert.equal(third({ observedAt: null, publishedAt: iso(NOW - HOUR) }), 1, 'publishedAt stands in for a missing observedAt');
  assert.equal(third({ observedAt: iso(NOW - 30 * HOUR), publishedAt: iso(NOW - HOUR) }), 0, 'observedAt wins when both exist');
  assert.equal(third({ observedAt: null, publishedAt: null }), 0, 'no provider time');
  assert.equal(third({ observedAt: 'garbage' }), 0);
  assert.equal(third({ observedAt: iso(NOW + 6 * 60000) }), 0, 'provider time in the future');
  assert.equal(third({ observedAt: iso(NOW + 4 * 60000) }), 1, 'a few minutes of clock skew is fine');
  assert.equal(third({ observedAt: iso(NOW + 20 * HOUR) }), 0, 'a far future date is not "within the window"');
  assert.equal(third({ location: { lat: null, lon: null, label: 'Somewhere' } }), 0, 'no coordinates');
  assert.equal(third({ location: place(NaN, 19) }), 0);
  assert.equal(third({ location: place(47.5, 181) }), 0);
  assert.equal(third({ location: null }), 0);
  assert.equal(third({ severity: 'low' }), 0, 'below watch');
  assert.equal(third({ severity: 'monitor' }), 0);
  assert.equal(third({ severity: 'unknown' }), 0);
  assert.equal(third({ severity: 'high' }), 1, 'above watch is fine');
});

test('convergence: windowHours and minLevel come from the rule', () => {
  const events = [hu('conflict', { observedAt: iso(NOW - 10 * HOUR) }), hu('earthquake', { observedAt: iso(NOW - 10 * HOUR) }), hu('weather', { observedAt: iso(NOW - 10 * HOUR) })];
  assert.equal(run(convergenceRule({ windowHours: 12 }), { events }).length, 1);
  assert.equal(run(convergenceRule({ windowHours: 6 }), { events }).length, 0);
  assert.equal(run(convergenceRule({ minLevel: 'high' }), { events }).length, 0, 'moderate events are only watch');
  assert.equal(run(convergenceRule({ minLevel: 'info' }), { events: [...events.slice(0, 2), hu('weather', { severity: 'low', observedAt: iso(NOW - HOUR) })] }).length, 1);
});

test('convergence: two cells give two hits, neighbouring cells are not merged', () => {
  const north = place(49.5, 19);
  const events = [...THREE.map(kind => hu(kind)), ...THREE.map(kind => hu(kind, { location: north }))];
  const hits = run(convergenceRule(), { events });
  assert.equal(hits.length, 2);
  assert.notEqual(hits[0].dedupKey, hits[1].dedupKey);
  assert.deepEqual(hits.map(hit => hit.entity.lat).sort(), [47, 49]);
  const split = [hu('conflict'), hu('earthquake'), hu('weather', { location: place(48.1, 19) })];
  assert.deepEqual(run(convergenceRule(), { events: split }), [], 'one event is across the cell boundary');
  assert.equal(run(convergenceRule({ cellDegrees: 4 }), { events: split }).length, 1, 'a bigger cell holds all three');
  assert.equal(run(convergenceRule({ cellDegrees: 1 }), { events: THREE.map(kind => hu(kind)) }).length, 1);
  assert.equal(run(convergenceRule({ cellDegrees: 1 }), { events: split }).length, 0);
});

test('convergence: the entity is the cell centre for every cell size', () => {
  for (const [degrees, centre] of [[1, [47.5, 19.5]], [2, [47, 19]], [4, [48, 18]]]) {
    const [hit] = run(convergenceRule({ cellDegrees: degrees }), { events: THREE.map(kind => hu(kind)) });
    assert.deepEqual([hit.entity.lat, hit.entity.lon], centre, `${degrees} degree cells`);
    assert.equal(hit.entity.id, cellOf(HU.lat, HU.lon, degrees));
  }
});

test('convergence: evidence holds at most 8 events, one per kind first, most severe first', () => {
  const kinds = ['conflict', 'earthquake', 'weather', 'disaster'];
  const events = [];
  for (let index = 0; index < 12; index += 1) events.push(hu(kinds[index % 4], { severity: index === 11 ? 'critical' : 'moderate', title: `Event ${index}` }));
  const [hit] = run(convergenceRule(), { events });
  assert.equal(hit.evidence.length, 8);
  assert.equal(new Set(hit.evidence.map(item => item.id)).size, 8, 'no repeats');
  for (const kind of kinds) assert.ok(hit.evidence.some(item => events.find(event => event.id === item.id).kind === kind), `a ${kind} event is in the evidence`);
  assert.equal(hit.evidence[0].level, 'critical', 'the most severe event leads');
  assert.equal(hit.evidence[0].id, events[11].id);
  const many = Array.from({ length: 300 }, (_, index) => hu(THREE[index % 3]));
  assert.equal(run(convergenceRule(), { events: many })[0].evidence.length, 8);
});

test('convergence: with more kinds than the evidence cap, the cap still holds', () => {
  const kinds = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'k10'];
  const [hit] = run(convergenceRule({ kinds, minKinds: 6 }), { events: kinds.map(kind => hu(kind)) });
  assert.equal(hit.evidence.length, 8);
  assert.match(hit.title, /^10 event kinds/);
});

test('convergence: the place in the title comes from the most severe event that has a label, coordinates otherwise', () => {
  const events = [hu('conflict', { location: place(HU.lat, HU.lon, null) }), hu('earthquake', { severity: 'high', location: place(HU.lat, HU.lon, 'Danube bend') }), hu('weather', { location: place(HU.lat, HU.lon, 'Budapest') })];
  assert.equal(run(convergenceRule(), { events })[0].title, '3 event kinds converge near Danube bend');
  const unlabeled = THREE.map(kind => hu(kind, { location: place(HU.lat, HU.lon, null) }));
  assert.equal(run(convergenceRule(), { events: unlabeled })[0].title, '3 event kinds converge near 47.0, 19.0');
});

test('convergence: title and summary are capped and clean', () => {
  const events = THREE.map(kind => hu(kind, { location: place(HU.lat, HU.lon, `Evil\n\u202e${'x'.repeat(500)}`) }));
  const [hit] = run(convergenceRule(), { events });
  assert.ok(hit.title.length <= 160);
  assert.ok(hit.summary.length <= 600);
  assert.doesNotMatch(`${hit.title}${hit.summary}${hit.entity.label}`, /[\u0000-\u001f\u202a-\u202e]/);
});

test('convergence: with no usable now there is nothing to be within the window of', () => {
  for (const now of [undefined, NaN, null, '2026']) assert.deepEqual(run(convergenceRule(), { events: THREE.map(kind => hu(kind)), now }), []);
});

// ─── delta ───────────────────────────────────────────────────────────────────

const delta = (signals = {}) => ({ snapshot: { delta: { signals: { new: [], escalated: [], deescalated: [], unchanged: [], ...signals } } } });

test('delta: critical maps to critical and high to high, from both new and escalated', () => {
  const parts = delta({
    new: [{ key: 'nuke_anomaly', reason: 'Nuclear anomaly detected', severity: 'critical' }, { key: 'source_degradation', reason: 'Sources failing', severity: 'moderate' }],
    escalated: [{ key: 'vix', label: 'VIX', from: 18, to: 25, pctChange: 38.89, direction: 'up', severity: 'critical' }, { key: 'wti', label: 'WTI', from: 70, to: 77, pctChange: 10, direction: 'up', severity: 'high' }, { key: 'gold', label: 'Gold', severity: 'moderate' }, { key: 'btc', label: 'Bitcoin' }],
    deescalated: [{ key: 'brent', label: 'Brent', severity: 'critical' }],
    unchanged: ['silver'],
  });
  const hits = run(deltaRule({ minSeverity: 'high' }), parts);
  assert.deepEqual(hits.map(hit => [hit.dedupKey, hit.severity]), [['dl|nuke_anomaly', 'critical'], ['dl|vix', 'critical'], ['dl|wti', 'high']]);
  assert.deepEqual(hits[0].entity, { type: 'signal', id: 'nuke_anomaly', label: 'Nuclear anomaly detected' });
  assert.equal(hits[1].title, 'VIX up 38.89%');
  assert.match(hits[1].summary, /18 → 25/);
  assert.equal(hits[0].summary, 'Nuclear anomaly detected');
  assert.deepEqual(hits[0].evidence, []);
});

test('delta: minSeverity critical skips the high ones', () => {
  const parts = delta({ new: [{ key: 'a', reason: 'A', severity: 'critical' }, { key: 'b', reason: 'B', severity: 'high' }], escalated: [{ key: 'c', label: 'C', severity: 'high' }, { key: 'd', label: 'D', severity: 'critical' }] });
  assert.deepEqual(keysOf(run(deltaRule({ minSeverity: 'critical' }), parts)), ['dl|a', 'dl|d']);
  assert.deepEqual(keysOf(run(deltaRule({ minSeverity: 'high' }), parts)), ['dl|a', 'dl|b', 'dl|c', 'dl|d']);
});

test('delta: the hit severity comes from the signal, not from the rule', () => {
  const parts = delta({ new: [{ key: 'a', reason: 'A', severity: 'critical' }, { key: 'b', reason: 'B', severity: 'high' }] });
  assert.deepEqual(run(deltaRule({ minSeverity: 'high' }, { severity: 'watch' }), parts).map(hit => hit.severity), ['critical', 'high']);
});

test('delta: no delta section (first run), or an odd one, gives no hits', () => {
  assert.deepEqual(run(deltaRule({ minSeverity: 'high' }), { snapshot: {} }), []);
  assert.deepEqual(run(deltaRule({ minSeverity: 'high' }), { snapshot: { delta: null } }), []);
  assert.deepEqual(run(deltaRule({ minSeverity: 'high' }), { snapshot: { delta: {} } }), []);
  assert.deepEqual(run(deltaRule({ minSeverity: 'high' }), { snapshot: { delta: { signals: null } } }), []);
  assert.deepEqual(run(deltaRule({ minSeverity: 'high' }), { snapshot: { delta: { signals: { new: 'x', escalated: { 0: { key: 'a', severity: 'critical' } } } } } }), []);
  assert.deepEqual(run(deltaRule({ minSeverity: 'high' }), { snapshot: null }), []);
  assert.deepEqual(run(deltaRule({ minSeverity: 'high' }), { snapshot: undefined }), []);
});

test('delta: signals without a key, a severity, or a plain-object shape are skipped, and a key in both lists is one hit', () => {
  const parts = delta({
    new: [null, 'x', 5, [], {}, { reason: 'no key', severity: 'critical' }, { key: '', severity: 'critical' }, { key: 5, severity: 'critical' }, { key: 'same', reason: 'first', severity: 'critical' }],
    escalated: [{ key: 'same', label: 'second', severity: 'critical' }, { key: 'x', severity: { toString: () => 'critical' } }, { key: 'y', severity: 'CRITICAL' }],
  });
  const hits = run(deltaRule({ minSeverity: 'high' }), parts);
  assert.deepEqual(keysOf(hits), ['dl|same']);
  assert.equal(hits[0].title, 'first', 'the first occurrence wins');
});

test('delta: a telegram signal puts the post text in the summary, not the title', () => {
  const [hit] = run(deltaRule({ minSeverity: 'high' }), delta({ new: [{ key: 'tg_urgent:abc123', text: 'Explosion reported downtown', reason: 'New urgent OSINT post', severity: 'high', item: { text: 'Explosion reported downtown' } }] }));
  assert.equal(hit.title, 'New urgent OSINT post');
  assert.match(hit.summary, /Explosion reported downtown/);
  assert.equal(hit.dedupKey, 'dl|tg_urgent:abc123');
});

test('delta: title and summary are capped and stripped of control characters', () => {
  const [hit] = run(deltaRule({ minSeverity: 'high' }), delta({ new: [{ key: 'k', reason: `Bad\u202e\n${'r'.repeat(400)}`, text: `T\u0000${'t'.repeat(3000)}`, severity: 'critical' }] }));
  assert.ok(hit.title.length <= 160);
  assert.ok(hit.summary.length <= 600);
  assert.doesNotMatch(`${hit.title}${hit.summary}${hit.entity.label}`, /[\u0000-\u001f\u202a-\u202e]/);
});

// ─── cross-cutting ───────────────────────────────────────────────────────────

test('hits are fresh mutable objects that share nothing with the frozen context', () => {
  const event = ev({ location: place(47.5, 19, 'Budapest') });
  const eventHits = run(eventRule({ minLevel: 'info' }), { events: [event] });
  const convergenceHits = run(convergenceRule(), { events: THREE.map(kind => hu(kind)) });
  const thresholdHits = run(thresholdRule({}), { metrics: { vix: 40 } });
  for (const hit of [...eventHits, ...convergenceHits, ...thresholdHits]) {
    assert.equal(Object.isFrozen(hit), false);
    assert.equal(Object.isFrozen(hit.entity), false);
    assert.equal(Object.isFrozen(hit.evidence), false);
    for (const item of hit.evidence) assert.equal(Object.isFrozen(item), false);
    hit.title = 'changed';
    hit.entity.label = 'changed';
    hit.evidence.push({});
    if (hit.metric) hit.metric.value = 0;
  }
  assert.equal(event.title.startsWith('Event'), true);
});

test('evaluating twice gives equal results, and no evaluator touches the context', () => {
  const events = [...THREE.map(kind => hu(kind)), ev({ severity: 'critical', location: place(47.5, 19, 'Budapest') })];
  const context = deepFreeze({
    snapshot: delta({ new: [{ key: 'a', reason: 'A', severity: 'critical' }] }).snapshot,
    events, metrics: { vix: 40, wti: 110 }, previousMetrics: { wti: 100 },
    health: [{ n: 'GDACS', err: true, freshness: { ageMs: 5 * HOUR } }], failStreak: () => 5, isActive: () => true, now: NOW,
  });
  const before = JSON.stringify(context);
  const rules = [eventRule({ minLevel: 'info' }, { scope: { keywords: ['event'], radius: { lat: 47.5, lon: 19, km: 100 } } }), thresholdRule({ clearValue: 28 }), changeRule({ pct: 5 }), absenceRule({ maxAgeMinutes: 60 }), convergenceRule(), deltaRule({ minSeverity: 'high' })];
  for (const target of rules) {
    const first = evaluateRule(target, context);
    assert.ok(first.length > 0, `${target.kind} produced hits for this context`);
    assert.deepEqual(evaluateRule(target, context), first);
  }
  assert.equal(JSON.stringify(context), before);
});

test('every hit satisfies the Hit contract', () => {
  const events = [...THREE.map(kind => hu(kind)), ev({ severity: 'critical', title: 'T'.repeat(400), summary: 'S'.repeat(3000), location: place(47.5, 19) })];
  const all = [
    ...run(eventRule({ minLevel: 'info' }), { events }),
    ...run(thresholdRule({}), { metrics: { vix: 40 } }),
    ...run(changeRule({ pct: 1 }), { metrics: { wti: 110 }, previousMetrics: { wti: 100 } }),
    ...run(absenceRule({}), { health: [{ n: 'GDACS', err: true }], failStreak: () => 9 }),
    ...run(convergenceRule(), { events }),
    ...run(deltaRule({ minSeverity: 'high' }), delta({ new: [{ key: 'a', reason: 'A', severity: 'critical' }] })),
  ];
  assert.ok(all.length >= 6);
  for (const hit of all) {
    assert.match(hit.dedupKey, /^[a-z0-9-]+\|.+/);
    assert.ok(['critical', 'high', 'watch', 'info'].includes(hit.severity), hit.severity);
    assert.ok(hit.title.length > 0 && hit.title.length <= 160);
    assert.ok(hit.summary.length > 0 && hit.summary.length <= 600);
    assert.ok(['event', 'metric', 'source', 'cell', 'signal'].includes(hit.entity.type));
    assert.equal(typeof hit.entity.id, 'string');
    assert.ok(Array.isArray(hit.evidence) && hit.evidence.length <= 8);
    for (const item of hit.evidence) assert.deepEqual(Object.keys(item).sort(), ['id', 'level', 'source', 'title', 'type']);
  }
});
