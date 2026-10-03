import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { SWEEP_ID_PATTERN, SweepArchive, isSweepId } from '../lib/sweeps/archive.mjs';
import { DOMAIN_IDS, domainOfSource } from '../lib/domains.mjs';

const BASE = Date.parse('2026-10-03T08:00:00.000Z');
const QUARTER = 15 * 60000;
const quiet = { warn() {}, error() {}, log() {} };
const at = n => new Date(BASE + n * QUARTER).toISOString();
const idAt = n => `sweep-${at(n).slice(0, 19).replace(/[-:]/g, '')}Z`;
const plain = value => JSON.parse(JSON.stringify(value));

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-sweeps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function recorder() {
  const lines = [];
  const push = (...parts) => lines.push(parts.join(' '));
  return { lines, warn: push, error: push, log: push };
}

const sweepsDir = dir => join(dir, 'sweeps');
const indexFile = dir => join(dir, 'sweeps', 'index.json');
const readIndex = dir => JSON.parse(readFileSync(indexFile(dir), 'utf8'));
const gzFiles = dir => readdirSync(sweepsDir(dir)).filter(name => name.endsWith('.json.gz')).sort();
const archiveAt = (dir, options = {}) => new SweepArchive(dir, { logger: quiet, ...options });

const row = (n, flags = {}) => ({ n, err: false, stale: false, disabled: false, ...flags });

function snap(n, extra = {}) {
  return {
    meta: { timestamp: at(n), sourcesQueried: 4, sourcesOk: 3 },
    health: [row('USGS'), row('GDELT', { stale: true }), row('FRED', { err: true }), row('OFAC', { disabled: true })],
    changes: { events: { newTotal: n + 2, new: [] }, sources: [{ source: 'GDELT' }], signals: [{ key: 'a' }, { key: 'b' }] },
    marker: `sweep ${n}`,
    ...extra,
  };
}

// A body that does not compress, so the byte caps can be exercised with small numbers.
const heavy = (n, bytes) => snap(n, { blob: randomBytes(bytes).toString('base64') });

test('isSweepId accepts the id format and rejects everything else', () => {
  assert.equal(isSweepId('sweep-20261003T081500Z'), true);
  assert.equal(SWEEP_ID_PATTERN.test('sweep-20261003T081500Z'), true);
  for (const bad of ['../x', '..\\x', 'sweep-1', 'sweep-20261003T081500Z.json', 'sweep-20261003T081500Z\n', 'sweep-20261003T081500Zx', 'xsweep-20261003T081500Z',
    'sweep-20261003t081500z', 'sweep-20261003T081500z', 'sweep-20261003T0815Z', 'sweep-%2e%2e', '', 'a'.repeat(100 * 1024), undefined, null, 5, {}, ['sweep-20261003T081500Z']]) {
    assert.equal(isSweepId(bad), false, String(bad).slice(0, 30));
  }
});

test('add, list, get and latest round trip a snapshot byte for byte', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  assert.deepEqual(archive.list(), []);
  assert.equal(archive.latest(), null);
  const first = snap(1);
  const second = snap(2, { extra: { nested: [1, { deep: 'ü' }] } });
  const added = archive.add({ snapshot: first, timing: { USGS: { status: 'ok', ms: 120 } } });
  assert.equal(added.id, idAt(1));
  assert.equal(added.timestamp, at(1));
  assert.equal(added.bytes, statSync(join(sweepsDir(dir), `${idAt(1)}.json.gz`)).size);
  archive.add({ snapshot: second });
  assert.deepEqual(plain(archive.get(idAt(1))), first);
  assert.deepEqual(plain(archive.get(idAt(2))), second);
  assert.equal(gunzipSync(readFileSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`))).toString('utf8'), JSON.stringify(second));
  assert.deepEqual(plain(archive.latest()), second);
  assert.deepEqual(plain(archive.list()), [
    { id: idAt(2), timestamp: at(2), ok: 3, total: 4, changeCounts: { events: 4, sources: 1, signals: 2 } },
    { id: idAt(1), timestamp: at(1), ok: 3, total: 4, changeCounts: { events: 3, sources: 1, signals: 2 } },
  ]);
  assert.deepEqual(plain(archive.list({ limit: 1 })).map(item => item.id), [idAt(2)]);
  for (const limit of [0, -3, 1.5, 'x', NaN, null]) assert.equal(archive.list({ limit }).length, 2, String(limit));
  assert.deepEqual(gzFiles(dir), [`${idAt(1)}.json.gz`, `${idAt(2)}.json.gz`]);
});

test('the id comes from meta.timestamp and falls back to the clock only when it is unusable', t => {
  const dir = tmp(t);
  const NOW = Date.parse('2026-11-05T01:02:03.456Z');
  const archive = archiveAt(dir, { now: () => NOW });
  assert.equal(archive.add({ snapshot: { meta: { timestamp: '2026-10-03T12:34:56.789Z' } } }).id, 'sweep-20261003T123456Z');
  assert.equal(archive.add({ snapshot: { meta: { timestamp: '2026-10-03T14:00:00+02:00' } } }).id, 'sweep-20261003T120000Z');
  const expected = 'sweep-20261105T010203Z';
  assert.equal(archive.add({ snapshot: { marker: 'no meta' } }).id, expected);
  for (const [index, timestamp] of [['bad', 'not a date'], ['number', 1790000000000], ['year', '+275760-09-13T00:00:00.000Z'], ['empty', ''], ['null', null]]) {
    const fresh = archiveAt(tmp(t), { now: () => NOW });
    const added = fresh.add({ snapshot: { meta: { timestamp }, marker: index } });
    assert.equal(added.id, expected, index);
    assert.equal(added.timestamp, '2026-11-05T01:02:03.456Z', index);
  }
  assert.ok(isSweepId(archiveAt(tmp(t)).add({ snapshot: {} }).id));
  assert.throws(() => archive.add({ snapshot: null }), TypeError);
  assert.throws(() => archive.add({ snapshot: [] }), TypeError);
  assert.throws(() => archive.add(), TypeError);
  assert.equal(archive.status, 'ok');
});

test('an id that already exists is not overwritten and is logged once', t => {
  const dir = tmp(t);
  const log = recorder();
  const archive = archiveAt(dir, { logger: log });
  assert.ok(archive.add({ snapshot: snap(1) }));
  const before = readFileSync(join(sweepsDir(dir), `${idAt(1)}.json.gz`));
  assert.equal(archive.add({ snapshot: snap(1, { marker: 'second attempt' }) }), null);
  assert.equal(log.lines.length, 1);
  assert.match(log.lines[0], new RegExp(idAt(1)));
  assert.deepEqual(readFileSync(join(sweepsDir(dir), `${idAt(1)}.json.gz`)), before);
  assert.equal(archive.get(idAt(1)).marker, 'sweep 1');
  assert.equal(archive.list().length, 1);
  assert.equal(archive.status, 'ok');
});

test('retention by count keeps the newest sweeps and deletes the files of the rest', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir, { count: 3 });
  for (let n = 1; n <= 5; n++) archive.add({ snapshot: snap(n) });
  assert.deepEqual(archive.list().map(item => item.id), [idAt(5), idAt(4), idAt(3)]);
  assert.deepEqual(gzFiles(dir), [3, 4, 5].map(n => `${idAt(n)}.json.gz`));
  assert.deepEqual(readIndex(dir).sweeps.map(item => item.id), [idAt(3), idAt(4), idAt(5)]);
  assert.equal(archive.get(idAt(1)), null);
  assert.deepEqual(archive.retention(), { count: 3, maxMb: 64 });
});

test('retention by bytes drops the oldest sweeps until the total fits', t => {
  const dir = tmp(t);
  const maxMb = 0.003;
  const cap = Math.floor(maxMb * 1024 * 1024);
  const archive = archiveAt(dir, { maxMb });
  const sizes = [];
  for (let n = 1; n <= 6; n++) sizes.push(archive.add({ snapshot: heavy(n, 700) }).bytes);
  let keep = 0;
  let total = 0;
  for (let i = sizes.length - 1; i >= 0 && total + sizes[i] <= cap; i--) { total += sizes[i]; keep++; }
  assert.ok(keep >= 2 && keep < 6, `the cap should cut some of the six sweeps (keeps ${keep})`);
  const kept = [1, 2, 3, 4, 5, 6].slice(6 - keep).map(idAt);
  assert.deepEqual(readIndex(dir).sweeps.map(item => item.id), kept);
  assert.deepEqual(gzFiles(dir), kept.map(id => `${id}.json.gz`));
  assert.ok(readIndex(dir).sweeps.reduce((sum, item) => sum + item.bytes, 0) <= cap);
  assert.equal(archive.retention().maxMb, maxMb);
});

test('the newest sweep is never pruned, even when it alone exceeds the byte cap', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir, { maxMb: 0.001 });
  const first = archive.add({ snapshot: heavy(1, 2000) });
  assert.ok(first.bytes > 1024, 'the sweep is larger than the cap');
  assert.deepEqual(archive.list().map(item => item.id), [idAt(1)]);
  assert.equal(archive.get(idAt(1)).marker, 'sweep 1');
  archive.add({ snapshot: heavy(2, 2000) });
  assert.deepEqual(archive.list().map(item => item.id), [idAt(2)]);
  assert.deepEqual(gzFiles(dir), [`${idAt(2)}.json.gz`]);
  assert.equal(archive.latest().marker, 'sweep 2');
});

test('the constructor rejects unusable options', t => {
  const dir = tmp(t);
  for (const bad of [{ count: 0 }, { count: -1 }, { count: 1.5 }, { count: NaN }, { count: '3' }, { maxMb: 0 }, { maxMb: 0.0005 }, { maxMb: NaN }, { maxMb: '8' }, { maxMb: Infinity }]) {
    assert.throws(() => new SweepArchive(dir, bad), RangeError, JSON.stringify(bad));
  }
  for (const bad of ['', undefined, null, 5]) assert.throws(() => new SweepArchive(bad), TypeError);
  assert.deepEqual(new SweepArchive(dir).retention(), { count: 96, maxMb: 64 });
  assert.deepEqual(new SweepArchive(dir, { count: 2, maxMb: 0.001 }).retention(), { count: 2, maxMb: 0.001 });
});

test('the index records codes, timings and counts per sweep', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  archive.add({
    snapshot: snap(1, { health: [row('USGS'), row('GDELT', { stale: true }), row('FRED', { err: true }), row('OFAC', { disabled: true }), row('EPA', { err: true, stale: true }), row('WHO', { disabled: true, err: true }), row('Bluesky'), row('Both', { disabled: true, err: true, stale: true })] }),
    timing: {
      USGS: { status: 'ok', ms: 120.4 }, GDELT: { status: 'stale', ms: 900 }, Bluesky: { status: 'error', ms: 31 },
      Treasury: { status: 'disabled', ms: 0 }, Unknown: { status: 'mystery', ms: 5 }, Broken: 'x', WHO: { status: 'ok', ms: -1 },
    },
  });
  const [entry] = readIndex(dir).sweeps;
  assert.equal(entry.id, idAt(1));
  assert.equal(entry.file, `${idAt(1)}.json.gz`);
  assert.equal(entry.timestamp, at(1));
  assert.equal(entry.ok, 3);
  assert.equal(entry.total, 4);
  assert.deepEqual(entry.changeCounts, { events: 3, sources: 1, signals: 2 });
  assert.deepEqual(entry.health, {
    USGS: [0, 120], GDELT: [1, 900], FRED: [2, null], OFAC: [3, null], EPA: [2, null], WHO: [0, null], Bluesky: [2, 31], Both: [3, null], Treasury: [3, 0],
  });
  assert.equal(readIndex(dir).version, 1);
});

test('ok, total and the change counts fall back to zero when the snapshot has no usable numbers', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  archive.add({ snapshot: { meta: { timestamp: at(1), sourcesOk: -1, sourcesQueried: 'many' }, changes: { events: { newTotal: 1.5 }, sources: 'x', signals: null } } });
  archive.add({ snapshot: { meta: { timestamp: at(2) } } });
  for (const item of archive.list()) assert.deepEqual(plain(item), { id: item.id, timestamp: item.timestamp, ok: 0, total: 0, changeCounts: { events: 0, sources: 0, signals: 0 } });
});

test('a corrupt, missing or invalid index is rebuilt from the files (health from health[], no timings)', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  for (let n = 1; n <= 3; n++) archive.add({ snapshot: snap(n), timing: { USGS: { status: 'ok', ms: 100 + n } } });
  const good = readIndex(dir);
  assert.equal(good.sweeps[0].health.USGS[1], 101);
  // Every case lists exactly the three real ids, so only the validation of the entries can reject it.
  const broken = patch => JSON.stringify({ version: 1, sweeps: good.sweeps.map((entry, index) => (index === 1 ? { ...entry, ...patch } : entry)) });
  const invalid = ['not json at all', '', '{"version":2,"sweeps":[]}', '{"version":1,"sweeps":{}}', '{"version":1,"sweeps":[{"id":"../x"}]}', 'null', '[]',
    JSON.stringify({ version: 1, sweeps: [good.sweeps[1], good.sweeps[0]] }),
    broken({ file: '../escape.json.gz' }), broken({ health: { USGS: [9, null] } }), broken({ health: { USGS: [0] } }), broken({ health: [] }),
    broken({ bytes: -1 }), broken({ bytes: '12' }), broken({ ok: 1.5 }), broken({ total: null }), broken({ timestamp: 'garbage' }), broken({ timestamp: 7 }),
    broken({ changeCounts: { events: 1, sources: 1 } }), broken({ changeCounts: null }), broken({ id: 'sweep-1' }), null];
  for (const content of invalid) {
    if (content === null) rmSync(indexFile(dir), { force: true }); else writeFileSync(indexFile(dir), content);
    const reopened = archiveAt(dir);
    assert.deepEqual(reopened.list().map(item => item.id), [idAt(3), idAt(2), idAt(1)], String(content).slice(0, 40));
    const rebuilt = readIndex(dir);
    assert.equal(rebuilt.version, 1);
    assert.deepEqual(rebuilt.sweeps.map(item => item.id), [idAt(1), idAt(2), idAt(3)]);
    assert.deepEqual(rebuilt.sweeps[0].health, { USGS: [0, null], GDELT: [1, null], FRED: [2, null], OFAC: [3, null] });
    assert.deepEqual(rebuilt.sweeps[2].changeCounts, { events: 5, sources: 1, signals: 2 });
    assert.equal(rebuilt.sweeps[2].timestamp, at(3));
    assert.equal(rebuilt.sweeps[2].bytes, statSync(join(sweepsDir(dir), `${idAt(3)}.json.gz`)).size);
  }
});

test('rebuildIndex can be called directly and reports how many sweeps it found', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  assert.equal(archive.rebuildIndex(), 0);
  archive.add({ snapshot: snap(1) });
  archive.add({ snapshot: snap(2) });
  writeFileSync(indexFile(dir), 'garbage');
  assert.equal(archive.rebuildIndex(), 2);
  assert.equal(readIndex(dir).sweeps.length, 2);
});

test('an empty directory is not written to by a read', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  assert.deepEqual(archive.list(), []);
  assert.deepEqual(archive.healthSeries(), { sweeps: [], sources: [] });
  assert.equal(archive.latest(), null);
  assert.equal(existsSync(sweepsDir(dir)), false);
});

test('zero-byte and truncated files are skipped by get and by the rebuild, never fatal', t => {
  const dir = tmp(t);
  const log = recorder();
  const archive = archiveAt(dir, { logger: log });
  for (let n = 1; n <= 3; n++) archive.add({ snapshot: snap(n) });
  const valid = readFileSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`));
  writeFileSync(join(sweepsDir(dir), `${idAt(4)}.json.gz`), Buffer.alloc(0));
  writeFileSync(join(sweepsDir(dir), `${idAt(5)}.json.gz`), valid.subarray(0, Math.floor(valid.length / 2)));
  writeFileSync(join(sweepsDir(dir), `${idAt(6)}.json.gz`), 'this is not gzip');
  for (const n of [4, 5, 6]) assert.equal(archive.get(idAt(n)), null, String(n));
  assert.equal(log.lines.length, 3, 'one report per unreadable file');
  assert.deepEqual(archive.list().map(item => item.id), [idAt(3), idAt(2), idAt(1)]);
  assert.deepEqual(readIndex(dir).sweeps.map(item => item.id), [idAt(1), idAt(2), idAt(3)]);
  assert.equal(archive.latest().marker, 'sweep 3');
  assert.equal(log.lines.length, 3, 'reading again does not report again');
  const reopenedLog = recorder();
  const reopened = archiveAt(dir, { logger: reopenedLog });
  assert.deepEqual(reopened.list().map(item => item.id), [idAt(3), idAt(2), idAt(1)]);
  assert.equal(reopenedLog.lines.length, 3, 'the rebuild reports each unreadable file');
  for (const n of [4, 5, 6]) assert.ok(reopenedLog.lines.some(line => line.includes(idAt(n))), String(n));
  assert.equal(reopened.healthSeries().sweeps.length, 3);
  assert.deepEqual(readIndex(dir).sweeps.map(item => item.id), [idAt(1), idAt(2), idAt(3)]);
  assert.equal(gzFiles(dir).length, 6, 'unreadable files are left in place, not deleted');
  reopened.list(); reopened.list(); reopened.healthSeries(); reopened.latest();
  assert.equal(reopenedLog.lines.length, 3, 'an unreadable file is reported once, not on every read');
});

test('a corrupt newest file is passed over by latest and an unreadable file found by get leaves the index', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  for (let n = 1; n <= 3; n++) archive.add({ snapshot: snap(n) });
  writeFileSync(join(sweepsDir(dir), `${idAt(3)}.json.gz`), Buffer.alloc(0));
  assert.equal(archive.latest().marker, 'sweep 2');
  assert.deepEqual(archive.list().map(item => item.id), [idAt(2), idAt(1)]);
  assert.deepEqual(readIndex(dir).sweeps.map(item => item.id), [idAt(1), idAt(2)]);
});

test('an index that lists a vanished file is repaired, and a file with no entry is adopted', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  for (let n = 1; n <= 3; n++) archive.add({ snapshot: snap(n), timing: { USGS: { status: 'ok', ms: 50 } } });
  rmSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`));
  assert.deepEqual(archive.list().map(item => item.id), [idAt(3), idAt(1)]);
  assert.deepEqual(readIndex(dir).sweeps.map(item => item.id), [idAt(1), idAt(3)]);
  assert.equal(archive.get(idAt(2)), null);
  const copy = join(sweepsDir(dir), `${idAt(8)}.json.gz`);
  writeFileSync(copy, readFileSync(join(sweepsDir(dir), `${idAt(3)}.json.gz`)));
  assert.deepEqual(archive.list().map(item => item.id), [idAt(8), idAt(3), idAt(1)]);
  const adopted = readIndex(dir).sweeps.at(-1);
  assert.equal(adopted.id, idAt(8));
  assert.equal(adopted.timestamp, '2026-10-03T10:00:00.000Z', 'a timestamp that disagrees with the file name is taken from the name');
  assert.deepEqual(adopted.health.USGS, [0, null]);
});

test('a file name that looks like an id but is not a real date is skipped', t => {
  const dir = tmp(t);
  const log = recorder();
  const archive = archiveAt(dir, { logger: log });
  archive.add({ snapshot: snap(1) });
  writeFileSync(join(sweepsDir(dir), 'sweep-20269999T999999Z.json.gz'), gzipSync(JSON.stringify({ marker: 'impossible date' })));
  assert.deepEqual(archive.list().map(item => item.id), [idAt(1)]);
  assert.equal(log.lines.length, 1);
});

test('stale temporary files of a crashed write are removed once, other files are left alone', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  archive.add({ snapshot: snap(1) });
  const leftovers = [`${idAt(2)}.json.gz.4242.0b8a3c3e-1111-4222-8333-444455556666.tmp`, 'index.json.4242.0b8a3c3e-1111-4222-8333-444455556666.tmp'];
  for (const name of [...leftovers, 'notes.txt', 'other.tmp']) writeFileSync(join(sweepsDir(dir), name), 'x');
  archiveAt(dir).list();
  const names = readdirSync(sweepsDir(dir));
  for (const name of leftovers) assert.equal(names.includes(name), false, name);
  assert.ok(names.includes('notes.txt') && names.includes('other.tmp'));
  assert.ok(names.includes(`${idAt(1)}.json.gz`) && names.includes('index.json'));
});

test('healthSeries orders sources by domain then name, with null cells and a sweep limit', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  archive.add({
    snapshot: snap(1, { health: [row('USGS'), row('GDELT', { stale: true }), row('FRED', { err: true }), row('OFAC', { disabled: true }), row('ACLED'), row('Zeta-Custom'), row('Alpha-Custom')] }),
    timing: { USGS: { status: 'ok', ms: 120 }, GDELT: { status: 'stale', ms: 900 }, ACLED: { status: 'error', ms: 1500 }, OFAC: { status: 'disabled', ms: 0 } },
  });
  archive.add({
    snapshot: snap(2, { health: [row('USGS', { err: true }), row('GDELT'), row('WHO'), row('Zeta-Custom')] }),
    timing: { USGS: { status: 'ok', ms: 80 } },
  });
  archive.add({ snapshot: snap(3, { health: [row('GDELT'), row('EPA')] }), timing: { GDELT: { status: 'ok', ms: 40 }, EPA: { status: 'ok', ms: 70 } } });
  const full = archive.healthSeries({ sweeps: 3 });
  assert.deepEqual(full.sweeps, [1, 2, 3].map(n => ({ id: idAt(n), timestamp: at(n) })));
  assert.deepEqual(full.sources.map(item => item.source), ['ACLED', 'GDELT', 'USGS', 'FRED', 'OFAC', 'EPA', 'WHO', 'Alpha-Custom', 'Zeta-Custom']);
  const by = Object.fromEntries(full.sources.map(item => [item.source, item]));
  assert.equal(by.ACLED.domain, 'security');
  assert.equal(by.USGS.domain, 'hazards');
  assert.equal(by.FRED.domain, 'economy');
  assert.equal(by.OFAC.domain, 'sanctions');
  assert.equal(by.EPA.domain, 'health');
  assert.equal(by['Alpha-Custom'].domain, null);
  assert.deepEqual(by.ACLED.cells, [[2, 1500], null, null]);
  assert.deepEqual(by.GDELT.cells, [[1, 900], [0, null], [0, 40]], 'timing wins over the booleans; without timing the booleans decide');
  assert.deepEqual(by.USGS.cells, [[0, 120], [0, 80], null], 'a timing status wins over health[].err');
  assert.deepEqual(by.FRED.cells, [[2, null], null, null]);
  assert.deepEqual(by.OFAC.cells, [[3, 0], null, null]);
  assert.deepEqual(by.EPA.cells, [null, null, [0, 70]]);
  assert.deepEqual(by.WHO.cells, [null, [0, null], null]);
  assert.deepEqual(by['Zeta-Custom'].cells, [[0, null], [0, null], null]);
  const order = full.sources.map(item => (item.domain === null ? DOMAIN_IDS.length : DOMAIN_IDS.indexOf(item.domain)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'grouped by domain order');
  for (const item of full.sources) assert.equal(item.domain, domainOfSource(item.source));

  const last2 = archive.healthSeries({ sweeps: 2 });
  assert.deepEqual(last2.sweeps.map(item => item.id), [idAt(2), idAt(3)]);
  assert.deepEqual(last2.sources.map(item => item.source), ['GDELT', 'USGS', 'EPA', 'WHO', 'Zeta-Custom'], 'only sources of the selected sweeps');
  assert.deepEqual(last2.sources.find(item => item.source === 'GDELT').cells, [[0, null], [0, 40]]);
  assert.deepEqual(archive.healthSeries({ sweeps: 1 }).sweeps.map(item => item.id), [idAt(3)]);
  assert.equal(archive.healthSeries().sweeps.length, 3, 'the default window covers a small archive');
  for (const sweeps of [0, -1, 'x', NaN]) assert.equal(archive.healthSeries({ sweeps }).sweeps.length, 3, String(sweeps));
});

test('hostile source names stay plain data and never reach a prototype', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  const timing = JSON.parse('{"__proto__":{"status":"error","ms":9},"constructor":{"status":"ok","ms":1},"": {"status":"ok"}}');
  archive.add({ snapshot: snap(1, { health: [row('__proto__', { stale: true }), row('constructor'), row(''), row('x'.repeat(200)), row(null), row(7), null] }), timing });
  archive.add({ snapshot: snap(2, { health: [row('USGS')] }) });
  assert.equal({}.status, undefined);
  const names = ['USGS', '__proto__', 'constructor'];
  const series = archive.healthSeries();
  assert.deepEqual(series.sources.map(item => item.source).sort(), names);
  assert.deepEqual(series.sources.find(item => item.source === '__proto__').cells, [[2, 9], null]);
  assert.deepEqual(series.sources.find(item => item.source === 'constructor').cells, [[0, 1], null]);
  assert.deepEqual(archiveAt(dir).healthSeries(), series);
  writeFileSync(indexFile(dir), 'x');
  assert.deepEqual(archiveAt(dir).healthSeries().sources.map(item => item.source).sort(), names);
  assert.equal({}.polluted, undefined);
});

test('a write failure throws, leaves the previous index and files readable and flips the status', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  assert.equal(archive.status, 'ok');
  archive.add({ snapshot: snap(1), timing: { USGS: { status: 'ok', ms: 10 } } });
  const indexBefore = readFileSync(indexFile(dir), 'utf8');
  const filesBefore = readdirSync(sweepsDir(dir)).sort();
  mkdirSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`));
  assert.throws(() => archive.add({ snapshot: snap(2) }));
  assert.equal(archive.status, 'unavailable');
  assert.equal(readFileSync(indexFile(dir), 'utf8'), indexBefore);
  assert.deepEqual(readdirSync(sweepsDir(dir)).sort(), [...filesBefore, `${idAt(2)}.json.gz`].sort(), 'no temporary file is left behind');
  assert.deepEqual(plain(archive.get(idAt(1))), snap(1));
  assert.deepEqual(archive.list().map(item => item.id), [idAt(1)]);
  assert.equal(archive.status, 'unavailable', 'reads do not clear the failure');
  rmSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`), { recursive: true });
  assert.ok(archive.add({ snapshot: snap(3) }));
  assert.equal(archive.status, 'ok');
  assert.deepEqual(archive.list().map(item => item.id), [idAt(3), idAt(1)]);
});

test('an index that cannot be written rolls the new file back and throws', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  mkdirSync(indexFile(dir), { recursive: true });
  assert.throws(() => archive.add({ snapshot: snap(1) }));
  assert.equal(archive.status, 'unavailable');
  assert.deepEqual(gzFiles(dir), []);
  assert.deepEqual(readdirSync(sweepsDir(dir)), ['index.json']);
  rmSync(indexFile(dir), { recursive: true });
  assert.ok(archive.add({ snapshot: snap(1) }));
  assert.equal(archive.status, 'ok');
  assert.deepEqual(gzFiles(dir), [`${idAt(1)}.json.gz`]);
});

test('a failed add never deletes older sweeps even when the count cap is reached', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir, { count: 2 });
  archive.add({ snapshot: snap(1) });
  archive.add({ snapshot: snap(2) });
  mkdirSync(join(sweepsDir(dir), `${idAt(3)}.json.gz`));
  assert.throws(() => archive.add({ snapshot: snap(3) }));
  assert.deepEqual(archive.list().map(item => item.id), [idAt(2), idAt(1)]);
  assert.equal(archive.get(idAt(1)).marker, 'sweep 1');
});

test('a snapshot too large to read back again is refused before anything is written', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  const started = performance.now();
  assert.throws(() => archive.add({ snapshot: snap(1, { huge: 'x'.repeat(65 * 1024 * 1024) }) }), RangeError);
  assert.ok(performance.now() - started < 5000);
  assert.equal(archive.status, 'unavailable');
  assert.deepEqual(existsSync(sweepsDir(dir)) ? gzFiles(dir) : [], []);
  assert.ok(archive.add({ snapshot: snap(1) }));
  assert.equal(archive.status, 'ok');
});

test('get refuses hostile ids, and reads only files that really are sweeps', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  archive.add({ snapshot: snap(1) });
  writeFileSync(join(dir, 'secret.json.gz'), gzipSync(JSON.stringify({ secret: true })));
  for (const bad of ['../secret', '..\\secret', '../sweeps/' + idAt(1), `${idAt(1)}/../${idAt(1)}`, `${idAt(1)}.json.gz`, 'index', 'sweep-1', '%2e%2e%2fsecret',
    '', 'a'.repeat(100 * 1024), undefined, null, 7, {}, [idAt(1)]]) {
    assert.equal(archive.get(bad), null, String(bad).slice(0, 40));
  }
  assert.equal(archiveAt(join(dir, 'nowhere')).get(idAt(1)), null, 'a missing archive directory is just empty');
  assert.equal(archive.get(idAt(9)), null, 'a valid id with no file');
  mkdirSync(join(sweepsDir(dir), `${idAt(7)}.json.gz`));
  assert.equal(archive.get(idAt(7)), null, 'a directory with a sweep name');
});

test('a file that is gzip but not a JSON object is treated as unreadable', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  archive.add({ snapshot: snap(1) });
  const bodies = { 2: 'plain text', 3: '[1,2,3]', 4: 'null', 5: '"string"', 6: '{"half":', 7: '42' };
  for (const [n, body] of Object.entries(bodies)) writeFileSync(join(sweepsDir(dir), `${idAt(Number(n))}.json.gz`), gzipSync(Buffer.from(body)));
  for (const n of Object.keys(bodies)) assert.equal(archive.get(idAt(Number(n))), null, n);
  assert.deepEqual(archive.list().map(item => item.id), [idAt(1)]);
});

test('gzip bombs are refused quickly and do not crash the archive', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  archive.add({ snapshot: snap(1) });
  const MiB = 1024 * 1024;
  const zeros = gzipSync(Buffer.alloc(100 * MiB));
  // A bomb that would decode to a perfectly valid JSON object if nothing capped the output.
  const json = gzipSync(Buffer.concat([Buffer.from('{"filler":"'), Buffer.alloc(100 * MiB, 'x'), Buffer.from('"}')]));
  for (const bomb of [zeros, json]) assert.ok(bomb.length < MiB, 'the compressed bomb is small');
  writeFileSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`), zeros);
  writeFileSync(join(sweepsDir(dir), `${idAt(3)}.json.gz`), json);
  for (const n of [2, 3]) {
    const started = performance.now();
    assert.equal(archive.get(idAt(n)), null, `bomb ${n}`);
    assert.ok(performance.now() - started < 2000, `get gave up on bomb ${n} within 2 s`);
  }
  const reopened = archiveAt(dir);
  const started = performance.now();
  assert.deepEqual(reopened.list().map(item => item.id), [idAt(1)]);
  assert.ok(performance.now() - started < 2000, 'the rebuild skipped both within 2 s');
  assert.equal(reopened.get(idAt(1)).marker, 'sweep 1');
  assert.equal(archive.status, 'ok');
});

test('a compressed file above the size cap is refused even when its first member is a valid sweep', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  archive.add({ snapshot: snap(1) });
  // Node decodes concatenated gzip members and only stops at trailing bytes that do not start a new member (the zeros here),
  // so the first member would decode as a valid sweep and only the size check keeps this file out.
  const padded = Buffer.concat([gzipSync(JSON.stringify(snap(2))), Buffer.alloc(65 * 1024 * 1024)]);
  writeFileSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`), padded);
  const started = performance.now();
  assert.equal(archive.get(idAt(2)), null);
  assert.deepEqual(archiveAt(dir).list().map(item => item.id), [idAt(1)]);
  assert.ok(performance.now() - started < 2000);
});

test('status is ok until an add fails and ok again after a good add', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  assert.equal(archive.status, 'ok');
  assert.ok(archive.add({ snapshot: snap(1) }));
  assert.equal(archive.status, 'ok');
  mkdirSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`));
  assert.throws(() => archive.add({ snapshot: snap(2) }));
  assert.equal(archive.status, 'unavailable');
  assert.equal(archive.add({ snapshot: snap(1) }), null, 'a duplicate is not a recovery');
  assert.equal(archive.status, 'unavailable');
  assert.ok(archive.add({ snapshot: snap(3) }));
  assert.equal(archive.status, 'ok');
});

test('a second archive on the same directory sees what the first one wrote', t => {
  const dir = tmp(t);
  const first = archiveAt(dir);
  first.add({ snapshot: snap(1), timing: { USGS: { status: 'ok', ms: 12 } } });
  first.add({ snapshot: snap(2) });
  const second = archiveAt(dir);
  assert.deepEqual(second.list().map(item => item.id), [idAt(2), idAt(1)]);
  assert.deepEqual(second.healthSeries().sources.find(item => item.source === 'USGS').cells, [[0, 12], [0, null]]);
  assert.equal(second.latest().marker, 'sweep 2');
  second.add({ snapshot: snap(3) });
  assert.deepEqual(first.list().map(item => item.id), [idAt(3), idAt(2), idAt(1)]);
});

// A readFile seam that records which sweep files are read and fails for chosen ids with a non-corruption error.
function readSeam(failing = []) {
  const reads = [];
  return {
    reads,
    readFile(path) {
      const id = basename(path).replace('.json.gz', '');
      reads.push(id);
      if (failing.includes(id)) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      return readFileSync(path);
    },
  };
}

test('the index is written before any pruned sweep is deleted', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir, { count: 2 });
  archive.add({ snapshot: snap(1) });
  archive.add({ snapshot: snap(2) });
  rmSync(indexFile(dir), { force: true });
  mkdirSync(indexFile(dir));
  assert.throws(() => archive.add({ snapshot: snap(3) }));
  assert.deepEqual(gzFiles(dir), [1, 2].map(n => `${idAt(n)}.json.gz`), 'the older sweeps survive, the new file is taken back');
  assert.equal(archive.status, 'unavailable');
  rmSync(indexFile(dir), { recursive: true });
  assert.ok(archive.add({ snapshot: snap(3) }));
  assert.deepEqual(archive.list().map(item => item.id), [idAt(3), idAt(2)]);
});

test('a sweep older than everything the retention keeps is not stored (the clock went back)', t => {
  const dir = tmp(t);
  const log = recorder();
  const archive = archiveAt(dir, { count: 2, logger: log });
  archive.add({ snapshot: snap(8) });
  archive.add({ snapshot: snap(9) });
  const indexBefore = readFileSync(indexFile(dir), 'utf8');
  assert.equal(archive.add({ snapshot: snap(4) }), null);
  assert.equal(log.lines.length, 1);
  assert.match(log.lines[0], new RegExp(idAt(4)));
  assert.equal(readFileSync(indexFile(dir), 'utf8'), indexBefore);
  assert.deepEqual(gzFiles(dir), [8, 9].map(n => `${idAt(n)}.json.gz`), 'nothing was written and nothing was deleted');
  assert.equal(archive.status, 'ok');
  // The same time fits when the cap has room, and is then kept in its place.
  const roomy = archiveAt(tmp(t), { count: 3 });
  roomy.add({ snapshot: snap(8) });
  roomy.add({ snapshot: snap(9) });
  assert.equal(roomy.add({ snapshot: snap(4) }).id, idAt(4));
  assert.deepEqual(roomy.list().map(item => item.id), [idAt(9), idAt(8), idAt(4)]);
});

test('a sweep that the byte cap would drop at once is not stored either', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir, { maxMb: 0.001 });
  archive.add({ snapshot: heavy(5, 2000) });
  assert.equal(archive.add({ snapshot: heavy(2, 2000) }), null);
  assert.deepEqual(archive.list().map(item => item.id), [idAt(5)]);
  assert.deepEqual(gzFiles(dir), [`${idAt(5)}.json.gz`]);
});

test('a file that cannot be read for a non-corruption reason is skipped once, never re-read and never deleted', t => {
  const dir = tmp(t);
  const writer = archiveAt(dir, { count: 2 });
  for (const n of [2, 3]) writer.add({ snapshot: snap(n) });
  writeFileSync(join(sweepsDir(dir), `${idAt(1)}.json.gz`), readFileSync(join(sweepsDir(dir), `${idAt(3)}.json.gz`)));
  const seam = readSeam([idAt(1)]);
  const log = recorder();
  const archive = archiveAt(dir, { count: 2, logger: log, readFile: seam.readFile });
  assert.deepEqual(archive.list().map(item => item.id), [idAt(3), idAt(2)]);
  assert.deepEqual(seam.reads, [idAt(1), idAt(2), idAt(3)], 'the rebuild read every file once');
  assert.equal(log.lines.length, 1);
  assert.match(log.lines[0], new RegExp(idAt(1)));
  const indexAfterRebuild = readFileSync(indexFile(dir), 'utf8');
  for (let round = 0; round < 3; round++) { archive.list(); archive.healthSeries(); }
  assert.equal(seam.reads.length, 3, 'later reads do not rebuild again');
  assert.equal(log.lines.length, 1);
  assert.equal(readFileSync(indexFile(dir), 'utf8'), indexAfterRebuild, 'and do not rewrite the index');
  archive.add({ snapshot: snap(4) });
  assert.equal(seam.reads.length, 3, 'adding does not read the files either');
  assert.deepEqual(archive.list().map(item => item.id), [idAt(4), idAt(3)]);
  assert.deepEqual(gzFiles(dir), [1, 3, 4].map(n => `${idAt(n)}.json.gz`), 'the unreadable file is older than everything kept, yet it stays');
});

test('a file that vanishes between the size check and the read is missing, not skipped for the process lifetime', t => {
  const dir = tmp(t);
  const writer = archiveAt(dir);
  for (const n of [1, 2]) writer.add({ snapshot: snap(n) });
  rmSync(indexFile(dir), { force: true });
  let vanish = true;
  const log = recorder();
  const archive = archiveAt(dir, { logger: log, readFile(path) {
    if (vanish && basename(path) === `${idAt(1)}.json.gz`) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
    return readFileSync(path);
  } });
  assert.deepEqual(archive.list().map(item => item.id), [idAt(2)]);
  assert.deepEqual(log.lines, [], 'a missing file is no warning');
  assert.equal(archive.get(idAt(1)), null);
  vanish = false;
  // Not remembered as unreadable: once the file reads again (a new file with that name) it is listed again.
  assert.deepEqual(archive.list().map(item => item.id), [idAt(2), idAt(1)]);
});

test('an index that cannot be written is not retried or re-read from every file on every call', t => {
  const dir = tmp(t);
  const writer = archiveAt(dir);
  for (const n of [1, 2]) writer.add({ snapshot: snap(n) });
  rmSync(indexFile(dir), { force: true });
  mkdirSync(indexFile(dir));
  const seam = readSeam();
  const log = recorder();
  const archive = archiveAt(dir, { logger: log, readFile: seam.readFile });
  for (let round = 0; round < 3; round++) {
    assert.deepEqual(archive.list().map(item => item.id), [idAt(2), idAt(1)]);
    assert.equal(archive.healthSeries().sweeps.length, 2);
  }
  assert.deepEqual(seam.reads, [idAt(1), idAt(2)], 'one rebuild, every file read once');
  assert.equal(log.lines.length, 1, 'the failed write is reported once');
  rmSync(indexFile(dir), { recursive: true });
  assert.equal(archive.list().length, 2);
  assert.equal(existsSync(indexFile(dir)), false, 'the same ids are not written again by a read');
  assert.equal(seam.reads.length, 2);
  assert.ok(archive.add({ snapshot: snap(3) }));
  assert.deepEqual(readIndex(dir).sweeps.map(item => item.id), [idAt(1), idAt(2), idAt(3)]);
  assert.deepEqual(archive.list().map(item => item.id), [idAt(3), idAt(2), idAt(1)]);
  assert.equal(seam.reads.length, 2, 'the entries of the failed rebuild were reused, the files were not read again');
});

test('corrupt files are deleted once they are older than every kept sweep, newer ones and unknown ones stay', t => {
  const dir = tmp(t);
  const writer = archiveAt(dir, { count: 2 });
  for (const n of [3, 4]) writer.add({ snapshot: snap(n) });
  const valid = readFileSync(join(sweepsDir(dir), `${idAt(3)}.json.gz`));
  const put = (n, bytes) => writeFileSync(join(sweepsDir(dir), `${idAt(n)}.json.gz`), bytes);
  put(1, Buffer.alloc(0));
  put(2, valid.subarray(0, 10));
  put(9, Buffer.alloc(0));
  const log = recorder();
  const archive = archiveAt(dir, { count: 2, logger: log });
  assert.deepEqual(archive.list().map(item => item.id), [idAt(4), idAt(3)], 'the restart discovers the corrupt files');
  assert.equal(gzFiles(dir).length, 5, 'discovering them deletes nothing');
  rmSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`));
  assert.ok(archive.add({ snapshot: snap(5) }));
  assert.deepEqual(gzFiles(dir), [4, 5, 9].map(n => `${idAt(n)}.json.gz`), 'the old corrupt file went, the pruned sweep went, the newer corrupt file stayed');
  assert.equal(log.lines.some(line => line.includes('could not delete')), false, 'a corrupt file that vanished by itself is not an error');
  archive.add({ snapshot: snap(6) });
  assert.ok(gzFiles(dir).includes(`${idAt(9)}.json.gz`), 'still newer than the oldest kept sweep');
  archive.add({ snapshot: snap(10) });
  archive.add({ snapshot: snap(11) });
  assert.deepEqual(gzFiles(dir), [10, 11].map(n => `${idAt(n)}.json.gz`), 'once it is older than everything kept it goes too');
  assert.deepEqual(archive.list().map(item => item.id), [idAt(11), idAt(10)]);
});

// An unlink seam: fails with EBUSY (an open viewer or a virus scanner on Windows) for the ids in `locked` until released.
function unlinkSeam(locked = []) {
  const held = new Set(locked);
  const calls = [];
  return {
    calls,
    release: () => held.clear(),
    unlink(path) {
      const id = basename(path).replace('.json.gz', '');
      calls.push(id);
      if (held.has(id)) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      unlinkSync(path);
    },
  };
}

test('a pruned sweep whose file cannot be deleted is remembered: no rebuild, the timings survive, the deletion is retried', t => {
  const dir = tmp(t);
  const log = recorder();
  const reads = readSeam();
  const seam = unlinkSeam([idAt(1)]);
  const archive = archiveAt(dir, { count: 2, logger: log, readFile: reads.readFile, unlink: seam.unlink });
  const timing = n => ({ USGS: { status: 'ok', ms: 100 + n } });
  for (const n of [1, 2, 3]) archive.add({ snapshot: snap(n), timing: timing(n) });
  assert.deepEqual(gzFiles(dir), [1, 2, 3].map(n => `${idAt(n)}.json.gz`), 'the locked file is still on disk');
  assert.equal(log.lines.filter(line => line.includes('could not delete')).length, 1);
  const indexAfter = readFileSync(indexFile(dir), 'utf8');
  assert.deepEqual(archive.list().map(item => item.id), [idAt(3), idAt(2)], 'the retention decision stands');
  assert.deepEqual(archive.healthSeries().sources.find(item => item.source === 'USGS').cells, [[0, 102], [0, 103]], 'the run times are not nulled by a rebuild');
  assert.equal(reads.reads.length, 0, 'no sweep file was read again');
  assert.equal(readFileSync(indexFile(dir), 'utf8'), indexAfter, 'and the index was not rewritten');
  // Still locked: the retry fails quietly, the pruned sweep 2 goes.
  archive.add({ snapshot: snap(4), timing: timing(4) });
  assert.deepEqual(gzFiles(dir), [1, 3, 4].map(n => `${idAt(n)}.json.gz`));
  assert.equal(log.lines.filter(line => line.includes('could not delete')).length, 1, 'the same file is not reported on every sweep');
  assert.equal(reads.reads.length, 0);
  assert.deepEqual(archive.healthSeries().sources.find(item => item.source === 'USGS').cells, [[0, 103], [0, 104]]);
  seam.release();
  archive.add({ snapshot: snap(5), timing: timing(5) });
  assert.deepEqual(gzFiles(dir), [4, 5].map(n => `${idAt(n)}.json.gz`), 'unlocked, the next add removes it with the sweep it prunes');
  const callsForOne = seam.calls.filter(id => id === idAt(1)).length;
  archive.add({ snapshot: snap(6), timing: timing(6) });
  assert.equal(seam.calls.filter(id => id === idAt(1)).length, callsForOne, 'a deleted file is not retried again');
  assert.deepEqual(archive.list().map(item => item.id), [idAt(6), idAt(5)]);
  assert.equal(reads.reads.length, 0);
});

test('a file that was removed by hand while its deletion was pending is forgotten without a warning', t => {
  const dir = tmp(t);
  const log = recorder();
  const seam = unlinkSeam([idAt(1)]);
  const archive = archiveAt(dir, { count: 2, logger: log, unlink: seam.unlink });
  for (const n of [1, 2, 3]) archive.add({ snapshot: snap(n) });
  rmSync(join(sweepsDir(dir), `${idAt(1)}.json.gz`));
  seam.release();
  archive.add({ snapshot: snap(4) });
  assert.equal(log.lines.filter(line => line.includes('could not delete')).length, 1, 'only the first failure was reported');
  const calls = seam.calls.filter(id => id === idAt(1)).length;
  archive.add({ snapshot: snap(5) });
  assert.equal(seam.calls.filter(id => id === idAt(1)).length, calls, 'an ENOENT ends the retries');
  assert.deepEqual(gzFiles(dir), [4, 5].map(n => `${idAt(n)}.json.gz`));
});

test('an explicit rebuild leaves a sweep with a pending deletion out of the index', t => {
  const dir = tmp(t);
  const seam = unlinkSeam([idAt(1)]);
  const archive = archiveAt(dir, { count: 2, unlink: seam.unlink });
  for (const n of [1, 2, 3]) archive.add({ snapshot: snap(n) });
  assert.equal(archive.rebuildIndex(), 2);
  assert.deepEqual(readIndex(dir).sweeps.map(item => item.id), [idAt(2), idAt(3)]);
  assert.deepEqual(archive.list().map(item => item.id), [idAt(3), idAt(2)]);
});

test('getRaw returns the stored gzip bytes of a valid sweep and null for everything get refuses', t => {
  const dir = tmp(t);
  const archive = archiveAt(dir);
  const added = archive.add({ snapshot: snap(1) });
  const stored = readFileSync(join(sweepsDir(dir), `${idAt(1)}.json.gz`));
  const raw = archive.getRaw(idAt(1));
  assert.ok(Buffer.isBuffer(raw));
  assert.ok(raw.equals(stored), 'exactly the bytes on disk');
  assert.equal(raw.length, added.bytes);
  assert.equal(gunzipSync(raw).toString('utf8'), JSON.stringify(snap(1)), 'which decode to the snapshot JSON');
  const put = (n, bytes) => writeFileSync(join(sweepsDir(dir), `${idAt(n)}.json.gz`), bytes);
  put(2, Buffer.alloc(0));
  put(3, stored.subarray(0, 12));
  put(4, 'plain text, not gzip');
  put(5, gzipSync('[1,2,3]'));
  put(6, gzipSync('"a string"'));
  put(7, gzipSync(Buffer.concat([Buffer.from('{"filler":"'), Buffer.alloc(100 * 1024 * 1024, 'x'), Buffer.from('"}')])));
  for (const n of [2, 3, 4, 5, 6, 7, 9]) assert.equal(archive.getRaw(idAt(n)), null, `sweep ${n}`);
  for (const bad of ['../x', `${idAt(1)}.json.gz`, 'sweep-1', '', undefined, null, 7, {}, [idAt(1)]]) assert.equal(archive.getRaw(bad), null, String(bad));
  mkdirSync(join(sweepsDir(dir), `${idAt(8)}.json.gz`));
  assert.equal(archive.getRaw(idAt(8)), null, 'a directory with a sweep name');
  assert.equal(archiveAt(join(dir, 'nowhere')).getRaw(idAt(1)), null);
});

test('getRaw is judged exactly like get: a corrupt file is reported once and a transient failure is not', t => {
  const dir = tmp(t);
  const log = recorder();
  const archive = archiveAt(dir, { logger: log, readFile: readSeam([idAt(2)]).readFile });
  archive.add({ snapshot: snap(1) });
  writeFileSync(join(sweepsDir(dir), `${idAt(3)}.json.gz`), 'broken');
  writeFileSync(join(sweepsDir(dir), `${idAt(2)}.json.gz`), gzipSync(JSON.stringify(snap(2))));
  assert.equal(archive.getRaw(idAt(3)), null);
  assert.equal(archive.getRaw(idAt(3)), null);
  assert.equal(log.lines.filter(line => line.includes(idAt(3))).length, 1, 'reported once, like get');
  assert.equal(archive.getRaw(idAt(2)), null, 'a file that cannot be read is no sweep to serve');
  assert.equal(log.lines.filter(line => line.includes(idAt(2))).length, 0, 'but is not reported as corrupt');
  assert.ok(archive.getRaw(idAt(1)));
});
