import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { briefing as safecast, resetState } from '../apis/sources/safecast.mjs';

// api.safecast.org answers about half of its requests with an instant HTTP 502 and needs ~14 s
// for the rest, so one sweep (30 s source cap) refreshes two sites and the others come from a
// bounded cache whose age is always reported.
const NOW = Date.parse('2026-10-02T12:00:00Z');
const MINUTE = 60000, HOUR = 3600000;
const KEYS = ['zaporizhzhia', 'chernobyl', 'bushehr', 'yongbyon', 'fukushima', 'dimona'];
const SITE_AT = { 47.51: 'zaporizhzhia', 51.39: 'chernobyl', 28.83: 'bushehr', 39.8: 'yongbyon', 37.42: 'fukushima', 31: 'dimona' };
const reading = (value, minutesAgo = 10) => ({ id: Math.round(value * 1000 + minutesAgo), value, unit: 'cpm', captured_at: new Date(Date.now() - minutesAgo * MINUTE).toISOString() });
const bad = status => new Response('upstream error', { status });

function provider(t, behaviour) {
  const calls = [];
  t.mock.restoreAll();
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  resetState();
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    const key = SITE_AT[Number(url.searchParams.get('latitude'))];
    const attempt = calls.filter(call => call.key === key).length + 1;
    calls.push({ key, url, headers: init?.headers, at: Date.now() });
    const result = await behaviour(key, attempt);
    return result instanceof Response ? result : Response.json(result);
  });
  return calls;
}

// Advances the mocked clock while the sweep waits for retry delays and slow responses.
async function sweep(t) {
  let done = false;
  const pending = safecast().finally(() => { done = true; });
  for (let i = 0; i < 400 && !done; i++) { await nextTurn(); t.mock.timers.tick(250); }
  return pending;
}
const statuses = result => result.sites.map(site => site.status);

test('Safecast refreshes two sites per sweep and serves the rest from a cache with explicit age', async t => {
  const calls = provider(t, () => [reading(30), reading(40), reading(50)]);
  const first = await sweep(t);
  assert.deepEqual(calls.map(call => call.key).sort(), ['chernobyl', 'zaporizhzhia']);
  assert.deepEqual(first.sites.map(site => site.key), KEYS, 'The dashboard pairs sites with map markers by index');
  assert.deepEqual(statuses(first), ['fresh', 'fresh', 'pending', 'pending', 'pending', 'pending']);
  assert.equal(first.sites[0].recentReadings, 3);
  assert.equal(first.sites[0].avgCPM, 40);
  assert.equal(first.sites[0].maxCPM, 50);
  assert.equal(JSON.stringify(first).includes('"error"'), false, 'Sites that are not due yet are not failures');

  t.mock.timers.tick(15 * MINUTE);
  const second = await sweep(t);
  assert.deepEqual(calls.slice(2).map(call => call.key).sort(), ['bushehr', 'yongbyon']);
  assert.deepEqual(statuses(second), ['cached', 'cached', 'fresh', 'fresh', 'pending', 'pending']);
  assert.equal(second.sites[0].ageMinutes, 15);
  assert.equal(second.sites[2].ageMinutes, 0);
  assert.equal(second.sites[0].avgCPM, 40, 'Cached readings keep their values');

  t.mock.timers.tick(15 * MINUTE);
  const third = await sweep(t);
  assert.deepEqual(calls.slice(4).map(call => call.key).sort(), ['dimona', 'fukushima']);
  assert.deepEqual(statuses(third), ['cached', 'cached', 'cached', 'cached', 'fresh', 'fresh']);
  assert.match(third.signals[0], /6 of 6/);

  t.mock.timers.tick(15 * MINUTE);
  await sweep(t);
  assert.deepEqual(calls.slice(6).map(call => call.key).sort(), ['chernobyl', 'zaporizhzhia'], 'The least recently attempted sites are due again');
});

test('Safecast asks only for recent, non-future cpm readings near the site', async t => {
  const calls = provider(t, () => []);
  await sweep(t);
  const { url, headers } = calls.find(call => call.key === 'zaporizhzhia');
  assert.equal(url.origin, 'https://api.safecast.org');
  assert.equal(url.pathname, '/measurements.json');
  assert.equal(url.searchParams.get('unit'), 'cpm');
  assert.equal(url.searchParams.get('order'), 'captured_at desc');
  assert.equal(url.searchParams.get('distance'), '100000', 'The radius is sent in metres');
  assert.equal(url.searchParams.get('captured_after'), new Date(NOW - 72 * HOUR).toISOString());
  assert.equal(url.searchParams.get('captured_before'), new Date(NOW + 5 * MINUTE).toISOString(), 'Devices with a wrong clock report year 2080');
  assert.match(headers['User-Agent'], /Crucix/);
});

test('Safecast ignores readings dated in the future, too old, in other units or malformed', async t => {
  provider(t, key => key === 'zaporizhzhia'
    ? [{ ...reading(999), captured_at: '2080-01-10T05:16:28.000Z' }, reading(40, 10), reading(500, 100 * 60), { ...reading(70), unit: 'usv' },
      { ...reading(60), captured_at: 'not a date' }, { ...reading(60), value: 'NaN' }, { ...reading(60), value: -3 }]
    : [{ ...reading(35), captured_at: '2080-01-11T10:30:15.000Z' }]);
  const { sites } = await sweep(t);
  assert.equal(sites[0].recentReadings, 1);
  assert.equal(sites[0].avgCPM, 40);
  assert.equal(sites[0].maxCPM, 40);
  assert.equal(sites[0].lastReading, new Date(NOW - 10 * MINUTE).toISOString());
  assert.equal(sites[0].anomaly, false);
  assert.equal(sites[1].status, 'no-recent-readings', 'A healthy provider without current readings is not an error');
  assert.equal(sites[1].recentReadings, 0);
  assert.equal(sites[1].avgCPM, null);
  assert.equal(sites[1].lastReading, null);
  assert.equal(JSON.stringify(sites[1]).includes('"error"'), false);
});

test('Safecast retries instant gateway errors but stops when a slow response could no longer finish', async t => {
  const calls = provider(t, (_key, attempt) => attempt < 3 ? bad(502) : [reading(30)]);
  const result = await sweep(t);
  assert.deepEqual(statuses(result).slice(0, 2), ['fresh', 'fresh']);
  assert.equal(calls.length, 6, 'Each due site needed three attempts');
  assert.equal(result.sites[0].refreshError, undefined);

  const failing = provider(t, () => bad(502));
  const failed = await sweep(t);
  assert.deepEqual(statuses(failed), ['unavailable', 'unavailable', 'pending', 'pending', 'pending', 'pending']);
  assert.match(failed.sites[0].error, /HTTP 502/);
  assert.equal(failed.sites[0].recentReadings, 0);
  assert.equal(failed.sites[0].avgCPM, null);
  assert.ok(failing.length >= 6 && failing.length <= 16, `Attempts stay bounded (${failing.length})`);
  const last = failing.at(-1);
  assert.ok(last.at - NOW <= 10500, 'No attempt starts when a ~15 s answer could not arrive within the 27 s sweep budget');
  assert.doesNotMatch(failed.signals.join(' '), /below|threshold/i, 'Nothing is called normal when nothing is current');
});

test('Safecast does not retry access or rate-limit refusals', async t => {
  for (const status of [403, 429]) {
    const calls = provider(t, () => bad(status));
    const result = await sweep(t);
    assert.equal(calls.length, 2, `HTTP ${status} is attempted once per due site`);
    assert.match(result.sites[0].error, new RegExp(`HTTP ${status}`));
  }
});

test('Safecast keeps cached readings when a refresh fails and reports the failure without an error', async t => {
  let failing = false;
  provider(t, () => failing ? bad(502) : [reading(40)]);
  for (let i = 0; i < 3; i++) { await sweep(t); t.mock.timers.tick(15 * MINUTE); }
  failing = true;
  const result = await sweep(t);
  assert.deepEqual(statuses(result), ['cached', 'cached', 'cached', 'cached', 'cached', 'cached']);
  assert.equal(result.sites[0].refreshError, 'HTTP 502', 'The failed refresh of the oldest sites is visible');
  assert.equal(result.sites[0].avgCPM, 40);
  assert.equal(result.sites[0].ageMinutes, 45);
  assert.equal(JSON.stringify(result).includes('"error"'), false, 'Usable cached data is not a source failure');
});

test('Safecast drops cached readings older than three hours instead of presenting them as current', async t => {
  let failing = false;
  provider(t, () => failing ? bad(502) : [reading(40)]);
  for (let i = 0; i < 3; i++) { await sweep(t); t.mock.timers.tick(15 * MINUTE); }
  failing = true;
  t.mock.timers.tick(3 * HOUR);
  const result = await sweep(t);
  assert.deepEqual(statuses(result), ['unavailable', 'unavailable', 'pending', 'pending', 'pending', 'pending']);
  for (const site of result.sites) {
    assert.equal(site.recentReadings, 0);
    assert.equal(site.avgCPM, null);
  }
  assert.match(result.sites[0].error, /HTTP 502/);
  assert.doesNotMatch(result.signals.join(' '), /below|threshold/i);
});

test('Safecast flags elevated readings and keeps the flag stable while the data is cached', async t => {
  provider(t, key => key === 'zaporizhzhia' ? [reading(120), reading(180)] : [reading(20)]);
  const first = await sweep(t);
  assert.equal(first.sites[0].anomaly, true);
  assert.equal(first.signals[0], 'ELEVATED RADIATION at Zaporizhzhia NPP (Ukraine): 150.0 CPM (normal: 10-80)');
  assert.equal(first.sites[1].anomaly, false);

  t.mock.timers.tick(15 * MINUTE);
  const second = await sweep(t);
  assert.equal(second.sites[0].status, 'cached');
  assert.equal(second.sites[0].anomaly, true, 'A failed or skipped refresh does not reset the flag and cause repeated alerts');
  assert.equal(second.signals[0], 'ELEVATED RADIATION at Zaporizhzhia NPP (Ukraine): 150.0 CPM (normal: 10-80; checked 15 min ago)');
});

test('Safecast summarises coverage honestly when some sites have no current readings', async t => {
  provider(t, () => [reading(20)]);
  const partial = await sweep(t);
  assert.match(partial.signals.join(' '), /2 of 6 monitored sites are below the 100 CPM threshold/);
  assert.match(partial.signals.join(' '), /No current readings: Bushehr NPP \(Iran\)/);

  provider(t, () => []);
  const none = await sweep(t);
  assert.equal(none.signals[0], 'No current radiation readings from any monitored site');
});
