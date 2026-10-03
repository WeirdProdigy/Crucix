import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePredictionMarkets, briefing, DEFAULT_QUERIES } from '../apis/sources/prediction-markets.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import config from '../crucix.config.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const now = Date.parse('2026-10-02T23:50:00Z');
const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const MIB = 1024 * 1024;
const iso = ms => new Date(ms).toISOString();
const rtl = String.fromCharCode(0x202e), zero = String.fromCharCode(0x200b), bell = String.fromCharCode(7);
const FULL_LT = String.fromCharCode(0xff1c), FULL_GT = String.fromCharCode(0xff1e), GE = String.fromCharCode(0x2265), LE = String.fromCharCode(0x2264);

// Real rows of https://api.manifold.markets/v0/search-markets?term=<word>&limit=10&sort=24-hour-vol&filter=open&contractType=BINARY, captured on
// 2026-10-02 at 23:48 UTC: id, question, probability, volume, closeTime and lastBetTime are as served. The creator's name, id and handle (also inside the
// link) are replaced by placeholders, the avatar is left out, and pool, liquidity, bettor count and creation time are simplified. Times are unix
// MILLISECONDS, probability is 0 to 1, volume is in Mana (play money).
const real = (id, question, slug, over) => ({ id, creatorId: 'creator-id', creatorUsername: 'trader1', creatorName: 'Trader One', createdTime: 1767245956816, question, slug,
  url: `https://manifold.markets/trader1/${slug}`, pool: { NO: 2318.7573071763463, YES: 13524.518022561795 }, p: 0.4513397290581431, totalLiquidity: 1000,
  outcomeType: 'BINARY', mechanism: 'cpmm-1', isResolved: false, uniqueBettorCount: 258, token: 'MANA', ...over });
const INVADE = real('q2CZUhn500', 'Will the US invade Iran before the end of 2026?', 'will-the-us-invade-iran-before-the-zs06u6hptc', { closeTime: 1798790340000, probability: 0.12360435174226582, volume: 112301.60046360925, volume24Hours: 6861.220575620945, lastUpdatedTime: 1790973430214, lastBetTime: 1790973430214, lastCommentTime: 1778966042737 });
const BITCOIN = real('0tE26608Py', 'Will bitcoin rise to 105k before the Strait of Hormuz is freely open?', 'will-bitcoin-rise-to-105k-before-th', { closeTime: 1793491140000, probability: 0.3680017714257132, volume: 816.8022661005045, volume24Hours: 227.66253488209549, lastUpdatedTime: 1790951127816, lastBetTime: 1790951127816, lastCommentTime: 1790903292414 });
// The answer to the word "Hormuz" also held this one: Manifold's search reads the description as well, the question has no such word.
const CONCEDE = real('yLI9ss8PE6', 'Will the US concede Taiwan to the PRC before 2030?', 'will-the-us-concede-taiwan-to-the-p', { closeTime: 1893455940000, probability: 0.1828496894094824, volume: 984.5464458194941, volume24Hours: 150, lastUpdatedTime: 1790966494113, lastBetTime: 1790966494113 });
const NOTHING = real('Egh5858OU0', 'Nothing Ever Happens 2026', 'nothing-ever-happens-2026', { closeTime: 1798779540000, probability: 0.8377531271924297, volume: 881.2621748038356, volume24Hours: 29.31688076485507, lastUpdatedTime: 1790934648080, lastBetTime: 1790934648080 });
const UKRAINE = real('UtgtL9ORLq', 'Ukraine war ends in 2026?', 'ukraine-war-ends-in-2026', { closeTime: 1798761540000, probability: 0.0756367790553753, volume: 2220.563607658758, volume24Hours: 105.6866643819333, lastUpdatedTime: 1790979288326, lastBetTime: 1790979288326 });
const RECESSION = real('Qgg9Rc8PIy', 'Will the U.S. enter a recession in Trump\'s second term?', 'will-the-us-enter-a-recession-in-tr', { closeTime: 1895201940000, probability: 0.37, volume: 296370.30719417235, volume24Hours: 708.63, lastUpdatedTime: 1790971964730, lastBetTime: 1790971964730 });
// One answer per default query, in the order of DEFAULT_QUERIES (Hormuz, Ukraine ceasefire, Iran, Taiwan, recession).
const REAL = [[BITCOIN, CONCEDE], [UKRAINE], [INVADE], [CONCEDE, NOTHING], [RECESSION]];

const copy = value => JSON.parse(JSON.stringify(value));
// An invented market (the fixtures above are real); every field a real row has.
const market = (id, question, over = {}) => ({ id, creatorId: 'creator-id', creatorUsername: 'trader1', creatorName: 'Trader One', createdTime: now - 90 * DAY, closeTime: now + 30 * DAY, question,
  slug: `slug-${id}`, url: `https://manifold.markets/trader1/slug-${id}`, pool: { NO: 100, YES: 100 }, probability: 0.5, p: 0.5, totalLiquidity: 1000, outcomeType: 'BINARY', mechanism: 'cpmm-1',
  volume: 1000, volume24Hours: 100, isResolved: false, uniqueBettorCount: 10, lastUpdatedTime: now - HOUR, lastBetTime: now - HOUR, token: 'MANA', ...over });
const parse = (answers = REAL, options) => parsePredictionMarkets(answers, { now, ...options });
// One word, one answer.
const one = (rows, query = 'Iran', options) => parsePredictionMarkets([rows], { now, queries: [query], ...options });
const ids = result => result.observations.map(row => row.providerId);
const withFetch = async (impl, run) => {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
};
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });
const term = url => new URL(url).searchParams.get('term');
const BY_WORD = { Hormuz: REAL[0], 'Ukraine ceasefire': REAL[1], Iran: REAL[2], Taiwan: REAL[3], recession: REAL[4] };
const answersFor = url => BY_WORD[term(url)] ?? [];

test('parse turns the real answers into ranked market rows with provider times and facts', () => {
  const result = parse();
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'Prediction-Markets');
  // Most traded first. NOTHING (no query word in its question, last bet 14 h ago) and UKRAINE (question lacks "ceasefire") are not listed.
  assert.deepEqual(ids(result), ['manifold:Qgg9Rc8PIy', 'manifold:q2CZUhn500', 'manifold:yLI9ss8PE6', 'manifold:0tE26608Py']);
  assert.equal(result.observedAt, '2026-10-02T20:37:10.214Z', 'the feed time is the newest last bet of a market that matches (UKRAINE, bet later, is no match)');
  const [recession, invade, concede, bitcoin] = result.observations;
  assert.equal(recession.kind, 'market'); assert.equal(recession.source, 'Prediction-Markets'); assert.equal(recession.severity, 'info');
  assert.equal(recession.title, 'Will the U.S. enter a recession in Trump\'s second term?');
  assert.equal(recession.probabilityPct, 37); assert.equal(recession.volume, 296370); assert.equal(recession.platform, 'Manifold');
  assert.equal(recession.closesAt, '2030-01-21 04:59 UTC');
  assert.equal(recession.observedAt, '2026-10-02T20:12:44.730Z', 'provider time: the last bet, never the collection time');
  assert.equal(recession.url, 'https://manifold.markets/trader1/will-the-us-enter-a-recession-in-tr');
  assert.equal(invade.probabilityPct, 12.4); assert.equal(invade.volume, 112302); assert.equal(invade.observedAt, '2026-10-02T20:37:10.214Z'); assert.equal(invade.closesAt, '2027-01-01 07:59 UTC');
  assert.equal(concede.probabilityPct, 18.3); assert.equal(concede.volume, 985);
  assert.equal(bitcoin.probabilityPct, 36.8); assert.equal(bitcoin.volume, 817); assert.equal(bitcoin.observedAt, '2026-10-02T14:25:27.816Z');
  assert.match(invade.summary, /12\.4% \(volume 112,302 Mana, closes 2027-01-01\)/);
  assert.match(invade.summary, /Manifold/); assert.match(invade.summary, /opinion of traders, not an event/i); assert.match(invade.summary, /play money/i); assert.match(invade.summary, /Last bet: 2026-10-02 20:37 UTC/);
  assert.equal(new Set(result.observations.map(row => row.url)).size, 4, 'every market has its own page, so history keeps them apart');
  assert.ok(result.observations.every(row => row.severity === 'info' && row.kind === 'market' && !('lat' in row)), 'a probability is not an event and has no place');
  assert.match(result.summary, /opinion of traders, not an event/i); assert.match(result.summary, /play-money/i);
  assert.match(result.summary, /Watched words: Hormuz; Ukraine ceasefire; Iran; Taiwan; recession\./);
  assert.match(result.summary, /No current market for: Ukraine ceasefire\./); assert.doesNotMatch(result.summary, /Warning/);
  assert.equal(result.examinedRecords, 7); assert.equal(result.truncatedRecords, 0);
});

test('the feed time is the newest last bet, and a market of the same row never needs the collection time', () => {
  const rows = [market('m-00001', 'Iran talks', { lastBetTime: now - 5 * HOUR }), market('m-00002', 'Iran war', { lastBetTime: now - 2 * HOUR, url: 'https://manifold.markets/trader1/b' })];
  const result = one(rows);
  assert.equal(result.observedAt, iso(now - 2 * HOUR)); assert.equal(result.freshness.fresh, true);
  assert.ok(result.observations.every(row => row.observedAt !== iso(now)), 'never the collection time');
  // Ten hours later the market with the bet 5 hours before `now` is 15 hours old and gone, the other one is exactly 12 hours old and still current.
  const later = parsePredictionMarkets([rows], { now: now + 10 * HOUR, queries: ['Iran'] });
  assert.equal(later.status, 'ok'); assert.deepEqual(ids(later), ['manifold:m-00002']); assert.equal(later.observedAt, iso(now - 2 * HOUR)); assert.equal(later.observations[0].observedAt, iso(now - 2 * HOUR));
  assert.equal(parsePredictionMarkets([rows], { now: now + 10 * HOUR + 1000, queries: ['Iran'] }).status, 'stale');
});

test('licence, rights and attribution come from the Manifold API terms and Terms of Service and survive every state', () => {
  const result = parse();
  assert.match(result.attribution, /Manifold/); assert.match(result.attribution, /manifold\.markets/);
  assert.equal(result.license, 'Manifold Terms of Service (personal and non-commercial use)'); assert.equal(result.licenseUrl, 'https://docs.manifold.markets/terms');
  assert.match(result.rights, /Building bots, automated trading systems, algorithmic tools, and integrations that interact with Manifold/);
  assert.match(result.rights, /Scraping the site through means other than the API; circumventing rate limits or security measures/);
  assert.match(result.rights, /You may not use API data to train AI\/ML models for commercial purposes without obtaining a data license from us/);
  assert.match(result.rights, /for your information and personal use only/); assert.match(result.rights, /500 requests per minute per IP/); assert.match(result.rights, /Mana has no cash or redeemable value/);
  assert.match(result.rights, /data@manifold\.markets/);
  assert.ok(result.rights.length <= 1000, `the server keeps 1000 characters of the rights text (${result.rights.length})`);
  const empty = parsePredictionMarkets([[]], { now, queries: ['Iran'] });
  const failed = parsePredictionMarkets([{ error: 'HTTP 503', status: 503 }], { now, queries: ['Iran'] });
  const noQueries = parsePredictionMarkets([], { now, queries: [] });
  for (const state of [empty, failed, noQueries, parse(null)]) { assert.equal(state.license, result.license); assert.equal(state.rights, result.rights); assert.match(state.attribution, /Manifold/); }
  assert.equal(empty.status, 'stale'); assert.equal(failed.status, 'error'); assert.equal(noQueries.status, 'error');
});

test('probabilities are 0 to 1, shown as percent with one decimal, clamped within a rounding error and rejected beyond it', () => {
  const cases = [[0.1236, 12.4], [0.12349, 12.3], [0.0005, 0.1], [0.0004, 0], [0, 0], [1, 100], [0.99951, 100], [0.99949, 99.9], [0.5, 50], [1.0000000000000002, 100], [-1e-12, 0], [0.37, 37]];
  for (const [probability, shown] of cases) {
    const result = one([market('m-00001', 'Iran talks', { probability })]);
    assert.equal(result.observations[0].probabilityPct, shown, String(probability)); assert.match(result.observations[0].summary, new RegExp(`${String(shown).replace('.', '\\.')}% \\(volume`));
  }
  assert.ok(Object.is(one([market('m-00001', 'Iran talks', { probability: -1e-12 })]).observations[0].probabilityPct, 0), 'no negative zero');
  // A value outside 0..1 is another unit or another shape, never a probability: the row is left out and counted as unreadable.
  for (const probability of [1.5, 63, 100, -0.2, NaN, Infinity, null, undefined, '0.5', '37%', {}, []]) {
    const result = one([market('m-00001', 'Iran talks', { probability }), market('m-00002', 'Iran deal', { url: 'https://manifold.markets/trader1/b' })]);
    assert.deepEqual(ids(result), ['manifold:m-00002'], String(probability)); assert.match(result.summary, /1 of the 2 markets could not be read/);
  }
  const allBad = one([market('m-00001', 'Iran talks', { probability: 63 })]);
  assert.equal(allBad.status, 'error'); assert.deepEqual(allBad.observations, []); assert.match(allBad.error, /unexpected shape/i);
});

test('closed markets, stale markets and markets without a trade are never shown as current', () => {
  assert.deepEqual(POLICIES['Prediction-Markets'], { maxAgeMs: 12 * HOUR, observationMaxAgeMs: 12 * HOUR });
  const listed = rows => ids(one(rows));
  // The close time must lie in the future; the instant of closing is already closed.
  assert.deepEqual(listed([market('m-00001', 'Iran a', { closeTime: now + 1 }), market('m-00002', 'Iran b', { closeTime: now, url: 'https://manifold.markets/trader1/b' }), market('m-00003', 'Iran c', { closeTime: now - 1, url: 'https://manifold.markets/trader1/c' })]), ['manifold:m-00001']);
  // The last bet must be within 12 hours: exactly 12 h is current, a second more is not.
  assert.deepEqual(listed([market('m-00001', 'Iran a', { lastBetTime: now - 12 * HOUR }), market('m-00002', 'Iran b', { lastBetTime: now - 12 * HOUR - 1000, url: 'https://manifold.markets/trader1/b' })]), ['manifold:m-00001']);
  // Resolved markets never are.
  assert.deepEqual(listed([market('m-00001', 'Iran a', { isResolved: true, resolution: 'NO', resolutionTime: now - DAY }), market('m-00002', 'Iran b', { url: 'https://manifold.markets/trader1/b' })]), ['manifold:m-00002']);
  // A bet that is ahead of the clock (more than five minutes) is not provider time that can be trusted.
  assert.deepEqual(listed([market('m-00001', 'Iran a', { lastBetTime: now + 4 * MIN }), market('m-00002', 'Iran b', { lastBetTime: now + 6 * MIN, url: 'https://manifold.markets/trader1/b' }), market('m-00003', 'Iran c', { lastBetTime: now + 3 * DAY, url: 'https://manifold.markets/trader1/c' })]), ['manifold:m-00001']);
  // A market nobody has bet on has no last bet: its probability is the creator's starting value, not an opinion of traders.
  const untraded = market('m-00001', 'Iran a', { volume: 0 }); delete untraded.lastBetTime;
  assert.deepEqual(listed([untraded, market('m-00002', 'Iran b', { url: 'https://manifold.markets/trader1/b' })]), ['manifold:m-00002']);
  assert.equal(one([untraded]).status, 'stale', 'no market with a trade is no current feed'); assert.equal(one([untraded]).observedAt, null, 'and has no provider time at all'); assert.equal(one([untraded]).freshness.reason, 'unknown-provider-time');
  // The newest last bet decides the feed time even when it is old: an old list is expired, not undated.
  const old = one([market('m-00001', 'Iran a', { lastBetTime: now - 20 * HOUR }), market('m-00002', 'Iran b', { lastBetTime: now - 30 * HOUR, url: 'https://manifold.markets/trader1/b' })]);
  assert.equal(old.status, 'stale'); assert.deepEqual(old.observations, []); assert.equal(old.observedAt, iso(now - 20 * HOUR)); assert.equal(old.freshness.reason, 'expired-provider-time');
  // Only closed markets: nothing is a current market at all.
  const closed = one([market('m-00001', 'Iran a', { closeTime: now - HOUR }), market('m-00002', 'Iran b', { closeTime: now - DAY, url: 'https://manifold.markets/trader1/b' })]);
  assert.equal(closed.status, 'stale'); assert.equal(closed.observedAt, null); assert.equal(closed.freshness.reason, 'unknown-provider-time'); assert.deepEqual(closed.observations, []);
  // A closed market does not lend its bet time to the feed.
  const mixed = one([market('m-00001', 'Iran a', { closeTime: now - HOUR, lastBetTime: now - MIN }), market('m-00002', 'Iran b', { lastBetTime: now - 20 * HOUR, url: 'https://manifold.markets/trader1/b' })]);
  assert.equal(mixed.status, 'stale'); assert.equal(mixed.observedAt, iso(now - 20 * HOUR));
  // Every answer empty: a quiet or misspelled watch list, never a healthy feed.
  const none = parse([[], [], [], [], []]);
  assert.equal(none.status, 'stale'); assert.deepEqual(none.observations, []); assert.equal(none.observedAt, null); assert.match(none.summary, /No current market for: Hormuz; Ukraine ceasefire; Iran; Taiwan; recession\./);
});

test('close dates far in the future are shown as 2100 or later, never as a year thousands of years away', () => {
  const far = one([market('m-00001', 'Iran a', { closeTime: Date.parse('4567-03-12T23:59:00Z') }), market('m-00002', 'Iran b', { closeTime: Date.parse('2100-01-01T00:00:00Z'), url: 'https://manifold.markets/trader1/b' }),
    market('m-00003', 'Iran c', { closeTime: Date.parse('2099-12-31T23:59:00Z'), url: 'https://manifold.markets/trader1/c' })]);
  const byId = Object.fromEntries(far.observations.map(row => [row.providerId, row]));
  assert.equal('closesAt' in byId['manifold:m-00001'], false); assert.match(byId['manifold:m-00001'].summary, /close date in 2100 or later/); assert.doesNotMatch(byId['manifold:m-00001'].summary, /4567/);
  assert.equal('closesAt' in byId['manifold:m-00002'], false, 'the year 2100 itself reads as no date');
  assert.equal(byId['manifold:m-00003'].closesAt, '2099-12-31 23:59 UTC'); assert.match(byId['manifold:m-00003'].summary, /closes 2099-12-31\)/);
  // A date beyond what a clock can show, or seconds instead of milliseconds, is another shape.
  for (const closeTime of [8.64e15 + 1, 1e18, 1798790340, -5, 0, null, undefined, '1798790340000', NaN]) {
    const result = one([market('m-00001', 'Iran a', { closeTime }), market('m-00002', 'Iran b', { url: 'https://manifold.markets/trader1/b' })]);
    assert.deepEqual(ids(result), ['manifold:m-00002'], String(closeTime)); assert.match(result.summary, /1 of the 2 markets could not be read/);
  }
});

test('duplicate questions are kept, the same market under two words is listed once', () => {
  const a = market('m-00001', 'Will Iran close the strait?', { volume: 500 }), b = market('m-00002', 'Will Iran close the strait?', { volume: 400, url: 'https://manifold.markets/trader2/will-iran-close-the-strait' });
  const twins = one([a, b]);
  assert.deepEqual(ids(twins), ['manifold:m-00001', 'manifold:m-00002'], 'two markets with one question are two markets'); assert.equal(new Set(twins.observations.map(row => row.url)).size, 2);
  const both = parsePredictionMarkets([[a], [a, b]], { now, queries: ['Iran', 'strait'] });
  assert.deepEqual(ids(both), ['manifold:m-00001', 'manifold:m-00002'], 'found by two words, one row'); assert.equal(both.observations.length, 2);
  assert.notEqual(one([a]).observations[0].providerId, one([b]).observations[0].providerId);
  // Answers collected at different times can hold the same market twice: the newer reading stands, whatever the order.
  const older = market('m-00001', 'Iran talks', { probability: 0.2, lastBetTime: now - 5 * HOUR }), newer = market('m-00001', 'Iran talks', { probability: 0.6, lastBetTime: now - HOUR });
  for (const answers of [[[older], [newer]], [[newer], [older]]]) { const read = parsePredictionMarkets(answers, { now, queries: ['Iran', 'talks'] }); assert.equal(read.observations.length, 1); assert.equal(read.observations[0].probabilityPct, 60); assert.equal(read.observations[0].observedAt, iso(now - HOUR)); }
});

test('query words match the question only: case and accent insensitive, every word, any order, at the start of a word', () => {
  const rows = [market('m-00001', 'Will Iran attack?'), market('m-00002', 'IRANIAN election result', { url: 'https://manifold.markets/trader1/b' }), market('m-00003', 'Miranda to win', { url: 'https://manifold.markets/trader1/c' }),
    market('m-00004', 'Zürich housing prices', { url: 'https://manifold.markets/trader1/d' }), market('m-00005', 'Will a ceasefire hold in Ukraine?', { url: 'https://manifold.markets/trader1/e' }), market('m-00006', 'Ukraine war ends?', { url: 'https://manifold.markets/trader1/f' }),
    market('m-00007', 'Taiwan’s chip exports', { url: 'https://manifold.markets/trader1/g' }), market('m-00008', 'Recessions in 2027', { url: 'https://manifold.markets/trader1/h' }), market('m-00009', 'Café culture', { url: 'https://manifold.markets/trader1/i' })];
  const found = (query, list = rows) => ids(one(list, query)).map(id => id.slice(-5));
  assert.deepEqual(found('iran'), ['00001', '00002'], 'case-insensitive, a word start (Iranian) matches, Miranda does not');
  assert.deepEqual(found('IRAN'), ['00001', '00002']); assert.deepEqual(found('ir'), ['00001', '00002'], 'a prefix of a word is a match');
  assert.deepEqual(found('zurich'), ['00004'], 'accent-insensitive: the query has no umlaut'); assert.deepEqual(found('Zürich'), ['00004']); assert.deepEqual(found('ZÜRICH'), ['00004']); assert.deepEqual(found('Zu' + String.fromCharCode(0x308) + 'rich'), ['00004'], 'a letter with a combining mark is the same letter');
  assert.deepEqual(found('cafe'), ['00009']); assert.deepEqual(found('café'), ['00009']);
  assert.deepEqual(found('Ukraine ceasefire'), ['00005'], 'every word has to be in the question'); assert.deepEqual(found('ceasefire Ukraine'), ['00005'], 'in any order');
  assert.deepEqual(found('Ukraine'), ['00005', '00006']);
  assert.deepEqual(found('taiwan'), ['00007'], 'a curly apostrophe ends the word'); assert.deepEqual(found('recession'), ['00008']);
  assert.deepEqual(found('rira'), [], 'the middle of a word is no match'); assert.deepEqual(found('xyz'), []);
  // Plain text only: markup characters in a query are punctuation, not a pattern.
  assert.deepEqual(found('.*'), []); assert.deepEqual(found('Iran|Ukraine'), [], 'a pipe is punctuation, not an alternation: both words are needed');
  assert.deepEqual(found('<b>Iran</b>'), ['00001', '00002'], 'tags around a word are punctuation');
  // The match is on the question, never on the description or the creator (Manifold\'s own search reads more than the question).
  const description = market('m-00001', 'Nothing Ever Happens 2026', { description: 'Taiwan, Iran', creatorUsername: 'Iran' });
  assert.deepEqual(found('Iran', [description]), []); assert.equal(one([description]).status, 'stale');
});

test('at most 20 rows, the most traded first, cut before the provider-side first-100 slice and bounded in what is examined', () => {
  assert.equal(DEFAULT_QUERIES.length, 5);
  // Six answers of 20 examined rows each hold 120 current markets; the 20 of the highest volume win, and the busiest ones sit at the end.
  const answers = Array.from({ length: 6 }, (_, q) => Array.from({ length: 20 }, (_, i) => market(`m-${q}-${String(i).padStart(3, '0')}`, `Word${q} market ${i}`, { volume: 1000 + q * 20 + i, url: `https://manifold.markets/trader1/m-${q}-${i}` })));
  const queries = ['Word0', 'Word1', 'Word2', 'Word3', 'Word4', 'Word5'];
  const result = parsePredictionMarkets(answers, { now, queries });
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 20);
  assert.deepEqual(result.observations.map(row => row.volume), Array.from({ length: 20 }, (_, i) => 1119 - i), 'the top 20 by volume, highest first');
  assert.equal(result.examinedRecords, 120); assert.equal(result.truncatedRecords, 100, 'the rest is reported, not hidden');
  assert.equal(result.rejectedObservations, 0);
  // Ties in volume resolve by id, so the order never depends on the order of the answer.
  const tie = ['m-00003', 'm-00001', 'm-00002'].map((id, i) => market(id, 'Iran tie', { volume: 50, url: `https://manifold.markets/trader1/t${i}` }));
  assert.deepEqual(ids(one(tie)), ['manifold:m-00001', 'manifold:m-00002', 'manifold:m-00003']); assert.deepEqual(ids(one([...tie].reverse())), ids(one(tie)));
  // Only the first 20 rows of an answer are looked at: a market buried at position 21 is never read.
  const buried = Array.from({ length: 25 }, (_, i) => market(`m-b${String(i).padStart(3, '0')}`, 'Iran buried', { volume: i + 1, url: `https://manifold.markets/trader1/b${i}` }));
  const cut = one(buried);
  assert.equal(cut.observations.length, 20); assert.equal(cut.examinedRecords, 20); assert.equal(cut.truncatedRecords, 5); assert.ok(!ids(cut).includes('manifold:m-b020'), 'a row after the first 20 is never read');
  // Markets that are too old must not take a place among the 20: the cap counts current markets only.
  const stale = Array.from({ length: 20 }, (_, i) => market(`m-s${String(i).padStart(3, '0')}`, 'Iran old', { volume: 9000 + i, lastBetTime: now - 20 * HOUR, url: `https://manifold.markets/trader1/s${i}` }));
  const fresh = Array.from({ length: 3 }, (_, i) => market(`m-f${i}aaaa`, 'Taiwan new', { volume: 10 + i, url: `https://manifold.markets/trader1/f${i}` }));
  const crowded = parsePredictionMarkets([stale, fresh], { now, queries: ['Iran', 'Taiwan'] });
  assert.equal(crowded.status, 'ok'); assert.deepEqual(ids(crowded), ['manifold:m-f2aaaa', 'manifold:m-f1aaaa', 'manifold:m-f0aaaa'], 'old markets of a high volume do not push current ones out'); assert.match(crowded.summary, /No current market for: Iran./);
  // A hostile answer with a million rows costs a fixed amount of work.
  const flood = new Array(1000000).fill(market('m-00001', 'Iran flood')), started = Date.now();
  const huge = one(flood);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`); assert.equal(huge.examinedRecords, 20); assert.equal(huge.truncatedRecords, 1000000 - 20); assert.equal(huge.observations.length, 1, 'the same market 20 times is one row');
});

test('a query that fails leaves the others; all failing is an error without a URL', () => {
  const half = parse([{ error: 'HTTP 429', status: 429 }, [UKRAINE], [INVADE], [CONCEDE, NOTHING], [RECESSION]]);
  assert.equal(half.status, 'ok'); assert.deepEqual(ids(half), ['manifold:Qgg9Rc8PIy', 'manifold:q2CZUhn500', 'manifold:yLI9ss8PE6']);
  assert.match(half.summary, /Warning: the search for Hormuz \(HTTP 429\) failed\./); assert.doesNotMatch(half.summary, /No current market for: Hormuz/, 'a failed search is not a quiet one');
  const several = parse([{ error: 'HTTP 503' }, { error: 'Request timed out after 10000ms' }, [INVADE], 'text', null]);
  assert.equal(several.status, 'ok'); assert.match(several.summary, /Warning: the search for Hormuz \(HTTP 503\), Ukraine ceasefire \(Request timed out after 10000ms\), Taiwan and recession failed\./);
  const all = parse([{ error: 'HTTP 503 from https://api.manifold.markets/v0/search-markets?term=Iran&key=secret', status: 503 }, { error: 'HTTP 429' }, { error: 'timeout' }, { error: 'x' }, { error: 'y' }]);
  assert.equal(all.status, 'error'); assert.deepEqual(all.observations, []); assert.equal(all.observedAt, null); assert.doesNotMatch(all.error, /https?:|secret|api\.manifold/i); assert.match(all.error, /Manifold/);
  for (const payload of [{}, [], null, undefined, 'text', 42, true, { results: [] }, { markets: [UKRAINE] }]) {
    const result = parsePredictionMarkets(payload === undefined ? [] : [payload], { now, queries: ['Iran'] });
    assert.notEqual(result.status, 'ok', JSON.stringify(payload)); assert.deepEqual(result.observations, []);
    if (!Array.isArray(payload)) assert.equal(result.status, 'error', JSON.stringify(payload)); else assert.equal(result.status, 'stale');
  }
  assert.match(parsePredictionMarkets([{}], { now, queries: ['Iran'] }).error, /unexpected response/i);
  assert.equal(parsePredictionMarkets([[]], { now, queries: ['Iran'] }).status, 'stale');
  assert.equal(parsePredictionMarkets(undefined, { now, queries: ['Iran'] }).status, 'error'); assert.equal(parsePredictionMarkets('x', { now }).status, 'error'); assert.equal(parsePredictionMarkets({ 0: [INVADE] }, { now, queries: ['Iran'] }).status, 'error', 'answers are a list');
});

test('a changed provider shape is an error, a partly changed one a note, never a quiet feed', () => {
  const rename = (list, from, to) => list.map(row => { const next = copy(row); next[to] = next[from]; delete next[from]; return next; });
  const rows = [market('m-00001', 'Iran a'), market('m-00002', 'Iran b', { url: 'https://manifold.markets/trader1/b' })];
  for (const [from, to] of [['question', 'title'], ['probability', 'prob'], ['lastBetTime', 'lastBet'], ['closeTime', 'closesAt'], ['id', 'contractId'], ['url', 'link'], ['volume', 'vol'], ['outcomeType', 'type'], ['isResolved', 'resolved']]) {
    const result = one(rename(rows, from, to));
    assert.equal(result.status, 'error', `${from} renamed`); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null); assert.match(result.error, /unexpected shape/i); assert.doesNotMatch(result.error, /https?:/);
    const partial = one([rename(rows, from, to)[0], rows[1]]);
    assert.equal(partial.status, 'ok', `${from} renamed in one row`); assert.deepEqual(ids(partial), ['manifold:m-00002']); assert.match(partial.summary, /Warning: 1 of the 2 markets could not be read/);
  }
  // Times in seconds (a plausible API change) are no provider time.
  const seconds = rows.map(row => ({ ...row, lastBetTime: Math.round(row.lastBetTime / 1000), lastUpdatedTime: Math.round(row.lastUpdatedTime / 1000) }));
  assert.equal(one(seconds).status, 'error'); assert.match(one(seconds).error, /unexpected shape/i);
  // A trade time that went missing while there is volume is a changed shape; no volume and no trade is simply a quiet market.
  const noTime = rows.map(row => { const next = copy(row); delete next.lastBetTime; return next; });
  assert.equal(one(noTime).status, 'error');
  assert.equal(one(noTime.map(row => ({ ...row, volume: 0 }))).status, 'stale');
  assert.equal(one([copy(rows[0]), 5, null, 'x', []]).status, 'ok'); assert.match(one([copy(rows[0]), 5, null, 'x', []]).summary, /4 of the 5 markets could not be read/);
  // Other kinds of market and the wrong token are not what was asked for.
  for (const over of [{ outcomeType: 'MULTIPLE_CHOICE' }, { outcomeType: 'POLL' }, { outcomeType: undefined }]) assert.equal(one([market('m-00001', 'Iran a', over)]).status, 'error', JSON.stringify(over));
  assert.equal(one([market('m-00001', 'Iran a', { isResolved: undefined }), market('m-00002', 'Iran b', { url: 'https://manifold.markets/trader1/b' })]).observations.length, 1);
  // Links: only a market page of manifold.markets, with a plain path.
  for (const url of ['http://manifold.markets/trader1/a', 'https://evil.example/trader1/a', 'https://manifold.markets.evil.example/trader1/a', 'https://manifold.markets/trader1', 'https://manifold.markets/trader1/a/b', 'https://manifold.markets/../a', 'https://manifold.markets/trader1/a b',
    'javascript:alert(1)', 'https://manifold.markets/trader1/a?x=1', 'https://manifold.markets/trader1/a#x', 'https://user:pw@manifold.markets/trader1/a', `https://manifold.markets/trader1/${'a'.repeat(300)}`, 5, null, {}, '']) {
    const result = one([market('m-00001', 'Iran a', { url }), market('m-00002', 'Iran b', { url: 'https://manifold.markets/trader1/b' })]);
    assert.deepEqual(ids(result), ['manifold:m-00002'], String(url).slice(0, 40));
  }
  for (const id of ['', 'a', 'abc', 'a b c d e f', '../../etc/passwd', 'x'.repeat(41), 5, null, '<script>']) assert.deepEqual(ids(one([market(id, 'Iran a')])), [], String(id).slice(0, 20));
  // An id that is plain text of the right length is fine, and a row keeps the id as its identity.
  assert.deepEqual(ids(one([market('Abc_-123xy', 'Iran a')])), ['manifold:Abc_-123xy']);
});

test('hostile provider text stays inert and comparison signs in a question survive', () => {
  const evil = `<img src=x onerror=alert(1)>${rtl}Iran${zero}${bell} <b>bold</b>`;
  const row = one([market('m-00001', evil)]).observations[0];
  assert.doesNotMatch(row.title, /[<>]/); assert.doesNotMatch(row.title, new RegExp(`[${rtl}${zero}${bell}]`)); assert.doesNotMatch(row.summary, /[<>]/);
  assert.match(row.title, /Iran/);
  // A question reads the same with its signs: a comparison is not markup, and dropping it would change what is asked.
  const questions = ['Will an AI-created movie have a rating >=7.0 on IMDB by 2028 for Iran?', 'Iran: acceptance rate <20%?', 'Iran decade (<2030)', 'Will Iran oil be >100 and Iran <5?', 'Iran a<=b>=c'];
  const shown = one(questions.map((question, i) => market(`m-0000${i}`, question, { url: `https://manifold.markets/trader1/q${i}` }))).observations.map(item => item.title).sort();
  assert.deepEqual(shown, [`Iran a${LE}b${GE}c`, `Iran decade (${FULL_LT}2030)`, `Iran: acceptance rate ${FULL_LT}20%?`, `Will Iran oil be ${FULL_GT}100 and Iran ${FULL_LT}5?`, `Will an AI-created movie have a rating ${GE}7.0 on IMDB by 2028 for Iran?`].sort());
  assert.ok(shown.every(title => !/[<>]/.test(title)), 'no ASCII angle bracket is left, so nothing can open a tag');
  // Line breaks inside a question become spaces; the title is cut to 300 characters.
  assert.equal(one([market('m-00001', 'Iran\nPrize\r\n\tProblem')]).observations[0].title, 'Iran Prize Problem');
  assert.equal(one([market('m-00001', `Iran ${'x'.repeat(1000)}`)]).observations[0].title.length, 300);
});

// Standing rule for every adapter: bound every input before any pattern or loop runs on it, and prove it fails fast.
test('hostile oversized provider fields are bounded in time and never stall the loop', () => {
  const n = 200000;
  const floods = ['<'.repeat(n), '<a '.repeat(n / 3), `${'<'.repeat(n)}Iran`, 'x'.repeat(n), `${' '.repeat(n)}Iran`, `Iran${zero.repeat(n)}`, 'http://'.repeat(n / 7), `Iran ${'\n'.repeat(n)}`];
  const rowsOf = make => floods.map((text, i) => make(text, i));
  const started = Date.now();
  const asQuestion = one(rowsOf((text, i) => market(`m-q${i}aaaa`, text.includes('Iran') ? text : `Iran ${text}`, { url: `https://manifold.markets/trader1/q${i}` })));
  const asUrl = one(rowsOf((text, i) => market(`m-u${i}aaaa`, 'Iran url', { url: `https://manifold.markets/trader1/${text}` })));
  const asId = one(rowsOf(text => market(text, 'Iran id')));
  const asExtra = one(rowsOf((text, i) => market(`m-e${i}aaaa`, 'Iran extra', { url: `https://manifold.markets/trader1/e${i}`, creatorUsername: text, creatorName: text, slug: text, description: text, token: text, resolution: text })));
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  // Of the eight questions one is only spaces before the cut (no question left: unreadable) and one has "Iran" only beyond the cut (no match).
  assert.equal(asQuestion.observations.length, 6); assert.match(asQuestion.summary, /1 of the 8 markets could not be read/); assert.equal(asUrl.status, 'error'); assert.equal(asId.status, 'error'); assert.equal(asExtra.observations.length, 8);
  for (const row of [...asQuestion.observations, ...asExtra.observations]) { assert.doesNotMatch(row.title, /[<>]/); assert.ok(row.title.length <= 300); assert.ok(row.summary.length < 700, `summary length ${row.summary.length}`); assert.ok(JSON.stringify(row).length < 3000, 'only whitelisted fields are kept'); }
  const queryFlood = parsePredictionMarkets([[market('m-00001', 'Iran a')]], { now, queries: ['<'.repeat(1000000), 'Iran'] });
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`); assert.deepEqual(ids(queryFlood), ['manifold:m-00001']);
  for (const error of ['http://'.repeat(150000), '<'.repeat(1000000), 'x'.repeat(1000000)]) {
    const failed = parsePredictionMarkets([{ error }], { now, queries: ['Iran'] });
    assert.equal(failed.status, 'error'); assert.ok(failed.error.length <= 300); assert.doesNotMatch(failed.error, /https?:/);
    const partly = parsePredictionMarkets([{ error }, [market('m-00001', 'Taiwan a')]], { now, queries: ['Iran', 'Taiwan'] });
    assert.equal(partly.status, 'ok'); assert.ok(partly.summary.length < 1200, `summary length ${partly.summary.length}`); assert.doesNotMatch(partly.summary, /https?:/);
  }
  const huge = one([market('m-00001', 'Iran a', { id: 'x'.repeat(1000000), url: `https://manifold.markets/${'a'.repeat(1000000)}/b` }), market('m-00002', 'Iran b', { url: 'https://manifold.markets/trader1/b' })]);
  assert.deepEqual(ids(huge), ['manifold:m-00002']);
  assert.ok(Date.now() - started < 2500, `took ${Date.now() - started} ms in all`);
});

test('the watched words are validated: strings only, cleaned, cut, no repeats, at most six', () => {
  const asked = list => parsePredictionMarkets(list.map(() => []), { now, queries: list });
  const watched = (queries, answers) => (parsePredictionMarkets(answers ?? queries.map(() => [market('m-00001', 'Iran a')]), { now, queries }).summary.match(/Watched words: ([^.]*)\./) ?? [])[1];
  assert.equal(watched(['Iran', 'iran', 'IRAN', ' Iran ', 'Irán']), 'Iran', 'case and accent variants of a word are one word');
  assert.equal(watched(['Iran', 5, null, {}, [], undefined, true, '', '   ', '...', '<>', 'a', 'Taiwan']), 'Iran; Taiwan', 'non-strings and entries without a word of two letters or digits are skipped');
  assert.equal(watched(['<b>Iran</b>', `${rtl}Taiwan${bell}`]), 'Iran; Taiwan', 'markup and control characters are punctuation, one-letter words are dropped');
  assert.equal(watched(['Zürich & co.']), 'Zürich co', 'what is searched is the words');
  assert.equal(watched(['a'.repeat(100000)]), 'a'.repeat(60), 'a word is cut to 60 characters');
  assert.equal(watched(Array.from({ length: 30 }, (_, i) => `word${i}`)), 'word0; word1; word2; word3; word4; word5', 'at most six');
  assert.equal(watched(['Iran', 'Taiwan'].concat(Array.from({ length: 100000 }, (_, i) => `x${i}`))), 'Iran; Taiwan; x0; x1; x2; x3', 'a hostile list is read only as far as needed');
  // Only the first 20 entries of a configured list are read, however long it is.
  const longList = [...new Array(1000000).fill(''), 'Iran'], listed = Date.now();
  assert.equal(parsePredictionMarkets([[]], { now, queries: longList }).status, 'error'); assert.ok(Date.now() - listed < 1000, `took ${Date.now() - listed} ms`);
  assert.deepEqual(asked(['', 5, '<>']).status, 'error'); assert.match(asked([]).error, /No valid market queries/); assert.equal(asked(DEFAULT_QUERIES).status, 'stale');
  assert.equal(parsePredictionMarkets([], { now, queries: 'Iran' }).status, 'error', 'a text is no list'); assert.equal(parsePredictionMarkets([], { now, queries: { 0: 'Iran' } }).status, 'error');
  // The default list is the configured one, and an undefined option means the default list.
  assert.deepEqual(config.publicSources.marketQueries, ['Hormuz', 'Ukraine ceasefire', 'Iran', 'Taiwan', 'recession']); assert.deepEqual([...DEFAULT_QUERIES], config.publicSources.marketQueries);
  assert.deepEqual(parsePredictionMarkets(REAL, { now }), parsePredictionMarkets(REAL, { now, queries: config.publicSources.marketQueries }));
});

test('provider ids are fixed and rows keep their identity across parses and sweeps', () => {
  assert.deepEqual(ids(parse()), ids(parse())); assert.deepEqual(ids(parse(copy(REAL))), ids(parse()));
  const moved = copy(REAL); moved[2][0].probability = 0.4; moved[2][0].volume = 120000; moved[2][0].lastBetTime = now - MIN;
  assert.deepEqual(ids(parse(moved)).sort(), ids(parse()).sort(), 'new values update the same rows');
  assert.ok(ids(parse()).every(id => /^manifold:[A-Za-z0-9_-]+$/.test(id)), 'no time in an id');
  assert.deepEqual(ids(parsePredictionMarkets(REAL, { now: now + HOUR })), ids(parse()));
});

test('observations survive the server normalization with facts, home and policy; events keep their identity', () => {
  assert.deepEqual(FACT_FIELDS['Prediction-Markets'], ['probabilityPct', 'volume', 'closesAt', 'platform']);
  assert.equal(HOME['Prediction-Markets'], 'https://manifold.markets/');
  const keys = Object.keys(POLICIES); assert.equal(keys.indexOf('Prediction-Markets'), keys.indexOf('ENTSOG-HU') + 1, 'appended right after the previous last source');
  const [out] = normalizeLiveSources({ 'Prediction-Markets': parse() }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://manifold.markets/'); assert.equal(out.observations.length, 4);
  const invade = out.observations.find(row => row.providerId === 'manifold:q2CZUhn500');
  assert.deepEqual(invade.facts, [{ label: 'probabilityPct', value: 12.4 }, { label: 'volume', value: 112302 }, { label: 'closesAt', value: '2027-01-01 07:59 UTC' }, { label: 'platform', value: 'Manifold' }]);
  assert.equal(invade.kind, 'market'); assert.equal(invade.severity, 'info'); assert.equal(invade.observedAt, '2026-10-02T20:37:10.214Z'); assert.equal(invade.url, 'https://manifold.markets/trader1/will-the-us-invade-iran-before-the-zs06u6hptc');
  assert.ok(out.observations.every(row => row.kind === 'market' && row.facts.length === 4), 'a row of any other kind would have become a signal');
  assert.equal(out.license, 'Manifold Terms of Service (personal and non-commercial use)'); assert.match(out.attribution, /Manifold/); assert.deepEqual(out.metrics, {});
  const [far] = normalizeLiveSources({ 'Prediction-Markets': one([market('m-00001', 'Iran a', { closeTime: Date.parse('4567-03-12T23:59:00Z') })]) }, now);
  assert.deepEqual(far.observations[0].facts.map(fact => fact.label), ['probabilityPct', 'volume', 'platform'], 'no close date, no fact');
  const [stale] = normalizeLiveSources({ 'Prediction-Markets': one([market('m-00001', 'Iran a', { lastBetTime: now - 13 * HOUR })]) }, now);
  assert.equal(stale.status, 'stale'); assert.deepEqual(stale.observations, []);
  const events = buildEvents({ meta: { timestamp: iso(now) }, liveSources: [out] }, { now });
  assert.equal(events.length, 4); assert.ok(events.every(event => event.kind === 'market')); assert.equal(new Set(events.map(event => event.source.url)).size, 4);
  const eventIds = payload => buildEvents({ meta: { timestamp: iso(now) }, liveSources: normalizeLiveSources({ 'Prediction-Markets': payload }, now) }, { now }).map(event => event.id).sort();
  assert.deepEqual(eventIds(parse()), eventIds(parse()), 'event identities are stable across parses');
  const moved = copy(REAL); moved[2][0].probability = 0.4; moved[2][0].lastBetTime = now - MIN;
  assert.deepEqual(eventIds(parse(moved)), eventIds(parse()), 'and across new values');
});

test('history keeps one record per market and updates it in place: a new sweep never adds rows', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-prediction-markets-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = new HistoryStore(dir, { now: () => now + 2 * HOUR });
  const eventsFor = (answers, at) => buildEvents({ meta: { timestamp: iso(at) }, liveSources: normalizeLiveSources({ 'Prediction-Markets': parsePredictionMarkets(answers, { now: at }) }, at) }, { now: at });
  const first = eventsFor(REAL, now);
  const moved = copy(REAL); moved[2][0].probability = 0.5; moved[2][0].volume = 130000; moved[2][0].lastBetTime = now + 10 * MIN; moved[4][0].lastBetTime = now + 5 * MIN;
  const second = eventsFor(moved, now + 15 * MIN);
  assert.equal(first.length, 4); assert.equal(new Set(first.map(event => event.source.url)).size, 4, 'four markets, four links: history cannot merge them');
  assert.deepEqual(history.add(first), { added: 4, updated: 0, ignored: 0, total: 4 });
  assert.deepEqual(history.add(second), { added: 0, updated: 4, ignored: 0, total: 4 }, 'new probabilities update the same records');
  assert.deepEqual(history.add(eventsFor(moved, now + 20 * MIN)), { added: 0, updated: 4, ignored: 0, total: 4 });
  assert.equal(history.query({ source: 'Prediction-Markets' }).total, 4);
  assert.deepEqual(second.map(event => event.id).sort(), first.map(event => event.id).sort(), 'the event ids are stable across sweeps');
});

test('briefing asks Manifold once per watched word with the real parameter names and no other host', async () => {
  const seen = [];
  const result = await briefing({ now, fetcher: async (url, options) => { seen.push({ url: new URL(url), options }); return answersFor(url); } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 5); assert.deepEqual(ids(result), ['manifold:Qgg9Rc8PIy', 'manifold:q2CZUhn500', 'manifold:yLI9ss8PE6', 'manifold:0tE26608Py']);
  assert.deepEqual(seen.map(item => item.url.searchParams.get('term')), ['Hormuz', 'Ukraine ceasefire', 'Iran', 'Taiwan', 'recession']);
  for (const { url, options } of seen) {
    assert.equal(url.origin, 'https://api.manifold.markets'); assert.equal(url.pathname, '/v0/search-markets');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['contractType', 'filter', 'limit', 'sort', 'term']);
    assert.equal(url.searchParams.get('limit'), '10'); assert.equal(url.searchParams.get('sort'), '24-hour-vol'); assert.equal(url.searchParams.get('filter'), 'open'); assert.equal(url.searchParams.get('contractType'), 'BINARY');
    assert.deepEqual({ ...options }, { timeout: 10000, retries: 0, maxBytes: 2 * MIB });
  }
  // A few words more than the cap still make at most six requests.
  const many = []; await briefing({ now, queries: Array.from({ length: 40 }, (_, i) => `word${i}`), fetcher: async url => { many.push(term(url)); return []; } });
  assert.deepEqual(many, ['word0', 'word1', 'word2', 'word3', 'word4', 'word5']);
  // The term that is sent is plain text, whatever the configuration held.
  const sent = []; await briefing({ now, queries: ['<script>Iran</script>', 'Zürich & co.', `${rtl}Taiwan${bell}`], fetcher: async url => { sent.push(term(url)); return []; } });
  assert.deepEqual(sent, ['script Iran script', 'Zürich co', 'Taiwan']);
  const none = await briefing({ now, queries: [], fetcher: async () => { throw new Error('must not be asked'); } });
  assert.equal(none.status, 'error'); assert.match(none.error, /No valid market queries/); assert.equal(none.license, result.license);
});

test('briefing degrades every transport failure to a result without a URL and never throws', async () => {
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'Request timed out after 10000ms' }, { error: 'Response exceeds 2097152 byte limit' },
    { error: 'connect failed for https://api.manifold.markets/v0/search-markets?term=Iran&key=secret' }, { error: 'Invalid JSON response', status: 200 }, {}, null, 'text', 5];
  for (const payload of failures) {
    const result = await briefing({ now, fetcher: async () => payload });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:|manifold\.markets|secret/i);
  }
  const thrown = await briefing({ now, fetcher: async () => { throw new Error('connect ECONNREFUSED https://api.manifold.markets/?key=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|manifold\.markets|secret|ECONNREFUSED/i);
  assert.equal((await briefing({ now, fetcher: () => { throw new Error('sync https://x'); } })).status, 'error');
  const oneDown = await briefing({ now, fetcher: async url => term(url) === 'Iran' ? { error: 'HTTP 429', status: 429 } : answersFor(url) });
  assert.equal(oneDown.status, 'ok'); assert.deepEqual(ids(oneDown), ['manifold:Qgg9Rc8PIy', 'manifold:yLI9ss8PE6', 'manifold:0tE26608Py']); assert.match(oneDown.summary, /Warning: the search for Iran \(HTTP 429\) failed\./);
  const slowOne = await briefing({ now, fetcher: async url => term(url) === 'recession' ? { error: 'Request timed out after 10000ms' } : answersFor(url) });
  assert.deepEqual(ids(slowOne), ['manifold:q2CZUhn500', 'manifold:yLI9ss8PE6', 'manifold:0tE26608Py']);
});

test('briefing over the real fetch helper degrades 429, 503, timeout, an oversized body and invalid JSON, and reads a real answer', async () => {
  const cases = {
    '429': () => reply('Too Many Requests', { status: 429 }),
    '503': () => reply('down', { status: 503 }),
    'timeout': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    'oversized': () => reply(`[${'0,'.repeat(2 * MIB)}0]`),
    'invalid json': () => reply('<html>not json</html>'),
    'network': () => Promise.reject(new TypeError('fetch failed')),
    'an object instead of a list': () => reply({ markets: [] }),
  };
  for (const [name, impl] of Object.entries(cases)) {
    const result = await withFetch(impl, () => briefing({ now, timeout: 25, queries: ['Iran'] }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name);
    assert.doesNotMatch(result.error, /https?:|manifold\.markets/i, name);
  }
  assert.match((await withFetch(cases.timeout, () => briefing({ now, timeout: 25, queries: ['Iran'], useCache: false }))).error, /timed out/i);
  assert.match((await withFetch(cases.oversized, () => briefing({ now, timeout: 5000, queries: ['Iran'], useCache: false }))).error, /exceeds|limit/i);
  const ok = await withFetch(async url => reply(answersFor(String(url))), () => briefing({ now, useCache: false }));
  assert.equal(ok.status, 'ok'); assert.deepEqual(ids(ok), ['manifold:Qgg9Rc8PIy', 'manifold:q2CZUhn500', 'manifold:yLI9ss8PE6', 'manifold:0tE26608Py']);
  const noIran = await withFetch(async url => term(String(url)) === 'Iran' ? reply('Too Many Requests', { status: 429 }) : reply(answersFor(String(url))), () => briefing({ now, useCache: false }));
  assert.equal(noIran.status, 'ok'); assert.match(noIran.summary, /the search for Iran \(HTTP 429\) failed/);
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await briefing({ now, timeout, queries: ['Iran'], fetcher: async (url, options) => { seen.push(options.timeout); return []; } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000);
});

test('answers are cached for 30 minutes per word with their age visible; errors and empty answers are not cached; the cache is bounded', async () => {
  let calls = 0;
  const fetcher = async url => { calls++; return answersFor(url); };
  const first = await briefing({ now, fetcher, useCache: true }); assert.equal(calls, 5); assert.equal(first.timestamp, iso(now));
  const again = await briefing({ now: now + 29 * MIN, fetcher, useCache: true });
  assert.equal(calls, 5, 'no request within 30 minutes'); assert.equal(again.status, 'ok'); assert.deepEqual(ids(again), ids(first)); assert.equal(again.timestamp, iso(now), 'a cached answer carries the time it was collected');
  const later = await briefing({ now: now + 31 * MIN, fetcher, useCache: true });
  assert.equal(calls, 10, 'asked again after 30 minutes'); assert.equal(later.timestamp, iso(now + 31 * MIN));
  await briefing({ now: now + 40 * MIN, fetcher, useCache: false }); assert.equal(calls, 15, 'the cache can be switched off');
  // Only the words that were asked before come from the cache; a new word is asked.
  const start = now + 2 * HOUR; calls = 0;
  await briefing({ now: start, queries: ['Iran'], fetcher, useCache: true }); assert.equal(calls, 1);
  await briefing({ now: start + MIN, queries: ['Iran', 'Taiwan'], fetcher, useCache: true }); assert.equal(calls, 2, 'only Taiwan is asked');
  const mixed = await briefing({ now: start + 2 * MIN, queries: ['Iran', 'Taiwan'], fetcher, useCache: true }); assert.equal(calls, 2); assert.equal(mixed.timestamp, iso(start), 'the oldest answer shows');
  // Failures and empty answers are asked again at the next sweep.
  let failing = 0; const bad = async () => { failing++; return { error: 'HTTP 429', status: 429 }; };
  const t2 = now + 4 * HOUR;
  await briefing({ now: t2, queries: ['Zzz'], fetcher: bad, useCache: true }); await briefing({ now: t2 + 1000, queries: ['Zzz'], fetcher: bad, useCache: true }); assert.equal(failing, 2, 'a failed answer is not cached');
  let empties = 0; const empty = async () => { empties++; return []; };
  await briefing({ now: t2, queries: ['Yyy'], fetcher: empty, useCache: true }); await briefing({ now: t2 + 1000, queries: ['Yyy'], fetcher: empty, useCache: true }); assert.equal(empties, 2, 'an empty answer is not cached');
  // An injected fetcher bypasses the cache unless asked; a different fetcher never reads another one\'s answers.
  let counted = 0; const plain = async url => { counted++; return answersFor(url); };
  const t3 = now + 6 * HOUR;
  await briefing({ now: t3, fetcher: plain }); await briefing({ now: t3, fetcher: plain }); assert.equal(counted, 10);
  let other = 0; await briefing({ now: t3 + 2 * MIN, fetcher: async url => { other++; return answersFor(url); }, useCache: true }); assert.equal(other, 5, 'another fetcher has its own cache');
  // Bounded: far more words than the cache holds, one at a time, push the oldest out.
  const t4 = now + 8 * HOUR; let bounded = 0; const count = async () => { bounded++; return [market('m-00001', 'Iran a')]; };
  for (let i = 0; i < 40; i++) await briefing({ now: t4 + i, queries: [`bound${i}`], fetcher: count, useCache: true });
  assert.equal(bounded, 40); await briefing({ now: t4 + 100, queries: ['bound0'], fetcher: count, useCache: true }); assert.equal(bounded, 41, 'the first word was pushed out of the cache');
  await briefing({ now: t4 + 101, queries: ['bound39'], fetcher: count, useCache: true }); assert.equal(bounded, 41, 'the newest word is still cached');
  // A clock that went backwards never reads the future.
  await briefing({ now: t4 - 1000, queries: ['bound39'], fetcher: count, useCache: true }); assert.equal(bounded, 42);
});
