// Crucix OVF Vízmérce (Berettyó) Adapter
// Forrás: Országos Vízügyi Főigazgatóság (OVF) Geoportál ArcGIS MapServer REST API
// Endpoint: https://geoportal.vizugy.hu/arcgis/rest/services/VIR/Vizmercek_vizugyhu/MapServer/60/query
// Jogi státusz és adatkezelés:
// - Kizárólag tájékoztató jellegű adat; nem minősül hivatalos árvízi vagy belvízi előrejelzésnek.
// - Csak memóriában tartott adat: SOHASEM íródik lemezre (runs/latest.json, sweep archívum, history).
// - Zero riasztási hatás: riasztást, eseményt, incidenst vagy értesítést nem generál.
// - Kapcsoló: CRUCIX_ENABLE_OVF_GAUGES (alapértelmezés: false; kikapcsolva 0 külső hálózati hívás).

import { safeFetch } from '../utils/fetch.mjs';

export const SOURCE = 'OVF-Gauges';
export const ENDPOINT_URL = 'https://geoportal.vizugy.hu/arcgis/rest/services/VIR/Vizmercek_vizugyhu/MapServer/60/query';
export const ATTRIBUTION = 'Forrás: Országos Vízügyi Főigazgatóság (OVF), tájékoztató jellegű adat; nem hivatalos árvízi vagy belvízi előrejelzés.';

// Cache TTL: 30 minutes
export const CACHE_TTL_MS = 30 * 60 * 1000;

// Freshness thresholds:
// 1. Órás automata állomások (Berettyóújfalu, Pocsaj): 60 perces mintavétel (HH:00Z) + 30 perc közzétételi ráhagyás = 90 perc.
export const HOURLY_FRESH_THRESHOLD_MINUTES = 90;
// 2. Napi leolvasású állomások (Darvas, Szeghalom): 24 órás ciklus (06:00Z reggeli leolvasás a mintában) + 2 óra ráhagyás = 26 óra (1560 perc).
export const DAILY_FRESH_THRESHOLD_MINUTES = 26 * 60;
// Visszafelé kompatibilis alapértelmezett küszöb
export const FRESH_THRESHOLD_MINUTES = HOURLY_FRESH_THRESHOLD_MINUTES;

// The 4 monitored Berettyó gauges based on official OVF registration (törzsszám)
export const OVF_BERETTYO_GAUGES = Object.freeze({
  '2546': {
    id: '2546',
    name: 'Berettyóújfalu',
    river: 'Berettyó',
    isPrimary: true,
    hasDischarge: true,
    cadence: 'hourly',
    freshThresholdMinutes: HOURLY_FRESH_THRESHOLD_MINUTES,
    order: 1
  },
  '2545': {
    id: '2545',
    name: 'Pocsaj',
    river: 'Berettyó',
    isPrimary: false,
    hasDischarge: true,
    cadence: 'hourly',
    freshThresholdMinutes: HOURLY_FRESH_THRESHOLD_MINUTES,
    order: 2
  },
  '2739': {
    id: '2739',
    name: 'Darvas',
    river: 'Berettyó',
    isPrimary: false,
    hasDischarge: false, // In official OVF sample: null (does not measure discharge)
    cadence: 'daily',
    freshThresholdMinutes: DAILY_FRESH_THRESHOLD_MINUTES,
    order: 3
  },
  '2740': {
    id: '2740',
    name: 'Szeghalom',
    river: 'Berettyó',
    isPrimary: false,
    hasDischarge: true,
    cadence: 'daily',
    freshThresholdMinutes: DAILY_FRESH_THRESHOLD_MINUTES,
    order: 4
  }
});

export const QUERY_WHERE = 'vFeAllomas_webmerc.Torzsszam IN (2545, 2546, 2739, 2740)';
export const QUERY_OUT_FIELDS = [
  'vFeAllomas_webmerc.Torzsszam',
  'vFeAllomas_webmerc.vFeAllomas_Nev',
  'vop.dbo.tAllomasFe.AllomasNev',
  'vop.dbo.tAllomasFe.Torzsszam',
  'vop.dbo.tAllomasFe.VizfolyasNev',
  'vop.dbo.tAllomasFe.Idopont',
  'vop.dbo.tAllomasFe.Vizallas',
  'vop.dbo.tAllomasFe.Vizhozam',
  'vop.dbo.tAllomasFe.Vizho',
  'vop.dbo.tAllomasFe.KF1',
  'vop.dbo.tAllomasFe.KF2',
  'vop.dbo.tAllomasFe.KF3',
  'vop.dbo.tAllomasFe.Fokozat',
  'vop.dbo.tAllomasFe.LKV',
  'vop.dbo.tAllomasFe.LNV'
].join(',');

let gaugeCache = null;
let lastSuccessfulGauges = null;

export function clearOvfGaugesCache() {
  gaugeCache = null;
  lastSuccessfulGauges = null;
}

/**
 * ArcGIS MapServer encodes naive Hungarian local falióra-idő as UTC epoch milliseconds.
 * This function extracts the falióra components and determines the DST-correct true UTC
 * timestamp in Europe/Budapest, handling CET (winter, UTC+1), CEST (summer, UTC+2),
 * spring missing hour (02:00 -> 03:00 transition) and autumn repeated hour (03:00 -> 02:00 transition).
 */
export function parseOvfLocalTimestamp(rawEpoch) {
  if (typeof rawEpoch !== 'number' || !Number.isFinite(rawEpoch) || rawEpoch <= 0) {
    return { utcIso: null, utcEpoch: null, localTime: '--:--', localDateTime: '--' };
  }

  const naive = new Date(rawEpoch);
  const year = naive.getUTCFullYear();
  const month = naive.getUTCMonth();
  const day = naive.getUTCDate();
  const hour = naive.getUTCHours();
  const minute = naive.getUTCMinutes();
  const second = naive.getUTCSeconds();

  const pad = n => String(n).padStart(2, '0');
  const targetIsoLocal = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;

  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  function getLocalString(utcMs) {
    const parts = dtf.formatToParts(new Date(utcMs));
    const m = {};
    for (const p of parts) m[p.type] = p.value;
    const h = m.hour === '24' ? '00' : m.hour;
    return `${m.year}-${m.month}-${m.day}T${h}:${m.minute}:${m.second}`;
  }

  // Candidates: CET (UTC+1, 3600000 ms) or CEST (UTC+2, 7200000 ms)
  // For autumn repeated hour (02:00-03:00), CET (+1h, standard civil hydrology time) is the timeline standard.
  const offsetCandidates = [3600000, 7200000];
  let bestUtc = null;

  for (const off of offsetCandidates) {
    const testUtc = rawEpoch - off;
    if (getLocalString(testUtc) === targetIsoLocal) {
      bestUtc = testUtc;
      break;
    }
  }

  if (bestUtc === null) {
    // Spring missing hour: e.g. 02:30 during 02:00->03:00 jump.
    // Pick candidate closest to target local representation.
    const diff1 = Math.abs(new Date(getLocalString(rawEpoch - 3600000)).getTime() - new Date(targetIsoLocal).getTime());
    const diff2 = Math.abs(new Date(getLocalString(rawEpoch - 7200000)).getTime() - new Date(targetIsoLocal).getTime());
    bestUtc = diff1 <= diff2 ? (rawEpoch - 3600000) : (rawEpoch - 7200000);
  }

  const dt = new Date(bestUtc);
  return {
    utcIso: dt.toISOString(),
    utcEpoch: bestUtc,
    localTime: `${pad(hour)}:${pad(minute)}`,
    localDateTime: `${year}. ${pad(month + 1)}. ${pad(day)}. ${pad(hour)}:${pad(minute)}`
  };
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

/**
 * Formats an ISO UTC timestamp into Europe/Budapest full date & time (YYYY.MM.DD HH:mm).
 */
export function formatToBudapestDateTime(isoString) {
  if (!isoString) return '--';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return '--';
  return dt.toLocaleString('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function parseNullableNum(val) {
  if (val === null || val === undefined || val === '' || val === -999 || val === '-999') {
    return null;
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * Calculates relation of water level to preparedness levels.
 * Non-alarmist, purely informational percentage and headroom.
 */
export function calculateLevelRelation(waterLevelCm, kf1, kf2, kf3) {
  if (waterLevelCm === null || kf1 === null || kf1 === undefined || kf1 <= 0) {
    return {
      status: 'unknown',
      percentOfKf1: null,
      headroomKf1Cm: null,
      text: '-'
    };
  }

  const headroom = kf1 - waterLevelCm;
  const pct = Math.round((waterLevelCm / kf1) * 100);

  let status = 'normal';
  let text = '';

  if (kf3 && waterLevelCm >= kf3) {
    status = 'kf3';
    text = `${waterLevelCm - kf3} cm túllépés a ${kf3} cm-es III. fokú szinthez (nem hivatalos állapot)`;
  } else if (kf2 && waterLevelCm >= kf2) {
    status = 'kf2';
    text = `${waterLevelCm - kf2} cm túllépés a ${kf2} cm-es II. fokú szinthez (nem hivatalos állapot)`;
  } else if (waterLevelCm >= kf1) {
    status = 'kf1';
    const over = waterLevelCm - kf1;
    text = over > 0
      ? `${over} cm túllépés, számítva a ${kf1} cm-es I. fokú készültségi szinthez (nem hivatalos állapot)`
      : `pontosan a ${kf1} cm-es I. fokú készültségi szinten (nem hivatalos állapot)`;
  } else {
    status = 'normal';
    text = `${headroom} cm tartalék, számítva a ${kf1} cm-es I. fokú készültségi szinthez (nem hivatalos állapot)`;
  }

  return {
    status,
    percentOfKf1: pct,
    headroomKf1Cm: headroom,
    text
  };
}

/**
 * Parses ArcGIS MapServer query JSON response.
 */
export function parseOvfArcGisResponse(responseJson, options = {}) {
  const now = options.now ? new Date(options.now).getTime() : Date.now();

  const data = typeof responseJson === 'string' ? JSON.parse(responseJson) : responseJson;
  if (!data || typeof data !== 'object') {
    throw new Error('Érvénytelen OVF válasz formátum (nem objektum)');
  }

  const features = Array.isArray(data.features) ? data.features : [];
  const gauges = {};

  for (const feature of features) {
    const a = feature?.attributes || {};
    // Extract raw törzsszám (number or trimmed string)
    const rawId = a['vFeAllomas_webmerc.Torzsszam'] ?? a['vop.dbo.tAllomasFe.Torzsszam'] ?? a['Torzsszam'];
    if (rawId === null || rawId === undefined) continue;

    const id = String(rawId).trim();
    const meta = OVF_BERETTYO_GAUGES[id];
    if (!meta) continue; // Only process the registered Berettyó gauges

    const name = (a['vop.dbo.tAllomasFe.AllomasNev'] || a['vFeAllomas_webmerc.vFeAllomas_Nev'] || a['AllomasNev'] || meta.name).trim();
    const river = (a['vop.dbo.tAllomasFe.VizfolyasNev'] || a['VizfolyasNev'] || meta.river).trim();

    // Per-gauge freshness threshold resolution
    const gaugeThresholdMinutes = options.gaugeThresholds?.[id]
      ?? meta.freshThresholdMinutes
      ?? options.freshThresholdMinutes
      ?? FRESH_THRESHOLD_MINUTES;

    // Timestamp: epoch milliseconds
    const rawEpoch = a['vop.dbo.tAllomasFe.Idopont'] ?? a['Idopont'];
    let observedAt = null;
    let ageMinutes = null;
    let fresh = false;
    let futureTimestamp = false;
    let observedAtBudapestTime = '--:--';
    let observedAtBudapestDate = '--';

    if (typeof rawEpoch === 'number' && Number.isFinite(rawEpoch) && rawEpoch > 0) {
      const parsedTime = parseOvfLocalTimestamp(rawEpoch);
      observedAt = parsedTime.utcIso;
      observedAtBudapestTime = parsedTime.localTime;
      observedAtBudapestDate = parsedTime.localDateTime;

      if (parsedTime.utcEpoch !== null) {
        const rawDiffMinutes = Math.round((now - parsedTime.utcEpoch) / 60000);
        if (rawDiffMinutes < -2) {
          // Anomaly: future timestamp. Preserve actual negative age and flag it, do NOT clamp to 0.
          futureTimestamp = true;
          ageMinutes = rawDiffMinutes;
          fresh = false;
        } else {
          ageMinutes = Math.max(0, rawDiffMinutes);
          fresh = ageMinutes <= gaugeThresholdMinutes;
        }
      }
    }

    const waterLevelCm = parseNullableNum(a['vop.dbo.tAllomasFe.Vizallas'] ?? a['Vizallas']);
    // Water discharge in m3/s: null if gauge does not measure it (e.g. Darvas)
    const dischargeM3s = parseNullableNum(a['vop.dbo.tAllomasFe.Vizhozam'] ?? a['Vizhozam']);
    // Water temperature in Celsius
    const waterTempC = parseNullableNum(a['vop.dbo.tAllomasFe.Vizho'] ?? a['Vizho']);

    const kf1 = parseNullableNum(a['vop.dbo.tAllomasFe.KF1'] ?? a['KF1']);
    const kf2 = parseNullableNum(a['vop.dbo.tAllomasFe.KF2'] ?? a['KF2']);
    const kf3 = parseNullableNum(a['vop.dbo.tAllomasFe.KF3'] ?? a['KF3']);
    const lkv = parseNullableNum(a['vop.dbo.tAllomasFe.LKV'] ?? a['LKV']);
    const lnv = parseNullableNum(a['vop.dbo.tAllomasFe.LNV'] ?? a['LNV']);
    const rawFokozat = parseNullableNum(a['vop.dbo.tAllomasFe.Fokozat'] ?? a['Fokozat']);

    const levelRelation = calculateLevelRelation(waterLevelCm, kf1, kf2, kf3);

    gauges[id] = {
      id,
      name,
      river,
      isPrimary: meta.isPrimary,
      hasDischarge: meta.hasDischarge,
      cadence: meta.cadence,
      freshThresholdMinutes: gaugeThresholdMinutes,
      order: meta.order,
      observedAt,
      observedAtBudapestTime,
      observedAtBudapestDate,
      ageMinutes,
      futureTimestamp,
      fresh,
      waterLevelCm,
      dischargeM3s,
      waterTempC,
      kf1,
      kf2,
      kf3,
      lkv,
      lnv,
      currentFokozat: rawFokozat,
      levelRelation
    };
  }

  // Ensure all 4 gauges exist in the output in order
  const gaugeList = Object.values(OVF_BERETTYO_GAUGES)
    .sort((a, b) => a.order - b.order)
    .map(meta => {
      if (gauges[meta.id]) return gauges[meta.id];
      const fallbackThreshold = options.gaugeThresholds?.[meta.id]
        ?? meta.freshThresholdMinutes
        ?? options.freshThresholdMinutes
        ?? FRESH_THRESHOLD_MINUTES;
      return {
        id: meta.id,
        name: meta.name,
        river: meta.river,
        isPrimary: meta.isPrimary,
        hasDischarge: meta.hasDischarge,
        cadence: meta.cadence,
        freshThresholdMinutes: fallbackThreshold,
        order: meta.order,
        observedAt: null,
        observedAtBudapestTime: '--:--',
        observedAtBudapestDate: '--',
        ageMinutes: null,
        futureTimestamp: false,
        fresh: false,
        waterLevelCm: null,
        dischargeM3s: null,
        waterTempC: null,
        kf1: null,
        kf2: null,
        kf3: null,
        lkv: null,
        lnv: null,
        currentFokozat: null,
        levelRelation: {
          status: 'unknown',
          percentOfKf1: null,
          headroomKf1Cm: null,
          text: '-'
        }
      };
    });

  // Primary gauge is Berettyóújfalu (2546)
  const primaryGauge = gaugeList.find(g => g.id === '2546') || gaugeList[0] || null;
  const allFresh = gaugeList.filter(g => g.observedAt).length > 0 &&
    gaugeList.filter(g => g.observedAt).every(g => g.fresh && !g.futureTimestamp);
  const anyFresh = gaugeList.some(g => g.fresh);

  return {
    source: SOURCE,
    enabled: true,
    queriedAt: new Date(now).toISOString(),
    primaryGauge,
    gauges: gaugeList,
    fresh: anyFresh,
    allFresh,
    attribution: ATTRIBUTION
  };
}

/**
 * Main Briefing Entrypoint.
 * Evaluates opt-in switch: CRUCIX_ENABLE_OVF_GAUGES.
 * Memory-only: never written to disk, zero alerts/events emitted.
 */
export async function briefing(options = {}) {
  const isEnabled = process.env.CRUCIX_ENABLE_OVF_GAUGES === 'true';
  if (!isEnabled) {
    return {
      status: 'disabled',
      data: {
        source: SOURCE,
        enabled: false,
        message: 'OVF vízmérce modul letiltva (CRUCIX_ENABLE_OVF_GAUGES=false)',
        attribution: ATTRIBUTION,
        gauges: []
      }
    };
  }

  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const timeout = options.timeout || options.timeoutMs || 10000;

  // Cache check: within CACHE_TTL_MS unless forced
  if (!options.bypassCache && gaugeCache && (now - gaugeCache.timestamp < CACHE_TTL_MS)) {
    return gaugeCache.result;
  }

  // Offline fixture support
  if (options.fixtureJson || options.fixtureData) {
    try {
      const parsed = parseOvfArcGisResponse(options.fixtureJson || options.fixtureData, { now, ...options });
      const briefResult = {
        status: parsed.fresh ? 'ok' : 'stale',
        data: {
          ...parsed,
          cached: false
        },
        error: null
      };
      gaugeCache = { timestamp: now, result: briefResult };
      lastSuccessfulGauges = briefResult.data;
      return briefResult;
    } catch (err) {
      return {
        status: 'error',
        data: null,
        error: `Fixture hiba: ${err.message}`
      };
    }
  }

  // Single sweep query to ArcGIS MapServer REST API
  try {
    const params = new URLSearchParams({
      where: QUERY_WHERE,
      outFields: QUERY_OUT_FIELDS,
      returnGeometry: 'false',
      f: 'json'
    });
    const url = `${ENDPOINT_URL}?${params.toString()}`;

    const res = await safeFetch(url, {
      timeout,
      headers: {
        'User-Agent': 'Crucix/2.13 (+https://github.com/WeirdProdigy/Crucix)',
        'Accept': 'application/json'
      }
    });

    if (!res || res.error) {
      throw new Error(res?.error || 'Nem sikerült letölteni az OVF vízmérce adatokat');
    }

    const parsed = parseOvfArcGisResponse(res.body || res.json || res, { now, ...options });
    const briefResult = {
      status: parsed.fresh ? 'ok' : 'stale',
      data: {
        ...parsed,
        cached: false
      },
      error: null
    };

    gaugeCache = { timestamp: now, result: briefResult };
    lastSuccessfulGauges = briefResult.data;
    return briefResult;
  } catch (err) {
    if (lastSuccessfulGauges) {
      return {
        status: 'stale',
        data: {
          ...lastSuccessfulGauges,
          stale: true,
          staleReason: err.message
        },
        error: err.message
      };
    }
    return {
      status: 'error',
      data: null,
      error: err.message
    };
  }
}
