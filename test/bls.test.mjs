import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefing, _resetBlsCache, BLS_CACHE_TTL_MS } from '../apis/sources/bls.mjs';

test('BLS briefing TTL cache prevents exceeding 25 req/day keyless quota', async () => {
  _resetBlsCache();

  assert.equal(BLS_CACHE_TTL_MS, 12 * 60 * 60 * 1000, 'BLS cache TTL is exactly 12 hours');

  let mockNetworkCalls = 0;
  const mockFetch = async () => {
    mockNetworkCalls++;
    return new Response(JSON.stringify({
      status: 'REQUEST_SUCCEEDED',
      responseTime: 120,
      message: [],
      Results: {
        series: [
          {
            seriesID: 'LNS14000000',
            data: [
              { year: '2026', period: 'M09', periodName: 'September', value: '4.1' },
              { year: '2026', period: 'M08', periodName: 'August', value: '4.2' }
            ]
          }
        ]
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const t0 = 1793300000000;
    // 1. Initial call: network fetch
    const res1 = await briefing(null, { now: t0 });
    assert.equal(mockNetworkCalls, 1, 'First call fetches from network');
    assert.equal(res1.source, 'BLS');
    assert.equal(res1.cached, undefined, 'First call is fresh (not cached)');
    assert.equal(res1.indicators[0].value, 4.1);

    // 2. Second call 15 minutes later (standard sweep interval): cache hit
    const t15m = t0 + 15 * 60 * 1000;
    const res2 = await briefing(null, { now: t15m });
    assert.equal(mockNetworkCalls, 1, 'Second call within 15 min does not make network request');
    assert.equal(res2.cached, true, 'Second call is served from cache');
    assert.equal(res2.indicators[0].value, 4.1);

    // 3. Third call 6 hours later (half TTL): still cache hit
    const t6h = t0 + 6 * 60 * 60 * 1000;
    const res3 = await briefing(null, { now: t6h });
    assert.equal(mockNetworkCalls, 1, 'Call at 6h still served from cache');
    assert.equal(res3.cached, true);

    // 4. Fourth call 12 hours + 1 ms later: cache expired, re-fetch
    const t12h = t0 + BLS_CACHE_TTL_MS + 1000;
    const res4 = await briefing(null, { now: t12h });
    assert.equal(mockNetworkCalls, 2, 'Call after 12h re-fetches from network');
    assert.equal(res4.cached, undefined, 'Fresh result returned');

    // 5. Bypass cache option
    const res5 = await briefing(null, { now: t12h + 1000, bypassCache: true });
    assert.equal(mockNetworkCalls, 3, 'bypassCache forces fresh network fetch');

    // 6. Reset cache
    _resetBlsCache();
    const res6 = await briefing(null, { now: t12h + 2000 });
    assert.equal(mockNetworkCalls, 4, 'After reset, next call fetches fresh');
  } finally {
    globalThis.fetch = originalFetch;
    _resetBlsCache();
  }
});
