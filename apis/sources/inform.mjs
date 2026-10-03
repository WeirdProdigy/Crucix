// INFORM Risk Index (European Commission Joint Research Centre, DRMKC / INFORM partnership): a 0-10 country risk
// baseline for humanitarian crises and disasters (higher is worse), published once or twice a year.
// Key-less, a plain source (health row only), not a live-row source: no POLICIES entry. A baseline, not a forecast.
//   GET .../Workflows/GetByYear/<year>  -> [{WorkflowId, Name, FlagGnaPublished, System, Iso3, ...}] the releases of a data year
//   GET .../Countries/Scores/?WorkflowId=<id>&IndicatorId=INFORM  -> [{Iso3, IndicatorId, IndicatorScore, ...}] (~190 rows)
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime } from '../utils/freshness.mjs';

const SOURCE = 'INFORM-Risk';
const BASE = 'https://drmkc.jrc.ec.europa.eu/inform-index/API/InformAPI';
// The JRC host resets the connection for the default Node/Crucix User-Agent (measured 2026-10-03: 2 of 12 requests got through,
// the same with a plain Crucix or "Mozilla/5.0 (compatible; ...)" agent); a browser-style agent that names Crucix got 10 of 10.
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) Crucix/2.13 Safari/537.36';
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024, headers: Object.freeze({ 'User-Agent': USER_AGENT }) });
const LIST_TTL = 24 * 3600000; // a newly published release is noticed within a day
const SCORES_TTL = 7 * 24 * 3600000; // the scores of a release, cached against its WorkflowId
const MAX_REQUESTS = 2; // per call, cold
const MAX_WORKFLOWS = 500;
const MAX_ROWS = 1000;
const MAX_CACHE = 6;
const DAY = 24 * 3600000;

const ATTRIBUTION = release => `INFORM Risk Index, European Commission Joint Research Centre (DRMKC) / INFORM partnership, ${release}.`;
const LICENSE = 'INFORM states "INFORM is open-source"; no licence text is published on the pages checked, so cite the source';
const RIGHTS = 'The INFORM Risk Index (European Commission Joint Research Centre, DRMKC, with the INFORM partnership) describes itself as "INFORM is open-source" (a "universal public good"). The terms and results pages checked on 2026-10-03 state no licence, and no key is needed; Crucix cites the source and the release and states no licence beyond that wording. The score is a 0-10 index of the risk of a humanitarian crisis or disaster (higher is worse): a yearly baseline, not a forecast of events.';

// Two small maps: the release lists by data year (24 h) and the scores by WorkflowId (7 days).
const state = { lists: new Map(), scores: new Map() };

class Failure extends Error {}
const failure = message => new Failure(message);
const SHAPE = 'INFORM returned an unexpected payload shape';

const iso = ms => new Date(ms).toISOString();
const unavailable = (message, now) => ({ source: SOURCE, status: 'error', timestamp: iso(now), error: String(message).slice(0, 300) });

function remember(map, key, value, now) {
  map.delete(key);
  map.set(key, { value, at: now });
  while (map.size > MAX_CACHE) map.delete(map.keys().next().value);
}
const recall = (map, key, ttl, now) => {
  const hit = map.get(key);
  return hit && now >= hit.at && now - hit.at < ttl ? hit.value : null;
};

// The newest published global release in a list of workflows: {id, name, published}, or null when none is published.
function latestRelease(workflows, now) {
  if (!Array.isArray(workflows) || workflows.length > MAX_WORKFLOWS) throw failure(SHAPE);
  let best = null;
  for (const item of workflows) {
    if (!item || typeof item !== 'object' || item.System !== 'INFORM' || item.Iso3) continue;
    const { WorkflowId: id, Name: name, FlagGnaPublished: published } = item;
    // The provider's timestamps carry no zone (2026-09-02T00:00:00): they are UTC.
    const stamp = providerTime(published, { assumeUTC: true });
    const time = stamp ? Date.parse(stamp) : NaN;
    if (!Number.isInteger(id) || id <= 0 || typeof name !== 'string' || !name.trim() || name.length > 120) continue;
    if (!Number.isFinite(time) || time > now + DAY) continue; // not published (yet)
    if (!best || time > best.time || (time === best.time && id > best.id)) best = { id, name: name.trim(), published: new Date(time).toISOString().slice(0, 10), time };
  }
  return best && { id: best.id, name: best.name, published: best.published };
}

// workflows: the release list(s) of GetByYear; scores: the Countries/Scores rows of the newest release in them.
// A changed shape is an error result.
export function parseInform(workflows, scores, now = Date.now()) {
  try {
    const release = latestRelease(workflows, now);
    if (!release) throw failure('INFORM lists no published release');
    if (!Array.isArray(scores) || scores.length > MAX_ROWS) throw failure(SHAPE);
    const countries = new Map();
    let bad = 0;
    for (const row of scores) {
      const score = row?.IndicatorScore;
      if (!row || typeof row !== 'object' || row.IndicatorId !== 'INFORM' || typeof row.Iso3 !== 'string' || !/^[A-Z]{3}$/.test(row.Iso3)
        || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10 || countries.has(row.Iso3)) { bad += 1; continue; }
      countries.set(row.Iso3, { score });
    }
    if (!countries.size || bad * 10 > scores.length) throw failure(SHAPE);
    return { source: SOURCE, status: 'ok', timestamp: iso(now), release: release.name, workflowId: release.id, published: release.published,
      countries: Object.fromEntries([...countries].sort(([a], [b]) => a < b ? -1 : 1)),
      attribution: ATTRIBUTION(release.name), rights: RIGHTS, license: LICENSE };
  } catch (error) {
    return unavailable(error instanceof Failure ? error.message : SHAPE, now);
  }
}

// A reply carrying the fetch helper's own error fails with a fixed message: no provider text, no URL.
function reply(response) {
  if (response === null || typeof response !== 'object') throw failure(SHAPE);
  if (!Array.isArray(response) && response.error) throw failure(`INFORM request failed${Number.isInteger(response.status) && response.status >= 400 ? ` (HTTP ${response.status})` : ''}`);
  return response;
}

// At most two requests per call when cold: the release list of the current data year, then the scores. Releases of a
// data year appear late (the current year's list is empty until the mid-year release), so an empty list falls back to
// the previous year; that costs one more request, so the scores of such a release are fetched by the next sweep.
export async function briefing(options = {}) {
  const now = options.now ?? Date.now();
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  try {
    let requests = 0;
    const year = new Date(now).getUTCFullYear();
    let workflows = null;
    let release = null;
    for (const candidate of [year, year - 1]) {
      let list = useCache ? recall(state.lists, candidate, LIST_TTL, now) : null;
      if (!list) {
        requests += 1;
        list = reply(await fetcher(`${BASE}/Workflows/GetByYear/${candidate}`, REQUEST));
        if (!Array.isArray(list)) throw failure(SHAPE);
        latestRelease(list, now); // validates the list before it is kept
        if (useCache) remember(state.lists, candidate, list, now);
      }
      release = latestRelease(list, now);
      if (release) { workflows = list; break; }
    }
    if (!release) throw failure('INFORM lists no published release');
    let scores = useCache ? recall(state.scores, release.id, SCORES_TTL, now) : null;
    if (!scores) {
      if (requests >= MAX_REQUESTS) throw failure('INFORM release found; its scores are fetched on the next sweep');
      scores = reply(await fetcher(`${BASE}/Countries/Scores/?WorkflowId=${release.id}&IndicatorId=INFORM`, REQUEST));
      const result = parseInform(workflows, scores, now);
      if (result.status !== 'ok') throw failure(result.error);
      if (useCache) remember(state.scores, release.id, scores, now);
      return result;
    }
    return parseInform(workflows, scores, now);
  } catch (error) {
    return unavailable(error instanceof Failure ? error.message : 'INFORM request failed', now);
  }
}
