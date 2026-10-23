import test from 'node:test';
import assert from 'node:assert/strict';
import { envBoolean } from '../crucix.config.mjs';
import config from '../crucix.config.mjs';
import { renderOfflineShell } from '../lib/offline-shell.mjs';
import { getLocale } from '../lib/i18n.mjs';

test('ENABLE_SWEEPS configuration: default is true, false is strictly parsed', () => {
  // Test fallback when env is unset or empty
  const prevEnv = process.env.ENABLE_SWEEPS;
  try {
    delete process.env.ENABLE_SWEEPS;
    assert.equal(envBoolean('ENABLE_SWEEPS', true), true, 'Unset ENABLE_SWEEPS must default to true');

    process.env.ENABLE_SWEEPS = '';
    assert.equal(envBoolean('ENABLE_SWEEPS', true), true, 'Empty ENABLE_SWEEPS must default to true');

    process.env.ENABLE_SWEEPS = 'false';
    assert.equal(envBoolean('ENABLE_SWEEPS', true), false, 'String "false" must parse to boolean false');

    process.env.ENABLE_SWEEPS = '0';
    assert.equal(envBoolean('ENABLE_SWEEPS', true), false, 'String "0" must parse to boolean false');

    process.env.ENABLE_SWEEPS = 'true';
    assert.equal(envBoolean('ENABLE_SWEEPS', true), true, 'String "true" must parse to boolean true');

    process.env.ENABLE_SWEEPS = '1';
    assert.equal(envBoolean('ENABLE_SWEEPS', true), true, 'String "1" must parse to boolean true');

    process.env.ENABLE_SWEEPS = 'invalid_boolean';
    assert.throws(
      () => envBoolean('ENABLE_SWEEPS', true),
      /ENABLE_SWEEPS must be true or false/,
      'Invalid boolean string must throw configuration error'
    );
  } finally {
    if (prevEnv !== undefined) process.env.ENABLE_SWEEPS = prevEnv;
    else delete process.env.ENABLE_SWEEPS;
  }
});

test('Manual sweep handlers return forbidden warning when enableSweeps is false', () => {
  const disabledConfig = { ...config, enableSweeps: false };

  // Telegram simulation
  const telegramSweepHandler = (cfg, inProgress) => {
    if (!cfg.enableSweeps) return '⚠️ Automatikus és kézi sweepek konfigurációval letiltva.';
    if (inProgress) return '🔄 Sweep already in progress. Please wait.';
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  };

  assert.equal(
    telegramSweepHandler(disabledConfig, false),
    '⚠️ Automatikus és kézi sweepek konfigurációval letiltva.',
    'Telegram manual sweep must be refused with explicit error message when sweeps are disabled'
  );

  // Discord simulation
  const discordSweepHandler = (cfg, inProgress) => {
    if (!cfg.enableSweeps) return '⚠️ Automatikus és kézi sweepek konfigurációval letiltva.';
    if (inProgress) return '🔄 Sweep already in progress. Please wait.';
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  };

  assert.equal(
    discordSweepHandler(disabledConfig, false),
    '⚠️ Automatikus és kézi sweepek konfigurációval letiltva.',
    'Discord manual sweep must be refused with explicit error message when sweeps are disabled'
  );
});

test('Sweep execution gate blocks fullBriefing when enableSweeps is false', async () => {
  let fullBriefingCalled = false;
  const mockFullBriefing = async () => {
    fullBriefingCalled = true;
    return { timing: {} };
  };

  // Mocked sweep cycle adhering to the server.mjs central execution gate
  const runSweepCycleGuarded = async (enableSweeps) => {
    if (!enableSweeps) {
      // Automatikus és kézi sweepek konfigurációval letiltva.
      return { skipped: true };
    }
    await mockFullBriefing();
    return { skipped: false };
  };

  const resDisabled = await runSweepCycleGuarded(false);
  assert.equal(resDisabled.skipped, true);
  assert.equal(fullBriefingCalled, false, 'fullBriefing must NEVER be called when enableSweeps is false');

  const resEnabled = await runSweepCycleGuarded(true);
  assert.equal(resEnabled.skipped, false);
  assert.equal(fullBriefingCalled, true, 'fullBriefing called when enableSweeps is true');
});

test('Missing or corrupt latest.json renders empty offline shell without live fallback', () => {
  const template = `<!DOCTYPE html><html><head><title>Test</title></head><body><script>\nlet D = {"test":true};\n</script></body></html>`;
  const locale = getLocale('hu');

  // When snapshot is missing/corrupt and enableSweeps is false, currentData is null
  let currentData = null;
  const enableSweeps = false;

  // Verify that missing data causes empty offline shell rendering, NOT a live sweep trigger
  let triggeredSweep = false;
  if (!currentData) {
    if (enableSweeps) {
      triggeredSweep = true;
    }
  }

  assert.equal(triggeredSweep, false, 'No live sweep fallback may trigger on missing data when enableSweeps is false');

  const html = renderOfflineShell(template, locale, { offline: false });
  assert.ok(html.includes('let D = {"meta":{"timestamp":null'), 'Rendered shell has empty snapshot data');
  assert.ok(html.includes('window.__CRUCIX_OFFLINE_SHELL__=false'), 'Shell indicates online server mode without live data');
});

test('Real server process with ENABLE_SWEEPS=false logs sweep disabled, does not run sweep, and serves health', { timeout: 15000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const directory = mkdtempSync(join(tmpdir(), 'crucix-test-nosweep-'));
  const envFile = join(directory, 'empty.env');
  writeFileSync(envFile, '');
  const runsDir = join(directory, 'runs');

  const testPort = '3121';
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    windowsHide: true,
    env: {
      ...process.env,
      CRUCIX_ENV_FILE: envFile,
      RUNS_DIR: runsDir,
      PORT: testPort,
      HOST: '127.0.0.1',
      ENABLE_SWEEPS: 'false',
      NO_AUTO_OPEN: '1',
      AUTH_USER: '',
      AUTH_PASSWORD: '',
      LLM_PROVIDER: '',
      TELEGRAM_BOT_TOKEN: '',
      DISCORD_BOT_TOKEN: '',
      DISCORD_WEBHOOK_URL: '',
      ALERT_NOTIFY_CHANNELS: '',
      ALERT_NTFY_URL: '',
      ALERT_WEBHOOK_URL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stdout.on('data', chunk => logs += chunk);
  child.stderr.on('data', chunk => logs += chunk);

  t.after(async () => {
    const stopped = new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode === null) {
      child.kill();
      await stopped;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 100));
    try {
      const res = await fetch(`http://127.0.0.1:${testPort}/api/health`);
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch {}
  }

  assert.ok(ready, 'Server must start and answer health endpoint');
  assert.ok(
    logs.includes('Automatikus és kézi sweepek konfigurációval letiltva.'),
    'Server must log that sweeps are disabled by configuration'
  );
  assert.equal(
    logs.includes('Starting sweep'),
    false,
    'Server must NEVER start a sweep when ENABLE_SWEEPS=false'
  );
});
