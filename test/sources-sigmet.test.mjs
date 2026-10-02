import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSigmet, briefing } from '../apis/sources/sigmet.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const now = Date.parse('2026-10-02T19:50:00Z');
const HOUR = 3600000, MINUTE = 60000;
const MIB = 1024 * 1024;
const iso = ms => new Date(ms).toISOString();
const secs = ms => Math.round(ms / 1000);
const rtl = String.fromCharCode(0x202e), zero = String.fromCharCode(0x200b), bell = String.fromCharCode(7), nul = String.fromCharCode(0);
const near = (actual, expected, message, eps = 0.0006) => assert.ok(Math.abs(actual - expected) <= eps, `${message || ''} ${actual} is not near ${expected}`);

// Real rows captured from https://aviationweather.gov/api/data/isigmet?format=json on 2026-10-02 (the unused rawSigmet bulletin text is left out, nothing else is edited).
// The provider returns a volcanic-ash or cyclone SIGMET twice (a series id and the same id with an F: the forecast area), repeats a bulletin that
// arrived on two circuits (MHTG G1), reuses the series id of one office for different messages (NZKL 29) and splits one message over several FIRs (EGRR 02).
const VA_SANTA_MARIA = {"icaoId":"MHTG","firId":"MHTG","firName":"MHCC CENTRAL AMERICAN","receiptTime":"2026-10-02T15:35:36.313Z","validTimeFrom":1790953200,"validTimeTo":1790974800,"seriesId":"1","hazard":"VA","qualifier":"SANTA MARIA","base":0,"top":14000,"geom":"AREA","coords":[{"lon":-91.383,"lat":15.033},{"lon":-91.267,"lat":14.933},{"lon":-91.533,"lat":14.733},{"lon":-91.55,"lat":14.75},{"lon":-91.383,"lat":15.033}],"dir":"NE","spd":"10","chng":null};
const VA_SANTA_MARIA_F = {"icaoId":"MHTG","firId":"MHTG","firName":"MHCC CENTRAL AMERICAN","receiptTime":"2026-10-02T15:35:36.319Z","validTimeFrom":1790953200,"validTimeTo":1790974800,"seriesId":"1F","hazard":"VA","qualifier":"SANTA MARIA","base":0,"top":14000,"geom":"AREA","coords":[{"lon":-91.45,"lat":15.133},{"lon":-91.3,"lat":15.05},{"lon":-91.533,"lat":14.733},{"lon":-91.567,"lat":14.733},{"lon":-91.45,"lat":15.133}],"dir":"NE","spd":"10","chng":null};
const VA_LEWOTOLOK = {"icaoId":"WAAA","firId":"WAAF","firName":"WAAF UJUNG PANDANG","receiptTime":"2026-10-02T15:30:35.691Z","validTimeFrom":1790955000,"validTimeTo":1790976600,"seriesId":"13","hazard":"VA","qualifier":"ERUPTION MT LEWOTOLOK","base":0,"top":6000,"geom":"AREA","coords":[{"lon":123.567,"lat":-8.25},{"lon":123.533,"lat":-8.333},{"lon":122.033,"lat":-8.217},{"lon":122.267,"lat":-7.65},{"lon":123.567,"lat":-8.25}],"dir":"W","spd":"15","chng":"NC"};
const TC_CHOI = {"icaoId":"PHFO","firId":"KZAK","firName":"OAKLAND OCEANIC","receiptTime":"2026-10-02T19:38:30.942Z","validTimeFrom":1790970000,"validTimeTo":1790991600,"seriesId":"TANGO 9","hazard":"TC","qualifier":"CHOI","base":null,"top":60000,"geom":"AREA","coords":[{"lon":143.75,"lat":20.25},{"lon":150,"lat":20.25},{"lon":149,"lat":16.25},{"lon":139.75,"lat":11.5},{"lon":138.25,"lat":15},{"lon":143.75,"lat":20.25}],"dir":"N","spd":"7","chng":"INTSF"};
const TC_CHOI_F = {"icaoId":"PHFO","firId":"KZAK","firName":"OAKLAND OCEANIC","receiptTime":"2026-10-02T19:38:30.960Z","validTimeFrom":1790970000,"validTimeTo":1790991600,"seriesId":"TANGO 9F","hazard":"TC","qualifier":"CHOI","base":null,"top":60000,"geom":"AREA","coords":[{"lon":143.75,"lat":20.25},{"lon":150,"lat":20.25},{"lon":149,"lat":16.25},{"lon":139.75,"lat":11.5},{"lon":138.25,"lat":15},{"lon":143.75,"lat":20.25}],"dir":"N","spd":"7","chng":"INTSF"};
const TS_BAKU = {"icaoId":"UBBB","firId":"UBBB","firName":"UBBA BAKU","receiptTime":"2026-10-02T15:11:33.046Z","validTimeFrom":1790953800,"validTimeTo":1790974800,"seriesId":"2","hazard":"TS","qualifier":"EMBD","base":null,"top":34000,"geom":"AREA","coords":[{"lon":45.417,"lat":39.2}],"dir":"NE","spd":"30","chng":"INTSF"};
const TS_G1 = {"icaoId":"MHTG","firId":"MHTG","firName":"MHCC CENTRAL AMERICAN","receiptTime":"2026-10-02T19:08:06.478Z","validTimeFrom":1790967600,"validTimeTo":1790982000,"seriesId":"G1","hazard":"TS","qualifier":"EMBD","base":null,"top":null,"geom":"AREA","coords":[{"lon":-83.617,"lat":9.05},{"lon":-82.833,"lat":12.917}],"dir":null,"spd":null,"chng":null};
const TS_G1_COPY = {"icaoId":"MHTG","firId":"MHTG","firName":"MHCC CENTRAL AMERICAN","receiptTime":"2026-10-02T19:08:06.480Z","validTimeFrom":1790967600,"validTimeTo":1790982000,"seriesId":"G1","hazard":"TS","qualifier":"EMBD","base":null,"top":null,"geom":"AREA","coords":[{"lon":-83.617,"lat":9.05},{"lon":-82.833,"lat":12.917}],"dir":null,"spd":null,"chng":null};
const TURB_NZ_A = {"icaoId":"NZKL","firId":"NZZC","firName":"NZZC NEW ZEALAND","receiptTime":"2026-10-02T16:05:13.474Z","validTimeFrom":1790957100,"validTimeTo":1790971500,"seriesId":"29","hazard":"TURB","qualifier":"SEV","base":24000,"top":35000,"geom":"AREA","coords":[{"lon":174.833,"lat":-33.667},{"lon":176.5,"lat":-34},{"lon":178.167,"lat":-35},{"lon":173,"lat":-34},{"lon":174.833,"lat":-33.667}],"dir":"-","spd":"0","chng":"WKN"};
const TURB_NZ_B = {"icaoId":"NZKL","firId":"NZZO","firName":"NZZO AUCKLAND OCEANIC","receiptTime":"2026-10-02T19:47:16.700Z","validTimeFrom":1790970420,"validTimeTo":1790984820,"seriesId":"29","hazard":"TURB","qualifier":"SEV","base":28000,"top":34000,"geom":"AREA","coords":[{"lon":-160.333,"lat":-32.333},{"lon":-161.333,"lat":-30.833},{"lon":-157,"lat":-29.167},{"lon":-157,"lat":-30},{"lon":-153.5,"lat":-30},{"lon":-160.333,"lat":-32.333}],"dir":"-","spd":"0","chng":"NC"};
const MTW_UK_A = {"icaoId":"EGRR","firId":"EGTT","firName":"EGTT LONDON","receiptTime":"2026-10-02T15:55:12.138Z","validTimeFrom":1790960400,"validTimeTo":1790974800,"seriesId":"02","hazard":"TURB","qualifier":"SEV MTW","base":6000,"top":16000,"geom":"AREA","coords":[{"lon":-1.05,"lat":53.95},{"lon":-3.017,"lat":52.517},{"lon":-4.233,"lat":52.483},{"lon":-4.817,"lat":55},{"lon":-1.6,"lat":55},{"lon":-1.05,"lat":53.95}],"dir":"-","spd":"0","chng":"WKN"};
const MTW_UK_B = {"icaoId":"EGRR","firId":"EGPX","firName":"EGPX SCOTTISH","receiptTime":"2026-10-02T15:56:26.889Z","validTimeFrom":1790960400,"validTimeTo":1790974800,"seriesId":"02","hazard":"TURB","qualifier":"SEV MTW","base":6000,"top":16000,"geom":"AREA","coords":[{"lon":-5.633,"lat":56.85},{"lon":-4.967,"lat":58.267},{"lon":-1.483,"lat":57.783},{"lon":-2.3,"lat":56.367},{"lon":-1.6,"lat":55},{"lon":-4.817,"lat":55},{"lon":-5.633,"lat":56.85}],"dir":"-","spd":"0","chng":"WKN"};
const ICE_NZ = {"icaoId":"NZKL","firId":"NZZC","firName":"NZZC NEW ZEALAND","receiptTime":"2026-10-02T17:49:00.318Z","validTimeFrom":1790963280,"validTimeTo":1790977680,"seriesId":"32","hazard":"ICE","qualifier":"SEV","base":7000,"top":20000,"geom":"AREA","coords":[{"lon":172.5,"lat":-42.667},{"lon":173.333,"lat":-41.5},{"lon":175.5,"lat":-42.167},{"lon":173.167,"lat":-43},{"lon":172.5,"lat":-42.667}],"dir":"NE","spd":"15","chng":"NC"};
const ICE_COMODORO = {"icaoId":"SAVC","firId":"SAVF","firName":"SAVF COMODORO RIVADAVIA","receiptTime":"2026-10-02T19:02:09.863Z","validTimeFrom":1790967840,"validTimeTo":1790982240,"seriesId":"E1","hazard":"ICE","qualifier":"SEV","base":null,"top":14000,"geom":"AREA","coords":[{"lon":-68.6,"lat":-51.617},{"lon":-61.65,"lat":-49.65},{"lon":-60.917,"lat":-52.767},{"lon":-68.733,"lat":-54.267},{"lon":-68.417,"lat":-52.567},{"lon":-69.083,"lat":-52.133},{"lon":-68.6,"lat":-51.617}],"dir":"-","spd":"0","chng":"NC"};
const AREAS_BRAZZAVILLE = {"icaoId":"FCBB","firId":"FCCC","firName":"FCCC BRAZZAVILLE","receiptTime":"2026-10-02T19:13:00.131Z","validTimeFrom":1790968800,"validTimeTo":1790983200,"seriesId":"N1","hazard":"TS","qualifier":"EMBD","base":null,"top":null,"geom":"AREAS","coords":[[{"lon":23,"lat":7.367},{"lon":25.317,"lat":7.25},{"lon":25.317,"lat":9.25},{"lon":23,"lat":9.367},{"lon":23,"lat":7.367}],[{"lon":18.133,"lat":7.933},{"lon":17.2,"lat":4.133},{"lon":15.2,"lat":4.133},{"lon":16.133,"lat":7.933},{"lon":18.133,"lat":7.933}],[{"lon":13.2,"lat":-1.917},{"lon":13.183,"lat":-3.067},{"lon":15.183,"lat":-3.067},{"lon":15.2,"lat":-1.917},{"lon":13.2,"lat":-1.917}]],"dir":null,"spd":null,"chng":null};
const LIVE = [VA_SANTA_MARIA, VA_SANTA_MARIA_F, VA_LEWOTOLOK, TC_CHOI, TC_CHOI_F, TS_BAKU, TS_G1, TS_G1_COPY, TURB_NZ_A, TURB_NZ_B, MTW_UK_A, MTW_UK_B, ICE_NZ, ICE_COMODORO, AREAS_BRAZZAVILLE];
const clone = value => JSON.parse(JSON.stringify(value));
const square = (lon, lat, size = 2) => [{ lon, lat }, { lon: lon + size, lat }, { lon: lon + size, lat: lat + size }, { lon, lat: lat + size }, { lon, lat }];
// A synthetic copy of a real row: a 2-degree square at 10 E, 20 N, valid from one hour before `now` for four hours; the series follows `n` unless given.
function sig(n, props = {}) {
  return { ...clone(TURB_NZ_A), icaoId: 'XXXX', firId: 'XXXX', firName: 'XXXX TESTLAND', receiptTime: iso(now - 50 * MINUTE), validTimeFrom: secs(now - HOUR), validTimeTo: secs(now + 3 * HOUR), seriesId: `S${n}`, hazard: 'TURB', qualifier: 'SEV', coords: square(10, 20), ...props };
}
// Most real rows above were received hours before `now`, and the feed itself expires three hours after its newest receipt. One fresh row of a made-up
// office (it ranks last and is filtered out again) keeps that rule out of the way where a test is about a single row.
const FILLER = sig(0, { icaoId: 'ZZZZ', hazard: 'SS', receiptTime: iso(now - MINUTE), validTimeFrom: secs(now - 23 * HOUR) });
const run = (payload, options) => { const result = parseSigmet([...payload, FILLER], { now, ...options }); return { ...result, observations: result.observations.filter(row => !row.providerId.startsWith('ZZZZ:')) }; };
const first = (payload, options) => run(payload, options).observations[0];
const ids = (payload, options) => run(payload, options).observations.map(row => row.providerId);
const shortId = row => row.providerId.split(':').slice(0, 3).join(':');
const withFetch = async (impl, run) => {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
};
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });

test('parse turns the live list into weather observations, one per SIGMET, ranked by hazard and then newest first', () => {
  const result = parseSigmet(LIVE, { now });
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'Aviation-SIGMET');
  assert.equal(result.observedAt, '2026-10-02T19:47:16.700Z', 'the feed time is the newest receipt time');
  // 15 rows in, 12 SIGMETs out: two forecast-area twins and one repeated bulletin are gone.
  assert.deepEqual(result.observations.map(shortId), ['WAAA:13:VA', 'MHTG:1:VA', 'NZKL:29:TURB', 'SAVC:E1:ICE', 'NZKL:32:ICE', 'EGRR:02:TURB', 'EGRR:02:TURB', 'NZKL:29:TURB', 'PHFO:TANGO_9:TC', 'FCBB:N1:TS', 'MHTG:G1:TS', 'UBBB:2:TS']);
  assert.deepEqual(result.observations.map(row => row.severity), ['high', 'high', 'moderate', 'moderate', 'moderate', 'moderate', 'moderate', 'moderate', 'low', 'low', 'low', 'low']);
  const row = result.observations[0];
  assert.equal(row.kind, 'weather'); assert.equal(row.source, 'Aviation-SIGMET');
  assert.match(row.providerId, /^WAAA:13:VA:1790955000:[0-9a-f]{8}$/);
  assert.equal(row.title, 'SIGMET Volcanic ash WAAF UJUNG PANDANG');
  assert.equal(row.observedAt, '2026-10-02T15:30:00.000Z', 'valid from'); assert.equal(row.validUntil, '2026-10-02T21:30:00.000Z', 'valid to'); assert.equal(row.publishedAt, '2026-10-02T15:30:35.691Z', 'received by the provider');
  near(row.lat, -8.068); near(row.lon, 122.676); assert.equal(row.locationMethod, 'polygon-centroid'); assert.equal(row.locationPrecision, 'approximate');
  assert.equal(row.severity, 'high'); assert.equal(row.hazard, 'Volcanic ash'); assert.equal(row.fir, 'WAAF UJUNG PANDANG'); assert.equal(row.region, 'WAAF UJUNG PANDANG');
  assert.match(row.summary, /^Volcanic ash SIGMET 13 \(ERUPTION MT LEWOTOLOK\) for WAAF UJUNG PANDANG, issued by WAAA\./);
  assert.match(row.summary, /Valid 2026-10-02 15:30 to 21:30 UTC/); assert.match(row.summary, /SFC to FL060/); assert.match(row.summary, /moving W at 15 kt/); assert.match(row.summary, /no change in intensity/);
  assert.match(row.summary, /bulletin text is the authority/i);
  assert.equal(new Set(result.observations.map(r => r.url)).size, 12, 'every row has its own link');
  assert.equal(new Set(result.observations.map(r => r.providerId)).size, 12);
  assert.match(result.summary, /SIGMET/); assert.match(result.summary, /not included|do not include/i); assert.match(result.summary, /centroid/i);
  assert.equal(result.examinedRecords, 15); assert.equal(result.rejectedObservations, 0);
});

test('licence, rights and attribution come from the NOAA/NWS terms', () => {
  const result = parseSigmet(LIVE, { now });
  assert.match(result.attribution, /Aviation Weather Center/); assert.match(result.attribution, /aviationweather\.gov/);
  assert.match(result.license, /public domain/i); assert.equal(result.licenseUrl, 'https://www.weather.gov/disclaimer');
  assert.match(result.rights, /public domain/i); assert.match(result.rights, /endorsement/i); assert.match(result.rights, /100 requests per minute/); assert.match(result.rights, /official bulletin/i);
  for (const failed of [parseSigmet(null, { now }), parseSigmet([], { now })]) assert.equal(failed.licenseUrl, 'https://www.weather.gov/disclaimer');
});

test('every hazard code has a label and the severity the brief gives it; an unknown plain code is low and shown as is', () => {
  const cases = [['VA', 'Volcanic ash', 'high'], ['TURB', 'Severe turbulence', 'moderate'], ['ICE', 'Severe icing', 'moderate'], ['TC', 'Tropical cyclone', 'low'], ['TS', 'Thunderstorm', 'low'],
    ['MTW', 'Mountain wave', 'low'], ['DS', 'Duststorm', 'low'], ['SS', 'Sandstorm', 'low'], ['RDOACT', 'RDOACT', 'low'], ['va', 'Volcanic ash', 'high']];
  for (const [code, label, severity] of cases) {
    const row = first([sig(1, { hazard: code })]);
    assert.equal(row.hazard, label, code); assert.equal(row.severity, severity, code); assert.equal(row.title, `SIGMET ${label} XXXX TESTLAND`);
    assert.match(row.summary, new RegExp(`^${label}`), code);
  }
  for (const hazard of [undefined, null, '', 5, {}, [], 'V A', 'T1', 'TS<b>', 'X'.repeat(9), 'TS ', '-', 'ÄÖ']) assert.equal(parseSigmet([sig(1, { hazard })], { now }).observations.length, 0, JSON.stringify(hazard));
});

test('138 SIGMETs are ranked volcanic ash first, then severe turbulence and icing, then the rest, newest first, and capped at 100', () => {
  const hazards = [...Array(10).fill('VA'), ...Array(20).fill('TURB'), ...Array(20).fill('ICE'), ...Array(8).fill('TC'), ...Array(80).fill('TS')];
  assert.equal(hazards.length, 138);
  // Distinct start times (1..138 minutes ago) in a scrambled order, so neither the order of the payload nor the id decides.
  const rows = hazards.map((hazard, i) => sig(i + 1, { hazard, validTimeFrom: secs(now - ((i * 37) % 138 + 1) * MINUTE) }));
  const result = parseSigmet(rows, { now });
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 100); assert.equal(result.truncatedRecords, 38); assert.equal(result.examinedRecords, 138);
  const hazardOf = row => row.hazard;
  assert.deepEqual(result.observations.slice(0, 10).map(hazardOf), Array(10).fill('Volcanic ash'));
  assert.deepEqual(result.observations.slice(10, 50).map(row => row.severity), Array(40).fill('moderate'));
  assert.deepEqual(result.observations.slice(50, 58).map(hazardOf), Array(8).fill('Tropical cyclone'), 'cyclones come before thunderstorms, so the cap cuts thunderstorms first');
  assert.ok(result.observations.slice(58).every(row => row.hazard === 'Thunderstorm')); assert.equal(result.observations.filter(row => row.hazard === 'Thunderstorm').length, 42);
  const tiers = [[0, 10], [10, 50], [50, 58], [58, 100]];
  for (const [from, to] of tiers) {
    const times = result.observations.slice(from, to).map(row => row.observedAt);
    assert.deepEqual(times, [...times].sort().reverse(), `newest first inside ${from}-${to}`);
  }
  const kept = new Set(result.observations.map(row => row.providerId)), tsRows = rows.filter(row => row.hazard === 'TS').map(row => ({ id: row.seriesId, from: row.validTimeFrom })).sort((a, b) => b.from - a.from);
  assert.equal(kept.size, 100);
  const cutOff = tsRows[41].from; assert.ok(result.observations.filter(row => row.hazard === 'Thunderstorm').every(row => Date.parse(row.observedAt) / 1000 >= cutOff), 'the 42 newest thunderstorms are the ones kept');
  const shuffled = parseSigmet([...rows].reverse(), { now });
  assert.deepEqual(shuffled.observations.map(row => row.providerId), result.observations.map(row => row.providerId), 'the order of the payload does not matter');
  const exactly = n => parseSigmet(rows.slice(0, n).map((row, i) => ({ ...row, hazard: 'TS', seriesId: `T${i}` })), { now });
  assert.equal(exactly(100).observations.length, 100); assert.equal(exactly(100).truncatedRecords, 0); assert.equal(exactly(101).truncatedRecords, 1);
  const huge = parseSigmet(Array.from({ length: 1200 }, (_, i) => sig(i + 1, { hazard: 'TS' })), { now });
  assert.equal(huge.examinedRecords, 1000); assert.equal(huge.observations.length, 100); assert.ok(huge.truncatedRecords >= 900);
});

test('expired, not yet started and day-old SIGMETs never take a slot of the 100-row cap', () => {
  const live = Array.from({ length: 100 }, (_, i) => sig(i + 1, { hazard: 'TS', validTimeFrom: secs(now - (i + 1) * MINUTE) }));
  // Volcanic ash ranks first, so each of these would be the top row if it counted.
  const unfit = [sig(201, { hazard: 'VA', validTimeTo: secs(now) }), sig(202, { hazard: 'VA', validTimeFrom: secs(now + 2 * HOUR) }), sig(203, { hazard: 'VA', validTimeFrom: secs(now - 25 * HOUR) })];
  const result = parseSigmet([...unfit, ...live], { now });
  assert.equal(result.observations.length, 100); assert.ok(result.observations.every(row => row.hazard === 'Thunderstorm'));
  assert.equal(result.truncatedRecords, 0, 'they are not counted as cut rows either');
});

test('volcanic ash outranks everything even when it is the oldest and starts last in the list', () => {
  const rows = [...Array.from({ length: 120 }, (_, i) => sig(i + 1, { hazard: 'TS', validTimeFrom: secs(now - (i + 1) * MINUTE) })), sig(500, { hazard: 'VA', validTimeFrom: secs(now - 5 * HOUR) })];
  const out = parseSigmet(rows, { now });
  assert.equal(out.observations[0].hazard, 'Volcanic ash'); assert.equal(out.observations.length, 100);
});

test('the forecast-area twin of a volcanic ash or cyclone SIGMET is not a second SIGMET', () => {
  assert.equal(ids([VA_SANTA_MARIA, VA_SANTA_MARIA_F]).length, 1); assert.equal(ids([VA_SANTA_MARIA_F, VA_SANTA_MARIA]).length, 1);
  const twin = first([VA_SANTA_MARIA_F, VA_SANTA_MARIA]);
  near(twin.lat, 14.892); near(twin.lon, -91.407); assert.match(twin.providerId, /^MHTG:1:VA:1790953200:/, 'the observed-area row is kept, the F twin dropped, in either order');
  assert.equal(ids([TC_CHOI, TC_CHOI_F]).length, 1); assert.match(ids([TC_CHOI_F, TC_CHOI])[0], /^PHFO:TANGO_9:TC:/);
  // An F row on its own is kept and identified as its series (so the id does not change if its twin shows up later).
  assert.match(ids([VA_SANTA_MARIA_F])[0], /^MHTG:1:VA:1790953200:/);
  // A twin has the same validity; a row that only looks like one (other validity, other hazard, other office) is a SIGMET of its own.
  const base = sig(1, { seriesId: '1', hazard: 'VA' });
  const forecast = { ...clone(base), seriesId: '1F', coords: square(30, 40) }; // the forecast area is another polygon
  assert.equal(parseSigmet([base, forecast], { now }).observations.length, 1);
  assert.equal(parseSigmet([base, { ...forecast, validTimeTo: base.validTimeTo + 60 }], { now }).observations.length, 2);
  assert.equal(parseSigmet([base, { ...forecast, hazard: 'TS' }], { now }).observations.length, 2);
  assert.equal(parseSigmet([base, { ...forecast, icaoId: 'YYYY' }], { now }).observations.length, 2);
  // A series that merely starts or contains an F is not a twin marker.
  for (const seriesId of ['F01', 'F', 'FF', 'A1F2', 'DELTA']) assert.ok(first([sig(1, { seriesId })]).providerId.startsWith(`XXXX:${seriesId.replace(/ /g, '_')}:`), seriesId);
  assert.ok(first([sig(1, { seriesId: 'OSCAR 39F' })]).providerId.startsWith('XXXX:OSCAR_39:'), 'the F after a digit marks the twin');
});

test('SIGMET identity is the office, series, hazard, start and area: repeats collapse, look-alikes stay apart, order does not matter', () => {
  assert.equal(ids([TS_G1, TS_G1_COPY]).length, 1, 'the same bulletin received on two circuits is listed once');
  const nz = run([TURB_NZ_A, TURB_NZ_B]).observations;
  assert.equal(nz.length, 2, 'one office reuses the series 29 for two messages'); assert.notEqual(nz[0].providerId, nz[1].providerId); assert.notEqual(nz[0].url, nz[1].url);
  assert.deepEqual(nz.map(row => row.fir).sort(), ['NZZC NEW ZEALAND', 'NZZO AUCKLAND OCEANIC']);
  const uk = run([MTW_UK_A, MTW_UK_B]).observations;
  assert.equal(uk.length, 2, 'one message split over two FIRs is two rows'); assert.notEqual(uk[0].providerId, uk[1].providerId); assert.notEqual(uk[0].url, uk[1].url);
  assert.equal(uk[0].providerId.split(':').slice(0, 4).join(':'), uk[1].providerId.split(':').slice(0, 4).join(':'), 'the office, series, hazard and start are identical: only the area tells them apart');
  assert.deepEqual(ids(LIVE), ids(LIVE)); assert.deepEqual(ids(clone(LIVE)), ids(LIVE)); assert.deepEqual(ids([...LIVE].reverse()), ids(LIVE));
  assert.deepEqual(parseSigmet([...LIVE].reverse(), { now }).observations.map(r => r.url), parseSigmet(LIVE, { now }).observations.map(r => r.url));
  assert.equal(new Set(ids(LIVE)).size, 12);
  // The id ignores key order, float noise below the provider precision and fields that are not part of the SIGMET.
  const base = sig(1, { coords: [{ lat: 20, lon: 10 }, { lat: 20, lon: 12 }, { lat: 22, lon: 12 }] });
  const noisy = { ...clone(base), coords: [{ lon: 10.0000001, lat: 19.9999999 }, { lon: 12, lat: 20 }, { lon: 12.0000002, lat: 22 }], receiptTime: iso(now - MINUTE), qualifier: 'OCNL', dir: 'N', spd: '5', chng: 'INTSF', base: 1000, top: 2000 };
  assert.deepEqual(ids([noisy]), ids([base]));
  assert.notDeepEqual(ids([sig(1, { coords: square(10, 20) })]), ids([sig(1, { coords: square(10, 21) })]), 'another area is another SIGMET');
  assert.notDeepEqual(ids([sig(1, { validTimeFrom: secs(now - HOUR) })]), ids([sig(1, { validTimeFrom: secs(now - 2 * HOUR) })]));
  assert.ok(first([sig(1, { icaoId: 'EGRR', seriesId: 'OSCAR 39' })]).providerId.startsWith('EGRR:OSCAR_39:TURB:'));
});

test('the row link is a real map page link made unique per SIGMET, and the centre is the SIGMET centroid', () => {
  const row = first([VA_SANTA_MARIA]);
  const url = new URL(row.url);
  assert.equal(url.origin + url.pathname, 'https://aviationweather.gov/gfa/'); assert.equal(url.searchParams.get('tab'), 'obs'); assert.equal(url.searchParams.get('layers'), 'sigmet');
  assert.equal(url.searchParams.get('zoom'), '4'); assert.equal(url.searchParams.get('sigmet'), row.providerId);
  const [lat, lon] = url.searchParams.get('center').split(',').map(Number); near(lat, row.lat); near(lon, row.lon);
  const unlocated = first([sig(1, { coords: [] })]);
  const bare = new URL(unlocated.url);
  assert.equal(bare.searchParams.get('layers'), 'sigmet'); assert.equal(bare.searchParams.has('center'), false); assert.equal(bare.searchParams.has('zoom'), false); assert.equal(bare.searchParams.get('sigmet'), unlocated.providerId);
  assert.ok(row.url.length < 300);
  for (const hostile of ['A B&c=d#frag', '../x?y=1']) { const odd = first([sig(1, { seriesId: hostile })]); assert.equal(odd, undefined, 'a series with markup or URL characters is dropped'); }
});

test('history keeps SIGMETs that share one page apart only because each row has its own link', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-sigmet-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = new HistoryStore(dir, { now: () => now + HOUR });
  const apartDir = mkdtempSync(join(tmpdir(), 'crucix-sigmet-')); t.after(() => rmSync(apartDir, { recursive: true, force: true }));
  const separate = new HistoryStore(apartDir, { now: () => now + HOUR });
  const eventsFor = (payload, at, edit = row => row) => {
    const raw = parseSigmet(payload, { now: at });
    return buildEvents({ meta: { timestamp: iso(at) }, liveSources: normalizeLiveSources({ 'Aviation-SIGMET': { ...raw, observations: raw.observations.map(edit) } }, at) }, { now: at });
  };
  // buildEvents identifies live rows by their provider id, so two SIGMETs on one page URL are two events ...
  const samePage = eventsFor([TURB_NZ_A, TURB_NZ_B], now, row => ({ ...row, url: 'https://aviationweather.gov/gfa/#sigmet' }));
  assert.equal(samePage.length, 2); assert.notEqual(samePage[0].id, samePage[1].id); assert.equal(samePage[0].source.url, samePage[1].source.url);
  // ... but HistoryStore merges records of one kind and one URL, so they would collapse into one stored record. That is why the adapter gives each row its own URL.
  assert.deepEqual(history.add(samePage), { added: 1, updated: 1, ignored: 0, total: 1 });
  const apart = eventsFor(LIVE, now);
  assert.equal(apart.length, 12); assert.equal(new Set(apart.map(event => event.id)).size, 12); assert.equal(new Set(apart.map(event => event.source.url)).size, 12);
  assert.ok(apart.every(event => event.kind === 'weather' && event.validUntil));
  assert.deepEqual(separate.add(apart), { added: 12, updated: 0, ignored: 0, total: 12 }, 'twelve SIGMETs are twelve stored records');
  assert.deepEqual(separate.add(eventsFor(LIVE, now + MINUTE)), { added: 0, updated: 12, ignored: 0, total: 12 }, 'the next sweep updates the same records and does not grow the history');
  assert.equal(separate.query({ source: 'Aviation-SIGMET', kind: 'weather' }).total, 12);
});

test('a SIGMET is current from its start until its valid-to time, not after', () => {
  const to = secs(now);
  const at = (validTimeTo, clock = now) => parseSigmet([sig(1, { validTimeTo })], { now: clock });
  assert.equal(at(to + 1).observations.length, 1, 'one second left'); assert.equal(at(to + 1).observations[0].validUntil, iso(now + 1000));
  assert.equal(at(to).observations.length, 0, 'it expires at valid-to, not a moment after'); assert.equal(at(to - 1).observations.length, 0);
  const expiring = [sig(1, { validTimeTo: secs(now + 10 * MINUTE) })];
  assert.equal(parseSigmet(expiring, { now: now + 10 * MINUTE - 1000 }).observations.length, 1); assert.equal(parseSigmet(expiring, { now: now + 10 * MINUTE }).observations.length, 0);
  assert.ok(parseSigmet(LIVE, { now }).observations.every(row => Date.parse(row.validUntil) > now));
  // Real data: TURB_NZ_A runs until 20:05, so it is listed at 20:04:59 and gone at 20:05:00 (a fresh filler row keeps the feed itself current).
  const filler = sig(99, { receiptTime: '2026-10-02T20:03:00.000Z', validTimeFrom: secs(Date.parse('2026-10-02T19:00:00Z')), validTimeTo: secs(Date.parse('2026-10-02T23:00:00Z')) });
  const listed = clock => parseSigmet([TURB_NZ_A, filler], { now: clock }).observations.some(row => row.providerId.startsWith('NZKL:29:TURB:1790957100'));
  assert.equal(listed(Date.parse('2026-10-02T20:04:59Z')), true); assert.equal(listed(Date.parse('2026-10-02T20:05:00Z')), false);
  for (const validTimeTo of [undefined, null, 'later', NaN, Infinity, -1, 0, to - 3600, secs(now - HOUR), 1790984820000, 4102444801, '1790984820']) assert.equal(at(validTimeTo).observations.length, 0, String(validTimeTo));
  const invalid = sig(1, { validTimeTo: sig(1).validTimeFrom }); assert.equal(parseSigmet([invalid], { now }).observations.length, 0, 'valid-to must come after valid-from');
});

test('a SIGMET that has not started, started a day ago or has no usable start is never current', () => {
  const from = validTimeFrom => parseSigmet([sig(1, { validTimeFrom, validTimeTo: secs(now + 3 * HOUR) })], { now });
  assert.equal(from(secs(now + 5 * MINUTE)).observations.length, 1, 'five minutes of clock skew are tolerated');
  assert.equal(from(secs(now + 5 * MINUTE) + 1).observations.length, 0, 'a SIGMET issued ahead of its start is not current yet');
  assert.equal(from(secs(now + 2 * HOUR)).observations.length, 0);
  assert.equal(from(secs(now - 24 * HOUR)).observations.length, 1, 'a day is the observation limit');
  assert.equal(from(secs(now - 24 * HOUR) - 1).observations.length, 0, 'a SIGMET that began more than a day ago is dropped even if its validity runs on');
  for (const validTimeFrom of [undefined, null, 'x', NaN, 0, -5, 1790953200000, 946684799, 4102444801]) assert.equal(from(validTimeFrom).observations.length, 0, String(validTimeFrom));
  // Real data: EGRR 02 is received at 15:55 for a start at 17:00.
  assert.equal(ids([MTW_UK_A], { now: Date.parse('2026-10-02T16:30:00Z') }).length, 0); assert.equal(ids([MTW_UK_A], { now: Date.parse('2026-10-02T17:00:00Z') }).length, 1);
  const future = parseSigmet([sig(1, { validTimeFrom: secs(now + 2 * HOUR), receiptTime: iso(now - MINUTE) })], { now });
  assert.equal(future.status, 'ok', 'a SIGMET not yet in force still shows the provider is current'); assert.deepEqual(future.observations, []);
});

test('the feed time is the newest receipt time (the start time when there is none) and expires after three hours', () => {
  const rows = [sig(1, { receiptTime: iso(now - 2 * HOUR) }), sig(2, { receiptTime: iso(now - 40 * MINUTE) }), sig(3, { receiptTime: iso(now - 4 * HOUR) })];
  assert.equal(parseSigmet(rows, { now }).observedAt, iso(now - 40 * MINUTE));
  for (const receiptTime of [undefined, null, 'soon', 5, iso(now + 2 * HOUR)]) {
    const result = parseSigmet([sig(1, { receiptTime, validTimeFrom: secs(now - 30 * MINUTE) })], { now });
    assert.equal(result.status, 'ok', String(receiptTime)); assert.equal(result.observedAt, iso(now - 30 * MINUTE), 'the start time stands in'); assert.equal('publishedAt' in result.observations[0], false);
  }
  for (const age of [2 * HOUR + 59 * MINUTE, 3 * HOUR]) assert.equal(parseSigmet([sig(1, { receiptTime: iso(now - age) })], { now }).status, 'ok', `${age / HOUR} h`);
  const stale = parseSigmet([sig(1, { receiptTime: iso(now - 3 * HOUR - 1000) })], { now });
  assert.equal(stale.status, 'stale'); assert.deepEqual(stale.observations, []); assert.equal(stale.freshness.reason, 'expired-provider-time');
  const empty = parseSigmet([], { now });
  assert.equal(empty.status, 'stale'); assert.equal(empty.observedAt, null); assert.deepEqual(empty.observations, []); assert.equal(empty.freshness.reason, 'unknown-provider-time');
  assert.equal(parseSigmet([sig(1, { receiptTime: iso(now + 4 * MINUTE) })], { now }).status, 'ok', 'a few minutes of clock skew are tolerated');
});

test('wrong shapes and provider errors never throw and give an error result', () => {
  for (const payload of [{}, null, undefined, 'sigmets', 42, true, { features: [] }, { data: [] }]) {
    const result = parseSigmet(payload, { now });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:/);
  }
  const failed = parseSigmet({ error: 'HTTP 503 from https://aviationweather.gov/api/data/isigmet?format=json' }, { now });
  assert.equal(failed.status, 'error'); assert.doesNotMatch(failed.error, /https?:|aviationweather/i);
  assert.equal(parseSigmet({ error: { code: 1 } }, { now }).status, 'error');
  // The provider's own error body (HTTP 400) keeps its short reason.
  const own = parseSigmet({ status: 'error', error: 'Invalid value for hazard' }, { now });
  assert.equal(own.status, 'error'); assert.match(own.error, /Invalid value for hazard/);
});

test('rows with a bad shape are skipped one by one and a valid sibling does not revive them', () => {
  const bad = [null, 'x', 7, [], {}, { hazard: 'VA' },
    sig(1, { icaoId: undefined }), sig(2, { icaoId: 'mhtg' }), sig(3, { icaoId: 'MHT' }), sig(4, { icaoId: 'MHTGX' }), sig(5, { icaoId: 'M HT' }), sig(6, { icaoId: 7 }),
    sig(7, { seriesId: undefined }), sig(8, { seriesId: '' }), sig(9, { seriesId: 7 }), sig(10, { seriesId: 'A'.repeat(21) }), sig(11, { seriesId: 'A<B>' }), sig(12, { seriesId: 'a/b' }), sig(13, { seriesId: { x: 1 } }),
    sig(14, { validTimeFrom: undefined }), sig(15, { validTimeTo: undefined }), sig(16, { validTimeFrom: '1790953200' }),
    sig(17, { hazard: 'XX<' })];
  const result = parseSigmet([...bad, TURB_NZ_B], { now });
  assert.equal(result.status, 'ok'); assert.deepEqual(result.observations.map(shortId), ['NZKL:29:TURB']);
});

test('the hazard group, series text, office and the optional fields are plain whitelisted values', () => {
  const full = first([sig(1, { hazard: 'ICE', qualifier: 'SEV', base: 7000, top: 20000, dir: 'NE', spd: '15', chng: 'INTSF' })]);
  assert.match(full.summary, /FL070 to FL200/); assert.match(full.summary, /moving NE at 15 kt/); assert.match(full.summary, /intensifying/);
  assert.match(first([sig(1, { base: 0, top: 14000 })]).summary, /SFC to FL140/); assert.match(first([sig(1, { base: null, top: 34000 })]).summary, /up to FL340/); assert.match(first([sig(1, { base: 24000, top: null })]).summary, /above FL240/);
  assert.match(first([sig(1, { chng: 'WKN' })]).summary, /weakening/); assert.match(first([sig(1, { chng: 'NC' })]).summary, /no change in intensity/);
  assert.match(first([sig(1, { dir: '-', spd: '0' })]).summary, /stationary/); assert.match(first([sig(1, { dir: 'SSW', spd: 25 })]).summary, /moving SSW at 25 kt/);
  for (const [props, pattern] of [[{ base: null, top: null }, /FL|SFC/], [{ base: -5, top: 'x' }, /FL|SFC/], [{ base: 9e9, top: Infinity }, /FL|SFC/], [{ dir: 'North', spd: '10' }, /moving/], [{ dir: 'NE', spd: '9999' }, /moving/], [{ dir: 'NE', spd: 'fast' }, /moving/],
    [{ dir: null, spd: null }, /moving|stationary/], [{ chng: 'EXPLODING' }, /intensity|weakening|intensifying/], [{ chng: null }, /intensity|weakening|intensifying/], [{ qualifier: null }, /\(\)/], [{ qualifier: '' }, /\(\)/]])
    assert.doesNotMatch(first([sig(1, props)]).summary, pattern, JSON.stringify(props));
  assert.ok(first([sig(1, { qualifier: 'OCNL' })]).summary.includes('(OCNL)'));
  assert.equal(first([sig(1, { firName: undefined, firId: 'EGTT' })]).fir, 'EGTT'); assert.equal(first([sig(1, { firName: '', firId: undefined })]).fir, 'XXXX', 'the office stands in when the FIR has no name');
  assert.equal(first([sig(1, { firName: null, firId: null })]).title, 'SIGMET Severe turbulence XXXX');
  assert.equal('unknownField' in first([{ ...sig(1), unknownField: 'x', rawSigmet: 'WS...', geom: 'AREA', coords: square(10, 20) }]), false);
});

test('hostile provider text is cleaned to inert plain text and capped', () => {
  const firName = `<img src=x onerror=alert(1)>${rtl}${bell}${nul}<script>alert(1)</script>Evil${zero}  Region\n\t of   "Mars" ${'A'.repeat(5000)}`;
  const row = first([sig(1, { firName, qualifier: `<b>ERUPTION</b> MT ${rtl}X${bell}${'B'.repeat(500)}`, firId: '<i>' })]);
  for (const value of [row.title, row.summary, row.fir, row.region, row.hazard]) {
    assert.doesNotMatch(value, /[<>]/); assert.doesNotMatch(value, /onerror=alert\(1\)>/); assert.doesNotMatch(value, new RegExp(`[${rtl}${zero}${bell}${nul}]`)); assert.doesNotMatch(value, /[\n\t]/);
  }
  assert.match(row.title, /^SIGMET Severe turbulence alert\(1\)Evil Region of "Mars" A+$/, 'tags are removed, the remaining text is inert'); assert.ok(row.fir.length <= 60, `fir length ${row.fir.length}`); assert.ok(row.title.length <= 100);
  assert.match(row.summary, /\(ERUPTION MT X B+\)/); assert.ok(row.summary.length <= 700, `summary length ${row.summary.length}`);
  for (const unclosed of ['FIR <img src=x onerror=alert(1)', 'FIR > <b', '<<img>>FIR', 'A<B>C<']) assert.doesNotMatch(first([sig(1, { firName: unclosed })]).title, /[<>]/, unclosed);
  assert.equal(first([sig(1, { firName: `<i></i>${rtl}   `, firId: 'LHCC' })]).fir, 'LHCC', 'a blank FIR name falls back to the FIR id');
  assert.equal(first([sig(1, { firName: `<i></i>`, firId: `<b>`, icaoId: 'LHBP' })]).fir, 'LHBP');
  for (const value of [undefined, null, 5, {}, []]) assert.equal(first([sig(1, { firName: value, firId: 'LHCC' })]).fir, 'LHCC');
});

// Standing rule for every adapter: cut the text to a fixed length first, then run regexes (a tag pattern that rescans from every '<' is quadratic).
// A flood of 30k is far above any field; a quadratic pattern needs seconds for it (a linear one milliseconds), so a regression fails the elapsed check instead of hanging CI.
test('hostile oversized provider text and geometry are handled in linear time', { timeout: 20000 }, () => {
  const started = Date.now();
  const N = 30000;
  const floods = { lt: '<'.repeat(N), openTag: '<a '.repeat(N), gt: '>'.repeat(N), nested: '<<>'.repeat(N), spaces: ' '.repeat(N) + 'FIR', words: 'A'.repeat(N), controls: (bell + zero).repeat(N / 2), http: 'http://'.repeat(N / 7), dots: '.'.repeat(N) };
  for (const [flood, value] of Object.entries(floods)) {
    for (const field of ['icaoId', 'seriesId', 'hazard', 'receiptTime', 'validTimeFrom', 'validTimeTo']) {
      const result = parseSigmet([sig(1, { [field]: value })], { now });
      assert.ok(result.observations.length <= 1, `${flood} ${field}`);
      if (field === 'receiptTime') assert.equal(result.observations.length, 1, 'an oversized receipt time only drops publishedAt');
      else assert.equal(result.observations.length, 0, `${flood} ${field}: an oversized value drops the row`);
    }
    const kept = first([sig(2, { firName: value, firId: value, qualifier: value, dir: value, spd: value, chng: value, base: value, top: value, rawSigmet: value })]);
    assert.ok(kept, flood); assert.doesNotMatch(kept.title, /[<>]/, flood); assert.ok(kept.title.length <= 100, `${flood} title length ${kept.title.length}`);
    assert.ok(kept.summary.length <= 700, flood); assert.ok(kept.fir.length <= 60, flood); assert.doesNotMatch(kept.summary, /moving|stationary|intensity|FL\d/, flood);
  }
  assert.equal(first([sig(1, { firName: floods.lt, firId: 'LHCC' })]).fir, 'LHCC'); assert.match(first([sig(1, { firName: floods.openTag })]).fir, /^a a a /); assert.equal(first([sig(1, { firName: floods.words })]).fir.length, 60);
  // A huge polygon: only the first points of a ring are read and the answer does not depend on the rest.
  const huge = Array.from({ length: 300000 }, (_, i) => ({ lon: 10 + (i % 2), lat: 20 + (i % 3) }));
  const big = first([sig(3, { coords: huge })]);
  assert.ok(big); near(big.lat, 21, 'finite centroid', 1); assert.ok(big.providerId.length < 100);
  const many = first([sig(4, { geom: 'AREAS', coords: Array.from({ length: 100000 }, () => square(10, 20)) })]);
  assert.ok(many); near(many.lat, 21);
  assert.equal(first([sig(5, { coords: floods.words })]).lat, undefined); assert.equal(first([sig(6, { coords: Array(N).fill(null) })]).lat, undefined);
  for (const error of ['http://'.repeat(N / 7), '<'.repeat(N), 'x'.repeat(N)]) {
    const failed = parseSigmet({ error }, { now });
    assert.equal(failed.status, 'error'); assert.ok(failed.error.length <= 300); assert.doesNotMatch(failed.error, /https?:/);
  }
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `took ${elapsed} ms`);
});

test('the SIGMET location is the area centroid, the one point of a point SIGMET, and is never invented', () => {
  const at = (coords, extra = {}) => first([sig(1, { coords, ...extra })]);
  // A 2 x 2 degree square: the centre, with or without the closing point.
  const squareRow = at(square(10, 20));
  assert.equal(squareRow.lat, 21); assert.equal(squareRow.lon, 11); assert.equal(squareRow.locationMethod, 'polygon-centroid'); assert.equal(squareRow.locationPrecision, 'approximate');
  assert.equal(at(square(10, 20).slice(0, 4)).lat, 21); assert.equal(at(square(10, 20).slice(0, 4)).lon, 11);
  // An L-shaped area: the area centroid (9.5/7), not the mean of the corner points (5/3).
  const ell = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]].map(([lon, lat]) => ({ lon, lat }));
  near(at(ell).lat, 1.357); near(at(ell).lon, 1.357);
  // The same square drawn the other way round has the same centre.
  assert.equal(at(square(10, 20).reverse()).lat, 21);
  // Across the antimeridian: the centre of 175 E to 179 W is 178 E, not the mean of 175 and -179.
  assert.deepEqual([at([{ lon: 175, lat: 10 }, { lon: -179, lat: 10 }, { lon: -179, lat: 14 }, { lon: 175, lat: 14 }, { lon: 175, lat: 10 }]).lat, at([{ lon: 175, lat: 10 }, { lon: -179, lat: 10 }, { lon: -179, lat: 14 }, { lon: 175, lat: 14 }]).lon], [12, 178]);
  assert.equal(at([{ lon: 178, lat: 10 }, { lon: -172, lat: 10 }, { lon: -172, lat: 14 }, { lon: 178, lat: 14 }]).lon, -177, 'the centre longitude wraps back into range');
  assert.equal(at([{ lon: -178, lat: 10 }, { lon: 172, lat: 10 }, { lon: 172, lat: 14 }, { lon: -178, lat: 14 }]).lon, 177);
  // Real rows.
  near(first([VA_SANTA_MARIA]).lat, 14.892); near(first([VA_SANTA_MARIA]).lon, -91.407); near(first([TC_CHOI]).lat, 16.54); near(first([TC_CHOI]).lon, 144.063);
  near(first([TURB_NZ_B]).lat, -30.737); near(first([TURB_NZ_B]).lon, -158.23); near(first([ICE_COMODORO]).lat, -52.058); near(first([ICE_COMODORO]).lon, -64.829);
  // A point SIGMET (UBBB 2) is the provider's own point; two points have a midpoint.
  const point = first([TS_BAKU]);
  assert.equal(point.lat, 39.2); assert.equal(point.lon, 45.417); assert.equal(point.locationMethod, 'provider'); assert.equal(point.locationPrecision, 'approximate');
  const line = first([TS_G1]);
  near(line.lat, 10.9835); near(line.lon, -83.225); assert.equal(line.locationMethod, 'polygon-centroid');
  // A first-ring centroid for several areas (FCBB N1 has three), a plain mean for a line and for collinear or repeated points.
  const areas = first([AREAS_BRAZZAVILLE]);
  near(areas.lat, 8.309); near(areas.lon, 24.159);
  assert.deepEqual([at([{ lon: 0, lat: 0 }, { lon: 2, lat: 2 }, { lon: 4, lat: 4 }]).lat, at([{ lon: 0, lat: 0 }, { lon: 2, lat: 2 }, { lon: 4, lat: 4 }]).lon], [2, 2], 'a flat polygon has no area: the mean of the points');
  assert.deepEqual([at([{ lon: 0, lat: 0 }, { lon: 2, lat: 2 }, { lon: 4, lat: 4 }, { lon: 0, lat: 0 }]).lat, at([{ lon: 0, lat: 0 }, { lon: 2, lat: 2 }, { lon: 4, lat: 4 }, { lon: 0, lat: 0 }]).lon], [2, 2], 'the closing point repeats the first and is not counted twice');
  assert.deepEqual([at([{ lon: 7, lat: 8 }, { lon: 7, lat: 8 }, { lon: 7, lat: 8 }]).lat, at([{ lon: 7, lat: 8 }, { lon: 7, lat: 8 }, { lon: 7, lat: 8 }]).lon], [8, 7]);
  const polyline = [[0, 0], [1, 0], [2, 0], [2, 10], [0, 10]].map(([lon, lat]) => ({ lon, lat }));
  assert.deepEqual([at(polyline, { geom: 'LINE' }).lat, at(polyline, { geom: 'LINE' }).lon], [4, 1], 'a LINE is not closed into an area: the mean of its points');
  assert.deepEqual([at(polyline).lat, at(polyline).lon], [5, 1], 'while the same points as an AREA enclose a rectangle');
  // Unusable points are dropped one by one; the rest still places the row.
  const mixed = at([{ lon: 10, lat: 20 }, { lon: 12, lat: 20 }, null, { lon: 'x', lat: 1 }, { lon: 500, lat: 1 }, { lon: 1, lat: 95 }, {}, { lon: 12, lat: 22 }, { lon: NaN, lat: 1 }, { lon: 10, lat: 22 }, 'p', []]);
  assert.equal(mixed.lat, 21); assert.equal(mixed.lon, 11);
  // A first ring that has no usable point leaves the next ring to place the row.
  const second = at([[{ lon: 'x', lat: 'y' }], square(10, 20)], { geom: 'AREAS' });
  assert.equal(second.lat, 21);
  // Degenerate or empty geometry: the row stays, without any location, and nothing throws.
  for (const coords of [[], null, undefined, 'x', 42, {}, [{}], [null], [[]], [[], []], [{ lon: 'a', lat: 'b' }], [{ lon: 200, lat: 0 }, { lon: 0, lat: 100 }], [[{ lon: 'x' }], [null]], Array(3).fill(null)]) {
    const kept = at(coords);
    assert.ok(kept, `the row is kept: ${JSON.stringify(coords)}`);
    for (const key of ['lat', 'lon', 'locationMethod', 'locationPrecision']) assert.equal(key in kept, false, `${key} for ${JSON.stringify(coords)}`);
    assert.match(kept.providerId, /^XXXX:S1:TURB:\d+:[0-9a-f]{8}$/);
  }
  const noGeom = { ...sig(1) }; delete noGeom.coords; delete noGeom.geom;
  assert.ok(first([noGeom]), 'a row without a coords field at all is still a SIGMET'); assert.equal('lat' in first([noGeom]), false);
  assert.equal(at(square(10, 20), { geom: undefined }).lat, 21); assert.equal(at(square(10, 20), { geom: 'WEIRD' }).lat, 21);
});

test('observations survive the server normalization with facts, location, validity and the registered home and policy', () => {
  assert.deepEqual(FACT_FIELDS['Aviation-SIGMET'], ['hazard', 'fir']);
  assert.equal(HOME['Aviation-SIGMET'], 'https://aviationweather.gov/');
  assert.deepEqual(POLICIES['Aviation-SIGMET'], { maxAgeMs: 3 * HOUR, observationMaxAgeMs: 24 * HOUR });
  const keys = Object.keys(POLICIES); assert.equal(keys.indexOf('Aviation-SIGMET'), keys.indexOf('Copernicus-EMS') + 1, 'registered in the fixed order, Copernicus-EMS then Aviation-SIGMET');
  const [out] = normalizeLiveSources({ 'Aviation-SIGMET': parseSigmet(LIVE, { now }) }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://aviationweather.gov/'); assert.equal(out.observations.length, 12);
  const row = out.observations[0];
  assert.equal(row.kind, 'weather'); assert.equal(row.severity, 'high'); near(row.lat, -8.068); near(row.lon, 122.676); assert.equal(row.locationMethod, 'polygon-centroid'); assert.equal(row.locationPrecision, 'approximate');
  assert.equal(row.region, 'WAAF UJUNG PANDANG'); assert.match(row.providerId, /^WAAA:13:VA:/); assert.equal(row.validUntil, '2026-10-02T21:30:00.000Z'); assert.equal(row.observedAt, '2026-10-02T15:30:00.000Z');
  assert.deepEqual(row.facts, [{ label: 'hazard', value: 'Volcanic ash' }, { label: 'fir', value: 'WAAF UJUNG PANDANG' }]);
  assert.match(out.license, /public domain/i); assert.match(out.attribution, /Aviation Weather Center/); assert.deepEqual(out.metrics, {});
  const events = buildEvents({ meta: { timestamp: iso(now) }, liveSources: [out] }, { now });
  assert.equal(events.length, 12); assert.ok(events.every(event => event.kind === 'weather' && event.validUntil));
  const top = events.find(event => event.title === 'SIGMET Volcanic ash WAAF UJUNG PANDANG');
  assert.equal(top.severity, 'high'); assert.equal(top.observedAt, '2026-10-02T15:30:00.000Z'); assert.equal(top.validUntil, '2026-10-02T21:30:00.000Z'); assert.equal(top.location.method, 'polygon-centroid'); assert.equal(top.location.label, 'WAAF UJUNG PANDANG');
  assert.equal(new URL(top.source.url).searchParams.get('layers'), 'sigmet');
  const eventIds = payload => buildEvents({ meta: { timestamp: iso(now) }, liveSources: normalizeLiveSources({ 'Aviation-SIGMET': parseSigmet(payload, { now }) }, now) }, { now }).map(event => event.id).sort();
  assert.deepEqual(eventIds(LIVE), eventIds(clone(LIVE))); assert.deepEqual(eventIds([...LIVE].reverse()), eventIds(LIVE), 'event identities are stable across parses'); assert.equal(new Set(eventIds(LIVE)).size, 12);
  // A SIGMET that expired in between is dropped again by the server normalization.
  const later = normalizeLiveSources({ 'Aviation-SIGMET': parseSigmet(LIVE, { now }) }, Date.parse('2026-10-02T20:06:00Z'))[0];
  assert.ok(!later.observations.some(r => r.providerId.startsWith('NZKL:29:TURB:1790957100')), 'the 20:05 SIGMET is gone at 20:06');
});

test('briefing asks for the international SIGMET list in one bounded request', async () => {
  const seen = [];
  const result = await briefing({ now, fetcher: async (url, options) => { seen.push({ url, options }); return clone(LIVE); } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://aviationweather.gov/api/data/isigmet?format=json');
  assert.deepEqual({ ...seen[0].options }, { timeout: 10000, retries: 0, maxBytes: 2 * MIB });
  assert.equal(result.observations.length, 12); assert.equal(result.observations[0].hazard, 'Volcanic ash');
});

test('an empty answer (HTTP 204) is a stale result and not an error or a crash', async () => {
  const viaFetcher = await briefing({ now, fetcher: async () => ({ error: 'Invalid JSON response', status: 204 }) });
  assert.equal(viaFetcher.status, 'stale'); assert.deepEqual(viaFetcher.observations, []); assert.equal(viaFetcher.observedAt, null); assert.equal('error' in viaFetcher, false);
  const viaFetch = await withFetch(async () => new Response(null, { status: 204 }), () => briefing({ now }));
  assert.equal(viaFetch.status, 'stale'); assert.deepEqual(viaFetch.observations, []);
  const emptyList = await briefing({ now, fetcher: async () => [] });
  assert.equal(emptyList.status, 'stale');
  const emptyOk = await withFetch(async () => reply(''), () => briefing({ now }));
  assert.equal(emptyOk.status, 'error', 'an empty body with HTTP 200 is not the no-SIGMETs answer');
  const notEmpty = await briefing({ now, fetcher: async () => ({ error: 'Invalid JSON response', status: 200 }) });
  assert.equal(notEmpty.status, 'error');
});

test('briefing degrades every transport failure to an error result without a URL and never throws', async () => {
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'HTTP 400', status: 400 }, { error: 'Request timed out after 10000ms' }, { error: 'Response exceeds 2097152 byte limit' },
    { error: 'connect failed for https://aviationweather.gov/api/data/isigmet?format=json&key=secret' }, {}, null, 'text', 5];
  for (const payload of failures) {
    const result = await briefing({ now, fetcher: async () => payload });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:|aviationweather|secret/i);
  }
  const thrown = await briefing({ now, fetcher: async () => { throw new Error('connect ECONNREFUSED https://aviationweather.gov/?key=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|aviationweather|secret|ECONNREFUSED/i);
  assert.equal((await briefing({ now, fetcher: () => { throw new Error('sync https://x'); } })).status, 'error');
});

test('briefing over the real fetch helper degrades 503, timeout, an oversized body and invalid JSON to error results', async () => {
  const cases = {
    '503': () => reply('down', { status: 503 }),
    '429': () => reply('slow down', { status: 429 }),
    'timeout': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    'oversized': () => reply('x'.repeat(2 * MIB + 1)),
    'invalid json': () => reply('<html>not json</html>'),
    'provider error': () => reply({ status: 'error', error: 'Invalid value for hazard' }, { status: 400 }),
    'network': () => Promise.reject(new TypeError('fetch failed')),
  };
  for (const [name, impl] of Object.entries(cases)) {
    const result = await withFetch(impl, () => briefing({ now, timeout: 25 }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name);
    assert.doesNotMatch(result.error, /https?:|aviationweather/i, name);
  }
  assert.match((await withFetch(cases.timeout, () => briefing({ now, timeout: 25 }))).error, /timed out/i);
  assert.match((await withFetch(cases.oversized, () => briefing({ now, timeout: 1000 }))).error, /exceeds|limit/i);
  const ok = await withFetch(async () => reply(LIVE), () => briefing({ now }));
  assert.equal(ok.status, 'ok'); assert.equal(ok.observations.length, 12); assert.equal(ok.observations[0].hazard, 'Volcanic ash');
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await briefing({ now, timeout, fetcher: async (url, options) => { seen.push(options.timeout); return LIVE; } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000);
});

test('briefing has no cache: every call asks the provider, an injected clock moves the validity check', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return LIVE; };
  const first = await briefing({ now, fetcher, useCache: true }), second = await briefing({ now: now + 20 * MINUTE, fetcher, useCache: true });
  assert.equal(requests, 2); assert.equal(first.observations.length, 12); assert.equal(second.observations.length, 11, 'the SIGMET that ended at 20:05 is gone twenty minutes later');
});
