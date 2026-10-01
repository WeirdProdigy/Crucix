import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesize, buildNewsFeed } from '../dashboard/inject.mjs';

test('synthesis retains source IDs, times and honest geolocation provenance', async () => {
  const data = await synthesize({ crucix: { timestamp: '2026-10-01T12:00:00Z' }, sources: {
    NOAA: { topAlerts: [{ id: 'alert-1', url: 'https://api.weather.gov/alerts/alert-1', sent: '2026-10-01T10:00:00Z', onset: '2026-10-01T11:00:00Z', event: 'Flood', headline: 'Flood report', lat: 1, lon: 2, locationMethod: 'polygon-centroid', locationPrecision: 'approximate' }] },
    ACLED: { deadliestEvents: [{ id: 'conflict-1', date: '2026-10-01', type: 'Battle', lat: 0, lon: 2, notes: 'Original description', locationMethod: 'provider', locationPrecision: 'approximate' }] },
    IODA: { outages: { recentEvents: [{ id: 'outage-1', countryCode: 'HU', country: 'Hungary', startIso: '2026-10-01T09:00:00Z' }] } },
    WHO: { diseaseOutbreakNews: [{ title: 'Ukraine health alert', date: '2026-10-01', url: 'https://www.who.int/emergencies/disease-outbreak-news/item/test' }] },
  } }, { news: [] });
  assert.equal(data.noaa.alerts[0].id, 'alert-1');
  assert.equal(data.noaa.alerts[0].sent, '2026-10-01T10:00:00Z');
  assert.equal(data.noaa.alerts[0].locationMethod, 'polygon-centroid');
  assert.equal(data.acled.deadliestEvents[0].id, 'conflict-1');
  assert.equal(data.acled.deadliestEvents[0].lat, 0);
  assert.equal(data.acled.deadliestEvents[0].notes, 'Original description');
  assert.equal(data.ioda.recentEvents[0].id, 'outage-1');
  assert.equal(data.ioda.recentEvents[0].locationMethod, 'country-centroid');
  assert.equal(data.who[0].locationPrecision, 'approximate');
});

test('ticker preserves full title, source link, coordinates and separate provider time', () => {
  const title = 'Hungary ' + 'original source context '.repeat(10);
  const rss = { title, source: 'Feed', date: '2026-10-01T10:00:00Z', url: 'https://example.org/item', lat: 47.5, lon: 19.1, locationMethod: 'headline-keyword', locationPrecision: 'approximate' };
  const [item] = buildNewsFeed([rss], {}, [], []);
  assert.equal(item.headline, title);
  assert.equal(item.publishedAt, '2026-10-01T10:00:00.000Z');
  assert.equal(item.locationMethod, 'headline-keyword');
  assert.equal(item.lat, 47.5);
  assert.equal(item.observedAt ?? null, null);
});
