import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNebihAsp, evaluateNebihAspNotification } from '../apis/sources/nebih-asp.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';

const readFixture = name => readFileSync(new URL(`./fixtures/nebih/${name}`, import.meta.url), 'utf8');

test('Nébih ASP end-to-end integration: ingestion, persistence, restart recovery, deduplication, and facts verification', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-nebih-asp-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const nowMs = Date.parse('2026-10-23T08:00:00Z');
  const history = new HistoryStore(dir, { now: () => nowMs });

  // 1. Parse fixture
  const html = readFixture('fixture_asp_minimal_baseline.html');
  const parsed = parseNebihAsp(html, { now: nowMs });
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
    territorialMatching: obs.territorialMatching,
    huntingDistrict: obs.huntingDistrict,
    raw: obs.raw,
    facts: obs.facts
  }));

  // Ingest into HistoryStore
  history.add(events);
  assert.equal(history.query().total, 4, '4 ASP events stored in history');

  // Find Bihartorda event
  const bihartorda = events.find(e => e.raw.settlement === 'Bihartorda');
  const storedBihartorda = history.get(bihartorda.id);
  assert.ok(storedBihartorda, 'Stored Bihartorda event found');
  assert.equal(storedBihartorda.title, 'Nébih ASP besorolás: Bihartorda - Fertőzött terület (SZKT-n kívüli része)');
  assert.ok(storedBihartorda.summary.includes('Hatósági területi besorolás, nem házisertés-kitörés'));

  // 2. Restart Store from same directory (persistence verification)
  const restarted = new HistoryStore(dir, { now: () => nowMs + 60000 });
  const restoredBihartorda = restarted.get(bihartorda.id);
  assert.ok(restoredBihartorda, 'Bihartorda record successfully restored from disk after restart');
  assert.equal(restoredBihartorda.title, storedBihartorda.title);
  assert.equal(restoredBihartorda.publishedAt, '2026-10-20T00:00:00.000Z');
  assert.equal(restoredBihartorda.observedAt, '2026-10-12T00:00:00.000Z');

  // 3. Re-ingestion deduplication check
  restarted.add(events);
  assert.equal(restarted.query().total, 4, 'Repeated ingestion must deduplicate and NOT increase total event count');

  // 4. Notification evaluation check on baseline vs change
  const baselineEval = evaluateNebihAspNotification(bihartorda, { isFirstRun: true });
  assert.equal(baselineEval.eligible, false);
  assert.equal(baselineEval.action, 'baseline');

  const unchangedEval = evaluateNebihAspNotification(bihartorda, { previousRecord: bihartorda });
  assert.equal(unchangedEval.eligible, false);
  assert.equal(unchangedEval.action, 'unchanged');
});
