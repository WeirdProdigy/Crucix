/**
 * View partitioning, counting contracts, domain-lens intersection,
 * and source coverage state model for Crucix (Package 2, Step 2A).
 *
 * Implements:
 * 1. Territorial Views: Helyi (Local), Hajdú-Bihar (County), Magyarország (National), Világ (Global)
 * 2. Strict Partitioning Categories:
 *    - Local view: confirmedLocal, keyConnection, needsReview, regionalAdvisories, unknownTerritory
 *    - County view: countyEvent, needsReview, regionalAdvisories, unknownTerritory
 *    - National view: nationalEvent, needsReview, regionalAdvisories, unknownTerritory
 *    - Global view: globalEvent, needsReview, unknownTerritory
 *    Guaranteed: confirmedLocal is ONLY used for primary/watched settlements in the active profile!
 *    Text mentions, unknown territory, unwatched settlements, key cities, and regional alerts
 *    are NEVER labelled confirmedLocal in ANY view.
 * 3. Relationship Types: primary, watched, key_connection, county, region, national, global, unknown
 * 4. Unique Incident Counting Contract across CAP chains with sender support and cancelled chain handling
 * 5. 6-state Source Coverage Model with explicit state precedence and 2C prerequisite tagging
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
 * - confirmedLocal: STRICTLY reserved for active-profile primary (Bihartorda) and watched settlements
 *   with official_area_assignment or resolved_event_location.
 * - keyConnection: dedicated counter/category for key cities (Debrecen, Hajdúszoboszló, Püspökladány, Berettyóújfalu if configured).
 * - countyEvent / nationalEvent / globalEvent: view-specific event categories for higher-level views (NEVER confirmedLocal).
 */
export const VIEW_CATEGORIES = Object.freeze({
  CONFIRMED_LOCAL: 'confirmedLocal',         // Megerősített helyi találat (kizárólag primary / watched settlement)
  KEY_CONNECTION: 'keyConnection',           // Kiemelt városi kapcsolat (külön számláló, nem bihartordai megerősített)
  NEEDS_REVIEW: 'needsReview',               // Ellenőrizendő helyi vonatkozás (text_mention)
  REGIONAL_ADVISORIES: 'regionalAdvisories', // Térségi / régiós tájékoztatás (source_region_only vármegyei/nagyrégiós riasztás)
  UNKNOWN_TERRITORY: 'unknownTerritory',     // Tisztázatlan / ismeretlen területi érintettség (matchState === 'unknown')
  COUNTY_EVENT: 'countyEvent',               // Vármegyei nézeti esemény (Hajdú-Bihar szint vagy nem figyelt megyei település)
  NATIONAL_EVENT: 'nationalEvent',           // Országos nézeti esemény
  GLOBAL_EVENT: 'globalEvent'                // Globális nézeti esemény
});

/**
 * Fine-grained territorial relationships.
 */
export const RELATIONSHIPS = Object.freeze({
  PRIMARY: 'primary',               // Elsődleges figyelt település (Bihartorda)
  WATCHED: 'watched',               // Felhasználó által figyelt település (pl. Bakonszeg, Nagyrábé)
  KEY_CONNECTION: 'key_connection', // Kiemelt városi kapcsolat (Debrecen, Hajdúszoboszló, Püspökladány)
  COUNTY: 'county',                 // Vármegyei szint vagy nem figyelt vármegyei település (pl. Zsáka)
  REGION: 'region',                 // Nagyrégiós szint (pl. Észak-Alföld NUTS2 HU32)
  NATIONAL: 'national',             // Országos szint / egyéb magyar település
  GLOBAL: 'global',                 // Nemzetközi / globális
  UNKNOWN: 'unknown'                // Ismeretlen / nem feloldható
});

/**
 * Human-readable Hungarian labels for categories.
 */
export const CATEGORY_LABELS = Object.freeze({
  confirmedLocal: 'Megerősített helyi érintettség (Bihartorda és figyelt települések)',
  keyConnection: 'Kiemelt városi kapcsolat (Debrecen, Hajdúszoboszló, Püspökladány)',
  needsReview: 'Ellenőrizendő szöveges említés',
  regionalAdvisories: 'Térségi tájékoztatás',
  unknownTerritory: 'Ismeretlen területi érintettség',
  countyEvent: 'Hajdú-Bihar vármegyei esemény',
  nationalEvent: 'Országos esemény',
  globalEvent: 'Globális esemény'
});

/**
 * Source coverage status model (6 states).
 */
export const COVERAGE_STATES = Object.freeze({
  LETILTOTT: 'letiltott',                     // 1. Konfigurációban letiltott forrás
  OFFLINE_PILLANATKEP: 'offline_pillanatkép', // 2. Statikus offline pillanatkép / archívum
  NINCS_FORRAS: 'nincs_forrás',               // 3. Nincs konfigurált / elérhető forrás a témához
  ELAVULT_HIBAS: 'elavult_hibas',             // 4. Hiba történt, vagy elavult az adat
  SIKERES_ADAT: 'sikeres_adat',               // 5. Sikeres lekérés, érkezett tétel
  SIKERES_URES: 'sikeres_üres'                // 6. Sikeres lekérés, nincs aktív tétel
});

/**
 * Explicit precedence order of coverage states (1 = highest priority).
 */
export const COVERAGE_PRECEDENCE = Object.freeze([
  COVERAGE_STATES.LETILTOTT,
  COVERAGE_STATES.OFFLINE_PILLANATKEP,
  COVERAGE_STATES.NINCS_FORRAS,
  COVERAGE_STATES.ELAVULT_HIBAS,
  COVERAGE_STATES.SIKERES_ADAT,
  COVERAGE_STATES.SIKERES_URES
]);

/**
 * Hungarian human-readable labels for source coverage states.
 */
export const COVERAGE_LABELS = Object.freeze({
  [COVERAGE_STATES.LETILTOTT]: 'Letiltott forrás',
  [COVERAGE_STATES.OFFLINE_PILLANATKEP]: 'Offline pillanatkép',
  [COVERAGE_STATES.NINCS_FORRAS]: 'Nincs telepített forrás',
  [COVERAGE_STATES.ELAVULT_HIBAS]: 'Elavult vagy hibás forrás',
  [COVERAGE_STATES.SIKERES_ADAT]: 'Sikeres adatgyűjtés',
  [COVERAGE_STATES.SIKERES_URES]: 'Nincs aktív jelzés'
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
 * Ensures unlocated items receive coordinates: null, preventing synthetic coordinate drift.
 */
export function sanitizeCoordinates(coordinates) {
  if (!coordinates || typeof coordinates !== 'object') return null;
  const lat = Number(coordinates.lat);
  const lon = Number(coordinates.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
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
 * Always incorporates sender when available to prevent collision between identical identifiers from different senders.
 * Deduplicates CAP update/cancel chains to the same incident identity.
 */
export function getEventCanonicalKey(event) {
  if (!event || typeof event !== 'object') {
    return 'unknown:empty';
  }
  const sender = typeof event.sender === 'string' && event.sender.trim() ? event.sender.trim() : null;

  // 1. CAP Chain Key: incorporate sender if not already prefixed
  if (typeof event.chainKey === 'string' && event.chainKey.trim()) {
    const rawChain = event.chainKey.trim();
    const fullChain = (sender && !rawChain.startsWith(`${sender}:`)) ? `${sender}:${rawChain}` : rawChain;
    return `cap-chain:${fullChain}`;
  }

  // 2. CAP message with identifier and sender
  if (typeof event.identifier === 'string' && event.identifier.trim()) {
    return `cap-msg:${sender || 'unknown-sender'}:${event.identifier.trim()}`;
  }

  // 3. Official Crucix event ID
  if (typeof event.id === 'string' && event.id.trim()) {
    return `event-id:${event.id.trim()}`;
  }

  // 4. Provider ID with sender
  if (typeof event.providerId === 'string' && event.providerId.trim()) {
    return `provider:${sender || 'unknown-sender'}:${event.providerId.trim()}`;
  }

  // 5. Deterministic fallback for ID-less items
  const source = typeof event.source === 'string' ? event.source : (event.source?.name || 'unknown');
  const title = typeof event.title === 'string' ? event.title.trim().slice(0, 100) : '';
  const time = event.publishedAt || event.observedAt || event.time || '';
  const link = typeof event.link === 'string' ? event.link : '';
  return `raw:${sender || source}:${title}:${time}:${link}`;
}

/**
 * Resolves the territorial relationship of a settlement or territory record.
 */
function resolveRelationship(settlementCode, territory, config) {
  if (!config) return RELATIONSHIPS.UNKNOWN;

  // 1. Primary settlement (Bihartorda)
  if (settlementCode && config.primary?.kshSettlement === settlementCode) {
    return RELATIONSHIPS.PRIMARY;
  }

  // 2. Watched settlements (e.g. Bakonszeg, Nagyrábé)
  if (settlementCode && Array.isArray(config.watchedSettlements) &&
      config.watchedSettlements.some(s => s.kshSettlement === settlementCode)) {
    return RELATIONSHIPS.WATCHED;
  }

  // 3. Key cities / connections (Debrecen, Hajdúszoboszló, Püspökladány; Berettyóújfalu if in config)
  const keyCities = config.keyCities || config.keyConnections || [];
  if (settlementCode && Array.isArray(keyCities) &&
      keyCities.some(k => k.kshSettlement === settlementCode)) {
    return RELATIONSHIPS.KEY_CONNECTION;
  }

  // 4. Full district inclusion
  if (config.includeFullDistrict && settlementCode && Array.isArray(config.districtSettlements) &&
      config.districtSettlements.some(d => d.kshSettlement === settlementCode)) {
    return RELATIONSHIPS.WATCHED;
  }

  // 5. County level or Hajdú-Bihar non-watched settlement (e.g. Zsáka)
  const countyCode = territory?.countyCode || territory?.county?.id;
  const nuts3 = territory?.nuts3 || territory?.nuts?.nuts3;
  if (countyCode === '09' || nuts3 === 'HU321') {
    return RELATIONSHIPS.COUNTY;
  }

  // 6. Regional level (Észak-Alföld NUTS2 HU32)
  const nuts2 = territory?.nuts2 || territory?.nuts?.nuts2;
  if (nuts2 === 'HU32') {
    return RELATIONSHIPS.REGION;
  }

  // 7. National
  const country = territory?.country || territory?.iso3 || territory?.nuts0;
  if (country === 'HUN' || country === 'HU') {
    return RELATIONSHIPS.NATIONAL;
  }

  return RELATIONSHIPS.UNKNOWN;
}

/**
 * Evaluates an event against the 4 territorial views, cleanly separating:
 * - inView: boolean (membership in that view)
 * - category: string | null (role within that view)
 * - relationship: primary | watched | key_connection | county | region | national | global | unknown
 * - reason: string | null
 */
export function evaluateEventTerritoryViews(event, config = DEFAULT_TERRITORY_CONFIG) {
  const result = {
    [VIEWS.LOCAL]: { inView: false, category: null, relationship: RELATIONSHIPS.UNKNOWN, reason: null },
    [VIEWS.COUNTY]: { inView: false, category: null, relationship: RELATIONSHIPS.UNKNOWN, reason: null },
    [VIEWS.NATIONAL]: { inView: false, category: null, relationship: RELATIONSHIPS.UNKNOWN, reason: null },
    [VIEWS.GLOBAL]: { inView: true, category: VIEW_CATEGORIES.GLOBAL_EVENT, relationship: RELATIONSHIPS.GLOBAL, reason: 'global_scope' }
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
    result[VIEWS.LOCAL] = {
      inView: true,
      category: VIEW_CATEGORIES.UNKNOWN_TERRITORY,
      relationship: RELATIONSHIPS.UNKNOWN,
      reason: 'indeterminate_territory'
    };
    result[VIEWS.COUNTY] = {
      inView: false,
      category: null,
      relationship: RELATIONSHIPS.UNKNOWN,
      reason: 'unknown_not_resolved_to_county'
    };
    result[VIEWS.NATIONAL] = {
      inView: true,
      category: VIEW_CATEGORIES.UNKNOWN_TERRITORY,
      relationship: RELATIONSHIPS.UNKNOWN,
      reason: 'indeterminate_domestic'
    };
    result[VIEWS.GLOBAL] = {
      inView: true,
      category: VIEW_CATEGORIES.UNKNOWN_TERRITORY,
      relationship: RELATIONSHIPS.UNKNOWN,
      reason: 'indeterminate_global'
    };
    return result;
  }

  // 2. Settlement Level Match
  if (territoryLevel === ADMINISTRATIVE_LEVELS.SETTLEMENT || territoryLevel === 'settlement') {
    const relationship = resolveRelationship(kshSettlement, territory, config);
    const isTextMention = localRelevanceReason === LOCAL_RELEVANCE_REASONS.TEXT_MENTION || Boolean(territory.needsLocalReview);
    const isOfficialOrResolved = isConfirmedLocal ||
      localRelevanceReason === LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT ||
      localRelevanceReason === LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION;

    // --- A. Local View ---
    if (relationship === RELATIONSHIPS.PRIMARY || relationship === RELATIONSHIPS.WATCHED) {
      if (isOfficialOrResolved) {
        result[VIEWS.LOCAL] = {
          inView: true,
          category: VIEW_CATEGORIES.CONFIRMED_LOCAL, // ONLY primary and watched settlements can be confirmedLocal
          relationship,
          reason: localRelevanceReason || 'confirmed_settlement'
        };
      } else if (isTextMention) {
        result[VIEWS.LOCAL] = {
          inView: true,
          category: VIEW_CATEGORIES.NEEDS_REVIEW,
          relationship,
          reason: 'text_mention'
        };
      }
    } else if (relationship === RELATIONSHIPS.KEY_CONNECTION) {
      if (isOfficialOrResolved) {
        result[VIEWS.LOCAL] = {
          inView: true,
          category: VIEW_CATEGORIES.KEY_CONNECTION, // Dedicated keyConnection category, NOT bihartordai megerősített
          relationship: RELATIONSHIPS.KEY_CONNECTION,
          reason: 'key_connection_settlement'
        };
      } else if (isTextMention) {
        result[VIEWS.LOCAL] = {
          inView: true,
          category: VIEW_CATEGORIES.NEEDS_REVIEW,
          relationship: RELATIONSHIPS.KEY_CONNECTION,
          reason: 'text_mention'
        };
      }
    } else {
      // Settlement is unwatched / not in active profile (e.g. Zsáka, or Berettyóújfalu when not in config)
      result[VIEWS.LOCAL] = {
        inView: false,
        category: null,
        relationship,
        reason: 'outside_active_profile'
      };
    }

    // --- B. Hajdú-Bihar County View ---
    // Matches any settlement in Hajdú-Bihar (countyCode '09' or NUTS3 'HU321')
    if (countyCode === '09' || nuts3 === 'HU321') {
      result[VIEWS.COUNTY] = {
        inView: true,
        category: isTextMention ? VIEW_CATEGORIES.NEEDS_REVIEW : VIEW_CATEGORIES.COUNTY_EVENT, // NEVER confirmedLocal!
        relationship,
        reason: 'county_settlement'
      };
    }

    // --- C. National View ---
    if (country === 'HUN' || country === 'HU' || nuts0 === 'HU' || countyCode) {
      result[VIEWS.NATIONAL] = {
        inView: true,
        category: isTextMention ? VIEW_CATEGORIES.NEEDS_REVIEW : VIEW_CATEGORIES.NATIONAL_EVENT, // NEVER confirmedLocal!
        relationship,
        reason: 'national_settlement'
      };
    }

    // --- D. Global View ---
    result[VIEWS.GLOBAL] = {
      inView: true,
      category: isTextMention ? VIEW_CATEGORIES.NEEDS_REVIEW : VIEW_CATEGORIES.GLOBAL_EVENT,
      relationship,
      reason: 'settlement'
    };

    return result;
  }

  // 3. County / Regional Level Match (source_region_only)
  if (territoryLevel === ADMINISTRATIVE_LEVELS.COUNTY ||
      territoryLevel === ADMINISTRATIVE_LEVELS.REGION ||
      territoryLevel === 'county' ||
      territoryLevel === 'region') {

    const isHajduBihar = countyCode === '09' || nuts3 === 'HU321';
    const isEszakAlfold = nuts2 === 'HU32';
    const rel = isHajduBihar ? RELATIONSHIPS.COUNTY : (isEszakAlfold ? RELATIONSHIPS.REGION : RELATIONSHIPS.NATIONAL);

    // Local View: Enclosing county or regional alert is included as regionalAdvisories, NEVER confirmedLocal!
    if (isHajduBihar || isEszakAlfold) {
      result[VIEWS.LOCAL] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES,
        relationship: rel,
        reason: 'enclosing_regional_warning'
      };
    }

    // Hajdú-Bihar View:
    // County-level Hajdú-Bihar warnings belong to county view as regionalAdvisories.
    // NUTS2 Észak-Alföld (HU32) warnings enclose Hajdú-Bihar, included as regionalAdvisories.
    if (isHajduBihar) {
      result[VIEWS.COUNTY] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES,
        relationship: RELATIONSHIPS.COUNTY,
        reason: 'county_warning'
      };
    } else if (isEszakAlfold) {
      result[VIEWS.COUNTY] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES,
        relationship: RELATIONSHIPS.REGION,
        reason: 'enclosing_nuts2_regional_advisory'
      };
    }

    // National View
    if (nuts0 === 'HU' || country === 'HUN' || country === 'HU' || isHajduBihar || isEszakAlfold) {
      result[VIEWS.NATIONAL] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES,
        relationship: rel,
        reason: 'domestic_regional_warning'
      };
    }

    result[VIEWS.GLOBAL] = {
      inView: true,
      category: VIEW_CATEGORIES.REGIONAL_ADVISORIES,
      relationship: rel,
      reason: 'regional_warning'
    };

    return result;
  }

  // 4. National Level Match
  if (territoryLevel === ADMINISTRATIVE_LEVELS.COUNTRY || territoryLevel === 'country' ||
      country === 'HUN' || country === 'HU' || nuts0 === 'HU') {
    result[VIEWS.NATIONAL] = {
      inView: true,
      category: VIEW_CATEGORIES.NATIONAL_EVENT,
      relationship: RELATIONSHIPS.NATIONAL,
      reason: 'national_level'
    };
    result[VIEWS.GLOBAL] = {
      inView: true,
      category: VIEW_CATEGORIES.GLOBAL_EVENT,
      relationship: RELATIONSHIPS.NATIONAL,
      reason: 'national_level'
    };
  }

  return result;
}

/**
 * Helper to check whether an event message represents a revocation/cancellation.
 */
function isCancelMessage(event) {
  if (!event || typeof event !== 'object') return false;
  return Boolean(
    event.cancelled === true ||
    event.msgType === 'Cancel' ||
    event.status === 'Cancel' ||
    event.lifecycle === 'cancelled' ||
    event.lifecycle === 'revoked'
  );
}

/**
 * Partitions a list of events into the four territorial views,
 * enforcing:
 * - Unique incident counting across CAP chains (incorporating sender)
 * - Chain resolution: latest message determines category; cancelled chain increments cancelledChains without active alert count
 * - Breakdown separation: confirmedLocal, keyConnection, needsReview, regionalAdvisories, unknownTerritory
 * - Relationship tracking: primary, watched, key_connection, county, region, national, global, unknown
 */
export function partitionEventsByView(events = [], config = DEFAULT_TERRITORY_CONFIG) {
  const eventList = Array.isArray(events) ? events : [];

  const createViewPartition = view => ({
    view,
    totalEvents: 0,
    uniqueEvents: 0,
    cancelledChains: 0,
    breakdown: {
      confirmedLocal: 0,      // ONLY primary and watched settlements (official/resolved)
      keyConnection: 0,       // Key connection cities (official/resolved)
      needsReview: 0,         // Text mentions
      regionalAdvisories: 0,  // Enclosing county/region advisories
      unknownTerritory: 0,    // Indeterminate
      countyEvent: 0,         // County view events
      nationalEvent: 0,       // National view events
      globalEvent: 0          // Global view events
    },
    relationshipBreakdown: {
      primary: 0,
      watched: 0,
      key_connection: 0,
      county: 0,
      region: 0,
      national: 0,
      global: 0,
      unknown: 0
    },
    items: {
      confirmedLocal: [],
      keyConnection: [],
      needsReview: [],
      regionalAdvisories: [],
      unknownTerritory: [],
      countyEvent: [],
      nationalEvent: [],
      globalEvent: []
    }
  });

  const partitions = {
    [VIEWS.LOCAL]: createViewPartition(VIEWS.LOCAL),
    [VIEWS.COUNTY]: createViewPartition(VIEWS.COUNTY),
    [VIEWS.NATIONAL]: createViewPartition(VIEWS.NATIONAL),
    [VIEWS.GLOBAL]: createViewPartition(VIEWS.GLOBAL)
  };

  // 1. Group events by canonical key to resolve multi-message chains (e.g. Alert -> Update -> Cancel)
  // Maps: key -> array of events in arrival/order sequence
  const chainsByKey = new Map();
  for (const event of eventList) {
    if (!event || typeof event !== 'object') continue;
    const key = getEventCanonicalKey(event);
    if (!chainsByKey.has(key)) {
      chainsByKey.set(key, []);
    }
    chainsByKey.get(key).push(event);
  }

  // 2. Process each chain
  for (const [key, chainEvents] of chainsByKey.entries()) {
    // Latest message determines final category and state of the chain
    const latestEvent = chainEvents[chainEvents.length - 1];
    const isCancelled = chainEvents.some(isCancelMessage);

    // Evaluate each raw event for raw counting and item storage
    for (const event of chainEvents) {
      const evaluation = evaluateEventTerritoryViews(event, config);
      for (const view of Object.values(VIEWS)) {
        const match = evaluation[view];
        if (!match || !match.inView) continue;
        partitions[view].totalEvents += 1;
        const category = match.category || VIEW_CATEGORIES.GLOBAL_EVENT;
        if (partitions[view].items[category]) {
          partitions[view].items[category].push(event);
        }
      }
    }

    // Evaluate latest event for unique incident counts
    const latestEval = evaluateEventTerritoryViews(latestEvent, config);

    for (const view of Object.values(VIEWS)) {
      const match = latestEval[view];
      if (!match || !match.inView) continue;

      if (isCancelled) {
        // Visszavont lánc: a raw totalEvents-ben szerepel, de az aktív incidenseket nem növeli!
        // Külön cancelledChains számlálót kap.
        partitions[view].cancelledChains += 1;
        continue;
      }

      // Aktív incidens számlálás
      partitions[view].uniqueEvents += 1;

      const category = match.category;
      if (category && partitions[view].breakdown[category] !== undefined) {
        partitions[view].breakdown[category] += 1;
      }

      const relationship = match.relationship;
      if (relationship && partitions[view].relationshipBreakdown[relationship] !== undefined) {
        partitions[view].relationshipBreakdown[relationship] += 1;
      }
    }
  }

  return partitions;
}

/**
 * Orthogonal Lens x View filter.
 * Combines territorial view partitioning with domain lenses (lens-core.js).
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

  const registry = domains || (typeof window !== 'undefined' ? window.CrucixDomains : null);
  if (registry && typeof registry.domainOfEvent === 'function') {
    const domain = typeof event.source === 'string' && typeof registry.domainOfSource === 'function'
      ? registry.domainOfSource(event.source)
      : registry.domainOfEvent(event);
    return domain === normLens;
  }

  const eventDomain = event.domain || event.lens || event.category || null;
  if (eventDomain) {
    return eventDomain.toLowerCase() === normLens;
  }

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
 * Evaluates the 6-state coverage status for each source, enforcing strict state precedence:
 * 1. LETILTOTT (disabled)
 * 2. OFFLINE_PILLANATKEP (offline snapshot mode)
 * 3. NINCS_FORRAS (unconfigured / missing source -> flagged as 2C prerequisite)
 * 4. ELAVULT_HIBAS (error or stale)
 * 5. SIKERES_ADAT (active items)
 * 6. SIKERES_URES (calm / 0 items)
 *
 * @param {Array<Object>} sources - Configured source list
 * @param {Array<Object>} observations - Current items/events received from sources
 * @param {Object} options - { now, staleThresholdMs, isOfflineSnapshot }
 * @returns {Array<Object>} Evaluated coverage status per source
 */
export function evaluateSourceCoverage(sources = [], observations = [], options = {}) {
  const now = Number(options.now) || Date.now();
  const staleThresholdMs = Number(options.staleThresholdMs) || 60 * 60 * 1000;
  const isOfflineSnapshot = Boolean(options.isOfflineSnapshot);

  const sourceList = Array.isArray(sources) ? sources : [];
  const obsList = Array.isArray(observations) ? observations : [];

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
    const enabled = src.enabled !== false && src.status !== 'disabled';
    const isUnconfigured = Boolean(src.unconfigured || src.missing || src.status === 'unconfigured');
    const items = obsBySource.get(id) || obsBySource.get(name) || [];

    // Precedence 1: Explicitly disabled source
    if (!enabled) {
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
        error: null,
        prerequisiteForStep2C: false
      };
    }

    // Precedence 2: Offline snapshot mode
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
        error: null,
        prerequisiteForStep2C: false
      };
    }

    // Precedence 3: Unconfigured / missing source -> prerequisite for Step 2C
    if (isUnconfigured || src.status === 'nincs_forrás') {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        status: COVERAGE_STATES.NINCS_FORRAS,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.NINCS_FORRAS],
        itemCount: 0,
        lastUpdated: null,
        timeWindow: { label: 'unconfigured', durationMs: 0 },
        isSnapshot: false,
        sourceType: 'unconfigured',
        error: 'Nincs elérhető vagy konfigurált valós adatforrás ehhez a témához',
        prerequisiteForStep2C: true // Jelölve a 2C előfeltételeként
      };
    }

    // Precedence 4: Error or stale state
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
        error: src.error || 'Source reported an error',
        prerequisiteForStep2C: false
      };
    }

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
        error: `Data is stale (older than ${Math.round(staleThresholdMs / 60000)} minutes)`,
        prerequisiteForStep2C: false
      };
    }

    // Precedence 5: Successful with active items
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
        error: null,
        prerequisiteForStep2C: false
      };
    }

    // Precedence 6: Successful with 0 items
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
      error: null,
      prerequisiteForStep2C: false
    };
  });
}
