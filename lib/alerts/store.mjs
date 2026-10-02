import { join } from 'node:path';
import { readJsonWithBackup, writeJsonAtomic } from '../atomic-json.mjs';
import { LEVELS } from './levels.mjs';
import { METRIC_KEYS } from './metrics.mjs';

// Persistence of the alert engine: runs/alerts/alerts.json ({version: 1, alerts, engine}) and runs/alerts/rules.json
// ({version: 1, rules}). Everything read back is rebuilt field by field from an allowlist, so a hand-edited, corrupt or
// hostile file can only lose records, never add fields, prototypes or unbounded text. Nothing here throws at the caller.

export const ALERT_STATES = Object.freeze(['firing', 'acked', 'snoozed', 'resolved']);
export const MAX_LOG = 20;
export const MAX_EVIDENCE = 8;
export const MAX_TITLE = 160;
export const MAX_SUMMARY = 600;
export const MAX_DEDUP_KEY = 400;
/** Stored user rule records (user rules and built-in overrides) read from rules.json; the engine writes at most 58. */
export const MAX_RULE_RECORDS = 200;
/** Every string field of an alert is capped, so 1000 alerts stay far below this; save() trims alerts if they ever do not. */
export const ALERTS_MAX_BYTES = 48 * 1024 * 1024;
/** 200 records of at most ~15 KB each (validated rules hold at most ~2 400 characters). */
export const RULES_MAX_BYTES = 4 * 1024 * 1024;

const VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_STATE_ENTRIES = 5000;
const MAX_CHANNELS = 8;
const RETRY_DELAY_MS = 50;
const ALERT_ID = /^alert-[0-9a-f]{32}$/;
const RULE_ID = /^[a-z0-9-]{1,40}$/;
const CHANNEL = /^[a-z0-9-]{1,20}$/;
// Control characters, line/paragraph separators and bidi overrides.
const UNSAFE_TEXT = new RegExp('[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]', 'g');

// ─── small readers ───────────────────────────────────────────────────────────

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
// Own properties only: a "__proto__" key in a parsed file is an own property and is never asked for by name.
const own = (source, key) => isObject(source) && Object.hasOwn(source, key) ? source[key] : undefined;
const listOf = value => Array.isArray(value) ? value : [];

/** One line of at most `max` characters with no control, separator or bidi characters and no lone surrogates. */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max).replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim().toWellFormed();
}

const optionalText = (value, max) => { const text = cleanText(value, max); return text === '' ? undefined : text; };
const level = value => LEVELS.includes(value) ? value : undefined;
const time = value => finite(value) ? value : undefined;

// A plain object without undefined values, so a normalised record looks exactly like a freshly built one.
function compact(record) {
  for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
  return record;
}

/** A null-prototype dictionary: any string, "constructor" or "__proto__" included, is just a key. */
export const dictionary = () => Object.create(null);

// ─── alerts ──────────────────────────────────────────────────────────────────

function entityOf(raw, dedupKey) {
  if (!isObject(raw)) return { type: 'unknown', id: cleanText(dedupKey, 200) };
  return compact({
    type: cleanText(own(raw, 'type'), 20) || 'unknown',
    id: cleanText(own(raw, 'id'), 200),
    label: optionalText(own(raw, 'label'), MAX_TITLE),
    lat: time(own(raw, 'lat')),
    lon: time(own(raw, 'lon')),
  });
}

function evidenceOf(raw) {
  return listOf(raw).slice(0, MAX_EVIDENCE).filter(isObject).map(item => compact({
    type: cleanText(own(item, 'type'), 20) || 'event',
    id: cleanText(own(item, 'id'), 200),
    title: cleanText(own(item, 'title'), MAX_TITLE),
    source: cleanText(own(item, 'source'), 120),
    level: level(own(item, 'level')),
  }));
}

function metricOf(raw) {
  if (!isObject(raw) || typeof own(raw, 'key') !== 'string') return undefined;
  return compact({
    key: cleanText(own(raw, 'key'), 40),
    value: time(own(raw, 'value')),
    threshold: time(own(raw, 'threshold')),
    previous: time(own(raw, 'previous')),
  });
}

function logOf(raw) {
  const entries = listOf(raw).filter(item => isObject(item) && finite(own(item, 'at')) && typeof own(item, 'action') === 'string');
  return entries.slice(-MAX_LOG).map(item => compact({ at: own(item, 'at'), action: cleanText(own(item, 'action'), 30), note: optionalText(own(item, 'note'), 200) }));
}

function notifiedOf(raw) {
  if (!isObject(raw) || !finite(own(raw, 'at'))) return undefined;
  const channels = [...new Set(listOf(own(raw, 'channels')).filter(item => typeof item === 'string' && CHANNEL.test(item)))].slice(0, MAX_CHANNELS);
  return { at: own(raw, 'at'), channels };
}

/** An alert rebuilt from the allowlist, or null when an identifying or lifecycle field is missing or wrong. */
export function normalizeAlert(raw) {
  if (!isObject(raw)) return null;
  const id = own(raw, 'id');
  const ruleId = own(raw, 'ruleId');
  const dedupKey = own(raw, 'dedupKey');
  let state = own(raw, 'state');
  const severity = level(own(raw, 'severity'));
  const firstSeenAt = time(own(raw, 'firstSeenAt'));
  const lastSeen = time(own(raw, 'lastSeenAt'));
  if (typeof id !== 'string' || !ALERT_ID.test(id) || typeof ruleId !== 'string' || !RULE_ID.test(ruleId)) return null;
  if (typeof dedupKey !== 'string' || dedupKey.length > MAX_DEDUP_KEY || !dedupKey.startsWith(`${ruleId}|`)) return null;
  if (!ALERT_STATES.includes(state) || severity === undefined || firstSeenAt === undefined || lastSeen === undefined) return null;
  const lastSeenAt = Math.max(firstSeenAt, lastSeen);

  const rawSnooze = own(raw, 'snooze');
  const until = time(own(rawSnooze, 'until'));
  if (state === 'snoozed' && until === undefined) state = 'firing';
  const count = own(raw, 'count');

  return compact({
    id, ruleId,
    ruleName: cleanText(own(raw, 'ruleName'), 80) || ruleId,
    dedupKey,
    kind: cleanText(own(raw, 'kind'), 20) || 'unknown',
    severity, state,
    title: cleanText(own(raw, 'title'), MAX_TITLE) || 'Untitled alert',
    summary: cleanText(own(raw, 'summary'), MAX_SUMMARY),
    entity: entityOf(own(raw, 'entity'), dedupKey),
    evidence: evidenceOf(own(raw, 'evidence')),
    metric: metricOf(own(raw, 'metric')),
    firstSeenAt, lastSeenAt,
    resolvedAt: state === 'resolved' ? Math.max(time(own(raw, 'resolvedAt')) ?? lastSeenAt, lastSeenAt) : undefined,
    count: Number.isSafeInteger(count) && count > 0 ? count : 1,
    ack: state === 'acked' ? { at: time(own(own(raw, 'ack'), 'at')) ?? lastSeenAt } : undefined,
    snooze: state === 'snoozed' ? compact({ at: time(own(rawSnooze, 'at')) ?? lastSeenAt, until, reason: optionalText(own(rawSnooze, 'reason'), 120) }) : undefined,
    notified: notifiedOf(own(raw, 'notified')),
    notify: own(raw, 'notify') === true,
    silent: own(raw, 'silent') === true,
    log: logOf(own(raw, 'log')),
  });
}

// Valid alerts with unique ids and at most one open episode per dedupKey (the most recently seen one wins).
function normalizeAlerts(raw) {
  const alerts = [];
  const ids = new Set();
  const open = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    const alert = normalizeAlert(item);
    if (alert === null || ids.has(alert.id)) continue;
    ids.add(alert.id);
    if (alert.state !== 'resolved') {
      const other = open.get(alert.dedupKey);
      if (other !== undefined && other.lastSeenAt >= alert.lastSeenAt) continue;
      if (other !== undefined) alerts.splice(alerts.indexOf(other), 1);
      open.set(alert.dedupKey, alert);
    }
    alerts.push(alert);
  }
  return alerts;
}

// Which alerts go first when the store is over its cap: resolved before open ones, then the least recently active.
const lastActivity = alert => alert.state === 'resolved' ? alert.resolvedAt : alert.lastSeenAt;
const dropOrder = (a, b) => (b.state === 'resolved') - (a.state === 'resolved') || lastActivity(a) - lastActivity(b);

/**
 * Drop resolved alerts older than the retention, then resolved alerts beyond `maxAlerts` (oldest first). Open alerts
 * are still being evaluated: dropping one would only reopen it as a new alert on the next sweep, so the engine bounds
 * them when it opens them, and they go here only with `dropOpen` (the size-limit emergency path), least recently
 * seen first. Keeps the original order.
 */
export function pruneAlerts(alerts, { now, maxAlerts, retentionMs, dropOpen = false }) {
  const cutoff = now - retentionMs;
  let kept = alerts.filter(alert => alert.state !== 'resolved' || !(alert.resolvedAt < cutoff));
  if (kept.length > maxAlerts) {
    const candidates = [...kept].filter(alert => dropOpen || alert.state === 'resolved').sort(dropOrder);
    const dropped = new Set(candidates.slice(0, kept.length - maxAlerts));
    kept = kept.filter(alert => !dropped.has(alert));
  }
  return kept;
}

// ─── engine state and rule records ───────────────────────────────────────────

// The valid entries of a stored counter table (capCounters bounds them afterwards).
function numbers(raw, accept, keyOk = () => true) {
  const clean = dictionary();
  if (!isObject(raw)) return clean;
  for (const key of Object.keys(raw)) {
    if (key !== '__proto__' && key.length <= MAX_DEDUP_KEY && keyOk(key) && accept(raw[key])) clean[key] = raw[key];
  }
  return clean;
}

const COUNTER_TABLES = Object.freeze(['pending', 'misses', 'failStreaks', 'cooldowns', 'baseline', 'overflow']);

// An emergency bound only: the engine keeps these tables far smaller by construction. Beyond MAX_STATE_ENTRIES the
// oldest entries go (insertion order), and for pending the shortest streaks first, so advanced streaks are never cut.
function capCounters(engine) {
  for (const name of COUNTER_TABLES) {
    const table = engine[name];
    let keys = Object.keys(table);
    if (keys.length <= MAX_STATE_ENTRIES) continue;
    if (name === 'pending') keys = keys.sort((a, b) => table[a] - table[b]);
    for (const key of keys.slice(0, keys.length - MAX_STATE_ENTRIES)) delete table[key];
  }
}

const counter = value => Number.isSafeInteger(value) && value > 0;

export function emptyEngineState() {
  return normalizeEngine(null);
}

function normalizeEngine(raw) {
  const metrics = dictionary();
  const storedMetrics = own(raw, 'metrics');
  for (const key of METRIC_KEYS) metrics[key] = finite(own(storedMetrics, key)) ? storedMetrics[key] : null;
  const engine = {
    initialized: own(raw, 'initialized') === true,
    lastEvaluatedAt: time(own(raw, 'lastEvaluatedAt')) ?? null,
    metrics,
    pending: numbers(own(raw, 'pending'), counter),
    misses: numbers(own(raw, 'misses'), counter),
    failStreaks: numbers(own(raw, 'failStreaks'), counter),
    cooldowns: numbers(own(raw, 'cooldowns'), finite),
    // Subjects (rule kind | event id, metric, source, cell or signal) hit at bootstrap without opening: silent later.
    baseline: numbers(own(raw, 'baseline'), finite),
    // Hits per rule held back by the caps on the last evaluation; the keys are rule ids.
    overflow: numbers(own(raw, 'overflow'), counter, key => RULE_ID.test(key)),
  };
  capCounters(engine);
  return engine;
}

// {id, rule} for a user rule or {id, override} for a built-in override. The content is validated by mergeRules and the
// engine; here only the shape, the first record per id and the record count are enforced.
function normalizeRecords(raw) {
  const records = [];
  const ids = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (records.length >= MAX_RULE_RECORDS) break;
    const id = own(item, 'id');
    if (typeof id !== 'string' || !RULE_ID.test(id) || ids.has(id)) continue;
    const rule = own(item, 'rule');
    const override = own(item, 'override');
    if ((rule === undefined) === (override === undefined)) continue;
    if (!isObject(rule ?? override)) continue;
    ids.add(id);
    records.push(rule === undefined ? { id, override } : { id, rule });
  }
  return records;
}

// ─── files ───────────────────────────────────────────────────────────────────

const isDocument = list => value => isObject(value) && own(value, 'version') === VERSION && Array.isArray(own(value, list));

function statusOf(result) {
  if (result.source === 'primary') return 'ok';
  if (result.source === 'backup') return 'recovered';
  return result.error ? 'corrupt' : 'empty';
}

const reasonOf = error => error?.code || (error instanceof Error ? error.message : String(error));

// Windows anti-virus and indexers briefly lock freshly written files; one short pause usually clears it.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class AlertStore {
  #now;
  #maxAlerts;
  #retentionMs;
  #maxBytes;
  #logger;
  #writeJson;
  #pause;
  #rulesWritten = '[]';

  /**
   * @param {string} runsDir the runs directory; files live in `<runsDir>/alerts/`.
   * @param {{now?: () => number, maxAlerts?: number, retentionDays?: number, maxBytes?: number, logger?: object,
   *          writeJson?: (path: string, value: unknown) => void, pause?: (ms: number) => void}} [options] `writeJson` and
   *          `pause` (the wait before the retry) replace writeJsonAtomic and a blocking sleep in tests.
   */
  constructor(runsDir, { now = Date.now, maxAlerts = 1000, retentionDays = 30, maxBytes = ALERTS_MAX_BYTES, logger = console, writeJson = writeJsonAtomic, pause = sleep } = {}) {
    const dir = join(String(runsDir), 'alerts');
    this.alertsPath = join(dir, 'alerts.json');
    this.rulesPath = join(dir, 'rules.json');
    this.#now = now;
    this.#maxAlerts = maxAlerts;
    this.#retentionMs = retentionDays * DAY_MS;
    this.#maxBytes = maxBytes;
    this.#logger = logger;
    this.#writeJson = writeJson;
    this.#pause = pause;
    this.state = { alerts: [], engine: emptyEngineState(), userRules: [] };
    this.status = { alerts: 'empty', rules: 'empty' };
  }

  #warn(message) {
    try { (this.#logger?.warn ?? this.#logger?.log)?.call(this.#logger, `[Alerts] ${message}`); } catch { /* logging never breaks the store */ }
  }

  #prune(alerts, maxAlerts = this.#maxAlerts, dropOpen = false) {
    return pruneAlerts(alerts, { now: this.#now(), maxAlerts, retentionMs: this.#retentionMs, dropOpen });
  }

  /** Read both files (falling back to their .bak copies). A missing, corrupt or oversized file gives an empty state. */
  load() {
    const alerts = readJsonWithBackup(this.alertsPath, { maxBytes: this.#maxBytes, validate: isDocument('alerts') });
    const rules = readJsonWithBackup(this.rulesPath, { maxBytes: RULES_MAX_BYTES, validate: isDocument('rules') });
    if (alerts.error) this.#warn(`alerts.json: ${alerts.error}`);
    if (rules.error) this.#warn(`rules.json: ${rules.error}`);
    this.state = {
      alerts: this.#prune(normalizeAlerts(own(alerts.value, 'alerts'))),
      engine: normalizeEngine(own(alerts.value, 'engine')),
      userRules: normalizeRecords(own(rules.value, 'rules')),
    };
    this.#rulesWritten = JSON.stringify(this.state.userRules);
    this.status = { alerts: statusOf(alerts), rules: statusOf(rules) };
    return { ...this.status };
  }

  #write(path, value) {
    try {
      this.#writeJson(path, value);
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error;
      this.#pause(RETRY_DELAY_MS);
      this.#writeJson(path, value);
    }
  }

  // The alerts document, trimmed (resolved and least recently active first) until it fits the size the loader accepts.
  #alertsDocument() {
    capCounters(this.state.engine);
    let alerts = this.#prune(this.state.alerts);
    let document = { version: VERSION, alerts, engine: this.state.engine };
    while (alerts.length > 0 && Buffer.byteLength(JSON.stringify(document)) > this.#maxBytes) {
      alerts = this.#prune(alerts, Math.floor(alerts.length * 3 / 4), true);
      document = { version: VERSION, alerts, engine: this.state.engine };
      this.#warn(`alerts.json over the size limit: kept ${alerts.length} alerts`);
    }
    this.state.alerts = alerts;
    return document;
  }

  /**
   * Prune and write alerts.json, and rules.json when the rule records changed. Never throws: a failure is logged and
   * reported as false. A Windows EPERM/EBUSY is retried once after a short pause.
   */
  save() {
    let ok = true;
    try {
      this.#write(this.alertsPath, this.#alertsDocument());
    } catch (error) {
      ok = false;
      this.#warn(`alerts.json not saved (${reasonOf(error)})`);
    }
    try {
      const rules = JSON.stringify(this.state.userRules);
      if (rules !== this.#rulesWritten) {
        this.#write(this.rulesPath, { version: VERSION, rules: this.state.userRules });
        this.#rulesWritten = rules;
      }
    } catch (error) {
      ok = false;
      this.#warn(`rules.json not saved (${reasonOf(error)})`);
    }
    return ok;
  }
}
