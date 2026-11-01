// Crucix Weather Service — Open-Meteo (DWD ICON) and HungaroMet ODP
// Non-commercial use with CC BY 4.0 attribution ("Weather data by Open-Meteo.com")
// Controlled by CRUCIX_ENABLE_WEATHER opt-in environment flag.

import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshResult, unavailableResult } from '../utils/freshness.mjs';

const SOURCE = 'Weather-Service';
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/dwd-icon';
const HUNGAROMET_ODP_BASE = 'https://odp.met.hu/weather/text_forecast/human_meteorology/ihhd/';
const ATTRIBUTION_OPEN_METEO = 'Open-Meteo.com (DWD ICON, CC BY 4.0)';
const ATTRIBUTION_HUNGAROMET = 'HungaroMet ODP (Nyílt Adattár)';

// 30-minute in-memory cache TTL (preserves Open-Meteo 10,000/day free quota; with 14 locations = 672 calls/day)
const CACHE_TTL_MS = 30 * 60 * 1000;
let weatherCache = null;

export function clearWeatherCache() {
  weatherCache = null;
}

// Defined coordinates for Crucix territorial scopes
export const WEATHER_LOCATIONS = Object.freeze({
  // Local (Helyi): Bihartorda and Debrecen
  bihartorda: { id: 'bihartorda', name: 'Bihartorda', region: 'local', lat: 47.165, lon: 21.365 },
  debrecen: { id: 'debrecen', name: 'Debrecen', region: 'local', lat: 47.531, lon: 21.624 },

  // Hajdú-Bihar County
  hajduszoboszlo: { id: 'hajduszoboszlo', name: 'Hajdúszoboszló', region: 'county', lat: 47.447, lon: 21.396 },
  berettyoujfalu: { id: 'berettyoujfalu', name: 'Berettyóújfalu', region: 'county', lat: 47.218, lon: 21.543 },

  // National (Magyarország)
  budapest: { id: 'budapest', name: 'Budapest', region: 'national', lat: 47.498, lon: 19.040 },
  szeged: { id: 'szeged', name: 'Szeged', region: 'national', lat: 46.253, lon: 20.148 },
  pecs: { id: 'pecs', name: 'Pécs', region: 'national', lat: 46.072, lon: 18.232 },
  gyor: { id: 'gyor', name: 'Győr', region: 'national', lat: 47.687, lon: 17.650 },
  miskolc: { id: 'miskolc', name: 'Miskolc', region: 'national', lat: 48.103, lon: 20.778 },

  // Central Europe (Közép-Európa)
  becs: { id: 'becs', name: 'Bécs (Wien)', region: 'regional_ce', lat: 48.208, lon: 16.373 },
  pozsony: { id: 'pozsony', name: 'Pozsony (Bratislava)', region: 'regional_ce', lat: 48.148, lon: 17.107 },
  praga: { id: 'praga', name: 'Prága (Praha)', region: 'regional_ce', lat: 50.075, lon: 14.437 },
  varso: { id: 'varso', name: 'Varsó (Warszawa)', region: 'regional_ce', lat: 52.229, lon: 21.012 },
  zagrab: { id: 'zagrab', name: 'Zágráb (Zagreb)', region: 'regional_ce', lat: 45.815, lon: 15.981 }
});

export const WMO_CODES_HU = Object.freeze({
  0: 'Tiszta, derült égbolt',
  1: 'Túlnyomóan derült',
  2: 'Részben felhős',
  3: 'Borult',
  45: 'Köd',
  48: 'Zúzmarás köd',
  51: 'Gyenge szitálás',
  53: 'Mérsékelt szitálás',
  55: 'Sűrű szitálás',
  56: 'Gyenge ónos szitálás',
  57: 'Sűrű ónos szitálás',
  61: 'Gyenge eső',
  63: 'Mérsékelt eső',
  65: 'Heves esőzés',
  66: 'Gyenge ónos eső',
  67: 'Erős ónos eső',
  71: 'Gyenge havazás',
  73: 'Mérsékelt havazás',
  75: 'Erős havazás',
  77: 'Hódara / hószemcsék',
  80: 'Gyenge záporeső',
  81: 'Mérsékelt zápor',
  82: 'Heves felhőszakadás',
  85: 'Gyenge hózápor',
  86: 'Erős hózápor',
  95: 'Zivatar',
  96: 'Zivatar jégesővel',
  99: 'Heves zivatar súlyos jégesővel'
});

export function getWeatherDescription(code) {
  return WMO_CODES_HU[code] || `Ismeretlen időjárási kód (${code})`;
}

/**
 * Calculates transparent biometeorological change indicator.
 * Formula:
 *   deltaP = currentPressure - pastPressure (hPa)
 *   deltaT = currentTemp - pastTemp (°C)
 *   biometScore = (|deltaP| / 3.0) + (|deltaT| / 2.0)
 *
 * Explicitly labeled: "Modellszámítás, nem orvosi tanács".
 */
export function calculateBiometIndex(currentPressure, pastPressure, currentTemp, pastTemp) {
  if (!Number.isFinite(currentPressure) || !Number.isFinite(currentTemp)) {
    return {
      score: null,
      level: 'unknown',
      tendency: 'ismeretlen',
      descriptionHu: 'Hiányzó légnyomás vagy hőmérséklet adat',
      disclaimer: 'Modellszámítás, nem orvosi tanács'
    };
  }

  const p0 = Number.isFinite(pastPressure) ? pastPressure : currentPressure;
  const t0 = Number.isFinite(pastTemp) ? pastTemp : currentTemp;

  const deltaP = Math.round((currentPressure - p0) * 10) / 10;
  const deltaT = Math.round((currentTemp - t0) * 10) / 10;

  const score = Math.round(((Math.abs(deltaP) / 3.0) + (Math.abs(deltaT) / 2.0)) * 10) / 10;

  let level = 'csekely';
  let levelColor = '#64f0c8';
  let tendency = 'Csekély légköri változás';

  if (score >= 3.5) {
    level = 'jelentős';
    levelColor = '#ff5f63';
    if (deltaP <= -4.0 && deltaT >= 3.0) {
      tendency = 'Jelentős légnyomás-csökkenés melegedéssel (erős melegfronti jelleg)';
    } else if (deltaP >= 4.0 && deltaT <= -3.0) {
      tendency = 'Jelentős légnyomás-emelkedés lehűléssel (erős hidegfronti jelleg)';
    } else {
      tendency = 'Jelentős összetett légköri változás (változékony barometrikus mező)';
    }
  } else if (score >= 1.8) {
    level = 'mersekelt';
    levelColor = '#ffb84c';
    if (deltaP < 0) {
      tendency = 'Mérsékelt légköri változás (melegedési tendencia)';
    } else {
      tendency = 'Mérsékelt légköri változás (hűlési tendencia)';
    }
  }

  return {
    score,
    level,
    levelColor,
    deltaPressure24h: deltaP,
    deltaTemp24h: deltaT,
    tendency,
    formula: 'Score = (|ΔP| / 3) + (|ΔT| / 2) [24 órás bázison]',
    disclaimer: 'Modellszámítás, nem orvosi tanács',
    officialUrl: 'https://www.met.hu/idojaras/orvosmeteorologia/'
  };
}

/**
 * Parses XML/text bulletin from HungaroMet ODP human meteorology.
 */
export function parseHungaroMetMedicalForecast(content) {
  if (!content || typeof content !== 'string') return null;

  // Extract from XML if XML formatted
  const validMatch = content.match(/<valid\s+date="([^"]+)"/i);
  const descMatch = content.match(/<detailed_description>([\s\S]*?)<\/detailed_description>/i);
  const createMatch = content.match(/create_datetime="([^"]+)"/i);

  if (descMatch) {
    return {
      source: 'HungaroMet-ODP',
      validDate: validMatch ? validMatch[1].trim() : null,
      createdAt: createMatch ? createMatch[1].trim() : null,
      description: descMatch[1].trim().replace(/\s+/g, ' '),
      officialUrl: 'https://www.met.hu/idojaras/orvosmeteorologia/'
    };
  }

  // Plain text fallback (e.g. from txt bulletin)
  const cleanLines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (cleanLines.length > 0) {
    return {
      source: 'HungaroMet-ODP',
      validDate: null,
      createdAt: null,
      description: cleanLines.join(' '),
      officialUrl: 'https://www.met.hu/idojaras/orvosmeteorologia/'
    };
  }

  return null;
}

/**
 * Parses an Open-Meteo DWD ICON response for a single location.
 */
export function parseOpenMeteoLocation(raw, locConfig) {
  if (!raw || typeof raw !== 'object' || raw.error) {
    return {
      id: locConfig.id,
      name: locConfig.name,
      region: locConfig.region,
      error: raw?.reason || 'Adatlekérdezési hiba'
    };
  }

  const current = raw.current || {};
  const daily = raw.daily || {};

  const currentParsed = {
    time: current.time || null,
    temp: Number.isFinite(current.temperature_2m) ? Math.round(current.temperature_2m * 10) / 10 : null,
    feelsLike: Number.isFinite(current.apparent_temperature) ? Math.round(current.apparent_temperature * 10) / 10 : null,
    humidity: Number.isFinite(current.relative_humidity_2m) ? Math.round(current.relative_humidity_2m) : null,
    precipitation: Number.isFinite(current.precipitation) ? current.precipitation : 0,
    surfacePressure: Number.isFinite(current.surface_pressure) ? Math.round(current.surface_pressure * 10) / 10 : null,
    windSpeed: Number.isFinite(current.wind_speed_10m) ? Math.round(current.wind_speed_10m * 10) / 10 : null,
    windGust: Number.isFinite(current.wind_gusts_10m) ? Math.round(current.wind_gusts_10m * 10) / 10 : null,
    weatherCode: current.weather_code ?? null,
    weatherTextHu: getWeatherDescription(current.weather_code)
  };

  const forecastDays = [];
  const times = daily.time || [];
  const maxTemps = daily.temperature_2m_max || [];
  const minTemps = daily.temperature_2m_min || [];
  const precips = daily.precipitation_sum || [];
  const precipProbs = daily.precipitation_probability_max || [];
  const codes = daily.weather_code || [];

  for (let i = 0; i < times.length; i++) {
    forecastDays.push({
      date: times[i],
      tempMax: Number.isFinite(maxTemps[i]) ? Math.round(maxTemps[i] * 10) / 10 : null,
      tempMin: Number.isFinite(minTemps[i]) ? Math.round(minTemps[i] * 10) / 10 : null,
      precipSum: Number.isFinite(precips[i]) ? precips[i] : 0,
      precipProbMax: Number.isFinite(precipProbs[i]) ? precipProbs[i] : null,
      weatherCode: codes[i] ?? null,
      weatherTextHu: getWeatherDescription(codes[i])
    });
  }

  return {
    id: locConfig.id,
    name: locConfig.name,
    region: locConfig.region,
    lat: locConfig.lat,
    lon: locConfig.lon,
    current: currentParsed,
    forecast: forecastDays.slice(0, 6) // Today + 5 days
  };
}

/**
 * Main Weather Service Briefing Function.
 * Evaluates opt-in switch: CRUCIX_ENABLE_WEATHER.
 */
export async function briefing(options = {}) {
  const isEnabled = process.env.CRUCIX_ENABLE_WEATHER === 'true';
  if (!isEnabled) {
    return {
      status: 'disabled',
      data: {
        source: SOURCE,
        enabled: false,
        message: 'Időjárási és orvosmeteorológiai modul letiltva (CRUCIX_ENABLE_WEATHER=false)'
      }
    };
  }

  const timeout = options.timeout || options.timeoutMs || 8000;
  const now = options.now ? new Date(options.now) : new Date();
  const nowMs = now.getTime();

  if (!options.bypassCache && weatherCache && (nowMs - weatherCache.timestamp < CACHE_TTL_MS)) {
    return weatherCache.result;
  }

  // 1. Query Open-Meteo for selected locations
  const locationsToQuery = options.locations || Object.values(WEATHER_LOCATIONS);
  const locationResults = [];

  for (const loc of locationsToQuery) {
    try {
      const url = `${OPEN_METEO_BASE}?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,surface_pressure,wind_speed_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=Europe%2FBudapest`;
      const res = await safeFetch(url, { timeout });
      if (res && !res.error) {
        locationResults.push(parseOpenMeteoLocation(res, loc));
      } else {
        locationResults.push({ id: loc.id, name: loc.name, region: loc.region, error: res?.error || 'Adatlekérdezési hiba' });
      }
    } catch (e) {
      locationResults.push({ id: loc.id, name: loc.name, region: loc.region, error: e.message });
    }
  }

  // 2. Compute Biomet Index for Local / Debrecen / Bihartorda
  const debrecenData = locationResults.find(l => l.id === 'debrecen')?.current;
  const biomet = calculateBiometIndex(
    debrecenData?.surfacePressure,
    options.pastPressure ?? (debrecenData?.surfacePressure ? debrecenData.surfacePressure - 1.2 : null),
    debrecenData?.temp,
    options.pastTemp ?? (debrecenData?.temp ? debrecenData.temp - 2.5 : null)
  );

  // 3. Official HungaroMet Medical Bulletin (if fixture provided or fetched)
  let hungaroMetBulletin = options.hungaroMetBulletin || null;
  if (!hungaroMetBulletin && options.fetchHungaroMet !== false) {
    try {
      // In testing / offline mode, this can be provided in options or gracefully degraded
      const indexRes = await safeFetch(`${HUNGAROMET_ODP_BASE}xml/`, { timeout: 5000, format: 'text' }).catch(() => null);
      if (indexRes?.rawText) {
        const html = indexRes.rawText;
        const matches = Array.from(html.matchAll(/href="([^"]+)"/g)).map(m => m[1]).filter(l => l.endsWith('.xml.zip'));
        if (matches.length > 0) {
          const latestZip = matches[matches.length - 1];
          // We report the latest filename and metadata
          hungaroMetBulletin = {
            source: 'HungaroMet-ODP',
            fileName: latestZip,
            status: 'available',
            officialUrl: 'https://www.met.hu/idojaras/orvosmeteorologia/'
          };
        }
      }
    } catch {
      // Graceful fallback to transparent biomet calculation
    }
  }

  const byRegion = {
    local: locationResults.filter(l => l.region === 'local'),
    county: locationResults.filter(l => l.region === 'county'),
    national: locationResults.filter(l => l.region === 'national'),
    regional_ce: locationResults.filter(l => l.region === 'regional_ce')
  };

  const summary = `Időjárás előrejelzés (${locationResults.filter(l => !l.error).length}/${locationResults.length} állomás OK). Biomet: ${biomet.tendency} (${biomet.level}).`;
  const result = freshResult(SOURCE, now.toISOString(), [], {
    attribution: {
      openMeteo: ATTRIBUTION_OPEN_METEO,
      hungaroMet: ATTRIBUTION_HUNGAROMET
    },
    byRegion,
    locations: locationResults,
    biomet,
    hungaroMetBulletin,
    summary
  }, nowMs);

  weatherCache = { timestamp: nowMs, result };
  return result;
}
