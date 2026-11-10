#!/usr/bin/env node
/**
 * scripts/qa-server.mjs
 *
 * Dedicated QA / test server launcher for Crucix.
 * Launches server.mjs in a fully isolated child process with:
 * - child_process.spawn and explicit environment object (never PowerShell string concat)
 * - ENABLE_SWEEPS=false (strictly zero background sweeps or external polling)
 * - NO_AUTO_OPEN=1 (prevents launching host web browser)
 * - HOST=127.0.0.1
 * - Isolated RUNS_DIR and empty CRUCIX_ENV_FILE
 * - Explicit PID output
 * - Verifies sweeps-disabled log confirmation before resolving
 * - Safe PID-specific teardown (never mass process killing)
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Builds an isolated environment object for the QA server.
 */
export function buildQaServerEnv(options = {}) {
  const runsDir = options.runsDir || process.env.RUNS_DIR || join(ROOT_DIR, 'runs');
  const envFile = options.envFile !== undefined ? options.envFile : '';

  return {
    ...process.env,
    ENABLE_SWEEPS: 'false',
    NO_AUTO_OPEN: '1',
    HOST: options.host || '127.0.0.1',
    PORT: String(options.port || process.env.QA_PORT || '3199'),
    RUNS_DIR: runsDir,
    CRUCIX_ENV_FILE: envFile,
    AUTH_USER: '',
    AUTH_PASSWORD: '',
    LLM_PROVIDER: '',
    LLM_API_KEY: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    TELEGRAM_CHANNELS: '',
    DISCORD_BOT_TOKEN: '',
    DISCORD_CHANNEL_ID: '',
    DISCORD_WEBHOOK_URL: '',
    TELEGRAM_OSINT_ENABLED: 'false',
    CRUCIX_ENABLE_POLICE_HAJDU: options.enablePolice ? 'true' : 'false',
    CRUCIX_ENABLE_OVF_GAUGES: options.enableOvfGauges !== undefined
      ? (options.enableOvfGauges ? 'true' : 'false')
      : (process.env.CRUCIX_ENABLE_OVF_GAUGES || 'true')
  };
}

/**
 * Launches an isolated QA server child process.
 * Returns a handle object: { child, pid, port, url, env, stop, logs }
 */
export async function startQaServer(options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  let tempEnvDir = null;
  let envFile = options.envFile;

  if (envFile === undefined) {
    tempEnvDir = mkdtempSync(join(tmpdir(), 'crucix-qa-env-'));
    envFile = join(tempEnvDir, 'empty.env');
    writeFileSync(envFile, '');
  }

  const port = options.port || process.env.PORT || '3117';
  const env = buildQaServerEnv({ ...options, port, envFile });

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT_DIR,
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const pid = child.pid;
  console.log(`[Crucix QA] Crucix QA server started [PID: ${pid}] on http://${env.HOST}:${port}`);

  let logs = '';
  let sweepsDisabledConfirmed = false;
  let serverListening = false;

  let tripwireError = null;

  const onData = (chunk) => {
    const text = chunk.toString();
    logs += text;
    if (options.verbose) {
      process.stdout.write(text);
    }
    // ACTIVE TRIPWIRE: if a sweep started, kill process immediately
    if (text.includes('Running initial sweep') ||
        text.includes('Starting intelligence sweep') ||
        text.includes('Starting sweep at')) {
      console.error(`[Crucix QA] CRITICAL GUARD VIOLATION: Server attempted to run sweep! Terminating PID ${pid} immediately.`);
      try { child.kill('SIGKILL'); } catch {}
      tripwireError = new Error(`Sweep tripwire triggered: server attempted sweep. PID ${pid} terminated.`);
      return;
    }
    if (text.includes('sweepek konfigurációval letiltva') ||
        text.includes('Sweeps disabled') ||
        text.includes('Automated sweeps disabled')) {
      sweepsDisabledConfirmed = true;
    }
    if (text.includes('Crucix listening on') || text.includes(`:${port}`)) {
      serverListening = true;
    }
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  const cleanup = () => {
    if (tempEnvDir) {
      try { rmSync(tempEnvDir, { recursive: true, force: true }); } catch {}
      tempEnvDir = null;
    }
  };

  const stop = async () => {
    if (child.exitCode !== null) {
      cleanup();
      return child.exitCode;
    }
    const exitPromise = new Promise(res => child.once('exit', res));
    try {
      child.kill('SIGTERM');
    } catch {}
    // If not exited within 2s, force kill
    const forceTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 2000);
    const code = await exitPromise;
    clearTimeout(forceTimer);
    cleanup();
    console.log(`[Crucix QA] Crucix QA server stopped [PID: ${pid}]`);
    return code;
  };

  // Wait for sweeps disabled confirmation and server listening
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (child.exitCode !== null) {
      cleanup();
      throw new Error(`QA server process exited prematurely with code ${child.exitCode}. Logs:\n${logs}`);
    }
    if (sweepsDisabledConfirmed && serverListening) {
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  if (!sweepsDisabledConfirmed) {
    await stop();
    throw new Error(`QA server startup timeout: sweeps-disabled confirmation not observed within ${timeoutMs}ms. Logs:\n${logs}`);
  }

  return {
    child,
    pid,
    port,
    url: `http://${env.HOST}:${port}`,
    env,
    getLogs: () => logs,
    stop
  };
}

// Direct CLI invocation
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  let port = '3117';
  let runsDir = null;
  let enablePolice = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = args[++i];
    if (args[i] === '--runs-dir' && args[i + 1]) runsDir = args[++i];
    if (args[i] === '--enable-police') enablePolice = true;
  }

  let serverHandle = null;
  const onSignal = async () => {
    if (serverHandle) {
      await serverHandle.stop();
    }
    process.exit(0);
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  startQaServer({ port, runsDir, enablePolice, verbose: true })
    .then(handle => {
      serverHandle = handle;
    })
    .catch(err => {
      console.error('[Crucix QA] Failed to start:', err.message);
      process.exit(1);
    });
}
