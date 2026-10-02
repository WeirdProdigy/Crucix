# Record Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline "open records" expansion of the "Current public data" panel with summary cards, a docked Inspector panel and a full-screen record browser, on one shared severity vocabulary.

**Architecture:** Server: `events.mjs` learns provider severity words, `live-sources.mjs` keeps per-record `facts` and an `eventId`. Browser: a pure `record-core.js` (severity, filter, sort, URL hash, store, transitions), a string-rendering `record-inspector.js` with a thin DOM controller, and `record-inspector.css`. The existing event dialog (`CrucixIntelligence.openEvent`) stays the single-record detail view.

**Tech Stack:** Node 22/24 ESM, `node:test`, vanilla browser JS (no libraries), optional Playwright QA.

**Spec:** `docs/superpowers/specs/2026-10-02-record-inspector-design.md`

## Global Constraints

- No new runtime dependency, no browser library; every new browser file is added to `sw.js` `BASE` and `jarvis.html`.
- Per-source record cap stays 100; Inspector page size 25 (`show 25 more`); `facts` ≤ 8 entries, label ≤ 40 chars, value ≤ 120 chars string, finite number or boolean; search text ≤ 80 chars.
- Four displayed levels, always glyph + colour: CRITICAL ◆ `#D55E00`, HIGH ▲ `#E69F00`, WATCH ● `#F0E442`, INFO ○ `#56B4E9`, unknown `–` muted. `monitor` is INFO, never WATCH.
- `window.CrucixLiveSources` keeps `policies`, `state`, `observations`, `renderPanel(sources,t,events,now)`; `setExpanded` is removed. `policies` must equal `apis/utils/freshness.mjs` `POLICIES`.
- Only fresh records are shown (existing `validRow`/`state`); every dynamic string is escaped; links are http(s) only, no credentials, no token-bearing query (`safeUrl` rules).
- Every user-visible string exists in `locales/en.json`, `hu.json`, `fr.json`; `npm test` and `npm run check` green before release; no `.env`/private data in tests.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Version 2.9.0, `sw.js` cache `crucix-shell-v2.9.0`.

## Review Focus

- Hand-edited URL hash such as `#src=__proto__&sev=<script>&win=999&q=%00&rec=nope&view=evil` must be ignored piecewise, never throw (Task 5).
- Rows with no `eventId`/`providerId`/`id`, or two rows with identical titles, must still get unique, stable keys (Task 5).
- A selected record that drops out of the fresh set on refresh must stay visible, marked "No longer current", until closed or replaced (Tasks 5, 7, 8).
- A source that is `error`/`stale`, has zero current records, or is selected via the hash before data arrives must render a reason, not an empty or broken panel (Task 7).
- A snapshot persisted by 2.8.0 (rows without `eventId`/`facts`) must still pair records with events and keep the map markers working (Tasks 5, 8).

---

### Task 1: Provider severity words on the event scale

**Files:**
- Modify: `lib/intelligence/events.mjs` (severity block, ~lines 207-210)
- Test: `test/intelligence-events.test.mjs`, `test/live-sources-integration.test.mjs`

**Interfaces:**
- Produces: `export function normalizeSeverity(value: unknown): 'unknown'|'monitor'|'low'|'moderate'|'elevated'|'high'|'critical'|null`. Case-insensitive on `text(value,30)`; `null` means "not a severity word". Aliases: extreme, severe, red → critical; orange → high; yellow, medium → moderate; minor, info, green → low; the seven scale words map to themselves.

- [ ] **Step 1: Write the failing tests**

In `intelligence-events.test.mjs`:

```js
test('provider severity words map onto the event scale', () => {
  const cases = { Red:'critical', Extreme:'critical', Severe:'critical', Orange:'high', High:'high', Elevated:'elevated',
    Yellow:'moderate', Medium:'moderate', Moderate:'moderate', Minor:'low', Info:'low', Green:'low', Low:'low', Monitor:'monitor', unknown:'unknown' };
  for (const [word, level] of Object.entries(cases)) assert.equal(model.normalizeSeverity(word), level, word);
  for (const bad of ['', 'banana', null, 7, {}, 'x'.repeat(400)]) assert.equal(model.normalizeSeverity(bad), null);
});
```

In `live-sources-integration.test.mjs`, reusing `now` and `normalizeLiveSources`: build a GDACS source whose row has `severity:'Orange'` (kind `disaster`, `providerId`, `observedAt`/`startsAt` within the last hour, `lat`/`lon`), run `buildEvents`, assert `events[0].severity === 'high'`. Add a second assertion that an urgent Telegram entry with severity `'banana'` still becomes `'high'` (existing urgent fallback).

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/intelligence-events.test.mjs test/live-sources-integration.test.mjs`
Expected: FAIL (`normalizeSeverity` is not a function; GDACS severity is `unknown`).

- [ ] **Step 3: Implement `normalizeSeverity` and use it in `normalize()`**

Replace the inline `extreme/severe/minor` handling with `severity = normalizeSeverity(metadata.severity) ?? (category === 'urgent' || metadata.urgent ? 'high' : 'unknown')`. A literal `'unknown'` stays `'unknown'` (no urgent fallback), as today.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/intelligence-events.test.mjs test/live-sources-integration.test.mjs`
Expected: PASS, no existing test regresses.

- [ ] **Step 5: Commit** — `git add lib/intelligence/events.mjs test/intelligence-events.test.mjs test/live-sources-integration.test.mjs && git commit -m "feat: map provider severity words onto the event scale"`

### Task 2: Per-record `facts`

**Files:**
- Modify: `lib/intelligence/live-sources.mjs`
- Test: `test/live-sources-integration.test.mjs`

**Interfaces:**
- Produces: rows from `normalizeLiveSources` may carry `facts: Array<{label:string, value:string|number|boolean}>` (1–8 entries; key absent when none). `export const FACT_FIELDS` = `{ 'FIRST-EPSS':['epss','percentile','predictionWindowDays'], GDACS:['eventType'], 'NASA-EONET':['category'], Meteoalarm:['area'], ECB:['currency','rate','baseCurrency','rateType'], RIPEstat:['resource','observedNeighbours'], 'MET-Norway':['temperature','windSpeed','precipitation','precipitationHours','symbol'], OONI:['countryCode','measurementStatus','targetHost','resource','blockingConfirmed'], 'NOAA-SWPC':[] }`.
- Rules: label = the raw key. Accepted value types: string (control chars → space, cap 120), finite number, boolean; everything else, `null` and nested objects are skipped. For `MET-Norway`, `temperature`/`windSpeed`/`precipitation` become strings `"<n> <unit>"` when `row.units[key]` is a string ≤ 20 chars. A row that already has a `facts` array (re-normalization via `freshLiveSnapshot`) is sanitised with the same caps and preferred over the whitelist.

- [ ] **Step 1: Write the failing tests**
  - `facts come only from the per-source whitelist`: EPSS row `{epss:.12345, percentile:.9, secret:'x', nested:{a:1}}` → `facts` deep-equals `[{label:'epss',value:.12345},{label:'percentile',value:.9}]`; no `secret`/`nested` anywhere in the output row.
  - `facts are bounded`: pre-normalized `facts` with 20 pairs, a 41-char label, a 200-char value, an object value and a `null` value → ≤ 8 entries, label length ≤ 40, value length ≤ 120, object/`null` entries dropped.
  - `facts survive re-normalization`: `normalizeLiveSources([normalizeLiveSources({...})[0]], now)` keeps identical `facts`.
  - `MET-Norway units are appended`: `temperature:15, units:{temperature:'celsius'}` → value `'15 celsius'`; `precipitationHours:1` stays number `1`.
- [ ] **Step 2: Run to verify failure** — `node --test test/live-sources-integration.test.mjs`; Expected: FAIL on the four new tests.
- [ ] **Step 3: Implement** `factsOf(row, source)` in `normalizeLiveSources` and export `FACT_FIELDS`; reuse the module's `text`.
- [ ] **Step 4: Run to verify pass** — same command; Expected: PASS including all pre-existing tests.
- [ ] **Step 5: Commit** — `git commit -m "feat: keep bounded per-record facts for live sources"` (files: the two above).

### Task 3: `eventId` on live rows

**Files:**
- Modify: `lib/intelligence/events.mjs`, `lib/intelligence/live-sources.mjs`, `dashboard/inject.mjs` (before `V2.events = buildEvents(...)`, ~line 786), `server.mjs` (`recordSnapshotEvents`, ~line 51)
- Test: `test/live-sources-integration.test.mjs`

**Interfaces:**
- Produces in `events.mjs`: `export function liveEventId(row: object): string|null` — the exact `event-<hash>` that `buildEvents` assigns to the same live row; `null` when `row.kind` is not in `LIVE_KINDS` or the row has no title. Build it by running the file's own `normalize` with `{kind: row.kind, provider: row.source, category:'live'}`, so the identity rules cannot drift.
- Produces: `export function stampLiveEventIds(liveSources: object[]): object[]` — returns copies of the sources whose observations carry `eventId` (key omitted when `liveEventId` is `null`). Called on `V2.liveSources` in `inject.mjs` and on `snapshot.liveSources` (when it is an array) in `recordSnapshotEvents`, in both cases just before `buildEvents`.
- `normalizeLiveSources` keeps `eventId` only when it matches `/^event-[0-9a-f]{32}$/`.

- [ ] **Step 1: Write the failing tests**
  - `stamped eventId equals the id buildEvents assigns`: two sources (MET-Norway with `providerId`; GDACS row with only `url`; a third row with neither `providerId` nor `url`) → for every stamped row `events.some(e => e.id === row.eventId)`.
  - `eventId survives freshLiveSnapshot and forged values are dropped`: stamped → `freshLiveSnapshot` keeps it; a row with `eventId:'x'` or `'event-' + 'z'.repeat(32)` is normalised without `eventId`.
  - `rows of unsupported kind get no eventId` (row with `kind:'banana'` → normalised to `signal`).
- [ ] **Step 2: Run to verify failure** — `node --test test/live-sources-integration.test.mjs`; Expected: FAIL (`stampLiveEventIds` missing).
- [ ] **Step 3: Implement** the two exports, the `eventId` pass-through, and the two call sites.
- [ ] **Step 4: Run to verify pass** — `node --test test/live-sources-integration.test.mjs test/intelligence-events.test.mjs test/intelligence-integration.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: stamp live records with their event id"`.

### Task 4: Locale keys and parity test

**Files:**
- Modify: `locales/en.json`, `locales/hu.json`, `locales/fr.json`
- Create: `test/locales.test.mjs`

**Interfaces:**
- Produces keys (English text; write natural HU/FR):
  - `liveSources.openRecords` "Open records", `liveSources.topRecords` "Top records"; delete `liveSources.showRecords` (its only users are replaced in Tasks 6 and 8).
  - `inspector.*`: `title` "Record inspector", `close` "Close", `expand` "Expand to full screen", `collapse` "Back to panel", `back` "Back to list", `browserTitle` "Record browser", `allSources` "All sources", `severity` "Severity", `timeWindow` "Time window", `window1h` "1 h", `window6h` "6 h", `window24h` "24 h", `windowAll` "All", `search` "Search records", `sort` "Sort", `sortSeverity` "Severity", `sortTime` "Newest", `sortTitle` "Title", `showMore` "Show 25 more", `shown` "shown", `noMatch` "No records match the filters", `outdated` "No longer current", `lastSuccess` "Last successful update", `details` "Event details", `facts` "Facts", `location` "Location", `sourceLabel` "Source", `yes` "Yes", `no` "No", `keys` "j/k move · Enter details · / search · e expand · Esc close".
  - `inspector.level.{critical,high,watch,info,unknown}`: "Critical", "High", "Watch", "Info", "Unknown".
  - `inspector.fact.<key>` for every key in `FACT_FIELDS`, e.g. `epss` "EPSS probability", `percentile` "Percentile", `predictionWindowDays` "Window (days)", `eventType` "Event type", `windSpeed` "Wind speed", `blockingConfirmed` "Blocking confirmed" (remaining keys: plain readable names).

- [ ] **Step 1: Write the failing test** `test/locales.test.mjs`: flatten `liveSources` and `inspector` of each locale; assert the three key sets are identical, every value is a non-empty string, `liveSources.showRecords` is absent, and `inspector.fact.<key>` exists for each key in `FACT_FIELDS` (import from `lib/intelligence/live-sources.mjs`).
- [ ] **Step 2: Run to verify failure** — `node --test test/locales.test.mjs`; Expected: FAIL.
- [ ] **Step 3: Add the keys** to all three files in the same order.
- [ ] **Step 4: Run to verify pass** — `node --test test/locales.test.mjs && npm run check`; Expected: PASS, "Syntax and locale checks passed".
- [ ] **Step 5: Commit** — `git commit -m "feat: locale strings for the record inspector"`.

### Task 5: `record-core.js` — pure logic

**Files:**
- Create: `dashboard/public/record-core.js` (exposes `window.CrucixRecords`)
- Test: `test/record-core.test.mjs` (loads the file with `vm.runInNewContext` like `live-sources-integration.test.mjs`; also imports `normalizeSeverity`)

**Interfaces:**
- Types. `Level = 'critical'|'high'|'watch'|'info'|'unknown'`. `Filters = {levels:Level[], windowHours:0|1|6|24, text:string, sort:'severity'|'time'|'title'}`; defaults `{levels:[], windowHours:0, text:'', sort:'severity'}`. `Rec = {key, source, kind, title, summary, level:Level, severity:string, time:number|null, observedAt, publishedAt, forecastAt, startsAt, validUntil, place, country, lat, lon, url, eventId, facts:[], current:true}` (missing text fields `''`/`null`). `State = {source:string|null, record:string|null, filters:Filters, browserOpen:boolean, limit:number}`; closed ⇔ `source === null`; default `limit` 25.
- Produces on `window.CrucixRecords`:
  - `LEVELS`, `GLYPH`, `severityLevel(value): Level` (critical/extreme/severe/red → critical; high/elevated/orange → high; moderate/medium/yellow → watch; monitor/low/minor/info/green → info; anything else, `null`, non-strings → unknown).
  - `recordKey(row): string` = `eventId || providerId || id || title|observedAt||publishedAt`.
  - `toRecords(rows, sourceName?): Rec[]` — accepts live rows (`row.source` string) and events (`row.source.name`, `row.id`, `row.location.{label,lat,lon}`); drops non-objects and title-less rows; keeps the first of equal keys; `time = Date.parse(observedAt||publishedAt)` or `null`.
  - `filterRecords(recs, filters, now): Rec[]`, `sortRecords(recs, key): Rec[]` (stable, new array; severity → critical first, then newest, `null` times last, then title), `countByLevel(recs): Record<Level,number>`.
  - `ageLabel(ms: number|null, now): string` → `'12m'`, `'3h'`, `'2d'` or `'—'`.
  - `parseHash(hash: string, allowedSources: string[]): Partial<State>`, `serializeHash(state): string` (no leading `#`, defaults omitted). Keys: `src` (allowlist or `all`), `sev` (comma list of levels), `win` (`1|6|24|all`), `q` (control chars stripped, ≤ 80), `sort`, `rec` (`/^event-[0-9a-f]{32}$/` only), `view=browser`.
  - Transitions (pure, return a new State): `openSource(state,name)` (resets record, filters, limit; keeps `browserOpen` false), `closeAll(state)`, `selectRecord(state,key|null)`, `setFilters(state,patch)` (resets `limit` to 25, keeps `record`), `showMore(state)` (+25), `openBrowser(state)`, `closeBrowser(state)`.
  - `reconcileSelection(key, lastRec, current): {record: Rec|null, outdated: boolean}`.
  - `indexEvents(events): Map<id,event>`, `eventForRow(row, byId, events): event|null` — by `row.eventId`, else the legacy match `source.name === row.source && title === row.title && observedAt === row.observedAt`.
  - `store`: `{get(): State, set(patch): void, subscribe(fn): () => void}`, plus `createStore(initial)`.
  - `esc(value): string`, `safeUrl(raw): string|null`, `stamp(value): string` — same rules as the helpers in `live-sources.js`; leave those untouched.

- [ ] **Step 1: Write the failing tests** (names; each with exact assertions):
  - `severityLevel matches the server vocabulary`: for `['Critical','Extreme','Severe','Red','High','Elevated','Orange','Moderate','Medium','Yellow','Monitor','Low','Minor','Info','Green','unknown','banana','',null,7]` assert `severityLevel(w) === {critical:'critical',high:'high',elevated:'high',moderate:'watch',low:'info',monitor:'info',unknown:'unknown'}[normalizeSeverity(w) ?? 'unknown']`.
  - `filter and sort`: levels subset; `windowHours:6` excludes rows older than 6 h **and** rows with `time:null`, `windowHours:0` keeps them; text `'arviz'` matches title `'Árvíz'` and a `place`; sort `severity` puts critical first then newest, `null` times last; input array is not mutated.
  - `keys are unique and stable`: two rows with identical titles and no ids → equal `recordKey` ⇒ `toRecords` returns one; same title but different `observedAt` ⇒ two; `eventId` wins over `providerId`; non-object entries and title-less rows are dropped; a title containing `<img onerror=x>` is kept verbatim (escaping is a render concern).
  - `hash parsing drops hostile input piecewise`: `'#src=__proto__&sev=critical,<script>&win=999&q=%00%00abc&rec=nope&view=evil&sort=drop'` with `allowedSources=['GDACS']` → `{filters:{levels:['critical'], text:'abc'}}` only (no `source`, `record`, `windowHours`, `browserOpen`, `sort`); never throws for `''`, `'#'`, `'%E0%A4%A'`, a 10 000-char value. Round trip: `parseHash('#'+serializeHash(s), ['GDACS'])` equals the valid parts of `s`; defaults are omitted from the output.
  - `transitions and reconcile`: `openSource` resets filters and limit; `setFilters` resets limit but keeps `record`; `showMore` → 50; `closeAll` → `source:null`; `reconcileSelection('k', last, [])` → `{record: last, outdated:true}`; present in `current` → `{record: thatRec, outdated:false}`; unknown key with no `last` → `{record:null, outdated:false}`.
  - `legacy rows still pair with events`: a row without `eventId` pairs by title + `observedAt`; a row with a wrong `eventId` pairs with nothing; `indexEvents` ignores non-objects.
  - `store notifies and unsubscribes`.
- [ ] **Step 2: Run to verify failure** — `node --test test/record-core.test.mjs`; Expected: FAIL (file missing).
- [ ] **Step 3: Implement** `record-core.js` as one IIFE like `live-sources.js`; no DOM access, no `location`/`history` use (the controller owns those).
- [ ] **Step 4: Run to verify pass** — `node --test test/record-core.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: pure record core for the inspector"`.

### Task 6: Summary cards

**Files:**
- Modify: `dashboard/public/live-sources.js` (`renderPanel`, remove `expanded`/`setExpanded`), `dashboard/public/live-sources.css`
- Test: `test/live-sources-integration.test.mjs` (rewrite the browser-policy test at lines 31-47)

**Interfaces:**
- Consumes: `window.CrucixRecords` `{toRecords, sortRecords, countByLevel, GLYPH, store}` at call time (absent → no badges, no top list).
- Produces: `window.CrucixLiveSources = {policies, state, observations, renderPanel}`. Each `article.live-source` keeps `data-live-source` and `data-live-state`, adds `data-selected="true"` when `CrucixRecords.store.get().source` equals it, and contains: name link, state chip, provider time, record count (`N` + `liveSources.records`), level badges `<span class="sev sev-<level>" title="<level text>"><i aria-hidden="true"><glyph></i><count></span>` for non-zero known levels, up to three `<li>` titles of `sortRecords(records,'severity')`, and `<button type="button" class="live-open" data-open-records="<source>" aria-controls="record-inspector">` labelled `liveSources.openRecords`. No `<details>`, no `.live-detail`. Error/stale cards show their message and no button.

- [ ] **Step 1: Rewrite the test** to load `record-core.js` then `live-sources.js` into the same vm context. Keep: `JSON.stringify(api.policies) === JSON.stringify(POLICIES)`, the `observations` freshness assertions, the hostile-title assertion (`<img` absent, `&lt;img` present), the `renderPanel([null,{...,observations:[null]}])` no-throw, and both `state` assertions. Replace the `setExpanded`/`<details open>` pair with: html contains `data-open-records="MET-Norway"` and no `<details`; with `CrucixRecords.store.set({source:'MET-Norway'})` it contains `data-selected="true"`; an `error` source renders no `data-open-records`; `api.setExpanded` is `undefined`. Add: a source with 100 records renders at most 3 `<li>` and the record count `100`.
- [ ] **Step 2: Run to verify failure** — `node --test test/live-sources-integration.test.mjs`; Expected: FAIL.
- [ ] **Step 3: Implement** the card; CSS for `.live-open`, `.sev`, `.sev-*` (colours from `var(--sev-*)`; the tokens are defined in Task 7's `record-inspector.css`, and nothing is linked into the page until Task 8), the top list, `[data-selected]` outline; remove `.live-record`, `.live-detail`, `details` rules and the 540 px scroller cap on `.live-source-list`.
- [ ] **Step 4: Run to verify pass** — same command; Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: summary cards for the live data panel"`.

### Task 7: Inspector and browser rendering

**Files:**
- Create: `dashboard/public/record-inspector.js` (rendering part; `window.CrucixRecordInspector`), `dashboard/public/record-inspector.css`
- Test: `test/record-inspector.test.mjs` (vm; loads `record-core.js` then `record-inspector.js`)

**Interfaces:**
- Consumes: Task 5 API; locale keys from Task 4 via `t(key, fallback)`.
- Produces: `renderInspector(view, t, now): string` and `renderBrowser(view, t, now): string`.
  - `view = {source:{name,url,state:'ok'|'error'|'stale',observedAt,attribution,rights,license,licenseUrl}, records:Rec[] /*already filtered+sorted*/, total:number, filters:Filters, limit:number, selected:{record:Rec,outdated:boolean}|null}`; browser view adds `sources:[{name,state,count,levels:Record<Level,number>}]` and `all:boolean` (`source` is `null` when `all`).
  - Inspector DOM contract (inner HTML of `<aside id="record-inspector">`): `.ri-head` (name link, state chip, age, attribution/rights line and licence link via `safeUrl`, `data-ri-action="close"`, `data-ri-action="expand"`), `.ri-filters` (`button.ri-chip[data-ri-level][aria-pressed]`, `select#ri-window`, `input#ri-search[maxlength=80]`, `select#ri-sort`), `ul.ri-list[role=listbox]` of `li.ri-row[role=option][data-key][aria-selected][tabindex]` (glyph `aria-hidden` + visually hidden level text, title, place/country, `ageLabel`), `button.ri-more[data-ri-action="more"]` while `records.length > limit`, a `shown/total` line, `section.ri-detail`, and `p.ri-keys`.
  - Detail: summary, provider/forecast/start/valid times (`stamp`), location, `facts` as `<dl>` (label via `inspector.fact.<label>` with the raw label as fallback; booleans via `inspector.yes/no`), original link when `safeUrl` passes, and `button[data-ri-action="details"][data-event-id]` only when `eventId` is set. `outdated` adds the `inspector.outdated` badge.
  - Browser (`<dialog id="record-browser">` inner HTML): three columns `.rb-sources` (`button[data-ri-source]` per source with count and level badges, plus `all`), `.rb-list`, `.rb-detail`; same filters and detail rendering.
  - `record-inspector.css`: `:root` tokens `--sev-critical:#D55E00; --sev-high:#E69F00; --sev-watch:#F0E442; --sev-info:#56B4E9; --sev-unknown:#6a8a82`; docked 480 px panel sliding in from the right; under 700 px a full-width bottom sheet; `content-visibility:auto` with `contain-intrinsic-size:auto 56px` on `.ri-row`; `prefers-reduced-motion` disables the slide; focus rings; touch targets ≥ 44 px under 700 px.

- [ ] **Step 1: Write the failing tests** (names; assertions):
  - `rendering escapes hostile text`: titles, summaries, place, fact labels/values and attribution containing `<img onerror=x>` appear only as `&lt;img`; a `url` with `?api_key=s` and a `javascript:` url yield no `href`.
  - `paging`: 60 records, `limit:25` → exactly 25 `ri-row` and one `data-ri-action="more"`; `limit:100` → none; the `shown/total` line shows `25` and `60`.
  - `selection and outdated`: the selected key row has `aria-selected="true"`; `outdated:true` includes `No longer current`; a record without `eventId` has no `data-ri-action="details"`.
  - `states`: `state:'error'` and `'stale'` render their reason and the last-success time, zero `ri-row`; `ok` with zero records renders `liveSources.noRecords` text; records empty because of filters renders `inspector.noMatch`.
  - `browser`: lists every source with its count; `all:true` renders rows from event records whose `time` is `null` with `—`; with `windowHours:6` those rows are absent.
  - `robustness`: `renderInspector({}, t, now)`, `renderInspector(null, …)`, rows `[null, 5, {}]` do not throw.
- [ ] **Step 2: Run to verify failure** — `node --test test/record-inspector.test.mjs`; Expected: FAIL.
- [ ] **Step 3: Implement** the two functions and the CSS. No DOM access in this task.
- [ ] **Step 4: Run to verify pass** — `node --test test/record-inspector.test.mjs`; Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: inspector and browser rendering"`.

### Task 8: Controller, dashboard wiring and browser QA

**Files:**
- Modify: `dashboard/public/record-inspector.js` (add `mount`/`refresh`), `dashboard/public/jarvis.html`, `dashboard/public/sw.js` (`BASE`), `scripts/intelligence-ui-qa.mjs`, `test/fixtures/dashboard-server.mjs`
- Test: `test/pwa.test.mjs` (existing, must still pass), manual Playwright run

**Interfaces:**
- Produces: `CrucixRecordInspector.mount({getSources, getEvents, t, now})` (once, from `init()` next to `CrucixIntelligence.init`) and `CrucixRecordInspector.refresh()` (re-render keeping list scrollTop, focused row key and selection).
- `mount` creates `<aside id="record-inspector" hidden aria-hidden="true">` and `<dialog id="record-browser">` under `body`; delegates `click` for `[data-open-records]` → `openSource`, `[data-ri-action]`, `.ri-row`, `.ri-chip`, `[data-ri-source]`; `change`/`input` for the filter controls; `keydown` `j`/`k` (move), `Enter` (details), `/` (search), `e` (expand), `Escape` (close; focus returns to the opener card). Records are built with `toRecords`, current set from `CrucixLiveSources.observations(getSources())` (per source) or `getEvents()` (`all`); selection via `reconcileSelection`. The panel stays closed after the user closes it; refreshes never reopen it. "Event details" calls `CrucixIntelligence.openEvent(eventId)`. State ↔ `location.hash` via `parseHash`/`serializeHash` (`allowedSources = Object.keys(CrucixLiveSources.policies)`), written with `history.replaceState` inside `try/catch` (blocked on `file:`), read on load and `hashchange`; an unknown `rec` is ignored.
- `jarvis.html`: add `<script src="record-core.js">` before `live-sources.js`, `<script src="record-inspector.js">` after it, `<link rel="stylesheet" href="record-inspector.css">`; delete the `toggle` listener (line ~2357) and the `.live-detail` click listener (~2358); call `CrucixRecordInspector?.refresh()` after each `CrucixIntelligence?.update(currentSnapshot())` (in `refreshLiveFreshness` and `reinit`); in `currentSnapshot()` keep an event when `!names.has(source)` or its `id` is in the fresh rows' `eventId` set or the legacy title + `observedAt` match holds; replace the map-marker lookup (~line 1872) with `CrucixRecords.eventForRow(row, byId, events)` where `byId = CrucixRecords.indexEvents(events)` is built once per plot.
- `sw.js`: add `/record-core.js`, `/record-inspector.js`, `/record-inspector.css` to `BASE` (cache bump happens in Task 9).

- [ ] **Step 1: Extend the fixture and the QA script.** In `dashboard-server.mjs` the `liveSources` control branch stamps rows with `stampLiveEventIds` before `buildEvents`, unless the request also has `legacyIds=true` (the 2.8.0 shape: no `eventId`). Add QA phase `inspector` (also run by `all`), using `/control?liveSources=true` and the existing `prepare()`; run the "Event details" and map-marker checks in both stamped and `legacyIds=true` modes. Checks: card shows no `<details>`; clicking `.live-open` shows `#record-inspector` (`aria-hidden="false"`) while the map container is still visible; location hash contains `src=`; clicking a severity chip filters rows; `Escape` closes and returns focus to the card; after `/control?liveSources=true` re-applied (simulated refresh) the panel stays closed; expand opens `#record-browser[open]`; reload with `#src=GDACS&sev=high` reopens the same view; hostile hash `#src=__proto__&rec=nope` opens nothing and raises no page error; the payload `<img onerror="window.__liveXss=1">` never sets `window.__liveXss`; screenshots at 1440×1000 and 390×844 saved to the artifacts directory.
- [ ] **Step 2: Run to verify failure** — `node -e "require('playwright')"` first; if it loads, start the fixture (`node test/fixtures/dashboard-server.mjs`) and run `QA_PHASE=inspector node scripts/intelligence-ui-qa.mjs`; Expected: FAIL (no `.live-open`). If Playwright is not installed, say so in the report and skip Steps 1/2/5 verification; do not claim browser QA.
- [ ] **Step 3: Implement** the controller and the `jarvis.html`/`sw.js` changes above.
- [ ] **Step 4: Run to verify pass** — `npm test && npm run check`; Expected: all green (existing `pwa.test.mjs` and `intelligence-ui.test.mjs` included).
- [ ] **Step 5: Run browser QA** — as in Step 2 for phases `inspector` and `detail`; Expected: PASS, screenshots written.
- [ ] **Step 6: Commit** — `git commit -m "feat: dock the record inspector into the dashboard"`.

### Task 9: Release 2.9.0

**Files:**
- Modify: `package.json`, `package-lock.json`, `dashboard/public/sw.js` (`CACHE`), `CHANGELOG.md`, `README.md`, `docs/OPERATIONS.md`
- Create: `docs/releases/v2.9.0.md` (same HU + EN sections as `docs/releases/v2.8.0.md`: summary, changes, Validation with the real test count, CI links, Upgrade)

- [ ] **Step 1: Bump** version to `2.9.0` in `package.json` and both places in `package-lock.json`; `sw.js` `CACHE = 'crucix-shell-v2.9.0'`.
- [ ] **Step 2: Write** `docs/releases/v2.9.0.md` (HU and EN), the `CHANGELOG.md` index line, one README paragraph on the Inspector/browser and the severity legend, and one `docs/OPERATIONS.md` paragraph (cards, Inspector, `#src=` links, keyboard keys).
- [ ] **Step 3: Verify** — `npm test && npm run check`; Expected: green; record the real pass/skip counts in the release note.
- [ ] **Step 4: Commit, tag, push** (standing authorisation from the user's saved release rule) — `git add -A docs package.json package-lock.json dashboard CHANGELOG.md README.md && git commit -m "feat: record inspector and full-screen browser (v2.9.0)" && git tag v2.9.0 && git push fork master v2.9.0`.
- [ ] **Step 5: GitHub release** — `gh release create v2.9.0 -R mp3pintyo/Crucix --title "v2.9.0 — HU / EN" --notes-file docs/releases/v2.9.0.md --verify-tag --latest`; then `gh run list -R mp3pintyo/Crucix --limit 5` and confirm the push- and tag-triggered runs appear; wait for success.
- [ ] **Step 6: Record CI** — add the run links to `docs/releases/v2.9.0.md` and `CHANGELOG.md`, `git commit -m "docs: record v2.9.0 release and passing push-triggered CI [skip ci]"`, `git push fork master`. Never delete old workflow runs.
