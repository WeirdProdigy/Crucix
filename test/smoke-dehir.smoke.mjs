import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch } from '../apis/utils/fetch.mjs';

test('Live smoke check: Dehir RSS feed probe (https://www.dehir.hu/rss.php)', async () => {
  const response = await safeFetch('https://www.dehir.hu/rss.php', {
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
  assert.ok(items.length >= 3, `Expected at least 3 items from live Dehir feed, got ${items.length}`);

  const firstTitle = items[0].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
  assert.ok(firstTitle.length > 5, 'Live Dehir feed item has non-empty title');
});
