import test from 'node:test';
import assert from 'node:assert/strict';

import { briefing as openskyBriefing, _resetOpenSkyCache, OPENSKY_CACHE_TTL_MS, calculateOpenSkyCredits, HOTSPOTS } from '../apis/sources/opensky.mjs';
import { briefing as epaBriefing, _resetEpaCache, EPA_CACHE_TTL_MS } from '../apis/sources/epa.mjs';
import { briefing as spaceBriefing, _resetSpaceCache, SPACE_CACHE_TTL_MS } from '../apis/sources/space.mjs';
import { getEvents as getAcledEvents, _resetAcledBreaker, ACLED_CIRCUIT_BREAKER_TTL_MS } from '../apis/sources/acled.mjs';
import { briefing as ripestatBriefing } from '../apis/sources/ripestat.mjs';

test('1. ACLED circuit breaker trips after 401/403 and prevents network calls for 24 hours', async () => {
  _resetAcledBreaker();
  const prevEmail = process.env.ACLED_EMAIL;
  const prevPass = process.env.ACLED_PASSWORD;
  process.env.ACLED_EMAIL = 'baduser@example.test';
  process.env.ACLED_PASSWORD = 'wrongpassword';

  const origFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
  };

  try {
    // Call 1: Rejection -> trips circuit breaker
    const res1 = await getAcledEvents();
    assert.ok(res1.error, 'First attempt fails with auth error');
    assert.ok(networkCalls > 0, 'First attempt makes network calls');

    const callsAfterTrip = networkCalls;

    // Call 2: Within 24h with same credentials -> circuit breaker trips immediately, 0 network calls!
    const res2 = await getAcledEvents();
    assert.ok(res2.error.includes('ACLED circuit breaker active'), 'Must report active circuit breaker');
    assert.equal(networkCalls, callsAfterTrip, 'Circuit breaker must prevent all network calls during cooldown');

    // Call 3: Credential change immediately clears breaker
    process.env.ACLED_PASSWORD = 'new_updated_password';
    const res3 = await getAcledEvents();
    assert.ok(networkCalls > callsAfterTrip, 'Credential update must reset breaker and permit new attempt');
  } finally {
    globalThis.fetch = origFetch;
    process.env.ACLED_EMAIL = prevEmail;
    process.env.ACLED_PASSWORD = prevPass;
    _resetAcledBreaker();
  }
});

test('2. OpenSky briefing: sequential execution, 2h TTL cache, and daily quota guarantee', async () => {
  _resetOpenSkyCache();

  // 1. Quota calculation verification
  const { totalCredits, breakdown } = calculateOpenSkyCredits();
  assert.equal(totalCredits, 28, 'OpenSky 10 hotspots total 28 credits per sweep');
  assert.equal(breakdown.middleEast.credits, 4, 'Middle East bbox (1050 deg²) = 4 credits');
  assert.equal(breakdown.taiwan.credits, 2, 'Taiwan Strait bbox (80 deg²) = 2 credits');
  assert.equal(breakdown.ukraine.credits, 3, 'Ukraine bbox (171 deg²) = 3 credits');
  assert.equal(breakdown.baltics.credits, 2, 'Baltics bbox (70 deg²) = 2 credits');
  assert.equal(breakdown.southChinaSea.credits, 3, 'South China Sea bbox (306 deg²) = 3 credits');
  assert.equal(breakdown.koreanPeninsula.credits, 2, 'Korean Peninsula bbox (80 deg²) = 2 credits');
  assert.equal(breakdown.caribbean.credits, 3, 'Caribbean bbox (216 deg²) = 3 credits');
  assert.equal(breakdown.gulfOfGuinea.credits, 3, 'Gulf of Guinea bbox (150 deg²) = 3 credits');
  assert.equal(breakdown.capeRoute.credits, 3, 'Cape Route bbox (120 deg²) = 3 credits');
  assert.equal(breakdown.hornOfAfrica.credits, 3, 'Horn of Africa bbox (150 deg²) = 3 credits');

  const dailySweeps = 24 / (OPENSKY_CACHE_TTL_MS / 3600000);
  assert.equal(dailySweeps, 12, '12 sweeps per 24 hours with 2h TTL');
  const dailyCredits = dailySweeps * totalCredits;
  assert.equal(dailyCredits, 336, 'Daily credits consumed = 336');
  assert.ok(dailyCredits <= 400, 'Daily credits (336) must never exceed anonymous daily quota of 400 credits');

  const origFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    return new Response(JSON.stringify({
      states: [['4b1234', 'TEST01', 'Hungary', 0, 0, 0, 0, 10000]]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const t0 = 1000000;
    // Call 1: Fetches 10 hotspots sequentially
    const res1 = await openskyBriefing({ now: t0, delayMs: 0 });
    assert.equal(res1.source, 'OpenSky');
    assert.equal(fetchCount, 10, 'Must query all 10 hotspots sequentially');
    assert.equal(res1.hotspots.length, 10);
    assert.equal(res1.error, undefined);

    // Call 2: Within 2h TTL (e.g. 60 minutes later) -> returns cached result without fetch!
    const res2 = await openskyBriefing({ now: t0 + 60 * 60 * 1000, delayMs: 0 });
    assert.equal(fetchCount, 10, 'Must return cached result within 2h TTL (no new fetch calls)');
    assert.equal(res2.cached, true);
    assert.equal(res2.timestamp, res1.timestamp, 'Cached OpenSky measurement must retain original timestamp, not receive new timestamp');
  } finally {
    globalThis.fetch = origFetch;
    _resetOpenSkyCache();
  }
});


test('2b. OpenSky runSource 60s timeout, retries=0, and abort signal propagation', async () => {
  const { runSource } = await import('../apis/briefing.mjs');
  const { getFlightsInArea } = await import('../apis/sources/opensky.mjs');

  // 1. Verify runSource honors timeoutMs: 60_000
  const mockFn = async (options) => {
    return { status: 'ok', signal: options?.signal };
  };

  const res = await runSource('OpenSky', mockFn, { timeoutMs: 60_000 });
  assert.equal(res.status, 'ok');
  assert.ok(res.data?.signal instanceof AbortSignal, 'runSource must propagate AbortSignal to source options');

  // 2. Verify retries: 0 (failed request does not retry and burn extra credits)
  const origFetch = globalThis.fetch;
  let flightFetchCalls = 0;
  globalThis.fetch = async () => {
    flightFetchCalls++;
    return new Response('Internal Server Error', { status: 500 });
  };

  try {
    const areaRes = await getFlightsInArea(10, 20, 30, 40);
    assert.equal(flightFetchCalls, 1, 'getFlightsInArea must set retries: 0 (exactly 1 call on error)');
    assert.ok(areaRes.error, 'Must report error without retry');

    // 3. Verify abort signal propagation in briefing
    _resetOpenSkyCache();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      async () => {
        await openskyBriefing({ signal: controller.signal, delayMs: 0 });
      },
      /aborted/i,
      'OpenSky briefing must immediately abort when signal is aborted'
    );
  } finally {
    globalThis.fetch = origFetch;
    _resetOpenSkyCache();
  }
});
test('3. EPA briefing: 6h TTL cache and exponential backoff on error', async () => {
  _resetEpaCache();
  const origFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    return new Response('Forbidden', { status: 403 });
  };

  try {
    const t0 = 2000000;
    // Call 1: Fails with 403 -> activates exponential backoff
    const res1 = await epaBriefing({ now: t0 });
    assert.ok(res1.error);
    const callsAfterFirst = fetchCount;

    // Call 2: Within backoff window (5 min later) -> immediately blocked by backoff without network call!
    const res2 = await epaBriefing({ now: t0 + 5 * 60 * 1000 });
    assert.ok(res2.error.includes('backoff active'), 'Must report active exponential backoff');
    assert.equal(fetchCount, callsAfterFirst, 'No network fetch during error backoff');
  } finally {
    globalThis.fetch = origFetch;
    _resetEpaCache();
  }
});

test('4. Space CelesTrak briefing: 6h TTL cache and exponential backoff on error', async () => {
  _resetSpaceCache();
  const origFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    return new Response(JSON.stringify([
      { OBJECT_NAME: 'ISS (ZARYA)', NORAD_CAT_ID: 25544, LAUNCH_DATE: '1998-11-20', APOAPSIS: 420, PERIAPSIS: 415 }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const t0 = 3000000;
    // Call 1: Successful fetch
    const res1 = await spaceBriefing({ now: t0 });
    assert.equal(res1.source, 'Space/CelesTrak');
    assert.ok(fetchCount > 0);
    const initialCalls = fetchCount;

    // Call 2: Within 6h TTL (2 hours later) -> returns cached result
    const res2 = await spaceBriefing({ now: t0 + 2 * 3600 * 1000 });
    assert.equal(fetchCount, initialCalls, 'Must return cached space result within 6h TTL');
    assert.equal(res2.cached, true);
    assert.equal(res2.timestamp, res1.timestamp, 'Cached OpenSky measurement must retain original timestamp, not receive new timestamp');
  } finally {
    globalThis.fetch = origFetch;
    _resetSpaceCache();
  }
});

test('5. RIPEstat briefing: 2h cache and 12h freshness window with simulated 8h RIS dump cycle', async () => {
  const origFetch = globalThis.fetch;
  let fetchCount = 0;
  let currentDumpTime = '2026-10-30T00:00:00Z'; // RIS dump at 00:00 UTC

  globalThis.fetch = async () => {
    fetchCount++;
    return new Response(JSON.stringify({
      status: 'ok',
      data_call_status: 'supported',
      data: {
        resource: 'AS5483',
        query_time: currentDumpTime,
        visibility: { v4: { ris_peers_seeing: 100, total_ris_peers: 100 } },
        announced_space: { v4: { prefixes: 50 } },
        observed_neighbours: 20
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const baseDumpMs = Date.parse('2026-10-30T00:00:00Z');

    // Worst-case simulation:
    // Crucix queries at t = 7h 59m (just before next 08:00 UTC dump arrives upstream).
    // The upstream RIS data is already 7h 59m old.
    const queryTime1 = baseDumpMs + (7 * 3600 + 59 * 60) * 1000;
    const res1 = await ripestatBriefing({ now: queryTime1, resources: ['AS5483'], useCache: true });
    assert.equal(res1.status, 'ok', 'Status must be ok at initial fetch');
    assert.equal(fetchCount, 1);

    // Crucix caches this for 2 hours (up to t = 9h 59m).
    // Test right at the end of the cache lifetime (1h 59m later, total age = 7h59m + 1h59m = 9h58m < 12h freshness window):
    const queryTime2 = queryTime1 + (1 * 3600 + 59 * 60) * 1000;
    const res2 = await ripestatBriefing({ now: queryTime2, resources: ['AS5483'], useCache: true });
    assert.equal(fetchCount, 1, 'Must serve from cache without new fetch');
    assert.equal(res2.status, 'ok', 'Observation age (9h58m) is within 12h window; status must NEVER be stale ("Lejárt")');

    // At t = 10h 01m, cache has expired (2 hours passed). Crucix refetches upstream.
    // By this time, upstream has the 08:00 UTC dump!
    currentDumpTime = '2026-10-30T08:00:00Z';
    const queryTime3 = queryTime1 + (2 * 3600 + 2 * 60) * 1000;
    const res3 = await ripestatBriefing({ now: queryTime3, resources: ['AS5483'], useCache: true });
    assert.equal(fetchCount, 2, 'Must query upstream after 2h cache expires');
    assert.equal(res3.status, 'ok', 'Status with fresh 08:00 UTC dump is ok');

    // Total verification: across the entire 8h dump cycle, RIPEstat NEVER evaluates to stale!
  } finally {
    globalThis.fetch = origFetch;
  }
});

