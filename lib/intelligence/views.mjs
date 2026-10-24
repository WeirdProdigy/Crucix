/**
 * View partitioning, counting contracts, domain-lens intersection,
 * and source coverage state model for Crucix (Package 2, Step 2A).
 *
 * Implements:
 * 1. Territorial Views: Helyi (Local), Hajdú-Bihar (County), Magyarország (National), Világ (Global)
 * 2. Strict Partitioning Categories: confirmedLocal, needsReview, regionalAdvisories, unknownTerritory
 * 3. Unique Incident Counting Contract across CAP chains and ID-less items
 * 4. Orthogonal Lens x View interaction (pure intersection)
 * 5. 6-state Source Coverage Model (sikeres_adat, sikeres_üres, letiltott, elavult_hibas, nincs_forrás, offline_pillanatkép)
 * 6. Date-only normalization and coordinate guards
 * 7. Briefing record reference contracts for Package 2B/2C
 */

import {
  DEFAULT_TERRITORY_CONFIG,
  LOCAL_RELEVANCE_REASONS,
  IDENTITY_STATUSES,
  WATCH_SCOPES,
  ADMINISTRATIVE_LEVELS,
  RELATIONSHIP_TYPES
} from './territory.mjs';

/**
 * Supported territorial views.
 */
export const VIEWS = Object.freeze({
  LOCAL: 'local',       // Helyi nézet (aktív profil: Bihartorda + figyelt települések + kiemelt városok)
  COUNTY: 'county',     // Hajdú-Bihar vármegye nézet (KSH 09 / NUTS3 HU321)
  NATIONAL: 'national', // Magyarország nézet (NUTS0 HU / HUN)
  GLOBAL: 'global'      // Világ nézet (minden esemény)
});

/**
 * Breakdown categories per view.
 * Guarantees that regional/county source_region_only advisories are never conflated with confirmed local hits.
 */
export const VIEW_CATEGORIES = Object.freeze({
  CONFIRMED_LOCAL: 'confirmedLocal',         // Megerősített helyi találat (official_area_assignment vagy resolved_event_location)
  NEEDS_REVIEW: 'needsReview',               // Ellenőrizendő helyi vonatkozás (text_mention)
  REGIONAL_ADVISORIES: 'regionalAdvisories', // Térségi / régiós tájékoztatás (source_region_only vármegyei/nagyrégiós riasztás)
  UNKNOWN_TERRITORY: 'unknownTerritory'      // Tisztázatlan / ismeretlen területi érintettség (matchState === 'unknown')
});

/**
 * Human-readable Hungarian labels for categories.
 */
export const CATEGORY_LABELS = Object.freeze({
  confirmedLocal: 'Megerősített helyi érintettség',
  needsReview: 'Ellenőrizendő szöveges említés',
  regionalAdvisories: 'Térségi tájékoztatás',
  unknownTerritory: 'Ismeretlen területi érintettség'
});

/**
 * Source coverage status model (6 states).
 */
export const COVERAGE_STATES = Object.freeze({
  SIKERES_ADAT: 'sikeres_adat',               // Sikeres lekérés, érkezett tétel
  SIKERES_URES: 'sikeres_üres',               // Sikeres lekérés, nincs aktív tétel
  LETILTOTT: 'letiltott',                     // Konfigurációban letiltott forrás
  ELAVULT_HIBAS: 'elavult_hibas',             // Hiba történt, vagy elavult az adat
  NINCS_FORRAS: 'nincs_forrás',               // Nincs konfigurált / elérhető forrás a témához
  OFFLINE_PILLANATKEP: 'offline_pillanatkép'  // Statikus offline pillanatkép / archívum
});

/**
 * Hungarian human-readable labels for source coverage states.
 */
export const COVERAGE_LABELS = Object.freeze({
  [COVERAGE_STATES.SIKERES_ADAT]: 'Sikeres adatgyűjtés',
  [COVERAGE_STATES.SIKERES_URES]: 'Nincs aktív jelzés',
  [COVERAGE_STATES.LETILTOTT]: 'Letiltott forrás',
  [COVERAGE_STATES.ELAVULT_HIBAS]: 'Elavult vagy hibás forrás',
  [COVERAGE_STATES.NINCS_FORRAS]: 'Nincs telepített forrás',
  [COVERAGE_STATES.OFFLINE_PILLANATKEP]: 'Offline pillanatkép'
});

/**
 * Mandatory fields for cited records in Briefing (POST /api/briefing and UI dialog).
 */
export const BRIEFING_RECORD_FIELDS = Object.freeze(['id', 'n', 'title']);
export const EVENT_ID_REGEX = /^event-[0-9a-f]{32}$/;

/**
 * Validates a citation reference item for cited briefings.
 */
export function isValidBriefingRef(ref) {
  return Boolean(
    ref &&
    typeof ref === 'object' &&
    Number.isInteger(ref.n) &&
    ref.n >= 1 &&
    ref.n <= 999 &&
    typeof ref.id === 'string' &&
    EVENT_ID_REGEX.test(ref.id) &&
    typeof ref.title === 'string' &&
    ref.title.trim().length > 0
  );
}

/**
 * Date-only strings (e.g. "2026-10-24") must NOT be artificially converted to midnight UTC
 * ("2026-10-24T00:00:00.000Z"), which would falsely imply second-level precision.
 */
export function normalizeEventDate(rawDate) {
  if (typeof rawDate !== 'string' || !rawDate.trim()) {
    return { dateOnly: false, iso: null, raw: rawDate || null, timestamp: null };
  }
  const trimmed = rawDate.trim();
  // Check for date-only pattern YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return {
      dateOnly: true,
      iso: null,
      raw: trimmed,
      timestamp: null // Do not fabricate 00:00:00.000Z
    };
  }
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return {
      dateOnly: false,
      iso: new Date(parsed).toISOString(),
      raw: trimmed,
      timestamp: parsed
    };
  }
  return { dateOnly: false, iso: null, raw: trimmed, timestamp: null };
}

/**
 * Ensures unlocated items (e.g. articles or regional warnings without coordinates)
 * receive coordinates: null, preventing synthetic coordinate drift.
 */
export function sanitizeCoordinates(coordinates) {
  if (!coordinates || typeof coordinates !== 'object') return null;
  const lat = Number(coordinates.lat);
  const lon = Number(coordinates.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Boundary check
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return Object.freeze({
    lat,
    lon,
    source: coordinates.source || 'unspecified',
    isEventLocation: Boolean(coordinates.isEventLocation)
  });
}

/**
 * Computes canonical unique event key.
 * Deduplicates CAP update/cancel chains to the same incident identity,
 * and deterministic key synthesis for ID-less items.
 */
export function getEventCanonicalKey(event) {
  if (!event || typeof event !== 'object') {
    return 'unknown:empty';
  }
  // 1. CAP Chain Key (for unfolding warning cascades)
  if (typeof event.chainKey === 'string' && event.chainKey.trim()) {
    return `cap-chain:${event.chainKey.trim()}`;
  }
  // 2. Official Crucix event ID
  if (typeof event.id === 'string' && event.id.trim()) {
    return `event-id:${event.id.trim()}`;
  }
  // 3. CAP identifier + sender
  if (typeof event.identifier === 'string' && event.identifier.trim()) {
    const sender = typeof event.sender === 'string' ? event.sender.trim() : 'unknown-sender';
    return `cap-msg:${sender}:${event.identifier.trim()}`;
  }
  // 4. Provider ID
  if (typeof event.providerId === 'string' && event.providerId.trim()) {
    return `provider:${event.providerId.trim()}`;
  }
  // 5. Deterministic fallback for ID-less items
  const source = typeof event.source === 'string' ? event.source : (event.source?.name || 'unknown');
  const title = typeof event.title === 'string' ? event.title.trim().slice(0, 100) : '';
  const time = event.publishedAt || event.observedAt || event.time || '';
  const link = typeof event.link === 'string' ? event.link : '';
  return `raw:${source}:${title}:${time}:${link}`;
}

/**
 * Checks whether a settlement belongs to the active configuration profile.
 * Bihartorda is primary.
 * Watched settlements are configurable.
 * Key cities (Debrecen, Hajdúszoboszló, Püspökladány) are configurable.
 * Berettyóújfalu is only included if explicitly in config.
 * District settlements are included only if includeFullDistrict is true.
 */
function isSettlementInActiveProfile(settlementCode, config) {
  if (!settlementCode || !config) return false;
  const primaryCode = config.primary?.kshSettlement;
  if (primaryCode && settlementCode === primaryCode) return true;

  if (Array.isArray(config.watchedSettlements) && config.watchedSettlements.some(s => s.kshSettlement === settlementCode)) {
    return true;
  }
  const keyCities = config.keyCities || config.keyConnections || [];
  if (Array.isArray(keyCities) && keyCities.some(k => k.kshSettlement === settlementCode)) {
    return true;
  }
  if (config.includeFullDistrict && Array.isArray(config.districtSettlements)) {
    if (config.districtSettlements.some(d => d.kshSettlement === settlementCode)) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates an event against the 4 territorial views.
 *
 * Returns an object with match information per view:
 * {
 *   [VIEWS.LOCAL]: { inView: boolean, category: string | null },
 *   [VIEWS.COUNTY]: { inView: boolean, category: string | null },
 *   [VIEWS.NATIONAL]: { inView: boolean, category: string | null },
 *   [VIEWS.GLOBAL]: { inView: boolean, category: string | null }
 * }
 */
export function evaluateEventTerritoryViews(event, config = DEFAULT_TERRITORY_CONFIG) {
  const result = {
    [VIEWS.LOCAL]: { inView: false, category: null, reason: null },
    [VIEWS.COUNTY]: { inView: false, category: null, reason: null },
    [VIEWS.NATIONAL]: { inView: false, category: null, reason: null },
    [VIEWS.GLOBAL]: { inView: true, category: VIEW_CATEGORIES.CONFIRMED_LOCAL, reason: 'global_scope' }
  };

  if (!event || typeof event !== 'object') {
    return result;
  }

  const territory = event.territory || event;
  const territoryLevel = territory.territoryLevel || 'indeterminate';
  const matchState = territory.matchState || (territory.status === 'indeterminate' ? 'unknown' : null);
  const localRelevanceReason = territory.localRelevanceReason || null;
  const isConfirmedLocal = Boolean(territory.isConfirmedLocal);
  const countyCode = territory.countyCode || territory.county?.id || null;
  const nuts3 = territory.nuts3 || territory.nuts?.nuts3 || null;
  const nuts2 = territory.nuts2 || territory.nuts?.nuts2 || null;
  const nuts0 = territory.nuts0 || territory.nuts?.nuts0 || null;
  const kshSettlement = territory.kshSettlementCode || territory.kshSettlement || null;
  const country = event.country || territory.country || territory.iso3 || event.iso3 || null;

  // 1. Unknown / Indeterminate territorial match
  if (matchState === 'unknown' || territoryLevel === 'indeterminate') {
    // In Local View: Retained and categorized as unknownTerritory (never dropped as outside_scope)
    result[VIEWS.LOCAL] = {
      inView: true,
      category: VIEW_CATEGORIES.UNKNOWN_TERRITORY,
      reason: 'indeterminate_territory'
    };
    result[VIEWS.COUNTY] = {
      inView: false,
      category: null,
      reason: 'unknown_not_resolved_to_county'
    };
    result[VIEWS.NATIONAL] = {
      inView: true, // Unknown domestic feeds remain in national view for review
      category: VIEW_CATEGORIES.UNKNOWN_TERRITORY,
      reason: 'indeterminate_domestic'
    };
    return result;
  }

  // 2. Settlement Level Match
  if (territoryLevel === ADMINISTRATIVE_LEVELS.SETTLEMENT || territoryLevel === 'settlement') {
    const isInConfig = isSettlementInActiveProfile(kshSettlement, config);

    if (isInConfig) {
      if (isConfirmedLocal ||
          localRelevanceReason === LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT ||
          localRelevanceReason === LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION) {
        result[VIEWS.LOCAL] = {
          inView: true,
          category: VIEW_CATEGORIES.CONFIRMED_LOCAL,
          reason: localRelevanceReason || 'confirmed_settlement'
        };
      } else if (localRelevanceReason === LOCAL_RELEVANCE_REASONS.TEXT_MENTION || territory.needsLocalReview) {
        result[VIEWS.LOCAL] = {
          inView: true,
          category: VIEW_CATEGORIES.NEEDS_REVIEW,
          reason: 'text_mention'
        };
      }
    } else {
      // Settlement is resolved, but NOT in active watch profile (e.g. Berettyóújfalu without config, or another district town)
      result[VIEWS.LOCAL] = {
        inView: false,
        category: null,
        reason: 'outside_active_profile'
      };
    }

    // Hajdú-Bihar County View: matches any settlement in Hajdú-Bihar (countyCode '09' or NUTS3 'HU321')
    if (countyCode === '09' || nuts3 === 'HU321') {
      const isConfirmed = isConfirmedLocal ||
        localRelevanceReason === LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT ||
        localRelevanceReason === LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION;
      result[VIEWS.COUNTY] = {
        inView: true,
        category: isConfirmed ? VIEW_CATEGORIES.CONFIRMED_LOCAL : VIEW_CATEGORIES.NEEDS_REVIEW,
        reason: 'county_settlement'
      };
    }

    // National View: matches any Hungarian settlement
    if (country === 'HUN' || country === 'HU' || nuts0 === 'HU' || countyCode) {
      result[VIEWS.NATIONAL] = {
        inView: true,
        category: VIEW_CATEGORIES.CONFIRMED_LOCAL,
        reason: 'national_settlement'
      };
    }
    return result;
  }

  // 3. County / Regional Level Match (source_region_only)
  if (territoryLevel === ADMINISTRATIVE_LEVELS.COUNTY ||
      territoryLevel === ADMINISTRATIVE_LEVELS.REGION ||
      territoryLevel === 'county' ||
      territoryLevel === 'region') {

    const isHajduBihar = countyCode === '09' || nuts3 === 'HU321';
    const isEszakAlfold = nuts2 === 'HU32';

    // Local View: Enclosing county or regional alert is included as regionalAdvisories, NEVER confirmedLocal!
    if (isHajduBihar || isEszakAlfold) {
      result[VIEWS.LOCAL] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES,
        reason: 'enclosing_regional_warning'
      };
    }

    // Hajdú-Bihar View:
    // County-level Hajdú-Bihar warnings belong to county view as confirmedLocal (or county advisory).
    // NUTS2 Észak-Alföld (HU32) warnings enclose Hajdú-Bihar, and are included as regionalAdvisories.
    if (isHajduBihar) {
      result[VIEWS.COUNTY] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES, // County warning
        reason: 'county_warning'
      };
    } else if (isEszakAlfold) {
      // HU32 regional record: explicitly tagged as regionalAdvisories in Hajdú-Bihar view
      result[VIEWS.COUNTY] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES,
        reason: 'enclosing_nuts2_regional_advisory'
      };
    }

    // National View: All Hungarian county/regional alerts belong to national view
    if (nuts0 === 'HU' || country === 'HUN' || country === 'HU' || isHajduBihar || isEszakAlfold) {
      result[VIEWS.NATIONAL] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES,
        reason: 'domestic_regional_warning'
      };
    }
    return result;
  }

  // 4. National Level Match
  if (territoryLevel === ADMINISTRATIVE_LEVELS.COUNTRY || territoryLevel === 'country' ||
      country === 'HUN' || country === 'HU' || nuts0 === 'HU') {
    result[VIEWS.NATIONAL] = {
      inView: true,
      category: VIEW_CATEGORIES.CONFIRMED_LOCAL,
      reason: 'national_level'
    };
  }

  return result;
}

/**
 * Partitions a list of events into the four territorial views,
 * enforcing unique incident counting across CAP chains and breakdown categories.
 */
export function partitionEventsByView(events = [], config = DEFAULT_TERRITORY_CONFIG) {
  const eventList = Array.isArray(events) ? events : [];

  const partitions = {
    [VIEWS.LOCAL]: {
      view: VIEWS.LOCAL,
      totalEvents: 0,
      uniqueEvents: 0,
      breakdown: {
        confirmedLocal: 0,
        needsReview: 0,
        regionalAdvisories: 0,
        unknownTerritory: 0
      },
      items: {
        confirmedLocal: [],
        needsReview: [],
        regionalAdvisories: [],
        unknownTerritory: []
      }
    },
    [VIEWS.COUNTY]: {
      view: VIEWS.COUNTY,
      totalEvents: 0,
      uniqueEvents: 0,
      breakdown: {
        confirmedLocal: 0,
        needsReview: 0,
        regionalAdvisories: 0,
        unknownTerritory: 0
      },
      items: {
        confirmedLocal: [],
        needsReview: [],
        regionalAdvisories: [],
        unknownTerritory: []
      }
    },
    [VIEWS.NATIONAL]: {
      view: VIEWS.NATIONAL,
      totalEvents: 0,
      uniqueEvents: 0,
      breakdown: {
        confirmedLocal: 0,
        needsReview: 0,
        regionalAdvisories: 0,
        unknownTerritory: 0
      },
      items: {
        confirmedLocal: [],
        needsReview: [],
        regionalAdvisories: [],
        unknownTerritory: []
      }
    },
    [VIEWS.GLOBAL]: {
      view: VIEWS.GLOBAL,
      totalEvents: 0,
      uniqueEvents: 0,
      breakdown: {
        confirmedLocal: 0,
        needsReview: 0,
        regionalAdvisories: 0,
        unknownTerritory: 0
      },
      items: {
        confirmedLocal: [],
        needsReview: [],
        regionalAdvisories: [],
        unknownTerritory: []
      }
    }
  };

  // Track unique incident keys per view and per category to enforce the counting contract
  const seenKeysPerView = {
    [VIEWS.LOCAL]: new Set(),
    [VIEWS.COUNTY]: new Set(),
    [VIEWS.NATIONAL]: new Set(),
    [VIEWS.GLOBAL]: new Set()
  };

  const seenKeysPerCategory = {
    [VIEWS.LOCAL]: { confirmedLocal: new Set(), needsReview: new Set(), regionalAdvisories: new Set(), unknownTerritory: new Set() },
    [VIEWS.COUNTY]: { confirmedLocal: new Set(), needsReview: new Set(), regionalAdvisories: new Set(), unknownTerritory: new Set() },
    [VIEWS.NATIONAL]: { confirmedLocal: new Set(), needsReview: new Set(), regionalAdvisories: new Set(), unknownTerritory: new Set() },
    [VIEWS.GLOBAL]: { confirmedLocal: new Set(), needsReview: new Set(), regionalAdvisories: new Set(), unknownTerritory: new Set() }
  };

  for (const event of eventList) {
    if (!event || typeof event !== 'object') continue;

    const key = getEventCanonicalKey(event);
    const evaluation = evaluateEventTerritoryViews(event, config);

    for (const view of Object.values(VIEWS)) {
      const match = evaluation[view];
      if (!match || !match.inView) continue;

      const category = match.category || VIEW_CATEGORIES.CONFIRMED_LOCAL;
      partitions[view].totalEvents += 1;
      partitions[view].items[category].push(event);

      // Unique incident tracking per view
      if (!seenKeysPerView[view].has(key)) {
        seenKeysPerView[view].add(key);
        partitions[view].uniqueEvents += 1;
      }

      // Unique incident tracking per category
      if (!seenKeysPerCategory[view][category].has(key)) {
        seenKeysPerCategory[view][category].add(key);
        partitions[view].breakdown[category] += 1;
      }
    }
  }

  return partitions;
}

/**
 * Orthogonal Lens x View filter.
 * Combines territorial view partitioning with domain lenses (lens-core.js).
 * Pure function: an event is retained if and only if it matches both view and lens.
 */
export function matchesViewAndLens(event, view, lens = 'all', config = DEFAULT_TERRITORY_CONFIG, domains = null) {
  if (!event || typeof event !== 'object') return false;

  // 1. View check
  const evaluation = evaluateEventTerritoryViews(event, config);
  const viewMatch = evaluation[view];
  if (!viewMatch || !viewMatch.inView) return false;

  // 2. Lens check
  const normLens = typeof lens === 'string' && lens.trim() ? lens.trim().toLowerCase() : 'all';
  if (normLens === 'all') return true;

  // If domains registry is provided or available on global
  const registry = domains || (typeof window !== 'undefined' ? window.CrucixDomains : null);
  if (registry && typeof registry.domainOfEvent === 'function') {
    const domain = typeof event.source === 'string' && typeof registry.domainOfSource === 'function'
      ? registry.domainOfSource(event.source)
      : registry.domainOfEvent(event);
    return domain === normLens;
  }

  // Fallback domain inspection directly on event
  const eventDomain = event.domain || event.lens || event.category || null;
  if (eventDomain) {
    return eventDomain.toLowerCase() === normLens;
  }

  // Source-level domain inference if source has domain property
  if (event.source && typeof event.source === 'object' && event.source.domain) {
    return event.source.domain.toLowerCase() === normLens;
  }

  return false;
}

/**
 * Filters a list of events by both view and domain lens.
 */
export function filterEventsByViewAndLens(events = [], view = VIEWS.LOCAL, lens = 'all', config = DEFAULT_TERRITORY_CONFIG, domains = null) {
  const list = Array.isArray(events) ? events : [];
  return list.filter(e => matchesViewAndLens(e, view, lens, config, domains));
}

/**
 * Computes the full 2D View x Lens matrix with unique incident counters.
 */
export function computeViewLensMatrix(events = [], lenses = ['all'], config = DEFAULT_TERRITORY_CONFIG, domains = null) {
  const matrix = {};
  for (const view of Object.values(VIEWS)) {
    matrix[view] = {};
    for (const lens of lenses) {
      const filtered = filterEventsByViewAndLens(events, view, lens, config, domains);
      const uniqueKeys = new Set(filtered.map(getEventCanonicalKey));
      matrix[view][lens] = {
        total: filtered.length,
        unique: uniqueKeys.size
      };
    }
  }
  return matrix;
}

/**
 * Evaluates the 6-state coverage status for each source.
 *
 * @param {Array<Object>} sources - Configured source list
 * @param {Array<Object>} observations - Current items/events received from sources
 * @param {Object} options - { now, staleThresholdMs, isOfflineSnapshot }
 * @returns {Array<Object>} Evaluated coverage status per source
 */
export function evaluateSourceCoverage(sources = [], observations = [], options = {}) {
  const now = Number(options.now) || Date.now();
  const staleThresholdMs = Number(options.staleThresholdMs) || 60 * 60 * 1000; // Default 1 hour
  const isOfflineSnapshot = Boolean(options.isOfflineSnapshot);

  const sourceList = Array.isArray(sources) ? sources : [];
  const obsList = Array.isArray(observations) ? observations : [];

  // Group observations/events by source name/id
  const obsBySource = new Map();
  for (const obs of obsList) {
    if (!obs || typeof obs !== 'object') continue;
    const srcKey = typeof obs.source === 'string' ? obs.source : (obs.source?.name || obs.sourceId || 'unknown');
    if (!obsBySource.has(srcKey)) {
      obsBySource.set(srcKey, []);
    }
    obsBySource.get(srcKey).push(obs);
  }

  return sourceList.map(src => {
    const id = src.id || src.name || 'unknown';
    const name = src.name || src.label || id;
    const domain = src.domain || 'general';
    const enabled = src.enabled !== false;
    const items = obsBySource.get(id) || obsBySource.get(name) || [];

    // 1. Explicitly disabled source
    if (!enabled || src.status === 'disabled') {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        status: COVERAGE_STATES.LETILTOTT,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.LETILTOTT],
        itemCount: 0,
        lastUpdated: null,
        timeWindow: { label: 'disabled', durationMs: 0 },
        isSnapshot: isOfflineSnapshot,
        sourceType: 'disabled',
        error: null
      };
    }

    // 2. Offline snapshot mode
    if (isOfflineSnapshot) {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        status: COVERAGE_STATES.OFFLINE_PILLANATKEP,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.OFFLINE_PILLANATKEP],
        itemCount: items.length,
        lastUpdated: src.lastUpdated || null,
        timeWindow: { label: 'snapshot', durationMs: null },
        isSnapshot: true,
        sourceType: 'snapshot',
        error: null
      };
    }

    // 3. Stale or Error state
    if (src.status === 'error' || src.error) {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        status: COVERAGE_STATES.ELAVULT_HIBAS,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.ELAVULT_HIBAS],
        itemCount: items.length,
        lastUpdated: src.lastUpdated || null,
        timeWindow: { label: 'error', durationMs: null },
        isSnapshot: false,
        sourceType: 'live',
        error: src.error || 'Source reported an error'
      };
    }

    // Check last update age
    const lastUpdateMs = src.lastUpdated ? Date.parse(src.lastUpdated) : null;
    if (Number.isFinite(lastUpdateMs) && (now - lastUpdateMs > staleThresholdMs)) {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        status: COVERAGE_STATES.ELAVULT_HIBAS,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.ELAVULT_HIBAS],
        itemCount: items.length,
        lastUpdated: src.lastUpdated,
        timeWindow: { label: 'stale', durationMs: now - lastUpdateMs },
        isSnapshot: false,
        sourceType: 'live',
        error: `Data is stale (older than ${Math.round(staleThresholdMs / 60000)} minutes)`
      };
    }

    // 4. Successful with items
    if (items.length > 0) {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        status: COVERAGE_STATES.SIKERES_ADAT,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.SIKERES_ADAT],
        itemCount: items.length,
        lastUpdated: src.lastUpdated || new Date(now).toISOString(),
        timeWindow: { label: 'active_window', durationMs: staleThresholdMs },
        isSnapshot: false,
        sourceType: 'live',
        error: null
      };
    }

    // 5. Successful with 0 items (e.g. no weather alerts or no active epidemic)
    return {
      sourceId: id,
      sourceName: name,
      domain,
      status: COVERAGE_STATES.SIKERES_URES,
      statusLabel: COVERAGE_LABELS[COVERAGE_STATES.SIKERES_URES],
      itemCount: 0,
      lastUpdated: src.lastUpdated || new Date(now).toISOString(),
      timeWindow: { label: 'active_window', durationMs: staleThresholdMs },
      isSnapshot: false,
      sourceType: 'live',
      error: null
    };
  });
}
