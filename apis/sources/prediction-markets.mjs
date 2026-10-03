// Prediction markets: what traders on Manifold (https://manifold.markets, play money called Mana) believe about a few watched words.
// A market probability is the opinion of traders, not an event, so every row is info. One request per watched word to
// https://api.manifold.markets/v0/search-markets (no key), checked live on 2026-10-02 (23:40 to 23:58 UTC):
//   ?term=<words>&limit=10&sort=24-hour-vol&filter=open&contractType=BINARY answers a plain JSON array of markets (about 1 KB each).
//   `probability` is 0 to 1; `closeTime`, `lastBetTime` and `lastUpdatedTime` are unix MILLISECONDS; `volume` is in Mana (`token` MANA; the docs type
//   it 'MANA' | 'CASH', and a market in prize cash is not play money, so it is left out).
//   The time of a probability is `lastBetTime`, not `lastUpdatedTime`: of the 1,000 most recently updated open binary markets (2026-10-02)
//   170 had a lastUpdatedTime other than their lastBetTime (an edit or a comment moves it) and 6 had no bet at all. A market nobody has
//   bet on has no last bet; its probability is the creator's starting value, not an opinion of traders, so it is left out.
//   Manifold's search reads more than the question: of the six answers to "Taiwan" two, and of the two answers to "Hormuz" one, had no
//   such word in the question. The question is therefore matched again here: every word of the watched text has to start a word of the
//   question (any letter case, accents ignored), the description and the creator never count.
//   Close dates far away exist (30 of those 1,000 markets close in 2100 or later, the latest in the year 4567): they are shown as a close date in 2100 or later and carry no validUntil.
//   Every other row carries validUntil = the close time: a snapshot that is read again after the close drops the row (freshResult and the browser
//   copy both honour it), while the last bet alone would keep a closed market current for up to 12 hours.
//   Questions use < and > as comparison signs (8 of those 1,000, for example ">=7.0" or "<2030"); stripping them as markup would change
//   what the market asks, so they stay as full-width signs and nothing can open a tag.
// Kalshi (https://api.elections.kalshi.com/trade-api/v2) is NOT used. It needs no key but has no keyword or topic filter on its markets or events endpoints, and a bounded
// request budget cannot find a topic in it: the first 200 listed markets were all multivariate sports combinations; with
// mve_filter=exclude 60 pages of 1,000 open markets were read (the cursor still continued) and 14,144 open events were counted (71 pages of
// 200), 51% of them sports; of the 56 markets with "Hormuz" in the title among those 60,000 the first sat at position 3,924, a page of 1,000
// rows is 2.2 MB (over the 2 MiB limit) and the docs say `updated_time` "Tracks non-trading changes only", so it is no time of a price.
// Polymarket is not reachable from Hungary. Reading the first rows of Kalshi would show random markets and miss the topics, so there is none.
// Provider text is never shown as written: only whitelisted fields are read, text is cut to a fixed length before any pattern runs on it,
// at most MAX_EXAMINED rows of an answer are looked at, and a hostile answer costs a fixed amount of work.
import { safeFetch } from '../utils/fetch.mjs';
import { freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';

const SOURCE = 'Prediction-Markets';
const ENDPOINT = 'https://api.manifold.markets/v0/search-markets';
const SITE = 'https://manifold.markets/';
// The default watched words, the same as publicSources.marketQueries in crucix.config.mjs (which documents the rules).
export const DEFAULT_QUERIES = Object.freeze(['Hormuz', 'Ukraine', 'Iran', 'Taiwan', 'recession']);
const MAX_QUERIES = 6; // one request each
const MAX_CONFIGURED = 20; // entries of the configured list that are looked at
const QUERY_CAP = 60;
const PER_QUERY = 10;
const MAX_EXAMINED = 20; // rows of one answer
const MAX_ROWS = 20;
const FUTURE_SKEW_MS = 300000;
const CACHE_MS = 30 * 60000;
const CACHE_ENTRIES = 16;
const MIN_MS = Date.UTC(2020, 0, 1); // Manifold started in 2021: an earlier time is another unit or another shape
const MAX_MS = 8.64e15; // the last instant a Date can hold
const FAR_MS = Date.UTC(2100, 0, 1);
const EPSILON = 1e-9;
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const PATH = /^[A-Za-z0-9_.-]{1,40}\/[A-Za-z0-9_.-]{1,120}$/;
const WORD = /[\p{L}\p{N}\p{M}]+/gu;
const FULL_LT = String.fromCharCode(0xff1c), FULL_GT = String.fromCharCode(0xff1e); // full-width < and >
const GE = String.fromCharCode(0x2265), LE = String.fromCharCode(0x2264);
const cache = new Map(); // one entry per watched word, at most CACHE_ENTRIES
const SUMMARY = `Probabilities that traders on Manifold, a play-money prediction market, give to questions that match the watched words (every word has to start a word of the question), most traded first, at most ${MAX_ROWS}. Only markets that have not closed and had a bet in the last 12 hours are listed. A market probability is the opinion of traders, not an event: every row is rated info.`;
const EXTRAS = {
  attribution: 'Source: Manifold (https://manifold.markets), play-money prediction markets',
  rights: 'Use of the Manifold API is subject to Manifold\'s Terms of Service. Permitted: "Building bots, automated trading systems, algorithmic tools, and integrations that interact with Manifold." Prohibited: "Scraping the site through means other than the API; circumventing rate limits or security measures." "You may not use API data to train AI/ML models for commercial purposes without obtaining a data license from us. Academic research, personal projects, and non-commercial use are permitted." The Terms give the site content "for your information and personal use only"; the rate limit is 500 requests per minute per IP. "Mana has no cash or redeemable value." Commercial use needs a data licence (data@manifold.markets).',
  license: 'Manifold Terms of Service (personal and non-commercial use)',
  licenseUrl: 'https://docs.manifold.markets/terms',
  summary: SUMMARY,
};

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
// Provider text becomes inert plain text: control, bidi and zero-width characters go, whitespace collapses, and the comparison signs
// stay (see above) as ">=" "<=" signs or full-width < and >. The input is cut BEFORE any pattern runs: linear on hostile text.
// A cut never leaves half of a character (a high surrogate at the end), and lone surrogates anywhere are dropped: encodeURIComponent throws on them.
const cut = (text, length) => {
  const head = text.slice(0, length), last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
};
const clean = (value, cap) => typeof value === 'string'
  ? cut(cut(value, 400).replace(/[\p{Cf}\p{Cs}]/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').replace(/>=/g, GE).replace(/<=/g, LE).replace(/[<>]/g, sign => sign === '<' ? FULL_LT : FULL_GT).trim(), cap).trim() : '';
const fold = text => text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '');
const wordsOf = text => text.match(WORD) ?? [];
const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
// Transport errors become a short reason; a URL or an upstream message never reaches the result.
const reason = error => typeof error === 'string' ? clean(error.slice(0, 300).replace(/https?:\/\/\S*/gi, ''), 120) : '';
const sentence = items => items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

// The watched words: text entries with a word of at least two characters, cleaned and cut, no repeats (letter case and accents ignored),
// at most MAX_QUERIES. What is asked of the provider and shown is the words joined by one space.
function queryList(list) {
  const input = list === undefined ? DEFAULT_QUERIES : Array.isArray(list) ? list : [];
  const seen = new Set(), out = [];
  for (const raw of input.slice(0, MAX_CONFIGURED)) {
    if (out.length >= MAX_QUERIES) break;
    const shown = [], words = [];
    for (const word of wordsOf(clean(raw, QUERY_CAP))) {
      const folded = fold(word);
      if (word.length > 1 && folded) { shown.push(word); words.push(folded); }
    }
    const key = words.join(' ');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ text: shown.join(' '), words, key });
  }
  return out;
}

// The page of one market on manifold.markets (/<creator>/<slug>) and nothing else.
function pageOf(raw) {
  if (typeof raw !== 'string' || raw.length > 200 || !raw.startsWith(SITE)) return null;
  const path = raw.slice(SITE.length);
  return PATH.test(path) && !path.includes('..') ? raw : null;
}

// One row of an answer. `null` is a row that cannot be read (a changed shape); otherwise `skip` says why a readable market is not current.
function market(raw, now) {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === 'string' && raw.id.length <= 40 && ID.test(raw.id) ? raw.id : null;
  const title = clean(raw.question, 300), url = pageOf(raw.url);
  const p = raw.probability;
  const probability = typeof p === 'number' && p >= -EPSILON && p <= 1 + EPSILON ? Math.min(1, Math.max(0, p)) : null;
  const volume = typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1e15 ? raw.volume : null;
  const close = typeof raw.closeTime === 'number' && raw.closeTime >= MIN_MS && raw.closeTime <= MAX_MS ? raw.closeTime : null;
  // `token` is optional and 'MANA' (play money) or 'CASH' (prize cash); any other value is another shape.
  if (!id || !title || !url || probability === null || volume === null || close === null || raw.outcomeType !== 'BINARY' || typeof raw.isResolved !== 'boolean'
    || (raw.token !== undefined && raw.token !== 'MANA' && raw.token !== 'CASH')) return null;
  let bet = null;
  if (raw.lastBetTime === undefined || raw.lastBetTime === null) { if (volume > 0) return null; } // volume without a bet: the time went missing
  else if (typeof raw.lastBetTime === 'number' && raw.lastBetTime >= MIN_MS && raw.lastBetTime <= MAX_MS) bet = raw.lastBetTime;
  else return null;
  const skip = raw.isResolved ? 'resolved' : raw.token === 'CASH' ? 'cash' : bet === null ? 'untraded' : close <= now ? 'closed' : bet - now > FUTURE_SKEW_MS ? 'future' : null;
  return { id, title, url, probability, volume, close, bet, skip, tokens: wordsOf(fold(title)) };
}

const matches = (item, words) => words.every(word => item.tokens.some(token => token.startsWith(word)));

function observation(item) {
  const percent = Math.round(item.probability * 1000) / 10, far = item.close >= FAR_MS;
  const volume = Math.round(item.volume);
  return { kind: 'market', providerId: `manifold:${item.id}`, title: item.title,
    summary: `Traders on Manifold put the probability at ${percent}% (volume ${volume.toLocaleString('en-US')} Mana, ${far ? 'close date in 2100 or later' : `closes ${stamp(item.close).slice(0, 10)}`}). Last bet: ${stamp(item.bet)} UTC. Manifold trades in play money, and a market probability is the opinion of traders, not an event.`,
    // Every market has its own page, so every row has its own link.
    source: SOURCE, url: item.url, observedAt: new Date(item.bet).toISOString(), ...(far ? {} : { validUntil: new Date(item.close).toISOString() }), severity: 'info',
    probabilityPct: percent, volume, ...(far ? {} : { closesAt: `${stamp(item.close)} UTC` }), platform: 'Manifold' };
}

// `answers[i]` is the raw answer of the i-th watched word (see queryList). A word whose answer failed is left out and named in the summary.
// `lengths[i]` is the number of rows the provider sent when the answer is a trimmed copy (the cache keeps only the rows that are read).
export function parsePredictionMarkets(answers, { now = Date.now(), queries, lengths } = {}) {
  const list = queryList(queries);
  if (!list.length) return unavailableResult(SOURCE, 'No valid market queries configured', EXTRAS, now);
  const input = Array.isArray(answers) ? answers : [];
  const markets = new Map(), failed = [], found = list.map(() => new Set());
  let examined = 0, truncated = 0, readable = 0, unreadable = 0;
  list.forEach((query, index) => {
    const answer = input[index];
    if (!Array.isArray(answer)) { failed.push({ query, why: isObject(answer) ? reason(answer.error) : '' }); return; }
    const rows = answer.slice(0, MAX_EXAMINED);
    const sent = Number.isFinite(lengths?.[index]) ? Math.max(lengths[index], answer.length) : answer.length;
    examined += rows.length; truncated += sent - rows.length;
    for (const raw of rows) {
      const item = market(raw, now);
      if (!item) { unreadable++; continue; }
      readable++;
      if (item.skip || !matches(item, query.words)) continue;
      // The same market under two words (answers collected at different times): the newer reading stands.
      const known = markets.get(item.id);
      if (!known || item.bet > known.bet) markets.set(item.id, item);
      found[index].add(item.id);
    }
  });
  if (failed.length === list.length) {
    const why = failed.find(entry => entry.why)?.why;
    return unavailableResult(SOURCE, why ? `Manifold request failed: ${why}` : 'Manifold returned an unexpected response', EXTRAS, now);
  }
  // Rows that all lack a readable id, question, probability or time mean the API changed shape: never a quiet feed.
  if (!readable && unreadable) return unavailableResult(SOURCE, 'Manifold returned markets in an unexpected shape', EXTRAS, now);
  const all = [...markets.values()];
  // The newest last bet of a market that matches, old or not: an old list is expired rather than undated.
  const newest = all.length ? new Date(Math.max(...all.map(item => item.bet))).toISOString() : null;
  // Rank and cap before freshResult, which only looks at the first 100 rows.
  const ranked = all.filter(item => freshness(new Date(item.bet).toISOString(), POLICIES[SOURCE].observationMaxAgeMs, now).fresh)
    .sort((a, b) => b.volume - a.volume || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const current = new Set(ranked.map(item => item.id));
  const quiet = list.filter((query, index) => !failed.some(entry => entry.query === query) && ![...found[index]].some(id => current.has(id)));
  const notes = (quiet.length ? ` No current market for: ${quiet.map(query => query.text).join('; ')}.` : '')
    + (failed.length ? ` Warning: the search for ${sentence(failed.map(entry => entry.why ? `${entry.query.text} (${entry.why})` : entry.query.text))} failed.` : '')
    + (unreadable ? ` Warning: ${unreadable} of the ${examined} markets could not be read (id, question, probability, link or time missing or unusable) and ${unreadable === 1 ? 'was' : 'were'} left out.` : '');
  return freshResult(SOURCE, newest, ranked.slice(0, MAX_ROWS).map(observation), { ...EXTRAS,
    summary: `${SUMMARY} Watched words: ${list.map(query => query.text).join('; ')}.${notes}`, examinedRecords: examined,
    truncatedRecords: truncated + Math.max(0, ranked.length - MAX_ROWS) }, now);
}

async function load(query, { fetcher, useCache, now, request }) {
  const hit = cache.get(query.key);
  if (useCache && hit?.fetcher === fetcher && now >= hit.collectedAt && now - hit.collectedAt < CACHE_MS) return hit;
  const url = `${ENDPOINT}?${new URLSearchParams({ term: query.text, limit: String(PER_QUERY), sort: '24-hour-vol', filter: 'open', contractType: 'BINARY' })}`;
  let payload;
  try { payload = await fetcher(url, request); } catch { payload = { error: 'network error' }; }
  const entry = { payload, length: Array.isArray(payload) ? payload.length : 0, fetcher, collectedAt: now };
  // Only answers with markets are kept: an error or an empty answer is asked again at the next sweep. Of those only the rows that are read.
  if (useCache && Array.isArray(payload) && payload.length) {
    if (cache.size >= CACHE_ENTRIES && !cache.has(query.key)) cache.delete(cache.keys().next().value);
    cache.set(query.key, { ...entry, payload: payload.slice(0, MAX_EXAMINED) });
  }
  return entry;
}

export async function briefing(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const list = queryList(options.queries);
  if (!list.length) return unavailableResult(SOURCE, 'No valid market queries configured', EXTRAS, now);
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  const request = { ...REQUEST, timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)) };
  const entries = await Promise.all(list.map(query => load(query, { fetcher, useCache, now, request })));
  const result = parsePredictionMarkets(entries.map(entry => entry.payload), { now, queries: options.queries, lengths: entries.map(entry => entry.length) });
  // A cached answer carries the time it was collected, so its age shows.
  return { ...result, timestamp: new Date(Math.min(...entries.map(entry => entry.collectedAt))).toISOString() };
}
