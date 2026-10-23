// Nébih (National Food Chain Safety Office) - African Swine Fever (ASP) Settlement Risk Classification
// Source: https://portal.nebih.gov.hu/asp_telepulesek
// Public data reuse under Act CI of 2023 (Nahtv.) and Act CXII of 2011 (Infotv.).
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime } from '../utils/freshness.mjs';
import { resolveSettlement, DEFAULT_TERRITORY_CONFIG } from '../../lib/intelligence/territory.mjs';
import { createHash } from 'node:crypto';

const SOURCE = 'Nebih-ASP';
const ENDPOINT = 'https://portal.nebih.gov.hu/asp_telepulesek';
const META = Object.freeze({
  feedUrl: ENDPOINT,
  attribution: 'Nemzeti Élelmiszerlánc-biztonsági Hivatal (Nébih) – portal.nebih.gov.hu',
  license: 'Közadat-újrahasznosítás (2023. évi CI. tv. és 2011. évi CXII. tv.)',
  licenseUrl: 'https://portal.nebih.gov.hu/kozadatok-ujrahasznositasa',
  legalStatus: 'feltételek nem tisztázottak; döntés/megkeresés szükséges',
  robotsTxtUrl: 'https://portal.nebih.gov.hu/robots.txt',
  robotsTxtPolicy: 'User-Agent: *; Disallow: /search; Sitemap: https://portal.nebih.gov.hu/sitemap.xml',
  coverage: 'Magyarország afrikai sertéspestis (ASP) által érintett településeinek hatósági kockázati besorolása',
  rights: 'A Nébih által közzétett közigazgatási és járványügyi tájékoztató adatok újrahasznosítása a Nahtv. szerinti igénybejelentéshez kötött.'
});

function decodeHtmlEntities(str) {
  if (typeof str !== 'string') return '';
  const NAMED_ENTITIES = {
    '&aacute;': 'á', '&Aacute;': 'Á',
    '&eacute;': 'é', '&Eacute;': 'É',
    '&iacute;': 'í', '&Iacute;': 'Í',
    '&oacute;': 'ó', '&Oacute;': 'Ó',
    '&ouml;': 'ö', '&Ouml;': 'Ö',
    '&otilde;': 'ő', '&Otilde;': 'Ő',
    '&odblac;': 'ő', '&Odblac;': 'Ő',
    '&uacute;': 'ú', '&Uacute;': 'Ú',
    '&uuml;': 'ü', '&Uuml;': 'Ü',
    '&udblac;': 'ű', '&Udblac;': 'Ű',
    '&nbsp;': ' ',
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&lt;': '<',
    '&gt;': '>'
  };
  return str
    .replace(/&[a-zA-Z]+;/g, match => NAMED_ENTITIES[match.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCharCode(parseInt(dec, 10)); } catch { return _; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCharCode(parseInt(hex, 16)); } catch { return _; }
    });
}

const clean = (val, max = 200) => {
  if (typeof val !== 'string') return '';
  const decoded = decodeHtmlEntities(val);
  return decoded
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
};

const normalizeKey = val => clean(val, 100)
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '_');

const hashString = val => createHash('sha256').update(String(val)).digest('hex').slice(0, 32);

export function makeNebihAspKey(settlement, county, vgeCode = '') {
  const normCounty = normalizeKey(county || '');
  const normSettlement = normalizeKey(settlement || '');
  const normVge = vgeCode ? normalizeKey(vgeCode) : '';
  return normVge
    ? `ASP|afrikai_sertes_pestis|${normCounty}|${normSettlement}|${normVge}`
    : `ASP|afrikai_sertes_pestis|${normCounty}|${normSettlement}`;
}

export function aspFreshResult(source, observedAt, observations = [], extras = {}, now = Date.now()) {
  return {
    source,
    timestamp: new Date(now).toISOString(),
    observedAt: observedAt || null,
    status: 'ok',
    observations,
    examinedRecords: extras.examinedRecords ?? observations.length,
    acceptedRecords: observations.length,
    ...extras
  };
}

export function aspUnavailableResult(source, error, extras = {}, now = Date.now()) {
  return {
    source,
    timestamp: new Date(now).toISOString(),
    observedAt: null,
    status: 'error',
    error: String(error).slice(0, 300),
    observations: [],
    ...extras
  };
}

/**
 * Maps Nébih ASP risk category to an intelligence severity level.
 * Note: These are administrative restriction zones, not active clinical domestic swine outbreaks.
 */
export function mapAspSeverity(category) {
  const norm = clean(category)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  if (norm.includes('szigoruan korlatozott') || norm.includes('szkt)')) return 'elevated';
  if (norm.includes('szkt-n kivuli') || norm.includes('fertozott')) return 'moderate';
  if (norm.includes('iii-as')) return 'high';
  if (norm.includes('magas kockazat')) return 'low';
  if (norm.includes('kozepes kockazat')) return 'low';
  return 'monitor';
}

/**
 * Evaluates whether an ASP observation warrants an alert or state transition.
 * Rules:
 * 1. isFirstRun: baseline run, suppresses all initial alerts.
 * 2. Unchanged record: suppresses duplicate alerts.
 * 3. Ambiguous territorial identity: review only, suppresses alerts.
 * 4. Material change in risk category or coverage: triggers restriction_update alert.
 * 5. Vanished record: marks vanished_unverified, strictly NO clearance alert.
 */
export function evaluateNebihAspNotification(currentRecord, { previousRecord = null, isFirstRun = false } = {}) {
  if (!currentRecord) {
    return { eligible: false, action: 'error', reason: 'Hiányzó rekord' };
  }

  // Schema drift or error states
  if (currentRecord.status === 'schema_drift_detected') {
    return {
      eligible: true,
      action: 'schema_drift_detected',
      alertType: 'system_review',
      isConfirmedLocal: false,
      chainKey: currentRecord.stableKey || 'drift',
      title: 'RENDSZER-FELÜLVIZSGÁLAT: Nébih ASP táblázatszerkezet megváltozott',
      reason: 'A táblázat oszlopai vagy mezőszerkezete megváltozott, emberi ellenőrzés szükséges'
    };
  }

  if (currentRecord.status === 'empty_table_anomaly') {
    return {
      eligible: false,
      action: 'empty_table_anomaly',
      reason: 'Üres forrástáblázat detektálva: korábbi állapot megőrizve'
    };
  }

  // Territorial ambiguity check
  if (currentRecord.territorialMatching?.matching_certainty === 'ambiguous_identity' ||
      currentRecord.territorialMatching?.matching_certainty === 'unresolved_identity' ||
      currentRecord.territorialMatching?.dataQualityFlag === 'ambiguous_identity_requires_review') {
    return {
      eligible: false,
      action: 'review_only',
      isConfirmedLocal: false,
      chainKey: currentRecord.stableKey,
      reason: 'Bizonytalan területi illesztés (ambiguous_identity): értesítés letiltva'
    };
  }

  // First run baseline: establishes known state, suppresses all alerts
  const isPrimary = Boolean(currentRecord.territorialMatching?.isPrimarySettlement);
  const isConfirmedLocal = Boolean(currentRecord.territorialMatching?.point_in_polygon);

  if (isFirstRun) {
    return {
      eligible: false,
      action: 'baseline',
      isConfirmedLocal,
      chainKey: currentRecord.stableKey,
      reason: 'Első beolvasás (baseline): riasztás mellőzve'
    };
  }

  // Vanished record (special call where currentRecord is marked vanished)
  if (currentRecord.action === 'vanished_unverified' || currentRecord.isVanished) {
    return {
      eligible: false,
      action: 'vanished_unverified',
      isConfirmedLocal,
      chainKey: currentRecord.stableKey,
      reason: 'A tétel kikerült a hatósági nyilvántartásból; hatósági feloldás nem igazolt'
    };
  }

  // Previous record comparison
  // Crucial: notification triggers look strictly at official raw values,
  // NOT Crucix-calculated severity levels (forrás nélküli leképezés nem hathat értesítésre).
  if (previousRecord) {
    const prevCat = previousRecord.raw?.riskCategory ?? previousRecord.territorialMatching?.official_settlement_assignment;
    const currCat = currentRecord.raw?.riskCategory ?? currentRecord.territorialMatching?.official_settlement_assignment;
    const prevCov = previousRecord.raw?.coveragePercent ?? previousRecord.territorialMatching?.official_assignment_percentage;
    const currCov = currentRecord.raw?.coveragePercent ?? currentRecord.territorialMatching?.official_assignment_percentage;

    const sameOfficialData = (prevCat !== undefined && currCat !== undefined && prevCat === currCat && (prevCov === undefined || currCov === undefined || prevCov === currCov)) ||
      (Boolean(previousRecord.title && currentRecord.title && previousRecord.title === currentRecord.title));

    if (!sameOfficialData && (prevCat !== currCat || prevCov !== currCov)) {
      return {
        eligible: isPrimary,
        action: 'category_changed',
        alertType: 'restriction_update',
        isConfirmedLocal,
        chainKey: currentRecord.stableKey,
        title: `NÉBIH ASP BESOROLÁS-VÁLTOZÁS: ${currentRecord.title}`,
        reason: `Hatósági besorolás megváltozott: "${prevCat || previousRecord.title}" (${prevCov || ''}%) -> "${currCat || currentRecord.title}" (${currCov || ''}%)`
      };
    }

    // Unchanged
    return {
      eligible: false,
      action: 'unchanged',
      isConfirmedLocal,
      chainKey: currentRecord.stableKey,
      reason: 'Változatlan hatósági besorolás: ismételt értesítés letiltva'
    };
  }

  // New record after baseline
  return {
    eligible: isPrimary,
    action: 'new_restriction',
    alertType: 'new_danger',
    isConfirmedLocal,
    chainKey: currentRecord.stableKey,
    title: `ÚJ NÉBIH ASP BESOROLÁS: ${currentRecord.title}`,
    reason: 'Új hatósági besorolás jelent meg a nyilvántartásban'
  };
}

/**
 * Parses the raw HTML response of portal.nebih.gov.hu/asp_telepulesek.
 * Extracts headers, reference dates, raw cell values, namespaces, and territorial matching.
 */
export function parseNebihAsp(html, { now = Date.now(), territoryConfig = DEFAULT_TERRITORY_CONFIG, scopeToWatched = false } = {}) {
  const meta = { ...META };

  if (typeof html !== 'string' || !html.trim()) {
    return aspUnavailableResult(SOURCE, 'Üres vagy hiányzó HTML tartalom', meta, now);
  }

  try {
    // 1. Locate table
    const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      return {
        ...aspUnavailableResult(SOURCE, 'schema_drift_detected: Nem található HTML táblázat az oldalon', meta, now),
        status: 'schema_drift_detected'
      };
    }
    const tableHtml = tableMatch[1];

    // 2. Extract rows
    const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
    if (!rowMatches.length) {
      return {
        ...aspUnavailableResult(SOURCE, 'empty_table_anomaly: A táblázatban nincsenek sorok', meta, now),
        status: 'empty_table_anomaly'
      };
    }

    // 3. Extract and validate headers
    const firstRow = rowMatches[0];
    let headerCells = [...firstRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => clean(m[1]));
    if (!headerCells.length) {
      headerCells = [...firstRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
    }

    if (headerCells.length < 5) {
      return {
        ...aspUnavailableResult(SOURCE, `schema_drift_detected: Váratlan oszlopszám (${headerCells.length} < 5)`, meta, now),
        status: 'schema_drift_detected'
      };
    }

    const h0 = headerCells[0].toLowerCase();
    const h1 = headerCells[1].toLowerCase();
    const h2 = headerCells[2].toLowerCase();
    if (!h0.includes('telep') || !h1.includes('megye') || !h2.includes('kock')) {
      return {
        ...aspUnavailableResult(SOURCE, 'schema_drift_detected: A fejlécek nem egyeznek az elvárt sémával', meta, now),
        status: 'schema_drift_detected'
      };
    }

    // 4. Extract dates
    // Reference date from header Col 2 (e.g. "Kockázati besorolás 2026.10.12")
    const refDateMatch = headerCells[2].match(/(?:202[4-9]\.\d{2}\.\d{2})/);
    const referenceDate = refDateMatch ? refDateMatch[0].replace(/\./g, '-') : null;

    // Page update date from text (e.g. "Frissítve: 2026.10.20.")
    const updatedMatch = html.match(/Friss[ií]tve:\s*(202[4-9]\.\d{2}\.\d{2})/i);
    const sourceUpdatedAt = updatedMatch ? updatedMatch[1].replace(/\./g, '-') : null;

    const harvestedAt = new Date(now).toISOString();

    // 5. Parse data rows and compute integrity metrics across all rows
    const dataRowMatches = rowMatches.slice(1);
    const observations = [];
    const occurrences = new Map();
    let malformedRows = 0;
    const tableChecksum = hashString(tableHtml);

    for (const rowHtml of dataRowMatches) {
      const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
      if (cells.length < 5) {
        malformedRows++;
        continue;
      }

      const rawSettlement = cells[0];
      const rawCounty = cells[1];
      const rawRiskCategory = cells[2];
      const rawCoveragePercent = cells[3];
      const rawVgeCode = cells[4];

      if (!rawSettlement || rawSettlement.toLowerCase().includes('település') || rawSettlement.startsWith('var max')) {
        continue;
      }

      // Territorial resolution
      const resolved = resolveSettlement(rawSettlement, rawCounty, { territoryConfig });

      // If scoped to watched catalog, skip settlements outside the catalog
      if (scopeToWatched && (!resolved.settlementId || resolved.certainty === 'unresolved_identity')) {
        continue;
      }

      // Stable tracked unit key: identifies the tracked administrative entity (disease + county + settlement [+ VGE]).
      // Crucial: referenceDate is NOT part of stableKey, so header date advances do not cause false vanishing or baseline resets.
      const normCounty = normalizeKey(rawCounty);
      const normSettlement = normalizeKey(rawSettlement);
      const normVge = rawVgeCode ? normalizeKey(rawVgeCode) : '';
      const baseKey = normVge
        ? `ASP|afrikai_sertes_pestis|${normCounty}|${normSettlement}|${normVge}`
        : `ASP|afrikai_sertes_pestis|${normCounty}|${normSettlement}`;

      const count = (occurrences.get(baseKey) || 0) + 1;
      occurrences.set(baseKey, count);
      const stableKey = count === 1 ? baseKey : `${baseKey}#${count}`;
      const eventId = `event-${hashString(stableKey)}`;

      const severity = mapAspSeverity(rawRiskCategory);
      const coverageNum = Number(rawCoveragePercent.replace('%', '').trim()) || 100;
      const rawRowHash = hashString(`${rawRiskCategory}|${coverageNum}|${rawVgeCode}`);

      const record = {
        id: eventId,
        stableKey,
        chainKey: stableKey,
        url: ENDPOINT,
        webUrl: ENDPOINT,
        source: {
          name: SOURCE,
          url: ENDPOINT,
          hostname: 'portal.nebih.gov.hu',
          status: 'ok'
        },
        kind: 'health',
        level: severity,
        levelCalculation: 'crucix_calculated',
        title: `Nébih ASP besorolás: ${rawSettlement} - ${rawRiskCategory}`,
        summary: `Nébih ASP besorolás (${rawSettlement}, ${rawCounty}): ${rawRiskCategory} (lefedettség: ${rawCoveragePercent}%, VGE: ${rawVgeCode}). Vonatkozás: ${referenceDate || 'n/a'}, frissítve: ${sourceUpdatedAt || 'n/a'}. Forrás: ${ENDPOINT}. Hatósági körzet, nem klinikai kitörés és nem humán kockázat.`,
        observedAt: referenceDate || null,
        publishedAt: sourceUpdatedAt || null,
        harvestedAt,
        changeFingerprint: rawRowHash,
        rawRowHash,
        countries: ['HUN'],
        country: 'Hungary',
        sourceRegion: rawCounty,
        location: {
          country: 'Hungary',
          region: rawCounty,
          settlement: rawSettlement
        },
        territorialMatching: {
          settlementId: resolved.settlementId,
          settlementName: resolved.settlementName || rawSettlement,
          kshSettlementCode: resolved.kshSettlementCode,
          kshDistrictCode: resolved.kshDistrictCode,
          countyCode: resolved.countyCode,
          countyName: resolved.countyName || rawCounty,
          point_in_polygon: null, // Név/vármegye illesztés: geometriai pont-poligon vizsgálat nem futott (null). False csak tényleges negatív geometriai eredmény lehet.
          geometryCheckStatus: 'not_evaluated',
          settlement_overlap_ratio: null,
          official_settlement_assignment: rawRiskCategory,
          official_assignment_percentage: coverageNum,
          matching_certainty: resolved.certainty,
          boundary_status: 'unverified',
          dataQualityFlag: resolved.dataQualityFlag || null,
          validUntil: null,
          isPrimarySettlement: Boolean(resolved.isConfirmedLocal)
        },
        huntingDistrict: {
          namespace: 'VGE',
          code: rawVgeCode
        },
        raw: {
          settlement: rawSettlement,
          county: rawCounty,
          riskCategory: rawRiskCategory,
          coveragePercent: rawCoveragePercent,
          vgeCode: rawVgeCode
        },
        facts: [
          { label: 'telepules', value: rawSettlement },
          { label: 'megye', value: rawCounty },
          { label: 'hatosagiBesorolas', value: rawRiskCategory },
          { label: 'crucixBelsoSzint', value: `${severity} (Crucix belső szint)` },
          { label: 'teruletiAranyPercent', value: String(coverageNum) },
          { label: 'vadgazdalkodasiEgysegVGE', value: rawVgeCode },
          { label: 'vonatkozasDatum', value: referenceDate || 'nem jelölt' },
          { label: 'oldalFrissitesDatum', value: sourceUpdatedAt || 'nem jelölt' },
          { label: 'illesztesiBizonyossag', value: resolved.certainty },
          { label: 'geometriaStatusz', value: 'not_evaluated' }
        ]
      };

      observations.push(record);
    }

    if (!observations.length && !scopeToWatched) {
      return {
        ...aspUnavailableResult(SOURCE, 'empty_table_anomaly: A táblázatban nincs érvényes települési rekord', meta, now),
        status: 'empty_table_anomaly'
      };
    }

    // Prioritize primary and watched settlements first
    observations.sort((a, b) => {
      const aScore = a.territorialMatching?.isPrimarySettlement ? 2 : (a.territorialMatching?.kshSettlementCode ? 1 : 0);
      const bScore = b.territorialMatching?.isPrimarySettlement ? 2 : (b.territorialMatching?.kshSettlementCode ? 1 : 0);
      return bScore - aScore;
    });

    const cappedObservations = observations.slice(0, 100);

    const out = aspFreshResult(SOURCE, sourceUpdatedAt || referenceDate || null, cappedObservations, {
      ...meta,
      referenceDate,
      sourceUpdatedAt,
      harvestedAt,
      tableChecksum,
      malformedRows,
      examinedRecords: dataRowMatches.length,
      acceptedRecords: observations.length
    }, now);

    return {
      ...out,
      examinedRecords: dataRowMatches.length,
      summary: `${out.observations.length} települési ASP kockázati besorolás feldolgozva (vonatkozási idő: ${referenceDate || 'nem jelölt'}).`
    };
  } catch (err) {
    return aspUnavailableResult(SOURCE, `Feldolgozási hiba: ${err.message}`, meta, now);
  }
}

/**
 * Live harvest briefing adapter for Nébih ASP data.
 * NOTE: Live network requests are disabled by default because official public reuse terms
 * require a formal application procedure under Nahtv.
 */
export async function briefing(options = {}) {
  const now = options.now ?? Date.now();

  if (!options.allowLiveNetwork) {
    return {
      source: SOURCE,
      status: 'disabled',
      disabled: true,
      legalStatus: 'feltételek nem tisztázottak; döntés/megkeresés szükséges',
      reason: 'Élő hálózati lekérés letiltva: a Nébih közadat-újrahasznosítási feltételei nem tisztázottak; döntés/megkeresés szükséges. Kizárólag offline fixture-teszt támogatott.',
      observations: []
    };
  }

  const timeout = Math.max(1, Math.min(30000, Number(options.timeout) || 15000));

  const data = await safeFetch(ENDPOINT, {
    format: 'text',
    maxBytes: 10 * 1024 * 1024,
    timeout,
    headers: {
      'User-Agent': 'Crucix/2.2 (+https://github.com/WeirdProdigy/Crucix; local-hazard-monitor)'
    },
    retries: options.retries === 1 ? 1 : 0
  });

  if (data.error) {
    return aspUnavailableResult(SOURCE, data.error, META, now);
  }

  return parseNebihAsp(data.rawText, {
    now,
    territoryConfig: options.territoryConfig,
    scopeToWatched: options.scopeToWatched ?? true
  });
}
