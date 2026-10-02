// GDELT — Global Database of Events, Language, and Tone
// No auth required. Reads the GKG 2.0 file GDELT publishes every 15 minutes (global news in
// 100+ languages with themes, locations and tone).
//
// The REST APIs on api.gdeltproject.org are deliberately not used: every response takes ~10 s,
// scheduled clients get HTTP 429 without a Retry-After header (retrying only keeps the window
// closed), and the GEO route /api/v2/geo/geo now answers 404. The static file feed on
// data.gdeltproject.org has no such limits. Column layout: GKG 2.1 codebook.

import { safeFetch } from '../utils/fetch.mjs';
import { readZipEntry } from '../utils/zip.mjs';
import { providerTime } from '../utils/freshness.mjs';

const BASE = 'https://data.gdeltproject.org/gdeltv2';
const INDEX_LINE = /^https?:\/\/data\.gdeltproject\.org\/gdeltv2\/(\d{14})\.gkg\.csv\.zip$/;
const MAX_FEED_AGE_MS = 3 * 3600000;
const FEED_LABEL_LEAD_MS = 20 * 60000; // files are labelled ~10 minutes ahead of when they are written
const PUBLISHED_SKEW_MS = 5 * 60000;
const MIN_THEME_HITS = 2;
const THEME_CAP = 3;
const MAX_ARTICLES = 50;
const MAX_POINTS = 30;
const MAX_TITLE = 300;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_CSV_BYTES = 64 * 1024 * 1024;

// Theme names are GKG taxonomy codes. Broad World Bank tags such as WB_2165_HEALTH_EMERGENCIES
// and EPU_ECONOMY are excluded because they label unrelated stories.
const CATEGORIES = {
  conflicts: /^(ARMEDCONFLICT|TERROR|MILITARY|REBELLION|PROTEST|UNREST_.+|WB_2433_CONFLICT_AND_VIOLENCE|CYBER_ATTACK|TAX_TERROR_GROUP(_.+)?)$/,
  economy: /^(ECON_(INFLATION|TRADE_DISPUTE|BANKRUPTCY|STOCKMARKET|INTEREST_RATES|DEBT|OILPRICE|CENTRALBANK|UNEMPLOYMENT)|SANCTIONS)$/,
  health: /^(HEALTH_PANDEMIC|WB_2167_PANDEMICS|TAX_DISEASE_(OUTBREAK|EPIDEMIC|PANDEMIC|\w*VIRUS|EBOLA|CHOLERA|MEASLES))$/,
  crisis: /^(NATURAL_DISASTER(_.+)?|DISASTER_.+|REFUGEES|FAMINE|EVACUATION|STATE_OF_EMERGENCY)$/,
};

const failure = error => ({ source: 'GDELT', timestamp: new Date().toISOString(), error, allArticles: [], geoPoints: [] });

const ENTITIES = { quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', amp: '&' };
function decodeEntities(text) {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|quot|apos|lt|gt|nbsp));/gi, (_match, decimal, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()];
    const code = decimal ? Number(decimal) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

// Titles come from third-party pages: drop control and bidi-override characters, bound the length.
function cleanTitle(raw) {
  return decodeEntities(raw)
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

// GDELT stamps are YYYYMMDDHHMMSS (UTC); the dashboard reads them as YYYYMMDDTHHMMSSZ.
const isoTime = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}Z`;
const compactTime = d => providerTime(isoTime(d)) ? `${d.slice(0, 8)}T${d.slice(8, 14)}Z` : null;

function safeUrl(raw) {
  if (!raw || raw.length > 2000) return null;
  try { return ['http:', 'https:'].includes(new URL(raw).protocol) ? raw : null; } catch { return null; }
}

// Only cities (type 3 US, 4 world) are mapped: country, state and province rows are
// centroids that would plot events at points where nothing happened.
function places(raw) {
  const found = new Map();
  for (const entry of raw.split(';')) {
    const [type, name, , , , lat, lon] = entry.split('#');
    const latitude = Number(lat), longitude = Number(lon);
    if (!['3', '4'].includes(type) || !name || lat === '' || lon === ''
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    found.set(`${latitude},${longitude}`, { lat: latitude, lon: longitude, name: name.slice(0, 120) });
  }
  return [...found.values()];
}

function parseRow(line) {
  const columns = line.split('\t');
  if (columns.length < 27) return null;
  const url = safeUrl(columns[4]);
  const extras = columns[26];
  const title = cleanTitle(extras.match(/<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/)?.[1] ?? '');
  const seendate = /^\d{14}$/.test(columns[1]) ? compactTime(columns[1]) : null;
  if (!url || !title || !seendate) return null;
  // The publication time is page metadata. An article cannot be published after GDELT saw it,
  // so a later (or invalid) value is dropped rather than shown as a provider time.
  const published = extras.match(/<PAGE_PRECISEPUBTIMESTAMP>(\d{14})<\/PAGE_PRECISEPUBTIMESTAMP>/)?.[1];
  const publishedAt = published && compactTime(published);
  const plausible = publishedAt && Date.parse(isoTime(published)) <= Date.parse(isoTime(columns[1])) + PUBLISHED_SKEW_MS;
  // V2Themes lists one "THEME,charoffset" entry per occurrence, so the entries of a category
  // measure how much the article is about it; one mention is not coverage. The focus score adds
  // each distinct theme up to THEME_CAP mentions: an event touches several themes, while a
  // market tip repeats a single one (ECON_STOCKMARKET) dozens of times.
  const mentions = new Map();
  for (const entry of columns[8].split(';')) {
    const theme = entry.split(',')[0];
    mentions.set(theme, (mentions.get(theme) || 0) + 1);
  }
  const qualified = Object.entries(CATEGORIES).map(([name, pattern]) => {
    const counts = [...mentions].filter(([theme]) => pattern.test(theme)).map(([, count]) => count);
    return { name, total: counts.reduce((sum, count) => sum + count, 0), focus: counts.reduce((sum, count) => sum + Math.min(count, THEME_CAP), 0) };
  }).filter(category => category.total >= MIN_THEME_HITS);
  const tone = Number.parseFloat(columns[15]);
  return {
    article: {
      title, url, seendate, domain: columns[3].slice(0, 253),
      ...(plausible ? { date: publishedAt } : {}),
    },
    categories: qualified.map(category => category.name),
    focus: qualified.reduce((sum, category) => sum + category.focus, 0),
    intensity: Number.isFinite(tone) ? Math.abs(tone) : 0,
    places: places(columns[10]),
  };
}

// Briefing mode — most intense coverage of conflict, economy, health and crisis themes
// in the latest 15-minute GKG file, plus the cities and states those stories mention.
export async function briefing() {
  const deadline = Date.now() + 27000;
  const left = () => Math.max(1000, deadline - Date.now());

  const index = await safeFetch(`${BASE}/lastupdate.txt`, { format: 'text', timeout: Math.min(5000, left()), retries: 1, retryDelay: 1000, maxBytes: 65536 });
  if (index.error) return failure(`GDELT feed index unavailable (${index.error})`);
  const label = index.rawText.split('\n').map(line => line.trim().split(/\s+/)[2]?.match(INDEX_LINE)?.[1]).find(Boolean);
  const feedTimestamp = label && providerTime(isoTime(label));
  if (!feedTimestamp) return failure('GDELT feed index did not list a GKG file');

  const age = Date.now() - Date.parse(feedTimestamp);
  if (age > MAX_FEED_AGE_MS || age < -FEED_LABEL_LEAD_MS) {
    return { source: 'GDELT', timestamp: new Date().toISOString(), stale: true, feedTimestamp,
      message: `GDELT feed ${label} is older than ${MAX_FEED_AGE_MS / 3600000} hours or has an implausible time`, allArticles: [], geoPoints: [] };
  }

  const archive = await safeFetch(`${BASE}/${label}.gkg.csv.zip`, { format: 'buffer', timeout: Math.min(15000, left()), retries: 0, maxBytes: MAX_ARCHIVE_BYTES });
  if (archive.error) return failure(`GDELT feed archive unavailable (${archive.error})`);
  let csv;
  try { csv = readZipEntry(archive.rawBuffer, { maxBytes: MAX_CSV_BYTES }).toString('utf8'); }
  catch { return failure('GDELT feed archive could not be read'); }

  const rows = csv.split('\n').map(line => parseRow(line.replace(/\r$/, ''))).filter(Boolean);
  if (!rows.length) return failure('GDELT feed contained no usable articles');

  // Outlets repeat the same headline, so identical headlines collapse into their most focused
  // copy. Stories rank by theme focus, then by how many outlets carry them, then by tone.
  const matched = rows.filter(row => row.categories.length).sort((a, b) => b.focus - a.focus || b.intensity - a.intensity);
  if (!matched.length) return failure('GDELT feed contained no matching conflict, economy, health or crisis articles');
  const stories = new Map();
  for (const row of matched) {
    const key = row.article.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const story = stories.get(key);
    if (!story) stories.set(key, { ...row, categories: new Set(row.categories), outlets: new Set([row.article.domain]) });
    else { row.categories.forEach(name => story.categories.add(name)); story.outlets.add(row.article.domain); }
  }
  const ranked = [...stories.values()].sort((a, b) => b.focus - a.focus || b.outlets.size - a.outlets.size || b.intensity - a.intensity);
  const articles = ranked.slice(0, MAX_ARTICLES).map(story => story.article);
  const mentions = new Map();
  for (const row of matched) {
    for (const place of row.places) {
      const key = `${place.lat},${place.lon}`;
      const point = mentions.get(key) ?? { ...place, count: 0, type: 'event' };
      point.count++;
      mentions.set(key, point);
    }
  }
  const inCategory = name => ranked.filter(story => story.categories.has(name)).slice(0, MAX_ARTICLES).map(story => story.article);

  return {
    source: 'GDELT',
    timestamp: new Date().toISOString(),
    feed: 'GKG 2.0',
    feedTimestamp,
    scannedArticles: rows.length,
    matchedArticles: matched.length,
    totalArticles: articles.length,
    allArticles: articles,
    geoPoints: [...mentions.values()].sort((a, b) => b.count - a.count).slice(0, MAX_POINTS),
    conflicts: inCategory('conflicts'),
    economy: inCategory('economy'),
    health: inCategory('health'),
    crisis: inCategory('crisis'),
  };
}

// Run standalone
if (process.argv[1]?.endsWith('gdelt.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
