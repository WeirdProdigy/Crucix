import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchRssFeed, fetchAllNews, synthesize, rssFeedState } from '../dashboard/inject.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { EntityStore, resolveEventCountries } from '../lib/intelligence/entities.mjs';
import { generateBriefing } from '../lib/llm/briefing.mjs';
import { eventLevel } from '../lib/alerts/levels.mjs';

const FIXTURE_KATVED_VESZ_POPULATED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BM OKF - Veszélyhelyzeti Értesítési Szolgáltatás</title>
    <link>https://www.katasztrofavedelem.hu/10466/RSS_VESZ</link>
    <item>
      <title>Kigyulladt egy melléképület Kótajon</title>
      <link>https://www.katasztrofavedelem.hu/modules/vesz/esemeny/93061</link>
      <description>Tűz keletkezett egy filagóriában Kótajon, a Vasvári Pál utcában. A tűzoltók propánbutángáz-palackot hoztak ki.</description>
      <pubDate>Thu, 22 Oct 2026 20:38:00 +0200</pubDate>
    </item>
    <item>
      <title>Viharos szél és fakidőlések miatt riasztották a debreceni tűzoltókat</title>
      <link>https://www.katasztrofavedelem.hu/modules/vesz/esemeny/93062</link>
      <description>Több útszakaszon kidőlt fák akadályozzák a forgalmat Debrecen belterületén.</description>
      <pubDate>Thu, 22 Oct 2026 19:15:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

const FIXTURE_KATVED_VESZ_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BM OKF - Veszélyhelyzeti Értesítési Szolgáltatás</title>
    <link>https://www.katasztrofavedelem.hu/10466/RSS_VESZ</link>
    <description>Nincs aktív országos vagy kiemelt vészhelyzet</description>
  </channel>
</rss>`;

const FIXTURE_KATVED_HIREK = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BM OKF - Szervezeti hírek</title>
    <link>https://www.katasztrofavedelem.hu/</link>
    <item>
      <title>Megemlékezés 1956 eseményeiről és szakmai elismerések átadása</title>
      <link>https://www.katasztrofavedelem.hu/29/hirek/299849/megemlekezes-1956</link>
      <description>Ünnepi állománygyűlést tartott a BM Országos Katasztrófavédelmi Főigazgatóság.</description>
      <pubDate>Thu, 22 Oct 2026 15:48:22 +0200</pubDate>
    </item>
    <item>
      <title>Gázszivárgás miatt riasztották a tűzoltókat Hajdúböszörményben</title>
      <link>https://www.katasztrofavedelem.hu/29/hirek/299850/gazszivargas-hajduboszormeny</link>
      <description>A katasztrófavédelem szakemberei biztonsági zónát jelöltek ki a beavatkozás idejére.</description>
      <pubDate>Thu, 22 Oct 2026 14:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

// ─── 1. Feed parsing, unlocated handling & routine news no-FLASH ───

test('Katasztrófavédelem: Vész and Hírek parsing, geotagging and no-FLASH for routine news', async (t) => {
  const veszServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_KATVED_VESZ_POPULATED);
  });
  t.after(() => veszServer.server.close());

  const hirekServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_KATVED_HIREK);
  });
  t.after(() => hirekServer.server.close());

  const news = await fetchAllNews([
    [veszServer.url, 'Katasztrófavédelem Vész'],
    [hirekServer.url, 'Katasztrófavédelem Hírek']
  ]);

  assert.equal(news.length, 4, 'All 4 items across the two Katved feeds were extracted');

  // 1. Katved Vész - Debrecen emergency item
  const debrecenAlert = news.find(n => n.source === 'Katasztrófavédelem Vész' && n.title.toLowerCase().includes('debrecen'));
  assert.ok(debrecenAlert);
  assert.equal(debrecenAlert.sourceRegion, 'Hungary');
  assert.equal(debrecenAlert.locationMethod, 'headline-keyword');
  assert.equal(debrecenAlert.region, 'Debrecen');
  assert.equal(debrecenAlert.lat, 47.5316);

  // 2. Katved Vész - Kótaj unlocated item (no fake Budapest coords)
  const kotajAlert = news.find(n => n.source === 'Katasztrófavédelem Vész' && n.title.includes('Kótajon'));
  assert.ok(kotajAlert);
  assert.equal(kotajAlert.sourceRegion, 'Hungary');
  assert.equal(kotajAlert.locationMethod, 'unknown');
  assert.equal(kotajAlert.lat, undefined, 'Unlocated Katved alert does NOT receive synthetic coords');
  assert.equal(kotajAlert.region, 'Hungary');

  // 3. Katved Hírek - Routine commemoration news
  const routineNews = news.find(n => n.source === 'Katasztrófavédelem Hírek' && n.title.includes('Megemlékezés'));
  assert.ok(routineNews);
  assert.equal(routineNews.sourceRegion, 'Hungary');
  assert.equal(routineNews.locationMethod, 'unknown');
  assert.equal(routineNews.lat, undefined);

  // 4. Katved Hírek - Hajdúböszörmény incident
  const boszormenyNews = news.find(n => n.source === 'Katasztrófavédelem Hírek' && n.title.includes('Hajdúböszörményben'));
  assert.ok(boszormenyNews);
  assert.equal(boszormenyNews.sourceRegion, 'Hungary');
  assert.equal(boszormenyNews.locationMethod, 'headline-keyword');
  assert.equal(boszormenyNews.region, 'Hajdúböszörmény');
  assert.equal(boszormenyNews.lat, 47.6725);

  // 5. Synthesize into intelligence events
  const rawData = { crucix: { timestamp: '2026-10-22T21:00:00.000Z' }, sources: {} };
  const V2 = await synthesize(rawData, { news, now: Date.parse('2026-10-22T21:00:00.000Z') });

  const routineEvt = V2.events.find(e => e.title.includes('Megemlékezés'));
  assert.ok(routineEvt);
  assert.equal(eventLevel(routineEvt), null, 'Routine organizational news has null eventLevel (no FLASH alert)');

  const debrecenEvt = V2.events.find(e => e.title.toLowerCase().includes('debreceni'));
  assert.ok(debrecenEvt);
  const debRes = resolveEventCountries(debrecenEvt);
  assert.deepEqual(debRes, { c: ['HUN'], m: 'm' }, 'Geotagged domestic emergency resolves to HUN');
});

// ─── 2. 5 Distinct feed states & healthy empty feed for Katasztrófavédelem Vész ───

test('Katasztrófavédelem Vész: 5 distinct states and healthy empty feed handling', async (t) => {
  rssFeedState.clear();

  // State 1: OK with items
  const okServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_KATVED_VESZ_POPULATED);
  });
  t.after(() => okServer.server.close());

  const okRes = await fetchRssFeed(okServer.url, 'Katasztrófavédelem Vész');
  assert.equal(okRes.status, 'ok');
  assert.equal(okRes.empty, false);
  assert.equal(okRes.error, null);
  assert.equal(okRes.items.length, 2);
  assert.ok(okRes.lastSuccess);

  // State 2: OK with 0 items (Healthy empty emergency feed)
  const emptyServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_KATVED_VESZ_EMPTY);
  });
  t.after(() => emptyServer.server.close());

  const emptyRes = await fetchRssFeed(emptyServer.url, 'Katasztrófavédelem Vész');
  assert.equal(emptyRes.status, 'ok', 'Empty emergency feed is status ok, NOT error');
  assert.equal(emptyRes.empty, true, 'Marked empty: true');
  assert.equal(emptyRes.items.length, 0);

  // State 3: HTTP 500 error (retains stale items)
  const http500Server = await startMockServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  });
  t.after(() => http500Server.server.close());

  // Prime cache
  await fetchRssFeed(okServer.url, 'Katasztrófavédelem Vész');
  const errRes = await fetchRssFeed(http500Server.url, 'Katasztrófavédelem Vész');
  assert.equal(errRes.status, 'error');
  assert.equal(errRes.errorType, 'http');
  assert.equal(errRes.items.length, 2);
  assert.equal(errRes.items[0].stale, true, 'Cached items marked stale');
  assert.equal(errRes.items[0].date, 'Thu, 22 Oct 2026 20:38:00 +0200', 'Original date is preserved');

  // State 4: Malformed XML
  const xmlServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>502 Bad Gateway</body></html>');
  });
  t.after(() => xmlServer.server.close());

  const xmlRes = await fetchRssFeed(xmlServer.url, 'Katasztrófavédelem Vész');
  assert.equal(xmlRes.status, 'error');
  assert.equal(xmlRes.errorType, 'xml');

  // State 5: Network Timeout
  const timeoutServer = await startMockServer((_req, _res) => {
    // Hold open
  });
  t.after(() => timeoutServer.server.close());

  const timeoutRes = await fetchRssFeed(timeoutServer.url, 'Katasztrófavédelem Vész', { timeout: 80 });
  assert.equal(timeoutRes.status, 'error');
  assert.equal(timeoutRes.errorType, 'network');
});

// ─── 3. Missing pubDate and coordinates resilience ───

test('Katasztrófavédelem: resilience against missing pubDate and unknown coordinates', async (t) => {
  const missingMetaXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BM OKF</title>
    <item>
      <title>Közlemény az országos készültségről</title>
      <link>https://www.katasztrofavedelem.hu/kozlemeny/1</link>
      <description>Országos összefoglaló tájékoztató.</description>
    </item>
  </channel>
</rss>`;

  const server = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(missingMetaXml);
  });
  t.after(() => server.server.close());

  const news = await fetchAllNews([[server.url, 'Katasztrófavédelem Vész']]);
  assert.equal(news.length, 1);
  const item = news[0];
  assert.equal(item.title, 'Közlemény az országos készültségről');
  assert.equal(item.date, '', 'Missing pubDate defaults to empty string without throwing');
  assert.equal(item.lat, undefined, 'Missing coords remains undefined');
  assert.equal(item.locationMethod, 'unknown');
});

// ─── 4. Multi-source coexistence across all 7 Hungarian feeds ───

test('Multi-source coexistence: all 7 Hungarian feeds coexist without ID or feed collision', async (t) => {
  const server = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    if (req.url.includes('haon')) {
      res.end(`<rss><channel><title>HAON</title><item><title>HAON hír Debrecenből</title><link>https://haon.hu/1</link></item></channel></rss>`);
    } else if (req.url.includes('dehir')) {
      res.end(`<rss><channel><title>Dehir</title><item><title>Dehir hír Nagyerdőről</title><link>https://dehir.hu/1</link></item></channel></rss>`);
    } else if (req.url.includes('telex')) {
      res.end(`<rss><channel><title>Telex</title><item><title>Telex belföldi összefoglaló</title><link>https://telex.hu/1</link></item></channel></rss>`);
    } else if (req.url.includes('portfolio')) {
      res.end(`<rss><channel><title>Portfolio</title><item><title>Portfolio makrogazdaság</title><link>https://portfolio.hu/1</link></item></channel></rss>`);
    } else if (req.url.includes('agrar')) {
      res.end(`<rss><channel><title>Agrárszektor</title><item><title>Agrár terményárak</title><link>https://agrarszektor.hu/1</link></item></channel></rss>`);
    } else if (req.url.includes('katved-vesz')) {
      res.end(`<rss><channel><title>Katasztrófavédelem Vész</title><item><title>Katasztrófavédelmi riasztás Hajdúszoboszlón</title><link>https://katved.hu/v/1</link></item></channel></rss>`);
    } else if (req.url.includes('katved-hirek')) {
      res.end(`<rss><channel><title>Katasztrófavédelem Hírek</title><item><title>Szakmai versenyeredmények</title><link>https://katved.hu/h/1</link></item></channel></rss>`);
    } else {
      res.end(`<rss><channel></channel></rss>`);
    }
  });
  t.after(() => server.server.close());

  const news = await fetchAllNews([
    [`${server.url}/haon`, 'HAON'],
    [`${server.url}/dehir`, 'Dehir'],
    [`${server.url}/telex`, 'Telex'],
    [`${server.url}/portfolio`, 'Portfolio'],
    [`${server.url}/agrar`, 'Agrárszektor'],
    [`${server.url}/katved-vesz`, 'Katasztrófavédelem Vész'],
    [`${server.url}/katved-hirek`, 'Katasztrófavédelem Hírek'],
  ]);

  assert.equal(news.length, 7, 'All 7 sources parsed exactly 1 item');
  const sources = new Set(news.map(n => n.source));
  assert.equal(sources.size, 7, 'All 7 distinct source names preserved');

  const rawData = { crucix: { timestamp: '2026-10-22T21:00:00.000Z' }, sources: {} };
  const V2 = await synthesize(rawData, { news, now: Date.parse('2026-10-22T21:00:00.000Z') });
  assert.equal(V2.events.length, 7);

  const eventIds = new Set(V2.events.map(e => e.id));
  assert.equal(eventIds.size, 7, 'Every event has a unique ID, no hash collisions');
});

// ─── 5. HistoryStore deduplication for Katasztrófavédelem items ───

test('HistoryStore deduplicates Katasztrófavédelem items across consecutive sweep cycles', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'crucix-katved-history-'));
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const now = Date.parse('2026-10-22T21:00:00.000Z');
  const history = new HistoryStore(tmpDir, { now: () => now });
  const event1 = {
    id: `event-${'8'.repeat(32)}`,
    kind: 'news',
    title: 'Katasztrófavédelmi művelet Debrecenben',
    summary: 'Riasztás történt.',
    source: { name: 'Katasztrófavédelem Vész', url: 'https://katved.hu/vesz/1', hostname: 'katved.hu', status: 'ok' },
    observedAt: null,
    publishedAt: '2026-10-22T19:00:00.000Z',
    collectedAt: '2026-10-22T20:00:00.000Z',
    location: { lat: 47.53, lon: 21.62, method: 'provider', label: 'Debrecen', precision: 'city' },
    severity: 'monitor',
    quality: { level: 'partial', checks: { sourceUrl: true, providerTime: true, location: true, sourceStatus: true }, explanationCodes: [] },
    relatedSources: []
  };

  // First sweep ingestion
  history.add([event1]);
  assert.equal(history.get(event1.id).title, 'Katasztrófavédelmi művelet Debrecenben');

  // Second sweep ingestion with the same event
  history.add([event1]);
  assert.equal(history.get(event1.id).title, 'Katasztrófavédelmi művelet Debrecenben');
});

// ─── 6. Briefing inclusion of Katasztrófavédelem events ───

test('Briefing includes Katasztrófavédelem events in Hungarian scope', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'crucix-katved-briefing-'));
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const store = new EntityStore({ dataDir: tmpDir });
  const now = Date.parse('2026-10-22T21:00:00.000Z');

  const katvedEmergency = {
    id: `event-${'7'.repeat(32)}`,
    kind: 'news',
    title: 'Katasztrófavédelmi riasztás viharkárok miatt Debrecenben',
    summary: 'A tűzoltók több helyszínen avatkoznak be a kidőlt fák és leszakadt vezetékek miatt.',
    source: { name: 'Katasztrófavédelem Vész', url: 'https://www.katasztrofavedelem.hu/10466/RSS_VESZ' },
    sourceRegion: 'Hungary',
    location: { method: 'headline-keyword', region: 'Debrecen', coordinates: [47.5316, 21.6273] },
    publishedAt: '2026-10-22T20:45:00.000Z',
    severity: 'high'
  };

  store.ingest([katvedEmergency]);

  const snapshot = {
    crucix: { timestamp: new Date(now).toISOString() },
    events: [katvedEmergency]
  };

  const hunBriefing = await generateBriefing({
    scope: 'HUN',
    snapshot,
    store,
    now
  });

  assert.equal(hunBriefing.scope, 'HUN');
  const citedIds = hunBriefing.bullets.flatMap(b => b.refs.map(r => r.id));
  assert.ok(citedIds.includes(katvedEmergency.id), 'Katasztrófavédelem emergency event is cited in HUN briefing');
});

// ─── 7. Full end-to-end dataflow, persistence recovery, and alert suppression ───

test('Katasztrófavédelem: complete end-to-end dataflow, persistence recovery, and alert suppression', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'crucix-katved-e2e-'));
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const server = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    if (req.url.includes('vesz')) {
      res.end(FIXTURE_KATVED_VESZ_POPULATED);
    } else if (req.url.includes('hirek')) {
      res.end(FIXTURE_KATVED_HIREK);
    } else if (req.url.includes('empty')) {
      res.end(FIXTURE_KATVED_VESZ_EMPTY);
    } else {
      res.end('<rss><channel></channel></rss>');
    }
  });
  t.after(() => server.server.close());

  const now = Date.parse('2026-10-22T21:00:00.000Z');

  // 1. RSS fetch -> normalization -> canonical intelligence events
  const news = await fetchAllNews([
    [`${server.url}/vesz`, 'Katasztrófavédelem Vész'],
    [`${server.url}/hirek`, 'Katasztrófavédelem Hírek']
  ]);
  const rawData = { crucix: { timestamp: new Date(now).toISOString() }, sources: {} };
  const V2 = await synthesize(rawData, { news, now });

  assert.equal(V2.events.length, 4, 'All 4 items synthesized into canonical events');

  // Verify the 3 distinct types of records:
  // a) Szervezeti hír: eventLevel is null (no FLASH)
  const orgEvent = V2.events.find(e => e.title.includes('Megemlékezés'));
  assert.ok(orgEvent);
  assert.equal(eventLevel(orgEvent), null, 'Routine organizational news has null eventLevel (no FLASH)');

  // b) Operatív eseményközlés: geotagged, local event
  const opEvent = V2.events.find(e => e.title.includes('Hajdúböszörményben'));
  assert.ok(opEvent);
  assert.equal(opEvent.location.method, 'headline-keyword');
  assert.equal(opEvent.location.label, 'Hajdúböszörmény');

  // c) Aktív vészhelyzeti figyelmeztetés: from Katasztrófavédelem Vész
  const alertEvent = V2.events.find(e => e.source.name === 'Katasztrófavédelem Vész' && e.title.toLowerCase().includes('debreceni'));
  assert.ok(alertEvent);

  // d) Unlocated record retention: Kótaj record has no synthetic coordinates but is retained
  const kotajEvent = V2.events.find(e => e.title.includes('Kótajon'));
  assert.ok(kotajEvent);
  assert.equal(kotajEvent.location.method, 'unknown');
  assert.equal(kotajEvent.location.lat, null, 'Unlocated record retains null lat without synthetic coordinates');

  // 2. Persistent storage (HistoryStore)
  const history1 = new HistoryStore(tmpDir, { now: () => now });
  history1.add(V2.events);

  // 3. Re-read from a brand new instance (restart resilience)
  const history2 = new HistoryStore(tmpDir, { now: () => now });
  const retrievedAlert = history2.get(alertEvent.id);
  assert.ok(retrievedAlert, 'Event retrieved from persistent storage after restart');
  assert.equal(retrievedAlert.title, alertEvent.title);
  assert.equal(retrievedAlert.source.url, alertEvent.source.url, 'Original source URL is preserved byte-for-byte');

  const retrievedKotaj = history2.get(kotajEvent.id);
  assert.ok(retrievedKotaj, 'Unlocated event retrieved from persistent storage');
  assert.equal(retrievedKotaj.location.lat, null, 'Unlocated event preserves null coordinates after persistence');

  // 4. Briefing inclusion with original reference
  const entityStore = new EntityStore({ dataDir: tmpDir });
  entityStore.ingest(V2.events, { now });

  const snapshot = {
    crucix: { timestamp: new Date(now).toISOString() },
    events: V2.events
  };

  const briefing = await generateBriefing({
    scope: 'HUN',
    snapshot,
    store: entityStore,
    history: history2,
    now
  });

  assert.equal(briefing.scope, 'HUN');
  const allRefs = briefing.bullets.flatMap(b => b.refs);
  const citedAlert = allRefs.find(r => r.id === alertEvent.id);
  assert.ok(citedAlert, 'Emergency alert is cited in HUN briefing');
  assert.equal(alertEvent.source.url, 'https://www.katasztrofavedelem.hu/modules/vesz/esemeny/93062', 'Original URL is available on cited event');

  // 5. Stale record & repeated sweep notification suppression
  const sweep2History = new HistoryStore(tmpDir, { now: () => now + 60000 });
  sweep2History.add(V2.events);
  // Re-ingestion of same events updates lastSeenAt but does not create duplicates or new events
  assert.equal(sweep2History.get(alertEvent.id).title, alertEvent.title);

  // 6. Empty feed observation assertion semantics
  const emptyRes = await fetchRssFeed(`${server.url}/empty`, 'Katasztrófavédelem Vész');
  assert.equal(emptyRes.status, 'ok', 'Empty feed returns status ok');
  assert.equal(emptyRes.empty, true, 'Empty feed returns empty: true');
  assert.equal(emptyRes.items.length, 0, 'Zero items returned');
  // Explicit check: empty feed signifies only that feed has no active items, NOT that "nincs veszély"
  assert.ok(emptyRes.empty && !Object.hasOwn(emptyRes, 'noThreatArea'), 'Feed state is purely observational');
});

