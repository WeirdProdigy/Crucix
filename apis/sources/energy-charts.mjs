// Energy-Charts (Fraunhofer ISE): the Hungarian day-ahead power price, the generation mix of Hungary and the grid frequency of
// Continental Europe. https://api.energy-charts.info - v1 endpoints (compact columnar JSON), checked live on 2026-10-02:
//   - /price?bzn=HU&start&end: { license_info, unix_seconds, price, unit: 'EUR / MWh', deprecated }. `license_info` is the licence of that bidding
//     zone ("CC BY 4.0 ... from Bundesnetzagentur | SMARD.de" for HU; the zones that are not CC BY 4.0 are private-use only), so a price answer
//     without a CC BY 4.0 licence is not published. 15-minute day-ahead slots; a slot is stamped with its START in unix SECONDS. A default query returns a whole day, so the curve holds slots that have not started yet:
//     the price now is the newest slot that has started. A window with no data answers HTTP 404 ("no content available").
//   - /public_power?country=hu&start&end: { unix_seconds, production_types: [{ name, data }], deprecated }. The same 15-minute slots, but the
//     newest sample lags about an hour and a half. The types vary (Fossil oil is listed on some days only) and the answer carries derived
//     series: Load, Residual load, Cross border electricity trading and two renewable shares in percent. The share of generation is the
//     provider's own series, read as it is. A default query just after midnight local time is HTTP 404, so the window is explicit.
//   - /frequency?region=DE-Freiburg&start&end: { unix_seconds, data, deprecated }. 1-second samples measured at Fraunhofer ISE in Freiburg for
//     the synchronous area Continental Europe (which Hungary belongs to), about 90 seconds behind. The documented parameter is `region`, not
//     `country`. A default query returns the whole day so far (1.5 MB), so a 20 minute window is asked for. A window beyond the data is a
//     series of nulls.
// Hungarian day-ahead prices run high. Measured over the 14 days to 2026-10-02 (2026-09-19 to 2026-10-02, 1,344 slots): median about 194 EUR/MWh,
// mean 176.5, minimum -3.08, maximum 574.32 (31 slots slightly negative); 72% of the slots were at or above 150, 3.9% at or above 300 and 0.6% at
// or above 400. The ratings (moderate from 300, high from 400) therefore mark only the peaks (44 of the 52 slots at or above 300 fell between 15:00
// and 19:00 UTC, 8 between 04:00 and 05:00 UTC: the evening and morning peaks); thresholds of 150 and 300 would have rated most of the day.
// The API allows 2 requests per minute per endpoint (price: a burst of 2) and answers HTTP 429 beyond that, so every answer is cached for
// two minutes (a manual sweep next to a scheduled one stays under the limit). Times are unix SECONDS: anything else (milliseconds, ISO
// text, small numbers) is another shape of the answer and reads as an error, never as a healthy feed. Provider text is never shown as
// written: only a few fixed names are read, the production type names pass a strict pattern after a length check, and arrays are scanned
// from the end for at most MAX_POINTS samples, so a hostile answer costs a fixed amount of work.
import { safeFetch } from '../utils/fetch.mjs';
import { freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';

const SOURCE = 'Energy-Charts-HU';
const API = 'https://api.energy-charts.info';
const CHARTS = 'https://energy-charts.info/charts/';
const WINDOW_S = 12 * 3600;
const FREQUENCY_WINDOW_S = 20 * 60;
const MAX_POINTS = 2000; // samples examined per series, counted from the newest end (the live windows hold 49, 49 and 1200)
const MAX_TYPES = 40; // production types examined (the live answer has 17)
const FUTURE_SKEW_MS = 300000;
const CACHE_MS = 2 * 60000;
const MIN_S = 946684800; // 2000-01-01 and 2100-01-01 in seconds: a value in milliseconds or a small number is not a provider time
const MAX_S = 4102444800;
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
const cache = new Map(); // one entry per endpoint: bounded by the three endpoints
const SHARE_SERIES = 'Renewable share of generation';
const NOT_GENERATION = /share|load|trading/i; // derived series of the answer: Load, Residual load, Cross border electricity trading, the shares
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9 /().,+-]*$/;
const RANK = { high: 0, moderate: 1, info: 2 };
const SUMMARY = 'The Hungarian day-ahead power price (EUR/MWh, rated moderate from 300 and high from 400), the renewable share of Hungarian electricity generation and the grid frequency of Continental Europe (rated by its deviation from 50 Hz: moderate from 0.1 Hz, high from 0.2 Hz), from Energy-Charts (Fraunhofer ISE). The day-ahead price is fixed a day ahead, the generation data is published with a delay of about an hour and a half, and the frequency is measured in Freiburg, Germany.';
const EXTRAS = {
  attribution: 'Fraunhofer ISE, Energy-Charts (https://energy-charts.info); day-ahead prices: Bundesnetzagentur | SMARD.de',
  rights: 'Energy-Charts data is licensed CC BY 4.0 with attribution to energy-charts.info unless the response says otherwise. Day-ahead prices of the Hungarian bidding zone: "CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de", published without changes. The grid frequency is measured at Fraunhofer ISE in Freiburg. The API allows 2 requests per minute per endpoint and per client; commercial access needs a contact with Fraunhofer ISE.',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  summary: SUMMARY,
};

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const round = (value, digits) => (Math.round(value * 10 ** digits) || 0) / 10 ** digits;
const stamp = (ms, seconds = false) => new Date(ms).toISOString().slice(0, seconds ? 19 : 16).replace('T', ' ');
const failed = (why, transport = false) => ({ state: 'failed', why, transport });
// Transport errors become a short reason; a URL or an upstream message never reaches the result.
function reason(error) {
  const text = typeof error === 'string' ? error.slice(0, 300).replace(/https?:\/\/\S*/gi, '').trim().slice(0, 120) : '';
  return `request failed${text ? `: ${text}` : ''}`;
}
const number = (low, high) => value => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;

// The newest usable sample among the last MAX_POINTS of a series (the provider lists them oldest first). A gap (null) is skipped; a value or a
// time that can not be right counts as `bad`; a sample that has not started yet (a day-ahead slot) or is ahead of the limit is ignored.
function sampleOf(times, values, valid, limitMs, now) {
  let best = null, bad = 0;
  for (let i = times.length - 1, stop = Math.max(0, times.length - MAX_POINTS); i >= stop; i--) {
    const value = values[i];
    if (value === null || value === undefined) continue;
    const time = times[i];
    if (!Number.isFinite(time) || time < MIN_S || time > MAX_S || !valid(value)) { bad++; continue; }
    const ms = Math.round(time * 1000);
    if (ms <= limitMs && (!best || ms > best.ms)) best = { ms, value, index: i };
  }
  if (!best) return bad ? failed('unexpected timestamps or values') : { state: 'empty' };
  return freshness(new Date(best.ms).toISOString(), POLICIES[SOURCE].observationMaxAgeMs, now).fresh ? { state: 'ok', ...best } : { state: 'old', ms: best.ms };
}

// An answer of the right shape or a failed state.
function answer(payload) {
  if (payload?.error) return failed(reason(payload.error), true);
  return isObject(payload) ? null : failed('unexpected response');
}

function readPrice(payload, now) {
  const problem = answer(payload);
  if (problem) return problem;
  if (!Array.isArray(payload.unix_seconds) || !Array.isArray(payload.price) || payload.unix_seconds.length !== payload.price.length) return failed('unexpected response');
  if (typeof payload.unit !== 'string' || payload.unit.length > 20 || !/^EUR\s*\/\s*MWh$/i.test(payload.unit)) return failed('unexpected unit');
  // The licence is per bidding zone and this field is authoritative: only CC BY 4.0 data is published.
  if (typeof payload.license_info !== 'string' || payload.license_info.length > 200 || !/CC BY 4\.0/i.test(payload.license_info)) return failed('unexpected licence');
  // The newest slot that has started: later slots are tomorrow's prices, not the price now.
  return sampleOf(payload.unix_seconds, payload.price, number(-1000, 10000), now, now);
}

function readFrequency(payload, now) {
  const problem = answer(payload);
  if (problem) return problem;
  if (!Array.isArray(payload.unix_seconds) || !Array.isArray(payload.data) || payload.unix_seconds.length !== payload.data.length) return failed('unexpected response');
  return sampleOf(payload.unix_seconds, payload.data, number(45, 55), now + FUTURE_SKEW_MS, now);
}

function readMix(payload, now) {
  const problem = answer(payload);
  if (problem) return problem;
  if (!Array.isArray(payload.unix_seconds) || !Array.isArray(payload.production_types)) return failed('unexpected response');
  const types = payload.production_types.slice(0, MAX_TYPES).filter(type => isObject(type) && typeof type.name === 'string' && type.name.length <= 60 && Array.isArray(type.data));
  const share = types.find(type => type.name === SHARE_SERIES);
  if (!share) return failed('no renewable share series');
  if (share.data.length !== payload.unix_seconds.length) return failed('unexpected response');
  const found = sampleOf(payload.unix_seconds, share.data, number(0, 100), now + FUTURE_SKEW_MS, now);
  if (found.state !== 'ok') return found;
  // The largest sources of the same slot, from the generation types the answer has (a type that is missing is simply not listed).
  const sources = types.filter(type => TYPE_NAME.test(type.name) && !NOT_GENERATION.test(type.name) && type.data.length === payload.unix_seconds.length)
    .map(type => [type.name, type.data[found.index]]).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e5)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, 3);
  return { ...found, sources };
}

function priceRow(sample) {
  const value = round(sample.value, 2);
  return { kind: 'energy', providerId: 'hu-price', title: `Hungary day-ahead power price: ${value.toFixed(2)} EUR/MWh`,
    summary: `Day-ahead spot price for the Hungarian bidding zone (HU) for the period starting ${stamp(sample.ms)} UTC: ${value.toFixed(2)} EUR/MWh.${value < 0 ? ' A negative price means that supply exceeds demand in the day-ahead auction: producers pay to sell.' : ''} Day-ahead auction result as published by Energy-Charts (data from Bundesnetzagentur | SMARD.de); it is fixed a day ahead and is not a real-time price. Hungarian day-ahead prices run high: rated moderate from 300 and high from 400 EUR/MWh.`,
    source: SOURCE, url: `${CHARTS}price_spot_market/chart.htm?l=en&c=HU`, observedAt: new Date(sample.ms).toISOString(),
    severity: value >= 400 ? 'high' : value >= 300 ? 'moderate' : 'info', pricePerMwh: value };
}

function frequencyRow(sample) {
  const value = round(sample.value, 4), deviation = round(Math.abs(value - 50), 4);
  const side = deviation === 0 ? 'exactly at the 50 Hz nominal frequency' : `${deviation} Hz ${value > 50 ? 'above' : 'below'} the 50 Hz nominal frequency`;
  return { kind: 'energy', providerId: 'hu-frequency', title: `Continental Europe grid frequency: ${value.toFixed(4)} Hz (measured in Freiburg)`,
    summary: `Grid frequency of the synchronous area Continental Europe, which includes Hungary, measured by Fraunhofer ISE in Freiburg (Germany): ${value.toFixed(4)} Hz in the 1-second sample of ${stamp(sample.ms, true)} UTC, ${side}. Rated high from a deviation of 0.2 Hz and moderate from 0.1 Hz.`,
    source: SOURCE, url: `${CHARTS}frequency/chart.htm?l=en&c=DE`, observedAt: new Date(sample.ms).toISOString(),
    severity: deviation >= 0.2 ? 'high' : deviation >= 0.1 ? 'moderate' : 'info', frequencyHz: value };
}

function mixRow(sample) {
  const value = round(sample.value, 1);
  const largest = sample.sources.length ? ` Largest sources: ${sample.sources.map(([name, mw]) => `${name} ${Math.round(mw)} MW`).join(', ')}.` : '';
  return { kind: 'energy', providerId: 'hu-mix', title: `Hungary electricity generation: ${value}% renewable`,
    summary: `Renewable sources supplied ${value}% of the public net electricity generation of Hungary in the period starting ${stamp(sample.ms)} UTC.${largest} Energy-Charts public power data, published with a delay.`,
    source: SOURCE, url: `${CHARTS}power/chart.htm?l=en&c=HU`, observedAt: new Date(sample.ms).toISOString(), severity: 'info', renewableSharePct: value };
}

const PARTS = [
  { label: 'price', endpoint: 'price', read: readPrice, row: priceRow, metric: ['hu_power_price', 'pricePerMwh'] },
  { label: 'frequency', endpoint: 'frequency', read: readFrequency, row: frequencyRow, metric: ['grid_frequency_hz', 'frequencyHz'] },
  { label: 'mix', endpoint: 'public_power', read: readMix, row: mixRow },
];
const WORDS = { empty: 'no sample', old: 'latest sample older than 6 hours' };

// The three raw answers of /price, /public_power and /frequency. A series that fails or has no current sample is left out and named in the
// summary; the others stay. Only when none of them is readable is the result an error (or stale when they are readable but not current).
export function parseEnergyCharts(price, power, frequency, { now = Date.now() } = {}) {
  const inputs = [price, frequency, power];
  const parts = PARTS.map((part, index) => ({ ...part, state: part.read(inputs[index], now), deprecated: isObject(inputs[index]) && inputs[index].deprecated === true }));
  if (parts.every(part => part.state.state === 'failed')) {
    const first = parts.find(part => part.state.transport);
    return unavailableResult(SOURCE, parts.every(part => part.state.transport) ? `Energy-Charts ${first.state.why}` : 'Energy-Charts returned an unexpected response', EXTRAS, now);
  }
  const times = parts.map(part => part.state.ms).filter(Number.isFinite);
  const notes = parts.flatMap(part => [...part.state.state === 'ok' ? [] : [`${part.label}: ${part.state.why ?? WORDS[part.state.state]}`],
    ...part.deprecated ? [`the ${part.endpoint} endpoint is marked deprecated by the provider and will be retired`] : []]);
  // Most severe first, then the fixed order.
  const rows = parts.flatMap((part, order) => part.state.state === 'ok' ? [{ order, row: part.row(part.state) }] : [])
    .sort((a, b) => RANK[a.row.severity] - RANK[b.row.severity] || a.order - b.order).map(item => item.row);
  const out = freshResult(SOURCE, times.length ? new Date(Math.max(...times)).toISOString() : null, rows, { ...EXTRAS, summary: SUMMARY + (notes.length ? ` Note: ${notes.join('; ')}.` : '') }, now);
  // The alert registry reads these: they come from the rows, which only a current feed has, so a stale series has no metric.
  out.metrics = {};
  for (const part of parts) {
    const row = part.metric && out.observations.find(item => item[part.metric[1]] !== undefined);
    if (row) out.metrics[part.metric[0]] = row[part.metric[1]];
  }
  return out;
}

async function load(name, url, { fetcher, useCache, now, request }) {
  const hit = cache.get(name);
  if (useCache && hit?.fetcher === fetcher && now >= hit.collectedAt && now - hit.collectedAt < CACHE_MS) return hit.payload;
  let payload;
  try { payload = await fetcher(url, request); } catch { payload = { error: 'network error' }; }
  if (useCache && isObject(payload) && Array.isArray(payload.unix_seconds)) cache.set(name, { payload, fetcher, collectedAt: now });
  return payload;
}

export async function briefing(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  const request = { ...REQUEST, timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)) };
  const end = Math.floor(now / 1000);
  const window = seconds => ({ start: String(end - seconds), end: String(end) });
  const common = { fetcher, useCache, now, request };
  const [price, power, frequency] = await Promise.all([
    load('price', `${API}/price?${new URLSearchParams({ bzn: 'HU', ...window(WINDOW_S) })}`, common),
    load('public_power', `${API}/public_power?${new URLSearchParams({ country: 'hu', ...window(WINDOW_S) })}`, common),
    load('frequency', `${API}/frequency?${new URLSearchParams({ region: 'DE-Freiburg', ...window(FREQUENCY_WINDOW_S) })}`, common),
  ]);
  return parseEnergyCharts(price, power, frequency, { now });
}
