import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEWS,
  VIEW_CATEGORIES,
  RELATIONSHIPS,
  CATEGORY_LABELS,
  COVERAGE_STATES,
  COVERAGE_PRECEDENCE,
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

test('1. VIEWS, VIEW_CATEGORIES, and RELATIONSHIPS enum contracts', () => {
  assert.equal(VIEWS.LOCAL, 'local');
  assert.equal(VIEWS.COUNTY, 'county');
  assert.equal(VIEWS.NATIONAL, 'national');
  assert.equal(VIEWS.GLOBAL, 'global');

  assert.equal(VIEW_CATEGORIES.CONFIRMED_LOCAL, 'confirmedLocal');
  assert.equal(VIEW_CATEGORIES.KEY_CONNECTION, 'keyConnection');
  assert.equal(VIEW_CATEGORIES.NEEDS_REVIEW, 'needsReview');
  assert.equal(VIEW_CATEGORIES.REGIONAL_ADVISORIES, 'regionalAdvisories');
  assert.equal(VIEW_CATEGORIES.UNKNOWN_TERRITORY, 'unknownTerritory');
  assert.equal(VIEW_CATEGORIES.COUNTY_EVENT, 'countyEvent');
  assert.equal(VIEW_CATEGORIES.NATIONAL_EVENT, 'nationalEvent');
  assert.equal(VIEW_CATEGORIES.GLOBAL_EVENT, 'globalEvent');

  assert.equal(RELATIONSHIPS.PRIMARY, 'primary');
  assert.equal(RELATIONSHIPS.WATCHED, 'watched');
  assert.equal(RELATIONSHIPS.KEY_CONNECTION, 'key_connection');
  assert.equal(RELATIONSHIPS.COUNTY, 'county');
  assert.equal(RELATIONSHIPS.REGION, 'region');
  assert.equal(RELATIONSHIPS.NATIONAL, 'national');
  assert.equal(RELATIONSHIPS.GLOBAL, 'global');
  assert.equal(RELATIONSHIPS.UNKNOWN, 'unknown');
});

test('2. Berettyóújfalu profile gating: excluded by default, included only when explicitly configured', () => {
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
  assert.equal(evalDefault[VIEWS.COUNTY].category, VIEW_CATEGORIES.COUNTY_EVENT, 'Category in county view is countyEvent, NOT confirmedLocal');
  assert.equal(evalDefault[VIEWS.NATIONAL].inView, true, 'Berettyóújfalu is in national view');

  // Explicit configuration with Berettyóújfalu as key connection
  const customCfg = createTerritoryConfig({
    keyCities: [...defaultCfg.keyCities, BERETTYOUJFALU_PROFILE]
  });
  const evalCustom = evaluateEventTerritoryViews(berettyoEvent, customCfg);
  assert.equal(evalCustom[VIEWS.LOCAL].inView, true, 'Berettyóújfalu must be in Local View when configured in keyCities');
  assert.equal(evalCustom[VIEWS.LOCAL].category, VIEW_CATEGORIES.KEY_CONNECTION, 'Category is keyConnection (NOT bihartordai megerősített)');
  assert.equal(evalCustom[VIEWS.LOCAL].relationship, RELATIONSHIPS.KEY_CONNECTION);

  // Deconfigured again: returns to out-of-view
  const revertedCfg = createTerritoryConfig();
  const evalReverted = evaluateEventTerritoryViews(berettyoEvent, revertedCfg);
  assert.equal(evalReverted[VIEWS.LOCAL].inView, false, 'Berettyóújfalu must return to out-of-view when deconfigured');
});

test('3. Bakonszeg inclusion does NOT pull in the whole Berettyóújfalui district (094)', () => {
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
  assert.equal(evalBak[VIEWS.LOCAL].relationship, RELATIONSHIPS.WATCHED);

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
  assert.equal(evalZsaka[VIEWS.COUNTY].inView, true);
  assert.equal(evalZsaka[VIEWS.COUNTY].category, VIEW_CATEGORIES.COUNTY_EVENT, 'Zsáka in County view is countyEvent, NEVER confirmedLocal');
  assert.equal(evalZsaka[VIEWS.COUNTY].relationship, RELATIONSHIPS.COUNTY);
});

test('4. Nem figyelt Berettyóújfalu és Zsáka NEM confirmedLocal a Helyi nézetben és a Hajdú-Bihar nézetben sem', () => {
  const cfg = DEFAULT_TERRITORY_CONFIG;

  const berettyoEvent = {
    id: 'event-b002',
    title: 'Közlemény Berettyóújfalu',
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

  const zsakaEvent = {
    id: 'event-z002',
    title: 'Közlemény Zsáka',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Zsáka',
      kshSettlement: '20831',
      kshSettlementCode: '20831',
      countyCode: '09',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  const partition = partitionEventsByView([berettyoEvent, zsakaEvent], cfg);

  // Local View checks
  assert.equal(partition[VIEWS.LOCAL].breakdown.confirmedLocal, 0, 'confirmedLocal in Local view must be 0 for unwatched settlements');
  assert.equal(partition[VIEWS.LOCAL].breakdown.keyConnection, 0);
  assert.equal(partition[VIEWS.LOCAL].uniqueEvents, 0, 'Unwatched settlements do not enter Local view');

  // Hajdú-Bihar View checks
  assert.equal(partition[VIEWS.COUNTY].breakdown.confirmedLocal, 0, 'confirmedLocal in Hajdú-Bihar view MUST BE 0!');
  assert.equal(partition[VIEWS.COUNTY].breakdown.countyEvent, 2, 'Unwatched county settlements enter countyEvent category');
  assert.equal(partition[VIEWS.COUNTY].relationshipBreakdown.county, 2);
});

test('5. Debrecen key_connection külön számláló: nem bihartordai megerősített találat', () => {
  const debEvent = {
    id: 'event-deb01',
    title: 'Debrecen új ipari park átadás',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Debrecen',
      kshSettlement: '15130',
      kshSettlementCode: '15130',
      countyCode: '09',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  const bihEvent = {
    id: 'event-bih01',
    title: 'Bihartorda falunap',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Bihartorda',
      kshSettlement: '29887',
      kshSettlementCode: '29887',
      countyCode: '09',
      isConfirmedLocal: true,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT
    }
  };

  const partition = partitionEventsByView([debEvent, bihEvent], DEFAULT_TERRITORY_CONFIG);
  const local = partition[VIEWS.LOCAL];

  assert.equal(local.uniqueEvents, 2);
  assert.equal(local.breakdown.confirmedLocal, 1, 'Only Bihartorda (primary) is confirmedLocal');
  assert.equal(local.breakdown.keyConnection, 1, 'Debrecen is isolated under keyConnection counter!');
  assert.equal(local.relationshipBreakdown.primary, 1);
  assert.equal(local.relationshipBreakdown.key_connection, 1);
});

test('6. text_mention és unknown a magas szintű nézetekben sem confirmedLocal', () => {
  const textMentionNational = {
    id: 'event-tm-nat',
    title: 'Cikk, amelyben Budapest és Debrecen neve előfordul',
    territory: {
      territoryLevel: 'settlement',
      settlementName: 'Debrecen',
      kshSettlement: '15130',
      countyCode: '09',
      country: 'HUN',
      isConfirmedLocal: false,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.TEXT_MENTION,
      needsLocalReview: true
    }
  };

  const unknownDomestic = {
    id: 'event-unk-dom',
    title: 'Ismeretlen helyszínű belpolitikai hír',
    territory: {
      matchState: 'unknown',
      territoryLevel: 'indeterminate',
      country: 'HUN',
      isConfirmedLocal: false,
      needsLocalReview: true
    }
  };

  const partition = partitionEventsByView([textMentionNational, unknownDomestic], DEFAULT_TERRITORY_CONFIG);

  // In Local View
  assert.equal(partition[VIEWS.LOCAL].breakdown.confirmedLocal, 0, 'No confirmedLocal in Local View for text mention or unknown');
  assert.equal(partition[VIEWS.LOCAL].breakdown.needsReview, 1);
  assert.equal(partition[VIEWS.LOCAL].breakdown.unknownTerritory, 1);

  // In County View
  assert.equal(partition[VIEWS.COUNTY].breakdown.confirmedLocal, 0, 'No confirmedLocal in County View');
  assert.equal(partition[VIEWS.COUNTY].breakdown.needsReview, 1);

  // In National View
  assert.equal(partition[VIEWS.NATIONAL].breakdown.confirmedLocal, 0, 'No confirmedLocal in National View');
  assert.equal(partition[VIEWS.NATIONAL].breakdown.needsReview, 1);
  assert.equal(partition[VIEWS.NATIONAL].breakdown.unknownTerritory, 1);

  // In Global View
  assert.equal(partition[VIEWS.GLOBAL].breakdown.confirmedLocal, 0, 'No confirmedLocal in Global View');
});

test('7. Hajdú-Bihar nézet: HU321 megyei riasztás countyEvent (nem régiós), HU32 regionalAdvisories', () => {
  const hbCountyAlert = {
    id: 'event-hb-cap',
    title: 'Hajdú-Bihar vármegyei szélriasztás',
    territory: {
      territoryLevel: 'county',
      territoryName: 'Hajdú-Bihar',
      countyCode: '09',
      nuts3: 'HU321',
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY
    }
  };

  const eszakAlfoldRegionalAlert = {
    id: 'event-ea-cap',
    title: 'Észak-Alföld hőségriasztás',
    territory: {
      territoryLevel: 'region',
      territoryName: 'Észak-Alföld',
      nuts2: 'HU32',
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY
    }
  };

  const evalCounty = evaluateEventTerritoryViews(hbCountyAlert, DEFAULT_TERRITORY_CONFIG);
  assert.equal(evalCounty[VIEWS.COUNTY].inView, true);
  assert.equal(evalCounty[VIEWS.COUNTY].category, VIEW_CATEGORIES.COUNTY_EVENT, 'HU321 county alert must be countyEvent in Hajdú-Bihar view, NOT regionalAdvisories');
  assert.equal(evalCounty[VIEWS.COUNTY].relationship, RELATIONSHIPS.COUNTY);

  const evalRegion = evaluateEventTerritoryViews(eszakAlfoldRegionalAlert, DEFAULT_TERRITORY_CONFIG);
  assert.equal(evalRegion[VIEWS.COUNTY].inView, true);
  assert.equal(evalRegion[VIEWS.COUNTY].category, VIEW_CATEGORIES.REGIONAL_ADVISORIES, 'HU32 regional alert remains regionalAdvisories in Hajdú-Bihar view');
  assert.equal(evalRegion[VIEWS.COUNTY].relationship, RELATIONSHIPS.REGION);

  // In Local view, both remain regionalAdvisories
  assert.equal(evalCounty[VIEWS.LOCAL].category, VIEW_CATEGORIES.REGIONAL_ADVISORIES);
  assert.equal(evalRegion[VIEWS.LOCAL].category, VIEW_CATEGORIES.REGIONAL_ADVISORIES);
});

test('8. Világ nézet: SOHA nem használhatja a regionalAdvisories kategóriát', () => {
  const regionalEvent = {
    id: 'event-reg-global',
    title: 'Regionális árvíz Észak-Alföldön',
    territory: {
      territoryLevel: 'region',
      nuts2: 'HU32',
      country: 'HUN'
    }
  };

  const evalRes = evaluateEventTerritoryViews(regionalEvent, DEFAULT_TERRITORY_CONFIG);
  assert.equal(evalRes[VIEWS.GLOBAL].inView, true);
  assert.equal(evalRes[VIEWS.GLOBAL].category, VIEW_CATEGORIES.GLOBAL_EVENT, 'Global view must NEVER use regionalAdvisories');
  assert.notEqual(evalRes[VIEWS.GLOBAL].category, VIEW_CATEGORIES.REGIONAL_ADVISORIES);
});

test('9. CAP dedup: sender nélküli fallback kulcs (no-sender)', () => {
  const alertNoSender = {
    identifier: 'MSG-NO-SENDER',
    title: 'Riasztás küldő nélkül',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  const key = getEventCanonicalKey(alertNoSender);
  assert.equal(key, 'cap-msg:no-sender:MSG-NO-SENDER', 'Missing sender must stably fallback to no-sender');
});

test('10. CAP dedup: azonos identifier eltérő sender esetén NEM vonódik össze', () => {
  const alertMeteo = {
    identifier: 'MSG-001',
    sender: 'meteoalarm.org',
    title: 'Meteoalarm szélvihar',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  const alertKat = {
    identifier: 'MSG-001',
    sender: 'katasztrofavedelem.hu',
    title: 'Katasztrófavédelem közlemény',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  const key1 = getEventCanonicalKey(alertMeteo);
  const key2 = getEventCanonicalKey(alertKat);

  assert.notEqual(key1, key2, 'Different senders with same identifier MUST NOT produce identical canonical keys');
  assert.equal(key1, 'cap-msg:meteoalarm.org:MSG-001');
  assert.equal(key2, 'cap-msg:katasztrofavedelem.hu:MSG-001');

  const partition = partitionEventsByView([alertMeteo, alertKat], DEFAULT_TERRITORY_CONFIG);
  assert.equal(partition[VIEWS.LOCAL].uniqueEvents, 2, 'Both messages must be retained as separate incidents');
});

test('11. CAP lánc: kategóriát és állapotot a CAP sent ideje határozza meg, fordított érkezési sorrendnél is', () => {
  const chainKey = 'meteoalarm:HU:wind:HU321';
  const sender = 'meteoalarm.org';

  // Order of messages in array is REVERSED: Cancel sent later, Alert sent earlier
  const earlierAlert = {
    chainKey,
    sender,
    identifier: 'CHAIN.001',
    sent: '2026-10-24T10:00:00Z',
    msgType: 'Alert',
    title: 'Szélvihar narancs (Alert)',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  const laterCancel = {
    chainKey,
    sender,
    identifier: 'CHAIN.002',
    sent: '2026-10-24T12:00:00Z',
    msgType: 'Cancel',
    cancelled: true,
    title: 'Szélvihar visszavonva (Cancel)',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  // Arrival order: earlierAlert comes AFTER laterCancel in the array!
  const reversedArray = [laterCancel, earlierAlert];
  const partition = partitionEventsByView(reversedArray, DEFAULT_TERRITORY_CONFIG);
  const local = partition[VIEWS.LOCAL];

  assert.equal(local.totalEvents, 2, 'Both messages are recorded in raw totalEvents');
  assert.equal(local.uniqueEvents, 0, 'Cancelled chain does NOT count as an active incident despite reversed arrival order');
  assert.equal(local.breakdown.regionalAdvisories, 0);
  assert.equal(local.cancelledChains, 1, 'Chain is recognized as cancelled due to sent timestamp order');
});

test('12. CAP küldőalapú dedup valós normalizált eseményeken is ellenőrizve', () => {
  const normEvent1 = {
    id: 'event-0123456789abcdef0123456789abcdef',
    source: { name: 'Meteoalarm' },
    sender: 'meteoalarm.org',
    identifier: 'NORM-001',
    chainKey: 'meteoalarm.org:HU:wind:HU321',
    title: 'Meteoalarm warning',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  const normEvent2 = {
    id: 'event-fedcba9876543210fedcba9876543210',
    source: { name: 'Katasztrofavedelem' },
    sender: 'katasztrofavedelem.hu',
    identifier: 'NORM-001',
    chainKey: 'katasztrofavedelem.hu:HU:wind:HU321',
    title: 'Katasztrófavédelem warning',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  const key1 = getEventCanonicalKey(normEvent1);
  const key2 = getEventCanonicalKey(normEvent2);

  assert.notEqual(key1, key2, 'Normalized events with different senders must produce distinct canonical keys');
  const partition = partitionEventsByView([normEvent1, normEvent2], DEFAULT_TERRITORY_CONFIG);
  assert.equal(partition[VIEWS.LOCAL].uniqueEvents, 2);
});

test('13. Fedettségi állapotok szigorú elsőbbsége (COVERAGE_PRECEDENCE)', () => {
  assert.deepEqual(COVERAGE_PRECEDENCE, [
    COVERAGE_STATES.LETILTOTT,
    COVERAGE_STATES.NINCS_FORRAS,
    COVERAGE_STATES.ELAVULT_HIBAS,
    COVERAGE_STATES.OFFLINE_PILLANATKEP,
    COVERAGE_STATES.SIKERES_ADAT,
    COVERAGE_STATES.SIKERES_URES
  ]);
});

test('14. Fedettségi modell: az origin (snapshot/live) külön mező, nem írja felül a hibát, hiányt vagy letiltást', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');

  // Source in offline snapshot with error: must be ELAVULT_HIBAS, NOT OFFLINE_PILLANATKEP!
  const errInSnapshot = { id: 's-err', name: 'Error Source', enabled: true, error: 'Database timeout' };
  const evalErr = evaluateSourceCoverage([errInSnapshot], [], { now, isOfflineSnapshot: true });
  assert.equal(evalErr[0].origin, 'snapshot');
  assert.equal(evalErr[0].isSnapshot, true);
  assert.equal(evalErr[0].status, COVERAGE_STATES.ELAVULT_HIBAS, 'Snapshot mode must NOT overwrite error state');

  // Source in offline snapshot that is unconfigured: must be NINCS_FORRAS!
  const missingInSnapshot = { id: 's-missing', name: 'Missing Source', enabled: true, unconfigured: true };
  const evalMissing = evaluateSourceCoverage([missingInSnapshot], [], { now, isOfflineSnapshot: true });
  assert.equal(evalMissing[0].origin, 'snapshot');
  assert.equal(evalMissing[0].status, COVERAGE_STATES.NINCS_FORRAS, 'Snapshot mode must NOT overwrite unconfigured state');

  // Healthy source in snapshot: receives OFFLINE_PILLANATKEP
  const healthyInSnapshot = { id: 's-ok', name: 'Healthy Snapshot', enabled: true, lastUpdated: '2026-10-24T11:50:00Z' };
  const evalOk = evaluateSourceCoverage([healthyInSnapshot], [{ source: 's-ok', title: 'Data' }], { now, isOfflineSnapshot: true });
  assert.equal(evalOk[0].origin, 'snapshot');
  assert.equal(evalOk[0].status, COVERAGE_STATES.OFFLINE_PILLANATKEP);
});

test('15. Fedettségi modell: sikeres_üres nem tartalmazhat nyugodt szóhasználatot', () => {
  assert.equal(COVERAGE_LABELS[COVERAGE_STATES.SIKERES_URES], 'Sikeres lekérés, nincs aktív tétel');
  assert.ok(!COVERAGE_LABELS[COVERAGE_STATES.SIKERES_URES].toLowerCase().includes('nyugodt'), 'sikeres_üres must NOT contain nyugodt');
});

test('16. Date normalization: date-only strings do NOT become midnight UTC', () => {
  const dOnly = normalizeEventDate('2026-10-24');
  assert.equal(dOnly.dateOnly, true);
  assert.equal(dOnly.raw, '2026-10-24');
  assert.equal(dOnly.iso, null, 'date-only string must NOT fabricate midnight ISO UTC string');
  assert.equal(dOnly.timestamp, null);

  const fullIso = normalizeEventDate('2026-10-24T14:30:00.000Z');
  assert.equal(fullIso.dateOnly, false);
  assert.equal(fullIso.iso, '2026-10-24T14:30:00.000Z');
  assert.ok(Number.isFinite(fullIso.timestamp));

  const invalid = normalizeEventDate('not-a-date');
  assert.equal(invalid.iso, null);
  assert.equal(invalid.timestamp, null);
});

test('17. Coordinate sanitization: unlocated news receives null, preventing fake centroid drift', () => {
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

test('18. Deterministic canonical key synthesis for ID-less records', () => {
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

test('19. Orthogonal Lens x View interaction (pure intersection matrix)', () => {
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

  // Local view + weather lens: bihWeather + debWeather
  const localWeather = filterEventsByViewAndLens(events, VIEWS.LOCAL, 'weather', DEFAULT_TERRITORY_CONFIG);
  assert.equal(localWeather.length, 2);

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

test('20. Briefing citation reference validation contract', () => {
  assert.deepEqual(BRIEFING_RECORD_FIELDS, ['id', 'n', 'title']);

  assert.equal(isValidBriefingRef({
    n: 1,
    id: 'event-0123456789abcdef0123456789abcdef',
    title: 'Szélvihar Hajdú-Bihar vármegyében'
  }), true);

  assert.equal(isValidBriefingRef(null), false);
  assert.equal(isValidBriefingRef({ n: 0, id: 'event-0123456789abcdef0123456789abcdef', title: 'T' }), false, 'n must be >= 1');
  assert.equal(isValidBriefingRef({ n: 1, id: 'not-an-event-id', title: 'T' }), false, 'id must match event id regex');
  assert.equal(isValidBriefingRef({ n: 1, id: 'event-0123456789abcdef0123456789abcdef', title: '' }), false, 'title must not be empty');
});
