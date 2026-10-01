import test from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/telegram.mjs';

test('command bot token never causes private message collection', async () => {
  const oldFetch = globalThis.fetch;
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldEnabled = process.env.TELEGRAM_OSINT_ENABLED;
  let calls = 0;
  process.env.TELEGRAM_BOT_TOKEN = 'private-command-bot';
  process.env.TELEGRAM_OSINT_ENABLED = 'false';
  globalThis.fetch = async () => { calls++; throw new Error('must not request bot updates'); };
  try {
    const data = await briefing();
    assert.equal(calls, 0);
    assert.equal(data.status, 'disabled');
    assert.deepEqual(data.topPosts, []);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of [['TELEGRAM_BOT_TOKEN', oldToken], ['TELEGRAM_OSINT_ENABLED', oldEnabled]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
