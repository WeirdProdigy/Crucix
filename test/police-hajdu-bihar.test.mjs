import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SOURCE,
  META,
  ROBOTS_TXT_URL,
  extractSection,
  extractRouteNumber,
  extractEventType,
  detectSettlementMention,
  parsePoliceRss,
  parseRobotsTxtPolicy,
  checkRobotsTxt,
  resetRobotsCache,
  ROBOTS_CACHE_TTL_MS,
  HAJDU_BIHAR_KSH_SETTLEMENTS,
  briefing
} from '../apis/sources/police-hajdu-bihar.mjs';
import { POLICIES, FEED_POLICIES, ALL_POLICIES, POLICE_HAJDU_POLICY } from '../apis/utils/freshness.mjs';
import { evaluateEventTerritoryViews, VIEWS, VIEW_CATEGORIES } from '../lib/intelligence/views.mjs';
import { normalizeLiveSources, freshLiveSnapshot } from '../lib/intelligence/live-sources.mjs';
import { AlertEngine } from '../lib/alerts/engine.mjs';
import { DEFAULT_RULES } from '../lib/alerts/rules.mjs';
import { normalizeHistoryEvent, HistoryStore } from '../lib/intelligence/history.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const FIXTURE_PATH = join(ROOT, 'test/fixtures/police-hajdu-bihar-fixture.xml');
const FIXTURE_XML = readFileSync(FIXTURE_PATH, 'utf8');

// Reference time: 2026-10-27T12:00:00Z (30 minutes after channel pubDate 11:30)
const REF_NOW = Date.parse('2026-10-27T12:00:00.000Z');

test('1. Freshness policy: Police-Hajdu is registered in FEED_POLICIES with 12-hour maxAgeMs and 72-hour observationMaxAgeMs', () => {
  assert.ok(POLICE_HAJDU_POLICY, 'POLICE_HAJDU_POLICY is exported');
  assert.equal(POLICE_HAJDU_POLICY.maxAgeMs, 43200000, 'maxAgeMs is 12 hours (43200000 ms)');
  assert.equal(POLICE_HAJDU_POLICY.observationMaxAgeMs, 259200000, 'observationMaxAgeMs is 72 hours (259200000 ms)');
  assert.equal(FEED_POLICIES[SOURCE].maxAgeMs, 43200000);
  assert.equal(ALL_POLICIES[SOURCE].maxAgeMs, 43200000);
  assert.equal(POLICIES[SOURCE], undefined, 'POLICIES preserves only the 19 core sensor sources');
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

test('12. Freshness staleness calculation: evaluates 12-hour maxAgeMs correctly', () => {
  const freshRes = parsePoliceRss(FIXTURE_XML, { now: REF_NOW, lastModified: new Date(REF_NOW).toISOString() });
  assert.equal(freshRes.status, 'ok');
  assert.equal(freshRes.stale, false);

  const staleNow = REF_NOW + 13 * 3600000;
  const staleRes = parsePoliceRss(FIXTURE_XML, { now: staleNow, lastModified: new Date(REF_NOW).toISOString() });
  assert.equal(staleRes.status, 'stale');
  assert.equal(staleRes.stale, true);
  assert.equal(staleRes.freshness.reason, 'expired-provider-time');
});

test('13. Pipeline lifecycle: Police-Hajdu events must survive normalizeLiveSources and freshLiveSnapshot without dropping into staleEvents', () => {
  const parsed = parsePoliceRss(FIXTURE_XML, { now: REF_NOW });
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.observations.length, 4);

  // 1. normalizeLiveSources
  const normalized = normalizeLiveSources([parsed], REF_NOW);
  const policeNorm = normalized.find(s => s.source === SOURCE);
  assert.ok(policeNorm, 'Police-Hajdu must be normalized and retained in liveSources');
  assert.equal(policeNorm.status, 'ok');

  // 2. freshLiveSnapshot
  const obs = parsed.observations[0];
  const policeEvent = {
    id: 'event-police-test-1',
    title: obs.title,
    observedAt: obs.publishedAt,
    source: { name: SOURCE, url: obs.link, status: 'ok' },
    territory: obs.territory
  };

  const snapshot = {
    meta: { timestamp: new Date(REF_NOW).toISOString() },
    liveSources: [parsed],
    events: [policeEvent],
    staleEvents: []
  };

  const fresh = freshLiveSnapshot(snapshot, REF_NOW);
  assert.equal(fresh.events.length, 1, 'Police event must be preserved in active events');
  assert.equal(fresh.events[0].id, 'event-police-test-1');
  assert.equal(fresh.staleEvents.length, 0, 'Police event must NOT be dropped into staleEvents');
});

test('14. Robots.txt: parser checks, caching behavior, and technical block handling', async () => {
  resetRobotsCache();
  assert.equal(ROBOTS_TXT_URL, 'https://www.police.hu/robots.txt');

  // 1. Parsing tests
  const sampleDisallow = 'User-agent: *\nDisallow: /hu/rss\n';
  assert.deepEqual(parseRobotsTxtPolicy(sampleDisallow), { allowed: false, rule: 'Disallow: /hu/rss' });

  const sampleAllow = 'User-agent: *\nDisallow: /admin\nAllow: /\n';
  assert.deepEqual(parseRobotsTxtPolicy(sampleAllow), { allowed: true, rule: 'Allow: /' });

  const specificCrucixBlock = 'User-agent: Crucix\nDisallow: /\n';
  assert.deepEqual(parseRobotsTxtPolicy(specificCrucixBlock), { allowed: false, rule: 'Disallow: /' });

  // 2. Caching: fetchFn is invoked only once across repeated calls
  let fetchCount = 0;
  const mockFetch = async (url) => {
    fetchCount += 1;
    assert.equal(url, ROBOTS_TXT_URL);
    return { rawText: 'User-agent: *\nAllow: /\n', status: 200 };
  };

  resetRobotsCache();
  const res1 = await checkRobotsTxt({ fetchFn: mockFetch });
  assert.equal(res1.allowed, true);
  assert.equal(fetchCount, 1);

  const res2 = await checkRobotsTxt({ fetchFn: mockFetch });
  assert.equal(res2.allowed, true);
  assert.equal(fetchCount, 1, 'Cache reused: fetch count must not increase');

  // 3. resetRobotsCache clears cache
  resetRobotsCache();
  const res3 = await checkRobotsTxt({ fetchFn: mockFetch });
  assert.equal(res3.allowed, true);
  assert.equal(fetchCount, 2, 'Cache was cleared, second network fetch performed');

  resetRobotsCache();
});

test('15. Alert notification suppression: police events are informational and trigger ZERO notifying alerts', (t) => {
  const parsed = parsePoliceRss(FIXTURE_XML, { now: REF_NOW });
  assert.equal(parsed.status, 'ok');

  // Convert observations to standard Crucix event records
  const policeEvents = parsed.observations.map((obs, idx) => ({
    id: `event-police-${idx}`,
    kind: 'news',
    severity: 'low',
    title: obs.title,
    summary: '',
    source: { name: SOURCE, url: obs.link, status: 'ok' },
    observedAt: obs.publishedAt,
    publishedAt: obs.publishedAt,
    location: { lat: null, lon: null, method: 'unknown', label: obs.settlement, precision: 'settlement' },
    facts: obs.facts,
    territory: obs.territory
  }));

  // Verify notifying default rules
  const notifyingRules = DEFAULT_RULES.filter(r => r.notify);
  assert.ok(notifyingRules.length > 0, 'There are default notifying rules');
  for (const rule of notifyingRules) {
    if (rule.kind === 'event') {
      assert.ok(['critical', 'high'].includes(rule.params.minLevel), 'Event notify rules require critical or high level');
    }
  }

  // Run AlertEngine over isolated directory
  const root = mkdtempSync(join(tmpdir(), 'crucix-police-alert-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const engine = new AlertEngine(root, {
    now: () => REF_NOW,
    logger: { warn: () => {}, error: () => {}, log: () => {}, info: () => {} }
  });
  engine.load();

  // Bootstrap sweep
  engine.evaluate({ events: [] });

  // Sweep with police events
  const result = engine.evaluate({ events: policeEvents });

  // Verify that any created alerts have notify: false, and zero notifying alerts were generated
  const notifyingAlerts = (result.created || []).filter(a => a.notify);
  assert.equal(
    notifyingAlerts.length,
    0,
    'Police events must NEVER trigger notifying alerts (strictly informational, no regional alarm/push)'
  );
});

test('16. Dynamic territory derivation: derives NUTS and county metadata without hardcoded strings', () => {
  const customConfig = {
    primary: {
      id: 'custom-settlement',
      name: 'Tesztfalu',
      countyCode: '15',
      countyName: 'Szabolcs-Szatmár-Bereg',
      nuts3: 'HU323',
      nuts2: 'HU32',
      nuts0: 'HU',
      iso3: 'HUN'
    },
    watchedSettlements: [],
    keyConnections: []
  };

  const mention = detectSettlementMention('Baleset történt a határban', customConfig);
  assert.equal(mention.countyCode, '15');
  assert.equal(mention.countyName, 'Szabolcs-Szatmár-Bereg');
  assert.equal(mention.nuts3, 'HU323');
  assert.equal(mention.nuts2, 'HU32');
  assert.equal(mention.nuts0, 'HU');
  assert.equal(mention.iso3, 'HUN');
  assert.equal(mention.isConfirmedLocal, false);
});

test('17. Settlement extraction: Hajdúböszörmény, Derecske, Debrecen detection and ambiguous names -> unknown', () => {
  // 1. Hajdúböszörmény (newly added from full Hajdú-Bihar KSH list)
  const boszormeny = detectSettlementMention('Drogellenes akció Hajdúböszörményben');
  assert.equal(boszormeny.territoryLevel, 'settlement');
  assert.equal(boszormeny.settlementName, 'Hajdúböszörmény');
  assert.equal(boszormeny.settlementId, 'hajduboszormeny');
  assert.equal(boszormeny.needsLocalReview, true);
  assert.equal(boszormeny.isConfirmedLocal, false);

  // 2. Derecske
  const derecske = detectSettlementMention('Baleset történt Derecskén a 47-es főúton');
  assert.equal(derecske.territoryLevel, 'settlement');
  assert.equal(derecske.settlementName, 'Derecske');
  assert.equal(derecske.needsLocalReview, true);
  assert.equal(derecske.isConfirmedLocal, false);

  // 3. Debrecen
  const debrecen = detectSettlementMention('Fokozott ellenőrzés Debrecenben a hétvégén');
  assert.equal(debrecen.territoryLevel, 'settlement');
  assert.equal(debrecen.settlementName, 'Debrecen');
  assert.equal(debrecen.needsLocalReview, true);
  assert.equal(debrecen.isConfirmedLocal, false);

  // 4. Ambiguous names -> unknown
  const sap = detectSettlementMention('Baleset történt Sáp közelében');
  assert.equal(sap.territoryLevel, 'unknown');
  assert.equal(sap.settlementName, null);
  assert.equal(sap.matchState, 'ambiguous');

  const told = detectSettlementMention('Rendőri intézkedés Told határában');
  assert.equal(told.territoryLevel, 'unknown');
  assert.equal(told.settlementName, null);
  assert.equal(told.matchState, 'ambiguous');

  const szerep = detectSettlementMention('Baleset Szerep térségében');
  assert.equal(szerep.territoryLevel, 'unknown');
  assert.equal(szerep.matchState, 'ambiguous');

  const bojt = detectSettlementMention('Útlezárás Bojt közelében');
  assert.equal(bojt.territoryLevel, 'unknown');
  assert.equal(bojt.matchState, 'ambiguous');

  // Lowercase common noun "szerep" should NOT match ambiguous settlement
  const commonNoun = detectSettlementMention('Fontos szerepet játszott az intézkedés');
  assert.equal(commonNoun.territoryLevel, 'county');
  assert.equal(commonNoun.settlementName, undefined);
});

test('18. Separation of source health and item age: 8-hour-old latest item in fresh feed stays active, not stale_error', () => {
  const now = Date.parse('2026-10-27T20:00:00.000Z');
  // Synthetic feed XML with latest item published 8 hours ago (12:00:00Z)
  const eightHoursAgoXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Legfrissebb híreink - Hajdú-Bihar Megyei Rendőr-főkapitányság</title>
    <link>https://www.police.hu/hu/rss/Hajd%C3%BA-Bihar%20Megyei%20Rend%C5%91r-f%C5%91kapit%C3%A1nys%C3%A1g</link>
    <description>Friss hírek</description>
    <item>
      <title>Baleset a 47-es főúton Derecske térségében</title>
      <link>https://www.police.hu/hu/hirek-es-informaciok/utinfo/baleseti-hirek/baleset-derecske-8h</link>
      <guid>https://www.police.hu/derecske-8h</guid>
      <pubDate>Tue, 27 Oct 2026 12:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

  // 1. Parsing: with feed fetched right now, status is 'ok' (fresh) and item is preserved
  const res = parsePoliceRss(eightHoursAgoXml, { now });
  assert.equal(res.status, 'ok', 'Source status must be ok (freshly fetched feed)');
  assert.equal(res.stale, false);
  assert.equal(res.observations.length, 1, '8-hour-old observation must be retained under 72-hour policy');

  // 2. Normalization
  const normalized = normalizeLiveSources([res], now);
  assert.equal(normalized[0].status, 'ok');
  assert.equal(normalized[0].observations.length, 1);

  // 3. Snapshot and Coverage evaluation
  const obs = res.observations[0];
  const policeEvent = {
    id: 'event-police-8h-1',
    title: obs.title,
    observedAt: obs.publishedAt,
    publishedAt: obs.publishedAt,
    source: { name: SOURCE, url: obs.link, status: 'ok' },
    territory: obs.territory
  };

  const snapshot = {
    meta: { timestamp: new Date(now).toISOString() },
    liveSources: normalized,
    events: [policeEvent],
    staleEvents: [],
    coverage: [{
      id: SOURCE,
      name: SOURCE,
      domain: 'security',
      status: 'ok',
      origin: 'live',
      isSnapshot: false
    }]
  };

  const fresh = freshLiveSnapshot(snapshot, now);
  assert.equal(fresh.events.length, 1, 'Police event must remain in active events');
  assert.equal(fresh.staleEvents.length, 0, 'Police event must NOT be moved to staleEvents');

  // Coverage check: must be ok_data, NOT stale_error
  const cov = fresh.coverage.find(c => c.sourceId === SOURCE || c.sourceName === SOURCE);
  assert.ok(cov, 'Coverage entry exists for Police-Hajdu');
  assert.equal(cov.status, 'ok_data', 'Must be ok_data, never stale_error');
  assert.equal(cov.itemCount, 1);
});

test('19. Retention and privacy: felhivasok excluded from history.json, zero personal names in facts', (t) => {
  // 1. Personal name protection: ensure facts only contain settlement, routeNumber, eventType (no person names)
  const missingPersonTitle = 'Keressük Mezei Arabellát';
  const parsed = parsePoliceRss(`<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Hajdú-Bihar</title>
    <link>https://www.police.hu/</link>
    <item>
      <title>${missingPersonTitle}</title>
      <link>https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/felhivasok/keressuk-mezei-arabellat</link>
      <pubDate>Tue, 27 Oct 2026 11:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`, { now: REF_NOW });

  assert.equal(parsed.observations.length, 1);
  const obs = parsed.observations[0];
  assert.equal(obs.facts.settlement, null, 'Person name must not be mistaken for a settlement');
  assert.equal(obs.facts.person, undefined, 'person field must never exist in facts');
  assert.equal(obs.facts.eventType, 'felhivas');

  // 2. History exclusion: felhivasok must be completely rejected by normalizeHistoryEvent
  const felhivasEvent = {
    id: 'event-0123456789abcdef0123456789abcdef',
    title: obs.title,
    source: { name: SOURCE, url: obs.link, status: 'ok' },
    section: 'felhivasok',
    facts: obs.facts,
    observedAt: obs.publishedAt,
    publishedAt: obs.publishedAt,
    collectedAt: new Date(REF_NOW).toISOString(),
    location: { lat: 47.5, lon: 21.6, method: 'centroid', precision: 'approximate' }
  };

  const normalizedRecord = normalizeHistoryEvent(felhivasEvent);
  assert.equal(normalizedRecord, null, 'felhivasok records must return null from normalizeHistoryEvent and never enter history.json');

  // 3. Regular non-felhivas police event is allowed
  const newsEvent = {
    ...felhivasEvent,
    id: 'event-abcdef0123456789abcdef0123456789',
    title: 'Fokozott közúti ellenőrzés',
    section: 'kozrendvedelem',
    facts: { settlement: 'Debrecen', routeNumber: null, eventType: 'kozrendvedelem' },
    source: { name: SOURCE, url: 'https://www.police.hu/hu/kozrendvedelem/ellenorzes', status: 'ok' }
  };
  const normalizedNews = normalizeHistoryEvent(newsEvent);
  assert.ok(normalizedNews !== null, 'Regular police news events can be normalized into history');
});

test('20. Robots.txt: 24-hour TTL caching and retry on 403', async () => {
  resetRobotsCache();
  let fetchAttempts = 0;
  let simulatedStatus = 403;

  const mockFetcher = async () => {
    fetchAttempts++;
    if (simulatedStatus === 403) {
      return { status: 403, error: 'HTTP 403 Forbidden' };
    }
    return { status: 200, rawText: 'User-agent: *\nAllow: /\n' };
  };

  // 1. Initial 403 response
  const res1 = await checkRobotsTxt({ fetchFn: mockFetcher, now: 1000 });
  assert.equal(res1.allowed, false);
  assert.equal(fetchAttempts, 1);

  // 2. Immediate retry: since 403 must not be permanently cached, next call retries fetch!
  simulatedStatus = 200;
  const res2 = await checkRobotsTxt({ fetchFn: mockFetcher, now: 2000 });
  assert.equal(res2.allowed, true, 'Immediate retry after 403 succeeds');
  assert.equal(fetchAttempts, 2, 'Fetcher was invoked again (403 was not cached)');

  // 3. 24-hour TTL: within 24h, cache is reused
  const res3 = await checkRobotsTxt({ fetchFn: mockFetcher, now: 2000 + 3600000 }); // +1 hour
  assert.equal(res3.allowed, true);
  assert.equal(fetchAttempts, 2, 'Cache hit within 24 hours');

  // 4. After 24h TTL expires: fetcher is called again
  const res4 = await checkRobotsTxt({ fetchFn: mockFetcher, now: 2000 + ROBOTS_CACHE_TTL_MS + 1000 }); // +24h + 1s
  assert.equal(res4.allowed, true);
  assert.equal(fetchAttempts, 3, 'Refetched after 24-hour TTL expiry');

  resetRobotsCache();
});



