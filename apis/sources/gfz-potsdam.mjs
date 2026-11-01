// GFZ Potsdam Kp and Hpo (Hp30, Hp60) Space Weather Indices
// CC BY 4.0 Attribution: GFZ German Research Centre for Geosciences
// API: https://kp.gfz.de/app/json/
// Controlled by CRUCIX_ENABLE_GFZ opt-in environment flag.

import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshResult, unavailableResult } from '../utils/freshness.mjs';

const SOURCE = 'GFZ-Potsdam';
const BASE_URL = 'https://kp.gfz.de/app/json/';
const SOURCE_URL = 'https://kp.gfz.de/';
const ATTRIBUTION = 'GFZ German Research Centre for Geosciences (CC BY 4.0)';

// 30-minute in-memory cache TTL to avoid redundant upstream calls (GFZ updates Kp every 3h, Hp30 every 30m)
const CACHE_TTL_MS = 30 * 60 * 1000;
let gfzCache = null;

export function clearGfzCache() {
  gfzCache = null;
}

export function getGfzHeaders() {
  const contact = process.env.CRUCIX_CONTACT_URL || 'https://github.com/WeirdProdigy/Crucix';
  return Object.freeze({
    'User-Agent': `Crucix/2.13 (+${contact})`,
    'Accept': 'application/json'
  });
}

/**
 * Normalizes GFZ parallel arrays into a structured object:
 * {
 *   latest: { time, value, status },
 *   series: [{ time, value, status }],
 *   metadata: {...}
 * }
 */
export function parseGfzIndexSeries(json, valueKey) {
  if (!json || typeof json !== 'object') return null;
  const datetimes = Array.isArray(json.datetime) ? json.datetime : [];
  const values = Array.isArray(json[valueKey]) ? json[valueKey] : [];
  const statuses = Array.isArray(json.status) ? json.status : [];

  if (datetimes.length === 0 || values.length === 0) return null;

  const count = Math.min(datetimes.length, values.length);
  const series = [];
  for (let i = 0; i < count; i++) {
    const val = Number(values[i]);
    if (Number.isFinite(val)) {
      series.push({
        time: datetimes[i],
        value: Math.round(val * 1000) / 1000,
        status: statuses[i] || 'pre'
      });
    }
  }

  if (series.length === 0) return null;
  const latest = series[series.length - 1];

  return {
    latest,
    series: series.slice(-24), // keep last 24 entries
    metadata: json.meta || json.metadata || null
  };
}

/**
 * Combines parsed Kp, Hp30, and Hp60 data into a consolidated GFZ space-weather telemetry object.
 */
export function parseGfzData(rawKp, rawHp30, rawHp60, { now = Date.now() } = {}) {
  const kpParsed = parseGfzIndexSeries(rawKp, 'Kp');
  const hp30Parsed = parseGfzIndexSeries(rawHp30, 'Hp30');
  const hp60Parsed = parseGfzIndexSeries(rawHp60, 'Hp60');

  if (!kpParsed && !hp30Parsed && !hp60Parsed) {
    return unavailableResult(SOURCE, 'GFZ Potsdam: no valid index data returned', { url: SOURCE_URL, attribution: ATTRIBUTION }, now);
  }

  const latestTime = kpParsed?.latest?.time || hp30Parsed?.latest?.time || hp60Parsed?.latest?.time;
  const observedAt = latestTime ? providerTime(latestTime, { assumeUTC: true }) : null;

  const currentKp = kpParsed?.latest?.value ?? null;
  const currentHp30 = hp30Parsed?.latest?.value ?? null;
  const currentHp60 = hp60Parsed?.latest?.value ?? null;

  // Determine geomagnetic storm level based on current Kp or Hp60
  const maxIdx = Math.max(currentKp ?? 0, currentHp60 ?? 0);
  let gScale = 'G0';
  let gSeverity = 'monitor';
  let gDescriptionHu = 'Nyugodt mágneses tér';

  if (maxIdx >= 9) {
    gScale = 'G5';
    gSeverity = 'critical';
    gDescriptionHu = 'Szélsőséges geomágneses vihar (G5)';
  } else if (maxIdx >= 8) {
    gScale = 'G4';
    gSeverity = 'high';
    gDescriptionHu = 'Súlyos geomágneses vihar (G4)';
  } else if (maxIdx >= 7) {
    gScale = 'G3';
    gSeverity = 'high';
    gDescriptionHu = 'Erős geomágneses vihar (G3)';
  } else if (maxIdx >= 6) {
    gScale = 'G2';
    gSeverity = 'moderate';
    gDescriptionHu = 'Mérsékelt geomágneses vihar (G2)';
  } else if (maxIdx >= 5) {
    gScale = 'G1';
    gSeverity = 'low';
    gDescriptionHu = 'Kisebb geomágneses vihar (G1)';
  } else if (maxIdx >= 4) {
    gScale = 'G0+';
    gSeverity = 'monitor';
    gDescriptionHu = 'Nyugtalan geomágneses aktivitás';
  }

  const metrics = {
    kp: currentKp,
    kpStatus: kpParsed?.latest?.status || null,
    hp30: currentHp30,
    hp60: currentHp60,
    gScale,
    gSeverity,
    gDescriptionHu,
    history24h: {
      kp: kpParsed?.series || [],
      hp30: hp30Parsed?.series || [],
      hp60: hp60Parsed?.series || []
    }
  };

  const observations = [];
  if (maxIdx >= 5) {
    observations.push({
      kind: 'space-weather',
      title: `GFZ Potsdam Geomágneses aktivitás: ${gScale} (Kp=${currentKp})`,
      summary: `A GFZ Potsdam indexei alapján a geomágneses aktivitás elérte a(z) ${gScale} szintet. ${gDescriptionHu}.`,
      source: SOURCE,
      url: SOURCE_URL,
      providerId: `gfz-${gScale}`,
      observedAt,
      publishedAt: observedAt,
      severity: gSeverity,
      lat: null,
      lon: null,
      locationMethod: 'global',
      locationPrecision: 'unknown'
    });
  }

  const summary = `GFZ Potsdam Kp: ${currentKp ?? 'N/A'}, Hp30: ${currentHp30 ?? 'N/A'}, Hp60: ${currentHp60 ?? 'N/A'} (${gScale}).`;
  return freshResult(SOURCE, observedAt, observations, {
    url: SOURCE_URL,
    attribution: ATTRIBUTION,
    metrics,
    summary
  }, now);
}

/**
 * Main briefing entrypoint for GFZ Potsdam.
 * Evaluates opt-in switch: CRUCIX_ENABLE_GFZ (default: false unless enabled).
 * Exactly 1 request per endpoint per sweep.
 */
export async function briefing(options = {}) {
  const isEnabled = process.env.CRUCIX_ENABLE_GFZ === 'true';
  if (!isEnabled) {
    return {
      status: 'disabled',
      data: {
        source: SOURCE,
        enabled: false,
        message: 'GFZ Potsdam adatlekérés letiltva (CRUCIX_ENABLE_GFZ=false)'
      }
    };
  }

  const now = options.now ? new Date(options.now) : new Date();
  const nowMs = now.getTime();

  if (!options.bypassCache && gfzCache && (nowMs - gfzCache.timestamp < CACHE_TTL_MS)) {
    return gfzCache.result;
  }

  const past = new Date(nowMs - 24 * 3600 * 1000);
  const startStr = past.toISOString().slice(0, 19) + 'Z';
  const endStr = now.toISOString().slice(0, 19) + 'Z';

  const headers = getGfzHeaders();
  const timeout = options.timeout || options.timeoutMs || 10000;

  try {
    const [kpResRaw, hp30ResRaw, hp60ResRaw] = await Promise.all([
      safeFetch(`${BASE_URL}?start=${startStr}&end=${endStr}&index=Kp`, { headers, timeout }).catch(() => null),
      safeFetch(`${BASE_URL}?start=${startStr}&end=${endStr}&index=Hp30`, { headers, timeout }).catch(() => null),
      safeFetch(`${BASE_URL}?start=${startStr}&end=${endStr}&index=Hp60`, { headers, timeout }).catch(() => null),
    ]);

    const kpRes = kpResRaw?.error ? null : kpResRaw;
    const hp30Res = hp30ResRaw?.error ? null : hp30ResRaw;
    const hp60Res = hp60ResRaw?.error ? null : hp60ResRaw;

    const result = parseGfzData(kpRes, hp30Res, hp60Res, { now: nowMs });
    const briefResult = {
      status: result.status,
      data: result,
      error: result.error || null
    };

    if (result.status === 'ok') {
      gfzCache = { timestamp: nowMs, result: briefResult };
    }
    return briefResult;
  } catch (err) {
    return {
      status: 'error',
      data: null,
      error: `GFZ Potsdam lekérdezési hiba: ${err.message}`
    };
  }
}
