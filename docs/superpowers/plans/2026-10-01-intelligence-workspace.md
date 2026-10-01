# Intelligence Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship traceable events, searchable persistent history/export and themed offline-installable workspaces.

**Architecture:** Pure ESM backend units expose normalized events and a bounded journal; the existing server integrates them. A focused browser module provides dialogs/profiles while the existing Jarvis map retains its rendering. Local versioned assets and an opt-in snapshot store support the PWA.

**Tech Stack:** Node22/24, Express, vanilla browser JS, local D3/Globe.gl, IndexedDB/CacheStorage, existing Playwright QA.

**Spec:** `docs/superpowers/specs/2026-10-01-intelligence-workspace-design.md`

## Global Constraints

- Node22/24 ESM; no new application runtime dependency or external stack.
- Preserve Jarvis, HU/EN/FR, all 31 adapters, WHO/HDX/IODA and saved panel/layer settings.
- No operator `.env`, real bot/provider credentials or user-managed archives in tests/releases.
- Unknown provider times remain null, inferred positions remain labelled, related reports are not confirmed truth.
- History: 30 days / 10 000 records / 20 MiB; API page 1–200; export cap 2 000.
- Profiles: research/market/infrastructure plus at most 12 user profiles; PWA only, no Tauri.
- Three independent release checkpoints with HU/EN notes and concrete verification.

## Review Focus

- Same event across sweeps must preserve ID/first-seen while stale older updates cannot roll time backward.
- Malicious text/URL/CSV formula must stay inert in detail, history and exports.
- Unknown time/location and syndicated feed duplicates cannot become provider evidence or independent corroboration.
- Restart/corrupted journal and blocked browser storage must preserve usable app state.
- Offline/authenticated sessions must never cache API/auth/live injected HTML without explicit snapshot opt-in.

### Task 1: Event model and related reports

**Files:** create `lib/intelligence/events.mjs`, `test/intelligence-events.test.mjs`; root modifies `dashboard/inject.mjs`/`server.mjs`.

**Interfaces:** `buildEvents(snapshot) -> EventRecord[]`; `clusterEvents(events, {cellDegrees=4,windowHours=24}) -> Cluster[]`; IDs `event-<hex>`. `EventRecord` exactly follows spec; clusters expose `id,eventIds,lat,lon,count,sourceCount,label`.

- [x] Write/run failing behavior tests for time separation, stable IDs, unsafe URL, coordinates, distinct-origin relations and unrelated near reports.
- [x] Implement pure bounded normalization and optional clustering, without executing external PR code.
- [x] Root preserves original metadata through synthesis and adds events after delta generation.
- [x] Full tests + browser detail/marker/ticker access, then publish 2.4.

### Task 2: Bounded history and export

**Files:** create `lib/intelligence/history.mjs`, `lib/intelligence/export.mjs`, `test/intelligence-history.test.mjs`, `test/intelligence-export.test.mjs`; root server API integration.

**Interfaces:** `new HistoryStore(runsDir,{maxRecords=10000,retentionDays=30,maxBytes=20*1024*1024,now=Date.now})`; sync `add(events)`, `query(filters={}) -> {items,total,limit,offset,stats}`, `get(id)`; `exportRecords(records,format,{generatedAt,total,language}) -> {contentType,extension,body}`. Filter keys `q,kind,source,from,to,limit,offset`. Export formats `json,csv,html,stix`; no PDF runtime dependency.

- [x] Write/run failing tests for persistence, duplicate/old updates, caps, corrupt backup, Unicode search/filter/date/pagination validation.
- [x] Implement journal atomic save and validated query; preserve original archives.
- [x] Write/run export escaping/formula/STIX identity and non-threat serialization tests; implement serializers.
- [x] Root API guard integration + history/timeline/export UI and spatial grouping; full tests/browser QA, then publish 2.5.

### Task 3: Browser workspace UI

**Files:** create `dashboard/public/intelligence.js`, `dashboard/public/intelligence.css`, focused browser tests; root owns `jarvis.html` and locales integration to avoid shared edits.

**Interfaces:** global `window.CrucixIntelligence.init({getSnapshot,getLayout,applyLayout,getLayers,applyLayers,getRegion,applyRegion,t,escapeText})`, `.update(snapshot)`, `.openEvent(eventOrId)`, `.openHistory()`, `.openProfiles()`. Module uses plain DOM/textContent, safe links, accessible dialog. Browser module may use `/api/history`, `/api/events/:id` and `/api/export` after 2.5 server integration. Phase 2.4 only detail/local event list is active; root controls feature flags `historyEnabled`, `profilesEnabled`.

- [x] Write/run behavior/DOM tests for malicious content, modal focus/Escape, no-time/place, result/filter state, blocked storage and profile normalization.
- [x] Implement detail and history timeline/export, preset + custom profile UI in module; no edits to root-owned HTML/locales/server.
- [x] Root wires event click and toolbar actions, adds locale keys and tests desktop/mobile workflows at release checkpoints.

### Task 4: PWA and local assets

**Files:** root creates asset manifest/vendor helper, local asset tree, `manifest.webmanifest`, `sw.js`, snapshot cache module and PWA tests; integrates server offline shell.

- [x] Inventory real CDN/world/font/texture dependencies; pin official originals, retain licence/hash ledger.
- [x] Write failing SW policy/HTTP/opt-in snapshot tests; implement shell-only precache and network-first navigation.
- [x] Wire install/save/clear/offline/update controls and safe persistence, with APIs always network-only.
- [x] Prove reload with blocked network, local flat/globe rendering and opt-in data-age label; verify no sensitive API response enters cache.
- [x] Profiles + PWA full tests/browser QA + Node/Docker CI; publish 2.6 and update implementation register.

### Task 5: Independent review and release handoff

- [x] Read every changed interface and reviewer finding; fix concrete regressions with targeted tests.
- [x] Verify `npm test`, `npm run check`, `npm audit --omit=dev`, whitespace and browser evidence.
- [x] Publish each major batch to `fork/master`, release HU/EN notes and dispatch exact tag CI.
- [x] Verify final CI/container publication and clean workspace; keep provider/live-feed limitations explicit.
