import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import express from 'express';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SweepArchive } from '../lib/sweeps/archive.mjs';
import { buildChanges } from '../lib/sweeps/changes.mjs';
import { installSweepRoutes } from '../lib/sweeps/routes.mjs';
import { domainOfSource } from '../lib/domains.mjs';

// The dashboard-structure chain without a browser: synthetic sweeps -> buildChanges -> SweepArchive.add (a temp dir) -> the read-only
// routes over real HTTP -> the server's JSON fed to the browser modules (changes.js, health-matrix.js, replay-core.js, domains.js) in a
// vm realm. Every figure the UI shows is checked against what went in at the start.
const BASE = Date.parse('2026-10-03T08:00:00.000Z');
const MINUTE = 60000;
const iso = minutes => new Date(BASE + minutes * MINUTE).toISOString();
const eid = n => `event-${n.toString(16).padStart(32, '0')}`;
const quiet = { warn() {}, error() {}, log() {} };
const HOSTILE = '<img src=x onerror="globalThis.__chainXss=1">';
const GLYPH = { ok: '✓', stale: '◔', error: '✕', disabled: '–', nodata: '·' };
const WORD = { ok: 'OK', stale: 'Stale', error: 'Error', disabled: 'Disabled', nodata: 'No data' };
const STATES = ['ok', 'stale', 'error', 'disabled'];

const event = (n, source, severity, title, minutes) => ({ id: eid(n), kind: 'news', title, source: { name: source }, severity, observedAt: iso(minutes) });
const row = (n, state = 'ok') => ({ n, err: state === 'error', stale: state === 'stale', disabled: state === 'disabled' });
// Three sweeps 15 minutes apart. Events come and go, sources change state (one is hostile, one appears only in the last sweep), the
// last sweep carries a delta signal.
const SWEEPS = [
  { minutes: 0, events: [event(1, 'USGS', 'high', 'Quake one', -5), event(2, 'GDELT', 'moderate', 'Protest two', -3)],
    health: [row('USGS'), row('GDELT'), row('FRED'), row(HOSTILE)] },
  { minutes: 15, events: [event(1, 'USGS', 'high', 'Quake one', -5), event(2, 'GDELT', 'moderate', 'Protest two', -3), event(3, 'CISA-KEV', 'critical', 'Exploited three', 10), event(4, 'Fixture news', 'unknown', 'Headline four', 12)],
    health: [row('USGS'), row('GDELT', 'error'), row('FRED', 'stale'), row(HOSTILE, 'error')] },
  { minutes: 30, events: [event(2, 'GDELT', 'moderate', 'Protest two', -3), event(3, 'CISA-KEV', 'critical', 'Exploited three', 10), event(4, 'Fixture news', 'unknown', 'Headline four', 12), event(5, 'GDACS', 'low', 'Flood five', 25), event(6, 'ECB', 'high', HOSTILE, 28)],
    health: [row('USGS', 'error'), row('GDELT'), row('FRED', 'stale'), row(HOSTILE), row('WHO', 'disabled')],
    delta: { signals: { new: [{ key: 'vix', label: 'VIX', severity: 'high', direction: 'up' }], escalated: [], deescalated: [] } } },
];
const snapshotOf = (sweep, index) => ({ meta: { timestamp: iso(sweep.minutes), sourcesQueried: sweep.health.length, sourcesOk: sweep.health.filter(item => !item.err && !item.stale && !item.disabled).length },
  health: sweep.health, events: sweep.events, ...(sweep.delta ? { delta: sweep.delta } : {}), marker: `sweep ${index}` });
const stateOf = item => (item.disabled ? 'disabled' : item.err ? 'error' : item.stale ? 'stale' : 'ok');
// The briefing's timing: the same state as health[] and a run time per source and sweep.
const timingOf = (sweep, index) => Object.fromEntries(sweep.health.map((item, i) => [item.n, { status: stateOf(item), ms: 100 * (index + 1) + i }]));

async function chain(t) {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-structure-chain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const archive = new SweepArchive(dir, { logger: quiet });
  const snapshots = [];
  let previous = null;
  for (const [index, sweep] of SWEEPS.entries()) {
    const snapshot = snapshotOf(sweep, index);
    snapshot.changes = buildChanges(previous, snapshot);
    assert.ok(archive.add({ snapshot, timing: timingOf(sweep, index) }), 'sweep archived: ' + index);
    snapshots.push(snapshot);
    previous = snapshot;
  }
  const app = express();
  installSweepRoutes(app, { archive, getCurrent: () => snapshots.at(-1), now: () => BASE + 31 * MINUTE });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = async route => { const response = await fetch(origin + route); assert.equal(response.status, 200, route); return response.json(); };
  return { snapshots, get };
}

// The browser modules in one vm realm with the page objects they need: a document that takes listeners and finds nothing.
function client() {
  const read = name => readFileSync(new URL('../dashboard/public/' + name, import.meta.url), 'utf8');
  const window = {};
  const document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } };
  const context = vm.createContext({ window, document, console });
  for (const name of ['domains.js', 'lens-core.js', 'record-core.js', 'changes.js', 'health-matrix.js', 'replay-core.js']) vm.runInContext(read(name), context, { filename: name });
  window.CrucixChanges.mount({ panelShown: () => true, openEvent() {}, openMatrix() {}, now: () => BASE + 31 * MINUTE });
  return window;
}

const ids = (markup, attribute) => [...markup.matchAll(new RegExp(attribute + '="([^"]*)"', 'g'))].map(match => match[1]);
const chipCount = markup => Number(/<span class="ch-n">(\d+)\+?<\/span>/.exec(markup)?.[1]);
// The matrix markup as [{source, cells: [[state, glyph, word, sweepId]], ms}].
function matrixRows(markup) {
  const decode = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return markup.split('<tr class="hm-row">').slice(1).map(part => ({
    source: decode(/<th scope="row" class="hm-src">([^<]*)<\/th>/.exec(part)[1]),
    cells: [...part.matchAll(/<button type="button" class="hm-cell" data-state="(\w+)" data-hm-sweep="([^"]+)"[^>]*><span class="hm-g" aria-hidden="true">([^<]*)<\/span><span class="hm-sr">([^<]*)<\/span><\/button>/g)].map(match => [match[1], match[3], match[4], match[2]]),
    ms: /<td class="hm-ms">([^<]*)<\/td>/.exec(part)?.[1] ?? null,
  }));
}

test('chain: the archived sweeps, their changes and the replay snapshots agree over HTTP', async t => {
  const { snapshots, get } = await chain(t);
  const list = await get('/api/sweeps');
  assert.deepEqual(list.sweeps.map(entry => entry.timestamp), SWEEPS.map(sweep => iso(sweep.minutes)).reverse(), 'newest first, one entry per sweep');
  assert.deepEqual(list.sweeps.map(entry => entry.changeCounts), snapshots.map(snapshot => ({ events: snapshot.changes.events.newTotal, sources: snapshot.changes.sources.length, signals: snapshot.changes.signals.length })).reverse());
  assert.equal(snapshots[0].changes.baseline, true, 'the first sweep has nothing to compare with');
  for (const [index, entry] of [...list.sweeps].reverse().entries()) {
    const stored = await get('/api/sweeps/' + entry.id);
    assert.deepEqual(stored, JSON.parse(JSON.stringify(snapshots[index])), 'the replay snapshot is the sweep as it was archived: ' + entry.id);
    assert.equal(stored.meta.timestamp, entry.timestamp);
    // The new records of a sweep are exactly the events of its archived snapshot that the previous one did not have.
    const own = new Set(stored.events.map(item => item.id)), before = new Set(index ? snapshots[index - 1].events.map(item => item.id) : []);
    const fresh = stored.events.map(item => item.id).filter(id => index && !before.has(id));
    assert.deepEqual(stored.changes.events.new.map(item => item.id).sort(), fresh.sort(), 'new ids = archived events minus the previous sweep\'s');
    assert.ok(stored.changes.events.new.every(item => own.has(item.id)), 'every changed id is an event of the archived snapshot');
    assert.equal(stored.changes.events.expiredTotal, index ? [...before].filter(id => !own.has(id)).length : 0);
  }
  const last = await get('/api/changes?window=last');
  assert.deepEqual(last, JSON.parse(JSON.stringify(snapshots[2].changes)), 'window=last is the current sweep\'s own changes');
  assert.deepEqual(last.events.new.map(item => item.id), [eid(6), eid(5)], 'most severe first: ECB high, then GDACS info');
  assert.deepEqual(last.sources.map(item => [item.source, item.from, item.to]), [['GDELT', 'error', 'ok'], ['USGS', 'ok', 'error'], [HOSTILE, 'error', 'ok']], 'domain order, then the domain-less source; WHO is new, no transition');
  const hour = await get('/api/changes?window=1h');
  assert.deepEqual(hour.events.new.map(item => item.id), [eid(3), eid(6), eid(5), eid(4)], 'the hour merges both sweeps with changes, each id once, severity order');
  assert.equal(hour.events.newTotal, 4);
  assert.deepEqual(hour.sources.map(item => item.source), ['GDELT', 'FRED', HOSTILE, 'GDELT', 'USGS', HOSTILE], 'transitions in time order');
  for (const item of [...hour.events.new, ...hour.sources]) assert.equal(item.domain, domainOfSource(item.source), 'server domain of ' + item.source);
});

test('chain: the changes panel and the header chip show the server\'s changes, lens by lens', async t => {
  const { get } = await chain(t);
  const window = client(), last = await get('/api/changes?window=last'), hour = await get('/api/changes?window=1h');
  const C = window.CrucixChanges, open = { records: true, sources: true, signals: true };
  for (const item of [...last.events.new, ...last.sources]) assert.equal(window.CrucixDomains.domainOfSource(item.source), item.domain, 'browser registry agrees: ' + item.source);
  const all = C.panelHtml(last, { lens: 'all', window: 'last', expanded: open });
  assert.deepEqual(ids(all, 'data-changes-event'), last.events.new.map(item => item.id), 'one record row per new event, the same ids, the same order');
  assert.deepEqual(ids(all, 'data-changes-source'), last.sources.map(item => item.source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')), 'one row per transition (attribute-escaped)');
  assert.deepEqual(ids(all, 'data-signal'), ['vix']);
  assert.ok(!all.includes('<img') && all.includes('&lt;img src=x onerror=&quot;globalThis.__chainXss=1&quot;&gt;'), 'the hostile title and source name are escaped');
  for (const item of [...last.sources]) assert.match(all, new RegExp(`data-state="${item.from}"><i aria-hidden="true">${GLYPH[item.from]}</i> ${WORD[item.from]}</span>`), 'from state as glyph and word');
  assert.match(all, /<span class="badge">6<\/span>/, 'the panel badge: 2 records + 3 transitions + 1 signal');
  assert.equal(chipCount(C.chipHtml(last, 'all')), last.events.newTotal + last.sources.length + last.signals.length);
  // Under a lens only the domain's records and transitions count; a domain-less item (the hostile source) and the signals are left out.
  for (const lens of ['hazards', 'economy', 'security', 'cyber']) {
    const records = last.events.new.filter(item => domainOfSource(item.source) === lens), sources = last.sources.filter(item => domainOfSource(item.source) === lens);
    const markup = C.panelHtml(last, { lens, window: 'last', expanded: open }), chip = C.chipHtml(last, lens);
    assert.deepEqual(ids(markup, 'data-changes-event'), records.map(item => item.id), 'lens records: ' + lens);
    assert.deepEqual(ids(markup, 'data-changes-source'), sources.map(item => item.source), 'lens transitions: ' + lens);
    assert.equal(chip === '' ? 0 : chipCount(chip), records.length + sources.length, 'lens chip: ' + lens);
    assert.equal(last.domains[lens] ?? 0, records.length + sources.length, 'the server domain count agrees: ' + lens);
  }
  // A merged window lists the merged ids and says its totals are upper bounds; it never gets the exact badge.
  const merged = C.panelHtml(last, { lens: 'all', window: '1h', windowChanges: hour, expanded: open });
  assert.deepEqual(ids(merged, 'data-changes-event'), hour.events.new.map(item => item.id));
  assert.match(merged, new RegExp(`data-domain="cyber"><span class="ch-dom-name">[^<]*</span> <span class="ch-dom-n"><span aria-hidden="true">≤${hour.domains.cyber}</span><span class="ch-sr">up to ${hour.domains.cyber}</span>`), 'a merged domain count is an upper bound');
  assert.ok(!/<span class="badge">/.test(merged));
});

test('chain: the matrix draws every archived state as glyph and word, and its cells open the replay at the right sweep', async t => {
  const { snapshots, get } = await chain(t);
  const window = client(), list = await get('/api/sweeps'), series = await get('/api/source-health');
  const oldestFirst = [...list.sweeps].reverse().map(entry => entry.id);
  assert.deepEqual(series.sweeps.map(entry => entry.id), oldestFirst, 'matrix columns are the archived sweeps, oldest first');
  const markup = window.CrucixHealthMatrix.render(series), rows = matrixRows(markup);
  assert.ok(!markup.includes('<img'), 'the hostile source name is escaped');
  const names = [...new Set(SWEEPS.flatMap(sweep => sweep.health.map(item => item.n)))];
  assert.deepEqual(rows.map(item => item.source).sort(), [...names].sort(), 'one row per source that any sweep reported');
  assert.deepEqual(rows.map(item => item.source), ['GDELT', 'USGS', 'FRED', 'WHO', HOSTILE], 'grouped in domain order, the domain-less source last');
  for (const item of rows) {
    // Each cell: the state of the source's health[] row in that sweep (no row = no data), its glyph and word, that sweep's id.
    const expected = SWEEPS.map((sweep, index) => { const health = sweep.health.find(entry => entry.n === item.source), state = health ? stateOf(health) : 'nodata'; return [state, GLYPH[state], WORD[state], oldestFirst[index]]; });
    assert.deepEqual(item.cells, expected, 'cells of ' + item.source);
    const index = SWEEPS[2].health.findIndex(entry => entry.n === item.source);
    assert.equal(item.ms, String(300 + index), 'last run time of the newest sweep: ' + item.source);
  }
  assert.deepEqual([...new Set(rows.flatMap(item => item.cells.map(cell => cell[0])))].sort(), [...STATES, 'nodata'].sort(), 'every state appears');
  // Choosing a cell: the replay reducer over the same list loads that sweep, whose stored snapshot carries the cell's sweep time.
  const R = window.CrucixReplayCore, chosen = rows[0].cells[1][3];
  let state = R.reduce(R.createState(), { type: 'sweeps', sweeps: list.sweeps.map(entry => entry.id) });
  assert.deepEqual(JSON.parse(JSON.stringify(state.sweeps)), oldestFirst, 'the reducer orders the API list oldest first, as the matrix does');
  state = R.reduce(state, { type: 'open', id: chosen });
  assert.deepEqual([state.mode, state.target, state.targetIndex], ['loading', chosen, 1]);
  const stored = await get('/api/sweeps/' + chosen);
  assert.equal(stored.meta.timestamp, series.sweeps[1].timestamp, 'the loaded snapshot is the sweep of the column');
  state = R.reduce(state, { type: 'loaded', id: chosen });
  assert.deepEqual([state.mode, state.id, state.index, R.canApplyLive(state)], ['replay', chosen, 1, false]);
  // A live snapshot during the replay is kept aside; a step goes to the next archived sweep; the exit drops nothing of the list.
  state = R.reduce(state, { type: 'liveArrived', snapshot: { meta: { timestamp: iso(45) } } });
  assert.equal(state.missed, 1);
  state = R.reduce(state, { type: 'step', delta: 1 });
  assert.deepEqual([state.mode, state.target], ['loading', oldestFirst[2]]);
  assert.equal((await get('/api/sweeps/' + state.target)).marker, snapshots[2].marker);
  state = R.reduce(state, { type: 'exit' });
  assert.deepEqual([state.mode, state.pending, JSON.parse(JSON.stringify(state.sweeps))], ['live', null, oldestFirst]);
});
