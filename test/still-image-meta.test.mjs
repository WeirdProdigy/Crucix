import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StillImageMetaService, DEFAULT_META_TIMEOUT_MS, DEFAULT_META_CACHE_TTL_MS } from '../lib/intelligence/still-image-meta.mjs';

const mockRegistry = [
  {
    id: 'schumann-resonance-cumiana',
    name: 'Schumann-rezonancia és ELF spektrogram (Cumiana)',
    sourceType: 'still-image',
    imageUrl: 'http://www.vlf.it/cumiana/last-geomar.jpg'
  },
  {
    id: 'debrecen-nagytemplom',
    name: 'Debrecen Kossuth tér és Nagytemplom',
    sourceType: 'webcam',
    imageUrl: 'https://cam.idokep.hu/nagytemplom.jpg'
  },
  {
    id: 'm1-hirado-live',
    name: 'M1 Híradó Élő',
    sourceType: 'youtube',
    videoId: 'abcdefghijk'
  }
];

test('StillImageMetaService: rejects missing, unknown, or non-still-image stream IDs (SSRF protection)', async () => {
  const service = new StillImageMetaService({ getRegistry: () => mockRegistry });

  // 1. Missing streamId
  const missing = await service.getMetadata();
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);

  // 2. Unknown streamId
  const unknown = await service.getMetadata('non-existent-stream');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, 404);

  // 3. SSRF attempt with full URL
  const ssrf = await service.getMetadata('http://169.254.169.254/latest/meta-data/');
  assert.equal(ssrf.ok, false);
  assert.equal(ssrf.status, 404);

  // 4. Existing stream, but wrong sourceType (webcam instead of still-image)
  const webcam = await service.getMetadata('debrecen-nagytemplom');
  assert.equal(webcam.ok, false);
  assert.equal(webcam.status, 404);

  // 5. Existing stream, but youtube sourceType
  const yt = await service.getMetadata('m1-hirado-live');
  assert.equal(yt.ok, false);
  assert.equal(yt.status, 404);
});

test('StillImageMetaService: fetches HEAD, extracts Last-Modified, and caches for 5 minutes', async () => {
  let fetchCount = 0;
  const mockFetch = async (url, opts) => {
    fetchCount++;
    assert.equal(url, 'http://www.vlf.it/cumiana/last-geomar.jpg');
    assert.equal(opts.method, 'HEAD');
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        'last-modified': 'Sat, 07 Nov 2026 09:30:00 GMT'
      })
    };
  };

  const service = new StillImageMetaService({
    getRegistry: () => mockRegistry,
    fetchFn: mockFetch
  });

  const baseTime = new Date('2026-11-07T09:35:00Z').getTime();

  // 1. Initial call (cache miss)
  const res1 = await service.getMetadata('schumann-resonance-cumiana', { now: baseTime });
  assert.equal(res1.ok, true);
  assert.equal(res1.status, 200);
  assert.equal(res1.lastModified, 'Sat, 07 Nov 2026 09:30:00 GMT');
  assert.equal(res1.cached, false);
  assert.equal(fetchCount, 1);
  assert.equal(service.getCacheSize(), 1);

  // 2. Subsequent call within 5 minutes (cache hit at baseTime + 4 min)
  const res2 = await service.getMetadata('schumann-resonance-cumiana', { now: baseTime + 4 * 60 * 1000 });
  assert.equal(res2.ok, true);
  assert.equal(res2.lastModified, 'Sat, 07 Nov 2026 09:30:00 GMT');
  assert.equal(res2.cached, true);
  assert.equal(fetchCount, 1, 'Did not invoke fetch on cache hit');

  // 3. Subsequent call after 5 minutes (cache expired at baseTime + 5 min 1 sec)
  const res3 = await service.getMetadata('schumann-resonance-cumiana', { now: baseTime + 5 * 60 * 1000 + 1000 });
  assert.equal(res3.ok, true);
  assert.equal(res3.cached, false);
  assert.equal(fetchCount, 2, 'Invoked fetch after cache expiration');
});

test('StillImageMetaService: error handling on upstream timeout and network failures', async () => {
  // 1. Upstream timeout simulation
  const timeoutFetch = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    throw err;
  };

  const serviceTimeout = new StillImageMetaService({
    getRegistry: () => mockRegistry,
    fetchFn: timeoutFetch
  });

  const resTimeout = await serviceTimeout.getMetadata('schumann-resonance-cumiana');
  assert.equal(resTimeout.ok, false);
  assert.equal(resTimeout.status, 502);
  assert.match(resTimeout.error, /Időtúllépés/);

  // 2. Upstream HTTP 500 error
  const http500Fetch = async () => ({
    ok: false,
    status: 500,
    headers: new Headers()
  });

  const service500 = new StillImageMetaService({
    getRegistry: () => mockRegistry,
    fetchFn: http500Fetch
  });

  const res500 = await service500.getMetadata('schumann-resonance-cumiana');
  assert.equal(res500.ok, false);
  assert.equal(res500.status, 502);
  assert.match(res500.error, /HTTP 500/);

  // 3. Network connection refused / DNS failure
  const netErrFetch = async () => {
    throw new Error('connect ECONNREFUSED 192.0.2.1:80');
  };

  const serviceNetErr = new StillImageMetaService({
    getRegistry: () => mockRegistry,
    fetchFn: netErrFetch
  });

  const resNetErr = await serviceNetErr.getMetadata('schumann-resonance-cumiana');
  assert.equal(resNetErr.ok, false);
  assert.equal(resNetErr.status, 502);
  assert.match(resNetErr.error, /Hálózati hiba/);
});
