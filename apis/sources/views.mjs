// VIEWS conflict forecasts (Uppsala University and PRIO): the predicted risk of state-based armed conflict
// per country for the three months after the run's data month. Key-less, a plain source (health row only).
// Not a live-row source: no POLICIES entry. A forecast, not an observed event.
//   GET https://api.viewsforecasting.org/                                  -> {runs: [...]}
//   GET https://api.viewsforecasting.org/{run}/cm/sb?month=..&month=..&month=..  -> {data: [...], page_count, ...}
import { safeFetch } from '../utils/fetch.mjs';

const SOURCE = 'VIEWS-Forecast';
const ROOT = 'https://api.viewsforecasting.org';
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
const LIST_TTL = 24 * 3600000; // the run listing is checked once a day
const STALE_MS = 45 * 24 * 3600000; // the last good payload outlives a failing provider for 45 days
const FORECAST_MONTHS = 3;
const MAX_RUNS = 5000;
const MAX_ROWS = 5000;
const MAX_COUNTRIES = 300;
// Never the `current` alias (HTTP 422): the lexicographically greatest id of this shape is the newest run.
const RUN_ID = /^fatalities\d+_(\d{4})_(\d{2})_t\d+$/;

const ATTRIBUTION = run => `Conflict forecasts: VIEWS (Uppsala University and PRIO), run ${run}. Hegre et al. 2022, 'Forecasting fatalities'; Hegre et al. 2021, J. Peace Research 58(3).`;
const LICENSE = 'No data licence stated by VIEWS; cite the source (non-commercial use is consistent with the licences of its code repositories)';
const RIGHTS = 'VIEWS (Uppsala University and PRIO) publishes these forecasts through its public API. No page or wiki checked on 2026-10-03 states a licence or terms of use for the API data, and no key or rate limit is mentioned; this is not a licence grant and does not claim CC BY 4.0. The code repositories carry CC BY-NC 4.0 (viewsforecasting), CC BY-NC-SA 4.0 (views_pipeline) and MIT (views_api) licences, and the README asks users to cite the work, so Crucix cites the source and the run and keeps its use non-commercial. main_dich is the predicted probability of at least 25 battle-related deaths in state-based armed conflict in the country-month; main_mean is the point prediction of fatalities. These are model forecasts, not observed events.';

// The one cache of the adapter: the list of runs (24 h) and the last good payload, which is also the data cached against its run id.
const state = { list: null, good: null };

class Failure extends Error {}
const failure = message => new Failure(message);
const SHAPE = 'VIEWS returned an unexpected payload shape';

const iso = ms => new Date(ms).toISOString();
// VIEWS month id: January 1980 is 1.
const monthId = (year, month) => (year - 1980) * 12 + month;
const unavailable = (message, now) => ({ source: SOURCE, status: 'error', timestamp: iso(now), error: String(message).slice(0, 300) });

// The newest run and the three months after its data month (run fatalities003_2026_08_t01 -> forecasts for 2026-09.. = ids 561..563).
function selectRun(runList) {
  const runs = runList && typeof runList === 'object' && Array.isArray(runList.runs) ? runList.runs : null;
  if (!runs || runs.length > MAX_RUNS) throw failure(SHAPE);
  let run = null;
  for (const id of runs) if (typeof id === 'string' && id.length <= 80 && RUN_ID.test(id) && (run === null || id > run)) run = id;
  if (run === null) throw failure('VIEWS lists no forecast run');
  const [, year, month] = RUN_ID.exec(run).map(Number);
  if (!(month >= 1 && month <= 12)) throw failure(SHAPE);
  const first = monthId(year, month) + 1;
  return { run, months: Array.from({ length: FORECAST_MONTHS }, (_, index) => first + index) };
}

const integer = value => typeof value === 'number' && Number.isInteger(value);
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

// One country-month row, or null when it is not what the API documents.
function parseRow(row, months) {
  if (!row || typeof row !== 'object') return null;
  const { isoab, name, month_id: id, year, month, main_dich: dich, main_mean: mean } = row;
  if (typeof isoab !== 'string' || !/^[A-Z]{3}$/.test(isoab) || !months.includes(id)) return null;
  if (!integer(year) || !integer(month) || monthId(year, month) !== id) return null;
  if (typeof dich !== 'number' || !Number.isFinite(dich) || dich < 0 || dich > 1) return null;
  if (typeof mean !== 'number' || !Number.isFinite(mean) || mean < 0) return null;
  const label = text(name, 80);
  return label ? { iso3: isoab, name: label, month: { month_id: id, year, month, main_dich: dich, main_mean: mean } } : null;
}

// runList: the root listing ({runs}); response: the cm/sb response ({data, next_page, ...}). A changed shape is an error result.
export function parseViews(runList, response, now = Date.now()) {
  try {
    const { run, months } = selectRun(runList);
    const rows = response && typeof response === 'object' && !response.error && Array.isArray(response.data) ? response.data : null;
    if (!rows || rows.length > MAX_ROWS) throw failure(SHAPE);
    if (response.next_page) throw failure('VIEWS returned a paginated payload'); // the three-month query fits one page
    const countries = new Map();
    const seen = new Set();
    const present = new Set();
    let bad = 0;
    for (const row of rows) {
      const parsed = parseRow(row, months);
      const key = parsed && `${parsed.iso3}:${parsed.month.month_id}`;
      if (!parsed || seen.has(key) || (!countries.has(parsed.iso3) && countries.size >= MAX_COUNTRIES)) { bad += 1; continue; }
      seen.add(key);
      present.add(parsed.month.month_id);
      const entry = countries.get(parsed.iso3) ?? { name: parsed.name, months: [] };
      entry.months.push(parsed.month);
      countries.set(parsed.iso3, entry);
    }
    if (!seen.size || bad * 10 > rows.length) throw failure(SHAPE);
    for (const entry of countries.values()) entry.months.sort((a, b) => a.month_id - b.month_id);
    return { source: SOURCE, status: 'ok', timestamp: iso(now), run,
      months: months.filter(id => present.has(id)),
      countries: Object.fromEntries([...countries].sort(([a], [b]) => a < b ? -1 : 1)),
      attribution: ATTRIBUTION(run), rights: RIGHTS, license: LICENSE };
  } catch (error) {
    return unavailable(error instanceof Failure ? error.message : SHAPE, now);
  }
}

// A reply that is not an object (or carries the fetch helper's own error) fails with a fixed message: no provider text, no URL.
function reply(response) {
  if (!response || typeof response !== 'object') throw failure(SHAPE);
  if (response.error) throw failure(`VIEWS request failed${Number.isInteger(response.status) && response.status >= 400 ? ` (HTTP ${response.status})` : ''}`);
  return response;
}

// At most two requests when cold (the run listing, then the data of a new run); nothing is requested for a run already held.
export async function briefing(options = {}) {
  const now = options.now ?? Date.now();
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  try {
    let list = useCache && state.list && now >= state.list.at && now - state.list.at < LIST_TTL ? state.list.value : null;
    if (!list) {
      list = reply(await fetcher(`${ROOT}/`, REQUEST));
      selectRun(list); // only a listing that holds a run is kept
      if (useCache) state.list = { value: list, at: now };
    }
    const { run, months } = selectRun(list);
    if (useCache && state.good?.run === run) return { ...state.good.payload, timestamp: iso(now) };
    const data = reply(await fetcher(`${ROOT}/${run}/cm/sb?${months.map(id => `month=${id}`).join('&')}`, REQUEST));
    const result = parseViews(list, data, now);
    if (result.status !== 'ok') throw failure(result.error);
    if (useCache) state.good = { run, payload: result, at: now };
    return result;
  } catch (error) {
    const message = error instanceof Failure ? error.message : 'VIEWS request failed';
    const good = useCache ? state.good : null;
    // A later failure keeps showing the last good forecasts, marked stale, for 45 days.
    if (good && now >= good.at && now - good.at < STALE_MS) {
      return { ...good.payload, timestamp: iso(now), stale: true, staleSince: iso(good.at), staleReason: message };
    }
    return unavailable(message, now);
  }
}
