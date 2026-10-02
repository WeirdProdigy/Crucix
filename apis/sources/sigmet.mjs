// International SIGMETs from the NOAA/NWS Aviation Weather Center: warnings of significant weather for aircraft in flight
// (volcanic ash, severe turbulence and icing, tropical cyclones, thunderstorms). https://aviationweather.gov/data/api/
// The isigmet service does not include SIGMETs that the United States issues in its domestic format. It returns one row per
// hazard area, and the rows are not unique per SIGMET (checked on 2026-10-02 against 155 live rows):
//   - volcanic ash and cyclone SIGMETs come twice, as "<series>" and "<series>F" (the forecast area, same message);
//   - a bulletin that arrived on two circuits is repeated (MHTG G1);
//   - one office reuses a series id for different messages (NZKL 29) and a message with several hazards or areas has one row each,
//     all with the same series id (SBGL 25-29, EGRR 02, FAOR G01).
// So the identity is the office, series, hazard, start time and a short hash of the area; the F twin is dropped.
// Every regex below runs on text that was cut to a fixed length first: unbounded input never reaches one.
import { createHash } from 'node:crypto';
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';

const SOURCE = 'Aviation-SIGMET';
const ENDPOINT = 'https://aviationweather.gov/api/data/isigmet?format=json';
const MAP_PAGE = 'https://aviationweather.gov/gfa/';
const MAX_ROWS = 100;
const MAX_EXAMINED = 1000;
const MAX_RINGS = 20;
const MAX_POINTS = 200;
const FUTURE_SKEW_MS = 300000;
const MIN_EPOCH = 946684800; // 2000-01-01 and 2100-01-01 in seconds: a value in milliseconds or a zero is not a time
const MAX_EPOCH = 4102444800;
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
const EXTRAS = {
  attribution: 'Source: NOAA/NWS Aviation Weather Center, https://aviationweather.gov (international SIGMETs as issued by the meteorological watch offices named in each bulletin)',
  rights: 'NWS information is in the public domain and may be used without charge for any lawful purpose, as long as you do not claim it as your own, imply NOAA/NWS endorsement or modify it and present it as official government material (weather.gov/disclaimer). The Aviation Weather Center asks for a custom user agent and at most 100 requests per minute. Decoded SIGMETs are no substitute for the official bulletin; the map position is an approximation.',
  license: 'Public domain (NWS disclaimer)',
  licenseUrl: 'https://www.weather.gov/disclaimer',
  summary: 'International SIGMETs in force now (significant weather for aircraft: volcanic ash, severe turbulence and icing, tropical cyclones, thunderstorms), ranked by hazard and then newest first. Each row sits at the centroid of the SIGMET area, an approximation; the bulletin text is the authority. SIGMETs that the United States issues in its domestic format are not included.',
};

// label, severity and the rank of the hazard: volcanic ash, severe turbulence and icing, cyclones, then the rest (so a cap cuts thunderstorms first).
const HAZARDS = { VA: ['Volcanic ash', 'high', 0], TURB: ['Severe turbulence', 'moderate', 1], ICE: ['Severe icing', 'moderate', 1], TC: ['Tropical cyclone', 'low', 2],
  TS: ['Thunderstorm', 'low', 3], MTW: ['Mountain wave', 'low', 3], DS: ['Duststorm', 'low', 3], SS: ['Sandstorm', 'low', 3] };
const CHANGES = { WKN: 'weakening', INTSF: 'intensifying', NC: 'no change in intensity' };

// Provider text becomes inert plain text: markup, control, bidi and zero-width characters go, whitespace collapses.
// The input is cut to 400 characters BEFORE any regex runs and the tag pattern cannot rescan: linear on hostile text.
const clean = (value, cap) => typeof value === 'string'
  ? value.slice(0, 400).replace(/<[^<>]*>/g, '').replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').replace(/[<>]/g, '').trim().slice(0, cap).trim() : '';
// Transport errors become a short reason; a URL or an upstream message never reaches the result.
function failure(error) {
  const reason = typeof error === 'string' ? error.slice(0, 300).replace(/https?:\/\/\S*/gi, '').trim().slice(0, 120) : '';
  return `Aviation SIGMET request failed${reason ? `: ${reason}` : ''}`;
}

const epoch = value => Number.isFinite(value) && value >= MIN_EPOCH && value <= MAX_EPOCH ? value : null;
const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const office = value => typeof value === 'string' && value.length === 4 && /^[A-Z0-9]{4}$/.test(value) ? value : null;
const seriesOf = value => {
  const series = typeof value === 'string' && value.length <= 30 ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9 .-]{0,19}$/.test(series) ? series : null;
};
const hazardOf = value => {
  const code = typeof value === 'string' && value.length <= 8 ? value.toUpperCase() : '';
  return /^[A-Z]{2,8}$/.test(code) ? code : null;
};
const fl = hundreds => `FL${String(hundreds).padStart(3, '0')}`;
const hundreds = feet => Number.isFinite(feet) && feet >= 0 && feet <= 100000 ? Math.round(feet / 100) : null;
function levels(base, top) {
  const lo = hundreds(base), hi = hundreds(top);
  if (lo !== null && hi !== null) return `${lo === 0 ? 'SFC' : fl(lo)} to ${fl(hi)}`;
  if (hi !== null) return `up to ${fl(hi)}`;
  return lo ? `above ${fl(lo)}` : '';
}
function movement(direction, speed) {
  const knots = typeof speed === 'number' ? speed : typeof speed === 'string' && speed.length <= 4 && /^\d{1,3}$/.test(speed) ? Number(speed) : NaN;
  const heading = typeof direction === 'string' && direction.length <= 3 && /^[NSEW]{1,3}$/.test(direction) ? direction : null;
  if (!Number.isInteger(knots) || knots < 0 || knots > 200) return '';
  return knots === 0 ? 'stationary' : heading ? `moving ${heading} at ${knots} kt` : '';
}

const validPoint = point => point && typeof point === 'object' && Number.isFinite(point.lon) && Number.isFinite(point.lat) && Math.abs(point.lon) <= 180 && Math.abs(point.lat) <= 90;
// The area of a row as lists of valid points: one list for AREA and LINE, one per area for AREAS (a list of lists).
function rings(coords) {
  if (!Array.isArray(coords)) return [];
  const lists = Array.isArray(coords[0]) ? coords.slice(0, MAX_RINGS) : [coords];
  return lists.map(list => (Array.isArray(list) ? list.slice(0, MAX_POINTS) : []).filter(validPoint).map(({ lon, lat }) => [lon, lat]));
}
const round3 = value => (Math.round(value * 1000) || 0) / 1000;

// The centre of the area: the area centroid of a polygon, the mean of the points of a line or a flat polygon. Longitudes are unwrapped
// along the ring first, so an area across the antimeridian is not averaged through the Greenwich side of the globe.
function centre(points, area) {
  const unwrapped = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let lon = points[i][0];
    const previous = unwrapped[i - 1][0];
    while (lon - previous > 180) lon -= 360;
    while (previous - lon > 180) lon += 360;
    unwrapped.push([lon, points[i][1]]);
  }
  const ring = unwrapped.length > 1 && unwrapped[0][0] === unwrapped.at(-1)[0] && unwrapped[0][1] === unwrapped.at(-1)[1] ? unwrapped.slice(0, -1) : unwrapped;
  const [x0, y0] = ring[0];
  const mean = () => [ring.reduce((sum, point) => sum + point[0], 0) / ring.length, ring.reduce((sum, point) => sum + point[1], 0) / ring.length];
  let lon, lat;
  if (!area || ring.length < 3) [lon, lat] = mean();
  else {
    // Shoelace sums, relative to the first point so that large coordinates do not cost precision.
    let twiceArea = 0, sumX = 0, sumY = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = [ring[i][0] - x0, ring[i][1] - y0], [bx, by] = [ring[(i + 1) % ring.length][0] - x0, ring[(i + 1) % ring.length][1] - y0];
      const cross = ax * by - bx * ay;
      twiceArea += cross; sumX += (ax + bx) * cross; sumY += (ay + by) * cross;
    }
    if (Math.abs(twiceArea) < 1e-9) [lon, lat] = mean();
    else { lon = x0 + sumX / (3 * twiceArea); lat = y0 + sumY / (3 * twiceArea); }
  }
  if (lon > 180) lon -= 360; else if (lon < -180) lon += 360;
  return { lat: round3(lat), lon: round3(lon) };
}

// Rows of one SIGMET are told apart by their area: the points at the provider's precision, hashed.
const areaHash = lists => createHash('sha1').update(lists.map(list => list.map(([lon, lat]) => `${round3(lon).toFixed(3)},${round3(lat).toFixed(3)}`).join(';')).join('|')).digest('hex').slice(0, 8);

// One provider row; whether it is current (started, not ended) is decided when rows are selected, below.
function decode(row, now) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const icao = office(row.icaoId), series = seriesOf(row.seriesId), code = hazardOf(row.hazard);
  const from = epoch(row.validTimeFrom), to = epoch(row.validTimeTo);
  if (!icao || !series || !code || from === null || to === null || to <= from) return null;
  // "<series>F" is the forecast area of the same message.
  const twin = /^(.*\d)F$/.exec(series);
  const base = twin ? twin[1] : series;
  const [label, severity, priority] = Object.hasOwn(HAZARDS, code) ? HAZARDS[code] : [code, 'low', 4];
  const lists = rings(row.coords);
  const located = lists.find(list => list.length > 0);
  const place = located ? { ...centre(located, row.geom !== 'LINE'), locationMethod: located.length === 1 ? 'provider' : 'polygon-centroid', locationPrecision: 'approximate' } : null;
  const providerId = `${icao}:${base.replace(/ /g, '_')}:${code}:${from}:${areaHash(lists)}`;
  const fir = clean(row.firName, 60) || clean(row.firId, 20) || icao;
  const qualifier = clean(row.qualifier, 40);
  const observedAt = new Date(from * 1000).toISOString(), validUntil = new Date(to * 1000).toISOString();
  // The time the provider received the bulletin, unless that lies in the future.
  const received = providerTime(row.receiptTime);
  const publishedAt = received && Date.parse(received) - now <= FUTURE_SKEW_MS ? received : null;
  const change = typeof row.chng === 'string' && row.chng.length <= 8 && Object.hasOwn(CHANGES, row.chng) ? CHANGES[row.chng] : '';
  const clauses = [`Valid ${stamp(from * 1000)} to ${observedAt.slice(0, 10) === validUntil.slice(0, 10) ? stamp(to * 1000).slice(11) : stamp(to * 1000)} UTC`, levels(row.base, row.top), movement(row.dir, row.spd), change].filter(Boolean);
  // The feed time of this row: the receipt time, the start time when there is none (never a future time).
  const feedAt = publishedAt ?? (from * 1000 - now <= FUTURE_SKEW_MS ? observedAt : null);
  return { twin: Boolean(twin), group: `${icao}|${base}|${code}|${from}|${to}`, feedAt, publishedAt, severity, priority, providerId, observedAt, validUntil,
    row: { kind: 'weather', providerId, title: `SIGMET ${label} ${fir}`,
      summary: `${label} SIGMET ${base}${qualifier ? ` (${qualifier})` : ''} for ${fir}, issued by ${icao}. ${clauses.join('; ')}. Decoded by the Aviation Weather Center; the bulletin text is the authority.`,
      source: SOURCE, url: `${MAP_PAGE}?${new URLSearchParams({ tab: 'obs', layers: 'sigmet', ...(place ? { center: `${place.lat},${place.lon}`, zoom: '4' } : {}), sigmet: providerId })}`,
      observedAt, ...(publishedAt ? { publishedAt } : {}), validUntil, ...(place ?? {}), region: fir, severity, hazard: label, fir } };
}

export function parseSigmet(payload, { now = Date.now() } = {}) {
  if (payload?.error) return unavailableResult(SOURCE, failure(payload.error), EXTRAS, now);
  if (!Array.isArray(payload)) return unavailableResult(SOURCE, 'Aviation SIGMET returned an unexpected response', EXTRAS, now);
  const examined = payload.slice(0, MAX_EXAMINED);
  const decoded = examined.map(row => decode(row, now)).filter(Boolean);
  // The feed time is the newest receipt time. Expired and not yet started rows count: they show that the provider is current.
  const feedAt = decoded.map(item => item.feedAt).filter(Boolean).sort().at(-1) ?? null;
  const bases = new Set(decoded.filter(item => !item.twin).map(item => item.group));
  const seen = new Set();
  // Rank and cap before freshResult, which only looks at the first 100 rows. Only SIGMETs that have started (within a few minutes of clock
  // skew) and whose end lies ahead count; freshResult applies the same rule again.
  const ranked = decoded.filter(item => !(item.twin && bases.has(item.group)) && Date.parse(item.validUntil) > now && freshness(item.observedAt, POLICIES[SOURCE].observationMaxAgeMs, now).fresh)
    .sort((a, b) => a.priority - b.priority || b.observedAt.localeCompare(a.observedAt) || b.validUntil.localeCompare(a.validUntil)
      || (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0) || (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
    .filter(item => !seen.has(item.providerId) && seen.add(item.providerId));
  return freshResult(SOURCE, feedAt, ranked.slice(0, MAX_ROWS).map(item => item.row), { ...EXTRAS, examinedRecords: examined.length,
    truncatedRecords: Math.max(0, payload.length - examined.length) + Math.max(0, ranked.length - MAX_ROWS) }, now);
}

export async function briefing(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const fetcher = options.fetcher || safeFetch;
  const request = { ...REQUEST, timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)) };
  let payload;
  try { payload = await fetcher(ENDPOINT, request); } catch { payload = { error: 'network error' }; }
  // "No SIGMET in force" is HTTP 204 with an empty body, which the fetch helper reports as invalid JSON.
  if (payload?.status === 204 && payload.error === 'Invalid JSON response') payload = [];
  return parseSigmet(payload, { now });
}
