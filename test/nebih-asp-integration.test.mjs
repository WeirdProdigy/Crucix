import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNebihAsp, evaluateNebihAspNotification } from '../apis/sources/nebih-asp.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';

const readFixture = name => readFileSync(new URL(`./fixtures/nebih/${name}`, import.meta.url), 'utf8');

// Rögzített teszt-időkonstansok (nem forrásbeli időpontok)
const FIXED_TEST_CLOCK_0800_MS = Date.parse('2026-10-23T08:00:00.000Z');
const FIXED_TEST_CLOCK_0801_MS = Date.parse('2026-10-23T08:01:00.000Z');

test('Nébih ASP end-to-end integration: ingestion, persistence, restart recovery, deduplication, and facts verification', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-nebih-asp-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const history = new HistoryStore(dir, { now: () => FIXED_TEST_CLOCK_0800_MS });

  // 1. Parse fixture
  const html = readFixture('fixture_asp_minimal_baseline.html');
  const parsed = parseNebihAsp(html, { now: FIXED_TEST_CLOCK_0800_MS });
  assert.equal(parsed.status, 'ok');

  // Convert observations to history event format
  const events = parsed.observations.map(obs => ({
    id: obs.id,
    kind: obs.kind,
    title: obs.title,
    summary: obs.summary,
    source: obs.source,
    observedAt: obs.observedAt,
    publishedAt: obs.publishedAt,
    collectedAt: obs.harvestedAt,
    severity: obs.level,
    territory: obs.territorialMatching,
    territorialMatching: obs.territorialMatching,
    huntingDistrict: obs.huntingDistrict,
    raw: obs.raw,
    facts: obs.facts
  }));

  // Ingest Bihartorda into HistoryStore
  const bihartorda = events.find(e => e.raw.settlement === 'Bihartorda');
  history.add([bihartorda]);
  assert.equal(history.query().total, 1, '1 Bihartorda ASP event stored in history');

  const storedBihartorda = history.get(bihartorda.id);
  assert.ok(storedBihartorda, 'Stored Bihartorda event found');
  assert.equal(storedBihartorda.title, 'Nébih ASP besorolás: Bihartorda - Fertőzött terület (SZKT-n kívüli része)');
  assert.ok(storedBihartorda.summary.includes('nem klinikai kitörés és nem humán kockázat'));
  assert.equal(storedBihartorda.source.url, 'https://portal.nebih.gov.hu/asp_telepulesek', 'Must be authentic portal page URL');
  assert.equal(storedBihartorda.territory.point_in_polygon, null, 'Name-based match has null point_in_polygon');
  assert.equal(storedBihartorda.territory.geometryCheckStatus, 'not_evaluated', 'Geometry status is explicitly not_evaluated');
  assert.equal(storedBihartorda.territory.boundary_status, 'unverified', 'Boundary status must be unverified');
  assert.equal(storedBihartorda.territory.matching_certainty, 'exact_name_and_county_match');

  // 2. Restart Store from same directory (persistence verification / Test F)
  const restarted = new HistoryStore(dir, { now: () => FIXED_TEST_CLOCK_0801_MS });
  const restoredBihartorda = restarted.get(bihartorda.id);
  assert.ok(restoredBihartorda, 'Bihartorda record successfully restored from disk after restart');
  assert.equal(restoredBihartorda.title, storedBihartorda.title);
  assert.equal(restoredBihartorda.publishedAt, '2026-10-20', 'Preserves day precision string from source');
  assert.equal(restoredBihartorda.observedAt, '2026-10-12', 'Preserves day precision string from source');
  assert.equal(restoredBihartorda.firstSeenAt, '2026-10-23T08:00:00.000Z', 'firstSeenAt established by local store on first observation');

  // 3. Re-ingestion deduplication check
  restarted.add([bihartorda]);
  assert.equal(restarted.query().total, 1, 'Repeated ingestion must deduplicate and NOT increase total event count');

  // 4. Test F: Baseline restart recovery - follow-up evaluation against restored baseline
  const baselineFollowupEval = evaluateNebihAspNotification(bihartorda, {
    previousRecord: restoredBihartorda,
    isFirstRun: false
  });
  assert.equal(baselineFollowupEval.eligible, false, 'Restart must preserve baseline and not trigger false initial-run alert');
  assert.equal(baselineFollowupEval.action, 'unchanged');

  // 5. Notification evaluation check on baseline vs change vs vanished
  const baselineEval = evaluateNebihAspNotification(bihartorda, { isFirstRun: true });
  assert.equal(baselineEval.eligible, false);
  assert.equal(baselineEval.action, 'baseline');

  const unchangedEval = evaluateNebihAspNotification(bihartorda, { previousRecord: bihartorda });
  assert.equal(unchangedEval.eligible, false);
  assert.equal(unchangedEval.action, 'unchanged');

  // Vanished record evaluation
  const vanishedRecord = { ...bihartorda, isVanished: true, action: 'vanished_unverified' };
  const vanishedEval = evaluateNebihAspNotification(vanishedRecord, { previousRecord: bihartorda });
  assert.equal(vanishedEval.eligible, false, 'Vanished record must never trigger clearance alert');
  assert.equal(vanishedEval.action, 'vanished_unverified');
  assert.ok(vanishedEval.reason.includes('hatósági feloldás nem igazolt'));
});
