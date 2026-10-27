import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SOURCE,
  META,
  extractSection,
  extractRouteNumber,
  extractEventType,
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

    // Confirm allowed metadata fields and facts are populated
    assert.ok(obs.title.startsWith('[TESZTADAT]'));
    assert.ok(obs.link.startsWith('https://www.police.hu/'));
    assert.ok(obs.pubDate.includes('T'));
    assert.ok(obs.guid);
    assert.ok(obs.section);
    assert.equal(obs.source, SOURCE);
    assert.ok(obs.facts && typeof obs.facts === 'object');
  }
});

test('5. Extracted facts: settlement name, route number, and event type', () => {
  const res = parsePoliceRss(FIXTURE_XML, { now: REF_NOW });
  const [kozrend, baleset, bunugy, felhivas] = res.observations;

  // 1. Kozrendvedelem (county level, no settlement, no road, eventType: kozrendvedelem)
  assert.equal(kozrend.facts.settlement, null);
  assert.equal(kozrend.facts.routeNumber, null);
  assert.equal(kozrend.facts.eventType, 'kozrendvedelem');

  // 2. Baleset (Derecske, 47-es út, eventType: baleset)
  assert.equal(baleset.facts.settlement, 'Derecske');
  assert.equal(baleset.facts.routeNumber, '47');
  assert.equal(baleset.facts.eventType, 'baleset');

  // 3. Bunugy (Debrecen, eventType: bunugy)
  assert.equal(bunugy.facts.settlement, 'Debrecen');
  assert.equal(bunugy.facts.routeNumber, null);
  assert.equal(bunugy.facts.eventType, 'bunugy');

  // 4. Felhivas (Bihartorda, eventType: felhivas)
  assert.equal(felhivas.facts.settlement, 'Bihartorda');
  assert.equal(felhivas.facts.routeNumber, null);
  assert.equal(felhivas.facts.eventType, 'felhivas');

  // Helper unit tests for extractRouteNumber
  assert.equal(extractRouteNumber('Baleset a 47-es főúton'), '47');
  assert.equal(extractRouteNumber('Torlódás az M35 autópályán'), 'M35');
  assert.equal(extractRouteNumber('Forgalomkorlátozás a 4-es úton'), '4');
  assert.equal(extractRouteNumber('Útkarbantartás a 471-es úton'), '471');
  assert.equal(extractRouteNumber('Csendes éjszaka'), null);

  // Helper unit tests for extractEventType
  assert.equal(extractEventType('Karambol a belvárosban', 'utinfo'), 'baleset');
  assert.equal(extractEventType('Elfogták a körözött férfit', 'hirek'), 'bunugy');
  assert.equal(extractEventType('Eltűnt kamaszlányt keres a rendőrség', 'hirek'), 'felhivas');
  assert.equal(extractEventType('Fokozott közúti ellenőrzés', 'hirek'), 'kozrendvedelem');
  assert.equal(extractEventType('Teljes útlezárás a szakaszon', 'utinfo'), 'forgalomkorlatozas');
});

test('6. Section extraction from URLs: recognizes kozrendvedelem, baleseti-hirek, bunugyek, felhivasok', () => {
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/kozrendvedelem/fokozott-ellenorzes'), 'kozrendvedelem');
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/utinfo/baleseti-hirek/baleset-derecske'), 'baleseti-hirek');
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/bunugyek/orizetbe-vetel'), 'bunugyek');
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/felhivasok/eltunt-szemely'), 'felhivasok');
  assert.equal(extractSection('https://www.police.hu/hu/hirek-es-informaciok/utinfo/utlezaras'), 'utinfo');
  assert.equal(extractSection(''), 'egyeb');
});

test('7. Deduplication: Duplicate item with identical guid/link is filtered out', () => {
  const res = parsePoliceRss(FIXTURE_XML, { now: REF_NOW });
  assert.equal(res.examinedCount, 5, 'Examined count reflects all 5 items in XML');
  assert.equal(res.acceptedCount, 4, 'Accepted count reflects 4 unique items');
  assert.equal(res.observations.length, 4);

  const guids = res.observations.map(o => o.guid);
  assert.equal(new Set(guids).size, 4, 'All accepted observations have unique GUIDs');
});

test('8. Territorial classification: County level by default, settlements are strictly text_mention and NEVER confirmedLocal', () => {
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

test('9. Technical block enforcement: robots.txt, 403, 429, WAF halts adapter with status: disabled without retry', async () => {
  // 1. Explicit robots.txt block
  const robotsRes = await briefing({ enabled: true, robotsDisallowed: true, now: REF_NOW });
  assert.equal(robotsRes.status, 'disabled');
  assert.equal(robotsRes.disabled, true);
  assert.equal(robotsRes.technicalBlock, true);
  assert.ok(robotsRes.reason.includes('robots.txt'));
  assert.deepEqual(robotsRes.observations, []);

  // 2. HTTP 403 Forbidden / WAF block
  const fetch403 = async () => ({ status: 403, error: 'HTTP 403' });
  const res403 = await briefing({ enabled: true, fetchFn: fetch403, now: REF_NOW });
  assert.equal(res403.status, 'disabled');
  assert.equal(res403.disabled, true);
  assert.equal(res403.technicalBlock, true);
  assert.ok(res403.reason.includes('403') || res403.reason.includes('Technikai tiltás'));

  // 3. HTTP 429 Rate Limit block
  const fetch429 = async () => ({ status: 429, error: 'HTTP 429 Too Many Requests' });
  const res429 = await briefing({ enabled: true, fetchFn: fetch429, now: REF_NOW });
  assert.equal(res429.status, 'disabled');
  assert.equal(res429.disabled, true);
  assert.equal(res429.technicalBlock, true);

  // 4. WAF Challenge text in error
  const fetchWaf = async () => ({ error: 'Blocked by Cloudflare WAF challenge' });
  const resWaf = await briefing({ enabled: true, fetchFn: fetchWaf, now: REF_NOW });
  assert.equal(resWaf.status, 'disabled');
  assert.equal(resWaf.disabled, true);
  assert.equal(resWaf.technicalBlock, true);
});

test('10. Conditional headers and 304 Not Modified handling', async () => {
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

test('11. Robustness and error handling: Malformed XML and general network errors', async () => {
  // 1. Malformed XML
  const badXmlRes = parsePoliceRss('<<<invalid xml', { now: REF_NOW });
  assert.equal(badXmlRes.status, 'error');
  assert.ok(badXmlRes.error.includes('XML értelmezési hiba') || badXmlRes.error.includes('XML'));
  assert.deepEqual(badXmlRes.observations, []);

  // 2. Empty string
  const emptyRes = parsePoliceRss('', { now: REF_NOW });
  assert.equal(emptyRes.status, 'error');

  // 3. Transient network error (non-block)
  const netErrorFetch = async () => ({ error: 'Connection reset by peer', status: 500 });
  const netErrorRes = await briefing({ enabled: true, fetchFn: netErrorFetch, now: REF_NOW });
  assert.equal(netErrorRes.status, 'error');
  assert.ok(netErrorRes.error.includes('Connection reset'));
});

test('12. Freshness staleness calculation: evaluates 1-hour maxAgeMs correctly', () => {
  const freshRes = parsePoliceRss(FIXTURE_XML, { now: REF_NOW });
  assert.equal(freshRes.status, 'ok');
  assert.equal(freshRes.stale, false);

  const staleNow = Date.parse('2026-10-27T13:30:00.000Z');
  const staleRes = parsePoliceRss(FIXTURE_XML, { now: staleNow });
  assert.equal(staleRes.status, 'stale');
  assert.equal(staleRes.stale, true);
  assert.equal(staleRes.freshness.reason, 'expired-provider-time');
});
