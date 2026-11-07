import { safeFetch } from '../utils/fetch.mjs';

export const SOURCE = 'OVF-Drought';
export const DEFAULT_STATION_ID = '22676D52-3F45-48BF-A75C-8024905FD3D4';
export const DEFAULT_STATION_NAME = 'Mezősas';
export const DEFAULT_DISTANCE_KM = 11.9;
export const DEFAULT_POLL_INTERVAL_MS = 30 * 60 * 1000;
export const ENDPOINT_URL = 'https://aszalymonitoring.vizugy.hu/api.php';

const HOURLY_FRESH_MS = 180 * 60 * 1000;
const DAILY_FRESH_MS = 36 * 60 * 60 * 1000;
const WATER_DEFICIT_FRESH_MS = 72 * 60 * 60 * 1000; // 72 óra: az OVF vízhiány réteg számítása ~2 napos modellszámítási késéssel érkezik
const DEPTHS = ['10cm', '20cm', '30cm', '45cm', '60cm', '75cm'];
const WATER_DEFICIT_DEPTHS = ['35cm', '80cm'];

let droughtState = null;
let pollingTimer = null;

function nowMs(value) {
  const parsed = value === undefined ? Date.now() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function parseValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = parseFloat(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

function pointTimestamp(point) {
  if (!point || typeof point !== 'object') return null;
  const epoch = Number(point.msec);
  if (Number.isFinite(epoch) && epoch > 0) return new Date(epoch).toISOString();
  if (point.date) {
    const parsed = new Date(point.date).getTime();
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function pointTimeMs(point) {
  const timestamp = pointTimestamp(point);
  return timestamp ? new Date(timestamp).getTime() : null;
}

function latestValid(series) {
  if (!Array.isArray(series)) return { value: null, timestamp: null };
  const valid = series
    .map(point => ({ point, value: parseValue(point?.value), time: pointTimeMs(point) }))
    .filter(item => item.value !== null)
    .sort((a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity));
  const item = valid[0];
  return item ? { value: item.value, timestamp: item.time === null ? null : new Date(item.time).toISOString() } : { value: null, timestamp: null };
}

function findGroup(groups, name) {
  return groups.find(group => group?.rawname === name) || {};
}

function seriesValue(group, index = 0) {
  return latestValid(Array.isArray(group?.data) ? group.data[index] : null);
}

function groupTimestamp(group) {
  const points = Array.isArray(group?.data) ? group.data.flat() : [];
  return latestValid(points).timestamp;
}

function metricFresh(metric, now, threshold) {
  return metric.value !== null && metric.timestamp !== null && now - new Date(metric.timestamp).getTime() <= threshold;
}

function metricBlock(metric, unit, fresh) {
  return { value: metric.value, unit, timestamp: metric.timestamp, fresh };
}

export function parseOvfDroughtResponse(json, options = {}) {
  const now = nowMs(options.now);
  const input = typeof json === 'string' ? (() => {
    try { return JSON.parse(json); } catch { return null; }
  })() : json;
  const groups = Array.isArray(input?.entries?.data) ? input.entries.data : [];

  const soilMoistureGroup = findGroup(groups, 'TalajNedv10');
  const soilTemperatureGroup = findGroup(groups, 'Talajho10');
  const waterDeficitGroup = findGroup(groups, 'WD35');
  const air = seriesValue(findGroup(groups, 'Legho'));
  const precipitation = seriesValue(findGroup(groups, 'Csapadek60'));
  const humidity = seriesValue(findGroup(groups, 'Legnedvesseg'));
  const drought = seriesValue(findGroup(groups, 'HDIs'));

  const soilMoisture = {};
  const soilTemperature = {};
  const waterDeficit = {};
  const timestamps = [];
  let allFresh = true;
  let measurementCount = 0;

  for (const [index, depth] of DEPTHS.entries()) {
    const moisture = seriesValue(soilMoistureGroup, index);
    const temperature = seriesValue(soilTemperatureGroup, index);
    soilMoisture[depth] = moisture.value;
    soilTemperature[depth] = temperature.value;
    for (const metric of [moisture, temperature]) {
      if (metric.value !== null) {
        measurementCount++;
        allFresh = allFresh && metricFresh(metric, now, HOURLY_FRESH_MS);
      }
      if (metric.timestamp) timestamps.push(metric.timestamp);
    }
  }

  for (const [index, depth] of WATER_DEFICIT_DEPTHS.entries()) {
    const deficit = seriesValue(waterDeficitGroup, index);
    waterDeficit[depth] = deficit.value;
    if (deficit.value !== null) {
      measurementCount++;
      allFresh = allFresh && metricFresh(deficit, now, WATER_DEFICIT_FRESH_MS);
    }
    if (deficit.timestamp) timestamps.push(deficit.timestamp);
  }

  const scalarMetrics = [
    [air, HOURLY_FRESH_MS],
    [precipitation, HOURLY_FRESH_MS],
    [humidity, HOURLY_FRESH_MS],
    [drought, DAILY_FRESH_MS]
  ];
  for (const [metric, threshold] of scalarMetrics) {
    if (metric.value !== null) {
      measurementCount++;
      allFresh = allFresh && metricFresh(metric, now, threshold);
    }
    if (metric.timestamp) timestamps.push(metric.timestamp);
  }

  const lastUpdated = timestamps.length ? new Date(Math.max(...timestamps.map(timestamp => new Date(timestamp).getTime()))).toISOString() : null;
  const station = {
    id: options.stationId || process.env.CRUCIX_OVF_DROUGHT_STATION_ID || DEFAULT_STATION_ID,
    name: options.stationName || DEFAULT_STATION_NAME,
    distanceKm: DEFAULT_DISTANCE_KM
  };

  const primaryMoisture = seriesValue(soilMoistureGroup, DEPTHS.indexOf('10cm'));
  const hasPrimaryMoisture = primaryMoisture.value !== null;
  const hasDroughtIndex = drought.value !== null;
  const isPrimaryMoistureFresh = hasPrimaryMoisture && metricFresh(primaryMoisture, now, HOURLY_FRESH_MS);
  const isDroughtIndexFresh = hasDroughtIndex && metricFresh(drought, now, DAILY_FRESH_MS);

  // Primary freshness: tile badge is based on primary drought metrics (TalajNedv10, HDIs).
  const isFresh = (hasPrimaryMoisture || hasDroughtIndex) &&
    (!hasPrimaryMoisture || isPrimaryMoistureFresh) &&
    (!hasDroughtIndex || isDroughtIndexFresh);

  return {
    station,
    soilMoisture: { ...soilMoisture, unit: 'V/V %', timestamp: groupTimestamp(soilMoistureGroup) || lastUpdated, fresh: DEPTHS.some(depth => soilMoisture[depth] !== null) && DEPTHS.filter(depth => soilMoisture[depth] !== null).every(depth => {
      const metric = seriesValue(soilMoistureGroup, DEPTHS.indexOf(depth));
      return metricFresh(metric, now, HOURLY_FRESH_MS);
    }) },
    soilTemperature: { ...soilTemperature, unit: '°C', timestamp: groupTimestamp(soilTemperatureGroup) || lastUpdated, fresh: DEPTHS.some(depth => soilTemperature[depth] !== null) && DEPTHS.filter(depth => soilTemperature[depth] !== null).every(depth => metricFresh(seriesValue(soilTemperatureGroup, DEPTHS.indexOf(depth)), now, HOURLY_FRESH_MS)) },
    droughtIndex: { value: drought.value, unit: '', timestamp: drought.timestamp, fresh: metricFresh(drought, now, DAILY_FRESH_MS) },
    waterDeficit: { ...waterDeficit, unit: 'mm', timestamp: groupTimestamp(waterDeficitGroup) || lastUpdated, fresh: WATER_DEFICIT_DEPTHS.some(depth => waterDeficit[depth] !== null) && WATER_DEFICIT_DEPTHS.filter(depth => waterDeficit[depth] !== null).every(depth => metricFresh(seriesValue(waterDeficitGroup, WATER_DEFICIT_DEPTHS.indexOf(depth)), now, WATER_DEFICIT_FRESH_MS)) },
    precipitation: metricBlock(precipitation, 'mm', metricFresh(precipitation, now, HOURLY_FRESH_MS)),
    airTemperature: metricBlock(air, '°C', metricFresh(air, now, HOURLY_FRESH_MS)),
    relativeHumidity: metricBlock(humidity, '%', metricFresh(humidity, now, HOURLY_FRESH_MS)),
    lastUpdated,
    isFresh,
    allLayersFresh: measurementCount > 0 && allFresh,
    isFixture: Boolean(options.isFixture || options.fixtureJson || options.fixtureData),
    enabled: true
  };
}

export function getOvfDroughtState() {
  return droughtState;
}

export async function fetchOvfDroughtData(options = {}) {
  if (process.env.CRUCIX_ENABLE_OVF_DROUGHT !== 'true') {
    return { enabled: false, status: 'disabled', message: 'OVF aszálymonitoring letiltva (CRUCIX_ENABLE_OVF_DROUGHT=false)' };
  }
  const now = nowMs(options.now);
  try {
    const fixture = options.fixtureJson ?? options.fixtureData;
    const response = fixture ?? await safeFetch(`${ENDPOINT_URL}?${new URLSearchParams({
      view: 'pattern',
      voa: options.stationId || process.env.CRUCIX_OVF_DROUGHT_STATION_ID || DEFAULT_STATION_ID
    })}`, { timeout: options.timeoutMs || 10000, signal: options.signal });
    const body = fixture ? response : (response?.body || response?.json || response);
    const parsed = parseOvfDroughtResponse(body, { ...options, now });
    droughtState = parsed;
    return parsed;
  } catch (error) {
    return { enabled: true, status: 'error', error: error.message };
  }
}

export function startOvfDroughtPolling(options = {}) {
  if (process.env.CRUCIX_ENABLE_OVF_DROUGHT !== 'true' || pollingTimer) return pollingTimer;
  const interval = Number(options.pollIntervalMs || process.env.CRUCIX_OVF_DROUGHT_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
  const poll = () => fetchOvfDroughtData(options).catch(error => console.error(`[${SOURCE}] Poll failed:`, error.message));
  poll();
  pollingTimer = setInterval(poll, Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_POLL_INTERVAL_MS);
  pollingTimer.unref?.();
  return pollingTimer;
}

export function stopOvfDroughtPolling() {
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = null;
}
