import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VIEWS,
  VIEW_CATEGORIES,
  RELATIONSHIPS,
  COVERAGE_STATES,
  isValidBriefingRef,
  evaluateEventTerritoryViews,
  partitionEventsByView,
  evaluateSourceCoverage
} from '../lib/intelligence/views.mjs';
import { freshLiveSnapshot, determineStaleReason, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { DEFAULT_TERRITORY_CONFIG } from '../lib/intelligence/territory.mjs';
import { createBriefingService, generateBriefing } from '../lib/llm/briefing.mjs';
import { generatePackage2bSnapshot } from '../scripts/generate-package2b-snapshot.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SNAPSHOT_PATH = join(ROOT, 'test/fixtures/runs-test-package2b/latest.json');

test('1. Package 2B test snapshot exists and is generated deterministically', () => {
  const result = generatePackage2bSnapshot({ outPath: SNAPSHOT_PATH });
  assert.ok(existsSync(SNAPSHOT_PATH), 'Snapshot file must exist on disk');
  assert.ok(result.eventCount > 0, 'Snapshot must contain events');
  assert.equal(result.briefingBullets, 2, 'Snapshot must contain 2 briefing bullets');
});

test('2. Event records retain their identity and receive additive .views, .lifecycle, .isCancelled fields', () => {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const events = raw.events;
  assert.ok(Array.isArray(events) && events.length > 0, 'Events array must be present');

  for (const event of events) {
    // 1. Identity contracts
    assert.match(event.id, /^event-[0-9a-f]{32}$/, `Event ID ${event.id} must be event-[0-9a-f]{32}`);

    // 2. Additive views object
    assert.ok(event.views && typeof event.views === 'object', 'Event must have additive .views');
    for (const view of Object.values(VIEWS)) {
      assert.ok(event.views[view], `Event.views must include ${view}`);
      assert.equal(typeof event.views[view].inView, 'boolean');
      if (event.views[view].inView) {
        assert.ok(Object.values(VIEW_CATEGORIES).includes(event.views[view].category), `Invalid category: ${event.views[view].category}`);
      } else {
        assert.equal(event.views[view].category, null, `Category must be null when inView=false`);
      }
      assert.ok(Object.values(RELATIONSHIPS).includes(event.views[view].relationship), `Invalid relationship: ${event.views[view].relationship}`);
    }

    // 3. Additive lifecycle and isCancelled
    assert.ok(['active', 'superseded', 'cancelled', 'expired', 'future'].includes(event.lifecycle), `Invalid lifecycle: ${event.lifecycle}`);
    assert.equal(typeof event.isCancelled, 'boolean');

    // 4. [TESZTADAT] tagging
    assert.ok(event.title.startsWith('[TESZTADAT]'), `Event title must be marked [TESZTADAT]: ${event.title}`);
  }
});

test('3. V2.views contains all 4 territorial views with exact unique, total, and cancelledChains counters', () => {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const views = raw.views;

  assert.ok(views && typeof views === 'object', 'views object must exist');
  for (const view of [VIEWS.LOCAL, VIEWS.COUNTY, VIEWS.NATIONAL, VIEWS.GLOBAL]) {
    assert.ok(views[view], `View ${view} must be present`);
    assert.equal(typeof views[view].uniqueEvents, 'number');
    assert.equal(typeof views[view].totalEvents, 'number');
    assert.equal(typeof views[view].cancelledChains, 'number');
    assert.ok(views[view].totalEvents >= views[view].uniqueEvents, 'totalEvents must be >= uniqueEvents');

    assert.ok(views[view].breakdown, 'breakdown object must exist');
    assert.equal(typeof views[view].breakdown.confirmedLocal, 'number');
    assert.equal(typeof views[view].breakdown.keyConnection, 'number');
    assert.equal(typeof views[view].breakdown.needsReview, 'number');
    assert.equal(typeof views[view].breakdown.regionalAdvisories, 'number');
    assert.equal(typeof views[view].breakdown.unknownTerritory, 'number');
  }

  // Local view specific assertions
  const local = views[VIEWS.LOCAL];
  assert.equal(local.breakdown.confirmedLocal, 2, 'Bihartorda and Püspökladány are confirmedLocal');
  assert.equal(local.breakdown.keyConnection, 1, 'Debrecen is keyConnection');
  assert.equal(local.breakdown.regionalAdvisories, 1, 'HU321 Meteoalarm alert is regionalAdvisories in local view');
  assert.equal(local.uniqueEvents, 4, 'Total unique active events in local view');
});

test('4. Source coverage fields use COVERAGE_STATES constants with correct spelling and origin="snapshot"', () => {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const coverage = raw.coverage;

  assert.ok(Array.isArray(coverage), 'Coverage must be an array of evaluated sources');
  const meteo = coverage.find(s => s.sourceId === 'Meteoalarm');
  assert.ok(meteo, 'Meteoalarm must be in coverage');
  assert.equal(meteo.origin, 'snapshot');
  assert.equal(meteo.isSnapshot, true);
  assert.equal(meteo.status, COVERAGE_STATES.OFFLINE_SNAPSHOT);
  assert.equal(meteo.status, 'offline_snapshot');

  const nebih = coverage.find(s => s.sourceId === 'Nebih-ASP');
  assert.ok(nebih, 'Nebih-ASP must be in coverage');
  assert.equal(nebih.origin, 'snapshot');
  assert.equal(nebih.status, COVERAGE_STATES.DISABLED);
  assert.equal(nebih.status, 'disabled');

  const haon = coverage.find(s => s.sourceId === 'HAON');
  assert.ok(haon, 'HAON must be in coverage');
  assert.equal(haon.origin, 'snapshot');
  assert.equal(haon.status, COVERAGE_STATES.UNCONFIGURED);
  assert.equal(haon.status, 'unconfigured');
});

test('5. freshLiveSnapshot idempotency: repeated calls return fresh objects without in-place mutation of input', () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const originalJson = JSON.stringify(snapshot);

  const read1 = freshLiveSnapshot(snapshot, Date.parse('2026-10-22T14:15:00.000Z'));
  const read2 = freshLiveSnapshot(snapshot, Date.parse('2026-10-22T14:15:00.000Z'));

  // 1. Output objects are newly built, not identical by reference
  assert.notEqual(read1, snapshot, 'freshLiveSnapshot must return a new snapshot object');
  assert.notEqual(read1, read2, 'Subsequent calls must return distinct object instances');
  assert.notEqual(read1.events, snapshot.events, 'Events array must be a fresh array');

  // 2. Cached input snapshot was NOT mutated
  assert.equal(JSON.stringify(snapshot), originalJson, 'Cached snapshot input must remain completely untouched');

  // 3. Repeated evaluations are identical in data
  assert.deepEqual(read1.views, read2.views, 'Repeated reads must produce identical views data');
  assert.deepEqual(read1.events.map(e => e.id), read2.events.map(e => e.id), 'Event IDs must be identical across reads');
});

test('6. Payload JSON serializability: full synthesized snapshot serializes and roundtrips without error', () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  let serialized = '';
  assert.doesNotThrow(() => {
    serialized = JSON.stringify(snapshot);
  }, 'Snapshot must be cleanly serializable with JSON.stringify without circular references');

  const parsed = JSON.parse(serialized);
  assert.equal(parsed.meta.version, '2.13.6');
  assert.equal(parsed.events.length, snapshot.events.length);
  assert.deepEqual(parsed.views.local.breakdown, snapshot.views.local.breakdown);
});

test('7. Briefing validation: rule-based briefing succeeds without LLM client and cites real event-[0-9a-f]{32} IDs', async () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

  // 1. Snapshot briefing bullets check
  assert.ok(snapshot.briefing && Array.isArray(snapshot.briefing.bullets), 'Briefing must have bullets');
  assert.equal(snapshot.briefing.bullets.length, 2);
  for (const bullet of snapshot.briefing.bullets) {
    assert.ok(bullet.text.startsWith('[TESZTADAT]'), `Briefing bullet must be tagged [TESZTADAT]: ${bullet.text}`);
    assert.ok(Array.isArray(bullet.refs) && bullet.refs.length > 0, 'Bullet must cite references');
    for (const ref of bullet.refs) {
      assert.ok(isValidBriefingRef(ref), `Reference ${JSON.stringify(ref)} must be valid`);
      assert.match(ref.id, /^event-[0-9a-f]{32}$/, `Citation ref id must match event-[0-9a-f]{32}: ${ref.id}`);
      assert.ok(snapshot.events.some(e => e.id === ref.id), `Cited ID ${ref.id} must exist in snapshot events`);
    }
  }

  // 2. Integration with createBriefingService without LLM provider (provider = null)
  const service = createBriefingService({
    provider: null, // Strictly NO LLM client!
    language: 'hu',
    getSnapshot: () => snapshot,
    now: () => Date.parse('2026-10-22T14:15:00.000Z')
  });

  const generated = await service.generate('HUN');
  assert.ok(generated, 'Briefing generation must succeed');
  assert.equal(generated.source, 'rules', 'Without LLM provider, briefing must be rule-based');
  assert.equal(generated.scope, 'HUN');
  assert.ok(Array.isArray(generated.bullets), 'Generated briefing must contain bullets');
});

test('8. Origin="live" is only assigned when live query actually executed in running process', async () => {
  const rawData = {
    crucix: { timestamp: '2026-10-22T14:15:00.000Z' },
    sources: {
      Meteoalarm: { status: 'ok', observations: [] },
      OpenSky: { status: 'ok', hotspots: [] }
    }
  };

  // 1. With isOfflineSnapshot=true or enableSweeps=false -> All sources must be "snapshot"
  const offlineV2 = await synthesize(rawData, { isOfflineSnapshot: true, now: Date.parse('2026-10-22T14:15:00.000Z') });
  for (const cov of offlineV2.coverage) {
    assert.equal(cov.origin, 'snapshot', `Under offline snapshot, origin must be snapshot: ${cov.sourceId}`);
  }

  // 2. With liveQueriedSources specified -> only queried source gets "live"
  const liveV2 = await synthesize(rawData, {
    isOfflineSnapshot: false,
    liveQueriedSources: new Set(['Meteoalarm']),
    now: Date.parse('2026-10-22T14:15:00.000Z')
  });

  const meteoCov = liveV2.coverage.find(c => c.sourceId === 'Meteoalarm');
  assert.ok(meteoCov);
  assert.equal(meteoCov.origin, 'live', 'Live queried source must have origin="live"');

  const openSkyCov = liveV2.coverage.find(c => c.sourceId === 'OpenSky');
  assert.ok(openSkyCov);
  assert.equal(openSkyCov.origin, 'snapshot', 'Non-queried source must have origin="snapshot"');
});

test('9. Real-clock serving: freshLiveSnapshot with Date.now() retains Nébih events while filtering stale Meteoalarm', () => {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const served = freshLiveSnapshot(raw, Date.now());

  // 1. Nébih events (unpolicied / offline administrative table) must be completely preserved
  const nebihEvents = served.events.filter(e => e.source?.name === 'Nebih-ASP');
  assert.equal(nebihEvents.length, 4, 'All 4 Nébih events must survive serving under real clock');

  // 2. HAON fixture event must also be preserved
  const haonEvents = served.events.filter(e => e.source?.name === 'HAON-Fixture');
  assert.equal(haonEvents.length, 1, 'HAON fixture event must survive serving under real clock');

  // 3. Stale Meteoalarm events must NOT be in served.events
  const meteoEvents = served.events.filter(e => e.source?.name === 'Meteoalarm');
  assert.equal(meteoEvents.length, 0, 'Stale Meteoalarm events must be filtered out of active events');

  // 4. Stale Meteoalarm events must be moved to served.staleEvents
  assert.ok(Array.isArray(served.staleEvents), 'served.staleEvents must be an array');
  const staleMeteo = served.staleEvents.filter(e => e.source?.name === 'Meteoalarm');
  assert.equal(staleMeteo.length, 4, 'All 4 stale Meteoalarm events must be in staleEvents');
});

test('10. Additive staleEvents: carries views and lifecycle fields but is excluded from active V2.views counters', () => {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const served = freshLiveSnapshot(raw, Date.now());

  // 1. All staleEvents have enriched views, lifecycle, isCancelled
  for (const event of served.staleEvents) {
    assert.match(event.id, /^event-[0-9a-f]{32}$/);
    assert.ok(event.views && typeof event.views === 'object');
    for (const view of Object.values(VIEWS)) {
      assert.ok(event.views[view]);
      assert.equal(typeof event.views[view].inView, 'boolean');
    }
    assert.ok(['active', 'superseded', 'cancelled', 'expired', 'future'].includes(event.lifecycle));
    assert.equal(typeof event.isCancelled, 'boolean');
    assert.ok(['source_stale', 'provider_expired', 'local_freshness_exceeded', 'source_error'].includes(event.staleReason), `Invalid staleReason: ${event.staleReason}`);
  }

  // 2. Active view counters ONLY count active events (served.events), NOT staleEvents
  // Active events: 4 Nébih + 1 Debrecen = 5 events.
  // In local view: 2 Nébih (Bihartorda, Báránd) + 1 Debrecen (key connection) = 3 active items.
  const localView = served.views[VIEWS.LOCAL];
  assert.equal(localView.totalEvents, 3, 'Local view totalEvents must not include stale Meteoalarm events');
  assert.equal(localView.breakdown.confirmedLocal, 2);
  assert.equal(localView.breakdown.keyConnection, 1);
  assert.equal(localView.breakdown.regionalAdvisories, 0, 'Stale regional Meteoalarm warning must not be counted');
});

test('11. Unified freshness threshold: coverage staleness adheres to POLICIES maxAgeMs', () => {
  const now = Date.parse('2026-10-25T12:00:00.000Z');
  const meteoPolicy = POLICIES.Meteoalarm;
  assert.ok(meteoPolicy && meteoPolicy.maxAgeMs === 3 * 3600 * 1000, 'Meteoalarm policy must have 3h maxAgeMs');

  // Case A: 2 hours old (older than 60m, but WITHIN 3h policy) -> NOT stale
  const twoHoursOld = new Date(now - 2 * 3600 * 1000).toISOString();
  const sourceA = { id: 'Meteoalarm', name: 'Meteoalarm', enabled: true, lastUpdated: twoHoursOld };
  const coverageOfflineA = evaluateSourceCoverage([sourceA], [{ source: 'Meteoalarm', title: 'Advisory' }], { now, isOfflineSnapshot: true });
  assert.equal(coverageOfflineA[0].status, COVERAGE_STATES.OFFLINE_SNAPSHOT, 'Source within 3h policy must not be marked stale');
  assert.equal(coverageOfflineA[0].status, 'offline_snapshot');
  assert.equal(coverageOfflineA[0].timeWindow.label, 'snapshot');

  const coverageLiveA = evaluateSourceCoverage([sourceA], [{ source: 'Meteoalarm', title: 'Advisory' }], { now, isOfflineSnapshot: false });
  assert.equal(coverageLiveA[0].status, COVERAGE_STATES.OK_DATA, 'Live source within 3h policy is successful');
  assert.equal(coverageLiveA[0].status, 'ok_data');
  assert.equal(coverageLiveA[0].timeWindow.label, 'active_window');
  assert.equal(coverageLiveA[0].timeWindow.durationMs, 3 * 3600 * 1000, 'timeWindow must reflect policy duration (3h)');

  // Case B: 4 hours old (exceeds 3h policy) -> Stale with exact 180 min error message
  const fourHoursOld = new Date(now - 4 * 3600 * 1000).toISOString();
  const sourceB = { id: 'Meteoalarm', name: 'Meteoalarm', enabled: true, lastUpdated: fourHoursOld };
  const coverageB = evaluateSourceCoverage([sourceB], [{ source: 'Meteoalarm', title: 'Advisory' }], { now, isOfflineSnapshot: true });
  assert.equal(coverageB[0].status, COVERAGE_STATES.STALE_ERROR, 'Source exceeding 3h policy must be marked stale');
  assert.equal(coverageB[0].status, 'stale_error');
  assert.equal(coverageB[0].timeWindow.label, 'stale');
  assert.equal(coverageB[0].timeWindow.durationMs, 4 * 3600 * 1000);
  assert.equal(coverageB[0].error, 'Data is stale (older than 180 minutes)', 'Error message must reflect exact policy');
});

test('12. Briefing reference target lookup: citations resolve against events or staleEvents', () => {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const served = freshLiveSnapshot(raw, Date.now());

  const allAvailableEvents = [...served.events, ...served.staleEvents];
  for (const bullet of raw.briefing.bullets) {
    for (const ref of bullet.refs) {
      const found = allAvailableEvents.find(e => e.id === ref.id);
      assert.ok(found, `Cited ID ${ref.id} must be resolvable in served events or staleEvents`);
    }
  }
});

test('13. Browser QA snapshot generation with relative times writes to non-committed location', () => {
  const browserOutPath = join(ROOT, 'runs/test-package2b-browser/latest.json');
  const result = generatePackage2bSnapshot({ now: Date.now(), outPath: browserOutPath, relativeTimes: true });

  assert.ok(existsSync(browserOutPath), 'Browser test snapshot must exist on disk');
  assert.equal(result.briefingBullets, 2);

  const browserRaw = JSON.parse(readFileSync(browserOutPath, 'utf8'));
  const served = freshLiveSnapshot(browserRaw, Date.now());

  // With relative times, the fresh Meteoalarm events remain in served.events under Date.now()!
  const freshMeteo = served.events.filter(e => e.source?.name === 'Meteoalarm');
  assert.ok(freshMeteo.length > 0, 'Fresh Meteoalarm events generated relative to now must survive real-clock serving');
});

test('14. staleReason precedence order when multiple reasons apply simultaneously', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z');

  // Condition A: Official validUntil expired -> Precedence 1: provider_expired (takes precedence even over source_error)
  const statesErr = new Map([
    ['Meteoalarm', { status: 'error', error: 'Connection refused', timestamp: '2026-10-26T06:00:00.000Z' }]
  ]);
  const eventMultiA = {
    source: { name: 'Meteoalarm' },
    validUntil: '2026-10-26T10:00:00.000Z', // Expired 2h ago
    observedAt: '2026-10-26T06:00:00.000Z'  // Stale (6h old)
  };
  assert.equal(determineStaleReason(eventMultiA, statesErr, now), 'provider_expired', 'provider_expired must take highest precedence as definitive factual expiry');

  // Condition B: Source error when validUntil is unexpired -> Precedence 2: source_error
  const eventMultiB = {
    source: { name: 'Meteoalarm' },
    validUntil: '2026-10-26T18:00:00.000Z', // Unexpired
    observedAt: '2026-10-26T06:00:00.000Z'
  };
  assert.equal(determineStaleReason(eventMultiB, statesErr, now), 'source_error', 'source_error takes precedence over source_stale when unexpired');

  // Condition C: Source is stale, but validUntil not expired (or null) -> Precedence 3: source_stale
  const statesStale = new Map([
    ['Meteoalarm', { status: 'stale', stale: true, timestamp: '2026-10-26T06:00:00.000Z' }]
  ]);
  const eventMultiC = {
    source: { name: 'Meteoalarm' },
    validUntil: '2026-10-26T18:00:00.000Z', // Still valid
    observedAt: '2026-10-26T06:00:00.000Z'  // Stale feed
  };
  assert.equal(determineStaleReason(eventMultiC, statesStale, now), 'source_stale', 'source_stale must be assigned when feed is stale and unexpired');

  // Condition D: Feed is fresh (status ok), but individual item age exceeds observation policy -> Precedence 4: local_freshness_exceeded
  const statesOk = new Map([
    ['Meteoalarm', { status: 'ok', stale: false, timestamp: new Date(now).toISOString() }]
  ]);
  const eventMultiD = {
    source: { name: 'Meteoalarm' },
    validUntil: null, // No explicit expiration
    observedAt: new Date(now - 50 * 3600 * 1000).toISOString() // 50h old, exceeds 48h observationMaxAgeMs
  };
  assert.equal(determineStaleReason(eventMultiD, statesOk, now), 'local_freshness_exceeded', 'local_freshness_exceeded when item exceeds observationMaxAgeMs');
});

test('15. Explicit isFixture protection: test fixtures preserved without relying on POLICIES absence', () => {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

  // 1. All Nébih and Debrecen fixture events carry isFixture: true
  const nebihFixtures = raw.events.filter(e => e.source?.name === 'Nebih-ASP');
  assert.equal(nebihFixtures.length, 4);
  for (const n of nebihFixtures) {
    assert.equal(n.isFixture, true, 'Nébih event must carry explicit isFixture: true');
  }

  const debrecenFixture = raw.events.find(e => e.source?.name === 'HAON-Fixture');
  assert.ok(debrecenFixture);
  assert.equal(debrecenFixture.isFixture, true, 'Debrecen-HAON event must carry explicit isFixture: true');

  // 2. Production normalizer strips arbitrary isFixture from incoming observations
  const testNow = Date.now();
  const spoofedObservations = [{
    source: 'Meteoalarm',
    title: 'Spoofed Fixture Warning',
    observedAt: new Date(testNow).toISOString(),
    isFixture: true // Attempted spoof
  }];
  const normalized = normalizeLiveSources({
    Meteoalarm: {
      source: 'Meteoalarm',
      status: 'ok',
      observedAt: new Date(testNow).toISOString(),
      observations: spoofedObservations
    }
  }, testNow);
  const normalizedObs = normalized.find(s => s.source === 'Meteoalarm')?.observations?.[0];
  assert.ok(normalizedObs, 'Normalized observation must exist');
  assert.equal(normalizedObs.isFixture, undefined, 'normalizeLiveSources must NEVER copy isFixture from live observations');
});

test('16. Live briefing under real clock never cites stale warnings as current statements', async () => {
  const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const served = freshLiveSnapshot(raw, Date.now());

  // Under real clock, Meteoalarm is stale and thus in served.staleEvents, NOT served.events
  const briefingHu = await generateBriefing({ scope: 'HUN', snapshot: served, provider: null, language: 'hu', now: Date.now() });

  assert.ok(briefingHu, 'generateBriefing must return a briefing object');
  assert.equal(briefingHu.source, 'rules');
  assert.equal(briefingHu.scope, 'HUN');

  // Verify that NO bullet in the live briefing cites an event from staleEvents
  const staleIds = new Set(served.staleEvents.map(e => e.id));
  for (const bullet of briefingHu.bullets) {
    for (const ref of bullet.refs) {
      assert.ok(!staleIds.has(ref.id), `Live briefing must never cite a stale event: ${ref.id}`);
    }
  }
});

test('17. ENABLE_SWEEPS=false and offline snapshot strictly enforce origin=snapshot, never live', () => {
  const coverageSources = [
    { id: 'Meteoalarm', name: 'Meteoalarm', domain: 'hazards', enabled: true, status: 'ok', isSnapshot: true },
    { id: 'Nebih-ASP', name: 'Nebih-ASP', domain: 'health', enabled: false, status: 'disabled', isSnapshot: true }
  ];
  const liveSources = [{ source: 'Meteoalarm', status: 'ok', observedAt: new Date().toISOString() }];

  // 1. With isOfflineSnapshot: true, origin is always 'snapshot'
  const covOffline = evaluateSourceCoverage(coverageSources, liveSources, {
    isOfflineSnapshot: true,
    now: Date.now()
  });
  for (const row of covOffline) {
    assert.equal(row.origin, 'snapshot', `Source ${row.sourceId} must have origin='snapshot' when isOfflineSnapshot=true`);
    assert.notEqual(row.origin, 'live', `Source ${row.sourceId} must NEVER have origin='live' when isOfflineSnapshot=true`);
  }

  // 2. Even if liveQueriedSources contains the source, isOfflineSnapshot overrides
  const covOverridden = evaluateSourceCoverage(coverageSources, liveSources, {
    isOfflineSnapshot: true,
    liveQueriedSources: new Set(['Meteoalarm']),
    now: Date.now()
  });
  const meteo = covOverridden.find(s => s.sourceId === 'Meteoalarm');
  assert.ok(meteo, 'Meteoalarm row must exist in coverage');
  assert.equal(meteo.origin, 'snapshot', 'isOfflineSnapshot must strictly override liveQueriedSources');
});

test('18. Served route hardening: freshLiveSnapshot with isOfflineSnapshot forbids live origin across missing isSnapshot and array/object shapes', () => {
  const now = Date.now();
  const liveSources = [
    { source: 'MET-Norway', status: 'ok', observedAt: new Date(now).toISOString(), observations: [] },
    { source: 'Meteoalarm', status: 'ok', observedAt: new Date(now).toISOString(), observations: [] }
  ];

  // Case A: Array format, isSnapshot field completely missing, input claims origin='live'
  const snapArray = {
    liveSources,
    coverage: [
      { sourceId: 'MET-Norway', sourceName: 'MET-Norway', domain: 'hazards', origin: 'live' },
      { sourceId: 'Meteoalarm', sourceName: 'Meteoalarm', domain: 'hazards', origin: 'live' }
    ]
  };
  const servedArray = freshLiveSnapshot(snapArray, now, { isOfflineSnapshot: true });
  assert.ok(Array.isArray(servedArray.coverage), 'Served coverage must be an array');
  assert.equal(servedArray.coverage.length, 2);
  for (const cov of servedArray.coverage) {
    assert.equal(cov.origin, 'snapshot', `Under isOfflineSnapshot, origin must be snapshot: ${cov.sourceId}`);
    assert.equal(cov.isSnapshot, true, `Under isOfflineSnapshot, isSnapshot must be true: ${cov.sourceId}`);
    assert.notEqual(cov.origin, 'live', `Under isOfflineSnapshot, origin must NEVER be live: ${cov.sourceId}`);
  }

  // Case B: Object format dictionary, isSnapshot missing, input claims origin='live'
  const snapObject = {
    liveSources,
    coverage: {
      'MET-Norway': { status: 'ok_empty', origin: 'live' },
      Meteoalarm: { status: 'ok_data', origin: 'live' }
    }
  };
  const servedObject = freshLiveSnapshot(snapObject, now, { isOfflineSnapshot: true });
  assert.ok(Array.isArray(servedObject.coverage), 'Served coverage must normalize object dictionary into array');
  assert.equal(servedObject.coverage.length, 2);
  for (const cov of servedObject.coverage) {
    assert.equal(cov.origin, 'snapshot', `Under isOfflineSnapshot, origin must be snapshot: ${cov.sourceId}`);
    assert.equal(cov.isSnapshot, true, `Under isOfflineSnapshot, isSnapshot must be true: ${cov.sourceId}`);
    assert.notEqual(cov.origin, 'live', `Under isOfflineSnapshot, origin must NEVER be live: ${cov.sourceId}`);
  }
});

