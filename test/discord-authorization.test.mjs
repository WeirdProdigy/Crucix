import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordAlerter } from '../lib/alerts/discord.mjs';

function interaction(overrides = {}) {
  const replies = [];
  return { commandName: 'mute', channelId: 'foreign', guildId: 'guild', user: { id: 'stranger' },
    memberPermissions: { has: () => false }, options: { getNumber: () => 1 },
    reply: async data => replies.push(data), replies, ...overrides };
}

test('foreign channel cannot mute the configured alert stream', async () => {
  const bot = new DiscordAlerter({ botToken: 'test', channelId: 'owner', guildId: 'guild' });
  const request = interaction();
  await bot._handleCommand(request);
  assert.equal(bot._muteUntil, null);
  assert.equal(request.replies.length, 1);
});

test('ordinary member cannot mute even from configured channel', async () => {
  const bot = new DiscordAlerter({ botToken: 'test', channelId: 'owner', guildId: 'guild' });
  const request = interaction({ channelId: 'owner' });
  await bot._handleCommand(request);
  assert.equal(bot._muteUntil, null);
});
