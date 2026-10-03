// ENTSOG Transparency Platform: physical gas flows at the cross-border interconnection points of Hungary.
// https://transparency.entsog.eu/api/v1/ (no key). Checked live on 2026-10-02:
//   - interconnections?fromCountryKey=HU and ?toCountryKey=HU list the points of Hungary. The seven cross-border interconnection points
//     (pointKey ITP-...) are in POINTS: HU-HR Dravaszerdahely, HU-SK Balassagyarmat, HU-RO Csanadpalota, HU-AT Mosonmagyarovar, HU-RS
//     Kiskundorozsma (a one-way exit) and Kiskundorozsma-2/Horgos (the TurkStream entry), HU-UA VIP Bereg. Storage, production, the virtual
//     point and the aggregated distribution/final consumer points of Hungary are not cross-border flows and are not read. The point keys are the
//     provider's stable identity (the labels have changed over the years), so the request filters by pointKey, not by pointLabel.
//   - operationaldata?indicator=Physical Flow&periodType=day&pointKey=<keys>&operatorKey=HU-TSO-0001&from&to&limit: one record per operator,
//     point, direction and gas day. Both operators of an interconnection report it, each in its own system: the Hungarian operator FGSZ
//     (HU-TSO-0001) says `entry` for gas entering Hungary and `exit` for gas leaving it, the neighbour says it the other way round, so only
//     FGSZ records are read. Fields: periodFrom/periodTo (the gas day, 06:00 to 06:00 Hungarian time, with a UTC offset, 23 to 25 hours long),
//     directionKey, value (kWh/d), unit, flowStatus (Provisional on every record seen), lastUpdateDateTime. A pointKey unknown to the API
//     in a list of keys is ignored; if all are unknown the answer is HTTP 404 {"message":...}.
//   - THE GAS DAY IN PROGRESS IS INCLUDED in the answer with the flow so far (about 173 GWh of the usual 247 GWh at 00:00 local time), under
//     the same unit kWh/d. It is told apart by its last update, which is earlier than the end of the gas day. A completed day has its final
//     update at about 07:00 on the next morning (median 1 h after the end, at most 2.4 h); 26 of 793 records of the last 60 days were
//     last updated BEFORE the day ended (the real day 2026-09-13: 204 GWh against about 245 GWh normally), so such a day is partial and is
//     not used. A row is the latest day for which every direction of the point is complete.
// Terms: ENTSOG TP Terms and Conditions of Use (TRA0394-16, article 5) allow the automated download through the API when the terms are respected
// and ask for the source and the date of the download ("ENTSOG TP [DD-MM-YYYY] https://transparency.entsog.eu/"); they forbid usage that reduces the
// platform's performance, so a good answer is kept for an hour (one request an hour while the platform answers; an error or an empty answer is not
// kept and the next sweep asks again). Provider text is never shown: the labels are our own, and only a unit and a
// status that pass a strict pattern after a length check are read.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshResult, unavailableResult } from '../utils/freshness.mjs';

const SOURCE = 'ENTSOG-HU';
const ENDPOINT = 'https://transparency.entsog.eu/api/v1/operationaldata';
const OPERATOR = 'HU-TSO-0001';
const INDICATOR = 'Physical Flow';
const POINTS = Object.freeze([
  { key: 'ITP-00011', slug: 'dravaszerdahely-hr', label: 'Dravaszerdahely (HU/HR)', directions: ['entry', 'exit'] },
  { key: 'ITP-00027', slug: 'balassagyarmat-sk', label: 'Balassagyarmat (HU/SK)', directions: ['entry', 'exit'] },
  { key: 'ITP-00032', slug: 'csanadpalota-ro', label: 'Csanadpalota (HU/RO)', directions: ['entry', 'exit'] },
  { key: 'ITP-00043', slug: 'mosonmagyarovar-at', label: 'Mosonmagyarovar (HU/AT)', directions: ['entry', 'exit'] },
  { key: 'ITP-00055', slug: 'kiskundorozsma-rs', label: 'Kiskundorozsma (HU/RS)', directions: ['exit'] },
  { key: 'ITP-10006', slug: 'bereg-ua', label: 'VIP Bereg (HU/UA)', directions: ['entry', 'exit'] },
  { key: 'ITP-10013', slug: 'kiskundorozsma-2-rs', label: 'Kiskundorozsma-2 / Horgos (HU/RS)', directions: ['entry', 'exit'] },
]);
const BY_KEY = new Map(POINTS.map(point => [point.key, point]));
const HOUR = 3600000;
const DAYS_BACK = 3; // gas days asked for besides today: the latest completed day is at most two days behind
const LIMIT = 400; // 7 points x 2 directions x 4 days = 56 records for FGSZ
const MAX_EXAMINED = LIMIT;
const FUTURE_SKEW_MS = 300000;
const CACHE_MS = HOUR;
const MAX_VALUE = 1e11; // kWh/d: far above the 250 GWh/d of the largest point
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
const UNIT = /^[A-Za-z0-9/]{1,12}$/;
const STATUS = /^[A-Za-z ]{1,20}$/;
const GAS_DAY_START = /T0[45]:00:00\.000Z$/; // 06:00 CET or CEST in UTC
const SUMMARY = 'Physical gas flow (ENTSOG Transparency Platform, indicator "Physical Flow") at the seven cross-border interconnection points of Hungary, one row per point for the latest completed gas day (06:00 to 06:00 CET/CEST), as reported by the Hungarian transmission operator FGSZ. Entry = gas entering Hungary, exit = gas leaving Hungary. Values are provisional and can be revised; the gas day in progress is not shown because it holds only the flow so far.';
const RIGHTS = 'ENTSOG Transparency Platform terms of use (art. 5): "you may download, store and use the contents of the ENTSOG TP in good faith and always complying with good business practices regarding the re-use of publicly available data, and provided you keep intact all trademark, copyright and other proprietary notices indicated"; when quoting, "you shall at least indicate the source, and the date of data download/extraction". "ENTSOG does not permit automatic extraction of data or other usage that reduces the performance of the ENTSOG TP"; automated download is possible through its API when the terms are respected. The separate ENTSOG TP Disclaimer (LGT0291) says "ENTSOG cannot be held liable for the accuracy and timeliness of the information provided"; the terms also disclaim responsibility for altered or summarized data.';
const extrasFor = downloadedAt => ({
  attribution: `ENTSOG TP ${new Date(downloadedAt).toISOString().slice(0, 10).split('-').reverse().join('-')} https://transparency.entsog.eu/`,
  rights: RIGHTS,
  license: 'ENTSOG Transparency Platform Terms and Conditions of Use (re-use with source citation)',
  licenseUrl: 'https://transparency.entsog.eu/pdf/TRA0394_20161115_ENTSOG_TP_Privacy_TC_of_Use_Rev_3.pdf',
  summary: SUMMARY,
});

let cached = null; // the last good answer: { payload, fetcher, collectedAt }

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const round2 = value => Math.round(value * 100) / 100;
// Transport errors become a short reason; a URL or an upstream message never reaches the result.
function failure(error) {
  const reason = typeof error === 'string' ? error.slice(0, 300).replace(/https?:\/\/\S*/gi, '').trim().slice(0, 120) : '';
  return `ENTSOG request failed${reason ? `: ${reason}` : ''}`;
}

// One record of the answer: null when it is not about a series this source reads (another operator, indicator, point, direction or period type,
// or no value: a gap), `{ bad: true }` when it is one of ours and can not be used, else the reading.
function reading(raw) {
  if (!isObject(raw)) return null;
  const point = typeof raw.pointKey === 'string' && raw.pointKey.length <= 20 ? BY_KEY.get(raw.pointKey) : undefined;
  if (!point || raw.operatorKey !== OPERATOR || raw.indicator !== INDICATOR || raw.periodType !== 'day' || (raw.directionKey !== 'entry' && raw.directionKey !== 'exit')) return null;
  if (raw.value === null || raw.value === undefined) return null;
  const from = providerTime(raw.periodFrom), to = providerTime(raw.periodTo), updated = providerTime(raw.lastUpdateDateTime);
  const value = raw.value, unit = raw.unit;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_VALUE || typeof unit !== 'string' || unit.length > 20 || !UNIT.test(unit)
    || !from || !to || !updated || !GAS_DAY_START.test(from)) return { bad: true };
  const span = Date.parse(to) - Date.parse(from);
  if (span < 23 * HOUR || span > 25 * HOUR) return { bad: true };
  const status = typeof raw.flowStatus === 'string' && raw.flowStatus.length <= 20 && STATUS.test(raw.flowStatus) ? raw.flowStatus.trim() : '';
  return { point, direction: raw.directionKey, day: from.slice(0, 10), start: Date.parse(from), end: Date.parse(to), updated: Date.parse(updated), value, unit, status };
}

// Every direction of the point is reported, in one unit, and was last updated after the gas day ended: the gas day is over (by our clock too)
// and its values are not the flow so far.
function completed(group, now) {
  return !group.conflict && group.point.directions.every(direction => group.directions.has(direction)) && group.end <= now + FUTURE_SKEW_MS
    && [...group.directions.values()].every(item => item.updated >= group.end);
}

function observation(group) {
  const { point, day } = group;
  const entry = group.directions.get('entry'), exit = group.directions.get('exit');
  const entryValue = entry?.value ?? 0, exitValue = exit?.value ?? 0;
  const flow = round2(Math.max(entryValue, exitValue)), direction = flow === 0 ? null : entryValue >= exitValue ? 'entry' : 'exit';
  const amount = group.unit === 'kWh/d' && flow >= 10000 ? `${(Math.round(flow / 10000) / 100).toFixed(2)} GWh/d` : `${flow} ${group.unit}`;
  const reported = [...entry ? [`entry into Hungary ${round2(entry.value)} ${group.unit}`] : [], ...exit ? [`exit from Hungary ${round2(exit.value)} ${group.unit}`] : []];
  const status = (entry ?? exit).status;
  return { kind: 'energy', providerId: `${point.slug}:${day}`,
    title: `${point.label}: ${direction ? `${amount} ${direction === 'entry' ? 'into' : 'out of'} Hungary` : 'no physical gas flow'} (gas day ${day})`,
    summary: `Physical gas flow at ${point.label}, ENTSOG point ${point.key}, on gas day ${day} (06:00 to 06:00 CET/CEST), as reported by the Hungarian transmission operator FGSZ: ${reported.join(', ')}. Reported status: ${status || 'not stated'}; values can be revised by the provider.`,
    // The API answer for exactly this point and gas day: a link of its own for every row.
    source: SOURCE, url: `${ENDPOINT}?${new URLSearchParams({ indicator: INDICATOR, periodType: 'day', pointKey: point.key, operatorKey: OPERATOR, from: day, to: day })}`,
    observedAt: new Date(group.start).toISOString(), publishedAt: new Date(Math.max(...[...group.directions.values()].map(item => item.updated))).toISOString(),
    severity: 'info', physicalFlow: flow, unit: group.unit };
}

// `payload` is the API answer; `downloadedAt` is when it was downloaded (the date of the source citation), the answer's age for a cached one.
export function parseEntsog(payload, { now = Date.now(), downloadedAt = now } = {}) {
  const extras = extrasFor(Number.isFinite(downloadedAt) ? downloadedAt : now);
  if (payload?.error) return unavailableResult(SOURCE, failure(payload.error), extras, now);
  if (!isObject(payload) || !Array.isArray(payload.operationaldata)) return unavailableResult(SOURCE, 'ENTSOG returned an unexpected response', extras, now);
  const examined = payload.operationaldata.slice(0, MAX_EXAMINED);
  const sizes = { examinedRecords: examined.length, truncatedRecords: payload.operationaldata.length - examined.length };
  const groups = new Map();
  let readable = 0, unreadable = 0;
  for (const raw of examined) {
    const item = reading(raw);
    if (!item) continue;
    if (item.bad) { unreadable++; continue; }
    readable++;
    const id = `${item.point.key}|${item.day}`;
    if (!groups.has(id)) groups.set(id, { point: item.point, day: item.day, start: item.start, end: item.end, unit: item.unit, conflict: false, directions: new Map() });
    const group = groups.get(id), known = group.directions.get(item.direction);
    if (item.unit !== group.unit && !group.conflict) { group.conflict = true; unreadable++; }
    if (!known || item.updated > known.updated) group.directions.set(item.direction, item);
  }
  if (!readable) return unavailableResult(SOURCE, unreadable ? 'ENTSOG returned records in an unexpected shape' : 'ENTSOG returned no data for the Hungarian points', { ...extras, ...sizes }, now);
  // The latest completed gas day of every point, in the fixed order of the points.
  const chosen = POINTS.map(point => [...groups.values()].filter(group => group.point === point && completed(group, now)).sort((a, b) => b.start - a.start)[0]);
  const found = chosen.filter(Boolean);
  const missing = POINTS.filter((point, index) => !chosen[index]).map(point => point.label);
  const newest = found.length ? new Date(Math.max(...found.map(group => group.start))).toISOString() : null;
  const rows = found.map(observation);
  const notes = `${missing.length ? ` No completed gas day for: ${missing.join(', ')}.` : ''}${unreadable ? ` Warning: ${unreadable} record${unreadable === 1 ? '' : 's'} of the Hungarian points could not be read (unit, time or value unusable) and ${unreadable === 1 ? 'was' : 'were'} left out.` : ''}`;
  return freshResult(SOURCE, newest, rows, { ...extras, ...sizes, summary: SUMMARY + notes }, now);
}

async function load(options) {
  const { fetcher, useCache, now, request } = options;
  if (useCache && cached?.fetcher === fetcher && now >= cached.collectedAt && now - cached.collectedAt < CACHE_MS) return cached;
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const query = new URLSearchParams({ indicator: INDICATOR, periodType: 'day', pointKey: POINTS.map(point => point.key).join(','), operatorKey: OPERATOR,
    from: day(now - DAYS_BACK * 24 * HOUR), to: day(now), limit: String(LIMIT) });
  let payload;
  try { payload = await fetcher(`${ENDPOINT}?${query}`, request); } catch { payload = { error: 'network error' }; }
  const entry = { payload, fetcher, collectedAt: now };
  if (useCache && isObject(payload) && Array.isArray(payload.operationaldata) && payload.operationaldata.length) cached = entry;
  return entry;
}

export async function briefing(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  const request = { ...REQUEST, timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)) };
  const { payload, collectedAt } = await load({ fetcher, useCache, now, request });
  return parseEntsog(payload, { now, downloadedAt: collectedAt });
}
