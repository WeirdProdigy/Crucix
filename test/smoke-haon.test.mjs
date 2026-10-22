import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch } from '../apis/utils/fetch.mjs';

test('live HAON RSS smoke check (probe https://www.haon.hu/feed/)', async (t) => {
  // Offline safety: in full test suite runs without live flag, skip external HTTP call
  const isDirectFile = process.argv.length <= 3 && process.argv.some(arg => arg.endsWith('smoke-haon.test.mjs') && !arg.includes('*'));
  const isExplicitlyEnabled = process.env.TEST_LIVE_SOURCES === '1' || process.env.HAON_SMOKE === '1';

  if (!isExplicitlyEnabled && !isDirectFile) {
    t.skip('Live smoke test skipped (set TEST_LIVE_SOURCES=1 or run node test/smoke-haon.test.mjs directly)');
    return;
  }

  const response = await safeFetch('https://www.haon.hu/feed/', {
    timeout: 10000,
    retries: 1,
    format: 'text',
    maxBytes: 2 * 1024 * 1024
  });

  assert.ok(!response.error, `Live fetch failed: ${response.error}`);
  assert.ok(typeof response.rawText === 'string' && response.rawText.length > 0);
  assert.ok(response.rawText.includes('<rss') || response.rawText.includes('<feed'));
  assert.ok(response.rawText.includes('<item>'));

  const items = response.rawText.match(/<item>[\s\S]*?<\/item>/g) || [];
  assert.ok(items.length >= 5, `Expected at least 5 items from live HAON feed, got ${items.length}`);

  const firstTitle = items[0].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
  assert.ok(firstTitle.length > 5, 'Live HAON feed item has non-empty title');
});
