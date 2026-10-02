import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../lib/atomic-json.mjs';
import { AlertStore, RULES_MAX_BYTES } from '../lib/alerts/store.mjs';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const quiet = { warn() {}, error() {}, log() {} };

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-alert-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function recorder() {
  const lines = [];
  const push = (...parts) => lines.push(parts.join(' '));
  return { lines, warn: push, error: push, log: push };
}

const store = (dir, options = {}) => new AlertStore(dir, { now: () => NOW, logger: quiet, ...options });
const plain = value => JSON.parse(JSON.stringify(value));
const alertsFile = dir => join(dir, 'alerts', 'alerts.json');
const rulesFile = dir => join(dir, 'alerts', 'rules.json');

function alert(n, overrides = {}) {
  return {
    id: `alert-${n.toString(16).padStart(32, '0')}`,
    ruleId: 'events-critical', ruleName: 'Critical events', dedupKey: `events-critical|event-${n}`, kind: 'event',
    severity: 'critical', state: 'firing', title: `Alert ${n}`, summary: 'Something happened',
    entity: { type: 'event', id: `event-${n}`, label: `Alert ${n}` },
    evidence: [{ type: 'event', id: `event-${n}`, title: `Alert ${n}`, source: 'GDACS', level: 'critical' }],
    firstSeenAt: NOW - DAY, lastSeenAt: NOW - DAY + n, count: 1, notify: true, silent: false,
    log: [{ at: NOW - DAY, action: 'created' }],
    ...overrides,
  };
}

const USER_RULE = { id: 'my-rule', name: 'My rule', kind: 'threshold', enabled: true, severity: 'high', notify: false, forSweeps: 2, cooldownMinutes: 30, params: { metric: 'wti', op: '>', value: 100 } };

test('a fresh directory loads as empty and the state is usable before and after load', t => {
  const dir = tmp(t);
  const subject = store(dir);
  assert.deepEqual(subject.state.alerts, []);
  assert.deepEqual(subject.load(), { alerts: 'empty', rules: 'empty' });
  assert.deepEqual(subject.state.alerts, []);
  assert.deepEqual(subject.state.userRules, []);
  assert.equal(subject.state.engine.initialized, false);
  assert.equal(subject.state.engine.lastEvaluatedAt, null);
  for (const name of ['pending', 'misses', 'failStreaks', 'cooldowns']) assert.deepEqual(Object.keys(subject.state.engine[name]), [], name);
});

test('round trip: alerts, engine state and user rules survive a save and a reload', t => {
  const dir = tmp(t);
  const first = store(dir);
  first.load();
  first.state.alerts.push(
    alert(1),
    alert(2, { state: 'acked', ack: { at: NOW - HOUR } }),
    alert(3, { state: 'snoozed', snooze: { at: NOW - HOUR, until: NOW + HOUR, reason: 'Known issue' }, notified: { at: NOW - DAY, channels: ['telegram', 'ntfy'] } }),
    alert(4, { state: 'resolved', resolvedAt: NOW - HOUR, metric: { key: 'vix', value: 31, threshold: 30 } }),
  );
  Object.assign(first.state.engine, { initialized: true, lastEvaluatedAt: NOW });
  first.state.engine.metrics.vix = 31.5;
  first.state.engine.pending['vix-spike|vix'] = 1;
  first.state.engine.misses['events-critical|event-1'] = 1;
  first.state.engine.failStreaks.GDELT = 2;
  first.state.engine.cooldowns['events-critical|event-9'] = NOW + 20 * 60000;
  first.state.engine.baseline['events-critical|event-8'] = NOW - HOUR;
  first.state.engine.overflow['events-critical'] = 12;
  first.state.userRules.push({ id: 'my-rule', rule: USER_RULE }, { id: 'vix-spike', override: { enabled: false } });
  assert.equal(first.save(), true);

  const saved = JSON.parse(readFileSync(alertsFile(dir), 'utf8'));
  assert.equal(saved.version, 1);
  assert.deepEqual(Object.keys(saved).sort(), ['alerts', 'engine', 'version']);
  assert.deepEqual(JSON.parse(readFileSync(rulesFile(dir), 'utf8')), { version: 1, rules: plain(first.state.userRules) });

  const second = store(dir);
  assert.deepEqual(second.load(), { alerts: 'ok', rules: 'ok' });
  assert.deepEqual(plain(second.state), plain(first.state));
});

test('a corrupt primary is recovered from the .bak copy', t => {
  const dir = tmp(t);
  const first = store(dir);
  first.load();
  first.state.alerts.push(alert(1));
  first.save();
  first.state.alerts.push(alert(2));
  first.save();
  writeFileSync(alertsFile(dir), '{"version":1,"alerts":[');

  const logger = recorder();
  const second = store(dir, { logger });
  assert.deepEqual(second.load(), { alerts: 'recovered', rules: 'empty' });
  assert.deepEqual(second.state.alerts.map(item => item.id), [alert(1).id]);
  assert.ok(logger.lines.some(line => line.includes('alerts.json')), logger.lines.join('\n'));
});

test('corrupt primary and backup give the corrupt status, an empty state, and the store keeps working', t => {
  const dir = tmp(t);
  mkdirSync(join(dir, 'alerts'), { recursive: true });
  for (const file of [alertsFile(dir), rulesFile(dir)]) {
    writeFileSync(file, 'garbage');
    writeFileSync(`${file}.bak`, '{"version":2,"alerts":[],"rules":[]}');
  }
  const subject = store(dir);
  assert.deepEqual(subject.load(), { alerts: 'corrupt', rules: 'corrupt' });
  assert.deepEqual(subject.state.alerts, []);
  assert.deepEqual(subject.state.userRules, []);
  assert.equal(subject.state.engine.initialized, false);

  subject.state.alerts.push(alert(1));
  assert.equal(subject.save(), true);
  assert.equal(store(dir).load().alerts, 'ok');
  // An unchanged rule list is not written, so the corrupt rules file stays for inspection.
  assert.equal(readFileSync(rulesFile(dir), 'utf8'), 'garbage');
});

test('wrong shapes and oversized files are not loaded', t => {
  const dir = tmp(t);
  mkdirSync(join(dir, 'alerts'), { recursive: true });
  writeFileSync(alertsFile(dir), JSON.stringify({ version: 1, alerts: {}, engine: {} }));
  writeFileSync(rulesFile(dir), JSON.stringify({ version: 1, rules: [], pad: 'x'.repeat(RULES_MAX_BYTES) }));
  assert.deepEqual(store(dir).load(), { alerts: 'corrupt', rules: 'corrupt' });
});

test('the alerts file size limit applies to loading and saving alike', t => {
  const dir = tmp(t);
  const maxBytes = 64 * 1024;
  const big = n => alert(n, { summary: 'x'.repeat(600), state: n % 2 ? 'resolved' : 'firing', resolvedAt: n % 2 ? NOW - n : undefined });
  const logger = recorder();
  const first = store(dir, { maxBytes, logger });
  first.load();
  for (let n = 1; n <= 200; n += 1) first.state.alerts.push(plain(big(n)));
  assert.equal(first.save(), true);
  assert.ok(readFileSync(alertsFile(dir)).length <= maxBytes);
  assert.ok(first.state.alerts.length > 0 && first.state.alerts.length < 100);
  assert.ok(first.state.alerts.every(item => item.state === 'firing'), 'resolved alerts are dropped first');
  assert.ok(logger.lines.some(line => line.includes('size')), logger.lines.join('\n'));
  assert.equal(store(dir, { maxBytes }).load().alerts, 'ok');
});

test('caps: 1001 alerts are cut to 1000, resolved ones first and the oldest of them first', t => {
  const dir = tmp(t);
  const subject = store(dir);
  subject.load();
  for (let n = 1; n <= 990; n += 1) subject.state.alerts.push(alert(n));
  for (let n = 991; n <= 1001; n += 1) subject.state.alerts.push(alert(n, { state: 'resolved', resolvedAt: NOW - HOUR + n }));
  subject.save();
  const reloaded = store(dir);
  reloaded.load();
  assert.equal(reloaded.state.alerts.length, 1000);
  const ids = new Set(reloaded.state.alerts.map(item => item.id));
  assert.equal(ids.has(alert(991).id), false, 'the oldest resolved alert goes first');
  assert.equal(ids.has(alert(1).id), true, 'active alerts stay while resolved ones can go');
});

test('caps: the count cap never drops open alerts (dropping one would only reopen it on the next sweep)', t => {
  const dir = tmp(t);
  const subject = store(dir, { maxAlerts: 10 });
  subject.load();
  for (let n = 1; n <= 12; n += 1) subject.state.alerts.push(alert(n));
  for (let n = 13; n <= 15; n += 1) subject.state.alerts.push(alert(n, { state: 'resolved', resolvedAt: NOW - n }));
  subject.save();
  assert.deepEqual(subject.state.alerts.map(item => item.id), Array.from({ length: 12 }, (_, i) => alert(i + 1).id));
  const reloaded = store(dir, { maxAlerts: 10 });
  reloaded.load();
  assert.equal(reloaded.state.alerts.length, 12);
});

test('counter tables are capped at 5000 entries on save, the oldest first, and load keeps the same newest ones', t => {
  const dir = tmp(t);
  const subject = store(dir);
  subject.load();
  for (let n = 0; n < 6000; n += 1) subject.state.engine.pending[`rule|key-${n}`] = 1;
  for (let n = 0; n < 5001; n += 1) subject.state.engine.baseline[`rule|key-${n}`] = NOW;
  subject.save();
  const keys = Object.keys(subject.state.engine.pending);
  assert.equal(keys.length, 5000);
  assert.equal(keys[0], 'rule|key-1000');
  assert.equal(Object.keys(subject.state.engine.baseline).length, 5000);
  const saved = JSON.parse(readFileSync(alertsFile(dir), 'utf8'));
  assert.equal(Object.keys(saved.engine.pending).length, 5000);

  const engine = { ...saved.engine, pending: Object.fromEntries(Array.from({ length: 6000 }, (_, n) => [`rule|key-${n}`, 1])) };
  writeJsonAtomic(alertsFile(dir), { ...saved, engine });
  const reloaded = store(dir);
  reloaded.load();
  assert.deepEqual(Object.keys(reloaded.state.engine.pending), keys);
});

test('retention: resolved alerts older than 30 days are dropped, younger ones and active ones are kept', t => {
  const dir = tmp(t);
  const subject = store(dir);
  subject.load();
  subject.state.alerts.push(
    alert(1, { state: 'resolved', firstSeenAt: NOW - 40 * DAY, lastSeenAt: NOW - 32 * DAY, resolvedAt: NOW - 31 * DAY }),
    alert(2, { state: 'resolved', firstSeenAt: NOW - 40 * DAY, lastSeenAt: NOW - 30 * DAY, resolvedAt: NOW - 29 * DAY }),
    alert(3, { state: 'acked', ack: { at: NOW - 39 * DAY }, firstSeenAt: NOW - 40 * DAY, lastSeenAt: NOW - 39 * DAY }),
  );
  subject.save();
  assert.deepEqual(subject.state.alerts.map(item => item.id), [alert(2).id, alert(3).id]);
  const short = store(dir, { retentionDays: 7 });
  short.load();
  assert.deepEqual(short.state.alerts.map(item => item.id), [alert(3).id]);
});

test('allowlist: unknown fields are stripped, bad records dropped, lists and text bounded', t => {
  const dir = tmp(t);
  const log = Array.from({ length: 25 }, (_, i) => ({ at: NOW - 25 + i, action: `step-${i}`, extra: 1 }));
  const evidence = Array.from({ length: 12 }, (_, i) => ({ type: 'event', id: `e${i}`, title: `E${i}`, source: 'X', level: 'high', html: '<b>' }));
  writeJsonAtomic(alertsFile(dir), {
    version: 1,
    alerts: [
      { ...alert(1), evil: '<script>', entity: { type: 'event', id: 'event-1', label: 'L', extra: 1 }, log, evidence, title: 'Line\u0000one\u2028two' },
      alert(2, { state: 'bogus' }),
      alert(3, { id: 'alert-XYZ' }),
      alert(4, { severity: 'apocalyptic' }),
      alert(5, { dedupKey: 'other-rule|x' }),
      alert(6, { firstSeenAt: 'yesterday' }),
      alert(7, { state: 'snoozed' }),
      'not an alert',
      null,
      { ...alert(1), title: 'duplicate id' },
    ],
    engine: { initialized: 'yes', lastEvaluatedAt: 'now', metrics: { vix: 'high', gold: 2000, nope: 1 }, pending: { 'a|b': 2, 'a|c': -1, 'a|d': 'x' }, extra: true },
  });
  const subject = store(dir);
  assert.equal(subject.load().alerts, 'ok');
  assert.deepEqual(subject.state.alerts.map(item => item.id), [alert(1).id, alert(7).id]);
  const [first, snoozed] = subject.state.alerts;
  assert.equal('evil' in first, false);
  assert.deepEqual(first.entity, { type: 'event', id: 'event-1', label: 'L' });
  assert.equal(first.log.length, 20);
  assert.equal(first.log[0].action, 'step-5', 'the newest 20 log entries are kept');
  assert.equal('extra' in first.log[0], false);
  assert.equal(first.evidence.length, 8);
  assert.equal('html' in first.evidence[0], false);
  assert.equal(first.title, 'Line one two');
  assert.equal(snoozed.state, 'firing', 'a snoozed alert without a deadline is firing');
  assert.equal('snooze' in snoozed, false);
  const { engine } = subject.state;
  assert.equal(engine.initialized, false);
  assert.equal(engine.lastEvaluatedAt, null);
  assert.equal(engine.metrics.vix, null);
  assert.equal(engine.metrics.gold, 2000);
  assert.equal('nope' in engine.metrics, false);
  assert.deepEqual(Object.keys(engine.pending), ['a|b']);
  assert.equal('extra' in engine, false);
});

test('__proto__ keys in a loaded file are ignored and pollute nothing', t => {
  const dir = tmp(t);
  mkdirSync(join(dir, 'alerts'), { recursive: true });
  const record = JSON.stringify(alert(1)).replace(/^\{/, '{"__proto__":{"polluted":true},');
  writeFileSync(alertsFile(dir), `{"version":1,"__proto__":{"polluted":true},"alerts":[${record}],"engine":{"__proto__":{"polluted":true},"initialized":true,"pending":{"__proto__":3,"rule|x":2},"failStreaks":{"__proto__":{"polluted":true},"constructor":4},"metrics":{"__proto__":{"polluted":true}}}}`);
  writeFileSync(rulesFile(dir), '{"version":1,"rules":[{"__proto__":{"polluted":true},"id":"vix-spike","override":{"enabled":false}},{"id":"__proto__","rule":{}},{"id":"constructor","rule":{"name":"C"}}]}');
  const subject = store(dir);
  assert.deepEqual(subject.load(), { alerts: 'ok', rules: 'ok' });
  assert.equal(({}).polluted, undefined);
  const [loaded] = subject.state.alerts;
  assert.equal(Object.getPrototypeOf(loaded), Object.prototype);
  assert.equal(Object.hasOwn(loaded, '__proto__'), false);
  assert.equal(loaded.polluted, undefined);
  assert.deepEqual(Object.keys(subject.state.engine.pending), ['rule|x']);
  assert.deepEqual(Object.keys(subject.state.engine.failStreaks), ['constructor']);
  assert.equal(subject.state.engine.failStreaks.constructor, 4);
  assert.equal(subject.state.engine.initialized, true);
  assert.deepEqual(plain(subject.state.userRules), [{ id: 'vix-spike', override: { enabled: false } }, { id: 'constructor', rule: { name: 'C' } }]);
});

test('user rule records are capped at 200 on load and must carry an id with one rule or override object', t => {
  const dir = tmp(t);
  const records = Array.from({ length: 300 }, (_, i) => ({ id: `rule-${i}`, rule: { name: `R${i}` } }));
  records.unshift({ id: 'bad id' }, { id: 'no-body' }, { id: 'both', rule: {}, override: {} }, { id: 'list', rule: [] }, { id: 'rule-0', override: {} });
  writeJsonAtomic(rulesFile(dir), { version: 1, rules: records });
  const subject = store(dir);
  subject.load();
  assert.equal(subject.state.userRules.length, 200);
  assert.equal(subject.state.userRules[0].id, 'rule-0');
  assert.equal(subject.state.userRules.filter(item => item.id === 'rule-0').length, 1, 'the first record per id wins');
});

test('save never throws: an unwritable directory is logged and reported as false', t => {
  const dir = tmp(t);
  writeFileSync(join(dir, 'alerts'), 'a file where the directory should be');
  const logger = recorder();
  const subject = store(dir, { logger });
  subject.load();
  subject.state.alerts.push(alert(1));
  subject.state.userRules.push({ id: 'my-rule', rule: USER_RULE });
  assert.equal(subject.save(), false);
  assert.ok(logger.lines.some(line => line.includes('alerts.json')), logger.lines.join('\n'));
  assert.ok(logger.lines.some(line => line.includes('rules.json')), logger.lines.join('\n'));
});

test('save retries once after a Windows EPERM or EBUSY and gives up on anything else', t => {
  const dir = tmp(t);
  const calls = [];
  const pauses = [];
  let failures = [];
  const writeJson = (path, value) => {
    calls.push(path);
    const code = failures.shift();
    if (code) throw Object.assign(new Error(`${code}: locked`), { code });
    writeJsonAtomic(path, value);
  };
  const subject = store(dir, { writeJson, logger: quiet, pause: ms => pauses.push(ms) });
  subject.load();

  failures = ['EPERM'];
  assert.equal(subject.save(), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(pauses, [50], 'one short pause before the retry');
  assert.ok(existsSync(alertsFile(dir)));

  calls.length = 0;
  failures = ['EBUSY', 'EBUSY'];
  assert.equal(subject.save(), false, 'a second failure is not retried again');
  assert.equal(calls.length, 2);

  calls.length = 0;
  failures = ['EACCES'];
  assert.equal(subject.save(), false);
  assert.equal(calls.length, 1, 'other errors are not retried');
  assert.equal(pauses.length, 2);
});

test('the rules file is written only when the rule records changed', t => {
  const dir = tmp(t);
  const written = [];
  const writeJson = (path, value) => { written.push(path); writeJsonAtomic(path, value); };
  const subject = store(dir, { writeJson });
  subject.load();
  subject.save();
  assert.deepEqual(written, [alertsFile(dir)]);
  subject.state.userRules.push({ id: 'my-rule', rule: USER_RULE });
  subject.save();
  subject.save();
  assert.deepEqual(written, [alertsFile(dir), alertsFile(dir), rulesFile(dir), alertsFile(dir)]);
});
