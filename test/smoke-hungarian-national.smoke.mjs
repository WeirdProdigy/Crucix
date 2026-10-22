import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch } from '../apis/utils/fetch.mjs';

test('Live smoke check: Telex RSS feed probe (https://telex.hu/rss)', async () => {
  const response = await safeFetch('https://telex.hu/rss', {
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
  assert.ok(items.length >= 5, `Expected at least 5 items from live Telex feed, got ${items.length}`);

  const firstTitle = items[0].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
  assert.ok(firstTitle.length > 5, 'Live Telex feed item has non-empty title');
});

test('Live smoke check: Portfolio RSS feed probe (https://www.portfolio.hu/rss/all.xml)', async () => {
  const response = await safeFetch('https://www.portfolio.hu/rss/all.xml', {
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
  assert.ok(items.length >= 5, `Expected at least 5 items from live Portfolio feed, got ${items.length}`);

  const firstTitle = items[0].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
  assert.ok(firstTitle.length > 5, 'Live Portfolio feed item has non-empty title');
});

test('Live smoke check: Agrárszektor RSS feed probe (https://www.agrarszektor.hu/rss)', async () => {
  const response = await safeFetch('https://www.agrarszektor.hu/rss', {
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
  assert.ok(items.length >= 3, `Expected at least 3 items from live Agrárszektor feed, got ${items.length}`);

  const firstTitle = items[0].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
  assert.ok(firstTitle.length > 5, 'Live Agrárszektor feed item has non-empty title');
});
