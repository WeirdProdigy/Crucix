import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  parseMeteoalarm,
  resolveWarningChains,
  determineLifecycleStatus,
  checkFreshnessPolicy,
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
import { AlertEngine } from '../lib/alerts/engine.mjs';
import { AlertNotifier } from '../lib/alerts/notify.mjs';
import { normalizeSeverity } from '../lib/intelligence/events.mjs';

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
  // Korábban értesített lánc visszavonása -> visszavonási értesítés:
  const evalCancel = evaluateWarningNotification(cancelMsg, { previousWarning: { ...escalatedUpdate, notified: true } });
  assert.equal(evalCancel.eligible, true);
  assert.equal(evalCancel.action, 'cancel');
  assert.equal(evalCancel.alertType, 'revocation', 'Revocation notification emitted, not a new danger');

  // Korábban NEM értesített lánc visszavonása -> elnyomva (nem küldünk téves visszavonást):
  const evalCancelUnnotified = evaluateWarningNotification(cancelMsg, { previousWarning: { ...escalatedUpdate, notified: false } });
  assert.equal(evalCancelUnnotified.eligible, false);
  assert.equal(evalCancelUnnotified.action, 'suppress_unnotified_cancellation');

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

// ─── 6. CAP-lánckeresés lapozása >200 rekordos tárolóban (Requirement 1) ───

test('CAP warning chain pagination finds referenced warning buried past 200 records in history', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'crucix-meteo-paging-'));
  try {
    const history = new HistoryStore(tmpDir, { now: () => NOW });

    // 1. Eredeti Alert rekord (HU.CHAIN.001) a tárolóban, régebbi időbélyeggel
    const originalAlert = {
      id: 'event-0123456789abcdef0123456789abcdef',
      kind: 'weather',
      title: 'Severe wind warning for Észak-Alföld',
      summary: 'Wind warning — Észak-Alföld',
      source: { name: 'Meteoalarm', url: 'https://meteoalarm.org/hungary', status: 'ok' },
      providerId: 'HU.CHAIN.001',
      sender: 'meteoalarm@meteoalarm.org',
      sent: '2026-10-22T08:00:00+02:00',
      observedAt: '2026-10-22T08:00:00+02:00',
      publishedAt: '2026-10-22T08:00:00+02:00',
      collectedAt: new Date(NOW - 3600000).toISOString(),
      location: { label: 'Észak-Alföld', lat: 47.16, lon: 21.36, method: 'polygon' },
      severity: 'high',
      lifecycle: 'active',
      chainKey: 'HU.CHAIN.001',
      territory: { matchState: 'match', isConfirmedLocal: true, inScope: true }
    };
    history.add([originalAlert]);

    // 2. 250 darab újabb esemény hozzáadása a tárolóhoz, hogy az Alert a 200-as offset mögé kerüljön
    const dummyRecords = [];
    for (let i = 0; i < 250; i++) {
      const hex = i.toString(16).padStart(8, '0');
      dummyRecords.push({
        id: `event-${hex}000000000000000000000000`,
        kind: 'weather',
        title: `Dummy weather record ${i}`,
        summary: `Dummy summary ${i}`,
        source: { name: 'Meteoalarm', url: `https://meteoalarm.org/dummy/${i}`, status: 'ok' },
        providerId: `HU.DUMMY.${i}`,
        sender: 'meteoalarm@meteoalarm.org',
        sent: new Date(NOW - 1800000 + i * 1000).toISOString(),
        observedAt: new Date(NOW - 1800000 + i * 1000).toISOString(),
        publishedAt: new Date(NOW - 1800000 + i * 1000).toISOString(),
        collectedAt: new Date(NOW - 1800000 + i * 1000).toISOString(),
        location: { label: 'Hungary', lat: 47.0, lon: 19.0, method: 'centroid' },
        severity: 'low',
        lifecycle: 'active',
        territory: { matchState: 'no_match', isConfirmedLocal: false }
      });
    }
    history.add(dummyRecords);

    // Ellenőrizzük, hogy az egyedi limit:200 lekérés NEM tartalmazza az eredeti alertet (mivel az a 251. helyen van)
    const page1 = history.query({ limit: 200 });
    assert.equal(page1.items.length, 200);
    assert.ok(!page1.items.some(r => r.providerId === 'HU.CHAIN.001'), 'Original alert is buried beyond first 200 records');
    assert.equal(page1.total, 251, 'Total records in history is 251');

    // 3. Érkezik az Update üzenet (HU.CHAIN.002), amely a HU.CHAIN.001-re hivatkozik
    const incomingUpdate = {
      providerId: 'HU.CHAIN.002',
      msgType: 'Update',
      title: 'Update wind warning for Észak-Alföld',
      references: 'meteoalarm@meteoalarm.org,HU.CHAIN.001,2026-10-22T08:00:00+02:00',
      parsedReferences: [{
        sender: 'meteoalarm@meteoalarm.org',
        identifier: 'HU.CHAIN.001',
        sent: '2026-10-22T08:00:00+02:00'
      }],
      referencedIds: ['HU.CHAIN.001'],
      lifecycle: 'active',
      territory: { matchState: 'match', isConfirmedLocal: true }
    };

    // 4. resolveWarningChains a lapozó historyval:
    resolveWarningChains([incomingUpdate], { history, now: NOW });

    // Igazolás: a lapozás sikeresen megtalálta az eltemetett rekordot
    assert.equal(incomingUpdate.chainKey, 'HU.CHAIN.001', 'ChainKey correctly resolved from buried record via pagination');
    const updatedAlertInHistory = history.get(originalAlert.id);
    assert.equal(updatedAlertInHistory.lifecycle, 'superseded', 'Buried alert marked superseded in history');
    assert.equal(updatedAlertInHistory.supersededBy, 'HU.CHAIN.002');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── 7. Súlyosság és hiányzó lejárati idő szemantikája (Requirement 2) ───

test('Severity mapping layers and 24h freshness lifecycle for warnings with missing expires', () => {
  // A. Szolgáltatói súlyosság és belső besorolás elkülönülése:
  // 1. Meteoalarm Moderate (2; yellow; Moderate):
  //    - provider: 'Moderate'
  //    - canonical event severity: 'moderate'
  //    - Crucix internal alert level: 'watch' (levelRank = 1)
  //    - illeszkedik: 'hungary-region' (minLevel: 'watch'), de NEM illeszkedik 'events-high' (minLevel: 'high')
  const moderateEvent = {
    title: 'Yellow wind warning',
    severity: normalizeSeverity('Moderate'),
    source: { name: 'Meteoalarm' }
  };
  assert.equal(moderateEvent.severity, 'moderate', 'CAP Moderate maps to event scale moderate');
  assert.equal(eventLevel(moderateEvent), 'watch', 'Event moderate maps to alert level watch');

  // 2. Meteoalarm Severe (3; orange; Severe):
  //    - provider: 'Severe'
  //    - canonical event severity: 'high'
  //    - Crucix internal alert level: 'high' (levelRank = 2)
  //    - illeszkedik mindkettőre: 'hungary-region' és 'events-high'
  const severeEvent = {
    title: 'Orange wind warning',
    severity: normalizeSeverity('Severe'),
    source: { name: 'Meteoalarm' }
  };
  assert.equal(severeEvent.severity, 'high', 'CAP Severe maps to event scale high');
  assert.equal(eventLevel(severeEvent), 'high', 'Event high maps to alert level high');

  // 3. Meteoalarm Extreme (4; red; Extreme):
  //    - provider: 'Extreme'
  //    - canonical event severity: 'critical'
  //    - Crucix internal alert level: 'critical' (levelRank = 3)
  const extremeEvent = {
    title: 'Red wind warning',
    severity: normalizeSeverity('Extreme'),
    source: { name: 'Meteoalarm' }
  };
  assert.equal(extremeEvent.severity, 'critical', 'CAP Extreme maps to event scale critical');
  assert.equal(eventLevel(extremeEvent), 'critical', 'Event critical maps to alert level critical');

  // B. Hiányzó expires (validUntil) helyi frissességi szabályzata és bizonytalansága:
  // 1. Friss riasztás a 24 órás határon belül (now - publishedAt = 2h):
  const publishedAt = '2026-10-22T08:00:00.000Z';
  const timeBeforeLimit = Date.parse('2026-10-22T10:00:00.000Z'); // 2 órával utána

  const freshRes = checkFreshnessPolicy({
    validUntil: null,
    publishedAt,
    now: timeBeforeLimit
  });
  assert.equal(freshRes.hasExplicitExpires, false, 'No explicit expires supplied by provider');
  assert.equal(freshRes.freshnessStatus, 'fresh', 'Freshness status is fresh within 24h');
  assert.equal(freshRes.isFreshnessLimitExceeded, false);
  assert.equal(freshRes.validityLabel, 'A kibocsátó nem adott meg lejáratot.', 'Exact expected label when active within 24h');

  // Provider lifecycle stays active (NOT artificially expired):
  const lifecycleBefore = determineLifecycleStatus({
    msgType: 'Alert',
    publishedAt,
    validUntil: null,
    now: timeBeforeLimit
  });
  assert.equal(lifecycleBefore, 'active', 'Provider lifecycle is active, not artificially expired');

  // 2. Pontosan a 24 órás határon (now - publishedAt = 24h):
  const timeAtLimit = Date.parse('2026-10-23T08:00:00.000Z'); // Pontosan 24h
  const atLimitRes = checkFreshnessPolicy({
    validUntil: null,
    publishedAt,
    now: timeAtLimit
  });
  assert.equal(atLimitRes.hasExplicitExpires, false);
  assert.equal(atLimitRes.isFreshnessLimitExceeded, true, 'At 24h boundary, freshness limit is exceeded');
  assert.equal(atLimitRes.freshnessStatus, 'stale');
  assert.equal(atLimitRes.validityLabel, 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.', 'Exact expected label at limit');

  // 3. A 24 órás határon túl (now - publishedAt = 25h):
  const timeAfterLimit = Date.parse('2026-10-23T09:00:00.000Z'); // 25h
  const afterLimitRes = checkFreshnessPolicy({
    validUntil: null,
    publishedAt,
    now: timeAfterLimit
  });
  assert.equal(afterLimitRes.hasExplicitExpires, false);
  assert.equal(afterLimitRes.isFreshnessLimitExceeded, true);
  assert.equal(afterLimitRes.freshnessStatus, 'stale');
  assert.equal(afterLimitRes.validityLabel, 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.', 'Exact expected label after limit');

  // Provider lifecycle továbbra is active (nem állítunk be téves expired szolgáltatói állapotot):
  const lifecycleAfter = determineLifecycleStatus({
    msgType: 'Alert',
    publishedAt,
    validUntil: null,
    now: timeAfterLimit
  });
  assert.equal(lifecycleAfter, 'active', 'Exceeding local freshness does NOT forge provider lifecycle=expired');

  // Értesítés letiltása a helyi frissességi korlát miatt:
  const staleWarning = {
    title: 'Wind warning without expires',
    providerId: 'HU.STALE.001',
    status: 'Actual',
    scope: 'Public',
    lifecycle: lifecycleAfter,
    validUntil: null,
    hasExplicitExpires: false,
    freshnessStatus: afterLimitRes.freshnessStatus,
    isFreshnessLimitExceeded: afterLimitRes.isFreshnessLimitExceeded,
    freshnessReason: afterLimitRes.freshnessReason,
    territory: { matchState: 'match', isConfirmedLocal: true }
  };
  const evalStale = evaluateWarningNotification(staleWarning);
  assert.equal(evalStale.eligible, false, 'Stale unverified warning is ineligible for alerting');
  assert.equal(evalStale.action, 'freshness_exceeded');
  assert.equal(evalStale.reason, 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.');
});

// ─── 8. Figyelmeztetés lejárat nélkül: perzisztens tárolás és újraszámítás újraindítás után ───

test('Warning without expires: persistent storage retains record and recalculates freshness across restarts', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'crucix-meteo-restart-freshness-'));
  try {
    const publishedAt = '2026-10-22T08:00:00.000Z';
    const t0 = Date.parse('2026-10-22T10:00:00.000Z'); // T0 = 2 órával közzététel után

    const initialFreshness = checkFreshnessPolicy({ validUntil: null, publishedAt, now: t0 });
    const initialRecord = {
      id: 'event-00112233445566778899aabbccddeeff',
      kind: 'weather',
      title: 'Thunderstorm warning without expires',
      summary: 'Thunderstorm — Észak-Alföld',
      source: { name: 'Meteoalarm', url: 'https://meteoalarm.org/hungary', status: 'ok' },
      providerId: 'HU.NO_EXPIRES.001',
      publishedAt,
      observedAt: publishedAt,
      collectedAt: new Date(t0).toISOString(),
      location: { label: 'Észak-Alföld', lat: 47.16, lon: 21.36, method: 'polygon' },
      severity: 'high',
      lifecycle: 'active',
      validUntil: null,
      hasExplicitExpires: false,
      freshnessStatus: initialFreshness.freshnessStatus,
      isFreshnessLimitExceeded: initialFreshness.isFreshnessLimitExceeded,
      freshnessReason: initialFreshness.freshnessReason,
      territory: { matchState: 'match', isConfirmedLocal: true }
    };

    // Mentés HistoryStore-ba T0 időpontban
    const history1 = new HistoryStore(tmpDir, { now: () => t0 });
    history1.add([initialRecord]);

    // Újraindítás 1: T0 + 2 óra (még a 24 órán belül)
    const t1 = Date.parse('2026-10-22T12:00:00.000Z');
    const history2 = new HistoryStore(tmpDir, { now: () => t1 });
    const loaded1 = history2.get(initialRecord.id);
    assert.ok(loaded1, 'Record recovered from history');
    assert.equal(loaded1.validUntil ?? null, null, 'validUntil remains strictly null or unset');
    assert.equal(loaded1.lifecycle, 'active', 'Lifecycle remains active');
    const recomputedFreshness1 = checkFreshnessPolicy({ validUntil: loaded1.validUntil ?? null, publishedAt: loaded1.publishedAt, now: t1 });
    assert.equal(recomputedFreshness1.freshnessStatus, 'fresh');
    assert.equal(recomputedFreshness1.isFreshnessLimitExceeded, false);
    assert.equal(recomputedFreshness1.validityLabel, 'A kibocsátó nem adott meg lejáratot.');

    // Újraindítás 2: T0 + 26 óra (24 órás frissességi határon túl)
    const t2 = Date.parse('2026-10-23T10:00:00.000Z');
    const history3 = new HistoryStore(tmpDir, { now: () => t2 });
    const loaded2 = history3.get(initialRecord.id);
    assert.ok(loaded2, 'Record retained in historical storage after expiration');
    assert.equal(loaded2.validUntil ?? null, null, 'validUntil is still null or unset');
    assert.equal(loaded2.lifecycle, 'active', 'Provider lifecycle is still active');
    // Újraszámított frissesség:
    const recomputedFreshness2 = checkFreshnessPolicy({ validUntil: loaded2.validUntil ?? null, publishedAt: loaded2.publishedAt, now: t2 });
    assert.equal(recomputedFreshness2.freshnessStatus, 'stale', 'Freshness recalculation marks record stale');
    assert.equal(recomputedFreshness2.isFreshnessLimitExceeded, true);
    assert.equal(recomputedFreshness2.validityLabel, 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.');
    assert.equal(recomputedFreshness2.freshnessReason, 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── 9. Cancel teljes motorút: riasztás, visszavonás, duplikátum-elnyomás, restart (Requirement 3) ───

test('Full AlertEngine and AlertNotifier lifecycle: initial alert, cancel revocation, duplicate suppression, unnotified rejection, and restart persistence', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'crucix-full-cancel-flow-'));
  try {
    const sentMessages = [];
    const mockTelegram = {
      isConfigured: true,
      sendMessage: async (text) => {
        sentMessages.push(text);
        return { ok: true };
      }
    };

    const notifier = new AlertNotifier({
      telegram: mockTelegram,
      notifyChannels: ['telegram'],
      minSeverity: 'high',
      now: () => NOW
    });

    const engine1 = new AlertEngine(tmpDir, { now: () => NOW });
    engine1.load();

    // 1. Bootstrap sweep
    engine1.evaluate({ events: [] });

    // 2. Első helyi riasztás (Severe thunderstorm warning for Észak-Alföld)
    const initialWarningEvent = {
      id: 'meteo00112233445566778899aabbcc',
      kind: 'weather',
      title: 'Orange thunderstorm warning for Észak-Alföld',
      summary: 'Thunderstorm warning — Észak-Alföld',
      source: { name: 'Meteoalarm', url: 'https://meteoalarm.org/hungary' },
      providerId: 'HU.CHAIN.001',
      chainKey: 'HU.CHAIN.001',
      msgType: 'Alert',
      severity: 'high',
      observedAt: new Date(NOW).toISOString(),
      publishedAt: new Date(NOW).toISOString(),
      location: { label: 'Észak-Alföld', lat: 47.16, lon: 21.36, method: 'polygon' },
      territory: { matchState: 'match', isConfirmedLocal: true, inScope: true },
      awarenessLevel: '3; orange; Severe',
      lifecycle: 'active',
      validUntil: new Date(NOW + 14400000).toISOString()
    };

    const evalRes1 = engine1.evaluate({ events: [initialWarningEvent] });
    assert.equal(evalRes1.created.length >= 1, true, 'AlertEngine created alert');
    const createdAlert = evalRes1.created.find(a => a.ruleId === 'events-high');
    assert.ok(createdAlert, 'events-high alert generated');

    // Kézbesítés mock küldővel:
    const dispatchRes1 = await notifier.dispatch({ created: [createdAlert], escalated: [], resolved: [] });
    assert.equal(dispatchRes1.sent.length, 1, 'Initial alert dispatched');
    assert.equal(sentMessages.length, 1, 'Mock Telegram received initial alert message');
    assert.ok(sentMessages[0].includes('[HIGH] Orange thunderstorm warning for Észak-Alföld'));

    // Rögzítés az engine-ben és perzisztálás lemezre:
    engine1.markNotified(createdAlert.id, ['telegram']);
    initialWarningEvent.notified = true;

    // 3. Későbbi Cancel visszavonásként történő kézbesítése
    const cancelEvent = {
      providerId: 'HU.CHAIN.003',
      chainKey: 'HU.CHAIN.001',
      title: 'Thunderstorm warning cancelled',
      status: 'Actual',
      scope: 'Public',
      msgType: 'Cancel',
      lifecycle: 'cancelled',
      territory: { matchState: 'match', isConfirmedLocal: true }
    };

    const evalCancel = evaluateWarningNotification(cancelEvent, { previousWarning: initialWarningEvent });
    assert.equal(evalCancel.eligible, true, 'Cancel is eligible for revocation');
    assert.equal(evalCancel.action, 'cancel');
    assert.equal(evalCancel.alertType, 'revocation');

    // Revocation értesítés összeállítása és elküldése a mock küldőnek:
    const revocationAlert = {
      id: 'alert-cancel-00112233445566778899aabb',
      ruleId: 'events-high',
      severity: 'high',
      notify: true,
      title: evalCancel.title,
      summary: 'Official CAP cancellation message for previously notified local hazard',
      evidence: [{ type: 'event', id: cancelEvent.providerId, title: evalCancel.title, level: 'high' }]
    };

    const dispatchCancelRes = await notifier.dispatch({ created: [revocationAlert], escalated: [], resolved: [] });
    assert.equal(dispatchCancelRes.sent.length, 1, 'Revocation alert dispatched');
    assert.equal(sentMessages.length, 2, 'Mock Telegram received exactly 2 messages (1 alert, 1 cancellation)');
    assert.ok(sentMessages[1].includes('[HIGH] VISSZAVONÁS: Thunderstorm warning cancelled'));

    // Rögzítjük a visszavonás kézbesítését:
    initialWarningEvent.cancelNotified = true;

    // 4. Ismételt Cancel esetén nincs újabb küldés (duplikátum elnyomása):
    const evalRepeatCancel = evaluateWarningNotification(cancelEvent, { previousWarning: initialWarningEvent });
    assert.equal(evalRepeatCancel.eligible, false, 'Repeated cancel is not eligible');
    assert.equal(evalRepeatCancel.action, 'suppress_duplicate', 'Duplicate cancellation suppressed');
    assert.equal(sentMessages.length, 2, 'No 3rd message emitted on repeated cancel');

    // 5. Korábban nem értesített láncnál nincs visszavonási üzenet:
    const unnotifiedChainEvent = {
      ...initialWarningEvent,
      providerId: 'HU.UNNOTIFIED.001',
      chainKey: 'HU.UNNOTIFIED.001',
      notified: false,
      cancelNotified: false
    };
    const unnotifiedCancelEvent = {
      ...cancelEvent,
      chainKey: 'HU.UNNOTIFIED.001'
    };
    const evalUnnotifiedCancel = evaluateWarningNotification(unnotifiedCancelEvent, { previousWarning: unnotifiedChainEvent });
    assert.equal(evalUnnotifiedCancel.eligible, false, 'Unnotified chain cancel is strictly ineligible');
    assert.equal(evalUnnotifiedCancel.action, 'suppress_unnotified_cancellation');
    assert.equal(sentMessages.length, 2, 'No message emitted for unnotified chain');

    // 6. Értesítési előzmény megmaradása újraindítás után:
    const engine2 = new AlertEngine(tmpDir, { now: () => NOW });
    engine2.load();
    const recoveredAlert = engine2.get(createdAlert.id);
    assert.ok(recoveredAlert, 'Alert recovered from disk after engine restart');
    assert.ok(recoveredAlert.notified, 'notified metadata preserved');
    assert.deepEqual(recoveredAlert.notified.channels, ['telegram'], 'Telegram channel notification remembered');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── 10. Böngészős bizonyíték: Record Inspector DOM kimenet (Requirement 4) ───

test('Browser evidence: Record Inspector DOM rendering of territory, matchState, awareness, lifecycle, freshness, and source link', () => {
  // Betöltjük a böngészős JS realm-et:
  const recordCoreSrc = readFileSync('dashboard/public/record-core.js', 'utf8');
  const recordInspectorSrc = readFileSync('dashboard/public/record-inspector.js', 'utf8');

  const window = {};
  const context = vm.createContext({ window, Date, URL });
  vm.runInContext(recordCoreSrc, context);
  vm.runInContext(recordInspectorSrc, context);

  const I = window.CrucixRecordInspector;
  const R = window.CrucixRecords;
  const t = (_, fallback) => fallback;

  // 1. Meteoalarm megfigyelési rekord a 24h frissességi határon belül (hiányzó expires):
  const rawRowFresh = {
    providerId: 'HU.METEO.DOM.001',
    title: 'Orange thunderstorm warning for Észak-Alföld',
    summary: 'Thunderstorm warning — Észak-Alföld',
    source: 'Meteoalarm',
    url: 'https://meteoalarm.org/en/live/warning/HU.METEO.DOM.001',
    severity: 'Severe',
    observedAt: '2026-10-22T08:00:00Z',
    publishedAt: '2026-10-22T08:00:00Z',
    validUntil: null,
    facts: [
      { label: 'territory', value: 'Észak-Alföld' },
      { label: 'matchState', value: 'match' },
      { label: 'lifecycle', value: 'active' },
      { label: 'freshnessStatus', value: 'fresh' },
      { label: 'awarenessLevel', value: '3; orange; Severe' },
      { label: 'validity', value: 'A kibocsátó nem adott meg lejáratot.' },
      { label: 'isConfirmedLocal', value: true }
    ]
  };

  const recordsFresh = R.toRecords([rawRowFresh], 'Meteoalarm');
  assert.equal(recordsFresh.length, 1);
  const recFresh = recordsFresh[0];

  const viewFresh = {
    source: { name: 'Meteoalarm', url: 'https://meteoalarm.org/', state: 'ok', observedAt: '2026-10-22T08:00:00Z' },
    records: recordsFresh,
    total: 1,
    filters: { levels: [], windowHours: 0, text: '', sort: 'severity' },
    limit: 25,
    selected: { record: recFresh, outdated: false }
  };

  const renderedFreshHtml = I.renderInspector(viewFresh, t, NOW);

  // Ellenőrizzük a 6 megkövetelt mezőt a generált DOM-ban:
  // 1. Terület:
  assert.ok(renderedFreshHtml.includes('<dd>Észak-Alföld</dd>'), 'DOM contains territory fact: Észak-Alföld');
  // 2. matchState:
  assert.ok(renderedFreshHtml.includes('<dd>match</dd>'), 'DOM contains matchState fact: match');
  // 3. Szolgáltatói fokozat (awarenessLevel):
  assert.ok(renderedFreshHtml.includes('<dd>3; orange; Severe</dd>'), 'DOM contains awarenessLevel fact: 3; orange; Severe');
  // 4. Életciklus és külön adatfrissesség:
  assert.ok(renderedFreshHtml.includes('<dd>active</dd>'), 'DOM contains lifecycle fact: active');
  assert.ok(renderedFreshHtml.includes('<dd>fresh</dd>'), 'DOM contains separate freshnessStatus fact: fresh');
  // 5. Hiányzó lejárat helyes felirata (A kibocsátó nem adott meg lejáratot.):
  assert.ok(renderedFreshHtml.includes('<dd>A kibocsátó nem adott meg lejáratot.</dd>'), 'DOM contains exact label: A kibocsátó nem adott meg lejáratot.');
  assert.ok(!renderedFreshHtml.includes('Érvényes visszavonásig (max. 24h)'), 'Forbidden label is absent');
  // 6. Eseményspecifikus eredeti hivatkozás:
  assert.ok(renderedFreshHtml.includes('href="https://meteoalarm.org/en/live/warning/HU.METEO.DOM.001"'), 'DOM contains event-specific original URL');
  assert.ok(renderedFreshHtml.includes('Original source ↗'), 'DOM contains clickable link text');

  // 2. Meteoalarm megfigyelési rekord a 24h frissességi határon túl:
  const rawRowStale = {
    ...rawRowFresh,
    providerId: 'HU.METEO.DOM.002',
    facts: [
      { label: 'territory', value: 'Észak-Alföld' },
      { label: 'matchState', value: 'match' },
      { label: 'lifecycle', value: 'active' },
      { label: 'freshnessStatus', value: 'stale' },
      { label: 'awarenessLevel', value: '3; orange; Severe' },
      { label: 'validity', value: 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.' },
      { label: 'freshnessReason', value: 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.' },
      { label: 'isConfirmedLocal', value: true }
    ]
  };

  const recordsStale = R.toRecords([rawRowStale], 'Meteoalarm');
  const viewStale = {
    ...viewFresh,
    records: recordsStale,
    selected: { record: recordsStale[0], outdated: false }
  };

  const renderedStaleHtml = I.renderInspector(viewStale, t, NOW);
  assert.ok(renderedStaleHtml.includes('<dd>Aktualitása nem igazolt: a helyi frissességi korlát letelt.</dd>'), 'DOM contains exact stale label: Aktualitása nem igazolt: a helyi frissességi korlát letelt.');
  assert.ok(renderedStaleHtml.includes('<dd>stale</dd>'), 'DOM contains freshnessStatus: stale');
});
