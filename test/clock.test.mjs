import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../dashboard/public/' + name, import.meta.url), 'utf8');
const html = read('jarvis.html');
const HOUR = 3600000, DAY = 24 * HOUR;
const T = Date.parse('2026-10-01T21:00:00Z'); // the snapshot time a replay freezes the clock at

// A fresh vm realm per test (the clock is a singleton). Its Date reports `state.real` as "now", so the "real clock" is deterministic;
// `new Date(value)` and Date.parse still work. TypeError is passed in so assert.throws can match it across realms.
function realm(files, { real = T + 3 * DAY, ...extra } = {}) {
  const state = { real };
  class FakeDate extends Date { static now() { return state.real; } }
  const window = {};
  const context = vm.createContext({ window, Date: FakeDate, URL, Object, Array, Number, JSON, Set, TypeError, ...extra });
  for (const file of files) vm.runInContext(read(file), context);
  return { window, state, context };
}

// A top-level function of jarvis.html, as the other tests slice them: it must start at column 0.
function pageFunctions(context, ...names) {
  const code = names.map(name => {
    const at = html.indexOf(`\nfunction ${name}(`);
    assert.ok(at >= 0, `function ${name}( is a top-level declaration at column 0`);
    const start = at + 1, end = html.indexOf('\nfunction ', start + 1);
    return html.slice(start, end);
  }).join('\n');
  vm.runInContext(code, context);
}

test('now() follows the real clock until it is frozen', () => {
  const { window, state } = realm(['clock.js'], { real: 1000 });
  const clock = window.CrucixClock;
  assert.deepEqual(Object.keys(clock).sort(), ['freeze', 'frozen', 'now', 'release']);
  assert.equal(clock.now(), 1000); assert.equal(clock.frozen(), false);
  state.real = 5000; assert.equal(clock.now(), 5000);
  const live = vm.createContext({ window: {}, Date });
  vm.runInContext(read('clock.js'), live);
  assert.ok(Math.abs(live.window.CrucixClock.now() - Date.now()) < 5000, 'without a fake Date it is Date.now()');
});

test('freeze(ms) pins now() and a later freeze re-pins it', () => {
  const { window, state } = realm(['clock.js'], { real: 1000 });
  const clock = window.CrucixClock;
  clock.freeze(T);
  state.real = 999999; assert.equal(clock.now(), T); assert.equal(clock.frozen(), true);
  state.real += HOUR; assert.equal(clock.now(), T, 'real time passing does not move a frozen clock');
  clock.freeze(T - DAY); assert.equal(clock.now(), T - DAY);
  clock.freeze(0); assert.equal(clock.frozen(), true); assert.equal(clock.now(), 0, 'zero is a valid frozen time');
});

test('release() restores real time and is idempotent', () => {
  const { window, state } = realm(['clock.js'], { real: 1000 });
  const clock = window.CrucixClock;
  clock.release(); assert.equal(clock.frozen(), false); assert.equal(clock.now(), 1000, 'release without a freeze is harmless');
  clock.freeze(T); state.real = 2000;
  clock.release(); assert.equal(clock.frozen(), false); assert.equal(clock.now(), 2000);
  clock.release(); assert.equal(clock.frozen(), false); assert.equal(clock.now(), 2000);
});

test('freeze rejects anything but a finite number and leaves the clock as it was', () => {
  const { window, state } = realm(['clock.js'], { real: 1000 });
  const clock = window.CrucixClock;
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '5', '', {}, [], true]) {
    assert.throws(() => clock.freeze(bad), TypeError, String(bad));
    assert.equal(clock.frozen(), false, `${String(bad)} did not freeze`);
  }
  clock.freeze(T);
  assert.throws(() => clock.freeze(NaN), TypeError);
  assert.equal(clock.frozen(), true); assert.equal(clock.now(), T, 'a rejected freeze keeps the earlier one');
  state.real = 3000; assert.equal(clock.now(), T);
});

// GDACS keeps a row current for 6 h (and its records for 72 h): 2 h old at T is current, 3 days later it is expired.
const observedAt = new Date(T - 2 * HOUR).toISOString();
const gdacs = { source: 'GDACS', status: 'ok', observedAt, observations: [{ providerId: 'g1', kind: 'disaster', title: 'Flood alert', severity: 'Orange', observedAt, lat: 36.2, lon: 28.1 }] };
const t = (_key, fallback) => fallback;

test('a source observed 2 h before the frozen time is ok with the clock frozen and expired with the real clock', () => {
  const { window } = realm(['record-core.js', 'clock.js', 'live-sources.js']);
  const api = window.CrucixLiveSources;
  assert.equal(api.state(gdacs), 'stale', 'real clock: observed 3 days ago');
  assert.equal(api.observations([gdacs]).length, 0); assert.equal(api.markerRows([gdacs], []).length, 0);
  const expired = api.renderPanel([gdacs], t, []);
  assert.match(expired, /data-live-state="stale"/); assert.match(expired, /Provider data expired/); assert.doesNotMatch(expired, /data-open-records/);
  window.CrucixClock.freeze(T);
  assert.equal(api.state(gdacs), 'ok', 'frozen at the snapshot time: 2 h old');
  assert.equal(api.observations([gdacs]).length, 1); assert.equal(api.markerRows([gdacs], []).length, 1);
  const current = api.renderPanel([gdacs], t, []);
  assert.match(current, /data-live-state="ok"/); assert.doesNotMatch(current, /Provider data expired/); assert.match(current, /data-open-records="GDACS"/); assert.match(current, />1\/1</);
  assert.equal(api.state(gdacs, T + 3 * DAY), 'stale', 'an explicit now still wins over the clock');
  window.CrucixClock.release();
  assert.equal(api.state(gdacs), 'stale', 'after leaving the replay the real clock is back');
  assert.match(api.renderPanel([gdacs], t, []), /data-live-state="stale"/);
});

test('live sources fall back to Date.now when CrucixClock is absent or broken', () => {
  const bare = realm(['live-sources.js'], { real: T });
  assert.equal(bare.window.CrucixClock, undefined);
  assert.equal(bare.window.CrucixLiveSources.state(gdacs), 'ok'); assert.equal(bare.window.CrucixLiveSources.observations([gdacs]).length, 1);
  bare.state.real = T + 3 * DAY;
  assert.equal(bare.window.CrucixLiveSources.state(gdacs), 'stale');
  assert.match(bare.window.CrucixLiveSources.renderPanel([gdacs], t, []), /data-live-state="stale"/);
  const broken = realm(['live-sources.js'], { real: T });
  for (const clock of [{ now: () => NaN }, { now: 'nope' }, {}]) {
    broken.window.CrucixClock = clock;
    assert.equal(broken.window.CrucixLiveSources.state(gdacs), 'ok', JSON.stringify(Object.keys(clock)));
  }
});

test('the page helpers read the frozen clock: getAge and the data freshness line', () => {
  const els = Object.fromEntries(['liveStatus', 'freshnessStatus', 'airFreshness'].map(id => [id, { dataset: {}, textContent: '' }]));
  const { window, context } = realm(['clock.js'], { t, document: { getElementById: id => els[id] }, connectionState: 'live', lastSweepError: '', refreshIntervalMinutes: 5, D: { meta: { timestamp: new Date(T).toISOString() } } });
  pageFunctions(context, 'clockNow', 'getAge', 'updateRuntimeStatus');
  const stamp = new Date(T - 2 * HOUR).toISOString();
  assert.equal(context.getAge(stamp), '3 d ago');
  context.updateRuntimeStatus();
  assert.equal(els.freshnessStatus.dataset.state, 'stale'); assert.match(els.freshnessStatus.textContent, /^Data: Stale \/ cached · 3 d ago$/);
  window.CrucixClock.freeze(T + 60000);
  assert.equal(context.getAge(stamp), '2 h ago');
  assert.equal(context.getAge(new Date(T + 60000).toISOString()), 'Just now');
  context.updateRuntimeStatus();
  assert.equal(els.freshnessStatus.dataset.state, 'live'); assert.match(els.freshnessStatus.textContent, /^Data: Fresh · 1 min ago$/);
  window.CrucixClock.release();
  assert.equal(context.getAge(stamp), '3 d ago');
  const bare = realm([], { real: T, t });
  pageFunctions(bare.context, 'clockNow', 'getAge');
  assert.equal(bare.context.getAge(stamp), '2 h ago', 'without CrucixClock getAge uses Date.now');
});

test('the DOMContentLoaded wiring hands the clock to the record inspector; the live alert tray keeps real time', () => {
  const start = html.indexOf("document.addEventListener('DOMContentLoaded'"), end = html.indexOf("\nwindow.addEventListener('beforeunload'", start);
  assert.ok(start > 0 && end > start, 'the DOMContentLoaded handler is found');
  const handlers = {}, mounted = {};
  const { window, context } = realm(['clock.js'], {
    t, L: { meta: { code: 'en' } }, D: { alerts: null, liveSources: [] }, location: { protocol: 'file:' }, setInterval: () => 0,
    document: { documentElement: {}, title: '', addEventListener: (type, fn) => { handlers[type] = fn; } },
    currentSnapshot: () => ({ events: [] }), init() {}, updateRuntimeStatus() {}, refreshLiveFreshness() {},
  });
  window.CrucixAlerts = { mount: opts => { mounted.alerts = opts; } };
  window.CrucixRecordInspector = { mount: opts => { mounted.inspector = opts; } };
  pageFunctions(context, 'clockNow');
  vm.runInContext(html.slice(start, end), context);
  handlers.DOMContentLoaded();
  // Without `now` alerts.js uses Date.now: the alerts are live state, also while a replay freezes the dashboard clock.
  assert.equal(mounted.alerts.now, undefined, 'the alert tray gets no dashboard clock'); assert.equal(typeof mounted.inspector.now, 'function');
  assert.equal(mounted.inspector.now(), T + 3 * DAY);
  window.CrucixClock.freeze(T);
  assert.equal(mounted.inspector.now(), T, 'the inspector reads the frozen clock');
  window.CrucixClock.release();
  assert.equal(mounted.inspector.now(), T + 3 * DAY);
});

test('clock.js loads before every module that reads it, and the offline shell caches it', () => {
  const at = needle => { const i = html.indexOf(needle); assert.ok(i > 0, needle); return i; };
  for (const later of ['live-sources.js', 'record-inspector.js', 'alerts.js']) assert.ok(at('<script src="clock.js">') < at(`<script src="${later}">`), `clock.js before ${later}`);
  const sw = read('sw.js'), base = JSON.parse(sw.match(/const BASE = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  assert.ok(base.includes('/clock.js'), '/clock.js is in the shell cache');
  assert.equal(new Set(base).size, base.length, 'no duplicate shell paths');
});

test('no freshness computation bypasses the clock: the only Date.now left in these files is the fallback', () => {
  const count = source => (source.match(/Date\.now/g) || []).length;
  assert.equal(count(read('live-sources.js')), 1, 'live-sources.js: the nowMs fallback only');
  assert.equal(count(html), 1, 'jarvis.html: the clockNow fallback only');
  assert.match(html, /function clockNow\(\)\{[^}]*Date\.now\(\)/);
});
