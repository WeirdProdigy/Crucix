import { createHash } from 'node:crypto';
import { LEVELS, levelRank } from './levels.mjs';
import { validateRule } from './rules.mjs';
import { MAX_DEDUP_KEY, MAX_LOG, cleanText } from './store.mjs';

// Pure helpers of the alert engine: errors, ordering, ids, logs and input checks. No state, no clock, no I/O.

export const MINUTE_MS = 60 * 1000;
const SNOOZE_MIN_MINUTES = 15;
export const SNOOZE_MAX_MINUTES = 7 * 24 * 60;
const MAX_REASON = 120;
export const MAX_COOLDOWN_MINUTES = 1440;
const UNSAFE_REASON = new RegExp('[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]');
const OVERRIDE_FIELDS = Object.freeze(['enabled', 'notify', 'severity', 'forSweeps', 'cooldownMinutes', 'params', 'scope']);
const PATH_UNSAFE = /[^A-Za-z0-9_.[\]-]/g;

/** An API-level error: `status` 400 or 404, `code` INVALID_RULE | INVALID_SNOOZE | NOT_FOUND | INVALID_STATE, `field` or null. */
export class AlertError extends Error {
  constructor(status, code, message, field = null) {
    super(message);
    this.name = 'AlertError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export const invalidRule = (field, message) => new AlertError(400, 'INVALID_RULE', message, field);

// ─── small helpers ───────────────────────────────────────────────────────────

export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isOpen = alert => alert.state !== 'resolved';
export const countOf = (dict, key) => Object.hasOwn(dict, key) ? dict[key] : 0;
export const copy = value => structuredClone(value);
export const integerIn = (value, min, max, fallback) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;
export const ruleKeyPrefix = ruleId => `${ruleId}|`;
export const ruleOfKey = key => { const end = key.indexOf('|'); return end < 0 ? '' : key.slice(0, end); };

// The keys of a counter table grouped by the rule id in front of them.
export function indexByRule(table) {
  const index = new Map();
  for (const key of Object.keys(table)) {
    const ruleId = ruleOfKey(key);
    if (!index.has(ruleId)) index.set(ruleId, []);
    index.get(ruleId).push(key);
  }
  return index;
}

// The value of a snapshot field, or the error its getter threw; a hostile snapshot must not end the evaluation early.
export function readField(snapshot, name) {
  try { return { value: snapshot[name] }; } catch (error) { return { error }; }
}

export const messageOf = error => cleanText(error instanceof Error ? error.message : String(error), 200) || 'unknown error';

export function alertId(dedupKey, firstSeenAt, episode) {
  return `alert-${createHash('sha256').update(`${dedupKey}|${firstSeenAt}|${episode}`).digest('hex').slice(0, 32)}`;
}

export function addLog(alert, at, action, note) {
  alert.log.push(note === undefined ? { at, action } : { at, action, note });
  if (alert.log.length > MAX_LOG) alert.log.splice(0, alert.log.length - MAX_LOG);
}

// Most severe first, then the most recently seen, then the newest, then by id so the order is stable.
export const bySeverity = (a, b) => levelRank(b.severity) - levelRank(a.severity)
  || b.lastSeenAt - a.lastSeenAt || b.firstSeenAt - a.firstSeenAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const stateRank = alert => alert.state === 'firing' ? 0 : alert.state === 'resolved' ? 2 : 1;
export const byListOrder = (a, b) => stateRank(a) - stateRank(b)
  || (a.state === 'resolved' && b.state === 'resolved' ? b.resolvedAt - a.resolvedAt : 0)
  || bySeverity(a, b);

export const compactAlert = alert => ({
  id: alert.id, ruleId: alert.ruleId, ruleName: alert.ruleName, severity: alert.severity, state: alert.state,
  title: alert.title, firstSeenAt: alert.firstSeenAt, lastSeenAt: alert.lastSeenAt, count: alert.count, silent: alert.silent,
});

// A hit the engine can store: evaluators only produce these, but the engine does not depend on it.
export const usableHit = (hit, rule) => isObject(hit) && typeof hit.dedupKey === 'string' && hit.dedupKey.length <= MAX_DEDUP_KEY
  && hit.dedupKey.startsWith(ruleKeyPrefix(rule.id)) && LEVELS.includes(hit.severity);

/** The cleaned snooze reason ('' for none) after checking minutes (15 min - 7 days) and reason; throws INVALID_SNOOZE. */
export function snoozeReason(minutes, reason) {
  if (!Number.isInteger(minutes) || minutes < SNOOZE_MIN_MINUTES || minutes > SNOOZE_MAX_MINUTES) {
    throw new AlertError(400, 'INVALID_SNOOZE', `minutes must be an integer from ${SNOOZE_MIN_MINUTES} to ${SNOOZE_MAX_MINUTES}`, 'minutes');
  }
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.trim().length > MAX_REASON || UNSAFE_REASON.test(reason))) {
    throw new AlertError(400, 'INVALID_SNOOZE', `reason must be a single line of at most ${MAX_REASON} characters`, 'reason');
  }
  return typeof reason === 'string' ? reason.trim().toWellFormed() : '';
}

/**
 * The override a PUT body sets on a built-in: only the override fields (`id`, `name` and `kind` may be sent along but
 * must not differ), validated as part of the merged rule and stored as the validated values. Throws INVALID_RULE.
 */
export function overrideOf(builtin, input) {
  if (!isObject(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalidRule('rule', 'must be an object');
  const changes = {};
  for (const key of Object.keys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    const field = key.slice(0, 40).replace(PATH_UNSAFE, '?');
    if (!('value' in descriptor)) throw invalidRule(field, 'must be plain data');
    if (key === 'id' || key === 'name' || key === 'kind') {
      if (descriptor.value !== builtin[key]) throw invalidRule(field, 'cannot be changed on a built-in rule');
    } else if (OVERRIDE_FIELDS.includes(key)) {
      changes[key] = descriptor.value;
    } else {
      throw invalidRule(field, 'is not a known field');
    }
  }
  const result = validateRule({ ...builtin, ...changes });
  if (!result.ok) throw invalidRule(result.error.field, result.error.message);
  // Store the validated, normalised values only.
  const override = {};
  for (const key of Object.keys(changes)) if (result.rule[key] !== undefined) override[key] = result.rule[key];
  return override;
}

