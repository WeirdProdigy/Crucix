import test from 'node:test';
import assert from 'node:assert/strict';
import { briefing, getSDNMetadata, getSDNAdvanced, getConsolidatedMetadata } from '../apis/sources/ofac.mjs';

const LIMIT = 64 * 1024;
const ENTRY = '<sdnEntry><uid>36</uid><lastName>Sample Entity</lastName><sdnType>Entity</sdnType><programList><program>CUBA</program></programList></sdnEntry>';
const SDN = `<sdnList><Publish_Date>08/07/2026</Publish_Date><Record_Count>19199</Record_Count>${ENTRY}</sdnList>`;
const ADVANCED = '<Sanctions><DateOfIssue CalendarTypeID="1"><Year>2026</Year><Month>8</Month><Day>7</Day></DateOfIssue></Sanctions>';

test('OFAC requests a bounded range and retains authoritative header totals', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /\/SDN\.XML$/);
    assert.equal(options.headers.Range, 'bytes=0-65535');
    return new Response(SDN, { status: 206, headers: { 'content-range': `bytes 0-${Buffer.byteLength(SDN) - 1}/28809039` } });
  });
  const result = await getSDNMetadata();
  assert.equal(result.publishDate, '08/07/2026');
  assert.equal(result.recordCount, 19199);
  assert.equal(result.entryCount, null);
  assert.equal(result.sampleEntryCount, 1);
  assert.equal(result.sampleBytes, Buffer.byteLength(SDN));
  assert.equal(result.totalBytes, 28809039);
  assert.equal(result.partial, true);
  assert.equal(result.sampled, true);
  assert.equal(result.rangeHonored, true);
});

test('OFAC cuts off an oversized transport chunk even when Range is ignored', async t => {
  let pulls = 0;
  let cancelled = false;
  const prefix = SDN.padEnd(LIMIT, ' ');
  const beyondLimit = '<sdnEntry><uid>999</uid><lastName>Outside sample</lastName></sdnEntry>';
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(Buffer.from(prefix + beyondLimit));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { status: 200 }));
  const result = await getSDNMetadata();
  assert.equal(result.sampleBytes, LIMIT);
  assert.equal(result.dataSize, LIMIT);
  assert.equal(result.sampleEntryCount, 1);
  assert.equal(result.entryCount, null);
  assert.equal(result.partial, true);
  assert.equal(result.rangeHonored, false);
  assert.equal(pulls, 1);
  assert.equal(cancelled, true);
});

test('OFAC stops pulling an unbounded stream once 64 KiB have been sampled', async t => {
  let pulls = 0;
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(Buffer.from((pulls === 1 ? SDN : '').padEnd(8192, ' ')));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { status: 200 }));
  const result = await getSDNMetadata();
  assert.equal(result.sampleBytes, LIMIT);
  assert.equal(pulls, 8);
  assert.equal(cancelled, true);
});

test('OFAC briefing reuses exactly two export samples and samples SDN rather than advanced data', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return new Response(url.endsWith('/SDN.XML') ? SDN : ADVANCED);
  });
  const result = await briefing();
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(url => url.endsWith('/SDN.XML')).length, 1);
  assert.equal(calls.filter(url => url.endsWith('/SDN_ADVANCED.XML')).length, 1);
  assert.equal(result.sdnList.recordCount, 19199);
  assert.equal(result.sdnList.entryCount, null);
  assert.equal(result.advancedList.publishDate, '2026-08-07');
  assert.equal(result.advancedList.recordCount, null);
  assert.equal(result.advancedList.entryCount, null);
  assert.deepEqual(result.sampleEntries, [{ uid: '36', name: 'Sample Entity', type: 'Entity', programs: ['CUBA'] }]);
  assert.match(result.sampleEntriesNote, /not recent additions/);
  assert.equal(result.coverage, 'metadata-and-prefix-sample');
});

test('OFAC does not infer full-list counts from sample entries or malformed count text', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(`<sdnList><Record_Count>12oops</Record_Count>${ENTRY}</sdnList>`));
  const result = await getSDNMetadata();
  assert.equal(result.recordCount, null);
  assert.equal(result.entryCount, null);
  assert.equal(result.sampleEntryCount, 1);
});

test('OFAC does not report a truncated SDN entry as a complete sample entry', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<sdnList><sdnEntry><uid>1</uid>', { status: 206 }));
  const result = await getSDNMetadata();
  assert.equal(result.sampleEntryCount, 0);
  assert.equal(result.partial, true);
});

test('OFAC rejects invalid advanced publication dates', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<Sanctions><DateOfIssue><Year>2026</Year><Month>2</Month><Day>30</Day></DateOfIssue></Sanctions>'));
  const result = await getSDNAdvanced();
  assert.equal(result.publishDate, null);
});

test('OFAC recognizes a complete small 200 response while keeping counts explicitly sampled', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(SDN, { headers: { 'content-length': String(Buffer.byteLength(SDN)) } }));
  const result = await getSDNMetadata();
  assert.equal(result.partial, false);
  assert.equal(result.sampled, true);
  assert.equal(result.totalBytes, Buffer.byteLength(SDN));
  assert.equal(result.entryCount, null);
});

test('OFAC consolidated metadata uses the same bounded sampler', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /\/CONS_ADVANCED\.XML$/);
    assert.equal(options.headers.Range, 'bytes=0-65535');
    return new Response(ADVANCED);
  });
  assert.equal((await getConsolidatedMetadata()).publishDate, '2026-08-07');
});

test('OFAC request failures remain visible and do not echo upstream bodies', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('upstream body must not be forwarded', { status: 403 }));
  const result = await briefing();
  assert.match(result.error, /SDN: HTTP 403; Advanced: HTTP 403/);
  assert.equal(result.sdnList.dataAvailable, false);
  assert.equal(result.advancedList.dataAvailable, false);
  assert.deepEqual(result.sampleEntries, []);
  assert.equal(result.sdnList.status, 403);
  assert.equal(result.error.includes('upstream body'), false);
});

test('OFAC rejects empty export bodies rather than reporting an available sample', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(''));
  assert.match((await getSDNMetadata()).error, /empty body/);
});

test('OFAC deadline remains active until the response body completes', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true });
    },
  })));
  const result = await getSDNMetadata({ timeout: 10 });
  assert.equal(result.error, 'OFAC request timed out after 10ms');
});
