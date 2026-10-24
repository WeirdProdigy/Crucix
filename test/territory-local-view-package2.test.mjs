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

test('VIEWS, VIEW_CATEGORIES, and RELATIONSHIPS enum contracts', () => {
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

test('3. Nem figyelt Berettyóújfalu és Zsáka NEM confirmedLocal a Helyi nézetben és a Hajdú-Bihar nézetben sem', () => {
  const cfg = DEFAULT_TERRITORY_CONFIG; // Berettyóújfalu és Zsáka nincsenek a figyelt profilban

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

test('4. Debrecen key_connection külön számláló: nem bihartordai megerősített találat', () => {
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

test('5. text_mention és unknown a magas szintű nézetekben sem confirmedLocal', () => {
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

test('6. CAP dedup: azonos identifier eltérő sender esetén NEM vonódik össze', () => {
  const alertMeteo = {
    identifier: 'MSG-001',
    sender: 'meteoalarm.org',
    title: 'Meteoalarm szélvihar',
    territory: {
      territoryLevel: 'county',
      countyCode: '09',
      nuts3: 'HU321',
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY
    }
  };

  const alertKat = {
    identifier: 'MSG-001',
    sender: 'katasztrofavedelem.hu',
    title: 'Katasztrófavédelem közlemény',
    territory: {
      territoryLevel: 'county',
      countyCode: '09',
      nuts3: 'HU321',
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY
    }
  };

  const key1 = getEventCanonicalKey(alertMeteo);
  const key2 = getEventCanonicalKey(alertKat);

  assert.notEqual(key1, key2, 'Different senders with same identifier MUST NOT produce identical canonical keys');
  assert.equal(key1, 'cap-msg:meteoalarm.org:MSG-001');
  assert.equal(key2, 'cap-msg:katasztrofavedelem.hu:MSG-001');

  const partition = partitionEventsByView([alertMeteo, alertKat], DEFAULT_TERRITORY_CONFIG);
  assert.equal(partition[VIEWS.LOCAL].uniqueEvents, 2, 'Both messages must be retained as separate incidents');
});

test('7. CAP lánc és visszavont (cancelled) lánc kezelése', () => {
  const chainKey = 'meteoalarm:HU:wind:HU321';
  const sender = 'meteoalarm.org';

  // Chain 1: Alert -> Update -> Cancel
  const msg1 = {
    chainKey,
    sender,
    identifier: 'CHAIN.001',
    msgType: 'Alert',
    title: 'Szélvihar narancs (Alert)',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  const msg2 = {
    chainKey,
    sender,
    identifier: 'CHAIN.002',
    msgType: 'Update',
    title: 'Szélvihar narancs (Update)',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  const msg3 = {
    chainKey,
    sender,
    identifier: 'CHAIN.003',
    msgType: 'Cancel',
    cancelled: true,
    title: 'Szélvihar visszavonva (Cancel)',
    territory: { territoryLevel: 'county', countyCode: '09', nuts3: 'HU321' }
  };

  const partition = partitionEventsByView([msg1, msg2, msg3], DEFAULT_TERRITORY_CONFIG);
  const local = partition[VIEWS.LOCAL];

  // The 3 raw messages are received
  assert.equal(local.totalEvents, 3, 'All 3 chain messages are recorded in totalEvents');
  // Because the chain was cancelled, active uniqueEvents must be 0!
  assert.equal(local.uniqueEvents, 0, 'Cancelled chain does NOT count as an active unique incident');
  assert.equal(local.breakdown.regionalAdvisories, 0, 'Cancelled advisory does NOT increment active regionalAdvisories');
  assert.equal(local.cancelledChains, 1, 'Cancelled chain is tracked under cancelledChains');
});

test('8. Fedettségi állapotok szigorú elsőbbsége (COVERAGE_PRECEDENCE)', () => {
  assert.deepEqual(COVERAGE_PRECEDENCE, [
    COVERAGE_STATES.LETILTOTT,
    COVERAGE_STATES.OFFLINE_PILLANATKEP,
    COVERAGE_STATES.NINCS_FORRAS,
    COVERAGE_STATES.ELAVULT_HIBAS,
    COVERAGE_STATES.SIKERES_ADAT,
    COVERAGE_STATES.SIKERES_URES
  ]);

  const now = Date.parse('2026-10-24T12:00:00Z');

  // Precedence 1: Disabled beats everything (even error or stale or snapshot)
  const disabledSrc = { id: 's1', name: 'Disabled', enabled: false, error: 'Fatal error', lastUpdated: '2020-01-01' };
  const evalDisabled = evaluateSourceCoverage([disabledSrc], [], { now, isOfflineSnapshot: true });
  assert.equal(evalDisabled[0].status, COVERAGE_STATES.LETILTOTT);

  // Precedence 2: Offline snapshot beats unconfigured/error
  const snapshotSrc = { id: 's2', name: 'Snapshot', enabled: true, error: 'Some error' };
  const evalSnapshot = evaluateSourceCoverage([snapshotSrc], [], { now, isOfflineSnapshot: true });
  assert.equal(evalSnapshot[0].status, COVERAGE_STATES.OFFLINE_PILLANATKEP);

  // Precedence 3: Unconfigured / Nincs forrás -> flags prerequisiteForStep2C: true
  const missingSrc = { id: 's3', name: 'Nincs Forrás Feed', enabled: true, unconfigured: true };
  const evalMissing = evaluateSourceCoverage([missingSrc], [], { now, isOfflineSnapshot: false });
  assert.equal(evalMissing[0].status, COVERAGE_STATES.NINCS_FORRAS);
  assert.equal(evalMissing[0].prerequisiteForStep2C, true, 'Unconfigured source must be flagged as 2C prerequisite');

  // Precedence 4: Error beats stale
  const errorSrc = { id: 's4', name: 'Err', enabled: true, error: '500 Server Error', lastUpdated: '2026-10-24T08:00:00Z' };
  const evalError = evaluateSourceCoverage([errorSrc], [], { now, isOfflineSnapshot: false, staleThresholdMs: 3600000 });
  assert.equal(evalError[0].status, COVERAGE_STATES.ELAVULT_HIBAS);
  assert.match(evalError[0].error, /500/);

  // Precedence 5: Active items
  const activeSrc = { id: 's5', name: 'Active', enabled: true, lastUpdated: '2026-10-24T11:55:00Z' };
  const evalActive = evaluateSourceCoverage([activeSrc], [{ source: 's5', title: 'Tétel' }], { now, isOfflineSnapshot: false });
  assert.equal(evalActive[0].status, COVERAGE_STATES.SIKERES_ADAT);
  assert.equal(evalActive[0].itemCount, 1);

  // Precedence 6: Calm (0 items)
  const calmSrc = { id: 's6', name: 'Calm', enabled: true, lastUpdated: '2026-10-24T11:55:00Z' };
  const evalCalm = evaluateSourceCoverage([calmSrc], [], { now, isOfflineSnapshot: false });
  assert.equal(evalCalm[0].status, COVERAGE_STATES.SIKERES_URES);
  assert.equal(evalCalm[0].itemCount, 0);
});

test('9. Date normalization and Coordinate guard', () => {
  // Date only does not become midnight
  const dOnly = normalizeEventDate('2026-10-24');
  assert.equal(dOnly.dateOnly, true);
  assert.equal(dOnly.iso, null);
  assert.equal(dOnly.timestamp, null);

  // Sanitized coordinates
  assert.equal(sanitizeCoordinates(null), null);
  assert.equal(sanitizeCoordinates({ lat: 95, lon: 21 }), null);
  const valid = sanitizeCoordinates({ lat: 47.1658, lon: 21.3650, isEventLocation: false });
  assert.equal(valid.lat, 47.1658);
  assert.equal(valid.lon, 21.3650);
});

test('10. Briefing citation reference validation contract', () => {
  assert.deepEqual(BRIEFING_RECORD_FIELDS, ['id', 'n', 'title']);
  assert.equal(isValidBriefingRef({ n: 1, id: 'event-0123456789abcdef0123456789abcdef', title: 'Riasztás' }), true);
  assert.equal(isValidBriefingRef({ n: 0, id: 'event-0123456789abcdef0123456789abcdef', title: 'Riasztás' }), false);
  assert.equal(isValidBriefingRef({ n: 1, id: 'bad-id', title: 'Riasztás' }), false);
});
