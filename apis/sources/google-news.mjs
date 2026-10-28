// Google News RSS Feed Adapter for Crucix Curated Intelligence Pipeline
//
// Operational and Legal Guardrails:
// 1. Opt-in only: Disabled by default via CRUCIX_ENABLE_GNEWS. When disabled, strictly 0 network calls.
// 2. Data minimization: Description and full text are strictly DISCARDED. Stored fields:
//    title (cleaned of " - Source" suffix), canonical link (Google redirect preserved),
//    UTC timestamp, guid hash, source metadata (name, domain), newsCategory, and extracted facts.
// 3. Client-side Blocklist: Rejects spam, social media, and low-quality aggregators (vietnam.vn, facebook, etc.).
// 4. HAON filter: For site:haon.hu, only news_hazard, news_local, and news_regional items survive.
//    Bulvár, clickbait, and lifestyle items are discarded and recorded in diagnostics.
// 5. Query pacing and backoff: Enforces >= 5s delay between queries.
//    HTTP 403 / 429 / CAPTCHA stops adapter immediately with status: disabled and backoff.
// 6. Truncation alert: Identifies feeds capped at 100 items (possibleTruncation: true).
// 7. Grounding: isConfirmedLocal is ALWAYS false; settlement text mentions are flagged needsLocalReview.

import { createHash } from 'node:crypto';
import { safeFetch, retryAfterMs } from '../utils/fetch.mjs';
import { parseXml } from '../utils/xml.mjs';
import { providerTime, freshResult, unavailableResult } from '../utils/freshness.mjs';
import { classifyNewsCategory } from './generic-rss.mjs';
import { detectSettlementMention } from '../utils/settlement-gazetteer.mjs';
import { DEFAULT_TERRITORY_CONFIG } from '../../lib/intelligence/territory.mjs';

export const GNEWS_SOURCE_NAME = 'Google-News';

export const BLOCKLIST_DOMAINS = Object.freeze(new Set([
  'vietnam.vn',
  'globalhir.hu',
  'hirstart.hu',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'reddit.com'
]));

export const GNEWS_CATALOG = Object.freeze([
  {
    id: 'gnews-debrecen',
    name: 'GNews-Debrecen',
    displayName: 'Debrecen közlekedés és beruházás',
    query: 'Debrecen (baleset OR közlekedés OR rendőrség OR beruházás) when:1d -site:vietnam.vn',
    intervalMs: 45 * 60 * 1000, // 45 min
    filterHaon: false,
    supportsTruncationAlert: false,
    implicitCountyContext: true
  },
  {
    id: 'gnews-hajdubihar',
    name: 'GNews-HajduBihar',
    displayName: 'Hajdú-Bihar események és közmű',
    query: '"Hajdú-Bihar" (baleset OR tűz OR rendőrség OR mentők OR vihar OR áramszünet OR vízhiány) when:2d -site:vietnam.vn',
    intervalMs: 30 * 60 * 1000, // 30 min
    filterHaon: false,
    supportsTruncationAlert: false,
    implicitCountyContext: true
  },
  {
    id: 'gnews-district-towns',
    name: 'GNews-DistrictTowns',
    displayName: 'Járási székhelyek kékfény és közmű',
    query: '("Püspökladány" OR "Berettyóújfalu" OR "Hajdúszoboszló" OR "Biharkeresztes") (baleset OR tűz OR rendőrség OR mentők OR áramszünet) when:2d',
    intervalMs: 120 * 60 * 1000, // 120 min
    filterHaon: false,
    supportsTruncationAlert: false,
    implicitCountyContext: true
  },
  {
    id: 'gnews-epizootic',
    name: 'GNews-Epizootic',
    displayName: 'Állategészségügy és epizootológia',
    query: '("afrikai sertéspestis" OR madárinfluenza OR veszettség) when:3d -site:vietnam.vn',
    intervalMs: 60 * 60 * 1000, // 60 min
    filterHaon: false,
    supportsTruncationAlert: true, // 100-item ceiling alert
    implicitCountyContext: false
  },
  {
    id: 'gnews-energy',
    name: 'GNews-Energy',
    displayName: 'Energiahálózat és gázellátás',
    query: '(MVM OR gázellátás OR áramellátás OR "Paksi Atomerőmű" OR távhő) -Dome -site:vietnam.vn when:2d',
    intervalMs: 60 * 60 * 1000, // 60 min
    filterHaon: false,
    supportsTruncationAlert: false,
    implicitCountyContext: false
  },
  {
    id: 'gnews-haon',
    name: 'GNews-HAON',
    displayName: 'HAON szűrt események',
    query: 'site:haon.hu when:2d',
    intervalMs: 60 * 60 * 1000, // 60 min
    filterHaon: true, // Retains ONLY news_hazard, news_local, news_regional
    supportsTruncationAlert: false,
    implicitCountyContext: true
  }
]);

// Internal state for backoff and deduplication across queries
let globalBackoffUntil = 0;
let requestCountWindowStart = Date.now();
let requestsInCurrentHour = 0;

export function resetGNewsState() {
  globalBackoffUntil = 0;
  requestCountWindowStart = Date.now();
  requestsInCurrentHour = 0;
}

/**
 * Checks if Google News adapter is explicitly enabled via environment variable or options.
 */
export function isGNewsEnabled(options = {}) {
  if (options.enabled === true) return true;
  const envVal = process.env.CRUCIX_ENABLE_GNEWS;
  return envVal === 'true' || envVal === '1';
}

/**
 * Cleans the trailing " - Source Name" suffix from Google News RSS article titles.
 */
export function cleanGNewsTitle(rawTitle) {
  if (typeof rawTitle !== 'string') return '';
  return rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
}

/**
 * Checks if a source name, source url, or link matches client-side blocklisted domains.
 */
export function isBlocklisted(sourceName = '', sourceUrl = '', articleUrl = '') {
  const checkStr = `${sourceName} ${sourceUrl} ${articleUrl}`.toLowerCase();
  for (const domain of BLOCKLIST_DOMAINS) {
    if (checkStr.includes(domain)) return true;
  }
  return false;
}

/**
 * Parses a single Google News RSS XML string into validated, normalized observations.
 */
export function parseGoogleNewsRss(xml, queryConfig, options = {}) {
  const now = options.now ?? Date.now();
  const territoryConfig = options.territoryConfig ?? DEFAULT_TERRITORY_CONFIG;
  const seenUrls = options.seenUrls instanceof Set ? options.seenUrls : new Set();

  if (!xml || typeof xml !== 'string') {
    return unavailableResult(queryConfig.name || GNEWS_SOURCE_NAME, 'Üres vagy érvénytelen Google News XML', {}, now);
  }

  let parsed;
  try {
    parsed = parseXml(xml);
  } catch (err) {
    return unavailableResult(queryConfig.name || GNEWS_SOURCE_NAME, `XML feldolgozási hiba: ${err.message}`, {}, now);
  }

  const channel = parsed?.rss?.channel || parsed?.channel || {};
  let rawItems = channel?.item || [];
  if (!Array.isArray(rawItems)) {
    rawItems = rawItems ? [rawItems] : [];
  }

  const observedAt = providerTime(channel.lastBuildDate)
    || providerTime(channel.pubDate)
    || new Date(now).toISOString();

  const observations = [];
  let droppedBlocklist = 0;
  let droppedDuplicate = 0;
  let droppedHaonIrrelevant = 0;
  let newestPubDate = null;
  let oldestPubDate = null;
  const possibleTruncation = rawItems.length >= 100;

  for (const item of rawItems) {
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : (item.title?.['#text'] || '').trim();
    const rawLink = typeof item.link === 'string' ? item.link.trim() : (item.link?.['#text'] || '').trim();
    if (!rawTitle || !rawLink) continue;

    const cleanedTitle = cleanGNewsTitle(rawTitle);

    // Extract publisher source name and source URL
    let sourcePublisherName = '';
    let sourcePublisherUrl = '';
    if (item.source) {
      if (typeof item.source === 'string') {
        sourcePublisherName = item.source.trim();
      } else if (typeof item.source === 'object') {
        sourcePublisherName = (item.source['#text'] || '').trim();
        sourcePublisherUrl = (item.source['@_url'] || item.source.url || '').trim();
      }
    }

    // Client-side blocklist check
    if (isBlocklisted(sourcePublisherName, sourcePublisherUrl, rawLink)) {
      droppedBlocklist++;
      continue;
    }

    // Deduplication check across canonical URLs
    if (seenUrls.has(rawLink)) {
      droppedDuplicate++;
      continue;
    }
    seenUrls.add(rawLink);

    const pubDateStr = item.pubDate || item['dc:date'] || item.date;
    const publishedAt = providerTime(pubDateStr, { assumeUTC: true }) || observedAt;

    if (publishedAt) {
      const pubMs = Date.parse(publishedAt);
      if (!newestPubDate || pubMs > Date.parse(newestPubDate)) {
        newestPubDate = publishedAt;
      }
      if (!oldestPubDate || pubMs < Date.parse(oldestPubDate)) {
        oldestPubDate = publishedAt;
      }
    }

    // Territory detection
    const territory = detectSettlementMention(cleanedTitle, territoryConfig, {
      implicitCountyContext: Boolean(queryConfig.implicitCountyContext)
    });

    // Categorization
    const newsCategory = classifyNewsCategory(cleanedTitle, '', territory, 'news_national');

    // HAON filter rule: If query is site:haon.hu, retain ONLY hazard/local/regional
    if (queryConfig.filterHaon) {
      const isAllowedCategory = ['news_hazard', 'news_local', 'news_regional'].includes(newsCategory);
      if (!isAllowedCategory) {
        droppedHaonIrrelevant++;
        continue;
      }
    }

    // Deterministic GUID hash
    const guidSource = item.guid ? (typeof item.guid === 'string' ? item.guid : item.guid?.['#text'] || '') : rawLink;
    const guidHash = `gnews-${createHash('sha256').update(guidSource || rawLink).digest('hex').slice(0, 16)}`;

    // Stored facts: data minimization strictly observed
    const facts = {
      settlement: territory.settlementName || null,
      county: territory.countyName || null,
      newsCategory,
      sourcePublisher: sourcePublisherName || null
    };

    observations.push({
      id: guidHash,
      guid: guidHash,
      title: cleanedTitle,
      link: rawLink, // Google redirect URL preserved as required
      url: rawLink,
      publishedAt,
      observedAt,
      source: {
        name: queryConfig.name || GNEWS_SOURCE_NAME,
        url: rawLink,
        status: 'ok',
        publisher: sourcePublisherName || null,
        publisherUrl: sourcePublisherUrl || null
      },
      kind: 'news',
      domain: 'security',
      newsCategory,
      section: 'gnews',
      severity: 'low',
      territory,
      facts,
      needsLocalReview: territory.needsLocalReview,
      isConfirmedLocal: false, // STRICT RULE: never confirmed local!
      isPublisherPromo: false
    });
  }

  const diagnostics = {
    query: queryConfig.query,
    totalRawItems: rawItems.length,
    observationsCount: observations.length,
    droppedBlocklist,
    droppedDuplicate,
    droppedHaonIrrelevant,
    possibleTruncation,
    newestPubDate,
    oldestPubDate
  };

  const res = freshResult(queryConfig.name || GNEWS_SOURCE_NAME, observedAt, observations, {
    query: queryConfig.query,
    itemCount: observations.length,
    diagnostics
  }, now);

  res.domain = 'security';
  res.diagnostics = diagnostics;
  return res;
}

/**
 * Executes a full briefing cycle across configured Google News catalog queries.
 */
export async function briefing(options = {}) {
  const now = options.now ?? Date.now();

  // 1. Opt-in gate: strictly 0 network calls if disabled
  if (!isGNewsEnabled(options)) {
    const res = unavailableResult(GNEWS_SOURCE_NAME, 'Google News forrás letiltva (alapértelmezetten kikapcsolt opt-in)', {
      disabled: true
    }, now);
    res.status = 'disabled';
    res.domain = 'security';
    return res;
  }

  // 2. Backoff window gate
  if (now < globalBackoffUntil) {
    const remainingSec = Math.ceil((globalBackoffUntil - now) / 1000);
    const res = unavailableResult(GNEWS_SOURCE_NAME, `Sebességkorlátozás miatt várakozás (${remainingSec}s hátralévő)`, {
      rateLimited: true
    }, now);
    res.status = 'disabled';
    res.domain = 'security';
    return res;
  }

  // Hourly request counter window reset
  if (now - requestCountWindowStart > 3600 * 1000) {
    requestCountWindowStart = now;
    requestsInCurrentHour = 0;
  }

  const fetchFn = options.fetchFn || safeFetch;
  const catalog = Array.isArray(options.catalog) ? options.catalog : GNEWS_CATALOG;
  const seenUrls = new Set();
  const allObservations = [];
  const queryDiagnostics = [];
  let totalDroppedBlocklist = 0;
  let totalDroppedDuplicate = 0;
  let totalDroppedHaon = 0;
  let anyTruncation = false;

  for (let idx = 0; idx < catalog.length; idx++) {
    const queryConfig = catalog[idx];

    // Enforce >= 5s pacing and jitter between consecutive live requests
    if (idx > 0 && typeof options.fetchFn !== 'function') {
      const jitterMs = Math.floor(Math.random() * 1500);
      const delayMs = 5000 + jitterMs;
      await new Promise(r => setTimeout(r, delayMs));
    }

    const encodedQ = encodeURIComponent(queryConfig.query);
    const url = `https://news.google.com/rss/search?q=${encodedQ}&hl=hu&gl=HU&ceid=HU:hu`;

    requestsInCurrentHour++;

    try {
      const response = await fetchFn(url, {
        timeout: 15_000,
        headers: {
          'User-Agent': options.userAgent || 'Crucix/2.13.6 (https://crucix.test)'
        },
        format: 'text'
      });

      if (response.status === 403 || response.status === 429) {
        const retryAfterHeader = response.headers?.get?.('retry-after') || response.headers?.['retry-after'];
        const backoffMs = retryAfterMs(retryAfterHeader, now) || (60 * 60 * 1000);
        globalBackoffUntil = now + backoffMs;

        const res = unavailableResult(GNEWS_SOURCE_NAME, `Google News blokkolás: HTTP ${response.status}`, {
          blocked: true,
          status: response.status,
          backoffMs
        }, now);
        res.status = 'disabled';
        res.domain = 'security';
        return res;
      }

      if (response.status !== 200 || !response.rawText) {
        queryDiagnostics.push({
          query: queryConfig.id,
          status: response.status || 'network_error',
          itemCount: 0
        });
        continue;
      }

      const parsedRes = parseGoogleNewsRss(response.rawText, queryConfig, {
        now,
        territoryConfig: options.territoryConfig,
        seenUrls
      });

      if (parsedRes.observations) {
        allObservations.push(...parsedRes.observations);
      }
      if (parsedRes.diagnostics) {
        queryDiagnostics.push(parsedRes.diagnostics);
        totalDroppedBlocklist += parsedRes.diagnostics.droppedBlocklist || 0;
        totalDroppedDuplicate += parsedRes.diagnostics.droppedDuplicate || 0;
        totalDroppedHaon += parsedRes.diagnostics.droppedHaonIrrelevant || 0;
        if (parsedRes.diagnostics.possibleTruncation) {
          anyTruncation = true;
        }
      }

    } catch (err) {
      queryDiagnostics.push({
        query: queryConfig.id,
        status: 'error',
        error: err.message
      });
    }
  }

  const latestObservedAt = allObservations[0]?.observedAt || new Date(now).toISOString();

  const compositeDiagnostics = {
    queriesRun: catalog.length,
    requestsThisHour: requestsInCurrentHour,
    totalDroppedBlocklist,
    totalDroppedDuplicate,
    totalDroppedHaon,
    possibleTruncation: anyTruncation,
    queryDetails: queryDiagnostics
  };

  const finalRes = freshResult(GNEWS_SOURCE_NAME, latestObservedAt, allObservations, {
    itemCount: allObservations.length,
    diagnostics: compositeDiagnostics
  }, now);

  finalRes.domain = 'security';
  finalRes.diagnostics = compositeDiagnostics;
  return finalRes;
}
