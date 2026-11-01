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
  territoryConfig = DEFAULT_TERRITORY_CONFIG,
  relativeTimes = false,
  mode = 'baseline'
} = {}) {
  const atMs = typeof now === 'number' ? now : Date.parse(now);
  const isoTime = new Date(atMs).toISOString();

  // If empty mode requested: generate a valid snapshot with empty events
  if (mode === 'empty') {
    const emptyViews = partitionEventsByView([], territoryConfig);
    const coverageSources = [
      { id: 'Meteoalarm', name: 'Meteoalarm', domain: 'hazards', enabled: true, status: 'ok', isSnapshot: true, origin: 'snapshot' },
      { id: 'Nebih-ASP', name: 'Nebih-ASP', domain: 'health', enabled: false, status: 'disabled', isSnapshot: true, origin: 'snapshot' },
      { id: 'HAON', name: 'HAON', domain: 'general', enabled: true, status: COVERAGE_STATES.UNCONFIGURED, unconfigured: true, isSnapshot: true, origin: 'snapshot' }
    ];
    const coverage = evaluateSourceCoverage(coverageSources, [], { isOfflineSnapshot: true, now: atMs });

    const snapshot = {
      isPreSynthesizedFixture: true,
      meta: {
        version: '2.13.6',
        timestamp: isoTime,
        totalDurationMs: 50,
        sourcesQueried: 3,
        sourcesOk: 1,
        sourcesFailed: 0,
        sourcesDisabled: 1,
        isOfflineSnapshot: true,
        testEnvironment: true
      },
      territoryConfig,
      liveSources: [],
      events: [],
      staleEvents: [],
      views: emptyViews,
      coverage,
      briefing: {
        scope: 'HU',
        language: 'hu',
        source: 'rules',
        generatedAt: isoTime,
        bullets: []
      },
      news: [],
      newsFeed: [],
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
      eventCount: 0,
      staleCount: 0,
      viewsCount: {
        local: emptyViews[VIEWS.LOCAL].uniqueEvents,
        county: emptyViews[VIEWS.COUNTY].uniqueEvents,
        national: emptyViews[VIEWS.NATIONAL].uniqueEvents,
        global: emptyViews[VIEWS.GLOBAL].uniqueEvents
      },
      localBreakdown: emptyViews[VIEWS.LOCAL].breakdown,
      briefingBullets: 0
    };
  }

  // 1. Load real static fixtures
  const meteoEdgeXml = readFileSync(join(ROOT, 'test/fixtures/synthetic-meteoalarm-edge-cases.atom.xml'), 'utf8');
  const nebihHtml = readFileSync(join(ROOT, 'test/fixtures/nebih/fixture_asp_minimal_baseline.html'), 'utf8');

  // 2. Parse fixtures through source parsers
  const fixtureRefMs = Date.parse('2026-10-22T14:15:00.000Z');
  const parsedMeteo = parseMeteoalarm(meteoEdgeXml, { country: 'hungary', now: relativeTimes ? fixtureRefMs : atMs, includeAllLifecycles: true });
  const parsedNebih = parseNebihAsp(nebihHtml, { now: relativeTimes ? fixtureRefMs : atMs, territoryConfig });

  // 3. Mark all test observations explicitly as [TESZTADAT] and apply relative times if requested
  const rawMeteoObs = parsedMeteo.allObservations || parsedMeteo.observations || [];
  const allMeteoObs = rawMeteoObs.map(obs => {
    let observedAt = obs.observedAt;
    let publishedAt = obs.publishedAt;
    let startsAt = obs.startsAt;
    let validUntil = obs.validUntil;

    if (relativeTimes) {
      if (obs.providerId === 'HU.EDGE.EXPIRED' || obs.providerId === 'HU.EDGE.UNKNOWN') {
        observedAt = new Date(atMs - 5 * 3600000).toISOString();
        publishedAt = new Date(atMs - 5 * 3600000).toISOString();
        startsAt = new Date(atMs - 5 * 3600000).toISOString();
        validUntil = new Date(atMs - 3600000).toISOString();
      } else if (obs.providerId === 'HU.EDGE.NO_EXPIRES') {
        observedAt = new Date(atMs - 30 * 3600000).toISOString();
        publishedAt = new Date(atMs - 30 * 3600000).toISOString();
        startsAt = new Date(atMs - 30 * 3600000).toISOString();
        validUntil = undefined;
      } else {
        observedAt = new Date(atMs - 3600000).toISOString();
        publishedAt = new Date(atMs - 3600000).toISOString();
        startsAt = new Date(atMs - 3600000).toISOString();
        validUntil = new Date(atMs + 2 * 3600000).toISOString();
      }
    }

    return {
      ...obs,
      observedAt,
      publishedAt,
      startsAt,
      validUntil,
      title: obs.title.startsWith('[TESZTADAT]') ? obs.title : `[TESZTADAT] ${obs.title}`,
      summary: obs.summary?.startsWith('[TESZTADAT]') ? obs.summary : `[TESZTADAT] ${obs.summary || obs.title}`
    };
  });

  const allNebihObs = (parsedNebih.observations || []).map(obs => {
    let observedAt = obs.observedAt;
    let publishedAt = obs.publishedAt;
    if (relativeTimes) {
      observedAt = new Date(atMs - 7 * 86400000).toISOString().slice(0, 10);
      publishedAt = new Date(atMs - 2 * 86400000).toISOString().slice(0, 10);
    }
    return {
      ...obs,
      observedAt,
      publishedAt,
      title: obs.title.startsWith('[TESZTADAT]') ? obs.title : `[TESZTADAT] ${obs.title}`,
      summary: obs.summary?.startsWith('[TESZTADAT]') ? obs.summary : `[TESZTADAT] ${obs.summary || obs.title}`
    };
  });

  // Resolve CAP warning chains for Meteoalarm
  const resolvedMeteoObs = resolveWarningChains(allMeteoObs, { now: atMs });

  if (mode === 'rich' || mode === 'browser') {
    const extraMeteo = Array.from({ length: 6 }, (_, i) => ({
      providerId: `HU.EDGE.EXTRA.${i + 1}`,
      kind: 'weather',
      title: `[TESZTADAT] Meteoalarm másodfokú időjárási figyelmeztetés #${i + 1}`,
      summary: `[TESZTADAT] Szimulált területi meteorológiai előrejelzés #${i + 1}`,
      severity: i % 2 === 0 ? 'moderate' : 'minor',
      observedAt: new Date(atMs - (15 + i * 3) * 60000).toISOString(),
      publishedAt: new Date(atMs - (15 + i * 3) * 60000).toISOString(),
      startsAt: new Date(atMs - (15 + i * 3) * 60000).toISOString(),
      validUntil: new Date(atMs + 4 * 3600000).toISOString(),
      country: 'Hungary',
      sourceRegion: 'Hajdú-Bihar',
      location: { country: 'Hungary', label: 'Hajdú-Bihar', lat: 47.53, lon: 21.62 }
    }));
    resolvedMeteoObs.push(...extraMeteo);
  }

  // 4. Normalize Meteoalarm through normalizeLiveSources
  const rawSources = {
    Meteoalarm: {
      source: 'Meteoalarm',
      status: 'ok',
      observedAt: relativeTimes ? new Date(atMs - 3600000).toISOString() : isoTime,
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
    isCancelled: false,
    isFixture: true
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
    observedAt: relativeTimes ? new Date(atMs - 3600000).toISOString() : isoTime,
    publishedAt: relativeTimes ? new Date(atMs - 3600000).toISOString() : isoTime,
    collectedAt: isoTime,
    lifecycle: 'active',
    isCancelled: false,
    isFixture: true
  };

  const events = [...nebihEvents, debrecenEvent, ...meteoEvents];
  let staleEvents = [];

  if (mode === 'rich' || mode === 'browser') {
    // 1. Add unknownTerritory event
    const unknownTerritoryEvent = {
      id: 'event-33333333333333333333333333333304',
      title: '[TESZTADAT] Ismeretlen területi hatáskörű teszt-riasztás',
      summary: '[TESZTADAT] Területhez még nem társított vagy nem azonosított kockázati jelentés.',
      source: { name: 'HAON-Fixture', url: 'https://example.test/unknown-territory', hostname: 'example.test', status: 'ok' },
      kind: 'news',
      severity: 'moderate',
      country: 'HU',
      iso3: 'HUN',
      matchState: 'unknown',
      territory: {
        nuts0: 'HU',
        iso3: 'HUN',
        territoryLevel: 'indeterminate',
        matchState: 'unknown',
        inScope: false,
        identityStatus: 'unresolved'
      },
      observedAt: relativeTimes ? new Date(atMs - 3600000).toISOString() : isoTime,
      publishedAt: relativeTimes ? new Date(atMs - 3600000).toISOString() : isoTime,
      collectedAt: isoTime,
      lifecycle: 'active',
      isCancelled: false,
      isFixture: true
    };
    events.push(unknownTerritoryEvent);

    // 2. Add rich staleEvents covering all 4 stale reasons
    staleEvents = [
      {
        id: 'event-stale-000000000000000000000001',
        title: '[TESZTADAT] Lejárt kibocsátói érvényességű tesztesemény',
        summary: '[TESZTADAT] Kibocsátó által adott érvényességi idő letelt.',
        source: { name: 'Meteoalarm', status: 'ok' },
        staleReason: 'provider_expired',
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true,
        observedAt: new Date(atMs - 10 * 3600000).toISOString(),
        views: { local: { inView: true, category: 'regionalAdvisories' } }
      },
      {
        id: 'event-stale-000000000000000000000002',
        title: '[TESZTADAT] Késő forrásfrissítésű tesztesemény (elavult lekérés)',
        summary: '[TESZTADAT] A forrás nem frissült időben.',
        source: { name: 'Meteoalarm', status: 'ok' },
        staleReason: 'source_stale',
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true,
        observedAt: new Date(atMs - 26 * 3600000).toISOString(),
        views: { local: { inView: true, category: 'regionalAdvisories' } }
      },
      {
        id: 'event-stale-000000000000000000000003',
        title: '[TESZTADAT] Helyi frissességi korlátot túllépő tesztesemény',
        summary: '[TESZTADAT] Kibocsátói lejárat nélküli elavult rekord.',
        source: { name: 'Meteoalarm', status: 'ok' },
        staleReason: 'local_freshness_exceeded',
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true,
        observedAt: new Date(atMs - 50 * 3600000).toISOString(),
        views: { local: { inView: true, category: 'regionalAdvisories' } }
      },
      {
        id: 'event-stale-000000000000000000000004',
        title: '[TESZTADAT] Forráshiba miatt nem igazolt tesztesemény',
        summary: '[TESZTADAT] A forrás hibát jelzett.',
        source: { name: 'Meteoalarm', status: 'error' },
        staleReason: 'source_error',
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true,
        observedAt: new Date(atMs - 12 * 3600000).toISOString(),
        views: { local: { inView: true, category: 'regionalAdvisories' } }
      }
    ];

    const syntheticNewsEvents = [
      {
        id: 'event-news-local-00000000000000000001',
        title: '[TESZTADAT] Bihartordán tervezett ivóvíz- és áramszünet karbantartás',
        summary: '[TESZTADAT] Helyi közműkarbantartási tájékoztató Bihartordán.',
        source: { name: 'RSS-HAON', url: 'https://example.test/bihartorda-kozmu', status: 'ok' },
        link: 'https://example.test/bihartorda-kozmu',
        kind: 'news',
        newsCategory: 'news_local',
        severity: 'info',
        territory: { settlementId: 'bihartorda', settlementName: 'Bihartorda', countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'settlement', inScope: true, identityStatus: 'resolved', watchScope: 'primary' },
        location: { country: 'Hungary', settlement: 'Bihartorda', lat: 47.2186, lon: 21.3547 },
        observedAt: new Date(atMs - 5 * 60000).toISOString(),
        publishedAt: new Date(atMs - 5 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-local-00000000000000000002',
        title: '[TESZTADAT] Bihartordai belvízvédelmi csatornatisztítási munkák (koordináta nélkül)',
        summary: '[TESZTADAT] Helyi belvízvédelmi munkálatok Bihartorda határában.',
        source: { name: 'RSS-Dehir', url: 'https://example.test/bihartorda-belviz', status: 'ok' },
        link: 'https://example.test/bihartorda-belviz',
        kind: 'news',
        newsCategory: 'news_local',
        severity: 'info',
        territory: { settlementId: 'bihartorda', settlementName: 'Bihartorda', countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'settlement', inScope: true, identityStatus: 'resolved', watchScope: 'primary' },
        observedAt: new Date(atMs - 10 * 60000).toISOString(),
        publishedAt: new Date(atMs - 10 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-local-00000000000000000003',
        title: '[TESZTADAT] Sárréti közlekedési ellenőrzés Bihartorda és Nagyrábé között (koordináta nélkül)',
        summary: '[TESZTADAT] Rendőrségi sebességellenőrzés a mellékúton.',
        source: { name: 'Police-Hajdu', url: 'https://police.hu/teszt/bihartorda-ellenorzes', status: 'ok' },
        link: 'https://police.hu/teszt/bihartorda-ellenorzes',
        kind: 'news',
        newsCategory: 'news_local',
        severity: 'info',
        territory: { settlementId: 'bihartorda', settlementName: 'Bihartorda', countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'settlement', inScope: true, identityStatus: 'resolved', watchScope: 'primary' },
        observedAt: new Date(atMs - 15 * 60000).toISOString(),
        publishedAt: new Date(atMs - 15 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-local-00000000000000000004',
        title: '[TESZTADAT] Derecskei járási katasztrófavédelmi gyakorlat (koordináta nélkül)',
        summary: '[TESZTADAT] Tűzoltósági gyakorlat a járásban.',
        source: { name: 'Katasztrófavédelem', url: 'https://katasztrofavedelem.hu/teszt/derecske', status: 'ok' },
        link: 'https://katasztrofavedelem.hu/teszt/derecske',
        kind: 'news',
        newsCategory: 'news_hazard',
        severity: 'moderate',
        territory: { settlementId: 'derecske', settlementName: 'Derecske', countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'settlement', inScope: true, identityStatus: 'resolved', watchScope: 'secondary' },
        observedAt: new Date(atMs - 20 * 60000).toISOString(),
        publishedAt: new Date(atMs - 20 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-local-00000000000000000005',
        title: '[TESZTADAT] Püspökladányi vasúti felsővezeték-karbantartás (koordináta nélkül)',
        summary: '[TESZTADAT] Menetrendi változás a 100-as vasútvonalon.',
        source: { name: 'RSS-HAON', url: 'https://example.test/puspokladany-mav', status: 'ok' },
        link: 'https://example.test/puspokladany-mav',
        kind: 'news',
        newsCategory: 'news_local',
        severity: 'info',
        territory: { settlementId: 'puspokladany', settlementName: 'Püspökladány', countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'settlement', inScope: true, identityStatus: 'resolved', watchScope: 'secondary' },
        observedAt: new Date(atMs - 25 * 60000).toISOString(),
        publishedAt: new Date(atMs - 25 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-local-00000000000000000006',
        title: '[TESZTADAT] Berettyóújfalui kórházi ügyeleti rend frissítése (koordináta nélkül)',
        summary: '[TESZTADAT] Hétvégi orvosi ügyeleti tájékoztató.',
        source: { name: 'RSS-Dehir', url: 'https://example.test/berettyoujfalu-ugyelet', status: 'ok' },
        link: 'https://example.test/berettyoujfalu-ugyelet',
        kind: 'news',
        newsCategory: 'news_local',
        severity: 'info',
        territory: { settlementId: 'berettyoujfalu', settlementName: 'Berettyóújfalu', countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'settlement', inScope: true, identityStatus: 'resolved', watchScope: 'secondary' },
        observedAt: new Date(atMs - 30 * 60000).toISOString(),
        publishedAt: new Date(atMs - 30 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-local-00000000000000000007',
        title: '[TESZTADAT] Kaba térségi agrár-időjárási összefoglaló (koordináta nélkül)',
        summary: '[TESZTADAT] Csapadék- és talajnedvesség-jelentés.',
        source: { name: 'RSS-Portfolio', url: 'https://example.test/kaba-agrar', status: 'ok' },
        link: 'https://example.test/kaba-agrar',
        kind: 'news',
        newsCategory: 'news_agriculture',
        severity: 'info',
        territory: { settlementId: 'kaba', settlementName: 'Kaba', countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'settlement', inScope: true, identityStatus: 'resolved', watchScope: 'secondary' },
        observedAt: new Date(atMs - 35 * 60000).toISOString(),
        publishedAt: new Date(atMs - 35 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-county-0000000000000000001',
        title: '[TESZTADAT] Tűzoltói riasztás és műszaki mentés a 4-es főúton Debrecen közelében',
        summary: '[TESZTADAT] Baleset és forgalomkorlátozás Hajdú-Bihar vármegyében.',
        source: { name: 'Katasztrófavédelem', url: 'https://katasztrofavedelem.hu/teszt/debrecen-4es', status: 'ok' },
        link: 'https://katasztrofavedelem.hu/teszt/debrecen-4es',
        kind: 'news',
        newsCategory: 'news_hazard',
        severity: 'high',
        territory: { countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'county', inScope: true, identityStatus: 'resolved' },
        location: { country: 'Hungary', settlement: 'Debrecen', lat: 47.5316, lon: 21.6273 },
        observedAt: new Date(atMs - 40 * 60000).toISOString(),
        publishedAt: new Date(atMs - 40 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-county-0000000000000000002',
        title: '[TESZTADAT] Rendőrségi körözés és fokozott ellenőrzés Hajdúböszörményben',
        summary: '[TESZTADAT] A Hajdú-Bihar Vármegyei Rendőr-főkapitányság közleménye.',
        source: { name: 'Police-Hajdu', url: 'https://police.hu/teszt/hajduboszormeny', status: 'ok' },
        link: 'https://police.hu/teszt/hajduboszormeny',
        kind: 'news',
        newsCategory: 'news_regional',
        severity: 'info',
        territory: { countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'county', inScope: true, identityStatus: 'resolved' },
        location: { country: 'Hungary', settlement: 'Hajdúböszörmény', lat: 47.6719, lon: 21.5094 },
        observedAt: new Date(atMs - 45 * 60000).toISOString(),
        publishedAt: new Date(atMs - 45 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-county-sport-000000000001',
        title: '[TESZTADAT] DVSC–Ferencváros labdarúgó bajnoki mérkőzés összefoglaló Debrecenben',
        summary: '[TESZTADAT] NB I-es futballmérkőzés a Nagyerdei Stadionban.',
        source: { name: 'RSS-Dehir', url: 'https://dehir.hu/sport/dvsc-fradi-teszt', status: 'ok' },
        link: 'https://dehir.hu/sport/dvsc-fradi-teszt',
        kind: 'news',
        newsCategory: 'news_regional',
        severity: 'info',
        territory: { countyCode: '09', countyName: 'Hajdú-Bihar', territoryLevel: 'county', inScope: true, identityStatus: 'resolved' },
        location: { country: 'Hungary', settlement: 'Debrecen', lat: 47.5542, lon: 21.6331 },
        observedAt: new Date(atMs - 50 * 60000).toISOString(),
        publishedAt: new Date(atMs - 50 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-national-0000000000000001',
        title: '[TESZTADAT] Másodfokú viharriasztás és árvízvédelmi készültség a Dunántúlon',
        summary: '[TESZTADAT] Országos meteorológiai és vízügyi tájékoztató.',
        source: { name: 'RSS-Telex', url: 'https://telex.hu/teszt/vihar-dunantul', status: 'ok' },
        link: 'https://telex.hu/teszt/vihar-dunantul',
        kind: 'news',
        newsCategory: 'news_hazard',
        severity: 'high',
        territory: { nuts0: 'HU', iso3: 'HUN', countryCode: 'HU', territoryLevel: 'country', inScope: true, identityStatus: 'resolved' },
        location: { country: 'Hungary', settlement: 'Győr', lat: 47.6875, lon: 17.6504 },
        observedAt: new Date(atMs - 55 * 60000).toISOString(),
        publishedAt: new Date(atMs - 55 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      },
      {
        id: 'event-news-national-culture-00000001',
        title: '[TESZTADAT] Őszi színházi fesztivál és komolyzenei koncertsorozat Budapesten',
        summary: '[TESZTADAT] Kulturális programajánló a fővárosban.',
        source: { name: 'RSS-444', url: 'https://444.hu/kultura/fesztival-teszt', status: 'ok' },
        link: 'https://444.hu/kultura/fesztival-teszt',
        kind: 'news',
        newsCategory: 'news_national',
        severity: 'info',
        territory: { nuts0: 'HU', iso3: 'HUN', countryCode: 'HU', territoryLevel: 'country', inScope: true, identityStatus: 'resolved' },
        location: { country: 'Hungary', settlement: 'Budapest', lat: 47.4979, lon: 19.0402 },
        observedAt: new Date(atMs - 60 * 60000).toISOString(),
        publishedAt: new Date(atMs - 60 * 60000).toISOString(),
        collectedAt: isoTime,
        lifecycle: 'active',
        isCancelled: false,
        isFixture: true
      }
    ];
    events.push(...syntheticNewsEvents);
  }

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
    { id: 'HAON', name: 'HAON', domain: 'general', enabled: true, status: COVERAGE_STATES.UNCONFIGURED, unconfigured: true, isSnapshot: true, origin: 'snapshot' },
    ...((mode === 'rich' || mode === 'browser') ? [
      { id: 'RSS-Dehir', name: 'RSS-Dehir', domain: 'general', enabled: true, status: 'error', error: 'HTTP timeout', isSnapshot: true, origin: 'snapshot' },
      { id: 'Police-Hajdu', name: 'Police-Hajdu', domain: 'general', enabled: true, status: 'ok', isSnapshot: true, origin: 'snapshot' },
      { id: 'RSS-Telex', name: 'RSS-Telex', domain: 'general', enabled: true, status: 'ok', isSnapshot: true, origin: 'snapshot' },
      { id: 'RSS-Portfolio', name: 'RSS-Portfolio', domain: 'general', enabled: true, status: 'ok', isSnapshot: true, origin: 'snapshot' },
      { id: 'Google-News', name: 'Google-News', domain: 'general', enabled: true, status: 'ok', isSnapshot: true, origin: 'snapshot' }
    ] : [])
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
    isPreSynthesizedFixture: true,
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
    staleEvents,
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
      },
      ...((mode === 'rich' || mode === 'browser') ? [
        {
          id: 'news-test-debrecen-unlocated',
          title: '[TESZTADAT] Debreceni közlekedési hír (koordináták nélkül, cím alapján illeszkedő)',
          headline: '[TESZTADAT] Debreceni közlekedési hír (koordináták nélkül, cím alapján illeszkedő)',
          source: 'HAON-Fixture',
          timestamp: isoTime,
          url: 'https://example.test/tesztadat/debrecen-unlocated'
        },
        {
          id: 'news-test-global-1',
          title: '[TESZTADAT] Globális tengeri szállítási lánc jelentés a Vörös-tengerről',
          headline: '[TESZTADAT] Globális tengeri szállítási lánc jelentés a Vörös-tengerről',
          source: 'BBC World',
          timestamp: isoTime,
          url: 'https://example.test/tesztadat/global-1'
        }
      ] : [])
    ],
    ...((mode === 'rich' || mode === 'browser') ? {
      health: [
        { n: 'RSS-Dehir', status: 'error', err: true, message: 'HTTP timeout', timestamp: isoTime },
        { n: 'OpenSky', status: 'stale', stale: true, message: 'Cached snapshot', timestamp: isoTime },
        { n: 'Meteoalarm', status: 'ok', timestamp: isoTime },
        { n: 'Police-Hajdu', status: 'ok', timestamp: isoTime },
        { n: 'RSS-HAON', status: 'ok', timestamp: isoTime },
        { n: 'RSS-Telex', status: 'ok', timestamp: isoTime },
        { n: 'RSS-Portfolio', status: 'ok', timestamp: isoTime },
        { n: 'USGS', status: 'ok', timestamp: isoTime },
        { n: 'WHO', status: 'ok', timestamp: isoTime },
        { n: 'Nebih-ASP', status: 'disabled', disabled: true, timestamp: isoTime }
      ],
      who: Array.from({ length: 8 }, (_, i) => ({
        title: `[TESZTADAT] WHO nemzetközi járványügyi közlemény #${i + 1}`,
        severity: i === 0 ? 'high' : 'monitor',
        region: 'Europe',
        date: isoTime,
        score: 50 - i * 3,
        url: `https://example.test/who/${i + 1}`
      })),
      supplementalHealth: Array.from({ length: 8 }, (_, i) => ({
        title: `[TESZTADAT] ReliefWeb egészségügyi helyzetjelentés #${i + 1}`,
        severity: i === 0 ? 'elevated' : 'monitor',
        region: 'Central Europe',
        source: 'ReliefWeb',
        date: isoTime,
        score: 40 - i * 2,
        url: `https://example.test/reliefweb/${i + 1}`
      })),
      tg: {
        posts: 10,
        urgent: Array.from({ length: 4 }, (_, i) => ({
          channel: `OSINT-TEST-${i + 1}`,
          text: `[TESZTADAT] Sürgős OSINT csatorna figyelmeztetés és helyszíni beszámoló #${i + 1}`,
          date: isoTime,
          views: 4200,
          urgentFlags: ['URGENT']
        })),
        topPosts: Array.from({ length: 6 }, (_, i) => ({
          channel: `OSINT-FEED-${i + 1}`,
          text: `[TESZTADAT] Rendszeres OSINT összefoglaló bejegyzés #${i + 1}`,
          date: isoTime,
          views: 1800
        }))
      },
      delta: {
        summary: { direction: 'mixed', totalChanges: 8, criticalChanges: 1, signalBreakdown: { new: 3, escalated: 3, deescalated: 2 } },
        signals: {
          new: Array.from({ length: 3 }, (_, i) => ({ key: `sig-new-${i + 1}`, label: `[TESZTADAT] Új jelzés #${i + 1}`, reason: `[TESZTADAT] Új detektált változás #${i + 1}` })),
          escalated: Array.from({ length: 4 }, (_, i) => ({ key: `sig-esc-${i + 1}`, label: `[TESZTADAT] Erősödő indikátor #${i + 1}`, from: 10, to: 18, pctChange: 80, severity: i === 0 ? 'critical' : 'high' })),
          deescalated: Array.from({ length: 3 }, (_, i) => ({ key: `sig-deesc-${i + 1}`, label: `[TESZTADAT] Enyhülő indikátor #${i + 1}`, from: 15, to: 9, pctChange: -40 }))
        }
      },
      changes: {
        baseline: false,
        since: new Date(atMs - 900000).toISOString(),
        newTotal: 8,
        newRecords: Array.from({ length: 8 }, (_, i) => ({
          id: `event-3333333333333333333333333333330${(i % 4) + 1}`,
          title: `[TESZTADAT] Újonnan felvett megfigyelési rekord #${i + 1}`,
          source: 'Meteoalarm',
          domain: 'weather',
          severity: i === 0 ? 'high' : 'moderate',
          observedAt: isoTime
        })),
        sourceTransitions: [],
        signals: []
      }
    } : {}),
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
  const isBrowser = process.argv.includes('--browser');
  const isRich = process.argv.includes('--rich') || isBrowser;
  const isEmpty = process.argv.includes('--empty');
  const mode = isEmpty ? 'empty' : (isRich ? 'rich' : 'baseline');
  const now = (isBrowser || isRich) ? Date.now() : '2026-10-22T14:15:00.000Z';
  const outPath = (isBrowser || isRich || isEmpty)
    ? join(ROOT, 'runs/test-package2b-browser/latest.json')
    : join(ROOT, 'test/fixtures/runs-test-package2b/latest.json');
  const result = generatePackage2bSnapshot({ now, outPath, relativeTimes: (isBrowser || isRich), mode });
  console.log(`[generate-package2b-snapshot] Snapshot generated successfully (mode=${mode}, ${isBrowser || isRich ? 'relative times' : 'static deterministic'}):`);
  console.log(`  Path: ${result.outPath}`);
  console.log(`  Events: ${result.eventCount}`);
  console.log(`  Views (unique): local=${result.viewsCount.local}, county=${result.viewsCount.county}, national=${result.viewsCount.national}, global=${result.viewsCount.global}`);
  console.log(`  Local Breakdown:`, result.localBreakdown);
  console.log(`  Briefing bullets: ${result.briefingBullets}`);
}
