import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseNebihAsp,
  evaluateNebihAspNotification,
  mapAspSeverity,
  makeNebihAspKey
} from '../apis/sources/nebih-asp.mjs';
import { EntityStore } from '../lib/intelligence/entities.mjs';
import { generateBriefing } from '../lib/llm/briefing.mjs';

const readFixture = name => readFileSync(new URL(`./fixtures/nebih/${name}`, import.meta.url), 'utf8');

// Rögzített teszt-időkonstansok (nem forrásbeli időpontok, kifejezetten reprodukálható offline tesztfuttatáshoz)
const FIXED_TEST_CLOCK_0800_MS = Date.parse('2026-10-23T08:00:00.000Z');
const FIXED_TEST_CLOCK_0830_MS = Date.parse('2026-10-23T08:30:00.000Z');

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
  const res = parseNebihAsp(html, { now: FIXED_TEST_CLOCK_0800_MS });

  assert.equal(res.status, 'ok');
  assert.equal(res.observations.length, 4);

  // Find Bihartorda
  const bihartorda = res.observations.find(o => o.raw.settlement === 'Bihartorda');
  assert.ok(bihartorda, 'Bihartorda record must exist');

  // Verify dates: nap pontosságú stringek, nincs mesterséges T00:00:00Z
  assert.equal(res.referenceDate, '2026-10-12', 'Reference date extracted from column header');
  assert.equal(res.sourceUpdatedAt, '2026-10-20', 'Page updated date extracted from text with day precision');
  assert.equal(res.harvestedAt, '2026-10-23T08:00:00.000Z', 'Harvested timestamp recorded from test clock');
  assert.equal(bihartorda.territorialMatching.validUntil, null, 'validUntil is strictly null (no synthetic expiry)');
  assert.equal(bihartorda.validUntil, undefined, 'validUntil is undefined on record root to prevent false expiry filtering');

  // Verify raw cell values preserved
  assert.equal(bihartorda.raw.settlement, 'Bihartorda');
  assert.equal(bihartorda.raw.county, 'Hajdú-Bihar');
  assert.equal(bihartorda.raw.riskCategory, 'Fertőzött terület (SZKT-n kívüli része)');
  assert.equal(bihartorda.raw.coveragePercent, '100');
  assert.equal(bihartorda.raw.vgeCode, '904960');

  // Geometriai állapot név/vármegye illesztésnél:
  // point_in_polygon: null (nem false; false csak tényleges negatív geometriai vizsgálatra)
  // geometryCheckStatus: 'not_evaluated'
  // boundary_status: 'unverified'
  // matching_certainty: 'exact_name_and_county_match'
  assert.equal(bihartorda.territorialMatching.kshSettlementCode, '29887');
  assert.equal(bihartorda.territorialMatching.matching_certainty, 'exact_name_and_county_match');
  assert.equal(bihartorda.territorialMatching.point_in_polygon, null, 'Name-based match has null point_in_polygon (not evaluated)');
  assert.equal(bihartorda.territorialMatching.geometryCheckStatus, 'not_evaluated', 'Geometry check status is explicitly not_evaluated');
  assert.equal(bihartorda.territorialMatching.boundary_status, 'unverified', 'Boundary status must remain unverified for name match');
  assert.equal(bihartorda.source.url, 'https://portal.nebih.gov.hu/asp_telepulesek', 'URL must be the authentic portal page without synthetic query params');
  assert.equal(bihartorda.levelCalculation, 'crucix_calculated', 'Severity level must be explicitly marked as Crucix-calculated');
  assert.equal(bihartorda.territorialMatching.official_assignment_percentage, 100);
  assert.deepEqual(bihartorda.huntingDistrict, { namespace: 'VGE', code: '904960' });

  // Verify facts and labels
  const factMap = new Map(bihartorda.facts.map(f => [f.label, f.value]));
  assert.equal(factMap.get('hatosagiBesorolas'), 'Fertőzött terület (SZKT-n kívüli része)');
  assert.equal(factMap.get('crucixBelsoSzint'), 'moderate (Crucix belső szint)');
  assert.equal(factMap.get('vonatkozasDatum'), '2026-10-12');
  assert.equal(factMap.get('oldalFrissitesDatum'), '2026-10-20');
  assert.equal(factMap.get('geometriaStatusz'), 'not_evaluated');

  // Verify briefing text phrasing
  assert.ok(bihartorda.summary.includes('nem klinikai kitörés és nem humán kockázat'), 'Must distinguish administrative zone from clinical outbreak');
  assert.equal(bihartorda.level, 'moderate');

  // Verify stable key format: settlement + county + VGE (nincs benne referenceDate)
  assert.equal(bihartorda.stableKey, 'ASP|afrikai_sertes_pestis|hajdu_bihar|bihartorda|904960');
});

test('scopeToWatched filters persistent observations to watched territorial catalog while validating all rows', () => {
  const html = readFixture('fixture_asp_minimal_baseline.html');
  const scoped = parseNebihAsp(html, { scopeToWatched: true });

  assert.equal(scoped.examinedRecords, 4, 'All 4 rows must be examined during table validation');
  assert.equal(scoped.observations.length, 3, 'Only 3 catalog settlements emitted as persistent observations');
  assert.ok(scoped.observations.find(o => o.raw.settlement === 'Bihartorda'));
  assert.ok(scoped.observations.find(o => o.raw.settlement === 'Püspökladány'));
  assert.ok(scoped.observations.find(o => o.raw.settlement === 'Báránd'));
  assert.equal(scoped.observations.find(o => o.raw.settlement === 'Aba'), undefined, 'Aba is outside watched catalog');
});

test('first run baseline establishes state and generates NO alerts', () => {
  const html = readFixture('fixture_asp_minimal_baseline.html');
  const res = parseNebihAsp(html);
  const bihartorda = res.observations.find(o => o.raw.settlement === 'Bihartorda');

  const evalResult = evaluateNebihAspNotification(bihartorda, { isFirstRun: true });
  assert.equal(evalResult.eligible, false, 'Baseline must not trigger an alert');
  assert.equal(evalResult.action, 'baseline');
});

test('Test A: unchanged data with new header date maintains entity and yields action: unchanged', () => {
  const htmlBaseline = readFixture('fixture_asp_minimal_baseline.html');
  const resBaseline = parseNebihAsp(htmlBaseline);
  const bihartordaBaseline = resBaseline.observations.find(o => o.raw.settlement === 'Bihartorda');

  // Simulate new sweep where header date advanced to 2026.10.25 but settlement data is identical
  const htmlNewDate = htmlBaseline.replace('KOCKAZATI BESOROLAS 2026.10.12', 'KOCKAZATI BESOROLAS 2026.10.25');
  const resNewDate = parseNebihAsp(htmlNewDate);
  const bihartordaNewDate = resNewDate.observations.find(o => o.raw.settlement === 'Bihartorda');

  assert.equal(bihartordaNewDate.stableKey, bihartordaBaseline.stableKey, 'StableKey must be identical across date bumps');
  const evalResult = evaluateNebihAspNotification(bihartordaNewDate, { previousRecord: bihartordaBaseline, isFirstRun: false });
  assert.equal(evalResult.eligible, false, 'Unchanged data with new header date must not alert');
  assert.equal(evalResult.action, 'unchanged');
});

test('Test B: new date with modified category updates same entity with action: category_changed', () => {
  const baselineHtml = readFixture('fixture_asp_minimal_baseline.html');
  const changedHtml = readFixture('fixture_asp_category_changed.html');

  const baselineRes = parseNebihAsp(baselineHtml);
  const changedRes = parseNebihAsp(changedHtml);

  const prevBihartorda = baselineRes.observations.find(o => o.raw.settlement === 'Bihartorda');
  const currBihartorda = changedRes.observations.find(o => o.raw.settlement === 'Bihartorda');

  assert.equal(currBihartorda.stableKey, prevBihartorda.stableKey, 'StableKey remains the same on category change');
  assert.equal(currBihartorda.raw.riskCategory, 'Fertőzött terület (Szigorúan korlátozott terület: SZKT)');
  assert.equal(currBihartorda.level, 'elevated');

  const evalResult = evaluateNebihAspNotification(currBihartorda, { previousRecord: prevBihartorda, isFirstRun: false });
  assert.equal(evalResult.eligible, true, 'Category change triggers alert for primary settlement');
  assert.equal(evalResult.action, 'category_changed');
  assert.equal(evalResult.alertType, 'restriction_update');
  assert.ok(evalResult.reason.includes('Fertőzött terület (SZKT-n kívüli része)'));
  assert.ok(evalResult.reason.includes('Szigorúan korlátozott terület'));
});

test('Test C: multiple VGE rows for same settlement receive distinct deterministic stable keys without collision', () => {
  const key1 = makeNebihAspKey('Bihartorda', 'Hajdú-Bihar', '904960');
  const key2 = makeNebihAspKey('Bihartorda', 'Hajdú-Bihar', '904961');

  assert.equal(key1, 'ASP|afrikai_sertes_pestis|hajdu_bihar|bihartorda|904960');
  assert.equal(key2, 'ASP|afrikai_sertes_pestis|hajdu_bihar|bihartorda|904961');
  assert.notEqual(key1, key2, 'Distinct VGE codes must yield distinct stable keys for same settlement');
});

test('Test D: table row reordering does not affect output entity keys and content', () => {
  const html = readFixture('fixture_asp_minimal_baseline.html');
  const res1 = parseNebihAsp(html);

  // Swap the first two <tr> data rows
  const matchRow1 = html.match(/<tr>\s*<td>Bihartorda<\/td>[\s\S]*?<\/tr>/);
  const matchRow2 = html.match(/<tr>\s*<td>Püspökladány<\/td>[\s\S]*?<\/tr>/);
  assert.ok(matchRow1 && matchRow2, 'Data rows found in baseline fixture');

  const swappedHtml = html.replace(matchRow1[0], '<!--SWAP_PLACEHOLDER-->')
                          .replace(matchRow2[0], matchRow1[0])
                          .replace('<!--SWAP_PLACEHOLDER-->', matchRow2[0]);

  const res2 = parseNebihAsp(swappedHtml);

  assert.equal(res1.status, 'ok');
  assert.equal(res2.status, 'ok');
  assert.equal(res1.observations.length, res2.observations.length);

  const keys1 = res1.observations.map(o => o.stableKey).sort();
  const keys2 = res2.observations.map(o => o.stableKey).sort();
  assert.deepEqual(keys1, keys2, 'Reordering rows produces identical set of stable keys');
});

test('Test E: ambiguous territorial identity is marked ambiguous_identity and review-only with alerts suppressed', () => {
  const html = readFixture('fixture_asp_ambiguous_settlement.html');
  const res = parseNebihAsp(html);

  const ambiguous = res.observations.find(o => o.raw.settlement === 'IsmeretlenUjfalu');
  assert.ok(ambiguous, 'Ambiguous record must be parsed');
  assert.equal(ambiguous.territorialMatching.kshSettlementCode, null, 'No guessed KSH code allowed');

  const evalResult = evaluateNebihAspNotification(ambiguous);
  assert.equal(evalResult.eligible, false, 'Ambiguous identity must strictly suppress notifications');
  assert.equal(evalResult.action, 'review_only');
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

test('duplicate rows with identical settlement, county and VGE receive deterministic indexing', () => {
  // Construct HTML with 2 rows having the EXACT same settlement, county and VGE code
  const html = `
    <table>
      <thead>
        <tr>
          <th>Település</th>
          <th>Megye</th>
          <th>Kockázati besorolás 2026.10.12</th>
          <th>Kockázati besorolás aránya a településen (%)</th>
          <th>A kockázati besorolást meghatározó vadgazdálkodási egység kódja</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Bihartorda</td><td>Hajdú-Bihar</td><td>Fertőzött terület (SZKT-n kívüli része)</td><td>60</td><td>904960</td></tr>
        <tr><td>Bihartorda</td><td>Hajdú-Bihar</td><td>Magas kockázatú terület</td><td>40</td><td>904960</td></tr>
      </tbody>
    </table>
  `;
  const res = parseNebihAsp(html);

  const bihartordaRows = res.observations.filter(o => o.raw.settlement === 'Bihartorda');
  assert.equal(bihartordaRows.length, 2, 'Two duplicate rows must be parsed');

  assert.equal(bihartordaRows[0].stableKey, 'ASP|afrikai_sertes_pestis|hajdu_bihar|bihartorda|904960');
  assert.equal(bihartordaRows[1].stableKey, 'ASP|afrikai_sertes_pestis|hajdu_bihar|bihartorda|904960#2');
  assert.notEqual(bihartordaRows[0].id, bihartordaRows[1].id, 'Distinct event IDs must be assigned');
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

test('Negative regression test: single ASP restriction record never produces unfounded national risk score and trend claim', async () => {
  const html = readFixture('fixture_asp_minimal_baseline.html');
  const parsed = parseNebihAsp(html, { now: FIXED_TEST_CLOCK_0800_MS });
  const bihartorda = parsed.observations.find(o => o.raw.settlement === 'Bihartorda');
  assert.ok(bihartorda);

  const store = new EntityStore();
  const aspEvent = {
    id: bihartorda.id,
    title: bihartorda.title,
    summary: bihartorda.summary,
    kind: bihartorda.kind,
    level: bihartorda.level,
    time: FIXED_TEST_CLOCK_0800_MS,
    countries: ['HUN'],
    source: 'nebih-asp',
    location: {
      country: 'Hungary',
      region: 'Hajdú-Bihar'
    }
  };
  store.ingest([aspEvent]);

  // Snapshot with single ASP event and a synthetic/heuristic country risk score for Hungary
  const snapshot = {
    events: [aspEvent],
    risk: {
      top: [
        { iso3: 'HUN', score: 25, change24h: 0 }
      ]
    }
  };

  const briefing = await generateBriefing({
    scope: 'HUN',
    snapshot,
    store,
    language: 'hu',
    now: FIXED_TEST_CLOCK_0830_MS
  });

  // Verify that NO bullet contains unfounded national score claim
  const nationalScoreBullet = briefing.bullets.find(b => b.text.includes('kockázati pontszám'));
  assert.equal(nationalScoreBullet, undefined, 'A single ASP settlement record must NOT produce or cite an unfounded national risk score sentence');

  // Verify the ASP bullet details: settlement, original classification, coverage %, dates, URL, and non-outbreak wording
  const aspBullet = briefing.bullets.find(b => b.text.includes('Bihartorda'));
  assert.ok(aspBullet, 'ASP event bullet must be present');
  assert.ok(aspBullet.text.includes('Bihartorda'), 'Contains settlement name');
  assert.ok(aspBullet.text.includes('Fertőzött terület (SZKT-n kívüli része)'), 'Contains original raw classification');
  assert.ok(aspBullet.text.includes('100%'), 'Contains coverage percentage');
  assert.ok(aspBullet.text.includes('2026-10-12'), 'Contains reference date');
  assert.ok(aspBullet.text.includes('2026-10-20'), 'Contains page update date');
  assert.ok(aspBullet.text.includes('https://portal.nebih.gov.hu/asp_telepulesek'), 'Contains authentic URL');
  assert.ok(aspBullet.text.includes('nem klinikai kitörés és nem humán kockázat'), 'Explicitly states it is not a clinical outbreak or human risk');
});
