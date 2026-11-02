// Crucix HungaroMet ODP 10-minute Synchronous Observations Adapter
// Data Source: HungaroMet Magyar Meteorológiai Szolgáltató Nonprofit Zrt.
// Endpoint: https://odp.met.hu/weather/weather_reports/synoptic/hungary/10_minutes/csv/HABP_10M_SYNOP_LATEST.csv.zip
// Controlled by CRUCIX_ENABLE_HUNGAROMET_OBS environment flag (default: false).
// Attribution required: "Adatbázis: Meteorológiai Adattár, HungaroMet Nonprofit Zrt."

import { safeFetch } from '../utils/fetch.mjs';
import { readZipEntry } from '../utils/zip.mjs';

export const SOURCE = 'HungaroMet-Observations';
export const FEED_URL = 'https://odp.met.hu/weather/weather_reports/synoptic/hungary/10_minutes/csv/HABP_10M_SYNOP_LATEST.csv.zip';
export const SOURCE_URL = 'https://odp.met.hu/';
export const ATTRIBUTION = 'Adatbázis: Meteorológiai Adattár, HungaroMet Nonprofit Zrt.';

// Cache TTL: 10 minutes (matches the 10-minute generation cycle of the upstream feed)
export const CACHE_TTL_MS = 10 * 60 * 1000;
// Freshness threshold: 30 minutes
export const STALE_THRESHOLD_MINUTES = 30;

// Official stations verified from station_meta_auto.csv
export const HUNGAROMET_STATIONS = Object.freeze({
  '65305': {
    id: '65305',
    name: 'Berettyóújfalu',
    region: 'Hajdú-Bihar',
    lat: 47.2092,
    lon: 21.5383,
    elevation: 92.0,
    isPrimary: true
  },
  '64711': {
    id: '64711',
    name: 'Debrecen repülőtér',
    region: 'Hajdú-Bihar',
    lat: 47.4844,
    lon: 21.6056,
    elevation: 106.6,
    isPrimary: false
  },
  '64310': {
    id: '64310',
    name: 'Debrecen Kismacs',
    region: 'Hajdú-Bihar',
    lat: 47.5767,
    lon: 21.5825,
    elevation: 125.0,
    isPrimary: false
  },
  '64713': {
    id: '64713',
    name: 'Derecske Petőfi major',
    region: 'Hajdú-Bihar',
    lat: 47.3653,
    lon: 21.5497,
    elevation: 97.0,
    isPrimary: false
  }
});

export const DEFAULT_FALLBACK_STATIONS = Object.freeze(['64711', '64310', '64713']);

/**
 * Calculates Haversine distance in kilometers between two lat/lon points.
 * Returns null if any coordinate is not finite.
 */
export function calculateHaversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return null;
  }
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((R * c) * 10) / 10;
}

/**
 * Resolves fallback station priority order from options, environment, or default list.
 */
export function resolveFallbackStationOrder(options = {}) {
  if (Array.isArray(options.fallbackStationOrder) && options.fallbackStationOrder.length > 0) {
    return options.fallbackStationOrder.map(s => String(s).trim()).filter(Boolean);
  }
  if (process.env.CRUCIX_HUNGAROMET_FALLBACK_STATIONS) {
    const fromEnv = process.env.CRUCIX_HUNGAROMET_FALLBACK_STATIONS
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (fromEnv.length > 0) return fromEnv;
  }
  return [...DEFAULT_FALLBACK_STATIONS];
}

/**
 * Resolves reference coordinates for distance calculations.
 * Order: options.userCoordinates -> process.env.CRUCIX_OBSERVED_USER_LAT/LON -> targetStation coordinates -> default.
 */
export function resolveReferenceCoordinates(targetStation, options = {}) {
  if (
    options.userCoordinates &&
    Number.isFinite(options.userCoordinates.lat) &&
    Number.isFinite(options.userCoordinates.lon)
  ) {
    return {
      lat: Number(options.userCoordinates.lat),
      lon: Number(options.userCoordinates.lon),
      source: 'options'
    };
  }

  const envLat = process.env.CRUCIX_OBSERVED_USER_LAT;
  const envLon = process.env.CRUCIX_OBSERVED_USER_LON;
  if (envLat !== undefined && envLon !== undefined) {
    const latNum = parseFloat(envLat);
    const lonNum = parseFloat(envLon);
    if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
      return { lat: latNum, lon: lonNum, source: 'env' };
    }
  }

  if (targetStation && Number.isFinite(targetStation.lat) && Number.isFinite(targetStation.lon)) {
    return { lat: targetStation.lat, lon: targetStation.lon, source: 'targetStation' };
  }

  const meta = targetStation?.station ? HUNGAROMET_STATIONS[targetStation.station] : HUNGAROMET_STATIONS['65305'];
  if (meta && Number.isFinite(meta.lat) && Number.isFinite(meta.lon)) {
    return { lat: meta.lat, lon: meta.lon, source: 'stationMeta' };
  }

  return { lat: 47.2092, lon: 21.5383, source: 'default' };
}

/**
 * Fills missing (null) observation metrics for a target station from candidate fallback stations.
 * Ensures:
 * 1. Primary/target values are NEVER overwritten if already present.
 * 2. Only fresh fallback stations (age <= 30 mins) can provide fallback values.
 * 3. Fallback candidates are evaluated in priority order with freshest timestamp winning.
 * 4. Separate structure values.<metric> = { value, station, stationName, observedAt, distanceKm, isFallback, fresh }
 * 5. Returns null if no valid measurement is found across target and all fallback stations.
 */
export function fillMissingObservations(targetStation, allStations = {}, options = {}) {
  if (!targetStation || typeof targetStation !== 'object') return null;

  const order = resolveFallbackStationOrder(options);
  const refCoords = resolveReferenceCoordinates(targetStation, options);
  const targetValues = targetStation.values || {};
  const metricKeys = Object.keys(targetValues);

  const values = {};
  const missingFields = [];
  const filledFields = [];

  for (const key of metricKeys) {
    const rawVal = targetValues[key];
    if (rawVal !== null && rawVal !== undefined) {
      const dist = calculateHaversineDistanceKm(refCoords.lat, refCoords.lon, targetStation.lat, targetStation.lon);
      values[key] = {
        value: rawVal,
        station: targetStation.station,
        stationName: targetStation.stationName,
        observedAt: targetStation.observedAt,
        distanceKm: dist !== null ? Math.round(dist * 10) / 10 : 0,
        isFallback: false,
        fresh: Boolean(targetStation.fresh)
      };
    } else {
      missingFields.push(key);

      const candidates = [];
      for (const fId of order) {
        if (fId === targetStation.station) continue;
        const fStation = allStations[fId];
        if (!fStation) continue;

        const isFresh = Boolean(fStation.fresh);
        if (!isFresh) continue;

        const fVal = fStation.values ? fStation.values[key] : null;
        if (fVal !== null && fVal !== undefined) {
          candidates.push({
            station: fStation,
            value: fVal,
            orderIdx: order.indexOf(fId),
            timestamp: new Date(fStation.observedAt).getTime()
          });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          if (b.timestamp !== a.timestamp) {
            return b.timestamp - a.timestamp;
          }
          return a.orderIdx - b.orderIdx;
        });

        const best = candidates[0];
        const fStn = best.station;
        const dist = calculateHaversineDistanceKm(refCoords.lat, refCoords.lon, fStn.lat, fStn.lon);

        values[key] = {
          value: best.value,
          station: fStn.station,
          stationName: fStn.stationName,
          observedAt: fStn.observedAt,
          distanceKm: dist !== null ? Math.round(dist * 10) / 10 : null,
          isFallback: true,
          fresh: true
        };
        filledFields.push(key);
      } else {
        values[key] = {
          value: null,
          station: null,
          stationName: null,
          observedAt: null,
          distanceKm: null,
          isFallback: true,
          fresh: false
        };
      }
    }
  }

  return {
    targetStation: targetStation.station,
    targetStationName: targetStation.stationName,
    fallbackStations: order,
    missingFields,
    filledFields,
    values
  };
}

let observationCache = null;
let lastSuccessfulData = null;

export function clearHungarometCache() {
  observationCache = null;
  lastSuccessfulData = null;
}

/**
 * Checks HTTP headers via HEAD to see if upstream file has changed.
 */
export async function checkHead(url = FEED_URL, { timeout = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Crucix/2.13 (+https://github.com/WeirdProdigy/Crucix)' }
    });
    return {
      ok: res.ok,
      status: res.status,
      lastModified: res.headers.get('last-modified') || null,
      etag: res.headers.get('etag') || null
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err.message,
      lastModified: null,
      etag: null
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Converts HungaroMet 12-char UTC string (YYYYMMDDHHmm) to ISO 8601 UTC string.
 */
export function parseOdpTimestampToUtcIso(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const s = timeStr.trim();
  if (s.length !== 12) return null;
  const y = s.slice(0, 4);
  const m = s.slice(4, 6);
  const d = s.slice(6, 8);
  const hh = s.slice(8, 10);
  const mm = s.slice(10, 12);
  return `${y}-${m}-${d}T${hh}:${mm}:00.000Z`;
}

/**
 * Formats an ISO UTC timestamp into Europe/Budapest local time string (HH:mm).
 */
export function formatToBudapestTime(isoString) {
  if (!isoString) return '--:--';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return '--:--';
  return dt.toLocaleTimeString('hu-HU', {
    timeZone: 'Europe/Budapest',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function parseNum(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (s === '' || s === '-999' || s === '-999.0' || s === '-999.00') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function colVal(row, colIndex, ...names) {
  for (const name of names) {
    const idx = colIndex[name];
    if (idx !== undefined && idx < row.length) {
      const val = row[idx];
      if (val !== undefined && val !== '') return val;
    }
  }
  return undefined;
}

function decodeZipText(buffer) {
  if (!buffer) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return buffer.toString('latin1');
  }
}

/**
 * Parses raw unzipped CSV text into station observations.
 * Filters strictly to target stations: 65305, 64711, 64310, 64713.
 */
export function parseSynopticCsv(csvText, options = {}) {
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  if (!csvText || typeof csvText !== 'string') {
    throw new Error('Üres vagy érvénytelen CSV tartalom');
  }

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error('A CSV nem tartalmaz elegendő adatsort');
  }

  const headerLine = lines[0];
  const headers = headerLine.split(';').map(h => h.trim());
  const colIndex = {};
  headers.forEach((h, i) => { colIndex[h] = i; });

  if (colIndex.Time === undefined || colIndex.StationNumber === undefined) {
    throw new Error('A CSV fejléc nem tartalmazza a kötelező Time vagy StationNumber oszlopot');
  }

  const stations = {};
  const targetIds = Object.keys(HUNGAROMET_STATIONS);

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(';');
    if (row.length < 2) continue;

    const stationNum = row[colIndex.StationNumber]?.trim();
    if (!targetIds.includes(stationNum)) continue;

    const rawTime = row[colIndex.Time]?.trim();
    const observedAt = parseOdpTimestampToUtcIso(rawTime);
    if (!observedAt) continue;

    const obsDate = new Date(observedAt);
    const ageMinutes = Math.max(0, Math.round((now - obsDate.getTime()) / (60 * 1000)));
    const isFresh = ageMinutes <= STALE_THRESHOLD_MINUTES;

    // If duplicate station row exists, keep the newer observation
    if (stations[stationNum]) {
      const existingTime = new Date(stations[stationNum].observedAt).getTime();
      if (obsDate.getTime() <= existingTime) {
        continue;
      }
    }

    const stationMeta = HUNGAROMET_STATIONS[stationNum];

    // Decode metrics per Leiras_automata_10perces-HABP_10M_now-hu.pdf with meteorological fallback
    const values = {
      temperature: parseNum(colVal(row, colIndex, 't', 'temperature')),
      temperatureAvg: parseNum(colVal(row, colIndex, 'ta')),
      temperatureMin: parseNum(colVal(row, colIndex, 'tn', 'tmin')),
      temperatureMax: parseNum(colVal(row, colIndex, 'tx', 'tmax')),
      humidity: parseNum(colVal(row, colIndex, 'u', 'humidity')),
      pressure: parseNum(colVal(row, colIndex, 'p', 'pressure')),
      windSpeed: parseNum(colVal(row, colIndex, 'fs', 'ff', 'windSpeed')),
      windDirection: parseNum(colVal(row, colIndex, 'fsd', 'dd', 'windDirection')),
      windGust: parseNum(colVal(row, colIndex, 'fx', 'windGust')),
      windGustDirection: parseNum(colVal(row, colIndex, 'fxd', 'windGustDirection')),
      precipitation: parseNum(colVal(row, colIndex, 'r', 'rr', 'precipitation')),
      visibility: parseNum(colVal(row, colIndex, 'v', 'vis', 'visibility')),
      soilTemp5cm: parseNum(colVal(row, colIndex, 'et5', 't05')),
      soilTemp10cm: parseNum(colVal(row, colIndex, 'et10', 't10')),
      soilTemp20cm: parseNum(colVal(row, colIndex, 'et20', 't20')),
      soilTemp50cm: parseNum(colVal(row, colIndex, 'et50', 't50')),
      soilTemp100cm: parseNum(colVal(row, colIndex, 'et100', 't100')),
      groundTempMin5cm: parseNum(colVal(row, colIndex, 'tsn', 'tn05'))
    };

    stations[stationNum] = {
      station: stationNum,
      stationName: stationMeta.name,
      region: stationMeta.region,
      lat: stationMeta.lat,
      lon: stationMeta.lon,
      elevation: stationMeta.elevation,
      isPrimary: Boolean(stationMeta.isPrimary),
      observedAt,
      observedAtLocal: formatToBudapestTime(observedAt),
      ageMinutes,
      fresh: isFresh,
      status: isFresh ? 'fresh' : 'stale',
      staleReason: isFresh ? null : `Az adat ${ageMinutes} perces (küszöb: ${STALE_THRESHOLD_MINUTES} perc)`,
      values,
      source: 'HungaroMet ODP',
      attribution: ATTRIBUTION
    };
  }

  const primaryStation = stations['65305'] || (Object.values(stations).length > 0 ? Object.values(stations)[0] : null);

  // Compute fallback / filled observations
  let primaryFallback = null;
  if (primaryStation) {
    primaryFallback = fillMissingObservations(primaryStation, stations, options);
    primaryStation.composite = primaryFallback;
    primaryStation.fallback = primaryFallback;
    primaryStation.fallbackValues = primaryFallback.values;
  }

  for (const sId of Object.keys(stations)) {
    if (stations[sId] !== primaryStation) {
      const fb = fillMissingObservations(stations[sId], stations, options);
      stations[sId].composite = fb;
      stations[sId].fallback = fb;
      stations[sId].fallbackValues = fb.values;
    }
  }

  const isOverallFresh = primaryStation ? primaryStation.fresh : false;
  const stationCount = Object.keys(stations).length;
  const minAgeMinutes = primaryStation ? primaryStation.ageMinutes : null;
  const latestUtcIso = primaryStation ? primaryStation.observedAt : null;
  const latestBudapestTime = primaryStation ? primaryStation.observedAtLocal : null;

  return {
    source: SOURCE,
    parsedAt: new Date(now).toISOString(),
    status: isOverallFresh ? 'ok' : 'stale',
    fresh: isOverallFresh,
    stationCount,
    ageMinutes: minAgeMinutes,
    feedTimestampUtc: latestUtcIso,
    feedTimestampLocal: latestBudapestTime,
    primaryStation,
    stations,
    fallback: primaryFallback,
    composite: primaryFallback,
    attribution: ATTRIBUTION
  };
}

/**
 * Main Briefing Entrypoint.
 * Evaluates opt-in switch: CRUCIX_ENABLE_HUNGAROMET_OBS.
 * Never alerts, never increments incident counts.
 */
export async function briefing(options = {}) {
  const isEnabled = process.env.CRUCIX_ENABLE_HUNGAROMET_OBS === 'true';
  if (!isEnabled) {
    return {
      status: 'disabled',
      data: {
        source: SOURCE,
        enabled: false,
        message: 'HungaroMet ODP mért adat modul letiltva (CRUCIX_ENABLE_HUNGAROMET_OBS=false)'
      }
    };
  }

  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const timeout = options.timeout || options.timeoutMs || 10000;

  // Cache check: within CACHE_TTL_MS unless forced
  if (!options.bypassCache && observationCache && (now - observationCache.timestamp < CACHE_TTL_MS)) {
    return observationCache.result;
  }

  // If a mock buffer or text fixture is passed via options (for testing / offline)
  if (options.fixtureBuffer || options.fixtureZip || options.fixtureCsv) {
    try {
      let csvContent = options.fixtureCsv;
      if (!csvContent) {
        const zipBuf = options.fixtureBuffer || options.fixtureZip;
        const unzipped = readZipEntry(zipBuf);
        csvContent = decodeZipText(unzipped);
      }
      const parsed = parseSynopticCsv(csvContent, { now, ...options });
      const briefResult = {
        status: parsed.fresh ? 'ok' : 'stale',
        data: {
          ...parsed,
          enabled: true,
          feedUrl: FEED_URL,
          cached: false
        },
        error: null
      };
      observationCache = { timestamp: now, result: briefResult, lastModified: null, etag: null };
      lastSuccessfulData = briefResult.data;
      return briefResult;
    } catch (err) {
      return {
        status: 'error',
        data: null,
        error: `Fixture feldolgozási hiba: ${err.message}`
      };
    }
  }

  // Pre-check with HEAD request if we have an existing cache
  let headInfo = null;
  if (options.checkHead !== false && observationCache?.lastModified) {
    headInfo = await checkHead(FEED_URL, { timeout: 5000 });
    if (headInfo.ok && headInfo.lastModified && headInfo.lastModified === observationCache.lastModified) {
      // Upstream file hasn't changed, refresh cache timestamp and return cached result
      observationCache.timestamp = now;
      return observationCache.result;
    }
  }

  // Fetch zip archive
  try {
    const fetchRes = await safeFetch(FEED_URL, {
      format: 'buffer',
      timeout,
      headers: {
        'User-Agent': 'Crucix/2.13 (+https://github.com/WeirdProdigy/Crucix)',
        'Accept': 'application/zip, application/octet-stream'
      }
    });

    if (!fetchRes || fetchRes.error || !fetchRes.rawBuffer) {
      throw new Error(fetchRes?.error || 'Nem sikerült letölteni a tömörített adatcsomagot');
    }

    const unzipped = readZipEntry(fetchRes.rawBuffer);
    const csvText = decodeZipText(unzipped);
    const parsed = parseSynopticCsv(csvText, { now, ...options });

    const briefResult = {
      status: parsed.fresh ? 'ok' : 'stale',
      data: {
        ...parsed,
        enabled: true,
        feedUrl: FEED_URL,
        lastModified: headInfo?.lastModified || null,
        etag: headInfo?.etag || null,
        cached: false
      },
      error: null
    };

    observationCache = {
      timestamp: now,
      result: briefResult,
      lastModified: headInfo?.lastModified || null,
      etag: headInfo?.etag || null
    };
    lastSuccessfulData = briefResult.data;

    return briefResult;
  } catch (err) {
    // Graceful fallback to last known successful data if available
    if (lastSuccessfulData) {
      return {
        status: 'stale',
        data: {
          ...lastSuccessfulData,
          fresh: false,
          fallback: true,
          staleReason: `Lekérési hiba fallback: ${err.message}`
        },
        error: `HungaroMet ODP lekérési hiba (fallback aktív): ${err.message}`
      };
    }

    return {
      status: 'error',
      data: null,
      error: `HungaroMet ODP mérési adat lekérési hiba: ${err.message}`
    };
  }
}
