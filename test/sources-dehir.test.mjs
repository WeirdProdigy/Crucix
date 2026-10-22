import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchAllNews, synthesize } from '../dashboard/inject.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';

const FIXTURE_DEHIR_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Dehir - Debrecen hírei</title>
    <link>https://www.dehir.hu</link>
    <description>Debreceni hírportál</description>
    <item>
      <title>Vígh Tamás: Debrecen kerékpározása fontos téma</title>
      <description>A kerékpáros közlekedés tipikusan olyan terület, ahol a szakmai szempontoknak kell elsőbbséget élvezniük.</description>
      <link>https://dehir.hu/debrecen/vigh-tamas-debrecen-kerekparozas/2026/10/22/</link>
      <pubDate>Thu, 22 Oct 2026 18:00:20 +0200</pubDate>
    </item>
    <item>
      <title>Felújítják a hajdúszoboszlói strandfürdő sétányát</title>
      <description>Korszerűsítési munkálatok kezdődnek a fürdővárosban a jövő évi turisztikai szezonra készülve.</description>
      <link>https://dehir.hu/hajdu-bihar/felujitjak-a-hajduszoboszloi-setanyt/2026/10/22/</link>
      <pubDate>Thu, 22 Oct 2026 16:30:10 +0200</pubDate>
    </item>
    <item>
      <title>Korszerű eszközökkel bővült a vármegyei mentőszolgálat gépparkja</title>
      <description>Új életmentő felszereléseket adtak át a regionális állomások képviselőinek.</description>
      <link>https://dehir.hu/regio/uj-eszkozok-a-mentoknek/2026/10/22/</link>
      <pubDate>Thu, 22 Oct 2026 15:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

const FIXTURE_HAON_PARALLEL = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Haon</title>
    <link>https://www.haon.hu</link>
    <item>
      <title>Vígh Tamás: Debrecen kerékpározása fontos téma</title>
      <description>A képviselő a szakmai párbeszéd fontosságát hangsúlyozta a debreceni fejlesztések kapcsán.</description>
      <link>https://www.haon.hu/helyi-kozelet/2026/10/vigh-tamas-debrecen-kerekparozas</link>
      <pubDate>Thu, 22 Oct 2026 18:15:00 +0200</pubDate>
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

test('Dehir feed parsing, geotagging separation, and unlocated news preservation', async (t) => {
  const { server, url } = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_DEHIR_RSS);
  });
  t.after(() => server.close());

  const news = await fetchAllNews([[url, 'Dehir']]);
  assert.equal(news.length, 3);

  // 1. Debrecen article: geotagged with approximate precision
  const deb = news.find(n => n.title.includes('Debrecen'));
  assert.ok(deb);
  assert.equal(deb.source, 'Dehir');
  assert.equal(deb.region, 'Debrecen');
  assert.equal(deb.locationMethod, 'headline-keyword');
  assert.equal(deb.locationPrecision, 'approximate');
  assert.equal(deb.lat, 47.5316);
  assert.equal(deb.lon, 21.6273);
  assert.ok(deb.summary.includes('A kerékpáros közlekedés tipikusan olyan terület'));

  // 2. Hajdúszoboszló article: recognized settlement
  const szob = news.find(n => n.title.includes('hajdúszoboszlói'));
  assert.ok(szob);
  assert.equal(szob.region, 'Hajdúszoboszló');
  assert.equal(szob.lat, 47.4447);
  assert.equal(szob.lon, 21.3961);

  // 3. Unlocated news without settlement keyword: no false Debrecen coordinates!
  const unloc = news.find(n => n.title.includes('mentőszolgálat'));
  assert.ok(unloc);
  assert.equal(unloc.source, 'Dehir');
  assert.equal(unloc.sourceRegion, 'Debrecen');
  assert.equal(unloc.region, 'Debrecen');
  assert.equal(unloc.locationMethod, 'unknown');
  assert.equal(unloc.lat, undefined);
  assert.equal(unloc.lon, undefined);
});

test('Multi-source coexistence: HAON and Dehir reports preserve distinct IDs and separate sources', async (t) => {
  const dehirServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_DEHIR_RSS);
  });
  t.after(() => dehirServer.server.close());

  const haonServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_HAON_PARALLEL);
  });
  t.after(() => haonServer.server.close());

  const allNews = await fetchAllNews([
    [dehirServer.url, 'Dehir'],
    [haonServer.url, 'HAON']
  ]);
  assert.equal(allNews.length, 4);

  const rawData = { crucix: { timestamp: '2026-10-22T19:00:00.000Z' }, sources: {} };
  const V2 = await synthesize(rawData, { news: allNews, now: Date.parse('2026-10-22T19:00:00.000Z') });

  // Both articles exist in events with distinct IDs (URL-based hash)
  const dehirEvent = V2.events.find(e => e.source.name === 'Dehir' && e.title.includes('Vígh Tamás'));
  const haonEvent = V2.events.find(e => e.source.name === 'HAON' && e.title.includes('Vígh Tamás'));

  assert.ok(dehirEvent, 'Dehir event exists');
  assert.ok(haonEvent, 'HAON event exists');
  assert.notEqual(dehirEvent.id, haonEvent.id, 'Events from distinct sources/URLs have distinct IDs and are not forced into one');

  // Both original URLs and source names remain completely intact
  assert.equal(dehirEvent.source.url, 'https://dehir.hu/debrecen/vigh-tamas-debrecen-kerekparozas/2026/10/22/');
  assert.equal(haonEvent.source.url, 'https://www.haon.hu/helyi-kozelet/2026/10/vigh-tamas-debrecen-kerekparozas');
  assert.equal(dehirEvent.source.name, 'Dehir');
  assert.equal(haonEvent.source.name, 'HAON');
  assert.equal(dehirEvent.source.hostname, 'dehir.hu');
  assert.equal(haonEvent.source.hostname, 'haon.hu');

  // The correlation engine links them as related reports without merging or destroying either
  const dehirRelated = dehirEvent.relatedSources.find(r => r.hostname === 'haon.hu');
  const haonRelated = haonEvent.relatedSources.find(r => r.hostname === 'dehir.hu');
  assert.ok(dehirRelated || haonRelated, 'Cross-source reporting is correlated as related source');
});
