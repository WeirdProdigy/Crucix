import { NUMERIC_METRICS, COUNT_METRICS } from '../delta/engine.mjs';

// Reuse the delta engine's extractors by key, so a snapshot is read one way everywhere.
// A renamed or removed delta key fails loudly at import, not as a silently null metric.
const extractor = (table, key) => {
  const entry = table.find(item => item.key === key);
  if (!entry) throw new Error(`Delta engine has no metric "${key}"`);
  return entry.extract;
};
const numeric = key => extractor(NUMERIC_METRICS, key);
// The delta count extractors turn a missing block into 0; a registry value must be null instead.
const counted = (key, present) => {
  const extract = extractor(COUNT_METRICS, key);
  return snapshot => present(snapshot) ? extract(snapshot) : null;
};

const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const hasFinite = pick => snapshot => finite(pick(snapshot)) !== null;
const find = (rows, test) => Array.isArray(rows) ? rows.find(row => row !== null && typeof row === 'object' && test(row)) : undefined;

const deltaVix = numeric('vix');
const deltaUnemployment = numeric('unemployment');

function metric(key, label, unit, kind, extract) {
  return Object.freeze({
    key, label, unit, kind,
    /** The metric's value in a snapshot, or null when it is absent or not a finite number. Never throws. */
    read(snapshot) {
      try { return finite(extract(snapshot !== null && typeof snapshot === 'object' ? snapshot : {})); } catch { return null; }
    },
  });
}

/** Every metric an alert rule can watch, in display order. */
export const METRICS = Object.freeze([
  // The live quote is fresher than the daily FRED close; FRED is the fallback.
  metric('vix', 'VIX', 'index', 'number', s => finite(s.markets?.vix?.value) ?? deltaVix(s)),
  metric('hy_spread', 'HY spread', '%', 'number', numeric('hy_spread')),
  metric('t10y2y', '10Y-2Y spread', '%', 'number', numeric('10y2y')),
  metric('wti', 'WTI crude', 'USD/bbl', 'number', numeric('wti')),
  metric('brent', 'Brent crude', 'USD/bbl', 'number', numeric('brent')),
  metric('natgas', 'Natural gas', 'USD/MMBtu', 'number', numeric('natgas')),
  metric('gold', 'Gold', 'USD/oz', 'number', numeric('gold')),
  metric('silver', 'Silver', 'USD/oz', 'number', numeric('silver')),
  metric('y10', '10Y yield', '%', 'number', numeric('10y_yield')),
  metric('usd_index', 'USD index', 'index', 'number', numeric('usd_index')),
  metric('mortgage', '30Y mortgage', '%', 'number', numeric('mortgage')),
  metric('fed_funds', 'Fed funds rate', '%', 'number', numeric('fed_funds')),
  metric('unemployment', 'Unemployment', '%', 'number', s => finite(deltaUnemployment(s)) ?? find(s.fred, row => row.id === 'UNRATE')?.value),
  metric('btc', 'Bitcoin', 'USD', 'number', s => find(s.markets?.crypto, row => row.symbol === 'BTC-USD')?.price),
  metric('eth', 'Ethereum', 'USD', 'number', s => find(s.markets?.crypto, row => row.symbol === 'ETH-USD')?.price),
  metric('eurhuf', 'EUR/HUF', 'HUF', 'number', s => find(s.liveSources, row => row.source === 'ECB')?.metrics?.HUF),
  metric('urgent_posts', 'Urgent OSINT posts', 'posts', 'count', counted('urgent_posts', s => Array.isArray(s.tg?.urgent))),
  metric('who_alerts', 'WHO alerts', 'alerts', 'count', counted('who_alerts', s => Array.isArray(s.who))),
  metric('conflict_events', 'Conflict events', 'events', 'count', counted('conflict_events', hasFinite(s => s.acled?.totalEvents))),
  metric('conflict_fatalities', 'Conflict fatalities', 'fatalities', 'count', counted('conflict_fatalities', hasFinite(s => s.acled?.totalFatalities))),
  metric('sources_ok', 'Sources OK', 'sources', 'count', counted('sources_ok', hasFinite(s => s.meta?.sourcesOk))),
  metric('sources_failed', 'Sources failed', 'sources', 'count', s => s.meta?.sourcesFailed),
  metric('sources_stale', 'Sources stale', 'sources', 'count', s => s.meta?.sourcesStale),
]);

export const METRIC_KEYS = Object.freeze(METRICS.map(item => item.key));

/** Every registry key mapped to its current value in `snapshot` (null when unavailable). */
export function metricValues(snapshot) {
  return Object.fromEntries(METRICS.map(item => [item.key, item.read(snapshot)]));
}
