# Fresh free sources implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Independent source modules use dispatching-parallel-agents.

**Goal:** Add nine verified current public data feeds, never present expired observations as live. Exclude annual World Bank data at the user's explicit request.

**Architecture:** Each bounded adapter returns a shared freshness envelope and a small normalized observation list. Recheck freshness during synthesis and browser rendering, including saved PWA snapshots. Source publication/model time remains distinct from collection and forecast validity.

**Tech stack:** Node 22+, existing safeFetch, pinned fast-xml-parser, existing dashboard/EventRecord/history/PWA.

**Spec:** User-approved list and docs/audit/free-data-sources-2026-10-01.md; observation tests on 2026-10-01 confirm nine recent providers.

## Constraints

- No World Bank, Eurostat, paid or key-required feeds in this change.
- Do not load operator .env or execute the full live sweep during verification.
- HTTP/body/depth/item/request counts bounded; no arbitrary XML entity or linked CAP fetching.
- No fabricated provider timestamps or physical locations; OONI failures and anomalies are distinct from confirmed blocking; EPSS is a model estimate.
- English, Hungarian and French UI copy; Hungarian and English release notes.

## Tasks

- [x] Test and implement apis/utils/freshness.mjs and xml.mjs: invalid/future/old dates, record expiry, bounded XML.
- [x] Independent adapters and behavioral tests: Meteoalarm/GDACS/EONET; SWPC/ECB/MET Norway; RIPEstat/EPSS/OONI.
- [x] Orchestrator and synthesis: 40 total adapters; liveSources is bounded and sanitized; re-evaluate cached provider/record ages.
- [x] Visible live data panel, event details/history/export and geographic alerts; provider time and forecast validity visible; no stale data rendered as live.
- [x] PWA snapshot allowlist and browser freshness timer; deterministic UI QA including delayed/stale and malicious payloads.
- [x] Live adapter probe without operator configuration, full tests/check/audit and browser regressions.
- [ ] Publish v2.7.0 with HU/EN changelog, confirm GitHub CI, record evidence.
