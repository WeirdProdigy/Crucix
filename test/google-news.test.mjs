// Tests for Google News RSS Feed Adapter
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GNEWS_SOURCE_NAME,
  BLOCKLIST_DOMAINS,
  GNEWS_CATALOG,
  cleanGNewsTitle,
  isBlocklisted,
  parseGoogleNewsRss,
  briefing as googleNewsBriefing,
  resetGNewsState,
  isGNewsEnabled,
  isGNewsBriefingActive,
  getQueryLastRunTimes
} from '../apis/sources/google-news.mjs';

import { FEED_POLICIES } from '../apis/utils/freshness.mjs';
import { normalizeLiveSources, freshLiveSnapshot } from '../lib/intelligence/live-sources.mjs';
import { AlertEngine } from '../lib/alerts/engine.mjs';
import { fullBriefing, runSource } from '../apis/briefing.mjs';

const REF_NOW = Date.parse('2026-10-28T12:00:00.000Z');

// SYNTHETIC FIXTURE [TESZTADAT] - Strictly synthetic, no real article headlines
const SYNTHETIC_GNEWS_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>[TESZTADAT] Google Hírek - Keresés</title>
    <link>https://news.google.com/rss/search?q=test</link>
    <lastBuildDate>Wed, 28 Oct 2026 11:30:00 GMT</lastBuildDate>
    <item>
      <title>[TESZTADAT] Baleset miatt forgalomkorlátozás van a 4-es főúton Debrecen közelében - Dehir</title>
      <link>https://news.google.com/rss/articles/CBMiTWh0dHBzOi8vd3d3LmRlaGlyLmh1L2RlYnJlY2VuL2JhbGVzZXQtbWlhdHQtZm9yZ2Fsb21rb3JsYXRvemFzLXZhbi8yMDI2LzEwLzI4L9IBAA?oc=5</link>
      <guid isPermaLink="false">CBMiTWh0dHBzOi8vd3d3LmRlaGlyLmh1</guid>
      <pubDate>Wed, 28 Oct 2026 11:15:00 GMT</pubDate>
      <description>&lt;a href="https://news.google.com/..."&gt;Baleset történt a 4-esen...&lt;/a&gt;</description>
      <source url="https://www.dehir.hu">Dehir</source>
    </item>
    <item>
      <title><![CDATA[[TESZTADAT] Kéretlen spam hír a régióból - Vietnam VN]]></title>
      <link>https://news.google.com/rss/articles/spam-item-1</link>
      <guid isPermaLink="false">spam-guid-1</guid>
      <pubDate>Wed, 28 Oct 2026 11:10:00 GMT</pubDate>
      <description>Spam description to discard</description>
      <source url="https://vietnam.vn">Vietnam VN</source>
    </item>
    <item>
      <title>[TESZTADAT] Áramszünet várható Püspökladány térségében karbantartás miatt - Index</title>
      <link>https://news.google.com/rss/articles/index-aramszunet-item</link>
      <guid isPermaLink="false">index-aramszunet-guid</guid>
      <pubDate>Wed, 28 Oct 2026 11:00:00 GMT</pubDate>
      <source url="https://index.hu">Index</source>
    </item>
  </channel>
</rss>`;

test('Google News Catalog integrity', () => {
  assert.equal(GNEWS_CATALOG.length, 6, 'GNEWS_CATALOG must define exactly 6 curated queries');
  const ids = GNEWS_CATALOG.map(q => q.id);
  assert.deepEqual(ids, [
    'gnews-debrecen',
    'gnews-hajdubihar',
    'gnews-district-towns',
    'gnews-epizootic',
    'gnews-energy',
    'gnews-haon'
  ]);

  const haonQuery = GNEWS_CATALOG.find(q => q.id === 'gnews-haon');
  assert.equal(haonQuery.filterHaon, true, 'HAON query must have filterHaon: true');

  const epizooticQuery = GNEWS_CATALOG.find(q => q.id === 'gnews-epizootic');
  assert.equal(epizooticQuery.supportsTruncationAlert, true, 'Epizootic query must support 100-cap truncation alert');
});

test('cleanGNewsTitle strips trailing publisher suffix', () => {
  assert.equal(
    cleanGNewsTitle('Súlyos baleset történt Debrecenben - Dehir'),
    'Súlyos baleset történt Debrecenben'
  );
  assert.equal(
    cleanGNewsTitle('Újabb korlátozások jönnek - Index.hu'),
    'Újabb korlátozások jönnek'
  );
  assert.equal(
    cleanGNewsTitle('Cím kötőjel nélkül'),
    'Cím kötőjel nélkül'
  );
  assert.equal(cleanGNewsTitle(''), '');
  assert.equal(cleanGNewsTitle(null), '');
});

test('isBlocklisted detects client-side blocklist domains', () => {
  assert.equal(isBlocklisted('Vietnam VN', 'https://vietnam.vn', 'https://news.google.com/1'), true);
  assert.equal(isBlocklisted('GlobalHír', 'https://globalhir.hu', 'https://news.google.com/2'), true);
  assert.equal(isBlocklisted('Facebook', 'https://facebook.com', 'https://news.google.com/3'), true);
  assert.equal(isBlocklisted('Reddit', 'https://reddit.com', 'https://news.google.com/4'), true);
  assert.equal(isBlocklisted('Hírstart', 'https://hirstart.hu', 'https://news.google.com/5'), true);
  assert.equal(isBlocklisted('Dehir', 'https://www.dehir.hu', 'https://news.google.com/ok'), false);
  assert.equal(isBlocklisted('Index', 'https://index.hu', 'https://news.google.com/ok2'), false);
});

test('parseGoogleNewsRss parses items, cleans titles, filters blocklist, and discards descriptions', () => {
  const queryConfig = GNEWS_CATALOG[0]; // Debrecen query
  const res = parseGoogleNewsRss(SYNTHETIC_GNEWS_XML, queryConfig, { now: REF_NOW });

  assert.equal(res.status, 'ok');
  assert.equal(res.observations.length, 2, 'Should keep 2 non-blocklisted items out of 3');
  assert.equal(res.diagnostics.droppedBlocklist, 1, 'Should record 1 dropped blocklist item');

  const item1 = res.observations[0];
  assert.equal(item1.title, '[TESZTADAT] Baleset miatt forgalomkorlátozás van a 4-es főúton Debrecen közelében');
  assert.equal(item1.source.publisher, 'Dehir');
  assert.equal(item1.source.publisherUrl, 'https://www.dehir.hu');
  assert.equal(item1.newsCategory, 'news_hazard', 'Hazard terms take precedence');
  assert.equal(item1.link.startsWith('https://news.google.com/rss/articles/'), true, 'Preserves Google redirect link');
  assert.equal(item1.isConfirmedLocal, false, 'isConfirmedLocal is strictly false');
  assert.equal(item1.description, undefined, 'Description MUST be discarded');
  assert.equal(item1.content, undefined, 'Content MUST be discarded');

  const item2 = res.observations[1];
  assert.equal(item2.title, '[TESZTADAT] Áramszünet várható Püspökladány térségében karbantartás miatt');
  assert.equal(item2.source.publisher, 'Index');
  assert.equal(item2.newsCategory, 'news_hazard', 'áramszünet is hazard');
});

test('Deduplication across multiple queries sharing seenUrls', () => {
  const seenUrls = new Set();
  const query1 = GNEWS_CATALOG[0];
  const query2 = GNEWS_CATALOG[1];

  const res1 = parseGoogleNewsRss(SYNTHETIC_GNEWS_XML, query1, { now: REF_NOW, seenUrls });
  assert.equal(res1.observations.length, 2);
  assert.equal(res1.diagnostics.droppedDuplicate, 0);

  // Second query encounters identical URLs
  const res2 = parseGoogleNewsRss(SYNTHETIC_GNEWS_XML, query2, { now: REF_NOW, seenUrls });
  assert.equal(res2.observations.length, 0, 'All previously seen items should be dropped as duplicates');
  assert.equal(res2.diagnostics.droppedDuplicate, 2, 'Should record 2 dropped duplicate items');
});

test('HAON filter retains only hazard, local, regional and drops lifestyle/other', () => {
  const haonXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Google Hírek - site:haon.hu</title>
    <item>
      <title>[TESZTADAT] Karambol történt a 47-esen Mikepércs közelében - HAON</title>
      <link>https://news.google.com/haon-1</link>
      <pubDate>Wed, 28 Oct 2026 11:00:00 GMT</pubDate>
      <source url="https://haon.hu">HAON</source>
    </item>
    <item>
      <title>[TESZTADAT] Sztárszakács receptjei az őszi estékre - HAON</title>
      <link>https://news.google.com/haon-2</link>
      <pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate>
      <source url="https://haon.hu">HAON</source>
    </item>
    <item>
      <title>[TESZTADAT] Felújították a művelődési házat Hajdúszoboszlón - HAON</title>
      <link>https://news.google.com/haon-3</link>
      <pubDate>Wed, 28 Oct 2026 09:00:00 GMT</pubDate>
      <source url="https://haon.hu">HAON</source>
    </item>
  </channel>
</rss>`;

  const haonConfig = GNEWS_CATALOG.find(q => q.id === 'gnews-haon');
  const res = parseGoogleNewsRss(haonXml, haonConfig, { now: REF_NOW });

  assert.equal(res.observations.length, 2, 'Should retain karambol (hazard) and Hajdúszoboszló (local), drop recipe');
  assert.equal(res.diagnostics.droppedHaonIrrelevant, 1, 'Should record 1 dropped irrelevant item');
  assert.equal(res.observations[0].newsCategory, 'news_hazard');
  assert.equal(res.observations[1].newsCategory, 'news_local');
});

test('100-item ceiling alert flags possibleTruncation: true', () => {
  let itemsXml = '';
  for (let i = 0; i < 100; i++) {
    itemsXml += `
    <item>
      <title>[TESZTADAT] Sertéspestis hír #${i} - Agrárszektor</title>
      <link>https://news.google.com/pestis-${i}</link>
      <pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate>
      <source url="https://agrarszektor.hu">Agrárszektor</source>
    </item>`;
  }
  const bigXml = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>${itemsXml}</channel></rss>`;
  const epizooticConfig = GNEWS_CATALOG.find(q => q.id === 'gnews-epizootic');
  const res = parseGoogleNewsRss(bigXml, epizooticConfig, { now: REF_NOW });

  assert.equal(res.diagnostics.possibleTruncation, true, '100 items must set possibleTruncation: true');
  assert.equal(res.observations.length, 100);
});

test('Opt-in gate: strictly 0 network calls when CRUCIX_ENABLE_GNEWS is false', async () => {
  resetGNewsState();
  const prevEnv = process.env.CRUCIX_ENABLE_GNEWS;
  try {
    delete process.env.CRUCIX_ENABLE_GNEWS;
    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      return { status: 200, rawText: SYNTHETIC_GNEWS_XML };
    };

    const res = await googleNewsBriefing({
      now: REF_NOW,
      fetchFn: mockFetch
    });

    assert.equal(res.status, 'disabled');
    assert.equal(res.disabled, true);
    assert.equal(fetchCalls, 0, 'Strictly 0 network calls when opt-in is disabled');
  } finally {
    if (prevEnv !== undefined) process.env.CRUCIX_ENABLE_GNEWS = prevEnv;
    else delete process.env.CRUCIX_ENABLE_GNEWS;
  }
});

test('HTTP 429 and Retry-After backoff window stops adapter immediately', async () => {
  resetGNewsState();
  let fetchCalls = 0;
  const mockFetch = async (url) => {
    fetchCalls++;
    if (url.includes('Debrecen')) {
      return {
        status: 429,
        headers: { 'retry-after': '120' },
        rawText: 'Too Many Requests'
      };
    }
    return { status: 200, rawText: SYNTHETIC_GNEWS_XML };
  };

  const res = await googleNewsBriefing({
    enabled: true,
    now: REF_NOW,
    fetchFn: mockFetch
  });

  assert.equal(res.status, 'disabled');
  assert.equal(res.blocked, true);
  assert.equal(fetchCalls, 1, 'Should stop immediately on 429 and NOT proceed to subsequent queries');

  // Next call within backoff window should fail fast with 0 network calls
  const res2 = await googleNewsBriefing({
    enabled: true,
    now: REF_NOW + 30_000, // 30s later (still within 120s backoff)
    fetchFn: mockFetch
  });

  assert.equal(res2.status, 'disabled');
  assert.equal(res2.rateLimited, true);
  assert.equal(fetchCalls, 1, 'Still 1 total fetch call; second sweep was short-circuited');

  resetGNewsState();
});

test('Alert notification suppression: news events do not generate notifying alerts', () => {
  const root = mkdtempSync(join(tmpdir(), 'crucix-gnews-alert-test-'));
  try {
    const engine = new AlertEngine(root, {
      now: () => REF_NOW,
      logger: { warn: () => {}, error: () => {}, log: () => {}, info: () => {} }
    });
    engine.load();

    const queryConfig = GNEWS_CATALOG[0];
    const parsed = parseGoogleNewsRss(SYNTHETIC_GNEWS_XML, queryConfig, { now: REF_NOW });

    // Bootstrap sweep
    engine.evaluate({ events: [] });

    // Sweep with Google News events
    const result = engine.evaluate({ events: parsed.observations });
    const notifyingAlerts = (result.created || []).filter(a => a.notify);

    assert.equal(
      notifyingAlerts.length,
      0,
      `Expected 0 notifying alerts for news events, got ${notifyingAlerts.length}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('FEED_POLICIES and live-sources integration for Google-News', () => {
  assert.ok(FEED_POLICIES['Google-News'], 'Google-News must be in FEED_POLICIES');
  assert.equal(FEED_POLICIES['Google-News'].maxAgeMs, 6 * 60 * 60 * 1000);
  assert.equal(FEED_POLICIES['Google-News'].observationMaxAgeMs, 48 * 60 * 60 * 1000);

  const queryConfig = GNEWS_CATALOG[0];
  const parsed = parseGoogleNewsRss(SYNTHETIC_GNEWS_XML, queryConfig, { now: REF_NOW });
  const liveContainers = normalizeLiveSources({
    'Google-News': parsed
  }, REF_NOW);

  const gnewsFeed = liveContainers.find(f => f.source === 'Google-News');
  assert.ok(gnewsFeed, 'Google-News present in normalized liveSources');
  assert.equal(gnewsFeed.observations.length, 2);

  const firstObs = gnewsFeed.observations[0];
  const newsEvent = {
    id: 'event-0123456789abcdef0123456789abcdef',
    title: firstObs.title,
    kind: 'news',
    severity: 'low',
    domain: 'security',
    observedAt: firstObs.observedAt,
    publishedAt: firstObs.publishedAt,
    source: { name: 'Google-News', url: firstObs.url, status: 'ok' },
    territory: firstObs.territory,
    facts: firstObs.facts
  };

  const snapshot = {
    meta: { timestamp: new Date(REF_NOW).toISOString() },
    liveSources: liveContainers,
    events: [newsEvent],
    staleEvents: [],
    coverage: [{
      id: 'Google-News',
      name: 'Google-News',
      domain: 'security',
      status: 'ok',
      origin: 'live',
      isSnapshot: false
    }]
  };

  const fresh = freshLiveSnapshot(snapshot, REF_NOW);
  assert.equal(fresh.events.length, 1, 'Google News event must remain in active events');
  assert.equal(fresh.staleEvents.length, 0, 'Google News event must NOT be moved to staleEvents');

  const cov = fresh.coverage.find(c => c.sourceId === 'Google-News' || c.sourceName === 'Google-News');
  assert.ok(cov, 'Coverage entry exists for Google-News');
  assert.equal(cov.status, 'ok_data', 'Coverage must be ok_data');
});

test('Full execution cycle with mock fetchFn aggregates all queries and diagnostics', async () => {
  resetGNewsState();
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return {
      status: 200,
      rawText: SYNTHETIC_GNEWS_XML
    };
  };

  // Sweep 1 at T=0: all 6 queries run because they have never run before
  const res1 = await googleNewsBriefing({
    enabled: true,
    now: REF_NOW,
    fetchFn: mockFetch
  });

  assert.equal(res1.status, 'ok');
  assert.ok(res1.observations.length > 0);
  assert.equal(res1.diagnostics.queriesRun, 6);
  assert.equal(res1.diagnostics.requestsThisHour, 6);
  assert.equal(res1.diagnostics.totalDroppedBlocklist, 6); // 1 per query * 6 queries
  assert.ok(res1.diagnostics.totalDroppedDuplicate > 0);
  assert.equal(fetchCount, 6);

  // Sweep 2 at T=15m: no queries are due yet (shortest interval is Hajdú-Bihar at 30m)
  const res2 = await googleNewsBriefing({
    enabled: true,
    now: REF_NOW + 15 * 60 * 1000,
    fetchFn: mockFetch
  });
  assert.equal(res2.status, 'ok');
  assert.equal(res2.diagnostics.queriesRun, 0, 'No queries should run at 15m');
  assert.equal(res2.diagnostics.queriesSkipped, 6);
  assert.equal(fetchCount, 6, 'Zero additional fetch calls at 15m');
  assert.ok(res2.observations.length > 0, 'Cached observations are preserved');

  // Sweep 3 at T=30m: only Hajdú-Bihar (30m interval) is due
  const res3 = await googleNewsBriefing({
    enabled: true,
    now: REF_NOW + 30 * 60 * 1000,
    fetchFn: mockFetch
  });
  assert.equal(res3.status, 'ok');
  assert.equal(res3.diagnostics.queriesRun, 1, 'Only Hajdú-Bihar should run at 30m');
  assert.equal(res3.diagnostics.queriesSkipped, 5);
  assert.equal(fetchCount, 7, 'Exactly 1 fetch call at 30m');

  resetGNewsState();
});

test('runSource source-specific timeout: Google-News receives 75s while others default to 30s', async () => {
  // Test default 30s timeout on generic source
  let genericTimedOut = false;
  const mockSlowGeneric = async () => {
    await new Promise(r => setTimeout(r, 50));
    return { status: 'ok' };
  };
  const resGeneric = await runSource('TestGeneric', mockSlowGeneric, { sourceTimeoutMs: 20 });
  assert.equal(resGeneric.status, 'error');
  assert.ok(resGeneric.error.includes('timed out after 0.02s'));

  // Test custom 75s timeout (tested here with small synthetic value e.g. 80ms vs 40ms)
  const mockSlowGNews = async (opts) => {
    assert.ok(opts.signal instanceof AbortSignal, 'Must receive AbortSignal');
    await new Promise(r => setTimeout(r, 30));
    return { status: 'ok', observations: [] };
  };
  const resGNews = await runSource('Google-News', mockSlowGNews, { timeoutMs: 100 });
  assert.equal(resGNews.status, 'ok');
});

test('Concurrency guard prevents overlapping simultaneous briefing executions', async () => {
  resetGNewsState();
  let concurrentDetected = false;
  let slowFetchResolve;
  const slowFetchPromise = new Promise(resolve => { slowFetchResolve = resolve; });

  const mockSlowFetch = async () => {
    await slowFetchPromise;
    return { status: 200, rawText: SYNTHETIC_GNEWS_XML };
  };

  // Launch first briefing (will hang until slowFetchResolve is called)
  const p1 = googleNewsBriefing({
    enabled: true,
    now: REF_NOW,
    fetchFn: mockSlowFetch
  });

  assert.equal(isGNewsBriefingActive(), true, 'isBriefingActive must be true while first run is in progress');

  // Launch second briefing concurrently
  const res2 = await googleNewsBriefing({
    enabled: true,
    now: REF_NOW,
    fetchFn: async () => {
      concurrentDetected = true;
      return { status: 200, rawText: SYNTHETIC_GNEWS_XML };
    }
  });

  assert.equal(concurrentDetected, false, 'Second run must not trigger any fetch calls');
  assert.equal(res2.diagnostics.skippedConcurrent, true, 'Second run must flag skippedConcurrent: true');

  // Complete first run
  slowFetchResolve();
  const res1 = await p1;
  assert.equal(res1.status, 'ok');
  assert.equal(isGNewsBriefingActive(), false, 'isBriefingActive must reset to false after completion');

  resetGNewsState();
});

test('AbortSignal immediately stops execution without running subsequent queries', async () => {
  resetGNewsState();
  const controller = new AbortController();
  let calls = 0;

  const mockFetch = async () => {
    calls++;
    if (calls === 2) {
      // Abort during query 2
      controller.abort();
    }
    return { status: 200, rawText: SYNTHETIC_GNEWS_XML };
  };

  const res = await googleNewsBriefing({
    enabled: true,
    now: REF_NOW,
    signal: controller.signal,
    fetchFn: mockFetch
  });

  assert.equal(calls, 2, 'Should abort after 2 queries, not completing the remaining 4 queries');
  assert.ok(res.diagnostics.queryDetails.some(d => d.status === 'aborted'), 'Must record aborted status in queryDetails');
  assert.equal(isGNewsBriefingActive(), false, 'isBriefingActive must reset after abort');

  const runTimes = getQueryLastRunTimes();
  // Query 1 completed before abort, so it has timestamp
  assert.equal(runTimes.get('gnews-debrecen'), REF_NOW);
  // Query 2 was aborted, so its last run time must NOT be updated!
  assert.equal(runTimes.has('gnews-hajdubihar'), false, 'Aborted query must NOT update queryLastRunTimes');
  // Queries 3..6 were never reached, so they must NOT have run times
  assert.equal(runTimes.has('gnews-district-towns'), false);
  assert.equal(runTimes.has('gnews-epizootic'), false);
  assert.equal(runTimes.has('gnews-energy'), false);
  assert.equal(runTimes.has('gnews-haon'), false);

  resetGNewsState();
});

test('isBriefingActive flag releases after exception, timeout, and abort', async () => {
  resetGNewsState();

  // 1. Release after unhandled exception in fetchFn
  const mockThrowingFetch = async () => {
    throw new Error('Fatal network exception');
  };
  try {
    await googleNewsBriefing({
      enabled: true,
      now: REF_NOW,
      fetchFn: mockThrowingFetch
    });
  } catch {}
  assert.equal(isGNewsBriefingActive(), false, 'isBriefingActive must release after exception');

  // 2. Release after abort signal
  const controller = new AbortController();
  controller.abort();
  await googleNewsBriefing({
    enabled: true,
    now: REF_NOW,
    signal: controller.signal,
    fetchFn: async () => ({ status: 200, rawText: SYNTHETIC_GNEWS_XML })
  });
  assert.equal(isGNewsBriefingActive(), false, 'isBriefingActive must release after abort');

  // 3. Release after timeout in runSource
  const mockTimingOutAdapter = async (opts) => {
    assert.ok(opts.signal instanceof AbortSignal);
    return new Promise(resolve => {
      opts.signal.addEventListener('abort', () => {
        resolve({ status: 'aborted' });
      });
    });
  };
  await runSource('Google-News', mockTimingOutAdapter, { timeoutMs: 20 });
  assert.equal(isGNewsBriefingActive(), false, 'isBriefingActive must release after runSource timeout');

  resetGNewsState();
});

test('runSource aborts Google News adapter when timeout occurs', async () => {
  resetGNewsState();
  let adapterSawAbort = false;

  const mockAdapter = async (opts) => {
    assert.ok(opts.signal instanceof AbortSignal);
    return new Promise((resolve) => {
      opts.signal.addEventListener('abort', () => {
        adapterSawAbort = true;
        resolve({ status: 'aborted' });
      });
    });
  };

  const res = await runSource('Google-News', mockAdapter, { timeoutMs: 25 });
  assert.equal(res.status, 'error');
  assert.ok(res.error.includes('timed out'));
  assert.equal(adapterSawAbort, true, 'Adapter signal must receive abort event on timeout');
});

