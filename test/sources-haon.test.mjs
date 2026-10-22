import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchAllNews, buildNewsFeed, synthesize } from '../dashboard/inject.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { EntityStore } from '../lib/intelligence/entities.mjs';
import { generateBriefing } from '../lib/llm/briefing.mjs';

const MOCK_HAON_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Haon</title>
    <link>https://www.haon.hu</link>
    <description>Hajdú-bihari hírportál</description>
    <item>
      <title><![CDATA[Új munkahelyeket teremtő beruházás indul Debrecen déli ipari parkjában]]></title>
      <link><![CDATA[https://www.haon.hu/gazdasag/2026/10/debrecen-ipari-park-beruhazas]]></link>
      <description><![CDATA[<p>Jelentős ipari fejlesztésről döntött a debreceni közgyűlés, több száz új munkahely létesül.</p>]]></description>
      <pubDate>Thu, 22 Oct 2026 10:00:00 +0200</pubDate>
      <guid>https://www.haon.hu/gazdasag/2026/10/debrecen-ipari-park-beruhazas</guid>
    </item>
    <item>
      <title><![CDATA[Korszerűsítik a hajdúszoboszlói gyógyfürdő medencéit a téli szezon előtt]]></title>
      <link><![CDATA[https://www.haon.hu/helyi-kozelet/2026/10/hajduszoboszlo-gyogyfurdo-fejlesztes]]></link>
      <description><![CDATA[Felújítási munkálatok kezdődtek Hajdúszoboszlón a látogatói élmény növelése érdekében.]]></description>
      <pubDate>Thu, 22 Oct 2026 09:30:00 +0200</pubDate>
      <guid>https://www.haon.hu/helyi-kozelet/2026/10/hajduszoboszlo-gyogyfurdo-fejlesztes</guid>
    </item>
    <item>
      <title><![CDATA[Őszi erdősítési program indult a vármegyei erdők megóvására]]></title>
      <link><![CDATA[https://www.haon.hu/helyi-kozelet/2026/10/hajdu-bihar-erdosites-termeszetvedelem]]></link>
      <description><![CDATA[Hajdú-Bihar vármegye több területén őshonos fafajokat ültetnek a szakemberek.]]></description>
      <pubDate>Thu, 22 Oct 2026 08:45:00 +0200</pubDate>
      <guid>https://www.haon.hu/helyi-kozelet/2026/10/hajdu-bihar-erdosites-termeszetvedelem</guid>
    </item>
    <item>
      <title><![CDATA[Hírek időbélyeg nélkül a térségből]]></title>
      <link><![CDATA[https://www.haon.hu/vegyes/2026/10/hirek-ido-nelkul]]></link>
      <description><![CDATA[Ez egy olyan hír, amelynek nincs pubDate mezője.]]></description>
      <guid>https://www.haon.hu/vegyes/2026/10/hirek-ido-nelkul</guid>
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

test('HAON feed parsing, CDATA decoding and HTML tag stripping', async (t) => {
  const { server, url } = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(MOCK_HAON_RSS);
  });
  t.after(() => server.close());

  const news = await fetchAllNews([[url, 'HAON']]);
  assert.equal(news.length, 4);

  // 1. Debrecen article
  const deb = news.find(n => n.title.includes('Debrecen'));
  assert.ok(deb);
  assert.equal(deb.source, 'HAON');
  assert.equal(deb.region, 'Debrecen');
  assert.equal(deb.locationMethod, 'headline-keyword');
  assert.equal(deb.locationPrecision, 'approximate');
  assert.equal(deb.lat, 47.5316);
  assert.equal(deb.lon, 21.6273);
  assert.ok(!deb.summary.includes('<p>'));
  assert.ok(deb.summary.includes('Jelentős ipari fejlesztésről döntött'));
  assert.ok(deb.summary.includes('Magyarország'));

  // 2. Hajdúszoboszló article
  const szob = news.find(n => n.title.includes('hajdúszoboszlói'));
  assert.ok(szob);
  assert.equal(szob.region, 'Hajdúszoboszló');
  assert.equal(szob.lat, 47.4447);
  assert.equal(szob.lon, 21.3961);

  // 3. County-wide unlocated article: NO false pinpoint
  const county = news.find(n => n.title.includes('erdősítési'));
  assert.ok(county);
  assert.equal(county.source, 'HAON');
  assert.equal(county.region, 'Hajdú-Bihar');
  assert.equal(county.locationMethod, 'unknown');
  assert.equal(county.lat, undefined);
  assert.equal(county.lon, undefined);

  // 4. Missing pubDate: handled gracefully
  const nodate = news.find(n => n.title.includes('időbélyeg nélkül'));
  assert.ok(nodate);
  assert.equal(nodate.date, '');
});

test('HAON error handling: malformed XML, empty feed, HTTP 500, and 404 fail gracefully', async (t) => {
  // 1. Malformed XML
  const badXmlServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end('<<<broken xml content not valid rss');
  });
  t.after(() => badXmlServer.server.close());
  const badXmlResult = await fetchAllNews([[badXmlServer.url, 'HAON']]);
  assert.deepEqual(badXmlResult, []);

  // 2. Empty feed
  const emptyServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    res.end('<rss><channel><title>Empty</title></channel></rss>');
  });
  t.after(() => emptyServer.server.close());
  const emptyResult = await fetchAllNews([[emptyServer.url, 'HAON']]);
  assert.deepEqual(emptyResult, []);

  // 3. HTTP 500
  const server500 = await startMockServer((_req, res) => {
    res.writeHead(500);
    res.end('Server error');
  });
  t.after(() => server500.server.close());
  const res500 = await fetchAllNews([[server500.url, 'HAON']]);
  assert.deepEqual(res500, []);

  // 4. HTTP 404
  const server404 = await startMockServer((_req, res) => {
    res.writeHead(404);
    res.end('Not found');
  });
  t.after(() => server404.server.close());
  const res404 = await fetchAllNews([[server404.url, 'HAON']]);
  assert.deepEqual(res404, []);
});

test('HAON end-to-end integration: synthesize, event normalization, deduplication, and Hungarian briefing', async (t) => {
  const { server, url } = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(MOCK_HAON_RSS);
  });
  t.after(() => server.close());

  const fetched = await fetchAllNews([[url, 'HAON']]);
  assert.equal(fetched.length, 4);

  // Synthesize raw sweep data with HAON news injected
  const rawData = {
    crucix: { timestamp: '2026-10-22T10:00:00.000Z' },
    sources: {}
  };
  const V2 = await synthesize(rawData, { news: fetched, now: Date.parse('2026-10-22T10:00:00.000Z') });

  // Verify map vs feed separation:
  // Only items with finite coordinates (Debrecen, Hajdúszoboszló) are in V2.news (map)
  assert.equal(V2.news.length, 2);
  assert.ok(V2.news.every(n => Number.isFinite(n.lat) && Number.isFinite(n.lon)));
  assert.ok(V2.news.some(n => n.region === 'Debrecen'));
  assert.ok(V2.news.some(n => n.region === 'Hajdúszoboszló'));

  // All 4 items are in V2.newsFeed (ticker and briefing pipeline)
  const haonFeedItems = V2.newsFeed.filter(n => n.source === 'HAON');
  assert.equal(haonFeedItems.length, 4);

  // Unlocated item is present in newsFeed without coordinates
  const unlocatedInFeed = haonFeedItems.find(n => n.headline.includes('erdősítési'));
  assert.ok(unlocatedInFeed);
  assert.equal(unlocatedInFeed.region, 'Hajdú-Bihar');
  assert.equal(unlocatedInFeed.lat, undefined);
  assert.equal(unlocatedInFeed.lon, undefined);

  // Verify buildEvents creates normalized events
  const haonEvents = V2.events.filter(e => e.source?.name === 'HAON');
  assert.ok(haonEvents.length >= 3);
  for (const ev of haonEvents) {
    assert.match(ev.id, /^event-[a-f0-9]{32}$/);
    assert.equal(ev.kind, 'news');
    assert.ok(ev.source.url?.startsWith('https://www.haon.hu/'));
    assert.ok(ev.quality);
  }

  // Deduplication check: re-running buildEvents with identical feed does not duplicate event IDs
  const reEvents = buildEvents(V2, { now: Date.parse('2026-10-22T10:05:00.000Z') });
  const eventIds = reEvents.map(e => e.id);
  assert.equal(new Set(eventIds).size, eventIds.length);

  // EntityStore country linking check:
  // Ingest events into EntityStore and verify that HAON events are indexed under 'HUN'
  const dir = mkdtempSync(join(tmpdir(), 'crucix-haon-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new EntityStore(dir, { now: () => Date.parse('2026-10-22T10:00:00.000Z') });
  store.load();
  store.ingest(haonEvents);

  const hunEvents = store.countryEvents('HUN');
  assert.ok(hunEvents.length >= 1, 'At least one HAON event is linked to HUN in EntityStore');

  // Hungarian Briefing generation check:
  // Generate a rule-based briefing for HUN scope and verify HAON news can be cited
  const briefingHu = await generateBriefing({
    scope: 'HUN',
    snapshot: V2,
    store,
    language: 'hu',
    now: Date.parse('2026-10-22T10:00:00.000Z'),
  });
  assert.equal(briefingHu.scope, 'HUN');
  assert.equal(briefingHu.language, 'hu');
  assert.ok(Array.isArray(briefingHu.bullets));
  assert.ok(briefingHu.bullets.length > 0, 'Briefing generated bullets for HUN scope');
  assert.ok(briefingHu.bullets[0].refs.length > 0);

  // Global Briefing generation check:
  const briefingGlobal = await generateBriefing({
    scope: 'global',
    snapshot: V2,
    store,
    language: 'hu',
    now: Date.parse('2026-10-22T10:00:00.000Z'),
  });
  assert.equal(briefingGlobal.scope, 'global');
  assert.ok(briefingGlobal.bullets.length > 0);
});
