// NOAA / National Weather Service — Severe weather alerts & climate events
// No auth required. Real-time alerts.

import { safeFetch } from '../utils/fetch.mjs';

const NWS_BASE = 'https://api.weather.gov';

// Get all active weather alerts (US)
export async function getActiveAlerts(opts = {}) {
  const {
    severity = null,  // Extreme, Severe, Moderate, Minor
    urgency = null,   // Immediate, Expected, Future
    event = null,     // e.g. "Tornado Warning", "Hurricane Warning"
  } = opts;

  // NWS /alerts/active does not support limit; totals must cover all active alerts.
  const params = new URLSearchParams({ status: 'actual' });
  if (severity) params.set('severity', severity);
  if (urgency) params.set('urgency', urgency);
  if (event) params.set('event', event);

  return safeFetch(`${NWS_BASE}/alerts/active?${params}`, {
    headers: { 'Accept': 'application/geo+json' },
  });
}

// Get severe alerts only
export async function getSevereAlerts() {
  return getActiveAlerts({ severity: 'Extreme,Severe' });
}

// Briefing — severe weather events that could impact markets/supply chains
export async function briefing() {
  const alerts = await getSevereAlerts();
  const source = 'NOAA/NWS';
  const timestamp = new Date().toISOString();
  if (alerts?.error) {
    return { source, timestamp, error: alerts.error, ...(alerts.status ? { status: alerts.status } : {}) };
  }
  if (!Array.isArray(alerts?.features) || alerts.features.some(feature => !feature || typeof feature !== 'object')) {
    return { source, timestamp, error: 'Invalid NOAA/NWS alert response: expected a features array' };
  }
  const features = alerts.features;

  // Categorize by impact type
  const hurricanes = features.filter(f => /hurricane|typhoon|tropical/i.test(f.properties?.event));
  const tornadoes = features.filter(f => /tornado/i.test(f.properties?.event));
  const floods = features.filter(f => /flood/i.test(f.properties?.event));
  const winter = features.filter(f => /blizzard|ice storm|winter/i.test(f.properties?.event));
  const fire = features.filter(f => /fire/i.test(f.properties?.event));
  const other = features.filter(f => {
    const e = f.properties?.event || '';
    return !/hurricane|typhoon|tropical|tornado|flood|blizzard|ice storm|winter|fire/i.test(e);
  });

  return {
    source,
    timestamp,
    totalSevereAlerts: features.length,
    summary: {
      hurricanes: hurricanes.length,
      tornadoes: tornadoes.length,
      floods: floods.length,
      winterStorms: winter.length,
      wildfires: fire.length,
      other: other.length,
    },
    topAlerts: features.slice(0, 15).map(f => {
      // Extract centroid from GeoJSON geometry
      let lat = null, lon = null;
      const geo = f.geometry;
      if (geo?.type === 'Polygon' && geo.coordinates?.[0]?.length) {
        const coords = geo.coordinates[0];
        lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      } else if (geo?.type === 'MultiPolygon' && geo.coordinates?.length) {
        const coords = geo.coordinates[0][0];
        lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      } else if (geo?.type === 'Point') {
        [lon, lat] = geo.coordinates;
      }
      return {
        id: f.id || f.properties?.id || null,
        url: f.id || f.properties?.id || null,
        sent: f.properties?.sent || null,
        event: f.properties?.event,
        severity: f.properties?.severity,
        urgency: f.properties?.urgency,
        headline: f.properties?.headline,
        areas: f.properties?.areaDesc,
        onset: f.properties?.onset,
        expires: f.properties?.expires,
        lat: lat != null ? +lat.toFixed(3) : null,
        lon: lon != null ? +lon.toFixed(3) : null,
        locationMethod: geo?.type === 'Point' ? 'provider' : geo ? 'polygon-centroid' : 'unknown',
        locationPrecision: geo?.type === 'Point' ? 'exact' : geo ? 'approximate' : 'unknown',
      };
    }),
  };
}

if (process.argv[1]?.endsWith('noaa.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
