import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

test('HTTP guard protects data and event streams with browser-compatible Basic auth', async t => {
  const module = await import('../lib/http-security.mjs').catch(() => ({}));
  assert.equal(typeof module.installHttpSecurity, 'function', 'HTTP security middleware must exist');
  const app = express();
  module.installHttpSecurity(app, { user: 'owner', password: 'long-test-password' });
  app.get('/api/data', (_req, res) => res.json({ private: true }));
  app.get('/events', (_req, res) => res.end('event-stream'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/api/data', '/events']) {
    const denied = await fetch(base + route);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate'), /^Basic /);
    const permitted = await fetch(base + route, { headers: { Authorization: `Basic ${Buffer.from('owner:long-test-password').toString('base64')}` } });
    assert.equal(permitted.status, 200);
    assert.equal(permitted.headers.get('cache-control'), 'no-store');
    assert.equal(permitted.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.equal((await fetch(base + '/healthz')).status, 200);
});

test('partial authentication configuration fails closed', async () => {
  const module = await import('../lib/http-security.mjs').catch(() => ({}));
  assert.equal(typeof module.installHttpSecurity, 'function');
  assert.throws(() => module.installHttpSecurity(express(), { user: 'owner' }), /AUTH_USER.*AUTH_PASSWORD/);
});
