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
 *    - Global view: globalEvent, needsReview, unknownTerritory (regionalAdvisories is NOT used in global view)
 *    Guaranteed: confirmedLocal is ONLY used for primary/watched settlements in the active profile!
 *    Text mentions, unknown territory, unwatched settlements, key cities, and regional alerts
 *    are NEVER labelled confirmedLocal in ANY view.
 *    In Hajdú-Bihar view, county alerts (HU321) are countyEvent, while NUTS2 regional alerts (HU32) are regionalAdvisories.
 * 3. Relationship Types: primary, watched, key_connection, county, region, national, global, unknown
 * 4. Unique Incident Counting Contract across CAP chains:
 *    - Incorporates sender with strict fallback ('no-sender')
 *    - Category and active status determined by CAP sent timestamp (arrival order is only a tie-breaker)
 *    - Cancelled chains increment cancelledChains and do NOT count as active unique incidents
 * 5. 6-state Source Coverage Model:
 *    - Data origin (origin: 'snapshot' | 'live') is a separate field
 *    - Operational states (letiltott, nincs_forrás, elavult_hibas) are NEVER overwritten by snapshot mode
 *    - sikeres_üres avoids "nyugodt" wording
 *    - Clean runtime model (no step-specific flags in runtime objects)
 * 6. Date-only normalization and coordinate guards
 * 7. Briefing record reference contracts for Package 2B/2C
 */

import { createHash } from 'node:crypto';
import {
  DEFAULT_TERRITORY_CONFIG,
  LOCAL_RELEVANCE_REASONS,
  IDENTITY_STATUSES,
  WATCH_SCOPES,
  ADMINISTRATIVE_LEVELS,
  RELATIONSHIP_TYPES
} from './territory.mjs';
import { countryByIso3 } from './countries.mjs';
import { POLICIES } from '../../apis/utils/freshness.mjs';

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
 * - countyEvent: county view direct events/settlements and county warnings (HU321).
 * - nationalEvent / globalEvent: view-specific event categories for higher-level views (NEVER confirmedLocal).
 * - regionalAdvisories: enclosing regional advisories (HU32 in county view, county/region in local view). NOT used in global view!
 */
export const VIEW_CATEGORIES = Object.freeze({
  CONFIRMED_LOCAL: 'confirmedLocal',         // Megerősített helyi találat (kizárólag primary / watched settlement)
  KEY_CONNECTION: 'keyConnection',           // Kiemelt városi kapcsolat (külön számláló, nem bihartordai megerősített)
  NEEDS_REVIEW: 'needsReview',               // Ellenőrizendő helyi vonatkozás (text_mention)
  REGIONAL_ADVISORIES: 'regionalAdvisories', // Térségi / régiós tájékoztatás (helyi és megyei nézetben, globálisban NEM!)
  UNKNOWN_TERRITORY: 'unknownTerritory',     // Tisztázatlan / ismeretlen területi érintettség (matchState === 'unknown')
  COUNTY_EVENT: 'countyEvent',               // Vármegyei nézeti esemény (Hajdú-Bihar szint, megyei riasztás HU321 vagy település)
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
  countyEvent: 'Hajdú-Bihar vármegyei esemény / figyelmeztetés',
  nationalEvent: 'Országos esemény',
  globalEvent: 'Globális esemény'
});

/**
 * Source coverage status model (6 states).
 */
export const COVERAGE_STATES = Object.freeze({
  DISABLED: 'disabled',                     // 1. Konfigurációban letiltott forrás
  UNCONFIGURED: 'unconfigured',             // 2. Nincs konfigurált / elérhető forrás a témához
  STALE_ERROR: 'stale_error',               // 3. Hiba történt, vagy elavult az adat
  OFFLINE_SNAPSHOT: 'offline_snapshot',     // 4. Statikus offline pillanatkép / archívum
  OK_DATA: 'ok_data',                       // 5. Sikeres lekérés, érkezett tétel
  OK_EMPTY: 'ok_empty',                     // 6. Sikeres lekérés, nincs aktív tétel
  // Hungarian alias properties for backwards-compatibility:
  LETILTOTT: 'disabled',
  NINCS_FORRAS: 'unconfigured',
  ELAVULT_HIBAS: 'stale_error',
  OFFLINE_PILLANATKEP: 'offline_snapshot',
  SIKERES_ADAT: 'ok_data',
  SIKERES_URES: 'ok_empty'
});

/**
 * Explicit precedence order of coverage states (1 = highest priority).
 * Operational conditions (disabled, missing, error) take precedence over origin.
 */
export const COVERAGE_PRECEDENCE = Object.freeze([
  COVERAGE_STATES.DISABLED,
  COVERAGE_STATES.UNCONFIGURED,
  COVERAGE_STATES.STALE_ERROR,
  COVERAGE_STATES.OFFLINE_SNAPSHOT,
  COVERAGE_STATES.OK_DATA,
  COVERAGE_STATES.OK_EMPTY
]);

/**
 * Hungarian human-readable labels for source coverage states.
 * Guarantees no "nyugodt" wording for OK_EMPTY.
 */
export const COVERAGE_LABELS = Object.freeze({
  [COVERAGE_STATES.DISABLED]: 'Letiltott forrás',
  [COVERAGE_STATES.UNCONFIGURED]: 'Nincs telepített forrás',
  [COVERAGE_STATES.STALE_ERROR]: 'Elavult vagy hibás forrás',
  [COVERAGE_STATES.OFFLINE_SNAPSHOT]: 'Offline pillanatkép',
  [COVERAGE_STATES.OK_DATA]: 'Sikeres adatgyűjtés',
  [COVERAGE_STATES.OK_EMPTY]: 'Szűrés utáni állapot nem meghatározható'
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
 * Helper to determine whether an event / territory is domestic Hungarian.
 * Strict ISO3 (HUN), ISO2 (HU), NUTS0 (HU), or Hungarian territorial machine codes.
 * Returns false for foreign countries (e.g. USA, UKR, ROU, etc.) or territory-less global events.
 */
export function isDomesticCountry(event, territory) {
  const t = territory || event?.territory || {};
  const e = event || {};

  if (t.nuts0 === 'HU' || t.nuts?.nuts0 === 'HU') return true;

  const rawCountry = (t.iso3 || t.country || t.countryCode || e.iso3 || e.country || e.countryCode);
  if (typeof rawCountry === 'string' && rawCountry.trim()) {
    const code = rawCountry.trim().toUpperCase();
    if (code === 'HUN' || code === 'HU') return true;
    const resolved = countryByIso3(code);
    if (resolved) {
      return resolved.iso3 === 'HUN';
    }
  }

  // Machine codes that uniquely identify Hungarian administrative boundaries
  if (t.countyCode || t.nuts3 || t.nuts2 || t.kshSettlement || t.kshSettlementCode) {
    return true;
  }

  return false;
}

/**
 * Computes canonical unique event key.
 * - When sender exists: sender + identifier
 * - When sender is missing: source name is used as fallback
 * - When neither sender nor source name exists: does NOT synthesize a shared 'no-sender' key;
 *   uses unique record ID (id) or a deterministic SHA-256 fingerprint of the record.
 */
export function getEventCanonicalKey(event) {
  if (!event || typeof event !== 'object') {
    return 'unknown:empty';
  }
  const explicitSender = typeof event.sender === 'string' && event.sender.trim() ? event.sender.trim() : null;
  const sourceNameFallback = !explicitSender && typeof event.source?.name === 'string' && event.source.name.trim()
    ? event.source.name.trim()
    : (!explicitSender && typeof event.source === 'string' && event.source.trim() ? event.source.trim() : null);
  const senderOrSource = explicitSender || sourceNameFallback || null;

  // 1. CAP Chain Key
  if (typeof event.chainKey === 'string' && event.chainKey.trim()) {
    const rawChain = event.chainKey.trim();
    if (senderOrSource) {
      const fullChain = rawChain.startsWith(`${senderOrSource}:`) ? rawChain : `${senderOrSource}:${rawChain}`;
      return `cap-chain:${fullChain}`;
    }
    const idVal = event.id || event.providerId || '';
    const hash = createHash('sha256').update(`${idVal}|${rawChain}`).digest('hex').slice(0, 16);
    return `cap-chain:anon:${hash}:${rawChain}`;
  }

  // 2. CAP message with identifier
  if (typeof event.identifier === 'string' && event.identifier.trim()) {
    if (senderOrSource) {
      return `cap-msg:${senderOrSource}:${event.identifier.trim()}`;
    }
    const idVal = event.id || event.providerId || '';
    const title = typeof event.title === 'string' ? event.title.trim().slice(0, 100) : '';
    const hash = createHash('sha256').update(`${idVal}|${event.identifier.trim()}|${title}`).digest('hex').slice(0, 16);
    return `cap-msg:anon:${hash}:${event.identifier.trim()}`;
  }

  // 3. Official Crucix event ID
  if (typeof event.id === 'string' && event.id.trim()) {
    return `event-id:${event.id.trim()}`;
  }

  // 4. Provider ID
  if (typeof event.providerId === 'string' && event.providerId.trim()) {
    if (senderOrSource) {
      return `provider:${senderOrSource}:${event.providerId.trim()}`;
    }
    const hash = createHash('sha256').update(event.providerId.trim()).digest('hex').slice(0, 16);
    return `provider:anon:${hash}`;
  }

  // 5. Deterministic fallback for ID-less items
  const title = typeof event.title === 'string' ? event.title.trim().slice(0, 100) : '';
  const time = event.publishedAt || event.observedAt || event.time || '';
  const link = typeof event.link === 'string' ? event.link : '';
  if (senderOrSource) {
    return `raw:${senderOrSource}:${title}:${time}:${link}`;
  }
  const rawKey = `${title}|${time}|${link}`;
  const hash = createHash('sha256').update(rawKey).digest('hex').slice(0, 16);
  return `raw:anon:${hash}`;
}

/**
 * Resolves the territorial relationship of a settlement or territory record.
 */
function resolveRelationship(settlementCode, territory, config) {
  if (!config) return RELATIONSHIPS.UNKNOWN;

  // 1. Primary settlement (Bihartorda)
  if (
    (settlementCode && config.primary?.kshSettlement === settlementCode) ||
    (territory?.settlementId && config.primary?.id === territory.settlementId) ||
    (territory?.territoryName && config.primary?.name === territory.territoryName)
  ) {
    return RELATIONSHIPS.PRIMARY;
  }

  // 2. Watched settlements (e.g. Bakonszeg, Nagyrábé)
  if (Array.isArray(config.watchedSettlements)) {
    if (settlementCode && config.watchedSettlements.some(s => s.kshSettlement === settlementCode)) {
      return RELATIONSHIPS.WATCHED;
    }
    if (territory?.settlementId && config.watchedSettlements.some(s => s.id === territory.settlementId)) {
      return RELATIONSHIPS.WATCHED;
    }
    if (territory?.territoryName && config.watchedSettlements.some(s => s.name === territory.territoryName)) {
      return RELATIONSHIPS.WATCHED;
    }
  }

  // 3. Key cities / connections (Debrecen, Hajdúszoboszló, Püspökladány; Berettyóújfalu if in config)
  const keyCities = config.keyCities || config.keyConnections || [];
  if (Array.isArray(keyCities)) {
    if (settlementCode && keyCities.some(k => k.kshSettlement === settlementCode)) {
      return RELATIONSHIPS.KEY_CONNECTION;
    }
    if (territory?.settlementId && keyCities.some(k => k.id === territory.settlementId)) {
      return RELATIONSHIPS.KEY_CONNECTION;
    }
    if (territory?.territoryName && keyCities.some(k => k.name === territory.territoryName)) {
      return RELATIONSHIPS.KEY_CONNECTION;
    }
  }

  // 4. Full district inclusion
  if (config.includeFullDistrict && Array.isArray(config.districtSettlements)) {
    if (settlementCode && config.districtSettlements.some(d => d.kshSettlement === settlementCode)) {
      return RELATIONSHIPS.WATCHED;
    }
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

  // 7. National (domestic Hungary)
  if (isDomesticCountry(null, territory)) {
    return RELATIONSHIPS.NATIONAL;
  }

  return RELATIONSHIPS.GLOBAL;
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
  const hasExplicitTerritory = Boolean(event.territory) || Boolean(event.matchState) || Boolean(event.territoryLevel);
  const territoryLevel = territory.territoryLevel || (hasExplicitTerritory ? 'indeterminate' : null);
  const matchState = territory.matchState || (territory.status === 'indeterminate' ? 'unknown' : null);
  const localRelevanceReason = territory.localRelevanceReason || null;
  const isConfirmedLocal = Boolean(territory.isConfirmedLocal);
  const countyCode = territory.countyCode || territory.county?.id || null;
  const nuts3 = territory.nuts3 || territory.nuts?.nuts3 || null;
  const nuts2 = territory.nuts2 || territory.nuts?.nuts2 || null;
  const nuts0 = territory.nuts0 || territory.nuts?.nuts0 || null;
  const kshSettlement = territory.kshSettlementCode || territory.kshSettlement || null;
  const isDomestic = isDomesticCountry(event, territory);

  // 0. Territory-less global / foreign sensor event (e.g. earthquake, solar flare, unscoped feed)
  if (!hasExplicitTerritory && !isDomestic) {
    result[VIEWS.LOCAL] = { inView: false, category: null, relationship: RELATIONSHIPS.GLOBAL, reason: 'unscoped_global_event' };
    result[VIEWS.COUNTY] = { inView: false, category: null, relationship: RELATIONSHIPS.GLOBAL, reason: 'unscoped_global_event' };
    result[VIEWS.NATIONAL] = { inView: false, category: null, relationship: RELATIONSHIPS.GLOBAL, reason: 'unscoped_global_event' };
    result[VIEWS.GLOBAL] = { inView: true, category: VIEW_CATEGORIES.GLOBAL_EVENT, relationship: RELATIONSHIPS.GLOBAL, reason: 'global_scope' };
    return result;
  }

  // 1. Explicitly Unknown / Indeterminate territorial match
  if (matchState === 'unknown' || territoryLevel === 'indeterminate') {
    if (isDomestic) {
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
    } else {
      result[VIEWS.LOCAL] = { inView: false, category: null, relationship: RELATIONSHIPS.GLOBAL, reason: 'foreign_unresolved' };
      result[VIEWS.COUNTY] = { inView: false, category: null, relationship: RELATIONSHIPS.GLOBAL, reason: 'foreign_unresolved' };
      result[VIEWS.NATIONAL] = { inView: false, category: null, relationship: RELATIONSHIPS.GLOBAL, reason: 'foreign_unresolved' };
      result[VIEWS.GLOBAL] = { inView: true, category: VIEW_CATEGORIES.GLOBAL_EVENT, relationship: RELATIONSHIPS.GLOBAL, reason: 'foreign_unresolved' };
    }
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
    const isHajduBiharSettlement = countyCode === '09' || nuts3 === 'HU321' ||
      relationship === RELATIONSHIPS.PRIMARY || relationship === RELATIONSHIPS.WATCHED || relationship === RELATIONSHIPS.KEY_CONNECTION;
    if (isHajduBiharSettlement) {
      result[VIEWS.COUNTY] = {
        inView: true,
        category: isTextMention ? VIEW_CATEGORIES.NEEDS_REVIEW : VIEW_CATEGORIES.COUNTY_EVENT, // NEVER confirmedLocal!
        relationship,
        reason: 'county_settlement'
      };
    }

    // --- C. National View ---
    const isDomesticSettlement = isDomestic ||
      relationship === RELATIONSHIPS.PRIMARY || relationship === RELATIONSHIPS.WATCHED || relationship === RELATIONSHIPS.KEY_CONNECTION;
    if (isDomesticSettlement) {
      result[VIEWS.NATIONAL] = {
        inView: true,
        category: isTextMention ? VIEW_CATEGORIES.NEEDS_REVIEW : VIEW_CATEGORIES.NATIONAL_EVENT, // NEVER confirmedLocal!
        relationship,
        reason: 'national_settlement'
      };
    }

    // --- D. Global View ---
    const isLocalWatchedTextMention = isTextMention &&
      (relationship === RELATIONSHIPS.PRIMARY || relationship === RELATIONSHIPS.WATCHED || relationship === RELATIONSHIPS.KEY_CONNECTION);

    result[VIEWS.GLOBAL] = {
      inView: true,
      category: isLocalWatchedTextMention ? VIEW_CATEGORIES.NEEDS_REVIEW : VIEW_CATEGORIES.GLOBAL_EVENT,
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
    // County-level Hajdú-Bihar warning (HU321) is a direct county event/warning (countyEvent), NOT regional!
    // NUTS2 Észak-Alföld (HU32) regional warning encloses Hajdú-Bihar, so it is regionalAdvisories!
    if (isHajduBihar) {
      result[VIEWS.COUNTY] = {
        inView: true,
        category: VIEW_CATEGORIES.COUNTY_EVENT, // HU321 megyei riasztás: countyEvent, NEM régiós tájékoztatás!
        relationship: RELATIONSHIPS.COUNTY,
        reason: 'county_warning'
      };
    } else if (isEszakAlfold) {
      result[VIEWS.COUNTY] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES, // HU32 nagyrégió: regionalAdvisories
        relationship: RELATIONSHIPS.REGION,
        reason: 'enclosing_nuts2_regional_advisory'
      };
    }

    // National View: only domestic Hungarian records
    if (isDomestic) {
      result[VIEWS.NATIONAL] = {
        inView: true,
        category: VIEW_CATEGORIES.REGIONAL_ADVISORIES,
        relationship: rel,
        reason: 'domestic_regional_warning'
      };
    }

    // Global View: regionalAdvisories is NOT used in global view; classified as globalEvent!
    result[VIEWS.GLOBAL] = {
      inView: true,
      category: VIEW_CATEGORIES.GLOBAL_EVENT,
      relationship: rel,
      reason: 'regional_warning'
    };

    return result;
  }

  // 4. National Level Match
  if (territoryLevel === ADMINISTRATIVE_LEVELS.COUNTRY || territoryLevel === 'country' || isDomestic) {
    if (isDomestic) {
      result[VIEWS.NATIONAL] = {
        inView: true,
        category: VIEW_CATEGORIES.NATIONAL_EVENT,
        relationship: RELATIONSHIPS.NATIONAL,
        reason: 'national_level'
      };
    }
    result[VIEWS.GLOBAL] = {
      inView: true,
      category: VIEW_CATEGORIES.GLOBAL_EVENT,
      relationship: isDomestic ? RELATIONSHIPS.NATIONAL : RELATIONSHIPS.GLOBAL,
      reason: 'country_level'
    };
    return result;
  }

  // 5. Default Fallback
  result[VIEWS.GLOBAL] = {
    inView: true,
    category: VIEW_CATEGORIES.GLOBAL_EVENT,
    relationship: isDomestic ? RELATIONSHIPS.NATIONAL : RELATIONSHIPS.GLOBAL,
    reason: 'global_scope'
  };

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
 * - Unique incident counting across CAP chains (incorporating sender with 'no-sender' fallback)
 * - Chain resolution: latest message by CAP 'sent' timestamp determines category and state;
 *   cancelled chains increment cancelledChains and do NOT count as active unique incidents.
 *   Arrival order is strictly a tie-breaker when sent timestamps are identical.
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
      regionalAdvisories: 0,  // Enclosing county/region advisories (local/county/national only)
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
  // Maps: key -> array of events in arrival sequence with original index
  const chainsByKey = new Map();
  for (let idx = 0; idx < eventList.length; idx++) {
    const event = eventList[idx];
    if (!event || typeof event !== 'object') continue;
    const key = getEventCanonicalKey(event);
    if (!chainsByKey.has(key)) {
      chainsByKey.set(key, []);
    }
    chainsByKey.get(key).push({ event, arrivalIndex: idx });
  }

  // 2. Process each chain
  for (const [key, chainItems] of chainsByKey.entries()) {
    // Sort chain events by CAP sent timestamp; arrival index is strictly a tie-breaker
    const sortedItems = [...chainItems].sort((a, b) => {
      const timeA = Date.parse(a.event.sent || a.event.publishedAt || a.event.observedAt || '') || 0;
      const timeB = Date.parse(b.event.sent || b.event.publishedAt || b.event.observedAt || '') || 0;
      return (timeA - timeB) || (a.arrivalIndex - b.arrivalIndex);
    });

    const latestEvent = sortedItems[sortedItems.length - 1].event;
    const isCancelled = isCancelMessage(latestEvent);

    // Evaluate each raw event for raw counting and item storage
    for (const item of chainItems) {
      const evaluation = evaluateEventTerritoryViews(item.event, config);
      for (const view of Object.values(VIEWS)) {
        const match = evaluation[view];
        if (!match || !match.inView) continue;
        partitions[view].totalEvents += 1;
        const category = match.category || VIEW_CATEGORIES.GLOBAL_EVENT;
        if (partitions[view].items[category]) {
          partitions[view].items[category].push(item.event);
        }
      }
    }

    // Evaluate latest event according to sent time for unique incident counts
    const latestEval = evaluateEventTerritoryViews(latestEvent, config);

    for (const view of Object.values(VIEWS)) {
      const match = latestEval[view];
      if (!match || !match.inView) continue;

      if (isCancelled) {
        // Visszavont lánc: a raw totalEvents-ben szerepel, de az aktív incidenseket nem növeli!
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
 * 2. NINCS_FORRAS (unconfigured / missing source)
 * 3. ELAVULT_HIBAS (error or stale)
 * 4. OFFLINE_PILLANATKEP (healthy source in offline snapshot mode)
 * 5. SIKERES_ADAT (active items)
 * 6. SIKERES_URES (empty / 0 items - avoiding "nyugodt" wording)
 *
 * Data origin (origin: 'snapshot' | 'live') is tracked as a separate field,
 * guaranteeing that snapshot mode NEVER overwrites disabled, missing, or error states.
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
  const globalOrigin = isOfflineSnapshot ? 'snapshot' : 'live';

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
    const isUnconfigured = Boolean(src.unconfigured || src.missing || src.status === COVERAGE_STATES.UNCONFIGURED || src.status === 'unconfigured' || src.status === 'nincs_forrás');
    const origin = isOfflineSnapshot ? 'snapshot' : (src.origin || globalOrigin);
    const isSnapshot = origin === 'snapshot';
    const items = obsBySource.get(id) || obsBySource.get(name) || [];
    let observationCount = 0;
    for (const item of items) {
      if (Array.isArray(item?.observations)) {
        observationCount += item.observations.length;
      } else {
        observationCount += 1;
      }
    }

    const policy = POLICIES?.[id] || POLICIES?.[name];
    const sourceStaleThresholdMs = options.staleThresholdMs ? Number(options.staleThresholdMs) : (Number(policy?.maxAgeMs) || staleThresholdMs);
    const staleThresholdMinutes = Math.round(sourceStaleThresholdMs / 60000);

    // Precedence 1: Explicitly disabled source
    if (!enabled) {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        origin,
        isSnapshot,
        status: COVERAGE_STATES.DISABLED,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.DISABLED],
        itemCount: 0,
        lastUpdated: null,
        timeWindow: { label: 'disabled', durationMs: 0 },
        sourceType: 'disabled',
        error: null
      };
    }

    // Precedence 2: Unconfigured / missing source (snapshot mode does NOT overwrite this!)
    if (isUnconfigured) {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        origin,
        isSnapshot,
        status: COVERAGE_STATES.UNCONFIGURED,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.UNCONFIGURED],
        itemCount: 0,
        lastUpdated: null,
        timeWindow: { label: 'unconfigured', durationMs: 0 },
        sourceType: 'unconfigured',
        error: 'Nincs konfigurált valós adatforrás'
      };
    }

    // Precedence 3: Error or stale state (snapshot mode does NOT overwrite this!)
    const isStaleStatus = src.status === 'stale' || Boolean(src.stale);
    if (src.status === 'error' || src.error || isStaleStatus) {
      const isStale = isStaleStatus && !src.error && src.status !== 'error';
      return {
        sourceId: id,
        sourceName: name,
        domain,
        origin,
        isSnapshot,
        status: COVERAGE_STATES.STALE_ERROR,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.STALE_ERROR],
        itemCount: observationCount,
        lastUpdated: src.lastUpdated || null,
        timeWindow: { label: isStale ? 'stale' : 'error', durationMs: isStale && src.lastUpdated ? Math.max(0, now - Date.parse(src.lastUpdated)) : null },
        sourceType: origin,
        error: src.error || (isStale ? `Data is stale (older than ${staleThresholdMinutes} minutes)` : 'Source reported an error')
      };
    }

    const lastUpdateMs = src.lastUpdated ? Date.parse(src.lastUpdated) : null;
    if (Number.isFinite(lastUpdateMs) && (now - lastUpdateMs > sourceStaleThresholdMs)) {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        origin,
        isSnapshot,
        status: COVERAGE_STATES.STALE_ERROR,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.STALE_ERROR],
        itemCount: observationCount,
        lastUpdated: src.lastUpdated,
        timeWindow: { label: 'stale', durationMs: now - lastUpdateMs },
        sourceType: origin,
        error: `Data is stale (older than ${staleThresholdMinutes} minutes)`
      };
    }

    // Precedence 4: Healthy source in offline snapshot mode
    if (isSnapshot || isOfflineSnapshot || src.isSnapshot) {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        origin: 'snapshot',
        isSnapshot: true,
        status: COVERAGE_STATES.OFFLINE_SNAPSHOT,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.OFFLINE_SNAPSHOT],
        itemCount: observationCount,
        lastUpdated: src.lastUpdated || null,
        timeWindow: { label: 'snapshot', durationMs: null },
        sourceType: 'snapshot',
        error: null
      };
    }

    // Precedence 5: Successful with active items
    if (observationCount > 0) {
      return {
        sourceId: id,
        sourceName: name,
        domain,
        origin,
        isSnapshot,
        status: COVERAGE_STATES.OK_DATA,
        statusLabel: COVERAGE_LABELS[COVERAGE_STATES.OK_DATA],
        itemCount: observationCount,
        lastUpdated: src.lastUpdated || new Date(now).toISOString(),
        timeWindow: { label: 'active_window', durationMs: sourceStaleThresholdMs },
        sourceType: origin,
        error: null
      };
    }

    // Precedence 6: Successful with 0 items (no "nyugodt" wording)
    return {
      sourceId: id,
      sourceName: name,
      domain,
      origin,
      isSnapshot,
      status: COVERAGE_STATES.OK_EMPTY,
      statusLabel: COVERAGE_LABELS[COVERAGE_STATES.OK_EMPTY],
      itemCount: 0,
      lastUpdated: src.lastUpdated || new Date(now).toISOString(),
      timeWindow: { label: 'calm', durationMs: 0 },
      sourceType: origin,
      error: null
    };
  });
}
