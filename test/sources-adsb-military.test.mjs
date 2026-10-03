import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdsbMilitary, briefing, DEFAULT_THEATERS } from '../apis/sources/adsb-military.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import config from '../crucix.config.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The payload `now` of https://api.adsb.lol/v2/mil is the provider time in milliseconds (probed 2026-10-02: 1790974197000, about 10 s behind the probing machine).
const PAYLOAD_NOW = Date.parse('2026-10-02T20:49:57Z');
const now = PAYLOAD_NOW + 10000;
const MINUTE = 60000, HOUR = 3600000;
const MIB = 1024 * 1024;
const iso = ms => new Date(ms).toISOString();
const rtl = String.fromCharCode(0x202e), zero = String.fromCharCode(0x200b), bell = String.fromCharCode(7), nul = String.fromCharCode(0);
const near = (actual, expected, message, eps = 0.0006) => assert.ok(Math.abs(actual - expected) <= eps, `${message || ''} ${actual} is not near ${expected}`);
const clone = value => JSON.parse(JSON.stringify(value));

// Real aircraft captured from https://api.adsb.lol/v2/mil on 2026-10-02 (military-registered aircraft of the whole world, 239 in that answer), trimmed to the fields the adapter
// reads plus a few typical ones. Three of them fly over the Gulf, one over the Yellow Sea, one over Hungary; the rest are the awkward shapes the live list really contains.
const GULF_A = {"hex":"ae63be","type":"mlat","flight":"        ","t":"B762","dbFlags":1,"alt_baro":30025,"squawk":"3262","lat":24.564209,"lon":54.437932,"seen_pos":1.835,"seen":0.5};
const GULF_B = {"hex":"af8403","type":"mlat","flight":"        ","t":"B762","dbFlags":1,"alt_baro":29000,"gs":187,"track":60,"squawk":"3263","lat":24.710398,"lon":54.904557,"seen_pos":1.218,"seen":0.5};
const GULF_C = {"hex":"60183e","type":"adsb_icao","t":"CRJ7","dbFlags":1,"alt_baro":31000,"gs":465.7,"track":68.72,"category":"A3","lat":24.590475,"lon":61.356,"seen_pos":31.173,"seen":18.5};
const KOREA = {"hex":"a2fad1","type":"adsb_icao","flight":"@@@@@@@@","t":"GLEX","dbFlags":1,"alt_baro":40000,"gs":371.4,"track":262.26,"squawk":"5072","emergency":"none","category":"A3","lat":37.200452,"lon":125.065135,"seen_pos":0,"seen":0};
const HUNGARY = {"hex":"ae11f8","type":"mlat","flight":"SAM582  ","t":"B737","dbFlags":1,"alt_baro":33000,"gs":446,"track":123.05,"squawk":"1436","lat":47.854673,"lon":21.46893,"seen_pos":2.035,"seen":0.8};
const ALASKA = {"hex":"ae04fa","type":"adsb_icao","flight":"NORTH48 ","t":"BE20","dbFlags":1,"alt_baro":7300,"gs":247.4,"track":320.91,"squawk":"2220","emergency":"none","category":"A1","lat":68.638138,"lon":-165.186114,"seen_pos":0.905,"seen":0.7};
const TANKER = {"hex":"ae0427","type":"mlat","t":"K35R","dbFlags":1,"alt_baro":36000,"gs":227,"track":245,"squawk":"3254","lat":37.889678,"lon":-123.35869,"seen_pos":1.582,"seen":0.5};
const NO_POSITION = {"hex":"4b8213","type":"mode_s","flight":"TUAF780 ","t":"A400","dbFlags":1,"alt_baro":28125,"squawk":"2360","seen":2.5};
const LAST_POSITION = {"hex":"afead2","type":"mode_s","t":"B762","dbFlags":1,"squawk":"1364","lastPosition":{"lat":62.949437,"lon":-147.694441,"nic":0,"rc":0,"seen_pos":981.286},"seen":0.9};
const PARKED = {"hex":"ae57d4","type":"adsb_icao","flight":"C2010   ","t":"C30J","dbFlags":1,"alt_baro":"ground","gs":13.8,"category":"A3","lat":57.736416,"lon":-152.502085,"seen_pos":4.768,"seen":4.8};
const GROUND_NO_POSITION = {"hex":"c2b82d","type":"mode_s","t":"B412","dbFlags":1,"alt_baro":"ground","seen":32.1};
const OBSTACLE = {"hex":"adf991","type":"adsb_icao_nt","flight":"11111111","dbFlags":1,"alt_baro":"ground","gs":0,"squawk":"5555","category":"C3","seen":0.4};
const TOWER = {"hex":"400006","type":"adsb_icao_nt","flight":"TEST1234","t":"TWR","dbFlags":1,"category":"C0","seen":1.8};
const TAXIING = {"hex":"43c6f7","type":"adsb_icao","flight":"@@@@@@@@","t":"A332","dbFlags":1,"alt_baro":"ground","gs":0,"squawk":"2000","emergency":"none","category":"A5","lat":55.511856,"lon":-4.585783,"seen_pos":12.287,"seen":1.9};
const ODD_TYPE = {"hex":"ae68a3","type":"mode_s","t":"P8 ?","dbFlags":1,"alt_baro":21000,"squawk":"4410","seen":1.8};
const LIVE_AC = [ALASKA, GULF_A, NO_POSITION, KOREA, PARKED, LAST_POSITION, GULF_B, GROUND_NO_POSITION, OBSTACLE, HUNGARY, TOWER, TAXIING, GULF_C, ODD_TYPE, TANKER];
// Header keys of the real answer (ctime equals now, ptime is 0, msg is "No error").
const mil = (ac, props = {}) => ({ ac, msg: 'No error', now: PAYLOAD_NOW, total: ac.length, ctime: PAYLOAD_NOW, ptime: 0, ...props });
const LIVE = mil(LIVE_AC);
// The live /v2/sqk/7700, /7600 and /7500 lists were empty when probed (HTTP 200, total 0, 101 bytes); that exact empty shape is real.
const EMPTY_SQUAWK = { ac: [], msg: 'No error', now: PAYLOAD_NOW + 500, total: 0, ctime: PAYLOAD_NOW + 500, ptime: 0 };
const squawks = (ac, props = {}) => ({ ac, msg: 'No error', now: PAYLOAD_NOW + 500, total: ac.length, ctime: PAYLOAD_NOW + 500, ptime: 0, ...props });

// A synthetic aircraft shaped like the real rows: a C-30J over the given point, a new hex and callsign per `n`.
function plane(n, lat, lon, props = {}) {
  return { hex: (0xa00000 + n).toString(16), type: 'adsb_icao', flight: `TST${String(n).padStart(3, '0')} `, t: 'C30J', dbFlags: 1, alt_baro: 30000, gs: 400, track: 90, squawk: '1234', emergency: 'none', category: 'A3', lat, lon, seen_pos: 1, seen: 0.5, ...props };
}
// An emergency aircraft in the shape of the 7777 and 7000 answers (real rows) with an invented identity: hex abcdef-ish, callsign TESTxx, and the emergency code set.
function alarm(n, code, props = {}) {
  return { hex: (0xabc000 + n).toString(16), type: 'adsb_icao', flight: `TEST${String(n).padStart(2, '0')}  `, t: 'B738', dbFlags: 0, alt_baro: 24000, gs: 430, track: 270, squawk: code, emergency: { 7700: 'general', 7600: 'nordo', 7500: 'unlawful' }[code], category: 'A3', lat: 47.5 + n / 100, lon: 19 + n / 100, seen_pos: 2, seen: 0.5, ...props };
}
const run = (ac, quacks = [EMPTY_SQUAWK, EMPTY_SQUAWK, EMPTY_SQUAWK], options) => parseAdsbMilitary(mil(ac), quacks, { now, ...options });
const row = (result, id) => result.observations.find(r => r.providerId === id);
const theaterIds = result => result.observations.filter(r => r.providerId.startsWith('mil:')).map(r => r.providerId);
const withFetch = async (impl, body) => {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await body(); } finally { globalThis.fetch = original; }
};
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });
// Aircraft over the centre of each default theater.
const SPOT = { 'black-sea': [46, 33], 'east-med': [34, 28], 'middle-east-gulf': [25, 50], baltic: [58, 20], 'south-china-sea-taiwan': [15, 112], korea: [37, 127], 'central-europe': [47, 17] };
const crowd = (id, n, from = 0) => Array.from({ length: n }, (_, i) => plane(from + i + 1, SPOT[id][0] + (i % 7) / 100, SPOT[id][1] + (i % 5) / 100));
// Custom theaters for the border tests: a square, a second square that overlaps it, and a box across the antimeridian.
const BOXES = [{ id: 'one', label: 'One', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 }, { id: 'two', label: 'Two', latMin: 15, latMax: 25, lonMin: 35, lonMax: 45 }, { id: 'pacific', label: 'Pacific', latMin: -10, latMax: 10, lonMin: 170, lonMax: -170 }];
// A result without a single counted aircraft is an error (a stalled feed) and has no metric: the helper reads that as zero.
const total = result => result.metrics?.mil_aircraft_total ?? 0;
// One aircraft over Alaska, outside every theater: the list of a working feed is never empty, and the emergency tests need a good list around their rows.
const ELSEWHERE = [plane(777, 68.6, -165.2)];

test('parse turns the live military list into one aggregate row per theater and counts everything else only in the metric', () => {
  const result = parseAdsbMilitary(LIVE, [EMPTY_SQUAWK, EMPTY_SQUAWK, EMPTY_SQUAWK], { now });
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'ADSB-Military');
  assert.equal(result.observedAt, '2026-10-02T20:49:57.000Z', 'the provider time is the payload now');
  // 15 aircraft: 7 are airborne with a fresh position (3 Gulf, 1 Korea, 1 Hungary, 2 elsewhere); the 8 others have no position, are on the ground, or are not aircraft.
  assert.deepEqual(result.metrics, { mil_aircraft_total: 7 });
  assert.deepEqual(theaterIds(result), ['mil:middle-east-gulf', 'mil:korea', 'mil:central-europe'], 'largest first, then the configured order');
  assert.equal(result.observations.length, 3, 'one row per theater with aircraft, no row for any single aircraft');
  const gulf = row(result, 'mil:middle-east-gulf');
  assert.equal(gulf.kind, 'aviation'); assert.equal(gulf.source, 'ADSB-Military'); assert.equal(gulf.title, 'Middle East and Gulf: 3 military aircraft'); assert.equal(gulf.severity, 'info');
  assert.equal(gulf.observedAt, '2026-10-02T20:49:57.000Z'); assert.equal(gulf.aircraft, 3); assert.equal(gulf.types, 'B762 (2), CRJ7 (1)');
  assert.equal(gulf.lat, 25); assert.equal(gulf.lon, 48); assert.equal(gulf.locationMethod, 'theater-centre'); assert.equal(gulf.locationPrecision, 'approximate'); assert.equal(gulf.region, 'Middle East and Gulf');
  assert.match(gulf.summary, /3 military aircraft/); assert.match(gulf.summary, /B762 \(2\), CRJ7 \(1\)/); assert.doesNotMatch(gulf.summary, /Callsigns/, 'blank callsigns are not listed');
  assert.match(gulf.summary, /ADS-B/); assert.match(gulf.summary, /transponders? (are|is) (off|switched off)|not visible|invisible/i); assert.match(gulf.summary, /centre/);
  const korea = row(result, 'mil:korea');
  assert.equal(korea.title, 'Korean Peninsula: 1 military aircraft'); assert.equal(korea.types, 'GLEX (1)'); assert.doesNotMatch(korea.summary, /@/, 'the placeholder callsign is not listed');
  const hungary = row(result, 'mil:central-europe');
  assert.equal(hungary.title, 'Central Europe: 1 military aircraft'); assert.equal(hungary.types, 'B737 (1)'); assert.match(hungary.summary, /Callsigns: SAM582\b/);
  near(hungary.lat, 48.75); near(hungary.lon, 16);
  assert.equal(new Set(result.observations.map(r => r.url)).size, 3, 'every row has its own link');
  assert.equal(result.examinedRecords, 15); assert.equal(result.rejectedObservations, 0);
  assert.match(result.summary, /ADS-B/); assert.match(result.summary, /transponders? off|transponders switched off|ADS-B-visible/i);
  assert.ok(!('error' in result));
});

test('licence, rights and attribution come from the adsb.lol terms (ODbL) and survive every state', () => {
  for (const result of [parseAdsbMilitary(LIVE, [], { now }), parseAdsbMilitary(null, [], { now }), parseAdsbMilitary(mil([]), [], { now: now + HOUR }), parseAdsbMilitary(mil([plane(1, 37, 127)]), [], { now: now + HOUR })]) {
    assert.match(result.attribution, /adsb\.lol/); assert.match(result.attribution, /ODbL/);
    assert.match(result.license, /ODbL/); assert.equal(result.licenseUrl, 'https://opendatacommons.org/licenses/odbl/1-0/');
    assert.match(result.rights, /Open Database License/); assert.match(result.rights, /API key/); assert.match(result.rights, /production/i); assert.match(result.rights, /transponder/i);
    assert.match(result.summary, /ADS-B/);
  }
});

test('theater boxes include their edges, the first box in the configured order wins an overlap, and a box may cross the antimeridian', () => {
  const at = (lat, lon, extra = {}) => parseAdsbMilitary(mil([plane(1, lat, lon, extra)]), [], { now, theaters: BOXES });
  const alone = (lat, lon) => parseAdsbMilitary(mil([plane(1, lat, lon)]), [], { now, theaters: [BOXES[0]] });
  for (const [lat, lon] of [[10, 30], [20, 40], [10, 40], [20, 30], [15, 35]]) assert.deepEqual(theaterIds(alone(lat, lon)), ['mil:one'], `${lat}, ${lon} on the edge or inside`);
  for (const [lat, lon] of [[9.999999, 30], [20.000001, 40], [10, 29.999999], [15, 40.000001], [10, 40.000001], [9.999999, 40]]) assert.deepEqual(theaterIds(alone(lat, lon)), [], `${lat}, ${lon} just outside`);
  // The overlap of the two squares (15..20 N, 35..40 E): one aircraft counts once, in the first theater of the configuration.
  const both = parseAdsbMilitary(mil([plane(1, 17, 37), plane(2, 17, 37.5), plane(3, 22, 42)]), [], { now, theaters: BOXES });
  assert.deepEqual(both.observations.map(r => [r.providerId, r.aircraft]), [['mil:one', 2], ['mil:two', 1]]); assert.equal(total(both), 3, 'each aircraft is counted once in the metric as well');
  const reversed = parseAdsbMilitary(mil([plane(1, 17, 37), plane(2, 17, 37.5), plane(3, 22, 42)]), [], { now, theaters: [BOXES[1], BOXES[0]] });
  assert.deepEqual(reversed.observations.map(r => [r.providerId, r.aircraft]), [['mil:two', 3]], 'the configured order decides, and the first box takes the whole overlap');
  // Antimeridian: 170 E to 170 W.
  for (const lon of [170, 175, 180, -180, -175, -170]) assert.deepEqual(theaterIds(at(0, lon)), ['mil:pacific'], `${lon}`);
  for (const lon of [169.999, -169.999, 0, 100, -100]) assert.deepEqual(theaterIds(at(0, lon)), [], `${lon}`);
  const pacific = at(0, 175).observations[0];
  assert.equal(pacific.lat, 0); assert.equal(pacific.lon, 180, 'the centre of 170 E to 170 W is the antimeridian'); assert.equal(pacific.locationMethod, 'theater-centre');
  const wide = parseAdsbMilitary(mil([plane(1, 0, -175)]), [], { now, theaters: [{ id: 'wide', label: 'Wide', latMin: -5, latMax: 5, lonMin: 160, lonMax: -150 }] }).observations[0];
  assert.equal(wide.lon, -175, 'a centre east of 180 wraps back into range: (160 + 210) / 2 = 185 -> -175');
  // The link opens the globe on the centre, so the rows of different boxes differ.
  const url = new URL(row(parseAdsbMilitary(LIVE, [], { now }), 'mil:middle-east-gulf').url);
  assert.equal(url.origin + url.pathname, 'https://adsb.lol/'); assert.equal(url.searchParams.get('lat'), '25'); assert.equal(url.searchParams.get('lon'), '48'); assert.match(url.searchParams.get('zoom'), /^[2-9]$/);
  assert.equal(url.searchParams.get('theater'), 'middle-east-gulf', 'the id makes the link unique per row (the map ignores it)'); assert.deepEqual([...url.searchParams.keys()], ['lat', 'lon', 'zoom', 'theater']);
  assert.equal(new Set(parseAdsbMilitary(mil(Object.keys(SPOT).flatMap(id => crowd(id, 1, Object.keys(SPOT).indexOf(id) * 10))), [], { now }).observations.map(r => r.url)).size, 7, 'seven theaters, seven links');
});

test('positions that are not usable never count: null, NaN, infinite, text, out of range and the null island', () => {
  const bad = [{ lat: null, lon: 5 }, { lat: 5, lon: null }, { lat: undefined, lon: undefined }, { lat: NaN, lon: 35 }, { lat: 15, lon: NaN }, { lat: Infinity, lon: 35 }, { lat: 15, lon: -Infinity }, { lat: '15', lon: '35' }, { lat: [15], lon: 35 }, { lat: {}, lon: {} },
    { lat: 95, lon: 35 }, { lat: 15, lon: 200 }, { lat: -90.0001, lon: 35 }, { lat: 0, lon: 0 }];
  const result = parseAdsbMilitary(mil([...bad.map((props, i) => plane(i + 1, 15, 35, props)), plane(99, 15, 35)]), [], { now, theaters: BOXES });
  assert.equal(total(result), 1); assert.deepEqual(result.observations.map(r => r.aircraft), [1]);
  const noKeys = plane(50, 15, 35); delete noKeys.lat; delete noKeys.lon;
  assert.equal(total(parseAdsbMilitary(mil([noKeys]), [], { now })), 0);
  // The poles and the date line themselves are valid positions.
  assert.equal(total(parseAdsbMilitary(mil([plane(1, 90, 180), plane(2, -90, -180), plane(3, 0, 0.0001)]), [], { now })), 3);
});

test('only airborne aircraft with a fresh position count: stale, grounded, surface vehicles, beacons, duplicates and bad ids are left out', () => {
  const count = (...extra) => total(run([plane(1, 15, 35), ...extra]));
  assert.equal(count(), 1);
  // seen_pos: the age of the position in seconds (the live list has 0..53 s; a mode-S only aircraft has none).
  assert.equal(count(plane(2, 15, 35, { seen_pos: 120 })), 2, '120 s is the limit'); assert.equal(count(plane(2, 15, 35, { seen_pos: 120.001 })), 1, 'older than 120 s is stale');
  for (const seen_pos of [121, 981.286, -1, NaN, Infinity, null, undefined, '1', {}]) assert.equal(count(plane(2, 15, 35, { seen_pos })), 1, `seen_pos ${String(seen_pos)}`);
  assert.equal(count(plane(2, 15, 35, { seen_pos: 0 })), 2, 'a position from this very moment is fine');
  // Aircraft on the ground (the live list has parked and taxiing ones) are no air activity.
  assert.equal(count(plane(2, 15, 35, { alt_baro: 'ground' })), 1); assert.equal(count(PARKED), 1);
  for (const alt_baro of [undefined, null, 0, 150, -50, 'GROUND']) assert.equal(count(plane(2, 15, 35, { alt_baro })), 2, `altitude ${String(alt_baro)} does not say ground`);
  // ADS-B surface vehicles and obstacles (emitter categories C1..C5) and the tower beacons are not aircraft.
  for (const category of ['C1', 'C2', 'C3', 'C4', 'C5']) assert.equal(count(plane(2, 15, 35, { category })), 1, category);
  for (const category of ['C0', 'A0', 'A3', 'B1', 'D6', undefined, null, 'C6']) assert.equal(count(plane(2, 15, 35, { category })), 2, `category ${String(category)} stays`);
  for (const t of ['TWR', 'GND', 'twr', ' TWR ']) assert.equal(count(plane(2, 15, 35, { t })), 1, t);
  assert.equal(count({ ...OBSTACLE, lat: 15, lon: 35, seen_pos: 1 }), 1); assert.equal(count({ ...TOWER, lat: 15, lon: 35, seen_pos: 1, alt_baro: 20000 }), 1);
  // Identity: no usable hex, no aircraft; one aircraft listed twice is one aircraft.
  for (const hex of [undefined, null, '', 'abc', 'abcdefg', 'zzzzzz', 'ab cd1', 123456, '~abcdef']) assert.equal(count(plane(2, 15, 35, { hex })), 1, `hex ${String(hex)}`);
  assert.equal(count(plane(1, 15, 35)), 1, 'the same hex twice'); assert.equal(count(plane(1, 15, 35, { hex: 'A00001' })), 1, 'hex case does not make a second aircraft');
  assert.equal(count(null, 'x', 7, [], {}, undefined), 1, 'non-object entries are skipped');
  // The real list: 15 entries, 7 count.
  assert.equal(total(parseAdsbMilitary(LIVE, [], { now })), 7);
  for (const aircraft of [NO_POSITION, LAST_POSITION, PARKED, GROUND_NO_POSITION, OBSTACLE, TOWER, TAXIING, ODD_TYPE]) assert.equal(total(parseAdsbMilitary(mil([aircraft]), [], { now })), 0, aircraft.hex);
  assert.deepEqual(run([PARKED, OBSTACLE]).observations, [], 'a theater with only excluded aircraft has no row');
});

test('the types and callsigns of a theater are summarised: three most common types, up to five callsigns, in a fixed order', () => {
  const kinds = ['C30J', 'C30J', 'C30J', 'C30J', 'H60', 'H60', 'H60', 'P8', 'P8', 'K35R', 'E3TF', 'C17'];
  const planes = kinds.map((t, i) => plane(i + 1, 25 + i / 100, 50, { t }));
  const gulf = row(run([...planes].reverse()), 'mil:middle-east-gulf');
  assert.equal(gulf.aircraft, 12); assert.equal(gulf.types, 'C30J (4), H60 (3), P8 (2)', 'three most common, count first, then name for ties');
  assert.match(gulf.summary, /C30J \(4\), H60 \(3\), P8 \(2\)/); assert.doesNotMatch(gulf.summary, /K35R|E3TF|C17/);
  // Callsigns: unique, sorted, five of them, with the number left out.
  assert.match(gulf.summary, /Callsigns: TST001, TST002, TST003, TST004, TST005 and 7 more/);
  assert.equal(row(run(planes.slice(0, 5)), 'mil:middle-east-gulf').summary.match(/Callsigns: ([^.]*)\./)[1], 'TST001, TST002, TST003, TST004, TST005');
  assert.match(row(run([plane(1, 25, 50, { flight: 'AAA1' }), plane(2, 25, 50, { flight: 'AAA1    ' }), plane(3, 25, 50, { flight: 'bbb2' })]), 'mil:middle-east-gulf').summary, /Callsigns: AAA1, BBB2\./, 'trimmed, upper-cased, listed once');
  // Ties between types are broken by name, so the order never depends on the order of the list.
  const tie = ['ZZ9', 'AA1', 'MM5', 'BB2'].map((t, i) => plane(i + 1, 25, 50 + i / 100, { t }));
  assert.equal(row(run(tie), 'mil:middle-east-gulf').types, 'AA1 (1), BB2 (1), MM5 (1)'); assert.equal(row(run([...tie].reverse()), 'mil:middle-east-gulf').types, 'AA1 (1), BB2 (1), MM5 (1)');
  // Unknown or odd types are left out of the list, the aircraft still count.
  const odd = row(run([plane(1, 25, 50, { t: undefined }), plane(2, 25, 50, { t: 'P8 ?' }), plane(3, 25, 50, { t: 'X' }), plane(4, 25, 50, { t: 'LONGTYPE' }), plane(5, 25, 50, { t: 5 })]), 'mil:middle-east-gulf');
  assert.equal(odd.aircraft, 5); assert.equal('types' in odd, false); assert.doesNotMatch(odd.summary, /Types/i);
  assert.equal(row(run([plane(1, 25, 50, { t: 'c30j' })]), 'mil:middle-east-gulf').types, 'C30J (1)', 'type designators are upper-cased');
});

test('theater ids and links are stable across parses even when the aircraft change', () => {
  const first = parseAdsbMilitary(mil([...crowd('korea', 4), ...crowd('baltic', 2, 100)]), [], { now });
  const second = parseAdsbMilitary(mil([...crowd('korea', 9, 200), ...crowd('baltic', 5, 300)], { now: PAYLOAD_NOW + 15 * MINUTE }), [], { now: now + 15 * MINUTE });
  assert.deepEqual(first.observations.map(r => r.providerId).sort(), ['mil:baltic', 'mil:korea']); assert.deepEqual(second.observations.map(r => r.providerId).sort(), ['mil:baltic', 'mil:korea']);
  for (const id of ['mil:baltic', 'mil:korea']) { assert.equal(row(first, id).url, row(second, id).url); assert.ok(!/[0-9]{9,}/.test(id), 'no timestamp in the id'); }
  assert.notEqual(row(first, 'mil:korea').title, row(second, 'mil:korea').title, 'the title carries the count, the identity does not');
  assert.deepEqual(parseAdsbMilitary(clone(LIVE), [], { now }).observations, parseAdsbMilitary(LIVE, [], { now }).observations, 'the same payload gives the same rows');
  assert.deepEqual(parseAdsbMilitary(mil([...LIVE_AC].reverse()), [], { now }).observations.map(r => r.providerId), parseAdsbMilitary(LIVE, [], { now }).observations.map(r => r.providerId), 'and the order of the aircraft does not matter');
});

test('a theater is rated monitor only when it has at least 10 aircraft and at least three times as many as in the previous sweep', () => {
  const sweep = (counts, previous, minutes) => parseAdsbMilitary(mil(Object.entries(counts).flatMap(([id, n]) => crowd(id, n, minutes * 100 + Object.keys(SPOT).indexOf(id) * 20)), { now: PAYLOAD_NOW + minutes * MINUTE }), [], { now: now + minutes * MINUTE, previous });
  const severityAfter = (before, after, minutes = 15, id = 'korea') => { const memory = new Map(); sweep({ [id]: before }, memory, 0); return row(sweep({ [id]: after }, memory, minutes), `mil:${id}`).severity; };
  assert.equal(severityAfter(3, 10), 'monitor', '10 aircraft, 10 >= 3 x 3'); assert.equal(severityAfter(10, 30), 'monitor', 'exactly three times'); assert.equal(severityAfter(1, 12), 'monitor');
  assert.equal(severityAfter(4, 10), 'info', '10 < 3 x 4'); assert.equal(severityAfter(10, 29), 'info', 'less than three times'); assert.equal(severityAfter(10, 10), 'info'); assert.equal(severityAfter(3, 9), 'info', 'three times but under 10 aircraft');
  assert.equal(severityAfter(2, 8), 'info'); assert.equal(severityAfter(40, 12), 'info', 'a drop is no surge');
  // The previous sweep may have had no aircraft at all in that theater.
  const memory = new Map(); sweep({ baltic: 2 }, memory, 0);
  assert.equal(row(sweep({ baltic: 11 }, memory, 15), 'mil:baltic').severity, 'monitor');
  const quiet = new Map(); sweep({ korea: 3 }, quiet, 0);
  const comeback = sweep({ baltic: 10 }, quiet, 15);
  assert.equal(row(comeback, 'mil:baltic').severity, 'monitor', 'a theater that was empty in the previous sweep (zero is remembered) and now has 10 aircraft');
  // The surge row says what it is compared with; the ranking puts it first.
  const compared = new Map(); sweep({ korea: 12, baltic: 5 }, compared, 0);
  const next = sweep({ korea: 12, baltic: 15 }, compared, 15);
  assert.deepEqual(next.observations.map(r => [r.providerId, r.severity]), [['mil:baltic', 'monitor'], ['mil:korea', 'info']], 'a surge ranks before a larger quiet theater');
  assert.match(row(next, 'mil:baltic').summary, /Previous sweep \(15 min earlier\): 5 aircraft/); assert.match(row(next, 'mil:korea').summary, /Previous sweep \(15 min earlier\): 12 aircraft/);
  // No memory (first sweep, restart, or no memory given at all): never a surge.
  assert.equal(row(sweep({ korea: 30 }, new Map(), 0), 'mil:korea').severity, 'info'); assert.equal(row(sweep({ korea: 30 }, undefined, 0), 'mil:korea').severity, 'info');
  assert.doesNotMatch(row(sweep({ korea: 30 }, new Map(), 0), 'mil:korea').summary, /Previous sweep/);
  // The previous sweep must be older than this one and not too old: the same instant, an older instant and more than 6 hours give no comparison.
  const old = new Map(); sweep({ korea: 3 }, old, 0);
  assert.equal(row(sweep({ korea: 30 }, old, 6 * 60 + 1), 'mil:korea').severity, 'info', 'a comparison with a sweep more than six hours ago is not a surge');
  const olderSweep = new Map(); sweep({ korea: 3 }, olderSweep, 30);
  assert.equal(row(sweep({ korea: 30 }, olderSweep, 0), 'mil:korea').severity, 'info', 'a sweep from the future of this one is no baseline');
  const same = new Map(); sweep({ korea: 3 }, same, 0);
  assert.equal(row(sweep({ korea: 30 }, same, 0), 'mil:korea').severity, 'info', 'the same payload time is the same sweep');
  const sixHours = new Map(); sweep({ korea: 3 }, sixHours, 0);
  assert.equal(row(sweep({ korea: 30 }, sixHours, 6 * 60), 'mil:korea').severity, 'monitor', 'six hours is still comparable');
  // Re-reading the same payload does not move the base: the next sweep still compares with the first one.
  const stable = new Map(); sweep({ korea: 3 }, stable, 0); sweep({ korea: 9 }, stable, 0);
  assert.equal(row(sweep({ korea: 10 }, stable, 15), 'mil:korea').severity, 'monitor', 'the first reading of an instant stays the base');
  // A moved box is a different theater: no false surge when the configuration changes between sweeps.
  const boxes = [{ id: 'korea', label: 'Korea', latMin: 33, latMax: 43, lonMin: 124, lonMax: 131.5 }];
  const moved = new Map();
  parseAdsbMilitary(mil(crowd('korea', 2)), [], { now, previous: moved, theaters: boxes });
  assert.equal(row(parseAdsbMilitary(mil(crowd('korea', 12), { now: PAYLOAD_NOW + 15 * MINUTE }), [], { now: now + 15 * MINUTE, previous: moved, theaters: [{ ...boxes[0], latMax: 44 }] }), 'mil:korea').severity, 'info');
  assert.equal(row(parseAdsbMilitary(mil(crowd('korea', 12), { now: PAYLOAD_NOW + 15 * MINUTE }), [], { now: now + 15 * MINUTE, previous: moved, theaters: boxes }), 'mil:korea').severity, 'monitor', 'the same box does compare');
});

test('the previous-count memory is updated by good sweeps only, cleaned by age and bounded', () => {
  const memory = new Map();
  parseAdsbMilitary(mil(crowd('korea', 3)), [], { now, previous: memory });
  assert.equal(memory.size, 7, 'every theater is remembered, the empty ones with a zero');
  for (const value of memory.values()) assert.deepEqual(Object.keys(value).sort(), ['at', 'count']);
  // A stale, an erroring or a malformed answer leaves the memory alone.
  const before = JSON.stringify([...memory]);
  parseAdsbMilitary(mil(crowd('korea', 20), { now: PAYLOAD_NOW - HOUR }), [], { now, previous: memory });
  parseAdsbMilitary(mil(crowd('korea', 20), { now: undefined }), [], { now, previous: memory });
  parseAdsbMilitary(mil(crowd('korea', 20), { now: now + 20 * MINUTE }), [], { now, previous: memory }); // a feed from the future is stale, and newer than what is remembered
  parseAdsbMilitary({ error: 'HTTP 503' }, [], { now, previous: memory }); parseAdsbMilitary(null, [], { now, previous: memory }); parseAdsbMilitary({ ac: 'x', now: PAYLOAD_NOW }, [], { now, previous: memory });
  assert.equal(JSON.stringify([...memory]), before);
  // Entries older than six hours go, and the map never grows past 64 entries.
  const junk = new Map(); for (let i = 0; i < 200; i++) junk.set(`junk-${i}`, { count: 1, at: PAYLOAD_NOW - 7 * HOUR });
  parseAdsbMilitary(LIVE, [], { now, previous: junk });
  assert.equal(junk.size, 7, 'old junk is cleaned, the seven theaters are left');
  const fresh = new Map(); for (let i = 0; i < 200; i++) fresh.set(`junk-${i}`, { count: 1, at: PAYLOAD_NOW - MINUTE });
  parseAdsbMilitary(LIVE, [], { now, previous: fresh });
  assert.equal(fresh.size, 64); assert.ok([...fresh.keys()].filter(key => key.startsWith('junk')).length === 57, 'the oldest entries make room, the new ones stay');
  const next = parseAdsbMilitary(mil(crowd('korea', 12), { now: PAYLOAD_NOW + 15 * MINUTE }), [], { now: now + 15 * MINUTE, previous: fresh });
  assert.ok(row(next, 'mil:korea')); assert.match(row(next, 'mil:korea').summary, /Previous sweep \(15 min earlier\): 1 aircraft/);
  // No memory option and a memory without a usable shape never throw.
  assert.doesNotThrow(() => parseAdsbMilitary(LIVE, [], { now, previous: null })); assert.doesNotThrow(() => parseAdsbMilitary(LIVE, [], { now, previous: {} })); assert.doesNotThrow(() => parseAdsbMilitary(LIVE, [], { now, previous: new Map([['x', null], ['y', 5], ['korea', { count: 'a', at: 'b' }]]) }));
});

test('emergency squawks become one row each with the real position, 7700 and 7500 high, 7600 moderate', () => {
  const result = run(ELSEWHERE, [squawks([alarm(1, '7700')]), squawks([alarm(2, '7600')]), squawks([alarm(3, '7500')])]);
  assert.equal(result.status, 'ok'); assert.deepEqual(result.metrics, { mil_aircraft_total: 1 });
  assert.equal(result.observations.length, 3);
  const [a, b, c] = ['sqk:' + alarm(1, '7700').hex + ':7700', 'sqk:' + alarm(2, '7600').hex + ':7600', 'sqk:' + alarm(3, '7500').hex + ':7500'];
  assert.deepEqual(result.observations.map(r => r.providerId).sort(), [a, b, c].sort());
  const x = row(result, a), y = row(result, b), z = row(result, c);
  assert.equal(x.kind, 'aviation'); assert.equal(x.severity, 'high'); assert.equal(y.severity, 'moderate'); assert.equal(z.severity, 'high');
  assert.equal(x.title, 'Emergency squawk 7700: TEST01'); assert.equal(y.title, 'Emergency squawk 7600: TEST02'); assert.equal(z.title, 'Emergency squawk 7500: TEST03');
  near(x.lat, 47.51); near(x.lon, 19.01); assert.equal(x.locationMethod, 'provider'); assert.equal(x.locationPrecision, 'exact');
  assert.equal(x.observedAt, iso(PAYLOAD_NOW + 500 - 2000), 'the position time: the answer time minus seen_pos');
  assert.equal(x.url, `https://adsb.lol/?icao=${alarm(1, '7700').hex}`); assert.equal(new Set(result.observations.map(r => r.url)).size, 3);
  assert.match(x.summary, /general emergency/); assert.match(y.summary, /radio failure/); assert.match(z.summary, /unlawful interference/);
  assert.match(x.summary, /TEST01/); assert.match(x.summary, /B738/); assert.match(x.summary, /24000 ft/); assert.match(x.summary, /not a confirmed emergency|not confirm/i); assert.match(x.summary, /mistake|test/i);
  assert.deepEqual(result.observations.map(r => r.severity), ['high', 'high', 'moderate'], 'high first, then moderate');
  assert.equal('aircraft' in x, false); assert.equal('types' in x, false);
  // No callsign: the hex stands in; an aircraft on the ground with an emergency code is still an emergency.
  const bare = run(ELSEWHERE, [squawks([alarm(4, '7700', { flight: '        ', alt_baro: 'ground' })]), EMPTY_SQUAWK, EMPTY_SQUAWK]).observations[0];
  assert.equal(bare.title, `Emergency squawk 7700: ${alarm(4, '7700').hex}`); assert.match(bare.summary, /on the ground/);
  // The code comes from the aircraft, whichever list it arrived in.
  assert.equal(run(ELSEWHERE, [squawks([alarm(5, '7500')]), EMPTY_SQUAWK, EMPTY_SQUAWK]).observations[0].providerId, `sqk:${alarm(5, '7500').hex}:7500`);
});

test('emergency rows are ranked by severity and then newest first, capped at 20, and duplicates by hex and code collapse', () => {
  const old7700 = Array.from({ length: 5 }, (_, i) => alarm(i + 1, '7700', { seen_pos: 100 - i }));
  const mid7500 = Array.from({ length: 5 }, (_, i) => alarm(i + 11, '7500', { seen_pos: 60 - i }));
  const new7600 = Array.from({ length: 15 }, (_, i) => alarm(i + 21, '7600', { seen_pos: 1 + i }));
  const result = run(ELSEWHERE, [squawks(old7700), squawks(new7600), squawks(mid7500)]);
  assert.equal(result.observations.length, 20, '25 emergency aircraft, 20 rows'); assert.equal(result.truncatedRecords, 5);
  assert.deepEqual(result.observations.slice(0, 10).map(r => r.severity), Array(10).fill('high'), 'the serious codes are never cut for newer radio failures');
  assert.deepEqual(result.observations.slice(10).map(r => r.severity), Array(10).fill('moderate'));
  const times = (from, to) => result.observations.slice(from, to).map(r => r.observedAt);
  assert.deepEqual(times(0, 10), [...times(0, 10)].sort().reverse(), 'newest first inside a severity: the 7500 rows (56-60 s old) before the 7700 rows (96-100 s)'); assert.deepEqual(times(10, 20), [...times(10, 20)].sort().reverse());
  assert.deepEqual(result.observations.slice(0, 5).map(r => r.providerId.slice(-4)), Array(5).fill('7500'));
  assert.equal(result.observations[10].providerId, `sqk:${alarm(21, '7600').hex}:7600`, 'the newest radio failure first');
  assert.equal(result.observations.length, new Set(result.observations.map(r => r.providerId)).size);
  assert.deepEqual(run(ELSEWHERE, [squawks(new7600), squawks(old7700), squawks(mid7500)]).observations.map(r => r.providerId), result.observations.map(r => r.providerId), 'the order of the lists does not matter');
  // The same aircraft twice with the same code is one row, the fresher position wins; two codes are two rows.
  const dup = run(ELSEWHERE, [squawks([alarm(1, '7700', { seen_pos: 50, lat: 40 }), alarm(1, '7700', { seen_pos: 5, lat: 41 })]), squawks([alarm(1, '7700', { seen_pos: 30, lat: 42 }), alarm(1, '7600', { seen_pos: 30 })]), EMPTY_SQUAWK]);
  assert.equal(dup.observations.length, 2); const kept = dup.observations.find(r => r.providerId.endsWith(':7700'));
  assert.equal(kept.lat, 41); assert.equal(kept.observedAt, iso(PAYLOAD_NOW + 500 - 5000));
  assert.equal(dup.observations.find(r => r.providerId.endsWith(':7600')).providerId, `sqk:${alarm(1, '7600').hex}:7600`);
  assert.deepEqual(run(ELSEWHERE, [squawks([alarm(1, '7700', { seen_pos: 5 }), alarm(1, '7700', { seen_pos: 50 })]), EMPTY_SQUAWK, EMPTY_SQUAWK]).observations.map(r => r.observedAt), [iso(PAYLOAD_NOW + 500 - 5000)], 'the fresher one wins in either order');
});

test('squawk aircraft that are not usable emergencies are skipped one by one', () => {
  const good = alarm(1, '7700');
  const skipped = [alarm(2, '1200'), alarm(3, '7777'), alarm(4, '7701'), alarm(5, '7700 '), alarm(6, 7700), alarm(7, undefined), alarm(8, '7700', { hex: undefined }), alarm(9, '7700', { hex: 'xyz' }), alarm(10, '7700', { lat: undefined }), alarm(11, '7700', { lon: NaN }),
    alarm(12, '7700', { lat: 0, lon: 0 }), alarm(13, '7700', { seen_pos: 121 }), alarm(14, '7700', { seen_pos: undefined }), alarm(15, '7700', { category: 'C2' }), alarm(16, '7700', { t: 'TWR' }), null, 'x', 7, [], {}, alarm(17, '__proto__'), alarm(18, 'constructor')];
  const result = run(ELSEWHERE, [squawks([...skipped, good]), EMPTY_SQUAWK, EMPTY_SQUAWK]);
  assert.deepEqual(result.observations.map(r => r.providerId), [`sqk:${good.hex}:7700`]);
  assert.equal(run(ELSEWHERE, [squawks([alarm(1, '7700', { seen_pos: 120 })]), EMPTY_SQUAWK, EMPTY_SQUAWK]).observations.length, 1, '120 s old is the limit, as for the aircraft counts');
  // Emergency aircraft are not part of the military count and do not need to be military.
  assert.equal(total(run(ELSEWHERE, [squawks([alarm(1, '7700')]), EMPTY_SQUAWK, EMPTY_SQUAWK])), 1, 'only the aircraft of the military list');
  // A position time that is in the future of the collection time, or older than the 25 minute limit, never becomes a row.
  assert.equal(run(ELSEWHERE, [squawks([alarm(1, '7700')], { now: PAYLOAD_NOW + 30 * MINUTE }), EMPTY_SQUAWK, EMPTY_SQUAWK]).observations.length, 0, 'a position from 30 minutes in the future');
  assert.equal(run(ELSEWHERE, [squawks([alarm(1, '7700')], { now: PAYLOAD_NOW - 30 * MINUTE }), EMPTY_SQUAWK, EMPTY_SQUAWK]).observations.length, 0, 'a position from 30 minutes ago');
  assert.equal(run(ELSEWHERE, [squawks([alarm(1, '7700')], { now: PAYLOAD_NOW - 20 * MINUTE }), EMPTY_SQUAWK, EMPTY_SQUAWK]).observations.length, 1, 'but one from 20 minutes ago is inside the 25 minute limit');
});

test('what the result holds is theaters with aircraft plus emergency rows and never a row for an ordinary military aircraft', () => {
  const ordinary = [...crowd('black-sea', 6), ...crowd('baltic', 40, 100), ...crowd('korea', 2, 200), ...Array.from({ length: 50 }, (_, i) => plane(300 + i, 40 + i / 10, -100))];
  const emergencies = [squawks([alarm(1, '7700'), alarm(2, '7600')]), EMPTY_SQUAWK, squawks([alarm(3, '7500')])];
  const result = run(ordinary, emergencies);
  const ids = result.observations.map(r => r.providerId);
  assert.equal(result.observations.length, 3 + 3, 'three theaters plus three emergency rows');
  assert.equal(ids.filter(id => id.startsWith('mil:')).length, 3); assert.equal(ids.filter(id => id.startsWith('sqk:')).length, 3);
  assert.equal(total(result), 98, 'the metric counts the aircraft in the theaters and outside'); assert.equal(result.observations.filter(r => r.providerId.startsWith('mil:')).reduce((sum, r) => sum + r.aircraft, 0), 48);
  for (const aircraft of ordinary) assert.ok(!result.observations.some(r => r.title.includes(aircraft.hex) || r.providerId.includes(aircraft.hex)), `no row for ${aircraft.hex}`);
  for (const observation of result.observations) assert.ok(!('hex' in observation) && !('callsign' in observation) && !('alt_baro' in observation), 'only whitelisted fields');
  // A theater row never carries an aircraft position: its position is the box centre, whatever the aircraft did.
  for (const observation of result.observations.filter(r => r.providerId.startsWith('mil:'))) assert.equal(observation.locationMethod, 'theater-centre');
  assert.deepEqual(result.observations.filter(r => r.providerId.startsWith('mil:')).map(r => [r.lat, r.lon]), [[59.75, 19.5], [46.5, 33], [38, 127.75]]);
  const quiet = run([plane(1, 0, 0, { lat: 5, lon: 5 })]);
  assert.deepEqual(quiet.observations, []); assert.equal(quiet.status, 'ok'); assert.equal(total(quiet), 1);
});

test('the provider time is the payload now in milliseconds: missing, in seconds, text, future or old means stale, never collection time', () => {
  const at = value => parseAdsbMilitary(mil(crowd('korea', 2), { now: value }), [EMPTY_SQUAWK], { now });
  const fine = at(PAYLOAD_NOW); assert.equal(fine.status, 'ok'); assert.equal(fine.observedAt, '2026-10-02T20:49:57.000Z');
  for (const value of [undefined, null, 'later', '1790974197000', Math.floor(PAYLOAD_NOW / 1000), NaN, Infinity, -1, 0, {}, [], 4102444800001, 946684799999, true]) {
    const result = at(value);
    assert.equal(result.status, 'stale', `now ${String(value)}`); assert.equal(result.observedAt, null); assert.deepEqual(result.observations, []); assert.equal(result.freshness.reason, 'unknown-provider-time'); assert.equal('metrics' in result && result.metrics.mil_aircraft_total !== undefined, false, 'a stale feed has no metric');
  }
  const absent = mil(crowd('korea', 2)); delete absent.now;
  const result = parseAdsbMilitary(absent, [], { now });
  assert.equal(result.status, 'stale'); assert.equal(result.observedAt, null); assert.deepEqual(result.observations, []); assert.ok(!('error' in result), 'stale, not an error');
  // 25 minutes is the limit (a little more than the default refresh interval of 15 minutes, so a row never reads expired between two sweeps).
  assert.equal(at(now - 25 * MINUTE).status, 'ok', '25 minutes old'); assert.equal(at(now - 25 * MINUTE - 1).status, 'stale', 'one millisecond more'); assert.equal(at(now - 25 * MINUTE - 1).freshness.reason, 'expired-provider-time'); assert.equal(at(now - 20 * MINUTE).status, 'ok');
  // Five minutes of clock skew are tolerated, more is a future feed.
  assert.equal(at(now + 5 * MINUTE).status, 'ok'); assert.equal(at(now + 5 * MINUTE + 1).status, 'stale'); assert.equal(at(now + 5 * MINUTE + 1).freshness.reason, 'future-provider-time');
  // An old answer carries no rows and its aircraft are not counted anywhere.
  assert.equal(at(now - HOUR).observations.length, 0);
});

test('wrong shapes and provider errors give an error result, never throw and never show a URL', () => {
  for (const payload of [{}, null, undefined, 'mil', 42, true, [], { ac: null }, { ac: 'x', now: PAYLOAD_NOW }, { ac: {}, now: PAYLOAD_NOW }, { ac: 5, now: PAYLOAD_NOW }, { aircraft: [], now: PAYLOAD_NOW }, { features: [] }]) {
    const result = parseAdsbMilitary(payload, [], { now });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null); assert.doesNotMatch(result.error, /https?:/); assert.ok(!result.metrics?.mil_aircraft_total);
  }
  const failed = parseAdsbMilitary({ error: 'HTTP 429 from https://api.adsb.lol/v2/mil?key=secret', status: 429 }, [], { now });
  assert.equal(failed.status, 'error'); assert.doesNotMatch(failed.error, /https?:|api\.adsb\.lol|secret/i); assert.match(failed.error, /ADSB-Military/);
  assert.equal(parseAdsbMilitary({ error: { code: 1 } }, [], { now }).status, 'error');
  // Wrong shapes in the emergency lists do not hurt a good military list, they are only noted.
  for (const bad of [null, undefined, 'x', 5, [], {}, { ac: 'x', now: PAYLOAD_NOW }, { error: 'HTTP 503' }, { ac: [], now: undefined }, { ac: [] }]) {
    const result = parseAdsbMilitary(LIVE, [bad, EMPTY_SQUAWK, EMPTY_SQUAWK], { now });
    assert.equal(result.status, 'ok', JSON.stringify(bad)); assert.equal(result.observations.length, 3); assert.match(result.summary, /1 of 3 emergency squawk lookups failed/);
  }
  assert.doesNotMatch(parseAdsbMilitary(LIVE, [EMPTY_SQUAWK, EMPTY_SQUAWK, EMPTY_SQUAWK], { now }).summary, /lookups? failed/);
  for (const quacks of [undefined, null, 'x', 5, {}]) assert.equal(parseAdsbMilitary(LIVE, quacks, { now }).status, 'ok', `squawk payloads ${JSON.stringify(quacks)}`);
  assert.match(parseAdsbMilitary(LIVE, [{ error: 'x' }, { error: 'y' }, { error: 'z' }], { now }).summary, /3 of 3 emergency squawk lookups failed/);
  assert.match(parseAdsbMilitary(LIVE, [{ error: 'x' }, { error: 'y' }, { error: 'z' }], { now }).summary, /ADS-B/, 'the standing summary stays when a note is added');
  // Only the first three emergency lists are read.
  assert.equal(parseAdsbMilitary(LIVE, [EMPTY_SQUAWK, EMPTY_SQUAWK, EMPTY_SQUAWK, squawks([alarm(1, '7700')]), { error: 'x' }], { now }).observations.length, 3);
});

test('a stalled feed is an error and no zero is published or remembered: an empty list, or one with nothing airborne and current in it', () => {
  const rows = [squawks([alarm(1, '7700')]), EMPTY_SQUAWK, EMPTY_SQUAWK];
  const stalled = {
    'an empty list': mil([]),
    'an empty list without a time': mil([], { now: undefined }),
    'only stale positions': mil([...crowd('korea', 3), ...crowd('baltic', 2, 50)].map(a => ({ ...a, seen_pos: 121 }))),
    'only aircraft on the ground': mil([PARKED, TAXIING, plane(1, 25, 50, { alt_baro: 'ground' })]),
    'only aircraft without a position': mil([NO_POSITION, LAST_POSITION, GROUND_NO_POSITION, ODD_TYPE]),
    'only vehicles and beacons': mil([OBSTACLE, TOWER, plane(1, 25, 50, { category: 'C2' })]),
    'only junk entries': mil([null, 'x', 7, [], {}, plane(1, 25, 50, { hex: 'nothex' })]),
  };
  for (const [name, payload] of Object.entries(stalled)) {
    const memory = new Map([['x', { count: 4, at: PAYLOAD_NOW - MINUTE }]]);
    const result = parseAdsbMilitary(payload, rows, { now, previous: memory });
    assert.equal(result.status, 'error', name); assert.match(result.error, /feed stalled[?]$/, name); assert.deepEqual(result.observations, [], `${name}: no theater row and no emergency row`);
    assert.ok(!('metrics' in result), `${name}: no mil_aircraft_total, not even 0`); assert.equal(result.observedAt, null); assert.doesNotMatch(result.error, /https?:/);
    assert.equal(result.licenseUrl, 'https://opendatacommons.org/licenses/odbl/1-0/', name);
    assert.deepEqual([...memory], [['x', { count: 4, at: PAYLOAD_NOW - MINUTE }]], `${name}: nothing is remembered`);
  }
  assert.match(parseAdsbMilitary(mil([]), [], { now }).error, /empty military list/); assert.match(parseAdsbMilitary(stalled['only stale positions'], [], { now }).error, /no airborne aircraft with a current position/);
  // The aircraft that do count are not hidden by the ones that do not: one good aircraft anywhere is a working feed.
  const alive = parseAdsbMilitary(mil([...stalled['only aircraft on the ground'].ac, plane(9, 68.6, -165.2)]), [], { now });
  assert.equal(alive.status, 'ok'); assert.deepEqual(alive.metrics, { mil_aircraft_total: 1 });
  // Server side the error stays an error with no metric and no rows.
  const [out] = normalizeLiveSources({ 'ADSB-Military': parseAdsbMilitary(mil([]), rows, { now }) }, now);
  assert.equal(out.status, 'error'); assert.deepEqual(out.observations, []); assert.deepEqual(out.metrics, {});
  // A stalled sweep in the middle leaves the earlier counts in place: the next good sweep is compared with the last good one, not with a zero.
  const memory = new Map();
  const at = (minutes, ac) => parseAdsbMilitary(mil(ac, { now: PAYLOAD_NOW + minutes * MINUTE }), [], { now: now + minutes * MINUTE, previous: memory });
  at(0, crowd('korea', 3)); at(15, []); at(30, crowd('korea', 4).map(a => ({ ...a, seen_pos: 500 })));
  const after = at(45, crowd('korea', 11, 100));
  assert.equal(row(after, 'mil:korea').severity, 'monitor', '11 is more than three times the 3 of the last good sweep'); assert.match(row(after, 'mil:korea').summary, /Previous sweep [(]45 min earlier[)]: 3 aircraft/);
});

test('a duplicated aircraft in the military list is counted once, at its freshest position', () => {
  const old = plane(1, 25, 50, { seen_pos: 50 }), fresh = plane(1, 37, 127, { seen_pos: 5 });
  for (const list of [[old, fresh], [fresh, old], [old, plane(2, 1, 1, { seen_pos: 1 }), fresh]]) {
    const result = run(list);
    assert.deepEqual(theaterIds(result), ['mil:korea'], 'the position of the fresher listing decides the theater'); assert.equal(row(result, 'mil:korea').aircraft, 1); assert.equal(total(result), list.length === 3 ? 2 : 1);
  }
  const tie = run([plane(1, 25, 50, { seen_pos: 5 }), plane(1, 37, 127, { seen_pos: 5 })]);
  assert.equal(total(tie), 1, 'equal ages: still one aircraft');
});

test('stale emergency rows never push a fresh one out of the 20-row cap', () => {
  const stale = Array.from({ length: 25 }, (_, i) => alarm(i + 1, '7700'));
  const result = run(ELSEWHERE, [squawks(stale, { now: PAYLOAD_NOW - 40 * MINUTE }), squawks([alarm(40, '7600')]), EMPTY_SQUAWK]);
  assert.deepEqual(result.observations.map(r => r.providerId), [`sqk:${alarm(40, '7600').hex}:7600`], 'the 25 old high-severity rows are dropped before the cap, the fresh moderate one stays');
  assert.equal(result.truncatedRecords, 0, 'rows that were never current are not counted as cut');
  // 22 fresh 7700 rows and a fresh 7600 compete for 20 places; the 25 stale ones play no part (23 candidates, 3 cut, and the cut ones are the radio failure and the two oldest).
  const mixed = run(ELSEWHERE, [squawks(stale, { now: PAYLOAD_NOW - 40 * MINUTE }), squawks(Array.from({ length: 22 }, (_, i) => alarm(i + 50, '7700', { seen_pos: i + 1 }))), squawks([alarm(40, '7600')])]);
  assert.equal(mixed.observations.length, 20); assert.ok(mixed.observations.every(r => r.severity === 'high')); assert.equal(mixed.truncatedRecords, 3);
});

test('theaters from the configuration are validated one by one; a bad entry is skipped, none usable is an error', () => {
  const run1 = theaters => parseAdsbMilitary(mil([plane(1, 15, 35)]), [], { now, theaters });
  assert.deepEqual(theaterIds(run1([{ id: 'one', label: 'One', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 }])), ['mil:one']);
  const bad = [null, 'x', 5, [], {}, { id: 'a' }, { id: 'ok', label: 'L', latMin: 'a', latMax: 20, lonMin: 30, lonMax: 40 }, { id: 'ok', label: 'L', latMin: 20, latMax: 10, lonMin: 30, lonMax: 40 }, { id: 'ok', label: 'L', latMin: 10, latMax: 10, lonMin: 30, lonMax: 40 },
    { id: 'ok', label: 'L', latMin: 10, latMax: 20, lonMin: 30, lonMax: 30 }, { id: 'ok', label: 'L', latMin: -91, latMax: 20, lonMin: 30, lonMax: 40 }, { id: 'ok', label: 'L', latMin: 10, latMax: 91, lonMin: 30, lonMax: 40 },
    { id: 'ok', label: 'L', latMin: 10, latMax: 20, lonMin: -181, lonMax: 40 }, { id: 'ok', label: 'L', latMin: 10, latMax: 20, lonMin: 30, lonMax: 181 }, { id: 'ok', label: 'L', latMin: NaN, latMax: 20, lonMin: 30, lonMax: 40 }, { id: 'ok', label: 'L', latMin: 10, latMax: Infinity, lonMin: 30, lonMax: 40 },
    { id: 'Bad Id', label: 'L', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 }, { id: 'UPPER', label: 'L', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 }, { id: '', label: 'L', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 }, { id: 5, label: 'L', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 },
    { id: 'x'.repeat(41), label: 'L', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 }, { id: 'a:b', label: 'L', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 }, { id: '-lead', label: 'L', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 }];
  const good = { id: 'good', label: 'Good', latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 };
  assert.deepEqual(theaterIds(run1([...bad, good])), ['mil:good']);
  // A repeated id keeps the first, so no two rows share an identity.
  assert.deepEqual(theaterIds(run1([good, { ...good, latMin: 0 }])), ['mil:good']);
  assert.deepEqual(theaterIds(parseAdsbMilitary(mil([plane(1, 15, 35), plane(2, 5, 35)]), [], { now, theaters: [good, { ...good, latMin: 0, latMax: 8 }] })), ['mil:good'], 'a second box with a used id is skipped');
  // Boxes with the same centre or even the same box are all valid: every row link carries its theater id, so no row is skipped and no two rows share a link
  // (history merges rows of one kind and one link).
  assert.deepEqual(theaterIds(run1([{ ...good, id: 'a' }, { ...good, id: 'b' }])), ['mil:a'], 'the same box twice: the first takes every aircraft');
  const twin = parseAdsbMilitary(mil([plane(1, 15, 35), plane(2, 9.5, 35)]), [], { now, theaters: [{ ...good, id: 'a' }, { ...good, id: 'b', latMin: 9, latMax: 21, lonMin: 29, lonMax: 41 }] });
  assert.deepEqual(twin.observations.map(r => [r.providerId, r.aircraft]), [['mil:a', 1], ['mil:b', 1]], 'same centre, same zoom: both rows are there'); assert.equal(total(twin), 2);
  assert.notEqual(twin.observations[0].url, twin.observations[1].url); assert.equal(new URL(twin.observations[0].url).searchParams.get('lat'), new URL(twin.observations[1].url).searchParams.get('lat'));
  assert.deepEqual(twin.observations.map(r => new URL(r.url).searchParams.get('theater')), ['a', 'b']);
  const inner = { id: 'inner', label: 'Inner', latMin: 14, latMax: 16, lonMin: 34, lonMax: 36 }, outer = { id: 'outer', label: 'Outer', latMin: 0, latMax: 30, lonMin: 20, lonMax: 50 };
  const nested = parseAdsbMilitary(mil([plane(1, 15, 35), plane(2, 5, 25)]), [], { now, theaters: [inner, outer] }).observations;
  assert.deepEqual(nested.map(r => [r.providerId, r.aircraft]), [['mil:inner', 1], ['mil:outer', 1]]); assert.notEqual(nested[0].url, nested[1].url); assert.equal(nested[0].lat, nested[1].lat);
  for (const theaters of [[], null, 'x', 5, {}, bad]) {
    const result = run1(theaters);
    assert.equal(result.status, 'error', JSON.stringify(theaters).slice(0, 40)); assert.match(result.error, /theater/i); assert.deepEqual(result.observations, []);
  }
  assert.equal(run1(undefined).status, 'ok', 'no option means the default theaters');
  // At most 12 theaters, and the label is cut and cleaned.
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, label: `T${i}`, latMin: i, latMax: i + 1, lonMin: 30, lonMax: 40 }));
  assert.equal(parseAdsbMilitary(mil(many.map((box, i) => plane(i + 1, box.latMin + 0.5, 35))), [], { now, theaters: many }).observations.length, 12);
  const labelled = run1([{ ...good, label: `<b>Good</b> ${rtl}area${bell}${'x'.repeat(300)}` }]).observations[0];
  assert.doesNotMatch(labelled.title, /[<>]/); assert.doesNotMatch(labelled.title, new RegExp(`[${rtl}${bell}]`)); assert.ok(labelled.title.length <= 100, `title length ${labelled.title.length}`);
  assert.equal(run1([{ ...good, label: '' }]).observations[0].title, 'good: 1 military aircraft', 'the id stands in for a missing label'); assert.equal(run1([{ ...good, label: undefined }]).observations[0].title, 'good: 1 military aircraft');
});

test('the default theaters are the configured ones: seven boxes, the first match wins, nothing overlaps by more than the documented borders', () => {
  const configured = config.publicSources.adsbTheaters;
  assert.deepEqual(configured.map(box => box.id), ['black-sea', 'east-med', 'middle-east-gulf', 'baltic', 'south-china-sea-taiwan', 'korea', 'central-europe']);
  for (const box of configured) { assert.equal(typeof box.label, 'string'); for (const key of ['latMin', 'latMax', 'lonMin', 'lonMax']) assert.equal(typeof box[key], 'number', `${box.id} ${key}`); assert.ok(box.latMin < box.latMax && box.lonMin < box.lonMax, box.id); }
  // The adapter default and the configuration agree box by box, so the two copies cannot drift apart: the same list, and the same answer with and without the option.
  assert.deepEqual(DEFAULT_THEATERS, configured);
  const live = mil([...LIVE_AC, ...Object.entries(SPOT).flatMap(([id], i) => crowd(id, 2, 400 + i * 10)), plane(900, 33, 35.5), plane(901, 53.5, 20), plane(902, 48, 24)]);
  assert.deepEqual(parseAdsbMilitary(live, [], { now }), parseAdsbMilitary(live, [], { now, theaters: configured }));
  const result = parseAdsbMilitary(live, [], { now });
  assert.equal(result.observations.length, 7, 'every default theater has aircraft here');
  // The overlap of the Mediterranean and the Gulf boxes goes to the Mediterranean, the border of the Baltic and Central Europe boxes to the Baltic, the border of the Black Sea box and Central Europe to the Black Sea.
  assert.equal(row(result, 'mil:east-med').aircraft, 3, '2 over the sea and the one at 33 N, 35.5 E'); assert.equal(row(result, 'mil:middle-east-gulf').aircraft, 5, '2 over the Gulf and 3 from the real list');
  assert.equal(row(result, 'mil:baltic').aircraft, 3, '2 and the one on 53.5 N'); assert.equal(row(result, 'mil:black-sea').aircraft, 3, '2 and the one on 24 E');
  assert.equal(row(result, 'mil:central-europe').aircraft, 3, '2 plus the Hungarian one of the real list');
  assert.equal(row(result, 'mil:korea').aircraft, 3, '2 plus the one of the real list'); assert.equal(row(result, 'mil:south-china-sea-taiwan').aircraft, 2);
  // Known places: Budapest, Kyiv, Tel Aviv, Riga, Taipei, Seoul, Dubai, Crete; Ankara and Moscow lie outside every box.
  const where = (lat, lon) => theaterIds(parseAdsbMilitary(mil([plane(1, lat, lon)]), [], { now }))[0];
  assert.equal(where(47.5, 19.04), 'mil:central-europe'); assert.equal(where(50.45, 30.52), 'mil:black-sea'); assert.equal(where(44.4, 33.5), 'mil:black-sea'); assert.equal(where(32.1, 34.8), 'mil:east-med'); assert.equal(where(35.2, 24.9), 'mil:east-med');
  assert.equal(where(56.95, 24.1), 'mil:baltic'); assert.equal(where(54.7, 20.5), 'mil:baltic'); assert.equal(where(25.1, 121.5), 'mil:south-china-sea-taiwan'); assert.equal(where(37.5, 127), 'mil:korea'); assert.equal(where(25.2, 55.3), 'mil:middle-east-gulf'); assert.equal(where(35.7, 51.4), 'mil:middle-east-gulf');
  assert.equal(where(39.9, 32.9), undefined, 'Ankara'); assert.equal(where(55.75, 37.6), undefined, 'Moscow'); assert.equal(where(51.5, -0.1), undefined, 'London'); assert.equal(where(40.7, -74), undefined, 'New York');
});

test('hostile provider text is dropped or cleaned and never reaches a row', () => {
  const hostile = `<img src=x onerror=alert(1)>${rtl}${bell}${nul}<script>alert(1)</script>Evil${zero}  Name\n\t of   "Mars" ${'A'.repeat(5000)}`;
  const result = run([plane(1, 25, 50, { flight: hostile, t: hostile }), plane(2, 25, 50, { flight: `AB${rtl}CD12`, t: `C${zero}30J` }), plane(3, 25, 50, { flight: 'X<b>Y', t: '<b>' }), plane(4, 25, 50, { flight: 'NORMAL1 ', t: 'H60' })],
    [squawks([alarm(1, '7700', { flight: hostile, t: hostile }), alarm(2, '7600', { flight: `<script>alert(1)</script>`, t: 'B738' }), alarm(3, '7500', { flight: `BAD${nul}1`, t: `B7${bell}38` })]), EMPTY_SQUAWK, EMPTY_SQUAWK]);
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 4);
  for (const observation of result.observations) {
    for (const value of [observation.title, observation.summary, observation.region ?? '', observation.types ?? '']) {
      assert.doesNotMatch(value, /[<>]/); assert.doesNotMatch(value, /onerror|alert\(|script/i); assert.doesNotMatch(value, new RegExp(`[${rtl}${zero}${bell}${nul}\\n\\t]`));
    }
    assert.ok(observation.title.length <= 100, `title length ${observation.title.length}`); assert.ok(observation.summary.length <= 900, `summary length ${observation.summary.length}`);
  }
  const gulf = row(result, 'mil:middle-east-gulf');
  assert.match(gulf.summary, /Callsigns: NORMAL1\./, 'only the plain callsign survives'); assert.equal(gulf.types, 'H60 (1)');
  assert.deepEqual(result.observations.filter(r => r.providerId.startsWith('sqk:')).map(r => r.title).sort(), [`Emergency squawk 7500: ${alarm(3, '7500').hex}`, `Emergency squawk 7600: ${alarm(2, '7600').hex}`, `Emergency squawk 7700: ${alarm(1, '7700').hex}`].sort());
});

// Standing rule for every adapter: cut the text to a fixed length first, then run regexes. A flood of 100k is far above any field; a quadratic pattern needs many seconds for it
// (a linear one milliseconds), so a regression fails the elapsed check instead of hanging CI.
test('hostile oversized provider text and payloads are handled in linear time', { timeout: 30000 }, () => {
  const started = Date.now();
  const N = 100000;
  const floods = { lt: '<'.repeat(N), openTag: '<a '.repeat(N / 3), gt: '>'.repeat(N), nested: '<<>'.repeat(N / 3), spaces: ' '.repeat(N) + 'AB', words: 'A'.repeat(N), controls: (bell + zero).repeat(N / 2), http: 'http://'.repeat(N / 7), digits: '1'.repeat(N) };
  for (const [flood, value] of Object.entries(floods)) {
    for (const field of ['hex', 'flight', 't', 'category', 'alt_baro', 'squawk', 'lat', 'lon', 'seen_pos', 'type']) {
      const result = run([plane(1, 25, 50, { [field]: value }), plane(2, 25, 50)]);
      assert.ok(result.observations.length <= 1, `${flood} ${field}`);
      const gulf = row(result, 'mil:middle-east-gulf');
      if (gulf) { assert.ok(gulf.summary.length <= 900, `${flood} ${field} summary length`); assert.doesNotMatch(gulf.summary + gulf.title, /[<>]/, `${flood} ${field}`); }
      const sq = run(ELSEWHERE, [squawks([alarm(1, '7700', { [field]: value }), alarm(2, '7600')]), EMPTY_SQUAWK, EMPTY_SQUAWK]);
      assert.ok(sq.observations.length >= 1 && sq.observations.length <= 2, `${flood} ${field} squawk`); for (const o of sq.observations) assert.doesNotMatch(o.summary + o.title, /[<>]/);
    }
    const tail = parseAdsbMilitary(mil([plane(1, 25, 50)], { now: value, msg: value }), [{ ac: [alarm(1, '7700')], now: value }, { error: value }, value], { now });
    assert.equal(tail.status, 'stale', `${flood} now`); assert.ok(tail.summary.length <= 1200, `${flood} summary length ${tail.summary.length}`);
    const label = parseAdsbMilitary(mil([plane(1, 15, 35)]), [], { now, theaters: [{ id: 'good', label: value, latMin: 10, latMax: 20, lonMin: 30, lonMax: 40 }, { id: value, label: 'x', latMin: 10, latMax: 20, lonMin: 31, lonMax: 40 }] });
    assert.equal(label.status, 'ok', `${flood} label`); assert.doesNotMatch(label.observations[0].title, /[<>]/); assert.ok(label.observations[0].title.length <= 100, `${flood} label title length`);
    for (const error of [value]) { const failed = parseAdsbMilitary({ error }, [], { now }); assert.equal(failed.status, 'error'); assert.ok(failed.error.length <= 300); assert.doesNotMatch(failed.error, /https?:/); }
  }
  // Huge lists: only the first aircraft of a list are read, and the answer does not depend on the rest.
  const big = mil(Array.from({ length: 20000 }, (_, i) => plane(i + 1, 25 + (i % 7) / 100, 50)));
  const result = parseAdsbMilitary(big, [squawks(Array.from({ length: 20000 }, (_, i) => alarm(i + 1, '7700')))], { now });
  assert.equal(result.status, 'ok'); assert.equal(result.examinedRecords, 5000); assert.equal(total(result), 5000); assert.ok(result.truncatedRecords >= 15000);
  assert.equal(result.observations.filter(r => r.providerId.startsWith('sqk:')).length, 20); assert.equal(row(result, 'mil:middle-east-gulf').aircraft, 5000);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `took ${elapsed} ms`);
});

test('observations survive the server normalization with facts, location and the registered home and policy', () => {
  assert.deepEqual(FACT_FIELDS['ADSB-Military'], ['aircraft', 'types']);
  assert.equal(HOME['ADSB-Military'], 'https://adsb.lol/');
  assert.deepEqual(POLICIES['ADSB-Military'], { maxAgeMs: 25 * MINUTE, observationMaxAgeMs: 25 * MINUTE });
  const keys = Object.keys(POLICIES); assert.equal(keys.indexOf('ADSB-Military'), keys.indexOf('Aviation-SIGMET') + 1, 'registered in the fixed order, Aviation-SIGMET then ADSB-Military');
  const [out] = normalizeLiveSources({ 'ADSB-Military': parseAdsbMilitary(LIVE, [squawks([alarm(1, '7700')]), EMPTY_SQUAWK, EMPTY_SQUAWK], { now }) }, now);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://adsb.lol/'); assert.equal(out.observations.length, 4);
  assert.deepEqual(out.metrics, { mil_aircraft_total: 7 }); assert.match(out.license, /ODbL/); assert.match(out.attribution, /adsb\.lol/);
  const emergency = out.observations[0];
  assert.equal(emergency.kind, 'aviation'); assert.equal(emergency.severity, 'high'); assert.equal(emergency.locationMethod, 'provider'); assert.equal(emergency.facts, undefined);
  const gulf = out.observations.find(r => r.providerId === 'mil:middle-east-gulf');
  assert.equal(gulf.kind, 'aviation'); assert.equal(gulf.severity, 'info'); assert.equal(gulf.lat, 25); assert.equal(gulf.lon, 48); assert.equal(gulf.locationMethod, 'theater-centre'); assert.equal(gulf.locationPrecision, 'approximate'); assert.equal(gulf.region, 'Middle East and Gulf');
  assert.deepEqual(gulf.facts, [{ label: 'aircraft', value: 3 }, { label: 'types', value: 'B762 (2), CRJ7 (1)' }]);
  const events = buildEvents({ meta: { timestamp: iso(now) }, liveSources: [out] }, { now });
  assert.equal(events.length, 4); assert.ok(events.every(event => event.kind === 'aviation'));
  const top = events.find(event => event.title === 'Middle East and Gulf: 3 military aircraft');
  assert.equal(top.severity, 'low', 'the event scale calls the provider word info low'); assert.equal(top.observedAt, '2026-10-02T20:49:57.000Z'); assert.equal(top.location.method, 'theater-centre'); assert.equal(top.location.label, 'Middle East and Gulf');
  const eventIds = payload => buildEvents({ meta: { timestamp: iso(now) }, liveSources: normalizeLiveSources({ 'ADSB-Military': parseAdsbMilitary(payload, [squawks([alarm(1, '7700')]), EMPTY_SQUAWK, EMPTY_SQUAWK], { now }) }, now) }, { now }).map(event => event.id).sort();
  assert.deepEqual(eventIds(LIVE), eventIds(clone(LIVE))); assert.deepEqual(eventIds(mil([...LIVE_AC].reverse())), eventIds(LIVE), 'event identities are stable across parses'); assert.equal(new Set(eventIds(LIVE)).size, 4);
  // The same theater a quarter of an hour later is the same event: the count changes, the identity does not.
  const later = mil([...LIVE_AC, plane(1, 25, 50)], { now: PAYLOAD_NOW + 15 * MINUTE });
  const laterIds = buildEvents({ meta: { timestamp: iso(now + 15 * MINUTE) }, liveSources: normalizeLiveSources({ 'ADSB-Military': parseAdsbMilitary(later, [EMPTY_SQUAWK], { now: now + 15 * MINUTE }) }, now + 15 * MINUTE) }, { now: now + 15 * MINUTE });
  assert.equal(laterIds.find(event => event.title.startsWith('Middle East and Gulf')).id, top.id, 'the theater keeps its identity while its count changes'); assert.match(laterIds.find(event => event.title.startsWith('Middle East and Gulf')).title, /: 4 military aircraft/);
  // Fresh time from the policy: 25 minutes after the provider time the rows are gone again.
  const gone = normalizeLiveSources({ 'ADSB-Military': parseAdsbMilitary(LIVE, [], { now }) }, PAYLOAD_NOW + 26 * MINUTE)[0];
  assert.equal(gone.status, 'stale'); assert.deepEqual(gone.observations, []); assert.deepEqual(gone.metrics, {});
});

test('history keeps each theater and each emergency aircraft apart because every row has its own link, and a new sweep does not grow it', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-adsb-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = new HistoryStore(dir, { now: () => now + HOUR });
  const eventsFor = (payload, quacks, at) => buildEvents({ meta: { timestamp: iso(at) }, liveSources: normalizeLiveSources({ 'ADSB-Military': parseAdsbMilitary(payload, quacks, { now: at }) }, at) }, { now: at });
  const sweepOne = eventsFor(mil([...crowd('korea', 3), ...crowd('baltic', 2, 50), ...crowd('central-europe', 1, 80)]), [squawks([alarm(1, '7700'), alarm(2, '7600')]), EMPTY_SQUAWK, EMPTY_SQUAWK], now);
  assert.equal(sweepOne.length, 5); assert.equal(new Set(sweepOne.map(event => event.id)).size, 5); assert.equal(new Set(sweepOne.map(event => event.source.url)).size, 5, 'five links');
  assert.deepEqual(history.add(sweepOne), { added: 5, updated: 0, ignored: 0, total: 5 }, 'five rows are five stored records');
  const at2 = now + 15 * MINUTE;
  const sweepTwo = eventsFor(mil([...crowd('korea', 7, 200), ...crowd('baltic', 1, 250), ...crowd('central-europe', 4, 280)], { now: PAYLOAD_NOW + 15 * MINUTE }), [squawks([alarm(1, '7700', { seen_pos: 9 }), alarm(2, '7600')], { now: PAYLOAD_NOW + 15 * MINUTE + 500 }), EMPTY_SQUAWK, EMPTY_SQUAWK], at2);
  assert.deepEqual(history.add(sweepTwo), { added: 0, updated: 5, ignored: 0, total: 5 }, 'the next sweep updates the same five records');
  assert.equal(history.query({ source: 'ADSB-Military', kind: 'aviation' }).total, 5);
});

test('briefing makes at most four bounded requests: the military list first, the serious emergency codes together, then the radio failure code', async () => {
  const seen = [];
  const lists = { 'https://api.adsb.lol/v2/mil': LIVE, 'https://api.adsb.lol/v2/sqk/7700': squawks([alarm(1, '7700')]), 'https://api.adsb.lol/v2/sqk/7600': EMPTY_SQUAWK, 'https://api.adsb.lol/v2/sqk/7500': squawks([alarm(3, '7500')]) };
  const result = await briefing({ pause: 0, now, previous: new Map(), fetcher: async (url, options) => { seen.push({ url, options }); return clone(lists[url]); } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 4);
  assert.deepEqual(seen.map(call => call.url).sort(), Object.keys(lists).sort());
  assert.equal(seen[0].url, 'https://api.adsb.lol/v2/mil', 'the list that cannot be missed goes first'); assert.deepEqual(seen.slice(1, 3).map(call => call.url).sort(), ['https://api.adsb.lol/v2/sqk/7500', 'https://api.adsb.lol/v2/sqk/7700']); assert.equal(seen[3].url, 'https://api.adsb.lol/v2/sqk/7600', '7600 is the least serious code and goes last');
  for (const call of seen) assert.deepEqual({ ...call.options }, { timeout: 10000, retries: 0, maxBytes: 2 * MIB });
  assert.equal(result.observations.length, 5); assert.equal(total(result), 7);
  assert.deepEqual(result.observations.map(r => r.providerId).slice(0, 2).sort(), [`sqk:${alarm(1, '7700').hex}:7700`, `sqk:${alarm(3, '7500').hex}:7500`].sort());
  assert.ok(!/lookups? failed/.test(result.summary));
});

test('a failing emergency list does not discard a good military list: still ok, with a note in the summary', async () => {
  const mk = failing => ({ pause: 0, now, previous: new Map(), fetcher: async url => {
    if (failing.includes(url.slice(url.lastIndexOf('/') + 1))) return { error: 'HTTP 429', status: 429 };
    if (url.endsWith('/mil')) return clone(LIVE);
    return url.endsWith('/7700') ? clone(squawks([alarm(1, '7700')])) : clone(EMPTY_SQUAWK);
  } });
  const one = await briefing(mk(['7600']));
  assert.equal(one.status, 'ok'); assert.equal(one.observations.length, 4, '3 theaters and the 7700 row'); assert.match(one.summary, /1 of 3 emergency squawk lookups failed, so emergency rows may be missing/); assert.equal(total(one), 7);
  const lost = await briefing(mk(['7700']));
  assert.equal(lost.status, 'ok'); assert.equal(lost.observations.length, 3); assert.match(lost.summary, /1 of 3/);
  const all = await briefing(mk(['7700', '7600', '7500']));
  assert.equal(all.status, 'ok'); assert.equal(all.observations.length, 3); assert.match(all.summary, /3 of 3 emergency squawk lookups failed/); assert.deepEqual(all.metrics, { mil_aircraft_total: 7 });
  assert.doesNotMatch(all.summary, /https?:|429/);
  // Empty bodies (HTTP 204) and thrown errors from an emergency list count as failed lookups too.
  const empty = await briefing({ pause: 0, now, previous: new Map(), fetcher: async url => url.endsWith('/mil') ? clone(LIVE) : url.endsWith('/7600') ? { error: 'Invalid JSON response', status: 204 } : url.endsWith('/7500') ? Promise.reject(new Error('boom https://x')) : clone(EMPTY_SQUAWK) });
  assert.equal(empty.status, 'ok'); assert.match(empty.summary, /2 of 3/);
});

test('a failing military list is an error result whatever the emergency lists say, and nothing leaks', async () => {
  const sq = squawks([alarm(1, '7700')]);
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'HTTP 403', status: 403 }, { error: 'Request timed out after 10000ms' }, { error: 'Response exceeds 2097152 byte limit' }, { error: 'Invalid JSON response', status: 200 },
    { error: 'connect failed for https://api.adsb.lol/v2/mil?key=secret' }, {}, null, 'text', 5, { ac: 'x', now: PAYLOAD_NOW }];
  for (const payload of failures) {
    const asked = [];
    const result = await briefing({ pause: 0, now, previous: new Map(), fetcher: async url => { asked.push(url); return url.endsWith('/mil') ? payload : clone(sq); } });
    assert.deepEqual(asked, ['https://api.adsb.lol/v2/mil'], 'no emergency list is asked for without a military list'); assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, [], 'the emergency rows are not shown without the military list'); assert.equal(result.observedAt, null); assert.doesNotMatch(result.error, /https?:|adsb\.lol|secret/i);
    assert.ok(!result.metrics?.mil_aircraft_total, 'no metric for a failed list');
  }
  const thrown = await briefing({ pause: 0, now, previous: new Map(), fetcher: async () => { throw new Error('connect ECONNREFUSED https://api.adsb.lol/?key=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|adsb\.lol|secret|ECONNREFUSED/i);
  assert.equal((await briefing({ pause: 0, now, previous: new Map(), fetcher: () => { throw new Error('sync https://x'); } })).status, 'error');
  // A military list without a usable provider time is stale and asks for nothing more either.
  const asked = [];
  const undated = await briefing({ pause: 0, now, previous: new Map(), fetcher: async url => { asked.push(url); return mil(crowd('korea', 2), { now: undefined }); } });
  assert.equal(undated.status, 'stale'); assert.equal(asked.length, 1);
});

test('briefing over the real fetch helper degrades 503, 429, timeout, an oversized body and invalid JSON to error results', async () => {
  const cases = {
    '503': () => reply('down', { status: 503 }),
    '429': () => reply('<html>429 Too Many Requests</html>', { status: 429 }),
    '403': () => reply('forbidden', { status: 403 }),
    'timeout': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    'oversized': () => reply('x'.repeat(2 * MIB + 1)),
    'invalid json': () => reply('<html>not json</html>'),
    'network': () => Promise.reject(new TypeError('fetch failed')),
  };
  for (const [name, impl] of Object.entries(cases)) {
    const result = await withFetch(impl, () => briefing({ pause: 0, now, timeout: 25, previous: new Map() }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name); assert.doesNotMatch(result.error, /https?:|adsb\.lol/i, name);
  }
  assert.match((await withFetch(cases.timeout, () => briefing({ pause: 0, now, timeout: 25, previous: new Map() }))).error, /timed out/i);
  assert.match((await withFetch(cases.oversized, () => briefing({ pause: 0, now, timeout: 1000, previous: new Map() }))).error, /exceeds|limit/i);
  // Only the emergency lists fail with the real helper: the military list is good.
  const calls = [];
  const half = await withFetch(async (url, init) => { calls.push({ url: String(url), headers: init.headers }); return String(url).endsWith('/mil') ? reply(LIVE) : String(url).endsWith('/7600') ? reply('slow down', { status: 429 }) : reply(EMPTY_SQUAWK); }, () => briefing({ pause: 0, now, previous: new Map() }));
  assert.equal(half.status, 'ok'); assert.equal(half.observations.length, 3); assert.match(half.summary, /1 of 3 emergency squawk lookups failed/);
  assert.equal(calls.length, 4);
  // The service answers 403 to a request without a user agent (and to the plain "node" one): the project's own agent is sent.
  for (const call of calls) assert.match(String(call.headers['User-Agent']), /^Crucix\//);
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await briefing({ pause: 0, now, timeout, previous: new Map(), fetcher: async (url, options) => { seen.push(options.timeout); return url.endsWith('/mil') ? LIVE : EMPTY_SQUAWK; } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000); assert.equal(seen.length, 24);
});

test('briefing keeps the previous counts between sweeps: a surge shows on the second call, and a given theater list is used', async () => {
  const memory = new Map();
  const fetcherFor = (ac, at) => async url => url.endsWith('/mil') ? mil(ac, { now: at }) : clone(EMPTY_SQUAWK);
  const first = await briefing({ pause: 0, now, previous: memory, fetcher: fetcherFor(crowd('korea', 3), PAYLOAD_NOW) });
  assert.equal(row(first, 'mil:korea').severity, 'info');
  const second = await briefing({ pause: 0, now: now + 15 * MINUTE, previous: memory, fetcher: fetcherFor(crowd('korea', 11, 50), PAYLOAD_NOW + 15 * MINUTE) });
  assert.equal(row(second, 'mil:korea').severity, 'monitor'); assert.match(row(second, 'mil:korea').summary, /Previous sweep \(15 min earlier\): 3 aircraft/);
  const custom = await briefing({ pause: 0, now, previous: new Map(), theaters: BOXES, fetcher: fetcherFor([plane(1, 15, 32), plane(2, 22, 44)], PAYLOAD_NOW) });
  assert.deepEqual(custom.observations.map(r => r.providerId), ['mil:one', 'mil:two']);
  let requests = 0;
  const none = await briefing({ pause: 0, now, previous: new Map(), theaters: [], fetcher: async () => { requests++; return LIVE; } });
  assert.equal(none.status, 'error', 'no valid theater configured'); assert.match(none.error, /theater/i); assert.equal(requests, 0, 'and no request is made for it');
  // Without a memory option the module's own memory is used (the only state this source keeps); a far-away clock keeps it apart from the other tests.
  const far = Date.parse('2027-03-01T10:00:00Z');
  const a = await briefing({ pause: 0, now: far + 10000, fetcher: fetcherFor(crowd('baltic', 2), far) });
  const b = await briefing({ pause: 0, now: far + 15 * MINUTE + 10000, fetcher: fetcherFor(crowd('baltic', 10, 60), far + 15 * MINUTE) });
  assert.equal(row(a, 'mil:baltic').severity, 'info'); assert.equal(row(b, 'mil:baltic').severity, 'monitor', 'the module memory carries the count over');
});

test('briefing paces the requests for the provider burst limit: the list alone, two codes together, the last code after a pause', async () => {
  const calls = [];
  let running = 0, peak = 0;
  const result = await briefing({ now, pause: 60, previous: new Map(), fetcher: async url => { calls.push({ url: url.slice(url.lastIndexOf('/') + 1), at: Date.now() }); running++; peak = Math.max(peak, running); await new Promise(resolve => setTimeout(resolve, 15)); running--; return url.endsWith('/mil') ? LIVE : EMPTY_SQUAWK; } });
  assert.equal(result.status, 'ok'); assert.deepEqual(calls.map(call => call.url).slice(0, 1), ['mil']); assert.deepEqual(calls.slice(1, 3).map(call => call.url).sort(), ['7500', '7700']); assert.equal(calls[3].url, '7600');
  assert.ok(calls[1].at - calls[0].at >= 10, 'the codes wait for the list to be answered'); assert.ok(Math.abs(calls[2].at - calls[1].at) < 10, 'the two serious codes go out together'); assert.ok(calls[3].at - calls[2].at >= 55, `the last code waits (waited ${calls[3].at - calls[2].at} ms)`);
  assert.equal(peak, 2, 'never more than two at once');
  // The pause defaults to ten seconds and a bad value falls back to that (checked through the budget, never by waiting).
  for (const pause of [-1, NaN, 'x', undefined, null]) {
    const asked = [];
    await briefing({ now, pause, budget: 100, previous: new Map(), fetcher: async url => { asked.push(url); return url.endsWith('/mil') ? LIVE : EMPTY_SQUAWK; } });
    assert.equal(asked.length, 3, `pause ${String(pause)}: the default ten seconds cannot fit in a 100 ms budget, so the last code is skipped`);
  }
});

test('the last emergency code is skipped when it could not finish within the time a source has', async () => {
  const asked = [];
  const fetcher = async url => { asked.push(url.slice(url.lastIndexOf('/') + 1)); return url.endsWith('/mil') ? LIVE : EMPTY_SQUAWK; };
  // Budget 100 ms, pause 80 ms and a request limit of 50 ms: 0 + 80 + 50 does not fit.
  const skipped = await briefing({ now, pause: 80, budget: 100, timeout: 50, previous: new Map(), fetcher });
  assert.deepEqual(asked.sort(), ['7500', '7700', 'mil']); assert.equal(skipped.status, 'ok'); assert.match(skipped.summary, /1 of 3 emergency squawk lookups failed/); assert.equal(skipped.observations.length, 3);
  asked.length = 0;
  const fits = await briefing({ now, pause: 5, budget: 1000, timeout: 50, previous: new Map(), fetcher });
  assert.deepEqual(asked.sort(), ['7500', '7600', '7700', 'mil']); assert.doesNotMatch(fits.summary, /lookups? failed/);
  // The time already spent counts: a slow military list leaves no room for the pause.
  asked.length = 0;
  const slow = await briefing({ now, pause: 5, budget: 150, timeout: 50, previous: new Map(), fetcher: async (url, options) => { if (url.endsWith('/mil')) await new Promise(resolve => setTimeout(resolve, 120)); return fetcher(url, options); } });
  assert.ok(!asked.includes('7600'), 'after 120 ms of a 150 ms budget the last code is not started'); assert.equal(slow.status, 'ok'); assert.match(slow.summary, /1 of 3/);
});

test('briefing asks for nothing more when the military list is a stalled feed: no emergency requests and no pause', async () => {
  const stalled = [mil([]), mil([...crowd('korea', 3)].map(a => ({ ...a, seen_pos: 300 }))), mil([PARKED, NO_POSITION, OBSTACLE])];
  for (const payload of stalled) {
    const asked = [], started = Date.now();
    // The default pause is ten seconds: a result within a moment shows that nothing waited.
    const result = await briefing({ now, previous: new Map(), fetcher: async url => { asked.push(url); return clone(payload); } });
    assert.deepEqual(asked, ['https://api.adsb.lol/v2/mil']); assert.ok(Date.now() - started < 2000, 'no pause');
    assert.equal(result.status, 'error'); assert.match(result.error, /feed stalled[?]$/); assert.ok(!('metrics' in result)); assert.deepEqual(result.observations, []);
  }
});
