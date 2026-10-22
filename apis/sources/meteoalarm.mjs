// Maintained country Atom feeds; CAP links are attribution links, never extra fetch targets.
import { safeFetch } from '../utils/fetch.mjs';
import { parseXml } from '../utils/xml.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';
import { matchTerritory, DEFAULT_TERRITORY_CONFIG } from '../../lib/intelligence/territory.mjs';

const SOURCE = 'Meteoalarm';
const BASE = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-';
const COUNTRIES = Object.freeze({
  andorra:'Andorra', austria:'Austria', belgium:'Belgium', 'bosnia-herzegovina':'Bosnia and Herzegovina',
  bulgaria:'Bulgaria', croatia:'Croatia', cyprus:'Cyprus', czechia:'Czech Republic', denmark:'Denmark',
  estonia:'Estonia', finland:'Finland', france:'France', germany:'Germany', greece:'Greece', hungary:'Hungary',
  iceland:'Iceland', ireland:'Ireland', israel:'Israel', italy:'Italy', latvia:'Latvia', lithuania:'Lithuania',
  luxembourg:'Luxembourg', malta:'Malta', moldova:'Moldova', montenegro:'Montenegro', netherlands:'Netherlands',
  norway:'Norway', poland:'Poland', portugal:'Portugal', 'republic-of-north-macedonia':'North Macedonia',
  romania:'Romania', serbia:'Serbia', slovakia:'Slovakia', slovenia:'Slovenia', spain:'Spain', sweden:'Sweden',
  switzerland:'Switzerland', ukraine:'Ukraine', 'united-kingdom':'United Kingdom',
});
const META = { feedUrl:'https://feeds.meteoalarm.org/', attribution:'Meteoalarm / EUMETNET and the issuing national meteorological services',
  licenseUrl:'https://creativecommons.org/licenses/by/4.0/', coverage:'Selected national weather warning feeds; this is not complete European coverage.' };
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];

function text(value, limit = 1000) {
  const raw = typeof value === 'string' ? value : !Array.isArray(value) && typeof value?.['#text'] === 'string' ? value['#text'] : null;
  return raw === null ? null : raw.trim().slice(0,limit);
}

function externalUrl(value) {
  if (typeof value !== 'string' || value.length>2000) return null;
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
}

function coordinates(entry) {
  const raw = text(entry.point ?? entry['georss:point']);
  if (raw === null || raw === '') return {};
  const pair = raw.split(/\s+/);
  if (pair.length!==2 || pair.some(v=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v))) return null;
  const [lat,lon] = pair.map(Number);
  return lat>=-90 && lat<=90 && lon>=-180 && lon<=180
    ? { lat,lon,locationMethod:'provider',locationPrecision:'exact' } : null;
}

/**
 * Extracts referenced alert IDs from a CAP references field.
 * Format: space-separated "sender,identifier,sent" triples.
 */
export function extractReferencedIds(rawReferences) {
  const raw = text(rawReferences, 2000);
  if (!raw) return [];
  const tokens = raw.split(/\s+/).filter(Boolean);
  const ids = [];
  for (const token of tokens) {
    const parts = token.split(',');
    if (parts.length >= 2 && parts[1]) ids.push(parts[1]);
    else if (token) ids.push(token);
  }
  return ids;
}

/**
 * Computes the lifecycle state of a weather warning.
 * Distinct states: 'future', 'active', 'expired', 'cancelled', 'superseded', 'unknown'.
 */
export function determineLifecycleStatus({ msgType, startsAt, validUntil, cancelled = false, superseded = false, now = Date.now() }) {
  const type = (msgType || '').toLowerCase();
  if (type === 'cancel' || cancelled) return 'cancelled';
  if (superseded) return 'superseded';
  const nowMs = typeof now === 'number' ? now : Date.now();
  const startsMs = startsAt ? Date.parse(startsAt) : null;
  const validMs = validUntil ? Date.parse(validUntil) : null;
  if (validMs && nowMs >= validMs) return 'expired';
  if (startsMs && nowMs < startsMs) return 'future';
  if (startsMs || validMs) return 'active';
  return 'unknown';
}

/**
 * Extracts normalized geocodes array from an entry or info block.
 */
function extractGeocodes(entry) {
  const raw = list(entry.geocode);
  const geocodes = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const valueName = text(item.valueName, 100);
    const value = text(item.value, 100);
    if (valueName && value) geocodes.push({ valueName, value });
  }
  return geocodes;
}

/**
 * Normalizes one Atom entry or direct CAP alert into a structured warning object.
 */
function warning(entry, country, now, territoryConfig) {
  if (!entry || typeof entry!=='object' || Array.isArray(entry)) return null;

  const status = text(entry.status)?.toLowerCase();
  // Filter Test, Exercise, Draft, and non-Actual messages
  if (status !== 'actual') return null;

  const scope = text(entry.scope)?.toLowerCase();
  if (entry.scope !== undefined && scope !== 'public') return null;

  const msgType = text(entry.message_type ?? entry.msgType, 50) || 'Alert';
  const isCancel = msgType.toLowerCase() === 'cancel';

  const observedAt = providerTime(text(entry.updated ?? entry.sent));
  const publishedAt = providerTime(text(entry.published ?? entry.sent));
  const validUntil = providerTime(text(entry.expires));
  const startsAt = providerTime(text(entry.onset ?? entry.effective));

  // Provider freshness validation (entry cannot be older than observationMaxAgeMs or in future)
  if (!freshness(observedAt, POLICIES[SOURCE].observationMaxAgeMs, now).fresh || !publishedAt || Date.parse(publishedAt) > now + 300000) {
    return null;
  }

  // Missing official onset/effective when supplied as invalid text
  if ((entry.onset !== undefined || entry.effective !== undefined) && !startsAt) {
    return null;
  }

  // Note on expiration:
  // If entry.expires was supplied but is invalid timestamp, reject it
  if (entry.expires !== undefined && text(entry.expires) && !validUntil) {
    return null;
  }

  // For active warnings in live sweep: if validUntil is given and expired, or cancel, determine lifecycle
  const lifecycle = determineLifecycleStatus({
    msgType,
    startsAt,
    validUntil,
    cancelled: isCancel,
    now
  });

  const title = text(entry.title, 500) || `${text(entry.event, 200)} warning for ${COUNTRIES[country] || country}`;
  const providerId = text(entry.identifier ?? entry.id, 1000);
  const point = coordinates(entry);
  if (!title || !providerId || point === null) return null;

  const links = list(entry.link);
  const htmlLink = links.find(link => link && typeof link === 'object' && link['@_type'] !== 'application/cap+xml'
    && link['@_rel'] !== 'related' && link['@_rel'] !== 'self' && externalUrl(link['@_href']));
  const capLink = links.find(link => link && typeof link === 'object' && link['@_type'] === 'application/cap+xml'
    && externalUrl(link['@_href']));
  const webLink = externalUrl(text(entry.web));

  const area = text(entry.areaDesc, 400);
  const event = text(entry.event, 400);
  const geocodes = extractGeocodes(entry);

  // Extract raw awareness level and awareness type
  let awarenessLevel = null;
  let awarenessType = null;
  const rawParams = list(entry.parameter);
  for (const p of rawParams) {
    const vn = text(p?.valueName, 100);
    const v = text(p?.value, 200);
    if (vn === 'awareness_level') awarenessLevel = v;
    else if (vn === 'awareness_type') awarenessType = v;
  }

  // Territorial matching against Bihartorda profile
  const territory = matchTerritory(geocodes, area, territoryConfig);

  const rawRefs = text(entry.references, 2000);
  const referencedIds = extractReferencedIds(rawRefs);
  const chainKey = referencedIds.length > 0 ? referencedIds[0] : providerId;

  return {
    kind: 'weather',
    title,
    summary: [event, area, startsAt && Date.parse(startsAt) > now ? `Warning valid from ${startsAt}` : null].filter(Boolean).join(' — ') || title,
    source: SOURCE,
    url: externalUrl(htmlLink?.['@_href']) || 'https://meteoalarm.org/',
    capUrl: externalUrl(capLink?.['@_href']) || null,
    webUrl: webLink || null,
    providerId,
    chainKey,
    observedAt,
    publishedAt,
    validUntil: validUntil || null,
    ...(startsAt ? { startsAt } : {}),
    country: COUNTRIES[country] || country,
    sourceRegion: country === 'hungary' ? 'Hungary' : undefined,
    ...(area ? { area } : {}),
    ...(text(entry.severity, 100) ? { severity: text(entry.severity, 100) } : {}),
    ...(text(entry.urgency, 100) ? { urgency: text(entry.urgency, 100) } : {}),
    ...(text(entry.certainty, 100) ? { certainty: text(entry.certainty, 100) } : {}),
    status: text(entry.status, 50) || 'Actual',
    scope: text(entry.scope, 50) || 'Public',
    msgType,
    ...(rawRefs ? { references: rawRefs, referencedIds } : {}),
    ...(awarenessLevel ? { awarenessLevel } : {}),
    ...(awarenessType ? { awarenessType } : {}),
    geocodes,
    territory,
    lifecycle,
    ...point
  };
}

/**
 * Resolves Alert -> Update -> Cancel chains across warning rows.
 * Updates superseded entries and links message identities.
 */
export function resolveWarningChains(warnings = []) {
  if (!Array.isArray(warnings)) return [];
  const byId = new Map();
  for (const w of warnings) byId.set(w.providerId, w);

  for (const w of warnings) {
    if (Array.isArray(w.referencedIds) && w.referencedIds.length > 0) {
      for (const refId of w.referencedIds) {
        const target = byId.get(refId);
        if (target) {
          if (w.msgType?.toLowerCase() === 'cancel') {
            target.lifecycle = 'cancelled';
            target.cancelledBy = w.providerId;
          } else if (w.msgType?.toLowerCase() === 'update') {
            target.lifecycle = 'superseded';
            target.supersededBy = w.providerId;
          }
          w.chainKey = target.chainKey || target.providerId;
        }
      }
    }
  }
  return warnings;
}

export function parseMeteoalarm(xml, { country = 'hungary', now = Date.now(), recordLimit = 500, territoryConfig, includeAllLifecycles = false } = {}) {
  const meta = { ...META, country: COUNTRIES[country] || country, feedUrl: `${BASE}${country}` };
  try {
    if (!Object.hasOwn(COUNTRIES, country)) throw new Error('Unsupported Meteoalarm country');
    const parsed = parseXml(xml);
    const feed = parsed.feed ?? (parsed.alert ? { entry: [parsed.alert] } : null);
    if (!feed || typeof feed !== 'object' || Array.isArray(feed)) throw new Error('Invalid Meteoalarm Atom feed');

    const entries = list(feed.entry);
    const limit = Math.max(0, Math.min(500, Math.floor(Number(recordLimit) || 500)));
    const examined = entries.slice(0, limit);

    const allRows = examined.map(entry => warning(entry, country, now, territoryConfig)).filter(Boolean);
    const resolvedRows = resolveWarningChains(allRows);

    // Active rows for public observation (excludes cancelled, superseded, or expired unless requested)
    const rows = includeAllLifecycles
      ? resolvedRows
      : resolvedRows.filter(row => {
          if (row.lifecycle === 'cancelled' || row.lifecycle === 'superseded') return false;
          if (row.validUntil && Date.parse(row.validUntil) <= now) return false;
          return true;
        });

    const rights = text(feed.rights, 1500) || 'Terms equivalent to CC BY 4.0, with additional redistribution requirements in Meteoalarm Terms and Conditions.';
    const feedUpdated = providerTime(text(feed.updated ?? feed.sent ?? entries[0]?.updated ?? entries[0]?.sent));

    const out = freshResult(SOURCE, feedUpdated, rows, {
      ...meta,
      rights,
      examinedRecords: examined.length,
      truncatedRecords: Math.max(0, entries.length - limit) + Math.max(0, rows.length - 100)
    }, now);

    return {
      ...out,
      rejectedObservations: examined.length - out.observations.length,
      allObservations: resolvedRows,
      summary: out.status === 'ok' && !out.observations.length
        ? examined.length
          ? `No verified recent warnings among ${examined.length} ${COUNTRIES[country]} Meteoalarm records; all records excluded.`
          : `No active warnings in the watched ${COUNTRIES[country]} Meteoalarm feed.`
        : out.status === 'stale'
          ? 'Provider feed time is unknown, in the future, or older than the freshness limit.'
          : `${out.observations.length} recent weather warnings in ${COUNTRIES[country]}.`
    };
  } catch (error) {
    return unavailableResult(SOURCE, error.message, meta, now);
  }
}

export async function briefing(options = {}) {
  const now = options.now ?? Date.now();
  const countries = options.countries ?? ['hungary', 'austria'];
  if (!Array.isArray(countries) || !countries.length || countries.length > 4
      || countries.some(country => typeof country !== 'string' || !Object.hasOwn(COUNTRIES, country))) {
    return unavailableResult(SOURCE, 'Expected 1–4 official Meteoalarm country slugs', META, now);
  }
  const selected = [...new Set(countries)];
  const results = await Promise.all(selected.map(async country => {
    const data = await safeFetch(`${BASE}${country}`, {
      format: 'text',
      maxBytes: 2 * 1024 * 1024,
      timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)),
      retries: options.retries === 1 ? 1 : 0
    });
    return data.error
      ? unavailableResult(SOURCE, data.error, { ...META, country: COUNTRIES[country], feedUrl: `${BASE}${country}` }, now)
      : parseMeteoalarm(data.rawText, { country, now, recordLimit: Math.floor(500 / selected.length), territoryConfig: options.territoryConfig });
  }));

  const countryFeeds = results.map(result => ({
    country: result.country,
    feedUrl: result.feedUrl,
    status: result.status,
    observedAt: result.observedAt,
    warnings: result.observations.length,
    ...(result.error ? { error: result.error } : {})
  }));

  const fresh = results.filter(result => result.status === 'ok');
  const meta = {
    ...META,
    countries: selected.map(country => COUNTRIES[country]),
    countryFeeds,
    partial: results.some(result => result.status !== 'ok'),
    rights: [...new Set(results.map(result => result.rights).filter(Boolean))].join(' ')
  };

  if (!fresh.length && results.some(result => result.status === 'error')) {
    return unavailableResult(SOURCE, results.filter(result => result.error).map(result => `${result.country}: ${result.error}`).join('; '), meta, now);
  }

  const observedAt = (fresh.length ? fresh : results).map(result => result.observedAt).filter(Boolean).sort()[0] || null;
  const out = freshResult(SOURCE, observedAt, fresh.flatMap(result => result.observations), meta, now);
  const examinedRecords = results.reduce((n, result) => n + (result.examinedRecords || 0), 0);

  return {
    ...out,
    examinedRecords,
    rejectedObservations: results.reduce((n, result) => n + (result.rejectedObservations || 0), 0) + Math.max(0, fresh.reduce((n, result) => n + result.observations.length, 0) - out.observations.length),
    summary: !fresh.length
      ? 'Watched national feeds have no verified fresh provider timestamp.'
      : !out.observations.length
        ? examinedRecords
          ? `No verified recent warnings among ${examinedRecords} watched Meteoalarm records; all records excluded.${meta.partial ? ' Coverage is partial.' : ''}`
          : `No active warnings in the watched Meteoalarm feeds: ${fresh.map(result => result.country).join(', ')}.${meta.partial ? ' Some watched feeds are unavailable or stale.' : ''}`
        : `${out.observations.length} recent weather warnings across watched national feeds.${meta.partial ? ' Coverage is partial.' : ''}`
  };
}
