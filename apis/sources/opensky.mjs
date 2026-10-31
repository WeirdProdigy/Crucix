// OpenSky Network — Real-time flight tracking
// Free for research. 4,000 API credits/day (no auth), 8,000 with account.
// Tracks all aircraft with ADS-B transponders including many military.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://opensky-network.org/api';

// Get all current flights (global state vector)
export async function getAllFlights() {
  return safeFetch(`${BASE}/states/all`, { timeout: 30000 });
}

// Get flights in a bounding box (lat/lon)
export async function getFlightsInArea(lamin, lomin, lamax, lomax, options = {}) {
  const params = new URLSearchParams({
    lamin: String(lamin),
    lomin: String(lomin),
    lamax: String(lamax),
    lomax: String(lomax),
  });
  return safeFetch(`${BASE}/states/all?${params}`, { timeout: 5000, retries: 0, signal: options.signal });
}

// Get flights by specific aircraft (ICAO24 hex codes)
export async function getFlightsByIcao(icao24List) {
  const icao = Array.isArray(icao24List) ? icao24List : [icao24List];
  const params = icao.map(i => `icao24=${i}`).join('&');
  return safeFetch(`${BASE}/states/all?${params}`, { timeout: 5000 });
}

// Get departures from an airport in a time range
export async function getDepartures(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return safeFetch(`${BASE}/flights/departure?${params}`);
}

// Get arrivals at an airport
export async function getArrivals(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return safeFetch(`${BASE}/flights/arrival?${params}`);
}

// Key hotspot regions for monitoring
export const HOTSPOTS = {
  middleEast: { lamin: 12, lomin: 30, lamax: 42, lomax: 65, label: 'Middle East' },
  taiwan: { lamin: 20, lomin: 115, lamax: 28, lomax: 125, label: 'Taiwan Strait' },
  ukraine: { lamin: 44, lomin: 22, lamax: 53, lomax: 41, label: 'Ukraine Region' },
  baltics: { lamin: 53, lomin: 19, lamax: 60, lomax: 29, label: 'Baltic Region' },
  southChinaSea: { lamin: 5, lomin: 105, lamax: 23, lomax: 122, label: 'South China Sea' },
  koreanPeninsula: { lamin: 33, lomin: 124, lamax: 43, lomax: 132, label: 'Korean Peninsula' },
  caribbean: { lamin: 18, lomin: -90, lamax: 30, lomax: -72, label: 'Caribbean' },
  gulfOfGuinea: { lamin: -2, lomin: -5, lamax: 8, lomax: 10, label: 'Gulf of Guinea' },
  capeRoute: { lamin: -38, lomin: 12, lamax: -28, lomax: 24, label: 'Cape Route' },
  hornOfAfrica: { lamin: 5, lomin: 40, lamax: 15, lomax: 55, label: 'Horn of Africa' },
};

// Briefing — check hotspot regions for flight activity
export const OPENSKY_CACHE_TTL_MS = 2 * 3600 * 1000; // 2 hours (12 runs/day * 28 credits = 336 <= 400 anonymous daily budget)
let cachedOpenSkyResult = null;
let cachedOpenSkyTime = 0;


// Calculates credit cost per bounding box according to OpenSky API pricing rules:
// <= 25 sq deg: 1 credit, <= 100 sq deg: 2 credits, <= 400 sq deg: 3 credits, > 400 sq deg: 4 credits
export function calculateOpenSkyCredits(hotspots = HOTSPOTS) {
  let totalCredits = 0;
  const breakdown = {};
  for (const [key, box] of Object.entries(hotspots)) {
    const latSpan = Math.abs(box.lamax - box.lamin);
    const lonSpan = Math.abs(box.lomax - box.lomin);
    const area = latSpan * lonSpan;
    let credits = 1;
    if (area > 400) credits = 4;
    else if (area > 100) credits = 3;
    else if (area > 25) credits = 2;
    totalCredits += credits;
    breakdown[key] = { area, credits };
  }
  return { totalCredits, breakdown };
}

export function _resetOpenSkyCache() {
  cachedOpenSkyResult = null;
  cachedOpenSkyTime = 0;
}

export async function briefing(options = {}) {
  const now = typeof options.now === 'function' ? options.now() : (Number.isFinite(options.now) ? options.now : Date.now());
  const ttl = options.ttlMs ?? OPENSKY_CACHE_TTL_MS;
  const delayMs = options.delayMs ?? 100;

  if (!options.bypassCache && cachedOpenSkyResult && (now - cachedOpenSkyTime < ttl)) {
    return { ...cachedOpenSkyResult, cached: true };
  }

  const hotspotEntries = Object.entries(HOTSPOTS);
  const results = [];
  for (let i = 0; i < hotspotEntries.length; i++) {
    if (options.signal?.aborted) {
      throw new Error('OpenSky briefing aborted');
    }
    const [key, box] = hotspotEntries[i];
    if (i > 0 && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
    const data = await getFlightsInArea(box.lamin, box.lomin, box.lamax, box.lomax, { signal: options.signal });
    const error = data?.error || null;
    const states = data?.states || [];
    results.push({
      region: box.label,
      key,
      totalAircraft: states.length,
      byCountry: states.reduce((acc, s) => {
        const country = s[2] || 'Unknown';
        acc[country] = (acc[country] || 0) + 1;
        return acc;
      }, {}),
      noCallsign: states.filter(s => !s[1]?.trim()).length,
      highAltitude: states.filter(s => s[7] && s[7] > 12000).length,
      ...(error ? { error } : {}),
    });
  }

  const hotspotErrors = results
    .filter(r => r.error)
    .map(r => ({ region: r.region, error: r.error }));

  const result = {
    source: 'OpenSky',
    timestamp: new Date(now).toISOString(),
    hotspots: results,
    ...(hotspotErrors.length ? {
      error: hotspotErrors.length === results.length
        ? `OpenSky unavailable across all hotspots: ${hotspotErrors[0].error}`
        : `OpenSky unavailable for ${hotspotErrors.length}/${results.length} hotspots`,
      hotspotErrors,
    } : {}),
  };
  if (!result.error) {
    cachedOpenSkyResult = result;
    cachedOpenSkyTime = now;
  }
  return result;
}

if (process.argv[1]?.endsWith('opensky.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
