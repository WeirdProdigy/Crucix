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
import { providerTime, freshResult, unavailableResult } from '../utils/freshness.mjs';
import { detectSettlementMention } from '../utils/settlement-gazetteer.mjs';
import { DEFAULT_TERRITORY_CONFIG } from '../../lib/intelligence/territory.mjs';

export const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB ceiling
export const ROBOTS_CACHE_TTL_MS = 24 * 3600 * 1000; // 24 hours

export const NEWS_CATEGORIES = Object.freeze([
  'news_local',
  'news_regional',
  'news_hazard',
  'news_agriculture',
  'news_energy',
  'news_science',
  'news_global'
]);

export const RSS_SOURCES = Object.freeze({
  'RSS-Dehir': {
    id: 'dehir',
    name: 'RSS-Dehir',
    displayName: 'Dehir',
    url: 'https://www.dehir.hu/rss.php',
    robotsUrl: 'https://www.dehir.hu/robots.txt',
    envOptIn: 'CRUCIX_ENABLE_FEED_DEHIR',
    altEnvOptIn: 'ENABLE_RSS_DEHIR',
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
    altEnvOptIn: 'ENABLE_RSS_TELEX',
    defaultDomain: 'security',
    defaultCategory: 'news_regional',
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
    altEnvOptIn: 'ENABLE_RSS_444',
    defaultDomain: 'security',
    defaultCategory: 'news_regional',
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
    altEnvOptIn: 'ENABLE_RSS_24HU',
    defaultDomain: 'security',
    defaultCategory: 'news_regional',
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
    altEnvOptIn: 'ENABLE_RSS_INDEX',
    defaultDomain: 'security',
    defaultCategory: 'news_regional',
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
    altEnvOptIn: 'ENABLE_RSS_HVG',
    defaultDomain: 'security',
    defaultCategory: 'news_regional',
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
    altEnvOptIn: 'ENABLE_RSS_PORTFOLIO',
    defaultDomain: 'security',
    defaultCategory: 'news_energy',
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
    altEnvOptIn: 'ENABLE_RSS_QUBIT',
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
 */
export function classifyNewsCategory(title, section = '', defaultCategory = 'news_regional') {
  const text = `${title || ''} ${section || ''}`.toLowerCase();

  // 1. Hazard
  if (/baleset|karambol|ütköz|gázol|tűz\b|égő\b|lángok|katasztrófa|vihar|felhőszakadás|villám|áramszünet|vízhiány|útlezárás|forgalomkorlátozás|riasztás|figyelmeztetés/.test(text)) {
    return 'news_hazard';
  }

  // 2. Epizootic / Agriculture
  if (/sertéspestis|madárinfluenza|agrár|mezőgazdaság|állategészség|kérődző|szarvasmarha|vetés|aratás|aszály|terméshozam/.test(text)) {
    return 'news_agriculture';
  }

  // 3. Energy & Utilities
  if (/energia|villamosenergia|áramhálózat|földgáz|gázellátás|üzemanyag|benzin|gázolaj|erőmű|akkumulátorgyár|távhő/.test(text)) {
    return 'news_energy';
  }

  // 4. Science
  if (/tudomány|kutatás|csillagászat|űrkutatás|nasa|egyetem\b|fizika\b|biológia|klímaváltozás|fekete lyuk|genom/.test(text)) {
    return 'news_science';
  }

  // 5. Local
  if (/debrecen|bihartorda|püspökladány|hajdúszoboszló|berettyóújfalu|derecske|balmazújváros/.test(text)) {
    return 'news_local';
  }

  // 6. Regional
  if (/hajdú-bihar|hajdú\b|bihar\b|sárrét|hortobágy/.test(text)) {
    return 'news_regional';
  }

  // 7. Global
  if (/külföld|kulfold|világ|vilag|nemzetközi|nemzetkozi|genf|békecsúcs|bekecsucs|egyesült államok|kína|oroszország|ukrajna|közel-kelet|nato|brüsszel|eu\b/.test(text)) {
    return 'news_global';
  }

  return defaultCategory;
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
  const envVal1 = process.env[sourceConfig.envOptIn];
  const envVal2 = sourceConfig.altEnvOptIn ? process.env[sourceConfig.altEnvOptIn] : null;
  return envVal1 === 'true' || envVal1 === '1' || envVal2 === 'true' || envVal2 === '1';
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

  const observations = [];
  const seenUrls = new Set();

  for (const item of rawItems) {
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : (item.title?.['#text'] || '').trim();
    const rawLink = typeof item.link === 'string' ? item.link.trim() : (item.link?.['#text'] || '').trim();
    if (!rawTitle || !rawLink) continue;

    const canonicalLink = cleanCanonicalUrl(rawLink);
    if (!canonicalLink || seenUrls.has(canonicalLink)) continue;
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
      continue;
    }

    const pubDateStr = item.pubDate || item['dc:date'] || item.date;
    const publishedAt = providerTime(pubDateStr, { assumeUTC: true }) || observedAt;

    // Section & news category
    const section = extractSection(canonicalLink, categories);
    const newsCategory = classifyNewsCategory(rawTitle, section, sourceConfig.defaultCategory);

    // Territory detection
    const territory = detectSettlementMention(rawTitle, territoryConfig, {
      implicitCountyContext: sourceConfig.implicitCountyContext
    });

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
      isConfirmedLocal: false // STRICT RULE: news mentions are NEVER confirmedLocal
    });
  }

  const res = freshResult(sourceConfig.name, observedAt, observations, {
    url: sourceConfig.url,
    itemCount: observations.length
  }, now);

  res.domain = sourceConfig.defaultDomain || 'news';
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
      const res = freshResult(sourceConfig.name, new Date(now).toISOString(), cached.observations, {
        url: sourceConfig.url,
        cached: true,
        itemCount: cached.observations.length
      }, now);
      res.domain = sourceConfig.defaultDomain || 'news';
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
      lastModified: fetchRes.headers?.['last-modified']
    });

    if (parsedResult.status === 'ok') {
      feedCache.set(sourceConfig.id, {
        etag: fetchRes.headers?.etag || null,
        lastModified: fetchRes.headers?.['last-modified'] || null,
        observations: parsedResult.observations,
        observedAt: parsedResult.observedAt
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
