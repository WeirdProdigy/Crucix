import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TERRITORY_NAMESPACES,
  RELATIONSHIP_TYPES,
  BOUNDARY_STATUS,
  LOCAL_RELEVANCE_REASONS,
  IDENTITY_STATUSES,
  WATCH_SCOPES,
  ADMINISTRATIVE_LEVELS,
  deriveMatchState,
  BIHARTORDA_PROFILE,
  BERETTYOUJFALU_PROFILE,
  KEY_CONNECTIONS,
  PUSPOKLADANY_DISTRICT_SETTLEMENTS,
  SUGGESTED_NEARBY_SETTLEMENTS,
  createTerritoryConfig,
  DEFAULT_TERRITORY_CONFIG,
  matchTerritory,
  resolveSettlement
} from '../lib/intelligence/territory.mjs';
import { checkFreshnessPolicy } from '../apis/sources/meteoalarm.mjs';

// ─── 1. Negatív regressziós teszt: Bihartorda puszta szöveges említése ───

test('Test 1: Bihartorda text mention only sets text_mention, needsLocalReview, and isConfirmedLocal: false', () => {
  const res = matchTerritory([], 'Bihartorda lakossága figyelembe veszi az előrejelzést');
  
  assert.equal(res.localRelevanceReason, LOCAL_RELEVANCE_REASONS.TEXT_MENTION);
  assert.equal(res.identityStatus, IDENTITY_STATUSES.RESOLVED);
  assert.equal(res.watchScope, WATCH_SCOPES.IN);
  assert.equal(res.matchState, 'match');
  assert.equal(res.inScope, true, 'inScope must be strictly boolean true');
  assert.equal(typeof res.inScope, 'boolean');
  
  // Szigorú negatív regresszió: puszta szöveges említés NEM lehet megerősített helyi találat!
  assert.equal(res.isConfirmedLocal, false, 'Pure text mention is NEVER a confirmed local match');
  assert.equal(res.needsLocalReview, true, 'Text mention flags needsLocalReview');
  assert.equal(res.relevanceLabel, 'ellenőrizendő helyi vonatkozás');
  assert.equal(res.territoryLevel, ADMINISTRATIVE_LEVELS.SETTLEMENT);
});

// ─── 2. Hivatalos területi kijelölés (Bihartorda hivatalos geokód) ───

test('Test 2: Bihartorda official area assignment sets official_area_assignment and isConfirmedLocal: true', () => {
  const res = matchTerritory([{ valueName: 'ksh_settlement_id', value: '29887' }], 'Bihartorda');
  
  assert.equal(res.localRelevanceReason, LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT);
  assert.equal(res.identityStatus, IDENTITY_STATUSES.RESOLVED);
  assert.equal(res.watchScope, WATCH_SCOPES.IN);
  assert.equal(res.matchState, 'match');
  assert.equal(res.inScope, true);
  assert.equal(res.isConfirmedLocal, true, 'Official area assignment is a confirmed local match');
  assert.equal(res.needsLocalReview, false);
  assert.equal(res.relevanceLabel, 'megerősített helyi találat');
  assert.equal(res.territoryLevel, ADMINISTRATIVE_LEVELS.SETTLEMENT);
});

// ─── 3. Azonosított, de nem figyelt település (Resolved unwatched settlement) ───

test('Test 3: Resolved unwatched settlement produces resolved identity, out watchScope, and no_match', () => {
  // Szerep a Püspökladányi járás része, de alapértelmezetten nincs a figyelt listán (includeFullDistrict: false)
  const resolved = resolveSettlement('Szerep', 'Hajdú-Bihar');
  
  assert.equal(resolved.identityStatus, IDENTITY_STATUSES.RESOLVED);
  assert.equal(resolved.watchScope, WATCH_SCOPES.OUT);
  assert.equal(resolved.matchState, 'no_match');
  assert.equal(resolved.inScope, false, 'inScope is strictly boolean false');
  assert.equal(typeof resolved.inScope, 'boolean');
  assert.equal(resolved.isConfirmedLocal, false);
  assert.equal(resolved.relevanceLabel, 'nem figyelt település');
  assert.equal(resolved.settlementName, 'Szerep');
  assert.equal(resolved.kshSettlementCode, '33437');
});

// ─── 4. Tisztázatlan vagy katalóguson kívüli identitás (Ambiguous / Unresolved) ───

test('Test 4: Ambiguous or unresolved settlement identity produces unknown matchState and false inScope', () => {
  // A. Vármegyei eltérés miatti többértelműség (Bihartorda Borsod-Abaúj-Zemplén megjelöléssel)
  const ambiguous = resolveSettlement('Bihartorda', 'Borsod-Abaúj-Zemplén');
  assert.equal(ambiguous.identityStatus, IDENTITY_STATUSES.AMBIGUOUS);
  assert.equal(ambiguous.watchScope, WATCH_SCOPES.UNKNOWN);
  assert.equal(ambiguous.matchState, 'unknown');
  assert.equal(ambiguous.inScope, false);
  assert.equal(ambiguous.isConfirmedLocal, false);
  assert.equal(ambiguous.needsLocalReview, true);
  assert.equal(ambiguous.dataQualityFlag, 'ambiguous_identity_county_mismatch');

  // B. Katalóguson kívüli település
  const outside = resolveSettlement('Szentpéterszeg', 'Borsod-Abaúj-Zemplén');
  assert.equal(outside.identityStatus, IDENTITY_STATUSES.UNRESOLVED);
  assert.equal(outside.watchScope, WATCH_SCOPES.UNKNOWN);
  assert.equal(outside.matchState, 'unknown');
  assert.equal(outside.inScope, false);
  assert.equal(outside.isConfirmedLocal, false);

  // C. Hiányzó településnév
  const missing = resolveSettlement('', 'Hajdú-Bihar');
  assert.equal(missing.identityStatus, IDENTITY_STATUSES.UNRESOLVED);
  assert.equal(missing.watchScope, WATCH_SCOPES.UNKNOWN);
  assert.equal(missing.matchState, 'unknown');
  assert.equal(missing.inScope, false);
  assert.equal(missing.isConfirmedLocal, false);
});

// ─── 5. Konfigurálható profil: includeFullDistrict be- és kikapcsolása ───

test('Test 5: Configurable profile correctly switches watchScope for non-watched district settlements', () => {
  // A. includeFullDistrict: false (alapértelmezett) -> Szerep kívül esik (watchScope: 'out')
  const configStrict = createTerritoryConfig({ includeFullDistrict: false });
  const resStrict = matchTerritory([{ valueName: 'ksh_settlement_id', value: '33437' }], 'Szerep', configStrict);
  assert.equal(resStrict.identityStatus, IDENTITY_STATUSES.RESOLVED);
  assert.equal(resStrict.watchScope, WATCH_SCOPES.OUT);
  assert.equal(resStrict.matchState, 'no_match');
  assert.equal(resStrict.inScope, false);
  assert.equal(resStrict.isConfirmedLocal, false);

  // B. includeFullDistrict: true -> Szerep bekerül a hatókörbe (watchScope: 'in')
  const configFull = createTerritoryConfig({ includeFullDistrict: true });
  const resFull = matchTerritory([{ valueName: 'ksh_settlement_id', value: '33437' }], 'Szerep', configFull);
  assert.equal(resFull.identityStatus, IDENTITY_STATUSES.RESOLVED);
  assert.equal(resFull.watchScope, WATCH_SCOPES.IN);
  assert.equal(resFull.matchState, 'match');
  assert.equal(resFull.inScope, true);
  assert.equal(resFull.isConfirmedLocal, true);
  assert.equal(resFull.territoryLevel, ADMINISTRATIVE_LEVELS.SETTLEMENT);
});

// ─── 6. Bakonszeg a Berettyóújfalui járáshoz (094) tartozik, nem a Püspökladányihoz (102) ───

test('Test 6: Bakonszeg is in watchScope but belongs to Berettyóújfalui járás (094), not Püspökladány (102)', () => {
  const resolved = resolveSettlement('Bakonszeg', 'Hajdú-Bihar');
  
  assert.equal(resolved.identityStatus, IDENTITY_STATUSES.RESOLVED);
  assert.equal(resolved.watchScope, WATCH_SCOPES.IN);
  assert.equal(resolved.matchState, 'match');
  assert.equal(resolved.inScope, true);
  assert.equal(resolved.kshDistrictCode, '094', 'Bakonszeg district code is 094');
  assert.equal(resolved.districtName, 'Berettyóújfalui járás');
  assert.notEqual(resolved.kshDistrictCode, '102', 'Bakonszeg is NOT in Püspökladány district');
  assert.equal(resolved.boundaryStatus, BOUNDARY_STATUS.UNVERIFIED);
});

// ─── 7. Kiemelt városi kapcsolatok külön címkézése ───

test('Test 7: Key connection cities (Debrecen, Hajdúszoboszló, Berettyóújfalu) receive key_connection tag', () => {
  const cities = ['Debrecen', 'Hajdúszoboszló', 'Berettyóújfalu'];
  for (const cityName of cities) {
    const resolved = resolveSettlement(cityName, 'Hajdú-Bihar');
    assert.equal(resolved.identityStatus, IDENTITY_STATUSES.RESOLVED);
    assert.equal(resolved.watchScope, WATCH_SCOPES.IN);
    assert.equal(resolved.matchState, 'match');
    assert.equal(resolved.relationshipType, RELATIONSHIP_TYPES.KEY_CONNECTION);
    assert.equal(resolved.relevanceLabel, 'kiemelt városi kapcsolat');
  }
});

// ─── 8. Közigazgatási hierarchiaszintek (territoryLevel) szigorú megőrzése ───

test('Test 8: County and Regional warnings retain territoryLevel and NEVER leak to settlement level', () => {
  // A. Vármegyei szint (Hajdú-Bihar: NUTS3 HU321)
  const countyRes = matchTerritory([{ valueName: 'NUTS3', value: 'HU321' }], 'Hajdú-Bihar vármegye');
  assert.equal(countyRes.territoryLevel, ADMINISTRATIVE_LEVELS.COUNTY);
  assert.notEqual(countyRes.territoryLevel, ADMINISTRATIVE_LEVELS.SETTLEMENT);
  assert.equal(countyRes.localRelevanceReason, LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY);
  assert.equal(countyRes.isConfirmedLocal, false, 'County alert is source_region_only, NEVER confirmed local settlement');

  // B. Nagyrégiós szint (Észak-Alföld: NUTS2 HU32)
  const regionRes = matchTerritory([{ valueName: 'NUTS2', value: 'HU32' }], 'Észak-Alföld');
  assert.equal(regionRes.territoryLevel, ADMINISTRATIVE_LEVELS.REGION);
  assert.notEqual(regionRes.territoryLevel, ADMINISTRATIVE_LEVELS.SETTLEMENT);
  assert.equal(regionRes.localRelevanceReason, LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY);
  assert.equal(regionRes.isConfirmedLocal, false, 'Regional alert is source_region_only, NEVER confirmed local settlement');

  // C. Járási szint (Püspökladányi járás: ksh_district_id: 102)
  const districtRes = matchTerritory([{ valueName: 'ksh_district_id', value: '102' }], 'Püspökladányi járás');
  assert.equal(districtRes.territoryLevel, ADMINISTRATIVE_LEVELS.DISTRICT);
  assert.notEqual(districtRes.territoryLevel, ADMINISTRATIVE_LEVELS.SETTLEMENT);
  assert.equal(districtRes.localRelevanceReason, LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY);
  assert.equal(districtRes.isConfirmedLocal, false);
});

// ─── 9. Hiányzó lejárat és elévülés felirata nem állíthat szolgáltatói lejáratot ───

test('Test 9: Stale warning with missing expires never claims provider expiration', () => {
  const publishedAt = '2026-10-21T08:00:00Z';
  const now = Date.parse('2026-10-23T08:00:00Z'); // 48 órával később: helyi 24h limit letelt
  
  const policy = checkFreshnessPolicy({ validUntil: null, publishedAt, now });
  
  assert.equal(policy.hasExplicitExpires, false);
  assert.equal(policy.freshnessStatus, 'stale');
  assert.equal(policy.isFreshnessLimitExceeded, true);
  
  // A felirat NEM állíthatja, hogy a szolgáltató szerint járt le:
  assert.ok(!policy.validityLabel.includes('szolgáltató szerint lejárt'), 'Label must not claim provider expired the alert');
  assert.ok(!policy.validityLabel.includes('hivatalos lejárati idő letelt'), 'Label must not claim official expires elapsed when none was given');
  assert.equal(policy.validityLabel, 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.');
  assert.equal(policy.freshnessReason, 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.');
});

// ─── 10. Esemény-azonosság megőrzése több figyelt település esetén ───

test('Test 10: Event record identity and deduplication across views', () => {
  const textMulti = 'Viharos szél és fakidőlések Nagyrábé és Bihardancsháza térségében';
  const res = matchTerritory([], textMulti);
  
  assert.equal(typeof res, 'object');
  assert.ok(!Array.isArray(res), 'Single event result, not cloned into multiple arrays');
  assert.equal(res.recordRetained, true);
  assert.equal(res.matchedSettlements.length, 2);
  assert.equal(res.settlementId, 'nagyrabe', 'Primary matched settlement preserved');
});
