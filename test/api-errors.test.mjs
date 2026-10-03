import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installApiErrorHandler } from '../lib/api-errors.mjs';
import { AlertEngine } from '../lib/alerts/engine.mjs';
import { installAlertRoutes } from '../lib/alerts/routes.mjs';
import { installHttpSecurity } from '../lib/http-security.mjs';
import { installIntelligenceRoutes } from '../lib/intelligence/routes.mjs';
import { SweepArchive } from '../lib/sweeps/archive.mjs';
import { installSweepRoutes } from '../lib/sweeps/routes.mjs';

const quiet = { warn() {}, error() {}, log() {}, info() {} };
const SECRET = 'EACCES: permission denied, open D:\\private\\token-abc123\n    at Object.readFileSync (node:fs:441:20)\n    at Provider.fetch (file:///D:/AI/Crucix/apis/sources/gdelt.mjs:12:3)';
const LEAKS = ['EACCES', 'token-abc123', 'private', 'node:fs', 'gdelt', 'URIError', 'decodeURIComponent', ' at '];

// Captures console.error so the tests can count what is logged and keep the test output clean.
function captureErrors(t) {
  const lines = [];
  const original = console.error;
  console.error = (...parts) => lines.push(parts.join(' '));
  t.after(() => { console.error = original; });
  return lines;
}

// The server's /api stack on a random port: the security headers, the history, alert and sweep routes, routes that fail in
// every way a route can, and the error handler installed after all of them, with a non-/api route before it and an /api route after it.
async function serve(t) {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-api-errors-'));
  const engine = new AlertEngine(dir, { now: () => Date.parse('2026-10-03T08:00:00Z'), logger: quiet });
  engine.load();
  const app = express();
  installHttpSecurity(app, {});
  installIntelligenceRoutes(app, { getSnapshot: () => ({ events: [] }), history: null, language: 'en' });
  installAlertRoutes(app, { engine, getSnapshot: () => null });
  installSweepRoutes(app, { archive: new SweepArchive(dir, { logger: quiet }), getCurrent: () => null });
  app.get('/api/boom', () => { throw new Error(SECRET); });
  app.get('/api/boom-async', async () => { throw new Error(SECRET); });
  app.get('/api/boom-odd', () => { throw Object.create(null); });
  app.get('/api/boom-text', () => { throw SECRET; });
  // Fails after the first part of the body went out (the write callback: it is on the wire), as a handler that streams can.
  app.get('/api/partial', async (_req, res) => { await new Promise(resolve => res.write('{"partial":', resolve)); throw new Error(SECRET); });
  app.get('/boom', () => { throw new Error(SECRET); });
  installApiErrorHandler(app);
  app.get('/api/late', () => { throw new Error(SECRET); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const port = server.address().port;
  // node:http sends the path as written; an aborted response (the connection closed mid-body) is reported, not thrown.
  const call = (path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      let body = '';
      let aborted = false;
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('error', () => { aborted = true; });
      res.on('close', () => resolve({ status: res.statusCode, type: res.headers['content-type'] ?? '', headers: res.headers, body, aborted: aborted || !res.complete }));
    });
    req.on('error', reject);
    req.end();
  });
  return { call };
}

const noLeak = (body, label) => { for (const leak of LEAKS) assert.ok(!body.includes(leak), `${label} leaks "${leak}"`); };

test('a broken percent-encoding in an id is a JSON 400 on the history route and the sweep route, never the HTML error page', async t => {
  const logs = captureErrors(t);
  const { call } = await serve(t);
  for (const path of ['/api/events/%E0%A4%A', '/api/events/%E0%A4%A?x=1', '/api/events/%zz', '/api/sweeps/%E0%A4%A', '/api/sweeps/%E0%A4%A?limit=1', '/api/sweeps/%C0%AF']) {
    const response = await call(path);
    assert.equal(response.status, 400, path);
    assert.match(response.type, /^application\/json/, path);
    assert.deepEqual(JSON.parse(response.body), { error: 'Invalid path parameter', code: 'INVALID_FILTER', field: 'id' }, path);
    noLeak(response.body, path);
    assert.equal(response.headers['cache-control'], 'no-store', `${path} keeps the global security headers`);
    assert.equal(response.headers['x-content-type-options'], 'nosniff', path);
  }
  assert.deepEqual(logs, [], 'a client mistake is no server log line');
});

test('the alert routes keep their own JSON answer for a broken percent-encoding', async t => {
  const logs = captureErrors(t);
  const { call } = await serve(t);
  for (const [method, path] of [['GET', '/api/alerts/rules/%E0%A4%A'], ['DELETE', '/api/alerts/rules/%E0%A4%A'], ['GET', '/api/alerts/%E0%A4%A/ack']]) {
    const response = await call(path, { method });
    assert.equal(response.status, 400, `${method} ${path}`);
    assert.match(response.type, /^application\/json/);
    assert.deepEqual(JSON.parse(response.body), { error: 'Invalid request', code: 'INVALID_REQUEST', field: null });
    noLeak(response.body, path);
  }
  assert.ok(logs.every(line => !line.includes('\n') && !/\n\s+at /.test(line) && !line.includes('URIError: ')), 'and nothing like a stack is logged');
});

test('an error that escapes a route is a generic JSON 503: sync throw, async rejection, a thrown string or an object with no prototype', async t => {
  const logs = captureErrors(t);
  const { call } = await serve(t);
  for (const path of ['/api/boom', '/api/boom-async', '/api/boom-odd', '/api/boom-text']) {
    logs.length = 0;
    const response = await call(path);
    assert.equal(response.status, 503, path);
    assert.match(response.type, /^application\/json/, path);
    assert.deepEqual(JSON.parse(response.body), { error: 'Service temporarily unavailable' }, path);
    noLeak(response.body, path);
    assert.equal(response.headers['cache-control'], 'no-store', `${path} keeps the global security headers`);
    assert.equal(logs.length, 1, `${path} is logged once`);
    assert.ok(logs[0].startsWith('[API] Request failed:'), logs[0]);
    assert.ok(!logs[0].includes('\n'), 'one line, no stack');
    assert.ok(!logs[0].includes('Provider.fetch') && !logs[0].includes('node:fs:441'), 'only the first line of the message is logged');
  }
});

test('the handler leaves alone what it must not answer: paths outside /api, routes registered after it, 404s and answers already started', async t => {
  const logs = captureErrors(t);
  const { call } = await serve(t);
  for (const path of ['/boom', '/api/late']) {
    const response = await call(path);
    assert.equal(response.status, 500, path);
    assert.ok(!response.type.startsWith('application/json'), `${path} is not turned into JSON: ${response.type}`);
    assert.ok(!response.body.includes('Service temporarily unavailable'), path);
  }
  assert.equal((await call('/api/does-not-exist')).status, 404, 'an unknown API path is still a 404');
  assert.equal((await call('/api/sweeps')).status, 200, 'and a working route is untouched');
  assert.equal(logs.some(line => line.startsWith('[API]')), false, 'none of these reached the handler');
  // The response is half sent: the handler must not append a second one; the connection is closed (Express's default handler).
  logs.length = 0;
  const partial = await call('/api/partial');
  assert.equal(partial.status, 200, 'the status that was already sent');
  assert.equal(partial.aborted, true, 'the connection was closed, the body is not completed');
  assert.ok(!partial.body.includes('Service temporarily unavailable'), 'no JSON 503 after the partial body');
  assert.equal(logs.some(line => line.startsWith('[API]')), false, 'it passed the error on without answering');
});
