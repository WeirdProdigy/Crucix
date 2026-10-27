import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SOURCE,
  META,
  extractSection,
  detectSettlementMention,
  parsePoliceRss,
  briefing
} from '../apis/sources/police-hajdu-bihar.mjs';
import { POLICIES, POLICE_HAJDU_POLICY } from '../apis/utils/freshness.mjs';
import { evaluateEventTerritoryViews, VIEWS, VIEW_CATEGORIES } from '../lib/intelligence/views.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const FIXTURE_PATH = join(ROOT, 'test/fixtures/police-hajdu-bihar-fixture.xml');
const FIXTURE_XML = readFileSync(FIXTURE_PATH, 'utf8');

// Reference time: 2026-10-27T12:00:00Z (30 minutes after channel pubDate 11:30)
const REF_NOW = Date.parse('2026-10-27T12:00:00.000Z');

test('1. Freshness policy: Police-Hajdu is registered with a 1-hour maxAgeMs and 24-hour observationMaxAgeMs', () => {
  assert.ok(POLICE_HAJDU_POLICY, 'POLICE_HAJDU_POLICY is exported');
  assert.equal(POLICE_HAJDU_POLICY.maxAgeMs, 3600000, 'maxAgeMs is 1 hour (3600000 ms)');
  assert.equal(POLICE_HAJDU_POLICY.observationMaxAgeMs, 86400000, 'observationMaxAgeMs is 24 hours (86400000 ms)');
  assert.equal(POLICIES[SOURCE].maxAgeMs, 3600000);
});

test('2. Opt-in behavior: Disabled by default without environment variable, strictly zero network calls', async () => {
  const oldEnv = process.env.CRUCIX_ENABLE_POLICE_HAJDU;
  try {
    delete process.env.CRUCIX_ENABLE_POLICE_HAJDU;
    let networkCallMade = false;
    const fetchSpy = async () => {
      networkCallMade = true;
      return { rawText: FIXTURE_XML };
    };

    const res = await briefing({ fetchFn: fetchSpy, now: REF_NOW });
    assert.equal(res.source, SOURCE);
    assert.equal(res.status, 'disabled');
    assert.equal(res.disabled, true);
    assert.deepEqual(res.observations, []);
    assert.equal(networkCallMade, false, 'Strictly zero network calls when opt-in is disabled');
    assert.ok(res.reason.includes('CRUCIX_ENABLE_POLICE_HAJDU'), 'Reason names the opt-in variable');
  } finally {
    if (oldEnv !== undefined) process.env.CRUCIX_ENABLE_POLICE_HAJDU = oldEnv;
  }
});

test('3. Opt-in behavior: Enabled via env var or options flag', async () => {
  const oldEnv = process.env.CRUCIX_ENABLE_POLICE_HAJDU;
  try {
    process.env.CRUCIX_ENABLE_POLICE_HAJDU = 'true';
    const res = await briefing({
      fixtureXml: FIXTURE_XML,
      now: REF_NOW
    });
    assert.equal(res.source, SOURCE);
    assert.equal(res.status, 'ok');
    assert.equal(res.observations.length, 4);
  } finally {
    if (oldEnv !== undefined) process.env.CRUCIX_ENABLE_POLICE_HAJDU = oldEnv;
  }
});

test('4. Legal/Copyright compliance: <description> and lead text are strictly discarded and never stored', () => {
  const res = parsePoliceRss(FIXTURE_XML, { now: REF_NOW });
  assert.equal(res.status, 'ok');
  assert.ok(res.observations.length > 0);

  for (const obs of res.observations) {
    assert.equal(obs.description, undefined, 'description must not exist on observation');
    assert.ok(!('description' in obs), 'description property key must be absent');
    assert.equal(obs.lead, undefined, 'lead must not exist on observation');
    assert.equal(obs.content, undefined, 'content must not exist on observation');

    // Confirm allowed metadata fields are populated
    assert.ok(obs.title.startsWith('[TESZTADAT]'));
    assert.ok(obs.link.startsWith('https://www.police.hu/'));
    assert.ok(obs.pubDate.includes('T'));
    assert.ok(obs.guid);
    assert.ok(obs.section);
    assert.equal(obs.source, SOURCE);
  }
});

test('5. Section extraction from URLs: recognizes kozrendvedelem, baleseti-hirek, bunugyek, felhivasok', () => {
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/kozrendvedelem/fokozott-ellenorzes'), 'kozrendvedelem');
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/utinfo/baleseti-hirek/baleset-derecske'), 'baleseti-hirek');
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/bunugyek/orizetbe-vetel'), 'bunugyek');
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/felhivasok/eltunt-szemely'), 'felhivasok');
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/utinfo/utlezaras'), 'utinfo');
  assert.equal(extractSection(''), 'egyeb');
});

test('6. Deduplication: Duplicate item with identical guid/link is filtered out', () => {
  const res = parsePoliceRss(FIXTURE_XML, { now: REF_NOW });
  // The fixture XML has 5 items total, 2 of which have the same guid/link
  assert.equal(res.examinedCount, 5, 'Examined count reflects all 5 items in XML');
  assert.equal(res.acceptedCount, 4, 'Accepted count reflects 4 unique items');
  assert.equal(res.observations.length, 4);

  const guids = res.observations.map(o => o.guid);
  assert.equal(new Set(guids).size, 4, 'All accepted observations have unique GUIDs');
});

test('7. Territorial classification: County level by default, settlements are strictly text_mention and NEVER confirmedLocal', () => {
  const res = parsePoliceRss(FIXTURE_XML, { now: REF_NOW });
  const [kozrend, baleset, bunugy, felhivas] = res.observations;

  // 1. County-level news without specific settlement mention
  assert.equal(kozrend.territory.territoryLevel, 'county');
  assert.equal(kozrend.territory.countyCode, '09');
  assert.equal(kozrend.territory.isConfirmedLocal, false);
  const kozrendViews = evaluateEventTerritoryViews(kozrend);
  assert.equal(kozrendViews[VIEWS.COUNTY].inView, true);
  assert.equal(kozrendViews[VIEWS.COUNTY].category, VIEW_CATEGORIES.COUNTY_EVENT);
  assert.notEqual(kozrendViews[VIEWS.LOCAL].category, VIEW_CATEGORIES.CONFIRMED_LOCAL);

  // 2. Settlement mention in Derecske
  assert.equal(baleset.territory.territoryLevel, 'settlement');
  assert.equal(baleset.territory.settlementId, 'derecske');
  assert.equal(baleset.territory.localRelevanceReason, 'text_mention');
  assert.equal(baleset.territory.needsLocalReview, true);
  assert.equal(baleset.territory.isConfirmedLocal, false, 'NEVER confirmedLocal');

  // 3. Settlement mention in Debrecen (key connection city)
  assert.equal(bunugy.territory.territoryLevel, 'settlement');
  assert.equal(bunugy.territory.settlementId, 'debrecen');
  assert.equal(bunugy.territory.localRelevanceReason, 'text_mention');
  assert.equal(bunugy.territory.needsLocalReview, true);
  assert.equal(bunugy.territory.isConfirmedLocal, false, 'NEVER confirmedLocal');
  const bunugyViews = evaluateEventTerritoryViews(bunugy);
  assert.equal(bunugyViews[VIEWS.LOCAL].inView, true);
  assert.equal(bunugyViews[VIEWS.LOCAL].category, VIEW_CATEGORIES.NEEDS_REVIEW);
  assert.notEqual(bunugyViews[VIEWS.LOCAL].category, VIEW_CATEGORIES.CONFIRMED_LOCAL);

  // 4. Settlement mention in Bihartorda (primary watched settlement)
  assert.equal(felhivas.territory.territoryLevel, 'settlement');
  assert.equal(felhivas.territory.settlementId, 'bihartorda');
  assert.equal(felhivas.territory.localRelevanceReason, 'text_mention');
  assert.equal(felhivas.territory.needsLocalReview, true);
  assert.equal(felhivas.territory.isConfirmedLocal, false, 'NEVER confirmedLocal');
  const felhivasViews = evaluateEventTerritoryViews(felhivas);
  assert.equal(felhivasViews[VIEWS.LOCAL].inView, true);
  assert.equal(felhivasViews[VIEWS.LOCAL].category, VIEW_CATEGORIES.NEEDS_REVIEW, 'Must be needsReview, never confirmedLocal');
  assert.notEqual(felhivasViews[VIEWS.LOCAL].category, VIEW_CATEGORIES.CONFIRMED_LOCAL);
});

test('8. Conditional headers and 304 Not Modified handling', async () => {
  const headersSent = {};
  const mockFetch = async (url, opts) => {
    Object.assign(headersSent, opts.headers);
    return { status: 304 };
  };

  const res = await briefing({
    enabled: true,
    fetchFn: mockFetch,
    etag: '"abc-123"',
    ifModifiedSince: 'Tue, 27 Oct 2026 11:00:00 GMT',
    now: REF_NOW
  });

  assert.equal(headersSent['If-None-Match'], '"abc-123"');
  assert.equal(headersSent['If-Modified-Since'], 'Tue, 27 Oct 2026 11:00:00 GMT');
  assert.equal(res.status, 'ok');
  assert.equal(res.notModified, true);
  assert.deepEqual(res.observations, []);
});

test('9. Robustness and error handling: Malformed XML and network error fallbacks', async () => {
  // 1. Malformed XML
  const badXmlRes = parsePoliceRss('<<<invalid xml', { now: REF_NOW });
  assert.equal(badXmlRes.status, 'error');
  assert.ok(badXmlRes.error.includes('XML értelmezési hiba') || badXmlRes.error.includes('XML'));
  assert.deepEqual(badXmlRes.observations, []);

  // 2. Empty string
  const emptyRes = parsePoliceRss('', { now: REF_NOW });
  assert.equal(emptyRes.status, 'error');

  // 3. Network fetch error
  const netErrorFetch = async () => ({ error: 'Connection refused' });
  const netErrorRes = await briefing({ enabled: true, fetchFn: netErrorFetch, now: REF_NOW });
  assert.equal(netErrorRes.status, 'error');
  assert.ok(netErrorRes.error.includes('Connection refused'));
});

test('10. Freshness staleness calculation: evaluates 1-hour maxAgeMs correctly', () => {
  // At REF_NOW (12:00 UTC), channel pubDate (11:30 UTC) is 30m old -> fresh ('ok')
  const freshRes = parsePoliceRss(FIXTURE_XML, { now: REF_NOW });
  assert.equal(freshRes.status, 'ok');
  assert.equal(freshRes.stale, false);

  // At 2 hours later (13:30 UTC), channel pubDate is 2h old -> stale (stale threshold is 1 hour)
  const staleNow = Date.parse('2026-10-27T13:30:00.000Z');
  const staleRes = parsePoliceRss(FIXTURE_XML, { now: staleNow });
  assert.equal(staleRes.status, 'stale');
  assert.equal(staleRes.stale, true);
  assert.equal(staleRes.freshness.reason, 'expired-provider-time');
});
