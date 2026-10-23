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

// ─── 7. Kiemelt városi kapcsolatok és felismerési katalógus szétválasztása ───

test('Test 7: Key connection recognition catalog is decoupled from active watch profile', () => {
  // A. Az alapértelmezett három kiemelt város (Debrecen, Hajdúszoboszló, Püspökladány) változatlanul figyelt:
  const defaultKeyCities = ['Debrecen', 'Hajdúszoboszló', 'Püspökladány'];
  for (const cityName of defaultKeyCities) {
    const resolved = resolveSettlement(cityName, 'Hajdú-Bihar');
    assert.equal(resolved.identityStatus, IDENTITY_STATUSES.RESOLVED);
    assert.equal(resolved.watchScope, WATCH_SCOPES.IN);
    assert.equal(resolved.matchState, 'match');
    assert.equal(resolved.relationshipType, RELATIONSHIP_TYPES.KEY_CONNECTION);
    assert.equal(resolved.relevanceLabel, 'kiemelt városi kapcsolat');
  }

  // B. Berettyóújfalu feloldható, de alapértelmezésben NEM válik figyeltté pusztán a katalóguscímkéje miatt:
  const berettyoDefault = resolveSettlement('Berettyóújfalu', 'Hajdú-Bihar');
  assert.equal(berettyoDefault.identityStatus, IDENTITY_STATUSES.RESOLVED, 'Berettyóújfalu identity is resolved from catalog');
  assert.equal(berettyoDefault.watchScope, WATCH_SCOPES.OUT, 'Default watchScope is OUT without explicit configuration');
  assert.equal(berettyoDefault.matchState, 'no_match', 'matchState is strictly no_match');
  assert.equal(berettyoDefault.inScope, false, 'inScope is strictly false');
  assert.equal(berettyoDefault.relevanceLabel, 'nem figyelt kiemelt kapcsolat');

  // C. Explicit keyCities/keyConnections konfigurációval figyeltté válik:
  const configWithBerettyo = createTerritoryConfig({
    keyCities: [...KEY_CONNECTIONS, BERETTYOUJFALU_PROFILE]
  });
  const berettyoExplicit = resolveSettlement('Berettyóújfalu', 'Hajdú-Bihar', { territoryConfig: configWithBerettyo });
  assert.equal(berettyoExplicit.identityStatus, IDENTITY_STATUSES.RESOLVED);
  assert.equal(berettyoExplicit.watchScope, WATCH_SCOPES.IN, 'watchScope is IN when explicitly configured in keyCities');
  assert.equal(berettyoExplicit.matchState, 'match');
  assert.equal(berettyoExplicit.inScope, true);
  assert.equal(berettyoExplicit.relevanceLabel, 'kiemelt városi kapcsolat');

  // D. A konfigurációból eltávolítva ismét elveszíti a figyelési hatókört:
  const configWithoutBerettyo = createTerritoryConfig({
    keyCities: KEY_CONNECTIONS
  });
  const berettyoRemoved = resolveSettlement('Berettyóújfalu', 'Hajdú-Bihar', { territoryConfig: configWithoutBerettyo });
  assert.equal(berettyoRemoved.watchScope, WATCH_SCOPES.OUT);
  assert.equal(berettyoRemoved.matchState, 'no_match');
  assert.equal(berettyoRemoved.inScope, false);

  // E. Bakonszeg egyedi figyelése megmarad, de a 094-es járás egésze nem válik figyeltté:
  const bakonszeg = resolveSettlement('Bakonszeg', 'Hajdú-Bihar');
  assert.equal(bakonszeg.watchScope, WATCH_SCOPES.IN, 'Bakonszeg remains watched via suggestedNearbySettlements');
  assert.equal(bakonszeg.kshDistrictCode, '094');
  assert.ok(!DEFAULT_TERRITORY_CONFIG.watchedDistricts.includes('094'), 'District 094 is NOT in watchedDistricts');

  // F. Egy másik, nem konfigurált 094-es járási település (pl. Furta) nem válik automatikusan figyeltté:
  const furta = resolveSettlement('Furta', 'Hajdú-Bihar');
  assert.notEqual(furta.watchScope, WATCH_SCOPES.IN, 'Unconfigured 094 settlement does not become watched');
  assert.equal(furta.inScope, false);
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

// ─── 10. Rekordintegritás és több település említésének kezelése ───
// Figyelem: A többnézetes aggregáció és nézetspecifikus számláló ellenőrzése
// a 2. csomagban (UI és aggregációs réteg) ellenőrizendő nyitott követelmény.

test('Test 10: Rekordintegritás és több település említésének kezelése', () => {
  const textMulti = 'Viharos szél és fakidőlések Nagyrábé és Bihardancsháza térségében';
  const res = matchTerritory([], textMulti);
  
  assert.equal(typeof res, 'object');
  assert.ok(!Array.isArray(res), 'Single event result, not cloned into multiple arrays');
  assert.equal(res.recordRetained, true);
  assert.equal(res.matchedSettlements.length, 2);
  assert.equal(res.settlementId, 'nagyrabe', 'Primary matched settlement preserved');
});
