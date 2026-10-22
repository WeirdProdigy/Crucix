import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchRssFeed, fetchAllNews, buildNewsFeed, synthesize, rssFeedState } from '../dashboard/inject.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { EntityStore, resolveEventCountries } from '../lib/intelligence/entities.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { generateBriefing } from '../lib/llm/briefing.mjs';
import { eventLevel } from '../lib/alerts/levels.mjs';

// Synthetic test fixture with clean original fields
const FIXTURE_HAON_RSS = `<?xml version="1.0" encoding="UTF-8"?>
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
      <title><![CDATA[Katasztrófa Romániában: árvíz pusztított a határ menti térségben]]></title>
      <link><![CDATA[https://www.haon.hu/orszag-vilag/2026/10/arviz-romania-hatar]]></link>
      <description><![CDATA[Hatalmas esőzések miatt lépett ki medréből a folyó a szomszédos országban.]]></description>
      <pubDate>Thu, 22 Oct 2026 07:15:00 +0200</pubDate>
      <guid>https://www.haon.hu/orszag-vilag/2026/10/arviz-romania-hatar</guid>
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

// ─── 1. Feed health states: 5 distinct observable conditions ───

test('Requirement 1: 5 distinct source states (zero items, HTTP error, timeout, XML error, success with items)', async (t) => {
  rssFeedState.clear();

  // State 1: Success with items
  const okServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_HAON_RSS);
  });
  t.after(() => okServer.server.close());

  const okResult = await fetchRssFeed(okServer.url, 'HAON');
  assert.equal(okResult.status, 'ok');
  assert.equal(okResult.empty, false);
  assert.equal(okResult.error, null);
  assert.ok(okResult.lastAttempt);
  assert.ok(okResult.lastSuccess);
  assert.equal(okResult.items.length, 4);

  // State 2: Success with zero items (valid empty feed)
  const emptyServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    res.end('<rss version="2.0"><channel><title>Empty Haon</title></channel></rss>');
  });
  t.after(() => emptyServer.server.close());

  const emptyResult = await fetchRssFeed(emptyServer.url, 'HAON-Empty');
  assert.equal(emptyResult.status, 'ok');
  assert.equal(emptyResult.empty, true);
  assert.equal(emptyResult.error, null);
  assert.equal(emptyResult.items.length, 0);
  assert.ok(emptyResult.lastSuccess);

  // State 3: HTTP error (500)
  const http500Server = await startMockServer((_req, res) => {
    res.writeHead(500);
    res.end('Internal Server Error');
  });
  t.after(() => http500Server.server.close());

  const http500Result = await fetchRssFeed(http500Server.url, 'HAON-500');
  assert.equal(http500Result.status, 'error');
  assert.equal(http500Result.errorType, 'http');
  assert.match(http500Result.error, /HTTP 500/);
  assert.ok(http500Result.lastAttempt);
  assert.equal(http500Result.lastSuccess, null);

  // State 4: Malformed XML error
  const badXmlServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end('<<<not-xml-garbage>>>');
  });
  t.after(() => badXmlServer.server.close());

  const badXmlResult = await fetchRssFeed(badXmlServer.url, 'HAON-BadXML');
  assert.equal(badXmlResult.status, 'error');
  assert.equal(badXmlResult.errorType, 'xml');
  assert.match(badXmlResult.error, /Malformed XML/);

  // State 5: Network timeout error
  const timeoutServer = await startMockServer((_req, _res) => {
    // Deliberately never respond
  });
  t.after(() => timeoutServer.server.close());

  const timeoutResult = await fetchRssFeed(timeoutServer.url, 'HAON-Timeout', { timeout: 100 });
  assert.equal(timeoutResult.status, 'error');
  assert.equal(timeoutResult.errorType, 'network');
  assert.match(timeoutResult.error, /timed out/i);

  // Fallback cache with stale marking on transient failure:
  // Feed 'HAON' previously succeeded. Now simulate a server outage.
  const failServer = await startMockServer((_req, res) => {
    res.writeHead(503);
    res.end('Service Unavailable');
  });
  t.after(() => failServer.server.close());

  const staleResult = await fetchRssFeed(failServer.url, 'HAON');
  assert.equal(staleResult.status, 'error');
  assert.equal(staleResult.errorType, 'http');
  assert.equal(staleResult.items.length, 4);
  assert.ok(staleResult.items.every(i => i.stale === true));
  assert.ok(staleResult.lastSuccess);
  assert.ok(staleResult.lastAttempt >= staleResult.lastSuccess);
});

// ─── 2. Country association vs Source publisher region ───

test('Requirement 3: strict distinction between publisher competence and article event country', () => {
  // Case A: Local event in Debrecen (no country in text; coordinates locate in Hungary)
  const debEvent = {
    id: `event-${'a'.repeat(32)}`,
    kind: 'news',
    title: 'Új ipari park épül Debrecen déli részén',
    summary: 'Jelentős gazdasági fejlesztésről született megállapodás.',
    location: { lat: 47.5316, lon: 21.6273, method: 'headline-keyword', precision: 'approximate' }
  };
  const debCountry = resolveEventCountries(debEvent);
  assert.deepEqual(debCountry, { c: ['HUN'], m: 'm' });

  // Case B: General county news without settlement (no country in text; no coordinates)
  const generalEvent = {
    id: `event-${'b'.repeat(32)}`,
    kind: 'news',
    title: 'Őszi erdősítési program indult a vármegyében',
    summary: 'Szakemberek őshonos fafajokat ültetnek a térségben.',
    location: { lat: null, lon: null, method: 'unknown' }
  };
  const generalCountry = resolveEventCountries(generalEvent);
  assert.equal(generalCountry, null, 'General county news without settlement is not falsely mapped to HUN');

  // Case C: Foreign event published by HAON (mentions Romania in title)
  const foreignEvent = {
    id: `event-${'c'.repeat(32)}`,
    kind: 'news',
    title: 'Katasztrófa Romániában: árvíz pusztított a határ menti térségben',
    summary: 'Hatalmas esőzések miatt lépett ki medréből a folyó.',
    location: { lat: null, lon: null, method: 'unknown' }
  };
  const foreignCountry = resolveEventCountries(foreignEvent);
  assert.deepEqual(foreignCountry, { c: ['ROU'], m: 'm' }, 'Foreign news is mapped to ROU, NOT to HUN');

  // Case D: Foreign event mentioning Ukraine published by regional paper
  const ukrEvent = {
    id: `event-${'d'.repeat(32)}`,
    kind: 'news',
    title: 'Légicsapások érték Ukrajna energetikai hálózatát',
    summary: 'Több városban áramkimaradásokat jelentettek.',
    location: { lat: null, lon: null, method: 'unknown' }
  };
  const ukrCountry = resolveEventCountries(ukrEvent);
  assert.deepEqual(ukrCountry, { c: ['UKR'], m: 'm' }, 'Ukraine news is mapped to UKR, NOT to HUN');

  // Original summary text is preserved without artificial appended strings
  assert.ok(!debEvent.summary.includes('(Magyarország)'));
  assert.ok(!generalEvent.summary.includes('(Magyarország)'));
});

// ─── 3. Persistent storage deduplication across sweeps ───

test('Requirement 4: storage-layer deduplication across sweeps in HistoryStore', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-store-dedup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const history = new HistoryStore(dir);

  const testEvent = {
    id: `event-${'1'.repeat(32)}`,
    kind: 'news',
    title: 'Új ipari park épül Debrecen déli részén',
    summary: 'Jelentős gazdasági fejlesztés.',
    source: { name: 'HAON', url: 'https://www.haon.hu/gazdasag/2026/10/debrecen-ipari-park-beruhazas', status: 'ok' },
    publishedAt: '2026-10-22T10:00:00.000Z',
    observedAt: null,
    collectedAt: '2026-10-22T10:05:00.000Z',
    location: { lat: 47.5316, lon: 21.6273, method: 'headline-keyword', label: 'Debrecen', precision: 'approximate' },
    severity: 'unknown',
    quality: { level: 'complete', checks: { sourceUrl: true, providerTime: true, location: true, sourceStatus: true }, explanationCodes: [] },
    relatedSources: [],
    firstSeenAt: '2026-10-22T10:05:00.000Z',
    lastSeenAt: '2026-10-22T10:05:00.000Z'
  };

  // Sweep 1: ingest event
  history.add([testEvent]);
  const query1 = history.query();
  assert.equal(query1.total, 1);
  assert.equal(query1.items[0].id, testEvent.id);
  assert.equal(query1.items[0].firstSeenAt, '2026-10-22T10:05:00.000Z');

  // Sweep 2: ingest the exact same article with updated lastSeenAt / collectedAt
  const sweep2Event = {
    ...testEvent,
    collectedAt: '2026-10-22T10:35:00.000Z',
    lastSeenAt: '2026-10-22T10:35:00.000Z'
  };
  history.add([sweep2Event]);

  // Read back from a brand new store instance pointing to the same disk directory
  const reloaded = new HistoryStore(dir);
  const query2 = reloaded.query();

  // Proof of storage-layer deduplication:
  assert.equal(query2.total, 1, 'Exactly one event record remains on disk across sweeps');
  assert.equal(query2.items.length, 1);
  assert.equal(query2.items[0].id, testEvent.id);
  assert.equal(query2.items[0].firstSeenAt, '2026-10-22T10:05:00.000Z', 'firstSeenAt is preserved');
  assert.equal(query2.items[0].lastSeenAt, '2026-10-22T10:35:00.000Z', 'lastSeenAt is updated');
});

// ─── 4. Routine news does not trigger FLASH alerts ───

test('Requirement 6: routine regional news severity is unknown and has no alert level (no FLASH)', () => {
  const routineEvent = {
    id: `event-${'2'.repeat(32)}`,
    kind: 'news',
    title: 'Korszerűsítik a debreceni kerékpárutakat',
    severity: 'unknown',
    location: { lat: 47.5316, lon: 21.6273, method: 'headline-keyword', precision: 'approximate' }
  };

  const level = eventLevel(routineEvent);
  assert.equal(level, null, 'Routine local news event level is null (raises no FLASH alert)');
});
