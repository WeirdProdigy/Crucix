import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseMeteoalarm,
  resolveWarningChains,
  determineLifecycleStatus,
  extractReferencedIds
} from '../apis/sources/meteoalarm.mjs';
import {
  matchTerritory,
  BIHARTORDA_PROFILE,
  KEY_CONNECTIONS,
  DEFAULT_TERRITORY_CONFIG
} from '../lib/intelligence/territory.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { EntityStore, resolveEventCountries } from '../lib/intelligence/entities.mjs';
import { generateBriefing } from '../lib/llm/briefing.mjs';
import { eventLevel } from '../lib/alerts/levels.mjs';

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const NOW = Date.parse('2026-10-22T12:00:00.000Z');

// ─── 1. Bihartorda KSH törzsadatok és névterek ellenőrzése ───

test('Bihartorda official KSH and Eurostat territory profile', () => {
  assert.equal(BIHARTORDA_PROFILE.name, 'Bihartorda');
  assert.equal(BIHARTORDA_PROFILE.kshSettlement, '29887', 'KSH településazonosító törzsszám: 29887');
  assert.equal(BIHARTORDA_PROFILE.kshDistrict, '102', 'KSH járáskód: 102 (Püspökladányi járás)');
  assert.equal(BIHARTORDA_PROFILE.districtName, 'Püspökladányi járás');
  assert.equal(BIHARTORDA_PROFILE.countyName, 'Hajdú-Bihar');
  assert.equal(BIHARTORDA_PROFILE.nuts3, 'HU321', 'Eurostat NUTS3: HU321');
  assert.equal(BIHARTORDA_PROFILE.nuts2, 'HU32', 'Eurostat NUTS2: HU32 (Észak-Alföld)');
  assert.equal(BIHARTORDA_PROFILE.iso3, 'HUN');
  assert.equal(BIHARTORDA_PROFILE.coordinates.lat, 47.1658);
  assert.equal(BIHARTORDA_PROFILE.coordinates.lon, 21.3650);

  // Key connection cities
  const puspokladany = KEY_CONNECTIONS.find(c => c.name === 'Püspökladány');
  assert.ok(puspokladany);
  assert.equal(puspokladany.kshDistrict, '102', 'Püspökladány shares district 102 with Bihartorda');

  const szoboszlo = KEY_CONNECTIONS.find(c => c.name === 'Hajdúszoboszló');
  assert.ok(szoboszlo);
  assert.equal(szoboszlo.kshDistrict, '101');

  const debrecen = KEY_CONNECTIONS.find(c => c.name === 'Debrecen');
  assert.ok(debrecen);
  assert.equal(debrecen.kshDistrict, '098');
});

// ─── 2. Alert -> Update -> Cancel lánc követése és references ───

test('Meteoalarm warning chain: Alert -> Update -> Cancel tracking', () => {
  const chainXml = readFileSync('test/fixtures/synthetic-meteoalarm-chain.atom.xml', 'utf8');
  const cancelXml = readFileSync('test/fixtures/synthetic-meteoalarm-cancellation.atom.xml', 'utf8');

  // Parse chain fixture
  const result1 = parseMeteoalarm(chainXml, { country: 'hungary', now: NOW, includeAllLifecycles: true });
  assert.equal(result1.status, 'ok');
  assert.equal(result1.allObservations.length, 2);

  const alert1 = result1.allObservations.find(w => w.providerId === 'HU.CHAIN.001');
  const update2 = result1.allObservations.find(w => w.providerId === 'HU.CHAIN.002');

  assert.ok(alert1);
  assert.ok(update2);
  assert.equal(alert1.lifecycle, 'superseded', 'Initial alert superseded by update');
  assert.equal(alert1.supersededBy, 'HU.CHAIN.002');
  assert.equal(update2.lifecycle, 'active', 'Update message is currently active');
  assert.equal(update2.chainKey, 'HU.CHAIN.001', 'Update message points to root chainKey');
  assert.equal(update2.severity, 'Severe', 'Severity escalated to Severe (Orange)');

  // Now process cancellation
  const cancelResult = parseMeteoalarm(cancelXml, { country: 'hungary', now: Date.parse('2026-10-22T14:30:00Z'), includeAllLifecycles: true });
  const cancel3 = cancelResult.allObservations.find(w => w.providerId === 'HU.CHAIN.003');
  assert.ok(cancel3);
  assert.equal(cancel3.msgType, 'Cancel');

  // Combined chain resolution across history
  const combined = resolveWarningChains([alert1, update2, cancel3]);
  const finalUpdate = combined.find(w => w.providerId === 'HU.CHAIN.002');
  assert.equal(finalUpdate.lifecycle, 'cancelled', 'Update was explicitly cancelled by Cancel message');
});

// ─── 3. Természetes lejárat visszavonás nélkül ───

test('Lifecycle: natural expiry without cancellation (now >= expires)', () => {
  const edgeXml = readFileSync('test/fixtures/synthetic-meteoalarm-edge-cases.atom.xml', 'utf8');
  const result = parseMeteoalarm(edgeXml, { country: 'hungary', now: NOW, includeAllLifecycles: true });

  const expired = result.allObservations.find(w => w.providerId === 'HU.EDGE.EXPIRED');
  assert.ok(expired);
  assert.equal(expired.lifecycle, 'expired', 'Expired warning is lifecycle: expired, NOT cancelled');
});

// ─── 4. Sorrenden kívül érkező üzenetek kezelése ───

test('Lifecycle: out-of-order message arrival resilience', () => {
  const alert = {
    providerId: 'HU.ORDER.001',
    msgType: 'Alert',
    startsAt: '2026-10-22T10:00:00Z',
    validUntil: '2026-10-22T18:00:00Z',
    lifecycle: 'active'
  };
  const cancel = {
    providerId: 'HU.ORDER.002',
    msgType: 'Cancel',
    references: 'riaszt@met.hu,HU.ORDER.001,2026-10-22T10:00:00Z',
    referencedIds: ['HU.ORDER.001'],
    lifecycle: 'cancelled'
  };

  // Arriving cancel before alert or resolving in reverse order
  const resolved = resolveWarningChains([cancel, alert]);
  const alertResolved = resolved.find(w => w.providerId === 'HU.ORDER.001');
  assert.equal(alertResolved.lifecycle, 'cancelled', 'Alert is cancelled even if cancel is processed first');
});

// ─── 5. Test/Exercise kizárása ───

test('Security & operational safety: Test and Exercise messages are strictly excluded', () => {
  const edgeXml = readFileSync('test/fixtures/synthetic-meteoalarm-edge-cases.atom.xml', 'utf8');
  const result = parseMeteoalarm(edgeXml, { country: 'hungary', now: NOW, includeAllLifecycles: true });

  const exercise = result.allObservations.find(w => w.providerId === 'HU.EDGE.EXERCISE');
  assert.equal(exercise, undefined, 'Exercise message was strictly rejected by parser');
});

// ─── 6. Területi illesztés Bihartorda szemszögéből ───

test('Territorial matching: NUTS2, NUTS3, District, Outside, and Indeterminate', () => {
  const edgeXml = readFileSync('test/fixtures/synthetic-meteoalarm-edge-cases.atom.xml', 'utf8');
  const result = parseMeteoalarm(edgeXml, { country: 'hungary', now: NOW, includeAllLifecycles: true });

  // 1. District level: Püspökladányi járás (KSH 102) -> Bihartorda district
  const districtWarning = result.allObservations.find(w => w.providerId === 'HU.EDGE.NO_EXPIRES');
  assert.ok(districtWarning);
  assert.equal(districtWarning.territory.status, 'in_watched_district');
  assert.equal(districtWarning.territory.territoryLevel, 'district');
  assert.equal(districtWarning.territory.inScope, true);
  assert.match(districtWarning.territory.message, /Püspökladányi járás/);
  // Ensure NO synthetic settlement coordinates are fabricated
  assert.equal(districtWarning.lat, undefined);
  assert.equal(districtWarning.lon, undefined);

  // 2. County level: Hajdú-Bihar (NUTS3: HU321)
  const countyWarning = result.allObservations.find(w => w.providerId === 'HU.EDGE.FUTURE');
  assert.ok(countyWarning);
  assert.equal(countyWarning.territory.status, 'in_watched_county');
  assert.equal(countyWarning.territory.territoryLevel, 'county');
  assert.equal(countyWarning.territory.inScope, true);
  assert.match(countyWarning.territory.message, /Hajdú-Bihar/);

  // 3. Region level: Észak-Alföld (NUTS2: HU32)
  const chainXml = readFileSync('test/fixtures/synthetic-meteoalarm-chain.atom.xml', 'utf8');
  const chainResult = parseMeteoalarm(chainXml, { country: 'hungary', now: NOW, includeAllLifecycles: true });
  const regionWarning = chainResult.allObservations.find(w => w.providerId === 'HU.CHAIN.002');
  assert.ok(regionWarning);
  assert.equal(regionWarning.territory.status, 'in_watched_region');
  assert.equal(regionWarning.territory.territoryLevel, 'region');
  assert.equal(regionWarning.territory.inScope, true);
  assert.match(regionWarning.territory.message, /Észak-Alföld nagyrégió/);

  // 4. Outside territory: Western Transdanubia (NUTS2: HU22)
  const westernWarning = result.allObservations.find(w => w.providerId === 'HU.EDGE.WESTERN');
  assert.ok(westernWarning);
  assert.equal(westernWarning.territory.status, 'not_in_watched_area');
  assert.equal(westernWarning.territory.inScope, false);
  assert.match(westernWarning.territory.message, /Nem erre a figyelt területre kiadva/);

  // 5. Indeterminate territory: unmapped custom geocode
  const unknownWarning = result.allObservations.find(w => w.providerId === 'HU.EDGE.UNKNOWN');
  assert.ok(unknownWarning);
  assert.equal(unknownWarning.territory.status, 'indeterminate');
  assert.equal(unknownWarning.territory.inScope, false);
  assert.match(unknownWarning.territory.message, /Területi érintettség nem eldönthető/);
});

// ─── 7. Awareness level és súlyosság megőrzése ───

test('Severity & awareness level preservation', () => {
  const chainXml = readFileSync('test/fixtures/synthetic-meteoalarm-chain.atom.xml', 'utf8');
  const result = parseMeteoalarm(chainXml, { country: 'hungary', now: NOW, includeAllLifecycles: true });

  const yellowAlert = result.allObservations.find(w => w.providerId === 'HU.CHAIN.001');
  assert.equal(yellowAlert.awarenessLevel, '2; yellow; Moderate', 'Original string preserved as-is');
  assert.equal(yellowAlert.severity, 'Moderate');

  const orangeUpdate = result.allObservations.find(w => w.providerId === 'HU.CHAIN.002');
  assert.equal(orangeUpdate.awarenessLevel, '3; orange; Severe', 'Original string preserved as-is');
  assert.equal(orangeUpdate.severity, 'Severe');
});

// ─── 8. Kanonikus adatút, tartós tárolás és HUN briefing integráció ───

test('Complete canonical pipeline: Meteoalarm -> buildEvents -> HistoryStore -> EntityStore -> HUN Briefing', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'crucix-meteo-pipeline-'));
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));

  const chainXml = readFileSync('test/fixtures/synthetic-meteoalarm-chain.atom.xml', 'utf8');
  const parsedMeteo = parseMeteoalarm(chainXml, { country: 'hungary', now: NOW });

  // 1. Snapshot with live source
  const rawData = {
    crucix: { timestamp: new Date(NOW).toISOString() },
    sources: {
      Meteoalarm: parsedMeteo
    }
  };

  // 2. synthesize and buildEvents produce canonical intelligence events
  const V2 = await synthesize(rawData, { now: NOW });
  const events = V2.events;
  assert.ok(events.length > 0, 'Weather events generated into canonical events');

  const activeWindEvent = events.find(e => e.providerId === 'HU.CHAIN.002');
  assert.ok(activeWindEvent);
  assert.equal(activeWindEvent.kind, 'weather');
  assert.equal(activeWindEvent.source.name, 'Meteoalarm');
  assert.equal(activeWindEvent.sourceRegion, 'Hungary');
  assert.equal(activeWindEvent.chainKey, 'HU.CHAIN.001');
  assert.equal(activeWindEvent.territory?.inScope, true);
  assert.equal(activeWindEvent.location.lat, null, 'No synthetic coords for territorial warning');
  assert.equal(activeWindEvent.location.method, 'unknown');

  // Internal severity mapping via levelRank: Moderate/Severe -> high/watch
  const lvl = eventLevel(activeWindEvent);
  assert.equal(lvl, 'high', 'Severe weather warning maps to high alert level');

  // 3. HistoryStore persistent storage and restart
  const history1 = new HistoryStore(tmpDir, { now: () => NOW });
  history1.add([activeWindEvent]);

  const history2 = new HistoryStore(tmpDir, { now: () => NOW });
  const retrieved = history2.get(activeWindEvent.id);
  assert.ok(retrieved, 'Event retrieved from disk after restart');
  assert.equal(retrieved.title, activeWindEvent.title);
  assert.equal(retrieved.chainKey, 'HU.CHAIN.001');

  // 4. EntityStore ingestion & country resolution
  const entityStore = new EntityStore({ dataDir: tmpDir });
  const resolvedCountry = resolveEventCountries(activeWindEvent);
  assert.deepEqual(resolvedCountry, { c: ['HUN'], m: 'l' }, 'Weather event in Hungary resolves to HUN');

  entityStore.ingest([activeWindEvent], { now: NOW });

  // 5. Hungarian briefing generation
  const snapshot = {
    crucix: { timestamp: new Date(NOW).toISOString() },
    events: [activeWindEvent]
  };

  const hunBriefing = await generateBriefing({
    scope: 'HUN',
    snapshot,
    store: entityStore,
    history: history2,
    now: NOW
  });

  assert.equal(hunBriefing.scope, 'HUN');
  const allRefs = hunBriefing.bullets.flatMap(b => b.refs);
  const cited = allRefs.find(r => r.id === activeWindEvent.id);
  assert.ok(cited, 'Meteoalarm weather warning is cited in HUN briefing');
  assert.ok(activeWindEvent.source.url.includes('meteoalarm.org'), 'Attribution URL preserved');
});
