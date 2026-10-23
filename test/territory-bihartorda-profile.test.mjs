import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TERRITORY_NAMESPACES,
  RELATIONSHIP_TYPES,
  BOUNDARY_STATUS,
  BIHARTORDA_PROFILE,
  KEY_CONNECTIONS,
  PUSPOKLADANY_DISTRICT_SETTLEMENTS,
  SUGGESTED_NEARBY_SETTLEMENTS,
  createTerritoryConfig,
  DEFAULT_TERRITORY_CONFIG,
  matchTerritory
} from '../lib/intelligence/territory.mjs';

/**
 * Független, ellenőrzött KSH TSZJ 2025 alapadatok (Ground Truth).
 * Forrás: https://www.ksh.hu/docs/osztalyozasok/teruleti_szamjel/teruleti_szamjelrendszer_struktura_elemei_2025_megnevezesekkel.xlsx
 * Nem a termékkód önmagával való összevetése, hanem külsőleg hitelesített adatok.
 */
const VERIFIED_KSH_BASELINE = Object.freeze({
  // Püspökladányi járás (102) mind a 12 települése:
  '29887': { name: 'Bihartorda', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Község' },
  '10162': { name: 'Püspökladány', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Város' },
  '26693': { name: 'Báránd', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Község' },
  '25256': { name: 'Bihardancsháza', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Község' },
  '24828': { name: 'Biharnagybajom', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Község' },
  '03258': { name: 'Földes', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Nagyközség' },
  '02307': { name: 'Kaba', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Város' },
  '06309': { name: 'Nagyrábé', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Nagyközség' },
  '26116': { name: 'Sáp', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Község' },
  '23940': { name: 'Sárrétudvari', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Nagyközség' },
  '33437': { name: 'Szerep', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Község' },
  '19691': { name: 'Tetétlen', district: '102', districtName: 'Püspökladányi járás', county: '09', legalStatus: 'Község' },
  // Kiemelt városok és környező figyelési jelöltek:
  '05175': { name: 'Hajdúszoboszló', district: '100', districtName: 'Hajdúszoboszlói járás', county: '09', legalStatus: 'Város' },
  '15130': { name: 'Debrecen', district: '095', districtName: 'Debreceni járás', county: '09', legalStatus: 'Megyei jogú város' },
  '15167': { name: 'Bakonszeg', district: '094', districtName: 'Berettyóújfalui járás', county: '09', legalStatus: 'Község' }
});

// ─── 1. KSH TSZJ 2025 Kódformátum és Vezető Nullák Megőrzése (Requirement 7.1) ───

test('KSH settlement and district IDs: string types and preserved leading zeroes', () => {
  // A. Településkódok 5 jegyű stringek vezető nullákkal:
  const foldes = PUSPOKLADANY_DISTRICT_SETTLEMENTS.find(s => s.id === 'foldes');
  assert.equal(typeof foldes.kshSettlement, 'string');
  assert.equal(foldes.kshSettlement, '03258', 'Leading zero preserved for Földes');
  assert.equal(foldes.kshSettlement.length, 5);

  const kaba = PUSPOKLADANY_DISTRICT_SETTLEMENTS.find(s => s.id === 'kaba');
  assert.equal(kaba.kshSettlement, '02307', 'Leading zero preserved for Kaba');

  const nagyrabe = PUSPOKLADANY_DISTRICT_SETTLEMENTS.find(s => s.id === 'nagyrabe');
  assert.equal(nagyrabe.kshSettlement, '06309', 'Leading zero preserved for Nagyrábé');

  const hajduszoboszlo = KEY_CONNECTIONS.find(c => c.id === 'hajduszoboszlo');
  assert.equal(hajduszoboszlo.kshSettlement, '05175', 'Leading zero preserved for Hajdúszoboszló');

  // B. Járáskódok 3 jegyű stringek vezető nullákkal:
  const debrecen = KEY_CONNECTIONS.find(c => c.id === 'debrecen');
  assert.equal(typeof debrecen.kshDistrict, 'string');
  assert.equal(debrecen.kshDistrict, '095', 'Leading zero preserved for Debreceni járás (095)');
  assert.equal(debrecen.kshDistrict.length, 3);

  const bakonszeg = SUGGESTED_NEARBY_SETTLEMENTS.find(s => s.id === 'bakonszeg');
  assert.equal(bakonszeg.kshDistrict, '094', 'Leading zero preserved for Berettyóújfalui járás (094)');

  // C. Vármegye kód 2 jegyű string vezető nullával:
  assert.equal(BIHARTORDA_PROFILE.countyCode, '09');
  assert.equal(BIHARTORDA_PROFILE.county.id, '09');
});

// ─── 2. Külön Települési, Járási és Vármegyei Névterek (Requirement 7.2) ───

test('Explicit separate namespaces for settlement, district, county, and NUTS regions', () => {
  assert.equal(TERRITORY_NAMESPACES.KSH_SETTLEMENT, 'ksh_settlement_id');
  assert.equal(TERRITORY_NAMESPACES.KSH_DISTRICT, 'ksh_district_id');
  assert.equal(TERRITORY_NAMESPACES.KSH_COUNTY, 'ksh_county_id');
  assert.equal(TERRITORY_NAMESPACES.NUTS3, 'NUTS3');
  assert.equal(TERRITORY_NAMESPACES.NUTS2, 'NUTS2');

  // Településazonosító és járásazonosító szigorúan nem keverhető:
  assert.notEqual(TERRITORY_NAMESPACES.KSH_SETTLEMENT, TERRITORY_NAMESPACES.KSH_DISTRICT);
  assert.notEqual(BIHARTORDA_PROFILE.kshSettlement, BIHARTORDA_PROFILE.kshDistrict);
  assert.equal(BIHARTORDA_PROFILE.kshSettlement, '29887');
  assert.equal(BIHARTORDA_PROFILE.kshDistrict, '102');
});

// ─── 3. Településkatalógus Egyedisége és Duplikációmentessége (Requirement 7.3) ───

test('No duplicate settlement IDs or KSH codes across the catalog', () => {
  const allSettlements = [
    ...PUSPOKLADANY_DISTRICT_SETTLEMENTS,
    ...KEY_CONNECTIONS.filter(c => !PUSPOKLADANY_DISTRICT_SETTLEMENTS.some(p => p.id === c.id)),
    ...SUGGESTED_NEARBY_SETTLEMENTS.filter(s => !PUSPOKLADANY_DISTRICT_SETTLEMENTS.some(p => p.id === s.id))
  ];

  const seenIds = new Set();
  const seenKsh = new Set();
  for (const s of allSettlements) {
    assert.ok(!seenIds.has(s.id), `Duplicate internal slug: ${s.id}`);
    assert.ok(!seenKsh.has(s.kshSettlement), `Duplicate KSH settlement code: ${s.kshSettlement}`);
    seenIds.add(s.id);
    seenKsh.add(s.kshSettlement);
  }
  assert.equal(seenIds.size, 15, 'Total 15 unique settlements across district, key connections, and nearby watch list');
});

// ─── 4. Püspökladányi Járás 12 Településének Ellenőrzése KSH Alapadattal (Requirement 4 & 7) ───

test('Complete 12-settlement Püspökladány district catalog verified against KSH TSZJ 2025 ground truth', () => {
  assert.equal(PUSPOKLADANY_DISTRICT_SETTLEMENTS.length, 12, 'Püspökladányi járás consists of exactly 12 settlements');

  for (const item of PUSPOKLADANY_DISTRICT_SETTLEMENTS) {
    const verified = VERIFIED_KSH_BASELINE[item.kshSettlement];
    assert.ok(verified, `Settlement ${item.name} (${item.kshSettlement}) exists in verified baseline`);
    assert.equal(item.name, verified.name);
    assert.equal(item.kshDistrict, verified.district);
    assert.equal(item.districtName, verified.districtName);
    assert.equal(item.countyCode, verified.county);
    assert.equal(item.legalStatus, verified.legalStatus);
    assert.equal(item.source, 'KSH TSZJ 2025');
    assert.equal(item.verifiedDate, '2026-10-22');
  }
});

// ─── 5. Bihartorda és a Három Kiemelt Város Helyes Hierarchiája (Requirement 7.4 & 7.5) ───

test('Bihartorda and the three key connection cities official administrative hierarchy', () => {
  // A. Bihartorda hierarchia:
  assert.equal(BIHARTORDA_PROFILE.name, 'Bihartorda');
  assert.equal(BIHARTORDA_PROFILE.kshSettlement, '29887');
  assert.equal(BIHARTORDA_PROFILE.kshDistrict, '102');
  assert.equal(BIHARTORDA_PROFILE.districtName, 'Püspökladányi járás');
  assert.equal(BIHARTORDA_PROFILE.county.id, '09');
  assert.equal(BIHARTORDA_PROFILE.county.name, 'Hajdú-Bihar');
  assert.equal(BIHARTORDA_PROFILE.nuts.nuts3, 'HU321');
  assert.equal(BIHARTORDA_PROFILE.nuts.nuts2, 'HU32');
  assert.equal(BIHARTORDA_PROFILE.nuts.nuts1, 'HU3');
  assert.equal(BIHARTORDA_PROFILE.nuts.nuts0, 'HU');

  // B. Püspökladány:
  const pkladany = KEY_CONNECTIONS.find(c => c.id === 'puspokladany');
  assert.equal(pkladany.kshSettlement, '10162');
  assert.equal(pkladany.kshDistrict, '102');
  assert.equal(pkladany.districtName, 'Püspökladányi járás');

  // C. Hajdúszoboszló:
  const hszoboszlo = KEY_CONNECTIONS.find(c => c.id === 'hajduszoboszlo');
  assert.equal(hszoboszlo.kshSettlement, '05175');
  assert.equal(hszoboszlo.kshDistrict, '100');
  assert.equal(hszoboszlo.districtName, 'Hajdúszoboszlói járás');

  // D. Debrecen:
  const debrecen = KEY_CONNECTIONS.find(c => c.id === 'debrecen');
  assert.equal(debrecen.kshSettlement, '15130');
  assert.equal(debrecen.kshDistrict, '095');
  assert.equal(debrecen.districtName, 'Debreceni járás');
});

// ─── 6. Közigazgatási Kapcsolat vs. Földrajzi Szomszédság Elkülönítése (Requirement 3 & 7.7) ───

test('Administrative proximity does NOT automatically imply verified geographic boundary adjacency', () => {
  // A javasolt figyelési lista elemei nem tekinthetők automatikusan igazolt térképi szomszédnak:
  for (const s of SUGGESTED_NEARBY_SETTLEMENTS) {
    assert.equal(s.relationshipType, RELATIONSHIP_TYPES.WATCHED_SETTLEMENT);
    assert.equal(s.boundaryStatus, BOUNDARY_STATUS.UNVERIFIED,
      `${s.name} is a suggested watch candidate, boundary adjacency is unverified without polygon data`);
  }

  // Bakonszeg másik járásba tartozik (094), mégis a javasolt figyelési lista része:
  const bakonszeg = SUGGESTED_NEARBY_SETTLEMENTS.find(s => s.id === 'bakonszeg');
  assert.equal(bakonszeg.kshDistrict, '094');
  assert.equal(bakonszeg.districtName, 'Berettyóújfalui járás');
  assert.equal(bakonszeg.boundaryStatus, BOUNDARY_STATUS.UNVERIFIED);

  // Illesztésnél a boundaryStatus és isDirectGeographicNeighbor explicit jelzi a szétválasztást:
  const res = matchTerritory([{ valueName: 'ksh_settlement_id', value: '06309' }], 'Nagyrábé');
  assert.equal(res.matchState, 'match');
  assert.equal(res.status, 'in_watched_settlement');
  assert.equal(res.isDirectGeographicNeighbor, false, 'Watched candidate does NOT claim verified direct neighbor status');
  assert.equal(res.boundaryStatus, BOUNDARY_STATUS.UNVERIFIED);
});

// ─── 7. Több Figyelt Település Esetén is Egy Eseményrekord Marad (Requirement 7.6) ───

test('Multiple watched settlements in a single text event preserve single event record identity', () => {
  // Egy olyan esemény, amely szövegesen több figyelt települést is említ:
  const textMulti = 'Viharos szél és fakidőlések Nagyrábé és Bihardancsháza térségében';
  const res = matchTerritory([], textMulti);

  assert.equal(res.matchState, 'match');
  assert.equal(res.status, 'in_watched_settlement');
  assert.ok(Array.isArray(res.matchedSettlements));
  assert.equal(res.matchedSettlements.length, 2);
  assert.equal(res.matchedSettlements[0].name, 'Nagyrábé');
  assert.equal(res.matchedSettlements[1].name, 'Bihardancsháza');

  // Egyetlen strukturált objektum keletkezik, nem többszöröződik meg az eseményrekord:
  assert.equal(typeof res, 'object');
  assert.ok(!Array.isArray(res));
  assert.equal(res.isConfirmedLocal, false, 'Text mention is unconfirmed local reviewable match');
  assert.equal(res.localRelevanceReason, 'text_mention');
  assert.equal(res.needsLocalReview, true);
  assert.equal(res.recordRetained, true);
});

// ─── 8. Konfigurálható Figyelési Profil Működése (Requirement 6) ───

test('Territorial profile is configurable without hardcoding or retrospective cascades', () => {
  // A. Alapértelmezett konfiguráció:
  assert.equal(DEFAULT_TERRITORY_CONFIG.primary.name, 'Bihartorda');
  assert.equal(DEFAULT_TERRITORY_CONFIG.watchedSettlements.length, 5);
  assert.equal(DEFAULT_TERRITORY_CONFIG.includeFullDistrict, false);

  // B. Testreszabott profil: csak Bihartorda és Sáp figyelése:
  const customConfig = createTerritoryConfig({
    watchedSettlements: [PUSPOKLADANY_DISTRICT_SETTLEMENTS.find(s => s.id === 'sap')]
  });
  assert.equal(customConfig.watchedSettlements.length, 1);
  assert.equal(customConfig.watchedSettlements[0].name, 'Sáp');

  // Sáp illeszkedik a testreszabott profillal:
  const matchSap = matchTerritory([], 'Sáp község belterülete', customConfig);
  assert.equal(matchSap.matchState, 'match');
  assert.equal(matchSap.territoryName, 'Sáp');

  // Nagyrábé nem része a szűkített profilnak, így nem illeszkedik helyiként (resolved identity, out of watch scope):
  const matchNagyrabe = matchTerritory([{ valueName: 'ksh_settlement_id', value: '06309' }], 'Nagyrábé', customConfig);
  assert.equal(matchNagyrabe.matchState, 'no_match', 'Nagyrábé is no_match when excluded from custom watched settlements');
  assert.equal(matchNagyrabe.watchScope, 'out');
  assert.equal(matchNagyrabe.inScope, false);

  // C. Teljes járási nézet bekapcsolása (includeFullDistrict: true):
  const districtFullConfig = createTerritoryConfig({
    includeFullDistrict: true
  });
  assert.equal(districtFullConfig.includeFullDistrict, true);
  assert.equal(districtFullConfig.districtSettlements.length, 12);

  // Szerep (nem része a suggested 5-ös listának, de járási település):
  const matchSzerep = matchTerritory([{ valueName: 'ksh_settlement_id', value: '33437' }], 'Szerep', districtFullConfig);
  assert.equal(matchSzerep.matchState, 'match');
  assert.equal(matchSzerep.status, 'in_watched_district');
  assert.equal(matchSzerep.matchedRule, 'district_settlement');
  assert.equal(matchSzerep.territoryName, 'Szerep');
});

// ─── 9. Ismeretlen Kód és Terület Kezelése (Requirement 7.8) ───

test('Unrecognized geocodes remain unknown, retain record, and forbid local alerting', () => {
  const res = matchTerritory([{ valueName: 'UNKNOWN_GEO', value: '99999' }], 'Ismeretlen terület');
  assert.equal(res.matchState, 'unknown');
  assert.equal(res.status, 'indeterminate');
  assert.equal(res.recordRetained, true, 'Record is retained for review');
  assert.equal(res.isConfirmedLocal, false, 'Unrecognized territory is NOT confirmed local');
  assert.equal(res.needsLocalReview, true, 'Needs operator review');
  assert.equal(res.alertEligibleLocal, false, 'NO local alert emitted');
  assert.equal(res.alertEligibleNational, true, 'National record eligibility preserved');
});
