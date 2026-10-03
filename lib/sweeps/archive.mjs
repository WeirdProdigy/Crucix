// Sweep archive: every synthesized dashboard snapshot is kept as one gzip file under <runsDir>/sweeps/ so that a
// past sweep can be replayed and the source-health matrix can be drawn. index.json is only a cache of the files:
// whenever it is missing, unreadable or disagrees with the directory it is rebuilt from the files themselves.
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeFileAtomic, writeJsonAtomic } from '../atomic-json.mjs';
import { DOMAIN_IDS, domainOfSource } from '../domains.mjs';

export const SWEEP_ID_PATTERN = /^sweep-\d{8}T\d{6}Z$/;

export function isSweepId(value) {
  return typeof value === 'string' && SWEEP_ID_PATTERN.test(value);
}

const FILE_PATTERN = /^(sweep-\d{8}T\d{6}Z)\.json\.gz$/;
// What lib/atomic-json.mjs leaves behind when the process dies between creating and renaming its temporary file.
const TEMP_PATTERN = /^(?:sweep-\d{8}T\d{6}Z\.json\.gz|index\.json(?:\.bak)?)\.\d+\.[0-9a-f-]{36}\.tmp$/;
// A stored snapshot is read back through gunzip with this output ceiling, so a gzip bomb cannot exhaust memory;
// a snapshot that would not fit under it is refused on write, and a compressed file larger than it is never read.
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const INDEX_MAX_BYTES = 8 * 1024 * 1024;
const MAX_NAME_LENGTH = 64;
const MAX_SOURCES_PER_SWEEP = 512;
const MAX_LIST = 672;
const DEFAULT_SERIES = 48;
// The four source states; the index of a state is its archive code (0 ok, 1 stale, 2 error, 3 disabled).
export const SOURCE_STATES = Object.freeze(['ok', 'stale', 'error', 'disabled']);
const STATUS_CODES = new Map(SOURCE_STATES.map((state, code) => [state, code]));

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const countOr = (value, fallback = 0) => (isCount(value) ? value : fallback);
const positiveOr = (value, fallback) => (Number.isInteger(value) && value > 0 ? value : fallback);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function instantOf(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

// null for a time whose ISO form does not fit the 4-digit-year id format.
function idForTime(time) {
  const id = `sweep-${new Date(time).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
  return isSweepId(id) ? id : null;
}

// null when the digits of the id are not a real date.
function isoOfId(id) {
  const [, year, month, day, hour, minute, second] = /^sweep-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(id);
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString() === iso ? iso : null;
}

// The snapshot's own time when it agrees with the file name, else the time the name spells.
function timestampOf(snapshot, id) {
  const time = instantOf(snapshot?.meta?.timestamp);
  return time !== null && idForTime(time) === id ? new Date(time).toISOString() : isoOfId(id);
}

/** A source name the archive accepts (1 to 64 characters), else null. */
export const sourceName = value => (typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH ? value : null);

function codeFromRow(row) {
  if (row.disabled) return 3;
  if (row.err) return 2;
  if (row.stale) return 1;
  return 0;
}

/** The state of one health[] row: disabled wins over error, error over stale, stale over ok. */
export const sourceStateOfRow = row => SOURCE_STATES[codeFromRow(row)];

// {<source>: [code, ms|null]}. A timing status wins over the booleans of health[]; without timing (a rebuild) ms is null.
function healthOf(snapshot, timing) {
  const timings = isObject(timing) ? timing : {};
  const timed = name => (Object.hasOwn(timings, name) && isObject(timings[name]) ? timings[name] : null);
  const msOf = entry => (Number.isFinite(entry?.ms) && entry.ms >= 0 ? Math.round(entry.ms) : null);
  const cells = new Map();
  for (const row of Array.isArray(snapshot.health) ? snapshot.health : []) {
    const name = isObject(row) ? sourceName(row.n) : null;
    if (name === null || cells.has(name)) continue;
    const entry = timed(name);
    cells.set(name, [STATUS_CODES.get(entry?.status) ?? codeFromRow(row), msOf(entry)]);
  }
  for (const name of Object.keys(timings)) {
    const entry = timed(name);
    if (sourceName(name) === null || cells.has(name) || !STATUS_CODES.has(entry?.status)) continue;
    cells.set(name, [STATUS_CODES.get(entry.status), msOf(entry)]);
  }
  return Object.fromEntries([...cells].slice(0, MAX_SOURCES_PER_SWEEP));
}

function entryOf(id, snapshot, timing, bytes, timestamp) {
  const meta = isObject(snapshot.meta) ? snapshot.meta : {};
  const changes = isObject(snapshot.changes) ? snapshot.changes : {};
  return {
    id, timestamp, file: `${id}.json.gz`, bytes,
    ok: countOr(meta.sourcesOk), total: countOr(meta.sourcesQueried),
    health: healthOf(snapshot, timing),
    changeCounts: {
      events: countOr(isObject(changes.events) ? changes.events.newTotal : 0),
      sources: Array.isArray(changes.sources) ? changes.sources.length : 0,
      signals: Array.isArray(changes.signals) ? changes.signals.length : 0,
    },
  };
}

function validHealth(health) {
  if (!isObject(health)) return false;
  const names = Object.keys(health);
  return names.length <= MAX_SOURCES_PER_SWEEP && names.every(name => {
    const cell = health[name];
    return sourceName(name) !== null && Array.isArray(cell) && cell.length === 2
      && Number.isInteger(cell[0]) && cell[0] >= 0 && cell[0] <= 3
      && (cell[1] === null || (Number.isFinite(cell[1]) && cell[1] >= 0));
  });
}

function validEntry(entry) {
  return isObject(entry) && isSweepId(entry.id) && entry.file === `${entry.id}.json.gz`
    && typeof entry.timestamp === 'string' && instantOf(entry.timestamp) !== null
    && isCount(entry.bytes) && isCount(entry.ok) && isCount(entry.total) && validHealth(entry.health)
    && isObject(entry.changeCounts) && isCount(entry.changeCounts.events) && isCount(entry.changeCounts.sources) && isCount(entry.changeCounts.signals);
}

// One invalid entry invalidates the whole index. Order and duplicates need no check of their own: the index is only used
// when its ids equal the ascending file listing exactly.
function validIndex(document) {
  if (!isObject(document) || document.version !== 1 || !Array.isArray(document.sweeps)) return null;
  return document.sweeps.every(validEntry) ? document.sweeps : null;
}

const isFile = path => { try { return statSync(path).isFile(); } catch { return false; } };

export class SweepArchive {
  #dir;
  #indexPath;
  #count;
  #maxBytes;
  #maxMb;
  #now;
  #logger;
  #failed = false;
  #cleaned = false;
  #readFile;
  // Ids of files that are corrupt (not gzip, truncated, not a JSON object, oversized, a bomb, a name that is no date).
  // The rebuild leaves them out (reported once) and the directory comparison ignores them. They are the only files the
  // archive ever deletes besides pruned sweeps: see #dropCorrupt.
  #unreadable = new Set();
  // Ids of files that could not be read at all just now (locked, permissions, a failing disk): skipped for the rest of the
  // process the same way, so one bad file does not trigger a rebuild on every call, but never deleted.
  #transient = new Set();
  // The entries of the last rebuild whose index write failed. They are served as long as the files still have exactly these
  // ids, so an index that cannot be written is neither re-read from every file nor rewritten on every call.
  #unsaved = null;

  /**
   * @param {string} runsDir the runs directory; files live in `<runsDir>/sweeps/`.
   * @param {{count?: number, maxMb?: number, now?: () => number, logger?: object, readFile?: (path: string) => Buffer}} [options]
   *   `maxMb` may be fractional (tests); the environment range is enforced by the configuration, not here. `readFile` replaces
   *   fs.readFileSync for the sweep files (a test seam for read errors and read counting).
   */
  constructor(runsDir, { count = 96, maxMb = 64, now = Date.now, logger = console, readFile = readFileSync } = {}) {
    if (typeof runsDir !== 'string' || !runsDir) throw new TypeError('SweepArchive requires the runs directory');
    if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
    if (!Number.isFinite(maxMb) || maxMb < 0.001) throw new RangeError('maxMb must be at least 0.001');
    this.#dir = join(runsDir, 'sweeps');
    this.#indexPath = join(this.#dir, 'index.json');
    this.#count = count;
    this.#maxMb = maxMb;
    this.#maxBytes = Math.floor(maxMb * 1024 * 1024);
    this.#now = now;
    this.#logger = logger;
    this.#readFile = readFile;
  }

  get status() {
    return this.#failed ? 'unavailable' : 'ok';
  }

  retention() {
    return { count: this.#count, maxMb: this.#maxMb };
  }

  #warn(message) {
    try { (this.#logger?.warn ?? this.#logger?.log)?.call(this.#logger, `[Sweeps] ${message}`); } catch { /* logging never breaks the archive */ }
  }

  #pathOf(id) {
    return join(this.#dir, `${id}.json.gz`);
  }

  // The sweep ids and the leftover temporary files of the directory; null when it cannot be listed.
  #scan() {
    let dirents;
    try { dirents = readdirSync(this.#dir, { withFileTypes: true }); } catch (error) {
      return error?.code === 'ENOENT' ? { ids: [], temps: [] } : null;
    }
    const ids = [];
    const temps = [];
    for (const dirent of dirents) {
      if (!dirent.isFile()) continue;
      const match = FILE_PATTERN.exec(dirent.name);
      if (match) ids.push(match[1]); else if (TEMP_PATTERN.test(dirent.name)) temps.push(dirent.name);
    }
    return { ids: ids.sort(), temps };
  }

  #readIndex() {
    try {
      if (statSync(this.#indexPath).size > INDEX_MAX_BYTES) return null;
      return validIndex(JSON.parse(readFileSync(this.#indexPath, 'utf8')));
    } catch { return null; }
  }

  /** The validated, ascending index entries; the index is rebuilt first when it does not match the files. */
  #load() {
    const scan = this.#scan();
    if (scan && !this.#cleaned) {
      this.#cleaned = true;
      // Nothing of this process can be writing yet, so a temporary file at this point is a leftover of a crash.
      for (const name of scan.temps) { try { unlinkSync(join(this.#dir, name)); } catch { /* it is only clutter */ } }
    }
    const stored = this.#readIndex();
    if (scan === null) return stored ?? [];
    const live = scan.ids.filter(id => !this.#unreadable.has(id) && !this.#transient.has(id));
    const matches = entries => entries.length === live.length && entries.every((entry, index) => entry.id === live[index]);
    if (stored && matches(stored)) { this.#unsaved = null; return stored; }
    if (this.#unsaved && matches(this.#unsaved)) return this.#unsaved;
    if (!stored && live.length === 0) return [];
    return this.#rebuild(live);
  }

  #rebuild(ids) {
    const entries = [];
    for (const id of ids) {
      const read = this.#read(id);
      if (!read.snapshot) {
        if (read.problem === 'corrupt') this.#reportUnreadable(id, read.detail);
        else if (read.problem === 'transient') this.#reportTransient(id, read.detail);
        continue;
      }
      const timestamp = timestampOf(read.snapshot, id);
      if (timestamp === null) this.#reportUnreadable(id, 'the name is not a real date');
      else entries.push(entryOf(id, read.snapshot, null, read.bytes, timestamp));
    }
    try {
      writeJsonAtomic(this.#indexPath, { version: 1, sweeps: entries });
      this.#unsaved = null;
    } catch (error) {
      this.#unsaved = entries;
      this.#warn(`could not write the rebuilt index (${error?.code || error?.message || 'error'})`);
    }
    return entries;
  }

  #reportUnreadable(id, detail) {
    if (this.#unreadable.has(id)) return;
    this.#unreadable.add(id);
    this.#warn(`${id}.json.gz is unreadable and is skipped (${detail})`);
  }

  #reportTransient(id, detail) {
    if (this.#transient.has(id)) return;
    this.#transient.add(id);
    this.#warn(`${id}.json.gz could not be read and is skipped for now (${detail})`);
  }

  // Read and decode one file: {snapshot, bytes}, or {problem: 'missing'|'transient'|'corrupt', detail}.
  #read(id) {
    const path = this.#pathOf(id);
    let size;
    try {
      const stats = statSync(path);
      if (!stats.isFile()) return { problem: 'missing', detail: 'not a file' };
      size = stats.size;
    } catch (error) {
      return { problem: error?.code === 'ENOENT' ? 'missing' : 'transient', detail: error?.code || 'unreadable' };
    }
    if (size > MAX_SNAPSHOT_BYTES) return { problem: 'corrupt', detail: `file too large (${size} bytes)` };
    let compressed;
    try { compressed = this.#readFile(path); } catch (error) {
      return { problem: error?.code === 'ENOENT' ? 'missing' : 'transient', detail: error?.code || 'unreadable' };
    }
    let value;
    try {
      value = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_SNAPSHOT_BYTES }).toString('utf8'));
    } catch (error) {
      return { problem: 'corrupt', detail: error?.code || (error instanceof SyntaxError ? 'invalid JSON' : 'not gzip') };
    }
    if (!isObject(value)) return { problem: 'corrupt', detail: 'not a JSON object' };
    return { snapshot: value, bytes: compressed.length };
  }

  /**
   * Store one synthesized snapshot. `timing` is the raw briefing's `{<source>: {status, ms}}`. Returns `{id, timestamp, bytes}`,
   * or `null` (logged, nothing written) when a sweep with the same id is already stored (that file is never overwritten) or when
   * the retention would drop the new sweep at once because it is older than everything it keeps (a clock that went back).
   * Throws when the snapshot cannot be written; the previous index and files are then untouched and `status` is `unavailable`.
   */
  add({ snapshot, timing } = {}) {
    if (!isObject(snapshot)) throw new TypeError('add requires a snapshot object');
    try {
      let time = instantOf(snapshot.meta?.timestamp);
      let id = time === null ? null : idForTime(time);
      if (id === null) { time = this.#now(); id = idForTime(time); }
      const path = this.#pathOf(id);
      if (isFile(path)) {
        this.#warn(`${id} is already archived; the new snapshot was not stored`);
        return null;
      }
      const body = JSON.stringify(snapshot);
      if (Buffer.byteLength(body) > MAX_SNAPSHOT_BYTES) throw new RangeError('snapshot is too large to archive');
      const compressed = gzipSync(body);
      mkdirSync(this.#dir, { recursive: true });
      const entries = this.#load();
      const entry = entryOf(id, snapshot, timing, compressed.length, new Date(time).toISOString());
      const { kept, removed } = this.#prune([...entries, entry].sort(byId));
      if (removed.includes(entry)) {
        this.#warn(`${id} is older than every sweep the retention keeps; the new snapshot was not stored`);
        return null;
      }
      writeFileAtomic(path, compressed);
      // The index goes first: if it cannot be written the new file is taken back and no older sweep has been touched.
      try { writeJsonAtomic(this.#indexPath, { version: 1, sweeps: kept }); } catch (error) {
        try { unlinkSync(path); } catch { /* the index error is the one to report */ }
        throw error;
      }
      this.#unsaved = null;
      for (const old of removed) {
        try { unlinkSync(this.#pathOf(old.id)); } catch (error) { this.#warn(`could not delete ${old.id}.json.gz (${error?.code || 'error'})`); }
      }
      this.#dropCorrupt(kept[0].id);
      this.#failed = false;
      return { id, timestamp: entry.timestamp, bytes: entry.bytes };
    } catch (error) {
      this.#failed = true;
      throw error;
    }
  }

  // Oldest first out: by count, then by total bytes. The newest entry always stays.
  #prune(entries) {
    let start = Math.max(0, entries.length - this.#count);
    let total = entries.slice(start).reduce((sum, entry) => sum + entry.bytes, 0);
    while (entries.length - start > 1 && total > this.#maxBytes) total -= entries[start++].bytes;
    return { kept: entries.slice(start), removed: entries.slice(0, start) };
  }

  // A corrupt file is no sweep and counts towards neither cap, so without this it would stay for ever. Once it is older than the
  // oldest sweep that is kept it goes. A file that was merely unreadable (#transient) is never deleted, and a corrupt one that
  // is newer than the oldest kept sweep stays, because it is not known to be stale.
  #dropCorrupt(oldestKept) {
    for (const id of [...this.#unreadable]) {
      if (id >= oldestKept) continue;
      try {
        unlinkSync(this.#pathOf(id));
        this.#unreadable.delete(id);
      } catch (error) {
        if (error?.code === 'ENOENT') this.#unreadable.delete(id);
        else this.#warn(`could not delete the unreadable ${id}.json.gz (${error?.code || 'error'})`);
      }
    }
  }

  /** Rebuild the index from the files (every file read once, unreadable ones skipped). Returns the number of sweeps indexed. */
  rebuildIndex() {
    this.#unreadable.clear();
    this.#transient.clear();
    this.#unsaved = null;
    const scan = this.#scan();
    return this.#rebuild(scan ? scan.ids : []).length;
  }

  /** Newest first: `{id, timestamp, ok, total, changeCounts}`. */
  list({ limit = MAX_LIST } = {}) {
    return this.#load().slice(-positiveOr(limit, MAX_LIST)).reverse().map(({ id, timestamp, ok, total, changeCounts }) => ({ id, timestamp, ok, total, changeCounts: { ...changeCounts } }));
  }

  /** The stored snapshot, or null for an invalid id, a missing file, or a file that is corrupt, oversized or not a JSON object. */
  get(id) {
    if (!isSweepId(id)) return null;
    const read = this.#read(id);
    if (read.snapshot) return read.snapshot;
    if (read.problem === 'corrupt') this.#reportUnreadable(id, read.detail);
    return null;
  }

  /** The newest readable snapshot, or null. */
  latest() {
    const entries = this.#load();
    for (let index = entries.length - 1; index >= 0; index--) {
      const snapshot = this.get(entries[index].id);
      if (snapshot) return snapshot;
    }
    return null;
  }

  /**
   * The source-status matrix of the newest `sweeps` sweeps: columns oldest to newest, one row per source seen in them,
   * ordered by domain then name; a sweep that did not report the source has a null cell.
   */
  healthSeries({ sweeps = DEFAULT_SERIES } = {}) {
    const selected = this.#load().slice(-positiveOr(sweeps, DEFAULT_SERIES));
    const names = new Set(selected.flatMap(entry => Object.keys(entry.health)));
    const rank = name => { const domain = domainOfSource(name); return domain === null ? DOMAIN_IDS.length : DOMAIN_IDS.indexOf(domain); };
    const sources = [...names].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
    return {
      sweeps: selected.map(({ id, timestamp }) => ({ id, timestamp })),
      sources: sources.map(source => ({
        source,
        domain: domainOfSource(source),
        cells: selected.map(entry => (Object.hasOwn(entry.health, source) ? [...entry.health[source]] : null)),
      })),
    };
  }
}
