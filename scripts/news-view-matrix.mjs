#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEvents } from '../lib/intelligence/events.mjs';
import { partitionEventsByView, VIEWS, TOTAL_NEWS_CAP, VIEW_NEWS_CAP } from '../lib/intelligence/views.mjs';

const DOMESTIC_LEGACY_SOURCES = [
  'Katasztrófavédelem Vész',
  'Katasztrófavédelem Hírek',
  'HAON',
  'Dehir',
  'Telex',
  'Portfolio',
  'Agrárszektor'
];

const NEW_NEWS_SOURCE_KEYS = [
  'Police-Hajdu',
  'RSS-Dehir',
  'RSS-Telex',
  'RSS-444',
  'RSS-24hu',
  'RSS-Index',
  'RSS-HVG',
  'RSS-Portfolio',
  'RSS-Qubit',
  'Google-News'
];

export function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generates the Source x Category x View news matrix from raw snapshot data or file path.
 *
 * @param {string|object} input - Snapshot file path or parsed snapshot object
 * @param {object} [options]
 * @param {number} [options.totalNewsCap=200]
 * @param {number} [options.viewNewsCap=50]
 * @param {string} [options.filePath] - Optional path if input is already an object
 * @returns {object} Matrix report object
 */
export function generateNewsViewMatrix(input, options = {}) {
  let data;
  let fileSha256 = null;
  let inputPath = null;

  if (typeof input === 'string') {
    inputPath = input;
    fileSha256 = computeFileSha256(input);
    const raw = fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '');
    data = JSON.parse(raw);
  } else if (input && typeof input === 'object') {
    data = input;
    if (options.filePath && fs.existsSync(options.filePath)) {
      inputPath = options.filePath;
      fileSha256 = computeFileSha256(options.filePath);
    }
  } else {
    throw new Error('Invalid input: must be file path or snapshot object');
  }

  const totalNewsCap = Number(options.totalNewsCap) || TOTAL_NEWS_CAP;
  const viewNewsCap = Number(options.viewNewsCap) || VIEW_NEWS_CAP;

  const snapTime = data?.meta?.timestamp ? Date.parse(data.meta.timestamp) : Date.now();
  const pipelineEvents = buildEvents(data, { now: snapTime });
  const newsEvents = pipelineEvents.filter(e => e.kind === 'news');
  const partitions = partitionEventsByView(pipelineEvents, undefined, { totalNewsCap, viewNewsCap });

  // Map observation counts per source from data.liveSources
  const obsMap = {};
  if (Array.isArray(data.liveSources)) {
    for (const s of data.liveSources) {
      const srcName = s.source || s.name;
      if (srcName) {
        obsMap[srcName] = Array.isArray(s.observations) ? s.observations.length : 0;
      }
    }
  }

  // Legacy sources in data.news (if present)
  // Obs Definition: For legacy rows (Legacy-Domestic and Legacy-International), obs is strictly defined
  // as the count of items present directly in raw data.news (raw.news items before event building).
  // During buildEvents, single raw items may expand into multiple distinct events (e.g. 4 raw -> 8 events, 18 raw -> 36 events).
  let legacyDomesticObs = 0;
  let legacyInternationalObs = 0;
  if (Array.isArray(data.news)) {
    for (const n of data.news) {
      const srcName = n.source?.name || n.source || 'Unknown';
      if (DOMESTIC_LEGACY_SOURCES.includes(srcName)) {
        legacyDomesticObs++;
      } else {
        legacyInternationalObs++;
      }
    }
  }

  const views = [VIEWS.LOCAL, VIEWS.COUNTY, VIEWS.NATIONAL, VIEWS.GLOBAL];
  const viewSets = {};
  for (const v of views) {
    viewSets[v] = new Set(partitions[v]?.newsIds || []);
  }

  const sourcesList = [
    ...NEW_NEWS_SOURCE_KEYS,
    'Legacy-Domestic',
    'Legacy-International'
  ];

  const rows = {};
  for (const s of sourcesList) {
    let obsCount = obsMap[s] || 0;
    if (s === 'Legacy-Domestic') obsCount = legacyDomesticObs;
    if (s === 'Legacy-International') obsCount = legacyInternationalObs;

    rows[s] = {
      source: s,
      obs: obsCount,
      events: 0,
      categories: {},
      local: 0,
      county: 0,
      national: 0,
      global: 0
    };
  }

  for (const ev of newsEvents) {
    let src = ev.source?.name || ev.source || 'Unknown';
    if (!obsMap[src]) {
      src = DOMESTIC_LEGACY_SOURCES.includes(src) ? 'Legacy-Domestic' : 'Legacy-International';
    }
    const cat = ev.newsCategory || ev.facts?.newsCategory || 'none';
    if (!rows[src]) {
      rows[src] = {
        source: src,
        obs: 0,
        events: 0,
        categories: {},
        local: 0,
        county: 0,
        national: 0,
        global: 0
      };
    }
    rows[src].events++;
    rows[src].categories[cat] = (rows[src].categories[cat] || 0) + 1;
    for (const v of views) {
      if (viewSets[v].has(ev.id)) {
        rows[src][v]++;
      }
    }
  }

  // Verifications and Column sums
  const colSums = { local: 0, county: 0, national: 0, global: 0 };
  let newNewsObsSum = 0;
  let totalObsSum = 0;
  let totalEventsSum = 0;
  let allNewSourcesObsCheck = true;
  let allSourceViewsCheck = true;

  for (const [s, r] of Object.entries(rows)) {
    if (NEW_NEWS_SOURCE_KEYS.includes(s)) {
      newNewsObsSum += r.obs;
      if (r.events > r.obs) {
        allNewSourcesObsCheck = false;
      }
    }
    totalObsSum += r.obs;
    totalEventsSum += r.events;

    for (const v of views) {
      if (r[v] > r.events) {
        allSourceViewsCheck = false;
      }
      colSums[v] += r[v];
    }
  }

  const colSumChecks = {
    localMatch: colSums.local === (partitions.local?.newsIds?.length || 0),
    countyMatch: colSums.county === (partitions.county?.newsIds?.length || 0),
    nationalMatch: colSums.national === (partitions.national?.newsIds?.length || 0),
    globalMatch: colSums.global === (partitions.global?.newsIds?.length || 0)
  };

  const countyLeaks = (rows['RSS-Portfolio']?.county || 0) + (rows['RSS-Qubit']?.county || 0);

  const report = {
    metadata: {
      inputPath,
      inputFileSha256: fileSha256,
      timestamp: data?.meta?.timestamp || null,
      totalNewsCap,
      viewNewsCap,
      totalPipelineNewsEvents: newsEvents.length,
      retainedUniqueNewsCount: partitions.news.length,
      legacyObsDefinition: 'Count of items directly in data.news (raw.news) before event building'
    },
    rows: Object.values(rows),
    totals: {
      newNewsObsSum,
      totalObsSum,
      eventsSum: totalEventsSum,
      localColSum: colSums.local,
      countyColSum: colSums.county,
      nationalColSum: colSums.national,
      globalColSum: colSums.global
    },
    verifications: {
      newNewsObsSumMatches372: newNewsObsSum === 372,
      allNewSourcesObsCheck,
      allSourceViewsCheck,
      colSumChecks,
      allColSumsMatch: Object.values(colSumChecks).every(Boolean),
      unionRetainedWithinCap: partitions.news.length <= totalNewsCap,
      countyTerritorialGatingValid: countyLeaks === 0
    }
  };

  return report;
}

// CLI execution
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  const inputArg = args.find(a => !a.startsWith('--')) || 'scratch/live_api_data.json';
  const capArg = args.find(a => a.startsWith('--total-cap='));
  const totalNewsCap = capArg ? parseInt(capArg.split('=')[1], 10) : TOTAL_NEWS_CAP;
  const formatArg = args.find(a => a.startsWith('--format='));
  const format = formatArg ? formatArg.split('=')[1] : 'json';

  try {
    const report = generateNewsViewMatrix(inputArg, { totalNewsCap });
    if (format === 'csv') {
      console.log('Source,Observations,Events,Local,County,National,Global');
      for (const r of report.rows) {
        console.log(`"${r.source}",${r.obs},${r.events},${r.local},${r.county},${r.national},${r.global}`);
      }
      console.log(`"TOTAL",${report.totals.totalObsSum},${report.totals.eventsSum},${report.totals.localColSum},${report.totals.countyColSum},${report.totals.nationalColSum},${report.totals.globalColSum}`);
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (err) {
    console.error('Error generating matrix:', err.message);
    process.exit(1);
  }
}
