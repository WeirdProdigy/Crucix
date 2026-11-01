// Tests for Generic RSS Adapter and Gazetteer
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RSS_SOURCES,
  cleanCanonicalUrl,
  isSponsoredOrPr,
  classifyNewsCategory,
  extractSection,
  isSourceEnabled,
  parseGenericRss,
  createRssBriefing,
  checkRobotsTxt,
  resetRssState,
  dehirRss,
  telexRss,
  rss444,
  rss24hu,
  indexRss,
  hvgRss,
  portfolioRss,
  qubitRss
} from '../apis/sources/generic-rss.mjs';

import {
  HAJDU_BIHAR_KSH_SETTLEMENTS,
  AMBIGUOUS_SETTLEMENT_NAMES,
  detectSettlementMention,
  hasCountyContext
} from '../apis/utils/settlement-gazetteer.mjs';

import { FEED_POLICIES, ALL_POLICIES } from '../apis/utils/freshness.mjs';
import { normalizeLiveSources, freshLiveSnapshot } from '../lib/intelligence/live-sources.mjs';
import { partitionEventsByView, getViewNews, VIEWS, VIEW_CATEGORIES, VIEW_NEWS_CAP, TOTAL_NEWS_CAP } from '../lib/intelligence/views.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { AlertEngine } from '../lib/alerts/engine.mjs';
import { DEFAULT_RULES } from '../lib/alerts/rules.mjs';

const REF_NOW = Date.parse('2026-10-28T12:00:00.000Z');

// SYNTHETIC FIXTURE [TESZTADAT] - Strictly synthetic, no real article headlines
const SYNTHETIC_NEWS_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>[TESZTADAT] Teszt Hírforrás</title>
    <link>https://example.com/rss</link>
    <lastBuildDate>Wed, 28 Oct 2026 11:30:00 +0000</lastBuildDate>
    <item>
      <title>[TESZTADAT] Útfelújítás kezdődik Debrecen és Derecske között</title>
      <link>https://example.com/hirek/ut-felujitas?utm_source=rss&amp;utm_medium=feed&amp;fbclid=xyz123</link>
      <guid isPermaLink="false">synthetic-item-1</guid>
      <pubDate>Wed, 28 Oct 2026 11:00:00 +0000</pubDate>
      <category>Közlekedés</category>
      <description>Ez a leírás szövege, amely szigorúan eldobásra kerül és soha nem tárolódik a tárolóban.</description>
      <dc:creator>Teszt Újságíró</dc:creator>
    </item>
    <item>
      <title>[TESZTADAT] Baleset miatt forgalomkorlátozás Hajdúszoboszló térségében</title>
      <link>https://example.com/hirek/baleset-hajduszoboszlo</link>
      <guid isPermaLink="true">https://example.com/hirek/baleset-hajduszoboszlo</guid>
      <pubDate>Wed, 28 Oct 2026 10:15:00 +0000</pubDate>
      <category>Balesetek</category>
      <description>Részletes baleseti tudósítás leírása, nem tárolandó.</description>
    </item>
    <item>
      <title>[TESZTADAT] Új kutatási központ nyílik (x)</title>
      <link>https://example.com/hirek/pr-cikk-1</link>
      <pubDate>Wed, 28 Oct 2026 09:30:00 +0000</pubDate>
      <category>Gazdaság</category>
      <description>Szponzorált termékbemutató szöveg.</description>
    </item>
    <item>
      <title>[TESZTADAT] Szponzorált termékteszt a boltokban</title>
      <link>https://example.com/hirek/pr-cikk-2</link>
      <pubDate>Wed, 28 Oct 2026 09:00:00 +0000</pubDate>
      <category>PR</category>
      <description>Fizetett hirdetés.</description>
    </item>
    <item>
      <title>[TESZTADAT] Állategészségügyi intézkedések: madárinfluenza gyanú egy telepen</title>
      <link>https://example.com/agrar/madarinfluenza-intezkedes</link>
      <pubDate>Wed, 28 Oct 2026 08:30:00 +0000</pubDate>
      <category>Agrár</category>
      <description>Szakmai jelentés leírása.</description>
    </item>
    <item>
      <title>[TESZTADAT] Új napelempark és villamosenergia hálózatbővítés a megyében</title>
      <link>https://example.com/gazdasag/energia-halozat</link>
      <pubDate>Wed, 28 Oct 2026 08:00:00 +0000</pubDate>
      <category>Energia</category>
      <description>Infrastruktúra fejlesztés.</description>
    </item>
    <item>
      <title>[TESZTADAT] Csillagászati felfedezés: új exobolygót azonosítottak</title>
      <link>https://example.com/tudomany/uj-exobolygo</link>
      <pubDate>Wed, 28 Oct 2026 07:30:00 +0000</pubDate>
      <category>Tudomány</category>
      <description>Tudományos hír.</description>
    </item>
    <item>
      <title>[TESZTADAT] Nemzetközi békecsúcs kezdődött Genfben</title>
      <link>https://example.com/kulfold/bekecsucs-genf</link>
      <pubDate>Wed, 28 Oct 2026 07:00:00 +0000</pubDate>
      <category>Külföld</category>
      <description>Világpolitikai esemény.</description>
    </item>
  </channel>
</rss>`;

test('1. Freshness policies: All 8 RSS sources registered with tailored thresholds', () => {
  const sources = [
    'RSS-Dehir', 'RSS-Telex', 'RSS-444', 'RSS-24hu',
    'RSS-Index', 'RSS-HVG', 'RSS-Portfolio', 'RSS-Qubit'
  ];

  for (const s of sources) {
    assert.ok(FEED_POLICIES[s], `${s} must be registered in FEED_POLICIES`);
    assert.ok(ALL_POLICIES[s], `${s} must be present in ALL_POLICIES`);
    assert.ok(RSS_SOURCES[s], `${s} must be present in RSS_SOURCES`);

    if (s === 'RSS-Qubit') {
      // Qubit publishes rarely (~4-5 articles/week)
      assert.equal(FEED_POLICIES[s].maxAgeMs, 24 * 3600 * 1000, 'Qubit maxAgeMs should be 24h');
      assert.equal(FEED_POLICIES[s].observationMaxAgeMs, 168 * 3600 * 1000, 'Qubit observationMaxAgeMs should be 7 days');
    } else {
      assert.equal(FEED_POLICIES[s].maxAgeMs, 6 * 3600 * 1000, 'Standard feed maxAgeMs should be 6h');
      assert.equal(FEED_POLICIES[s].observationMaxAgeMs, 48 * 3600 * 1000, 'Standard feed observationMaxAgeMs should be 48h');
    }
  }
});

test('2. Opt-in behavior: Disabled by default without env var, strictly zero network calls', async () => {
  resetRssState();
  let networkCalls = 0;
  const mockFetch = async () => {
    networkCalls++;
    return { status: 200, rawText: SYNTHETIC_NEWS_XML };
  };

  // Run all 8 briefings without opt-in env vars
  const briefingFns = [dehirRss, telexRss, rss444, rss24hu, indexRss, hvgRss, portfolioRss, qubitRss];
  for (const fn of briefingFns) {
    const res = await fn({ fetchFn: mockFetch, now: REF_NOW });
    assert.equal(res.status, 'disabled');
    assert.equal(res.observations.length, 0);
  }

  assert.equal(networkCalls, 0, 'Zero network calls made when disabled');
});

test('3. Opt-in behavior: Enabled via env var or options flag', async () => {
  resetRssState();
  let networkCalls = 0;
  const mockFetch = async () => {
    networkCalls++;
    return {
      status: 200,
      rawText: SYNTHETIC_NEWS_XML,
      headers: { 'content-type': 'application/rss+xml' }
    };
  };

  // Enabled via options.enabled = true (fetches robots.txt + feed = 2 network calls)
  const res = await telexRss({ fetchFn: mockFetch, enabled: true, now: REF_NOW });
  assert.equal(res.status, 'ok');
  assert.ok(res.observations.length > 0);
  assert.equal(networkCalls, 2, '2 network calls made (robots.txt and feed)');
});

test('4. Legal/Copyright compliance: <description>, lead, creator, full text are strictly DISCARDED', () => {
  const sourceConfig = RSS_SOURCES['RSS-Telex'];
  const res = parseGenericRss(SYNTHETIC_NEWS_XML, sourceConfig, { now: REF_NOW });
  assert.equal(res.status, 'ok');

  for (const obs of res.observations) {
    assert.equal(obs.description, undefined, 'description field must NEVER exist');
    assert.equal(obs.lead, undefined, 'lead field must NEVER exist');
    assert.equal(obs.creator, undefined, 'creator field must NEVER exist');
    assert.equal(obs.author, undefined, 'author field must NEVER exist');
    assert.equal(obs.fullText, undefined, 'fullText field must NEVER exist');
    assert.equal(obs.content, undefined, 'content field must NEVER exist');

    // Stored fields check
    assert.ok(obs.title);
    assert.ok(obs.link);
    assert.ok(obs.guid);
    assert.ok(obs.publishedAt);
    assert.ok(obs.observedAt);
    assert.ok(obs.source);
    assert.ok(obs.newsCategory);
    assert.ok(obs.facts);
  }
});

test('5. Canonical link cleaning: Strips tracking params and hashes', () => {
  const dirtyUrl = 'https://telex.hu/belfold/2026/10/28/cikk?utm_source=rss&utm_medium=feed&utm_campaign=daily&fbclid=IwAR123&gclid=abc#section-comments';
  const clean = cleanCanonicalUrl(dirtyUrl);
  assert.equal(clean, 'https://telex.hu/belfold/2026/10/28/cikk');

  const cleanUrl = 'https://dehir.hu/debrecen/hir-cime/2026/10/28/';
  assert.equal(cleanCanonicalUrl(cleanUrl), cleanUrl);
});

test('6. PR / Sponsored filtering: Filters items with (x), [x], [pr], or PR category', () => {
  assert.equal(isSponsoredOrPr({ title: '[TESZTADAT] Új termék (x)', categories: [] }), true);
  assert.equal(isSponsoredOrPr({ title: '[TESZTADAT] Cégbemutató [PR]', categories: [] }), true);
  assert.equal(isSponsoredOrPr({ title: 'Hirdetés: Akciós ajánlatok', categories: [] }), true);
  assert.equal(isSponsoredOrPr({ title: '[TESZTADAT] Normál hír', categories: ['PR'] }), true);
  assert.equal(isSponsoredOrPr({ title: '[TESZTADAT] Normál hír', categories: ['Szponzorált tartalom'] }), true);

  // Normal articles should NOT be flagged
  assert.equal(isSponsoredOrPr({ title: '[TESZTADAT] Kormányzati program indul', categories: ['Gazdaság'] }), false);
  assert.equal(isSponsoredOrPr({ title: '[TESZTADAT] Mbappé bocsánatkérése a szponzora miatt', categories: ['Sport'] }), false);

  // Check synthetic XML parse result: the 2 PR items must be filtered out
  const sourceConfig = RSS_SOURCES['RSS-Telex'];
  const res = parseGenericRss(SYNTHETIC_NEWS_XML, sourceConfig, { now: REF_NOW });
  const titles = res.observations.map(o => o.title);
  assert.ok(!titles.some(t => t.includes('(x)')), 'Item with (x) must be filtered out');
  assert.ok(!titles.some(t => t.includes('Szponzorált termékteszt')), 'Item with category PR must be filtered out');
});

test('7. Dedicated News Categorization: Classifies into news_* categories and NEVER CAP event categories', () => {
  const sourceConfig = RSS_SOURCES['RSS-Telex'];
  const res = parseGenericRss(SYNTHETIC_NEWS_XML, sourceConfig, { now: REF_NOW });

  const categories = res.observations.map(o => o.newsCategory);
  assert.ok(categories.includes('news_hazard'), 'Accident headline categorized as news_hazard');
  assert.ok(categories.includes('news_agriculture'), 'Bird flu headline categorized as news_agriculture');
  assert.ok(categories.includes('news_energy'), 'Solar/energy headline categorized as news_energy');
  assert.ok(categories.includes('news_science'), 'Astronomy headline categorized as news_science');
  assert.ok(categories.includes('news_global'), 'Geneva peace summit categorized as news_global');
  assert.ok(categories.includes('news_local'), 'Debrecen headline categorized as news_local');

  for (const obs of res.observations) {
    assert.equal(obs.kind, 'news');
    assert.equal(obs.domain, 'security');
    // Ensure no CAP hazard category was assigned
    assert.ok(!['meteoalarm', 'earthquake', 'severeWeather', 'cbrn'].includes(obs.newsCategory));
  }
});

test('8. Settlement extraction: Shared gazetteer, ambiguous names handling and county context', () => {
  // 1. Regular unambiguous settlement detection
  const debrecenRes = detectSettlementMention('[TESZTADAT] Útlezárás Debrecen belvárosában');
  assert.equal(debrecenRes.territoryLevel, 'settlement');
  assert.equal(debrecenRes.settlementName, 'Debrecen');
  assert.equal(debrecenRes.isConfirmedLocal, false, 'News mentions are NEVER confirmedLocal');
  assert.equal(debrecenRes.needsLocalReview, true);

  // 2. Ambiguous names without county context -> unknown / ambiguous
  const sapRes = detectSettlementMention('[TESZTADAT] Baleset Sáp közelében');
  assert.equal(sapRes.territoryLevel, 'unknown');
  assert.equal(sapRes.matchState, 'ambiguous');

  const toldRes = detectSettlementMention('[TESZTADAT] Útépítés Told határában');
  assert.equal(toldRes.territoryLevel, 'unknown');
  assert.equal(toldRes.matchState, 'ambiguous');

  const szerepRes = detectSettlementMention('[TESZTADAT] Viharos szél Szerep térségében');
  assert.equal(szerepRes.territoryLevel, 'unknown');
  assert.equal(szerepRes.matchState, 'ambiguous');

  // 3. Lowercase common nouns do NOT trigger ambiguous settlement
  const commonNounRes = detectSettlementMention('[TESZTADAT] Fontos szerepet játszott az új technológia');
  assert.equal(commonNounRes.territoryLevel, 'county');
  assert.equal(commonNounRes.settlementName, undefined);

  // 4. Ambiguous name with explicit county context and implicit county source
  const sapWithCounty = detectSettlementMention('[TESZTADAT] Baleset Sáp közelében (Hajdú-Bihar vármegye)', undefined, { implicitCountyContext: true });
  assert.equal(sapWithCounty.territoryLevel, 'settlement');
  assert.equal(sapWithCounty.settlementName, 'Sáp');
  assert.equal(sapWithCounty.isConfirmedLocal, false);
});

test('9. Deduplication: Duplicate items with identical canonical URL are discarded', () => {
  const duplicateXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Dedup Test</title>
    <item>
      <title>[TESZTADAT] Esemény 1</title>
      <link>https://example.com/cikk-1?utm_source=rss</link>
      <pubDate>Wed, 28 Oct 2026 11:00:00 +0000</pubDate>
    </item>
    <item>
      <title>[TESZTADAT] Esemény 1 Ismétlés</title>
      <link>https://example.com/cikk-1?utm_source=facebook</link>
      <pubDate>Wed, 28 Oct 2026 11:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

  const sourceConfig = RSS_SOURCES['RSS-Telex'];
  const res = parseGenericRss(duplicateXml, sourceConfig, { now: REF_NOW });
  assert.equal(res.observations.length, 1, 'Duplicate canonical URL must be processed only once');
});

test('10. Technical block enforcement: HTTP 403 and 429 return status disabled without workarounds', async () => {
  resetRssState();
  const sourceConfig = RSS_SOURCES['RSS-Telex'];
  const robotsOpt = { robotsTxtContent: 'User-agent: *\nAllow: /\n' };

  // Test 403 Forbidden
  const mock403Fetch = async () => ({ status: 403, error: 'HTTP 403 Forbidden' });
  const briefing403 = createRssBriefing('RSS-Telex');
  const res403 = await briefing403({ fetchFn: mock403Fetch, enabled: true, now: REF_NOW, ...robotsOpt });
  assert.equal(res403.status, 'disabled');
  assert.equal(res403.observations.length, 0);

  // Test 429 Rate Limit
  const mock429Fetch = async () => ({
    status: 429,
    headers: { 'retry-after': '60' },
    error: 'HTTP 429 Too Many Requests'
  });
  const res429 = await briefing403({ fetchFn: mock429Fetch, enabled: true, now: REF_NOW, ...robotsOpt });
  assert.equal(res429.status, 'disabled');

  // Verify backoff: consecutive call within backoff window makes ZERO network calls
  let consecutiveCalls = 0;
  const mockTrackFetch = async () => {
    consecutiveCalls++;
    return { status: 200, rawText: SYNTHETIC_NEWS_XML };
  };
  const resBackoff = await briefing403({ fetchFn: mockTrackFetch, enabled: true, now: REF_NOW + 10_000, ...robotsOpt });
  assert.equal(resBackoff.status, 'disabled');
  assert.equal(consecutiveCalls, 0, 'No network call made during active backoff window');

  resetRssState();
});

test('11. Conditional GET: Supports 304 Not Modified and reuses cached observations', async () => {
  resetRssState();
  let fetchAttempts = 0;
  let sentHeaders = null;
  const robotsOpt = { robotsTxtContent: 'User-agent: *\nAllow: /\n' };

  const mockFetch = async (url, opts) => {
    fetchAttempts++;
    sentHeaders = opts.headers || {};
    if (fetchAttempts === 1) {
      return {
        status: 200,
        rawText: SYNTHETIC_NEWS_XML,
        headers: {
          etag: '"test-etag-123"',
          'last-modified': 'Wed, 28 Oct 2026 11:30:00 GMT'
        }
      };
    }
    // Second fetch returns 304
    return { status: 304, headers: {} };
  };

  const briefing = createRssBriefing('RSS-Telex');

  // 1. Initial 200 fetch
  const res1 = await briefing({ fetchFn: mockFetch, enabled: true, now: REF_NOW, ...robotsOpt });
  assert.equal(res1.status, 'ok');
  assert.ok(res1.observations.length > 0);
  assert.equal(fetchAttempts, 1);

  // 2. Second fetch sending conditional headers
  const res2 = await briefing({ fetchFn: mockFetch, enabled: true, now: REF_NOW + 1000, ...robotsOpt });
  assert.equal(res2.status, 'ok');
  assert.equal(res2.cached, true);
  assert.equal(res2.observations.length, res1.observations.length);
  assert.equal(fetchAttempts, 2);
  assert.equal(sentHeaders['If-None-Match'], '"test-etag-123"');
  assert.equal(sentHeaders['If-Modified-Since'], 'Wed, 28 Oct 2026 11:30:00 GMT');

  resetRssState();
});

test('12. Payload ceiling enforcement: Rejects payloads exceeding 1 MB', async () => {
  resetRssState();
  const oversizedXml = '<rss>' + 'x'.repeat(1024 * 1024 + 10) + '</rss>';
  const mockFetch = async () => ({
    status: 200,
    rawText: oversizedXml
  });

  const briefing = createRssBriefing('RSS-Telex');
  const res = await briefing({ fetchFn: mockFetch, enabled: true, now: REF_NOW, robotsTxtContent: 'User-agent: *\nAllow: /\n' });
  assert.equal(res.status, 'error');
  assert.ok(res.error.includes('1 MB'));

  resetRssState();
});

test('13. Alert notification suppression: Generic news items trigger ZERO notifying alerts', (t) => {
  const sourceConfig = RSS_SOURCES['RSS-Telex'];
  const parsed = parseGenericRss(SYNTHETIC_NEWS_XML, sourceConfig, { now: REF_NOW });
  assert.equal(parsed.status, 'ok');

  // Convert observations to standard Crucix event records
  const newsEvents = parsed.observations.map((obs, idx) => ({
    id: `event-rss-${idx}`,
    kind: 'news',
    severity: 'low',
    title: obs.title,
    summary: '',
    source: { name: obs.source.name, url: obs.link, status: 'ok' },
    observedAt: obs.publishedAt,
    publishedAt: obs.publishedAt,
    location: { lat: null, lon: null, method: 'unknown', label: obs.facts.settlement, precision: 'settlement' },
    facts: obs.facts,
    territory: obs.territory
  }));

  const root = mkdtempSync(join(tmpdir(), 'crucix-rss-alert-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const engine = new AlertEngine(root, {
    now: () => REF_NOW,
    logger: { warn: () => {}, error: () => {}, log: () => {}, info: () => {} }
  });
  engine.load();

  // Bootstrap sweep
  engine.evaluate({ events: [] });

  // Sweep with news events
  const result = engine.evaluate({ events: newsEvents });

  // Verify that any created alerts have notify: false, and zero notifying alerts were generated
  const notifyingAlerts = (result.created || []).filter(a => a.notify);
  assert.equal(
    notifyingAlerts.length,
    0,
    'News events must NEVER trigger notifying alerts (strictly informational, no alarm/push)'
  );
});

test('14. Pipeline lifecycle: News items survive normalizeLiveSources and freshLiveSnapshot into active events', () => {
  const sourceConfig = RSS_SOURCES['RSS-Telex'];
  const parsed = parseGenericRss(SYNTHETIC_NEWS_XML, sourceConfig, { now: REF_NOW });
  assert.equal(parsed.status, 'ok');

  const normalized = normalizeLiveSources({
    'RSS-Telex': parsed
  }, REF_NOW);

  const telexFeed = normalized.find(f => f.source === 'RSS-Telex');
  assert.ok(telexFeed, 'RSS-Telex present in normalized liveSources');
  assert.ok(telexFeed.observations.length > 0);

  const firstObs = telexFeed.observations[0];
  const newsEvent = {
    id: 'event-0123456789abcdef0123456789abcdef',
    title: firstObs.title,
    kind: 'news',
    severity: 'low',
    domain: 'security',
    observedAt: firstObs.observedAt,
    publishedAt: firstObs.publishedAt,
    source: { name: 'RSS-Telex', url: firstObs.url, status: 'ok' },
    territory: firstObs.territory,
    facts: firstObs.facts
  };

  const snapshot = {
    meta: { timestamp: new Date(REF_NOW).toISOString() },
    liveSources: normalized,
    events: [newsEvent],
    staleEvents: [],
    coverage: [{
      id: 'RSS-Telex',
      name: 'RSS-Telex',
      domain: 'security',
      status: 'ok',
      origin: 'live',
      isSnapshot: false
    }]
  };

  const fresh = freshLiveSnapshot(snapshot, REF_NOW);
  assert.equal(fresh.events.length, 1, 'News event must remain in active events');
  assert.equal(fresh.staleEvents.length, 0, 'News event must NOT be moved to staleEvents');

  const cov = fresh.coverage.find(c => c.sourceId === 'RSS-Telex' || c.sourceName === 'RSS-Telex');
  assert.ok(cov, 'Coverage entry exists for RSS-Telex');
  assert.equal(cov.status, 'ok_data', 'Coverage must be ok_data');
});

test('15. Ambiguous settlement gazetteer hardening: Reject personal names, compound words, accept locatives', () => {
  // Negative test: Fülöp-szigetek
  const resFilippines = detectSettlementMention('[TESZTADAT] Vihar pusztított a Fülöp-szigetek térségében');
  assert.notEqual(resFilippines.settlementName, 'Fülöp', 'Fülöp-szigetek must NOT match Fülöp settlement');
  assert.notEqual(resFilippines.territoryLevel, 'settlement');

  // Negative test: Fülöp herceg / forename
  const resPrince = detectSettlementMention('[TESZTADAT] Fülöp herceg megnyitotta a kiállítást');
  assert.notEqual(resPrince.settlementName, 'Fülöp', 'Fülöp herceg must NOT match Fülöp settlement');
  assert.notEqual(resPrince.territoryLevel, 'settlement');

  // Negative test: Fülöp Márk / forename + surname
  const resMark = detectSettlementMention('[TESZTADAT] Fülöp Márk nyerte a versenyt');
  assert.notEqual(resMark.settlementName, 'Fülöp', 'Fülöp Márk must NOT match Fülöp settlement');
  assert.notEqual(resMark.territoryLevel, 'settlement');

  // Negative test: Compound word inside noun (állampolgár -> Polgár)
  const resCitizen = detectSettlementMention('[TESZTADAT] Magyar állampolgár vesztette életét az incidensben');
  assert.notEqual(resCitizen.settlementName, 'Polgár', 'állampolgár must NOT match Polgár settlement');
  assert.notEqual(resCitizen.territoryLevel, 'settlement');

  // Positive test: Locative inflected form Fülöpön
  const resFulopon = detectSettlementMention('[TESZTADAT] Halálos baleset történt Fülöpön a főúton');
  assert.equal(resFulopon.settlementName, 'Fülöp', 'Fülöpön must match Fülöp settlement');
  assert.equal(resFulopon.territoryLevel, 'settlement');
  assert.equal(resFulopon.needsLocalReview, true);
  assert.equal(resFulopon.isConfirmedLocal, false);

  // Positive test: Locative inflected forms for other ambiguous settlements
  const resEbes = detectSettlementMention('[TESZTADAT] Útlezárás Ebesen a vasútállomásnál');
  assert.equal(resEbes.settlementName, 'Ebes');

  const resSzerep = detectSettlementMention('[TESZTADAT] Ég egy lakóház Szerepen');
  assert.equal(resSzerep.settlementName, 'Szerep');
});

test('16. 304 Not Modified health: Consecutive 304s over 7 hours maintain status "ok" and retain items', async () => {
  resetRssState();
  const ONE_HOUR = 3600 * 1000;
  const START_TIME = Date.parse('2026-10-28T08:00:00.000Z');
  let fetchCount = 0;

  const mockFetch = async (url, opts) => {
    fetchCount++;
    if (fetchCount === 1) {
      return {
        status: 200,
        rawText: SYNTHETIC_NEWS_XML,
        headers: {
          etag: '"initial-etag-304"',
          'last-modified': new Date(START_TIME).toUTCString()
        }
      };
    }
    return { status: 304, headers: {} };
  };

  const briefing = createRssBriefing('RSS-Telex');
  const robotsOpt = { robotsTxtContent: 'User-agent: *\nAllow: /\n' };

  // Fetch at T=0
  const initial = await briefing({ fetchFn: mockFetch, enabled: true, now: START_TIME, ...robotsOpt });
  assert.equal(initial.status, 'ok');
  assert.equal(initial.observations.length > 0, true);

  // Simulate hourly 304 fetches for 7 hours (T=1h to T=7h)
  for (let hour = 1; hour <= 7; hour++) {
    const curTime = START_TIME + hour * ONE_HOUR;
    const res = await briefing({ fetchFn: mockFetch, enabled: true, now: curTime, ...robotsOpt });
    assert.equal(res.status, 'ok', `Source status must remain 'ok' at hour ${hour} of 304s`);
    assert.equal(res.stale, false, `Source must NOT become stale at hour ${hour} of 304s`);
    assert.equal(res.cached, true);
    assert.equal(res.observations.length, initial.observations.length, `Observations must be retained at hour ${hour}`);
  }

  assert.equal(fetchCount, 8);
  resetRssState();
});

test('17. Gap detection (possibleGap): Detects feed roll-forward gap when oldest item is newer than previous newest item', () => {
  const sourceConfig = RSS_SOURCES['RSS-Telex'];

  const XML_CYCLE_1 = `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0">
    <channel>
      <title>Feed</title>
      <item>
        <title>[TESZTADAT] Hír 1</title>
        <link>https://example.com/h1</link>
        <pubDate>Wed, 28 Oct 2026 08:00:00 +0000</pubDate>
      </item>
      <item>
        <title>[TESZTADAT] Hír 2</title>
        <link>https://example.com/h2</link>
        <pubDate>Wed, 28 Oct 2026 08:30:00 +0000</pubDate>
      </item>
    </channel>
  </rss>`;

  const parsed1 = parseGenericRss(XML_CYCLE_1, sourceConfig, { now: REF_NOW });
  assert.equal(parsed1.diagnostics.possibleGap, false);
  assert.equal(parsed1.diagnostics.newestPubDate, '2026-10-28T08:30:00.000Z');

  // Cycle 2: Oldest item (09:00:00) is strictly newer than cycle 1 newest (08:30:00) -> GAP!
  const XML_CYCLE_2_GAP = `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0">
    <channel>
      <title>Feed</title>
      <item>
        <title>[TESZTADAT] Hír 3</title>
        <link>https://example.com/h3</link>
        <pubDate>Wed, 28 Oct 2026 09:00:00 +0000</pubDate>
      </item>
      <item>
        <title>[TESZTADAT] Hír 4</title>
        <link>https://example.com/h4</link>
        <pubDate>Wed, 28 Oct 2026 09:30:00 +0000</pubDate>
      </item>
    </channel>
  </rss>`;

  const parsed2 = parseGenericRss(XML_CYCLE_2_GAP, sourceConfig, {
    now: REF_NOW,
    cached: { lastNewestPubDate: parsed1.diagnostics.newestPubDate }
  });
  assert.equal(parsed2.diagnostics.possibleGap, true, 'possibleGap must be true when all items are newer than previous newest');

  // Cycle 3: Overlapping feed (oldest item 09:15 <= previous newest 09:30) -> NO GAP
  const XML_CYCLE_3_OVERLAP = `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0">
    <channel>
      <title>Feed</title>
      <item>
        <title>[TESZTADAT] Hír 4b</title>
        <link>https://example.com/h4b</link>
        <pubDate>Wed, 28 Oct 2026 09:15:00 +0000</pubDate>
      </item>
      <item>
        <title>[TESZTADAT] Hír 5</title>
        <link>https://example.com/h5</link>
        <pubDate>Wed, 28 Oct 2026 10:00:00 +0000</pubDate>
      </item>
    </channel>
  </rss>`;

  const parsed3 = parseGenericRss(XML_CYCLE_3_OVERLAP, sourceConfig, {
    now: REF_NOW,
    cached: { lastNewestPubDate: parsed2.diagnostics.newestPubDate }
  });
  assert.equal(parsed3.diagnostics.possibleGap, false, 'possibleGap must be false when feed overlaps');
});

test('18. Event counter isolation: News events (kind: news / news_*) DO NOT count into physical event counters', () => {
  // 1 real CAP hazard alert
  const capAlert = {
    id: 'event-cap-0001',
    identifier: 'cap-alert-001',
    sender: 'meteoalarm',
    kind: 'weather',
    severity: 'high',
    title: '[TESZTADAT] Viharjelzés',
    publishedAt: new Date(REF_NOW).toISOString(),
    territory: {
      territoryLevel: 'settlement',
      settlementId: 'bihartorda',
      settlementName: 'Bihartorda',
      kshSettlement: '09012',
      isConfirmedLocal: true
    }
  };

  // 2 news items
  const news1 = {
    id: 'news-0001',
    kind: 'news',
    newsCategory: 'news_local',
    title: '[TESZTADAT] Debreceni közlekedési hír',
    publishedAt: new Date(REF_NOW).toISOString(),
    territory: {
      territoryLevel: 'settlement',
      settlementId: 'debrecen',
      settlementName: 'Debrecen',
      needsLocalReview: true,
      isConfirmedLocal: false
    }
  };

  const news2 = {
    id: 'news-0002',
    kind: 'news',
    newsCategory: 'news_hazard',
    title: '[TESZTADAT] Országos baleseti összefoglaló',
    publishedAt: new Date(REF_NOW).toISOString(),
    territory: {
      territoryLevel: 'national',
      needsLocalReview: false,
      isConfirmedLocal: false
    }
  };

  const partitions = partitionEventsByView([capAlert, news1, news2]);

  // Check Local view: exactly 1 physical event (capAlert), exactly 1 news item (news1 in local view)
  const localView = partitions[VIEWS.LOCAL];
  assert.equal(localView.totalEvents, 1, 'News must not increment totalEvents');
  assert.equal(localView.uniqueEvents, 1, 'News must not increment uniqueEvents');
  assert.equal(localView.cancelledChains, 0);
  assert.equal(localView.breakdown.confirmedLocal, 1);
  assert.equal(localView.breakdown.needsReview, 0, 'News needsReview must not enter physical breakdown.needsReview');
  assert.equal(localView.newsCount, 1, 'Local view has exactly 1 local news item');
  assert.equal(getViewNews(partitions, VIEWS.LOCAL).length, 1);
  assert.equal(getViewNews(partitions, VIEWS.LOCAL)[0].id, 'news-0001');

  // Check National view: 1 national news item (news2)
  const nationalView = partitions[VIEWS.NATIONAL];
  assert.equal(nationalView.newsCount, 1, 'National view contains national news item');
  assert.equal(getViewNews(partitions, VIEWS.NATIONAL).length, 1);
  assert.equal(getViewNews(partitions, VIEWS.NATIONAL)[0].id, 'news-0002');

  // Check All news view: contains both news items
  assert.equal(partitions.all.newsCount, 2, 'All news partition contains both news items');
  assert.equal(getViewNews(partitions, 'all').length, 2);
});

test('19. PR filtering and Telex Közlemény diagnostics accounting', () => {
  const sourceConfig = RSS_SOURCES['RSS-Telex'];
  const XML_WITH_PR_AND_PROMO = `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0">
    <channel>
      <title>Telex</title>
      <item>
        <title>[TESZTADAT] Rendes hír a világból</title>
        <link>https://telex.hu/kulfold/2026/10/28/hir-1</link>
        <pubDate>Wed, 28 Oct 2026 10:00:00 +0000</pubDate>
        <category>Külföld</category>
      </item>
      <item>
        <title>[TESZTADAT] Szponzorált cikk a piacról (pr)</title>
        <link>https://telex.hu/gazdasag/2026/10/28/pr-1</link>
        <pubDate>Wed, 28 Oct 2026 09:30:00 +0000</pubDate>
        <category>PR</category>
      </item>
      <item>
        <title>[TESZTADAT] Telex rendezvény és beszélgetés</title>
        <link>https://telex.hu/kozlemeny/2026/10/28/telex-rendezveny</link>
        <pubDate>Wed, 28 Oct 2026 09:00:00 +0000</pubDate>
        <category>Közlemény</category>
      </item>
    </channel>
  </rss>`;

  const parsed = parseGenericRss(XML_WITH_PR_AND_PROMO, sourceConfig, { now: REF_NOW });
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.observations.length, 2, 'PR item was discarded, regular and promo items retained');
  assert.equal(parsed.diagnostics.filteredPrCount, 1, 'filteredPrCount must be 1');
  assert.equal(parsed.diagnostics.publisherPromoCount, 1, 'publisherPromoCount must be 1');

  const promoObs = parsed.observations.find(o => o.isPublisherPromo);
  assert.ok(promoObs, 'Publisher promo observation flagged with isPublisherPromo: true');
  assert.equal(promoObs.section, 'kozlemeny');
});

test('20. News categories classification rules: Portfolio economy != energy, sport -> other, national, keyword overrides', () => {
  // 1. Portfolio economic section -> news_economy (NEVER news_energy)
  const portfolioCat = classifyNewsCategory('Növekedési kilátások a hazai bankszektorban', 'gazdasag', null, 'news_economy');
  assert.equal(portfolioCat, 'news_economy', 'Portfolio economic section must be news_economy');

  // 2. Telex sport -> news_other
  const sportCat = classifyNewsCategory('Kikapott a címvédő a bajnoki rangadón', 'sport', null, 'news_national');
  assert.equal(sportCat, 'news_other', 'Sport news must be classified as news_other');

  // 3. Domestic national -> news_national
  const nationalCat = classifyNewsCategory('Döntött a kormány a jövő évi költségvetésről', 'belfold', null, 'news_national');
  assert.equal(nationalCat, 'news_national', 'National news without county mention must be news_national');

  // 4. Hazard keyword in title OVERRIDES territory (settlement remains in territory)
  const hazardWithTerritory = detectSettlementMention('Súlyos baleset történt Debrecen belvárosában');
  const hazardCat = classifyNewsCategory('Súlyos baleset történt Debrecen belvárosában', 'hirek', hazardWithTerritory, 'news_national');
  assert.equal(hazardCat, 'news_hazard', 'Hazard keyword must override territorial category');
  assert.equal(hazardWithTerritory.settlementName, 'Debrecen', 'Settlement context preserved in territory object');

  // 5. Energy keyword in title
  const energyCat = classifyNewsCategory('Korszerűsítik az országos villamosenergia hálózatot', 'belfold', null, 'news_national');
  assert.equal(energyCat, 'news_energy', 'Electricity/energy keyword must classify as news_energy');

  // 6. Agriculture / epizootic keyword in title
  const agriCat = classifyNewsCategory('Afrikai sertéspestis megfigyelési körzet elrendelése', 'belfold', null, 'news_national');
  assert.equal(agriCat, 'news_agriculture', 'Epizootic keyword must classify as news_agriculture');
});

test('21. Accented settlement gazetteer: Unicode boundaries, punctuation, Ártánd, and állampolgár exclusion', () => {
  // 1. Ártánd newly added
  const artandRes = detectSettlementMention('Forgalomkorlátozás Ártándnál a határátkelőn!');
  assert.equal(artandRes.settlementName, 'Ártánd');
  assert.equal(artandRes.matchState, 'match');

  // 2. Álmosd with punctuation
  const almosdRes = detectSettlementMention('Viharos szél: Álmosdon tetőket rongált meg a vihar.');
  assert.equal(almosdRes.settlementName, 'Álmosd');

  // 3. Újléta with vowel locative (-n)
  const ujletaRes = detectSettlementMention('Új orvosi rendelőt avattak fel Újlétán, ünnepélyes keretek között.');
  assert.equal(ujletaRes.settlementName, 'Újléta');

  // 4. Hajdúszoboszló with vowel locative (-n) and quotation
  const szoboszloRes = detectSettlementMention('„Megtelt a strand Hajdúszoboszlón” - közölték.');
  assert.equal(szoboszloRes.settlementName, 'Hajdúszoboszló');

  // 5. Bedő with vowel locative (-n)
  const bedoRes = detectSettlementMention('Útfelújítás kezdődik Bedőn;');
  assert.equal(bedoRes.settlementName, 'Bedő');

  // 6. Nagyrábé with vowel locative (-n)
  const nagyrabeRes = detectSettlementMention('Korszerűsítették az iskolát Nagyrábén.');
  assert.equal(nagyrabeRes.settlementName, 'Nagyrábé');

  // 7. Compound word exclusion: állampolgár must NEVER match Polgár
  const polgarCompound = detectSettlementMention('Több magyar állampolgár rekedt a határon a szigorítások miatt.');
  assert.ok(!polgarCompound.settlementName, 'állampolgár must NOT match Polgár');
  assert.notEqual(polgarCompound.settlementId, 'polgar');
});

test('22. News payload deduplication, VIEW_NEWS_CAP=50, and isPublisherPromo exclusion', () => {
  const events = [];
  // Generate 70 synthetic news items for global view
  for (let i = 1; i <= 70; i++) {
    events.push({
      id: `news-item-${String(i).padStart(3, '0')}`,
      title: `[TESZTADAT] Hír tétel #${i}`,
      kind: 'news',
      newsCategory: 'news_global',
      source: { name: 'RSS-Telex', status: 'ok' },
      observedAt: '2026-10-28T10:00:00.000Z',
      publishedAt: '2026-10-28T10:00:00.000Z'
    });
  }

  // Add 1 publisher promo item
  events.push({
    id: 'news-promo-001',
    title: '[TESZTADAT] Kiadói közlemény',
    kind: 'news',
    newsCategory: 'news_other',
    section: 'kozlemeny',
    isPublisherPromo: true,
    source: { name: 'RSS-Telex', status: 'ok' },
    observedAt: '2026-10-28T10:00:00.000Z',
    publishedAt: '2026-10-28T10:00:00.000Z'
  });

  const partitioned = partitionEventsByView(events);

  // Global view received news
  const global = partitioned[VIEWS.GLOBAL];
  assert.equal(global.newsCount, 70, 'Publisher promo must NOT be counted in newsCount (70 items)');
  assert.equal(global.newsIds.length, 50, 'newsIds capped at VIEW_NEWS_CAP = 50');
  assert.equal(partitioned.news.length, 50, 'Shared news array holds ONLY referenced items (capped at 50 for global view)');
  assert.ok(!global.newsIds.includes('news-promo-001'), 'Promo item strictly excluded from newsIds');

  // Explicit accessor getViewNews returns 50 objects
  assert.equal(getViewNews(partitioned, VIEWS.GLOBAL).length, 50);
  assert.equal(getViewNews(partitioned, VIEWS.GLOBAL)[0].id, 'news-item-001');

  // JSON.stringify serializes cleanly and getViewNews recovers data completely
  const jsonStr = JSON.stringify(partitioned);
  const reParsed = JSON.parse(jsonStr);
  assert.equal(reParsed[VIEWS.GLOBAL].newsIds.length, 50);
  assert.equal(reParsed.news.length, 50, 'Only shared referenced news array is serialized');
  assert.equal(getViewNews(reParsed, VIEWS.GLOBAL).length, 50);
  assert.equal(getViewNews(reParsed, VIEWS.GLOBAL)[0].id, 'news-item-001');
});

test('23. Diagnostics counters: droppedStale, droppedPr, droppedDuplicate', () => {
  const sourceConfig = RSS_SOURCES['RSS-Telex'];
  const XML_WITH_DROPS = `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0">
    <channel>
      <title>[TESZTADAT] Dropped Items Test</title>
      <link>https://example.com</link>
      <lastBuildDate>Wed, 28 Oct 2026 12:00:00 +0000</lastBuildDate>
      <!-- Fresh valid item 1 -->
      <item>
        <title>[TESZTADAT] Friss hír 1</title>
        <link>https://example.com/fresh-1</link>
        <pubDate>Wed, 28 Oct 2026 11:00:00 +0000</pubDate>
      </item>
      <!-- Duplicate item of fresh-1 -->
      <item>
        <title>[TESZTADAT] Friss hír 1 duplikátum</title>
        <link>https://example.com/fresh-1</link>
        <pubDate>Wed, 28 Oct 2026 11:05:00 +0000</pubDate>
      </item>
      <!-- PR sponsored item -->
      <item>
        <title>[TESZTADAT] Szponzorált PR ajánlat (x)</title>
        <link>https://example.com/pr-item</link>
        <pubDate>Wed, 28 Oct 2026 11:00:00 +0000</pubDate>
      </item>
      <!-- Stale item: older than 48h (REF_NOW is Oct 28 12:00, item is Oct 24) -->
      <item>
        <title>[TESZTADAT] Nagyon régi hír</title>
        <link>https://example.com/stale-old</link>
        <pubDate>Sat, 24 Oct 2026 08:00:00 +0000</pubDate>
      </item>
    </channel>
  </rss>`;

  const parsed = parseGenericRss(XML_WITH_DROPS, sourceConfig, { now: REF_NOW });
  assert.equal(parsed.observations.length, 1, 'Only fresh-1 survives');
  assert.equal(parsed.diagnostics.droppedDuplicate, 1, 'droppedDuplicate must be 1');
  assert.equal(parsed.diagnostics.droppedPr, 1, 'droppedPr must be 1');
  assert.equal(parsed.diagnostics.droppedStale, 1, 'droppedStale must be 1');
});

test('24. Kataszter contract: exactly 82 settlements, required settlements present, ambiguous set', () => {
  assert.equal(HAJDU_BIHAR_KSH_SETTLEMENTS.length, 82, 'Gazetteer must contain exactly 82 unique settlements');
  const names = new Set(HAJDU_BIHAR_KSH_SETTLEMENTS.map(s => s.name));
  assert.equal(names.size, 82, 'All 82 settlement names must be unique');

  // Verify critical settlements
  assert.ok(names.has('Ártánd'), 'Ártánd must be present');
  assert.ok(names.has('Bihartorda'), 'Bihartorda must be present');
  assert.ok(names.has('Püspökladány'), 'Püspökladány must be present');
  assert.ok(names.has('Hajdúszoboszló'), 'Hajdúszoboszló must be present');
  assert.ok(names.has('Furta'), 'Furta must be present');
  assert.ok(names.has('Kokad'), 'Kokad must be present');

  // Verify all 10 ambiguous settlements
  const expectedAmbiguous = ['folyas', 'furta', 'tepe', 'fulop', 'told', 'sap', 'bojt', 'darvas', 'ebes', 'szerep'];
  for (const amb of expectedAmbiguous) {
    assert.ok(AMBIGUOUS_SETTLEMENT_NAMES.has(amb), `Ambiguous settlement '${amb}' must be in AMBIGUOUS_SETTLEMENT_NAMES`);
  }
});

test('25. Keyword refinements: Paksi FC vs atomerőmű, Energia KC vs hálózat, áramszünet Püspökladányban, sport guard', () => {
  // Paks: ONLY nuclear context
  assert.notEqual(classifyNewsCategory('Kikapott a Paksi FC idegenben', 'sport'), 'news_energy');
  assert.notEqual(classifyNewsCategory('Paksi FC győzelem a bajnokságban', 'hirek'), 'news_energy');
  assert.equal(classifyNewsCategory('Karbantartás a paksi atomerőmű 3. blokkjában', 'hirek'), 'news_energy');

  // Energia: sports teams must NOT match energy
  assert.notEqual(classifyNewsCategory('Bravúros győzelmet aratott az Energia KC', 'sport'), 'news_energy');
  assert.notEqual(classifyNewsCategory('Energia KC mérkőzés a hétvégén', 'hirek'), 'news_energy');
  assert.equal(classifyNewsCategory('Korszerűsítik a hazai villamosenergia hálózatot', 'hirek'), 'news_energy');

  // Hazard overrides territory: áramszünet Püspökladányban
  const puspokTerritory = detectSettlementMention('Váratlan áramszünet Püspökladányban');
  assert.equal(puspokTerritory.settlementName, 'Püspökladány');
  const cat = classifyNewsCategory('Váratlan áramszünet Püspökladányban', 'hirek', puspokTerritory);
  assert.equal(cat, 'news_hazard', 'áramszünet must classify as news_hazard');

  // Sport/culture section guard: accidents override, but mild words do not
  assert.equal(classifyNewsCategory('Súlyos baleset történt a rali versenyen', 'sport'), 'news_hazard');
  assert.equal(classifyNewsCategory('Katasztrofális vereséget szenvedett a csapat', 'sport'), 'news_other');
});

test('26. Payload: getViewNews accessor survives spread, structuredClone, and JSON without data loss', () => {
  const events = [
    { id: 'news-01', title: 'Hír 1', kind: 'news', newsCategory: 'news_global' },
    { id: 'news-02', title: 'Hír 2', kind: 'news', newsCategory: 'news_global' },
    { id: 'news-03', title: 'Hír 3 Debrecen', kind: 'news', newsCategory: 'news_local', territory: { settlementId: 'debrecen', settlementName: 'Debrecen' } }
  ];

  const partitioned = partitionEventsByView(events);

  // 1. Spread object
  const spreadViews = { ...partitioned };
  assert.deepEqual(getViewNews(spreadViews, VIEWS.GLOBAL), getViewNews(partitioned, VIEWS.GLOBAL));

  // 2. structuredClone
  const cloned = structuredClone(partitioned);
  assert.deepEqual(getViewNews(cloned, VIEWS.GLOBAL), getViewNews(partitioned, VIEWS.GLOBAL));

  // 3. JSON roundtrip
  const roundtripped = JSON.parse(JSON.stringify(partitioned));
  assert.deepEqual(getViewNews(roundtripped, VIEWS.GLOBAL), getViewNews(partitioned, VIEWS.GLOBAL));
  assert.equal(getViewNews(roundtripped, VIEWS.GLOBAL).length, 2);
  assert.equal(getViewNews(roundtripped, 'all').length, 3);
});

test('27. HistoryStore exclusion: news events are strictly rejected from history.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-hist-test-'));
  try {
    const store = new HistoryStore(dir, { now: () => REF_NOW });
    const result = store.add([
      // News event with kind: news
      {
        id: 'event-00000000000000000000000000000001',
        title: 'Helyi hír Debrecenből',
        kind: 'news',
        source: { name: 'RSS-Dehir', url: 'https://dehir.hu/test', status: 'ok' },
        collectedAt: new Date(REF_NOW).toISOString()
      },
      // News event from RSS source
      {
        id: 'event-00000000000000000000000000000002',
        title: 'Országos hír',
        newsCategory: 'news_national',
        source: { name: 'RSS-Telex', url: 'https://telex.hu/test', status: 'ok' },
        collectedAt: new Date(REF_NOW).toISOString()
      },
      // Valid physical hazard event
      {
        id: 'event-00000000000000000000000000000003',
        title: 'Zivatarriasztás',
        kind: 'weather',
        source: { name: 'Meteoalarm', url: 'https://meteoalarm.org/test', status: 'ok' },
        collectedAt: new Date(REF_NOW).toISOString()
      }
    ]);

    assert.equal(result.added, 1, 'Only physical hazard event added');
    assert.equal(result.ignored, 2, 'Both news events were ignored');

    const history = store.query();
    assert.equal(history.total, 1);
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].id, 'event-00000000000000000000000000000003');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('28. News ceiling prioritization: 100 national items do not squeeze out local and hazard items', () => {
  // Generate 100 national items with recent timestamps
  const nationalItems = [];
  for (let i = 0; i < 100; i++) {
    nationalItems.push({
      id: `gnews-national-${String(i).padStart(3, '0')}`,
      title: `[TESZTADAT] Országos gazdasági és belpolitikai hír #${i}`,
      link: `https://news.google.com/articles/national-${i}`,
      kind: 'news',
      newsCategory: 'news_national',
      publishedAt: new Date(REF_NOW - i * 60 * 1000).toISOString(),
      observedAt: new Date(REF_NOW).toISOString(),
      source: { name: 'RSS-Telex', status: 'ok' },
      territory: { territoryLevel: 'national' }
    });
  }

  // Generate 1 hazard item and 1 local settlement item (arriving AFTER the 100 national items)
  const hazardItem = {
    id: 'gnews-hazard-urgent',
    title: '[TESZTADAT] Súlyos áramszünet és vízhiány keletkezett',
    link: 'https://news.google.com/articles/hazard-1',
    kind: 'news',
    newsCategory: 'news_hazard',
    publishedAt: new Date(REF_NOW - 120 * 60 * 1000).toISOString(), // Older timestamp!
    observedAt: new Date(REF_NOW).toISOString(),
    source: { name: 'RSS-Index', status: 'ok' },
    territory: { territoryLevel: 'national' }
  };

  const localItem = {
    id: 'gnews-local-bihartorda',
    title: '[TESZTADAT] Hírek Bihartorda térségéből',
    link: 'https://news.google.com/articles/local-1',
    kind: 'news',
    newsCategory: 'news_local',
    publishedAt: new Date(REF_NOW - 150 * 60 * 1000).toISOString(), // Older timestamp!
    observedAt: new Date(REF_NOW).toISOString(),
    source: { name: 'RSS-Dehir', status: 'ok' },
    territory: {
      territoryLevel: 'settlement',
      settlementId: 'bihartorda',
      settlementName: 'Bihartorda',
      needsLocalReview: true,
      localRelevanceReason: 'text_mention'
    }
  };

  // Pass national items first in arrival order
  const allEvents = [...nationalItems, hazardItem, localItem];
  const partitioned = partitionEventsByView(allEvents);

  // Total news collection contains capped items (50 in national view + 1 local item)
  assert.equal(partitioned.news.length, 51);
  assert.equal(partitioned[VIEWS.NATIONAL].newsIds.length, 50);

  // Prioritization check: hazard (rank 0) and local (rank 1) MUST be retained
  const hasHazard = partitioned.news.some(n => n.id === hazardItem.id);
  const hasLocal = partitioned.news.some(n => n.id === localItem.id);
  assert.equal(hasHazard, true, 'Hazard item must NOT be squeezed out by 100 national items');
  assert.equal(hasLocal, true, 'Local item must NOT be squeezed out by 100 national items');

  // Verify they occupy top priority slots ahead of any national items
  assert.equal(partitioned.news[0].id, hazardItem.id, 'Hazard news is top priority (slot 0)');
  assert.equal(partitioned.news[1].id, localItem.id, 'Local news is second priority (slot 1)');

  // Local view news accessor must find the local item
  const localViewNews = getViewNews(partitioned, VIEWS.LOCAL);
  assert.ok(localViewNews.some(n => n.id === localItem.id), 'Local view contains local item');
});

test('29. Ambiguous settlement gazetteer: Kaba and Polgár disambiguation and locative acceptance', () => {
  // Negative tests: common words, plurals, surnames must NOT trigger settlement matches
  const negKaba = detectSettlementMention('kaba viselkedés miatt figyelmeztettek a szakértők');
  assert.equal(negKaba.settlementId, undefined, '"kaba viselkedés" must NOT match settlement Kaba');

  const negPolgarPlural = detectSettlementMention('A polgárok tüntetést szerveztek a belvárosban');
  assert.equal(negPolgarPlural.settlementId, undefined, '"polgárok" must NOT match settlement Polgár');

  const negPolgarSurname = detectSettlementMention('Polgár Péter nyerte a sakkbajnokságot');
  assert.equal(negPolgarSurname.settlementId, undefined, '"Polgár Péter" surname must NOT match settlement Polgár');

  // Positive tests: locative inflections MUST match
  const posPolgar = detectSettlementMention('Polgáron felújították a helyi rendelőt');
  assert.equal(posPolgar.settlementId, 'polgar', '"Polgáron" must match settlement Polgár');
  assert.equal(posPolgar.settlementName, 'Polgár');
  assert.equal(posPolgar.matchState, 'match');

  const posKaba = detectSettlementMention('Kabán új ipari létesítményt adtak át');
  assert.equal(posKaba.settlementId, 'kaba', '"Kabán" must match settlement Kaba');
  assert.equal(posKaba.settlementName, 'Kaba');
  assert.equal(posKaba.matchState, 'match');
});

test('30. Categorization regression: ceasefire (tűzszünet) exclusion and specific headline keyword matching', () => {
  // 1. "tűzszünet" must NOT match acute fire incident; with "kulfold" section it classifies as news_global
  const catCeasefireForeign = classifyNewsCategory('Korlátozott tűzszünet lépett életbe a térségben', 'kulfold');
  assert.equal(catCeasefireForeign, 'news_global', '"tűzszünet" in foreign section must classify as news_global, not news_hazard');

  const catCeasefireGeneral = classifyNewsCategory('Éjféltől tűzszünet lép életbe', 'hirek');
  assert.notEqual(catCeasefireGeneral, 'news_hazard', '"tűzszünet" alone must NOT trigger news_hazard');

  // 2. Acute fire incidents MUST remain news_hazard
  const catFireOutbreak = classifyNewsCategory('Tűz ütött ki egy debreceni raktárépületben', 'belfold');
  assert.equal(catFireOutbreak, 'news_hazard', '"tűz ütött ki" must classify as news_hazard');

  const catFireExtinguish = classifyNewsCategory('Tüzet oltottak a tűzoltók a belvárosban', 'hirek');
  assert.equal(catFireExtinguish, 'news_hazard', '"tüzet oltottak" must classify as news_hazard');

  // 3. Documented actual keyword matching reasons for specific audit headlines:
  // NATO headline matches "figyelmeztetés" keyword -> news_hazard
  const catNato = classifyNewsCategory('Magyarországról küldött figyelmeztetést a NATO magas rangú parancsnoka', 'gazdasag');
  assert.equal(catNato, 'news_hazard', 'NATO headline classified as news_hazard specifically due to "figyelmeztetés" keyword match');

  // Battery factory headline matches "akkumulátorgyár" keyword -> news_energy
  const catBattery = classifyNewsCategory('Gajdos László: Feketelistára került az iváncsai akkumulátorgyár', 'zhvg');
  assert.equal(catBattery, 'news_energy', 'Battery factory headline classified as news_energy specifically due to "akkumulátorgyár" keyword match');
});

test('31. Territorial view ceilings, global saturation resilience, and newsCount semantics', () => {
  // 1. Generate 70 pure global items
  const globalItems = [];
  for (let i = 1; i <= 70; i++) {
    globalItems.push({
      id: `news-glob-${String(i).padStart(3, '0')}`,
      kind: 'news',
      newsCategory: 'news_global',
      title: `[TESZTADAT] Külföldi hír ${i}`,
      source: { name: 'RSS-Telex', status: 'ok' },
      observedAt: new Date(Date.now() - i * 60000).toISOString(),
      publishedAt: new Date(Date.now() - i * 60000).toISOString()
    });
  }

  // 2. Add 1 local item (with settlement context) arriving AFTER global items
  const localItem = {
    id: 'news-local-bihartorda-audit',
    kind: 'news',
    newsCategory: 'news_local',
    title: '[TESZTADAT] Helyi hír Bihartordáról',
    source: { name: 'RSS-Dehir', status: 'ok' },
    observedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    territory: {
      territoryLevel: 'settlement',
      settlementId: 'bihartorda',
      settlementName: 'Bihartorda',
      needsLocalReview: true,
      localRelevanceReason: 'text_mention'
    }
  };

  // Run partitioning with global items first, then local item
  const allEvents = [...globalItems, localItem];
  const partitioned = partitionEventsByView(allEvents);

  // 3. Semantics check: newsCount vs retainedNewsCount / newsIds.length
  const globalView = partitioned[VIEWS.GLOBAL];
  assert.equal(partitioned.all.newsCount, 71, 'all.newsCount represents all eligible items (70 global + 1 local = 71)');
  assert.equal(globalView.newsCount, 70, 'newsCount represents all eligible items (70 global items)');
  assert.equal(globalView.retainedNewsCount, 50, 'retainedNewsCount is capped at VIEW_NEWS_CAP = 50');
  assert.equal(globalView.newsIds.length, 50, 'newsIds.length is capped at 50');

  // 4. Local view qualification and global saturation resilience:
  // Global view saturation (50 items) must NOT drop local news which has space in Local view
  const localView = partitioned[VIEWS.LOCAL];
  assert.equal(localView.newsCount, 1, 'Local view newsCount is 1');
  assert.equal(localView.retainedNewsCount, 1, 'Local view retainedNewsCount is 1');
  assert.equal(localView.newsIds.length, 1);
  assert.equal(localView.newsIds[0], localItem.id, 'Local item must be retained in Local view newsIds');

  // 5. Shared collection contains the union of referenced items
  assert.ok(partitioned.news.some(n => n.id === localItem.id), 'Local item must be present in partitions.news');
  assert.equal(partitioned.news[0].id, localItem.id, 'Local item took slot 0 in partitions.news due to priority');
  assert.equal(partitioned.news.length, 51, 'partitions.news holds union of referenced items (1 local + 50 global = 51)');

  // 6. Accessor getViewNews returns the local item cleanly
  const resolvedLocal = getViewNews(partitioned, VIEWS.LOCAL);
  assert.equal(resolvedLocal.length, 1);
  assert.equal(resolvedLocal[0].id, localItem.id);
  assert.equal(resolvedLocal[0].title, '[TESZTADAT] Helyi hír Bihartordáról');
});

test('32. Shared 100 ceiling exceeded: all newsIds resolvable, partitions.news <= 100, view newsIds <= 50', () => {
  // Generate 150 distinct news items:
  // - 50 global-only items (fill Global view to 50, priority 10)
  // - 50 national items (fill National view to 50, priority 10)
  // - 50 additional items (county/global, arriving after 100 limit is reached)
  const items = [];

  // 1. 50 global-only items
  for (let i = 1; i <= 50; i++) {
    items.push({
      id: `news-glo-${String(i).padStart(3, '0')}`,
      kind: 'news',
      newsCategory: 'news_global',
      title: `[TESZTADAT] Globális külpolitikai hír #${i}`,
      source: { name: 'RSS-Telex', status: 'ok' },
      observedAt: new Date(REF_NOW - 100000 - i * 1000).toISOString()
    });
  }

  // 2. 50 national items (with explicit HUN domestic territory)
  for (let i = 1; i <= 50; i++) {
    items.push({
      id: `news-nat-${String(i).padStart(3, '0')}`,
      kind: 'news',
      newsCategory: 'news_national',
      title: `[TESZTADAT] Országos gazdasági hír #${i}`,
      source: { name: 'RSS-Telex', status: 'ok' },
      observedAt: new Date(REF_NOW - 200000 - i * 1000).toISOString(),
      territory: { territoryLevel: 'national', country: 'HUN', iso3: 'HUN' }
    });
  }

  // 3. 50 additional items (total 150 > 100)
  for (let i = 1; i <= 50; i++) {
    items.push({
      id: `news-ext-${String(i).padStart(3, '0')}`,
      kind: 'news',
      newsCategory: 'news_global',
      title: `[TESZTADAT] További túllépő hír #${i}`,
      source: { name: 'RSS-Index', status: 'ok' },
      observedAt: new Date(REF_NOW - 300000 - i * 1000).toISOString()
    });
  }

  assert.equal(items.length, 150, 'Input must exceed 100-item aggregate ceiling');

  const partitioned = partitionEventsByView(items);

  // 1. Shared collection ceiling: <= 100 and saturated at 100
  assert.ok(partitioned.news.length <= 100, `Shared collection must not exceed 100 (actual: ${partitioned.news.length})`);
  assert.equal(partitioned.news.length, 100, 'Shared collection should be saturated at 100');

  // 2. Per-view ceiling: <= 50
  for (const view of Object.values(VIEWS)) {
    const v = partitioned[view];
    assert.ok(v.newsIds.length <= 50, `View ${view} newsIds.length (${v.newsIds.length}) must be <= 50`);
    assert.equal(v.retainedNewsCount, v.newsIds.length, `retainedNewsCount must match newsIds.length for ${view}`);

    // 3. CRUCIAL CONTRACT: Every single newsId in view.newsIds MUST be resolvable in partitions.news!
    for (const newsId of v.newsIds) {
      const found = partitioned.news.some(item => item.id === newsId);
      assert.ok(found, `newsId ${newsId} referenced in view ${view} must exist in partitions.news!`);
    }

    // 4. Accessor resolves all items without dropping dangling references
    const resolved = getViewNews(partitioned, view);
    assert.equal(resolved.length, v.newsIds.length, `getViewNews for ${view} must resolve exactly ${v.newsIds.length} items`);
  }

  // 5. Eligible newsCount tracks all matching items prior to capping
  assert.equal(partitioned[VIEWS.NATIONAL].newsCount, 50, 'National view matched 50 national items');
  assert.equal(partitioned[VIEWS.GLOBAL].newsCount, 100, 'Global view matched 100 global items');
  assert.equal(partitioned.all.newsCount, 150, 'All view matched all 150 items');
});

test('33. Territorial classification: HVG national and international items never get Hajdú-Bihar county label, local portals default only without contradiction', () => {
  // 1. HVG national & international items without implicit county context
  const orbanItem = detectSettlementMention('Orbán elítélte, Putyin-hívő barátját is meghívták Trump rezidenciájára', undefined, { implicitCountyContext: false });
  assert.equal(orbanItem.countyCode, null, 'National political headline in HVG must NOT receive Hajdú-Bihar countyCode');
  assert.equal(orbanItem.countyName, null, 'National political headline in HVG must NOT receive Hajdú-Bihar countyName');
  assert.notEqual(orbanItem.territoryLevel, 'county', 'Territory level must NOT be county');

  const varsoItem = detectSettlementMention('Alkotmányos válság Varsóban: újabb feszültség a kormánypártok között', undefined, { implicitCountyContext: false });
  assert.equal(varsoItem.countyCode, null, 'International headline in HVG must NOT receive Hajdú-Bihar countyCode');
  assert.equal(varsoItem.countyName, null, 'International headline in HVG must NOT receive Hajdú-Bihar countyName');
  assert.notEqual(varsoItem.territoryLevel, 'county', 'Territory level must NOT be county');

  const adocsomagItem = detectSettlementMention('Új adócsomagot fogadott el a parlament a tavaszi ülésszakban', undefined, { implicitCountyContext: false });
  assert.equal(adocsomagItem.countyCode, null, 'Domestic general headline in HVG must NOT receive Hajdú-Bihar countyCode');
  assert.equal(adocsomagItem.countyName, null, 'Domestic general headline in HVG must NOT receive Hajdú-Bihar countyName');
  assert.equal(adocsomagItem.territoryLevel, 'country', 'Domestic general headline must be country level');

  // 2. HVG item explicitly naming a Hajdú-Bihar settlement DOES match
  const debrecenInHvg = detectSettlementMention('Útlezárás Debrecen belvárosában felújítás miatt', undefined, { implicitCountyContext: false });
  assert.equal(debrecenInHvg.territoryLevel, 'settlement');
  assert.equal(debrecenInHvg.settlementName, 'Debrecen');
  assert.equal(debrecenInHvg.countyCode, '09');
  assert.equal(debrecenInHvg.countyName, 'Hajdú-Bihar');

  // 3. Local portal with implicit county context defaults to county ONLY when uncontradicted
  const dehirLocal = detectSettlementMention('Új játszótér épül a lakótelepen', undefined, { implicitCountyContext: true });
  assert.equal(dehirLocal.territoryLevel, 'county');
  assert.equal(dehirLocal.countyCode, '09');
  assert.equal(dehirLocal.countyName, 'Hajdú-Bihar');

  // 4. Local portal with foreign contradiction does NOT get county
  const dehirForeign = detectSettlementMention('Alkotmányos válság Varsóban', undefined, { implicitCountyContext: true });
  assert.equal(dehirForeign.countyCode, null, 'Foreign headline in local portal must NOT default to county');
  assert.equal(dehirForeign.countyName, null);
  assert.notEqual(dehirForeign.territoryLevel, 'county');

  // 5. Local portal with other Hungarian region contradiction does NOT get county
  const dehirOtherRegion = detectSettlementMention('Baleset az M1-esen Győrnél', undefined, { implicitCountyContext: true });
  assert.equal(dehirOtherRegion.countyCode, null, 'Headline naming another region must NOT default to county');
  assert.equal(dehirOtherRegion.countyName, null);
  assert.notEqual(dehirOtherRegion.territoryLevel, 'county');
});
