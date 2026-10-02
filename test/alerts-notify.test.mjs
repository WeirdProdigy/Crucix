import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertNotifier, parseQuietHours } from '../lib/alerts/notify.mjs';
import { TelegramAlerter } from '../lib/alerts/telegram.mjs';
import { DiscordAlerter } from '../lib/alerts/discord.mjs';

const NTFY_URL = 'https://ntfy.example.test/crucix-secret-topic';
const HOOK_URL = 'https://hooks.example.test/in/SECRETPATH123?token=SECRETQUERY';
const TOKEN = 'tk_SECRETTOKEN';
const PUBLIC_URL = 'https://dash.example.test/crucix';
const SECRETS = [TOKEN, 'crucix-secret-topic', 'SECRETPATH123', 'SECRETQUERY'];
const CHANNELS = ['telegram', 'discord', 'ntfy', 'webhook'];

// Local wall-clock times: quiet hours are defined in local time, so the tests build dates from local components.
const at = (hour, minute = 0, day = 2) => new Date(2026, 9, day, hour, minute, 0).getTime();
const NOON = at(12);

function recorder() {
  const lines = [];
  const push = (...parts) => lines.push(parts.join(' '));
  return { lines, warn: push, error: push, log: push, info: push };
}

let seq = 0;
function alert(overrides = {}) {
  seq += 1;
  return {
    id: `alert-${String(seq).padStart(32, '0')}`, ruleId: 'events-critical', ruleName: 'Critical events',
    dedupKey: `events-critical|event-${seq}`, kind: 'event', severity: 'high', state: 'firing',
    title: `Event ${seq} reported`, summary: `Summary ${seq}`, entity: { type: 'event', id: `event-${seq}` },
    evidence: [], firstSeenAt: NOON, lastSeenAt: NOON, count: 1, notify: true, silent: false,
    log: [{ at: NOON, action: 'created' }], ...overrides,
  };
}
const batch = (created = [], escalated = [], silent = false) => ({ created, escalated, silent });

// A stand-in for TelegramAlerter / DiscordAlerter: records the arguments of sendMessage and answers `result`.
function fakeAlerter(result, { configured = true, throws = false } = {}) {
  const fake = {
    isConfigured: configured, calls: [], result,
    async sendMessage(...args) {
      fake.calls.push(args);
      if (throws) throw new Error('send exploded');
      return fake.result;
    },
  };
  return fake;
}
const fakeTelegram = options => fakeAlerter({ ok: true, messageId: 1 }, options);
const fakeDiscord = options => fakeAlerter(true, options);

function fakeFetch(responder = () => ({ ok: true, status: 200 })) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  fn.calls = calls;
  return fn;
}

// A notifier with all four channels over fakes (Telegram and Discord opted in, no pause between Discord messages); any
// option (even `undefined`) replaces its default.
function setup(options = {}) {
  const pick = (key, fallback) => (key in options ? options[key] : fallback);
  const logger = pick('logger', recorder());
  const clock = { now: NOON };
  const telegram = pick('telegram', fakeTelegram());
  const discord = pick('discord', fakeDiscord());
  const fetch = pick('fetch', fakeFetch());
  const notifier = new AlertNotifier({
    ntfy: { url: NTFY_URL, token: TOKEN }, webhook: { url: HOOK_URL }, now: () => clock.now,
    notifyChannels: ['telegram', 'discord'], sleep: async () => {},
    ...options, telegram, discord, fetch, logger,
  });
  const callsTo = url => (fetch?.calls ?? []).filter(call => call.url === url);
  return { notifier, telegram, discord, fetch, logger, clock, ntfyCalls: () => callsTo(NTFY_URL), hookCalls: () => callsTo(HOOK_URL) };
}

const everyChannelCalls = ({ telegram, discord, ntfyCalls, hookCalls }) => [telegram.calls.length, discord.calls.length, ntfyCalls().length, hookCalls().length];

// ─── configuration and channels ────────────────────────────────────────────────

test('channels() lists only configured channels, in a fixed order', () => {
  assert.deepEqual(new AlertNotifier({ logger: recorder() }).channels(), []);
  assert.deepEqual(setup().notifier.channels(), CHANNELS);
  assert.deepEqual(setup({ telegram: fakeTelegram({ configured: false }), webhook: undefined }).notifier.channels(), ['discord', 'ntfy']);
  assert.deepEqual(setup({ telegram: undefined, discord: undefined, ntfy: { url: null, token: null }, webhook: { url: null } }).notifier.channels(), []);
  assert.deepEqual(setup({ fetch: null }).notifier.channels(), ['telegram', 'discord'], 'without a fetch there is no ntfy or webhook');
});

test('ntfy and webhook URLs with credentials, other schemes or garbage are not channels, and the warning does not echo them', () => {
  const bad = [
    'https://user:pass@ntfy.example.test/topic', 'ftp://ntfy.example.test/topic', 'not a url', 'javascript:alert(1)', `https://ntfy.example.test/${'a'.repeat(3000)}`,
  ];
  for (const url of bad) {
    const { notifier, logger } = setup({ ntfy: { url }, webhook: { url } });
    assert.deepEqual(notifier.channels().filter(name => name === 'ntfy' || name === 'webhook'), [], url.slice(0, 40));
    assert.ok(logger.lines.length >= 1);
    for (const line of logger.lines) assert.ok(!line.includes(url.slice(0, 30)) && !line.includes('pass@'), line);
  }
});

test('a malformed ntfy token disables ntfy instead of sending without it', () => {
  for (const token of ['has space', 'new\nline', 'tökén', 'x'.repeat(600)]) {
    const { notifier, logger } = setup({ ntfy: { url: NTFY_URL, token } });
    assert.ok(!notifier.channels().includes('ntfy'));
    assert.ok(logger.lines.length >= 1);
    for (const line of logger.lines) assert.ok(!line.includes(token), line);
  }
});

test('invalid options fall back to the defaults with a warning', async () => {
  const { notifier, telegram, logger } = setup({ minSeverity: 'bogus', maxPerSweep: 99, publicUrl: 'https://user:secret@dash.example.test/', quietHours: '25:99-xx' });
  assert.ok(logger.lines.length >= 3);
  assert.ok(logger.lines.every(line => !line.includes('secret')));
  const many = Array.from({ length: 8 }, () => alert({ severity: 'high' }));
  const result = await notifier.dispatch(batch([...many, alert({ severity: 'watch' })]));
  assert.equal(telegram.calls.length, 6, 'default cap 5 plus a digest, and the watch alert stays below the default high gate');
  assert.equal(result.digest.count, 3);
  assert.ok(!notifier.formatText(alert()).includes('dash.example'));
  assert.equal(notifier.inQuietHours(new Date(at(3))), false);
  const zero = setup({ maxPerSweep: 0 });
  await zero.notifier.dispatch(batch(Array.from({ length: 8 }, () => alert())));
  assert.equal(zero.telegram.calls.length, 6);
});

// ─── gates ─────────────────────────────────────────────────────────────────────

test('severity gate: the default minimum is high and minSeverity moves it', async () => {
  const levels = ['critical', 'high', 'watch', 'info'];
  const run = async minSeverity => {
    const env = setup(minSeverity === undefined ? {} : { minSeverity });
    const result = await env.notifier.dispatch(batch(levels.map(severity => alert({ severity }))));
    return { sent: result.sent.length, skipped: result.skipped, texts: env.telegram.calls.map(call => call[0].split('\n')[0].match(/^\[(\w+)\]/)[1]) };
  };
  assert.deepEqual(await run(), { sent: 2, skipped: 2, texts: ['CRITICAL', 'HIGH'] });
  assert.deepEqual(await run('watch'), { sent: 3, skipped: 1, texts: ['CRITICAL', 'HIGH', 'WATCH'] });
  assert.deepEqual(await run('info'), { sent: 4, skipped: 0, texts: ['CRITICAL', 'HIGH', 'WATCH', 'INFO'] });
  assert.deepEqual(await run('critical'), { sent: 1, skipped: 3, texts: ['CRITICAL'] });
});

test('an alert whose rule has notify off is never sent', async () => {
  const env = setup();
  const result = await env.notifier.dispatch(batch([alert({ severity: 'critical', notify: false }), alert({ severity: 'critical', notify: undefined })], [alert({ severity: 'critical', notify: false })]));
  assert.deepEqual(result, { sent: [], digest: null, skipped: 3 });
  assert.deepEqual(everyChannelCalls(env), [0, 0, 0, 0]);
});

test('a silent (bootstrap) batch sends nothing, even for critical and escalated alerts', async () => {
  const env = setup();
  const result = await env.notifier.dispatch(batch([alert({ severity: 'critical', silent: true }), alert({ severity: 'critical' })], [alert({ severity: 'critical' })], true));
  assert.deepEqual(result, { sent: [], digest: null, skipped: 3 });
  assert.deepEqual(everyChannelCalls(env), [0, 0, 0, 0]);
});

test('a created alert flagged silent stays silent, but a later escalation of it notifies', async () => {
  const env = setup();
  const created = await env.notifier.dispatch(batch([alert({ severity: 'critical', silent: true })]));
  assert.deepEqual(created, { sent: [], digest: null, skipped: 1 });
  assert.deepEqual(everyChannelCalls(env), [0, 0, 0, 0]);

  const escalated = alert({ severity: 'critical', silent: true });
  const result = await env.notifier.dispatch(batch([], [escalated]));
  assert.equal(result.sent.length, 1);
  assert.equal(result.sent[0].alertId, escalated.id);
  assert.deepEqual(result.sent[0].channels, CHANNELS);
  assert.deepEqual(everyChannelCalls(env), [1, 1, 1, 1]);
  assert.equal(JSON.parse(env.hookCalls()[0].init.body).escalated, true);
});

test('escalation re-notifies; an alert listed twice is sent once', async () => {
  const env = setup();
  const first = alert({ severity: 'high' });
  await env.notifier.dispatch(batch([first]));
  const result = await env.notifier.dispatch(batch([], [{ ...first, severity: 'critical' }]));
  assert.equal(env.telegram.calls.length, 2);
  assert.match(env.telegram.calls[1][0], /^\[CRITICAL\]/);
  assert.equal(result.sent.length, 1);

  const dup = alert();
  const twice = await env.notifier.dispatch(batch([dup], [dup]));
  assert.equal(twice.sent.length, 1);
  assert.equal(twice.skipped, 1);
  assert.equal(env.telegram.calls.length, 3);
});

test('no channel configured: nothing to do, nothing held', async () => {
  const notifier = new AlertNotifier({ quietHours: '00:00-23:59', now: () => at(12), logger: recorder() });
  assert.deepEqual(await notifier.dispatch(batch([alert({ severity: 'critical' })])), { sent: [], digest: null, skipped: 1 });
});

// ─── Telegram and Discord: opt-in, mute, Discord pacing ───────────────────────

test('Telegram and Discord carry engine alerts only when notifyChannels lists them', async () => {
  for (const notifyChannels of [undefined, null, [], 'telegram,discord', ['bogus', 'ntfy', 'Telegram']]) {
    const env = setup({ notifyChannels });
    assert.deepEqual(env.notifier.channels(), ['ntfy', 'webhook'], JSON.stringify(notifyChannels));
    const result = await env.notifier.dispatch(batch([alert({ severity: 'critical' })]));
    assert.deepEqual(result.sent[0].channels, ['ntfy', 'webhook']);
    assert.deepEqual([env.telegram.calls.length, env.discord.calls.length], [0, 0], 'configured but not listed: nothing is sent there');
  }
  const discordOnly = setup({ notifyChannels: ['discord'] });
  assert.deepEqual(discordOnly.notifier.channels(), ['discord', 'ntfy', 'webhook']);
  await discordOnly.notifier.dispatch(batch([alert()]));
  assert.deepEqual([discordOnly.telegram.calls.length, discordOnly.discord.calls.length], [0, 1]);
  assert.deepEqual(setup({ notifyChannels: ['telegram'], telegram: fakeTelegram({ configured: false }) }).notifier.channels(), ['ntfy', 'webhook'], 'listed but not configured is no channel either');
});

// A fake alerter with the mute switch of TelegramAlerter / DiscordAlerter (_isMuted()).
const mutable = (fake, muted = true) => Object.assign(fake, { muted, _isMuted() { return this.muted; } });

test('a muted Telegram or Discord alerter is skipped for every severity and the digest, until the mute ends', async () => {
  const telegram = mutable(fakeTelegram()), discord = mutable(fakeDiscord());
  const env = setup({ telegram, discord, maxPerSweep: 1 });
  const result = await env.notifier.dispatch(batch([alert({ severity: 'critical' }), alert({ severity: 'high' })]));
  assert.deepEqual([telegram.calls.length, discord.calls.length], [0, 0]);
  assert.deepEqual(result.sent[0].channels, ['ntfy', 'webhook'], 'a muted channel is not reported as sent');
  assert.deepEqual(result.digest.channels, ['ntfy', 'webhook']);
  assert.ok(!env.logger.lines.some(line => /did not accept|failed/.test(line)), 'a mute is not a failure');

  telegram.muted = false;
  const after = await env.notifier.dispatch(batch([alert({ severity: 'critical' })]));
  assert.deepEqual(after.sent[0].channels, ['telegram', 'ntfy', 'webhook']);
  assert.deepEqual([telegram.calls.length, discord.calls.length], [1, 0], 'nothing was queued for the muted time');
});

test('the /mute state of the real alerters stops engine notifications', async t => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return { ok: true, status: 204, json: async () => ({ result: { message_id: 1 } }) }; };
  t.after(() => { globalThis.fetch = original; });
  const telegram = new TelegramAlerter({ botToken: '123:abc', chatId: '42' });
  const discord = new DiscordAlerter({ webhookUrl: 'https://discord.example.test/api/webhooks/1/token' });
  telegram._muteUntil = Date.now() + 3600000;
  discord._muteUntil = Date.now() + 3600000;
  const notifier = new AlertNotifier({ telegram, discord, notifyChannels: ['telegram', 'discord'], sleep: async () => {}, logger: recorder() });
  assert.deepEqual(await notifier.dispatch(batch([alert({ severity: 'critical' })])), { sent: [], digest: null, skipped: 0 });
  assert.deepEqual(urls, []);
  telegram._muteUntil = null;
  discord._muteUntil = Date.now() - 1;
  assert.deepEqual((await notifier.dispatch(batch([alert({ severity: 'critical' })]))).sent[0].channels, ['telegram', 'discord']);
  assert.equal(urls.length, 2);
});

test('Discord messages are paced 500 ms apart for its webhook rate limit; the other channels are not', async () => {
  const steps = [];
  const discord = Object.assign(fakeDiscord(), { async sendMessage(...args) { discord.calls.push(args); steps.push('send'); return true; } });
  const env = setup({ discord, maxPerSweep: 3, sleep: async ms => { steps.push(ms); } });
  const result = await env.notifier.dispatch(batch(Array.from({ length: 4 }, () => alert())));
  assert.deepEqual(steps, ['send', 500, 'send', 500, 'send', 500, 'send'], 'three alerts and the digest, a pause before each but the first');
  assert.equal(result.digest.count, 1);
  assert.deepEqual(result.digest.channels, CHANNELS);

  const pauses = [];
  await setup({ discord: undefined, sleep: async ms => { pauses.push(ms); } }).notifier.dispatch(batch([alert(), alert()]));
  assert.deepEqual(pauses, [], 'no Discord, no pause');
});

// ─── cap and digest ───────────────────────────────────────────────────────────

test('at most 5 individual messages per sweep, then one digest with the right count on every channel', async () => {
  const env = setup({ publicUrl: PUBLIC_URL });
  const many = [...Array.from({ length: 8 }, () => alert({ severity: 'high' })), alert({ severity: 'critical' })];
  const result = await env.notifier.dispatch(batch(many));

  assert.equal(result.sent.length, 5);
  assert.deepEqual(result.digest, { count: 4, channels: CHANNELS });
  assert.equal(result.skipped, 0);
  assert.deepEqual(everyChannelCalls(env), [6, 6, 6, 6]);
  assert.match(env.telegram.calls[0][0], /^\[CRITICAL\]/, 'the most severe alert is not the one that falls into the digest');
  assert.equal(env.telegram.calls[5][0].split('\n')[0], '+4 more alerts');
  assert.match(env.telegram.calls[5][0], /crucix$/, 'the digest carries the link too');
  assert.deepEqual(JSON.parse(env.hookCalls()[5].init.body), { event: 'digest', count: 4, overflow: 4, held: 0 });
  assert.match(env.ntfyCalls()[5].init.headers.Title, /^Crucix: 4 alerts$/);
});

test('the cap is configurable and a batch within the cap sends no digest', async () => {
  const two = setup({ maxPerSweep: 2 });
  const result = await two.notifier.dispatch(batch(Array.from({ length: 3 }, () => alert())));
  assert.equal(result.sent.length, 2);
  assert.equal(result.digest.count, 1);
  assert.equal(two.telegram.calls[2][0].split('\n')[0], '+1 more alert');

  const five = setup();
  const fits = await five.notifier.dispatch(batch(Array.from({ length: 5 }, () => alert())));
  assert.equal(fits.sent.length, 5);
  assert.equal(fits.digest, null);
  assert.equal(five.telegram.calls.length, 5);
});

// ─── text ──────────────────────────────────────────────────────────────────────

test('formatText is plain text: severity, title, summary, up to three evidence titles, then the link', () => {
  const { notifier } = setup({ publicUrl: PUBLIC_URL });
  const text = notifier.formatText(alert({
    severity: 'critical', title: 'Quake near Budapest', summary: 'Magnitude 5 detected',
    evidence: ['one', 'two', 'three', 'four'].map(word => ({ type: 'event', id: word, title: `Report ${word}` })),
  }));
  assert.equal(text, '[CRITICAL] Quake near Budapest\nMagnitude 5 detected\n- Report one\n- Report two\n- Report three\nhttps://dash.example.test/crucix');
  assert.equal(setup().notifier.formatText(alert({ title: 'Bare', summary: '' })), '[HIGH] Bare');
});

test('hostile feed text stays literal on Telegram: no parse mode, markdown characters untouched, one line per field', async () => {
  const env = setup();
  const title = '*_[x](http://evil) `code` <b>bold</b> @everyone';
  await env.notifier.dispatch(batch([alert({ title, summary: `line one\nline two\r\n${String.fromCharCode(0x202e)}reversed`, evidence: [{ title: '_[y](http://evil2)' }] })]));
  const [text, options] = env.telegram.calls[0];
  assert.equal(text, `[HIGH] ${title}\nline one line two reversed\n- _[y](http://evil2)`);
  assert.equal(options.parseMode, null);
  assert.ok(!text.includes(String.fromCharCode(0x202e)));
});

test('long fields are truncated: a 400-character title to 160, and the whole message stays under every channel limit', () => {
  const { notifier } = setup({ publicUrl: `https://dash.example.test/${'p'.repeat(450)}` });
  const long = 'x'.repeat(400);
  const first = notifier.formatText(alert({ title: long })).split('\n')[0];
  assert.equal(first, `[HIGH] ${'x'.repeat(160)}`);

  const text = notifier.formatText(alert({ title: long, summary: 'y'.repeat(100000), evidence: Array.from({ length: 1000 }, () => ({ title: 'z'.repeat(5000) })) }));
  assert.ok(text.length < 2000, String(text.length));
  assert.equal(text.split('\n').filter(line => line.startsWith('- ')).length, 3);
  assert.ok(text.split('\n').every(line => line.length < 900));
});

test('a link longer than 500 characters is ignored with a warning', () => {
  const { notifier, logger } = setup({ publicUrl: `https://dash.example.test/${'p'.repeat(600)}` });
  assert.ok(!notifier.formatText(alert()).includes('dash.example'));
  assert.ok(logger.lines.length >= 1);
});

test('Discord gets the same text with markdown and mentions neutralised', async () => {
  const env = setup();
  await env.notifier.dispatch(batch([alert({ title: '*_[x](http://evil) ~~s~~ ||spoiler|| @everyone <@123456> # head > quote', summary: '`tick` \\ back', evidence: [{ title: '> ![img](http://evil)' }] })]));
  const [content, embeds, options] = env.discord.calls[0];
  assert.deepEqual(embeds, []);
  assert.deepEqual(options, { suppressMentions: true });
  const [head, ...rest] = content.split('\n');
  assert.ok(head.startsWith('[HIGH] '), 'the severity label itself is not escaped');
  // Whatever markdown or mention syntax survives the escaping must be preceded by a backslash.
  for (const line of [head.slice(7), ...rest.map(line => line.replace(/^- /, ''))]) {
    const bare = line.replace(/\\./g, '');
    assert.ok(!/[*_~`|>#[\]()<@]/.test(bare), `unescaped syntax in: ${line}`);
  }
  assert.ok(content.includes('\\@everyone') && content.includes('\\<\\@123456\\>'));
  assert.ok(content.includes('\\[x\\]\\(http://evil\\)'));
});

test('the Discord link line is left unescaped so the URL still works', async () => {
  const env = setup({ publicUrl: 'https://dash.example.test/a_b_c' });
  await env.notifier.dispatch(batch([alert()]));
  assert.equal(env.discord.calls[0][0].split('\n').at(-1), 'https://dash.example.test/a_b_c');
});

// Escaping can double the text, and Discord rejects content over 2000 characters, so the Discord message has its own budget.
const ALL_SPECIAL = '*_[]()`~|#>-@<\\';
const MIXED_SPECIAL = '*_[]()`@everyone<@123>~|#>-\\';
const repeatTo = (unit, length) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
const LONG_LINK = `https://dash.example.test/${'p'.repeat(470)}`;

// Every markdown or mention character of a Discord line is escaped by a backslash that is not itself cut off.
function assertEscaped(line) {
  const bare = line.replace(/\\./g, '');
  assert.ok(!/[*_~`|>#[\]()<@\\-]/.test(bare), `unescaped syntax in: ${line.slice(0, 80)}`);
}

test('a worst-case all-special alert stays within 2000 characters on Discord with nothing left unescaped', async () => {
  const env = setup({ publicUrl: LONG_LINK });
  const hostile = alert({
    severity: 'critical', title: repeatTo(ALL_SPECIAL, 400), summary: `@everyone <@123> ${repeatTo(ALL_SPECIAL, 5000)}`,
    evidence: Array.from({ length: 8 }, () => ({ title: repeatTo(MIXED_SPECIAL, 400) })),
  });
  const plainLength = env.notifier.formatText(hostile).length;
  await env.notifier.dispatch(batch([hostile]));

  const content = env.discord.calls[0][0];
  assert.ok(plainLength < 2000 && plainLength > 1000, `the plain text fits ${plainLength}`);
  assert.ok(content.length <= 2000, `Discord content is ${content.length} characters`);
  const lines = content.split('\n');
  assert.ok(lines[0].startsWith('[CRITICAL] '));
  assert.equal(lines.at(-1), LONG_LINK, 'the link survives whole');
  for (const line of [lines[0].slice(11), ...lines.slice(1, -1).map(line => line.replace(/^- /, ''))]) assertEscaped(line);
  assert.ok(lines[1].startsWith('\\@everyone \\<\\@123\\> '), 'mentions stay inert');
  assert.ok(!lines.some(line => line.startsWith('- ')), 'the evidence lines are the first to go');
  assert.ok(lines[1].endsWith('…'), 'the summary is cut with an ellipsis');
  // The other channels keep the full, unescaped text.
  assert.equal(env.telegram.calls[0][0], env.notifier.formatText(hostile));
});

test('Discord drops evidence lines from the end first and keeps the whole summary when that is enough', async () => {
  const env = setup();
  const evidence = ['a', 'b', 'c'].map(letter => ({ title: `${letter}${'('.repeat(159)}` }));
  await env.notifier.dispatch(batch([alert({ title: 'x', summary: '('.repeat(600), evidence })]));
  const lines = env.discord.calls[0][0].split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[1], '\\('.repeat(600), 'the summary is untouched');
  assert.deepEqual(lines.slice(2).map(line => line[2]), ['a', 'b']);
  assert.ok(env.discord.calls[0][0].length <= 2000);
});

test('Discord cuts the summary on a character boundary, never between a backslash and its character', async () => {
  const env = setup({ publicUrl: LONG_LINK });
  await env.notifier.dispatch(batch([alert({ title: '('.repeat(160), summary: '('.repeat(600) })]));
  const lines = env.discord.calls[0][0].split('\n');
  assert.equal(lines.length, 3);
  assert.ok(env.discord.calls[0][0].length <= 2000);
  assert.match(lines[1], /^(\\\()+…$/);
  assert.ok(lines[1].length > 1000);
});

test('Discord digests stay within 2000 characters, a release digest included', async () => {
  const env = setup({ publicUrl: LONG_LINK, maxPerSweep: 1, quietHours: '22:00-07:00' });
  env.clock.now = at(23, 0);
  await env.notifier.dispatch(batch(Array.from({ length: 30 }, () => alert())));
  env.clock.now = at(8, 0, 3);
  const result = await env.notifier.dispatch(batch(Array.from({ length: 40 }, () => alert())));
  assert.equal(result.digest.count, 69);
  const content = env.discord.calls.at(-1)[0];
  assert.equal(content, `+39 more alerts\n30 alerts held during quiet hours\n${LONG_LINK}`);
  assert.ok(content.length <= 2000);
});

// ─── webhook ───────────────────────────────────────────────────────────────────

test('the webhook gets valid JSON with the hostile title intact as data', async () => {
  const env = setup();
  const title = '*_[x](http://evil) "quoted" </script><img src=x onerror=alert(1)> \\ ';
  const hostile = alert({ severity: 'critical', title, summary: '{"event":"x"}', evidence: [{ type: 'event', id: 'e1', title: '<b>t</b>', source: 'ACLED' }] });
  await env.notifier.dispatch(batch([hostile]));

  const [call] = env.hookCalls();
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.ok(!('Authorization' in call.init.headers), 'the ntfy token never goes to the webhook');
  const body = JSON.parse(call.init.body);
  assert.equal(body.event, 'alert');
  assert.equal(body.escalated, false);
  assert.equal(body.alert.id, hostile.id);
  assert.equal(body.alert.kind, 'event');
  assert.equal(body.alert.title, title);
  assert.equal(body.alert.summary, '{"event":"x"}');
  assert.equal(body.alert.severity, 'critical');
  assert.deepEqual(body.alert.evidence, hostile.evidence);
  assert.ok(!('log' in body.alert) && !('dedupKey' in body.alert), 'internal bookkeeping stays out of the payload');
});

// ─── ntfy ──────────────────────────────────────────────────────────────────────

test('ntfy: POST with the text body, the priority mapping and a Bearer header only when a token is set', async () => {
  const priorities = { critical: 5, high: 4, watch: 3, info: 2 };
  for (const [severity, priority] of Object.entries(priorities)) {
    const live = setup({ minSeverity: 'info' });
    const item = alert({ severity, title: 'Plain title', summary: 'Details' });
    await live.notifier.dispatch(batch([item]));
    const [call] = live.ntfyCalls();
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Priority, String(priority), severity);
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(call.init.headers.Title, `[${severity.toUpperCase()}] Plain title`);
    assert.equal(call.init.headers['Content-Type'], 'text/plain; charset=utf-8');
    assert.equal(call.init.body, live.notifier.formatText(item));
  }

  const open = setup({ ntfy: { url: NTFY_URL } });
  await open.notifier.dispatch(batch([alert()]));
  assert.ok(!('Authorization' in open.ntfyCalls()[0].init.headers));
});

test('ntfy header values are ASCII-safe even for Hungarian, non-Latin-1 and multi-line titles', async () => {
  const env = setup();
  const title = 'Árvíz riasztás — tűz\nDunakeszi őű 中文 🔥';
  const hostile = alert({ title, ruleId: 'events-critical', severity: 'critical' });
  await env.notifier.dispatch(batch([hostile, alert({ ruleId: 'árvíz\nX: injected', severity: 'critical', title: 'plain' })]));

  const calls = env.ntfyCalls();
  assert.equal(calls.length, 2);
  for (const { init } of calls) {
    for (const [name, value] of Object.entries(init.headers)) {
      assert.match(name, /^[A-Za-z-]+$/);
      assert.match(value, /^[\x20-\x7e]*$/, `${name}: ${JSON.stringify(value)}`);
    }
  }
  // RFC 2047 encoded word: it decodes back to the cleaned title, and the body carries the text as UTF-8.
  const encoded = calls[0].init.headers.Title;
  const match = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(encoded);
  assert.ok(match, encoded);
  assert.equal(Buffer.from(match[1], 'base64').toString('utf8'), `[CRITICAL] ${title.replace(/\s+/g, ' ')}`);
  assert.ok(calls[0].init.body.includes('Árvíz riasztás'));
  assert.ok(!('X' in calls[1].init.headers) && !('injected' in calls[1].init.headers));
  assert.match(calls[1].init.headers.Tags, /^[a-z0-9_,-]+$/, 'a rule id that is not a safe tag is left out');
});

test('ntfy tags carry the severity and the rule id', async () => {
  const env = setup();
  await env.notifier.dispatch(batch([alert({ severity: 'critical', ruleId: 'vix-spike' })]));
  assert.equal(env.ntfyCalls()[0].init.headers.Tags, 'rotating_light,crucix,vix-spike');
});

test('ntfy tags carry no rule tag unless the rule id is a string of the tag pattern', async () => {
  const env = setup({ minSeverity: 'info', maxPerSweep: 20 });
  const odd = { toString: () => 'sneaky' };
  const ruleIds = [undefined, null, 42, ['vix-spike'], odd, '', 'UPPER', 'a'.repeat(41), 'has space'];
  await env.notifier.dispatch(batch(ruleIds.map(ruleId => alert({ severity: 'info', ruleId }))));
  assert.equal(env.ntfyCalls().length, ruleIds.length);
  for (const { init } of env.ntfyCalls()) assert.equal(init.headers.Tags, 'information_source,crucix');
});

test('network calls use a 10 s abort signal, refuse redirects and never read the response body', async () => {
  let bodyRead = false;
  const fetch = fakeFetch(() => ({ ok: true, status: 200, text() { bodyRead = true; return ''; }, json() { bodyRead = true; return {}; }, arrayBuffer() { bodyRead = true; return new ArrayBuffer(0); } }));
  const env = setup({ fetch });
  const result = await env.notifier.dispatch(batch([alert()]));
  assert.equal(fetch.calls.length, 2);
  for (const { init } of fetch.calls) {
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'POST');
  }
  assert.equal(bodyRead, false);
  assert.deepEqual(result.sent[0].channels, CHANNELS);
});

// ─── failures ──────────────────────────────────────────────────────────────────

test('a throwing or failing channel does not stop the others and no log line leaks a secret', async () => {
  const fetch = fakeFetch(url => {
    if (url === NTFY_URL) throw Object.assign(new Error(`connect ECONNREFUSED ${NTFY_URL} Bearer ${TOKEN}`), { name: 'TypeError' });
    return { ok: false, status: 500, statusText: HOOK_URL };
  });
  const env = setup({ telegram: fakeTelegram({ throws: true }), fetch });
  const result = await env.notifier.dispatch(batch([alert({ severity: 'critical' }), alert({ severity: 'high' })]));

  assert.equal(env.telegram.calls.length, 2, 'the failing channel is still tried for every message');
  assert.equal(env.discord.calls.length, 2);
  assert.deepEqual(result.sent.map(entry => entry.channels), [['discord'], ['discord']]);
  assert.ok(env.logger.lines.length >= 4);
  const log = env.logger.lines.join('\n');
  for (const secret of SECRETS) assert.ok(!log.includes(secret), `log leaks ${secret}`);
  assert.match(log, /telegram/);
  assert.match(log, /ntfy.*TypeError/);
  assert.match(log, /webhook.*HTTP 500/);
});

test('a hanging alerter is given up on at its deadline and the other channels still report', async () => {
  const hanging = Object.assign(fakeTelegram(), { sendMessage: () => new Promise(() => {}) });
  const env = setup({ telegram: hanging, deadlineMs: 20 });
  const result = await env.notifier.dispatch(batch([alert(), alert()]));
  assert.deepEqual(result.sent.map(entry => entry.channels), [['discord', 'ntfy', 'webhook'], ['discord', 'ntfy', 'webhook']]);
  assert.match(env.logger.lines.join('\n'), /telegram failed: TimeoutError/);
  assert.deepEqual([env.discord.calls.length, env.ntfyCalls().length, env.hookCalls().length], [2, 2, 2]);

  const stuckDiscord = Object.assign(fakeDiscord(), { sendMessage: () => new Promise(() => {}) });
  const other = setup({ discord: stuckDiscord, deadlineMs: 20 });
  assert.deepEqual((await other.notifier.dispatch(batch([alert()]))).sent[0].channels, ['telegram', 'ntfy', 'webhook']);
});

test('an alerter that fails after its deadline is not an unhandled rejection', async t => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const late = Object.assign(fakeTelegram(), { sendMessage: () => new Promise((_, reject) => setTimeout(() => reject(new Error('late failure')), 40)) });
  const env = setup({ telegram: late, deadlineMs: 10 });
  await env.notifier.dispatch(batch([alert()]));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(unhandled, []);
});

test('the deadline timer is cleared as soon as the alerter answers or fails', async t => {
  const open = new Set();
  const { setTimeout: realSet, clearTimeout: realClear } = globalThis;
  globalThis.setTimeout = (...args) => { const handle = realSet(...args); open.add(handle); return handle; };
  globalThis.clearTimeout = handle => { open.delete(handle); return realClear(handle); };
  t.after(() => { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; });

  const failing = fakeTelegram({ throws: true });
  const env = setup({ telegram: failing, deadlineMs: 60000 });
  await env.notifier.dispatch(batch([alert(), alert()]));
  assert.equal(env.discord.calls.length, 2);
  assert.equal(failing.calls.length, 2);
  assert.equal(open.size, 0, 'no deadline timer is left running');
});

test('an invalid deadline falls back to the default with a warning', () => {
  for (const deadlineMs of [0, -5, 1.5, '20', 999999]) {
    const { logger } = setup({ deadlineMs });
    assert.ok(logger.lines.some(line => /deadline/.test(line)), String(deadlineMs));
  }
});

test('a channel that answers not-ok is not reported as sent', async () => {
  const env = setup({ telegram: Object.assign(fakeTelegram(), { result: { ok: false } }), discord: Object.assign(fakeDiscord(), { result: false }) });
  const result = await env.notifier.dispatch(batch([alert()]));
  assert.deepEqual(result.sent, [{ alertId: result.sent[0].alertId, channels: ['ntfy', 'webhook'] }]);
  const none = setup({ telegram: Object.assign(fakeTelegram(), { result: { ok: false } }), discord: Object.assign(fakeDiscord(), { result: false }), fetch: fakeFetch(() => ({ ok: false, status: 503 })) });
  assert.deepEqual(await none.notifier.dispatch(batch([alert()])), { sent: [], digest: null, skipped: 0 });
});

test('dispatch never throws, whatever it is given', async () => {
  const env = setup();
  const throwing = { get severity() { throw new Error('getter'); }, id: 'x', notify: true };
  for (const input of [undefined, null, 'x', 42, {}, { created: 'no' }, batch([null, 1, 'x', [], throwing]), { created: [alert()], escalated: null }]) {
    const result = await env.notifier.dispatch(input);
    assert.ok(Array.isArray(result.sent));
    assert.equal(typeof result.skipped, 'number');
  }
  const broken = setup({ logger: { warn() { throw new Error('logger down'); }, error() { throw new Error('logger down'); }, log() { throw new Error('logger down'); } }, telegram: fakeTelegram({ throws: true }) });
  assert.equal((await broken.notifier.dispatch(batch([alert()]))).sent.length, 1);
});

// ─── quiet hours ───────────────────────────────────────────────────────────────

test('parseQuietHours: valid windows, wrap past midnight, and everything else is null', () => {
  assert.deepEqual(parseQuietHours('22:00-07:00'), { start: 1320, end: 420 });
  assert.deepEqual(parseQuietHours('09:30-17:45'), { start: 570, end: 1065 });
  assert.deepEqual(parseQuietHours(' 6:05 - 7:00 '), { start: 365, end: 420 });
  assert.deepEqual(parseQuietHours('00:00-23:59'), { start: 0, end: 1439 });
  for (const bad of ['', '  ', null, undefined, 42, {}, '22:00', '22:00-', '25:00-07:00', '22:60-07:00', '22:00-24:00', 'ab:cd-ef:gh', '22:00-22:00', '22:00-07:00;x', '22.00-07.00', '22:00–07:00', `22:00-07:00${' '.repeat(100)}x`]) {
    assert.equal(parseQuietHours(bad), null, JSON.stringify(bad));
  }
});

test('inQuietHours follows the injected clock: wrap window, plain window, start inclusive, end exclusive, none configured', () => {
  const wrap = setup({ quietHours: '22:00-07:00' }).notifier;
  for (const [hour, minute, quiet] of [[22, 0, true], [23, 30, true], [0, 0, true], [6, 59, true], [7, 0, false], [12, 0, false], [21, 59, false]]) {
    assert.equal(wrap.inQuietHours(new Date(at(hour, minute))), quiet, `${hour}:${minute}`);
  }
  const plain = setup({ quietHours: '09:30-17:45' }).notifier;
  for (const [hour, minute, quiet] of [[9, 29, false], [9, 30, true], [12, 0, true], [17, 44, true], [17, 45, false], [23, 0, false]]) {
    assert.equal(plain.inQuietHours(new Date(at(hour, minute))), quiet, `${hour}:${minute}`);
  }
  const none = setup().notifier;
  assert.equal(none.inQuietHours(new Date(at(3))), false);
  assert.equal(none.inQuietHours(new Date(NaN)), false);
  assert.equal(wrap.inQuietHours(new Date(NaN)), false);
});

test('during quiet hours critical goes through, high is held and released as one digest after the window', async () => {
  const env = setup({ quietHours: '22:00-07:00' });
  env.clock.now = at(23, 30);
  const first = await env.notifier.dispatch(batch([alert({ severity: 'critical', title: 'Critical one' }), alert({ severity: 'high' }), alert({ severity: 'high' })]));
  assert.equal(env.telegram.calls.length, 1);
  assert.match(env.telegram.calls[0][0], /^\[CRITICAL\] Critical one/);
  assert.equal(first.sent.length, 1);
  assert.equal(first.digest, null);
  assert.equal(first.skipped, 0, 'held alerts are not skipped');

  env.clock.now = at(23, 45);
  assert.deepEqual(await env.notifier.dispatch(batch()), { sent: [], digest: null, skipped: 0 });
  assert.equal(env.telegram.calls.length, 1);

  env.clock.now = at(7, 5, 3);
  const released = await env.notifier.dispatch(batch());
  assert.deepEqual(released, { sent: [], digest: { count: 2, channels: CHANNELS }, skipped: 0 });
  assert.equal(env.telegram.calls.length, 2);
  assert.equal(env.telegram.calls[1][0].split('\n')[0], '2 alerts held during quiet hours');
  assert.deepEqual(JSON.parse(env.hookCalls()[1].init.body), { event: 'digest', count: 2, overflow: 0, held: 2 });

  env.clock.now = at(7, 20, 3);
  assert.deepEqual(await env.notifier.dispatch(batch()), { sent: [], digest: null, skipped: 0 });
  assert.equal(env.telegram.calls.length, 2, 'the digest is sent once');
});

test('the release digest also merges with the cap overflow of the same dispatch', async () => {
  const env = setup({ quietHours: '22:00-07:00', maxPerSweep: 1 });
  env.clock.now = at(23, 0);
  await env.notifier.dispatch(batch([alert()]));
  env.clock.now = at(8, 0, 3);
  const result = await env.notifier.dispatch(batch([alert(), alert(), alert()]));
  assert.equal(result.sent.length, 1);
  assert.deepEqual(result.digest, { count: 3, channels: CHANNELS });
  assert.deepEqual(env.telegram.calls.at(-1)[0].split('\n').slice(0, 2), ['+2 more alerts', '1 alert held during quiet hours']);
});

test('a held alert that escalates to critical during quiet hours is sent at once and not counted again', async () => {
  const env = setup({ quietHours: '22:00-07:00' });
  env.clock.now = at(23, 0);
  const held = alert({ severity: 'high' });
  await env.notifier.dispatch(batch([held]));
  assert.equal(env.telegram.calls.length, 0);

  env.clock.now = at(23, 30);
  const result = await env.notifier.dispatch(batch([], [{ ...held, severity: 'critical' }]));
  assert.equal(result.sent.length, 1);
  assert.equal(env.telegram.calls.length, 1);

  env.clock.now = at(8, 0, 3);
  assert.deepEqual(await env.notifier.dispatch(batch()), { sent: [], digest: null, skipped: 0 });
  assert.equal(env.telegram.calls.length, 1);
});

test('a release digest that no channel accepted stays held for the next dispatch', async () => {
  const env = setup({ quietHours: '22:00-07:00', ntfy: undefined, webhook: undefined, discord: undefined });
  env.clock.now = at(23, 0);
  await env.notifier.dispatch(batch([alert()]));
  env.clock.now = at(8, 0, 3);
  env.telegram.result = { ok: false };
  assert.equal((await env.notifier.dispatch(batch())).digest, null);
  env.telegram.result = { ok: true };
  const retry = await env.notifier.dispatch(batch());
  assert.deepEqual(retry.digest, { count: 1, channels: ['telegram'] });
  assert.equal(env.telegram.calls.length, 2);
});

test('a silent batch neither sends nor releases held alerts', async () => {
  const env = setup({ quietHours: '22:00-07:00' });
  env.clock.now = at(23, 0);
  await env.notifier.dispatch(batch([alert()]));
  env.clock.now = at(8, 0, 3);
  assert.deepEqual(await env.notifier.dispatch(batch([], [], true)), { sent: [], digest: null, skipped: 0 });
  assert.equal(env.telegram.calls.length, 0);
  assert.equal((await env.notifier.dispatch(batch())).digest.count, 1);
});

// ─── the existing alerters keep their behaviour ────────────────────────────────

test('TelegramAlerter.sendMessage defaults to Markdown and sends plain text for parseMode null', async t => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ result: { message_id: 7 } }) }; };
  t.after(() => { globalThis.fetch = original; });
  const bot = new TelegramAlerter({ botToken: '123:abc', chatId: '42' });

  assert.deepEqual(await bot.sendMessage('a'), { ok: true, messageId: 7 });
  assert.deepEqual(await bot.sendMessage('b', { parseMode: null }), { ok: true, messageId: 7 });
  await bot.sendMessage('c', { parseMode: 'HTML' });
  assert.equal(bodies[0].parse_mode, 'Markdown');
  assert.equal('parse_mode' in bodies[1], false);
  assert.equal(bodies[1].text, 'b');
  assert.equal(bodies[1].disable_web_page_preview, true);
  assert.equal(bodies[2].parse_mode, 'HTML');
});

test('DiscordAlerter.sendMessage adds allowed_mentions only on request', async t => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 204 }; };
  t.after(() => { globalThis.fetch = original; });
  const bot = new DiscordAlerter({ webhookUrl: 'https://discord.example.test/api/webhooks/1/token' });

  assert.equal(await bot.sendMessage('plain call'), true);
  assert.equal(await bot.sendMessage('quiet call', [], { suppressMentions: true }), true);
  assert.equal('allowed_mentions' in bodies[0], false);
  assert.deepEqual(bodies[1], { content: 'quiet call', allowed_mentions: { parse: [] } });
});
