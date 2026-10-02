// OpenSanctions dataset index: when the big sanctions lists last changed and how many entries they hold.
// https://data.opensanctions.org/datasets/latest/index.json lists every dataset OpenSanctions processes (485 on 2026-10-02) with
// `last_change` (when the dataset content last changed, UTC without a zone designator, the same clock as the index's own `run_time`)
// and `thing_count` (the listed people, companies, vessels and other things; `entity_count` is about twice as large because it also
// counts relationship and helper records). The index
// is regenerated several times a day, so its `run_time` is the feed time; a list that has not changed for a week is still current.
// The index is about 2,097,763 bytes (checked 2026-10-02), a few hundred bytes over the 2 MiB request limit of the other sources, so this adapter
// asks for up to 3 MiB (50% headroom for new datasets). One request, never more.
// `last_change` is OpenSanctions' view of the list (their crawl of the original), not the moment the issuer published it.
// Every regex below runs on text that was cut to a fixed length first: unbounded input never reaches one.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';

const SOURCE = 'OpenSanctions-Index';
const ENDPOINT = 'https://data.opensanctions.org/datasets/latest/index.json';
const DATASET_PAGE = 'https://www.opensanctions.org/datasets/';
const MAX_BYTES = 3 * 1024 * 1024;
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: MAX_BYTES });
// OFAC SDN, EU Financial Sanctions Files, UN Security Council, UK FCDO, US BIS Denied Persons and the US Trade Consolidated
// Screening List (which also carries the BIS Entity List); spelled as the index's dataset names.
const DEFAULT_DATASETS = ['us_ofac_sdn', 'eu_fsf', 'un_sc_sanctions', 'gb_fcdo_sanctions', 'us_bis_denied', 'us_trade_csl'];
const NAME = /^[a-z][a-z0-9_]{1,59}$/;
const MAX_DATASETS = 12;
const MAX_ROWS = MAX_DATASETS;
const MAX_EXAMINED = 2000;
const MAX_TRACKED = 64;
const MODERATE_DELTA = 10;
const RANK = { moderate: 0, info: 1 };
const FUTURE_SKEW_MS = 300000;
const CACHE_MS = 3600000;
const CACHE_ENTRIES = 16;
const cache = new Map();
// What the previous sweep saw per dataset: { count, change, delta }. A plain number is a count seeded by the caller.
const lastSeen = new Map();
const EXTRAS = {
  attribution: 'Data: OpenSanctions (opensanctions.org); the lists themselves belong to their issuers',
  rights: 'OpenSanctions says (opensanctions.org, checked 2026-10-02): "The data is licensed under the terms of Creative Commons 4.0 Attribution NonCommercial" and "OpenSanctions is free for non-commercial users. Businesses must acquire a data license to use the dataset." Change times and counts are OpenSanctions\' processed view of the original lists, not the issuers\' own publication times.',
  license: 'CC BY-NC 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  summary: 'Sanctions lists (OFAC SDN, EU, UN Security Council, UK, US BIS Denied Persons, US Trade CSL) that changed in the last 14 days according to the OpenSanctions dataset index, newest change first. The entry-count change that came with a list change is measured between this server\'s own sweeps, so it is missing after a restart.',
};

// Provider text becomes inert plain text: markup, control, bidi and zero-width characters go, whitespace collapses.
// The input is cut to 400 characters BEFORE any regex runs and the tag pattern cannot rescan: linear on hostile text.
const clean = (value, cap) => typeof value === 'string'
  ? value.slice(0, 400).replace(/<[^<>]*>/g, '').replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').replace(/[<>]/g, '').trim().slice(0, cap).trim() : '';
// A full timestamp only; the index writes UTC without a zone designator.
const when = value => typeof value === 'string' && value.length <= 40 && value.includes('T') ? providerTime(value, { assumeUTC: true }) : null;
const stampOf = isoTime => `${isoTime.slice(0, 19).replace(/[-:]/g, '')}Z`;
const text = isoTime => `${isoTime.slice(0, 10)} ${isoTime.slice(11, 16)} UTC`;
// Transport errors become a short reason; a URL or an upstream message never reaches the result.
function failure(error) {
  const reason = typeof error === 'string' ? error.slice(0, 300).replace(/https?:\/\/\S*/gi, '').trim().slice(0, 120) : '';
  return `OpenSanctions request failed${reason ? `: ${reason}` : ''}`;
}

function watched(list) {
  const names = list === undefined ? DEFAULT_DATASETS : Array.isArray(list) ? list : [];
  return [...new Set(names.slice(0, 50).filter(name => typeof name === 'string' && name.length <= 60 && NAME.test(name)))].slice(0, MAX_DATASETS);
}

// The first entry of each wanted name inside the examined part of the index; null entries and odd names are skipped.
function pick(payload, wanted) {
  const found = new Map();
  for (const entry of payload.datasets.slice(0, MAX_EXAMINED)) {
    const name = typeof entry?.name === 'string' && entry.name.length <= 80 ? entry.name : '';
    if (wanted.has(name) && !found.has(name)) found.set(name, entry);
  }
  return found;
}

// The change since the previous sweep belongs to a list state (change time and count). Seeing the same state again keeps the
// same answer, so a second look at one payload (cache, retry, a sweep with no new change) never turns "+12" into "0".
function deltaOf(previous, name, count, change) {
  const stored = previous.get(name);
  const known = typeof stored === 'number' ? { count: stored } : stored;
  if (known && known.change === change && known.count === count) return known.delta;
  const delta = Number.isInteger(known?.count) ? count - known.count : undefined;
  previous.delete(name);
  if (previous.size >= MAX_TRACKED) previous.delete(previous.keys().next().value);
  previous.set(name, { count, change, delta });
  return delta;
}

function observation(entry, now, previous) {
  const name = entry.name;
  const change = when(entry.last_change);
  const count = Number.isInteger(entry.thing_count) && entry.thing_count >= 0 && entry.thing_count <= 1e8 ? entry.thing_count : null;
  // No readable change time or count (a renamed field, a changed format, a future change time) is unusable, not merely old.
  if (!change || count === null || Date.parse(change) - now > FUTURE_SKEW_MS) return { unusable: true };
  // The baseline moves for every watched list, also for those that did not change recently.
  const delta = deltaOf(previous, name, count, change);
  if (!freshness(change, POLICIES[SOURCE].observationMaxAgeMs, now).fresh) return { newest: change };
  const label = clean(entry.title, 120) || name;
  const stamp = stampOf(change);
  const trend = delta === undefined ? '' : delta === 0 ? '; the entry count did not change with it' : `; ${delta > 0 ? '+' : ''}${delta} ${Math.abs(delta) === 1 ? 'entry' : 'entries'} with this change`;
  return { newest: change, row: { kind: 'sanctions', providerId: `os:${name}:${stamp}`, title: `${label}: list updated`,
    summary: `${label} last changed on ${text(change)} according to OpenSanctions and now lists ${count} entries (people, companies, vessels and other entities)${trend}. The change time is OpenSanctions' view of the list, not the issuer's publication time.`,
    // The change time in the link keeps every change of a list a separate history record (history merges rows with the same kind and URL).
    source: SOURCE, url: `${DATASET_PAGE}${name}/?change=${stamp}`, observedAt: change,
    severity: delta !== undefined && delta >= MODERATE_DELTA ? 'moderate' : 'info', thingCount: count, ...(delta === undefined ? {} : { deltaSinceLast: delta }) } };
}

export function parseOpensanctionsIndex(payload, { now = Date.now(), datasets, previous } = {}) {
  const tracker = previous instanceof Map ? previous : lastSeen;
  const names = watched(datasets);
  if (!names.length) return unavailableResult(SOURCE, 'No valid datasets configured', EXTRAS, now);
  if (payload?.error) return unavailableResult(SOURCE, failure(payload.error), EXTRAS, now);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.datasets)) return unavailableResult(SOURCE, 'OpenSanctions returned an unexpected response', EXTRAS, now);
  const found = pick(payload, new Set(names));
  if (!found.size) return unavailableResult(SOURCE, 'The OpenSanctions index lists none of the watched datasets', EXTRAS, now);
  const all = names.filter(name => found.has(name)).map(name => observation(found.get(name), now, tracker));
  // Every watched dataset without a usable change time or count means the index changed shape: never a quiet feed.
  const unusable = all.filter(result => result.unusable).length;
  if (unusable === all.length) return unavailableResult(SOURCE, 'The OpenSanctions index has an unexpected dataset shape', EXTRAS, now);
  const results = all.filter(result => !result.unusable);
  // Moderate rows first, then the newest change; the id breaks a tie.
  const rows = results.flatMap(result => result.row ? [result.row] : [])
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0) || (a.providerId < b.providerId ? -1 : 1));
  // The index's own generation time is the feed time; without it the newest watched change stands in.
  const feed = when(payload.run_time) ?? results.map(result => result.newest).sort().at(-1) ?? null;
  const missing = names.length - found.size;
  const notes = [missing ? `${missing} watched dataset${missing === 1 ? ' is' : 's are'} not in the index.` : '',
    unusable ? `${unusable} watched dataset${unusable === 1 ? ' has' : 's have'} no usable change time or entry count and ${unusable === 1 ? 'is' : 'are'} left out.` : ''].filter(Boolean);
  const summary = [EXTRAS.summary, ...notes].join(' ');
  return freshResult(SOURCE, feed, rows.slice(0, MAX_ROWS), { ...EXTRAS, summary, examinedRecords: Math.min(payload.datasets.length, MAX_EXAMINED),
    truncatedRecords: Math.max(0, payload.datasets.length - MAX_EXAMINED) }, now);
}

// Only the watched datasets and the fields used are kept: the whole index is 2 MB.
const short = value => typeof value === 'string' ? value.slice(0, 400) : undefined;
const reduce = (payload, names) => ({ run_time: short(payload.run_time),
  datasets: [...pick(payload, new Set(names)).values()].map(({ name, title, thing_count, last_change }) => ({ name, title: short(title), thing_count, last_change: short(last_change) })) });

export async function briefing(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const names = watched(options.datasets);
  if (!names.length) return unavailableResult(SOURCE, 'No valid datasets configured', EXTRAS, now);
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  const request = { ...REQUEST, timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)) };
  const parse = payload => parseOpensanctionsIndex(payload, { now, datasets: names, previous: options.previous });
  const key = names.join('|');
  const hit = cache.get(key);
  if (useCache && hit?.fetcher === fetcher && now >= hit.collectedAt && now - hit.collectedAt < CACHE_MS) return parse(hit.payload);
  let payload;
  try { payload = await fetcher(ENDPOINT, request); } catch { payload = { error: 'network error' }; }
  const result = parse(payload);
  if (useCache && result.status === 'ok') {
    cache.delete(key);
    if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { payload: reduce(payload, names), fetcher, collectedAt: now });
  }
  return result;
}
