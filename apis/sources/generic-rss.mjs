// Generic RSS Feed Adapter for Curated Hungarian News Sources
// Sources: Dehir, Telex, 444, 24.hu, Index, HVG, Portfolio, Qubit
//
// Operational and Legal Guardrails:
// 1. Opt-in only: Every source is DISABLED by default. When disabled, strictly 0 network calls.
// 2. Data minimization: Stored fields are limited to title, canonical link, UTC timestamp,
//    guid hash, source, section, newsCategory, and extracted facts.
//    The description, lead, author, images, and full text are strictly DISCARDED.
// 3. Response size ceiling: Enforces a 1 MB payload limit per feed request.
// 4. Commercial PR / Sponsored filtering: Automatically discards items with verified PR badges
//    or sponsored categories.
// 5. Categorization: News items receive dedicated news categories (news_local, news_regional,
//    news_hazard, news_agriculture, news_energy, news_science, news_global) and NEVER CAP hazard event categories.
// 6. Territorial grounding: isConfirmedLocal is ALWAYS false; settlement text mentions are flagged needsLocalReview.
// 7. Technical blocks: robots.txt, 403, 429, and WAF stop the adapter immediately with status: disabled.
//    Retry-After headers and backoff windows are strictly respected across consecutive cycles.
// 8. Deduplication and Conditional GET: Deduplicates by canonical URL; leverages ETag / Last-Modified (304).

import { createHash } from 'node:crypto';
import { safeFetch } from '../utils/fetch.mjs';
import { parseXml } from '../utils/xml.mjs';
import { providerTime, freshResult, unavailableResult, ALL_POLICIES, FEED_POLICIES } from '../utils/freshness.mjs';
import { detectSettlementMention } from '../utils/settlement-gazetteer.mjs';
import { DEFAULT_TERRITORY_CONFIG } from '../../lib/intelligence/territory.mjs';

export const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB ceiling
export const ROBOTS_CACHE_TTL_MS = 24 * 3600 * 1000; // 24 hours

export const NEWS_CATEGORIES = Object.freeze([
  'news_local',
  'news_regional',
  'news_national',
  'news_global',
  'news_hazard',
  'news_energy',
  'news_economy',
  'news_agriculture',
  'news_science',
  'news_other'
]);

export const RSS_SOURCES = Object.freeze({
  'RSS-Dehir': {
    id: 'dehir',
    name: 'RSS-Dehir',
    displayName: 'Dehir',
    url: 'https://www.dehir.hu/rss.php',
    robotsUrl: 'https://www.dehir.hu/robots.txt',
    envOptIn: 'CRUCIX_ENABLE_FEED_DEHIR',
    defaultDomain: 'security',
    defaultCategory: 'news_local',
    implicitCountyContext: true,
    supportsConditionalGet: false
  },
  'RSS-Telex': {
    id: 'telex',
    name: 'RSS-Telex',
    displayName: 'Telex',
    url: 'https://telex.hu/rss',
    robotsUrl: 'https://telex.hu/robots.txt',
    envOptIn: 'CRUCIX_ENABLE_FEED_TELEX',
    defaultDomain: 'security',
    defaultCategory: 'news_national',
    implicitCountyContext: false,
    supportsConditionalGet: true
  },
  'RSS-444': {
    id: '444',
    name: 'RSS-444',
    displayName: '444',
    url: 'https://444.hu/feed',
    robotsUrl: 'https://444.hu/robots.txt',
    envOptIn: 'CRUCIX_ENABLE_FEED_444',
    defaultDomain: 'security',
    defaultCategory: 'news_national',
    implicitCountyContext: false,
    supportsConditionalGet: true
  },
  'RSS-24hu': {
    id: '24hu',
    name: 'RSS-24hu',
    displayName: '24.hu',
    url: 'https://24.hu/feed/',
    robotsUrl: 'https://24.hu/robots.txt',
    envOptIn: 'CRUCIX_ENABLE_FEED_24HU',
    defaultDomain: 'security',
    defaultCategory: 'news_national',
    implicitCountyContext: false,
    supportsConditionalGet: true
  },
  'RSS-Index': {
    id: 'index',
    name: 'RSS-Index',
    displayName: 'Index',
    url: 'https://index.hu/24ora/rss/',
    robotsUrl: 'https://index.hu/robots.txt',
    envOptIn: 'CRUCIX_ENABLE_FEED_INDEX',
    defaultDomain: 'security',
    defaultCategory: 'news_national',
    implicitCountyContext: false,
    supportsConditionalGet: false // Cache-Control: no-store
  },
  'RSS-HVG': {
    id: 'hvg',
    name: 'RSS-HVG',
    displayName: 'HVG',
    url: 'https://hvg.hu/rss',
    robotsUrl: 'https://hvg.hu/robots.txt',
    envOptIn: 'CRUCIX_ENABLE_FEED_HVG',
    defaultDomain: 'security',
    defaultCategory: 'news_national',
    implicitCountyContext: false,
    supportsConditionalGet: true
  },
  'RSS-Portfolio': {
    id: 'portfolio',
    name: 'RSS-Portfolio',
    displayName: 'Portfolio',
    url: 'https://www.portfolio.hu/rss/all.xml',
    robotsUrl: 'https://www.portfolio.hu/robots.txt',
    envOptIn: 'CRUCIX_ENABLE_FEED_PORTFOLIO',
    defaultDomain: 'security',
    defaultCategory: 'news_economy',
    implicitCountyContext: false,
    supportsConditionalGet: false
  },
  'RSS-Qubit': {
    id: 'qubit',
    name: 'RSS-Qubit',
    displayName: 'Qubit',
    url: 'https://qubit.hu/feed',
    robotsUrl: 'https://qubit.hu/robots.txt',
    envOptIn: 'CRUCIX_ENABLE_FEED_QUBIT',
    defaultDomain: 'security',
    defaultCategory: 'news_science',
    implicitCountyContext: false,
    supportsConditionalGet: false
  }
});

// Internal state maps for caching, backoff, and robots.txt policies
const robotsCache = new Map(); // sourceId -> { allowed, rule, time }
const backoffMap = new Map();   // sourceId -> backoffUntilTimestampMs
const feedCache = new Map();    // sourceId -> { etag, lastModified, observations, observedAt }

export function resetRssState() {
  robotsCache.clear();
  backoffMap.clear();
  feedCache.clear();
}

/**
 * Removes tracking query parameters and fragments from a URL.
 */
export function cleanCanonicalUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  try {
    const parsed = new URL(rawUrl.trim());
    const trackingParams = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
      'fbclid', 'gclid', 'msclkid', '_ga', 'ref', 'source', 'campaign', 'affiliate'
    ]);
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (trackingParams.has(lower) || lower.startsWith('utm_')) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Parses robots.txt content to verify path permissions.
 */
export function parseRobotsTxtPolicy(content, targetPath) {
  if (typeof content !== 'string' || !content.trim()) return { allowed: true };
  const lines = content.split(/\r?\n/);
  let inRelevantBlock = false;
  const disallows = [];
  const allows = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'user-agent') {
      const agent = value.toLowerCase();
      inRelevantBlock = (agent === '*' || agent === 'crucix' || agent.includes('crucix'));
    } else if (inRelevantBlock) {
      if (field === 'disallow') {
        if (value) disallows.push(value);
      } else if (field === 'allow') {
        if (value) allows.push(value);
      }
    }
  }

  const decodedPath = decodeURI(targetPath);
  for (const allow of allows) {
    if (targetPath.startsWith(allow) || decodedPath.startsWith(allow)) {
      return { allowed: true, rule: `Allow: ${allow}` };
    }
  }
  for (const disallow of disallows) {
    if (targetPath.startsWith(disallow) || decodedPath.startsWith(disallow)) {
      return { allowed: false, rule: `Disallow: ${disallow}` };
    }
  }

  return { allowed: true };
}

/**
 * Checks robots.txt with 24h caching and retry capability on transient 403/429.
 */
export async function checkRobotsTxt(sourceConfig, options = {}) {
  const now = options.now ?? Date.now();
  const sourceId = sourceConfig.id;

  if (options.robotsDisallowed === true) {
    return { allowed: false, rule: 'Manual options.robotsDisallowed' };
  }
  if (options.robotsTxtContent) {
    return parseRobotsTxtPolicy(options.robotsTxtContent, new URL(sourceConfig.url).pathname);
  }

  const cached = robotsCache.get(sourceId);
  if (cached && (now - cached.time < ROBOTS_CACHE_TTL_MS)) {
    return cached;
  }

  const fetchFn = options.fetchFn || safeFetch;
  try {
    const res = await fetchFn(sourceConfig.robotsUrl, {
      timeout: 10_000,
      retries: 0
    });
    if (res.status === 403 || res.status === 429) {
      // Do NOT permanently cache a 403 or 429 error
      return { allowed: false, rule: `HTTP ${res.status} accessing robots.txt`, transient: true };
    }
    if (res.rawText) {
      const parsed = parseRobotsTxtPolicy(res.rawText, new URL(sourceConfig.url).pathname);
      robotsCache.set(sourceId, { ...parsed, time: now });
      return parsed;
    }
  } catch {
    // If robots.txt cannot be reached, default to allowed
  }

  const defaultPolicy = { allowed: true };
  robotsCache.set(sourceId, { ...defaultPolicy, time: now });
  return defaultPolicy;
}

/**
 * Determines if an item is a verified sponsored / PR article.
 */
export function isSponsoredOrPr(item) {
  const title = (item.title || '').trim();
  
  // Title markers: (x), [x], (pr), [pr], or starting with Hirdetés: / Szponzorált:
  if (/\((?:x|pr)\)|\[(?:x|pr)\]/i.test(title)) return true;
  if (/^(?:hirdetés|szponzorált tartalom|támogatott tartalom|pr cikk)[:\-]/i.test(title)) return true;

  // Category exact matches
  const categories = Array.isArray(item.categories) ? item.categories : [];
  for (const cat of categories) {
    const trimmed = (cat || '').trim();
    if (/^(?:pr|hirdetés|szponzorált tartalom|támogatott tartalom|brandchannel|promóció)$/i.test(trimmed)) {
      return true;
    }
  }

  // Description markers (checked only at parse time, description itself is never stored)
  const desc = (item.description || '').trim();
  if (/\((?:x|pr)\)|\[(?:x|pr)\]/i.test(desc)) return true;
  if (/szponzorált tartalom|fizetett hirdetés|támogatott tartalom/i.test(desc)) return true;

  return false;
}

/**
 * Classifies an item into Crucix dedicated news categories.
 * 10 categories: news_local, news_regional, news_national, news_global,
 * news_hazard, news_energy, news_economy, news_agriculture, news_science, news_other.
 *
 * Rules:
 * - hazard / energy / agriculture: KEYWORDS strictly in title (override territory)
 * - economy / science / other: section-based (or science keywords in title)
 * - territorial (local / regional / global / national): gazetteer mentions and sections
 */
export function classifyNewsCategory(title, section = '', territoryOrDef = null, maybeDefault = 'news_other') {
  let territory = null;
  let defaultCategory = 'news_other';

  if (typeof territoryOrDef === 'string') {
    defaultCategory = territoryOrDef;
    territory = null;
  } else {
    territory = territoryOrDef;
    defaultCategory = maybeDefault || 'news_other';
  }

  const normTitle = (title || '').toLowerCase();
  const normSec = (section || '').toLowerCase();
  const isSportOrCulture = /sport|foci|labdarugas|kultura|kultur|szorakozas|bulvar/.test(normSec);

  // 1. Keyword-based overrides (hazard, energy, agriculture) strictly on title
  // Severe incident guard: in sport/culture, ONLY acute incidents (baleset, tűz, robbanás, mentés) override.
  const isSevereIncident = /(?<![\p{L}\p{N}])(?:baleset(?:[a-záéíóöőúüű]+)?|karambol(?:[a-záéíóöőúüű]+)?|ütköz[eé](?:[a-záéíóöőúüű]+)?|gázol(?:[a-záéíóöőúüű]+)?|tűz(?:[a-záéíóöőúüű]+)?|tűzeset(?:[a-záéíóöőúüű]+)?|lángok(?:[a-záéíóöőúüű]+)?|égő|robbanás(?:[a-záéíóöőúüű]+)?|mentés(?:[a-záéíóöőúüű]+)?|mentők(?:[a-záéíóöőúüű]+)?|tűzoltók(?:[a-záéíóöőúüű]+)?)(?![\p{L}\p{N}])/ui.test(normTitle);

  if (isSevereIncident) {
    return 'news_hazard';
  }

  if (!isSportOrCulture) {
    // General hazard (expanded with operational query keywords)
    if (/(?<![\p{L}\p{N}])(?:katasztrófa(?:[a-záéíóöőúüű]+)?|vihar(?:[a-záéíóöőúüű]+)?|viharkár(?:[a-záéíóöőúüű]+)?|felhőszakadás(?:[a-záéíóöőúüű]+)?|villám(?:[a-záéíóöőúüű]+)?|villámárvíz(?:[a-záéíóöőúüű]+)?|árvíz(?:[a-záéíóöőúüű]+)?|földrengés(?:[a-záéíóöőúüű]+)?|áramszünet(?:[a-záéíóöőúüű]+)?|vízhiány(?:[a-záéíóöőúüű]+)?|útlezárás(?:[a-záéíóöőúüű]+)?|forgalomkorlátozás(?:[a-záéíóöőúüű]+)?|riasztás(?:[a-záéíóöőúüű]+)?|figyelmeztetés(?:[a-záéíóöőúüű]+)?)(?![\p{L}\p{N}])/ui.test(normTitle)) {
      return 'news_hazard';
    }

    // Energy: Paks in nuclear context only; energia does not match sports clubs (e.g. Energia KC)
    const isPaksEnergy = /(?<![\p{L}\p{N}])(?:paksi\s+atomerőmű(?:[a-záéíóöőúüű]+)?|paksi\s+blokk(?:[a-záéíóöőúüű]+)?|paksi\s+bővítés(?:[a-záéíóöőúüű]+)?|paks\s*ii|atomerőmű(?:[a-záéíóöőúüű]+)?)(?![\p{L}\p{N}])/ui.test(normTitle);
    const isGeneralEnergy = /(?<![\p{L}\p{N}])(?:energia(?!\s+(?:kc|fc|sc|se|te|bajnokság|kupa|liga))|villamosenergia(?:[a-záéíóöőúüű]+)?|áramhálózat(?:[a-záéíóöőúüű]+)?|földgáz(?:[a-záéíóöőúüű]+)?|gázellátás(?:[a-záéíóöőúüű]+)?|áramellátás(?:[a-záéíóöőúüű]+)?|üzemanyag(?:[a-záéíóöőúüű]+)?|benzin(?:[a-záéíóöőúüű]+)?|gázolaj(?:[a-záéíóöőúüű]+)?|erőmű(?:[a-záéíóöőúüű]+)?|akkumulátorgyár(?:[a-záéíóöőúüű]+)?|távhő(?:[a-záéíóöőúüű]+)?)(?![\p{L}\p{N}])/ui.test(normTitle);

    if (isPaksEnergy || isGeneralEnergy) {
      return 'news_energy';
    }

    // Epizootic / Agriculture
    if (/(?<![\p{L}\p{N}])(?:sertéspestis(?:[a-záéíóöőúüű]+)?|madárinfluenza(?:[a-záéíóöőúüű]+)?|veszettség(?:[a-záéíóöőúüű]+)?|agrár(?:[a-záéíóöőúüű]+)?|mezőgazdaság(?:[a-záéíóöőúüű]+)?|állategészség(?:[a-záéíóöőúüű]+)?|kérődző(?:[a-záéíóöőúüű]+)?|szarvasmarha(?:[a-záéíóöőúüű]+)?|vetés(?:[a-záéíóöőúüű]+)?|aratás(?:[a-záéíóöőúüű]+)?|aszály(?:[a-záéíóöőúüű]+)?|terméshozam(?:[a-záéíóöőúüű]+)?|vaddisznó(?:[a-záéíóöőúüű]+)?|afrikai\s+sertéspestis)(?![\p{L}\p{N}])/ui.test(normTitle)) {
      return 'news_agriculture';
    }
  }

  // 2. Section-based thematic categories
  if (/gazdasag|uzlet|penzugy|finanszirozas|piac|befektetes|makrogazdasag/.test(normSec)) {
    return 'news_economy';
  }
  if (/tudomany|kornyezet|tech|qubit|urkutatas/.test(normSec) ||
      /(?<![\p{L}\p{N}])(?:tudomány|űrkutatás|nasa|csillagászat|fekete lyuk|genom|klímaváltozás)(?![\p{L}\p{N}])/ui.test(normTitle)) {
    return 'news_science';
  }
  if (/sport|foci|labdarugas|kultura|kultur|eletmod|elet-stilus|zacc|zene|film|szorakozas|bulvar/.test(normSec)) {
    return 'news_other';
  }

  // 3. Global news (section or keywords)
  if (/kulfold|nagyvilag|vilag|global/.test(normSec) ||
      /(?<![\p{L}\p{N}])(?:külföld|világ|nemzetközi|genf|békecsúcs|egyesült államok|kína|oroszország|ukrajna|közel-kelet|nato|brüsszel|eu|európai unió|fehér ház|kreml|washington)(?![\p{L}\p{N}])/ui.test(normTitle)) {
    return 'news_global';
  }

  // 4. Territorial classification (local, regional, national)
  if (territory && (territory.settlementName || territory.settlementId)) {
    return 'news_local';
  }
  if (/(?<![\p{L}\p{N}])(?:hajd[uú]-bihar|hajd[uú]|bihar|sárrét|hortobágy|hajdú-bihari)(?![\p{L}\p{N}])/ui.test(normTitle) ||
      normSec.includes('hajdu') || normSec.includes('bihar') || normSec.includes('debrecen')) {
    return 'news_regional';
  }
  if (/belfold|itthon|magyarorszag|politika|kozelet/.test(normSec) ||
      /(?<![\p{L}\p{N}])(?:magyarország|belföld|kormány|parlament|országgyűlés|miniszter|budapest)(?![\p{L}\p{N}])/ui.test(normTitle)) {
    return 'news_national';
  }

  return defaultCategory || 'news_other';
}

/**
 * Extracts normalized section from category or URL.
 */
export function extractSection(url, categories = []) {
  if (Array.isArray(categories) && categories.length > 0) {
    const firstCat = categories[0].trim();
    if (firstCat) {
      return firstCat
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-');
    }
  }
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length > 0 && !/^\d+$/.test(parts[0])) {
      return parts[0].toLowerCase();
    }
  } catch {}
  return 'hirek';
}

/**
 * Checks whether a given source is explicitly enabled via env var or options.
 */
export function isSourceEnabled(sourceConfig, options = {}) {
  if (options.enabled === true) return true;
  if (Array.isArray(options.enabledFeeds) && (options.enabledFeeds.includes(sourceConfig.id) || options.enabledFeeds.includes(sourceConfig.name))) {
    return true;
  }
  const envVal = process.env[sourceConfig.envOptIn];
  return envVal === 'true' || envVal === '1';
}

/**
 * Parses raw RSS XML into normalized observations adhering strictly to data minimization.
 */
export function parseGenericRss(xml, sourceConfig, options = {}) {
  const now = options.now ?? Date.now();
  const territoryConfig = options.territoryConfig ?? DEFAULT_TERRITORY_CONFIG;

  if (!xml || typeof xml !== 'string') {
    return unavailableResult(sourceConfig.name, 'Üres vagy érvénytelen RSS XML', { url: sourceConfig.url }, now);
  }

  let parsed;
  try {
    parsed = parseXml(xml);
  } catch (err) {
    return unavailableResult(sourceConfig.name, `XML feldolgozási hiba: ${err.message}`, { url: sourceConfig.url }, now);
  }

  const channel = parsed?.rss?.channel || parsed?.channel || {};
  let rawItems = channel?.item || [];
  if (!Array.isArray(rawItems)) {
    rawItems = rawItems ? [rawItems] : [];
  }

  // Derive source-level observation timestamp
  const observedAt = providerTime(options.lastModified)
    || providerTime(channel.lastBuildDate)
    || providerTime(channel.pubDate)
    || new Date(now).toISOString();

  const policy = ALL_POLICIES[sourceConfig.name] || FEED_POLICIES[sourceConfig.name];
  const maxAgeMs = policy?.observationMaxAgeMs || (48 * 3600 * 1000);

  const observations = [];
  const seenUrls = new Set();
  let droppedDuplicate = 0;
  let droppedPr = 0;
  let droppedStale = 0;
  let publisherPromoCount = 0;
  let newestPubDate = null;
  let oldestPubDate = null;

  for (const item of rawItems) {
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : (item.title?.['#text'] || '').trim();
    const rawLink = typeof item.link === 'string' ? item.link.trim() : (item.link?.['#text'] || '').trim();
    if (!rawTitle || !rawLink) continue;

    const canonicalLink = cleanCanonicalUrl(rawLink);
    if (!canonicalLink) continue;
    if (seenUrls.has(canonicalLink)) {
      droppedDuplicate++;
      continue;
    }
    seenUrls.add(canonicalLink);

    // Extract categories
    let categories = [];
    if (Array.isArray(item.category)) {
      categories = item.category.map(c => typeof c === 'string' ? c : (c?.['#text'] || '')).filter(Boolean);
    } else if (item.category) {
      const c = typeof item.category === 'string' ? item.category : (item.category?.['#text'] || '');
      if (c) categories.push(c);
    }

    // PR / Sponsored check
    const rawDesc = typeof item.description === 'string' ? item.description : (item.description?.['#text'] || '');
    if (isSponsoredOrPr({ title: rawTitle, categories, description: rawDesc })) {
      droppedPr++;
      continue;
    }

    const pubDateStr = item.pubDate || item['dc:date'] || item.date;
    const publishedAt = providerTime(pubDateStr, { assumeUTC: true }) || observedAt;

    if (publishedAt) {
      const pubMs = Date.parse(publishedAt);
      if (Number.isFinite(pubMs) && (now - pubMs > maxAgeMs)) {
        droppedStale++;
        continue;
      }
      if (!newestPubDate || pubMs > Date.parse(newestPubDate)) {
        newestPubDate = publishedAt;
      }
      if (!oldestPubDate || pubMs < Date.parse(oldestPubDate)) {
        oldestPubDate = publishedAt;
      }
    }

    // Territory detection
    const territory = detectSettlementMention(rawTitle, territoryConfig, {
      implicitCountyContext: sourceConfig.implicitCountyContext
    });

    // Section & news category
    const section = extractSection(canonicalLink, categories);
    const isPublisherPromo = section === 'kozlemeny' || categories.some(c => /közlemény/i.test(c));
    if (isPublisherPromo) {
      publisherPromoCount++;
    }
    const newsCategory = classifyNewsCategory(rawTitle, section, territory, sourceConfig.defaultCategory);

    // Deterministic GUID hash
    const guidSource = item.guid ? (typeof item.guid === 'string' ? item.guid : item.guid?.['#text'] || '') : canonicalLink;
    const guidHash = `${sourceConfig.id}-${createHash('sha256').update(guidSource || canonicalLink).digest('hex').slice(0, 16)}`;

    // Stored facts: NO person names, NO full description text
    const facts = {
      settlement: territory.settlementName || null,
      county: territory.countyName || null,
      newsCategory,
      section
    };

    observations.push({
      id: guidHash,
      guid: guidHash,
      title: rawTitle,
      link: canonicalLink,
      url: canonicalLink,
      publishedAt,
      observedAt,
      source: { name: sourceConfig.name, url: canonicalLink, status: 'ok' },
      kind: 'news',
      domain: sourceConfig.defaultDomain || 'news',
      newsCategory,
      section,
      severity: 'low',
      territory,
      facts,
      needsLocalReview: territory.needsLocalReview,
      isConfirmedLocal: false, // STRICT RULE: news mentions are NEVER confirmedLocal
      isPublisherPromo
    });
  }

  // Detect possible temporal gap if feed rolled forward completely past the previous newest item
  let possibleGap = false;
  if (options.cached?.lastNewestPubDate && newestPubDate && oldestPubDate) {
    const prevNewestMs = Date.parse(options.cached.lastNewestPubDate);
    const curOldestMs = Date.parse(oldestPubDate);
    const curNewestMs = Date.parse(newestPubDate);
    if (curNewestMs > prevNewestMs && curOldestMs > prevNewestMs) {
      possibleGap = true;
    }
  }

  const diagnostics = {
    droppedStale,
    droppedPr,
    droppedDuplicate,
    filteredPrCount: droppedPr,
    publisherPromoCount,
    possibleGap,
    newestPubDate,
    oldestPubDate
  };

  const res = freshResult(sourceConfig.name, observedAt, observations, {
    url: sourceConfig.url,
    itemCount: observations.length,
    diagnostics
  }, now);

  res.domain = sourceConfig.defaultDomain || 'news';
  res.diagnostics = diagnostics;
  return res;
}

/**
 * Creates an individual source briefing runner for a configured RSS feed.
 */
export function createRssBriefing(sourceKey) {
  const sourceConfig = RSS_SOURCES[sourceKey];
  if (!sourceConfig) {
    throw new Error(`Unknown RSS source key: ${sourceKey}`);
  }

  return async function briefing(options = {}) {
    const now = options.now ?? Date.now();

    // 1. Opt-in gate: strictly 0 network calls if not enabled
    if (!isSourceEnabled(sourceConfig, options)) {
      const res = unavailableResult(sourceConfig.name, 'Forrás letiltva (alapértelmezetten kikapcsolt opt-in)', {
        url: sourceConfig.url,
        disabled: true
      }, now);
      res.status = 'disabled';
      res.domain = sourceConfig.defaultDomain || 'news';
      return res;
    }

    // 2. Check backoff window
    const backoffUntil = backoffMap.get(sourceConfig.id) || 0;
    if (now < backoffUntil) {
      const remainingSec = Math.ceil((backoffUntil - now) / 1000);
      const res = unavailableResult(sourceConfig.name, `Sebességkorlátozás miatt várakozás (${remainingSec}s hátralévő)`, {
        url: sourceConfig.url,
        rateLimited: true
      }, now);
      res.status = 'disabled';
      res.domain = sourceConfig.defaultDomain || 'news';
      return res;
    }

    // 3. robots.txt check
    const robotsPolicy = await checkRobotsTxt(sourceConfig, options);
    if (!robotsPolicy.allowed) {
      const res = unavailableResult(sourceConfig.name, `Hozzáférés tiltva robots.txt által (${robotsPolicy.rule})`, {
        url: sourceConfig.url,
        robotsBlocked: true
      }, now);
      res.status = 'disabled';
      res.domain = sourceConfig.defaultDomain || 'news';
      return res;
    }

    // 4. Conditional GET headers preparation
    const cached = feedCache.get(sourceConfig.id);
    const headers = {};
    if (sourceConfig.supportsConditionalGet && cached) {
      if (cached.etag) headers['If-None-Match'] = cached.etag;
      if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    }

    // 5. Fetch feed with payload size limit
    const fetchFn = options.fetchFn || safeFetch;
    let fetchRes;
    try {
      fetchRes = await fetchFn(sourceConfig.url, {
        timeout: options.timeout ?? 15_000,
        headers,
        retries: 0
      });
    } catch (err) {
      return unavailableResult(sourceConfig.name, `Hálózati hiba: ${err.message}`, { url: sourceConfig.url }, now);
    }

    // 6. Handle HTTP 304 Not Modified
    if (fetchRes.status === 304 && cached) {
      const nowIso = new Date(now).toISOString();
      cached.observedAt = nowIso;
      feedCache.set(sourceConfig.id, cached);
      const res = freshResult(sourceConfig.name, nowIso, cached.observations, {
        url: sourceConfig.url,
        cached: true,
        itemCount: cached.observations.length,
        diagnostics: cached.diagnostics || {}
      }, now);
      res.domain = sourceConfig.defaultDomain || 'news';
      res.diagnostics = cached.diagnostics || {};
      return res;
    }

    // 7. Handle technical blocks (403, 429) & backoff
    if (fetchRes.status === 429) {
      let backoffDurationMs = 300_000; // default 5m
      const retryAfter = fetchRes.headers?.['retry-after'];
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds) && seconds > 0) {
          backoffDurationMs = seconds * 1000;
        }
      }
      backoffMap.set(sourceConfig.id, now + backoffDurationMs);
      const res = unavailableResult(sourceConfig.name, 'HTTP 429 Túl sok kérés (sebességkorlátozás)', {
        url: sourceConfig.url,
        backoffUntil: now + backoffDurationMs
      }, now);
      res.status = 'disabled';
      res.domain = sourceConfig.defaultDomain || 'news';
      return res;
    }

    if (fetchRes.status === 403) {
      const res = unavailableResult(sourceConfig.name, 'HTTP 403 Hozzáférés megtagadva (WAF/szerver blokkolás)', {
        url: sourceConfig.url
      }, now);
      res.status = 'disabled';
      res.domain = sourceConfig.defaultDomain || 'news';
      return res;
    }

    if (fetchRes.status !== 200 || !fetchRes.rawText) {
      return unavailableResult(sourceConfig.name, `HTTP ${fetchRes.status} válasz a feed végpontról`, {
        url: sourceConfig.url
      }, now);
    }

    // 8. Size ceiling check
    const byteLength = Buffer.byteLength(fetchRes.rawText, 'utf-8');
    if (byteLength > MAX_PAYLOAD_BYTES) {
      return unavailableResult(sourceConfig.name, `A válasz mérete (${byteLength} bájt) meghaladja az 1 MB limitet`, {
        url: sourceConfig.url,
        byteLength
      }, now);
    }

    // 9. Parse and cache observations
    const parsedResult = parseGenericRss(fetchRes.rawText, sourceConfig, {
      now,
      territoryConfig: options.territoryConfig,
      lastModified: fetchRes.headers?.['last-modified'],
      cached
    });

    if (parsedResult.status === 'ok') {
      feedCache.set(sourceConfig.id, {
        etag: fetchRes.headers?.etag || null,
        lastModified: fetchRes.headers?.['last-modified'] || null,
        observations: parsedResult.observations,
        observedAt: parsedResult.observedAt,
        lastNewestPubDate: parsedResult.diagnostics?.newestPubDate || null,
        diagnostics: parsedResult.diagnostics || {}
      });
    }

    return parsedResult;
  };
}

// Individual briefing exports
export const dehirRss = createRssBriefing('RSS-Dehir');
export const telexRss = createRssBriefing('RSS-Telex');
export const rss444 = createRssBriefing('RSS-444');
export const rss24hu = createRssBriefing('RSS-24hu');
export const indexRss = createRssBriefing('RSS-Index');
export const hvgRss = createRssBriefing('RSS-HVG');
export const portfolioRss = createRssBriefing('RSS-Portfolio');
export const qubitRss = createRssBriefing('RSS-Qubit');
