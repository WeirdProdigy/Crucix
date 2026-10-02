// Federal Register: the newest rules and notices of the Treasury's Office of Foreign Assets Control (OFAC) and the Commerce
// Department's Bureau of Industry and Security (BIS), from the public documents API (no key):
// https://www.federalregister.gov/developers/documentation/api/v1 - one request per agency, 15 documents each, newest first.
// `publication_date` is a plain day (YYYY-MM-DD) and is read as UTC midnight, so a document published today is at most a day old.
// The API has no feed time: the newest publication day of the answer stands in for it, and OFAC and BIS together publish
// nothing for several days in a row now and then (a few days over a weekend, 22 days during the October 2025 shutdown).
// The `agencies` field of a document names every agency it belongs to; it decides the `agency` fact, so a joint document
// shows both. A document number can carry a prefix (C1-2026-16628 is a correction of 2026-16628: a separate document).
// Every regex below runs on text that was cut to a fixed length first: unbounded input never reaches one.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';

const SOURCE = 'Federal-Register';
const ENDPOINT = 'https://www.federalregister.gov/api/v1/documents.json';
const DOCUMENT_BASE = 'https://www.federalregister.gov/documents/';
const SHORT_LINK = 'https://www.federalregister.gov/d/';
const AGENCIES = Object.freeze([
  { code: 'OFAC', slug: 'foreign-assets-control-office', name: 'Office of Foreign Assets Control (OFAC)' },
  { code: 'BIS', slug: 'industry-and-security-bureau', name: 'Bureau of Industry and Security (BIS)' },
]);
const FIELDS = ['title', 'document_number', 'publication_date', 'html_url', 'type', 'agencies'];
const PER_PAGE = 15;
const MAX_ROWS = 30;
const MAX_EXAMINED = 100; // per agency
const FUTURE_SKEW_MS = 300000;
const CACHE_MS = 3600000;
const cache = new Map(); // one entry per agency: bounded by the fixed agency list
const REQUEST = Object.freeze({ timeout: 10000, retries: 0, maxBytes: 2 * 1024 * 1024 });
const NUMBER = /^[A-Za-z0-9]{1,6}(?:-[A-Za-z0-9]{1,10}){1,3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPE = /^[A-Za-z][A-Za-z ]{0,29}$/;
const LINK_PATH = /^[A-Za-z0-9/_.-]+$/;
// Plain substrings of the cleaned title, any letter case (so "entity list", "Designations" and "designated" all match).
const MODERATE_TITLE = /entity list|designat/i;
const EXTRAS = {
  attribution: 'Source: Office of the Federal Register, National Archives and Records Administration (federalregister.gov)',
  rights: 'Federal Register material is not copyrighted: "Any person may reproduce or republish any material appearing in any regular or special edition of the Federal Register (1 CFR 2.6). There are no restrictions regarding what is reproduced, who can reproduce it, or where it can be reproduced." The federalregister.gov rendition is an unofficial informational edition without legal status; check the official PDF on govinfo.gov before relying on a text.',
  license: 'Public domain (1 CFR 2.6)',
  licenseUrl: 'https://www.federalregister.gov/reader-aids/government-policy-and-ofr-procedures/about-this-site',
  summary: 'The newest Federal Register rules and notices of the Treasury\'s Office of Foreign Assets Control (OFAC) and the Commerce Department\'s Bureau of Industry and Security (BIS), newest first. Publication days are shown at 00:00 UTC. Rules whose title mentions the Entity List or designations are rated moderate, everything else is info.',
};

// Provider text becomes inert plain text: markup, control, bidi and zero-width characters go, whitespace collapses.
// The input is cut to 400 characters BEFORE any regex runs and the tag pattern cannot rescan: linear on hostile text.
const clean = (value, cap) => typeof value === 'string'
  ? value.slice(0, 400).replace(/<[^<>]*>/g, '').replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').replace(/[<>]/g, '').trim().slice(0, cap).trim() : '';
// Transport errors become a short reason; a URL or an upstream message never reaches the result.
function failure(error) {
  const reason = typeof error === 'string' ? error.slice(0, 300).replace(/https?:\/\/\S*/gi, '').trim().slice(0, 120) : '';
  return `Federal Register request failed${reason ? `: ${reason}` : ''}`;
}

// The page of the document itself on federalregister.gov and nothing else; the short link by number stands in for anything odd.
function linkOf(raw, number) {
  if (typeof raw === 'string' && raw.length <= 300 && raw.startsWith(DOCUMENT_BASE)) {
    const path = raw.slice(DOCUMENT_BASE.length);
    if (LINK_PATH.test(path) && !path.includes('..') && !path.includes('//') && path.split('/').includes(number)) return raw;
  }
  return `${SHORT_LINK}${number}`;
}

// The agencies of a document as listed by the document itself; the agency whose query returned it when the list says nothing.
function codesOf(raw, requested) {
  const slugs = Array.isArray(raw.agencies) ? raw.agencies.slice(0, 20).map(entry => typeof entry?.slug === 'string' && entry.slug.length <= 80 ? entry.slug : '') : [];
  const own = AGENCIES.filter(agency => slugs.includes(agency.slug)).map(agency => agency.code);
  return own.length ? own : [requested];
}

function document(raw, requested, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const number = typeof raw.document_number === 'string' && raw.document_number.length <= 30 && NUMBER.test(raw.document_number) ? raw.document_number : null;
  const day = typeof raw.publication_date === 'string' && raw.publication_date.length === 10 && DAY.test(raw.publication_date) ? providerTime(raw.publication_date) : null;
  const title = clean(raw.title, 300);
  if (!number || !day || !title || Date.parse(day) - now > FUTURE_SKEW_MS) return null;
  const type = typeof raw.type === 'string' && raw.type.length <= 40 && TYPE.test(raw.type.trim()) ? raw.type.trim() : '';
  return { providerId: number, title, observedAt: day, type, url: linkOf(raw.html_url, number), codes: new Set(codesOf(raw, requested)) };
}

function observation(doc) {
  const names = AGENCIES.filter(agency => doc.codes.has(agency.code));
  const moderate = doc.type === 'Rule' && MODERATE_TITLE.test(doc.title);
  const day = doc.observedAt.slice(0, 10);
  return { kind: 'sanctions', providerId: doc.providerId, title: doc.title,
    summary: `${doc.type || 'Document'} from the ${names.map(agency => agency.name).join(' and the ')}, published in the Federal Register on ${day}: ${doc.title}.${moderate ? ' Rated moderate because the title of this rule mentions the Entity List or designations.' : ''}`,
    // Every document has its own page, so every row has its own link.
    source: SOURCE, url: doc.url, observedAt: doc.observedAt, publishedAt: doc.observedAt, severity: moderate ? 'moderate' : 'info',
    ...(doc.type ? { docType: doc.type } : {}), agency: names.map(agency => agency.code).join(', ') };
}

// `answers` holds one API answer per agency code ({ OFAC, BIS }). An agency whose answer failed is left out and named in the summary.
export function parseFederalRegister(answers, { now = Date.now() } = {}) {
  const input = answers && typeof answers === 'object' ? answers : {};
  const docs = new Map(), failed = [];
  let examined = 0, truncated = 0;
  for (const agency of AGENCIES) {
    const answer = Object.hasOwn(input, agency.code) ? input[agency.code] : undefined;
    if (!answer || typeof answer !== 'object' || answer.error || !Array.isArray(answer.results)) { failed.push({ agency, error: answer?.error }); continue; }
    const results = answer.results.slice(0, MAX_EXAMINED);
    examined += results.length; truncated += answer.results.length - results.length;
    for (const raw of results) {
      const doc = document(raw, agency.code, now);
      if (!doc) continue;
      const known = docs.get(doc.providerId);
      if (known) doc.codes.forEach(code => known.codes.add(code)); else docs.set(doc.providerId, doc);
    }
  }
  if (failed.length === AGENCIES.length) {
    const reason = failed.find(entry => typeof entry.error === 'string')?.error;
    return unavailableResult(SOURCE, reason === undefined ? 'The Federal Register returned an unexpected response' : failure(reason), EXTRAS, now);
  }
  const all = [...docs.values()];
  // The newest publication day, old or not: an old list is expired rather than undated.
  const newest = all.map(doc => doc.observedAt).sort().at(-1) ?? null;
  const ranked = all.filter(doc => freshness(doc.observedAt, POLICIES[SOURCE].observationMaxAgeMs, now).fresh)
    .sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0) || (a.providerId < b.providerId ? 1 : -1));
  const rows = ranked.slice(0, MAX_ROWS).map(observation);
  const note = failed.length ? ` Warning: the ${failed.map(entry => entry.agency.code).join(' and ')} request failed, so only ${AGENCIES.filter(agency => !failed.some(entry => entry.agency === agency)).map(agency => agency.code).join(' and ')} documents are listed.` : '';
  return freshResult(SOURCE, newest, rows, { ...EXTRAS, summary: EXTRAS.summary + note, examinedRecords: examined, truncatedRecords: truncated + Math.max(0, ranked.length - MAX_ROWS) }, now);
}

async function load(agency, { fetcher, useCache, now, request }) {
  const hit = cache.get(agency.slug);
  if (useCache && hit?.fetcher === fetcher && now >= hit.collectedAt && now - hit.collectedAt < CACHE_MS) return hit.payload;
  const query = new URLSearchParams([['conditions[agencies][]', agency.slug], ['order', 'newest'], ['per_page', String(PER_PAGE)], ...FIELDS.map(field => ['fields[]', field])]);
  let payload;
  try { payload = await fetcher(`${ENDPOINT}?${query}`, request); } catch { payload = { error: 'network error' }; }
  if (useCache && Array.isArray(payload?.results)) cache.set(agency.slug, { payload, fetcher, collectedAt: now });
  return payload;
}

export async function briefing(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const fetcher = options.fetcher || safeFetch;
  const useCache = options.useCache ?? !options.fetcher;
  const request = { ...REQUEST, timeout: Math.max(1, Math.min(10000, Number(options.timeout) || 10000)) };
  const payloads = await Promise.all(AGENCIES.map(agency => load(agency, { fetcher, useCache, now, request })));
  return parseFederalRegister(Object.fromEntries(AGENCIES.map((agency, index) => [agency.code, payloads[index]])), { now });
}
