import { join } from 'node:path';
import { readJsonWithBackup, writeJsonAtomic } from '../atomic-json.mjs';
import { countryByIso3 } from './countries.mjs';
import { refTime } from './entities.mjs';
import { RISK_KINDS, RISK_MODEL_VERSION } from './risk.mjs';

// The logged question (spec section 5): "within 7 days, will at least one NEW (first seen after the prediction),
// >= high, RISK_KINDS, located event happen in the country?" One prediction per country per UTC day.
const VERSION = 1;
const DAY = 86400000;
const HORIZON = 7 * DAY;
const KEEP_RESOLVED = 90 * DAY;
const MAX_ROWS = 20000;
const MIN_SCORE = 10;          // a country is predicted when its score is at least this ...
const ACTIVE_DAYS = 7;         // ... or it had a located RISK_KINDS event in the last 7 days
const BIN_MIN_RESOLVED = 20;   // a score bin's observed rate becomes the said probability from this many resolved rows
const MIN_CALIBRATION = 30;    // below this many resolved rows the metrics are "not enough data"

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const binOf = score => Math.min(9, Math.max(0, Math.floor(score / 10)));
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const reasonOf = error => error?.code || (error instanceof Error ? error.message : String(error));

function normalizeRow(value) {
  if (!object(value) || typeof value.iso3 !== 'string' || !countryByIso3(value.iso3) || !finite(value.at) || !finite(value.score) || !finite(value.p)) return null;
  if (typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || value.p < 0 || value.p > 1) return null;
  const resolved = value.outcome === 0 || value.outcome === 1;
  if (resolved && !finite(value.resolvedAt)) return null;
  return {
    id: `${value.iso3}-${value.day}`, iso3: value.iso3, day: value.day, at: value.at, score: value.score, p: value.p,
    uncalibrated: value.uncalibrated === true, model: finite(value.model) ? value.model : RISK_MODEL_VERSION,
    outcome: resolved ? value.outcome : null, resolvedAt: resolved ? value.resolvedAt : null,
    evidence: resolved && typeof value.evidence === 'string' ? value.evidence.slice(0, 80) : null,
  };
}

export class PredictionJournal {
  #now;

  constructor(runsDir, { now = Date.now } = {}) {
    this.path = join(String(runsDir), 'intelligence', 'predictions.json');
    this.#now = typeof now === 'function' ? now : Date.now;
    this.rows = [];
    this.status = 'empty';
  }

  /** Read the file (or its .bak); missing or corrupt gives an empty journal. Never throws. */
  load() {
    const result = readJsonWithBackup(this.path, { validate: value => object(value) && value.version === VERSION && Array.isArray(value.rows) });
    const seen = new Set();
    this.rows = [];
    for (const raw of result.value?.rows ?? []) {
      const row = normalizeRow(raw);
      if (row && !seen.has(row.id)) { seen.add(row.id); this.rows.push(row); }
    }
    this.rows.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    this.status = result.source === 'primary' ? 'ok' : result.source === 'backup' ? 'recovered' : result.error ? 'corrupt' : 'empty';
    this.#prune(this.#now());
    return this.status;
  }

  // The said probability: the observed rate of the score's 10-wide bin once it has 20 resolved rows, else score / 100.
  #probability(score) {
    const bin = binOf(score);
    let n = 0, hits = 0;
    for (const row of this.rows) if (row.outcome !== null && binOf(row.score) === bin) { n++; hits += row.outcome; }
    return n >= BIN_MIN_RESOLVED ? { p: round(hits / n, 3), uncalibrated: false } : { p: round(Math.min(100, Math.max(0, score)) / 100, 3), uncalibrated: true };
  }

  /** Log today's prediction for every eligible country not yet predicted today. A clock behind the last entry logs nothing. */
  log(scores, store, now = this.#now()) {
    if (!Array.isArray(scores) || !finite(now) || (this.rows.length && now < this.rows.at(-1).at)) return 0;
    const day = new Date(now).toISOString().slice(0, 10);
    const today = new Set(this.rows.filter(row => row.day === day).map(row => row.iso3));
    let added = 0;
    for (const score of scores) {
      if (!object(score) || !countryByIso3(score.iso3) || !finite(score.score) || today.has(score.iso3)) continue;
      const active = store.countryEvents(score.iso3, { sinceMs: now - ACTIVE_DAYS * DAY, kinds: RISK_KINDS, mode: 'l' }).length > 0;
      if (score.score < MIN_SCORE && !active) continue;
      this.rows.push({ id: `${score.iso3}-${day}`, iso3: score.iso3, day, at: now, score: score.score, ...this.#probability(score.score),
        model: RISK_MODEL_VERSION, outcome: null, resolvedAt: null, evidence: null });
      today.add(score.iso3);
      added++;
    }
    this.#prune(now);
    return added;
  }

  /**
   * Resolve the open predictions whose horizon has passed. An event counts when it is NEW (first seen after the prediction) and happened inside
   * the horizon: its own time capped at its first sighting (refTime), so an event first seen after the horizon (the server was down) still counts.
   * Resolved rows never change.
   */
  resolve(store, now = this.#now()) {
    if (!finite(now)) return 0;
    let resolved = 0;
    for (const row of this.rows) {
      if (row.outcome !== null || now < row.at + HORIZON) continue;
      const hit = store.countryEvents(row.iso3, { kinds: RISK_KINDS, mode: 'l' })
        .filter(ref => (ref.l === 'critical' || ref.l === 'high') && ref.t > row.at && refTime(ref) <= row.at + HORIZON)
        .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1))[0];
      row.outcome = hit ? 1 : 0;
      row.resolvedAt = now;
      row.evidence = hit ? hit.id : null;
      resolved++;
    }
    this.#prune(now);
    return resolved;
  }

  #prune(now) {
    this.rows = this.rows.filter(row => row.outcome === null || row.resolvedAt >= now - KEEP_RESOLVED);
    if (this.rows.length > MAX_ROWS) {
      // Drop the oldest resolved rows first, then the oldest open ones.
      const excess = this.rows.length - MAX_ROWS;
      const drop = new Set([...this.rows].sort((a, b) => (a.outcome === null) - (b.outcome === null) || a.at - b.at).slice(0, excess));
      this.rows = this.rows.filter(row => !drop.has(row));
    }
  }

  /**
   * Metrics over the resolved rows, or null when nothing was logged yet. With fewer than 30 resolved rows `enough` is
   * false and the scores are null ("not enough data, n = ...").
   */
  calibration() {
    if (!this.rows.length) return null;
    const resolved = this.rows.filter(row => row.outcome !== null);
    const n = resolved.length;
    const open = this.rows.length - n;
    if (n < MIN_CALIBRATION) return { n, open, enough: false, baseRate: null, brier: null, brierBase: null, skill: null, bins: [] };
    const baseRate = resolved.reduce((sum, row) => sum + row.outcome, 0) / n;
    const brier = resolved.reduce((sum, row) => sum + (row.p - row.outcome) ** 2, 0) / n;
    const brierBase = resolved.reduce((sum, row) => sum + (baseRate - row.outcome) ** 2, 0) / n;
    const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, hits: 0, sumP: 0 }));
    for (const row of resolved) {
      const bin = bins[Math.min(9, Math.floor(row.p * 10))];
      bin.n++; bin.hits += row.outcome; bin.sumP += row.p;
    }
    return {
      n, open, enough: true, baseRate: round(baseRate, 4), brier: round(brier, 4), brierBase: round(brierBase, 4),
      skill: brierBase > 0 ? round(1 - brier / brierBase, 4) : null,
      bins: bins.map(({ lo, hi, n: count, hits, sumP }) => ({ lo, hi, n: count, rate: count ? round(hits / count, 4) : null, p: count ? round(sumP / count, 4) : null })),
    };
  }

  /** The newest rows first (copies). */
  recent(limit = 50) {
    const count = Number.isInteger(limit) ? Math.max(0, Math.min(MAX_ROWS, limit)) : 50;
    return count ? this.rows.slice(-count).reverse().map(row => ({ ...row })) : [];
  }

  /** Write the file atomically. Never throws: false (and a warning) on failure. */
  save(logger = console) {
    try {
      writeJsonAtomic(this.path, { version: VERSION, rows: this.rows });
      return true;
    } catch (error) {
      try { logger?.warn?.(`[Risk] predictions.json not saved (${reasonOf(error)})`); } catch { /* logging never breaks the journal */ }
      return false;
    }
  }
}
