// IMF PortWatch: daily ship transit counts at the world's main maritime chokepoints, estimated from satellite AIS
// signals. https://portwatch.imf.org/ - the ArcGIS layers are refreshed weekly and run 2-9 days behind, so an
// observation is the latest day the IMF has published, never today's traffic. Counts cover ships whose AIS signal
// is received; dark or AIS-off ships are not counted.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshResult, unavailableResult } from '../utils/freshness.mjs';

const SOURCE = 'IMF-PortWatch';
const SERVICES = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services';
const DAILY_URL = `${SERVICES}/Daily_Chokepoints_Data/FeatureServer/0/query`;
const PLACES_URL = `${SERVICES}/PortWatch_chokepoints_database/FeatureServer/0/query`;
const PAGE_URL = 'https://portwatch.imf.org/pages/';
const DAY = 86400000;
const HISTORY_DAYS = 40; // the latest published day (up to 10 days old) plus its 28-day baseline
const BASELINE_DAYS = 28;
const MIN_BASELINE_DAYS = 14;
const MAX_CHOKEPOINTS = 12;
const MAX_EXAMINED = 2000;
const FUTURE_SKEW_MS = 300000;
const CACHE_MS = 6 * 3600000;
const CACHE_ENTRIES = 16;
const cache = new Map();
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
// The default chokepoints, spelled as the layer's portname values, with the fixed slugs of their ids and metrics.
const DEFAULTS = [['Strait of Hormuz', 'hormuz'], ['Bab el-Mandeb Strait', 'bab_el_mandeb'], ['Suez Canal', 'suez'], ['Malacca Strait', 'malacca'],
  ['Bosporus Strait', 'bosporus'], ['Panama Canal', 'panama'], ['Gibraltar Strait', 'gibraltar'], ['Dover Strait', 'dover']];
const SLUGS = new Map(DEFAULTS.map(([name, slug]) => [name.toLowerCase(), slug]));
const NAME = /^[A-Za-z][A-Za-z .-]{1,59}$/;
const METRIC_SLUGS = new Set(['hormuz', 'bab_el_mandeb', 'suez']);
const RANK = { high: 0, moderate: 1, info: 2 };
const SUMMARY = 'Daily ship transit counts at the watched maritime chokepoints for the latest day the IMF has published (weekly refresh, a delay of several days). Counts are AIS-visible transits only: dark or AIS-off ships are not counted. These are estimates, not live positions.';
const EXTRAS = {
  attribution: 'Sources: UN Global Platform; IMF PortWatch (portwatch.imf.org)',
  rights: 'IMF terms of use: personal, noncommercial usage only, without any right to resell or redistribute. Transit counts are AIS-based estimates provided "as is", without warranty.',
  license: 'IMF Copyright and Usage terms: personal, non-commercial use; cite the source',
  licenseUrl: 'https://www.imf.org/external/terms.htm',
  summary: SUMMARY,
};

const round1 = value => (Math.round(value * 10) || 0) / 10;
function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
// Transport errors become a short reason; a URL or an upstream message never reaches the result.
function failure(error) {
  if (error && typeof error === 'object') return Number.isInteger(error.code) ? `ArcGIS error ${error.code}` : 'ArcGIS error';
  const reason = typeof error === 'string' ? error.replace(/https?:\/\/\S*/gi, '').trim().slice(0, 120) : '';
  return `IMF PortWatch request failed${reason ? `: ${reason}` : ''}`;
}

// Configured names go into an ArcGIS where clause: plain letters, spaces, dots and hyphens only.
function watched(list) {
  const names = list === undefined ? DEFAULTS.map(([name]) => name) : Array.isArray(list) ? list : [];
  const seen = new Set();
  return names.slice(0, 50).flatMap(raw => {
    const name = typeof raw === 'string' ? raw.trim() : '';
    const key = name.toLowerCase();
    if (!NAME.test(name) || seen.has(key)) return [];
    seen.add(key);
    return [{ name, key, slug: SLUGS.get(key) || key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') }];
  }).slice(0, MAX_CHOKEPOINTS);
}

const portId = value => typeof value === 'string' && /^chokepoint\d{1,3}$/.test(value) ? value : null;
const validPoint = (lat, lon) => typeof lat === 'number' && typeof lon === 'number' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

// Chokepoint coordinates from the provider's own chokepoint layer, keyed by portid.
export function parsePortwatchPlaces(payload) {
  const places = {};
  for (const feature of Array.isArray(payload?.features) ? payload.features.slice(0, 200) : []) {
    const attributes = feature?.attributes, id = portId(attributes?.portid);
    if (id && validPoint(attributes.lat, attributes.lon)) places[id] = { lat: attributes.lat, lon: attributes.lon };
  }
  return places;
}

// Daily counts per watched chokepoint: valid, non-future days only; the first record of a day wins.
function collect(features, specs, now) {
  const groups = new Map();
  for (const feature of features.slice(0, MAX_EXAMINED)) {
    const attributes = feature?.attributes;
    if (!attributes || typeof attributes !== 'object') continue;
    const spec = specs.get(typeof attributes.portname === 'string' ? attributes.portname.trim().toLowerCase() : '');
    const id = portId(attributes.portid);
    const day = typeof attributes.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(attributes.date) ? providerTime(attributes.date) : null;
    const count = attributes.n_total;
    if (!spec || !id || !day || typeof count !== 'number' || !Number.isFinite(count) || count < 0 || count > 1e6) continue;
    if (Date.parse(day) - now > FUTURE_SKEW_MS) continue;
    // The provider's spelling is shown only when it is plain ASCII (case folding can match odd letters).
    if (!groups.has(spec.key)) groups.set(spec.key, { spec, name: NAME.test(attributes.portname.trim()) ? attributes.portname.trim() : spec.name, id, days: new Map() });
    const group = groups.get(spec.key);
    if (!group.days.has(day)) group.days.set(day, count);
  }
  return groups;
}

function observation(group, places) {
  const latest = [...group.days.keys()].sort().at(-1), count = group.days.get(latest), latestMs = Date.parse(latest);
  const baselineValues = [...group.days].filter(([day]) => Date.parse(day) >= latestMs - BASELINE_DAYS * DAY && Date.parse(day) < latestMs).map(([, value]) => value);
  const baseline = baselineValues.length >= MIN_BASELINE_DAYS ? round1(median(baselineValues)) : null;
  const change = baseline > 0 ? round1((count - baseline) / baseline * 100) : null;
  const severity = change !== null && change <= -50 ? 'high' : change !== null && change <= -25 ? 'moderate' : 'info';
  const dayLabel = latest.slice(0, 10);
  const comparison = baseline === null ? 'fewer than 14 baseline days are available, so no change is computed'
    : `the median of the previous 28 days is ${baseline}${change === null ? '' : ` (${change > 0 ? '+' : ''}${change}%)`}`;
  const place = Object.hasOwn(places, group.id) ? places[group.id] : null;
  return { kind: 'maritime', providerId: `${group.spec.slug}:${dayLabel}`, chokepoint: group.spec.slug,
    title: `${group.name}: ${count} ship transit${count === 1 ? '' : 's'} on ${dayLabel}`,
    summary: `${group.name} logged ${count} AIS-visible ship transit${count === 1 ? '' : 's'} on ${dayLabel} (UTC); ${comparison}. Counts include only ships whose AIS signal is received: dark or AIS-off ships are not counted. IMF PortWatch estimate, refreshed weekly.`,
    source: SOURCE, url: `${PAGE_URL}${group.id}`, observedAt: latest, severity,
    transitCalls: count, ...(baseline === null ? {} : { baseline28d: baseline }), ...(change === null ? {} : { changePct: change }),
    ...(place ? { lat: place.lat, lon: place.lon, locationMethod: 'provider', locationPrecision: 'approximate' } : {}) };
}

export function parsePortwatch(payload, { now = Date.now(), chokepoints, locations } = {}) {
  const names = watched(chokepoints);
  if (!names.length) return unavailableResult(SOURCE, 'No valid chokepoints configured', EXTRAS, now);
  if (payload?.error) return unavailableResult(SOURCE, failure(payload.error), EXTRAS, now);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.features)) return unavailableResult(SOURCE, 'IMF PortWatch returned an unexpected response', EXTRAS, now);
  const groups = collect(payload.features, new Map(names.map(spec => [spec.key, spec])), now);
  const places = locations && typeof locations === 'object' ? locations : {};
  // Most severe first, then the configured order; at most one row per chokepoint, so the cap never bites.
  const rows = names.flatMap(spec => groups.has(spec.key) ? [observation(groups.get(spec.key), places)] : []).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const out = freshResult(SOURCE, rows.map(row => row.observedAt).sort().at(-1) ?? null, rows, EXTRAS, now);
  out.metrics = Object.fromEntries(out.observations.filter(row => METRIC_SLUGS.has(row.chokepoint)).map(row => [`${row.chokepoint}_transits`, row.transitCalls]));
  return out;
}

async function load(key, { fetcher, useCache, now, url, request, usable }) {
  const previous = cache.get(key);
  if (useCache && previous?.fetcher === fetcher && now >= previous.collectedAt && now - previous.collectedAt < CACHE_MS) return previous.payload;
  let payload;
  try { payload = await fetcher(url, request); } catch { payload = { error: 'network error' }; }
  if (useCache && usable(payload)) {
    cache.delete(key);
    if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { payload, fetcher, collectedAt: now });
  }
  return payload;
}

export async function briefing(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const names = watched(options.chokepoints);
  if (!names.length) return unavailableResult(SOURCE, 'No valid chokepoints configured', EXTRAS, now);
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  const request = { ...REQUEST, timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)) };
  const listed = names.map(spec => spec.name);
  const where = `portname IN (${listed.map(name => `'${name}'`).join(',')})`;
  const since = new Date(now - HISTORY_DAYS * DAY).toISOString().slice(0, 10);
  const query = params => `?${new URLSearchParams({ returnGeometry: 'false', f: 'json', ...params })}`;
  const key = names.map(spec => spec.key).join('|');
  const common = { fetcher, useCache, now, request };
  const [daily, places] = await Promise.all([
    load(`daily:${key}`, { ...common, url: DAILY_URL + query({ where: `${where} AND date >= DATE '${since}'`, outFields: 'date,portid,portname,n_total', orderByFields: 'date DESC' }),
      usable: payload => parsePortwatch(payload, { now, chokepoints: listed }).status === 'ok' }),
    load(`places:${key}`, { ...common, url: PLACES_URL + query({ where, outFields: 'portid,portname,lat,lon' }),
      usable: payload => Object.keys(parsePortwatchPlaces(payload)).length > 0 }),
  ]);
  return parsePortwatch(daily, { now, chokepoints: listed, locations: parsePortwatchPlaces(places) });
}
