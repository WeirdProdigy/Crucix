import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNebihAsp, evaluateNebihAspNotification, mapAspSeverity } from '../apis/sources/nebih-asp.mjs';
import { resolveSettlement, DEFAULT_TERRITORY_CONFIG } from '../lib/intelligence/territory.mjs';

const readFixture = name => readFileSync(new URL(`./fixtures/nebih/${name}`, import.meta.url), 'utf8');

test('mapAspSeverity accurately categorizes restriction levels without confusing them with clinical outbreaks', () => {
  assert.equal(mapAspSeverity('Fertőzött terület (Szigorúan korlátozott terület: SZKT)'), 'elevated');
  assert.equal(mapAspSeverity('Fertőzött terület (SZKT-n kívüli része)'), 'moderate');
  assert.equal(mapAspSeverity('III-as körzet'), 'high');
  assert.equal(mapAspSeverity('Magas kockázatú terület'), 'low');
  assert.equal(mapAspSeverity('Közepes kockázatú terület'), 'low');
  assert.equal(mapAspSeverity('Ismeretlen kategória'), 'monitor');
});

test('parseNebihAsp extracts baseline records, preserves raw cells, and separates dates', () => {
  const html = readFixture('fixture_asp_minimal_baseline.html');
  const now = Date.parse('2026-10-23T08:00:00Z');
  const res = parseNebihAsp(html, { now });

  assert.equal(res.status, 'ok');
  assert.equal(res.observations.length, 4);

  // Find Bihartorda
  const bihartorda = res.observations.find(o => o.raw.settlement === 'Bihartorda');
  assert.ok(bihartorda, 'Bihartorda record must exist');

  // Verify dates
  assert.equal(res.referenceDate, '2026-10-12', 'Reference date extracted from column header');
  assert.equal(res.sourceUpdatedAt, '2026-10-20T00:00:00Z', 'Page updated date extracted from text');
  assert.equal(res.harvestedAt, '2026-10-23T08:00:00.000Z', 'Harvested timestamp recorded');
  assert.equal(bihartorda.territorialMatching.validUntil, null, 'validUntil is strictly null (no synthetic expiry)');
  assert.equal(bihartorda.validUntil, undefined, 'validUntil is undefined on record root to prevent false expiry filtering');

  // Verify raw cell values preserved
  assert.equal(bihartorda.raw.settlement, 'Bihartorda');
  assert.equal(bihartorda.raw.county, 'Hajdú-Bihar');
  assert.equal(bihartorda.raw.riskCategory, 'Fertőzött terület (SZKT-n kívüli része)');
  assert.equal(bihartorda.raw.coveragePercent, '100');
  assert.equal(bihartorda.raw.vgeCode, '904960');

  // Verify namespaces
  assert.equal(bihartorda.territorialMatching.kshSettlementCode, '29887');
  assert.equal(bihartorda.territorialMatching.matching_certainty, 'exact_name_and_county_match');
  assert.equal(bihartorda.territorialMatching.point_in_polygon, true);
  assert.equal(bihartorda.territorialMatching.official_assignment_percentage, 100);
  assert.deepEqual(bihartorda.huntingDistrict, { namespace: 'VGE', code: '904960' });

  // Verify briefing text phrasing
  assert.ok(bihartorda.summary.includes('Hatósági területi besorolás, nem házisertés-kitörés'), 'Must distinguish administrative zone from clinical outbreak');
  assert.equal(bihartorda.level, 'moderate');

  // Verify stable key format
  assert.equal(bihartorda.stableKey, 'ASP|afrikai_sertes_pestis|hajdu_bihar|bihartorda|2026_10_12');
});

test('first run baseline establishes state and generates NO alerts', () => {
  const html = readFixture('fixture_asp_minimal_baseline.html');
  const res = parseNebihAsp(html);
  const bihartorda = res.observations.find(o => o.raw.settlement === 'Bihartorda');

  const evalResult = evaluateNebihAspNotification(bihartorda, { isFirstRun: true });
  assert.equal(evalResult.eligible, false, 'Baseline must not trigger an alert');
  assert.equal(evalResult.action, 'baseline');
});

test('repeated sweep with identical records deduplicates and suppresses alerts', () => {
  const html = readFixture('fixture_asp_minimal_baseline.html');
  const res = parseNebihAsp(html);
  const bihartorda = res.observations.find(o => o.raw.settlement === 'Bihartorda');

  const evalResult = evaluateNebihAspNotification(bihartorda, { previousRecord: bihartorda, isFirstRun: false });
  assert.equal(evalResult.eligible, false, 'Unchanged record must not trigger an alert');
  assert.equal(evalResult.action, 'unchanged');
});

test('classification change triggers restriction_update alert', () => {
  const baselineHtml = readFixture('fixture_asp_minimal_baseline.html');
  const changedHtml = readFixture('fixture_asp_category_changed.html');

  const baselineRes = parseNebihAsp(baselineHtml);
  const changedRes = parseNebihAsp(changedHtml);

  const prevBihartorda = baselineRes.observations.find(o => o.raw.settlement === 'Bihartorda');
  const currBihartorda = changedRes.observations.find(o => o.raw.settlement === 'Bihartorda');

  assert.equal(currBihartorda.raw.riskCategory, 'Fertőzött terület (Szigorúan korlátozott terület: SZKT)');
  assert.equal(currBihartorda.level, 'elevated');

  const evalResult = evaluateNebihAspNotification(currBihartorda, { previousRecord: prevBihartorda, isFirstRun: false });
  assert.equal(evalResult.eligible, true, 'Category escalation must trigger an alert');
  assert.equal(evalResult.action, 'category_changed');
  assert.equal(evalResult.alertType, 'restriction_update');
  assert.ok(evalResult.reason.includes('Fertőzött terület (SZKT-n kívüli része)'));
  assert.ok(evalResult.reason.includes('Szigorúan korlátozott terület'));
});

test('vanished record is marked vanished_unverified and strictly forbids clearance alert', () => {
  const baselineHtml = readFixture('fixture_asp_minimal_baseline.html');
  const vanishedHtml = readFixture('fixture_asp_vanished_row.html');

  const baselineRes = parseNebihAsp(baselineHtml);
  const vanishedRes = parseNebihAsp(vanishedHtml);

  const prevBihartorda = baselineRes.observations.find(o => o.raw.settlement === 'Bihartorda');
  const currentBihartorda = vanishedRes.observations.find(o => o.raw.settlement === 'Bihartorda');

  assert.equal(currentBihartorda, undefined, 'Bihartorda is missing from vanished fixture');

  // Evaluate vanished record state
  const vanishedRecord = { ...prevBihartorda, isVanished: true, action: 'vanished_unverified' };
  const evalResult = evaluateNebihAspNotification(vanishedRecord, { previousRecord: prevBihartorda });

  assert.equal(evalResult.eligible, false, 'Vanished record must never trigger an automatic clearance alert');
  assert.equal(evalResult.action, 'vanished_unverified');
  assert.ok(evalResult.reason.includes('hatósági feloldás nem igazolt'));
});

test('duplicate rows with identical stable key in same table receive deterministic indexing', () => {
  const html = readFixture('fixture_asp_duplicate_keys.html');
  const res = parseNebihAsp(html);

  const bihartordaRows = res.observations.filter(o => o.raw.settlement === 'Bihartorda');
  assert.equal(bihartordaRows.length, 2, 'Two duplicate rows must be parsed');

  assert.equal(bihartordaRows[0].stableKey, 'ASP|afrikai_sertes_pestis|hajdu_bihar|bihartorda|2026_10_12');
  assert.equal(bihartordaRows[1].stableKey, 'ASP|afrikai_sertes_pestis|hajdu_bihar|bihartorda|2026_10_12#2');
  assert.notEqual(bihartordaRows[0].id, bihartordaRows[1].id, 'Distinct event IDs must be assigned');
});

test('ambiguous territorial identity is marked ambiguous_identity and review-only', () => {
  const html = readFixture('fixture_asp_ambiguous_settlement.html');
  const res = parseNebihAsp(html);

  const ambiguous = res.observations.find(o => o.raw.settlement === 'IsmeretlenUjfalu');
  assert.ok(ambiguous, 'Ambiguous record must be parsed');
  assert.equal(ambiguous.territorialMatching.kshSettlementCode, null, 'No guessed KSH code allowed');

  const evalResult = evaluateNebihAspNotification(ambiguous);
  assert.equal(evalResult.eligible, false, 'Ambiguous identity must not trigger an alert');
});

test('schema drift triggers schema_drift_detected and requests review', () => {
  const html = readFixture('fixture_asp_schema_drift.html');
  const res = parseNebihAsp(html);

  assert.equal(res.status, 'schema_drift_detected');
  const evalResult = evaluateNebihAspNotification(res);
  assert.equal(evalResult.action, 'schema_drift_detected');
  assert.equal(evalResult.eligible, true);
  assert.equal(evalResult.alertType, 'system_review');
});

test('empty table triggers empty_table_anomaly without false clearance', () => {
  const html = readFixture('fixture_asp_empty_table.html');
  const res = parseNebihAsp(html);

  assert.equal(res.status, 'empty_table_anomaly');
  const evalResult = evaluateNebihAspNotification(res);
  assert.equal(evalResult.action, 'empty_table_anomaly');
  assert.equal(evalResult.eligible, false);
});
