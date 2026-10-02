import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnergyCharts, briefing } from '../apis/sources/energy-charts.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const now = Date.parse('2026-10-02T22:55:00Z');
const HOUR = 3600000;
const MIB = 1024 * 1024;
const iso = ms => new Date(ms).toISOString();
const sec = text => Date.parse(text) / 1000;
const rtl = String.fromCharCode(0x202e), zero = String.fromCharCode(0x200b), bell = String.fromCharCode(7);

// Real answers of https://api.energy-charts.info captured on 2026-10-02 around 22:55 UTC, trimmed to the last slots (nothing edited).
// /price?bzn=HU: 15-minute day-ahead slots, unix seconds. The slot at 22:45 UTC is the latest one that has started.
const PRICE = { license_info: 'CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de', unix_seconds: [1790976600, 1790977500, 1790978400, 1790979300, 1790980200, 1790981100],
  price: [194.55, 185.1, 204.51, 200.14, 190.08, 182.36], unit: 'EUR / MWh', deprecated: false };
// /frequency (RG Continental Europe, measured in Freiburg): 1-second samples; the live answer was captured for the window 22:49:44-22:49:53 UTC.
const FREQUENCY = { unix_seconds: [1790981384, 1790981385, 1790981386, 1790981387, 1790981388, 1790981389, 1790981390, 1790981391, 1790981392, 1790981393],
  data: [50.0162, 50.0187, 50.0184, 50.018, 50.018, 50.0197, 50.0207, 50.0215, 50.0214, 50.0217], deprecated: false };
// /public_power?country=hu: the generation mix of the last three slots (the newest sample was 21:30 UTC: the data lags about an hour and a half).
const POWER = { unix_seconds: [1790974800, 1790975700, 1790976600], production_types: [
  { name: 'Cross border electricity trading', data: [2473.1, 2394.1, 2390.3] }, { name: 'Nuclear', data: [1429.3, 1429, 1429.4] }, { name: 'Hydro Run-of-River', data: [2.1, 2.1, 2.1] },
  { name: 'Biomass', data: [205.7, 205.9, 206.3] }, { name: 'Fossil brown coal / lignite', data: [163.4, 162.4, 164] }, { name: 'Fossil gas', data: [586.7, 578.4, 579.1] },
  { name: 'Geothermal', data: [0.2, 0.2, 0.2] }, { name: 'Hydro water reservoir', data: [2.9, 2.9, 2.9] }, { name: 'Others', data: [27.2, 24.1, 24.1] }, { name: 'Other renewables', data: [23, 22.6, 22.6] },
  { name: 'Waste', data: [13.2, 13.3, 12.9] }, { name: 'Wind onshore', data: [15.5, 14.4, 14.2] }, { name: 'Solar', data: [35.5, 35.5, 35.3] }, { name: 'Load', data: [4845.2, 4830.2, 4779.2] },
  { name: 'Residual load', data: [4794.2, 4780.3, 4729.6] }, { name: 'Renewable share of load', data: [6, 6, 6.1] }, { name: 'Renewable share of generation', data: [11.6, 11.7, 11.6] }], deprecated: false };

const copy = value => JSON.parse(JSON.stringify(value));
const parse = (price = PRICE, power = POWER, frequency = FREQUENCY, options) => parseEnergyCharts(price, power, frequency, { now, ...options });
const ids = result => result.observations.map(row => row.providerId);
// A price answer with one slot at `at` (UTC text) and one value.
const priceAt = (value, at = '2026-10-02T22:45:00Z', extra) => ({ ...copy(PRICE), unix_seconds: [sec(at)], price: [value], ...extra });
const frequencyAt = (value, at = '2026-10-02T22:49:53Z') => ({ ...copy(FREQUENCY), unix_seconds: [sec(at)], data: [value] });
// A power answer with the given series (name -> values) over slots starting at `at`, 15 minutes apart.
function powerOf(series, at = '2026-10-02T21:30:00Z') {
  const first = sec(at), length = Math.max(...Object.values(series).map(values => values.length));
  return { unix_seconds: Array.from({ length }, (_, i) => first + i * 900), production_types: Object.entries(series).map(([name, data]) => ({ name, data })), deprecated: false };
}
const withShare = (share, at) => powerOf({ Nuclear: [1429.4], 'Fossil gas': [579.1], Solar: [35.3], 'Renewable share of generation': [share] }, at);
const withFetch = async (impl, run) => {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
};
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });
const answers = url => url.includes('/price') ? PRICE : url.includes('/public_power') ? POWER : FREQUENCY;

test('parse turns the real answers into a price, a frequency and a generation mix observation', () => {
  const result = parse();
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'Energy-Charts-HU');
  assert.deepEqual(ids(result), ['hu-price', 'hu-frequency', 'hu-mix']);
  assert.equal(result.observedAt, '2026-10-02T22:49:53.000Z', 'the feed time is the newest sample time');
  const [price, frequency, mix] = result.observations;
  assert.equal(price.kind, 'energy'); assert.equal(price.source, 'Energy-Charts-HU'); assert.equal(price.severity, 'info', '182.36 EUR/MWh is the usual Hungarian level (median around 180): below the moderate threshold of 300');
  assert.equal(price.title, 'Hungary day-ahead power price: 182.36 EUR/MWh'); assert.equal(price.pricePerMwh, 182.36);
  assert.equal(price.observedAt, '2026-10-02T22:45:00.000Z', 'the latest slot start, in UTC');
  assert.match(price.summary, /day-ahead/i); assert.match(price.summary, /2026-10-02 22:45 UTC/); assert.match(price.summary, /not a real-time price/i);
  assert.equal(frequency.kind, 'energy'); assert.equal(frequency.severity, 'info'); assert.equal(frequency.frequencyHz, 50.0217);
  assert.equal(frequency.title, 'Continental Europe grid frequency: 50.0217 Hz (measured in Freiburg)'); assert.equal(frequency.observedAt, '2026-10-02T22:49:53.000Z');
  assert.match(frequency.summary, /Fraunhofer ISE/); assert.match(frequency.summary, /Freiburg/); assert.match(frequency.summary, /Hungary/); assert.match(frequency.summary, /22:49:53 UTC/); assert.match(frequency.summary, /0\.0217 Hz above/);
  assert.equal(mix.kind, 'energy'); assert.equal(mix.severity, 'info'); assert.equal(mix.renewableSharePct, 11.6);
  assert.equal(mix.title, 'Hungary electricity generation: 11.6% renewable'); assert.equal(mix.observedAt, '2026-10-02T21:30:00.000Z');
  assert.match(mix.summary, /11\.6%/); assert.match(mix.summary, /2026-10-02 21:30 UTC/); assert.match(mix.summary, /Largest sources: Nuclear 1429 MW, Fossil gas 579 MW, Biomass 206 MW\./);
  assert.doesNotMatch(mix.summary, /Load|Residual|Cross border|Renewable share of/i, 'only generation types are listed');
  assert.equal(new Set(result.observations.map(row => row.url)).size, 3, 'every row has its own chart page');
  assert.deepEqual(result.observations.map(row => row.url), ['https://energy-charts.info/charts/price_spot_market/chart.htm?l=en&c=HU', 'https://energy-charts.info/charts/frequency/chart.htm?l=en&c=DE', 'https://energy-charts.info/charts/power/chart.htm?l=en&c=HU']);
  assert.deepEqual(result.metrics, { hu_power_price: 182.36, grid_frequency_hz: 50.0217 });
  assert.match(result.summary, /Energy-Charts/); assert.doesNotMatch(result.summary, /Note:/, 'nothing is missing');
});

test('licence, rights and attribution come from the Energy-Charts and SMARD terms', () => {
  const result = parse();
  assert.match(result.attribution, /Energy-Charts/); assert.match(result.attribution, /Fraunhofer ISE/); assert.match(result.attribution, /Bundesnetzagentur \| SMARD\.de/);
  assert.equal(result.license, 'CC BY 4.0'); assert.equal(result.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.match(result.rights, /CC BY 4\.0 \(creativecommons\.org\/licenses\/by\/4\.0\) from Bundesnetzagentur \| SMARD\.de/);
  assert.match(result.rights, /attribution to energy-charts\.info/); assert.match(result.rights, /2 requests per minute/);
  for (const failed of [parse(null, null, null), parse({}, {}, {}), parse(priceAt(100, '2026-10-02T10:00:00Z'), null, null)]) { assert.equal(failed.license, 'CC BY 4.0'); assert.match(failed.attribution, /Energy-Charts/); assert.match(failed.rights, /SMARD/); }
});

test('the day-ahead price is rated at its exact boundaries and a negative price is info with a note', () => {
  // The usual Hungarian level is 150 to 250 (72% of the slots of 14 days were at or above 150): only the evening peaks are rated.
  const cases = [[-12.5, 'info'], [0, 'info'], [150, 'info'], [250, 'info'], [299.99, 'info'], [299.994, 'info'], [299.996, 'moderate'], [300, 'moderate'], [399.99, 'moderate'], [399.994, 'moderate'], [399.996, 'high'], [400, 'high'], [1200, 'high']];
  for (const [value, severity] of cases) {
    const row = parse(priceAt(value)).observations.find(item => item.providerId === 'hu-price');
    assert.equal(row.severity, severity, `${value} EUR/MWh`);
    assert.equal(row.pricePerMwh, Math.round(value * 100) / 100); assert.ok(row.title.includes(`${(Math.round(value * 100) / 100).toFixed(2)} EUR/MWh`), row.title);
  }
  const negative = parse(priceAt(-12.5)).observations.find(item => item.providerId === 'hu-price');
  assert.match(negative.summary, /negative price/i); assert.equal(negative.severity, 'info'); assert.equal(negative.pricePerMwh, -12.5);
  assert.doesNotMatch(parse(priceAt(0)).observations[0].summary, /negative price/i);
  assert.equal(parse(priceAt(-12.5)).metrics.hu_power_price, -12.5, 'a negative price is a real value');
});

test('the grid frequency is rated by its deviation from 50 Hz at exact boundaries', () => {
  const cases = [[50, 'info'], [50.0999, 'info'], [49.9001, 'info'], [50.1, 'moderate'], [49.9, 'moderate'], [50.1999, 'moderate'], [49.8001, 'moderate'], [50.2, 'high'], [49.8, 'high'], [50.45, 'high'], [47.5, 'high']];
  for (const [value, severity] of cases) {
    const row = parse(PRICE, POWER, frequencyAt(value)).observations.find(item => item.providerId === 'hu-frequency');
    assert.equal(row.severity, severity, `${value} Hz`); assert.equal(row.frequencyHz, value);
  }
  assert.match(parse(PRICE, POWER, frequencyAt(49.93)).observations[1].summary, /0\.07 Hz below/);
  assert.match(parse(PRICE, POWER, frequencyAt(50)).observations[1].summary, /at the 50 Hz nominal/);
  assert.equal(parse(PRICE, POWER, frequencyAt(49.93)).metrics.grid_frequency_hz, 49.93);
  const worst = parse(priceAt(400), POWER, frequencyAt(49.7));
  assert.deepEqual(worst.observations.map(row => row.severity), ['high', 'high', 'info'], 'most severe first, then the fixed order');
  const mixed = parse(priceAt(200), POWER, frequencyAt(50.0));
  assert.deepEqual(ids(mixed), ['hu-price', 'hu-frequency', 'hu-mix']); assert.deepEqual(mixed.observations.map(row => row.severity), ['info', 'info', 'info'], '200 EUR/MWh is not rated any more');
  const peak = parse(priceAt(300), POWER, frequencyAt(50.0));
  assert.deepEqual(ids(peak), ['hu-price', 'hu-frequency', 'hu-mix']); assert.deepEqual(peak.observations.map(row => row.severity), ['moderate', 'info', 'info']);
  const frequencyFirst = parse(priceAt(100), POWER, frequencyAt(50.15));
  assert.deepEqual(ids(frequencyFirst), ['hu-frequency', 'hu-price', 'hu-mix']);
});

test('values the provider can not have produced are skipped and the latest valid sample is used', () => {
  const junk = { ...copy(FREQUENCY), data: [50.0162, 50.0187, 5000, 'x', {}, -3, NaN, true, 0, 12] };
  const row = parse(PRICE, POWER, junk).observations.find(item => item.providerId === 'hu-frequency');
  assert.equal(row.frequencyHz, 50.0187); assert.equal(row.observedAt, '2026-10-02T22:49:45.000Z');
  const prices = { ...copy(PRICE), price: [194.55, 185.1, 204.51, 200.14, 190.08, 'cheap'] };
  assert.equal(parse(prices).observations[0].pricePerMwh, 190.08);
  const absurd = { ...copy(PRICE), price: [194.55, 185.1, 204.51, 200.14, 190.08, 1e9] };
  assert.equal(parse(absurd).observations[0].pricePerMwh, 190.08);
});

test('null samples are skipped, an all-null series gives no observation and never a zero metric', () => {
  const tail = { ...copy(PRICE), price: [194.55, 185.1, 204.51, 200.14, null, null] };
  const price = parse(tail).observations[0];
  assert.equal(price.pricePerMwh, 200.14); assert.equal(price.observedAt, iso(1790979300 * 1000));
  const nullFrequency = { ...copy(FREQUENCY), data: [50.0162, 50.0187, 50.0184, null, null, null, null, null, null, null] };
  assert.equal(parse(PRICE, POWER, nullFrequency).observations.find(r => r.providerId === 'hu-frequency').frequencyHz, 50.0184);
  const allNull = parse({ ...copy(PRICE), price: [null, null, null, null, null, null] }, POWER, { ...copy(FREQUENCY), data: FREQUENCY.data.map(() => null) });
  assert.equal(allNull.status, 'ok'); assert.deepEqual(ids(allNull), ['hu-mix']); assert.deepEqual(allNull.metrics, {});
  assert.match(allNull.summary, /price: no sample/); assert.match(allNull.summary, /frequency: no sample/);
  const nothing = parse({ ...copy(PRICE), price: [null, null, null, null, null, null] }, { ...copy(POWER), production_types: POWER.production_types.map(t => ({ name: t.name, data: [null, null, null] })) }, { ...copy(FREQUENCY), data: FREQUENCY.data.map(() => null) });
  assert.equal(nothing.status, 'stale', 'no sample at all is no current reading'); assert.deepEqual(nothing.observations, []); assert.equal(nothing.observedAt, null); assert.equal(nothing.freshness.reason, 'unknown-provider-time');
  assert.equal('metrics' in nothing && Object.keys(nothing.metrics).length, 0);
  assert.equal(parse({ license_info: PRICE.license_info, unix_seconds: [], price: [], unit: 'EUR / MWh' }, { unix_seconds: [], production_types: [] }, { unix_seconds: [], data: [] }).status, 'stale', 'empty arrays are not a healthy feed');
});

test('a series whose latest sample is older than the policy window is dropped and never replaced', () => {
  assert.deepEqual(POLICIES['Energy-Charts-HU'], { maxAgeMs: 6 * HOUR, observationMaxAgeMs: 6 * HOUR });
  const at = ms => iso(now - ms);
  const edge = parse(priceAt(180, at(6 * HOUR)), POWER, FREQUENCY);
  assert.equal(edge.observations.find(r => r.providerId === 'hu-price').pricePerMwh, 180, 'exactly 6 hours old is still current');
  for (const age of [6 * HOUR + 1000, 7 * HOUR, 30 * HOUR]) {
    const result = parse(priceAt(180, at(age)), POWER, FREQUENCY);
    assert.equal(result.status, 'ok', 'the other series are current'); assert.equal(ids(result).includes('hu-price'), false, `${age / HOUR} h`);
    assert.equal('hu_power_price' in result.metrics, false, 'no metric from a stale price'); assert.equal(result.metrics.grid_frequency_hz, 50.0217);
    assert.match(result.summary, /price: latest sample older than 6 hours/);
  }
  const allOld = parse(priceAt(180, at(8 * HOUR)), withShare(12, at(9 * HOUR)), frequencyAt(50, at(10 * HOUR)));
  assert.equal(allOld.status, 'stale'); assert.deepEqual(allOld.observations, []); assert.deepEqual(allOld.metrics, {}); assert.equal(allOld.freshness.reason, 'expired-provider-time');
  assert.equal(allOld.observedAt, at(8 * HOUR), 'the newest of the old samples is the feed time');
  const oldMix = parse(PRICE, withShare(12, at(7 * HOUR)), FREQUENCY);
  assert.equal(ids(oldMix).includes('hu-mix'), false); assert.match(oldMix.summary, /mix: latest sample older than 6 hours/);
  const oldFrequency = parse(PRICE, POWER, frequencyAt(50, at(7 * HOUR)));
  assert.equal(ids(oldFrequency).includes('hu-frequency'), false); assert.equal('grid_frequency_hz' in oldFrequency.metrics, false);
});

test('future slots of a day-ahead curve are never the latest sample', () => {
  // A whole local day (00:00 local on the 3rd is 22:00 UTC on the 2nd): at 22:55 UTC only the slots up to 22:45 have started.
  const day = Array.from({ length: 96 }, (_, i) => sec('2026-10-02T22:00:00Z') + i * 900);
  const curve = { ...copy(PRICE), unix_seconds: day, price: day.map((_, i) => 100 + i) };
  const row = parse(curve).observations[0];
  assert.equal(row.observedAt, '2026-10-02T22:45:00.000Z'); assert.equal(row.pricePerMwh, 103, 'the slot that is running now');
  const future = parse(priceAt(180, '2026-10-02T23:15:00Z'));
  assert.equal(ids(future).includes('hu-price'), false); assert.match(future.summary, /price: no sample/);
  assert.equal(ids(parse(priceAt(180, '2026-10-02T22:59:00Z'))).includes('hu-price'), false, 'a slot that has not started is not the current price');
  assert.equal(parse(priceAt(180, '2026-10-02T22:55:00Z')).observations[0].pricePerMwh, 180, 'a slot that starts now has started');
  // Measured values carry a few minutes of tolerance for the clocks.
  assert.equal(parse(PRICE, POWER, frequencyAt(50.01, '2026-10-02T22:59:00Z')).observations.find(r => r.providerId === 'hu-frequency').frequencyHz, 50.01);
  assert.equal(ids(parse(PRICE, POWER, frequencyAt(50.01, '2026-10-02T23:01:00Z'))).includes('hu-frequency'), false, 'five minutes ahead is the limit');
  assert.equal(ids(parse(PRICE, withShare(12, '2026-10-02T23:15:00Z'), FREQUENCY)).includes('hu-mix'), false);
});

test('seconds are the time unit: milliseconds read as a changed shape and never as a healthy feed', () => {
  const ms = payload => ({ ...copy(payload), unix_seconds: payload.unix_seconds.map(value => value * 1000) });
  const priceMs = parse(ms(PRICE));
  assert.equal(priceMs.status, 'ok'); assert.equal(ids(priceMs).includes('hu-price'), false); assert.match(priceMs.summary, /price: unexpected timestamps or values/);
  assert.equal('hu_power_price' in priceMs.metrics, false);
  const allMs = parse(ms(PRICE), ms(POWER), ms(FREQUENCY));
  assert.equal(allMs.status, 'error'); assert.deepEqual(allMs.observations, []); assert.equal(allMs.observedAt, null); assert.match(allMs.error, /unexpected/i);
  const secondsOk = parse(PRICE, POWER, FREQUENCY);
  assert.equal(secondsOk.status, 'ok'); assert.equal(secondsOk.observations.length, 3);
  const micro = { ...copy(FREQUENCY), unix_seconds: FREQUENCY.unix_seconds.map(value => value * 1e6) };
  assert.equal(ids(parse(PRICE, POWER, micro)).includes('hu-frequency'), false);
  const iso8601 = { ...copy(PRICE), unix_seconds: PRICE.unix_seconds.map(value => iso(value * 1000)) };
  assert.equal(ids(parse(iso8601)).includes('hu-price'), false, 'v2 style timestamps are another shape'); assert.match(parse(iso8601).summary, /price: unexpected timestamps or values/);
  const isoText = payload => ({ ...copy(payload), unix_seconds: payload.unix_seconds.map(value => iso(value * 1000)) });
  const allIso = parse(isoText(PRICE), isoText(POWER), isoText(FREQUENCY));
  assert.equal(allIso.status, 'error', 'ISO text everywhere is a changed shape, not a quiet feed'); assert.deepEqual(allIso.observations, []); assert.equal(allIso.observedAt, null); assert.match(allIso.error, /unexpected/i);
  const isoMix = parse(PRICE, isoText(POWER), FREQUENCY);
  assert.equal(ids(isoMix).includes('hu-mix'), false); assert.match(isoMix.summary, /mix: unexpected timestamps or values/);
  const isoFrequency = parse(PRICE, POWER, isoText(FREQUENCY));
  assert.equal(ids(isoFrequency).includes('hu-frequency'), false); assert.match(isoFrequency.summary, /frequency: unexpected timestamps or values/); assert.equal('grid_frequency_hz' in isoFrequency.metrics, false);
  const small = { ...copy(PRICE), unix_seconds: PRICE.unix_seconds.map((_, i) => i) };
  assert.equal(ids(parse(small)).includes('hu-price'), false, 'seconds from 1970 are no provider time'); assert.match(parse(small).summary, /price: unexpected timestamps or values/);
});

test('the generation mix share comes from the provider series; a missing producer type changes nothing', () => {
  const full = parse().observations.find(r => r.providerId === 'hu-mix');
  assert.equal(full.renewableSharePct, 11.6);
  const noGas = copy(POWER); noGas.production_types = noGas.production_types.filter(type => type.name !== 'Fossil gas');
  const withoutGas = parse(PRICE, noGas, FREQUENCY).observations.find(r => r.providerId === 'hu-mix');
  assert.equal(withoutGas.renewableSharePct, 11.6); assert.match(withoutGas.summary, /Largest sources: Nuclear 1429 MW, Biomass 206 MW, Fossil brown coal \/ lignite 164 MW\./);
  const fewTypes = parse(PRICE, withShare(34.2), FREQUENCY).observations.find(r => r.providerId === 'hu-mix');
  assert.equal(fewTypes.renewableSharePct, 34.2); assert.match(fewTypes.summary, /Largest sources: Nuclear 1429 MW, Fossil gas 579 MW, Solar 35 MW\./);
  const onlyShare = parse(PRICE, powerOf({ 'Renewable share of generation': [8.4] }), FREQUENCY).observations.find(r => r.providerId === 'hu-mix');
  assert.equal(onlyShare.renewableSharePct, 8.4); assert.doesNotMatch(onlyShare.summary, /Largest sources/);
  const zeros = parse(PRICE, powerOf({ Nuclear: [0], Solar: [0], 'Renewable share of generation': [0] }), FREQUENCY).observations.find(r => r.providerId === 'hu-mix');
  assert.equal(zeros.renewableSharePct, 0, 'a zero share is a value'); assert.doesNotMatch(zeros.summary, /Largest sources/);
  const noShare = parse(PRICE, powerOf({ Nuclear: [1429.4], Solar: [35.3] }), FREQUENCY);
  assert.equal(noShare.status, 'ok'); assert.deepEqual(ids(noShare), ['hu-price', 'hu-frequency']); assert.match(noShare.summary, /mix: no renewable share series/);
  const renamed = parse(PRICE, powerOf({ Nuclear: [1429.4], 'Renewable generation share': [11.6] }), FREQUENCY);
  assert.equal(ids(renamed).includes('hu-mix'), false); assert.match(renamed.summary, /mix: no renewable share series/);
  for (const share of [-0.1, 100.1, 'x', '11.6']) assert.equal(ids(parse(PRICE, withShare(share), FREQUENCY)).includes('hu-mix'), false, String(share));
  assert.equal(parse(PRICE, withShare(100), FREQUENCY).observations.find(r => r.providerId === 'hu-mix').renewableSharePct, 100);
  const short = copy(POWER); short.production_types.find(type => type.name === 'Renewable share of generation').data = [11.6];
  assert.equal(ids(parse(PRICE, short, FREQUENCY)).includes('hu-mix'), false, 'a series that does not line up with the time axis is another shape');
  // Every slot has visibly different values, so reading another slot of the sources (first or last) can not pass.
  const lateShare = powerOf({ Nuclear: [100, 200, 300], 'Fossil gas': [10, 20, 30], Solar: [1, 2, 3], 'Renewable share of generation': [11.6, 11.7, null] }, '2026-10-02T21:00:00Z');
  const late = parse(PRICE, lateShare, FREQUENCY).observations.find(r => r.providerId === 'hu-mix');
  assert.equal(late.observedAt, '2026-10-02T21:15:00.000Z'); assert.equal(late.renewableSharePct, 11.7);
  assert.match(late.summary, /Largest sources: Nuclear 200 MW, Fossil gas 20 MW, Solar 2 MW\./, 'the sources are read from the same slot as the share');
});

test('wrong shapes and provider errors degrade to an error result, never to a quiet feed', () => {
  for (const payload of [[], null, undefined, 'text', 42, {}, { unix_seconds: 'x' }, { unix_seconds: [1], price: 'x' }]) {
    const result = parseEnergyCharts(payload, payload, payload, { now });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null); assert.doesNotMatch(result.error, /https?:/);
  }
  const renamed = { ...copy(PRICE), prices: PRICE.price }; delete renamed.price;
  assert.equal(parse(renamed, null, null).status, 'error');
  const partial = parse(renamed, POWER, FREQUENCY);
  assert.equal(partial.status, 'ok'); assert.deepEqual(ids(partial), ['hu-frequency', 'hu-mix']); assert.match(partial.summary, /price: unexpected response/);
  const renamedTimes = { ...copy(FREQUENCY), seconds: FREQUENCY.unix_seconds }; delete renamedTimes.unix_seconds;
  assert.match(parse(PRICE, POWER, renamedTimes).summary, /frequency: unexpected response/);
  const renamedTypes = { unix_seconds: POWER.unix_seconds, series: POWER.production_types };
  assert.match(parse(PRICE, renamedTypes, FREQUENCY).summary, /mix: unexpected response/);
  for (const unit of ['EUR / kWh', 'USD / MWh', 'HUF / MWh', undefined, null, 5, 'x'.repeat(100000), `EUR${' '.repeat(100)}/ MWh`]) {
    const result = parse({ ...copy(PRICE), unit }, POWER, FREQUENCY);
    assert.equal(ids(result).includes('hu-price'), false, String(unit).slice(0, 20)); assert.match(result.summary, /price: unexpected/);
  }
  for (const unit of ['EUR / MWh', 'EUR/MWh', 'eur / mwh']) assert.equal(ids(parse({ ...copy(PRICE), unit })).includes('hu-price'), true, unit);
  const unequal = { ...copy(PRICE), price: [1, 2] };
  assert.equal(ids(parse(unequal)).includes('hu-price'), false, 'values that do not line up with the time axis');
  const failed = parse({ error: 'HTTP 503 from https://api.energy-charts.info/price?bzn=HU&key=secret', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'Request timed out after 10000ms' });
  assert.equal(failed.status, 'error'); assert.doesNotMatch(failed.error, /https?:|secret|api\.energy-charts/i); assert.match(failed.error, /Energy-Charts/);
  const half = parse({ error: 'HTTP 429', status: 429 }, POWER, FREQUENCY);
  assert.equal(half.status, 'ok'); assert.match(half.summary, /price: request failed: HTTP 429/); assert.equal('hu_power_price' in half.metrics, false);
  assert.equal(parse(PRICE, { error: 'HTTP 404', status: 404 }, FREQUENCY).status, 'ok', 'a missing mix leaves the other two');
  assert.match(parse(PRICE, { error: 'HTTP 404', status: 404 }, FREQUENCY).summary, /mix: request failed: HTTP 404/);
});

test('the price series is published only with a CC BY 4.0 licence from the answer itself', () => {
  const ok = parse(PRICE, POWER, FREQUENCY);
  assert.equal(ids(ok).includes('hu-price'), true); assert.equal(ok.metrics.hu_power_price, 182.36);
  const withoutLicence = copy(PRICE); delete withoutLicence.license_info;
  const bad = [withoutLicence, { ...copy(PRICE), license_info: null }, { ...copy(PRICE), license_info: 5 }, { ...copy(PRICE), license_info: {} }, { ...copy(PRICE), license_info: 'For private and internal use only' },
    { ...copy(PRICE), license_info: 'CC BY-NC 4.0' }, { ...copy(PRICE), license_info: 'CC BY 4x0' },{ ...copy(PRICE), license_info: 'CC BY 3.0' }, { ...copy(PRICE), license_info: '' }, { ...copy(PRICE), license_info: 'x'.repeat(100000) },
    { ...copy(PRICE), license_info: `${' '.repeat(200)}CC BY 4.0` }, { ...copy(PRICE), license_info: '<'.repeat(1000000) }];
  for (const payload of bad) {
    const result = parse(payload, POWER, FREQUENCY);
    assert.equal(result.status, 'ok', 'the other series stay'); assert.deepEqual(ids(result), ['hu-frequency', 'hu-mix']); assert.match(result.summary, /price: unexpected licence/);
    assert.equal('hu_power_price' in result.metrics, false, 'no price metric without the licence'); assert.equal(result.metrics.grid_frequency_hz, 50.0217);
  }
  assert.equal(parse(withoutLicence, null, null).status, 'error', 'the licence alone can make the feed unreadable');
  for (const license_info of ['CC BY 4.0', 'cc by 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de', 'Data: CC BY 4.0 from SMARD.de']) assert.equal(ids(parse({ ...copy(PRICE), license_info }, POWER, FREQUENCY)).includes('hu-price'), true, license_info);
  const exactly200 = `CC BY 4.0${' '.repeat(191)}`; assert.equal(exactly200.length, 200);
  assert.equal(ids(parse({ ...copy(PRICE), license_info: exactly200 }, POWER, FREQUENCY)).includes('hu-price'), true, 'a licence text of 200 characters is the limit');
  assert.equal(ids(parse({ ...copy(PRICE), license_info: `${exactly200} ` }, POWER, FREQUENCY)).includes('hu-price'), false);
});

test('a deprecated endpoint is reported in the summary and still read', () => {
  const result = parse({ ...copy(PRICE), deprecated: true }, POWER, FREQUENCY);
  assert.equal(result.status, 'ok'); assert.equal(ids(result).includes('hu-price'), true); assert.match(result.summary, /price endpoint is marked deprecated/i);
  assert.doesNotMatch(parse().summary, /deprecated/i);
});

test('hostile provider text in the production type names stays inert', () => {
  const names = [`<img src=x onerror=alert(1)>${rtl}Nuclear`, `Solar${bell}${zero}`, 'A'.repeat(1000000), '<'.repeat(1000000), '<a '.repeat(300000), `Wind ${'x'.repeat(61)}`, 5, null, { name: 'x' }, '../../etc', 'Solar <b>'];
  const power = powerOf({ Biomass: [206.3], 'Renewable share of generation': [11.6] });
  for (const name of names) power.production_types.push({ name, data: [9999] });
  power.production_types.push(null, 'x', { data: [1] }, { name: 'Hydro', data: 'x' });
  const started = Date.now();
  const mix = parse(PRICE, power, FREQUENCY).observations.find(r => r.providerId === 'hu-mix');
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  assert.doesNotMatch(mix.summary, /[<>]/); assert.doesNotMatch(mix.summary, new RegExp(`[${rtl}${zero}${bell}]`)); assert.match(mix.summary, /Largest sources: Biomass 206 MW\./);
  assert.ok(mix.summary.length < 800, `summary length ${mix.summary.length}`);
});

// Standing rule for every adapter: bound every input before any pattern or loop runs on it, and prove it fails fast.
test('hostile oversized answers are bounded in time and never stall the loop', () => {
  const started = Date.now();
  const n = 400000;
  const times = Array.from({ length: n }, (_, i) => 1790000000 + i);
  const hugeNulls = { unix_seconds: times, data: times.map(() => null) };
  const frequency = parse(PRICE, POWER, hugeNulls);
  assert.equal(ids(frequency).includes('hu-frequency'), false); assert.match(frequency.summary, /frequency: no sample/);
  const hugeValid = { unix_seconds: times.map((_, i) => 1790981393 - (n - 1 - i)), data: times.map((_, i) => 50 + (i % 10) / 1000) };
  const latest = parse(PRICE, POWER, hugeValid).observations.find(r => r.providerId === 'hu-frequency');
  assert.equal(latest.observedAt, '2026-10-02T22:49:53.000Z'); assert.equal(latest.frequencyHz, 50 + ((n - 1) % 10) / 1000);
  const hugePrice = { ...copy(PRICE), unix_seconds: times, price: times.map(() => 'x') };
  assert.match(parse(hugePrice).summary, /price: unexpected timestamps or values/);
  const hugeTypes = { unix_seconds: [sec('2026-10-02T21:30:00Z')], production_types: Array.from({ length: 300000 }, (_, i) => ({ name: `Type ${i}`, data: [i] })) };
  hugeTypes.production_types.unshift({ name: 'Renewable share of generation', data: [11.6] });
  assert.equal(parse(PRICE, hugeTypes, FREQUENCY).observations.find(r => r.providerId === 'hu-mix').renewableSharePct, 11.6);
  // Only the newest MAX_POINTS (2000) samples and the first 40 production types are looked at (the live windows have 49, 49 and 1200 samples, 17 types).
  const buried = Array.from({ length: 5000 }, () => null); buried[0] = 50.01;
  const deep = { unix_seconds: Array.from({ length: 5000 }, (_, i) => 1790981393 - 4999 + i), data: buried };
  assert.match(parse(PRICE, POWER, deep).summary, /frequency: no sample/, 'a sample 5000 places back is not looked for');
  const manyTypes = { unix_seconds: [sec('2026-10-02T21:30:00Z')], production_types: [...Array.from({ length: 100 }, (_, i) => ({ name: `Type ${i}`, data: [i] })), { name: 'Renewable share of generation', data: [11.6] }] };
  assert.match(parse(PRICE, manyTypes, FREQUENCY).summary, /mix: no renewable share series/, 'only the first 40 types are examined');
  const hugeText = { ...copy(PRICE), unit: 'x'.repeat(1000000), license_info: '<'.repeat(1000000) };
  assert.match(parse(hugeText).summary, /price: unexpected/);
  for (const error of ['http://'.repeat(150000), '<'.repeat(1000000), 'x'.repeat(1000000)]) {
    const failed = parse({ error }, { error }, { error });
    assert.equal(failed.status, 'error'); assert.ok(failed.error.length <= 300); assert.doesNotMatch(failed.error, /https?:/);
  }
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test('provider ids are fixed and rows keep their identity across parses and sweeps', () => {
  assert.deepEqual(ids(parse()), ids(parse())); assert.deepEqual(ids(parse(copy(PRICE), copy(POWER), copy(FREQUENCY))), ['hu-price', 'hu-frequency', 'hu-mix']);
  const later = parse(priceAt(250, '2026-10-02T22:45:00Z'), withShare(20), frequencyAt(50.03), {});
  assert.deepEqual(ids(later), ['hu-price', 'hu-frequency', 'hu-mix'], 'new values update the same rows in place');
  const urls = result => result.observations.map(row => row.url);
  assert.deepEqual(urls(later), urls(parse()));
  const sweepLater = parseEnergyCharts(PRICE, POWER, FREQUENCY, { now: now + HOUR });
  assert.deepEqual(ids(sweepLater), ['hu-price', 'hu-frequency', 'hu-mix']);
});

test('observations survive the server normalization with facts, metrics and the registered home and policy', () => {
  assert.deepEqual(FACT_FIELDS['Energy-Charts-HU'], ['pricePerMwh', 'frequencyHz', 'renewableSharePct']);
  assert.equal(HOME['Energy-Charts-HU'], 'https://energy-charts.info/');
  const [out] = normalizeLiveSources({ 'Energy-Charts-HU': parse() }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://energy-charts.info/'); assert.equal(out.observations.length, 3);
  assert.deepEqual(out.observations.map(row => row.facts), [[{ label: 'pricePerMwh', value: 182.36 }], [{ label: 'frequencyHz', value: 50.0217 }], [{ label: 'renewableSharePct', value: 11.6 }]]);
  assert.deepEqual(out.observations.map(row => row.severity), ['info', 'info', 'info'], 'all info: the fixed row order');
  assert.deepEqual(out.observations.map(row => row.facts[0].label), ['pricePerMwh', 'frequencyHz', 'renewableSharePct']);
  assert.ok(out.observations.every(row => row.kind === 'energy' && row.url.startsWith('https://energy-charts.info/charts/')));
  assert.deepEqual(out.metrics, { hu_power_price: 182.36, grid_frequency_hz: 50.0217 });
  assert.equal(out.license, 'CC BY 4.0'); assert.match(out.attribution, /Energy-Charts/);
  const [stale] = normalizeLiveSources({ 'Energy-Charts-HU': parse(priceAt(1, iso(now - 8 * HOUR)), null, null) }, now);
  assert.deepEqual(stale.metrics, {}, 'metrics are absent unless the feed is ok');
  const events = buildEvents({ meta: { timestamp: iso(now) }, liveSources: [out] }, { now });
  assert.equal(events.length, 3); assert.ok(events.every(event => event.kind === 'energy'));
  assert.equal(events.find(event => event.title.startsWith('Hungary day-ahead')).source.url, 'https://energy-charts.info/charts/price_spot_market/chart.htm?l=en&c=HU');
  const eventIds = payload => buildEvents({ meta: { timestamp: iso(now) }, liveSources: normalizeLiveSources({ 'Energy-Charts-HU': payload }, now) }, { now }).map(event => event.id).sort();
  assert.deepEqual(eventIds(parse()), eventIds(parse()), 'event identities are stable across parses');
  assert.deepEqual(eventIds(parse()), eventIds(parse(priceAt(250), withShare(20), frequencyAt(50.03))), 'and across new values');
});

test('briefing makes three bounded requests with the real parameter names', async () => {
  const seen = [];
  const result = await briefing({ now, fetcher: async (url, options) => { seen.push({ url: new URL(url), options }); return answers(url); } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 3); assert.deepEqual(ids(result), ['hu-price', 'hu-frequency', 'hu-mix']);
  const byPath = Object.fromEntries(seen.map(item => [item.url.pathname, item]));
  const end = String(now / 1000);
  assert.equal(byPath['/price'].url.origin, 'https://api.energy-charts.info');
  assert.equal(byPath['/price'].url.searchParams.get('bzn'), 'HU'); assert.equal(byPath['/price'].url.searchParams.get('start'), String(now / 1000 - 12 * 3600)); assert.equal(byPath['/price'].url.searchParams.get('end'), end);
  assert.equal(byPath['/public_power'].url.searchParams.get('country'), 'hu'); assert.equal(byPath['/public_power'].url.searchParams.get('start'), String(now / 1000 - 12 * 3600)); assert.equal(byPath['/public_power'].url.searchParams.get('end'), end);
  assert.equal(byPath['/frequency'].url.searchParams.get('region'), 'DE-Freiburg'); assert.equal(byPath['/frequency'].url.searchParams.get('start'), String(now / 1000 - 20 * 60)); assert.equal(byPath['/frequency'].url.searchParams.get('end'), end);
  for (const { options } of seen) assert.deepEqual({ ...options }, { timeout: 10000, retries: 0, maxBytes: 2 * MIB });
  assert.equal(new Set(seen.map(item => item.url.pathname)).size, 3, 'one request per endpoint');
});

test('briefing degrades every transport failure to a result without a URL and never throws', async () => {
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'Request timed out after 10000ms' }, { error: 'Response exceeds 2097152 byte limit' },
    { error: 'connect failed for https://api.energy-charts.info/price?bzn=HU&key=secret' }, { error: 'Invalid JSON response', status: 200 }, [], null, 'text'];
  for (const payload of failures) {
    const result = await briefing({ now, fetcher: async () => payload });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:|energy-charts\.info|secret/i);
  }
  const thrown = await briefing({ now, fetcher: async () => { throw new Error('connect ECONNREFUSED https://api.energy-charts.info/?key=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|energy-charts\.info|secret|ECONNREFUSED/i);
  assert.equal((await briefing({ now, fetcher: () => { throw new Error('sync https://x'); } })).status, 'error');
  const oneDown = await briefing({ now, fetcher: async url => url.includes('/price') ? { error: 'HTTP 429', status: 429 } : answers(url) });
  assert.equal(oneDown.status, 'ok'); assert.deepEqual(ids(oneDown), ['hu-frequency', 'hu-mix']); assert.match(oneDown.summary, /price: request failed: HTTP 429/); assert.equal('hu_power_price' in oneDown.metrics, false);
  const slowOne = await briefing({ now, fetcher: async url => url.includes('/frequency') ? { error: 'Request timed out after 10000ms' } : answers(url) });
  assert.deepEqual(ids(slowOne), ['hu-price', 'hu-mix']);
});

test('briefing over the real fetch helper degrades 429, 404, 503, timeout, an oversized body and invalid JSON', async () => {
  const cases = {
    '429': () => reply('Too Many Requests', { status: 429 }),
    '404': () => reply('no content available', { status: 404 }),
    '503': () => reply('down', { status: 503 }),
    'timeout': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    'oversized': () => reply('x'.repeat(2 * MIB + 1)),
    'invalid json': () => reply('<html>not json</html>'),
    'network': () => Promise.reject(new TypeError('fetch failed')),
  };
  for (const [name, impl] of Object.entries(cases)) {
    const result = await withFetch(impl, () => briefing({ now, timeout: 25 }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name);
    assert.doesNotMatch(result.error, /https?:|energy-charts\.info/i, name);
  }
  assert.match((await withFetch(cases.timeout, () => briefing({ now, timeout: 25, useCache: false }))).error, /timed out/i);
  assert.match((await withFetch(cases.oversized, () => briefing({ now, timeout: 1000, useCache: false }))).error, /exceeds|limit/i);
  const ok = await withFetch(async url => reply(answers(String(url))), () => briefing({ now, useCache: false }));
  assert.equal(ok.status, 'ok'); assert.deepEqual(ids(ok), ['hu-price', 'hu-frequency', 'hu-mix']);
  const noMix = await withFetch(async url => String(url).includes('/public_power') ? reply('no content available', { status: 404 }) : reply(answers(String(url))), () => briefing({ now, useCache: false }));
  assert.equal(noMix.status, 'ok'); assert.deepEqual(ids(noMix), ['hu-price', 'hu-frequency']); assert.match(noMix.summary, /mix: request failed: HTTP 404/);
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await briefing({ now, timeout, fetcher: async (url, options) => { seen.push(options.timeout); return answers(url); } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000);
});

test('the answers are cached for two minutes (the provider allows 2 requests a minute per endpoint); errors are not cached', async () => {
  let calls = 0;
  const fetcher = async url => { calls++; return answers(url); };
  await briefing({ now, fetcher, useCache: true }); assert.equal(calls, 3);
  const again = await briefing({ now: now + 60000, fetcher, useCache: true }); assert.equal(calls, 3, 'no request within two minutes'); assert.equal(again.status, 'ok');
  await briefing({ now: now + 121000, fetcher, useCache: true }); assert.equal(calls, 6, 'asked again after two minutes');
  await briefing({ now: now + 250000, fetcher, useCache: false }); assert.equal(calls, 9, 'a different fetcher option disables the cache');
  let failing = 0;
  const bad = async url => { failing++; return url.includes('/price') ? { error: 'HTTP 429', status: 429 } : answers(url); };
  const later = now + 3600000;
  await briefing({ now: later, fetcher: bad, useCache: true }); const afterFirst = failing;
  await briefing({ now: later + 1000, fetcher: bad, useCache: true });
  assert.equal(failing - afterFirst, 1, 'only the failed price request is repeated; the two good answers come from the cache');
  const dead = async () => ({ error: 'HTTP 503', status: 503 }); let deadCalls = 0;
  const counting = async url => { deadCalls++; return dead(url); };
  await briefing({ now: later + 7200000, fetcher: counting, useCache: true }); await briefing({ now: later + 7200001, fetcher: counting, useCache: true });
  assert.equal(deadCalls, 6, 'failed answers are not cached');
  const defaults = await briefing({ now, fetcher: async url => answers(url) });
  assert.equal(defaults.status, 'ok', 'the default with a fetcher is no cache');
  let counted = 0;
  const plain = async url => { counted++; return answers(url); };
  await briefing({ now, fetcher: plain }); await briefing({ now, fetcher: plain }); assert.equal(counted, 6, 'an injected fetcher bypasses the cache unless asked');
});

test('history keeps three records that update in place: a new sweep never adds rows', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-energy-charts-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = new HistoryStore(dir, { now: () => now + 2 * HOUR });
  const eventsFor = (price, power, frequency, at) => buildEvents({ meta: { timestamp: iso(at) }, liveSources: normalizeLiveSources({ 'Energy-Charts-HU': parseEnergyCharts(price, power, frequency, { now: at }) }, at) }, { now: at });
  const first = eventsFor(PRICE, POWER, FREQUENCY, now);
  const second = eventsFor(priceAt(250, '2026-10-02T22:45:00Z'), withShare(20), frequencyAt(50.03), now + 900000);
  const later = eventsFor(priceAt(80, '2026-10-02T23:00:00Z'), withShare(25, '2026-10-02T22:15:00Z'), frequencyAt(49.99, '2026-10-02T23:12:00Z'), now + 1800000);
  assert.equal(first.length, 3); assert.equal(new Set(first.map(event => event.source.url)).size, 3, 'the three rows have three links');
  assert.deepEqual(history.add(first), { added: 3, updated: 0, ignored: 0, total: 3 });
  assert.deepEqual(history.add(second), { added: 0, updated: 3, ignored: 0, total: 3 }, 'new values update the same records');
  assert.deepEqual(history.add(later), { added: 0, updated: 3, ignored: 0, total: 3 });
  assert.equal(history.query({ source: 'Energy-Charts-HU' }).total, 3);
  assert.deepEqual(second.map(event => event.id).sort(), first.map(event => event.id).sort(), 'the event ids are stable across sweeps');
});
