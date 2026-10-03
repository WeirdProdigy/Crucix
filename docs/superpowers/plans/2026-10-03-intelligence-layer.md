# Intelligence layer (country risk, logged predictions, entity links, conflict forecasts, cited briefings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (lean variant, see Process) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Per-country risk scores with a transparent breakdown, logged and scored 7-day predictions, event-to-country links, VIEWS/INFORM sources, cited AI (or rule-based) briefings, and the dashboard views for them (release 2.13.0).

**Architecture:** Dependency-free country resolution (gazetteer + point-in-polygon over the vendored topojson) feeds an entity store; a pure risk model reads the store and two new plain sources; a prediction journal logs and scores forecasts from the same store; a never-throwing risk step runs after event building and before the alert step and attaches a compact `risk` summary to the snapshot; read-only routes, one POST briefing route, and small browser modules plug into the D dashboard (panel registry, palette, map click, replay gating).

**Tech Stack:** Node 22/24 ESM, `node:test`, existing Express routes pattern, vanilla browser JS/CSS, existing LLM provider layer.

**Spec:** `docs/superpowers/specs/2026-10-03-intelligence-layer-design.md` (Hungarian, binding; read it fully). Facts: `.superpowers/sdd/e-facts-code.md`, `e-facts-forecast-sources.md` (local). D code facts are in the committed D spec/plan and the code itself (re-grep; line numbers drift).

## Process (lean, by the owner's instruction — see memory "keep tests and process lean")

- **At most 20 tests in total for this whole release**, only for behaviour that would really hurt if broken. The per-task budgets below are ceilings: `T1` 6, `T2` 2, `T3` 5, `T4` 4 (17, leaving headroom). No test batteries, no mutation-testing marathons, no per-task review loops: one implementer per task, one final whole-branch review, ONE fix wave, then release. Implementers run the full `npm test` once at the end and fix what they broke; they self-review against the spec.
- Never pass DOM nodes to `assert.equal`/`deepEqual` (a failing diff hangs for minutes): use `assert.ok(a === b, msg)`. Tests that read source files must tolerate CRLF (`\r?\n`).

## Global Constraints

- No new runtime dependencies; Node >= 22 (CI: ubuntu-24.04 and windows-2025 on Node 22 and 24); no timers left running or `unref`'d in server code.
- Server code in normal formatting; browser modules `dashboard/public/*.js` are IIFEs exposing `window.CrucixX`, compact one-line style, no regex lookbehind, every dynamic string escaped, no inline handlers; the server-injected `let D = {...};` line in `jarvis.html` stays ONE line; new browser files go into `dashboard/public/sw.js` `BASE` (cache NAME bump belongs to the release task).
- All user-visible text in en/hu/fr locale groups with identical keys in identical order (ONE parity test covering the three new groups); natural Hungarian/French.
- Read-only API routes follow `lib/intelligence/routes.mjs` (installed after authentication, strict query allowlist, `400 {error, code, field}` / `404` / generic `503`, strict id patterns); the D `/api` JSON error handler (`lib/api-errors.mjs`) covers broken percent-encoding. The POST route follows `lib/alerts/routes.mjs` (`requireSameOriginJson`, host protection, small body).
- Never invent data or numbers: a missing score component is omitted and reflected in `coverage`; documents and notes only state measured numbers.
- New sources are plain sources (health row only): add to the D domain registry (`security`), `apis/briefing.mjs`, README/OPERATIONS counts (50 → 52); the registry test counts adapters from `briefing.mjs`, update it.
- Commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; explicit `git add` paths; only the controller pushes/tags/releases.

## Review Focus (for the one final review)

- Country attribution never uses keyword-located coordinates; ambiguous names never match from titles; hostile 1e6-character text stays linear and fast.
- A source outage, an empty store, a corrupt file or a missing `risk` never stops a sweep or the dashboard; the risk step never throws.
- Predictions use only events first seen AFTER the prediction; resolved rows are never rewritten; Brier/skill are computed from stored rows only.
- Briefing citations: every kept bullet cites ≥ 1 existing event; invalid refs dropped; model output markup stripped; POST protected like the alert routes.
- Replay (D): country dialog / briefing disabled during replay with the note; the panel shows the archived snapshot's own `risk`.
- Alert metrics return `null` without `risk`; existing alert rules and tests unchanged.

---

### Task 1: Country resolution, entity store, risk model, prediction journal (libs)

**Files:** Create `lib/intelligence/countries.mjs`, `lib/intelligence/geo.mjs`, `lib/intelligence/entities.mjs`, `lib/intelligence/risk.mjs`, `lib/intelligence/predictions.mjs`, `test/intelligence-risk.test.mjs`.

**Interfaces:**
- `countries.mjs`: `COUNTRIES` (frozen array `{iso3, iso2, num, name, aliases, ambiguous}` for ISO 3166-1, ~249), `countryByIso3(code)`, `countryByIso2(code)`, `countryByNum(n)`, `countriesInText(text, {limit = 3})` per spec section 2 (cap 600 chars before scanning, token/Map based, no regex from input, ambiguous aliases excluded).
- `geo.mjs`: `countryAt(lat, lon) -> iso3|null` over the vendored `dashboard/public/vendor/countries-110m-2.0.2.json` (decode TopoJSON arcs in Node; bbox prefilter + ray casting; longitude normalised; load lazily once; never throws).
- `entities.mjs`: `class EntityStore { constructor(runsDir, {retentionDays = 35, maxRefs = 20000, now}) ; load(); ingest(events, {now}) ; save(); countryEvents(iso3, {sinceMs, kinds}) ; mentionCounts(iso3, days) ; linked(iso3, limit = 8) ; series(iso3) ; recordScores(scores, now) }` persisting `<runsDir>/intelligence/countries.json` atomically (`lib/atomic-json.mjs`); `ingest` applies the located/mentioned rules of spec section 2 (trusted location methods, label names, caps, deterministic, id-cached); corrupt/missing file -> empty store.
- `risk.mjs`: `RISK_MODEL_VERSION`, `RISK_KINDS`, `scoreCountries({store, forecasts, baselines, now}) -> [{iso3, name, score, coverage, components:{events,persistence,diversity,attention,forecast,baseline: {value|null, weight}}, convergence:{active, kinds}, change24h}]` per spec section 4 (pure given inputs; missing components omitted and weights renormalised; `change24h` from the store series or `null`); `summarize(scores, calibration) -> snapshot.risk` (top 15, counts, calibration).
- `predictions.mjs`: `class PredictionJournal { constructor(runsDir, {now}) ; load(); log(scores, store, now) ; resolve(store, now) ; calibration() -> {n, open, baseRate, brier, brierBase, skill, bins:[{lo,hi,n,rate}]}|null ; recent(limit) ; save() }` per spec section 5 (one prediction per country per day, horizon 7 days, said-probability rule, `uncalibrated` flag, resolved rows immutable, cap 20,000 rows, atomic file `<runsDir>/intelligence/predictions.json`).

- [ ] **Step 1: Implement** the five modules per the spec. Keep them compact and dependency-free; the gazetteer data is a literal table (check it against the world-atlas shapes: every shape in the topojson must resolve).
- [ ] **Step 2: Tests (ceiling 6, one file):** (1) every topojson shape resolves in the gazetteer and `countriesInText` handles ambiguity ("Georgia" does not match from a title, "North Korea" does) and a 1e6-character hostile string within a time bound; (2) `countryAt` for a few known points (Budapest, Kyiv, Tokyo, mid-Pacific -> null, a point near the antimeridian); (3) entity ingest: a `headline-keyword` located news item links only by title mention, a `provider` quake links by coordinates, caps and retention hold, a corrupt file loads empty; (4) risk: components renormalise when forecast/baseline are missing (coverage shown), convergence needs ≥ 3 kinds at ≥ high, `change24h` null without history; (5) predictions: log -> events AFTER the prediction resolve it -> Brier/skill computed, resolved rows unchanged, "not enough data" gating via `calibration()`; (6) the full chain on a synthetic event list (ingest -> score -> log -> resolve) is deterministic.
- [ ] **Step 3: Run** `node --test test/intelligence-risk.test.mjs` on the local Node and `npx --yes node@22 --test` on it; `npm run check`; measure and report the real country-attribution rate on `runs/latest.json` events (synthesized offline as `server.mjs` does at startup) and the time to ingest 2,000 events.
- [ ] **Step 4: Commit** `feat: country resolution, entity store, risk model and prediction journal`.

### Task 2: VIEWS and INFORM sources

**Files:** Create `apis/sources/views.mjs`, `apis/sources/inform.mjs`, `test/sources-risk.test.mjs`; modify `apis/briefing.mjs`, `lib/domains.mjs` and `dashboard/public/domains.js` (identical data), `test/domains.test.mjs` count if pinned, README/OPERATIONS adapter counts.

**Interfaces:** `views.mjs` exports `parseViews(runList, rows, now)` and `briefing()` (source name `VIEWS-Forecast`), `inform.mjs` exports `parseInform(workflows, scores, now)` and `briefing()` (`INFORM-Risk`), per spec section 6 (endpoints, caches, attribution/licence fields, ≤ 2 requests per call cold, `{timeout: 10000, retries: 0, maxBytes: 2 MiB}` like the other adapters, never throw: failures -> `unavailableResult`-style objects without secrets or full URLs; changed shape -> error). Verify both endpoints with one read-only GET each before writing the parser (facts in `e-facts-forecast-sources.md`; the VIEWS `current` alias returns 422).

- [ ] **Step 1: Implement** both adapters and register them (`runSource` after the existing sources; add both to the `security` domain in the registry and its browser copy).
- [ ] **Step 2: Tests (ceiling 2):** one per adapter with a small trimmed real fixture: parse result shape (iso3 map, run id/release, attribution) and a changed-shape payload -> error.
- [ ] **Step 3: Run** the two test files + `test/domains.test.mjs` on the local Node and Node 22; `npm run check`; one real run of each `briefing()` (network permitting) and record the real sizes/timings.
- [ ] **Step 4: Commit** `feat: VIEWS and INFORM risk sources`.

### Task 3: Server step, routes, alert metrics, config, briefing

**Files:** Create `lib/intelligence/risk-step.mjs`, `lib/intelligence/risk-routes.mjs`, `lib/llm/briefing.mjs`, `test/intelligence-routes-risk.test.mjs`; modify `server.mjs`, `crucix.config.mjs`, `lib/llm/budgets.mjs`, `lib/alerts/metrics.mjs`, `locales/*.json` (alert metric labels + units only), `.env.example`, `docs/OPERATIONS.md`, README.

**Interfaces:**
- `risk-step.mjs`: `runRiskStep({store, journal, snapshot, raw, now, log}) -> {ok, error?}` ingests `snapshot.events`, reads forecasts/baselines from `raw.sources['VIEWS-Forecast'|'INFORM-Risk']`, scores, records the series, logs/resolves predictions, saves, and sets `snapshot.risk` (spec section 7); never throws; placed in `server.mjs` after `recordSnapshotEvents` and before `runAlertStep`; `/api/health` gains `riskStatus`.
- `risk-routes.mjs`: `installRiskRoutes(app, {store, journal, getSnapshot, history, briefing, security})` -> `GET /api/countries`, `GET /api/countries/:iso3`, `GET /api/predictions`, `POST /api/briefing` per spec section 7 (profile includes components, series, VIEWS months with run id and attribution, INFORM, recent events resolved through `history.get`, linked countries).
- `briefing.mjs`: `generateBriefing({scope, snapshot, store, provider, language, now}) -> {scope, generatedAt, source: 'llm'|'rules', bullets:[{text, refs:[{n, id, title}]}]}` per spec section 8 (numbered rows, JSON bullets, server-side ref validation, markup stripping, 400-char surrogate-safe cut, deterministic rule-based fallback, cache per scope|language|sweep, one in-flight generation per key, `purpose: 'briefing'` budget with `LLM_BRIEFING_MAX_TOKENS`/`LLM_BRIEFING_TIMEOUT_MS`).
- `metrics.mjs`: `risk_max_score`, `risk_countries_high` per spec section 7 (null without `risk`), with en/hu/fr labels.
- Config: `RISK_ENABLED` (default true), `RISK_RETENTION_DAYS` (default 35, 14–90) via `envInteger`, `LLM_BRIEFING_*`; `.env.example`, OPERATIONS (files, retention, what the score is and is not).

- [ ] **Step 1: Implement** the step, routes, briefing, metrics, config and the `server.mjs` wiring (the archived snapshot must contain `risk`; startup creates the store/journal; `RISK_ENABLED=false` skips everything).
- [ ] **Step 2: Tests (ceiling 5, one file where possible):** (1) the risk step never throws on a hostile/empty snapshot and sets `snapshot.risk` otherwise; (2) routes over real HTTP: list/profile/predictions shapes, unknown/invalid ISO3 -> 404/400, no stack on errors; (3) `POST /api/briefing`: rejects cross-origin / non-JSON / bad scope, and drops invalid refs and ref-less bullets from a fake provider's output; (4) briefing falls back to rules when the provider throws/returns junk, and every rule bullet has a valid ref; (5) the alert metrics read `risk` and return null without it.
- [ ] **Step 3: Run** the new test file on the local Node and Node 22; `npm run check`; one full `npm test`; a real local server run on a throwaway `RUNS_DIR` (network blocked fixture as in `test/server-start.test.mjs`): `/api/countries`, `/api/countries/<iso3>`, `/api/predictions`, `/api/health` `riskStatus`, a rules briefing; record real sizes/timings.
- [ ] **Step 4: Commit** `feat: country risk step, API, alert metrics and cited briefings`.

### Task 4: Dashboard views

**Files:** Create `dashboard/public/risk.js`, `risk.css`, `country.js`, `country.css`, `briefing.js`, `briefing.css`, `test/risk-ui.test.mjs`; modify `dashboard/public/jarvis.html` (panel registration in the three places like `changes`, topbar/palette actions, flat-map country click, `normalizeSnapshot`, script/link tags, replay gating), `dashboard/public/intelligence.js` (DEFAULT_ZONES/presets), `dashboard/public/pwa.js` (`KEYS` += `risk`), `dashboard/public/sw.js` (`BASE`), `locales/*.json` (`risk`, `country`, `briefing`, `panels.countryRisk`).

**Interfaces:** `window.CrucixRisk = {panelHtml(risk, opts), mount(opts), update(risk)}` (panel `countryRisk`, spec section 9), `window.CrucixCountry = {open(iso3), close()}` (dialog over `GET /api/countries/:iso3`), `window.CrucixBriefing = {open(scope?), close()}` (dialog over `POST /api/briefing`, citation chips open records through `CrucixIntelligence.openEvent`); entry points: panel rows, flat-map country polygons, palette actions ("Open country: <name>" for top countries and for a typed country name via the gazetteer names embedded from the server `risk.top` + an `/api/countries` fetch, plus "Briefing"); during replay the dialogs are disabled with `CrucixReplay.historyNote()`-style note and the panel shows the replayed snapshot's `risk`.

- [ ] **Step 1: Implement** the three modules, the registrations and the locale groups; reuse the D patterns (glyph + text severities, dialog/focus handling like the matrix dialog, delegated listeners, no inline handlers).
- [ ] **Step 2: Tests (ceiling 4, one file where possible):** (1) the three new locale groups + `panels.countryRisk` have identical keys in identical order in en/hu/fr; (2) the panel renders ranking/changes/coverage/convergence with escaping of hostile names and the "not enough data yet" calibration state; (3) the briefing dialog renders citation chips only for valid refs and opens the record via `openEvent`; (4) during replay the country/briefing entry points are disabled.
- [ ] **Step 3: Run** the new test file and the existing `locales`, `pwa`, `dashboard-security`, `browser-compat`, `intelligence-ui`, `lens`, `replay`, `changes-ui` tests on Node 22 and the local Node; `npm run check`; ONE Playwright smoke (not a committed test): fixture + faked `/api/countries*` and `/api/briefing` via `page.route`, 1280 and 390 px, LOOK at the screenshots, and run `QA_PHASE=all node scripts/intelligence-ui-qa.mjs` and `node scripts/browser-qa.mjs` (restore tracked `docs/audit/images` afterwards) so the existing QA stays green (the fixture needs a minimal `risk` object and the routes if the page probes them: add them to `test/fixtures/dashboard-server.mjs`).
- [ ] **Step 4: Commit** `feat: country risk panel, country sheet and briefing dialog`.

### Task 5: Release 2.13.0 preparation

**Files:** `package.json`, `package-lock.json` (both version places), `dashboard/public/sw.js` (`CACHE = 'crucix-shell-v2.13.0'`), `CHANGELOG.md`, `README.md`, `docs/OPERATIONS.md`, `docs/releases/v2.13.0.md` (HU + EN, structure of `docs/releases/v2.12.0.md`).

- [ ] **Step 1: Bump** versions and the cache name (update any test that pins them).
- [ ] **Step 2: Release notes** covering the six features, the ACLED CAST substitution with its evidence (free/Gmail accounts have no API access; EULA bars display on the own dashboard; quoted in `e-facts-forecast-sources.md`), the VIEWS/INFORM licence wording exactly as the spec says, the model and its honest limits (heuristic index, not a probability; predictions start with "not enough data"; keyword locations excluded; no organisation/actor extraction), new env keys, routes, files and disk use (measured), the briefing safeguards, known limits, and Validation with REAL numbers (test count as it is, Node 22 whole suite, CRLF-clone suite, check, audit, the real local run) and the interim CI wording. State the lean test policy neutrally (the suite grows by only the new tests).
- [ ] **Step 3: Verify** `npm test`, `npm run check`, `npm audit --omit=dev`, `npx --yes node@22 --test test/*.test.mjs`, the CRLF-clone run (`git clone --config core.autocrlf=true . <tmp>`, junction `node_modules`, `node --test test/*.test.mjs` there), the existing QA scripts; record the real numbers.
- [ ] **Step 4: Commit locally** `feat: country risk, logged predictions, conflict forecasts and cited briefings (v2.13.0)`; do not tag, push or release (the controller does after confirming the gates).
