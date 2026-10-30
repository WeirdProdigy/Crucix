import test from 'node:test';
import assert from 'node:assert/strict';
import {
  partitionEventsByView,
  evaluateEventTerritoryViews,
  evaluateNewsTerritoryViews,
  getViewNews,
  VIEWS
} from '../lib/intelligence/views.mjs';
import { DEFAULT_TERRITORY_CONFIG } from '../lib/intelligence/territory.mjs';
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
