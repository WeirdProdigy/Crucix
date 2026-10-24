import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEWS,
  VIEW_CATEGORIES,
  CATEGORY_LABELS,
  COVERAGE_STATES,
  COVERAGE_LABELS,
  BRIEFING_RECORD_FIELDS,
  isValidBriefingRef,
  normalizeEventDate,
  sanitizeCoordinates,
  getEventCanonicalKey,
  evaluateEventTerritoryViews,
  partitionEventsByView,
  matchesViewAndLens,
  filterEventsByViewAndLens,
  computeViewLensMatrix,
  evaluateSourceCoverage
} from '../lib/intelligence/views.mjs';

import {
  DEFAULT_TERRITORY_CONFIG,
  createTerritoryConfig,
  BIHARTORDA_PROFILE,
  BERETTYOUJFALU_PROFILE,
  LOCAL_RELEVANCE_REASONS,
  IDENTITY_STATUSES,
  WATCH_SCOPES,
  ADMINISTRATIVE_LEVELS,
  matchTerritory
} from '../lib/intelligence/territory.mjs';

test('VIEWS and VIEW_CATEGORIES enum contracts', () => {
  assert.equal(VIEWS.LOCAL, 'local');
  assert.equal(VIEWS.COUNTY, 'county');
  assert.equal(VIEWS.NATIONAL, 'national');
  assert.equal(VIEWS.GLOBAL, 'global');

  assert.equal(VIEW_CATEGORIES.CONFIRMED_LOCAL, 'confirmedLocal');
  assert.equal(VIEW_CATEGORIES.NEEDS_REVIEW, 'needsReview');
  assert.equal(VIEW_CATEGORIES.REGIONAL_ADVISORIES, 'regionalAdvisories');
  assert.equal(VIEW_CATEGORIES.UNKNOWN_TERRITORY, 'unknownTerritory');
});

test('1. Berettyóújfalu profile gating: excluded by default, included only when explicitly configured', () => {
  const defaultCfg = DEFAULT_TERRITORY_CONFIG;
  const berettyoEvent = {
    id: 'event-b001',
    title: 'Vízvezeték-felújítás Berettyóújfaluban',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Berettyóújfalu',
      kshSettlement: '20822',
      kshSettlementCode: '20822',
      countyCode: '09',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  // Default configuration: Berettyóújfalu is NOT in watchedSettlements or keyCities
  const evalDefault = evaluateEventTerritoryViews(berettyoEvent, defaultCfg);
  assert.equal(evalDefault[VIEWS.LOCAL].inView, false, 'Berettyóújfalu must NOT be in Local View by default');
  assert.equal(evalDefault[VIEWS.LOCAL].category, null);
  assert.equal(evalDefault[VIEWS.COUNTY].inView, true, 'Berettyóújfalu is in Hajdú-Bihar county view');
  assert.equal(evalDefault[VIEWS.NATIONAL].inView, true, 'Berettyóújfalu is in national view');

  // Explicit configuration with Berettyóújfalu as key connection
  const customCfg = createTerritoryConfig({
    keyCities: [...defaultCfg.keyCities, BERETTYOUJFALU_PROFILE]
  });
  const evalCustom = evaluateEventTerritoryViews(berettyoEvent, customCfg);
  assert.equal(evalCustom[VIEWS.LOCAL].inView, true, 'Berettyóújfalu must be in Local View when configured in keyCities');
  assert.equal(evalCustom[VIEWS.LOCAL].category, VIEW_CATEGORIES.CONFIRMED_LOCAL);

  // Deconfigured again: returns to out-of-view
  const revertedCfg = createTerritoryConfig();
  const evalReverted = evaluateEventTerritoryViews(berettyoEvent, revertedCfg);
  assert.equal(evalReverted[VIEWS.LOCAL].inView, false, 'Berettyóújfalu must return to out-of-view when deconfigured');
});

test('2. Bakonszeg inclusion does NOT pull in the whole Berettyóújfalui district (094)', () => {
  const cfg = DEFAULT_TERRITORY_CONFIG; // Bakonszeg is in SUGGESTED_NEARBY_SETTLEMENTS (kshSettlement: 15167, district: 094)

  const bakonszegEvent = {
    id: 'event-bak01',
    title: 'Helyi hír Bakonszeg',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Bakonszeg',
      kshSettlement: '15167',
      kshSettlementCode: '15167',
      countyCode: '09',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  const evalBak = evaluateEventTerritoryViews(bakonszegEvent, cfg);
  assert.equal(evalBak[VIEWS.LOCAL].inView, true, 'Bakonszeg is in Local View because it is in watchedSettlements');
  assert.equal(evalBak[VIEWS.LOCAL].category, VIEW_CATEGORIES.CONFIRMED_LOCAL);

  // Another settlement in district 094 (e.g. Zsáka ksh: 20831), NOT in watched settlements
  const zsakaEvent = {
    id: 'event-zsa01',
    title: 'Zsáka község híre',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Zsáka',
      kshSettlement: '20831',
      kshSettlementCode: '20831',
      kshDistrict: '094',
      countyCode: '09',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  const evalZsaka = evaluateEventTerritoryViews(zsakaEvent, cfg);
  assert.equal(evalZsaka[VIEWS.LOCAL].inView, false, 'Zsáka must NOT be in Local View (no full-district expansion for 094)');
});

test('3. Unknown territory status is NEVER marked outside_scope or lost; placed in unknownTerritory category', () => {
  const unknownEvent = {
    id: 'event-unk01',
    title: 'Tisztázatlan forrású hír',
    territory: {
      matchState: 'unknown',
      territoryLevel: 'indeterminate',
      isConfirmedLocal: false,
      needsLocalReview: true
    }
  };

  const evalUnk = evaluateEventTerritoryViews(unknownEvent, DEFAULT_TERRITORY_CONFIG);
  assert.equal(evalUnk[VIEWS.LOCAL].inView, true, 'Unknown items must remain visible in Local View for review');
  assert.equal(evalUnk[VIEWS.LOCAL].category, VIEW_CATEGORIES.UNKNOWN_TERRITORY);
  assert.equal(evalUnk[VIEWS.NATIONAL].inView, true, 'Unknown items remain in National View for review');

  // Verify in full partition
  const partition = partitionEventsByView([unknownEvent], DEFAULT_TERRITORY_CONFIG);
  assert.equal(partition[VIEWS.LOCAL].uniqueEvents, 1);
  assert.equal(partition[VIEWS.LOCAL].breakdown.confirmedLocal, 0);
  assert.equal(partition[VIEWS.LOCAL].breakdown.unknownTerritory, 1);
});

test('4. Regional and county source_region_only alerts are NEVER counted as confirmed local', () => {
  const countyAlert = {
    id: 'event-meteo-hb01',
    title: 'Narancs riasztás felhőszakadásra - Hajdú-Bihar vármegye',
    territory: {
      territoryLevel: 'county',
      territoryName: 'Hajdú-Bihar',
      countyCode: '09',
      nuts3: 'HU321',
      nuts2: 'HU32',
      isConfirmedLocal: false,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY
    }
  };

  const regionAlert = {
    id: 'event-meteo-ea01',
    title: 'Sárga figyelmeztetés hőségre - Észak-Alföld',
    territory: {
      territoryLevel: 'region',
      territoryName: 'Észak-Alföld',
      nuts2: 'HU32',
      isConfirmedLocal: false,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY
    }
  };

  const partition = partitionEventsByView([countyAlert, regionAlert], DEFAULT_TERRITORY_CONFIG);

  const local = partition[VIEWS.LOCAL];
  assert.equal(local.breakdown.confirmedLocal, 0, 'Regional/county alerts must NEVER increment confirmedLocal in Local View');
  assert.equal(local.breakdown.regionalAdvisories, 2, 'Enclosing county and regional alerts go to regionalAdvisories');
  assert.equal(local.uniqueEvents, 2);
});

test('5. Hajdú-Bihar View correctly handles NUTS2 HU32 regional alerts as regionalAdvisories', () => {
  const hbCountyAlert = {
    id: 'event-hb-01',
    title: 'Hajdú-Bihar vármegyei figyelmeztetés',
    territory: {
      territoryLevel: 'county',
      countyCode: '09',
      nuts3: 'HU321'
    }
  };

  const hu32RegionalAlert = {
    id: 'event-hu32-01',
    title: 'Észak-Alföld nagyrégiós figyelmeztetés',
    territory: {
      territoryLevel: 'region',
      nuts2: 'HU32'
    }
  };

  const pestCountyAlert = {
    id: 'event-pest-01',
    title: 'Pest vármegyei figyelmeztetés',
    territory: {
      territoryLevel: 'county',
      countyCode: '13',
      nuts3: 'HU120'
    }
  };

  const partition = partitionEventsByView([hbCountyAlert, hu32RegionalAlert, pestCountyAlert], DEFAULT_TERRITORY_CONFIG);

  const countyView = partition[VIEWS.COUNTY];
  assert.equal(countyView.uniqueEvents, 2, 'Only Hajdú-Bihar and enclosing HU32 alerts enter county view');
  assert.equal(countyView.breakdown.regionalAdvisories, 2);
  assert.equal(countyView.items.regionalAdvisories.length, 2);

  // Pest alert must NOT be in Hajdú-Bihar view
  assert.ok(!countyView.items.regionalAdvisories.some(e => e.id === 'event-pest-01'));
});

test('6. Counting Contract & CAP chain deduplication across Alert, Update, Cancel', () => {
  const chainKey = 'meteoalarm:HU:wind:HU321';

  const alert1 = {
    id: 'event-c001',
    chainKey,
    identifier: 'HU.CHAIN.001',
    sender: 'meteoalarm',
    title: 'Szélvihar narancs riasztás (Kezdet)',
    territory: {
      territoryLevel: 'county',
      countyCode: '09',
      nuts3: 'HU321',
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY
    }
  };

  const update1 = {
    id: 'event-c002',
    chainKey,
    identifier: 'HU.CHAIN.002',
    sender: 'meteoalarm',
    title: 'Szélvihar narancs riasztás (Megerősítés/Frissítés)',
    territory: {
      territoryLevel: 'county',
      countyCode: '09',
      nuts3: 'HU321',
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY
    }
  };

  const cancel1 = {
    id: 'event-c003',
    chainKey,
    identifier: 'HU.CHAIN.003',
    sender: 'meteoalarm',
    title: 'Szélvihar visszavonva (Cancel)',
    territory: {
      territoryLevel: 'county',
      countyCode: '09',
      nuts3: 'HU321',
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY
    }
  };

  // Separate, unrelated alert
  const debAlert = {
    id: 'event-deb01',
    title: 'Debreceni villamosbaleset',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Debrecen',
      kshSettlement: '15130',
      countyCode: '09',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  const partition = partitionEventsByView([alert1, update1, cancel1, debAlert], DEFAULT_TERRITORY_CONFIG);

  const local = partition[VIEWS.LOCAL];
  assert.equal(local.totalEvents, 4, 'Total raw records received is 4');
  assert.equal(local.uniqueEvents, 2, 'Distinct unique incidents is 2 (3 chain items deduplicated to 1)');
  assert.equal(local.breakdown.confirmedLocal, 1, 'Debrecen confirmed local is 1');
  assert.equal(local.breakdown.regionalAdvisories, 1, 'The 3 chain records deduplicate to 1 regional advisory');
  assert.equal(local.breakdown.needsReview, 0);
  assert.equal(local.breakdown.unknownTerritory, 0);
});

test('7. Deterministic canonical key synthesis for ID-less records', () => {
  const itemWithoutId1 = {
    source: 'haon',
    title: 'Felújítják a főteret',
    publishedAt: '2026-10-24T08:00:00Z',
    link: 'https://haon.hu/cikk/1'
  };

  const itemWithoutId2 = {
    source: 'haon',
    title: 'Felújítják a főteret',
    publishedAt: '2026-10-24T08:00:00Z',
    link: 'https://haon.hu/cikk/1'
  };

  const key1 = getEventCanonicalKey(itemWithoutId1);
  const key2 = getEventCanonicalKey(itemWithoutId2);

  assert.equal(key1, key2, 'Identical ID-less articles produce identical canonical keys');
  assert.match(key1, /^raw:haon:Felújítják a főteret/);
});

test('8. Date normalization: date-only strings do NOT become midnight UTC', () => {
  const dateOnly = normalizeEventDate('2026-10-24');
  assert.equal(dateOnly.dateOnly, true);
  assert.equal(dateOnly.raw, '2026-10-24');
  assert.equal(dateOnly.iso, null, 'date-only string must NOT fabricate midnight ISO UTC string');
  assert.equal(dateOnly.timestamp, null);

  const fullIso = normalizeEventDate('2026-10-24T14:30:00.000Z');
  assert.equal(fullIso.dateOnly, false);
  assert.equal(fullIso.iso, '2026-10-24T14:30:00.000Z');
  assert.ok(Number.isFinite(fullIso.timestamp));

  const invalid = normalizeEventDate('not-a-date');
  assert.equal(invalid.iso, null);
  assert.equal(invalid.timestamp, null);
});

test('9. Coordinate sanitization: unlocated news receives null, preventing fake centroid drift', () => {
  assert.equal(sanitizeCoordinates(null), null);
  assert.equal(sanitizeCoordinates({}), null);
  assert.equal(sanitizeCoordinates({ lat: 'invalid', lon: 21.0 }), null);
  assert.equal(sanitizeCoordinates({ lat: 100, lon: 21.0 }), null, 'Out of bounds lat');

  const valid = sanitizeCoordinates({
    lat: 47.1658,
    lon: 21.3650,
    source: 'OpenStreetMap/Nominatim',
    isEventLocation: false
  });
  assert.deepEqual(valid, {
    lat: 47.1658,
    lon: 21.3650,
    source: 'OpenStreetMap/Nominatim',
    isEventLocation: false
  });
});

test('10. Source coverage status model evaluates all 6 distinct states', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');

  const sources = [
    { id: 'src-data', name: 'Meteoalarm HU', domain: 'weather', enabled: true },
    { id: 'src-empty', name: 'NÉBIH ASP', domain: 'health', enabled: true },
    { id: 'src-disabled', name: 'Disabled Feed', domain: 'cyber', enabled: false },
    { id: 'src-error', name: 'Faulty API', domain: 'air', enabled: true, error: '503 Service Unavailable' },
    { id: 'src-stale', name: 'Stale Source', domain: 'weather', enabled: true, lastUpdated: '2026-10-24T09:00:00Z' }
  ];

  const observations = [
    { source: 'src-data', title: 'Szélriasztás' }
  ];

  const evaluated = evaluateSourceCoverage(sources, observations, {
    now,
    staleThresholdMs: 60 * 60 * 1000, // 1 hour
    isOfflineSnapshot: false
  });

  const byId = Object.fromEntries(evaluated.map(s => [s.sourceId, s]));

  assert.equal(byId['src-data'].status, COVERAGE_STATES.SIKERES_ADAT);
  assert.equal(byId['src-data'].itemCount, 1);

  assert.equal(byId['src-empty'].status, COVERAGE_STATES.SIKERES_URES);
  assert.equal(byId['src-empty'].itemCount, 0);

  assert.equal(byId['src-disabled'].status, COVERAGE_STATES.LETILTOTT);

  assert.equal(byId['src-error'].status, COVERAGE_STATES.ELAVULT_HIBAS);
  assert.match(byId['src-error'].error, /503/);

  assert.equal(byId['src-stale'].status, COVERAGE_STATES.ELAVULT_HIBAS);
  assert.match(byId['src-stale'].error, /stale/i);

  // Offline snapshot mode
  const offlineEval = evaluateSourceCoverage(sources, observations, {
    now,
    isOfflineSnapshot: true
  });
  assert.ok(offlineEval.every(s => s.status === COVERAGE_STATES.LETILTOTT || s.status === COVERAGE_STATES.OFFLINE_PILLANATKEP));
});

test('11. Orthogonal Lens x View interaction (pure intersection matrix)', () => {
  const bihWeather = {
    id: 'event-bw01',
    domain: 'weather',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Bihartorda',
      kshSettlement: '29887',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  const bihHealth = {
    id: 'event-bh01',
    domain: 'health',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Bihartorda',
      kshSettlement: '29887',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  const debWeather = {
    id: 'event-dw01',
    domain: 'weather',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Debrecen',
      kshSettlement: '15130',
      countyCode: '09',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  const events = [bihWeather, bihHealth, debWeather];

  // Local view + weather lens: bihWeather only (Debrecen is keyCity, so it is in local view too!)
  const localWeather = filterEventsByViewAndLens(events, VIEWS.LOCAL, 'weather', DEFAULT_TERRITORY_CONFIG);
  assert.equal(localWeather.length, 2); // bihWeather + debWeather

  // Local view + health lens: bihHealth only
  const localHealth = filterEventsByViewAndLens(events, VIEWS.LOCAL, 'health', DEFAULT_TERRITORY_CONFIG);
  assert.equal(localHealth.length, 1);
  assert.equal(localHealth[0].id, 'event-bh01');

  // Local view + conflict lens: 0
  const localConflict = filterEventsByViewAndLens(events, VIEWS.LOCAL, 'conflict', DEFAULT_TERRITORY_CONFIG);
  assert.equal(localConflict.length, 0);

  // Compute full 2D matrix
  const matrix = computeViewLensMatrix(events, ['all', 'weather', 'health'], DEFAULT_TERRITORY_CONFIG);
  assert.equal(matrix[VIEWS.LOCAL].all.unique, 3);
  assert.equal(matrix[VIEWS.LOCAL].weather.unique, 2);
  assert.equal(matrix[VIEWS.LOCAL].health.unique, 1);
});

test('12. Briefing citation reference validation contract', () => {
  assert.deepEqual(BRIEFING_RECORD_FIELDS, ['id', 'n', 'title']);

  // Valid ref
  assert.equal(isValidBriefingRef({
    n: 1,
    id: 'event-0123456789abcdef0123456789abcdef',
    title: 'Szélvihar Hajdú-Bihar vármegyében'
  }), true);

  // Invalid cases
  assert.equal(isValidBriefingRef(null), false);
  assert.equal(isValidBriefingRef({ n: 0, id: 'event-0123456789abcdef0123456789abcdef', title: 'T' }), false, 'n must be >= 1');
  assert.equal(isValidBriefingRef({ n: 1, id: 'not-an-event-id', title: 'T' }), false, 'id must match event id regex');
  assert.equal(isValidBriefingRef({ n: 1, id: 'event-0123456789abcdef0123456789abcdef', title: '' }), false, 'title must not be empty');
});
