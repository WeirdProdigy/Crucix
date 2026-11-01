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
import { POLICIES, FEED_POLICIES } from '../../apis/utils/freshness.mjs';

/**
 * Supported territorial views.
 */
export const VIEWS = Object.freeze({
  LOCAL: 'local',       // Helyi nézet (aktív profil: Bihartorda + figyelt települések + kiemelt városok)
  COUNTY: 'county',     // Hajdú-Bihar vármegye nézet (KSH 09 / NUTS3 HU321)
  NATIONAL: 'national', // Magyarország nézet (NUTS0 HU / HUN)
  GLOBAL: 'global'      // Világ nézet (minden esemény)
});

export const VIEW_NEWS_CAP = 50;
export const TOTAL_NEWS_CAP = 200;

/**
 * Explicit accessor function for view news.
 * Operates purely on plain serializable JSON properties (views.news and view.newsIds),
 * guaranteeing that spread ({ ...views }), structuredClone, and JSON serialize/deserialize
 * preserve complete data integrity without relying on fragile non-enumerable getters.
 *
 * @param {Object} container - Snapshot or views object
 * @param {string} viewName - Name of the view ('local' | 'county' | 'national' | 'global')
 * @returns {Array<Object>} News items belonging to the view
 */
export function getViewNews(container, viewName) {
  if (!container || !viewName) return [];
  const views = container.views || container;
  const newsList = views.news || container.news || [];
  if (viewName === 'all' || viewName === 'allNews') {
    return Array.isArray(newsList) ? newsList : [];
  }
  const partition = views[viewName];
  if (!partition?.newsIds || !Array.isArray(newsList)) return [];
  const idSet = new Set(partition.newsIds);
  return newsList.filter(item => idSet.has(item.id));
}

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

function buildSettlementStemRegex(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length < 3) return null;
  let stem;
  if (trimmed.endsWith('a') || trimmed.endsWith('á')) {
    stem = `${trimmed.slice(0, -1)}[aá]`;
  } else if (trimmed.endsWith('e') || trimmed.endsWith('é')) {
    stem = `${trimmed.slice(0, -1)}[eé]`;
  } else if (trimmed.endsWith('u') || trimmed.endsWith('ú')) {
    stem = `${trimmed.slice(0, -1)}[uú]`;
  } else if (trimmed.endsWith('o') || trimmed.endsWith('ó')) {
    stem = `${trimmed.slice(0, -1)}[oó]`;
  } else {
    stem = trimmed;
  }
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${stem}`, 'ui');
}

/**
 * Evaluates territorial view assignment for news observations.
 * News view routing rules:
 * - news_local + local settlement match (primary/watched/key connection) -> local (+ county)
 * - news_regional or Hajdú-Bihar context -> county
 * - news_national -> national
 * - news_global -> global
 * - news_hazard / news_energy / news_agriculture -> routed by territorial scope (local -> local+county+national; county -> county+national; national -> national; global -> global)
 * - other categories (news_economy, news_science, news_other) -> routed by territorial scope / origin
 */
export function evaluateNewsTerritoryViews(event, config = DEFAULT_TERRITORY_CONFIG) {
  const result = {
    [VIEWS.LOCAL]: { inView: false, category: null, relationship: RELATIONSHIPS.UNKNOWN, reason: null },
    [VIEWS.COUNTY]: { inView: false, category: null, relationship: RELATIONSHIPS.UNKNOWN, reason: null },
    [VIEWS.NATIONAL]: { inView: false, category: null, relationship: RELATIONSHIPS.UNKNOWN, reason: null },
    [VIEWS.GLOBAL]: { inView: false, category: null, relationship: RELATIONSHIPS.UNKNOWN, reason: null }
  };

  if (!event || typeof event !== 'object') {
    return result;
  }

  const category = event.newsCategory || event.facts?.newsCategory || (typeof event.kind === 'string' && event.kind.startsWith('news_') ? event.kind : null);
  const territory = event.territory || {};
  const facts = event.facts || {};
  const title = typeof event.title === 'string' ? event.title : '';
  const locLabel = typeof event.location?.label === 'string' ? event.location.label : '';

  // 1. Check for local settlement match (primary, watched, or key connection)
  const settlementName = territory.settlementName || facts.settlement || event.settlement || (locLabel && locLabel !== 'Global' && locLabel !== 'Hungary' ? locLabel : null);
  const settlementKsh = territory.kshSettlementCode || territory.kshSettlement || null;
  const settlementId = territory.settlementId || null;

  let localRelationship = RELATIONSHIPS.UNKNOWN;
  if (settlementKsh || settlementId || settlementName) {
    localRelationship = resolveRelationship(settlementKsh, { settlementId, territoryName: settlementName }, config);
  }

  if (localRelationship === RELATIONSHIPS.UNKNOWN && title) {
    const primaryName = config.primary?.name;
    const primaryRegex = buildSettlementStemRegex(primaryName);
    if (primaryRegex && primaryRegex.test(title)) {
      localRelationship = RELATIONSHIPS.PRIMARY;
    } else if (Array.isArray(config.watchedSettlements)) {
      for (const w of config.watchedSettlements) {
        const regex = buildSettlementStemRegex(w.name);
        if (regex && regex.test(title)) {
          localRelationship = RELATIONSHIPS.WATCHED;
          break;
        }
      }
    }
    if (localRelationship === RELATIONSHIPS.UNKNOWN) {
      const keyCities = config.keyCities || config.keyConnections || [];
      for (const k of keyCities) {
        const regex = buildSettlementStemRegex(k.name);
        if (regex && regex.test(title)) {
          localRelationship = RELATIONSHIPS.KEY_CONNECTION;
          break;
        }
      }
    }
  }

  // Source-level default territory for local portals (Dehir, Police-Hajdu, HAON)
  const isLocalPortal = event.source?.name === 'Police-Hajdu' ||
                        event.source?.name === 'RSS-Dehir' ||
                        event.source?.name === 'Dehir' ||
                        event.source?.name === 'HAON';

  // Check if article explicitly contradicts local portal territory (e.g. explicitly states another county/region)
  const otherCountyMatch = territory.countyCode && territory.countyCode !== '09' && territory.countyCode !== 'HU321' &&
                           territory.countyName && territory.countyName !== 'Hajdú-Bihar';
  const contradictsLocal = isLocalPortal && Boolean(otherCountyMatch);

  if (isLocalPortal && !contradictsLocal) {
    if (event.source?.name === 'RSS-Dehir' || event.source?.name === 'Dehir') {
      // Dehir default location is Debrecen (key connection in default config)
      if (localRelationship === RELATIONSHIPS.UNKNOWN) {
        localRelationship = RELATIONSHIPS.KEY_CONNECTION;
      }
    }
  }

  const hasLocalMatch = localRelationship === RELATIONSHIPS.PRIMARY ||
                        localRelationship === RELATIONSHIPS.WATCHED ||
                        localRelationship === RELATIONSHIPS.KEY_CONNECTION;

  // 2. Check for Hajdú-Bihar county context
  // Only genuine local/county settlement match, explicit Hajdú-Bihar mention, or local portal default grants county context.
  // Blanket countyCode: 09 from generic feeds without settlement match does NOT grant county context.
  const hasExplicitHajduMention = /Hajdú-Bihar/i.test(title) || (typeof event.sourceRegion === 'string' && /Hajdú-Bihar/i.test(event.sourceRegion));
  const hasGenuineHajduSettlement = Boolean(settlementName || settlementKsh || settlementId) &&
                                   (territory.countyCode === '09' || (typeof territory.countyName === 'string' && /Hajdú-Bihar/i.test(territory.countyName)));
  const hasCountyContext = (isLocalPortal && !contradictsLocal) ||
                          hasExplicitHajduMention ||
                          hasGenuineHajduSettlement ||
                          hasLocalMatch;

  // 3. Check for Hungarian national context
  const isDomestic = (Boolean(territory.territoryLevel) && (territory.territoryLevel === 'national' || territory.territoryLevel === 'country')) ||
                     /országos/i.test(title) ||
                     isDomesticCountry(event, territory) ||
                     locLabel === 'Hungary' ||
                     (typeof event.country === 'string' && /hungary|hu|hun/i.test(event.country)) ||
                     (typeof event.source?.name === 'string' && (event.source.name.startsWith('RSS-') || ['Google-News', 'Police-Hajdu', 'Telex', 'Index', 'HVG', 'Portfolio', 'Qubit', '444', '24hu', 'Agrárszektor', 'Katasztrófavédelem Hírek', 'Katasztrófavédelem Vész'].includes(event.source.name)));

  // Routing according to user specification:
  if (category === 'news_local') {
    if (hasLocalMatch) {
      const localCat = localRelationship === RELATIONSHIPS.KEY_CONNECTION ? VIEW_CATEGORIES.KEY_CONNECTION : VIEW_CATEGORIES.NEEDS_REVIEW;
      result[VIEWS.LOCAL] = { inView: true, category: localCat, relationship: localRelationship, reason: 'news_local_match' };
      result[VIEWS.COUNTY] = { inView: true, category: VIEW_CATEGORIES.COUNTY_EVENT, relationship: RELATIONSHIPS.COUNTY, reason: 'news_local_in_county' };
    } else if (hasCountyContext) {
      result[VIEWS.COUNTY] = { inView: true, category: VIEW_CATEGORIES.COUNTY_EVENT, relationship: RELATIONSHIPS.COUNTY, reason: 'news_local_county_context' };
    } else if (isDomestic) {
      result[VIEWS.NATIONAL] = { inView: true, category: VIEW_CATEGORIES.NATIONAL_EVENT, relationship: RELATIONSHIPS.NATIONAL, reason: 'news_local_national_context' };
    } else {
      result[VIEWS.GLOBAL] = { inView: true, category: VIEW_CATEGORIES.GLOBAL_EVENT, relationship: RELATIONSHIPS.GLOBAL, reason: 'news_local_unscoped' };
    }
    return result;
  }

  if (category === 'news_regional' || (!category && hasCountyContext && !hasLocalMatch)) {
    result[VIEWS.COUNTY] = { inView: true, category: VIEW_CATEGORIES.COUNTY_EVENT, relationship: RELATIONSHIPS.COUNTY, reason: 'news_regional_county' };
    return result;
  }

  if (category === 'news_national') {
    result[VIEWS.NATIONAL] = { inView: true, category: VIEW_CATEGORIES.NATIONAL_EVENT, relationship: RELATIONSHIPS.NATIONAL, reason: 'news_national_scope' };
    return result;
  }

  if (category === 'news_global') {
    result[VIEWS.GLOBAL] = { inView: true, category: VIEW_CATEGORIES.GLOBAL_EVENT, relationship: RELATIONSHIPS.GLOBAL, reason: 'news_global_scope' };
    return result;
  }

  if (['news_hazard', 'news_energy', 'news_agriculture'].includes(category)) {
    if (hasLocalMatch) {
      const localCat = localRelationship === RELATIONSHIPS.KEY_CONNECTION ? VIEW_CATEGORIES.KEY_CONNECTION : VIEW_CATEGORIES.NEEDS_REVIEW;
      result[VIEWS.LOCAL] = { inView: true, category: localCat, relationship: localRelationship, reason: `${category}_local` };
      result[VIEWS.COUNTY] = { inView: true, category: VIEW_CATEGORIES.COUNTY_EVENT, relationship: RELATIONSHIPS.COUNTY, reason: `${category}_county` };
      result[VIEWS.NATIONAL] = { inView: true, category: VIEW_CATEGORIES.NATIONAL_EVENT, relationship: RELATIONSHIPS.NATIONAL, reason: `${category}_national` };
    } else if (hasCountyContext) {
      result[VIEWS.COUNTY] = { inView: true, category: VIEW_CATEGORIES.COUNTY_EVENT, relationship: RELATIONSHIPS.COUNTY, reason: `${category}_county` };
      result[VIEWS.NATIONAL] = { inView: true, category: VIEW_CATEGORIES.NATIONAL_EVENT, relationship: RELATIONSHIPS.NATIONAL, reason: `${category}_national` };
    } else if (isDomestic) {
      result[VIEWS.NATIONAL] = { inView: true, category: VIEW_CATEGORIES.NATIONAL_EVENT, relationship: RELATIONSHIPS.NATIONAL, reason: `${category}_national` };
    } else {
      result[VIEWS.GLOBAL] = { inView: true, category: VIEW_CATEGORIES.GLOBAL_EVENT, relationship: RELATIONSHIPS.GLOBAL, reason: `${category}_global` };
    }
    return result;
  }

  // Fallback for other categories (news_economy, news_science, news_other, or unclassified news)
  if (hasLocalMatch) {
    const localCat = localRelationship === RELATIONSHIPS.KEY_CONNECTION ? VIEW_CATEGORIES.KEY_CONNECTION : VIEW_CATEGORIES.NEEDS_REVIEW;
    result[VIEWS.LOCAL] = { inView: true, category: localCat, relationship: localRelationship, reason: 'news_local_mention' };
    result[VIEWS.COUNTY] = { inView: true, category: VIEW_CATEGORIES.COUNTY_EVENT, relationship: RELATIONSHIPS.COUNTY, reason: 'news_county_enclosing' };
  } else if (hasCountyContext) {
    result[VIEWS.COUNTY] = { inView: true, category: VIEW_CATEGORIES.COUNTY_EVENT, relationship: RELATIONSHIPS.COUNTY, reason: 'news_county_context' };
  } else if (isDomestic) {
    result[VIEWS.NATIONAL] = { inView: true, category: VIEW_CATEGORIES.NATIONAL_EVENT, relationship: RELATIONSHIPS.NATIONAL, reason: 'news_domestic_default' };
  } else {
    result[VIEWS.GLOBAL] = { inView: true, category: VIEW_CATEGORIES.GLOBAL_EVENT, relationship: RELATIONSHIPS.GLOBAL, reason: 'news_global_default' };
  }

  return result;
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

  if (isNewsEvent(event)) {
    return evaluateNewsTerritoryViews(event, config);
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
 * Assigns priority rank to news events.
 * news_hazard (0), news_local or settlement-grounded (1), news_regional or county-grounded (2)
 * precede general/national/global news (10).
 */
export function getNewsPriority(event) {
  const cat = event?.newsCategory || event?.facts?.newsCategory || event?.kind;
  if (cat === 'news_hazard') return 0;
  if (cat === 'news_local' || (event?.territory?.settlementName && event?.territory?.settlementName !== 'Global' && event?.territory?.settlementName !== 'Hungary') || event?.facts?.settlement) return 1;
  const isLocalPortal = event?.source?.name === 'Police-Hajdu' || event?.source === 'Police-Hajdu' ||
                        event?.source?.name === 'RSS-Dehir' || event?.source === 'RSS-Dehir' ||
                        event?.source?.name === 'Dehir' || event?.source === 'HAON';
  const hasExplicitHajdu = /Hajdú-Bihar/i.test(event?.title || '') || (typeof event?.sourceRegion === 'string' && /Hajdú-Bihar/i.test(event.sourceRegion));
  if (cat === 'news_regional' || isLocalPortal || hasExplicitHajdu) return 2;
  return 10;
}

/**
 * Interleaves candidates in round-robin fashion across distinct sources within each priority tier.
 * Guarantees no single high-volume source starves lower-volume sources of the same priority.
 */
function interleaveCandidatesBySource(candidates) {
  const prioGroups = new Map();
  for (const item of candidates) {
    const prio = getNewsPriority(item);
    if (!prioGroups.has(prio)) prioGroups.set(prio, []);
    prioGroups.get(prio).push(item);
  }
  const sortedPrios = Array.from(prioGroups.keys()).sort((a, b) => a - b);
  const result = [];
  for (const prio of sortedPrios) {
    const items = prioGroups.get(prio);
    const sourceBuckets = new Map();
    for (const it of items) {
      const src = it.source?.name || it.source || 'Unknown';
      if (!sourceBuckets.has(src)) sourceBuckets.set(src, []);
      sourceBuckets.get(src).push(it);
    }
    for (const [src, bucket] of sourceBuckets.entries()) {
      bucket.sort((a, b) => {
        const tA = Date.parse(a.publishedAt || a.observedAt || '') || 0;
        const tB = Date.parse(b.publishedAt || b.observedAt || '') || 0;
        return tB - tA;
      });
    }
    const sourceKeys = Array.from(sourceBuckets.keys());
    let added = true;
    let round = 0;
    while (added) {
      added = false;
      for (const k of sourceKeys) {
        const bucket = sourceBuckets.get(k);
        if (round < bucket.length) {
          result.push(bucket[round]);
          added = true;
        }
      }
      round++;
    }
  }
  return result;
}

/**
 * Determines whether an event record is an informational news observation.
 * News items (kind: 'news' or news_*) are isolated from physical disaster/hazard incident counters
 * and do not participate in CAP chain convergence or cancellation logic.
 */
export function isNewsEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.kind === 'news' || (typeof event.kind === 'string' && event.kind.startsWith('news_'))) {
    return true;
  }
  if (typeof event.newsCategory === 'string' && (event.newsCategory === 'news' || event.newsCategory.startsWith('news_'))) {
    return true;
  }
  return false;
}

const NON_CRITICAL_NEWS_TEXT_PATTERN = /\b(sport|sportol[óo]|foci|futball|labdar[úu]g[áa]s|bajnoks[áa]g|m[ée]rk[őo]z[ée]s|meccs|dvsc|loki|fradi|ferencv[áa]ros|újpest|nb\s*i\b|kézilabda|kosárlabda|vízilabda|úszás|atlétika|olimpia|világbajnokság|európa-bajnokság|world cup|soccer|football|fifa|uefa|champions league|premier league|caf cup|tennis|grand slam|formula[\s-]*1|forma[\s-]*1|eurovision|eurovízió|fesztivál|koncert|kultúra|kulturális|színház|kiállítás|múzeum|mozi|filmajánló|horoszkóp|bulvár|sztárvilág|recept|gasztro|divat|szépségápolás)\b/i;
const NON_CRITICAL_NEWS_URL_PATTERN = /\/(sport|foci|labdarugas|dvsc|kultura|kult|szorakozas|eletmod|bulvar| sztarvilag|gasztro|horoszkop|divat|mozi|zene)\//i;
const HAZARD_OVERRIDE_TEXT_PATTERN = /\b(baleset|tűz|tűzeset|robbanás|áradás|árvíz|vihar|földrengés|riasztás|katasztrófa|rendőrség|mentők|halálos|sérült|evakuálás|veszély|merénylet|támadás)\b/i;

/**
 * Determines whether a news item is sport, culture, entertainment, or lifestyle
 * and therefore excluded from the "Fontos" (Important) tab and map news markers.
 */
export function isNonCriticalNews(item) {
  if (!item || typeof item !== 'object') return false;
  const cat = String(item.newsCategory || item.facts?.newsCategory || item.topic || '').toLowerCase();
  if (cat === 'news_sport' || cat === 'sport' || cat === 'news_culture' || cat === 'culture' || cat === 'lifestyle') {
    return true;
  }
  const title = String(item.title || item.headline || '');
  const summary = String(item.summary || '');
  const url = String(item.link || item.url || item.source?.url || '');
  if (HAZARD_OVERRIDE_TEXT_PATTERN.test(title)) {
    return false;
  }
  if (NON_CRITICAL_NEWS_URL_PATTERN.test(url)) {
    return true;
  }
  if (NON_CRITICAL_NEWS_TEXT_PATTERN.test(`${title} ${summary}`)) {
    return true;
  }
  return false;
}

/**
 * Determines whether a news item qualifies for the "Fontos" (Important) tab
 * and default map news markers:
 * - Hazard-themed news (news_hazard, Katasztrófavédelem, urgent)
 * - Local / county news (local/county view, news_local, news_regional)
 * - Police news (Police-Hajdu / police.hu)
 * Excludes sport, culture, lifestyle, and publisher promos.
 */
export function isImportantNews(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.isPublisherPromo || item.facts?.isPublisherPromo) return false;
  if (isNonCriticalNews(item)) return false;

  const cat = String(item.newsCategory || item.facts?.newsCategory || item.kind || '').toLowerCase();
  const srcName = String(item.source?.name || item.source || '').toLowerCase();
  const url = String(item.link || item.url || item.source?.url || '').toLowerCase();

  if (cat === 'news_hazard' || item.urgent === true) return true;
  if (srcName.includes('police') || srcName.includes('rendőrség') || url.includes('police.hu')) return true;
  if (srcName.includes('katasztrofavedelem') || srcName.includes('katasztrófavédelem') || srcName.includes('katved')) return true;
  if (cat === 'news_local' || cat === 'news_regional') return true;
  if (item.views?.local?.inView || item.views?.county?.inView) return true;

  const region = String(item.region || item.sourceRegion || item.territory?.countyName || item.territory?.settlementName || '').toLowerCase();
  if (region.includes('hajdú') || region.includes('hajdu') || region.includes('debrecen') || region.includes('bihartorda')) {
    return true;
  }

  const title = String(item.title || item.headline || '');
  if (HAZARD_OVERRIDE_TEXT_PATTERN.test(title)) return true;

  return false;
}

export function normalizeNewsTitle(rawTitle, item) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  let title = rawTitle.toLowerCase();

  // 1. Strip explicit publisher suffix if known (e.g. " - HAON", " - Dehir")
  const explicitPub = (item?.facts?.sourcePublisher || item?.source?.publisher || '');
  if (explicitPub && explicitPub.length >= 2) {
    const escaped = explicitPub.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp(`\\s*[-–—|]\\s*${escaped}.*$`, 'i'), '');
  }

  // 2. Strip common news outlet suffixes
  title = title.replace(/\s*[-–—|]\s*(dehir(?:\.hu)?|haon(?:\.hu)?|index(?:\.hu)?|telex(?:\.hu)?|hvg(?:\.hu)?|24\.hu|portfolio(?:\.hu)?|civishír|világgazdaság|vg\.hu|police\.hu|qubit(?:\.hu)?|infostart|mti|euronews|magyar nemzet|népszava|blikk|femcafe|metropol|origo(?:\.hu)?).*$/i, '');

  // 3. Strip punctuation ("írásjelek nélkül")
  title = title.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()'"„”»«?–—|]/g, ' ');

  // 4. Collapse whitespace
  title = title.replace(/\s+/g, ' ').trim();
  return title;
}

export function arePublishTimesWithin15Min(itemA, itemB) {
  const timeA = Date.parse(itemA.publishedAt || itemA.observedAt || '');
  const timeB = Date.parse(itemB.publishedAt || itemB.observedAt || '');
  if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) return false;
  return Math.abs(timeA - timeB) <= 15 * 60 * 1000;
}

export function isDirectPublisherUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return !url.includes('news.google.com') && !url.includes('/rss/articles/');
}

export function deduplicateNewsEvents(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < items.length; i++) {
    if (assigned.has(i)) continue;
    const current = items[i];
    const normCurrent = normalizeNewsTitle(current.title, current);
    const cluster = [current];
    assigned.add(i);

    for (let j = i + 1; j < items.length; j++) {
      if (assigned.has(j)) continue;
      const candidate = items[j];
      const normCand = normalizeNewsTitle(candidate.title, candidate);

      if (normCurrent && normCurrent === normCand && arePublishTimesWithin15Min(current, candidate)) {
        cluster.push(candidate);
        assigned.add(j);
      }
    }
    clusters.push(cluster);
  }

  return clusters.map(cluster => {
    if (cluster.length === 1) return cluster[0];

    // Direct publisher link takes precedence over Google redirect
    let primary = cluster[0];
    for (const item of cluster) {
      const itemUrl = item.source?.url || item.url || item.link || '';
      const primaryUrl = primary.source?.url || primary.url || primary.link || '';
      if (isDirectPublisherUrl(itemUrl) && !isDirectPublisherUrl(primaryUrl)) {
        primary = item;
      }
    }

    const otherItems = cluster.filter(item => item !== primary);
    const primarySource = primary.source?.name || 'News';
    const relatedSourceNames = [
      ...new Set(otherItems.map(item => item.source?.name).filter(name => name && name !== primarySource))
    ];

    return {
      ...primary,
      relatedSources: relatedSourceNames.length > 0 ? relatedSourceNames : undefined,
      mergedItemIds: otherItems.map(item => item.id)
    };
  });
}

/**
 * Partitions a list of events into the four territorial views,
 * enforcing:
 * - News isolation: news items (kind: 'news' / news_*) DO NOT increment totalEvents, uniqueEvents,
 *   cancelledChains, or breakdown.*. They populate dedicated view.news and view.newsCount collections.
 * - Unique incident counting across CAP chains (incorporating sender with 'no-sender' fallback)
 * - Chain resolution: latest message by CAP 'sent' timestamp determines category and state;
 *   cancelled chains increment cancelledChains and do NOT count as active unique incidents.
 *   Arrival order is strictly a tie-breaker when sent timestamps are identical.
 * - Breakdown separation: confirmedLocal, keyConnection, needsReview, regionalAdvisories, unknownTerritory
 * - Relationship tracking: primary, watched, key_connection, county, region, national, global, unknown
 */
export function partitionEventsByView(events = [], config = DEFAULT_TERRITORY_CONFIG, options = {}) {
  const eventList = Array.isArray(events) ? events : [];
  const totalNewsCap = Number(options?.totalNewsCap) || TOTAL_NEWS_CAP;
  const viewNewsCap = Number(options?.viewNewsCap) || VIEW_NEWS_CAP;

  const createViewPartition = view => ({
    view,
    totalEvents: 0,
    uniqueEvents: 0,
    cancelledChains: 0,
    newsCount: 0,         // Total eligible news items matching this view partition
    retainedNewsCount: 0, // Capped retained news items in this view (newsIds.length, <= viewNewsCap)
    newsIds: [],
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
    [VIEWS.GLOBAL]: createViewPartition(VIEWS.GLOBAL),
    all: {
      view: 'all',
      newsCount: 0,
      retainedNewsCount: 0,
      newsIds: []
    },
    news: []
  };

  // 1. Group events by canonical key to resolve multi-message chains (e.g. Alert -> Update -> Cancel)
  // Maps: key -> array of events in arrival sequence with original index
  const newsItems = [];
  const chainsByKey = new Map();
  for (let idx = 0; idx < eventList.length; idx++) {
    const event = eventList[idx];
    if (!event || typeof event !== 'object') continue;

    if (isNewsEvent(event)) {
      if (event.isPublisherPromo === true) {
        continue;
      }
      newsItems.push({ event, arrivalIndex: idx });
      continue; // Bypass chainsByKey, convergence, and physical incident counting
    }

    const key = getEventCanonicalKey(event);
    if (!chainsByKey.has(key)) {
      chainsByKey.set(key, []);
    }
    chainsByKey.get(key).push({ event, arrivalIndex: idx });
  }

  // 1. Evaluate matching views and collect candidate queues per view
  const viewCandidates = {
    [VIEWS.LOCAL]: [],
    [VIEWS.COUNTY]: [],
    [VIEWS.NATIONAL]: [],
    [VIEWS.GLOBAL]: []
  };

  // Server-side duplicate merging BEFORE view admission and capping
  const dedupedNewsEvents = deduplicateNewsEvents(newsItems.map(item => item.event));

  const seenNewsIds = new Set();
  for (const event of dedupedNewsEvents) {
    if (seenNewsIds.has(event.id)) continue;
    seenNewsIds.add(event.id);

    const evaluation = evaluateEventTerritoryViews(event, config);
    for (const view of Object.values(VIEWS)) {
      const match = evaluation[view];
      if (match && match.inView) {
        partitions[view].newsCount += 1;
        viewCandidates[view].push(event);
      }
    }
  }

  // Interleave each view's candidate pool by source within priority groups for fair representation
  for (const view of Object.values(VIEWS)) {
    viewCandidates[view] = interleaveCandidatesBySource(viewCandidates[view]);
  }

  // 2. Fair-share 2-phase admission across views:
  // Phase 1: Local and County views get their allocation first!
  // Phase 2: National and Global views share the remaining capacity up to totalNewsCap.
  const retainedSet = new Set();
  const viewPointers = {
    [VIEWS.LOCAL]: 0,
    [VIEWS.COUNTY]: 0,
    [VIEWS.NATIONAL]: 0,
    [VIEWS.GLOBAL]: 0
  };

  function admit(v, c) {
    if (partitions[v].newsIds.length >= viewNewsCap) return false;
    if (partitions[v].newsIds.includes(c.id)) return false;
    if (retainedSet.has(c.id)) {
      partitions[v].newsIds.push(c.id);
      return true;
    }
    if (partitions.news.length < totalNewsCap) {
      partitions.news.push(c);
      retainedSet.add(c.id);
      partitions[v].newsIds.push(c.id);
      return true;
    }
    return false;
  }

  // Phase 1: Local & County
  const regionalViews = [VIEWS.LOCAL, VIEWS.COUNTY];
  let progress = true;
  while (progress && regionalViews.some(v => partitions[v].newsIds.length < viewNewsCap)) {
    progress = false;
    for (const v of regionalViews) {
      while (viewPointers[v] < viewCandidates[v].length) {
        if (admit(v, viewCandidates[v][viewPointers[v]++])) {
          progress = true;
          break;
        }
      }
    }
  }

  // Phase 2: National & Global
  const macroViews = [VIEWS.NATIONAL, VIEWS.GLOBAL];
  progress = true;
  while (progress && (partitions.news.length < totalNewsCap || macroViews.some(v => partitions[v].newsIds.length < viewNewsCap))) {
    progress = false;
    for (const v of macroViews) {
      while (viewPointers[v] < viewCandidates[v].length) {
        if (admit(v, viewCandidates[v][viewPointers[v]++])) {
          progress = true;
          break;
        }
      }
    }
  }

  // Final pass: admit already retained candidates to other views where they match
  for (const v of Object.values(VIEWS)) {
    while (viewPointers[v] < viewCandidates[v].length && partitions[v].newsIds.length < viewNewsCap) {
      const c = viewCandidates[v][viewPointers[v]++];
      if (!partitions[v].newsIds.includes(c.id) && retainedSet.has(c.id)) {
        partitions[v].newsIds.push(c.id);
      }
    }
    partitions[v].retainedNewsCount = partitions[v].newsIds.length;
  }

  partitions.news.sort((a, b) => {
    const prioA = getNewsPriority(a);
    const prioB = getNewsPriority(b);
    if (prioA !== prioB) return prioA - prioB;
    const timeA = Date.parse(a.publishedAt || a.observedAt || '') || 0;
    const timeB = Date.parse(b.publishedAt || b.observedAt || '') || 0;
    return timeB - timeA;
  });
  partitions.all.newsCount = dedupedNewsEvents.length;
  partitions.all.rawNewsCount = newsItems.length;
  partitions.all.newsIds = partitions.news.map(n => n.id);
  partitions.all.retainedNewsCount = partitions.news.length;

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

    const policy = POLICIES?.[id] || POLICIES?.[name] || FEED_POLICIES?.[id] || FEED_POLICIES?.[name];
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
