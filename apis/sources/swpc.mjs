// Current NOAA space-weather scales and enhanced telemetry.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshResult, unavailableResult } from '../utils/freshness.mjs';

const SOURCE = 'NOAA-SWPC';
const FEED_URL = 'https://services.swpc.noaa.gov/products/noaa-scales.json';
const SOURCE_URL = 'https://www.swpc.noaa.gov/noaa-scales-explanation';
const LEVELS = ['none', 'minor', 'moderate', 'strong', 'severe', 'extreme'];
const SEVERITIES = ['monitor', 'low', 'moderate', 'high', 'high', 'critical'];
const SCALES_HU = Object.freeze({
  radioBlackouts: 'rádió-blackout',
  solarRadiationStorms: 'sugárzási vihar',
  geomagneticStorms: 'geomágneses vihar',
});
const LEVELS_HU = Object.freeze(['nincs', 'kisebb', 'mérsékelt', 'erős', 'súlyos', 'szélsőséges']);
const SCALES = [
  ['R', 'radioBlackouts', 'radio blackouts'],
  ['S', 'solarRadiationStorms', 'solar radiation storms'],
  ['G', 'geomagneticStorms', 'geomagnetic storms'],
];
export function getSwpcHeaders() {
  const contact = process.env.CRUCIX_CONTACT_URL || 'https://github.com/WeirdProdigy/Crucix';
  return Object.freeze({
    'User-Agent': `Crucix/2.13 (+${contact})`
  });
}
const META = { url: SOURCE_URL, feedUrl: FEED_URL, attribution: 'NOAA / NWS Space Weather Prediction Center' };

/**
 * Parses configurable SWPC notification thresholds from environment string (e.g. 'G4,R4,S3').
 * Defaults to G4+/R4+/S3+ for notification dispatch.
 */
export function parseSwpcNotifyThreshold(envVal = process.env.CRUCIX_SWPC_NOTIFY_MIN) {
  const defaults = { g: 4, r: 4, s: 3 };
  if (!envVal || typeof envVal !== 'string') return defaults;
  const gMatch = envVal.match(/G(\d)/i);
  const rMatch = envVal.match(/R(\d)/i);
  const sMatch = envVal.match(/S(\d)/i);
  return {
    g: gMatch ? parseInt(gMatch[1], 10) : defaults.g,
    r: rMatch ? parseInt(rMatch[1], 10) : defaults.r,
    s: sMatch ? parseInt(sMatch[1], 10) : defaults.s
  };
}

/**
 * Normalizes input raw JSON into an array of objects.
 * Handles:
 * 1. Array of objects: [{ time_tag, Kp }, ...]
 * 2. Array of arrays: [["time_tag", "Kp"], ["2026-10-30...", 1.67]]
 * 3. Indexed object: {"0": {...}, "1": {...}}
 */
export function normalizeJsonTable(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (Array.isArray(raw[0])) {
      const headers = raw[0].map(h => String(h).trim());
      const rows = [];
      for (let i = 1; i < raw.length; i++) {
        const row = raw[i];
        if (!Array.isArray(row)) continue;
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
          obj[headers[j]] = row[j];
        }
        rows.push(obj);
      }
      return rows;
    }
    if (typeof raw[0] === 'object' && raw[0] !== null) {
      return raw;
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    return Object.values(raw);
  }
  return [];
}

/**
 * Parses planetary K-index from NOAA feed.
 */
export function parseKpIndex(raw) {
  const rows = normalizeJsonTable(raw);
  if (!rows.length) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const kpVal = r.Kp ?? r.kp ?? r.KP;
    if (kpVal !== undefined && kpVal !== null && !isNaN(Number(kpVal))) {
      return {
        kp: Math.round(Number(kpVal) * 100) / 100,
        timeTag: r.time_tag || r.timeTag || null,
        stationCount: Number(r.station_count) || null
      };
    }
  }
  return null;
}

/**
 * Parses real-time solar wind plasma and magnetic field.
 * Respects active spacecraft and extracts speed, density, temperature, and Bz/Bt.
 */
export function parseSolarWind(windRaw, magRaw) {
  const windRows = normalizeJsonTable(windRaw);
  const magRows = normalizeJsonTable(magRaw);

  let bestWind = null;
  if (windRows.length) {
    const active = windRows.filter(r => r.active === true);
    bestWind = active.length ? active[active.length - 1] : windRows[windRows.length - 1];
  }

  let bestMag = null;
  if (magRows.length) {
    const active = magRows.filter(r => r.active === true);
    bestMag = active.length ? active[active.length - 1] : magRows[magRows.length - 1];
  }

  const speed = Number(bestWind?.proton_speed ?? bestWind?.speed);
  const density = Number(bestWind?.proton_density ?? bestWind?.density);
  const temp = Number(bestWind?.proton_temperature ?? bestWind?.temperature);

  const bz = Number(bestMag?.bz_gsm ?? bestMag?.bz_gse ?? bestMag?.bz);
  const bt = Number(bestMag?.bt);

  return {
    speed: Number.isFinite(speed) ? Math.round(speed) : null,
    density: Number.isFinite(density) ? Math.round(density * 10) / 10 : null,
    temperature: Number.isFinite(temp) ? Math.round(temp) : null,
    bz: Number.isFinite(bz) ? Math.round(bz * 10) / 10 : null,
    bt: Number.isFinite(bt) ? Math.round(bt * 10) / 10 : null,
    source: bestWind?.source || bestMag?.source || null,
    timeTag: bestWind?.time_tag || bestMag?.time_tag || null
  };
}

/**
 * Calculates standard solar X-ray flare class from flux in W/m^2 (0.1-0.8 nm wavelength).
 */
export function calculateXrayClass(flux) {
  if (!Number.isFinite(flux) || flux <= 0) return null;
  if (flux < 1e-7) {
    return `A${(flux / 1e-8).toFixed(1)}`;
  }
  if (flux < 1e-6) {
    return `B${(flux / 1e-7).toFixed(1)}`;
  }
  if (flux < 1e-5) {
    return `C${(flux / 1e-6).toFixed(1)}`;
  }
  if (flux < 1e-4) {
    return `M${(flux / 1e-5).toFixed(1)}`;
  }
  return `X${(flux / 1e-4).toFixed(1)}`;
}

/**
 * Parses GOES primary satellite X-ray flux.
 */
export function parseGoesXrays(raw) {
  const rows = normalizeJsonTable(raw);
  if (!rows.length) return null;
  const longWave = rows.filter(r => (r.energy === '0.1-0.8nm' || r.energy === '0.1-0.8') && Number.isFinite(Number(r.flux)));
  if (!longWave.length) return null;

  const satellites = Array.from(new Set(longWave.map(r => Number(r.satellite)).filter(Number.isFinite)));
  const primarySat = satellites.length ? Math.max(...satellites) : null;

  const satRows = primarySat ? longWave.filter(r => Number(r.satellite) === primarySat) : longWave;
  const latest = satRows[satRows.length - 1];

  const flux = Number(latest.flux);
  return {
    flux,
    xrayClass: calculateXrayClass(flux),
    satellite: latest.satellite || primarySat,
    timeTag: latest.time_tag
  };
}

/**
 * Parses NOAA space weather alerts and watches.
 * Enforces high severity filtering (G3+, R3+, S2+).
 */
export function parseAlerts(raw, { now = Date.now(), maxAgeHours = 24 } = {}) {
  const items = Array.isArray(raw) ? raw : (raw?.alerts || []);
  const activeAlerts = [];
  const highSeverityAlerts = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const msg = String(item.message || '');
    const dt = item.issue_datetime ? item.issue_datetime.replace(' ', 'T') : null;
    const issued = dt ? Date.parse(dt.endsWith('Z') ? dt : dt + 'Z') : null;
    if (issued && !isNaN(issued) && (now - issued > maxAgeHours * 3600 * 1000)) {
      continue;
    }

    const isWatch = /WATCH:/i.test(msg);
    const isWarning = /WARNING:/i.test(msg);
    const isAlert = /ALERT:/i.test(msg);

    const gMatch = msg.match(/G([1-5])/);
    const rMatch = msg.match(/R([1-5])/);
    const sMatch = msg.match(/S([1-5])/);

    const gLevel = gMatch ? Number(gMatch[1]) : 0;
    const rLevel = rMatch ? Number(rMatch[1]) : 0;
    const sLevel = sMatch ? Number(sMatch[1]) : 0;

    const entry = {
      productId: item.product_id,
      issuedAt: item.issue_datetime,
      type: isAlert ? 'alert' : (isWarning ? 'warning' : (isWatch ? 'watch' : 'info')),
      gLevel,
      rLevel,
      sLevel,
      messageSnippet: msg.split('\n')[0] || msg.slice(0, 100)
    };

    activeAlerts.push(entry);

    if (gLevel >= 3 || rLevel >= 3 || sLevel >= 2) {
      highSeverityAlerts.push(entry);
    }
  }

  return {
    activeCount: activeAlerts.length,
    activeAlerts: activeAlerts.slice(0, 10),
    highSeverityAlerts
  };
}

/**
 * Parses SWPC 3-day forecast text summary.
 */
export function parseForecast(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const match = text.match(/The greatest expected 3 hr Kp for [^\n]+ is ([0-9.]+)\s*(?:\((NOAA Scale\s*(G[1-5]))\))?/i);
  const issuedMatch = text.match(/:Issued:\s*([^\n]+)/i);
  return {
    maxExpectedKp: match ? Number(match[1]) : null,
    maxExpectedGScale: match && match[3] ? match[3] : 'None',
    issued: issuedMatch ? issuedMatch[1].trim() : null,
    summary: match ? match[0].trim() : null
  };
}

/**
 * Baseline SWPC scales parser.
 * Preserves strict backwards compatibility with existing scales fixture.
 */
export function parseSWPC(data, { now = Date.now() } = {}) {
  if (data?.scales) {
    return parseEnhancedSWPC(data, { now });
  }
  const current = data?.['0'];
  if (!current || typeof current !== 'object') return unavailableResult(SOURCE, 'Invalid NOAA scales: missing current conditions', { ...META, metrics: {} }, now);
  const observedAt = typeof current.DateStamp === 'string' && typeof current.TimeStamp === 'string'
    ? providerTime(`${current.DateStamp}T${current.TimeStamp}`, { assumeUTC: true }) : null;
  const metrics = {};
  const observations = [];
  for (const [code, key, title] of SCALES) {
    const raw = current[code]?.Scale;
    if (!(typeof raw === 'string' && /^[0-5]$/.test(raw)) && !(Number.isInteger(raw) && raw >= 0 && raw <= 5)) {
      return unavailableResult(SOURCE, 'Invalid NOAA scale: expected a level from 0 to 5', { ...META, metrics: {} }, now);
    }
    const scale = Number(raw);
    metrics[key] = { scale, label: LEVELS[scale] };
    if (scale > 0) observations.push({
      kind: 'space-weather', title: `NOAA ${code}${scale} ${title}`,
      summary: `Current NOAA ${title} scale: ${code}${scale} (${LEVELS[scale]}). Global conditions; this feed does not identify a local impact site.`,
      source: SOURCE, url: SOURCE_URL, providerId: `${code}${scale}`, observedAt, publishedAt: observedAt,
      severity: SEVERITIES[scale], lat: null, lon: null, locationMethod: 'global', locationPrecision: 'unknown',
    });
  }
  const scaleSummaryHu = SCALES.map(([code, key]) => `${code}${metrics[key].scale} ${SCALES_HU[key] || key} (${LEVELS_HU[metrics[key].scale] || metrics[key].label})`).join('; ');
  const summary = `Aktuális NOAA skálák: ${scaleSummaryHu}. Jelenlegi állapotok, nem NOAA-előrejelzés.`;
  const out = freshResult(SOURCE, observedAt, observations, { ...META, metrics, summary }, now);
  if (out.stale) { out.metrics = {}; out.summary = 'A jelenlegi NOAA űridőjárási skálák nem érhetők el az 1 órás frissességi ablakban.'; }
  return out;
}

/**
 * Enhanced SWPC telemetry parser.
 * Combines scales with Kp, solar wind, X-ray flux, active alerts, and 3-day forecast.
 */
export function parseEnhancedSWPC(data, { now = Date.now(), notifyMin = parseSwpcNotifyThreshold() } = {}) {
  const rawScales = data.scales || data;
  const hasScales = rawScales && !rawScales.error && rawScales['0'] && typeof rawScales['0'] === 'object';
  const baseResult = hasScales
    ? parseSWPC(rawScales, { now })
    : {
        status: 'warning',
        observedAt: new Date(now).toISOString(),
        observations: [],
        metrics: {},
        summary: 'A NOAA skálák jelenleg nem érhetők el.'
      };

  const parsedKp = data.kp ? parseKpIndex(data.kp) : null;
  const parsedWind = (data.wind || data.mag) ? parseSolarWind(data.wind, data.mag) : null;
  const parsedXrays = data.xrays ? parseGoesXrays(data.xrays) : null;
  const parsedAlerts = data.alerts ? parseAlerts(data.alerts, { now }) : null;
  const parsedForecast = data.forecast ? parseForecast(typeof data.forecast === 'string' ? data.forecast : data.forecast.rawText) : null;

  // Extract 1-3 day solar flare & proton probabilities from noaa-scales.json
  const probabilities = [];
  if (hasScales) {
    for (const day of ['1', '2', '3']) {
      const dayData = rawScales[day];
      if (dayData && typeof dayData === 'object') {
        probabilities.push({
          day: Number(day),
          date: dayData.DateStamp || null,
          rMinorProb: dayData.R?.MinorProb ? Number(dayData.R.MinorProb) : null,
          rMajorProb: dayData.R?.MajorProb ? Number(dayData.R.MajorProb) : null,
          sProb: dayData.S?.Prob ? Number(dayData.S.Prob) : null,
          gScale: dayData.G?.Scale != null ? Number(dayData.G.Scale) : null
        });
      }
    }
  }

  const metrics = { ...baseResult.metrics };
  if (parsedKp) metrics.kp = parsedKp.kp;
  if (parsedWind?.speed != null) metrics.solarWindSpeed = parsedWind.speed;
  if (parsedWind?.bz != null) metrics.bz = parsedWind.bz;
  if (parsedXrays?.xrayClass) metrics.xrayClass = parsedXrays.xrayClass;
  if (parsedAlerts?.activeCount != null) metrics.activeAlertsCount = parsedAlerts.activeCount;
  if (parsedForecast?.maxExpectedKp != null) metrics.maxForecastKp = parsedForecast.maxExpectedKp;
  if (parsedForecast?.maxExpectedGScale) metrics.maxForecastG = parsedForecast.maxExpectedGScale;
  if (probabilities.length) metrics.probabilities = probabilities;

  const facts = [];
  if (parsedKp) facts.push({ label: 'kp', value: `${parsedKp.kp}` });
  if (parsedWind?.speed != null) facts.push({ label: 'solarWindSpeed', value: `${parsedWind.speed} km/s` });
  if (parsedWind?.bz != null) facts.push({ label: 'bz', value: `${parsedWind.bz} nT` });
  if (parsedXrays?.xrayClass) facts.push({ label: 'xrayClass', value: parsedXrays.xrayClass });
  if (metrics.radioBlackouts?.scale !== undefined) facts.push({ label: 'rScale', value: `R${metrics.radioBlackouts.scale}` });
  if (metrics.solarRadiationStorms?.scale !== undefined) facts.push({ label: 'sScale', value: `S${metrics.solarRadiationStorms.scale}` });
  if (metrics.geomagneticStorms?.scale !== undefined) facts.push({ label: 'gScale', value: `G${metrics.geomagneticStorms.scale}` });

  const observations = [...baseResult.observations];

  // Calibrate scale severity:
  // - G4+, R4+, S3+ trigger notification -> severity: 'high' (or 'critical')
  // - G3, R3, S2 are dashboard-only alerts -> severity: 'moderate' (watch level: rendered on dashboard, but does NOT trigger Telegram dispatch)
  for (const obs of observations) {
    const code = obs.providerId?.[0];
    const lvl = parseInt(obs.providerId?.slice(1), 10);
    if (!isNaN(lvl)) {
      const meetsNotify = (code === 'G' && lvl >= notifyMin.g) ||
                          (code === 'R' && lvl >= notifyMin.r) ||
                          (code === 'S' && lvl >= notifyMin.s);
      if (meetsNotify) {
        if (obs.severity !== 'critical') obs.severity = 'high';
      } else if ((code === 'G' && lvl >= 3) || (code === 'R' && lvl >= 3) || (code === 'S' && lvl >= 2)) {
        obs.severity = 'moderate';
      }
    }
  }

  // Active high severity alerts (G3+, R3+, S2+)
  if (parsedAlerts?.highSeverityAlerts?.length) {
    for (const hAlert of parsedAlerts.highSeverityAlerts) {
      const gLvl = hAlert.gLevel || 0;
      const rLvl = hAlert.rLevel || 0;
      const sLvl = hAlert.sLevel || 0;
      const alertCode = gLvl >= 3 ? `G${gLvl}` : (rLvl >= 3 ? `R${rLvl}` : `S${sLvl}`);
      const meetsNotify = (gLvl >= notifyMin.g) || (rLvl >= notifyMin.r) || (sLvl >= notifyMin.s);
      const alertSeverity = meetsNotify ? 'high' : 'moderate';

      if (!observations.some(o => o.providerId === alertCode)) {
        observations.push({
          kind: 'space-weather',
          title: `NOAA ${meetsNotify ? 'High' : 'Moderate'} Space Weather Alert ${alertCode}`,
          summary: `Active SWPC alert: ${hAlert.messageSnippet}`,
          source: SOURCE,
          url: SOURCE_URL,
          providerId: `alert-${alertCode}`,
          observedAt: baseResult.observedAt,
          publishedAt: baseResult.observedAt,
          severity: alertSeverity,
          lat: null,
          lon: null,
          locationMethod: 'global',
          locationPrecision: 'unknown'
        });
      }
    }
  }

  const summaryParts = hasScales ? [baseResult.summary] : ['A NOAA skálák jelenleg nem érhetők el.'];
  if (parsedKp) summaryParts.push(`Kp: ${parsedKp.kp}`);
  if (parsedWind?.speed != null) summaryParts.push(`Napszél: ${parsedWind.speed} km/s (Bz: ${parsedWind.bz ?? 0} nT)`);
  if (parsedXrays?.xrayClass) summaryParts.push(`Röntgen: ${parsedXrays.xrayClass}`);
  if (parsedForecast?.maxExpectedKp != null) summaryParts.push(`Várható max: Kp ${parsedForecast.maxExpectedKp} (${parsedForecast.maxExpectedGScale})`);

  const summary = summaryParts.join(' | ');

  const out = freshResult(SOURCE, baseResult.observedAt, observations, {
    ...META,
    metrics,
    summary,
    facts
  }, now);

  if (!hasScales) {
    out.status = 'warning';
  }

  if (out.stale) {
    out.metrics = {};
    out.summary = 'A jelenlegi NOAA űridőjárási telemetria nem érhető el az 1 órás frissességi ablakban.';
  }

  // Preserve parsed sub-structures so consumers have direct structured access
  out.wind = parsedWind;
  out.solarWind = parsedWind;
  out.xrays = parsedXrays;
  out.forecast = parsedForecast;
  out.alerts = parsedAlerts;
  out.kp = parsedKp;
  if (probabilities.length) out.probabilities = probabilities;

  return out;
}

/**
 * Briefing entry point.
 * By default (CRUCIX_ENABLE_SWPC !== 'true'), fetches scales only.
 * When CRUCIX_ENABLE_SWPC === 'true', fetches enhanced feeds concurrently with 403/429 handling.
 */
export async function briefing({
  now = Date.now(),
  enableEnhanced = (process.env.CRUCIX_ENABLE_SWPC === 'true'),
  notifyMin = parseSwpcNotifyThreshold()
} = {}) {
  const swpcHeaders = getSwpcHeaders();
  if (!enableEnhanced) {
    const data = await safeFetch(FEED_URL, { timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024, headers: swpcHeaders });
    return data?.error ? unavailableResult(SOURCE, data.error, { ...META, metrics: {} }, now) : parseSWPC(data, { now });
  }

  const [scalesRes, kpRes, windRes, magRes, xraysRes, alertsRes, forecastRes] = await Promise.allSettled([
    safeFetch(FEED_URL, { timeout: 10000, retries: 1, maxBytes: 2 * 1024 * 1024, headers: swpcHeaders }),
    safeFetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', { timeout: 10000, retries: 1, maxBytes: 2 * 1024 * 1024, headers: swpcHeaders }),
    safeFetch('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json', { timeout: 10000, retries: 1, maxBytes: 2 * 1024 * 1024, headers: swpcHeaders }),
    safeFetch('https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json', { timeout: 10000, retries: 1, maxBytes: 2 * 1024 * 1024, headers: swpcHeaders }),
    safeFetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json', { timeout: 10000, retries: 1, maxBytes: 2 * 1024 * 1024, headers: swpcHeaders }),
    safeFetch('https://services.swpc.noaa.gov/products/alerts.json', { timeout: 10000, retries: 1, maxBytes: 2 * 1024 * 1024, headers: swpcHeaders }),
    safeFetch('https://services.swpc.noaa.gov/text/3-day-forecast.txt', { timeout: 10000, retries: 1, maxBytes: 2 * 1024 * 1024, format: 'text', headers: swpcHeaders })
  ]);

  const scales = scalesRes.status === 'fulfilled' ? scalesRes.value : { error: scalesRes.reason?.message };
  const kp = kpRes.status === 'fulfilled' ? kpRes.value : null;
  const wind = windRes.status === 'fulfilled' ? windRes.value : null;
  const mag = magRes.status === 'fulfilled' ? magRes.value : null;
  const xrays = xraysRes.status === 'fulfilled' ? xraysRes.value : null;
  const alerts = alertsRes.status === 'fulfilled' ? alertsRes.value : null;
  const forecast = forecastRes.status === 'fulfilled' ? forecastRes.value : null;

  const anyTelemetrySucceeded = [kp, wind, mag, xrays, alerts, forecast].some(v => v && !v.error);

  if (scales?.error && !anyTelemetrySucceeded) {
    const isBlocked = /403|429/i.test(scales.error);
    const status = isBlocked ? 'disabled' : 'error';
    return unavailableResult(SOURCE, scales.error, { ...META, metrics: {}, status }, now);
  }

  return parseEnhancedSWPC({
    scales: scales?.error ? null : scales,
    kp,
    wind,
    mag,
    xrays,
    alerts,
    forecast
  }, { now, notifyMin });
}
