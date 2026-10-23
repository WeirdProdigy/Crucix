import test from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/nebih-asp.mjs';

test('Nébih ASP live smoke test: DISABLED (feltételek nem tisztázottak; döntés/megkeresés szükséges)', async () => {
  // Live network fetching is disabled by policy until official public reuse terms are clarified.
  const result = await briefing();
  assert.equal(result.status, 'disabled');
  assert.equal(result.disabled, true);
  assert.equal(result.legalStatus, 'feltételek nem tisztázottak; döntés/megkeresés szükséges');
  assert.ok(result.reason.includes('Élő hálózati lekérés letiltva'));
});
