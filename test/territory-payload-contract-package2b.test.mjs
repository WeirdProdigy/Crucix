import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
import { freshLiveSnapshot } from '../lib/intelligence/live-sources.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { DEFAULT_TERRITORY_CONFIG } from '../lib/intelligence/territory.mjs';
import { createBriefingService } from '../lib/llm/briefing.mjs';
import { generatePackage2bSnapshot } from '../scripts/generate-package2b-snapshot.mjs';

const SNAPSHOT_PATH = join(process.cwd(), 'test/fixtures/runs-test-package2b/latest.json');

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
  assert.equal(meteo.status, COVERAGE_STATES.OFFLINE_PILLANATKEP);

  const nebih = coverage.find(s => s.sourceId === 'Nebih-ASP');
  assert.ok(nebih, 'Nebih-ASP must be in coverage');
  assert.equal(nebih.origin, 'snapshot');
  assert.equal(nebih.status, COVERAGE_STATES.LETILTOTT);

  const haon = coverage.find(s => s.sourceId === 'HAON');
  assert.ok(haon, 'HAON must be in coverage');
  assert.equal(haon.origin, 'snapshot');
  assert.equal(haon.status, COVERAGE_STATES.NINCS_FORRAS, 'HAON must have nincs_forrás (with á)');
  assert.equal(haon.status, 'nincs_forrás');
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
