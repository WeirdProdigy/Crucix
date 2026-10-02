// Copernicus Emergency Management Service (CEMS) on-demand rapid mapping: the activations listed on the service's public
// dashboard, https://mapping.emergency.copernicus.eu/ . The JSON endpoint is the one the site itself uses and is not documented.
// The older rapidmapping.emergency.copernicus.eu host answers the same endpoint but redirects every page to the host used here.
// Facts about the list that shape this adapter (checked on 2026-10-02 over all 265 activations): every listed activation was closed,
// so entries lag the disaster by days; times are UTC but carry no zone designator; the event time can be later than the activation
// time (anticipated events), so the activation time is the observation; the list carries no severity or priority field.
// Every regex below runs on text that was cut to a fixed length first: unbounded input never reaches one.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';

const SOURCE = 'Copernicus-EMS';
const ENDPOINT = 'https://mapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/';
const ACTIVATION_PAGE = 'https://mapping.emergency.copernicus.eu/activations/';
const REQUEST_LIMIT = 30;
const MAX_ROWS = 20;
const MAX_EXAMINED = 200;
const FUTURE_SKEW_MS = 300000;
const CACHE_MS = 3600000;
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
const EXTRAS = {
  attribution: 'Copernicus Emergency Management Service (© European Union), https://mapping.emergency.copernicus.eu',
  rights: 'Copernicus Emergency Management Service information is available with free, full and open access under Regulation (EU) 2021/696, without any express or implied warranty. Whoever communicates or distributes it must name the source (Copernicus EMS On Demand Mapping terms and conditions, last modified 07/06/2023). Only public activation details are used here, not the mapping products; the activation list is an undocumented dashboard service.',
  license: 'Free, full and open access under Regulation (EU) 2021/696 (Copernicus EMS terms and conditions); cite the source',
  licenseUrl: 'https://mapping.emergency.copernicus.eu/terms-and-conditions/',
  summary: 'Copernicus EMS rapid mapping activations of the last 30 days, newest first. An activation means a disaster was significant enough for a mapping request; the service publishes no severity rating, so every row is rated moderate. The public list showed closed activations only when checked, so entries can lag the disaster by days.',
};

// Provider text becomes inert plain text: markup, control, bidi and zero-width characters go, whitespace collapses.
// The input is cut to 400 characters BEFORE any regex runs and the tag pattern cannot rescan: linear on hostile text.
const clean = (value, cap) => typeof value === 'string'
  ? value.slice(0, 400).replace(/<[^<>]*>/g, '').replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').replace(/[<>]/g, '').trim().slice(0, cap).trim() : '';
// A full timestamp only; the provider writes UTC without a zone designator.
const when = value => typeof value === 'string' && value.length <= 40 && value.includes('T') ? providerTime(value, { assumeUTC: true }) : null;
const count = value => Number.isInteger(value) && value >= 0 && value <= 10000 ? value : null;
const text = isoTime => `${isoTime.slice(0, 10)} ${isoTime.slice(11, 16)} UTC`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Transport errors become a short reason; a URL or an upstream message never reaches the result.
function failure(error) {
  const reason = typeof error === 'string' ? error.slice(0, 300).replace(/https?:\/\/\S*/gi, '').trim().slice(0, 120) : '';
  return `Copernicus EMS request failed${reason ? `: ${reason}` : ''}`;
}

// "POINT (longitude latitude)", the only form the list uses; anything else is no location.
const POINT = /^POINT\s*\(\s*(-?\d{1,3}(?:\.\d{1,17})?)\s+(-?\d{1,3}(?:\.\d{1,17})?)\s*\)$/;
function centroid(value) {
  const match = typeof value === 'string' && value.length <= 100 ? POINT.exec(value.trim()) : null;
  if (!match) return null;
  const lon = Number(match[1]), lat = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

function countriesOf(value) {
  if (!Array.isArray(value)) return '';
  const names = [...new Set(value.slice(0, 20).map(name => clean(name, 60)).filter(Boolean))].slice(0, 8);
  return names.join(', ').slice(0, 120).trim();
}

function activation(row, now) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const code = typeof row.code === 'string' && row.code.length <= 12 && /^EMSR\d{1,6}$/.test(row.code) ? row.code : null;
  const observedAt = when(row.activationTime);
  if (!code || !observedAt || Date.parse(observedAt) - now > FUTURE_SKEW_MS) return null;
  const updated = when(row.lastUpdate);
  const publishedAt = updated && Date.parse(updated) - now <= FUTURE_SKEW_MS ? updated : null;
  const eventAt = when(row.eventTime);
  const place = centroid(row.centroid);
  const category = clean(row.category, 60), countries = countriesOf(row.countries);
  const areas = count(row.n_aois), products = count(row.n_products);
  const title = clean(row.name, 140) || `Copernicus EMS activation ${code}`;
  const mapping = [areas === null ? '' : plural(areas, 'area of interest', 'areas of interest'), products === null ? '' : plural(products, 'product', 'products')].filter(Boolean).join(' and ');
  const summary = [`Copernicus EMS rapid mapping activation ${code}${category ? ` (${category})` : ''}${countries ? ` for ${countries}` : ''}.`,
    `Activated ${text(observedAt)}${eventAt ? `; event time ${text(eventAt)} as given by the provider` : ''}.`,
    mapping ? `Mapping: ${mapping}.` : '', row.closed === true ? 'Activation closed.' : row.closed === false ? 'Activation still open.' : '',
    'The service publishes no severity rating; moderate is the default for an activation.'].filter(Boolean).join(' ');
  return { kind: 'disaster', providerId: code, title, summary, source: SOURCE, url: `${ACTIVATION_PAGE}${code}`, observedAt, ...(publishedAt ? { publishedAt } : {}),
    ...(place ? { ...place, locationMethod: 'provider', locationPrecision: 'approximate' } : {}), ...(countries ? { region: countries, countries } : {}),
    severity: 'moderate', ...(category ? { category } : {}) };
}

export function parseCopernicus(payload, { now = Date.now() } = {}) {
  if (payload?.error) return unavailableResult(SOURCE, failure(payload.error), EXTRAS, now);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) return unavailableResult(SOURCE, 'Copernicus EMS returned an unexpected response', EXTRAS, now);
  const examined = payload.results.slice(0, MAX_EXAMINED);
  const rows = examined.map(row => activation(row, now)).filter(Boolean);
  // The newest valid activation time, old or not: an old list is expired rather than undated.
  const newest = rows.map(row => row.observedAt).sort().at(-1) ?? null;
  const seen = new Set();
  // Rank and cap before freshResult, which only looks at the first 100 rows.
  const ranked = rows.filter(row => freshness(row.observedAt, POLICIES[SOURCE].observationMaxAgeMs, now).fresh)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || Number(b.providerId.slice(4)) - Number(a.providerId.slice(4)))
    .filter(row => !seen.has(row.providerId) && seen.add(row.providerId));
  return freshResult(SOURCE, newest, ranked.slice(0, MAX_ROWS), { ...EXTRAS, examinedRecords: examined.length,
    truncatedRecords: Math.max(0, payload.results.length - examined.length) + Math.max(0, ranked.length - MAX_ROWS) }, now);
}

// One entry: the single request has one answer. Only ok answers are kept, the age is checked again at every read.
let cached = null;

export async function briefing(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  const request = { ...REQUEST, timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)) };
  const hit = useCache && cached?.fetcher === fetcher && now >= cached.collectedAt && now - cached.collectedAt < CACHE_MS;
  let entry = cached;
  if (!hit) {
    let payload;
    try { payload = await fetcher(`${ENDPOINT}?limit=${REQUEST_LIMIT}`, request); } catch { payload = { error: 'network error' }; }
    entry = { payload, fetcher, collectedAt: now };
  }
  const result = parseCopernicus(entry.payload, { now });
  if (!hit && useCache && result.status === 'ok') cached = entry;
  // A cached answer carries the time it was collected, so its age shows.
  return { ...result, timestamp: new Date(entry.collectedAt).toISOString() };
}
