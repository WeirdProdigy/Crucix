import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch } from '../apis/utils/fetch.mjs';

test('Live smoke check: Katasztrófavédelem Vész RSS probe (https://www.katasztrofavedelem.hu/10466/RSS_VESZ)', async () => {
  const response = await safeFetch('https://www.katasztrofavedelem.hu/10466/RSS_VESZ', {
    timeout: 10000,
    retries: 1,
    format: 'text',
    maxBytes: 2 * 1024 * 1024
  });

  assert.ok(!response.error, `Live fetch failed: ${response.error}`);
  assert.ok(typeof response.rawText === 'string' && response.rawText.length > 0);
  assert.ok(response.rawText.includes('<rss') || response.rawText.includes('<feed'));
  assert.ok(response.rawText.includes('<channel>'));
  assert.ok(
    response.rawText.includes('Veszélyhelyzeti Értesítési Szolgáltatás') ||
    response.rawText.includes('Katasztrófavédelem')
  );

  // RSS_VESZ can have 0 or more items depending on active national/county emergencies
  const items = response.rawText.match(/<item>[\s\S]*?<\/item>/g) || [];
  if (items.length > 0) {
    const firstTitle = items[0].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
    assert.ok(firstTitle.length > 3, 'When items exist, title must be valid');
  }
});

test('Live smoke check: Katasztrófavédelem Hírek RSS probe (https://www.katasztrofavedelem.hu/10417/RSS_hirek)', async () => {
  const response = await safeFetch('https://www.katasztrofavedelem.hu/10417/RSS_hirek', {
    timeout: 10000,
    retries: 1,
    format: 'text',
    maxBytes: 2 * 1024 * 1024
  });

  assert.ok(!response.error, `Live fetch failed: ${response.error}`);
  assert.ok(typeof response.rawText === 'string' && response.rawText.length > 0);
  assert.ok(response.rawText.includes('<rss') || response.rawText.includes('<feed'));
  assert.ok(response.rawText.includes('<channel>'));

  const items = response.rawText.match(/<item>[\s\S]*?<\/item>/g) || [];
  assert.ok(items.length >= 1, `Expected at least 1 item from live news feed, got ${items.length}`);

  const firstTitle = items[0].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
  assert.ok(firstTitle.length > 3, 'Live news feed item has non-empty title');
});
