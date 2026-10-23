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
 * Extracts structured referenced alert objects from a CAP references field.
 * Format: space-separated "sender,identifier,sent" triples (CAP 1.2 standard).
 */
export function parseCapReferences(rawReferences) {
  const raw = text(rawReferences, 2000);
  if (!raw) return [];
  const tokens = raw.split(/\s+/).filter(Boolean);
  const refs = [];
  for (const token of tokens) {
    const parts = token.split(',');
    if (parts.length >= 3) {
      refs.push({
        sender: parts[0].trim(),
        identifier: parts[1].trim(),
        sent: parts[2].trim(),
        raw: token
      });
    } else if (parts.length === 2) {
      refs.push({
        sender: parts[0].trim(),
        identifier: parts[1].trim(),
        sent: null,
        raw: token
      });
    } else if (token) {
      refs.push({
        sender: null,
        identifier: token.trim(),
        sent: null,
        raw: token
      });
    }
  }
  return refs;
}

/**
 * Extracts referenced alert IDs from a CAP references field.
 */
export function extractReferencedIds(rawReferences) {
  return parseCapReferences(rawReferences).map(r => r.identifier).filter(Boolean);
}

/**
 * Computes the official provider lifecycle state of a weather warning per CAP specification.
 * Distinct states: 'future', 'active', 'expired', 'cancelled', 'superseded'.
 * Note: Exceeding local freshness limits does not alter the provider's lifecycle state.
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
  return 'active';
}

/**
 * Checks local data freshness policy for warnings, especially those lacking official expires.
 * - When validUntil is null, the warning is subject to a 24-hour local freshness threshold.
 * - Under 24h: freshnessStatus = 'fresh', label = 'A kibocsátó nem adott meg lejáratot.'
 * - Over 24h: freshnessStatus = 'stale', isFreshnessLimitExceeded = true,
 *   label = 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.'
 */
export function checkFreshnessPolicy({ validUntil, publishedAt, startsAt, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000 }) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  if (validUntil) {
    const validMs = Date.parse(validUntil);
    const isExpired = Number.isFinite(validMs) && nowMs >= validMs;
    return {
      hasExplicitExpires: true,
      freshnessStatus: isExpired ? 'expired' : 'fresh',
      isFreshnessLimitExceeded: false,
      freshnessReason: isExpired ? 'Hivatalos lejárati idő letelt.' : 'Hivatalos érvényességi időn belül.',
      validityLabel: validUntil
    };
  }

  const baseline = publishedAt || startsAt;
  const baselineMs = baseline ? Date.parse(baseline) : null;
  const ageMs = baselineMs ? Math.max(0, nowMs - baselineMs) : 0;
  const isFreshnessLimitExceeded = baselineMs ? ageMs >= maxAgeMs : false;

  return {
    hasExplicitExpires: false,
    freshnessStatus: isFreshnessLimitExceeded ? 'stale' : 'fresh',
    isFreshnessLimitExceeded,
    freshnessLimitExpiresAt: baselineMs ? new Date(baselineMs + maxAgeMs).toISOString() : null,
    freshnessReason: isFreshnessLimitExceeded
      ? 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.'
      : 'A kibocsátó nem adott meg lejáratot.',
    validityLabel: isFreshnessLimitExceeded
      ? 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.'
      : 'A kibocsátó nem adott meg lejáratot.'
  };
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

  const freshnessPolicy = checkFreshnessPolicy({
    validUntil,
    publishedAt,
    startsAt,
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
  const parsedReferences = parseCapReferences(rawRefs);
  const referencedIds = parsedReferences.map(r => r.identifier).filter(Boolean);
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
    ...(validUntil ? { validUntil } : {}),
    hasExplicitExpires: freshnessPolicy.hasExplicitExpires,
    freshnessStatus: freshnessPolicy.freshnessStatus,
    isFreshnessLimitExceeded: freshnessPolicy.isFreshnessLimitExceeded,
    freshnessReason: freshnessPolicy.freshnessReason,
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
    sender: text(entry.sender, 200) || 'meteoalarm.org',
    sent: text(entry.sent, 200) || publishedAt,
    ...(rawRefs ? { references: rawRefs, parsedReferences, referencedIds } : {}),
    ...(awarenessLevel ? { awarenessLevel } : {}),
    ...(awarenessType ? { awarenessType } : {}),
    geocodes,
    territory,
    lifecycle,
    facts: [
      { label: 'territory', value: area || territory?.areaDesc || 'Unknown area' },
      { label: 'matchState', value: territory?.matchState || 'unknown' },
      { label: 'lifecycle', value: lifecycle },
      { label: 'freshnessStatus', value: freshnessPolicy.freshnessStatus },
      ...(awarenessLevel ? [{ label: 'awarenessLevel', value: awarenessLevel }] : []),
      { label: 'validity', value: freshnessPolicy.validityLabel },
      ...(freshnessPolicy.isFreshnessLimitExceeded ? [{ label: 'freshnessReason', value: freshnessPolicy.freshnessReason }] : []),
      { label: 'isConfirmedLocal', value: Boolean(territory?.isConfirmedLocal) },
    ],
    ...point
  };
}

/**
 * Resolves Alert -> Update -> Cancel chains across warning rows and persistent history.
 * Supports triple matching (sender, identifier, sent) per CAP 1.2 standard.
 */
export function resolveWarningChains(warnings = [], { history = null, now = Date.now() } = {}) {
  if (!Array.isArray(warnings)) return [];
  const byId = new Map();
  const byTriple = new Map();

  const register = (item) => {
    if (!item || typeof item !== 'object') return;
    if (item.providerId) byId.set(item.providerId, item);
    if (item.id) byId.set(item.id, item);
    const sender = item.sender || item.source?.name || item.source;
    const sent = item.sent || item.publishedAt;
    if (item.providerId && sender && sent) {
      byTriple.set(`${sender},${item.providerId},${sent}`, item);
    }
  };

  // 1. Index history if provided (HistoryStore or Map or Array) with full pagination
  if (history) {
    if (typeof history.query === 'function') {
      try {
        let offset = 0;
        while (true) {
          const qRes = history.query({ limit: 200, offset });
          const items = qRes?.items || [];
          for (const h of items) register(h);
          offset += items.length;
          if (!items.length || offset >= (qRes?.total || 0)) break;
        }
      } catch {}
    } else if (typeof history.list === 'function') {
      try { for (const h of history.list()) register(h); } catch {}
    } else if (typeof history.values === 'function') {
      for (const h of history.values()) register(h);
    } else if (Array.isArray(history)) {
      for (const h of history) register(h);
    }
  }

  // 2. Index current batch
  for (const w of warnings) register(w);

  // 3. Resolve incoming references
  for (const w of warnings) {
    const refs = Array.isArray(w.parsedReferences) ? w.parsedReferences : parseCapReferences(w.references);
    for (const ref of refs) {
      let target = null;
      if (ref.sender && ref.identifier && ref.sent) {
        target = byTriple.get(`${ref.sender},${ref.identifier},${ref.sent}`) || null;
      } else if (ref.identifier) {
        const candidate = byId.get(ref.identifier);
        if (candidate) {
          const candSender = candidate.sender || candidate.source?.name || candidate.source;
          const candSent = candidate.sent || candidate.publishedAt;
          const senderConflict = Boolean(ref.sender && candSender && ref.sender.trim() !== String(candSender).trim());
          const sentConflict = Boolean(
            ref.sent && candSent &&
            ref.sent.trim() !== String(candSent).trim() &&
            Number.isFinite(Date.parse(ref.sent)) &&
            Number.isFinite(Date.parse(candSent)) &&
            Date.parse(ref.sent) !== Date.parse(candSent)
          );
          if (!senderConflict && !sentConflict) {
            target = candidate;
          }
        }
      }
      if (target) {
        const nowIso = new Date(now).toISOString();
        if (w.msgType?.toLowerCase() === 'cancel') {
          target.lifecycle = 'cancelled';
          target.cancelled = true;
          target.cancelledBy = w.providerId;
          target.collectedAt = nowIso;
          if (history && typeof history.add === 'function') history.add([target]);
        } else if (w.msgType?.toLowerCase() === 'update') {
          target.lifecycle = 'superseded';
          target.superseded = true;
          target.supersededBy = w.providerId;
          target.collectedAt = nowIso;
          if (history && typeof history.add === 'function') history.add([target]);
        }
        w.chainKey = target.chainKey || target.providerId || ref.identifier;
      } else if (ref.identifier && !w.chainKey) {
        w.chainKey = ref.identifier;
      }
    }
  }
  return warnings;
}

/**
 * Evaluates alerting eligibility and notification action for a weather warning.
 *
 * Rules:
 * 1. Test/Exercise or non-public: eligible = false, action = 'drop'
 * 2. Feed error: eligible = false, action = 'feed_error' (never treated as cancellation)
 * 3. Formal cancellation (msgType === 'cancel' or lifecycle === 'cancelled'):
 *    - must match previous warning chain (chainKey, referencedIds, or providerId)
 *    - if already cancelled: eligible = false, action = 'suppress_duplicate'
 *    - if never notified: eligible = false, action = 'suppress_unnotified_cancellation'
 *    - if unlinked: eligible = false, action = 'unlinked_cancellation'
 *    - if previously notified: eligible = true, action = 'cancel', alertType = 'revocation'
 *      (settlement level retains isConfirmedLocal = true; county/region has isConfirmedLocal = false)
 * 4. Territory unknown or outside (for new warnings and revisions):
 *    - if territory.matchState === 'unknown': eligible = false, action = 'review_only'
 *    - if territory.matchState === 'no_match' or isConfirmedLocal !== true: eligible = false, action = 'outside_scope'
 * 5. Local freshness limit exceeded: eligible = false, action = 'freshness_exceeded'
 * 6. Naturally expired (now >= expires): eligible = false, action = 'expired', alertType = 'expiry'
 * 7. Update message / repeated sweep:
 *    - if previousWarning exists with same chainKey / providerId:
 *      * if material change (severity changed, awarenessLevel changed, area changed):
 *        eligible = true, action = 'update', alertType = 'revision'
 *      * if materially unchanged:
 *        eligible = false, action = 'suppress_duplicate', alertType = 'none' (no duplicate initial alert!)
 * 8. Initial new warning: eligible = true, action = 'initial_alert', alertType = 'new_danger'
 */
export function evaluateWarningNotification(currentWarning, { previousWarning = null, channel = 'telegram' } = {}) {
  // Feed error handling
  if (!currentWarning || currentWarning.status === 'error' || currentWarning.error) {
    return {
      eligible: false,
      action: 'feed_error',
      alertType: 'none',
      reason: 'Feed transport or parsing error must not trigger cancellation of existing alerts'
    };
  }

  // Test / Exercise filter
  const status = (currentWarning.status || '').toLowerCase();
  if (status !== 'actual' || (currentWarning.scope && currentWarning.scope.toLowerCase() !== 'public')) {
    return {
      eligible: false,
      action: 'drop',
      alertType: 'none',
      reason: 'Test or Exercise messages have no live notification eligibility'
    };
  }

  // Formal cancellation (processed before initial territorial gating)
  const isCancel = currentWarning.msgType?.toLowerCase() === 'cancel' || currentWarning.lifecycle === 'cancelled';
  if (isCancel) {
    if (!previousWarning) {
      return {
        eligible: false,
        action: 'unlinked_cancellation',
        alertType: 'none',
        isConfirmedLocal: false,
        chainKey: currentWarning.chainKey,
        reason: 'Cancellation rejected: no previous warning provided for cancellation chain'
      };
    }

    const refs = Array.isArray(currentWarning.parsedReferences) && currentWarning.parsedReferences.length > 0
      ? currentWarning.parsedReferences
      : parseCapReferences(currentWarning.references);

    if (!refs || refs.length === 0) {
      return {
        eligible: false,
        action: 'unlinked_cancellation',
        alertType: 'none',
        isConfirmedLocal: false,
        chainKey: currentWarning.chainKey,
        reason: 'Cancellation rejected: missing CAP references for cancellation chain'
      };
    }

    // Verify full CAP reference triple: sender, identifier, sent
    const prevSender = (previousWarning.sender || '').trim();
    const prevId = (previousWarning.providerId || '').trim();
    const prevSent = (previousWarning.sent || '').trim();
    const prevSentTime = prevSent ? Date.parse(prevSent) : NaN;

    const matchesPrevious = refs.some(ref => {
      const refSender = (ref.sender || '').trim();
      const refId = (ref.identifier || '').trim();
      const refSent = (ref.sent || '').trim();
      const refSentTime = refSent ? Date.parse(refSent) : NaN;

      if (!refSender || !refId || !refSent) return false;
      if (!prevSender || !prevId || !prevSent) return false;

      const senderMatches = refSender === prevSender;
      const idMatches = refId === prevId;
      const sentMatches = refSent === prevSent || (Number.isFinite(refSentTime) && Number.isFinite(prevSentTime) && refSentTime === prevSentTime);

      return senderMatches && idMatches && sentMatches;
    });

    if (!matchesPrevious) {
      return {
        eligible: false,
        action: 'unlinked_cancellation',
        alertType: 'none',
        isConfirmedLocal: false,
        chainKey: currentWarning.chainKey,
        reason: 'Cancellation rejected: CAP references do not match previous warning triple (sender, identifier, sent)'
      };
    }

    const alreadyCancelled = Boolean(
      previousWarning.cancelled ||
      previousWarning.cancelNotified ||
      (previousWarning.msgType?.toLowerCase() === 'cancel' && (previousWarning.notified || previousWarning.wasNotified))
    );
    if (alreadyCancelled) {
      return {
        eligible: false,
        action: 'suppress_duplicate',
        alertType: 'none',
        isConfirmedLocal: false,
        chainKey: currentWarning.chainKey,
        reason: 'Repeated cancellation: cancellation already processed and notified, duplicate suppressed'
      };
    }

    const wasNotified = Boolean(previousWarning.notified || previousWarning.wasNotified || currentWarning.wasNotified);
    if (!wasNotified) {
      return {
        eligible: false,
        action: 'suppress_unnotified_cancellation',
        alertType: 'none',
        isConfirmedLocal: false,
        chainKey: currentWarning.chainKey,
        reason: 'Cancellation suppressed: warning chain was never previously notified to user'
      };
    }

    const prevTerr = previousWarning.territory;
    const currTerr = currentWarning.territory;
    const territoryLevel = prevTerr?.territoryLevel || currTerr?.territoryLevel || 'indeterminate';
    const isConfirmedLocal = (territoryLevel === 'settlement' || !prevTerr?.territoryLevel) &&
      (prevTerr?.isConfirmedLocal === true || currTerr?.isConfirmedLocal === true) &&
      territoryLevel !== 'county' && territoryLevel !== 'region';

    let reason = 'Official CAP cancellation message for previously notified local hazard';
    if (territoryLevel === 'county') {
      reason = 'Official CAP cancellation message for previously notified county hazard';
    } else if (territoryLevel === 'region') {
      reason = 'Official CAP cancellation message for previously notified regional hazard';
    } else if (territoryLevel !== 'settlement' && prevTerr?.territoryLevel) {
      reason = 'Official CAP cancellation message for previously notified warning';
    }

    return {
      eligible: true,
      action: 'cancel',
      alertType: 'revocation',
      isConfirmedLocal,
      chainKey: currentWarning.chainKey,
      title: `VISSZAVONÁS: ${currentWarning.title}`,
      reason
    };
  }

  // Unknown or outside territorial matching (for new alerts and revisions)
  const terr = currentWarning.territory;
  if (!terr || terr.matchState === 'unknown' || terr.isConfirmedLocal !== true) {
    return {
      eligible: false,
      action: terr?.matchState === 'unknown' ? 'review_only' : 'outside_scope',
      alertType: 'none',
      isConfirmedLocal: false,
      reason: terr?.matchState === 'unknown'
        ? 'Indeterminate territorial geocode: retained for review, but cannot trigger confirmed local warning'
        : 'Warning territory outside watched local area'
    };
  }

  // Local freshness limit exceeded (missing expires older than local 24h threshold)
  if (currentWarning.isFreshnessLimitExceeded || currentWarning.freshnessStatus === 'stale') {
    return {
      eligible: false,
      action: 'freshness_exceeded',
      alertType: 'none',
      isConfirmedLocal: true,
      chainKey: currentWarning.chainKey,
      reason: 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.'
    };
  }

  // Official provider expiration (per CAP expires / validUntil)
  if (currentWarning.lifecycle === 'expired') {
    return {
      eligible: false,
      action: 'expired',
      alertType: 'expiry',
      isConfirmedLocal: true,
      chainKey: currentWarning.chainKey,
      reason: 'Hivatalos szolgáltatói lejárati idő elérve'
    };
  }

  // Previous warning comparison
  if (previousWarning) {
    const prevSev = previousWarning.severity || previousWarning.awarenessLevel;
    const currSev = currentWarning.severity || currentWarning.awarenessLevel;
    const prevArea = previousWarning.area || '';
    const currArea = currentWarning.area || '';
    
    const isEscalation = currSev !== prevSev;
    const isAreaChanged = currArea !== prevArea && Math.abs(currArea.length - prevArea.length) > 10;
    
    if (isEscalation || isAreaChanged) {
      return {
        eligible: true,
        action: 'update',
        alertType: 'revision',
        isConfirmedLocal: true,
        chainKey: currentWarning.chainKey,
        title: `FRISSÍTÉS: ${currentWarning.title}`,
        reason: isEscalation ? `Material change: severity updated from ${prevSev} to ${currSev}` : 'Material change: warning area updated'
      };
    }

    // Materially unchanged -> suppress duplicate initial alert
    return {
      eligible: false,
      action: 'suppress_duplicate',
      alertType: 'none',
      isConfirmedLocal: true,
      chainKey: currentWarning.chainKey,
      reason: 'Unchanged warning: already notified, duplicate initial alert suppressed'
    };
  }

  // Initial alert
  return {
    eligible: true,
    action: 'initial_alert',
    alertType: 'new_danger',
    isConfirmedLocal: true,
    chainKey: currentWarning.chainKey,
    title: `RIASZTÁS: ${currentWarning.title}`,
    reason: 'New active confirmed local weather hazard'
  };
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
          if (row.lifecycle === 'cancelled' || row.lifecycle === 'superseded' || row.lifecycle === 'expired') return false;
          if (row.validUntil && Date.parse(row.validUntil) <= now) return false;
          if (row.isFreshnessLimitExceeded) return false;
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
