import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

// Write the bytes beside the target and rename them over it, so a crash leaves
// either the old file or the new one, never a torn one. The cleanup after a
// failure is best effort: its own error never replaces the one that stopped the write.
function replaceFile(path, data) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, data);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally {
    try { if (fd !== undefined) closeSync(fd); } catch { /* the write error matters */ }
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* the write error matters */ }
  }
}

/**
 * Atomically replace `path` with the JSON of `value`. The previous primary is
 * kept as `<path>.bak` when it still parses (a corrupt file never overwrites a
 * good backup); a failed backup never blocks the write. Throws when `value`
 * cannot be serialised or the file cannot be written; the old primary is then
 * untouched and no temporary file is left behind.
 */
export function writeJsonAtomic(path, value) {
  const body = JSON.stringify(value);
  if (typeof body !== 'string') throw new TypeError('Value is not JSON-serialisable');
  mkdirSync(dirname(path), { recursive: true });
  try {
    const previous = readFileSync(path);
    JSON.parse(previous.toString('utf8'));
    replaceFile(`${path}.bak`, previous);
  } catch { /* nothing usable to back up */ }
  replaceFile(path, body);
}

function attempt(path, { maxBytes, validate }) {
  let size;
  try { size = statSync(path).size; } catch (error) {
    return error?.code === 'ENOENT' ? { absent: true } : { error: `unreadable (${error?.code || 'error'})` };
  }
  if (size > maxBytes) return { error: `file too large (${size} bytes, limit ${maxBytes})` };
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    return { error: error instanceof SyntaxError ? 'invalid JSON' : `unreadable (${error?.code || 'error'})` };
  }
  if (validate) {
    let valid = false;
    try { valid = validate(value) === true; } catch { /* a throwing validator rejects the value */ }
    if (!valid) return { error: 'failed validation' };
  }
  return { value };
}

/**
 * Read the JSON at `path`, falling back to `<path>.bak`. Oversize files, bad
 * JSON and values rejected by `validate` count as failures. Never throws.
 * `error` is set when a file existed but could not be used (also when the
 * backup rescued the read); it is absent when nothing was stored yet.
 */
export function readJsonWithBackup(path, given) {
  const { maxBytes = DEFAULT_MAX_BYTES, validate } = given ?? {};
  const limit = Number.isFinite(maxBytes) && maxBytes >= 0 ? maxBytes : DEFAULT_MAX_BYTES;
  const options = { maxBytes: limit, validate: typeof validate === 'function' ? validate : null };
  const failures = [];
  for (const [source, file] of [['primary', path], ['backup', `${path}.bak`]]) {
    const result = attempt(file, options);
    if ('value' in result) return failures.length ? { value: result.value, source, error: failures.join('; ') } : { value: result.value, source };
    if (result.error) failures.push(`${source}: ${result.error}`);
  }
  return failures.length ? { value: null, source: 'none', error: failures.join('; ') } : { value: null, source: 'none' };
}
