// USGS Earthquake Hazards Program — significant events in the past-day feed.
// This feed is not a complete catalog of all earthquakes above a magnitude cutoff.
import { safeFetch } from '../utils/fetch.mjs';

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson';
const FEED_LABEL = 'USGS significant earthquakes in the past day';

export async function getRecentEarthquakes({ timeout = 10000, retries = 1 } = {}) {
  return safeFetch(FEED_URL, { timeout, retries, maxBytes: 2 * 1024 * 1024 });
}

function isoTime(value) {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function externalUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

function normalizeEarthquake(feature) {
  if (!feature || feature.geometry?.type !== 'Point') return null;
  const properties = feature.properties;
  const coordinates = feature.geometry.coordinates;
  if (!properties || !Array.isArray(coordinates)) return null;
  const [lon, lat, depth] = coordinates;
  const time = isoTime(properties.time);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180 || !Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(properties.mag) || !time) return null;

  const depthKm = Number.isFinite(depth) ? depth : null;
  return {
    id: typeof feature.id === 'string' ? feature.id : null,
    magnitude: properties.mag,
    place: typeof properties.place === 'string' ? properties.place : 'Location not provided',
    title: typeof properties.title === 'string' ? properties.title : null,
    time,
    lat,
    lon,
    coordinates: [lon, lat, depthKm],
    depth: depthKm,
    // The GeoJSON flag does not establish that a tsunami warning was issued.
    tsunamiFlag: properties.tsunami === 1,
    url: externalUrl(properties.url),
    felt: Number.isFinite(properties.felt) && properties.felt >= 0 ? properties.felt : null,
    cdi: Number.isFinite(properties.cdi) ? properties.cdi : null,
  };
}

export async function briefing() {
  const data = await getRecentEarthquakes();
  const meta = {
    source: 'USGS',
    timestamp: new Date().toISOString(),
    feed: 'significant_day',
    feedLabel: FEED_LABEL,
    feedUrl: FEED_URL,
  };
  if (data?.error) return { ...meta, error: data.error, ...(data.status ? { status: data.status } : {}) };
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    return { ...meta, error: 'Invalid USGS response: expected a GeoJSON FeatureCollection' };
  }

  const earthquakes = data.features.map(normalizeEarthquake).filter(Boolean)
    .sort((a, b) => b.magnitude - a.magnitude || Date.parse(b.time) - Date.parse(a.time));
  const discardedFeatures = data.features.length - earthquakes.length;
  if (data.features.length > 0 && earthquakes.length === 0) {
    return { ...meta, error: 'USGS feed contains no valid earthquake features', discardedFeatures };
  }

  return {
    ...meta,
    generated: isoTime(data.metadata?.generated),
    // Counts refer only to this feed; rejected features remain explicitly visible.
    totalEarthquakes: data.features.length,
    validEarthquakes: earthquakes.length,
    discardedFeatures,
    earthquakes,
    tsunamiFlagNote: 'USGS event flag only; an issued tsunami warning is not established by this feed.',
    signals: earthquakes.length
      ? earthquakes.slice(0, 5).map(event => `M${event.magnitude.toFixed(1)} earthquake: ${event.place}${event.tsunamiFlag ? ' (USGS tsunami flag set)' : ''}`)
      : ['No events in the USGS significant earthquakes feed for the past day.'],
  };
}

if (process.argv[1]?.endsWith('usgs.mjs')) {
  console.log(JSON.stringify(await briefing(), null, 2));
}
