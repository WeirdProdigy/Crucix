import test from 'node:test';
import assert from 'node:assert/strict';
import { briefing, parseNebihAsp } from '../apis/sources/nebih-asp.mjs';

test('Nébih ASP live smoke test: fetches live portal endpoint and verifies real Bihartorda record', { timeout: 30000 }, async () => {
  const result = await briefing();

  assert.equal(result.status, 'ok', `Live fetch must succeed with status 'ok' (error: ${result.error})`);
  assert.ok(result.examinedRecords && result.examinedRecords > 3000, `Expected > 3000 live settlement records examined, received ${result.examinedRecords}`);
  assert.equal(result.observations.length, 100, 'Payload capped to top 100 prioritized observations per Crucix policy');

  // Find Bihartorda in live data
  const bihartorda = result.observations.find(o => o.raw?.settlement === 'Bihartorda' && o.raw?.county === 'Hajdú-Bihar');
  assert.ok(bihartorda, 'Bihartorda must exist in the official Nébih live ASP table');

  assert.equal(bihartorda.territorialMatching.kshSettlementCode, '29887');
  assert.equal(bihartorda.territorialMatching.countyCode, '09');
  assert.equal(bihartorda.territorialMatching.matching_certainty, 'exact_name_and_county_match');
  assert.equal(bihartorda.territorialMatching.point_in_polygon, true);
  assert.equal(bihartorda.huntingDistrict.namespace, 'VGE');
  assert.equal(bihartorda.huntingDistrict.code, '904960');
  assert.equal(bihartorda.raw.riskCategory, 'Fertőzött terület (SZKT-n kívüli része)');
  assert.equal(bihartorda.raw.coveragePercent, '100');

  assert.ok(bihartorda.summary.includes('Hatósági területi besorolás, nem házisertés-kitörés'));
});
