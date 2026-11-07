import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildQaServerEnv, startQaServer } from '../scripts/qa-server.mjs';

test('1. buildQaServerEnv produces strict, isolated configuration', () => {
  const customRuns = join(tmpdir(), 'test-runs-custom');
  const env = buildQaServerEnv({
    port: '4123',
    runsDir: customRuns,
    envFile: 'test.env',
    enablePolice: true
  });

  assert.equal(env.ENABLE_SWEEPS, 'false', 'Sweeps must be strictly disabled');
  assert.equal(env.NO_AUTO_OPEN, '1', 'Auto browser opening must be disabled');
  assert.equal(env.HOST, '127.0.0.1', 'Host must be localhost');
  assert.equal(env.PORT, '4123');
  assert.equal(env.RUNS_DIR, customRuns);
  assert.equal(env.CRUCIX_ENV_FILE, 'test.env');
  assert.equal(env.CRUCIX_ENABLE_POLICE_HAJDU, 'true');

  // Verify external notification and LLM credentials are cleared
  assert.equal(env.AUTH_USER, '');
  assert.equal(env.AUTH_PASSWORD, '');
  assert.equal(env.LLM_PROVIDER, '');
  assert.equal(env.LLM_API_KEY, '');
  assert.equal(env.TELEGRAM_BOT_TOKEN, '');
  assert.equal(env.DISCORD_BOT_TOKEN, '');
  assert.equal(env.DISCORD_WEBHOOK_URL, '');
  assert.equal(env.TELEGRAM_OSINT_ENABLED, 'false');
});

test('2. startQaServer spawns isolated server, verifies sweeps-disabled confirmation, and stops by PID', { timeout: 20000 }, async (t) => {
  // Find a free ephemeral port
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));

  const testRunsDir = mkdtempSync(join(tmpdir(), 'crucix-qa-server-test-'));
  t.after(() => {
    try { rmSync(testRunsDir, { recursive: true, force: true }); } catch {}
  });

  const handle = await startQaServer({
    port: String(port),
    runsDir: testRunsDir,
    timeoutMs: 15000
  });

  assert.ok(Number.isInteger(handle.pid) && handle.pid > 0, 'QA server has valid PID');
  assert.equal(handle.port, String(port));

  // Verify sweeps disabled confirmation in logs
  const logs = handle.getLogs();
  assert.ok(
    logs.includes('sweepek konfigurációval letiltva') || logs.includes('Sweeps disabled'),
    'Server logs must explicitly confirm that sweeps are disabled'
  );
  assert.ok(!logs.includes('Starting sweep'), 'Logs must NEVER contain "Starting sweep"');

  // Test HTTP health endpoint
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'ok');

  // Test live streams endpoint and CSP header
  const liveRes = await fetch(`http://127.0.0.1:${port}/api/live-streams`);
  assert.equal(liveRes.status, 200);
  const liveJson = await liveRes.json();
  assert.ok(Array.isArray(liveJson.liveStreams));
  assert.ok(liveJson.liveStreams.length >= 10);
  assert.ok(liveRes.headers.get('content-security-policy').includes("frame-src 'self' https://www.youtube-nocookie.com https://embed.windy.com https://g0.ipcamlive.com https://videa.hu;"));

  // Stop specifically by PID
  const exitCode = await handle.stop();
  assert.ok(exitCode === 0 || exitCode === null || exitCode === 143 || exitCode === 1, 'Clean shutdown of QA server');
});
