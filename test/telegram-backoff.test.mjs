import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramAlerter } from '../lib/alerts/telegram.mjs';

test('Telegram polling backoff: doubles on consecutive failures up to max interval, resets on success', async () => {
  const alerter = new TelegramAlerter({
    botToken: 'mock-test-token',
    chatId: 'mock-test-chat'
  });

  assert.equal(alerter.consecutiveFailures, 0);
  assert.equal(alerter.currentIntervalMs, 5000);

  // Mock global fetch to simulate failure
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  globalThis.fetch = async () => {
    fetchCallCount++;
    throw new Error('fetch failed: mock connection refused');
  };

  try {
    // 1. First failure -> interval becomes 10s (5000 * 2)
    await alerter._pollUpdates();
    assert.equal(alerter.consecutiveFailures, 1);
    assert.equal(alerter.currentIntervalMs, 10000);

    // 2. Second failure -> interval becomes 20s
    await alerter._pollUpdates();
    assert.equal(alerter.consecutiveFailures, 2);
    assert.equal(alerter.currentIntervalMs, 20000);

    // 3. Third failure -> interval becomes 40s
    await alerter._pollUpdates();
    assert.equal(alerter.consecutiveFailures, 3);
    assert.equal(alerter.currentIntervalMs, 40000);

    // 4. Multiple failures up to max interval (300,000ms / 5 min)
    for (let i = 0; i < 10; i++) {
      await alerter._pollUpdates();
    }
    assert.equal(alerter.consecutiveFailures, 13);
    assert.equal(alerter.currentIntervalMs, 300000, 'Interval must cap at 300,000 ms (5 min)');

    // 5. Success resets failures and restores min interval (5000ms)
    globalThis.fetch = async () => {
      return {
        ok: true,
        json: async () => ({ ok: true, result: [] })
      };
    };

    await alerter._pollUpdates();
    assert.equal(alerter.consecutiveFailures, 0, 'Failures must reset to 0 on success');
    assert.equal(alerter.currentIntervalMs, 5000, 'Interval must reset to min interval (5000ms) on success');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Telegram outbound send counters: tracks outboundSuccessCount, outboundErrorCount, and timestamps', async () => {
  const alerter = new TelegramAlerter({
    botToken: 'mock-test-token',
    chatId: 'mock-test-chat'
  });

  assert.equal(alerter.outboundSuccessCount, 0);
  assert.equal(alerter.outboundErrorCount, 0);
  assert.equal(alerter.lastOutboundSuccessAt, null);
  assert.equal(alerter.lastOutboundErrorAt, null);

  const originalFetch = globalThis.fetch;
  try {
    // 1. Send failure
    globalThis.fetch = async () => {
      return new Response('Unauthorized', { status: 401 });
    };

    const resFail = await alerter.sendMessage('Test fail message');
    assert.equal(resFail.ok, false);
    assert.equal(alerter.outboundErrorCount, 1);
    assert.ok(alerter.lastOutboundErrorAt);
    assert.equal(alerter.outboundSuccessCount, 0);

    // 2. Send success
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 12345 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const resOk = await alerter.sendMessage('Test success message');
    assert.equal(resOk.ok, true);
    assert.equal(alerter.outboundSuccessCount, 1);
    assert.ok(alerter.lastOutboundSuccessAt);
    assert.equal(alerter.outboundErrorCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
