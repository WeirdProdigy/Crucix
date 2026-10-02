// EMSC-CSEM SeismicPortal FDSN event service: earthquakes of magnitude 4.5 or larger reported in the last 24 hours.
// https://www.seismicportal.eu/fdsn-wsevent.html - preliminary parameters that the provider revises afterwards.
// The service has no feed time. The newest event time stands in for it, so a gap of more than 12 hours without any
// M4.5+ event reads as an expired feed (in 48.7 days of real events, about 20 a day, the longest gap was 9.2 h; a 6 hour
// limit would have expired the feed about 0.8% of the time). An empty answer (HTTP 204, no body) therefore has no
// provider time at all and is a stale result, never an ok list of zero events.
// Every regex below runs on text that was cut to a fixed length first: unbounded input never reaches one.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';

const SOURCE = 'EMSC';
const ENDPOINT = 'https://www.seismicportal.eu/fdsnws/event/1/query';
const EVENT_PAGE = 'https://www.seismicportal.eu/eventdetails.html?unid=';
const WINDOW_MS = 24 * 3600000;
const MAX_ROWS = 100;
const REQUEST_LIMIT = MAX_ROWS + 1; // one more than we keep, so a cut made by the provider itself shows in truncatedRecords
const MAX_EXAMINED = 1000;
const FUTURE_SKEW_MS = 300000;
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
const EXTRAS = {
  attribution: 'Credit: EMSC-CSEM SeismicPortal, https://www.seismicportal.eu',
  rights: 'Datasets from the SeismicPortal FDSN service are provided under CC BY 4.0; the service and databases themselves are not covered by that licence, and commercial reproduction of them needs prior written permission from EMSC-CSEM. Information may be incomplete, delayed or contain errors.',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  summary: 'Earthquakes of magnitude 4.5 or larger reported by EMSC in the last 24 hours, ranked by magnitude. Parameters are preliminary and can be revised.',
};

// Provider text becomes inert plain text: markup, control, bidi and zero-width characters go, whitespace collapses.
// The input is cut to 400 characters BEFORE any regex runs and the tag pattern cannot rescan: linear on hostile text.
const clean = (value, cap) => typeof value === 'string'
  ? value.slice(0, 400).replace(/<[^<>]*>/g, '').replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').replace(/[<>]/g, '').trim().slice(0, cap).trim() : '';
const tag = value => typeof value === 'string' && value.length <= 40 && /^[A-Za-z0-9 ._-]{1,20}$/.test(value.trim()) ? value.trim() : '';
const validPoint = (lat, lon) => typeof lat === 'number' && typeof lon === 'number' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
// Transport errors become a short reason; a URL or an upstream message never reaches the result.
function failure(error) {
  const reason = typeof error === 'string' ? error.slice(0, 300).replace(/https?:\/\/\S*/gi, '').trim().slice(0, 120) : '';
  return `EMSC request failed${reason ? `: ${reason}` : ''}`;
}
const severityOf = magnitude => magnitude >= 7 ? 'critical' : magnitude >= 6 ? 'high' : magnitude >= 5 ? 'moderate' : 'low';

function quake(feature, now) {
  const p = feature?.properties;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const id = p.unid ?? feature.id;
  const providerId = typeof id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(id) ? id : null;
  const magnitude = typeof p.mag === 'number' && Number.isFinite(p.mag) && p.mag >= 0 && p.mag <= 10 ? Math.round(p.mag * 10) / 10 : null;
  const observedAt = providerTime(p.time);
  const [lon, lat] = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : [];
  const place = validPoint(lat, lon) ? { lat, lon } : validPoint(p.lat, p.lon) ? { lat: p.lat, lon: p.lon } : null;
  // Only earthquakes (known or suspected): explosions and other event types are not seismic hazards here.
  if (!providerId || magnitude === null || !observedAt || !place || !['ke', 'se'].includes(p.evtype)) return null;
  if (Date.parse(observedAt) - now > FUTURE_SKEW_MS) return null;
  const updated = providerTime(p.lastupdate);
  const publishedAt = updated && Date.parse(updated) - now <= FUTURE_SKEW_MS ? updated : null;
  const depthKm = typeof p.depth === 'number' && Number.isFinite(p.depth) && p.depth >= 0 && p.depth <= 1000 ? Math.round(p.depth * 10) / 10 : null;
  const region = clean(p.flynn_region, 120) || 'Unknown region';
  const type = tag(p.magtype), author = tag(p.auth);
  return { kind: 'earthquake', providerId, title: `M${magnitude.toFixed(1)} ${region}`,
    summary: `${p.evtype === 'se' ? 'Suspected earthquake' : 'Earthquake'} of magnitude ${magnitude.toFixed(1)}${type ? ` (${type})` : ''}${depthKm === null ? '' : `, depth ${depthKm} km`}, ${region}. ${author ? `Solution from ${author}. ` : ''}Preliminary EMSC parameters; they can be revised.`,
    source: SOURCE, url: `${EVENT_PAGE}${encodeURIComponent(providerId)}`, observedAt, ...(publishedAt ? { publishedAt } : {}),
    ...place, locationMethod: 'provider', locationPrecision: 'exact', region, severity: severityOf(magnitude),
    magnitude, ...(depthKm === null ? {} : { depthKm }) };
}

export function parseEmsc(payload, { now = Date.now() } = {}) {
  if (payload?.error) return unavailableResult(SOURCE, failure(payload.error), EXTRAS, now);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.features)) return unavailableResult(SOURCE, 'EMSC returned an unexpected response', EXTRAS, now);
  const examined = payload.features.slice(0, MAX_EXAMINED);
  const events = examined.map(feature => quake(feature, now)).filter(Boolean);
  // The newest valid event time, old or not: an old list is expired rather than undated.
  const newest = events.map(event => event.observedAt).sort().at(-1) ?? null;
  const seen = new Set();
  // Rank and cap before freshResult, which only looks at the first 100 rows.
  const ranked = events.filter(event => freshness(event.observedAt, POLICIES[SOURCE].observationMaxAgeMs, now).fresh)
    .sort((a, b) => b.magnitude - a.magnitude || b.observedAt.localeCompare(a.observedAt) || a.providerId.localeCompare(b.providerId))
    .filter(event => !seen.has(event.providerId) && seen.add(event.providerId));
  return freshResult(SOURCE, newest, ranked.slice(0, MAX_ROWS), { ...EXTRAS, examinedRecords: examined.length,
    truncatedRecords: Math.max(0, payload.features.length - examined.length) + Math.max(0, ranked.length - MAX_ROWS) }, now);
}

export async function briefing(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const fetcher = options.fetcher || safeFetch;
  const request = { ...REQUEST, timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)) };
  // Largest first, so the 100-event limit can only cut the smallest quakes of a very busy day.
  const query = new URLSearchParams({ format: 'json', minmag: '4.5', limit: String(REQUEST_LIMIT), orderby: 'magnitude', start: new Date(now - WINDOW_MS).toISOString() });
  let payload;
  try { payload = await fetcher(`${ENDPOINT}?${query}`, request); } catch { payload = { error: 'network error' }; }
  // "No event in the window" is HTTP 204 with an empty body, which the fetch helper reports as invalid JSON.
  if (payload?.status === 204 && payload.error === 'Invalid JSON response') payload = { type: 'FeatureCollection', features: [] };
  return parseEmsc(payload, { now });
}
