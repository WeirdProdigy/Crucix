// Read public OONI web-connectivity measurement metadata; never run probes.
// https://api.ooni.io/apidocs/ — measurement failure != anomaly != confirmed blocking.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshness, freshResult, unavailableResult } from '../utils/freshness.mjs';

const SOURCE = 'OONI';
const MAX_AGE = 24 * 3600000;
const CACHE_MS = 30 * 60000;
const cache = new Map();
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
const ATTRIBUTION = 'OONI, Open Observatory of Network Interference';
const SUMMARY = 'Recent public OONI web-connectivity samples. A failed measurement is a test error; an anomaly is unconfirmed; confirmed blocking applies to that measurement, not a whole country.';
// Assigned ISO 3166-1 alpha-2 codes; reject arbitrary API country filters.
const COUNTRIES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

function country(value) { return typeof value === 'string' && /^[A-Z]{2}$/.test(value) && COUNTRIES.has(value) ? value : null; }
function asn(value) {
  if (typeof value !== 'string' || !/^AS\d{1,10}$/.test(value)) return null;
  const number = Number(value.slice(2));
  return Number.isInteger(number) && number > 0 && number <= 4294967295 ? `AS${number}` : null;
}
function targetHost(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.hostname.slice(0, 253) : null; }
  catch { return null; }
}

export function parseOoniMeasurements(payload, { now = Date.now() } = {}) {
  const extras = { attribution: ATTRIBUTION, summary: SUMMARY };
  if (payload?.error) return unavailableResult(SOURCE, payload.error, extras, now);
  if (!payload || !Array.isArray(payload.results)) return unavailableResult(SOURCE, 'OONI returned an invalid response', extras, now);
  const observations = payload.results.slice(0, 100).flatMap(row => {
    if (!row || row.test_name !== 'web_connectivity' || !country(row.probe_cc) ||
      typeof row.measurement_uid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(row.measurement_uid) ||
      !['failure', 'anomaly', 'confirmed'].every(key => typeof row[key] === 'boolean')) return [];
    const observedAt = providerTime(row.measurement_start_time);
    const host = targetHost(row.input);
    const resource = asn(row.probe_asn);
    const context = `${row.probe_cc}${resource ? ` / ${resource}` : ''}${host ? `, ${host}` : ''}`;
    const measurementStatus = row.failure ? 'measurement-failure' : row.confirmed ? 'confirmed-blocking' : row.anomaly ? 'anomaly' : 'no-anomaly';
    const description = row.failure ? 'Measurement failed: a test error, not evidence of blocking.' : row.confirmed
      ? 'OONI reports confirmed blocking in this web-connectivity measurement.' : row.anomaly
        ? 'OONI reports an unconfirmed web-connectivity anomaly; review the measurement.' : 'No anomaly or confirmed blocking was reported in this web-connectivity sample.';
    return [{ providerId: row.measurement_uid,
      title: `OONI ${measurementStatus}: ${row.probe_cc}`,
      summary: `${description} ${context}.`, source: SOURCE,
      url: `https://explorer.ooni.org/m/${encodeURIComponent(row.measurement_uid)}`,
      observedAt, publishedAt: observedAt, kind: 'network',
      severity: measurementStatus === 'confirmed-blocking' ? 'high' : measurementStatus === 'anomaly' ? 'medium' : 'info',
      countryCode: row.probe_cc, ...(resource ? { resource } : {}), ...(host ? { targetHost: host } : {}),
      measurementStatus, blockingConfirmed: !row.failure && row.confirmed,
      failure: row.failure, anomaly: row.anomaly, confirmed: row.confirmed,
    }];
  });
  const dates = observations.map(row => row.observedAt).filter(Boolean).sort();
  const freshDates = dates.filter(date => freshness(date, MAX_AGE, now).fresh);
  const result = freshResult(SOURCE, freshDates.at(-1) || dates.at(-1) || null, observations, extras, now);
  result.metrics = { samples: result.observations.length,
    failures: result.observations.filter(row => row.measurementStatus === 'measurement-failure').length,
    anomalies: result.observations.filter(row => row.measurementStatus === 'anomaly').length,
    confirmedBlocking: result.observations.filter(row => row.measurementStatus === 'confirmed-blocking').length };
  return result;
}

async function request(code, fetcher, now, useCache) {
  const previous = cache.get(code);
  if (useCache && previous?.fetcher === fetcher && now >= previous.collectedAt && now - previous.collectedAt < CACHE_MS) return previous.payload;
  const query = new URLSearchParams({ probe_cc: code, test_name: 'web_connectivity',
    since: new Date(now - MAX_AGE).toISOString(), until: new Date(now).toISOString(),
    limit: '5', order_by: 'measurement_start_time', order: 'desc' });
  let payload;
  try { payload = await fetcher(`https://api.ooni.io/api/v1/measurements?${query}`, REQUEST); }
  catch { payload = { error: 'OONI request failed' }; }
  if (useCache && !payload?.error && parseOoniMeasurements(payload, { now }).status === 'ok') {
    if (cache.size >= 16 && !cache.has(code)) cache.delete(cache.keys().next().value);
    cache.set(code, { payload, fetcher, collectedAt: now });
  }
  return payload;
}

export async function briefing(options = {}) {
  const now = options.now ?? Date.now();
  const countries = options.countries === undefined ? ['HU'] : Array.isArray(options.countries)
    ? [...new Set(options.countries.slice(0, 100).map(country).filter(Boolean))].slice(0, 3) : [];
  const extras = { attribution: ATTRIBUTION, summary: SUMMARY, countries,
    window: { since: new Date(now - MAX_AGE).toISOString(), until: new Date(now).toISOString() } };
  if (!countries.length) return unavailableResult(SOURCE, 'No valid ISO country codes requested', extras, now);
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  const results = await Promise.all(countries.map(async code => parseOoniMeasurements(await request(code, fetcher, now, useCache), { now })));
  const errors = results.map((result, index) => result.error ? { countryCode: countries[index], error: result.error } : null).filter(Boolean);
  if (errors.length === results.length) return unavailableResult(SOURCE, 'OONI requests unavailable', { ...extras, errors }, now);
  const dates = results.map(result => result.observedAt).filter(Boolean).sort();
  const freshDates = dates.filter(date => freshness(date, MAX_AGE, now).fresh);
  const observations = results.flatMap(result => result.observations);
  const result = freshResult(SOURCE, freshDates.at(-1) || dates.at(-1) || null, observations, { ...extras, ...(errors.length ? { errors } : {}) }, now);
  result.rejectedObservations += results.reduce((sum, row) => sum + row.rejectedObservations, 0);
  result.metrics = { samples: result.observations.length,
    failures: result.observations.filter(row => row.measurementStatus === 'measurement-failure').length,
    anomalies: result.observations.filter(row => row.measurementStatus === 'anomaly').length,
    confirmedBlocking: result.observations.filter(row => row.measurementStatus === 'confirmed-blocking').length };
  return result;
}
