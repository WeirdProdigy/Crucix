#!/usr/bin/env node
/**
 * scripts/qa-launch.mjs
 *
 * Dedicated, guarded QA server launcher for Crucix.
 * Launches server.mjs in a fully isolated child process with:
 * - child_process.spawn with an explicit environment object (never shell string concatenation)
 * - ENABLE_SWEEPS=false (strictly zero background sweeps or external polling)
 * - Isolated non-default port (default: 3199, configurable via --port or QA_PORT)
 * - LLM, Telegram, Discord, and external outbound notifications disabled
 * - Explicit PID output to stdout
 * - ACTIVE TRIPWIRE: monitors server stdout/stderr in real time. If any line indicates
 *   sweep execution (e.g. "Running initial sweep", "Starting intelligence sweep"),
 *   the process is terminated IMMEDIATELY by PID and the launcher exits with error.
 * - Confirms that sweeps are explicitly disabled ("sweepek konfigurációval letiltva")
 *   before resolving ready.
 * - Clean PID-specific teardown on SIGINT/SIGTERM.
 */

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const DEFAULT_QA_PORT = '3199';

export const SWEEP_TRIPWIRE_PATTERNS = [
  'Running initial sweep',
  'Starting intelligence sweep',
  'Starting sweep at',
  'Sweep complete'
];

export const SWEEPS_DISABLED_PATTERNS = [
  'sweepek konfigurációval letiltva',
  'Sweeps disabled',
  'Automated sweeps disabled'
];

/**
 * Checks whether output contains any sweep-execution indicator.
 * Returns the matching pattern, or null if clean.
 */
export function checkSweepTripwire(text) {
  if (typeof text !== 'string') return null;
  for (const pat of SWEEP_TRIPWIRE_PATTERNS) {
    if (text.includes(pat)) {
      return pat;
    }
  }
  return null;
}

/**
 * Checks whether output contains explicit confirmation that sweeps are disabled.
 */
export function checkSweepsDisabledConfirmed(text) {
  if (typeof text !== 'string') return false;
  return SWEEPS_DISABLED_PATTERNS.some(pat => text.includes(pat));
}

/**
 * Terminate a process and its process tree by PID reliably across platforms.
 */
export function killPidTree(pid) {
  if (!pid || typeof pid !== 'number') return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } catch {}
  }
}

/**
 * Builds an isolated environment object for the QA server.
 */
export function buildQaEnv(options = {}) {
  const port = String(options.port || process.env.QA_PORT || DEFAULT_QA_PORT);
  const runsDir = options.runsDir || process.env.RUNS_DIR || join(ROOT_DIR, 'runs');
  const envFile = options.envFile !== undefined ? options.envFile : '';

  return {
    ...process.env,
    ENABLE_SWEEPS: 'false',
    NO_AUTO_OPEN: '1',
    HOST: options.host || '127.0.0.1',
    PORT: port,
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
    CRUCIX_ENABLE_POLICE_HAJDU: options.enablePolice ? 'true' : 'false'
  };
}

/**
 * Launches an isolated QA server child process with active sweep tripwire.
 * Returns a handle object: { child, pid, port, url, env, stop, getLogs }
 */
export async function startQaLaunch(options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  let tempEnvDir = null;
  let envFile = options.envFile;

  if (envFile === undefined) {
    tempEnvDir = mkdtempSync(join(tmpdir(), 'crucix-qa-env-'));
    envFile = join(tempEnvDir, 'empty.env');
    writeFileSync(envFile, '');
  }

  const port = String(options.port || process.env.QA_PORT || DEFAULT_QA_PORT);
  const env = buildQaEnv({ ...options, port, envFile });

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT_DIR,
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const pid = child.pid;
  console.log(`[Crucix QA-Launch] Crucix QA server started [PID: ${pid}] on http://${env.HOST}:${port}`);

  let logs = '';
  let sweepsDisabledConfirmed = false;
  let serverListening = false;
  let tripwireError = null;

  const cleanup = () => {
    if (tempEnvDir) {
      try { rmSync(tempEnvDir, { recursive: true, force: true }); } catch {}
      tempEnvDir = null;
    }
  };

  const onData = (chunk) => {
    const text = chunk.toString();
    logs += text;
    if (options.verbose) {
      process.stdout.write(text);
    }

    // ACTIVE TRIPWIRE: if a sweep started, kill process immediately
    const tripped = checkSweepTripwire(text);
    if (tripped) {
      console.error(`[Crucix QA-Launch] CRITICAL GUARD VIOLATION: Server attempted to run a sweep ("${tripped}")! Terminating PID ${pid} immediately.`);
      killPidTree(pid);
      tripwireError = new Error(`Sweep tripwire triggered: server attempted sweep ("${tripped}"). PID ${pid} terminated.`);
      return;
    }

    if (checkSweepsDisabledConfirmed(text)) {
      sweepsDisabledConfirmed = true;
    }
    if (text.includes('Crucix listening on') || text.includes(`:${port}`)) {
      serverListening = true;
    }
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

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
      killPidTree(pid);
    }, 2000);
    const code = await exitPromise;
    clearTimeout(forceTimer);
    cleanup();
    console.log(`[Crucix QA-Launch] Crucix QA server stopped [PID: ${pid}]`);
    return code;
  };

  // Wait for sweeps disabled confirmation and server listening
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (tripwireError) {
      cleanup();
      throw tripwireError;
    }
    if (child.exitCode !== null) {
      cleanup();
      throw new Error(`QA server process exited prematurely with code ${child.exitCode}. Logs:\n${logs}`);
    }
    if (sweepsDisabledConfirmed && serverListening) {
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  if (tripwireError) {
    cleanup();
    throw tripwireError;
  }

  if (!sweepsDisabledConfirmed) {
    await stop();
    throw new Error(`QA server startup timeout: sweeps-disabled confirmation not observed within ${timeoutMs}ms. PID ${pid} terminated. Logs:\n${logs}`);
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
  let port = DEFAULT_QA_PORT;
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

  startQaLaunch({ port, runsDir, enablePolice, verbose: true })
    .then(handle => {
      serverHandle = handle;
    })
    .catch(err => {
      console.error('[Crucix QA-Launch] Failed to start:', err.message);
      process.exit(1);
    });
}
