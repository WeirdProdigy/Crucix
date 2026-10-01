import test from 'node:test';
import assert from 'node:assert/strict';
import { providerTime, freshness, freshResult, unavailableResult } from '../apis/utils/freshness.mjs';
import { parseXml } from '../apis/utils/xml.mjs';
const now = Date.parse('2026-10-01T21:00:00Z');
test('provider dates are strict; naive times require explicit UTC declaration', () => {
  assert.equal(providerTime('2026-02-30'), null);
  assert.equal(providerTime('2026-10-01T25:00:00Z'), null);
  assert.equal(providerTime('2026-10-01T16:00:00'), null);
  assert.equal(providerTime('2026-10-01T16:00:00', { assumeUTC: true }), '2026-10-01T16:00:00.000Z');
  assert.equal(providerTime('2026-10-01T20:50:32.123456Z'), '2026-10-01T20:50:32.123Z');
  assert.equal(providerTime('Thu, 01 Oct 2026 20:55:02 GMT'), '2026-10-01T20:55:02.000Z');
  assert.equal(providerTime('Mon, 05 Oct 2026 21:00:00 +9600'), null);
});
test('unknown, old and future observations fail closed', () => {
  for (const value of [null, '2026-09-01', '2026-10-02']) assert.equal(freshness(value, 3600000, now).fresh, false);
  assert.equal(freshness('2026-10-01T20:50:00Z', 3600000, now).fresh, true);
});
test('fresh feed cannot revive stale, unknown or expired individual observations', () => {
  const rows = [
    { id:'good', observedAt:'2026-10-01T20:00:00Z' },
    { id:'old', observedAt:'2026-09-01' },
    { id:'expired', observedAt:'2026-10-01T20:00:00Z', validUntil:'2026-10-01T20:30:00Z' },
    { id:'unknown' },
  ];
  const out = freshResult('Meteoalarm', '2026-10-01T20:45:00Z', rows, {}, now);
  assert.equal(out.status, 'ok'); assert.deepEqual(out.observations.map(r=>r.id), ['good']);
  assert.equal(freshResult('Meteoalarm', '2026-09-01', rows, {}, now).observations.length, 0);
  assert.equal(freshResult('Meteoalarm', null, [], {}, now).status, 'stale');
  assert.equal(unavailableResult('GDACS', 'Unavailable', {}, now).status, 'error');
});
test('XML keeps attributes and namespaces while refusing DTDs, deep and malformed input', () => {
  assert.equal(parseXml('<a:x xmlns:a="urn:a" v="1"><y>hello &amp; world</y></a:x>').x.y, 'hello & world');
  for (const xml of ['<!DOCTYPE x [<!ENTITY e "bad">]><x>&e;</x>', '<x><y></x>', '<x>'.repeat(60)+'</x>'.repeat(60)]) assert.throws(()=>parseXml(xml));
});
test('current MET forecasts require a bounded target and valid forecast interval',()=>{
  const row={kind:'forecast',observedAt:'2026-10-01T19:00:00Z',forecastAt:'2026-10-01T21:00:00Z',validUntil:'2026-10-01T22:00:00Z'};
  assert.equal(freshResult('MET-Norway',row.observedAt,[row],{},now).observations.length,1);
  for(const forecastAt of [undefined,'bad','2026-09-01','2099-01-01','2026-10-01T23:00:00Z']) assert.equal(freshResult('MET-Norway',row.observedAt,[{...row,forecastAt}],{},now).observations.length,0);
  assert.equal(freshResult('MET-Norway',row.observedAt,[{...row,validUntil:null}],{},now).observations.length,0);
});
