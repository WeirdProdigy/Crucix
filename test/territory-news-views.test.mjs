import test from 'node:test';
import assert from 'node:assert/strict';
import {
  partitionEventsByView,
  evaluateEventTerritoryViews,
  evaluateNewsTerritoryViews,
  getViewNews,
  VIEWS
} from '../lib/intelligence/views.mjs';
import {
  DEFAULT_TERRITORY_CONFIG,
  createTerritoryConfig,
  calculateLocalMapBounds,
  BIHARTORDA_PROFILE
} from '../lib/intelligence/territory.mjs';
import { normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';

test('1. Synthetic items WITHOUT territory fields: category-based view routing', () => {
  const localNews = {
    id: 'syn-local-bihartorda',
    kind: 'news',
    newsCategory: 'news_local',
    title: '[TESZTADAT] Helyi csőtörés Bihartordán',
    source: { name: 'RSS-Dehir', status: 'ok' },
    observedAt: '2026-10-29T10:00:00Z',
    publishedAt: '2026-10-29T10:00:00Z'
  };

  const keyConnectionNews = {
    id: 'syn-local-debrecen',
    kind: 'news',
    newsCategory: 'news_local',
    title: '[TESZTADAT] Villamosmegálló felújítás Debrecenben',
    source: { name: 'RSS-Dehir', status: 'ok' },
    observedAt: '2026-10-29T10:05:00Z',
    publishedAt: '2026-10-29T10:05:00Z'
  };

  const regionalNews = {
    id: 'syn-regional-hajdu',
    kind: 'news',
    newsCategory: 'news_regional',
    title: '[TESZTADAT] Megyei útburkolat-felújítás Hajdú-Biharban',
    source: { name: 'Police-Hajdu', status: 'ok' },
    observedAt: '2026-10-29T10:10:00Z',
    publishedAt: '2026-10-29T10:10:00Z'
  };

  const nationalNews = {
    id: 'syn-national-parlament',
    kind: 'news',
    newsCategory: 'news_national',
    title: '[TESZTADAT] Költségvetési vita az Országgyűlésben',
    source: { name: 'RSS-Telex', status: 'ok' },
    observedAt: '2026-10-29T10:15:00Z',
    publishedAt: '2026-10-29T10:15:00Z'
  };

  const globalNews = {
    id: 'syn-global-geneva',
    kind: 'news',
    newsCategory: 'news_global',
    title: '[TESZTADAT] Nemzetközi klímacsúcs kezdődött Genfben',
    source: { name: 'BBC', status: 'ok' },
    observedAt: '2026-10-29T10:20:00Z',
    publishedAt: '2026-10-29T10:20:00Z'
  };

  // Direct evaluation check
  const evalLocal = evaluateEventTerritoryViews(localNews);
  assert.equal(evalLocal[VIEWS.LOCAL].inView, true, 'news_local with Bihartorda must enter local view');
  assert.equal(evalLocal[VIEWS.COUNTY].inView, true, 'news_local must enter county view');
  assert.equal(evalLocal[VIEWS.NATIONAL].inView, false);
  assert.equal(evalLocal[VIEWS.GLOBAL].inView, false);

  const evalKey = evaluateEventTerritoryViews(keyConnectionNews);
  assert.equal(evalKey[VIEWS.LOCAL].inView, true, 'news_local with Debrecen must enter local view');
  assert.equal(evalKey[VIEWS.COUNTY].inView, true, 'news_local with Debrecen must enter county view');
  assert.equal(evalKey[VIEWS.NATIONAL].inView, false);
  assert.equal(evalKey[VIEWS.GLOBAL].inView, false);

  const evalRegional = evaluateEventTerritoryViews(regionalNews);
  assert.equal(evalRegional[VIEWS.LOCAL].inView, false);
  assert.equal(evalRegional[VIEWS.COUNTY].inView, true, 'news_regional must enter county view');
  assert.equal(evalRegional[VIEWS.NATIONAL].inView, false);
  assert.equal(evalRegional[VIEWS.GLOBAL].inView, false);

  const evalNational = evaluateEventTerritoryViews(nationalNews);
  assert.equal(evalNational[VIEWS.LOCAL].inView, false);
  assert.equal(evalNational[VIEWS.COUNTY].inView, false);
  assert.equal(evalNational[VIEWS.NATIONAL].inView, true, 'news_national must enter national view');
  assert.equal(evalNational[VIEWS.GLOBAL].inView, false);

  const evalGlobal = evaluateEventTerritoryViews(globalNews);
  assert.equal(evalGlobal[VIEWS.LOCAL].inView, false);
  assert.equal(evalGlobal[VIEWS.COUNTY].inView, false);
  assert.equal(evalGlobal[VIEWS.NATIONAL].inView, false);
  assert.equal(evalGlobal[VIEWS.GLOBAL].inView, true, 'news_global must enter global view');

  // Partitioning check
  const partitions = partitionEventsByView([
    localNews,
    keyConnectionNews,
    regionalNews,
    nationalNews,
    globalNews
  ]);

  assert.equal(partitions[VIEWS.LOCAL].newsCount, 2, 'Local view has 2 items (Bihartorda and Debrecen)');
  assert.equal(partitions[VIEWS.COUNTY].newsCount, 3, 'County view has 3 items (2 local + 1 regional)');
  assert.equal(partitions[VIEWS.NATIONAL].newsCount, 1, 'National view has 1 item');
  assert.equal(partitions[VIEWS.GLOBAL].newsCount, 1, 'Global view has 1 item');

  // "Összes hír" partition has all 5 items
  assert.equal(partitions.all.newsCount, 5, 'All news partition has 5 items');
  assert.equal(partitions.all.retainedNewsCount, 5);
  assert.equal(partitions.news.length, 5);
  assert.equal(getViewNews(partitions, 'all').length, 5);
});

test('2. news_hazard, news_energy, news_agriculture routed by territorial scope without territory fields', () => {
  const localHazard = {
    id: 'syn-haz-debrecen',
    kind: 'news',
    newsCategory: 'news_hazard',
    title: '[TESZTADAT] Viharkárok felszámolása Debrecenben',
    source: { name: 'RSS-Dehir', status: 'ok' },
    observedAt: '2026-10-29T11:00:00Z',
    publishedAt: '2026-10-29T11:00:00Z'
  };

  const countyEnergy = {
    id: 'syn-nrg-hajdu',
    kind: 'news',
    newsCategory: 'news_energy',
    title: '[TESZTADAT] Távvezeték karbantartás Hajdú-Biharban',
    source: { name: 'RSS-Portfolio', status: 'ok' },
    observedAt: '2026-10-29T11:05:00Z',
    publishedAt: '2026-10-29T11:05:00Z'
  };

  const nationalAgri = {
    id: 'syn-agr-orszagos',
    kind: 'news',
    newsCategory: 'news_agriculture',
    title: '[TESZTADAT] Országos aszálykár enyhítési intézkedések',
    source: { name: 'RSS-Telex', status: 'ok' },
    observedAt: '2026-10-29T11:10:00Z',
    publishedAt: '2026-10-29T11:10:00Z'
  };

  const globalHazard = {
    id: 'syn-haz-indonesia',
    kind: 'news',
    newsCategory: 'news_hazard',
    title: '[TESZTADAT] Erős földrengés rázta meg Indonéziát',
    source: { name: 'GDELT', status: 'ok' },
    observedAt: '2026-10-29T11:15:00Z',
    publishedAt: '2026-10-29T11:15:00Z'
  };

  const partitions = partitionEventsByView([
    localHazard,
    countyEnergy,
    nationalAgri,
    globalHazard
  ]);

  // Local hazard enters local, county, and national
  assert.ok(partitions[VIEWS.LOCAL].newsIds.includes(localHazard.id));
  assert.ok(partitions[VIEWS.COUNTY].newsIds.includes(localHazard.id));
  assert.ok(partitions[VIEWS.NATIONAL].newsIds.includes(localHazard.id));
  assert.ok(!partitions[VIEWS.GLOBAL].newsIds.includes(localHazard.id));

  // County energy enters county and national
  assert.ok(!partitions[VIEWS.LOCAL].newsIds.includes(countyEnergy.id));
  assert.ok(partitions[VIEWS.COUNTY].newsIds.includes(countyEnergy.id));
  assert.ok(partitions[VIEWS.NATIONAL].newsIds.includes(countyEnergy.id));
  assert.ok(!partitions[VIEWS.GLOBAL].newsIds.includes(countyEnergy.id));

  // National agriculture enters national only
  assert.ok(!partitions[VIEWS.LOCAL].newsIds.includes(nationalAgri.id));
  assert.ok(!partitions[VIEWS.COUNTY].newsIds.includes(nationalAgri.id));
  assert.ok(partitions[VIEWS.NATIONAL].newsIds.includes(nationalAgri.id));
  assert.ok(!partitions[VIEWS.GLOBAL].newsIds.includes(nationalAgri.id));

  // Global hazard enters global only
  assert.ok(!partitions[VIEWS.LOCAL].newsIds.includes(globalHazard.id));
  assert.ok(!partitions[VIEWS.COUNTY].newsIds.includes(globalHazard.id));
  assert.ok(!partitions[VIEWS.NATIONAL].newsIds.includes(globalHazard.id));
  assert.ok(partitions[VIEWS.GLOBAL].newsIds.includes(globalHazard.id));

  assert.equal(partitions.all.newsCount, 4);
  assert.equal(getViewNews(partitions, 'all').length, 4);
});

test('3. Physical event counters (breakdown.*) remain strictly 0 with news items', () => {
  const newsItems = [
    { id: 'n1', kind: 'news', newsCategory: 'news_local', title: '[TESZTADAT] Bihartorda hír' },
    { id: 'n2', kind: 'news', newsCategory: 'news_regional', title: '[TESZTADAT] Hajdú-Bihar hír' },
    { id: 'n3', kind: 'news', newsCategory: 'news_national', title: '[TESZTADAT] Országos hír' },
    { id: 'n4', kind: 'news', newsCategory: 'news_global', title: '[TESZTADAT] Világhír' }
  ];

  const partitions = partitionEventsByView(newsItems);

  for (const view of [VIEWS.LOCAL, VIEWS.COUNTY, VIEWS.NATIONAL, VIEWS.GLOBAL]) {
    const p = partitions[view];
    assert.equal(p.totalEvents, 0, `${view} totalEvents must be 0`);
    assert.equal(p.uniqueEvents, 0, `${view} uniqueEvents must be 0`);
    assert.equal(p.cancelledChains, 0, `${view} cancelledChains must be 0`);

    for (const [key, val] of Object.entries(p.breakdown)) {
      assert.equal(val, 0, `${view} breakdown.${key} must be strictly 0 for news`);
    }
    for (const [key, val] of Object.entries(p.relationshipBreakdown)) {
      assert.equal(val, 0, `${view} relationshipBreakdown.${key} must be strictly 0 for news`);
    }
  }
});

test('4. "Összes hír" view / tab access and accessor contract', () => {
  const items = [];
  for (let i = 1; i <= 20; i++) {
    items.push({
      id: `item-${i}`,
      kind: 'news',
      newsCategory: i % 2 === 0 ? 'news_national' : 'news_global',
      title: `[TESZTADAT] Teszt hír ${i}`,
      observedAt: new Date(Date.now() - i * 1000).toISOString(),
      publishedAt: new Date(Date.now() - i * 1000).toISOString()
    });
  }

  const partitions = partitionEventsByView(items);
  assert.equal(partitions.all.newsCount, 20);
  assert.equal(partitions.all.retainedNewsCount, 20);
  assert.equal(partitions.all.newsIds.length, 20);

  const resolved = getViewNews(partitions, 'all');
  assert.equal(resolved.length, 20);
  assert.equal(resolved[0].id, 'item-1');

  // Accessing with 'allNews' alias also succeeds
  const resolvedAlias = getViewNews(partitions, 'allNews');
  assert.equal(resolvedAlias.length, 20);
});

test('5. End-to-end pipeline test: normalizeLiveSources -> buildEvents -> partitionEventsByView with dedup', () => {
  const sharedUrl = 'https://telex.hu/belfold/2026/10/29/gazdasagi-csomag-bejelentes';
  const now = Date.parse('2026-10-29T12:00:00Z');

  const liveSourcesRaw = [
    {
      source: 'RSS-Telex',
      status: 'ok',
      observedAt: '2026-10-29T11:50:00Z',
      observations: [
        {
          providerId: 'telex-1',
          url: sharedUrl,
          title: '[TESZTADAT] Új gazdasági intézkedéscsomag a parlamentben',
          summary: 'Kormányzati bejelentés részletei a mai sajtótájékoztatón.',
          kind: 'news',
          newsCategory: 'news_national',
          isPublisherPromo: false,
          observedAt: '2026-10-29T11:50:00Z',
          publishedAt: '2026-10-29T11:50:00Z'
        }
      ]
    },
    {
      source: 'RSS-Dehir',
      status: 'ok',
      observedAt: '2026-10-29T11:45:00Z',
      observations: [
        {
          providerId: 'dehir-1',
          url: 'https://dehir.hu/debrecen/felujitjak-a-piac-utcat/2026/10/29/',
          title: '[TESZTADAT] Felújítják a Piac utcát Debrecenben',
          summary: 'Közlekedési korlátozások várhatóak jövő héttől.',
          kind: 'news',
          newsCategory: 'news_local',
          isPublisherPromo: false,
          observedAt: '2026-10-29T11:45:00Z',
          publishedAt: '2026-10-29T11:45:00Z'
        }
      ]
    },
    {
      source: 'Police-Hajdu',
      status: 'ok',
      observedAt: '2026-10-29T11:40:00Z',
      observations: [
        {
          providerId: 'police-1',
          url: 'https://police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/hajdu-bihar-varmegye/utlezaras-a-47-esen',
          title: '[TESZTADAT] Útlezárás a 47-es főúton Berettyóújfalu és Bihartorda között',
          summary: 'Baleset miatt félpályás lezárás van érvényben.',
          kind: 'news',
          newsCategory: 'news_local',
          isPublisherPromo: false,
          settlement: 'Bihartorda',
          observedAt: '2026-10-29T11:40:00Z',
          publishedAt: '2026-10-29T11:40:00Z'
        }
      ]
    },
    {
      source: 'Google-News',
      status: 'ok',
      observedAt: '2026-10-29T11:30:00Z',
      observations: [
        {
          providerId: 'gnews-promo',
          url: 'https://example.hu/promo-cikk',
          title: '[TESZTADAT] Szponzorált tartalom: Támogatott hitelkonstrukciók',
          summary: 'Promóció.',
          kind: 'news',
          newsCategory: 'news_national',
          isPublisherPromo: true,
          observedAt: '2026-10-29T11:30:00Z',
          publishedAt: '2026-10-29T11:30:00Z'
        }
      ]
    }
  ];

  // Legacy snapshot feed containing duplicate of the Telex item AND an international legacy item
  const legacyNewsFeed = [
    {
      id: 'legacy-telex-dup',
      url: sharedUrl,
      title: 'Legacy címe a Telex hírnek',
      source: 'LegacyNewsEngine',
      publishedAt: '2026-10-29T11:48:00Z'
    },
    {
      id: 'legacy-bbc-intl',
      url: 'https://bbc.com/news/world-europe-12345678',
      title: '[TESZTADAT] European Union climate summit concludes in Brussels',
      source: 'BBC News',
      publishedAt: '2026-10-29T11:00:00Z'
    }
  ];

  const snapshot = {
    meta: { timestamp: new Date(now).toISOString() },
    liveSources: liveSourcesRaw,
    newsFeed: legacyNewsFeed
  };

  // Pipeline step 1: normalizeLiveSources
  const normalizedSources = normalizeLiveSources(snapshot.liveSources, now);
  assert.equal(normalizedSources.length, 4);

  // Pipeline step 2: buildEvents
  const events = buildEvents(snapshot, { now });
  assert(events.length >= 4, 'buildEvents produces events for live news and legacy items');

  // Verify deduplication: the Telex item appears only once, with precedence given to the live adapter
  const telexEvents = events.filter(e => e.source?.url === sharedUrl);
  assert.equal(telexEvents.length, 1, 'Duplicate canonical URL between live and legacy feed is deduplicated');
  assert.equal(telexEvents[0].source?.name, 'RSS-Telex', 'Live adapter takes precedence over legacy feed');
  assert.equal(telexEvents[0].newsCategory, 'news_national', 'Live adapter metadata is preserved');

  // Verify legacy international item is preserved
  const bbcEvents = events.filter(e => e.source?.url?.includes('bbc.com'));
  assert.equal(bbcEvents.length, 1, 'Legacy international news item is preserved');

  // Pipeline step 3: partitionEventsByView
  const partitions = partitionEventsByView(events);

  // Verify promo item was filtered out
  assert.ok(!partitions.news.some(n => n.id === 'gnews-promo' || n.title?.includes('Szponzorált')), 'isPublisherPromo item is excluded');

  // Verify territorial routing
  // Bihartorda -> local + county
  const localNews = getViewNews(partitions, VIEWS.LOCAL);
  assert.ok(localNews.some(n => n.title?.includes('Bihartorda') || n.title?.includes('Piac utcát')), 'Local view contains local items');

  // Telex -> national
  const nationalNews = getViewNews(partitions, VIEWS.NATIONAL);
  assert.ok(nationalNews.some(n => n.source?.url === sharedUrl), 'National view contains Telex news');

  // BBC -> global
  const globalNews = getViewNews(partitions, VIEWS.GLOBAL);
  assert.ok(globalNews.some(n => n.source?.url?.includes('bbc.com')), 'Global view contains legacy international news');

  // Strictly verify physical counters remain ZERO
  for (const view of Object.values(VIEWS)) {
    assert.equal(partitions[view].totalEvents, 0, `${view} totalEvents must be 0 for news`);
    assert.equal(partitions[view].uniqueEvents, 0, `${view} uniqueEvents must be 0 for news`);
    assert.equal(partitions[view].cancelledChains, 0, `${view} cancelledChains must be 0 for news`);
    for (const [k, v] of Object.entries(partitions[view].breakdown)) {
      assert.equal(v, 0, `${view} breakdown.${k} must be 0 for news`);
    }
  }
});

test('6. County view territorial gating: Qubit tudományos, Portfolio gazdasági, HVG egyéb nem megyei; Dehir debreceni kultúrhír helyi/megyei', () => {
  const qubitItem = {
    id: 'qubit-science-1',
    source: { name: 'RSS-Qubit', url: 'https://qubit.hu/2026/10/30/varjak-donteshozatala' },
    title: 'A varjak kétszer gyorsabban döntenek, mint a csimpánzok vagy az emberek',
    kind: 'news',
    newsCategory: 'news_science',
    territory: {
      territoryLevel: 'county',
      countyCode: '09',
      countyName: 'Hajdú-Bihar',
      nuts3: 'HU321'
    },
    facts: {
      settlement: null,
      county: 'Hajdú-Bihar',
      newsCategory: 'news_science'
    }
  };

  const portfolioItem = {
    id: 'portfolio-econ-1',
    source: { name: 'RSS-Portfolio', url: 'https://portfolio.hu/gazdasag/20261030/megallapodas' },
    title: 'Fontos gazdasági megállapodást kötött az Európai Unió',
    kind: 'news',
    newsCategory: 'news_economy',
    territory: {
      territoryLevel: 'county',
      countyCode: '09',
      countyName: 'Hajdú-Bihar',
      nuts3: 'HU321'
    },
    facts: {
      settlement: null,
      county: 'Hajdú-Bihar',
      newsCategory: 'news_economy'
    }
  };

  const hvgItem = {
    id: 'hvg-other-1',
    source: { name: 'RSS-HVG', url: 'https://hvg.hu/elet-stilus/20261030/botrany' },
    title: 'Kitört a botrány, szokatlan jelenetek a filmforgatáson',
    kind: 'news',
    newsCategory: 'news_other',
    territory: {
      territoryLevel: 'county',
      countyCode: '09',
      countyName: 'Hajdú-Bihar',
      nuts3: 'HU321'
    },
    facts: {
      settlement: null,
      county: 'Hajdú-Bihar',
      newsCategory: 'news_other'
    }
  };

  const dehirCultureItem = {
    id: 'dehir-culture-1',
    source: { name: 'RSS-Dehir', url: 'https://dehir.hu/kultura/debreceni-kiallitas-nyilt/2026/10/30/' },
    title: 'Debreceni kiállítás nyílt a Kölcsey Központban',
    kind: 'news',
    newsCategory: 'news_other',
    territory: {},
    facts: {}
  };

  const policeCountyItem = {
    id: 'police-county-1',
    source: { name: 'Police-Hajdu', url: 'https://police.hu/hajdu-hirek' },
    title: 'Vármegyei összefoglaló az elmúlt 24 óra rendőrségi eseményeiről',
    kind: 'news',
    newsCategory: 'news_local',
    territory: {},
    facts: {}
  };

  const items = [qubitItem, portfolioItem, hvgItem, dehirCultureItem, policeCountyItem];
  const partitions = partitionEventsByView(items);

  const localNews = getViewNews(partitions, VIEWS.LOCAL);
  const countyNews = getViewNews(partitions, VIEWS.COUNTY);
  const nationalNews = getViewNews(partitions, VIEWS.NATIONAL);

  // Qubit, Portfolio, HVG: NOT in county view, routed to national
  assert.ok(!countyNews.some(n => n.id === 'qubit-science-1'), 'Qubit tudományos hír NEM kerül a megyei nézetbe');
  assert.ok(!countyNews.some(n => n.id === 'portfolio-econ-1'), 'Portfolio gazdasági hír NEM kerül a megyei nézetbe');
  assert.ok(!countyNews.some(n => n.id === 'hvg-other-1'), 'HVG egyéb hír NEM kerül a megyei nézetbe');

  assert.ok(nationalNews.some(n => n.id === 'qubit-science-1'), 'Qubit az országos nézetbe kerül');
  assert.ok(nationalNews.some(n => n.id === 'portfolio-econ-1'), 'Portfolio az országos nézetbe kerül');
  assert.ok(nationalNews.some(n => n.id === 'hvg-other-1'), 'HVG az országos nézetbe kerül');

  // Dehir kultúrhír: Dehir forrásszintű alapértelmezett területe (Debrecen) miatt bekerül helyi vagy megyei nézetbe
  assert.ok(countyNews.some(n => n.id === 'dehir-culture-1') || localNews.some(n => n.id === 'dehir-culture-1'), 'Dehir debreceni kultúrhír helyi vagy megyei nézetbe kerül');

  // Police-Hajdu: Vármegyei hír bekerül a megyei nézetbe
  assert.ok(countyNews.some(n => n.id === 'police-county-1'), 'Police-Hajdu vármegyei hír a megyei nézetbe kerül');
});

test('8. View fairness: source round-robin interleaving, local/county priority allocation, and legacy international representation', () => {
  // Synthesize a scenario where high-volume source (Feed-A) has 60 items with newer timestamps,
  // while low-volume sources (Feed-B, Feed-C, Legacy-BBC) have 5-10 items with slightly older timestamps.
  const now = Date.now();
  const testItems = [];

  // Feed-A (high volume national news): 60 items
  for (let i = 0; i < 60; i++) {
    testItems.push({
      id: `feed-a-${i}`,
      source: { name: 'RSS-A' },
      kind: 'news',
      newsCategory: 'news_national',
      title: `Feed A hír ${i}`,
      publishedAt: new Date(now - i * 1000).toISOString()
    });
  }

  // Feed-B (medium volume national news, e.g. 444): 10 items
  for (let i = 0; i < 10; i++) {
    testItems.push({
      id: `feed-b-${i}`,
      source: { name: 'RSS-B' },
      kind: 'news',
      newsCategory: 'news_national',
      title: `Feed B hír ${i}`,
      publishedAt: new Date(now - (i + 100) * 1000).toISOString() // older than Feed-A
    });
  }

  // Feed-C (science/economy, e.g. Qubit/Portfolio): 10 items
  for (let i = 0; i < 10; i++) {
    testItems.push({
      id: `feed-c-${i}`,
      source: { name: 'RSS-C' },
      kind: 'news',
      newsCategory: 'news_science',
      title: `Feed C hír ${i}`,
      publishedAt: new Date(now - (i + 150) * 1000).toISOString() // older than Feed-A
    });
  }

  // Local portal (Police-Hajdu): 3 items
  for (let i = 0; i < 3; i++) {
    testItems.push({
      id: `police-ph-${i}`,
      source: { name: 'Police-Hajdu' },
      kind: 'news',
      title: `Rendőrségi tájékoztató ${i}`,
      publishedAt: new Date(now - (i + 200) * 1000).toISOString()
    });
  }

  // Legacy international news (e.g. BBC): 15 items
  for (let i = 0; i < 15; i++) {
    testItems.push({
      id: `legacy-bbc-${i}`,
      source: { name: 'BBC' },
      kind: 'news',
      newsCategory: 'news_global',
      title: `BBC World report ${i}`,
      country: 'GBR',
      publishedAt: new Date(now - (i + 300) * 1000).toISOString()
    });
  }

  // Run view partitioning with totalNewsCap = 50 to test severe constraint
  const partitions = partitionEventsByView(testItems, undefined, { totalNewsCap: 50, viewNewsCap: 30 });

  const nationalNews = getViewNews(partitions, VIEWS.NATIONAL);
  const countyNews = getViewNews(partitions, VIEWS.COUNTY);
  const globalNews = getViewNews(partitions, VIEWS.GLOBAL);

  // 1. All 3 Police-Hajdu items are admitted to county view (local/county allocation prioritized)
  assert.equal(countyNews.filter(n => n.source?.name === 'Police-Hajdu').length, 3, 'Mind a 3 Police-Hajdu hírnek be kell kerülnie a megyei nézetbe');

  // 2. Feed-B and Feed-C are NOT starved in National view despite older timestamps
  const feedBCount = nationalNews.filter(n => n.source?.name === 'RSS-B').length;
  const feedCCount = nationalNews.filter(n => n.source?.name === 'RSS-C').length;
  assert.ok(feedBCount > 0, 'RSS-B (444 típusú) nem szorulhat ki az országos nézetből (count > 0)');
  assert.ok(feedCCount > 0, 'RSS-C (Qubit/Portfolio típusú) nem szorulhat ki az országos nézetből (count > 0)');

  // 3. Legacy international news is NOT starved in Global view
  const bbcCount = globalNews.filter(n => n.source?.name === 'BBC').length;
  assert.ok(bbcCount > 0, 'A legacy nemzetközi hírek (BBC) nem szorulhatnak ki a globális nézetből (count > 0)');

  // 4. Total retained news respects ceiling
  assert.ok(partitions.news.length <= 50, 'A közös plafon (50) nem léphető túl');
});

test('8. Server-side duplicate merging before cap frees up slots and retains related sources', () => {
  const now = Date.now();
  const testItems = [
    // Duplicate pair 1: Index (direct) vs Google News (redirect) with same normalized title within 5 min
    {
      id: 'gnews-dup-1',
      kind: 'news',
      newsCategory: 'news_national',
      title: 'Közlekedési változások a fővárosban - Index',
      source: { name: 'Google-News', url: 'https://news.google.com/rss/articles/CBMi...' },
      publishedAt: new Date(now - 10 * 60 * 1000).toISOString()
    },
    {
      id: 'index-direct-1',
      kind: 'news',
      newsCategory: 'news_national',
      title: 'Közlekedési változások a fővárosban',
      source: { name: 'Index', url: 'https://index.hu/belfold/2026/10/30/kozlekedes/' },
      publishedAt: new Date(now - 12 * 60 * 1000).toISOString()
    },
    // Distinct news 2
    {
      id: 'telex-news-2',
      kind: 'news',
      newsCategory: 'news_national',
      title: 'Fontos bejelentést tett a kormány a költségvetésről',
      source: { name: 'Telex', url: 'https://telex.hu/gazdasag/2026/10/30/bejelentes' },
      publishedAt: new Date(now - 20 * 60 * 1000).toISOString()
    },
    // Distinct news 3
    {
      id: 'hvg-news-3',
      kind: 'news',
      newsCategory: 'news_national',
      title: 'Átadták az új vasúti szakaszt',
      source: { name: 'HVG', url: 'https://hvg.hu/gazdasag/20261030_vasut' },
      publishedAt: new Date(now - 30 * 60 * 1000).toISOString()
    }
  ];

  // Set totalNewsCap = 3. Without dedup, items 1a and 1b would take 2 slots, leaving only 1 slot for items 2 and 3.
  // With dedup, 1a + 1b merge into 1 slot, freeing capacity so BOTH item 2 and item 3 are admitted!
  const partitions = partitionEventsByView(testItems, undefined, { totalNewsCap: 3, viewNewsCap: 10 });

  assert.equal(partitions.news.length, 3, 'Mind a 3 egyedi téma befért a 3-as plafonba a duplikátum összevonása miatt');
  const merged = partitions.news.find(n => n.id === 'index-direct-1');
  assert.ok(merged, 'A közvetlen kiadói link (Index) lett a főkártya a Google News átirányítóval szemben');
  assert.deepEqual(merged.relatedSources, ['Google-News'], 'A kapcsolódó forrás megőrzésre került');
  assert.ok(partitions.news.some(n => n.id === 'telex-news-2'), 'A 2. tétel bekerült');
  assert.ok(partitions.news.some(n => n.id === 'hvg-news-3'), 'A 3. tétel bekerült a felszabadult helyre');
});

test('9. Portfolio territorial audit: company names alone (BMW, CATL) do NOT grant County view without settlement match', () => {
  const now = Date.now();
  const testItems = [
    // Item A: mentions BMW and CATL, but NO settlement or county name
    {
      id: 'portfolio-corp-only',
      kind: 'news',
      newsCategory: 'news_economy',
      title: 'Hatalmas globális megállapodást kötött a BMW és a CATL az akkumulátorok terén',
      source: { name: 'Portfolio', url: 'https://portfolio.hu/gazdasag/bmw-catl' },
      publishedAt: new Date(now - 10 * 60 * 1000).toISOString()
    },
    // Item B: mentions Debrecen explicitly alongside BMW
    {
      id: 'portfolio-debrecen-bmw',
      kind: 'news',
      newsCategory: 'news_economy',
      title: 'Új műszak indul Debrecenben a BMW gyárban a termelés felpörgetésére',
      source: { name: 'Portfolio', url: 'https://portfolio.hu/gazdasag/debrecen-bmw' },
      publishedAt: new Date(now - 15 * 60 * 1000).toISOString()
    }
  ];

  const partitions = partitionEventsByView(testItems);
  const countyNews = getViewNews(partitions, VIEWS.COUNTY);
  const nationalNews = getViewNews(partitions, VIEWS.NATIONAL);

  assert.ok(!countyNews.some(n => n.id === 'portfolio-corp-only'), 'Cégnév (BMW, CATL) önmagában NEM kerülhet a megyei nézetbe');
  assert.ok(nationalNews.some(n => n.id === 'portfolio-corp-only'), 'A területi kapcsolat nélküli Portfolio hír az országos nézetbe kerül');
  assert.ok(countyNews.some(n => n.id === 'portfolio-debrecen-bmw'), 'Debrecen településnévvel bíró Portfolio hír bekerül a megyei nézetbe');
});

test('10. calculateLocalMapBounds: dynamic center and radius calculation from settlement profile', () => {
  // Case A: Bihartorda default profile (47.1658, 21.3650, 35 km)
  const bihartordaBounds = calculateLocalMapBounds(BIHARTORDA_PROFILE, 35);
  assert.equal(bihartordaBounds.regionKey, 'local');
  assert.equal(bihartordaBounds.label, 'Bihartorda és térsége');
  assert.equal(bihartordaBounds.pov.lat, 47.1658);
  assert.equal(bihartordaBounds.pov.lng, 21.3650);
  // Verify bounding box symmetry around center
  const [[minLonA, minLatA], [maxLonA, maxLatA]] = bihartordaBounds.bounds;
  assert.ok(minLonA < 21.3650 && maxLonA > 21.3650, 'Lon range contains Bihartorda center');
  assert.ok(minLatA < 47.1658 && maxLatA > 47.1658, 'Lat range contains Bihartorda center');
  assert.equal(Number(((minLatA + maxLatA) / 2).toFixed(4)), 47.1658, 'Lat range is centered exactly on Bihartorda');
  assert.equal(Number(((minLonA + maxLonA) / 2).toFixed(4)), 21.3650, 'Lon range is centered exactly on Bihartorda');

  // Case B: Debrecen profile with custom radius (47.5316, 21.6273, 25 km)
  const debrecenProfile = {
    id: 'debrecen',
    name: 'Debrecen',
    radiusKm: 25,
    coordinates: { lat: 47.5316, lon: 21.6273 }
  };
  const debrecenBounds = calculateLocalMapBounds(debrecenProfile);
  assert.equal(debrecenBounds.regionKey, 'local');
  assert.equal(debrecenBounds.label, 'Debrecen és térsége');
  assert.equal(debrecenBounds.pov.lat, 47.5316);
  assert.equal(debrecenBounds.pov.lng, 21.6273);
  const [[minLonB, minLatB], [maxLonB, maxLatB]] = debrecenBounds.bounds;
  assert.equal(Number(((minLatB + maxLatB) / 2).toFixed(4)), 47.5316, 'Lat range is centered on Debrecen');
  assert.equal(Number(((minLonB + maxLonB) / 2).toFixed(4)), 21.6273, 'Lon range is centered on Debrecen');

  // Case C: createTerritoryConfig integrates calculated bounds dynamically
  const debConfig = createTerritoryConfig({ primary: debrecenProfile });
  assert.equal(debConfig.mapBounds.local.label, 'Debrecen és térsége');
  assert.equal(debConfig.mapBounds.local.pov.lat, 47.5316);
  assert.deepEqual(debConfig.mapBounds.local.bounds, debrecenBounds.bounds);

  const defaultCfg = createTerritoryConfig();
  assert.equal(defaultCfg.mapBounds.local.label, 'Bihartorda és térsége');
  assert.equal(defaultCfg.mapBounds.local.pov.lat, 47.1658);
});
