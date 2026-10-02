import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEntsog, briefing } from '../apis/sources/entsog.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const now = Date.parse('2026-10-02T22:10:00Z');
const HOUR = 3600000;
const MIB = 1024 * 1024;
const iso = ms => new Date(ms).toISOString();
const rtl = String.fromCharCode(0x202e), zero = String.fromCharCode(0x200b), bell = String.fromCharCode(7);

// Real records of https://transparency.entsog.eu/api/v1/operationaldata (indicator Physical Flow, periodType day, the operator FGSZ = HU-TSO-0001)
// captured on 2026-10-02 around 22:00 UTC, trimmed to the fields the source reads (values and times as served). A gas day runs from 06:00 to 06:00
// Hungarian time. `entry` is gas entering Hungary, `exit` gas leaving it. The gas day of 2026-10-02 was still running (its records were last
// updated at 00:01 on the 3rd, before the day ended); the day of 2026-10-01 had its final update at 07:01 on the 2nd.
const POINTS = { 'ITP-00011': 'Dravaszerdahely', 'ITP-00027': 'Balassagyarmat (HU) / Velké Zlievce (SK)', 'ITP-00032': 'Csanadpalota', 'ITP-00043': 'Mosonmagyarovar',
  'ITP-00055': 'Kiskundorozsma (HU>RS)', 'ITP-10006': 'VIP Bereg (HU) / VIP Bereg (UA)', 'ITP-10013': 'Kiskundorozsma-2 (HU) / Horgos (RS)' };
function record(pointKey, directionKey, day, value, over = {}) {
  const next = iso(Date.parse(`${day}T00:00:00Z`) + 86400000).slice(0, 10);
  return { id: `1Physical Flowday${day}${next}HU-TSO-0001${pointKey}${directionKey}kWh/d`, indicator: 'Physical Flow', periodType: 'day', periodFrom: `${day}T06:00:00+02:00`, periodTo: `${next}T06:00:00+02:00`,
    operatorKey: 'HU-TSO-0001', pointKey, pointLabel: POINTS[pointKey], directionKey, unit: 'kWh/d', value, lastUpdateDateTime: `${next}T07:01:10+02:00`, flowStatus: 'Provisional', ...over };
}
// [point, entry, exit] for the gas day of 2026-10-01 (ITP-00055 reports an exit only).
const FINAL = [['ITP-00043', 1101666, 0], ['ITP-00055', undefined, 0], ['ITP-00032', 75954000, 0], ['ITP-00011', 0, 5083000], ['ITP-00027', 0, 123343000], ['ITP-10013', 247029000, 0], ['ITP-10006', 14645000, 0]];
const RUNNING = [['ITP-00043', 0, 0], ['ITP-00055', undefined, 0], ['ITP-00032', 55605000, 0], ['ITP-00011', 0, 7829000], ['ITP-00027', 0, 87438000], ['ITP-10013', 173355000, 0], ['ITP-10006', 14510000, 0]];
const records = (table, day, over) => table.flatMap(([key, entry, exit]) => [...entry === undefined ? [] : [record(key, 'entry', day, entry, over)], record(key, 'exit', day, exit, over)]);
const running = over => records(RUNNING, '2026-10-02', { lastUpdateDateTime: '2026-10-03T00:01:30+02:00', ...over });
const LIVE = { meta: { count: 26 }, operationaldata: [...records(FINAL, '2026-10-01'), ...running()] };
const answer = list => ({ operationaldata: list });
const parse = (payload = LIVE, options) => parseEntsog(payload, { now, ...options });
const row = (result, slug) => result.observations.find(item => item.providerId.startsWith(`${slug}:`));
const ids = result => result.observations.map(item => item.providerId);
const withFetch = async (impl, run) => {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
};
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });

test('parse turns the live records into one observation per Hungarian point for the latest completed gas day', () => {
  const result = parse();
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'ENTSOG-HU');
  assert.deepEqual(ids(result), ['dravaszerdahely-hr:2026-10-01', 'balassagyarmat-sk:2026-10-01', 'csanadpalota-ro:2026-10-01', 'mosonmagyarovar-at:2026-10-01', 'kiskundorozsma-rs:2026-10-01', 'bereg-ua:2026-10-01', 'kiskundorozsma-2-rs:2026-10-01']);
  assert.equal(result.observedAt, '2026-10-01T04:00:00.000Z', 'the feed time is the newest gas day start (06:00 at +02:00 is 04:00 UTC)');
  const turk = row(result, 'kiskundorozsma-2-rs');
  assert.equal(turk.kind, 'energy'); assert.equal(turk.source, 'ENTSOG-HU'); assert.equal(turk.severity, 'info');
  assert.equal(turk.title, 'Kiskundorozsma-2 / Horgos (HU/RS): 247.03 GWh/d into Hungary (gas day 2026-10-01)');
  assert.equal(turk.physicalFlow, 247029000); assert.equal(turk.unit, 'kWh/d'); assert.equal(turk.observedAt, '2026-10-01T04:00:00.000Z'); assert.equal(turk.publishedAt, '2026-10-02T05:01:10.000Z');
  assert.match(turk.summary, /ENTSOG point ITP-10013/); assert.match(turk.summary, /gas day 2026-10-01 \(06:00 to 06:00 CET\/CEST\)/); assert.match(turk.summary, /FGSZ/);
  assert.match(turk.summary, /entry into Hungary 247029000 kWh\/d/); assert.match(turk.summary, /exit from Hungary 0 kWh\/d/); assert.match(turk.summary, /Provisional/);
  const sk = row(result, 'balassagyarmat-sk');
  assert.equal(sk.title, 'Balassagyarmat (HU/SK): 123.34 GWh/d out of Hungary (gas day 2026-10-01)'); assert.equal(sk.physicalFlow, 123343000);
  assert.equal(row(result, 'csanadpalota-ro').title, 'Csanadpalota (HU/RO): 75.95 GWh/d into Hungary (gas day 2026-10-01)');
  assert.equal(row(result, 'dravaszerdahely-hr').title, 'Dravaszerdahely (HU/HR): 5.08 GWh/d out of Hungary (gas day 2026-10-01)');
  assert.equal(row(result, 'bereg-ua').title, 'VIP Bereg (HU/UA): 14.65 GWh/d into Hungary (gas day 2026-10-01)');
  assert.equal(row(result, 'mosonmagyarovar-at').title, 'Mosonmagyarovar (HU/AT): 1.10 GWh/d into Hungary (gas day 2026-10-01)');
  const serbia = row(result, 'kiskundorozsma-rs');
  assert.equal(serbia.title, 'Kiskundorozsma (HU/RS): no physical gas flow (gas day 2026-10-01)'); assert.equal(serbia.physicalFlow, 0);
  assert.doesNotMatch(serbia.summary, /entry into Hungary/, 'a direction the provider does not report is not invented'); assert.match(serbia.summary, /exit from Hungary 0 kWh\/d/);
  assert.equal(new Set(result.observations.map(item => item.url)).size, 7, 'every row has its own link');
  const url = new URL(turk.url);
  assert.equal(url.origin + url.pathname, 'https://transparency.entsog.eu/api/v1/operationaldata');
  assert.equal(url.searchParams.get('pointKey'), 'ITP-10013'); assert.equal(url.searchParams.get('from'), '2026-10-01'); assert.equal(url.searchParams.get('to'), '2026-10-01');
  assert.equal(url.searchParams.get('operatorKey'), 'HU-TSO-0001'); assert.equal(url.searchParams.get('indicator'), 'Physical Flow'); assert.equal(url.searchParams.get('periodType'), 'day');
  assert.match(result.summary, /Physical Flow/); assert.match(result.summary, /entry = gas entering Hungary/i); assert.doesNotMatch(result.summary, /Warning/);
  assert.equal('metrics' in result, false, 'no metrics are promised for this source');
});

test('licence, rights and attribution quote the ENTSOG Transparency Platform terms with the download date', () => {
  const result = parse();
  assert.equal(result.attribution, 'ENTSOG TP 02-10-2026 https://transparency.entsog.eu/');
  assert.match(result.rights, /you may download, store and use the contents of the ENTSOG TP/); assert.match(result.rights, /indicate the source, and the date of data download\/extraction/);
  assert.match(result.rights, /and provided you keep intact all trademark, copyright and other proprietary notices indicated/); assert.match(result.rights, /separate ENTSOG TP Disclaimer \(LGT0291\) says "ENTSOG cannot be held liable/);
  assert.match(result.rights, /does not permit automatic extraction of data or other usage that reduces the performance/); assert.match(result.rights, /cannot be held liable for the accuracy and timeliness/);
  assert.ok(result.rights.length <= 1000, `rights length ${result.rights.length}`);
  assert.match(result.license, /ENTSOG/); assert.equal(result.licenseUrl, 'https://transparency.entsog.eu/pdf/TRA0394_20161115_ENTSOG_TP_Privacy_TC_of_Use_Rev_3.pdf');
  assert.equal(parse(LIVE, { downloadedAt: Date.parse('2026-01-05T10:00:00Z') }).attribution, 'ENTSOG TP 05-01-2026 https://transparency.entsog.eu/', 'the date of the download');
  for (const failed of [parse(null), parse(answer([]))]) { assert.match(failed.license, /ENTSOG/); assert.match(failed.attribution, /^ENTSOG TP \d\d-\d\d-\d{4} https:\/\/transparency\.entsog\.eu\/$/); assert.match(failed.rights, /download, store and use/); }
});

test('the gas day in progress and a day that was not updated after it ended are never the latest day', () => {
  const only = parse(answer(running()));
  assert.equal(only.status, 'stale', 'a running gas day carries only the flow so far: no completed day'); assert.deepEqual(only.observations, []); assert.equal(only.observedAt, null);
  assert.match(only.summary, /No completed gas day/);
  const csanad = row(parse(), 'csanadpalota-ro');
  assert.equal(csanad.providerId, 'csanadpalota-ro:2026-10-01'); assert.notEqual(csanad.physicalFlow, 55605000, 'not the 55.6 GWh of the running day');
  // The real day of 2026-09-13 (the provider's last update was at 03:03 on the 14th, before the day ended at 06:00): 204 GWh against about 245 normally.
  const partial = [record('ITP-10013', 'entry', '2026-09-13', 204230000, { lastUpdateDateTime: '2026-09-14T03:03:10+02:00' }), record('ITP-10013', 'exit', '2026-09-13', 0, { lastUpdateDateTime: '2026-09-14T03:03:10+02:00' }),
    record('ITP-10013', 'entry', '2026-09-12', 234729000, { lastUpdateDateTime: '2026-09-13T06:00:09+02:00' }), record('ITP-10013', 'exit', '2026-09-12', 0, { lastUpdateDateTime: '2026-09-13T06:00:09+02:00' })];
  const fallback = parseEntsog(answer(partial), { now: Date.parse('2026-09-14T20:00:00Z') });
  assert.equal(fallback.status, 'ok'); assert.deepEqual(ids(fallback), ['kiskundorozsma-2-rs:2026-09-12'], 'the previous complete day, not the partial one'); assert.equal(fallback.observations[0].physicalFlow, 234729000);
  assert.match(fallback.summary, /No completed gas day for: .*Csanadpalota/);
  const early = parseEntsog(answer(records(FINAL, '2026-10-01', { lastUpdateDateTime: '2026-10-02T05:59:59+02:00' })), { now });
  assert.equal(early.status, 'stale', 'updated one second before the day ended: not final'); assert.deepEqual(early.observations, []);
  const exact = parseEntsog(answer(records(FINAL, '2026-10-01', { lastUpdateDateTime: '2026-10-02T06:00:00+02:00' })), { now });
  assert.equal(exact.status, 'ok'); assert.equal(exact.observations.length, 7, 'updated at the end of the day is final');
  const oneDirection = records(FINAL, '2026-10-01'); oneDirection.find(r => r.pointKey === 'ITP-00032' && r.directionKey === 'exit').lastUpdateDateTime = '2026-10-02T03:00:00+02:00';
  assert.equal(row(parse(answer([...oneDirection, ...records(FINAL, '2026-09-30', { lastUpdateDateTime: '2026-10-01T07:01:00+02:00' })])), 'csanadpalota-ro').providerId, 'csanadpalota-ro:2026-09-30', 'every direction of a day must be final');
  const notEnded = parseEntsog(answer(records(FINAL, '2026-10-01', { lastUpdateDateTime: '2026-10-02T07:01:10+02:00' })), { now: Date.parse('2026-10-02T03:30:00Z') });
  assert.equal(notEnded.status, 'stale', 'a day that has not ended yet at our clock is not complete whatever the provider says');
});

test('several gas days: the latest completed day wins for every point', () => {
  const days = ['2026-09-29', '2026-09-30', '2026-10-01'].flatMap((day, i) => records(FINAL.map(([key, entry, exit]) => [key, entry === undefined ? undefined : entry && entry + (i - 2) * 1000, exit && exit + (i - 2) * 1000]), day));
  const result = parse(answer([...days.reverse(), ...running()]));
  assert.ok(result.observations.every(item => item.providerId.endsWith(':2026-10-01')));
  assert.equal(row(result, 'csanadpalota-ro').physicalFlow, 75954000, 'the newest completed day, not the first or the biggest');
  const older = parse(answer(records(FINAL, '2026-09-30', { lastUpdateDateTime: '2026-10-01T07:01:00+02:00' })));
  assert.ok(older.observations.every(item => item.providerId.endsWith(':2026-09-30')) && older.observations.length === 7);
  assert.equal(older.observedAt, '2026-09-30T04:00:00.000Z');
  const mixed = parse(answer([...records(FINAL.filter(([key]) => key !== 'ITP-00043'), '2026-10-01'), ...records(FINAL.filter(([key]) => key === 'ITP-00043'), '2026-09-30', { lastUpdateDateTime: '2026-10-01T07:01:00+02:00' })]));
  assert.equal(row(mixed, 'mosonmagyarovar-at').providerId, 'mosonmagyarovar-at:2026-09-30', 'each point has its own latest day'); assert.equal(mixed.observedAt, '2026-10-01T04:00:00.000Z');
});

test('zero flows, flows in both directions and a missing direction', () => {
  const zero = parse(answer(records([['ITP-00043', 0, 0]], '2026-10-01')));
  const quiet = zero.observations[0];
  assert.equal(quiet.physicalFlow, 0); assert.equal(quiet.unit, 'kWh/d'); assert.match(quiet.title, /no physical gas flow/); assert.equal(zero.status, 'ok', 'a zero flow is a real reading');
  assert.match(quiet.summary, /entry into Hungary 0 kWh\/d, exit from Hungary 0 kWh\/d/);
  const both = parse(answer(records([['ITP-00043', 1500000, 40000000]], '2026-10-01'))).observations[0];
  assert.equal(both.physicalFlow, 40000000); assert.match(both.title, /40\.00 GWh\/d out of Hungary/); assert.match(both.summary, /entry into Hungary 1500000 kWh\/d, exit from Hungary 40000000 kWh\/d/);
  const tie = parse(answer(records([['ITP-00043', 2000000, 2000000]], '2026-10-01'))).observations[0];
  assert.equal(tie.physicalFlow, 2000000); assert.match(tie.title, /into Hungary/, 'equal flows: the entry is shown');
  const small = parse(answer(records([['ITP-00043', 4000, 0]], '2026-10-01'))).observations[0];
  assert.match(small.title, /4000 kWh\/d into Hungary/, 'below 0.01 GWh the unit stays kWh/d'); assert.equal(small.physicalFlow, 4000);
  const decimals = parse(answer(records([['ITP-00032', 83767525.333333, 0]], '2026-10-01'))).observations[0];
  assert.equal(decimals.physicalFlow, 83767525.33); assert.match(decimals.title, /83\.77 GWh\/d/);
  const exitOnly = parse(answer(records([['ITP-00055', undefined, 3500000]], '2026-10-01'))).observations[0];
  assert.match(exitOnly.title, /3\.50 GWh\/d out of Hungary/);
});

test('units: kWh/d is shown in GWh, another unit is kept as given, mixed or hostile units are unreadable', () => {
  const mwh = parse(answer(records([['ITP-00032', 75954, 0]], '2026-10-01', { unit: 'MWh/d' }))).observations[0];
  assert.equal(mwh.unit, 'MWh/d'); assert.equal(mwh.physicalFlow, 75954); assert.match(mwh.title, /75954 MWh\/d into Hungary/); assert.match(mwh.summary, /entry into Hungary 75954 MWh\/d/);
  const mixed = [record('ITP-00032', 'entry', '2026-10-01', 75954000), record('ITP-00032', 'exit', '2026-10-01', 0, { unit: 'MWh/d' }), ...records([['ITP-10013', 247029000, 0]], '2026-10-01')];
  const result = parse(answer(mixed));
  assert.deepEqual(ids(result), ['kiskundorozsma-2-rs:2026-10-01'], 'two units for one point and day cannot be compared'); assert.match(result.summary, /could not be read/);
  for (const unit of ['<b>kWh</b>/d', `kWh/d${rtl}`, 'x'.repeat(100000), 'a b', '', 5, null, undefined, 'kWh/d\n']) {
    const bad = parse(answer([...records([['ITP-00032', 1, 0]], '2026-10-01', { unit }), ...records([['ITP-10013', 247029000, 0]], '2026-10-01')]));
    assert.deepEqual(ids(bad), ['kiskundorozsma-2-rs:2026-10-01'], String(unit).slice(0, 20)); assert.match(bad.summary, /could not be read/);
  }
  assert.equal(parse(answer(records([['ITP-00032', 1000000, 0]], '2026-10-01', { flowStatus: '<img src=x>' }))).observations[0].summary.includes('<'), false, 'a hostile flow status is dropped');
  assert.match(parse(answer(records([['ITP-00032', 1000000, 0]], '2026-10-01', { flowStatus: 'Confirmed' }))).observations[0].summary, /Confirmed/);
});

test('negative, null and non-numeric flows', () => {
  const good = records([['ITP-10013', 247029000, 0]], '2026-10-01');
  for (const value of [-1, -247029000, '75954000', 'x', NaN, Infinity, {}, [], true, 1e12]) {
    const result = parse(answer([...records([['ITP-00032', value, 0]], '2026-10-01'), ...good]));
    assert.deepEqual(ids(result), ['kiskundorozsma-2-rs:2026-10-01'], String(value)); assert.match(result.summary, /could not be read/);
  }
  const gap = parse(answer([...records([['ITP-00032', null, null]], '2026-10-01'), ...good]));
  assert.deepEqual(ids(gap), ['kiskundorozsma-2-rs:2026-10-01'], 'a null value is no reading'); assert.match(gap.summary, /No completed gas day for: .*Csanadpalota/); assert.doesNotMatch(gap.summary, /could not be read/);
  const half = parse(answer([...records([['ITP-00032', 75954000, null]], '2026-10-01'), ...good]));
  assert.deepEqual(ids(half), ['kiskundorozsma-2-rs:2026-10-01'], 'a day with a direction missing is no complete reading: "no flow" can not be claimed'); assert.match(half.summary, /No completed gas day for: .*Csanadpalota/);
  assert.equal(parse(answer(records([['ITP-00032', 0, 0]], '2026-10-01'))).observations[0].physicalFlow, 0);
});

test('other operators, indicators, periods and directions are ignored', () => {
  const other = [...records([['ITP-00032', 83772000, 0]], '2026-10-01', { operatorKey: 'RO-TSO-0001' }), ...records([['ITP-00032', 83772000, 0]], '2026-10-01', { indicator: 'Allocation' }), ...records([['ITP-00032', 83772000, 0]], '2026-10-01', { periodType: 'hour' }),
    record('ITP-00032', 'storage', '2026-10-01', 5), record('DIS-00196', 'exit', '2026-10-01', 123), record('ITP-99999', 'entry', '2026-10-01', 5), null, 'x', 7, [], {}];
  const result = parse(answer([...other, ...records([['ITP-10013', 247029000, 0]], '2026-10-01')]));
  assert.deepEqual(ids(result), ['kiskundorozsma-2-rs:2026-10-01']); assert.match(result.summary, /No completed gas day for: .*Csanadpalota/); assert.doesNotMatch(result.summary, /could not be read/, 'records of other series are not unreadable ones');
  assert.equal(row(parse(answer([...records([['ITP-00032', 1111, 0]], '2026-10-01', { operatorKey: 'RO-TSO-0001' }), ...records([['ITP-00032', 75954000, 0]], '2026-10-01')])), 'csanadpalota-ro').physicalFlow, 75954000, 'the Hungarian operator defines the direction');
});

test('points not found, an empty answer and a changed shape are errors, never a quiet feed', () => {
  for (const payload of [[], null, undefined, 'text', 42, {}, { operationaldata: 'x' }, { operationaldata: {} }, { data: LIVE.operationaldata }]) {
    const result = parseEntsog(payload, { now });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null); assert.doesNotMatch(result.error, /https?:/);
  }
  const empty = parse(answer([]));
  assert.equal(empty.status, 'error'); assert.match(empty.error, /no data for the Hungarian points/);
  const elsewhere = parse(answer([record('DIS-00196', 'exit', '2026-10-01', 5), record('ITP-99999', 'entry', '2026-10-01', 5)]));
  assert.equal(elsewhere.status, 'error', 'the expected points are not in the answer'); assert.match(elsewhere.error, /no data for the Hungarian points/);
  const rename = (list, from, to) => list.map(item => { const copy = { ...item, [to]: item[from] }; delete copy[from]; return copy; });
  for (const [from, to] of [['pointKey', 'pointkey'], ['directionKey', 'direction'], ['periodFrom', 'from'], ['periodTo', 'to'], ['lastUpdateDateTime', 'updated'], ['value', 'amount'], ['operatorKey', 'operator'], ['unit', 'units']]) {
    const result = parse(answer(rename(LIVE.operationaldata, from, to)));
    assert.equal(result.status, 'error', `${from} renamed`); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
  }
  const partial = parse(answer([...records(FINAL.slice(0, 3), '2026-10-01')]));
  assert.equal(partial.status, 'ok'); assert.equal(partial.observations.length, 3); assert.match(partial.summary, /No completed gas day for: .*Dravaszerdahely.*Balassagyarmat.*VIP Bereg.*Kiskundorozsma-2/);
  for (const bad of [{ periodFrom: 'yesterday' }, { periodFrom: undefined }, { periodTo: '2026-10-02' }, { periodTo: '2026-13-40T06:00:00+02:00' }, { lastUpdateDateTime: 'never' }, { lastUpdateDateTime: null }, { periodTo: '2026-10-05T06:00:00+02:00' }, { periodTo: '2026-10-01T10:00:00+02:00' }]) {
    const result = parse(answer([...records([['ITP-00032', 75954000, 0]], '2026-10-01', bad), ...records([['ITP-10013', 247029000, 0]], '2026-10-01')]));
    assert.deepEqual(ids(result), ['kiskundorozsma-2-rs:2026-10-01'], JSON.stringify(bad)); assert.match(result.summary, /could not be read/);
  }
});

test('the gas day start is a provider time in UTC, also across the clock change', () => {
  const winter = record('ITP-00032', 'entry', '2026-12-10', 80000000, { periodFrom: '2026-12-10T06:00:00+01:00', periodTo: '2026-12-11T06:00:00+01:00', lastUpdateDateTime: '2026-12-11T07:01:00+01:00' });
  const winterExit = { ...winter, directionKey: 'exit', value: 0 };
  const result = parseEntsog(answer([winter, winterExit]), { now: Date.parse('2026-12-11T12:00:00Z') });
  assert.equal(result.observations[0].observedAt, '2026-12-10T05:00:00.000Z'); assert.equal(result.observations[0].providerId, 'csanadpalota-ro:2026-12-10');
  // 2026-10-24 is 25 hours long (clock change back at 03:00 on the 25th), 2026-03-28 is 23 hours long.
  const longDay = record('ITP-00032', 'entry', '2026-10-24', 80000000, { periodFrom: '2026-10-24T06:00:00+02:00', periodTo: '2026-10-25T06:00:00+01:00', lastUpdateDateTime: '2026-10-25T07:01:00+01:00' });
  const dst = parseEntsog(answer([longDay, { ...longDay, directionKey: 'exit', value: 0 }]), { now: Date.parse('2026-10-26T12:00:00Z') });
  assert.equal(dst.observations[0].observedAt, '2026-10-24T04:00:00.000Z'); assert.equal(dst.observations[0].providerId, 'csanadpalota-ro:2026-10-24');
  const shortDay = record('ITP-00032', 'entry', '2026-03-28', 80000000, { periodFrom: '2026-03-28T06:00:00+01:00', periodTo: '2026-03-29T06:00:00+02:00', lastUpdateDateTime: '2026-03-29T07:01:00+02:00' });
  assert.equal(parseEntsog(answer([shortDay, { ...shortDay, directionKey: 'exit', value: 0 }]), { now: Date.parse('2026-03-30T12:00:00Z') }).observations[0].observedAt, '2026-03-28T05:00:00.000Z');
  const midnight = record('ITP-00032', 'entry', '2026-10-01', 80000000, { periodFrom: '2026-10-01T00:00:00+02:00', periodTo: '2026-10-02T00:00:00+02:00' });
  assert.equal(ids(parse(answer([midnight, { ...midnight, directionKey: 'exit', value: 0 }]))).length, 0, 'days that do not start at 06:00 Hungarian time are not gas days');
  const utc = record('ITP-00032', 'entry', '2026-10-01', 5000000, { periodFrom: '2026-10-01T04:00:00Z', periodTo: '2026-10-02T04:00:00Z', lastUpdateDateTime: '2026-10-02T05:01:00Z' });
  assert.equal(parse(answer([utc, { ...utc, directionKey: 'exit', value: 0 }])).observations[0].observedAt, '2026-10-01T04:00:00.000Z');
  assert.ok(Math.abs(Date.parse(parse().observations[0].observedAt) - now) < 72 * HOUR);
});

test('freshness: a gas day older than 72 hours is dropped, a future gas day is ignored', () => {
  assert.deepEqual(POLICIES['ENTSOG-HU'], { maxAgeMs: 72 * HOUR, observationMaxAgeMs: 72 * HOUR });
  const day = '2026-10-01', start = Date.parse('2026-10-01T04:00:00Z');
  for (const age of [24 * HOUR, 48 * HOUR, 71 * HOUR, 72 * HOUR]) {
    const result = parseEntsog(answer(records(FINAL, day)), { now: start + age });
    assert.equal(result.status, 'ok', `${age / HOUR} h`); assert.equal(result.observations.length, 7);
  }
  assert.equal(parseEntsog(answer(records(FINAL, day)), { now: start + 12 * HOUR }).status, 'stale', 'the gas day has not ended yet');
  for (const age of [72 * HOUR + 1000, 100 * HOUR, 30 * 24 * HOUR]) {
    const result = parseEntsog(answer(records(FINAL, day)), { now: start + age });
    assert.equal(result.status, 'stale', `${age / HOUR} h`); assert.deepEqual(result.observations, []); assert.equal(result.freshness.reason, 'expired-provider-time'); assert.equal(result.observedAt, '2026-10-01T04:00:00.000Z');
  }
  const future = parse(answer([...records(FINAL, '2026-10-01'), ...records(FINAL, '2026-10-04', { lastUpdateDateTime: '2026-10-06T07:01:00+02:00' })]));
  assert.ok(future.observations.every(item => item.providerId.endsWith(':2026-10-01')), 'a gas day that starts in the future is never the latest');
  const mixedAge = parse(answer([...records(FINAL.filter(([key]) => key !== 'ITP-00043'), '2026-10-01'), ...records(FINAL.filter(([key]) => key === 'ITP-00043'), '2026-09-27', { lastUpdateDateTime: '2026-09-28T07:01:00+02:00' })]));
  assert.equal(mixedAge.status, 'ok'); assert.equal(row(mixedAge, 'mosonmagyarovar-at'), undefined, 'one old point is dropped, the others stay');
});

test('a repeated record is read once: the newest update wins', () => {
  const first = record('ITP-00032', 'entry', '2026-10-01', 70000000, { lastUpdateDateTime: '2026-10-02T07:01:00+02:00' });
  const revised = record('ITP-00032', 'entry', '2026-10-01', 75954000, { lastUpdateDateTime: '2026-10-02T09:30:00+02:00' });
  const exit = record('ITP-00032', 'exit', '2026-10-01', 0);
  for (const list of [[first, revised, exit], [revised, first, exit], [exit, revised, first, revised]]) {
    const result = parse(answer(list));
    assert.equal(result.observations.length, 1); assert.equal(result.observations[0].physicalFlow, 75954000); assert.equal(result.observations[0].publishedAt, '2026-10-02T07:30:00.000Z');
  }
});

test('provider ids are fixed and stable across parses, sweeps and revised values', () => {
  const again = () => ids(parse(JSON.parse(JSON.stringify(LIVE))));
  assert.deepEqual(again(), ids(parse())); assert.deepEqual(ids(parse()), again());
  const revised = JSON.parse(JSON.stringify(LIVE)); revised.operationaldata.find(r => r.pointKey === 'ITP-00032' && r.directionKey === 'entry' && r.periodFrom.startsWith('2026-10-01')).value = 76000000;
  assert.deepEqual(ids(parse(revised)), ids(parse()), 'a revised value updates the same row');
  assert.deepEqual(ids(parse(answer([...LIVE.operationaldata].reverse()))), ids(parse()), 'the order of the answer does not matter');
  assert.deepEqual(parse().observations.map(item => item.url), parse(answer([...LIVE.operationaldata].reverse())).observations.map(item => item.url));
  assert.equal(new Set(ids(parse())).size, 7);
  assert.deepEqual(ids(parseEntsog(LIVE, { now: now + 3 * HOUR })), ids(parse()), 'a later sweep of the same day keeps the identities');
});

// Standing rule for every adapter: bound every input before any pattern or loop runs on it, and prove it fails fast.
test('hostile oversized answers are bounded in time and never stall the loop', () => {
  const started = Date.now();
  const huge = 'x'.repeat(1000000), tags = '<a '.repeat(300000);
  const hostile = [];
  for (const field of ['id', 'indicator', 'periodType', 'operatorKey', 'pointKey', 'pointLabel', 'directionKey', 'unit', 'periodFrom', 'periodTo', 'lastUpdateDateTime', 'flowStatus']) {
    for (const text of [huge, tags, '<'.repeat(1000000), `${bell}${zero}${rtl}`.repeat(300000)]) hostile.push(record('ITP-00032', 'entry', '2026-10-01', 1, { [field]: text }));
  }
  const good = records([['ITP-10013', 247029000, 0]], '2026-10-01');
  const result = parse(answer([...hostile, ...good]));
  assert.equal(result.status, 'ok'); assert.deepEqual(ids(result), ['kiskundorozsma-2-rs:2026-10-01']);
  assert.doesNotMatch(JSON.stringify(result), /[<>]/, 'hostile text never reaches the result'); assert.ok(JSON.stringify(result).length < 20000);
  const many = Array.from({ length: 1000000 }, () => null); many.push(...good);
  const flood = parse(answer(many));
  assert.equal(flood.status, 'error', 'only the first 400 entries are examined'); assert.equal(flood.truncatedRecords, 1000002 - 400);
  const examined = parse(answer([...Array.from({ length: 390 }, () => 'x'), ...records([['ITP-10013', 247029000, 0]], '2026-10-01')]));
  assert.equal(examined.status, 'ok'); assert.equal(examined.examinedRecords, 392);
  for (const error of ['http://'.repeat(150000), '<'.repeat(1000000), 'x'.repeat(1000000)]) {
    const failed = parseEntsog({ error }, { now });
    assert.equal(failed.status, 'error'); assert.ok(failed.error.length <= 300); assert.doesNotMatch(failed.error, /https?:/);
  }
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test('observations survive the server normalization with facts, the registered home and policy', () => {
  assert.deepEqual(FACT_FIELDS['ENTSOG-HU'], ['physicalFlow', 'unit']);
  assert.equal(HOME['ENTSOG-HU'], 'https://transparency.entsog.eu/');
  const [out] = normalizeLiveSources({ 'ENTSOG-HU': parse() }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://transparency.entsog.eu/'); assert.equal(out.observations.length, 7);
  const turk = out.observations.find(item => item.providerId === 'kiskundorozsma-2-rs:2026-10-01');
  assert.equal(turk.kind, 'energy'); assert.equal(turk.severity, 'info'); assert.deepEqual(turk.facts, [{ label: 'physicalFlow', value: 247029000 }, { label: 'unit', value: 'kWh/d' }]);
  assert.match(turk.url, /^https:\/\/transparency\.entsog\.eu\/api\/v1\/operationaldata\?/); assert.equal(turk.observedAt, '2026-10-01T04:00:00.000Z');
  assert.match(out.attribution, /^ENTSOG TP 02-10-2026/); assert.match(out.license, /ENTSOG/); assert.deepEqual(out.metrics, {});
  const events = buildEvents({ meta: { timestamp: iso(now) }, liveSources: [out] }, { now });
  assert.equal(events.length, 7); assert.ok(events.every(event => event.kind === 'energy'));
  assert.equal(events.find(event => event.title.startsWith('Csanadpalota')).severity, 'low', 'info rows are low severity events');
  const eventIds = payload => buildEvents({ meta: { timestamp: iso(now) }, liveSources: normalizeLiveSources({ 'ENTSOG-HU': parse(payload) }, now) }, { now }).map(event => event.id).sort();
  assert.deepEqual(eventIds(LIVE), eventIds(JSON.parse(JSON.stringify(LIVE))), 'event identities are stable across parses');
  const [stale] = normalizeLiveSources({ 'ENTSOG-HU': parseEntsog(LIVE, { now: now + 100 * HOUR }) }, now + 100 * HOUR);
  assert.equal(stale.status, 'stale'); assert.deepEqual(stale.observations, []);
});

test('briefing asks for the three last gas days of the seven Hungarian points in one bounded request', async () => {
  const seen = [];
  const result = await briefing({ now, fetcher: async (url, options) => { seen.push({ url: new URL(url), options }); return LIVE; } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 1); assert.equal(result.observations.length, 7);
  const { url, options } = seen[0];
  assert.equal(url.origin + url.pathname, 'https://transparency.entsog.eu/api/v1/operationaldata');
  assert.equal(url.searchParams.get('indicator'), 'Physical Flow'); assert.equal(url.searchParams.get('periodType'), 'day');
  assert.deepEqual(url.searchParams.get('pointKey').split(','), ['ITP-00011', 'ITP-00027', 'ITP-00032', 'ITP-00043', 'ITP-00055', 'ITP-10006', 'ITP-10013']);
  assert.equal(url.searchParams.get('operatorKey'), 'HU-TSO-0001'); assert.equal(url.searchParams.get('from'), '2026-09-29'); assert.equal(url.searchParams.get('to'), '2026-10-02'); assert.equal(url.searchParams.get('limit'), '400');
  assert.deepEqual({ ...options }, { timeout: 10000, retries: 0, maxBytes: 2 * MIB });
  const later = [];
  await briefing({ now: Date.parse('2026-11-03T01:00:00Z'), fetcher: async url => { later.push(new URL(url).searchParams.get('from') + '..' + new URL(url).searchParams.get('to')); return LIVE; } });
  assert.deepEqual(later, ['2026-10-31..2026-11-03']);
});

test('briefing degrades every transport failure to an error result without a URL and never throws', async () => {
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'HTTP 404', status: 404 }, { error: 'Request timed out after 10000ms' }, { error: 'Response exceeds 2097152 byte limit' },
    { error: 'connect failed for https://transparency.entsog.eu/api/v1/operationaldata?key=secret' }, { error: 'Invalid JSON response', status: 200 }, [], null, 'text', { message: 'Not Found' }];
  for (const payload of failures) {
    const result = await briefing({ now, fetcher: async () => payload });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:|transparency\.entsog|secret/i);
  }
  const thrown = await briefing({ now, fetcher: async () => { throw new Error('connect ECONNREFUSED https://transparency.entsog.eu/?key=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|transparency\.entsog|secret|ECONNREFUSED/i);
  assert.equal((await briefing({ now, fetcher: () => { throw new Error('sync https://x'); } })).status, 'error');
});

test('briefing over the real fetch helper degrades 404, 429, 503, timeout, an oversized body and invalid JSON to error results', async () => {
  const cases = {
    '404': () => reply({ message: 'Not Found' }, { status: 404 }),
    '429': () => reply('Too Many Requests', { status: 429 }),
    '503': () => reply('down', { status: 503 }),
    'timeout': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    'oversized': () => reply('x'.repeat(2 * MIB + 1)),
    'invalid json': () => reply('<html>not json</html>'),
    'network': () => Promise.reject(new TypeError('fetch failed')),
  };
  for (const [name, impl] of Object.entries(cases)) {
    const result = await withFetch(impl, () => briefing({ now, timeout: 25, useCache: false }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name);
    assert.doesNotMatch(result.error, /https?:|transparency\.entsog/i, name);
  }
  assert.match((await withFetch(cases.timeout, () => briefing({ now, timeout: 25, useCache: false }))).error, /timed out/i);
  assert.match((await withFetch(cases.oversized, () => briefing({ now, timeout: 1000, useCache: false }))).error, /exceeds|limit/i);
  const ok = await withFetch(async () => reply(LIVE), () => briefing({ now, useCache: false }));
  assert.equal(ok.status, 'ok'); assert.equal(ok.observations.length, 7);
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await briefing({ now, timeout, fetcher: async (url, options) => { seen.push(options.timeout); return LIVE; } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000);
});

test('the answer is cached for an hour (the data changes once a day); errors and empty answers are not cached', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return LIVE; };
  const first = await briefing({ now, fetcher, useCache: true }); assert.equal(calls, 1); assert.equal(first.attribution, 'ENTSOG TP 02-10-2026 https://transparency.entsog.eu/');
  const again = await briefing({ now: now + 59 * 60000, fetcher, useCache: true }); assert.equal(calls, 1, 'no request within the hour'); assert.equal(again.status, 'ok'); assert.equal(again.observations.length, 7);
  await briefing({ now: now + 61 * 60000, fetcher, useCache: true }); assert.equal(calls, 2, 'asked again after the hour');
  const midnight = Date.parse('2026-10-02T23:30:00Z'), shared = async () => LIVE;
  await briefing({ now: midnight, fetcher: shared, useCache: true });
  const cached = await briefing({ now: midnight + 40 * 60000, fetcher: shared, useCache: true });
  assert.equal(cached.attribution, 'ENTSOG TP 02-10-2026 https://transparency.entsog.eu/', 'the date of the download, not of the read');
  let failing = 0;
  const bad = async () => { failing++; return { error: 'HTTP 503', status: 503 }; };
  const later = now + 10 * HOUR;
  await briefing({ now: later, fetcher: bad, useCache: true }); await briefing({ now: later + 1000, fetcher: bad, useCache: true });
  assert.equal(failing, 2, 'an error is not cached');
  let empties = 0;
  const empty = async () => { empties++; return answer([]); };
  await briefing({ now: later + 2 * HOUR, fetcher: empty, useCache: true }); await briefing({ now: later + 2 * HOUR + 1000, fetcher: empty, useCache: true });
  assert.equal(empties, 2, 'an empty answer is not cached');
  let counted = 0;
  const plain = async () => { counted++; return LIVE; };
  await briefing({ now, fetcher: plain }); await briefing({ now, fetcher: plain }); assert.equal(counted, 2, 'an injected fetcher bypasses the cache unless asked');
});

test('history keeps one record per point and gas day: a new gas day adds rows, the same day again updates them', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-entsog-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = new HistoryStore(dir, { now: () => now + 30 * HOUR });
  const eventsFor = (payload, at) => buildEvents({ meta: { timestamp: iso(at) }, liveSources: normalizeLiveSources({ 'ENTSOG-HU': parseEntsog(payload, { now: at }) }, at) }, { now: at });
  const dayOne = eventsFor(LIVE, now), sameDayLater = eventsFor(LIVE, now + 3 * HOUR);
  const nextDay = eventsFor(answer(records(FINAL.map(([key, entry, exit]) => [key, entry && entry + 1000, exit && exit + 1000]), '2026-10-02', { lastUpdateDateTime: '2026-10-03T07:01:10+02:00' })), now + 24 * HOUR);
  assert.equal(dayOne.length, 7); assert.equal(nextDay.length, 7); assert.ok(nextDay.every(event => event.title.includes('2026-10-02')));
  assert.equal(new Set([...dayOne, ...nextDay].map(event => event.source.url)).size, 14, 'a link of its own for every point and day');
  assert.equal(new Set([...dayOne, ...nextDay].map(event => event.id)).size, 14);
  assert.deepEqual(history.add(dayOne), { added: 7, updated: 0, ignored: 0, total: 7 });
  assert.deepEqual(history.add(sameDayLater), { added: 0, updated: 7, ignored: 0, total: 7 }, 'the same gas day again updates the same records');
  assert.deepEqual(history.add(nextDay), { added: 7, updated: 0, ignored: 0, total: 14 }, 'the next gas day adds records');
  assert.equal(history.query({ source: 'ENTSOG-HU' }).total, 14);
  assert.deepEqual(sameDayLater.map(event => event.id).sort(), dayOne.map(event => event.id).sort());
});
