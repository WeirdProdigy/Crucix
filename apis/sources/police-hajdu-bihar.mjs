// Police.hu Hajdú-Bihar County Police Headquarters RSS adapter
// Source: https://www.police.hu/hu/rss/Hajd%C3%BA-Bihar%20Megyei%20Rend%C5%91r-f%C5%91kapit%C3%A1nys%C3%A1g
//
// Tárolási és működési szabályok:
// 1. Tárolt mezők: cím, link, UTC időbélyeg (pubDate / publishedAt), guid, szekció (URL-útvonalból),
//    forrásmegjelölés (Police-Hajdu), és saját kinyerésű tények (településnév, útszám, eseménytípus).
// 2. A description szövege és a lead NEM kerül tárolásra (szerzői jogi és adatvédelmi védelem).
// 3. Nincs engedélykérés, nincs levélváltás: ami technikailag vagy a nyilvános feltételek szerint
//    nem használható, az kimarad.
// 4. Technikai tiltás (robots.txt, 403, 429, WAF) esetén az adapter leáll, és disabled státuszt
//    jelez; semmilyen megkerülés vagy kikerülési kísérlet nincs.
// 5. Alapállapot: kikapcsolt, külön környezeti változóval (CRUCIX_ENABLE_POLICE_HAJDU=true) engedélyezhető.
// 6. HAON és Hírstart adapter NEM készül.
// 7. A felületen mindig látszik a forrás neve és a link.

import { createHash } from 'node:crypto';
import { safeFetch } from '../utils/fetch.mjs';
import { parseXml } from '../utils/xml.mjs';
import { providerTime, freshResult, unavailableResult } from '../utils/freshness.mjs';
import {
  DEFAULT_TERRITORY_CONFIG,
  ADMINISTRATIVE_LEVELS,
  LOCAL_RELEVANCE_REASONS
} from '../../lib/intelligence/territory.mjs';

export const SOURCE = 'Police-Hajdu';
export const FEED_URL = 'https://www.police.hu/hu/rss/Hajd%C3%BA-Bihar%20Megyei%20Rend%C5%91r-f%C5%91kapit%C3%A1nys%C3%A1g';

export const META = Object.freeze({
  feedUrl: FEED_URL,
  attribution: 'Országos Rendőr-főkapitányság / Hajdú-Bihar VMRFK (police.hu)',
  license: 'Közérdekű tájékoztatás (a leírás és a lead szövege kizárva; kizárólag cím, metaadatok és saját kinyerésű tények)',
  legalStatus: 'opt-in; nyilvános feltételek szerint csak a metaadatok és kinyert tények kerülnek átvételre (nincs levélváltás vagy engedélykérés)',
  robotsTxtUrl: 'https://www.police.hu/robots.txt',
  robotsTxtPolicy: 'User-agent: * Allow: /',
  coverage: 'Hajdú-Bihar vármegyei rendőrségi hírek, közlemények, baleseti információk és felhívások',
  rights: 'A police.hu weboldalon közzétett cikkek szövege és leírása szerzői jogvédelem alatt áll; kizárólag a hivatalos metaadatok, a szekcióbesorolás és saját kinyerésű tények kerülnek rögzítésre.'
});

function clean(val, max = 300) {
  if (typeof val !== 'string') return '';
  return val
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Extracts news section from police.hu article URL.
 * Recognized sections:
 * - kozrendvedelem
 * - baleseti-hirek
 * - bunugyek
 * - felhivasok
 */
export function extractSection(url) {
  if (typeof url !== 'string' || !url.trim()) return 'egyeb';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.includes('baleseti-hirek')) return 'baleseti-hirek';
    if (path.includes('kozrendvedelem')) return 'kozrendvedelem';
    if (path.includes('bunugyek')) return 'bunugyek';
    if (path.includes('felhivasok')) return 'felhivasok';
    if (path.includes('utinfo')) return 'utinfo';
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2) {
      return segments[segments.length - 2];
    }
    return 'hirek';
  } catch {
    return 'egyeb';
  }
}

/**
 * Extracts road / highway route number from news title.
 * Examples: "47-es főúton" -> "47", "M35 autópályán" -> "M35", "4-es főút" -> "4"
 */
export function extractRouteNumber(title) {
  if (typeof title !== 'string' || !title.trim()) return null;
  const match = title.match(/\b(M\d+|\d{1,4})(?:-[eaöoe]s|-s)?\s*(?:főút(?:on)?|autópály(?:a|án)|út(?:on)?)\b/i) ||
                title.match(/\b(M\d+)\b/i) ||
                title.match(/\b(\d{1,4})-[eaöoe]s\b/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extracts normalized event type from title and section.
 * Types: baleset, bunugy, felhivas, kozrendvedelem, forgalomkorlatozas, egyeb
 */
export function extractEventType(title, section = '') {
  const normTitle = (typeof title === 'string' ? title : '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const normSec = (typeof section === 'string' ? section : '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

  if (normSec.includes('baleset') || /baleset|utkozes|felborult|karambol|gazolas/.test(normTitle)) {
    return 'baleset';
  }
  if (normSec.includes('bunugy') || /bunugy|orizet|lopas|rablas|betores|elfog|koroz|csalas/.test(normTitle)) {
    return 'bunugy';
  }
  if (normSec.includes('felhivas') || /felhivas|eltunt|keresi|szemtanu/.test(normTitle)) {
    return 'felhivas';
  }
  if (normSec.includes('kozrend') || /kozrend|ellenorzes|fokozott|razzia/.test(normTitle)) {
    return 'kozrendvedelem';
  }
  if (/utlezaras|forgalomkorlatozas|tereles/.test(normTitle)) {
    return 'forgalomkorlatozas';
  }
  return 'egyeb';
}

/**
 * Detects whether a known settlement in Hajdú-Bihar is mentioned in the news title.
 * CRITICAL RULE: A settlement match in police news text is ALWAYS classified as
 * text_mention (needsLocalReview: true, isConfirmedLocal: false).
 * It must NEVER be marked as confirmedLocal.
 */
export function detectSettlementMention(title, territoryConfig = DEFAULT_TERRITORY_CONFIG) {
  const normTitle = (typeof title === 'string' ? title : '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

  const candidates = [];
  if (territoryConfig?.primary) {
    candidates.push({ ...territoryConfig.primary, id: territoryConfig.primary.id || 'bihartorda' });
  }
  for (const w of territoryConfig?.watchedSettlements || []) {
    candidates.push(w);
  }
  for (const k of territoryConfig?.keyCities || territoryConfig?.keyConnections || []) {
    candidates.push(k);
  }
  // Common Hajdú-Bihar towns often appearing in county police feeds
  const extraTowns = [
    { id: 'derecske', name: 'Derecske', kshSettlement: '03728' },
    { id: 'berettyoujfalu', name: 'Berettyóújfalu', kshSettlement: '21056' }
  ];
  for (const t of extraTowns) {
    if (!candidates.some(c => c.id === t.id)) candidates.push(t);
  }

  for (const cand of candidates) {
    const normName = (cand.name || '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    if (normName.length >= 4 && normTitle.includes(normName)) {
      return {
        territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
        settlementId: cand.id,
        settlementName: cand.name,
        kshSettlementCode: cand.kshSettlement || null,
        countyCode: '09',
        countyName: 'Hajdú-Bihar',
        nuts3: 'HU321',
        nuts2: 'HU32',
        nuts0: 'HU',
        iso3: 'HUN',
        matchState: 'match',
        localRelevanceReason: LOCAL_RELEVANCE_REASONS.TEXT_MENTION,
        needsLocalReview: true,
        isConfirmedLocal: false // STRICT REQUIREMENT: never confirmed local!
      };
    }
  }

  // Default to county level Hajdú-Bihar
  return {
    territoryLevel: ADMINISTRATIVE_LEVELS.COUNTY,
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    nuts3: 'HU321',
    nuts2: 'HU32',
    nuts0: 'HU',
    iso3: 'HUN',
    matchState: 'match',
    isConfirmedLocal: false
  };
}

/**
 * Parses police.hu RSS feed XML.
 * Strictly ignores <description> and lead text to adhere to copyright boundaries.
 * Extracts explicit facts: settlement, routeNumber, eventType.
 */
export function parsePoliceRss(xml, options = {}) {
  const now = options.now ?? Date.now();
  const territoryConfig = options.territoryConfig ?? DEFAULT_TERRITORY_CONFIG;

  if (!xml || typeof xml !== 'string') {
    return unavailableResult(SOURCE, 'Üres vagy érvénytelen RSS XML', META, now);
  }

  let parsed;
  try {
    parsed = parseXml(xml);
  } catch (err) {
    return unavailableResult(SOURCE, `XML értelmezési hiba: ${err.message}`, META, now);
  }

  const channel = parsed?.rss?.channel;
  if (!channel || typeof channel !== 'object') {
    return unavailableResult(SOURCE, 'Érvénytelen police.hu RSS csatorna struktúra', META, now);
  }

  const channelPubDate = providerTime(channel.pubDate);
  const rawItems = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);

  const observations = [];
  const seenKeys = new Set();

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const title = clean(item.title, 300);
    const link = clean(typeof item.link === 'string' ? item.link : (item.link?.['#text'] || ''), 500);
    const rawGuid = clean(typeof item.guid === 'string' ? item.guid : (item.guid?.['#text'] || link), 500);
    const pubDate = providerTime(item.pubDate);

    if (!title || !link) continue;

    // Deduplication by guid and link
    const dedupeKey = `${rawGuid}|${link}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const section = extractSection(link);
    const territory = detectSettlementMention(title, territoryConfig);
    const routeNumber = extractRouteNumber(title);
    const eventType = extractEventType(title, section);
    const settlement = territory.settlementName || null;

    const id = `police-hajdu-${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 16)}`;

    // Strictly omit description / lead text; store authentic source, metadata and extracted facts
    const observation = {
      id,
      source: SOURCE,
      title,
      link,
      pubDate,
      publishedAt: pubDate,
      guid: rawGuid,
      section,
      settlement,
      routeNumber,
      eventType,
      facts: {
        settlement,
        routeNumber,
        eventType
      },
      territory
    };

    observations.push(observation);
  }

  const observedAt = channelPubDate || observations[0]?.publishedAt || new Date(now).toISOString();

  return freshResult(SOURCE, observedAt, observations, {
    ...META,
    examinedCount: rawItems.length,
    acceptedCount: observations.length
  }, now);
}

/**
 * Briefing harvester for police.hu Hajdú-Bihar feed.
 * OPT-IN: Disabled by default. Enabled only when CRUCIX_ENABLE_POLICE_HAJDU === 'true'
 * or options.enabled === true.
 *
 * TECHNICAL BLOCK HANDLING:
 * On robots.txt block, HTTP 403, 429, WAF or rate limiting, the adapter halts immediately
 * without retry or bypass, returning status: 'disabled'.
 */
export async function briefing(options = {}) {
  const now = options.now ?? Date.now();
  const isOptIn = options.enabled ?? (process.env.CRUCIX_ENABLE_POLICE_HAJDU === 'true');

  if (!isOptIn) {
    return {
      source: SOURCE,
      status: 'disabled',
      disabled: true,
      legalStatus: META.legalStatus,
      reason: 'Élő hálózati lekérés letiltva: opt-in forrás. Engedélyezéshez állítsa be a CRUCIX_ENABLE_POLICE_HAJDU=true környezeti változót.',
      observations: []
    };
  }

  // Explicit robots.txt blockage check
  if (options.robotsDisallowed) {
    return {
      source: SOURCE,
      status: 'disabled',
      disabled: true,
      technicalBlock: true,
      reason: 'Technikai tiltás (robots.txt elutasítás) észlelve. Az adapter azonnal leállt, megkerülés nélkül.',
      observations: []
    };
  }

  if (options.fixtureXml) {
    return parsePoliceRss(options.fixtureXml, { now, territoryConfig: options.territoryConfig });
  }

  const timeout = Math.max(1, Math.min(30000, Number(options.timeout) || 15000));
  const headers = {
    'User-Agent': 'Crucix/2.2 (+https://github.com/WeirdProdigy/Crucix; local-hazard-monitor)'
  };
  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.ifModifiedSince) headers['If-Modified-Since'] = options.ifModifiedSince;

  const fetcher = options.fetchFn ?? safeFetch;
  const res = await fetcher(FEED_URL, {
    format: 'text',
    maxBytes: 2 * 1024 * 1024,
    timeout,
    headers,
    retries: 0 // Do not retry blindly on potential technical blocks
  });

  // Check for technical blocks (403, 429, WAF, rate limit, forbidden)
  const isTechnicalBlock = res.status === 403 ||
    res.status === 429 ||
    /403|429|waf|forbidden|blocked|rate\s*limit|access\s*denied/i.test(String(res.error || ''));

  if (isTechnicalBlock) {
    return {
      source: SOURCE,
      status: 'disabled',
      disabled: true,
      technicalBlock: true,
      reason: `Technikai tiltás vagy hozzáférési korlátozás észlelve (${res.status ? 'HTTP ' + res.status : res.error}). Az adapter automatikus megkerülés nélkül leállt.`,
      observations: []
    };
  }

  if (res.status === 304 || res.error?.includes('304')) {
    return {
      source: SOURCE,
      status: 'ok',
      notModified: true,
      timestamp: new Date(now).toISOString(),
      observations: []
    };
  }

  if (res.error) {
    return unavailableResult(SOURCE, res.error, META, now);
  }

  return parsePoliceRss(res.rawText, {
    now,
    territoryConfig: options.territoryConfig
  });
}
