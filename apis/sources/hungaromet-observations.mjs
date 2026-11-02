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

/**
 * Parses raw unzipped CSV text into station observations.
 * Filters strictly to target stations: 65305, 64711, 64310, 64713.
 */
export function parseSynopticCsv(csvText, { now = Date.now() } = {}) {
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

    const stationMeta = HUNGAROMET_STATIONS[stationNum];

    // Decode metrics per Leiras_automata_10perces-HABP_10M_now-hu.pdf
    const values = {
      temperature: parseNum(row[colIndex.t]),
      temperatureAvg: parseNum(row[colIndex.ta]),
      temperatureMin: parseNum(row[colIndex.tn]),
      temperatureMax: parseNum(row[colIndex.tx]),
      humidity: parseNum(row[colIndex.u]),
      pressure: parseNum(row[colIndex.p]),
      windSpeed: parseNum(row[colIndex.fs]),
      windDirection: parseNum(row[colIndex.fsd]),
      windGust: parseNum(row[colIndex.fx]),
      windGustDirection: parseNum(row[colIndex.fxd]),
      precipitation: parseNum(row[colIndex.r]),
      visibility: parseNum(row[colIndex.v]),
      soilTemp5cm: parseNum(row[colIndex.et5]),
      soilTemp10cm: parseNum(row[colIndex.et10]),
      soilTemp20cm: parseNum(row[colIndex.et20]),
      soilTemp50cm: parseNum(row[colIndex.et50]),
      soilTemp100cm: parseNum(row[colIndex.et100]),
      groundTempMin5cm: parseNum(row[colIndex.tsn])
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

  const primaryStation = stations['65305'] || null;
  const isOverallFresh = primaryStation ? primaryStation.fresh : false;

  return {
    source: SOURCE,
    parsedAt: new Date(now).toISOString(),
    primaryStation,
    stations,
    fresh: isOverallFresh,
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
        csvContent = unzipped.toString('latin1');
      }
      const parsed = parseSynopticCsv(csvContent, { now });
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
    const csvText = unzipped.toString('latin1');
    const parsed = parseSynopticCsv(csvText, { now });

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
