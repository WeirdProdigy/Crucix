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
