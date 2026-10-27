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
  BIHARTORDA_PROFILE,
  ADMINISTRATIVE_LEVELS,
  LOCAL_RELEVANCE_REASONS
} from '../../lib/intelligence/territory.mjs';

export const SOURCE = 'Police-Hajdu';
export const FEED_URL = 'https://www.police.hu/hu/rss/Hajd%C3%BA-Bihar%20Megyei%20Rend%C5%91r-f%C5%91kapit%C3%A1nys%C3%A1g';
export const ROBOTS_TXT_URL = 'https://www.police.hu/robots.txt';

let cachedRobotsResult = null;
let cachedRobotsTime = 0;
export const ROBOTS_CACHE_TTL_MS = 24 * 3600 * 1000; // 24 hours

export function resetRobotsCache() {
  cachedRobotsResult = null;
  cachedRobotsTime = 0;
}

/**
 * Parses robots.txt text and checks if the target path is allowed for User-agent: * or Crucix.
 */
export function parseRobotsTxtPolicy(content, targetPath = '/hu/rss/Hajd%C3%BA-Bihar%20Megyei%20Rend%C5%91r-f%C5%91kapit%C3%A1nys%C3%A1g') {
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

  for (const a of allows) {
    if (a && (decodedPath.startsWith(a) || targetPath.startsWith(a))) {
      return { allowed: true, rule: `Allow: ${a}` };
    }
  }

  for (const d of disallows) {
    if (d === '/' || (d && (decodedPath.startsWith(d) || targetPath.startsWith(d)))) {
      return { allowed: false, rule: `Disallow: ${d}` };
    }
  }

  return { allowed: true };
}

/**
 * Checks robots.txt policy with 24-hour TTL caching and immediate retry on 403.
 */
export async function checkRobotsTxt(options = {}) {
  const now = options.now ?? Date.now();
  if (options.robotsDisallowed === true) {
    return { allowed: false, rule: 'Manual options.robotsDisallowed' };
  }
  if (options.robotsTxtContent) {
    return parseRobotsTxtPolicy(options.robotsTxtContent);
  }
  if (cachedRobotsResult && (now - cachedRobotsTime < ROBOTS_CACHE_TTL_MS)) {
    return cachedRobotsResult;
  }

  const fetcher = options.fetchFn ?? safeFetch;
  try {
    const res = await fetcher(ROBOTS_TXT_URL, {
      format: 'text',
      timeout: 10000,
      headers: { 'User-Agent': 'Crucix/2.2 (+https://github.com/WeirdProdigy/Crucix; local-hazard-monitor)' },
      retries: 0
    });
    if (res.status === 403 || res.status === 429) {
      // Do NOT permanently cache a 403 or 429 error, so subsequent calls can retry fetching
      return { allowed: false, rule: `HTTP ${res.status} accessing robots.txt`, transient: true };
    }
    if (res.rawText) {
      cachedRobotsResult = parseRobotsTxtPolicy(res.rawText);
      cachedRobotsTime = now;
      return cachedRobotsResult;
    }
  } catch {
    // network fallback
  }

  cachedRobotsResult = { allowed: true };
  cachedRobotsTime = now;
  return cachedRobotsResult;
}

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

export const AMBIGUOUS_SETTLEMENT_NAMES = new Set([
  'sap', 'told', 'bojt', 'darvas', 'ketertelmu', 'keterdelmu'
]);

/**
 * Complete KSH gazetteer of Hajdú-Bihar vármegye settlements.
 */
export const HAJDU_BIHAR_KSH_SETTLEMENTS = Object.freeze([
  { id: 'almosd', name: 'Álmosd' },
  { id: 'bagamer', name: 'Bagamér' },
  { id: 'bakonszeg', name: 'Bakonszeg' },
  { id: 'balmazujvaros', name: 'Balmazújváros' },
  { id: 'barand', name: 'Báránd' },
  { id: 'bedo', name: 'Bedő' },
  { id: 'berekboszormeny', name: 'Berekböszörmény' },
  { id: 'berettyoujfalu', name: 'Berettyóújfalu' },
  { id: 'bihardancshaza', name: 'Bihardancsháza' },
  { id: 'biharkeresztes', name: 'Biharkeresztes' },
  { id: 'biharnagybajom', name: 'Biharnagybajom' },
  { id: 'bihartorda', name: 'Bihartorda' },
  { id: 'bocskaikert', name: 'Bocskaikert' },
  { id: 'bojt', name: 'Bojt', ambiguous: true },
  { id: 'csokmo', name: 'Csökmő' },
  { id: 'darvas', name: 'Darvas', ambiguous: true },
  { id: 'debrecen', name: 'Debrecen' },
  { id: 'derecske', name: 'Derecske' },
  { id: 'ebes', name: 'Ebes' },
  { id: 'egyek', name: 'Egyek' },
  { id: 'esztar', name: 'Esztár' },
  { id: 'folyas', name: 'Folyás' },
  { id: 'foldes', name: 'Földes' },
  { id: 'fulop', name: 'Fülöp' },
  { id: 'gaborjan', name: 'Gáborján' },
  { id: 'gorbehaza', name: 'Görbeháza' },
  { id: 'hajdubagos', name: 'Hajdúbagos' },
  { id: 'hajduboszormeny', name: 'Hajdúböszörmény' },
  { id: 'hajdudorog', name: 'Hajdúdorog' },
  { id: 'hajduhadhaz', name: 'Hajdúhadház' },
  { id: 'hajdunanás', name: 'Hajdúnánás' },
  { id: 'hajdusamson', name: 'Hajdúsámson' },
  { id: 'hajduszoboszlo', name: 'Hajdúszoboszló' },
  { id: 'hajduszovat', name: 'Hajdúszovát' },
  { id: 'hencida', name: 'Hencida' },
  { id: 'hortobagy', name: 'Hortobágy' },
  { id: 'hosszupalyi', name: 'Hosszúpályi' },
  { id: 'kaba', name: 'Kaba' },
  { id: 'kismarja', name: 'Kismarja' },
  { id: 'komadi', name: 'Komádi' },
  { id: 'konyar', name: 'Konyár' },
  { id: 'korosszakal', name: 'Körösszakál' },
  { id: 'korosszegapati', name: 'Körösszegapáti' },
  { id: 'letavertes', name: 'Létavértes' },
  { id: 'magyarhomorog', name: 'Magyarhomorog' },
  { id: 'mezopeterd', name: 'Mezőpeterd' },
  { id: 'mezosas', name: 'Mezősas' },
  { id: 'mikepercs', name: 'Mikepércs' },
  { id: 'monostorpalyi', name: 'Monostorpályi' },
  { id: 'nadudvar', name: 'Nádudvar' },
  { id: 'nagyhegyes', name: 'Nagyhegyes' },
  { id: 'nagykereki', name: 'Nagykereki' },
  { id: 'nagyrabe', name: 'Nagyrábé' },
  { id: 'nyiracsad', name: 'Nyíracsád' },
  { id: 'nyiradony', name: 'Nyíradony' },
  { id: 'nyirabrany', name: 'Nyírábrány' },
  { id: 'nyirmartonfalva', name: 'Nyírmártonfalva' },
  { id: 'pocsaj', name: 'Pocsaj' },
  { id: 'polgar', name: 'Polgár' },
  { id: 'puspokladany', name: 'Püspökladány' },
  { id: 'sap', name: 'Sáp', ambiguous: true },
  { id: 'sarand', name: 'Sáránd' },
  { id: 'sarretudvari', name: 'Sárrétudvari' },
  { id: 'szentpeterszeg', name: 'Szentpéterszeg' },
  { id: 'szerep', name: 'Szerep' },
  { id: 'teglas', name: 'Téglás' },
  { id: 'tepe', name: 'Tépe' },
  { id: 'tetetlen', name: 'Tetétlen' },
  { id: 'tiszacsege', name: 'Tiszacsege' },
  { id: 'tiszagyulahaza', name: 'Tiszagyulaháza' },
  { id: 'told', name: 'Told', ambiguous: true },
  { id: 'ujiraz', name: 'Újiráz' },
  { id: 'ujleta', name: 'Újléta' },
  { id: 'ujszentmargita', name: 'Újszentmargita' },
  { id: 'ujtikos', name: 'Újtikos' },
  { id: 'vamospercs', name: 'Vámospércs' },
  { id: 'vancsad', name: 'Váncsod' },
  { id: 'vekerd', name: 'Vekerd' },
  { id: 'zsaka', name: 'Zsáka' }
]);

/**
 * Detects whether a known settlement in Hajdú-Bihar is mentioned in the news title.
 * CRITICAL RULE: A settlement match in police news text is ALWAYS classified as
 * text_mention (needsLocalReview: true, isConfirmedLocal: false).
 * It must NEVER be marked as confirmedLocal.
 * Ambiguous names yield territoryLevel: 'unknown'.
 */
export function detectSettlementMention(title, territoryConfig = DEFAULT_TERRITORY_CONFIG) {
  const normTitle = (typeof title === 'string' ? title : '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

  const primary = territoryConfig?.primary || BIHARTORDA_PROFILE;
  const countyCode = primary.countyCode || '09';
  const countyName = primary.countyName || 'Hajdú-Bihar';
  const nuts3 = primary.nuts3 || primary.nuts?.nuts3 || 'HU321';
  const nuts2 = primary.nuts2 || primary.nuts?.nuts2 || 'HU32';
  const nuts0 = primary.nuts0 || primary.nuts?.nuts0 || 'HU';
  const iso3 = primary.iso3 || 'HUN';

  // Check for ambiguous settlement names or explicit ambiguity marker
  for (const amb of AMBIGUOUS_SETTLEMENT_NAMES) {
    const ambRegex = new RegExp(`\\b${amb}\\b`, 'i');
    if (ambRegex.test(normTitle)) {
      return {
        territoryLevel: 'unknown',
        settlementId: null,
        settlementName: null,
        countyCode,
        countyName,
        nuts3,
        nuts2,
        nuts0,
        iso3,
        matchState: 'ambiguous',
        localRelevanceReason: 'ambiguous_text_mention',
        needsLocalReview: true,
        isConfirmedLocal: false
      };
    }
  }

  const candidateMap = new Map();

  // Add primary profile
  if (primary) {
    candidateMap.set(primary.id || 'bihartorda', { ...primary, id: primary.id || 'bihartorda' });
  }
  for (const w of territoryConfig?.watchedSettlements || []) {
    if (w?.id) candidateMap.set(w.id, w);
  }
  for (const k of territoryConfig?.keyCities || territoryConfig?.keyConnections || []) {
    if (k?.id) candidateMap.set(k.id, k);
  }
  // Add complete official KSH settlement register for Hajdú-Bihar
  for (const s of HAJDU_BIHAR_KSH_SETTLEMENTS) {
    if (!candidateMap.has(s.id)) {
      candidateMap.set(s.id, s);
    }
  }

  // Sort candidates by name length descending to match compound/longer names first
  const sortedCandidates = Array.from(candidateMap.values())
    .sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

  for (const cand of sortedCandidates) {
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
        countyCode,
        countyName,
        nuts3,
        nuts2,
        nuts0,
        iso3,
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
    countyCode,
    countyName,
    nuts3,
    nuts2,
    nuts0,
    iso3,
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
      observedAt: pubDate,
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

  // Source health is derived from the feed's own build/modified/harvest time, NOT from the latest item's age
  const observedAt = providerTime(options.lastModified) ||
    providerTime(channel.lastBuildDate) ||
    new Date(now).toISOString();

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
  const robots = await checkRobotsTxt(options);
  if (!robots.allowed) {
    return {
      source: SOURCE,
      status: 'disabled',
      disabled: true,
      technicalBlock: true,
      reason: `Technikai tiltás (robots.txt elutasítás: ${robots.rule || 'tiltott útvonal'}). Az adapter leállt.`,
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
