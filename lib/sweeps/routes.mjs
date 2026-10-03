// Read-only API of the sweep archive: the list of stored sweeps, one stored snapshot (replay), the changes of a time window
// and the source-health matrix. Same pattern as lib/intelligence/routes.mjs: installed after authentication, a strict query
// allowlist, 400 {error, code, field} for a bad request, a generic 503 for anything else (no stack, no provider text). What fails
// before a handler runs (a broken percent-encoding in an id) is answered by installApiErrorHandler, which the server installs
// after every /api route.
import { isSweepId } from './archive.mjs';
import { mergeChanges } from './changes.mjs';

const HOUR = 60 * 60 * 1000;
const WINDOWS = Object.freeze({ '1h': HOUR, '6h': 6 * HOUR, '24h': 24 * HOUR });
const WINDOW_NAMES = Object.freeze(['last', ...Object.keys(WINDOWS)]);
const DEFAULT_SERIES = 48;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class SweepRequestError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.code = 'INVALID_FILTER';
    this.field = field;
  }
}

// The query of one route, with every key outside `allowed` refused.
function queryOf(req, allowed) {
  if (Object.keys(req.query).some(key => !allowed.includes(key))) throw new SweepRequestError('Unknown query parameter', 'query');
  return req.query;
}

// An optional integer from 1 to `max`; `fallback` when the key is absent.
function boundedInteger(query, field, max, fallback) {
  if (!Object.hasOwn(query, field)) return fallback;
  const raw = query[field];
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new SweepRequestError(`Invalid ${field}; expected 1–${max}`, field);
  return value;
}

/**
 * Installed after the application's authentication middleware.
 * @param {import('express').Express} app
 * @param {{archive: import('./archive.mjs').SweepArchive, getCurrent: () => object|null, now?: () => number}} options
 *   `getCurrent` returns the current synthesized snapshot; `now` is the clock of the time windows (a test seam).
 */
export function installSweepRoutes(app, { archive, getCurrent, now = Date.now }) {
  const handle = fn => (req, res) => {
    try { fn(req, res); }
    catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message, code: error.code, field: error.field });
      console.error('[Sweeps] Request failed:', error?.message);
      res.status(503).json({ error: 'Sweep archive temporarily unavailable' });
    }
  };
  // `limit` and `sweeps` can ask for at most what the archive keeps.
  const retained = () => archive.retention().count;
  // sweep id -> the `changes` of that stored sweep (null: it has none), for the time windows. A stored file never changes (add()
  // does not overwrite one), so a read that succeeded stays right; a sweep that could not be read is not stored and is tried
  // again by the next request. Only ids that the archive still lists are kept, so it never holds more than the retention count.
  const memo = new Map();
  const changesOf = id => {
    if (memo.has(id)) return memo.get(id);
    const snapshot = archive.get(id);
    if (!snapshot) return undefined;
    const changes = isObject(snapshot.changes) ? snapshot.changes : null;
    memo.set(id, changes);
    return changes;
  };

  app.get('/api/sweeps', handle((req, res) => {
    const count = retained();
    const limit = boundedInteger(queryOf(req, ['limit']), 'limit', count, count);
    res.json({ sweeps: archive.list({ limit }), retention: archive.retention() });
  }));

  // The stored snapshot as it was, never passed through freshLiveSnapshot (a replay shows the sweep at its own time).
  // A client that accepts gzip gets the stored file as it is (what the archive validated, see getRaw): the same JSON text, no
  // parse-stringify-compress round trip and about a seventh of the bytes. Any other client gets the plain JSON.
  app.get('/api/sweeps/:id', handle((req, res) => {
    queryOf(req, []);
    const { id } = req.params;
    if (!isSweepId(id)) throw new SweepRequestError('Invalid sweep ID', 'id');
    const gzip = req.acceptsEncodings('gzip', 'identity') === 'gzip';
    const stored = gzip ? archive.getRaw(id) : archive.get(id);
    if (!stored) return res.status(404).json({ error: 'Sweep not found' });
    res.vary('Accept-Encoding');
    if (!gzip) return res.json(stored);
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip' });
    res.send(stored);
  }));

  app.get('/api/changes', handle((req, res) => {
    const query = queryOf(req, ['window']);
    const window = Object.hasOwn(query, 'window') ? query.window : 'last';
    if (typeof window !== 'string' || !WINDOW_NAMES.includes(window)) throw new SweepRequestError(`Invalid window; expected ${WINDOW_NAMES.join(', ')}`, 'window');
    if (window === 'last') {
      const current = getCurrent()?.changes;
      if (isObject(current)) return res.json(current);
      const stored = archive.latest()?.changes;
      return res.json(isObject(stored) ? stored : mergeChanges([]));
    }
    const end = now();
    const start = end - WINDOWS[window];
    // list() is newest first; the newest retention-count sweeps are the ones the archive keeps (its index can hold more for a
    // while after the operator lowered the count). mergeChanges wants oldest first.
    const listed = archive.list({ limit: retained() });
    const kept = new Set(listed.map(entry => entry.id));
    for (const id of memo.keys()) if (!kept.has(id)) memo.delete(id);
    const ids = listed
      .filter(entry => { const time = Date.parse(entry.timestamp); return time >= start && time <= end; })
      .map(entry => entry.id)
      .reverse();
    // A sweep whose file has gone or turned unreadable since the listing is left out; entries without changes are skipped.
    res.json(mergeChanges(ids.map(changesOf)));
  }));

  app.get('/api/source-health', handle((req, res) => {
    const count = retained();
    const sweeps = boundedInteger(queryOf(req, ['sweeps']), 'sweeps', count, Math.min(DEFAULT_SERIES, count));
    res.json(archive.healthSeries({ sweeps }));
  }));
}
