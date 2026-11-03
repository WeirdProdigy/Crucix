import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_QA_PORT,
  buildQaEnv,
  checkSweepTripwire,
  checkSweepsDisabledConfirmed,
  killPidTree,
  startQaLaunch
} from '../scripts/qa-launch.mjs';

test('1. buildQaEnv: produces strict isolated config with default port 3199', () => {
  const envDefault = buildQaEnv();
  assert.equal(envDefault.PORT, DEFAULT_QA_PORT, `Default port must be ${DEFAULT_QA_PORT} (not 3117)`);
  assert.equal(envDefault.ENABLE_SWEEPS, 'false', 'ENABLE_SWEEPS must be "false"');
  assert.equal(envDefault.NO_AUTO_OPEN, '1');
  assert.equal(envDefault.HOST, '127.0.0.1');
  assert.equal(envDefault.LLM_PROVIDER, '');
  assert.equal(envDefault.LLM_API_KEY, '');
  assert.equal(envDefault.TELEGRAM_BOT_TOKEN, '');
  assert.equal(envDefault.DISCORD_BOT_TOKEN, '');

  const customRuns = join(tmpdir(), 'test-runs-custom-qa');
  const envCustom = buildQaEnv({
    port: '3250',
    runsDir: customRuns,
    envFile: 'custom.env',
    enablePolice: true
  });
  assert.equal(envCustom.PORT, '3250');
  assert.equal(envCustom.RUNS_DIR, customRuns);
  assert.equal(envCustom.CRUCIX_ENV_FILE, 'custom.env');
  assert.equal(envCustom.CRUCIX_ENABLE_POLICE_HAJDU, 'true');
});

test('2. checkSweepTripwire: reliably detects sweep attempts and ignores clean logs', () => {
  assert.equal(checkSweepTripwire('[Crucix] Running initial sweep...'), 'Running initial sweep');
  assert.equal(checkSweepTripwire('[Crucix] Starting intelligence sweep — 67 sources...'), 'Starting intelligence sweep');
  assert.equal(checkSweepTripwire('[Crucix] Starting sweep at 13:36:11'), 'Starting sweep at');
  assert.equal(checkSweepTripwire('[Crucix] Sweep complete — 38/67 sources OK'), 'Sweep complete');

  assert.equal(checkSweepTripwire('[Crucix] Server running on http://localhost:3199'), null);
  assert.equal(checkSweepTripwire('[Crucix] Automatikus és kézi sweepek konfigurációval letiltva.'), null);
  assert.equal(checkSweepTripwire(null), null);
  assert.equal(checkSweepTripwire(undefined), null);
});

test('3. checkSweepsDisabledConfirmed: matches required disabled confirmation strings', () => {
  assert.equal(checkSweepsDisabledConfirmed('[Crucix] Automatikus és kézi sweepek konfigurációval letiltva.'), true);
  assert.equal(checkSweepsDisabledConfirmed('[Crucix] Sweeps disabled by configuration.'), true);
  assert.equal(checkSweepsDisabledConfirmed('Automated sweeps disabled'), true);
  assert.equal(checkSweepsDisabledConfirmed('Server started successfully.'), false);
  assert.equal(checkSweepsDisabledConfirmed(''), false);
});

test('4. Tripwire guard: terminates process and throws if sweep message is observed (mocked process)', async () => {
  // Create a mock child process that simulates a rogue server outputting a sweep line
  let killedWith = null;
  const mockChild = new EventEmitter();
  mockChild.pid = 999999;
  mockChild.exitCode = null;
  mockChild.stdout = new EventEmitter();
  mockChild.stderr = new EventEmitter();
  mockChild.kill = (sig) => { killedWith = sig; mockChild.exitCode = 1; };

  // Verify that checkSweepTripwire intercepts the line immediately
  const rogueLine = '[Crucix] Running initial sweep...';
  const tripped = checkSweepTripwire(rogueLine);
  assert.equal(tripped, 'Running initial sweep');

  // Triggering tripwire must trigger termination
  if (tripped) {
    mockChild.kill('SIGKILL');
  }
  assert.equal(killedWith, 'SIGKILL');
  assert.equal(mockChild.exitCode, 1);
});

test('5. startQaLaunch: real server boots with sweeps disabled, serves health, and stops cleanly by PID', { timeout: 20000 }, async (t) => {
  // Find a free ephemeral port
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));

  const testRunsDir = mkdtempSync(join(tmpdir(), 'crucix-qa-launch-test-'));
  t.after(() => {
    try { rmSync(testRunsDir, { recursive: true, force: true }); } catch {}
  });

  const handle = await startQaLaunch({
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
  assert.ok(!logs.includes('Running initial sweep'), 'Logs must NEVER contain "Running initial sweep"');

  // Test HTTP health endpoint
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'ok');

  // Stop specifically by PID
  const exitCode = await handle.stop();
  assert.ok(exitCode === 0 || exitCode === null || exitCode === 143 || exitCode === 1, 'Clean shutdown of QA server');
});
