import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../dashboard/public/' + name, import.meta.url), 'utf8');
const html = read('jarvis.html');
const HOUR = 3600000;
const REAL = Date.parse('2026-10-03T12:00:00Z'); // the "real" now of every realm
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

// ===== replay-core.js: the pure state machine =====
function core() {
  const window = {};
  vm.runInNewContext(read('replay-core.js'), { window, Object, Array, Number, Date, JSON });
  return window.CrucixReplayCore;
}
const IDS = ['sweep-20261003T090000Z', 'sweep-20261003T091500Z', 'sweep-20261003T093000Z', 'sweep-20261003T094500Z'];
const live = (minutes = 0) => ({ meta: { timestamp: new Date(REAL + minutes * 60000).toISOString() } });

test('core: a fresh state is live, takes live data and knows no sweeps', () => {
  const C = core(), state = C.createState();
  assert.deepEqual(Object.keys(C).sort(), ['canApplyLive', 'createState', 'reduce']);
  assert.equal(state.mode, 'live'); assert.equal(state.id, null); assert.equal(state.index, -1); assert.deepEqual(plain(state.sweeps), []);
  assert.equal(state.pending, null); assert.equal(state.missed, 0); assert.equal(C.canApplyLive(state), true);
  assert.equal(C.reduce(state, { type: 'nonsense' }), state, 'an unknown action changes nothing');
});

test('core: open -> loading -> loaded -> replay, the newest sweep by default', () => {
  const C = core();
  let s = C.reduce(C.createState(), { type: 'sweeps', sweeps: IDS });
  s = C.reduce(s, { type: 'open' });
  assert.equal(s.mode, 'loading'); assert.equal(s.target, IDS[3]); assert.equal(s.targetIndex, 3); assert.equal(s.id, null);
  assert.equal(C.canApplyLive(s), false, 'live data waits while the first sweep loads');
  s = C.reduce(s, { type: 'loaded', id: IDS[3] });
  assert.equal(s.mode, 'replay'); assert.equal(s.id, IDS[3]); assert.equal(s.index, 3); assert.equal(s.target, null);
  assert.equal(C.canApplyLive(s), false);
  const named = C.reduce(C.reduce(C.createState(), { type: 'sweeps', sweeps: IDS }), { type: 'open', id: IDS[1] });
  assert.equal(named.target, IDS[1]); assert.equal(named.targetIndex, 1);
  assert.equal(C.reduce(s, { type: 'open', id: IDS[3] }).mode, 'replay', 'opening the sweep already shown loads nothing');
});

test('core: open without sweeps or with an unknown id is an error that never entered the replay', () => {
  const C = core();
  const none = C.reduce(C.createState(), { type: 'open' });
  assert.equal(none.mode, 'error'); assert.equal(none.error, 'noSweeps'); assert.equal(C.canApplyLive(none), true);
  const unknown = C.reduce(C.reduce(C.createState(), { type: 'sweeps', sweeps: IDS }), { type: 'open', id: 'sweep-20200101T000000Z' });
  assert.equal(unknown.mode, 'error'); assert.equal(unknown.error, 'notFound'); assert.equal(C.canApplyLive(unknown), true);
});

function inReplay(C, index = 2) {
  let s = C.reduce(C.createState(), { type: 'sweeps', sweeps: IDS });
  s = C.reduce(s, { type: 'open', id: IDS[index] });
  return C.reduce(s, { type: 'loaded', id: IDS[index] });
}

test('core: a failed load keeps the sweep shown and sets the error; from live it falls back to live', () => {
  const C = core();
  let s = C.reduce(inReplay(C, 2), { type: 'step', delta: -1 });
  assert.equal(s.mode, 'loading'); assert.equal(s.target, IDS[1]); assert.equal(s.id, IDS[2], 'the previous sweep stays while loading');
  s = C.reduce(s, { type: 'failed', id: IDS[1], error: 'notFound' });
  assert.equal(s.mode, 'error'); assert.equal(s.error, 'notFound'); assert.equal(s.id, IDS[2]); assert.equal(s.index, 2); assert.equal(s.target, null);
  assert.equal(C.canApplyLive(s), false, 'still replaying the previous sweep');
  const again = C.reduce(s, { type: 'step', delta: 1 });
  assert.equal(again.mode, 'loading'); assert.equal(again.target, IDS[3]); assert.equal(again.error, '', 'a new step clears the error');
  let first = C.reduce(C.reduce(C.createState(), { type: 'sweeps', sweeps: IDS }), { type: 'open' });
  first = C.reduce(first, { type: 'liveArrived', snapshot: live(5) });
  first = C.reduce(first, { type: 'failed', id: IDS[3], error: 'error' });
  assert.equal(first.mode, 'error'); assert.equal(first.id, null); assert.equal(C.canApplyLive(first), true);
  assert.equal(first.pending, null, 'the caller applies what was kept aside'); assert.equal(first.missed, 0);
});

test('core: step clamps at both ends; stepping back to the sweep shown cancels the load', () => {
  const C = core();
  const start = inReplay(C, 0);
  assert.equal(C.reduce(start, { type: 'step', delta: -1 }), start, 'nothing before the oldest sweep');
  const end = inReplay(C, 3);
  assert.equal(C.reduce(end, { type: 'step', delta: 1 }), end, 'nothing after the newest sweep');
  const far = C.reduce(end, { type: 'step', delta: -10 });
  assert.equal(far.target, IDS[0]); assert.equal(far.targetIndex, 0);
  const moving = C.reduce(C.reduce(inReplay(C, 2), { type: 'step', delta: 1 }), { type: 'step', delta: -1 });
  assert.equal(moving.mode, 'replay'); assert.equal(moving.id, IDS[2]); assert.equal(moving.target, null);
  const twice = C.reduce(C.reduce(inReplay(C, 1), { type: 'step', delta: 1 }), { type: 'step', delta: 1 });
  assert.equal(twice.target, IDS[3], 'a step while loading moves on from the target');
  assert.equal(C.reduce(C.createState(), { type: 'step', delta: 1 }).mode, 'live', 'no step from live');
});

test('core: goto jumps to a listed sweep; late or foreign results are ignored', () => {
  const C = core();
  const s = C.reduce(inReplay(C, 3), { type: 'goto', id: IDS[0] });
  assert.equal(s.mode, 'loading'); assert.equal(s.target, IDS[0]);
  assert.equal(C.reduce(inReplay(C, 3), { type: 'goto', id: 'sweep-20200101T000000Z' }).mode, 'replay', 'an unlisted id is ignored');
  assert.equal(C.reduce(s, { type: 'loaded', id: IDS[1] }), s, 'a response for another sweep is dropped');
  assert.equal(C.reduce(s, { type: 'failed', id: IDS[1], error: 'error' }), s, 'a failure for another sweep is dropped');
  const shown = inReplay(C, 2);
  assert.equal(C.reduce(shown, { type: 'loaded', id: IDS[2] }), shown, 'nothing is loading');
});

test('core: liveArrived keeps only the newest live snapshot and counts it; exit returns to live', () => {
  const C = core();
  const idle = C.createState();
  assert.equal(C.reduce(idle, { type: 'liveArrived', snapshot: live(1) }), idle, 'live mode applies it, nothing is kept');
  let s = C.reduce(inReplay(C), { type: 'liveArrived', snapshot: live(1) });
  assert.equal(s.missed, 1); assert.equal(s.pending.meta.timestamp, live(1).meta.timestamp);
  s = C.reduce(s, { type: 'liveArrived', snapshot: live(16) });
  assert.equal(s.missed, 2); assert.equal(s.pending.meta.timestamp, live(16).meta.timestamp);
  assert.equal(C.reduce(s, { type: 'liveArrived', snapshot: live(16) }), s, 'the same snapshot again (poll) is not counted');
  assert.equal(C.reduce(s, { type: 'liveArrived', snapshot: live(2) }), s, 'an older snapshot never replaces a newer one');
  for (const bad of [null, {}, { meta: {} }, { meta: { timestamp: 'nope' } }, { meta: { timestamp: '<img onerror=1>' } }, 'x']) assert.equal(C.reduce(s, { type: 'liveArrived', snapshot: bad }), s);
  const out = C.reduce(s, { type: 'exit' });
  assert.equal(out.mode, 'live'); assert.equal(out.id, null); assert.equal(out.pending, null); assert.equal(out.missed, 0);
  assert.deepEqual(plain(out.sweeps), IDS, 'the list is kept'); assert.equal(C.canApplyLive(out), true);
});

test('core: a refreshed list keeps the sweep shown by its id', () => {
  const C = core();
  const s = C.reduce(inReplay(C, 1), { type: 'sweeps', sweeps: IDS.slice(1).concat('sweep-20261003T100000Z') });
  assert.equal(s.id, IDS[1]); assert.equal(s.index, 0); assert.equal(s.sweeps.length, 4);
  const dropped = C.reduce(inReplay(C, 0), { type: 'sweeps', sweeps: IDS.slice(2) });
  assert.deepEqual(plain(dropped.sweeps), [IDS[0], IDS[2], IDS[3]], 'the sweep shown stays listed after retention dropped it'); assert.equal(dropped.index, 0);
  assert.deepEqual(plain(C.reduce(C.createState(), { type: 'sweeps', sweeps: ['x', 7, IDS[0]] }).sweeps), [IDS[0]], 'only sweep ids');
});

// ===== replay.js in a vm with a DOM-less fake root =====
class FakeElement {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.attrs = new Map(); this.children = []; this.parentNode = null; this.listeners = {}; this.text = ''; this.hidden = false; this.disabled = false; this.value = ''; this.type = ''; this.className = ''; this.id = ''; this.min = ''; this.max = ''; this.step = ''; doc.all.push(this); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  append(...nodes) { for (let node of nodes) { if (typeof node === 'string') { const text = new FakeElement('#text', this.ownerDocument); text.text = node; node = text; } node.parentNode = this; this.children.push(node); } }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  set innerHTML(value) { this.ownerDocument.innerHTMLWrites.push(String(value)); }
  get innerHTML() { return ''; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  focus() { this.ownerDocument.activeElement = this; }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  closest(selector) { for (let n = this; n; n = n.parentNode) if (selector.startsWith('#') && n.id === selector.slice(1)) return n; return null; }
  click() { return dispatch(this, 'click'); }
  get isConnected() { return true; }
}
function dispatch(target, type, init = {}) {
  const event = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init };
  const doc = target.ownerDocument;
  for (let n = target; n; n = n.parentNode) for (const fn of n.listeners[type] || []) { event.currentTarget = n; fn(event); }
  for (const fn of doc.listeners[type] || []) { event.currentTarget = doc; fn(event); }
  return event;
}
function fakeDocument() {
  const doc = { all: [], innerHTMLWrites: [], listeners: {}, activeElement: null };
  doc.createElement = tag => new FakeElement(tag, doc);
  doc.getElementById = id => doc.all.find(node => node.id === id && (node === doc.body || doc.body.contains(node))) || null;
  doc.addEventListener = (type, fn) => { (doc.listeners[type] ||= []).push(fn); };
  doc.body = new FakeElement('body', doc);
  return doc;
}
const allText = node => node.textContent;
const find = (root, test) => { if (test(root)) return root; for (const child of root.children) { const hit = find(child, test); if (hit) return hit; } return null; };
const byRole = (root, role) => find(root, n => n.getAttribute?.('role') === role);
const byAction = (root, action) => find(root, n => n.getAttribute?.('data-replay') === action);
const slider = root => find(root, n => n.tagName === 'INPUT');

const sweepTime = id => { const m = id.match(/^sweep-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/); return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`; };
const listOf = ids => ({ sweeps: ids.slice().reverse().map(id => ({ id, timestamp: sweepTime(id), ok: 30, total: 31, changeCounts: {} })), retention: { count: 96, maxMb: 64 } });
const snapshotOf = (id, extra = {}) => ({ meta: { timestamp: sweepTime(id), sourcesOk: 30, sourcesQueried: 31 }, events: [], alerts: { generatedAt: 1, archived: true }, ...extra });
const httpError = status => Object.assign(new Error('HTTP ' + status), { status });
const english = (key, fallback) => fallback;

// A realm with clock.js, replay-core.js and replay.js. `routes(url)` answers fetchJson; a route may return a promise.
function replayRealm({ routes = {}, t = english, real = REAL } = {}) {
  const state = { real };
  class FakeDate extends Date { static now() { return state.real; } }
  const document = fakeDocument();
  const root = document.createElement('div'); root.id = 'replayBar'; root.hidden = true; document.body.append(root);
  const trigger = document.createElement('button'); trigger.id = 'replayTrigger'; document.body.append(trigger);
  const window = {}, errors = [];
  const context = vm.createContext({ window, document, Date: FakeDate, Object, Array, Number, JSON, String, Promise, Error, TypeError, Math, Set, Map, encodeURIComponent, console: { error: (...args) => errors.push(args.map(String).join(' ')) } });
  for (const file of ['clock.js', 'replay-core.js', 'replay.js']) vm.runInContext(read(file), context);
  const clock = window.CrucixClock, log = [], requests = [];
  const fetchJson = url => {
    requests.push(url);
    const route = routes[url];
    if (route === undefined) return Promise.reject(httpError(404));
    return Promise.resolve(typeof route === 'function' ? route(url) : route);
  };
  const options = {
    root, t, locale: 'en-US', fetchJson,
    applySnapshot: snapshot => { log.push(['apply', snapshot.meta.timestamp, clock.frozen() ? clock.now() : null]); },
    restoreLive: snapshot => { log.push(['restore', snapshot.meta.timestamp, clock.frozen()]); },
    redrive: () => { log.push(['redrive', clock.frozen() ? clock.now() : null]); },
  };
  window.CrucixReplay.mount(options);
  return { api: window.CrucixReplay, window, document, root, trigger, clock, log, requests, state, options, context, errors };
}
const statusText = realm => allText(byRole(realm.root, 'status'));
async function entered(ids = IDS, extra = {}) {
  const routes = { '/api/sweeps': listOf(ids), ...Object.fromEntries(ids.map(id => ['/api/sweeps/' + id, snapshotOf(id)])), ...extra.routes };
  const realm = replayRealm({ ...extra, routes });
  await tick();
  return realm;
}

test('mount: the bar is a hidden landmark and the header button waits for two archived sweeps', async () => {
  const one = replayRealm({ routes: { '/api/sweeps': listOf(IDS.slice(0, 1)) } });
  assert.equal(one.root.hidden, true); assert.equal(one.root.getAttribute('role'), 'region'); assert.equal(one.root.getAttribute('aria-label'), 'Sweep replay');
  await tick();
  assert.deepEqual(one.requests, ['/api/sweeps'], 'the list is read without a fixed limit');
  const disabled = one.api.button();
  assert.match(disabled, /id="replayTrigger"/); assert.match(disabled, /aria-disabled="true"/); assert.match(disabled, /title="Replay needs at least two archived sweeps\."/);
  assert.doesNotMatch(disabled, /onclick/i, 'no inline handler');
  one.trigger.click(); await tick();
  assert.equal(one.api.active(), false, 'a disabled button does nothing'); assert.deepEqual(one.requests, ['/api/sweeps']);
  const two = await entered(IDS.slice(0, 2));
  const enabled = two.api.button();
  assert.doesNotMatch(enabled, /aria-disabled/); assert.match(enabled, /aria-pressed="false"/); assert.match(enabled, />Replay</);
  const broken = replayRealm({ routes: {} }); await tick();
  assert.match(broken.api.button(), /aria-disabled="true"/, 'an unreadable archive leaves the button disabled');
});

test('entering freezes the clock at the snapshot time, renders the bar and re-drives the labels after the freeze', async () => {
  const realm = await entered();
  assert.equal(await realm.api.open(), true);
  const ms = Date.parse(sweepTime(IDS[3]));
  assert.equal(realm.clock.frozen(), true); assert.equal(realm.clock.now(), ms);
  assert.deepEqual(plain(realm.log), [['apply', sweepTime(IDS[3]), ms], ['redrive', ms]], 'applied with the clock frozen, then re-driven');
  assert.equal(realm.api.active(), true); assert.equal(realm.root.hidden, false);
  assert.deepEqual(realm.requests.slice(-2), ['/api/sweeps', '/api/sweeps/' + IDS[3]], 'the list is re-read on open');
  const range = slider(realm.root);
  assert.equal(range.type, 'range'); assert.equal(String(range.min), '0'); assert.equal(String(range.max), '3'); assert.equal(String(range.value), '3');
  const label = find(realm.root, n => n.className === 'rp-time');
  assert.ok(label.textContent.length > 0); assert.equal(range.getAttribute('aria-valuetext'), label.textContent, 'the slider speaks the time');
  assert.equal(byAction(realm.root, 'next').getAttribute('aria-disabled'), 'true', 'nothing after the newest sweep');
  assert.equal(byAction(realm.root, 'prev').getAttribute('aria-disabled'), null);
  assert.match(allText(realm.root), /Alerts stay live/); assert.match(allText(realm.root), /Event history and export/);
  assert.equal(statusText(realm), '');
  assert.equal(realm.document.activeElement, range, 'the slider takes the focus when the bar opens');
  assert.match(realm.api.button(), /aria-pressed="true"/);
});

test('offerLive: false during the replay (kept aside, counted), true after exit; the kept snapshot is restored on exit', async () => {
  const realm = await entered();
  assert.equal(realm.api.offerLive(live(1)), true, 'live mode: the caller applies it');
  await realm.api.open(); realm.log.length = 0;
  assert.equal(realm.api.offerLive(live(1)), false); assert.equal(realm.api.offerLive(live(16)), false);
  assert.match(statusText(realm), /Newer live data waiting: 2/);
  assert.deepEqual(plain(realm.log), [], 'nothing is applied during the replay');
  realm.api.exit();
  assert.equal(realm.clock.frozen(), false, 'the real clock is back');
  assert.deepEqual(plain(realm.log), [['restore', live(16).meta.timestamp, false], ['redrive', null]], 'the newest kept snapshot, after the release');
  assert.equal(realm.api.active(), false); assert.equal(realm.root.hidden, true);
  assert.equal(realm.api.offerLive(live(20)), true);
  assert.ok(!realm.requests.includes('/api/data'), 'no fetch when a live snapshot was kept');
});

test('exit without a kept snapshot fetches /api/data once; a live update applied meanwhile wins', async () => {
  let answer;
  const realm = await entered(IDS, { routes: { '/api/data': () => new Promise(resolve => { answer = resolve; }) } });
  await realm.api.open(); realm.log.length = 0;
  realm.api.exit();
  assert.deepEqual(plain(realm.log), [['redrive', null]], 'labels follow the real clock at once');
  assert.equal(realm.requests.filter(url => url === '/api/data').length, 1);
  answer(live(3)); await tick();
  assert.deepEqual(plain(realm.log.slice(1)), [['restore', live(3).meta.timestamp, false], ['redrive', null]]);
  const raced = await entered(IDS, { routes: { '/api/data': () => new Promise(resolve => { answer = resolve; }) } });
  await raced.api.open(); raced.log.length = 0;
  raced.api.exit();
  assert.equal(raced.api.offerLive(live(9)), true, 'an SSE update right after exit is applied by the page');
  answer(live(3)); await tick();
  assert.ok(!raced.log.some(([kind]) => kind === 'restore'), 'the older /api/data answer is dropped');
  const failing = await entered(IDS, { routes: { '/api/data': () => Promise.reject(new Error('offline')) } });
  await failing.api.open(); failing.api.exit(); await tick();
  assert.equal(failing.api.active(), false, 'a failed fetch still leaves the replay');
});

test('a failed sweep load (404, network error, invalid JSON, not a snapshot) keeps the previous state and shows the error', async () => {
  const failures = {
    [IDS[2]]: () => Promise.reject(httpError(404)),
    [IDS[1]]: () => Promise.reject(new TypeError('Failed to fetch')),
    [IDS[0]]: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
  };
  const routes = Object.fromEntries(Object.entries(failures).map(([id, fn]) => ['/api/sweeps/' + id, fn]));
  const realm = await entered(IDS, { routes });
  await realm.api.open();
  const shown = Date.parse(sweepTime(IDS[3]));
  for (const [id, message] of [[IDS[2], /no longer in the archive/], [IDS[1], /Could not load this sweep/], [IDS[0], /Could not load this sweep/]]) {
    realm.log.length = 0;
    const range = slider(realm.root); range.value = String(IDS.indexOf(id)); dispatch(range, 'change');
    await tick();
    assert.match(statusText(realm), message, id);
    assert.deepEqual(plain(realm.log), [], 'nothing is applied');
    assert.equal(realm.clock.now(), shown, 'the clock stays at the sweep shown'); assert.equal(realm.api.active(), true);
    assert.equal(String(range.value), '3', 'the slider returns to the sweep shown');
  }
  const bad = await entered(IDS, { routes: { ['/api/sweeps/' + IDS[3]]: { meta: { timestamp: '<b>no</b>' } } } });
  assert.equal(await bad.api.open(), false);
  assert.equal(bad.clock.frozen(), false, 'never frozen'); assert.equal(bad.api.active(), false, 'live data flows again');
  assert.equal(bad.root.hidden, false, 'the error is shown in the bar'); assert.match(statusText(bad), /Could not load this sweep/);
  assert.equal(bad.api.offerLive(live(1)), true);
  byAction(bad.root, 'exit').click();
  assert.equal(bad.root.hidden, true, 'dismissed');
});

test('a failure while entering applies the live snapshot that arrived meanwhile', async () => {
  let reject;
  const realm = await entered(IDS, { routes: { ['/api/sweeps/' + IDS[3]]: () => new Promise((_, no) => { reject = no; }) } });
  const opening = realm.api.open(); await tick();
  assert.equal(realm.api.active(), true, 'loading the first sweep already holds live data back');
  assert.equal(realm.api.offerLive(live(4)), false);
  reject(httpError(503)); await opening;
  assert.deepEqual(plain(realm.log), [['restore', live(4).meta.timestamp, false]]);
  assert.equal(realm.api.active(), false);
});

test('a late /api/sweeps/:id response for a sweep the user already left is dropped (sequence guard)', async () => {
  const answers = {};
  const routes = Object.fromEntries(IDS.slice(0, 3).map(id => ['/api/sweeps/' + id, () => new Promise(resolve => { answers[id] = () => resolve(snapshotOf(id)); })]));
  const realm = await entered(IDS, { routes });
  await realm.api.open(); realm.log.length = 0;
  byAction(realm.root, 'prev').click(); // -> IDS[2]
  byAction(realm.root, 'prev').click(); // -> IDS[1]
  assert.match(statusText(realm), /Loading sweep/);
  answers[IDS[1]](); await tick();
  assert.deepEqual(plain(realm.log.map(([kind, at]) => [kind, at])), [['apply', sweepTime(IDS[1])], ['redrive', Date.parse(sweepTime(IDS[1]))]]);
  answers[IDS[2]](); await tick();
  assert.equal(realm.log.length, 2, 'the late answer for the sweep left behind is dropped');
  assert.equal(realm.clock.now(), Date.parse(sweepTime(IDS[1])));
  assert.equal(String(slider(realm.root).value), '1');
  const reopened = await entered(IDS, { routes: { ['/api/sweeps/' + IDS[3]]: () => new Promise(resolve => { answers.late = () => resolve(snapshotOf(IDS[3])); }) } });
  reopened.api.open(); await tick();
  reopened.api.exit();
  answers.late(); await tick();
  assert.equal(reopened.api.active(), false); assert.equal(reopened.clock.frozen(), false, 'an answer after exit never re-enters the replay');
  assert.deepEqual(plain(reopened.log), []);
});

test('keyboard and buttons: slider change, prev/next at the ends, Esc on the bar leaves and focuses the header button', async () => {
  const realm = await entered();
  await realm.api.open(IDS[1]);
  const range = slider(realm.root);
  range.value = '0'; dispatch(range, 'input');
  assert.match(range.getAttribute('aria-valuetext'), /\S/); await tick();
  assert.deepEqual(realm.requests.slice(-1), ['/api/sweeps/' + IDS[1]], 'input only previews the time; change loads');
  dispatch(range, 'change'); await tick();
  assert.equal(realm.clock.now(), Date.parse(sweepTime(IDS[0])));
  assert.equal(byAction(realm.root, 'prev').getAttribute('aria-disabled'), 'true');
  const before = realm.requests.length;
  byAction(realm.root, 'prev').click(); await tick();
  assert.equal(realm.requests.length, before, 'no step before the oldest sweep');
  byAction(realm.root, 'next').click(); await tick();
  assert.equal(realm.clock.now(), Date.parse(sweepTime(IDS[1])));
  const ignored = dispatch(range, 'keydown', { key: 'Escape', ctrlKey: true });
  assert.equal(realm.api.active(), true, 'Esc with a modifier is not ours'); assert.equal(ignored.defaultPrevented, false);
  const esc = dispatch(range, 'keydown', { key: 'Escape' });
  assert.equal(esc.defaultPrevented, true); assert.equal(realm.api.active(), false);
  assert.equal(realm.document.activeElement, realm.trigger, 'focus returns to the header button');
  realm.trigger.click(); await tick();
  assert.equal(realm.api.active(), true, 'the header button opens the replay');
  realm.trigger.click();
  assert.equal(realm.api.active(), false, 'and pressed again it goes back to live');
});

test('hostile text never reaches innerHTML: list timestamps, translations and ids', async () => {
  const hostile = '<img src=x onerror="window.__pwned=1">';
  const list = listOf(IDS); list.sweeps[0].timestamp = hostile; list.sweeps.push({ id: hostile, timestamp: hostile }, { id: '../../etc/passwd', timestamp: '2026-10-03T08:00:00Z' });
  const realm = replayRealm({ t: () => hostile, routes: { '/api/sweeps': list, ...Object.fromEntries(IDS.map(id => ['/api/sweeps/' + id, snapshotOf(id)])) } });
  await tick();
  const markup = realm.api.button();
  assert.ok(!markup.includes('<img'), markup); assert.match(markup, /&lt;img src=x onerror=&quot;/);
  await realm.api.open();
  assert.equal(String(slider(realm.root).max), '3', 'entries with an id outside the sweep pattern are dropped');
  assert.ok(!realm.requests.some(url => url.includes('passwd') || url.includes('<')), 'no request for a foreign id');
  assert.deepEqual(realm.document.innerHTMLWrites, [], 'the bar is built from text nodes only');
  const label = find(realm.root, n => n.className === 'rp-time').textContent;
  assert.ok(!label.includes('<img'));
  const fromId = new Date(Date.parse(sweepTime(IDS[3]))).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  assert.equal(label, fromId, 'a broken list timestamp (Date.parse would read "…=1" as 2001) falls back to the id time');
  assert.equal(realm.window.__pwned, undefined);
});

test('the module tolerates a page without CrucixClock or a broken option', async () => {
  const realm = await entered();
  realm.window.CrucixClock = undefined;
  realm.options.applySnapshot = () => { throw new Error('render failed'); };
  assert.equal(await realm.api.open(), false);
  assert.equal(realm.api.active(), false); assert.match(statusText(realm), /Could not load this sweep/);
  assert.deepEqual(realm.errors, ['[replay] Error: render failed'], 'the failure is logged once');
});

// ===== jarvis.html wiring: applySnapshot, SSE, poll and the offline cache =====
function pageFunctions(context, ...names) {
  const code = names.map(name => {
    const at = html.indexOf(`\nfunction ${name}(`) >= 0 ? html.indexOf(`\nfunction ${name}(`) : html.indexOf(`\nasync function ${name}(`);
    assert.ok(at >= 0, `function ${name}( is a top-level declaration at column 0`);
    const start = at + 1, end = html.slice(start + 1).search(/\n(async )?function /) + start + 1;
    return html.slice(start, end);
  }).join('\n');
  vm.runInContext(code, context);
}

function pageRealm({ pwa = true } = {}) {
  const realm = replayRealm({ routes: { '/api/sweeps': listOf(IDS), ...Object.fromEntries(IDS.map(id => ['/api/sweeps/' + id, snapshotOf(id, { events: [{ id: 'archived-event' }] })])) } });
  const { context, window } = realm, page = { reinit: 0, cache: [], marks: 0, alerts: [], inspector: 0, sources: null };
  const liveAlerts = { generatedAt: REAL, counts: {}, threat: { level: 2 }, live: true };
  const handlers = {};
  class FakeEventSource { constructor(url) { this.url = url; handlers.source = this; } close() {} }
  Object.assign(context, {
    D: { meta: { timestamp: new Date(REAL).toISOString() }, events: [{ id: 'live-event' }], alerts: liveAlerts, liveSources: [] },
    lastSweepError: 'Sweep failed', connectionState: 'live', sseConnected: true, liveEvents: null, apiRequestRunning: false, liveExpirySignature: 'old',
    location: { protocol: 'http:' }, EventSource: FakeEventSource, AbortController, setTimeout, clearTimeout,
    t: english, CrucixLiveSources: { policies: {} },
    reinit() { page.reinit++; }, updateRuntimeStatus() {}, refreshLiveFreshness() { page.sources = context.liveExpirySignature; },
  });
  context.document.querySelector = () => null;
  if (pwa) window.CrucixPWA = { cacheLive: snapshot => page.cache.push(snapshot.meta.timestamp), markLive: () => { page.marks++; } };
  window.CrucixAlerts = { update: summary => { page.alerts.push(summary); return true; } };
  window.CrucixRecordInspector = { refresh: () => { page.inspector++; } };
  pageFunctions(context, 'validSnapshot', 'normalizeSnapshot', 'applySnapshot', 'applyReplaySnapshot', 'restoreLiveSnapshot', 'newerAlerts', 'redriveClock', 'pollSnapshot', 'connectSSE');
  // The page's own hooks, as DOMContentLoaded hands them over.
  Object.assign(realm.options, { applySnapshot: context.applyReplaySnapshot, restoreLive: context.restoreLiveSnapshot, redrive: context.redriveClock });
  return { ...realm, page, handlers, liveAlerts };
}

test('applySnapshot: older snapshots only with force; a replayed snapshot never reaches the offline cache', async () => {
  const realm = pageRealm(), { context, page } = realm;
  await tick();
  const older = { meta: { timestamp: new Date(REAL - HOUR).toISOString() } };
  assert.equal(context.applySnapshot(older), false, 'live updates still refuse an older snapshot');
  assert.equal(context.applySnapshot(older, { force: true }), true);
  assert.equal(context.D.meta.timestamp, older.meta.timestamp);
  assert.deepEqual(page.cache, [older.meta.timestamp], 'live mode caches as before'); assert.equal(page.marks, 1);
  context.lastSweepError = 'Sweep failed';
  await realm.api.open(IDS[0]);
  assert.equal(realm.api.active(), true); assert.equal(context.D.meta.timestamp, sweepTime(IDS[0]));
  assert.equal(context.applySnapshot({ meta: { timestamp: new Date(REAL - 5 * HOUR).toISOString() } }, { force: true }), true);
  assert.deepEqual(page.cache, [older.meta.timestamp], 'no cacheLive while replaying'); assert.equal(page.marks, 1, 'no markLive while replaying');
  assert.equal(context.lastSweepError, 'Sweep failed', 'the live sweep error survives a replay render');
});

test('replay in the page: SSE update, alerts, poll and reconnects never overwrite the replayed sweep; exit restores live and caches only live', async () => {
  const realm = pageRealm(), { context, page, handlers, api } = realm;
  await tick();
  context.connectSSE();
  const message = data => handlers.source.onmessage({ data: JSON.stringify(data) });
  await api.open(IDS[1]);
  const replayed = sweepTime(IDS[1]);
  assert.equal(context.D.meta.timestamp, replayed, 'the archived sweep is shown although it is older');
  assert.deepEqual(plain(context.D.events), [{ id: 'archived-event' }], 'records come from the replayed sweep');
  assert.equal(context.D.alerts, realm.liveAlerts, 'the live alerts object is kept, not the archived summary');
  assert.equal(realm.clock.now(), Date.parse(replayed));
  assert.equal(context.liveExpirySignature, '', 'the live panel signature is reset after the freeze'); assert.equal(page.sources, '');
  assert.ok(page.inspector > 0, 'the inspector ages are redrawn'); assert.equal(page.alerts.at(-1), realm.liveAlerts, 'the alert strip is redrawn with the live alerts');
  assert.deepEqual(page.cache, [], 'entering the replay writes nothing to the offline cache'); assert.equal(page.marks, 0);
  const newer = { meta: { timestamp: new Date(REAL + 15 * 60000).toISOString() }, events: [{ id: 'newest-live' }], alerts: { generatedAt: REAL - HOUR, counts: {}, threat: { level: 1 } } };
  const reinits = page.reinit;
  message({ type: 'update', data: newer });
  assert.equal(context.D.meta.timestamp, replayed, 'an SSE update does not overwrite the replay'); assert.equal(page.reinit, reinits);
  assert.match(statusText(realm), /Newer live data waiting: 1/);
  const ack = { generatedAt: REAL + 20 * 60000, counts: {}, threat: { level: 3 } };
  message({ type: 'alerts', data: ack });
  assert.deepEqual(plain(context.D.alerts), ack, 'alerts stay live'); assert.equal(context.D.meta.timestamp, replayed);
  handlers.source.onerror(); handlers.source.onopen?.();
  assert.equal(api.active(), true, 'an SSE drop and reconnect keep the replay');
  context.sseConnected = false;
  context.fetch = async () => ({ ok: true, json: async () => ({ ...newer, meta: { timestamp: new Date(REAL + 30 * 60000).toISOString() } }) });
  await context.pollSnapshot();
  assert.equal(context.D.meta.timestamp, replayed, 'the 60 s poll does not overwrite the replay');
  assert.match(statusText(realm), /Newer live data waiting: 2/);
  assert.deepEqual(page.cache, [], 'nothing cached during the replay');
  api.exit();
  assert.equal(realm.clock.frozen(), false);
  assert.equal(context.D.meta.timestamp, new Date(REAL + 30 * 60000).toISOString(), 'the newest kept live snapshot is shown');
  assert.deepEqual(plain(context.D.alerts), ack, 'the newer live alerts survive the restore');
  assert.deepEqual(page.cache, [new Date(REAL + 30 * 60000).toISOString()], 'only the live snapshot reaches the offline cache');
  message({ type: 'update', data: { meta: { timestamp: new Date(REAL + 45 * 60000).toISOString() } } });
  assert.equal(context.D.meta.timestamp, new Date(REAL + 45 * 60000).toISOString(), 'live updates apply again');
});

test('the page loads the replay modules after the clock, keeps the D line single and the shell caches them', () => {
  const at = needle => { const i = html.indexOf(needle); assert.ok(i > 0, needle); return i; };
  assert.ok(at('<script src="clock.js">') < at('<script src="replay-core.js">') && at('<script src="replay-core.js">') < at('<script src="replay.js">'));
  at('<link rel="stylesheet" href="replay.css">'); at('<div id="replayBar" hidden></div>');
  assert.equal(html.match(/^(let|const) D = .*;\s*$/gm).length, 1, 'the injected D line stays one line');
  const sw = read('sw.js'), base = JSON.parse(sw.match(/const BASE = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  for (const path of ['/replay-core.js', '/replay.js', '/replay.css']) assert.ok(base.includes(path), path);
  assert.equal(new Set(base).size, base.length);
  for (const name of ['replay-core.js', 'replay.js']) assert.doesNotMatch(read(name), /\son[a-z]+\s*=\s*["']/i, `${name}: no inline handler markup`);
  assert.match(html, /CrucixReplay\?\.offerLive\(message\.data\)/); assert.match(html, /CrucixReplay\?\.offerLive\(data\)/);
});

// ===== pwa.js: the offline store refuses a write during a replay =====
function pwaRealm(replaying) {
  const values = new Map();
  const db = { close() {}, transaction() {
    let pending = 0, finished = false; const tx = { abort() { finished = true; queueMicrotask(() => tx.onabort?.()); }, objectStore() { return store; } };
    const schedule = fn => { pending++; queueMicrotask(() => { fn(); pending--; if (!pending && !finished) { finished = true; queueMicrotask(() => tx.oncomplete?.()); } }); };
    const store = { get(key) { const request = {}; schedule(() => { request.result = structuredClone(values.get(key)); request.onsuccess?.(); }); return request; }, put(value, key) { schedule(() => values.set(key, structuredClone(value))); }, delete(key) { schedule(() => values.delete(key)); } };
    return tx;
  } };
  const window = { indexedDB: { open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request; } }, navigator: {}, addEventListener() {}, CrucixReplay: { active: () => replaying.value } };
  vm.runInNewContext(read('pwa.js'), { window, document: { querySelector: () => null }, TextEncoder, Date, JSON, Promise, Error, Object, Number, Array });
  return { api: window.CrucixPWA, values };
}

test('pwa.js writes no snapshot to IndexedDB while a replay is active', async () => {
  const replaying = { value: false }, { api, values } = pwaRealm(replaying);
  await api.setOfflineEnabled(true);
  replaying.value = true;
  const archived = { meta: { timestamp: new Date().toISOString() }, events: [] };
  assert.equal(await api.saveSnapshot(archived), false); assert.equal(values.has('snapshot'), false);
  await api.cacheLive(archived); await api.setOfflineEnabled(true);
  assert.equal(values.has('snapshot'), false, 'neither cacheLive nor enabling saves the replayed snapshot');
  replaying.value = false;
  assert.equal(await api.saveSnapshot(archived), true); assert.equal(values.has('snapshot'), true);
});
