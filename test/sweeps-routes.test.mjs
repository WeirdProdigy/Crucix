import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { installApiErrorHandler } from '../lib/api-errors.mjs';
import { installHttpSecurity } from '../lib/http-security.mjs';
import { freshLiveSnapshot } from '../lib/intelligence/live-sources.mjs';
import { SweepArchive } from '../lib/sweeps/archive.mjs';
import { buildChanges, mergeChanges } from '../lib/sweeps/changes.mjs';
import { installSweepRoutes } from '../lib/sweeps/routes.mjs';
import { archiveSweep } from '../lib/sweeps/step.mjs';

const BASE = Date.parse('2026-10-03T08:00:00.000Z');
const MINUTE = 60000;
const iso = minutes => new Date(BASE + minutes * MINUTE).toISOString();
const idOf = minutes => `sweep-${iso(minutes).slice(0, 19).replace(/[-:]/g, '')}Z`;
const eid = n => `event-${n.toString(16).padStart(32, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const quiet = { warn() {}, error() {}, log() {} };
const row = (n, flags = {}) => ({ n, err: false, stale: false, disabled: false, ...flags });

// A changes object as buildChanges writes it: one new event, one source transition, at the sweep's own time.
function changesAt(minutes, n) {
  return {
    since: iso(minutes - 15), at: iso(minutes), baseline: false,
    events: { new: [{ id: eid(n), title: `Event ${n}`, kind: 'news', source: 'USGS', domain: 'hazards', severity: 'watch', observedAt: iso(minutes) }], newTotal: 1, expiredTotal: 0 },
    sources: [{ source: `Source ${n}`, domain: null, from: 'ok', to: 'error' }],
    signals: [], domains: { hazards: 1 },
  };
}

function snapshotAt(minutes, n, extra = {}) {
  return {
    meta: { timestamp: iso(minutes), sourcesQueried: 2, sourcesOk: 1 },
    health: [row('USGS'), row('GDELT', { err: true })],
    events: [], changes: changesAt(minutes, n), marker: `sweep ${n} – árvíz <b>`, ...extra,
  };
}

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-sweep-routes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Every archive call is recorded, so a test can prove that an invalid id never reaches the archive.
function spied(archive) {
  const calls = [];
  const wrap = name => (...args) => { calls.push([name, ...args]); return archive[name](...args); };
  return { calls, archive: { list: wrap('list'), get: wrap('get'), getRaw: wrap('getRaw'), latest: wrap('latest'), healthSeries: wrap('healthSeries'), retention: wrap('retention'), get status() { return archive.status; } } };
}

async function serve(t, { archive, getCurrent = () => null, now = () => BASE, auth = {} }) {
  const app = express();
  installHttpSecurity(app, auth);
  installSweepRoutes(app, { archive, getCurrent, now });
  installApiErrorHandler(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  // node:http sends the path as written (fetch would resolve %2e%2e segments before sending them).
  const get = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
  // The same with the body as bytes: a gzip response must not go through a string decoder.
  const bytes = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
  return { get, bytes };
}

// An archive in a temporary runs directory holding the given [minutes, n] sweeps.
function filled(t, sweeps, options = {}) {
  const dir = tmp(t);
  const archive = new SweepArchive(dir, { logger: quiet, ...options });
  const stored = new Map();
  for (const [minutes, n] of sweeps) {
    const snapshot = snapshotAt(minutes, n);
    archive.add({ snapshot, timing: { USGS: { status: 'ok', ms: 120 + n } } });
    stored.set(idOf(minutes), snapshot);
  }
  return { dir, archive, stored };
}

// Captures console.error so a 503 test can check what is logged and keep the test output clean.
function captureErrors(t) {
  const lines = [];
  const original = console.error;
  console.error = (...parts) => lines.push(parts.join(' '));
  t.after(() => { console.error = original; });
  return lines;
}

test('GET /api/sweeps lists newest first with the retention, and limit is an integer from 1 to the retention count', async t => {
  const { archive } = filled(t, [[0, 1], [15, 2], [30, 3]], { count: 5, maxMb: 8 });
  const { get } = await serve(t, { archive });
  const all = await get('/api/sweeps');
  assert.equal(all.status, 200);
  assert.equal(all.headers['cache-control'], 'no-store');
  assert.deepEqual(all.json().retention, { count: 5, maxMb: 8 });
  assert.deepEqual(all.json().sweeps.map(item => item.id), [idOf(30), idOf(15), idOf(0)]);
  assert.deepEqual(all.json().sweeps[0], { id: idOf(30), timestamp: iso(30), ok: 1, total: 2, changeCounts: { events: 1, sources: 1, signals: 0 } });
  assert.deepEqual((await get('/api/sweeps?limit=2')).json().sweeps.map(item => item.id), [idOf(30), idOf(15)]);
  assert.equal((await get('/api/sweeps?limit=1')).json().sweeps.length, 1);
  assert.equal((await get('/api/sweeps?limit=5')).status, 200, 'the retention count itself is allowed');
  for (const query of ['limit=0', 'limit=6', 'limit=673', 'limit=-1', 'limit=1.5', 'limit=two', 'limit=', 'limit=%202', 'limit=1&limit=2', 'limit=99999999999999999999', 'limit[]=1', 'limit[a]=1']) {
    const response = await get(`/api/sweeps?${query}`);
    assert.equal(response.status, 400, query);
    assert.deepEqual(Object.keys(response.json()).sort(), ['code', 'error', 'field'], query);
    // Express 5 parses `limit[]` as a key of its own, which is then an unknown key.
    assert.equal(response.json().field, query.includes('[') ? 'query' : 'limit', query);
    assert.equal(response.json().code, 'INVALID_FILTER', query);
  }
});

test('an unknown query key is a 400 on every route', async t => {
  const { archive } = filled(t, [[0, 1]]);
  const { get } = await serve(t, { archive });
  for (const path of ['/api/sweeps?limt=2', `/api/sweeps/${idOf(0)}?full=1`, '/api/changes?window=last&since=x', '/api/source-health?sweep=2', '/api/changes?__proto__=1', '/api/sweeps?constructor=1']) {
    const response = await get(path);
    assert.equal(response.status, 400, path);
    assert.deepEqual(response.json(), { error: 'Unknown query parameter', code: 'INVALID_FILTER', field: 'query' }, path);
  }
});

test('GET /api/sweeps/:id returns the stored snapshot byte for byte, untouched by the live freshness filter', async t => {
  const liveSources = [{ source: 'USGS', status: 'ok', observedAt: iso(0), observations: [] }];
  const dir = tmp(t);
  const archive = new SweepArchive(dir, { logger: quiet });
  const snapshot = snapshotAt(0, 1, { liveSources, events: [{ id: eid(9), title: 'Old live row', source: { name: 'USGS' } }] });
  archive.add({ snapshot });
  // Two days later the live filter would drop or expire the old live rows; the replay must not.
  const { get } = await serve(t, { archive, now: () => BASE + 48 * 60 * MINUTE });
  const response = await get(`/api/sweeps/${idOf(0)}`);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^application\/json/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body, JSON.stringify(snapshot));
});

test('hostile sweep ids are refused before the archive is touched; well-formed unknown ids are a 404', async t => {
  const { dir, archive: real } = filled(t, [[0, 1]]);
  // A gzip file that a path escape would reach: it must never be served.
  writeFileSync(join(dir, 'secret.json.gz'), gzipSync(JSON.stringify({ secret: 'outside the archive' })));
  const { calls, archive } = spied(real);
  const { get } = await serve(t, { archive });
  const hostile = ['/api/sweeps/..%2fsecret', '/api/sweeps/..%2Fsecret', '/api/sweeps/%2e%2e', '/api/sweeps/%2E%2E%2Fsecret', '/api/sweeps/sweep-1',
    `/api/sweeps/${'a'.repeat(10 * 1024)}`, `/api/sweeps/${idOf(0)}%5C`, `/api/sweeps/..%5C${idOf(0)}`, '/api/sweeps/sweep-20261003T080000Z%00',
    `/api/sweeps/${idOf(0).toLowerCase()}`, `/api/sweeps/${idOf(0)}.json.gz`, '/api/sweeps/%2e%2e%2fsweeps%2findex', '/api/sweeps/%E0%A4%A'];
  for (const path of hostile) {
    const response = await get(path);
    assert.equal(response.status, 400, path.slice(0, 60));
    // Also the broken percent-encoding, which fails in the router and is answered by the API's error handler: JSON, never
    // Express's HTML page with a stack.
    assert.deepEqual(response.json(), path === '/api/sweeps/%E0%A4%A' ? { error: 'Invalid path parameter', code: 'INVALID_FILTER', field: 'id' } : { error: 'Invalid sweep ID', code: 'INVALID_FILTER', field: 'id' }, path.slice(0, 60));
  }
  // A raw ../ is several path segments: no route of the archive matches at all.
  assert.equal((await get('/api/sweeps/../../secret.json.gz')).status, 404);
  assert.deepEqual(calls, [], 'no invalid id reached the archive');
  for (const id of ['sweep-20261003T090000Z', 'sweep-20261399T999999Z']) {
    const response = await get(`/api/sweeps/${id}`);
    assert.equal(response.status, 404, id);
    assert.deepEqual(response.json(), { error: 'Sweep not found' });
  }
  assert.deepEqual(calls, [['get', 'sweep-20261003T090000Z'], ['get', 'sweep-20261399T999999Z']]);
});

test('a stored sweep that is corrupt, empty or deleted is a 404 with the generic body', async t => {
  const { dir, archive } = filled(t, [[0, 1], [15, 2], [30, 3]]);
  writeFileSync(join(dir, 'sweeps', `${idOf(0)}.json.gz`), 'not gzip at all');
  writeFileSync(join(dir, 'sweeps', `${idOf(15)}.json.gz`), Buffer.alloc(0));
  rmSync(join(dir, 'sweeps', `${idOf(30)}.json.gz`));
  const { get } = await serve(t, { archive });
  for (const minutes of [0, 15, 30]) {
    const response = await get(`/api/sweeps/${idOf(minutes)}`);
    assert.equal(response.status, 404, idOf(minutes));
    assert.deepEqual(response.json(), { error: 'Sweep not found' });
  }
});

test('window=last serves the current changes, else the newest archived changes, else an empty baseline', async t => {
  const { archive } = filled(t, [[0, 1], [15, 2]]);
  const current = { changes: changesAt(30, 7) };
  let snapshot = current;
  const { get } = await serve(t, { archive, getCurrent: () => snapshot });
  assert.deepEqual((await get('/api/changes?window=last')).json(), current.changes);
  assert.deepEqual((await get('/api/changes')).json(), current.changes, 'last is the default window');
  snapshot = { meta: {} };
  assert.deepEqual((await get('/api/changes')).json(), changesAt(15, 2), 'a current snapshot without changes (the startup reload) falls back to the archive');
  snapshot = null;
  assert.deepEqual((await get('/api/changes')).json(), changesAt(15, 2));
  const empty = await serve(t, { archive: new SweepArchive(tmp(t), { logger: quiet }) });
  const baseline = (await empty.get('/api/changes?window=last')).json();
  assert.deepEqual(baseline, plain(mergeChanges([])));
  assert.equal(baseline.baseline, true);
  assert.equal(baseline.since, null);
  assert.deepEqual(baseline.events, { new: [], newTotal: 0, expiredTotal: 0 });
});

test('a time window merges the archived changes inside [now - window, now], oldest first', async t => {
  // Sweeps 7 h, 5 h, 90 min and 30 min before "now", and one 10 min after it (a clock that went back).
  const now = BASE + 10 * 60 * MINUTE;
  const at = hoursBefore => 10 * 60 - hoursBefore * 60;
  const sweeps = [[at(7), 1], [at(5), 2], [at(1.5), 3], [at(0.5), 4], [10 * 60 + 10, 5]];
  const { archive } = filled(t, sweeps);
  const { get } = await serve(t, { archive, now: () => now, getCurrent: () => ({ changes: changesAt(10 * 60, 99) }) });
  const expected = minutesList => plain(mergeChanges(minutesList.map(([minutes, n]) => changesAt(minutes, n))));
  const sixHours = (await get('/api/changes?window=6h')).json();
  assert.deepEqual(sixHours, expected(sweeps.slice(1, 4)));
  assert.deepEqual(sixHours.sources.map(item => item.source), ['Source 2', 'Source 3', 'Source 4'], 'transitions in time order');
  assert.equal(sixHours.since, iso(at(5) - 15));
  assert.equal(sixHours.at, iso(at(0.5)));
  assert.deepEqual((await get('/api/changes?window=1h')).json(), expected(sweeps.slice(3, 4)));
  assert.deepEqual((await get('/api/changes?window=24h')).json(), expected(sweeps.slice(0, 4)));
  // Nothing archived in the window: the baseline shape with since/at null means "nothing in this window".
  const later = await serve(t, { archive, now: () => now + 30 * 60 * MINUTE });
  assert.deepEqual((await later.get('/api/changes?window=1h')).json(), plain(mergeChanges([])));
});

test('a window skips sweeps whose file went bad and sweeps without changes', async t => {
  const now = BASE + 60 * MINUTE;
  const { dir, archive } = filled(t, [[0, 1], [15, 2], [30, 3]]);
  archive.add({ snapshot: { meta: { timestamp: iso(45) }, health: [] } });
  writeFileSync(join(dir, 'sweeps', `${idOf(15)}.json.gz`), 'broken');
  const { get } = await serve(t, { archive, now: () => now });
  assert.deepEqual((await get('/api/changes?window=1h')).json(), plain(mergeChanges([changesAt(0, 1), changesAt(30, 3)])));
});

test('window must be last, 1h, 6h or 24h', async t => {
  const { archive } = filled(t, [[0, 1]]);
  const { get } = await serve(t, { archive });
  for (const query of ['window=2d', 'window=', 'window=LAST', 'window=1H', 'window=last&window=1h', 'window[]=last', 'window=6h%00']) {
    const response = await get(`/api/changes?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.json().field, query.includes('[') ? 'query' : 'window', query);
    assert.equal(response.json().code, 'INVALID_FILTER', query);
  }
});

test('GET /api/source-health returns the matrix oldest to newest; sweeps is an integer from 1 to the retention count', async t => {
  const { archive } = filled(t, [[0, 1], [15, 2], [30, 3]], { count: 4 });
  const { get } = await serve(t, { archive });
  const all = (await get('/api/source-health')).json();
  assert.deepEqual(Object.keys(all), ['sweeps', 'sources']);
  assert.deepEqual(all.sweeps, [0, 15, 30].map(minutes => ({ id: idOf(minutes), timestamp: iso(minutes) })));
  assert.deepEqual(all.sources.find(item => item.source === 'USGS'), { source: 'USGS', domain: 'hazards', cells: [[0, 121], [0, 122], [0, 123]] });
  assert.deepEqual(all.sources.find(item => item.source === 'GDELT').cells, [[2, null], [2, null], [2, null]]);
  const two = (await get('/api/source-health?sweeps=2')).json();
  assert.deepEqual(two.sweeps.map(item => item.id), [idOf(15), idOf(30)]);
  assert.ok(two.sources.every(item => item.cells.length === 2));
  assert.equal((await get('/api/source-health?sweeps=4')).status, 200);
  for (const query of ['sweeps=0', 'sweeps=5', 'sweeps=673', 'sweeps=1e2', 'sweeps=-2', 'sweeps=x']) {
    const response = await get(`/api/source-health?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.json().field, 'sweeps', query);
  }
});

test('the default matrix is 48 sweeps, or the retention count when that is smaller', async t => {
  const seen = [];
  const fake = count => ({ retention: () => ({ count, maxMb: 64 }), healthSeries: options => { seen.push(options.sweeps); return { sweeps: [], sources: [] }; } });
  for (const count of [96, 12]) {
    const { get } = await serve(t, { archive: fake(count) });
    assert.equal((await get('/api/source-health')).status, 200);
  }
  assert.deepEqual(seen, [48, 12]);
});

test('an archive that throws gives a generic 503 without the error text or a stack', async t => {
  const errors = captureErrors(t);
  const secret = 'EACCES: permission denied, open D:\\private\\token-abc123\n    at Object.readFileSync (node:fs:441:20)';
  const boom = () => { throw new Error(secret); };
  const archive = { list: boom, get: boom, latest: boom, healthSeries: boom, retention: () => ({ count: 96, maxMb: 64 }), status: 'unavailable' };
  const { get } = await serve(t, { archive, getCurrent: boom });
  for (const path of ['/api/sweeps', `/api/sweeps/${idOf(0)}`, '/api/changes', '/api/changes?window=24h', '/api/source-health']) {
    const response = await get(path);
    assert.equal(response.status, 503, path);
    assert.deepEqual(response.json(), { error: 'Sweep archive temporarily unavailable' }, path);
    for (const leak of ['EACCES', 'token', 'node:fs', 'private']) assert.ok(!response.body.includes(leak), `${path} leaks ${leak}`);
  }
  assert.equal(errors.length, 5);
  assert.ok(errors.every(line => line.startsWith('[Sweeps] Request failed:')));
});

test('the archive routes share the authentication of the rest of the API', async t => {
  const { archive } = filled(t, [[0, 1]]);
  const { get } = await serve(t, { archive, auth: { user: 'reader', password: 'test-password' } });
  const authorization = 'Basic ' + Buffer.from('reader:test-password').toString('base64');
  for (const path of ['/api/sweeps', `/api/sweeps/${idOf(0)}`, '/api/changes?window=6h', '/api/source-health']) {
    assert.equal((await get(path)).status, 401, path);
    const response = await get(path, { Authorization: authorization });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('freshLiveSnapshot keeps the changes of the current snapshot untouched', () => {
  const changes = changesAt(0, 1);
  const snapshot = { liveSources: [{ source: 'USGS', status: 'ok', observedAt: iso(0), observations: [] }], events: [], health: [], changes };
  assert.equal(freshLiveSnapshot(snapshot, BASE + 48 * 60 * MINUTE).changes, changes);
});

test('archiveSweep sets the changes before storing: a baseline without a previous sweep, real changes with one', t => {
  const dir = tmp(t);
  const archive = new SweepArchive(dir, { logger: quiet });
  const first = { meta: { timestamp: iso(0) }, health: [row('USGS')], events: [{ id: eid(1), title: 'One', source: { name: 'USGS' } }] };
  assert.deepEqual(archiveSweep({ archive, snapshot: first, timing: { USGS: { status: 'ok', ms: 80 } }, previous: null, log: quiet }), { archived: true });
  assert.equal(first.changes.baseline, true);
  const second = { meta: { timestamp: iso(15) }, health: [row('USGS', { err: true })], events: [{ id: eid(1), title: 'One', source: { name: 'USGS' } }, { id: eid(2), title: 'Two', source: { name: 'USGS' } }] };
  assert.deepEqual(archiveSweep({ archive, snapshot: second, timing: {}, previous: first, log: quiet }), { archived: true });
  assert.deepEqual(second.changes, buildChanges(first, second));
  assert.equal(second.changes.baseline, false);
  assert.deepEqual(second.changes.events.new.map(item => item.id), [eid(2)]);
  assert.deepEqual(archive.get(idOf(15)).changes, plain(second.changes), 'the archived snapshot carries its changes');
  assert.deepEqual(archive.healthSeries().sources[0].cells, [[0, 80], [2, null]], 'the timing reached the index');
  assert.deepEqual(archive.list()[0].changeCounts, { events: 1, sources: 1, signals: 0 });
});

test('archiveSweep never throws: a skipped sweep is no error, a failed write is logged once and still leaves the changes set', t => {
  const lines = [];
  const log = { error: (...parts) => lines.push(parts.join(' ')) };
  const previous = { meta: { timestamp: iso(0) }, events: [] };
  const snapshot = () => ({ meta: { timestamp: iso(15) }, events: [{ id: eid(3), title: 'Three' }] });
  const skipped = snapshot();
  assert.deepEqual(archiveSweep({ archive: { add: () => null }, snapshot: skipped, previous, log }), { archived: false });
  assert.equal(skipped.changes.events.newTotal, 1);
  assert.deepEqual(lines, []);
  for (const thrown of [Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }), 'a string', null]) {
    lines.length = 0;
    const failed = snapshot();
    const result = archiveSweep({ archive: { add: () => { throw thrown; } }, snapshot: failed, timing: {}, previous, log });
    assert.equal(result.archived, false);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
    assert.equal(failed.changes.events.newTotal, 1, 'the dashboard still gets its changes');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith('[Sweeps] Archive failed:'), lines[0]);
  }
  // A logger that throws does not break the sweep either.
  const result = archiveSweep({ archive: { add: () => { throw new Error('disk'); } }, snapshot: snapshot(), previous, log: { error() { throw new Error('log down'); } } });
  assert.deepEqual(result, { archived: false, error: 'disk' });
});

test('archiveSweep against a real archive whose directory cannot be written reports the failure and the archive turns unavailable', t => {
  const dir = tmp(t);
  // A file where the sweeps directory should be: mkdir fails.
  writeFileSync(join(dir, 'sweeps'), 'not a directory');
  const archive = new SweepArchive(dir, { logger: quiet });
  const lines = [];
  const snapshot = { meta: { timestamp: iso(0) }, events: [] };
  const result = archiveSweep({ archive, snapshot, previous: null, log: { error: (...parts) => lines.push(parts.join(' ')) } });
  assert.equal(result.archived, false);
  assert.ok(result.error);
  assert.equal(snapshot.changes.baseline, true);
  assert.equal(archive.status, 'unavailable');
  assert.equal(lines.length, 1);
});

// An Accept-Encoding the route answers with gzip, and ones it answers with plain JSON (the header absent included).
const GZIP_ACCEPTED = ['gzip', 'GZIP', 'gzip, deflate, br', 'deflate, gzip;q=0.5', 'gzip;q=1.0, identity;q=0.1', 'identity;q=0.5, gzip'];
const PLAIN_ACCEPTED = ['identity', 'gzip;q=0', 'br', 'deflate', 'gzip;q=0, deflate', 'identity, gzip;q=0', ''];
const SECURITY_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };

test('GET /api/sweeps/:id passes the stored gzip bytes on to a client that accepts gzip; the decoded body equals the plain JSON byte for byte', async t => {
  const dir = tmp(t);
  const archive = new SweepArchive(dir, { logger: quiet });
  const title = `Árvíztűrő tükörfúrógép <script>${String.fromCharCode(0x2028)}</script> ☃ ${String.fromCodePoint(0x1f600)}`;
  const snapshot = snapshotAt(0, 1, { events: [{ id: eid(9), title, source: { name: 'USGS' } }], numbers: [1.5, -0, 1e21, 0.1 + 0.2] });
  archive.add({ snapshot });
  const stored = readFileSync(join(dir, 'sweeps', `${idOf(0)}.json.gz`));
  const { calls, archive: spy } = spied(archive);
  const { bytes } = await serve(t, { archive: spy });
  const path = `/api/sweeps/${idOf(0)}`;
  const plainResponse = await bytes(path);
  assert.equal(plainResponse.status, 200);
  assert.equal(plainResponse.headers['content-encoding'], undefined);
  assert.equal(plainResponse.headers['content-type'], 'application/json; charset=utf-8');
  assert.match(plainResponse.headers.vary, /Accept-Encoding/i);
  assert.ok(plainResponse.body.equals(Buffer.from(JSON.stringify(snapshot))), 'the plain path is the snapshot JSON');
  const gzip = await bytes(path, { 'Accept-Encoding': 'gzip' });
  assert.equal(gzip.status, 200);
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal(gzip.headers['content-type'], 'application/json; charset=utf-8');
  assert.match(gzip.headers.vary, /Accept-Encoding/i);
  assert.ok(gzip.body.equals(stored), 'the bytes of the file, not a second compression');
  assert.equal(Number(gzip.headers['content-length']), stored.length);
  assert.ok(gunzipSync(gzip.body).equals(plainResponse.body), 'decoded, exactly the bytes of the plain answer');
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(plainResponse.headers[name], value, `plain ${name}`);
    assert.equal(gzip.headers[name], value, `gzip ${name}`);
  }
  assert.deepEqual(calls.filter(([name]) => name !== 'retention'), [['get', idOf(0)], ['getRaw', idOf(0)]], 'one archive read per request, the one the branch needs');
});

test('only a client that accepts gzip gets the stored bytes', async t => {
  const { archive } = filled(t, [[0, 1]]);
  const { bytes } = await serve(t, { archive });
  const path = `/api/sweeps/${idOf(0)}`;
  const expected = JSON.stringify(snapshotAt(0, 1));
  for (const header of GZIP_ACCEPTED) {
    const response = await bytes(path, { 'Accept-Encoding': header });
    assert.equal(response.headers['content-encoding'], 'gzip', `[${header}]`);
    assert.equal(gunzipSync(response.body).toString('utf8'), expected, `[${header}]`);
    assert.match(response.headers.vary, /Accept-Encoding/i, `[${header}]`);
  }
  for (const header of [...PLAIN_ACCEPTED, undefined]) {
    const response = await bytes(path, header === undefined ? {} : { 'Accept-Encoding': header });
    assert.equal(response.headers['content-encoding'], undefined, `[${header}]`);
    assert.equal(response.body.toString('utf8'), expected, `[${header}]`);
    assert.match(response.headers.vary, /Accept-Encoding/i, `[${header}]`);
  }
});

test('the gzip branch keeps the validation: a corrupt, empty, non-object or deleted file is a 404, a bad id a 400', async t => {
  const { dir, archive } = filled(t, [[0, 1], [15, 2], [30, 3], [45, 4]]);
  const file = minutes => join(dir, 'sweeps', `${idOf(minutes)}.json.gz`);
  writeFileSync(file(0), 'not gzip at all');
  writeFileSync(file(15), Buffer.alloc(0));
  writeFileSync(file(30), gzipSync('[1,2,3]'));
  writeFileSync(file(45), gzipSync('{"half":'));
  const { bytes } = await serve(t, { archive });
  for (const encoding of ['gzip', 'identity']) {
    for (const minutes of [0, 15, 30, 45, 60]) {
      const response = await bytes(`/api/sweeps/${idOf(minutes)}`, { 'Accept-Encoding': encoding });
      assert.equal(response.status, 404, `${encoding} ${minutes}`);
      assert.equal(response.headers['content-encoding'], undefined, `${encoding} ${minutes}`);
      assert.deepEqual(JSON.parse(response.body.toString('utf8')), { error: 'Sweep not found' }, `${encoding} ${minutes}`);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    const bad = await bytes('/api/sweeps/sweep-1', { 'Accept-Encoding': encoding });
    assert.equal(bad.status, 400);
    assert.equal(bad.headers['content-encoding'], undefined);
    assert.deepEqual(JSON.parse(bad.body.toString('utf8')), { error: 'Invalid sweep ID', code: 'INVALID_FILTER', field: 'id' });
    const query = await bytes(`/api/sweeps/${idOf(0)}?full=1`, { 'Accept-Encoding': encoding });
    assert.equal(query.status, 400);
    assert.deepEqual(JSON.parse(query.body.toString('utf8')), { error: 'Unknown query parameter', code: 'INVALID_FILTER', field: 'query' });
  }
});

test('a file that went bad after it was listed is never passed on as gzip', async t => {
  const { dir, archive } = filled(t, [[0, 1], [15, 2]]);
  const { bytes } = await serve(t, { archive });
  assert.equal((await bytes(`/api/sweeps/${idOf(15)}`, { 'Accept-Encoding': 'gzip' })).status, 200);
  writeFileSync(join(dir, 'sweeps', `${idOf(15)}.json.gz`), gzipSync(JSON.stringify(snapshotAt(15, 2))).subarray(0, 40));
  const response = await bytes(`/api/sweeps/${idOf(15)}`, { 'Accept-Encoding': 'gzip' });
  assert.equal(response.status, 404);
  assert.equal(response.headers['content-encoding'], undefined);
});

// A fake archive of known sweeps for the memo tests: list() newest first as the real one answers, every get() recorded.
function fakeArchive(count = 5) {
  const state = { listed: [], files: new Map(), gets: [], lists: [] };
  const archive = {
    retention: () => ({ count, maxMb: 64 }),
    list: options => { state.lists.push(options); return state.listed.slice(0, options?.limit ?? 672); },
    get: id => { state.gets.push(id); return state.files.get(id) ?? null; },
  };
  const put = (minutes, n) => state.files.set(idOf(minutes), snapshotAt(minutes, n));
  const list = minutesList => { state.listed = minutesList.map(minutes => ({ id: idOf(minutes), timestamp: iso(minutes) })); };
  return { state, archive, put, list };
}

test('a time window reads each sweep once: the changes are memoized per id, for as long as the id is listed', async t => {
  const { state, archive, put, list } = fakeArchive(5);
  for (const [minutes, n] of [[0, 1], [15, 2], [30, 3], [45, 4]]) put(minutes, n);
  list([45, 30, 15, 0]);
  let now = BASE + 50 * MINUTE;
  const { get } = await serve(t, { archive, now: () => now });
  const expected = sweeps => plain(mergeChanges(sweeps.map(([minutes, n]) => changesAt(minutes, n))));
  const all = [[0, 1], [15, 2], [30, 3], [45, 4]];
  const first = await get('/api/changes?window=1h');
  assert.deepEqual(first.json(), expected(all), 'the first answer is the merge of what the archive holds');
  assert.deepEqual(state.gets, [0, 15, 30, 45].map(idOf), 'every sweep of the window was read, oldest first');
  const second = await get('/api/changes?window=1h');
  assert.equal(second.body, first.body, 'the same answer');
  assert.equal(state.gets.length, 4, 'and no sweep was read again');
  assert.ok(state.lists.length >= 2 && state.lists.every(options => options?.limit === 5), 'the list is asked for the retention count');
  // The window moves on: only the newest sweep is inside it, the older ones are still listed and stay memoized.
  now = BASE + 100 * MINUTE;
  assert.deepEqual((await get('/api/changes?window=1h')).json(), expected([[45, 4]]));
  now = BASE + 50 * MINUTE;
  assert.deepEqual((await get('/api/changes?window=1h')).json(), expected(all));
  assert.equal(state.gets.length, 4, 'a sweep outside one window but still listed is not forgotten');
  // A new sweep: only that one is read. The oldest leaves the list.
  put(60, 5);
  list([60, 45, 30, 15]);
  now = BASE + 70 * MINUTE;
  assert.deepEqual((await get('/api/changes?window=1h')).json(), expected([[15, 2], [30, 3], [45, 4], [60, 5]]));
  assert.deepEqual(state.gets.slice(4), [idOf(60)]);
  // The id that left the list was dropped from the memo: when it is listed again it is read again.
  list([60, 45, 30, 15, 0]);
  now = BASE + 65 * MINUTE;
  assert.deepEqual((await get('/api/changes?window=24h')).json(), expected([[0, 1], [15, 2], [30, 3], [45, 4], [60, 5]]));
  assert.deepEqual(state.gets.slice(5), [idOf(0)]);
});

test('a sweep that could not be read is not memoized; one that was read without changes is', async t => {
  const { state, archive, put, list } = fakeArchive(5);
  put(15, 2);
  state.files.set(idOf(30), { meta: { timestamp: iso(30) }, health: [] });
  list([30, 15, 0]);
  const { get } = await serve(t, { archive, now: () => BASE + 40 * MINUTE });
  const first = await get('/api/changes?window=1h');
  assert.deepEqual(first.json(), plain(mergeChanges([changesAt(15, 2)])), 'the missing file and the sweep without changes are left out');
  assert.deepEqual(state.gets, [0, 15, 30].map(idOf));
  put(0, 1);
  const second = await get('/api/changes?window=1h');
  assert.deepEqual(second.json(), plain(mergeChanges([changesAt(0, 1), changesAt(15, 2)])), 'the file that has appeared is used at once');
  assert.deepEqual(state.gets.slice(3), [idOf(0)], 'only the one that failed is read again');
  state.files.delete(idOf(0));
  assert.deepEqual((await get('/api/changes?window=1h')).json(), second.json(), 'a read that succeeded stays, whatever happens to the file later');
});

test('the changes of a window cover at most the retention count of sweeps, even when the index holds more', async t => {
  const { dir } = filled(t, [[0, 1], [15, 2], [30, 3], [45, 4]], { count: 8 });
  // The operator lowered SWEEP_ARCHIVE_COUNT: the index still lists four sweeps until the next add.
  const archive = new SweepArchive(dir, { logger: quiet, count: 2 });
  assert.equal(archive.list().length, 4);
  const { calls, archive: spy } = spied(archive);
  const { get } = await serve(t, { archive: spy, now: () => BASE + 50 * MINUTE });
  assert.deepEqual((await get('/api/changes?window=1h')).json(), plain(mergeChanges([changesAt(30, 3), changesAt(45, 4)])));
  assert.deepEqual(calls.filter(([name]) => name === 'list'), [['list', { limit: 2 }]]);
  assert.deepEqual(calls.filter(([name]) => name === 'get'), [['get', idOf(30)], ['get', idOf(45)]]);
});
