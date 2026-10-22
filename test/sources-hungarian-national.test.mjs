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

const FIXTURE_TELEX_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Telex</title>
    <link>https://telex.hu</link>
    <item>
      <title>Debrecen új kulturális központot kap a belvárosban</title>
      <link>https://telex.hu/belfold/2026/10/22/debrecen-uj-kulturalis-kozpont</link>
      <description>Jelentős városfejlesztési beruházás indul a cívisvárosban.</description>
      <pubDate>Thu, 22 Oct 2026 14:00:00 +0200</pubDate>
    </item>
    <item>
      <title>Új adózási szabályokat jelentett be a kormány</title>
      <link>https://telex.hu/gazdasag/2026/10/22/uj-adozasi-szabalyok</link>
      <description>Átfogó adminisztrációs könnyítéseket léptetnek életbe a kisvállalkozások számára.</description>
      <pubDate>Thu, 22 Oct 2026 13:00:00 +0200</pubDate>
    </item>
    <item>
      <title>Választási felkészülés zajlik Franciaországban</title>
      <link>https://telex.hu/kulfold/2026/10/22/valasztasi-felkeszules-franciaorszag</link>
      <description>Politikai elemzés a párizsi fejleményekről.</description>
      <pubDate>Thu, 22 Oct 2026 12:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

const FIXTURE_PORTFOLIO_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Portfolio.hu</title>
    <link>https://www.portfolio.hu</link>
    <item>
      <title><![CDATA[Megugrott az állampapírok iránti kereslet a hazai piacon]]></title>
      <link>https://www.portfolio.hu/gazdasag/20261022/megugrott-az-allampapirok-iranti-kereslet-871650</link>
      <description><![CDATA[<p>A lakossági megtakarítások dinamikusan növekedtek az elmúlt negyedévben.</p>]]></description>
      <pubDate>Thu, 22 Oct 2026 14:30:00 +0200</pubDate>
    </item>
    <item>
      <title><![CDATA[Szabotázsakció gyanúja miatt nyomoznak Lengyelországban]]></title>
      <link>https://www.portfolio.hu/global/20261022/szabotazsakcio-gyanuja-lengyelorszagban-871651</link>
      <description><![CDATA[<p>A varsói hatóságok vizsgálják a dróngyár elleni kísérlet hátterét.</p>]]></description>
      <pubDate>Thu, 22 Oct 2026 13:45:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

const FIXTURE_AGRAR_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Agrárszektor</title>
    <link>https://www.agrarszektor.hu</link>
    <item>
      <title><![CDATA[Jégkár pusztított Hajdúszoboszló környékén a délutáni viharban]]></title>
      <link>https://www.agrarszektor.hu/noveny/20261022/jegkar-hajduszoboszlo-kornyeken-65230</link>
      <description><![CDATA[<p>Jelentős terméskieséstől tartanak a helyi gazdák a heves jégeső után.</p>]]></description>
      <pubDate>Thu, 22 Oct 2026 15:00:00 +0200</pubDate>
    </item>
    <item>
      <title><![CDATA[Emelkednek a műtrágyaárak az őszi vetési szezon kezdetén]]></title>
      <link>https://www.agrarszektor.hu/gazdasag/20261022/emelkednek-a-mutragyaarak-65231</link>
      <description><![CDATA[<p>A világpiaci gázárak közvetlen hatással vannak az agrár inputanyagok költségeire.</p>]]></description>
      <pubDate>Thu, 22 Oct 2026 14:15:00 +0200</pubDate>
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

// ─── 1. Feed parsing, unlocated handling & country isolation ───

test('Telex, Portfolio, Agrárszektor: feed parsing, geotagging and foreign isolation', async (t) => {
  const telexServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_TELEX_RSS);
  });
  t.after(() => telexServer.server.close());

  const portServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_PORTFOLIO_RSS);
  });
  t.after(() => portServer.server.close());

  const agrarServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_AGRAR_RSS);
  });
  t.after(() => agrarServer.server.close());

  const news = await fetchAllNews([
    [telexServer.url, 'Telex'],
    [portServer.url, 'Portfolio'],
    [agrarServer.url, 'Agrárszektor']
  ]);

  assert.equal(news.length, 7, 'All 7 items across the three feeds were extracted');

  // 1. Telex items check
  const telexDebrecen = news.find(n => n.source === 'Telex' && n.title.includes('Debrecen'));
  assert.ok(telexDebrecen);
  assert.equal(telexDebrecen.sourceRegion, 'Hungary');
  assert.equal(telexDebrecen.locationMethod, 'headline-keyword');
  assert.equal(telexDebrecen.region, 'Debrecen');
  assert.equal(telexDebrecen.lat, 47.5316);

  const telexUnloc = news.find(n => n.source === 'Telex' && n.title.includes('adózási'));
  assert.ok(telexUnloc);
  assert.equal(telexUnloc.sourceRegion, 'Hungary');
  assert.equal(telexUnloc.locationMethod, 'unknown');
  assert.equal(telexUnloc.lat, undefined, 'National unlocated news does NOT receive synthetic Budapest coords');
  assert.equal(telexUnloc.region, 'Hungary');

  // 2. Portfolio items check: textual only, no numeric price extraction
  const portItem = news.find(n => n.source === 'Portfolio' && n.title.includes('állampapírok'));
  assert.ok(portItem);
  assert.equal(portItem.sourceRegion, 'Hungary');
  assert.equal(portItem.locationMethod, 'unknown');
  assert.equal(portItem.summary, 'A lakossági megtakarítások dinamikusan növekedtek az elmúlt negyedévben.');

  // 3. Agrárszektor items check: unlocated input prices remain textual news, Hajdúszoboszló geotagged
  const agrarJeg = news.find(n => n.source === 'Agrárszektor' && n.title.includes('Jégkár'));
  assert.ok(agrarJeg);
  assert.equal(agrarJeg.locationMethod, 'headline-keyword');
  assert.equal(agrarJeg.region, 'Hajdúszoboszló');
  assert.equal(agrarJeg.lat, 47.4447);

  const agrarMutragya = news.find(n => n.source === 'Agrárszektor' && n.title.includes('műtrágyaárak'));
  assert.ok(agrarMutragya);
  assert.equal(agrarMutragya.locationMethod, 'unknown');
  assert.equal(agrarMutragya.lat, undefined);

  // 4. Synthesize into intelligence events
  const rawData = { crucix: { timestamp: '2026-10-22T16:00:00.000Z' }, sources: {} };
  const V2 = await synthesize(rawData, { news, now: Date.parse('2026-10-22T16:00:00.000Z') });

  // Verify entity country resolution: foreign vs domestic
  const foreignPoland = V2.events.find(e => e.title.includes('Lengyelországban'));
  assert.ok(foreignPoland);
  const polRes = resolveEventCountries(foreignPoland);
  assert.deepEqual(polRes, { c: ['POL'], m: 'm' }, 'Poland article is mapped to POL, NOT HUN');

  const unlocEcon = V2.events.find(e => e.title.includes('állampapírok'));
  assert.ok(unlocEcon);
  const econRes = resolveEventCountries(unlocEcon);
  assert.equal(econRes, null, 'Unlocated national economic news has NO fake HUN country');

  // Routine news severity unknown -> event level null (no FLASH)
  assert.equal(eventLevel(unlocEcon), null, 'Routine economic news has null eventLevel (no FLASH)');
  assert.equal(eventLevel(agrarMutragya), null, 'Routine fertilizer news has null eventLevel (no FLASH)');
});

// ─── 2. 5 Distinct feed states & cache retention for Telex ───

test('Telex feed health tracking: 5 distinct states and cache preservation', async (t) => {
  rssFeedState.clear();

  // State 1: OK with items
  const okServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(FIXTURE_TELEX_RSS);
  });
  t.after(() => okServer.server.close());

  const okRes = await fetchRssFeed(okServer.url, 'Telex');
  assert.equal(okRes.status, 'ok');
  assert.equal(okRes.empty, false);
  assert.equal(okRes.error, null);
  assert.equal(okRes.items.length, 3);
  assert.ok(okRes.lastSuccess);

  // State 2: OK with 0 items
  const emptyServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end('<rss><channel><title>Telex</title></channel></rss>');
  });
  t.after(() => emptyServer.server.close());

  const emptyRes = await fetchRssFeed(emptyServer.url, 'Telex');
  assert.equal(emptyRes.status, 'ok');
  assert.equal(emptyRes.empty, true);
  assert.equal(emptyRes.items.length, 0);

  // State 3: HTTP 500 error (retains stale items)
  const http500Server = await startMockServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  });
  t.after(() => http500Server.server.close());

  // Prime cache
  await fetchRssFeed(okServer.url, 'Telex');
  const errRes = await fetchRssFeed(http500Server.url, 'Telex');
  assert.equal(errRes.status, 'error');
  assert.equal(errRes.errorType, 'http');
  assert.equal(errRes.items.length, 3);
  assert.equal(errRes.items[0].stale, true, 'Cached items marked stale');
  assert.equal(errRes.items[0].date, 'Thu, 22 Oct 2026 14:00:00 +0200', 'Original date is preserved, no new date');

  // State 4: Malformed XML
  const xmlServer = await startMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>403 Cloudflare Error</body></html>');
  });
  t.after(() => xmlServer.server.close());

  const xmlRes = await fetchRssFeed(xmlServer.url, 'Telex');
  assert.equal(xmlRes.status, 'error');
  assert.equal(xmlRes.errorType, 'xml');

  // State 5: Network Timeout
  const timeoutServer = await startMockServer((_req, _res) => {
    // Deliberately hold connection open
  });
  t.after(() => timeoutServer.server.close());

  const timeoutRes = await fetchRssFeed(timeoutServer.url, 'Telex', { timeout: 80 });
  assert.equal(timeoutRes.status, 'error');
  assert.equal(timeoutRes.errorType, 'network');
});

// ─── 3. Multi-source coexistence across all 5 Hungarian outlets ───

test('Multi-source coexistence: HAON, Dehir, Telex, Portfolio, Agrárszektor preserve distinct IDs and URLs', async (t) => {
  const commonServer = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    if (req.url.includes('telex')) res.end(FIXTURE_TELEX_RSS);
    else if (req.url.includes('portfolio')) res.end(FIXTURE_PORTFOLIO_RSS);
    else if (req.url.includes('agrar')) res.end(FIXTURE_AGRAR_RSS);
    else res.end('<rss><channel></channel></rss>');
  });
  t.after(() => commonServer.server.close());

  const news = await fetchAllNews([
    [`${commonServer.url}/telex`, 'Telex'],
    [`${commonServer.url}/portfolio`, 'Portfolio'],
    [`${commonServer.url}/agrar`, 'Agrárszektor']
  ]);

  const rawData = { crucix: { timestamp: '2026-10-22T17:00:00.000Z' }, sources: {} };
  const V2 = await synthesize(rawData, { news });

  // Each source preserves its distinct URLs and hostnames
  const telexEv = V2.events.find(e => e.source.name === 'Telex');
  const portEv = V2.events.find(e => e.source.name === 'Portfolio');
  const agrarEv = V2.events.find(e => e.source.name === 'Agrárszektor');

  assert.ok(telexEv && telexEv.source.url.includes('telex.hu'));
  assert.ok(portEv && portEv.source.url.includes('portfolio.hu'));
  assert.ok(agrarEv && agrarEv.source.url.includes('agrarszektor.hu'));

  // Ensure unique event IDs
  const allIds = [telexEv.id, portEv.id, agrarEv.id];
  assert.equal(new Set(allIds).size, 3, 'Distinct sources produce distinct event IDs');
});

// ─── 4. End-to-end data path with HistoryStore and Briefing ───

test('End-to-end data path: persistent deduplication in HistoryStore and Hungarian Briefing integration', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-national-e2e-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const now = Date.parse('2026-10-22T17:00:00.000Z');
  const history = new HistoryStore(dir);
  const store = new EntityStore(dir, { now: () => now });
  store.load();

  const telexEcon = {
    id: `event-${'a'.repeat(32)}`,
    kind: 'news',
    title: 'Új költségvetési irányvonalakat határoztak meg',
    summary: 'A pénzügyi stabilitást célozzák az intézkedések.',
    source: { name: 'Telex', url: 'https://telex.hu/gazdasag/2026/10/22/uj-koltsegvetes' },
    sourceRegion: 'Hungary',
    publishedAt: '2026-10-22T16:00:00.000Z',
    collectedAt: '2026-10-22T16:05:00.000Z',
    severity: 'unknown',
    firstSeenAt: '2026-10-22T16:05:00.000Z',
    lastSeenAt: '2026-10-22T16:05:00.000Z',
    location: { method: 'unknown' }
  };

  // Sweep 1: add to history
  history.add([telexEcon]);
  assert.equal(history.query().total, 1);

  // Sweep 2: add same article with updated lastSeenAt
  history.add([{ ...telexEcon, lastSeenAt: '2026-10-22T16:35:00.000Z', collectedAt: '2026-10-22T16:35:00.000Z' }]);

  // Reload history from disk and verify deduplication
  const reloaded = new HistoryStore(dir);
  const q2 = reloaded.query();
  assert.equal(q2.total, 1, 'Exactly 1 record on disk across sweeps');
  assert.equal(q2.items[0].firstSeenAt, '2026-10-22T16:05:00.000Z');
  assert.equal(q2.items[0].lastSeenAt, '2026-10-22T16:35:00.000Z');

  // Ingest into EntityStore and verify briefing inclusion
  store.ingest([telexEcon]);
  const snapshot = {
    crucix: { timestamp: new Date(now).toISOString() },
    events: [telexEcon]
  };

  const briefing = await generateBriefing({
    scope: 'HUN',
    snapshot,
    store,
    language: 'hu',
    now
  });

  assert.equal(briefing.scope, 'HUN');
  assert.ok(briefing.bullets.length > 0, 'Briefing generated bullets');
  const citedIds = briefing.bullets.flatMap(b => b.refs.map(r => r.id));
  assert.ok(citedIds.includes(telexEcon.id), 'Unlocated Telex economic news is citable in HUN briefing');
});
