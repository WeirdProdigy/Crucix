// Automatic model forecasts, not station measurements. Model issue time drives freshness.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';

const SOURCE = 'MET-Norway';
const BASE_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const SOURCE_URL = 'https://api.met.no/doc/Locationforecast';
const HOUR = 3600000;
const DEFAULT_LOCATION = Object.freeze({label:'Budapest',lat:47.4979,lon:19.0402});
const CACHE = new Map();
const META = { url:SOURCE_URL, attribution:'MET Norway (Norwegian Meteorological Institute); selected forecast fields and summary adapted by Crucix',
  license:'CC BY 4.0', licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
  forecastNote:'Automatic model forecast at a configured point, not a measured weather observation.' };

export function normalizeLocations(locations = [DEFAULT_LOCATION]) {
  if (!Array.isArray(locations) || !locations.length || locations.length > 5) throw new Error('Configure 1 to 5 forecast locations');
  return locations.map(location=>{
    const {label,lat,lon} = location || {};
    if (typeof label !== 'string' || !label.trim() || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)
        || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Invalid forecast location: label and numeric geographic coordinates required');
    // MET requires at most four decimals in location requests. Truncation also bounds cache keys.
    return {label:label.trim(),lat:Math.trunc(lat*10000)/10000,lon:Math.trunc(lon*10000)/10000};
  });
}

function urlFor(location) {
  return `${BASE_URL}?${new URLSearchParams({lat:String(location.lat),lon:String(location.lon)})}`;
}
function unit(raw) { return typeof raw === 'string' && raw.length <= 40 && !/[\u0000-\u001f\u007f]/.test(raw) ? raw : null; }
function metric(raw, nonnegative = false) { return Number.isFinite(raw) && (!nonnegative || raw >= 0) ? raw : null; }

function normalizeForecast(data, location) {
  if (data?.type !== 'Feature' || !data.properties?.meta || !Array.isArray(data.properties.timeseries)) throw new Error('Invalid MET location forecast response');
  const observedAt = providerTime(data.properties.meta.updated_at);
  const rawUnits = data.properties.meta.units || {};
  const units = {temperature:unit(rawUnits.air_temperature),windSpeed:unit(rawUnits.wind_speed),precipitation:unit(rawUnits.precipitation_amount)};
  const rows = [];
  for (const step of data.properties.timeseries.slice(0,100)) {
    const forecastAt = providerTime(step?.time);
    if (!forecastAt) continue;
    const details = step?.data?.instant?.details;
    if (!details || typeof details !== 'object') continue;
    const period = [1,6,12].find(hours=>step.data[`next_${hours}_hours`] && typeof step.data[`next_${hours}_hours`] === 'object');
    if (!period) continue;
    const interval = step.data[`next_${period}_hours`];
    const validUntil = new Date(Date.parse(forecastAt)+period*HOUR).toISOString();
    const temperature = metric(details.air_temperature);
    const windSpeed = metric(details.wind_speed,true);
    const precipitation = metric(interval.details?.precipitation_amount,true);
    const symbol = typeof interval.summary?.symbol_code === 'string' && /^[a-z0-9_]{1,80}$/.test(interval.summary.symbol_code) ? interval.summary.symbol_code : null;
    const values = [temperature === null ? null : `temperature ${temperature} ${units.temperature ?? '(unit unavailable)'}`,
      windSpeed === null ? null : `wind ${windSpeed} ${units.windSpeed ?? '(unit unavailable)'}`,
      precipitation === null ? null : `precipitation ${precipitation} ${units.precipitation ?? '(unit unavailable)'} over ${period} hour${period === 1 ? '' : 's'}`].filter(Boolean);
    rows.push({kind:'forecast',title:`Weather forecast for ${location.label}`,
      summary:`Forecast target ${forecastAt}; model issued ${observedAt ?? 'unknown'}: ${values.join('; ') || 'weather values unavailable'}${symbol ? `; ${symbol.replaceAll('_',' ')}` : ''}. Model forecast, not a measured observation.`,
      source:SOURCE,url:urlFor(location),providerId:`${location.lat},${location.lon}@${forecastAt}`,observedAt,publishedAt:observedAt,forecastAt,validUntil,
      temperature,windSpeed,precipitation,precipitationHours:period,units,symbol,severity:'monitor',
      location:location.label,lat:location.lat,lon:location.lon,locationMethod:'configured-point',locationPrecision:'approximate'});
  }
  return {observedAt,rows};
}

function resultFor(normalized, now) {
  const near = normalized.rows.filter(row=>Math.abs(Date.parse(row.forecastAt)-now) <= HOUR && Date.parse(row.validUntil) > now)
    .sort((a,b)=>Math.abs(Date.parse(a.forecastAt)-now)-Math.abs(Date.parse(b.forecastAt)-now) || Date.parse(a.forecastAt)-Date.parse(b.forecastAt));
  const selected = near.slice(0,1).map(row=>({...row,units:{...row.units}}));
  const out = freshResult(SOURCE,normalized.observedAt,selected,META,now);
  out.forecasts = out.observations;
  out.metrics = out.observations.length ? {temperature:out.observations[0].temperature,windSpeed:out.observations[0].windSpeed,
    precipitation:out.observations[0].precipitation,units:out.observations[0].units} : {};
  out.summary = out.observations[0]?.summary || (out.stale ? 'MET Norway model issue time is missing or outside the eight-hour freshness window.' : 'No unexpired forecast target within one hour of collection time.');
  return out;
}

export function parseMetForecast(data, { now = Date.now(), location = DEFAULT_LOCATION } = {}) {
  try { return resultFor(normalizeForecast(data,normalizeLocations([location])[0]),now); }
  catch (error) { return unavailableResult(SOURCE,error.message,{...META,forecasts:[],metrics:{}},now); }
}

async function getLocation(location, now) {
  const key = `${location.lat},${location.lon}`;
  const cached = CACHE.get(key);
  if (cached && now >= cached.collectedAt && now-cached.collectedAt < HOUR
      && freshness(cached.normalized.observedAt,POLICIES[SOURCE].maxAgeMs,now).fresh) {
    // Labels may differ for the same coordinates; do not retain a previous user's label.
    const rows = cached.normalized.rows.map(row=>({...row,location:location.label,title:`Weather forecast for ${location.label}`}));
    return resultFor({...cached.normalized,rows},now);
  }
  CACHE.delete(key);
  const data = await safeFetch(urlFor(location),{timeout:10000,retries:0,maxBytes:2*1024*1024,
    headers:{'User-Agent':'Crucix/2.7 (https://github.com/mp3pintyo/Crucix)'}});
  if (data?.error) return unavailableResult(SOURCE,data.error,{...META,forecasts:[],metrics:{}},now);
  try {
    const normalized = normalizeForecast(data,location);
    const out = resultFor(normalized,now);
    if (!out.stale) {
      if (CACHE.size >= 25) CACHE.delete(CACHE.keys().next().value);
      CACHE.set(key,{collectedAt:now,normalized}); // Only bounded, normalized fields are cached.
    }
    return out;
  } catch (error) { return unavailableResult(SOURCE,error.message,{...META,forecasts:[],metrics:{}},now); }
}

export async function briefing({ now = Date.now(), locations } = {}) {
  let selected;
  try { selected = normalizeLocations(locations); }
  catch (error) { return unavailableResult(SOURCE,error.message,{...META,forecasts:[],metrics:{}},now); }
  const pending = new Map();
  const results = await Promise.all(selected.map(async location=>{
    const key = `${location.lat},${location.lon}`;
    if (!pending.has(key)) pending.set(key,getLocation(location,now));
    const result = await pending.get(key);
    return {...result,observations:result.observations.map(row=>({...row,units:{...row.units},location:location.label,title:`Weather forecast for ${location.label}`}))};
  }));
  if (results.length === 1) return results[0];
  const available = results.filter(result=>result.status === 'ok');
  const locationStatus = results.map((result,index)=>({location:selected[index].label,status:result.status,observedAt:result.observedAt,error:result.error ?? null}));
  if (!available.length) {
    const stale = results.find(result=>result.status === 'stale');
    return stale ? {...stale,locationStatus} : unavailableResult(SOURCE,'MET Norway forecasts unavailable for configured locations',{...META,forecasts:[],metrics:{},locationStatus},now);
  }
  // The oldest available model issue time governs the combined envelope.
  const observedAt = available.map(result=>result.observedAt).sort()[0];
  const out = freshResult(SOURCE,observedAt,available.flatMap(result=>result.observations),{...META,locationStatus},now);
  out.forecasts = out.observations;
  out.summary = out.observations.map(row=>`${row.location}: ${row.summary}`).join(' ').slice(0,2000);
  out.metrics = {locations:available.length,forecasts:out.observations.length};
  return out;
}
