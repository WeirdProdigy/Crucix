#!/usr/bin/env node
/**
 * Deterministic Package 2B Test Snapshot Generator for Crucix.
 *
 * Uses the REAL application processing pipeline:
 * parseMeteoalarm / parseNebihAsp -> normalizeLiveSources -> buildEvents ->
 * resolveWarningChains -> partitionEventsByView -> evaluateSourceCoverage
 *
 * All generated test data is explicitly tagged with [TESZTADAT].
 * Generates test/fixtures/runs-test-package2b/latest.json.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMeteoalarm, resolveWarningChains } from '../apis/sources/meteoalarm.mjs';
import { parseNebihAsp } from '../apis/sources/nebih-asp.mjs';
import { normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { buildEvents, stampLiveEventIds } from '../lib/intelligence/events.mjs';
import {
  partitionEventsByView,
  evaluateSourceCoverage,
  evaluateEventTerritoryViews,
  VIEWS,
  VIEW_CATEGORIES,
  COVERAGE_STATES
} from '../lib/intelligence/views.mjs';
import { DEFAULT_TERRITORY_CONFIG } from '../lib/intelligence/territory.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export function generatePackage2bSnapshot({
  now = '2026-10-22T14:15:00.000Z',
  outPath = join(ROOT, 'test/fixtures/runs-test-package2b/latest.json'),
  territoryConfig = DEFAULT_TERRITORY_CONFIG
} = {}) {
  const atMs = typeof now === 'number' ? now : Date.parse(now);
  const isoTime = new Date(atMs).toISOString();

  // 1. Load real static fixtures
  const meteoEdgeXml = readFileSync(join(ROOT, 'test/fixtures/synthetic-meteoalarm-edge-cases.atom.xml'), 'utf8');
  const nebihHtml = readFileSync(join(ROOT, 'test/fixtures/nebih/fixture_asp_minimal_baseline.html'), 'utf8');

  // 2. Parse fixtures through source parsers
  const parsedMeteo = parseMeteoalarm(meteoEdgeXml, { country: 'hungary', now: atMs, includeAllLifecycles: true });
  const parsedNebih = parseNebihAsp(nebihHtml, { now: atMs, territoryConfig });

  // 3. Mark all test observations explicitly as [TESZTADAT]
  const allMeteoObs = (parsedMeteo.observations || []).map(obs => ({
    ...obs,
    title: obs.title.startsWith('[TESZTADAT]') ? obs.title : `[TESZTADAT] ${obs.title}`,
    summary: obs.summary?.startsWith('[TESZTADAT]') ? obs.summary : `[TESZTADAT] ${obs.summary || obs.title}`
  }));

  const allNebihObs = (parsedNebih.observations || []).map(obs => ({
    ...obs,
    title: obs.title.startsWith('[TESZTADAT]') ? obs.title : `[TESZTADAT] ${obs.title}`,
    summary: obs.summary?.startsWith('[TESZTADAT]') ? obs.summary : `[TESZTADAT] ${obs.summary || obs.title}`
  }));

  // Resolve CAP warning chains for Meteoalarm
  const resolvedMeteoObs = resolveWarningChains(allMeteoObs, { now: atMs });

  // 4. Normalize Meteoalarm through normalizeLiveSources
  const rawSources = {
    Meteoalarm: {
      source: 'Meteoalarm',
      status: 'ok',
      observedAt: isoTime,
      timestamp: isoTime,
      observations: resolvedMeteoObs
    }
  };

  const liveSources = stampLiveEventIds(normalizeLiveSources(rawSources, atMs));

  // 5. Build Meteoalarm events through buildEvents
  const meteoEvents = buildEvents({ meta: { timestamp: isoTime }, liveSources }, { now: atMs }).map(e => ({
    ...e,
    title: e.title.startsWith('[TESZTADAT]') ? e.title : `[TESZTADAT] ${e.title}`,
    summary: e.summary && !e.summary.startsWith('[TESZTADAT]') ? `[TESZTADAT] ${e.summary}` : (e.summary || '')
  }));

  // Nébih events constructed from parsed fixture observations
  const nebihEvents = allNebihObs.map(obs => ({
    id: obs.id,
    title: obs.title,
    summary: obs.summary,
    source: { name: 'Nebih-ASP', url: obs.url, hostname: 'portal.nebih.gov.hu', status: 'disabled' },
    kind: obs.kind,
    severity: 'moderate',
    territory: obs.territorialMatching,
    country: obs.country,
    sourceRegion: obs.sourceRegion,
    location: obs.location,
    observedAt: obs.observedAt,
    publishedAt: obs.publishedAt,
    collectedAt: isoTime,
    lifecycle: 'active',
    isCancelled: false
  }));

  // Key connection Debrecen test news item
  const debrecenEvent = {
    id: 'event-33333333333333333333333333333303',
    title: '[TESZTADAT] Debrecen teszt infrastrukturális jelentés',
    summary: '[TESZTADAT] Debrecen belvárosában teszt célú közlekedési hálózatellenőrzés zajlik.',
    source: { name: 'HAON-Fixture', url: 'https://example.test/debrecen', hostname: 'example.test', status: 'ok' },
    kind: 'news',
    severity: 'info',
    territory: {
      settlementId: 'debrecen',
      settlementName: 'Debrecen',
      countyCode: '09',
      countyName: 'Hajdú-Bihar',
      territoryLevel: 'settlement',
      inScope: true,
      identityStatus: 'resolved',
      watchScope: 'key_connection'
    },
    country: 'Hungary',
    sourceRegion: 'Hajdú-Bihar',
    location: { country: 'Hungary', settlement: 'Debrecen' },
    observedAt: isoTime,
    publishedAt: isoTime,
    collectedAt: isoTime,
    lifecycle: 'active',
    isCancelled: false
  };

  const events = [...nebihEvents, debrecenEvent, ...meteoEvents];

  // Enrich each event with computed views and lifecycle
  for (const event of events) {
    event.views = evaluateEventTerritoryViews(event, territoryConfig);
    event.lifecycle = event.lifecycle || (event.isCancelled || event.cancelled ? 'cancelled' : event.superseded ? 'superseded' : 'active');
    event.isCancelled = Boolean(event.isCancelled || event.cancelled || event.lifecycle === 'cancelled');
  }

  // 6. Compute partitions and coverage
  const views = partitionEventsByView(events, territoryConfig);

  const coverageSources = [
    { id: 'Meteoalarm', name: 'Meteoalarm', domain: 'hazards', enabled: true, status: 'ok', isSnapshot: true, origin: 'snapshot' },
    { id: 'Nebih-ASP', name: 'Nebih-ASP', domain: 'health', enabled: false, status: 'disabled', isSnapshot: true, origin: 'snapshot' },
    { id: 'HAON', name: 'HAON', domain: 'general', enabled: true, status: COVERAGE_STATES.NINCS_FORRAS, unconfigured: true, isSnapshot: true, origin: 'snapshot' }
  ];

  const coverage = evaluateSourceCoverage(coverageSources, liveSources, { isOfflineSnapshot: true, now: atMs });

  // 7. Assemble briefing bullets citing REAL event-[0-9a-f]{32} IDs from generated events
  const bihartordaEvent = events.find(e => e.territory?.settlementId === 'bihartorda' || e.location?.settlement === 'Bihartorda') || events[0];
  const meteoEvent = events.find(e => e.source?.name === 'Meteoalarm' && e.territory?.countyCode === '09') || events[events.length - 1];

  const briefing = {
    scope: 'HU',
    language: 'hu',
    source: 'rules',
    generatedAt: isoTime,
    bullets: [
      {
        text: `[TESZTADAT] Szimulációs gyakorlat: Bihartorda területén teszt jellegű afrikai sertéspestis megfigyelési körzet van szimulálva.`,
        refs: bihartordaEvent ? [{ n: 1, id: bihartordaEvent.id, title: bihartordaEvent.title }] : []
      },
      {
        text: `[TESZTADAT] Szimulációs gyakorlat: Hajdú-Bihar vármegyében teszt célú zivatarriasztási szimuláció van rögzítve.`,
        refs: meteoEvent ? [{ n: 2, id: meteoEvent.id, title: meteoEvent.title }] : []
      }
    ].filter(b => b.refs.length > 0)
  };

  // 8. Construct complete dashboard snapshot payload
  const snapshot = {
    meta: {
      version: '2.13.6',
      timestamp: isoTime,
      totalDurationMs: 120,
      sourcesQueried: 3,
      sourcesOk: 1,
      sourcesFailed: 0,
      sourcesDisabled: 1,
      isOfflineSnapshot: true,
      testEnvironment: true
    },
    territoryConfig,
    liveSources,
    events,
    views,
    coverage,
    briefing,
    news: [],
    newsFeed: [
      {
        id: 'news-test-01',
        title: '[TESZTADAT] Szimulált helyi sajtóhír: Bihartordai infrastrukturális teszt',
        headline: '[TESZTADAT] Szimulált helyi sajtóhír: Bihartordai infrastrukturális teszt',
        source: 'HAON-Fixture',
        timestamp: isoTime,
        url: 'https://example.test/tesztadat/bihartorda-01'
      }
    ],
    air: [],
    thermal: [],
    tSignals: [],
    chokepoints: [],
    nuke: [],
    nukeSignals: [],
    sdr: { total: 0, online: 0, zones: {} },
    earthquakes: [],
    markets: {},
    ideas: [],
    ideasSource: 'rules'
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');

  return {
    outPath,
    eventCount: events.length,
    viewsCount: {
      local: views[VIEWS.LOCAL].uniqueEvents,
      county: views[VIEWS.COUNTY].uniqueEvents,
      national: views[VIEWS.NATIONAL].uniqueEvents,
      global: views[VIEWS.GLOBAL].uniqueEvents
    },
    localBreakdown: views[VIEWS.LOCAL].breakdown,
    briefingBullets: briefing.bullets.length
  };
}

// Direct CLI invocation
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = generatePackage2bSnapshot();
  console.log('[generate-package2b-snapshot] Snapshot generated successfully:');
  console.log(`  Path: ${result.outPath}`);
  console.log(`  Events: ${result.eventCount}`);
  console.log(`  Views (unique): local=${result.viewsCount.local}, county=${result.viewsCount.county}, national=${result.viewsCount.national}, global=${result.viewsCount.global}`);
  console.log(`  Local Breakdown:`, result.localBreakdown);
  console.log(`  Briefing bullets: ${result.briefingBullets}`);
}
