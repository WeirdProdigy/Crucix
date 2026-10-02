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
// The latest published day (up to ~10 days of provider lag), its 7-day window and the 28-day baseline before the window.
// At most 12 names x 47 days = 564 rows: under the layer's 1000-record page and MAX_EXAMINED.
const HISTORY_DAYS = 46;
const WINDOW_DAYS = 7;
const MIN_WINDOW_DAYS = 5;
const BASELINE_DAYS = 28;
const MIN_BASELINE_DAYS = 14;
const MIN_RATED_BASELINE = 3; // below 3 transits a day the percentages are noise, so no severity is rated
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
const RANK = { high: 0, moderate: 1, info: 2 };
const SUMMARY = 'Daily ship transit counts at the watched maritime chokepoints for the latest day the IMF has published (weekly refresh, a delay of several days), rated by the 7-day mean against the previous 28-day median. Counts are AIS-visible transits only: dark or AIS-off ships are not counted. These are estimates, not live positions.';
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
// Every regex in this file runs on text that was cut to a fixed length first: unbounded input never reaches one.
function failure(error) {
  if (error && typeof error === 'object') return Number.isInteger(error.code) ? `ArcGIS error ${error.code}` : 'ArcGIS error';
  const reason = typeof error === 'string' ? error.slice(0, 300).replace(/https?:\/\/\S*/gi, '').trim().slice(0, 120) : '';
  return `IMF PortWatch request failed${reason ? `: ${reason}` : ''}`;
}

// Configured names go into an ArcGIS where clause: plain letters, spaces, dots and hyphens only.
// A custom name gets a derived slug that never collides with the eight fixed ones or an earlier custom slug (suffix _2, _3, ...).
function watched(list) {
  const names = list === undefined ? DEFAULTS.map(([name]) => name) : Array.isArray(list) ? list : [];
  const seen = new Set(), used = new Set(DEFAULTS.map(([, slug]) => slug));
  return names.slice(0, 50).flatMap(raw => {
    const name = typeof raw === 'string' && raw.length <= 80 ? raw.trim() : '';
    const key = name.toLowerCase();
    if (!NAME.test(name) || seen.has(key)) return [];
    seen.add(key);
    let slug = SLUGS.get(key);
    if (!slug) {
      const base = key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      slug = base;
      for (let n = 2; used.has(slug); n++) slug = `${base}_${n}`;
      used.add(slug);
    }
    return [{ name, key, slug }];
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
    const spec = specs.get(typeof attributes.portname === 'string' && attributes.portname.length <= 80 ? attributes.portname.trim().toLowerCase() : '');
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

// Rated on the 7-day mean ending at the latest day against the median of the 28 days before that window: a single day
// is far too noisy at single-digit counts. `transitCalls` stays the latest day's own count.
function observation(group, places) {
  const latest = [...group.days.keys()].sort().at(-1), latestMs = Date.parse(latest), count = group.days.get(latest);
  const between = (oldest, newest) => [...group.days].filter(([day]) => Date.parse(day) >= latestMs - oldest * DAY && Date.parse(day) <= latestMs - newest * DAY).map(([, value]) => value);
  const recent = between(WINDOW_DAYS - 1, 0), before = between(WINDOW_DAYS - 1 + BASELINE_DAYS, WINDOW_DAYS);
  const mean7d = recent.length >= MIN_WINDOW_DAYS ? round1(recent.reduce((sum, value) => sum + value, 0) / recent.length) : null;
  const baseline = before.length >= MIN_BASELINE_DAYS ? round1(median(before)) : null;
  const change = mean7d !== null && baseline > 0 ? round1((mean7d - baseline) / baseline * 100) : null;
  const severity = change === null || baseline < MIN_RATED_BASELINE ? 'info' : change <= -50 ? 'high' : change <= -25 ? 'moderate' : 'info';
  const dayLabel = latest.slice(0, 10), plural = count === 1 ? '' : 's';
  const comparison = mean7d === null ? 'fewer than 5 of the last 7 days are available, so no change is computed'
    : baseline === null ? 'fewer than 14 baseline days are available, so no change is computed'
    : `the 7-day mean is ${mean7d} against a median of ${baseline} over the previous 28 days${change === null ? '' : ` (${change > 0 ? '+' : ''}${change}%)`}${baseline < MIN_RATED_BASELINE ? '; the baseline is below 3 transits a day, too low to rate a change' : ''}`;
  const place = Object.hasOwn(places, group.id) ? places[group.id] : null;
  return { kind: 'maritime', providerId: `${group.spec.slug}:${dayLabel}`, chokepoint: group.spec.slug,
    title: `${group.name}: ${count} ship transit${plural} on ${dayLabel}`,
    summary: `${group.name} logged ${count} AIS-visible ship transit${plural} on ${dayLabel} (UTC); ${comparison}. Counts include only ships whose AIS signal is received: dark or AIS-off ships are not counted. IMF PortWatch estimate, refreshed weekly.`,
    // The date makes the deep link specific to the day, so history keeps one record per chokepoint and day.
    source: SOURCE, url: `${PAGE_URL}${group.id}?date=${dayLabel}`, observedAt: latest, severity,
    transitCalls: count, ...(mean7d === null ? {} : { mean7d }), ...(baseline === null ? {} : { baseline28d: baseline }), ...(change === null ? {} : { changePct: change }),
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
  // The alert registry reads these: the 7-day mean, not the noisy single day; absent when the window is too thin.
  out.metrics = Object.fromEntries(out.observations.filter(row => row.mean7d !== undefined).map(row => [`${row.chokepoint}_transits`, row.mean7d]));
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
