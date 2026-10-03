# Dashboard structure (lenses, Ctrl+K, health matrix, changes, replay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard navigable and time-aware: eight domain lenses with a compact grouped live panel, a Ctrl+K command palette, a source-health matrix over past sweeps, a "what changed" panel, and replay of archived sweeps.

**Architecture:** A new server-side sweep archive (`lib/sweeps/`) stores each synthesized snapshot gzip-compressed plus a compact index (health per source, change counts); a pure `buildChanges` diff is attached to every snapshot as `changes`; four read-only routes expose list/snapshot/changes/health. In the browser, small IIFE modules (clock, lens, palette, health matrix, changes, replay) plug into the existing single-file dashboard; a shared domain registry (server + identical browser copy) maps every adapter to one of eight domains.

**Tech Stack:** Node 22/24 ESM, `node:zlib` (gzip), Express routes in the existing pattern, vanilla browser JS/CSS, `node:test`, Playwright QA (optional, `PLAYWRIGHT_MODULE=D:/AI/Jev/node_modules/playwright`).

**Spec:** `docs/superpowers/specs/2026-10-03-dashboard-structure-design.md` (Hungarian; the binding authority). Explore facts: `.superpowers/sdd/d-facts-server.md`, `.superpowers/sdd/d-facts-frontend.md` (line numbers there are from the 2.11.0 tree and drift; re-grep).

## Global Constraints

- No new runtime dependencies; Node >= 22 (CI runs 22 and 24 on ubuntu-24.04 and windows-2025). Run the files you add/change under Node 22 too: `npx --yes node@22 --test <files>`. Never leave a timer running or `unref`'d in server code that tests exercise.
- Server code: lib/ files in normal formatting. Browser modules `dashboard/public/*.js`: IIFE exposing `window.CrucixX`, compact one-line style like `live-sources.js`/`alerts-core.js`; **no regex lookbehind** (a test enforces it); every dynamic string escaped with the existing helpers; no inline event handlers in new modules.
- `jarvis.html` line `let D = {...};` stays ONE line; helpers called from tests stay top-level `function` declarations at column 0 (see `test/dashboard-security.test.mjs`).
- New browser files go into `dashboard/public/sw.js` `BASE`; Task 12 bumps the cache name.
- All user-visible text in en/hu/fr locale groups with identical keys in identical order (new parity tests); Hungarian wording natural, not machine-literal.
- Statuses are never colour-only: glyph + text (A's severity vocabulary CRITICAL ◆ / HIGH ▲ / WATCH ● / INFO ○ and `--sev-*` tokens in record-inspector.css).
- Read-only API routes follow `lib/intelligence/routes.mjs`: installed after authentication, strict query allowlist, `400 {error, code, field}` for validation, generic `503` otherwise (no stack), `id` validated by a strict pattern before touching the filesystem.
- Never put an unmeasured number into code comments, locale text, docs or rulings; measure it.
- Defaults: `SWEEP_ARCHIVE_COUNT` 96 (2–672), `SWEEP_ARCHIVE_MAX_MB` 64 (4–512). Change caps: `events.new` 40, `sources` 30, `signals` 20. Palette: 12 results, history search from 2 characters, `limit=6`, 200 ms debounce.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; explicit `git add` paths; never push/tag/gh in tasks other than the controller's release step.

## Review Focus

- Replay must never reach the offline cache or let a live `update`/poll overwrite it: a test with an SSE `update` during replay and one asserting no IndexedDB write.
- Frozen clock: a 2-hour-old snapshot's live sources must render as ok at its own time and must NOT render "expired"; and after leaving replay the real clock is back.
- `/api/sweeps/:id` with `..`, encoded separators, long/odd ids, and an id that is valid but whose file was deleted or corrupted: 400/404, never a path outside `sweeps/`, never a stack.
- Archive survives: corrupt index (rebuilt), torn/zero-byte gz file (skipped, not fatal), full disk/write failure (sweep still completes; status `unavailable`), retention by count and by bytes, newest never deleted.
- Changes on the first sweep after a restart use the archived latest as baseline; with no archive the result is `baseline: true` with empty lists (no flood), caps hold with 5000 new events.
- Palette: a slow older `/api/history` response must not overwrite a newer query's results; Esc/focus restore; hostile titles in results are escaped; Ctrl+K does not hijack typing inside inputs other than its own and does not collide with the inspector keys.
- Lens persistence with unavailable `localStorage`; an unknown stored lens value falls back to `all`; items without a domain only appear under `all`.
- Live panel grouping: 19 cards still reachable (expand), per-card "open records" buttons keep working after the swap via `outerHTML` every 30 s (expansion state survives a refresh).
- 390 px: no horizontal scroll with the lens bar, matrix dialog, palette and replay bar.

---

### Task 1: Domain registry (server + identical browser copy + `lenses` locale group)

**Files:**
- Create: `lib/domains.mjs`, `dashboard/public/domains.js`, `test/domains.test.mjs`
- Modify: `locales/en.json`, `locales/hu.json`, `locales/fr.json` (new `lenses` group), `test/locales.test.mjs`

**Interfaces:**
- Produces (`lib/domains.mjs`): `export const DOMAINS` — ordered array of `{ id, sources: string[] }` with the eight domains and exact source lists of spec section 2 (order: security, hazards, space, cyber, economy, supply, sanctions, health); `export function domainOfSource(name): string|null` (unknown/non-string → `null`); `export function domainOfEvent(event): string|null` — uses the event's source name (inspect `lib/intelligence/events.mjs` for the exact field, `event.source`), `null` when absent or unmapped; `export const DOMAIN_IDS` (array of ids).
- Produces (`dashboard/public/domains.js`): `window.CrucixDomains = { DOMAINS, DOMAIN_IDS, domainOfSource, domainOfEvent }` with data **identical** to the server copy (also loadable in a vm context as a script).
- Locale group `lenses`: `all` ("All"/"Mind"/"Tous"), `label` (lens bar aria-label), and one key per domain id (`security`, `hazards`, `space`, `cyber`, `economy`, `supply`, `sanctions`, `health`) in en/hu/fr, same order everywhere.

- [ ] **Step 1: Write failing tests** in `test/domains.test.mjs`: every `runSource('<name>'` in `apis/briefing.mjs` (regex over the file) and every key of `POLICIES` (`apis/utils/freshness.mjs`) is in exactly one domain; no source in two domains; no unknown source name in any domain (50 total); `domainOfSource('GDELT') === 'security'`, `domainOfSource('nope') === null`, `domainOfSource(undefined) === null`; browser copy loaded with `vm.runInNewContext` equals the server copy through `JSON.parse(JSON.stringify(...))` for `DOMAINS`; every domain id has a non-empty en/hu/fr `lenses.<id>`; extend `test/locales.test.mjs` with a `lenses` group key-and-order parity test written like the existing `liveSources, inspector and alerts` one.
- [ ] **Step 2: Run** `node --test test/domains.test.mjs test/locales.test.mjs` — expect FAIL (missing modules/keys).
- [ ] **Step 3: Implement** `lib/domains.mjs`, `dashboard/public/domains.js`, and the locale keys.
- [ ] **Step 4: Run** the same command on the local Node and Node 22 — expect PASS; run `npm run check`.
- [ ] **Step 5: Commit** `feat: domain registry for lenses`.

### Task 2: Sweep archive store

**Files:**
- Create: `lib/sweeps/archive.mjs`, `test/sweeps-archive.test.mjs`

**Interfaces:**
- Consumes: `writeJsonAtomic`/`readJsonAtomic`-style helpers of `lib/atomic-json.mjs` (read the file for the exact exports), `domainOfSource` from Task 1.
- Produces:
  - `export const SWEEP_ID_PATTERN = /^sweep-\d{8}T\d{6}Z$/; export function isSweepId(value): boolean`.
  - `export class SweepArchive { constructor(runsDir, { count = 96, maxMb = 64 } = {}) }` storing under `<runsDir>/sweeps/`.
  - `add({ snapshot, timing }): { id, timestamp, bytes }` — `snapshot.meta.timestamp` (fall back to `new Date().toISOString()` only if absent/invalid) yields the id `sweep-YYYYMMDDTHHMMSSZ`; writes `<id>.json.gz` atomically (temporary file beside it + fsync + rename, like `replaceFile` in `lib/atomic-json.mjs`), updates the index, then prunes by count and by total bytes (oldest first; the newest is never deleted); an id that already exists is NOT overwritten (returns `null` and logs once). Throws on write failure; the previous index and files stay intact.
  - Index `sweeps/index.json` (`{version:1, sweeps:[{id,timestamp,file,bytes,ok,total,health:{<source>:[code,ms|null]},changeCounts:{events,sources,signals}}]}`, oldest→newest): `code` 0 ok, 1 stale, 2 error, 3 disabled, derived from `timing[source].status` when present, otherwise from the snapshot `health[]` booleans in the order disabled → 3, err → 2, stale → 1, else 0; `ms` from `timing[source].ms`, else `null`; `ok`/`total` from `snapshot.meta.sourcesOk`/`sourcesQueried`; `changeCounts` from `snapshot.changes` (events.newTotal, sources.length, signals.length; zeros when absent).
  - `list({ limit = 672 }): Array<{id,timestamp,ok,total,changeCounts}>` newest first; `get(id): object|null` (invalid id → `null` without touching the disk; missing/corrupt/oversized/not-JSON file → `null`); `latest(): object|null`; `healthSeries({ sweeps = 48 }): { sweeps:[{id,timestamp}], sources:[{source, domain, cells:[[code,ms]|null,…]}] }` oldest→newest columns, `sources` = union of names across the selected sweeps ordered by domain order then name, a missing source in a sweep → `null`; `get status(): 'ok'|'unavailable'`; `retention(): {count, maxMb}`.
  - Index recovery: a missing, unparsable or invalid index (or one that lists a file that is gone/lists no entry for an existing `sweep-*.json.gz`) triggers `rebuildIndex()` from the files (reading each once; `health` from the snapshot's `health[]`, `ms` null, `changeCounts` from the snapshot's `changes`); a corrupt gz file is skipped, never fatal.
  - Reading uses `zlib.gunzipSync` with a hard output cap (`maxOutputLength` 64 MiB) so a gzip bomb cannot exhaust memory.

- [ ] **Step 1: Write failing tests** `test/sweeps-archive.test.mjs` (temp dir under `os.tmpdir()`, removed in `t.after`): add/list/get round trip returns a snapshot deep-equal to the input; id format and `isSweepId` accept/reject (`../x`, `sweep-1`, trailing junk, lowercase t/z, 100 kB string); duplicate id not overwritten; retention by count (`count: 3` after 5 adds keeps the 3 newest) and by bytes (`maxMb` tiny via a constructor option allowed to be fractional in tests: accept `maxMb >= 0.001` in the constructor, the env range is enforced by config); the newest is never pruned even when it alone exceeds the byte cap; corrupt index → rebuilt (health from `health[]`, ms null); zero-byte and truncated gz skipped by `get` (→ null) and by rebuild; index listing a vanished file is repaired; `healthSeries` codes/ordering/null cells/domain grouping and `sweeps` limit; write failure (make the target path a directory) throws and leaves the previous index readable; gzip bomb (a 100 MiB zero stream gzipped) → `get` null without crashing and within 2 s; `status` flips to `unavailable` after a failed add and back to `ok` after a good one.
- [ ] **Step 2: Run** `node --test test/sweeps-archive.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** `lib/sweeps/archive.mjs`.
- [ ] **Step 4: Run** the file on the local Node and Node 22 — PASS; `npm run check`.
- [ ] **Step 5: Commit** `feat: sweep archive store`.

### Task 3: Change computation

**Files:**
- Create: `lib/sweeps/changes.mjs`, `test/sweeps-changes.test.mjs`

**Interfaces:**
- Consumes: `domainOfSource`/`domainOfEvent` (Task 1), the event record shape (`lib/intelligence/events.mjs`: `id`, `title`, `kind`, `severity`, `observedAt`, source), snapshot `health[]` and `delta` (`signals.new/escalated/deescalated`, see `lib/delta/engine.mjs`).
- Produces: `export function buildChanges(previous, current): object` exactly the shape of spec section 4 (`since`, `at`, `baseline`, `events:{new,newTotal,expiredTotal}`, `sources`, `signals`, `domains`) with caps 40/30/20; `previous` may be `null`/malformed (→ `baseline: true`, empty lists, `since: null`); `export function mergeChanges(list, { limit }): object` — union of several `changes` objects (oldest→newest) for the window route: events deduped by id keeping the earliest, sorted by severity desc then newer first, caps as above, source transitions chronological, `since` = first, `at` = last, `baseline` false; `export const CHANGE_CAPS = { events: 40, sources: 30, signals: 20 }`.
- Source state used for transitions is the same 4-value state as the archive codes (ok/stale/error/disabled, precedence disabled > error > stale). `domains` counts new events plus transitions per domain id; items without a domain are counted under no domain.

- [ ] **Step 1: Write failing tests**: new/expired detection by id; severity ordering (critical > high > moderate > low > unknown, take the order from `events.mjs`) then recency; caps with 5000 new events (`newTotal` 5000, list 40); baseline for `null`, `{}`, and non-array `events`; transition list (ok→error, error→ok, new source appears = no transition, source vanishes = no transition); delta signals simplified and capped; hostile titles stay plain strings (no mutation, truncated to 200 chars surrogate-safely); `mergeChanges` dedupe/ordering/caps; the function does not mutate its inputs (deep-freeze both).
- [ ] **Step 2: Run** `node --test test/sweeps-changes.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** `lib/sweeps/changes.mjs`.
- [ ] **Step 4: Run** local Node + Node 22 — PASS.
- [ ] **Step 5: Commit** `feat: sweep change computation`.

### Task 4: Server wiring, routes, config

**Files:**
- Create: `lib/sweeps/routes.mjs`, `test/sweeps-routes.test.mjs`
- Modify: `server.mjs`, `crucix.config.mjs`, `.env.example`, `docs/OPERATIONS.md`

**Interfaces:**
- Consumes: `SweepArchive` (Task 2), `buildChanges`/`mergeChanges` (Task 3).
- Produces: `export function installSweepRoutes(app, { archive, getCurrent })` serving, per spec section 5, `GET /api/sweeps?limit=`, `GET /api/sweeps/:id`, `GET /api/changes?window=last|1h|6h|24h`, `GET /api/source-health?sweeps=`; strict allowlist (`limit` 1–672, `sweeps` 1–672 integers, `window` enum), `400 {error,code,field}` / `404` / generic `503`. `window=last` returns `getCurrent()?.changes` (or the archive `latest()` changes, or a `baseline` object when none); other windows merge archived `changes` whose `timestamp >= now − window` (read through `archive.get`, at most `retention.count` files).
- `config.sweeps = { count, maxMb }` from `SWEEP_ARCHIVE_COUNT` (default 96, 2–672) and `SWEEP_ARCHIVE_MAX_MB` (default 64, 4–512) via `envInteger`.
- Server: after `recordSnapshotEvents(synthesized)` and the alert step, compute `synthesized.changes = buildChanges(previousArchived, synthesized)` (previous = in-memory last archived snapshot, initialised at startup from `archive.latest()`), then `archive.add({ snapshot: synthesized, timing: rawData.timing })` inside try/catch (failure → log `[Sweeps] Archive failed:` once per failure, never throws), keep the snapshot as `previousArchived`; `currentData = synthesized` as before (the `changes` field is in the broadcast and `/api/data`). `/api/health` gains `archiveStatus` (`ok`/`unavailable`) and `archivedSweeps` (count). The startup re-synthesis of `runs/latest.json` is not archived. The `/api/data` freshness filter must keep `changes` untouched.

- [ ] **Step 1: Write failing tests** `test/sweeps-routes.test.mjs` on a real `express` app and `http` requests (see how `test/intelligence-routes.test.mjs` does it): list order and limit; `/api/sweeps/:id` happy path returns the stored snapshot byte-for-byte as JSON; `..%2f`, `%2e%2e`, `sweep-1`, a 10 kB id, an id with a backslash → 400 (or 404 for well-formed unknown ids) and never read outside the directory (spy: archive `get` is not called for invalid ids); corrupted file → 404; unknown query key → 400 `code`/`field`; `window=2d` → 400; `/api/changes?window=6h` merges (fixtures with synthetic timestamps; no real waiting); `/api/source-health` shape and limit; archive throwing → 503 with generic body and no stack text; responses carry no raw error text; config parsing test for the two env keys (invalid → throws like the other `envInteger` users; check `test/config*.test.mjs` for the pattern). Add a server-level test if the repo already has one for sweep wiring; otherwise a focused test of the extracted helper `archiveSweep({archive, snapshot, timing, previous})` that you export from `lib/sweeps/routes.mjs` or a small `lib/sweeps/step.mjs` (your choice, keep server.mjs thin) proving: success sets `changes`, failure never throws and keeps `changes` set.
- [ ] **Step 2: Run** `node --test test/sweeps-routes.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** the routes, config keys, `.env.example` entries, `docs/OPERATIONS.md` paragraph (retention, disk use measured in Step 4, where files live), and the `server.mjs` wiring.
- [ ] **Step 4: Measure** the real archive size: run the archive step against `runs/latest.json` re-synthesized the way `server.mjs` does at startup (`news: []`) plus one with a realistic news array if available, and record the gzip size and ratio in your report (use the numbers in `docs/OPERATIONS.md`, no estimates). Run `npm test` (full) once and `npx --yes node@22 --test test/sweeps-*.test.mjs`.
- [ ] **Step 5: Commit** `feat: sweep archive, changes and replay API`.

### Task 5: Browser clock

**Files:**
- Create: `dashboard/public/clock.js`, `test/clock.test.mjs`
- Modify: `dashboard/public/live-sources.js`, `dashboard/public/jarvis.html` (script tag, `Date.now()` call sites listed below), `dashboard/public/sw.js` (`BASE`), `test/live-sources-integration.test.mjs` or the nearest existing test as needed

**Interfaces:**
- Produces: `window.CrucixClock = { now(): number, freeze(ms: number): void, release(): void, frozen(): boolean }`; `now()` returns `Date.now()` unless frozen. `freeze` rejects non-finite values (throws `TypeError`); `release` is idempotent.
- Call sites to route through `CrucixClock.now()` (re-grep; line numbers drift): `CrucixLiveSources.state/observations/markerRows` default `now` (live-sources.js), `sourceState`'s use of it, `getAge`, `updateRuntimeStatus`, `refreshLiveFreshness`, and the `now: Date.now` passed at the DOMContentLoaded wiring. Other `Date.now()` uses (timers, request ids, animation) stay.

- [ ] **Step 1: Write failing tests** `test/clock.test.mjs` (vm context, fresh per test): `now` tracks real time; `freeze(t)` pins it; `release` restores; non-finite rejected; plus a live-sources test: a source observed 2 h before the frozen time is `ok` under `CrucixLiveSources.state(row)` with the clock frozen at that time and `expired` with the real clock, using the existing test harness in `test/live-sources-integration.test.mjs`.
- [ ] **Step 2: Run** `node --test test/clock.test.mjs test/live-sources-integration.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** `clock.js`, wire it (load it **before** `live-sources.js` in jarvis.html and in `sw.js` `BASE`; `CrucixLiveSources` must work when `CrucixClock` is absent, falling back to `Date.now`), replace the listed call sites.
- [ ] **Step 4: Run** the two files + `test/pwa.test.mjs` + `test/dashboard-security.test.mjs` on the local Node and Node 22; `npm run check`.
- [ ] **Step 5: Commit** `feat: injectable dashboard clock`.

### Task 6: Replay mode

**Files:**
- Create: `dashboard/public/replay-core.js`, `dashboard/public/replay.js`, `dashboard/public/replay.css`, `test/replay.test.mjs`
- Modify: `dashboard/public/jarvis.html` (mount point, SSE/poll gating, cache gating, header button), `dashboard/public/pwa.js` only if needed for the gate, `dashboard/public/sw.js` (`BASE`), `locales/*.json` (`replay` group), `test/locales.test.mjs`

**Interfaces:**
- Consumes: `CrucixClock` (Task 5), `GET /api/sweeps`, `GET /api/sweeps/:id` (Task 4), the existing `normalizeSnapshot`/`applySnapshot`/`reinit` path in `jarvis.html`.
- Produces (`replay-core.js`, pure, no DOM): `window.CrucixReplayCore = { createState(): state, reduce(state, action): state, canApplyLive(state): boolean }`; states `live`, `loading` (target id), `replay` (id, index), `error` (message); actions `open`, `loaded`, `failed`, `step(delta)`, `goto(id)`, `exit`, `liveArrived(snapshot)` (stores the newest live snapshot as `pending` and increments `missed`); `canApplyLive` is true only in `live` (and `error` that never entered replay).
- Produces (`replay.js`): `window.CrucixReplay = { mount(options), open(id?), exit(), active(): boolean, offerLive(snapshot): boolean }` where `options` supplies `{ fetchJson, applySnapshot(snapshot), restoreLive(snapshot), t, root }` so the module is testable without the page; `offerLive(snapshot)` returns `true` when the caller may apply it (live mode) and `false` when it was stored; the replay bar is a `role=region` landmark with the banner text, the time label, the `<input type=range>` (`aria-valuetext` = formatted time), prev/next buttons, "Back to live" button, and a `role=status` line for `missed` live updates and errors. Locale group `replay`: banner, back-to-live, prev, next, loading, error, newer-live-available (with count), alerts-stay-live note, history-unavailable note, no-sweeps hint, button label.
- In jarvis.html: SSE `update` and the 60 s poll call `CrucixReplay.offerLive` before `applySnapshot`; `cacheLive`/`markLive` are skipped while `CrucixReplay.active()`; entering replay calls `CrucixClock.freeze(Date.parse(snapshot.meta.timestamp))` and applies the loaded snapshot through the same render path; exiting releases the clock and applies the pending (or freshly fetched `/api/data`) snapshot. The `applySnapshot` older-than-current rejection must not block replay application (add an explicit force flag used only by replay and by the exit path). During replay the history/export fetches of `intelligence.js` are disabled with the note (`CrucixReplay.active()` checked at their entry points; list them in the report).

- [ ] **Step 1: Write failing tests** `test/replay.test.mjs`: reducer transitions (open → loading → loaded → replay; failed keeps the previous state and sets an error; step clamps at both ends; exit → live; `liveArrived` increments `missed` and keeps only the newest pending; `canApplyLive`); `CrucixReplay` in a vm with a DOM-less fake root: entering freezes the clock to the snapshot time and renders the bar; `offerLive` returns false during replay and true after exit; the pending snapshot is applied on exit; a failed fetch (404, network error, invalid JSON) leaves the previous state and shows the error; a late `/api/sweeps/:id` response for a stale target is dropped when the user already stepped on (sequence guard); hostile text (`<img onerror>` in the time label source) never reaches `innerHTML` unescaped; the PWA-cache gate (`active()` true → no `cacheLive`); locale `replay` parity test.
- [ ] **Step 2: Run** `node --test test/replay.test.mjs test/locales.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** core, module, css, jarvis.html wiring, `sw.js` `BASE`, locales.
- [ ] **Step 4: Run** the replay, clock, pwa, pwa-storage, dashboard-security, browser-compat tests on the local Node and Node 22; `npm run check`.
- [ ] **Step 5: Commit** `feat: sweep replay mode`.

### Task 7: Lenses and grouped live panel

**Files:**
- Create: `dashboard/public/lens-core.js`, `dashboard/public/lens.js`, `dashboard/public/lens.css`, `test/lens.test.mjs`
- Modify: `dashboard/public/live-sources.js`, `dashboard/public/live-sources.css`, `dashboard/public/record-inspector.js` (browser sources list filter), `dashboard/public/jarvis.html` (lens bar mount, map live markers, source-health panel filter, wiring), `dashboard/public/sw.js` (`BASE`), `locales/*.json` (extend `lenses`: group header strings), `test/live-sources-integration.test.mjs`, `test/locales.test.mjs`

**Interfaces:**
- Consumes: `CrucixDomains` (Task 1).
- Produces (`lens-core.js`, pure): `window.CrucixLensCore = { normalize(value): string  /* known domain id or 'all' */, matchesSource(lens, sourceName): boolean, matchesEvent(lens, event): boolean, groupSources(rows, domainOf): Array<{domain, rows, worst, attention}> }` — `all` matches everything including domain-less items; any other lens matches only items whose domain equals it. `worst` is the highest A-vocabulary severity among the group's records, `attention` is true when any source is not `ok` or `worst` is HIGH/CRITICAL.
- Produces (`lens.js`): `window.CrucixLens = { get(): string, set(id): void, onChange(fn): void, mount(root): void, expanded(domain): boolean, toggle(domain): void }`; persists `crucix.lens` and the expansion map under `crucix.liveGroups` in `localStorage` (every access try/catch; works without storage); the lens bar is a `role=group` with `aria-label` from `lenses.label` and buttons with `aria-pressed`.
- `CrucixLiveSources.renderPanel` renders groups: header `<button aria-expanded aria-controls>` (name, source count, record count, worst severity glyph + text, non-ok chips), body = today's cards unchanged (same `data-live-source`, `button.live-open[data-open-records]`); default expanded = `attention` groups; lens other than `all` shows only that group, expanded. The collapsed panel at 1280 px desktop width is <= 420 px tall (measured in Task 11 QA, not guessed here). The outerHTML refresh every 30 s preserves expansion (state lives in `CrucixLens`).
- The lens also filters: the source-health panel rows, the record-browser source list (sources outside the lens are hidden, counts unchanged), and the located live markers on both maps (hidden when their source's domain does not match; legacy layers untouched).

- [ ] **Step 1: Write failing tests** `test/lens.test.mjs`: `normalize` (unknown/hostile/null → `all`); `matchesSource`/`matchesEvent` for each domain and for domain-less events; `groupSources` ordering by domain order, `worst`, `attention`; `CrucixLens` with failing/absent `localStorage` (throwing getters) still works in memory; persisted value restored; unknown stored value → `all`; expansion survives a re-render (call `renderPanel` twice with the same state); live panel markup: 19 cards reachable inside 8 or fewer groups (count the groups with sources), every card keeps `data-live-source`/`data-live-state`/`button.live-open`; group header has `aria-expanded` and escapes names; under lens `hazards` only hazards cards render; lens-filtered marker rows; `lenses` locale group extended with group-header keys and parity.
- [ ] **Step 2: Run** `node --test test/lens.test.mjs test/live-sources-integration.test.mjs test/locales.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** modules, CSS, live panel grouping, jarvis.html wiring, inspector filter, map marker filter.
- [ ] **Step 4: Run** the new and the existing live/inspector/intelligence-ui/dashboard-security/browser-compat tests on the local Node and Node 22; fix existing assertions that counted collapsed cards (the cards stay in the DOM; only visibility changes); `npm run check`.
- [ ] **Step 5: Commit** `feat: domain lenses and grouped live panel`.

### Task 8: Source-health matrix

**Files:**
- Create: `dashboard/public/health-matrix.js`, `dashboard/public/health-matrix.css`, `test/health-matrix.test.mjs`
- Modify: `dashboard/public/jarvis.html` (source-health panel button, wiring), `dashboard/public/sw.js` (`BASE`), `locales/*.json` (`matrix` group), `test/locales.test.mjs`

**Interfaces:**
- Consumes: `GET /api/source-health?sweeps=` (Task 4), `CrucixLens` (Task 7), `CrucixReplay.open(id)` (Task 6), `CrucixDomains`.
- Produces: `window.CrucixHealthMatrix = { mount(options), open(), close(), render(model): string }` where `options = { fetchJson, t, esc, onOpenSweep(id) }`; `render(model)` is pure and returns the HTML table: `<table>` with `<caption>`, column headers = sweep times (`<th scope=col>`), row headers = source names (`<th scope=row>`) grouped by domain (a `<tbody>` per domain with a `<th colspan>` group row), each cell `data-state` plus glyph and visually-hidden text (✓ ok, ◔ stale, ✕ error, – disabled, · no data), the last-run ms in a final column, and cells are `<button>` elements calling `onOpenSweep(sweepId)`. The dialog is a native `<dialog>` with `showModal()`, a sweep-count selector (12/24/48/…, up to the retention), the lens filter applied, focus restored on close, Esc closes.
- Locale group `matrix`: title, caption, state names, `ms` header, source column header, sweep-count label, empty state, error text, close, open-hint.

- [ ] **Step 1: Write failing tests** `test/health-matrix.test.mjs`: `render` structure (caption, scope attributes, one group row per domain present, a cell per sweep, glyph + hidden text per state, `null` cell → "no data"); escaping of hostile source names; lens filter hides other domains' groups; empty model (no sweeps) → empty state not a table; `open()` fetches once per open and shows an error on failure while keeping the dialog usable; cell click calls `onOpenSweep` with the right id; `matrix` locale parity.
- [ ] **Step 2: Run** `node --test test/health-matrix.test.mjs test/locales.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** module, CSS, button in the source-health panel (visible only when the archive route answers; a 404/503 hides it silently), wiring.
- [ ] **Step 4: Run** new + existing dashboard tests on the local Node and Node 22; `npm run check`.
- [ ] **Step 5: Commit** `feat: source health matrix`.

### Task 9: "What changed" panel and header chip

**Files:**
- Create: `dashboard/public/changes.js`, `dashboard/public/changes.css`, `test/changes-ui.test.mjs`
- Modify: `dashboard/public/jarvis.html` (panel registration in the four places, header chip, wiring), `dashboard/public/intelligence.js` (`DEFAULT_ZONES` and `preset()` entries), `dashboard/public/pwa.js` (`KEYS` += `changes`), `dashboard/public/sw.js` (`BASE`), `locales/*.json` (`changes` group and `panels.changes`), `test/locales.test.mjs`, the PWA tests that pin the key list

**Interfaces:**
- Consumes: `snapshot.changes` (Task 3/4), `GET /api/changes?window=` (Task 4), `CrucixLens`, `CrucixHealthMatrix.open()`, the existing path that opens a record in the inspector from an event id (find it in `intelligence.js`/`record-inspector.js`).
- Produces: `window.CrucixChanges = { panelHtml(changes, options): string, chipHtml(changes, lens): string, mount(options), update(changes) }`; the panel (id `changes`, first in the right rail, also added to the three presets in `intelligence.js`) shows the since-time, window buttons (`aria-pressed`: last sweep / 1 h / 6 h / 24 h; non-`last` windows fetch `/api/changes`), sections New records (severity glyph + text, title, source, age, opens in the inspector), Source changes (from → to with glyphs; opens the matrix), Signals; per-domain count chips; `baseline: true` renders the "first sweep, nothing to compare" note; the header chip `Δ N` (N = lens-filtered new records + transitions + signals; hidden at 0; `aria-label` with the full phrase) scrolls/focuses the panel.
- `pwa.js` `KEYS` gains `changes`; keep the snapshot below the 5 MiB guard (the existing size test must still pass).

- [ ] **Step 1: Write failing tests** `test/changes-ui.test.mjs`: `panelHtml` for a full object, a baseline object, an empty object and `undefined`; lens filtering of items and chip count; escaping of hostile titles/sources; window buttons (`aria-pressed`) and the fetch for non-`last` windows with a failing fetch keeping the last good content plus an error line; click on a record row calls the open-record hook with the event id; `Δ` chip text/hidden at zero; locale parity for `changes`; `KEYS` contains `changes` and the pinned-key test is updated; panel registered in the default zones and the three presets (extend the existing intelligence-ui test assertions).
- [ ] **Step 2: Run** `node --test test/changes-ui.test.mjs test/locales.test.mjs test/pwa.test.mjs test/intelligence-ui.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** module, CSS, registrations, wiring.
- [ ] **Step 4: Run** new + existing dashboard tests on the local Node and Node 22; `npm run check`.
- [ ] **Step 5: Commit** `feat: what-changed panel`.

### Task 10: Ctrl+K command palette

**Files:**
- Create: `dashboard/public/palette-core.js`, `dashboard/public/palette.js`, `dashboard/public/palette.css`, `test/palette.test.mjs`
- Modify: `dashboard/public/jarvis.html` (mount, header hint button), `dashboard/public/sw.js` (`BASE`), `locales/*.json` (`palette` group), `test/locales.test.mjs`

**Interfaces:**
- Consumes: `CrucixLens`, `CrucixHealthMatrix.open`, `CrucixReplay.open`, `CrucixChanges` panel focus, the alert tray/settings/glossary open functions, `CrucixRecords` (open a source's records), `GET /api/history?q=&limit=6`, `CrucixDomains`.
- Produces (`palette-core.js`, pure): `window.CrucixPaletteCore = { score(query, label): number /* 0 = no match */, rank(items, query, { limit = 12 }): items[], isOpenKey(event): boolean /* Ctrl+K or Cmd+K, not when alt/shift */, shouldIgnoreTarget(target): boolean /* false for the palette's own input; the open key still works from anywhere */ }`; scoring: exact > prefix > word-prefix > in-order subsequence (case- and diacritics-insensitive, so "hazard" finds the Hungarian label without accents), stable order for ties.
- Produces (`palette.js`): `window.CrucixPalette = { mount(options), open(), close(), isOpen(): boolean, setActions(list): void }`; `options = { fetchJson, t, esc, actions(), sources() }`; items have `{ id, group: 'action'|'source'|'record', label, hint, run() }`; `<dialog>` + `role=combobox` input controlling `role=listbox`, `aria-activedescendant`, ↑/↓ wrap, Enter runs, Esc closes, Home/End; opening stores the focused element and restores it; the open key is captured at document level in the capture phase and `preventDefault`s only when it opens the palette; live search: query length >= 2 → debounced (200 ms `setTimeout`, cleared on close) `fetchJson('/api/history?q=…&limit=6')` with `AbortController` when available and a monotonically increasing request token so a late response is dropped; a failed search shows nothing extra (no error spam) and keeps the static results.
- Default actions (labels in the `palette` locale group): switch lens (all + 8), open alerts, open settings, open glossary, open source-health matrix, open record browser (all sources), start replay, open "what changed" panel; one item per live source ("Open records: <source>") and per other source ("Show in source health"); record results open in the inspector via the existing open-by-id path.

- [ ] **Step 1: Write failing tests** `test/palette.test.mjs`: scoring order and diacritics; `rank` limit/ties; key detection (Ctrl+K, Cmd+K, not Ctrl+Shift+K/Alt+K, not plain k); palette behaviour in a vm with fakes: opens/closes, restores focus, ArrowDown/Up wrap, Enter runs the active item and closes, Esc closes, `aria-activedescendant` tracks; race: query "ab" slow response arriving after query "abc" is dropped; debounce (use an injected scheduler in `options` for tests, no real waiting); hostile titles from the API are escaped; `fetchJson` rejecting keeps static results; the document-level key handler does not run the palette while the inspector/settings modal is capturing keys (verify with the existing modal's capture-phase handler order: describe the finding in your report); `palette` locale parity.
- [ ] **Step 2: Run** `node --test test/palette.test.mjs test/locales.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** core, module, CSS, jarvis.html mount and a visible "Ctrl K" hint button in the header (a11y label), `sw.js` `BASE`, locales.
- [ ] **Step 4: Run** new + existing dashboard tests on the local Node and Node 22; `npm run check`.
- [ ] **Step 5: Commit** `feat: Ctrl+K command palette`.

### Task 11: Integration, fixture, browser QA, docs

**Files:**
- Modify: `test/fixtures/dashboard-server.mjs` (archive fixture: `/api/sweeps*`, `/api/changes`, `/api/source-health` with deterministic data; `/control` switches e.g. `?archive=empty|seed`), `scripts/intelligence-ui-qa.mjs` (new `structure` phase), `dashboard/public/sw.js` (`CACHE`/`BASE` final check), `README.md`, `docs/OPERATIONS.md`, `test/pwa.test.mjs` as needed
- Create: `test/structure-chain.test.mjs`

**Interfaces:**
- Produces: `QA_PHASE=structure node scripts/intelligence-ui-qa.mjs` (also included in `all`); `test/structure-chain.test.mjs` exercising the real chain without a browser: a synthetic sweep sequence → `buildChanges` → `SweepArchive.add` (a temp dir) → routes over HTTP → client modules in vm (`CrucixChanges.panelHtml`, `CrucixHealthMatrix.render`, replay reducer) with the real server JSON.

- [ ] **Step 1: Write the chain test and the QA phase** (assertions, all must be able to fail): lens `hazards` leaves only hazards groups visible and survives a reload; collapsed live panel height at 1280×900 <= 420 px (measure and print the real value); `Ctrl+K` opens the palette from the body, typing "hazard" lists the lens action, Enter applies it, Esc closes with focus restored; typing a history query lists record results and opens one in the inspector; matrix opens from the source-health panel, has one row per fixture source and the right glyph/text for ok/stale/error/disabled; clicking a matrix cell enters replay at that sweep: banner visible, clock frozen (a source observed 2 h earlier shows ok), `/control` pushes a live `update` and the page does not change, "Back to live" applies it; `archive=empty` disables the replay button with the explanation; the changes panel shows the fixture's new records, `Δ` chip count equals the lens-filtered sum, window buttons fetch; hostile titles in records/sources produce no `__structureXss`; at 390 px `scrollWidth <= innerWidth` with the lens bar, palette, matrix and replay bar open in turn; adjust the old assertions (19 cards: expand all groups first). LOOK at screenshots (Read the PNGs) of: collapsed panel, palette, matrix, replay bar, 390 px.
- [ ] **Step 2: Run** `node --test test/structure-chain.test.mjs` and the QA (`PLAYWRIGHT_MODULE=D:/AI/Jev/node_modules/playwright`, start the fixture on 3199, set `QA_ARTIFACT_DIR` to the path in the dispatch, stop the fixture afterwards) — expect FAIL where the integration is incomplete; fix the integration (small glue only; larger defects get reported instead).
- [ ] **Step 3: Docs**: README (feature list, the Ctrl+K, lenses, replay, new env keys, API list), OPERATIONS (archive location/retention/disk use with the measured numbers from Task 4, what replay can and cannot show, alerts stay live).
- [ ] **Step 4: Run** `npm test`, `npm run check`, the structure QA, the whole suite on Node 22 (`npx --yes node@22 --test test/*.test.mjs`) and one real local sweep with the archive enabled (note: `npm start` runs a sweep; stop it afterwards; record sweep count, file size, `/api/sweeps` and `/api/changes` samples in the report).
- [ ] **Step 5: Commit** `feat: wire the dashboard structure features and QA`.

### Task 12: Release 2.12.0 preparation

**Files:** `package.json`, `package-lock.json` (both version places), `dashboard/public/sw.js` (`CACHE = 'crucix-shell-v2.12.0'`), `CHANGELOG.md`, `README.md`, `docs/OPERATIONS.md`, `docs/releases/v2.12.0.md` (HU + EN, structure of `docs/releases/v2.11.0.md`).

- [ ] **Step 1: Bump** versions and the service-worker cache.
- [ ] **Step 2: Write the release notes** per feature (lenses and the eight domains with the source lists, grouped live panel with the measured collapsed height, Ctrl+K and its limits, source-health matrix, changes panel and windows, replay and what it does not replay (alerts stay live, history/export disabled), archive layout/retention/disk use with measured numbers, new env keys, API list, known limits: single lens, news-type items only under "All", legacy map layers not lens-filtered, replay steps over sweeps not continuous time, offline snapshot limit unchanged), Validation with REAL numbers (`npm test`, whole suite on Node 22, `npm run check`, `npm audit --omit=dev`, structure QA local-only, the real sweep with archive), interim GitHub CI wording as in `docs/releases/v2.11.0.md`, Upgrade (no required changes; the first replayable sweep appears after the first sweep; archive disk use; PWA cache bump).
- [ ] **Step 3: Verify** — the four commands of Step 4 of Task 11 again; record real numbers.
- [ ] **Step 4: Commit locally** — explicit paths; message `feat: dashboard structure — lenses, palette, matrix, changes, replay (v2.12.0)`; do not tag, push or release (the controller does after the Node 22 gate).
