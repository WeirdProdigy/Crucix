import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseMeteoalarm,
  resolveWarningChains,
  determineLifecycleStatus,
  extractReferencedIds,
  parseCapReferences,
  evaluateWarningNotification
} from '../apis/sources/meteoalarm.mjs';
import {
  matchTerritory,
  BIHARTORDA_PROFILE,
  KEY_CONNECTIONS,
  DEFAULT_TERRITORY_CONFIG
} from '../lib/intelligence/territory.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { EntityStore, resolveEventCountries } from '../lib/intelligence/entities.mjs';
import { generateBriefing } from '../lib/llm/briefing.mjs';
import { eventLevel } from '../lib/alerts/levels.mjs';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');

// ─── 1. KSH TSZJ 2025 törzsadatok és OpenStreetMap koordináta-attribúció ───

test('Bihartorda and key connection official KSH TSZJ 2025 profile and OpenStreetMap attribution', () => {
  // 1. Bihartorda törzsadatai (KSH TSZJ 2025)
  assert.equal(BIHARTORDA_PROFILE.name, 'Bihartorda');
  assert.equal(BIHARTORDA_PROFILE.kshSettlement, '29887', 'KSH településkód: 29887');
  assert.equal(BIHARTORDA_PROFILE.kshDistrict, '102', 'KSH járáskód: 102 (Püspökladányi járás, string, nem LAU1)');
  assert.equal(BIHARTORDA_PROFILE.districtName, 'Püspökladányi járás');
  assert.equal(BIHARTORDA_PROFILE.countyCode, '09', 'KSH vármegyekód: 09');
  assert.equal(BIHARTORDA_PROFILE.countyName, 'Hajdú-Bihar');
  assert.equal(BIHARTORDA_PROFILE.nuts3, 'HU321', 'Eurostat NUTS3: HU321');
  assert.equal(BIHARTORDA_PROFILE.nuts2, 'HU32', 'Eurostat NUTS2: HU32 (Észak-Alföld)');
  assert.equal(BIHARTORDA_PROFILE.iso3, 'HUN');

  // Koordináták adatgazdája KIFEJEZETTEN OpenStreetMap / Nominatim, NEM KSH:
  assert.equal(BIHARTORDA_PROFILE.coordinates.source, 'OpenStreetMap/Nominatim');
  assert.equal(BIHARTORDA_PROFILE.coordinates.lat, 47.1658);
  assert.equal(BIHARTORDA_PROFILE.coordinates.lon, 21.3650);

  // 2. Kiemelt városi kapcsolatok (KSH TSZJ 2025 alapján megőrzött vezető nullákkal):
  const puspokladany = KEY_CONNECTIONS.find(c => c.name === 'Püspökladány');
  assert.ok(puspokladany);
  assert.equal(puspokladany.kshSettlement, '10162', 'Püspökladány KSH településkód: 10162');
  assert.equal(puspokladany.kshDistrict, '102', 'Püspökladányi járás kódja: 102');
  assert.equal(puspokladany.coordinates.source, 'OpenStreetMap/Nominatim');

  const szoboszlo = KEY_CONNECTIONS.find(c => c.name === 'Hajdúszoboszló');
  assert.ok(szoboszlo);
  assert.equal(szoboszlo.kshSettlement, '05175', 'Hajdúszoboszló KSH településkód: 05175 (megőrzött vezető nullával)');
  assert.equal(szoboszlo.kshDistrict, '100', 'Hajdúszoboszlói járás KSH kódja: 100');
  assert.equal(szoboszlo.coordinates.source, 'OpenStreetMap/Nominatim');

  const debrecen = KEY_CONNECTIONS.find(c => c.name === 'Debrecen');
  assert.ok(debrecen);
  assert.equal(debrecen.kshSettlement, '15130', 'Debrecen KSH településkód: 15130');
  assert.equal(debrecen.kshDistrict, '095', 'Debreceni járás KSH kódja: 095 (megőrzött vezető nullával)');
  assert.equal(debrecen.coordinates.source, 'OpenStreetMap/Nominatim');
});

// ─── 2. Háromállapotú területi illesztés és jogosultságok szétválasztása ───

test('Three-state territory matching: match / no_match / unknown and permission dimensions', () => {
  // A: Match (Hajdú-Bihar vármegye, NUTS3: HU321)
  const matchRes = matchTerritory([{ valueName: 'NUTS3', value: 'HU321' }], 'Hajdú-Bihar vármegye');
  assert.equal(matchRes.matchState, 'match');
  assert.equal(matchRes.inScope, true);
  assert.equal(matchRes.recordRetained, true);
  assert.equal(matchRes.isConfirmedLocal, true);
  assert.equal(matchRes.needsLocalReview, false);
  assert.equal(matchRes.alertEligibleLocal, true);

  // B: No-match (Nyugat-Dunántúl, NUTS2: HU22)
  const noMatchRes = matchTerritory([{ valueName: 'NUTS2', value: 'HU22' }], 'Nyugat-Dunántúl');
  assert.equal(noMatchRes.matchState, 'no_match');
  assert.equal(noMatchRes.inScope, false);
  assert.equal(noMatchRes.recordRetained, true, 'Outside record is preserved');
  assert.equal(noMatchRes.isConfirmedLocal, false);
  assert.equal(noMatchRes.needsLocalReview, false);
  assert.equal(noMatchRes.alertEligibleLocal, false);
  assert.equal(noMatchRes.alertEligibleNational, true, 'Available in national HUN scope');

  // C: Unknown / Indeterminate (nem igazolt geokód, pl. unverified custom code)
  const unknownRes = matchTerritory([{ valueName: 'CUSTOM_CODE', value: 'XYZ_UNKNOWN' }], 'Szektor 99');
  assert.equal(unknownRes.matchState, 'unknown');
  assert.equal(unknownRes.inScope, null, 'inScope is null for unknown, NOT true!');
  assert.equal(unknownRes.recordRetained, true, 'Record is retained without data loss');
  assert.equal(unknownRes.isConfirmedLocal, false, 'Never confirmed local');
  assert.equal(unknownRes.needsLocalReview, true, 'Flagged for local review');
  assert.equal(unknownRes.alertEligibleLocal, false, 'No unconfirmed local hazard alert triggered');

  // D: EMMA_ID provider code without official public crosswalk guarantee:
  // Must fall into unknown / review status, NOT a confirmed local match!
  const emmaRes = matchTerritory([{ valueName: 'EMMA_ID', value: 'EMMA_ID:HU006' }], 'Meteoalarm EMMA zone');
  assert.equal(emmaRes.matchState, 'unknown');
  assert.equal(emmaRes.isConfirmedLocal, false, 'Unverified EMMA_ID is not a confirmed local match');
  assert.equal(emmaRes.needsLocalReview, true);
});

// ─── 3. CAP-lánc több sweep és újraindítás között (Requirement 3) ───

test('CAP warning chain across multiple sweeps and application restarts (Alert -> Update -> Cancel)', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'crucix-meteo-chain-'));
  try {
    // ─── Sweep 1: Csak Alert érkezik ───
    const alert1Xml = readFileSync('test/fixtures/synthetic-meteoalarm-step1-alert.atom.xml', 'utf8');
    const parsed1 = parseMeteoalarm(alert1Xml, { country: 'hungary', now: Date.parse('2026-10-22T08:30:00+02:00'), includeAllLifecycles: true });
    assert.equal(parsed1.observations.length, 1);
    
    const V2_1 = await synthesize({
      crucix: { timestamp: new Date('2026-10-22T08:30:00+02:00').toISOString() },
      sources: { Meteoalarm: parsed1 }
    }, { now: Date.parse('2026-10-22T08:30:00+02:00') });
    
    const event1 = V2_1.events.find(e => e.providerId === 'HU.CHAIN.001');
    assert.ok(event1, 'Canonical event created for Alert 001');
    assert.equal(event1.msgType, 'Alert');
    assert.equal(event1.lifecycle, 'active');
    assert.equal(event1.chainKey, 'HU.CHAIN.001');

    // Mentés HistoryStore-ba (Sweep 1 lezárása)
    const history1 = new HistoryStore(tmpDir, { now: () => Date.parse('2026-10-22T08:30:00+02:00') });
    history1.add([event1]);

    // ─── Újraindítás: Új tárolópéldány a lemezről ───
    const history2 = new HistoryStore(tmpDir, { now: () => Date.parse('2026-10-22T10:30:00+02:00') });
    const loadedAlert1 = history2.get(event1.id);
    assert.ok(loadedAlert1, 'Alert 001 recovered from persistent storage');
    assert.equal(loadedAlert1.lifecycle, 'active');

    // ─── Sweep 2: Csak Update érkezik (Alert már nincs a feedben!) ───
    const update2Xml = readFileSync('test/fixtures/synthetic-meteoalarm-step2-update.atom.xml', 'utf8');
    const parsed2 = parseMeteoalarm(update2Xml, { country: 'hungary', now: Date.parse('2026-10-22T10:30:00+02:00'), includeAllLifecycles: true });
    assert.equal(parsed2.observations.length, 1);
    
    const V2_2 = await synthesize({
      crucix: { timestamp: new Date('2026-10-22T10:30:00+02:00').toISOString() },
      sources: { Meteoalarm: parsed2 }
    }, { now: Date.parse('2026-10-22T10:30:00+02:00') });

    const event2 = V2_2.events.find(e => e.providerId === 'HU.CHAIN.002');
    assert.ok(event2, 'Canonical event created for Update 002');
    assert.equal(event2.msgType, 'Update');

    // CAP sender,identifier,sent hármas kinyerése a hivatkozásból
    const capRefs = parseCapReferences(event2.references);
    assert.equal(capRefs.length, 1);
    assert.equal(capRefs[0].sender, 'meteoalarm@meteoalarm.org');
    assert.equal(capRefs[0].identifier, 'HU.CHAIN.001');
    assert.equal(capRefs[0].sent, '2026-10-22T08:00:00+02:00');

    // Lánc feloldása a perzisztens tároló bevonásával:
    resolveWarningChains([event2], { history: history2, now: Date.parse('2026-10-22T10:30:00+02:00') });

    // Ellenőrzések:
    assert.equal(event2.chainKey, 'HU.CHAIN.001', 'Update adopts root chainKey from persistent Alert');
    assert.equal(event2.lifecycle, 'active', 'Update is the new active state');
    
    // A korábbi aktív állapot nem maradt tévesen aktív a tárolóban:
    const supersededAlert = history2.get(event1.id);
    assert.equal(supersededAlert.lifecycle, 'superseded', 'Previous alert marked superseded in persistent history');
    assert.equal(supersededAlert.supersededBy, 'HU.CHAIN.002');

    // Mentés HistoryStore-ba (Sweep 2 lezárása)
    history2.add([event2]);

    // ─── Újabb újraindítás: Új tárolópéldány ───
    const history3 = new HistoryStore(tmpDir, { now: () => Date.parse('2026-10-22T14:15:00+02:00') });
    assert.equal(history3.get(event1.id)?.lifecycle, 'superseded');
    assert.equal(history3.get(event2.id)?.lifecycle, 'active');

    // ─── Sweep 3: Csak Cancel érkezik ───
    const cancel3Xml = readFileSync('test/fixtures/synthetic-meteoalarm-step3-cancel.atom.xml', 'utf8');
    const parsed3 = parseMeteoalarm(cancel3Xml, { country: 'hungary', now: Date.parse('2026-10-22T14:15:00+02:00'), includeAllLifecycles: true });
    
    const V2_3 = await synthesize({
      crucix: { timestamp: new Date('2026-10-22T14:15:00+02:00').toISOString() },
      sources: { Meteoalarm: parsed3 }
    }, { now: Date.parse('2026-10-22T14:15:00+02:00') });

    const event3 = V2_3.events.find(e => e.providerId === 'HU.CHAIN.003');
    assert.ok(event3, 'Canonical event created for Cancel 003');
    assert.equal(event3.msgType, 'Cancel');

    resolveWarningChains([event3], { history: history3, now: Date.parse('2026-10-22T14:15:00+02:00') });

    // Ellenőrzések:
    assert.equal(event3.chainKey, 'HU.CHAIN.001', 'Cancel links to root logical chainKey');
    const cancelledUpdate = history3.get(event2.id);
    assert.equal(cancelledUpdate.lifecycle, 'cancelled', 'Update 002 was marked cancelled in persistent storage');
    assert.equal(cancelledUpdate.cancelledBy, 'HU.CHAIN.003');

    // Mindhárom történeti üzenet megmaradt:
    history3.add([event3]);
    assert.ok(history3.get(event1.id), 'Alert 001 retained');
    assert.ok(history3.get(event2.id), 'Update 002 retained');
    assert.ok(history3.get(event3.id), 'Cancel 003 retained');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── 4. Értesítési útvonal bizonyítása mock kimeneten (Requirement 4) ───

test('Notification decision evaluation: mock alerting paths for all 8 required cases', () => {
  const baseAlert = {
    title: 'Yellow wind warning for Észak-Alföld',
    providerId: 'HU.CHAIN.001',
    chainKey: 'HU.CHAIN.001',
    msgType: 'Alert',
    status: 'Actual',
    scope: 'Public',
    severity: 'Moderate',
    awarenessLevel: '2; yellow; Moderate',
    area: 'Észak-Alföld (Northern Great Plain)',
    lifecycle: 'active',
    territory: { matchState: 'match', isConfirmedLocal: true, inScope: true }
  };

  // 1. Initial alert
  const eval1 = evaluateWarningNotification(baseAlert);
  assert.equal(eval1.eligible, true);
  assert.equal(eval1.action, 'initial_alert');
  assert.equal(eval1.alertType, 'new_danger');

  // 2. Változatlan riasztás a következő sweepben: nincs ismételt riasztás!
  const evalUnchanged = evaluateWarningNotification(baseAlert, { previousWarning: baseAlert });
  assert.equal(evalUnchanged.eligible, false);
  assert.equal(evalUnchanged.action, 'suppress_duplicate');

  // 3. Új azonosítójú, de érdemben változatlan Update: nincs új első riasztás!
  const reissuedUpdate = {
    ...baseAlert,
    providerId: 'HU.CHAIN.001B',
    msgType: 'Update'
  };
  const evalReissue = evaluateWarningNotification(reissuedUpdate, { previousWarning: baseAlert });
  assert.equal(evalReissue.eligible, false);
  assert.equal(evalReissue.action, 'suppress_duplicate', 'No duplicate initial alert emitted');

  // 4. Lényeges változás (súlyosság Severe-re nőtt): megfelelő frissítési értesítés!
  const escalatedUpdate = {
    ...baseAlert,
    providerId: 'HU.CHAIN.002',
    msgType: 'Update',
    severity: 'Severe',
    awarenessLevel: '3; orange; Severe'
  };
  const evalEscalation = evaluateWarningNotification(escalatedUpdate, { previousWarning: baseAlert });
  assert.equal(evalEscalation.eligible, true);
  assert.equal(evalEscalation.action, 'update');
  assert.equal(evalEscalation.alertType, 'revision');

  // 5. Cancel üzenet: visszavonás, NEM új veszély!
  const cancelMsg = {
    ...baseAlert,
    providerId: 'HU.CHAIN.003',
    msgType: 'Cancel',
    lifecycle: 'cancelled'
  };
  const evalCancel = evaluateWarningNotification(cancelMsg, { previousWarning: escalatedUpdate });
  assert.equal(evalCancel.eligible, true);
  assert.equal(evalCancel.action, 'cancel');
  assert.equal(evalCancel.alertType, 'revocation', 'Revocation notification emitted, not a new danger');

  // 6. Természetes lejárat: elkülönül a visszavonástól, nincs téves cancel küldés!
  const expiredMsg = {
    ...baseAlert,
    lifecycle: 'expired'
  };
  const evalExpired = evaluateWarningNotification(expiredMsg, { previousWarning: baseAlert });
  assert.equal(evalExpired.eligible, false);
  assert.equal(evalExpired.action, 'expired');
  assert.equal(evalExpired.alertType, 'expiry');

  // 7. Test / Exercise üzenet: szigorúan nincs éles értesítési jogosultság!
  const exerciseMsg = {
    ...baseAlert,
    status: 'Exercise'
  };
  const evalExercise = evaluateWarningNotification(exerciseMsg);
  assert.equal(evalExercise.eligible, false);
  assert.equal(evalExercise.action, 'drop');

  // 8. Unknown területi illesztés: nincs igazolt helyi veszélyriasztás!
  const unknownMsg = {
    ...baseAlert,
    territory: { matchState: 'unknown', isConfirmedLocal: false, inScope: null, needsLocalReview: true }
  };
  const evalUnknown = evaluateWarningNotification(unknownMsg);
  assert.equal(evalUnknown.eligible, false);
  assert.equal(evalUnknown.action, 'review_only');
  assert.equal(evalUnknown.isConfirmedLocal, false);

  // 9. Feedhiba: nem válik hivatalos visszavonássá!
  const feedError = { status: 'error', error: 'HTTP 503 Service Unavailable' };
  const evalError = evaluateWarningNotification(feedError, { previousWarning: baseAlert });
  assert.equal(evalError.eligible, false);
  assert.equal(evalError.action, 'feed_error', 'Feed error is never treated as a warning cancellation');
});

// ─── 5. Helyi és országos nézet szétválasztása (Requirement 5) ───

test('Separation of local Bihartorda and national HUN scope, no fake pinpoints', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'crucix-scope-split-'));
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const edgeXml = readFileSync('test/fixtures/synthetic-meteoalarm-edge-cases.atom.xml', 'utf8');
  const parsed = parseMeteoalarm(edgeXml, { country: 'hungary', now: NOW, includeAllLifecycles: true });

  const rawData = {
    crucix: { timestamp: new Date(NOW).toISOString() },
    sources: { Meteoalarm: parsed }
  };

  const V2 = await synthesize(rawData, { now: NOW });
  const events = V2.events;

  // 1. HU32 (Észak-Alföld) riasztás:
  const localEvent = events.find(e => e.providerId === 'HU.EDGE.NO_EXPIRES');
  assert.ok(localEvent);
  assert.equal(localEvent.territory.matchState, 'match');
  assert.equal(localEvent.territory.isConfirmedLocal, true);
  assert.equal(localEvent.location.lat, null, 'No fake point for district warning');

  // 2. HU22 (Nyugat-Dunántúl) riasztás:
  const westernEvent = events.find(e => e.providerId === 'HU.EDGE.WESTERN');
  assert.ok(westernEvent);
  assert.equal(westernEvent.territory.matchState, 'no_match');
  assert.equal(westernEvent.territory.isConfirmedLocal, false, 'HU22 is NOT a local match for Bihartorda');
  assert.equal(westernEvent.location.lat, null, 'No fake point for regional warning');

  // 3. Unknown terület:
  const unknownEvent = events.find(e => e.providerId === 'HU.EDGE.UNKNOWN');
  assert.ok(unknownEvent);
  assert.equal(unknownEvent.territory.matchState, 'unknown');
  assert.equal(unknownEvent.territory.needsLocalReview, true, 'Marked as needing review');
  assert.equal(unknownEvent.territory.isConfirmedLocal, false);

  // 4. Szűrés helyi vs országos nézetben:
  const localList = events.filter(e => e.territory?.isConfirmedLocal === true);
  const localReviewList = events.filter(e => e.territory?.needsLocalReview === true);
  const nationalList = events.filter(e => e.country === 'Hungary');

  assert.ok(localList.some(e => e.providerId === 'HU.EDGE.NO_EXPIRES'), 'Local list contains HU32/district');
  assert.ok(!localList.some(e => e.providerId === 'HU.EDGE.WESTERN'), 'Local list strictly excludes HU22');
  assert.ok(localReviewList.some(e => e.providerId === 'HU.EDGE.UNKNOWN'), 'Unknown code is marked for review');
  assert.ok(nationalList.some(e => e.providerId === 'HU.EDGE.WESTERN'), 'National list keeps HU22');

  // 5. HUN briefing NEM szűkül kizárólag Bihartordára:
  const entityStore = new EntityStore({ dataDir: tmpDir });
  entityStore.ingest(events, { now: NOW });

  const history = new HistoryStore(tmpDir, { now: () => NOW });
  history.add(events);

  const snapshot = {
    crucix: { timestamp: new Date(NOW).toISOString() },
    events
  };

  const hunBriefing = await generateBriefing({
    scope: 'HUN',
    snapshot,
    store: entityStore,
    history,
    now: NOW
  });

  assert.equal(hunBriefing.scope, 'HUN');
  // Both western (HU22) and local (HU32) events are referenced/available in the HUN briefing:
  assert.ok(hunBriefing.bullets.length > 0, 'HUN briefing produced bullets');
  const allRefIds = hunBriefing.bullets.flatMap(b => b.refs).map(r => r.id);
  assert.ok(allRefIds.includes(localEvent.id) || allRefIds.includes(westernEvent.id), 'National briefing covers Hungarian warnings');
});
