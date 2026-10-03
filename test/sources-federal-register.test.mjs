import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFederalRegister, briefing } from '../apis/sources/federal-register.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
import { FACT_FIELDS, HOME, normalizeLiveSources } from '../lib/intelligence/live-sources.mjs';
import { HistoryStore } from '../lib/intelligence/history.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const now = Date.parse('2026-10-02T22:10:00Z');
const HOUR = 3600000, DAY = 24 * HOUR, MINUTE = 60000;
const MIB = 1024 * 1024;
const iso = ms => new Date(ms).toISOString();
const day = ms => iso(ms).slice(0, 10);
const rtl = String.fromCharCode(0x202e), zero = String.fromCharCode(0x200b), bell = String.fromCharCode(7), nul = String.fromCharCode(0);

// Real documents captured from https://www.federalregister.gov/api/v1/documents.json on 2026-10-02 (conditions[agencies][]=foreign-assets-control-office
// and industry-and-security-bureau, order=newest, per_page=15, fields title, document_number, publication_date, html_url, type, agencies).
// Trimmed to these documents; the agencies keep only their raw_name, name, id and slug. The values are not edited.
const OFAC_DOCS = [
  {"title":"Notice of OFAC Sanctions Action","document_number":"2026-20215","publication_date":"2026-10-02","html_url":"https://www.federalregister.gov/documents/2026/10/02/2026-20215/notice-of-ofac-sanctions-action","type":"Notice","agencies":[{"raw_name":"DEPARTMENT OF THE TREASURY","name":"Treasury Department","id":497,"slug":"treasury-department"},{"raw_name":"Office of Foreign Assets Control","name":"Foreign Assets Control Office","id":203,"slug":"foreign-assets-control-office"}]},
  {"title":"Notice of OFAC Sanctions Action","document_number":"2026-20032","publication_date":"2026-09-30","html_url":"https://www.federalregister.gov/documents/2026/09/30/2026-20032/notice-of-ofac-sanctions-action","type":"Notice","agencies":[{"raw_name":"DEPARTMENT OF THE TREASURY","name":"Treasury Department","id":497,"slug":"treasury-department"},{"raw_name":"Office of Foreign Assets Control","name":"Foreign Assets Control Office","id":203,"slug":"foreign-assets-control-office"}]},
  {"title":"Publication of Russian Harmful Foreign Activities Sanctions Regulations Web General Licenses 131E, 131F, and 131G","document_number":"2026-20014","publication_date":"2026-09-30","html_url":"https://www.federalregister.gov/documents/2026/09/30/2026-20014/publication-of-russian-harmful-foreign-activities-sanctions-regulations-web-general-licenses-131e","type":"Rule","agencies":[{"raw_name":"DEPARTMENT OF THE TREASURY","name":"Treasury Department","id":497,"slug":"treasury-department"},{"raw_name":"Office of Foreign Assets Control","name":"Foreign Assets Control Office","id":203,"slug":"foreign-assets-control-office"}]},
  {"title":"Removing Duplicative Penalties Information and Reorganizing Certain Parts","document_number":"2026-20007","publication_date":"2026-09-30","html_url":"https://www.federalregister.gov/documents/2026/09/30/2026-20007/removing-duplicative-penalties-information-and-reorganizing-certain-parts","type":"Rule","agencies":[{"raw_name":"DEPARTMENT OF THE TREASURY","name":"Treasury Department","id":497,"slug":"treasury-department"},{"raw_name":"Office of Foreign Assets Control","name":"Foreign Assets Control Office","id":203,"slug":"foreign-assets-control-office"}]},
  {"title":"Terrorism List Governments Sanctions Regulations","document_number":"2026-19657","publication_date":"2026-09-25","html_url":"https://www.federalregister.gov/documents/2026/09/25/2026-19657/terrorism-list-governments-sanctions-regulations","type":"Rule","agencies":[{"raw_name":"DEPARTMENT OF THE TREASURY","name":"Treasury Department","id":497,"slug":"treasury-department"},{"raw_name":"Office of Foreign Assets Control","name":"Foreign Assets Control Office","id":203,"slug":"foreign-assets-control-office"}]},
];
const BIS_DOCS = [
  {"title":"Agency Information Collection Activities; Submission to the Office of Management and Budget (OMB) for Review and Approval; Comment Request; Five-Year Records Retention Requirement for Export Transactions and Boycott Actions","document_number":"2026-20058","publication_date":"2026-09-30","html_url":"https://www.federalregister.gov/documents/2026/09/30/2026-20058/agency-information-collection-activities-submission-to-the-office-of-management-and-budget-omb-for","type":"Notice","agencies":[{"raw_name":"DEPARTMENT OF COMMERCE","name":"Commerce Department","id":54,"slug":"commerce-department"},{"raw_name":"Bureau of Industry and Security","name":"Industry and Security Bureau","id":241,"slug":"industry-and-security-bureau"}]},
  {"title":"URAL Airlines JSC, Utrenniy Lane 1-g, Yekaterinburg, Russia 620025; Order Renewing Temporary Denial of Export Privileges","document_number":"2026-19927","publication_date":"2026-09-29","html_url":"https://www.federalregister.gov/documents/2026/09/29/2026-19927/ural-airlines-jsc-utrenniy-lane-1-g-yekaterinburg-russia-620025-order-renewing-temporary-denial-of","type":"Notice","agencies":[{"raw_name":"DEPARTMENT OF COMMERCE","name":"Commerce Department","id":54,"slug":"commerce-department"},{"raw_name":"Bureau of Industry and Security","name":"Industry and Security Bureau","id":241,"slug":"industry-and-security-bureau"}]},
  {"title":"Measures To Restrict Stockpiling of Polysilicon and Polysilicon Derivatives Under Proclamation 11052","document_number":"2026-19537","publication_date":"2026-09-24","html_url":"https://www.federalregister.gov/documents/2026/09/24/2026-19537/measures-to-restrict-stockpiling-of-polysilicon-and-polysilicon-derivatives-under-proclamation-11052","type":"Rule","agencies":[{"raw_name":"DEPARTMENT OF COMMERCE","name":"Commerce Department","id":54,"slug":"commerce-department"},{"raw_name":"Bureau of Industry and Security","name":"Industry and Security Bureau","id":241,"slug":"industry-and-security-bureau"}]},
  {"title":"Revisions to the Entity List","document_number":"2026-17231","publication_date":"2026-08-24","html_url":"https://www.federalregister.gov/documents/2026/08/24/2026-17231/revisions-to-the-entity-list","type":"Rule","agencies":[{"raw_name":"DEPARTMENT OF COMMERCE","name":"Commerce Department","id":54,"slug":"commerce-department"},{"raw_name":"Bureau of Industry and Security","name":"Industry and Security Bureau","id":241,"slug":"industry-and-security-bureau"}]},
  {"title":"Removal From the Entity List","document_number":"2026-17230","publication_date":"2026-08-24","html_url":"https://www.federalregister.gov/documents/2026/08/24/2026-17230/removal-from-the-entity-list","type":"Rule","agencies":[{"raw_name":"DEPARTMENT OF COMMERCE","name":"Commerce Department","id":54,"slug":"commerce-department"},{"raw_name":"Bureau of Industry and Security","name":"Industry and Security Bureau","id":241,"slug":"industry-and-security-bureau"}]},
  {"title":"Streamlining Export Controls for Drone Exports","document_number":"C1-2026-16628","publication_date":"2026-08-28","html_url":"https://www.federalregister.gov/documents/2026/08/28/C1-2026-16628/streamlining-export-controls-for-drone-exports","type":"Rule","agencies":[{"raw_name":"DEPARTMENT OF COMMERCE","name":"Commerce Department","id":54,"slug":"commerce-department"},{"raw_name":"Bureau of Industry and Security","name":"Industry and Security Bureau","id":241,"slug":"industry-and-security-bureau"}]},
  {"title":"Streamlining Export Controls for Drone Exports","document_number":"2026-16628","publication_date":"2026-08-14","html_url":"https://www.federalregister.gov/documents/2026/08/14/2026-16628/streamlining-export-controls-for-drone-exports","type":"Rule","agencies":[{"raw_name":"DEPARTMENT OF COMMERCE","name":"Commerce Department","id":54,"slug":"commerce-department"},{"raw_name":"Bureau of Industry and Security","name":"Industry and Security Bureau","id":241,"slug":"industry-and-security-bureau"}]},
];
const page = results => ({ description: 'Documents', count: results.length, total_pages: 1, results });
const answers = (ofac, bis) => ({ OFAC: page(ofac), BIS: page(bis) });
const LIVE = answers(OFAC_DOCS, BIS_DOCS);
// Inside the 14 day window at `now`, newest first (the BIS rules of August and the 2026-08-14 rule are older).
const LIVE_IDS = ['2026-20215', '2026-20058', '2026-20032', '2026-20014', '2026-20007', '2026-19927', '2026-19657', '2026-19537'];

const agenciesOf = code => (code === 'BIS' ? BIS_DOCS : OFAC_DOCS)[0].agencies;
// A copy of a real document with overrides; the number follows `n` and so does the link unless given.
function entry(n, props = {}, code = 'OFAC') {
  const number = props.document_number ?? `2026-${String(90000 + n).padStart(5, '0')}`;
  const date = props.publication_date ?? day(now - n * HOUR);
  return { title: `Notice number ${n}`, document_number: number, publication_date: date, html_url: `https://www.federalregister.gov/documents/${typeof date === 'string' ? date.slice(0, 10).replaceAll('-', '/') : '2026/10/02'}/${number}/notice-number-${n}`, type: 'Notice', agencies: JSON.parse(JSON.stringify(agenciesOf(code))), ...props };
}
const parse = (payload, options) => parseFederalRegister(payload, { now, ...options });
const one = (props, options) => parse(answers([entry(1, props)], []), options).observations[0];
const rows = (docs, options) => parse(answers(docs, []), options).observations;
const ids = result => result.observations.map(row => row.providerId);
const withFetch = async (impl, run) => {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
};
const reply = (body, init) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });
const brief = options => briefing({ now, useCache: false, ...options });

test('parse turns the live documents of both agencies into sanctions observations, newest first', () => {
  const result = parse(LIVE);
  assert.equal(result.status, 'ok'); assert.equal(result.source, 'Federal-Register');
  assert.equal(result.observedAt, '2026-10-02T00:00:00.000Z', 'the feed time is the newest publication day');
  assert.deepEqual(ids(result), LIVE_IDS);
  const rule = result.observations.find(row => row.providerId === '2026-20014');
  assert.equal(rule.kind, 'sanctions'); assert.equal(rule.source, 'Federal-Register');
  assert.equal(rule.title, 'Publication of Russian Harmful Foreign Activities Sanctions Regulations Web General Licenses 131E, 131F, and 131G');
  assert.equal(rule.observedAt, '2026-09-30T00:00:00.000Z'); assert.equal(rule.publishedAt, '2026-09-30T00:00:00.000Z');
  assert.equal(rule.url, 'https://www.federalregister.gov/documents/2026/09/30/2026-20014/publication-of-russian-harmful-foreign-activities-sanctions-regulations-web-general-licenses-131e');
  assert.equal(rule.docType, 'Rule'); assert.equal(rule.agency, 'OFAC'); assert.equal(rule.severity, 'info');
  assert.match(rule.summary, /^Document 2026-20014 \(Rule\) from the Office of Foreign Assets Control \(OFAC\)/); assert.match(rule.summary, /Federal Register on 2026-09-30/);
  const denial = result.observations.find(row => row.providerId === '2026-19927');
  assert.equal(denial.docType, 'Notice'); assert.equal(denial.agency, 'BIS'); assert.equal(denial.severity, 'info'); assert.match(denial.title, /Order Renewing Temporary Denial of Export Privileges$/);
  assert.equal(new Set(result.observations.map(r => r.url)).size, 8, 'every document has its own link, also the two with one title');
  assert.equal(result.observations[0].title, result.observations[2].title);
  assert.match(result.summary, /OFAC/); assert.match(result.summary, /BIS/); assert.match(result.summary, /00:00 UTC/);
  assert.equal(result.rejectedObservations, 0); assert.equal(result.examinedRecords, 12); assert.equal(result.truncatedRecords, 0);
});

test('licence, rights and attribution come from the Federal Register terms and survive every state', () => {
  const result = parse(LIVE);
  assert.match(result.attribution, /Office of the Federal Register/); assert.equal(result.license, 'Public domain (1 CFR 2.6)');
  assert.equal(result.licenseUrl, 'https://www.federalregister.gov/reader-aids/government-policy-and-ofr-procedures/about-this-site');
  assert.match(result.rights, /1 CFR 2\.6/); assert.match(result.rights, /no restrictions/i); assert.match(result.rights, /unofficial/i); assert.match(result.rights, /govinfo\.gov/);
  for (const state of [parse(null), parse({}), parse(answers([], [])), parse({ OFAC: { error: 'HTTP 503' }, BIS: { error: 'HTTP 503' } }), parse({ OFAC: page(OFAC_DOCS), BIS: { error: 'HTTP 503' } })]) {
    assert.equal(state.license, 'Public domain (1 CFR 2.6)'); assert.match(state.attribution, /Federal Register/);
  }
});

test('the same document from both agencies is one row for both and a repeated document is listed once', () => {
  const joint = entry(1, { document_number: '2026-90001', agencies: [...agenciesOf('OFAC'), agenciesOf('BIS')[1]] });
  const merged = parse(answers([joint], [joint]));
  assert.deepEqual(ids(merged), ['2026-90001']); assert.equal(merged.observations[0].agency, 'OFAC, BIS');
  assert.match(merged.observations[0].summary, /Office of Foreign Assets Control \(OFAC\) and the Bureau of Industry and Security \(BIS\)/);
  assert.equal(parse(answers([joint], [])).observations[0].agency, 'OFAC, BIS', 'the document names both agencies itself');
  assert.equal(rows([OFAC_DOCS[0], OFAC_DOCS[0], { ...OFAC_DOCS[0] }]).length, 1);
  const bothAnswers = parse(answers([OFAC_DOCS[0]], [OFAC_DOCS[0]]));
  assert.equal(bothAnswers.observations.length, 1); assert.equal(bothAnswers.observations[0].agency, 'OFAC', 'an OFAC document seen by two queries stays OFAC');
  // A document without an agency list of its own is OFAC for the query that returned it as OFAC and BIS for the other: seen by both, it is both.
  assert.equal(parse(answers([entry(1, { agencies: [] })], [entry(1, { agencies: [] })])).observations[0].agency, 'OFAC, BIS');
  const crowded = [...Array.from({ length: 19 }, () => ({ slug: 'x' })), agenciesOf('OFAC')[1], agenciesOf('BIS')[1]];
  assert.equal(parse(answers([entry(1, { agencies: crowded })], [])).observations[0].agency, 'OFAC', 'only the first 20 agencies of a document are read');
  assert.equal(parse(answers([entry(1, { agencies: crowded.slice(1) })], [])).observations[0].agency, 'OFAC, BIS');
  // A document that names no watched agency falls back to the agency whose query returned it.
  for (const agencies of [[], undefined, null, 'x', 5, [{ slug: 'treasury-department' }], [null, 3, {}], [{ slug: 'x'.repeat(5000) }]]) {
    assert.equal(parse(answers([], [entry(1, { agencies })])).observations[0].agency, 'BIS', JSON.stringify(agencies)?.slice(0, 40));
    assert.equal(parse(answers([entry(1, { agencies })], [])).observations[0].agency, 'OFAC');
  }
});

test('at most 30 documents are kept, newest first and ranked before the freshness filter', () => {
  const fresh = Array.from({ length: 50 }, (_, i) => entry(i + 1, { publication_date: day(now - (i % 12) * DAY), document_number: `2026-${String(80000 + i)}` }));
  const result = parse(answers(fresh.slice(0, 25), fresh.slice(25)));
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 30);
  const expected = [...fresh].sort((a, b) => b.publication_date.localeCompare(a.publication_date) || (a.document_number < b.document_number ? 1 : -1)).slice(0, 30).map(d => d.document_number);
  assert.deepEqual(ids(result), expected);
  assert.equal(result.truncatedRecords, 20); assert.equal(result.examinedRecords, 50);
  assert.deepEqual(ids(parse(answers([...fresh.slice(25)].reverse(), [...fresh.slice(0, 25)].reverse()))), expected, 'the order of the answers does not matter');
  const ancient = Array.from({ length: 60 }, (_, i) => entry(100 + i, { publication_date: day(now - (20 + i) * DAY), document_number: `2026-${String(70000 + i)}` }));
  const mixed = parse(answers([...ancient, ...fresh.slice(0, 10)], ancient));
  assert.equal(mixed.observations.length, 10, 'old documents never take a slot'); assert.equal(mixed.rejectedObservations, 0);
  const exactly = n => parse(answers(Array.from({ length: n }, (_, i) => entry(i + 1, { publication_date: '2026-10-01', document_number: `2026-${60000 + i}` })), []));
  assert.equal(exactly(30).observations.length, 30); assert.equal(exactly(30).truncatedRecords, 0); assert.equal(exactly(31).observations.length, 30); assert.equal(exactly(31).truncatedRecords, 1);
  const huge = parse(answers(Array.from({ length: 250 }, (_, i) => entry(i + 1, { publication_date: '2026-10-01', document_number: `2026-${50000 + i}` })), []));
  assert.equal(huge.examinedRecords, 100); assert.equal(huge.observations.length, 30); assert.ok(huge.truncatedRecords >= 150);
});

test('future, old and undated documents are excluded and a future one never sets the feed time', () => {
  const midnight = Date.parse('2026-10-02T00:00:00Z');
  // Another document of the same day keeps the feed current, so only the row's own age decides.
  const at = (date, clock = midnight) => parse(answers([entry(1, { publication_date: date }), entry(2, { publication_date: day(clock) })], []), { now: clock }).observations.filter(row => row.providerId === '2026-90001');
  assert.equal(at('2026-10-02').length, 1, 'today');
  assert.equal(at('2026-09-18').length, 1, 'exactly 14 days old is still current');
  assert.equal(at('2026-09-17').length, 0, 'one day older is not');
  assert.equal(at('2026-10-03').length, 0, 'tomorrow is a future date'); assert.equal(at('2026-10-02', midnight - 4 * MINUTE).length, 1, 'a few minutes of clock skew are tolerated');
  assert.equal(at('2026-10-02', midnight - 10 * MINUTE).length, 0);
  for (const publication_date of [undefined, null, '', 'today', '2026-13-40', '2026-02-30', '20261002', 20261002, '2026-10-02T10:00:00Z', '2026-10-2', ' 2026-10-02', 'x'.repeat(100000)]) {
    assert.equal(rows([entry(1, { publication_date }), entry(2, { publication_date: '2026-10-02' })]).filter(row => row.providerId === '2026-90001').length, 0, String(publication_date).slice(0, 30));
  }
  const futureOnly = parse(answers([entry(1, { publication_date: '2026-10-09' })], []));
  assert.equal(futureOnly.status, 'stale'); assert.equal(futureOnly.observedAt, null); assert.equal(futureOnly.freshness.reason, 'unknown-provider-time');
  const withFuture = parse(answers([entry(1, { publication_date: '2026-10-09' }), entry(2, { publication_date: '2026-09-30' })], []));
  assert.equal(withFuture.observedAt, '2026-09-30T00:00:00.000Z'); assert.deepEqual(ids(withFuture), ['2026-90002']);
  // The feed limit is the row window, 14 days of the newest publication day (OFAC and BIS can be silent for days, 22 once); the newest day counts even when the row itself is old.
  const onTheEdge = parse(answers([entry(1, { publication_date: '2026-09-18' })], []), { now: Date.parse('2026-10-02T00:00:00Z') });
  assert.equal(onTheEdge.status, 'ok', 'exactly 14 days'); assert.equal(onTheEdge.observations.length, 1);
  assert.equal(parse(answers([entry(1, { publication_date: '2026-09-28' })], [])).status, 'ok', 'a gap of four days (96 hours and more) is not expiry any more');
  const expired = parse(answers([entry(1, { publication_date: '2026-09-18' })], []), { now: Date.parse('2026-10-02T00:00:01Z') });
  assert.equal(expired.status, 'stale'); assert.equal(expired.freshness.reason, 'expired-provider-time'); assert.deepEqual(expired.observations, []);
  const onlyOld = parse(answers([entry(1, { publication_date: '2026-08-01' })], []));
  assert.equal(onlyOld.status, 'stale'); assert.equal(onlyOld.observedAt, '2026-08-01T00:00:00.000Z');
});

test('an empty answer has no provider time and is never presented as current', () => {
  const empty = parse(answers([], []));
  assert.equal(empty.status, 'stale'); assert.equal(empty.observedAt, null); assert.deepEqual(empty.observations, []); assert.equal(empty.freshness.reason, 'unknown-provider-time');
  assert.equal('error' in empty, false);
});

test('wrong shapes and provider errors never throw and give an error result', () => {
  for (const payload of [[], null, undefined, 'results', 42, {}, { OFAC: [], BIS: [] }, { OFAC: 'x', BIS: 5 }, { OFAC: { results: 'x' }, BIS: { results: {} } }, { OFAC: { results: null }, BIS: null }, { __proto__: { OFAC: page(OFAC_DOCS) } }]) {
    const result = parse(payload);
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:/);
  }
  const failed = parse({ OFAC: { error: 'HTTP 503 from https://www.federalregister.gov/api/v1/documents.json?key=secret' }, BIS: { error: 'HTTP 503' } });
  assert.equal(failed.status, 'error'); assert.doesNotMatch(failed.error, /https?:|federalregister\.gov|secret/i); assert.match(failed.error, /Federal Register request failed/);
  assert.equal(parse({ OFAC: { error: { code: 1 } }, BIS: { error: { code: 2 } } }).status, 'error');
  const bad = [null, 'x', 7, [], {}, { title: 'x' }, entry(1, { title: 5 }), entry(2, { title: '<b></b>' }), entry(3, { document_number: undefined }), entry(4, { document_number: '../../x' }), entry(5, { document_number: 'a b' }), entry(6, { document_number: 'x'.repeat(100) }), entry(7, { document_number: '2026' }), entry(8, { document_number: 'a-b-c-d-e' }), entry(9, { document_number: 'ABCDEF-1234567890-1234567890-1234567890' })];
  const skipped = parse(answers([...bad, OFAC_DOCS[0]], []));
  assert.equal(skipped.status, 'ok'); assert.deepEqual(ids(skipped), ['2026-20215']);
});

test('documents that cannot be read are counted and noted, and an answer with none readable is an error, never a quiet feed', () => {
  const drift = (docs, field, to) => docs.map(doc => { const { [field]: value, ...rest } = doc; return { ...rest, [to]: value }; });
  const drifted = parse(answers(drift(OFAC_DOCS, 'document_number', 'documentNumber'), BIS_DOCS));
  assert.equal(drifted.status, 'ok'); assert.deepEqual(ids(drifted), ['2026-20058', '2026-19927', '2026-19537']);
  assert.match(drifted.summary, /Warning: 5 of the 5 OFAC documents could not be read \(number, date or title missing or unusable\) and were left out\./);
  assert.doesNotMatch(drifted.summary, /request failed/); assert.equal(drifted.examinedRecords, 12);
  assert.match(parse(answers(OFAC_DOCS, drift(BIS_DOCS, 'publication_date', 'publicationDate'))).summary, /Warning: 7 of the 7 BIS documents could not be read/);
  assert.match(parse(answers(OFAC_DOCS, drift(BIS_DOCS, 'title', 'name'))).summary, /Warning: 7 of the 7 BIS documents/);
  for (const [field, to] of [['document_number', 'documentNumber'], ['publication_date', 'publicationDate'], ['title', 'name']]) {
    const none = parse(answers(drift(OFAC_DOCS, field, to), drift(BIS_DOCS, field, to)));
    assert.equal(none.status, 'error', field); assert.match(none.error, /unexpected shape/); assert.deepEqual(none.observations, []); assert.equal(none.observedAt, null); assert.equal(none.license, 'Public domain (1 CFR 2.6)');
  }
  assert.equal(parse({ OFAC: { error: 'HTTP 503' }, BIS: page(drift(BIS_DOCS, 'document_number', 'documentNumber')) }).status, 'error', 'one agency down and the other unreadable');
  const some = parse(answers([entry(1, { publication_date: undefined }), entry(2), entry(3, { title: '' })], [entry(4, {}, 'BIS'), null]));
  assert.equal(some.status, 'ok'); assert.deepEqual(ids(some), ['2026-90004', '2026-90002']);
  assert.match(some.summary, /Warning: 2 of the 3 OFAC documents and 1 of the 2 BIS documents could not be read/);
  assert.match(parse(answers([entry(1), entry(2, { title: 5 })], [])).summary, /Warning: 1 of the 2 OFAC documents could not be read .* and was left out\./);
  // A document dated in the future or older than the window is readable: no warning, and a list of only those is not a shape problem.
  assert.doesNotMatch(parse(answers([entry(1, { publication_date: '2026-10-09' }), entry(2, { publication_date: '2026-01-01' })], [])).summary, /could not be read/);
  assert.equal(parse(answers([entry(1, { publication_date: '2026-10-09' })], [])).status, 'stale');
  assert.doesNotMatch(parse(LIVE).summary, /could not be read/);
  assert.equal(parse(answers([], [])).status, 'stale', 'an empty list has nothing unreadable in it');
});

test('two notices of one day with one title are told apart by their document numbers in the summary', () => {
  const [first, second] = rows([entry(1, { title: 'Notice of OFAC Sanctions Action', publication_date: '2026-10-02' }), entry(2, { title: 'Notice of OFAC Sanctions Action', publication_date: '2026-10-02' })]);
  assert.equal(first.title, second.title); assert.notEqual(first.summary, second.summary);
  assert.match(first.summary, /^Document 2026-90002 \(Notice\)/); assert.match(second.summary, /^Document 2026-90001 \(Notice\)/);
});

test('one agency failing leaves the other in place and says so in the summary', () => {
  for (const broken of [{ error: 'HTTP 503', status: 503 }, { error: 'Request timed out after 10000ms' }, null, [], { results: 'x' }, undefined]) {
    const partial = parse({ OFAC: page(OFAC_DOCS), BIS: broken });
    assert.equal(partial.status, 'ok', JSON.stringify(broken)); assert.deepEqual(ids(partial), ['2026-20215', '2026-20032', '2026-20014', '2026-20007', '2026-19657']);
    assert.match(partial.summary, /BIS request failed, so only OFAC documents are listed/); assert.equal('error' in partial, false);
    const other = parse({ OFAC: broken, BIS: page(BIS_DOCS) });
    assert.equal(other.status, 'ok'); assert.deepEqual(ids(other), ['2026-20058', '2026-19927', '2026-19537']); assert.match(other.summary, /OFAC request failed, so only BIS documents are listed/);
  }
  assert.doesNotMatch(parse(LIVE).summary, /request failed/);
  const quiet = parse({ OFAC: page([]), BIS: page(BIS_DOCS) });
  assert.equal(quiet.status, 'ok'); assert.doesNotMatch(quiet.summary, /request failed/, 'an empty answer is not a failure');
  assert.equal(parse({ OFAC: { error: 'HTTP 503' }, BIS: page([]) }).status, 'stale', 'nothing from the one that answered is no feed time');
});

test('severity is moderate for a rule whose title mentions the Entity List or designations, a plain case-insensitive substring', () => {
  const sev = (title, type = 'Rule') => one({ title, type }).severity;
  for (const title of ['Revisions to the Entity List', 'Removal From the Entity List', 'ADDITION OF ENTITIES TO THE ENTITY LIST', 'entity list updates', 'Entity Lists of the Future', 'Designation of Foreign Terrorist Organizations', 'Designations Under Executive Order 14024', 'Persons Designated Under the Act', 'Redesignating Part 3', 'Entity   List', 'Ent<b>ity</b> List', `Entity${zero} List`]) assert.equal(sev(title), 'moderate', title);
  for (const title of ['Notice of OFAC Sanctions Action', 'Entity-List', 'Entities', 'Designer Drugs Rule', 'The Entity', 'List of Entity', 'Terrorism List Governments Sanctions Regulations', 'Entity']) assert.equal(sev(title), 'info', title);
  for (const type of ['Notice', 'Proposed Rule', 'Presidential Document', 'rule', 'Rules', 'RULE']) assert.equal(sev('Revisions to the Entity List', type), 'info', `${type} is not a rule`);
  assert.equal(one({ title: 'Revisions to the Entity List', type: undefined }).severity, 'info');
  assert.equal(sev(`${'A '.repeat(160)}Entity List`), 'info', 'the rule looks at the title as shown, which is cut at 300 characters');
  assert.equal(sev(`${'A '.repeat(100)}Entity List`), 'moderate');
  const moderate = one({ title: 'Revisions to the Entity List', type: 'Rule' });
  assert.match(moderate.summary, /Rated moderate because the title of this rule mentions the Entity List or designations/); assert.doesNotMatch(one({}).summary, /Rated moderate/);
  const live = parse(answers(OFAC_DOCS, BIS_DOCS), { now: Date.parse('2026-08-29T12:00:00Z') });
  assert.deepEqual(live.observations.filter(row => row.severity === 'moderate').map(row => row.providerId), ['2026-17231', '2026-17230'], 'the real Entity List rules of 2026-08-24');
  assert.equal(live.observations.find(row => row.providerId === 'C1-2026-16628').severity, 'info');
});

test('the document type is a short plain label or absent and never decides anything else', () => {
  assert.equal(one({ type: 'Proposed Rule' }).docType, 'Proposed Rule'); assert.equal(one({ type: 'Presidential Document' }).docType, 'Presidential Document');
  assert.match(one({ type: 'Proposed Rule' }).summary, /^Document 2026-90001 \(Proposed Rule\) from the /);
  for (const type of [undefined, null, 5, {}, [], '', '<b>Rule</b>', 'x'.repeat(100000), 'Rule; DROP', '1Rule', `Rule${zero}`]) {
    const row = one({ type });
    assert.equal('docType' in row, false, String(type).slice(0, 30)); assert.match(row.summary, /^Document 2026-90001 from the /);
  }
  assert.equal(one({ type: ' Rule ', title: 'Revisions to the Entity List' }).docType, 'Rule', 'plain whitespace around the label is trimmed');
});

test('hostile provider text is cleaned to inert plain text and capped', () => {
  const title = `<img src=x onerror=alert(1)>${rtl}${bell}${nul}<script>alert(1)</script>Evil${zero}  Notice\n\t of   "Mars" ${'A'.repeat(5000)}`;
  const row = one({ title });
  for (const value of [row.title, row.summary]) { assert.doesNotMatch(value, /[<>]/); assert.doesNotMatch(value, /onerror=alert\(1\)>/); assert.doesNotMatch(value, new RegExp(`[${rtl}${zero}${bell}${nul}]`)); assert.doesNotMatch(value, /[\n\t]/); }
  assert.match(row.title, /^alert\(1\)Evil Notice of "Mars" A+$/, 'tags are removed, the remaining text is inert'); assert.ok(row.title.length <= 300, `title length ${row.title.length}`); assert.ok(row.summary.length <= 700, `summary length ${row.summary.length}`);
  for (const unclosed of ['NOTICE <img src=x onerror=alert(1)', 'NOTICE > <b', '<<img>>ORDER', 'A<B>C<']) assert.doesNotMatch(one({ title: unclosed }).title, /[<>]/, unclosed);
  for (const value of [undefined, null, 5, {}, [], '', `<i></i>${rtl}   `]) assert.equal(rows([entry(1, { title: value })]).length, 0, 'a document without a readable title is dropped');
  assert.equal(parse(answers([entry(1, { title: '<script>alert(1)</script>Real title' })], [])).observations[0].title, 'alert(1)Real title');
});

test('the link is the document page on federalregister.gov, anything else gives the short link by number', () => {
  const link = html_url => one({ document_number: '2026-90001', html_url }).url;
  const own = 'https://www.federalregister.gov/documents/2026/10/02/2026-90001/some-title';
  assert.equal(link(own), own);
  const short = 'https://www.federalregister.gov/d/2026-90001';
  for (const bad of [undefined, null, 5, {}, '', 'javascript:alert(1)', 'http://www.federalregister.gov/documents/2026/10/02/2026-90001/x', 'https://evil.example/documents/2026/10/02/2026-90001/x',
    'https://www.federalregister.gov.evil.example/documents/2026/10/02/2026-90001/x', 'https://user:pw@www.federalregister.gov/documents/2026/10/02/2026-90001/x', 'https://www.federalregister.gov/documents/2026/10/02/2026-90001/x?token=1',
    'https://www.federalregister.gov/documents/2026/10/02/2026-90001/x#frag', 'https://www.federalregister.gov/documents/2026/10/02/2026-90001/x y', 'https://www.federalregister.gov/documents/2026/10/02/2026-90001/"onmouseover=x',
    'https://www.federalregister.gov/documents/2026/10/02/2026-90001/../../../x', 'https://www.federalregister.gov/documents/2026/10/02//2026-90001/x', 'https://www.federalregister.gov/documents/2026/10/02/2026-90002/other-document',
    'https://www.federalregister.gov/documents/2026/10/02/2026-900011/x', 'https://www.federalregister.gov/agencies/foreign-assets-control-office', `https://www.federalregister.gov/documents/${'a/'.repeat(200)}2026-90001`, 'https://www.federalregister.gov/documents/\n2026-90001']) {
    assert.equal(link(bad), short, String(bad).slice(0, 60));
  }
  assert.equal(one({ document_number: 'C1-2026-16628', html_url: 'https://www.federalregister.gov/documents/2026/08/28/C1-2026-16628/streamlining' }).url, 'https://www.federalregister.gov/documents/2026/08/28/C1-2026-16628/streamlining');
});

// Standing rule for every adapter: cut the text to a fixed length first, then run regexes (a tag pattern that rescans from every '<' is quadratic).
test('hostile oversized provider text is cleaned in linear time', { timeout: 5000 }, () => {
  const started = Date.now();
  const floods = { lt: '<'.repeat(30000), openTag: '<a '.repeat(10000), gt: '>'.repeat(30000), nested: '<<>'.repeat(10000), spaces: ' '.repeat(30000) + 'NOTICE', words: 'A'.repeat(30000), controls: (bell + zero).repeat(15000), http: 'http://'.repeat(5000) };
  for (const [name, flood] of Object.entries(floods)) {
    const result = parse(answers([entry(1, { title: flood, type: flood, html_url: flood, document_number: flood, publication_date: flood }), entry(2, { title: `Entity List ${flood}`, type: 'Rule', html_url: flood, agencies: Array.from({ length: 3000 }, () => ({ slug: flood })) })], []));
    assert.equal(result.status, 'ok', name);
    for (const row of result.observations) { assert.doesNotMatch(row.title, /[<>]/, name); assert.ok(row.title.length <= 300, `${name} title length ${row.title.length}`); assert.ok(row.summary.length <= 700, `${name} summary length ${row.summary.length}`); assert.match(row.url, /^https:\/\/www\.federalregister\.gov\/d\/2026-90002$/, name); }
  }
  assert.equal(rows([entry(1, { title: floods.lt })]).length, 0); assert.match(rows([entry(1, { title: floods.openTag })])[0].title, /^a a a /);
  assert.equal(rows([entry(1, { title: floods.words })])[0].title.length, 300);
  assert.equal(rows([entry(1, { title: `${'<'.repeat(30000)}Entity List`, type: 'Rule' })]).length, 0, 'text beyond the cut never counts');
  for (const error of ['http://'.repeat(5000), '<'.repeat(30000), 'x'.repeat(30000)]) {
    const failed = parse({ OFAC: { error }, BIS: { error } });
    assert.equal(failed.status, 'error'); assert.ok(failed.error.length <= 300); assert.doesNotMatch(failed.error, /https?:/);
  }
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
});

test('provider ids are the document numbers, stable across parses and independent of the order', () => {
  assert.deepEqual(ids(parse(LIVE)), ids(parse(JSON.parse(JSON.stringify(LIVE))))); assert.deepEqual(ids(parse(LIVE)), LIVE_IDS);
  assert.deepEqual(ids(parse({ OFAC: page([...OFAC_DOCS].reverse()), BIS: page([...BIS_DOCS].reverse()) })), LIVE_IDS);
  const revised = JSON.parse(JSON.stringify(LIVE)); revised.OFAC.results[0].title = 'Notice of OFAC Sanctions Action (corrected title)';
  assert.equal(parse(revised).observations[0].providerId, '2026-20215', 'a revised title keeps the identity');
  assert.equal(new Set(ids(parse(LIVE))).size, 8);
  assert.deepEqual(ids(parse(answers([entry(1, { document_number: 'C1-2026-16628' }), entry(2, { document_number: '2026-16628' })], []))).sort(), ['2026-16628', 'C1-2026-16628'], 'a correction is a document of its own');
});

test('history keeps every document apart because every row has its own link, and does not grow between sweeps', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-fedreg-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const history = new HistoryStore(dir, { now: () => now + 3 * HOUR });
  const eventsFor = (payload, at = now) => buildEvents({ meta: { timestamp: iso(at) }, liveSources: normalizeLiveSources({ 'Federal-Register': parse(payload, { now: at }) }, at) }, { now: at });
  const live = eventsFor(LIVE);
  assert.equal(live.length, 8); assert.equal(new Set(live.map(event => event.id)).size, 8); assert.equal(new Set(live.map(event => event.source.url)).size, 8); assert.ok(live.every(event => event.kind === 'sanctions'));
  assert.equal(live.filter(event => event.title === 'Notice of OFAC Sanctions Action').length, 2, 'two notices with one title are two events');
  assert.deepEqual(history.add(live), { added: 8, updated: 0, ignored: 0, total: 8 });
  assert.deepEqual(history.add(eventsFor(LIVE, now + 15 * MINUTE)), { added: 0, updated: 8, ignored: 0, total: 8 }, 'the next sweep updates the same records and does not grow the history');
  const more = eventsFor(answers([entry(1, { publication_date: '2026-10-02', document_number: '2026-20300' }), ...OFAC_DOCS], BIS_DOCS), now + 2 * HOUR);
  assert.deepEqual(history.add(more), { added: 1, updated: 8, ignored: 0, total: 9 }, 'a new document is a new record');
  // Two documents the provider links to the same page would collapse in history, so the second gets the link of its own number.
  const samePage = rows([entry(1, { document_number: '2026-90001', html_url: 'https://www.federalregister.gov/documents/2026/10/02/2026-90001/a' }), entry(2, { document_number: '2026-90002', html_url: 'https://www.federalregister.gov/documents/2026/10/02/2026-90001/a' })]);
  assert.deepEqual(samePage.map(row => row.url).sort(), ['https://www.federalregister.gov/d/2026-90002', 'https://www.federalregister.gov/documents/2026/10/02/2026-90001/a']);
  const apartDir = mkdtempSync(join(tmpdir(), 'crucix-fedreg-')); t.after(() => rmSync(apartDir, { recursive: true, force: true }));
  assert.deepEqual(new HistoryStore(apartDir, { now: () => now + HOUR }).add(eventsFor(answers([entry(1, { document_number: '2026-90001', html_url: 'https://www.federalregister.gov/documents/2026/10/02/2026-90001/a' }), entry(2, { document_number: '2026-90002', html_url: 'https://www.federalregister.gov/documents/2026/10/02/2026-90001/a' })], []))), { added: 2, updated: 0, ignored: 0, total: 2 });
});

test('observations survive the server normalization with facts, severity and the registered home and policy', () => {
  assert.deepEqual(FACT_FIELDS['Federal-Register'], ['docType', 'agency']);
  assert.equal(HOME['Federal-Register'], 'https://www.federalregister.gov/');
  assert.deepEqual(POLICIES['Federal-Register'], { maxAgeMs: 336 * HOUR, observationMaxAgeMs: 336 * HOUR });
  const clock = Date.parse('2026-08-29T12:00:00Z');
  const [out] = normalizeLiveSources({ 'Federal-Register': parse(LIVE, { now: clock }) }, clock);
  assert.equal(out.status, 'ok'); assert.equal(out.url, 'https://www.federalregister.gov/'); assert.equal(out.observations.length, 3);
  const entryList = out.observations.find(row => row.providerId === '2026-17231');
  assert.equal(entryList.kind, 'sanctions'); assert.equal(entryList.severity, 'moderate'); assert.equal(entryList.observedAt, '2026-08-24T00:00:00.000Z'); assert.equal(entryList.url, 'https://www.federalregister.gov/documents/2026/08/24/2026-17231/revisions-to-the-entity-list');
  assert.deepEqual(entryList.facts, [{ label: 'docType', value: 'Rule' }, { label: 'agency', value: 'BIS' }]);
  assert.equal(entryList.lat, undefined); assert.equal(out.license, 'Public domain (1 CFR 2.6)'); assert.deepEqual(out.metrics, {});
  const events = buildEvents({ meta: { timestamp: iso(clock) }, liveSources: [out] }, { now: clock });
  assert.equal(events.length, 3); assert.ok(events.every(event => event.kind === 'sanctions'));
  const top = events.find(event => event.title === 'Revisions to the Entity List');
  assert.equal(top.severity, 'moderate'); assert.equal(top.source.url, 'https://www.federalregister.gov/documents/2026/08/24/2026-17231/revisions-to-the-entity-list');
  const eventIds = payload => buildEvents({ meta: { timestamp: iso(clock) }, liveSources: normalizeLiveSources({ 'Federal-Register': parse(payload, { now: clock }) }, clock) }, { now: clock }).map(event => event.id).sort();
  assert.deepEqual(eventIds(LIVE), eventIds(LIVE), 'event identities are stable across parses'); assert.equal(new Set(eventIds(LIVE)).size, 3);
});

test('briefing asks both agencies for their 15 newest documents with the listed fields and bounded requests', async () => {
  const seen = [];
  const result = await brief({ fetcher: async (url, options) => { seen.push({ url: new URL(url), options }); return page(url.includes('foreign-assets') ? OFAC_DOCS : BIS_DOCS); } });
  assert.equal(result.status, 'ok'); assert.equal(seen.length, 2); assert.deepEqual(ids(result), LIVE_IDS);
  assert.deepEqual(seen.map(({ url }) => url.searchParams.get('conditions[agencies][]')).sort(), ['foreign-assets-control-office', 'industry-and-security-bureau']);
  for (const { url, options } of seen) {
    assert.equal(url.origin + url.pathname, 'https://www.federalregister.gov/api/v1/documents.json');
    assert.equal(url.searchParams.get('order'), 'newest'); assert.equal(url.searchParams.get('per_page'), '15');
    assert.deepEqual(url.searchParams.getAll('fields[]'), ['title', 'document_number', 'publication_date', 'html_url', 'type', 'agencies']);
    assert.deepEqual({ ...options }, { timeout: 10000, retries: 0, maxBytes: 2 * MIB });
  }
});

test('briefing with one agency failing is still ok and with both failing is an error, without a URL, and it never throws', async () => {
  const partial = await brief({ fetcher: async url => url.includes('foreign-assets') ? { error: 'HTTP 503', status: 503 } : page(BIS_DOCS) });
  assert.equal(partial.status, 'ok'); assert.deepEqual(ids(partial), ['2026-20058', '2026-19927', '2026-19537']); assert.match(partial.summary, /OFAC request failed/);
  const thrownOne = await brief({ fetcher: async url => { if (url.includes('industry')) throw new Error('connect ECONNREFUSED https://www.federalregister.gov/?key=secret'); return page(OFAC_DOCS); } });
  assert.equal(thrownOne.status, 'ok'); assert.match(thrownOne.summary, /BIS request failed/); assert.doesNotMatch(thrownOne.summary, /https?:|secret|ECONNREFUSED/);
  const failures = [{ error: 'HTTP 503', status: 503 }, { error: 'HTTP 429', status: 429 }, { error: 'Request timed out after 10000ms' }, { error: 'Response exceeds 2097152 byte limit' }, { error: 'Invalid JSON response', status: 200 },
    { error: 'connect failed for https://www.federalregister.gov/api/v1/documents.json?key=secret' }, [], null, 'text'];
  for (const payload of failures) {
    const result = await brief({ fetcher: async () => payload });
    assert.equal(result.status, 'error', JSON.stringify(payload)); assert.deepEqual(result.observations, []); assert.equal(result.observedAt, null);
    assert.doesNotMatch(result.error, /https?:|federalregister\.gov|secret/i);
  }
  const thrown = await brief({ fetcher: async () => { throw new Error('connect ECONNREFUSED https://www.federalregister.gov/?key=secret'); } });
  assert.equal(thrown.status, 'error'); assert.doesNotMatch(thrown.error, /https?:|federalregister\.gov|secret|ECONNREFUSED/i);
  assert.equal((await brief({ fetcher: () => { throw new Error('sync https://x'); } })).status, 'error');
});

test('briefing over the real fetch helper degrades 503, timeout, an oversized body and invalid JSON to error results', async () => {
  const cases = {
    '503': () => reply('down', { status: 503 }),
    'timeout': (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    'oversized': () => reply('x'.repeat(2 * MIB + 1)),
    'invalid json': () => reply('<html>not json</html>'),
    'network': () => Promise.reject(new TypeError('fetch failed')),
  };
  for (const [name, impl] of Object.entries(cases)) {
    const result = await withFetch(impl, () => brief({ timeout: 25 }));
    assert.equal(result.status, 'error', name); assert.deepEqual(result.observations, [], name); assert.equal(result.observedAt, null, name);
    assert.doesNotMatch(result.error, /https?:|federalregister\.gov/i, name);
  }
  assert.match((await withFetch(cases.timeout, () => brief({ timeout: 25 }))).error, /timed out/i);
  assert.match((await withFetch(cases.oversized, () => brief({ timeout: 1000 }))).error, /exceeds|limit/i);
  const one503 = await withFetch(async url => String(url).includes('industry') ? reply('down', { status: 503 }) : reply(page(OFAC_DOCS)), () => brief({ timeout: 1000 }));
  assert.equal(one503.status, 'ok'); assert.match(one503.summary, /BIS request failed/);
  const ok = await withFetch(async url => reply(page(String(url).includes('industry') ? BIS_DOCS : OFAC_DOCS)), () => brief({}));
  assert.equal(ok.status, 'ok'); assert.equal(ok.observations.length, 8);
});

test('an unusable timeout option falls back to the 10 s limit and never exceeds it', async () => {
  const seen = [];
  for (const timeout of [undefined, 'abc', 0, -5, 99999, NaN]) await brief({ timeout, fetcher: async (url, options) => { seen.push(options.timeout); return page(OFAC_DOCS); } });
  assert.ok(seen.every(value => value >= 1 && value <= 10000)); assert.equal(seen[0], 10000);
});

test('an answer whose documents are all unreadable is an error now and is asked again at the next sweep, not kept for an hour', async () => {
  let drifted = true, calls = 0;
  const unreadable = docs => docs.map(({ document_number, ...rest }) => rest);
  const fetcher = async url => { calls++; const docs = url.includes('foreign-assets') ? OFAC_DOCS : BIS_DOCS; return page(drifted ? unreadable(docs) : docs); };
  const first = await brief({ fetcher, useCache: true });
  assert.equal(first.status, 'error'); assert.match(first.error, /unexpected shape/); assert.equal(calls, 2);
  drifted = false;
  const healed = await brief({ fetcher, useCache: true, now: now + 5 * MINUTE });
  assert.equal(healed.status, 'ok'); assert.equal(calls, 4, 'the unreadable answers were not cached: both agencies are asked again');
  const again = await brief({ fetcher, useCache: true, now: now + 6 * MINUTE });
  assert.equal(again.status, 'ok'); assert.equal(calls, 4, 'a readable answer is cached as before');
});

test('briefing caches a good answer per agency for an hour and never caches a failure', async () => {
  let calls = 0;
  const fetcher = async url => { calls++; return page(url.includes('foreign-assets') ? OFAC_DOCS : BIS_DOCS); };
  const cached = options => brief({ fetcher, useCache: true, ...options });
  const firstCall = await cached(); assert.equal(firstCall.status, 'ok'); assert.equal(calls, 2);
  const hit = await cached({ now: now + 59 * MINUTE });
  assert.equal(calls, 2, 'inside the hour nothing is asked'); assert.deepEqual(ids(hit), ids(firstCall)); assert.equal(hit.timestamp, iso(now + 59 * MINUTE), 'a cached answer is evaluated at the current time');
  await cached({ now: now + 60 * MINUTE }); assert.equal(calls, 4, 'after an hour both are asked again');
  await brief({ fetcher: async url => { calls++; return page(url.includes('foreign-assets') ? OFAC_DOCS : BIS_DOCS); }, useCache: true }); assert.equal(calls, 6, 'another fetcher does not read the cache');
  let attempts = 0;
  const flaky = async url => { attempts++; return url.includes('industry') && attempts <= 2 ? { error: 'HTTP 503' } : page(url.includes('foreign-assets') ? OFAC_DOCS : BIS_DOCS); };
  assert.match((await brief({ fetcher: flaky, useCache: true })).summary, /BIS request failed/);
  const healed = await brief({ fetcher: flaky, useCache: true });
  assert.equal(healed.status, 'ok'); assert.doesNotMatch(healed.summary, /request failed/, 'the failure was not cached'); assert.equal(attempts, 3, 'only the failed agency was asked again');
  let plain = 0;
  await brief({ fetcher: async () => { plain++; return page(OFAC_DOCS); } }); await brief({ fetcher: async () => { plain++; return page(OFAC_DOCS); } }); assert.equal(plain, 4, 'with an injected fetcher the cache is off unless asked for');
  let network = 0;
  const live = async url => { network++; return reply(page(String(url).includes('industry') ? BIS_DOCS : OFAC_DOCS)); };
  await withFetch(live, async () => { await briefing({ now: now + 3 * DAY }); await briefing({ now: now + 3 * DAY }); });
  assert.equal(network, 2, 'with the real fetch helper the cache is on');
});
