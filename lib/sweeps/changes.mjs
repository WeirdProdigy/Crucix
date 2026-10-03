// What a synthesized sweep changed against the previous one (the dashboard's "changes" panel and the /api/changes window).
// buildChanges and mergeChanges are pure: they never mutate or keep their inputs, never throw on a malformed snapshot, and
// every string they return is a plain, well-formed, length-bounded string for the client to escape.
import { LEVELS, eventLevel, levelRank } from '../alerts/levels.mjs';
import { DOMAIN_IDS, domainOfEvent, domainOfSource } from '../domains.mjs';
import { SOURCE_STATES, sourceName, sourceStateOfRow } from './archive.mjs';

export const CHANGE_CAPS = Object.freeze({ events: 40, sources: 30, signals: 20 });

const EVENT_ID = /^event-[0-9a-f]{32}$/;
const SIGNAL_TYPES = ['new', 'escalated', 'deescalated'];
const MAX = { title: 200, source: 120, kind: 40, key: 80, direction: 20 };
// The delta engine's key prefix for a new urgent Telegram post (a signal of type 'new').
const URGENT_POST = 'tg_urgent:';
// The most entries one merge looks at: the upper end of SWEEP_ARCHIVE_COUNT.
const MAX_MERGE = 672;
// Sorts below every real time (the earliest representable Date is about -8.64e15).
const NO_TIME = Number.MIN_SAFE_INTEGER;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;

// At most `max` UTF-16 units, never ending in half a surrogate pair, never holding a lone surrogate; '' for a non-string.
function cut(value, max) {
  if (typeof value !== 'string') return '';
  let text = value;
  if (text.length > max) {
    text = text.slice(0, max);
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
  }
  return text.toWellFormed();
}

// The ISO form of a parseable time string, else null.
function timeOf(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

const msOf = iso => (iso === null ? NO_TIME : Date.parse(iso));
const bySeverityThenNewer = (a, b) => levelRank(b.severity) - levelRank(a.severity) || msOf(b.observedAt) - msOf(a.observedAt);
const bySeverity = (a, b) => levelRank(b.severity) - levelRank(a.severity);
const domainRank = domain => (domain === null ? DOMAIN_IDS.length : DOMAIN_IDS.indexOf(domain));
const bySourceOrder = (a, b) => domainRank(a.domain) - domainRank(b.domain) || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0);

// {<domain>: n} in domain order, without the domains that have nothing; a null domain (an item outside the table) is never read.
function domainObject(counts) {
  const result = {};
  for (const id of DOMAIN_IDS) if (counts.get(id) > 0) result[id] = counts.get(id);
  return result;
}

function tally(...lists) {
  const counts = new Map();
  for (const list of lists) for (const { domain } of list) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  return domainObject(counts);
}

// The level of a signal: a word of the shared four-level vocabulary or null, never any other string. A level word is kept; an
// event-scale word (the delta engine emits critical/high/moderate) is mapped by eventLevel; anything else is null. The engine puts no
// severity on a new urgent Telegram post although it counts each one as a critical change, and events.mjs rates an urgent post
// 'high', so that is the level such a signal gets here; otherwise it would be the first row dropped under the cap.
function signalSeverity(type, key, value) {
  const level = LEVELS.includes(value) ? value : eventLevel({ severity: value });
  return level ?? (type === 'new' && key.startsWith(URGENT_POST) ? 'high' : null);
}

const baselineChanges = (at, since = null) => ({ since, at, baseline: true, events: { new: [], newTotal: 0, expiredTotal: 0 }, sources: [], signals: [], domains: {} });

// ─── buildChanges ────────────────────────────────────────────────────────────

// {<id>: event} of the usable events of a snapshot (the first one of an id wins), or null when it has no events array.
function eventsOf(snapshot) {
  if (!isObject(snapshot) || !Array.isArray(snapshot.events)) return null;
  const events = new Map();
  for (const event of snapshot.events) {
    if (isObject(event) && typeof event.id === 'string' && EVENT_ID.test(event.id) && !events.has(event.id)) events.set(event.id, event);
  }
  return events;
}

function eventItem(event) {
  const nested = isObject(event.source) ? event.source.name : undefined;
  return {
    id: event.id,
    title: cut(event.title, MAX.title),
    kind: cut(event.kind, MAX.kind),
    source: cut(typeof nested === 'string' ? nested : event.sourceName, MAX.source),
    domain: domainOfEvent(event),
    severity: eventLevel(event),
    observedAt: timeOf(event.observedAt),
  };
}

// {<source>: state} from the health[] rows; the first row of a name wins.
function statesOf(snapshot) {
  const states = new Map();
  for (const row of isObject(snapshot) && Array.isArray(snapshot.health) ? snapshot.health : []) {
    const name = isObject(row) ? sourceName(row.n) : null;
    if (name !== null && !states.has(name)) states.set(name, sourceStateOfRow(row));
  }
  return states;
}

function transitionsOf(previous, current) {
  const before = statesOf(previous);
  const transitions = [];
  for (const [source, to] of statesOf(current)) {
    const from = before.get(source);
    if (from !== undefined && from !== to) transitions.push({ source, domain: domainOfSource(source), from, to });
  }
  return transitions.sort(bySourceOrder);
}

function signalsOf(snapshot) {
  const signals = isObject(snapshot.delta) && isObject(snapshot.delta.signals) ? snapshot.delta.signals : {};
  const items = [];
  for (const type of SIGNAL_TYPES) {
    for (const entry of Array.isArray(signals[type]) ? signals[type] : []) {
      const key = isObject(entry) ? cut(entry.key, MAX.key) : '';
      if (key === '') continue;
      items.push({
        key,
        label: cut(entry.label, MAX.title) || cut(entry.reason, MAX.title) || key,
        direction: cut(entry.direction, MAX.direction) || null,
        severity: signalSeverity(type, key, entry.severity),
        type,
      });
    }
  }
  return items.sort(bySeverity);
}

/**
 * The changes of `current` against `previous`, two synthesized sweep snapshots. The result is spec section 4:
 * `{since, at, baseline, events: {new, newTotal, expiredTotal}, sources, signals, domains}`.
 * - Events are told apart by their `id`. `events.new` lists at most 40, most severe first (the shared critical/high/watch/info
 *   levels of lib/alerts/levels.mjs; an event without a usable severity has level null and comes last), then the more recently
 *   observed first, then in snapshot order; the totals are the real counts.
 * - `sources` lists the sources whose state (ok/stale/error/disabled) differs between the two sweeps, in domain order then by name,
 *   at most 30. A source that is new or gone is no transition.
 * - `signals` are the delta engine's new/escalated/deescalated entries, most severe first, at most 20. The severity is a level of the
 *   same four-level vocabulary (critical/high/watch/info) when the engine's word is an event-scale word (it only emits
 *   critical/high/moderate), else null; a new urgent Telegram post (`tg_urgent:*`), which carries none, is rated 'high'.
 * - `domains` counts every new event and every transition per domain (not just the listed ones); items without a domain count nowhere.
 * - Without a comparable `previous` (null, not an object, or no `events` array), or `current`, the result is a baseline: the lists are
 *   empty, so the first sweep after a restart without an archive does not report everything as new.
 * `at` is the current snapshot's time; the clock `options.now` is only read when that is missing or unparsable.
 */
export function buildChanges(previous, current, options) {
  const now = typeof options?.now === 'function' ? options.now : Date.now;
  const at = (isObject(current) ? timeOf(current.meta?.timestamp) : null) ?? new Date(now()).toISOString();
  const before = eventsOf(previous);
  const after = eventsOf(current);
  if (before === null || after === null) return baselineChanges(at);
  const added = [...after.values()].filter(event => !before.has(event.id)).map(eventItem);
  let expiredTotal = 0;
  for (const id of before.keys()) if (!after.has(id)) expiredTotal++;
  const transitions = transitionsOf(previous, current);
  return {
    since: timeOf(previous.meta?.timestamp),
    at,
    baseline: false,
    events: { new: added.sort(bySeverityThenNewer).slice(0, CHANGE_CAPS.events), newTotal: added.length, expiredTotal },
    sources: transitions.slice(0, CHANGE_CAPS.sources),
    signals: signalsOf(current).slice(0, CHANGE_CAPS.signals),
    domains: tally(added, transitions),
  };
}

// ─── mergeChanges ────────────────────────────────────────────────────────────

// The domain of every item is derived again from its source name, so a stored domain is never trusted.
function mergedEvent(item) {
  if (!isObject(item) || typeof item.id !== 'string' || !EVENT_ID.test(item.id)) return null;
  const source = cut(item.source, MAX.source);
  return {
    id: item.id,
    title: cut(item.title, MAX.title),
    kind: cut(item.kind, MAX.kind),
    source,
    domain: domainOfSource(source),
    severity: LEVELS.includes(item.severity) ? item.severity : null,
    observedAt: timeOf(item.observedAt),
  };
}

function mergedTransition(item) {
  const source = isObject(item) ? sourceName(item.source) : null;
  if (source === null || !SOURCE_STATES.includes(item.from) || !SOURCE_STATES.includes(item.to) || item.from === item.to) return null;
  return { source, domain: domainOfSource(source), from: item.from, to: item.to };
}

function mergedSignal(item) {
  const key = isObject(item) ? cut(item.key, MAX.key) : '';
  if (key === '' || !SIGNAL_TYPES.includes(item.type)) return null;
  return { key, label: cut(item.label, MAX.title) || key, direction: cut(item.direction, MAX.direction) || null, severity: signalSeverity(item.type, key, item.severity), type: item.type };
}

// One changes object cleaned up, or null when it is not one. Lists are read only up to their caps.
function readChanges(entry) {
  if (!isObject(entry) || !isObject(entry.events) || !Array.isArray(entry.events.new)) return null;
  const read = (list, reader, cap) => {
    const items = [];
    if (Array.isArray(list)) for (const item of list.slice(0, cap)) { const clean = reader(item); if (clean !== null) items.push(clean); }
    return items;
  };
  const events = read(entry.events.new, mergedEvent, CHANGE_CAPS.events);
  const domains = new Map();
  if (isObject(entry.domains)) for (const id of DOMAIN_IDS) if (Object.hasOwn(entry.domains, id) && isCount(entry.domains[id])) domains.set(id, entry.domains[id]);
  return {
    since: timeOf(entry.since),
    at: timeOf(entry.at),
    baseline: entry.baseline === true,
    events,
    newTotal: Math.max(events.length, isCount(entry.events.newTotal) ? entry.events.newTotal : 0),
    expiredTotal: isCount(entry.events.expiredTotal) ? entry.events.expiredTotal : 0,
    sources: read(entry.sources, mergedTransition, CHANGE_CAPS.sources),
    signals: read(entry.signals, mergedSignal, CHANGE_CAPS.signals),
    domains,
  };
}

// One row per type and key, newest sighting first (an entry's own order is kept), then the stable level sort, then the cap.
function mergedSignals(entries) {
  const seen = new Set();
  const rows = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    for (const signal of entries[index].signals) {
      const id = `${signal.type}|${signal.key}`;
      if (!seen.has(id)) { seen.add(id); rows.push(signal); }
    }
  }
  return rows.sort(bySeverity).slice(0, CHANGE_CAPS.signals);
}

/**
 * The union of several `changes` objects, oldest first, for a time window. `options.limit` (a positive integer, default and maximum
 * 672) is how many of the newest entries are merged; objects that are not changes are skipped.
 * - Events are deduplicated by id keeping the earliest sighting, then ordered and capped like buildChanges.
 * - `newTotal` and `domains` are the per-sweep counts added up minus the repeat sightings that were dropped, so they stay real even
 *   when a sweep listed fewer events than it had (exact unless a repeat sighting fell outside a sweep's capped list: then they are
 *   upper bounds); `expiredTotal` is the sum of the sweeps' counts.
 * - `sources` keeps the chronological order of the transitions and, over the cap, the newest ones. `signals` are listed once per
 *   type and key (the newest sighting, so a metric that escalates in many sweeps is one row with its latest level), then ordered
 *   most severe first and, within a level, newest first, and capped: a late critical signal is not pushed out by an old repeated one.
 * - `since` is the first entry's `since` (its `at` when that is unknown), `at` the last entry's `at`. `baseline` is true only when every
 *   merged entry is a baseline, or there is none: then nothing is known to have changed.
 */
export function mergeChanges(list, options) {
  const limit = Number.isInteger(options?.limit) && options.limit > 0 ? Math.min(options.limit, MAX_MERGE) : MAX_MERGE;
  const entries = (Array.isArray(list) ? list.slice(-limit) : []).map(readChanges).filter(entry => entry !== null);
  if (entries.length === 0) return baselineChanges(null);
  const seen = new Set();
  const events = [];
  const domains = new Map();
  let newTotal = 0;
  let expiredTotal = 0;
  for (const entry of entries) {
    newTotal += entry.newTotal;
    expiredTotal += entry.expiredTotal;
    for (const [id, count] of entry.domains) domains.set(id, (domains.get(id) ?? 0) + count);
    for (const item of entry.events) {
      if (!seen.has(item.id)) { seen.add(item.id); events.push(item); continue; }
      newTotal--;
      if (item.domain !== null) domains.set(item.domain, (domains.get(item.domain) ?? 0) - 1);
    }
  }
  return {
    since: entries.map(entry => entry.since ?? entry.at).find(time => time !== null) ?? null,
    at: entries.map(entry => entry.at).reverse().find(time => time !== null) ?? null,
    baseline: entries.every(entry => entry.baseline),
    events: { new: events.sort(bySeverityThenNewer).slice(0, CHANGE_CAPS.events), newTotal, expiredTotal },
    sources: entries.flatMap(entry => entry.sources).slice(-CHANGE_CAPS.sources),
    signals: mergedSignals(entries),
    domains: domainObject(domains),
  };
}
