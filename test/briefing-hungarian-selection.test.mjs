import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateBriefing } from '../lib/llm/briefing.mjs';
import { EntityStore, resolveEventCountries } from '../lib/intelligence/entities.mjs';

test('Requirement 2: briefing relevance distinction (purely foreign vs foreign with Hungarian connection vs unlocated regional)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-briefing-select-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const now = Date.parse('2026-10-22T12:00:00.000Z');
  const store = new EntityStore(dir, { now: () => now });
  store.load();

  // 1. Unlocated Hungarian regional news (no coordinates, no country in text)
  const unlocatedRegionalEvent = {
    id: `event-${'1'.repeat(32)}`,
    kind: 'news',
    title: 'Megkezdődött az őszi erdősítési program a térségben',
    summary: 'Széles körű faültetési akció indult a megyei természetvédelmi területeken.',
    source: { name: 'HAON', url: 'https://www.haon.hu/helyi-kozelet/2026/10/erdositesi-program-megye' },
    sourceRegion: 'Hajdú-Bihar',
    location: { method: 'unknown' },
    publishedAt: '2026-10-22T10:00:00.000Z',
    severity: 'unknown',
  };

  // 2. Purely foreign event without Hungarian connection (published by Hungarian outlet)
  const purelyForeignEvent = {
    id: `event-${'2'.repeat(32)}`,
    kind: 'news',
    title: 'Katasztrófa Romániában: árvíz pusztított a határ menti falvakban',
    summary: 'A szomszédos országban folyók léptek ki medrükből.',
    source: { name: 'HAON', url: 'https://www.haon.hu/orszag-vilag/2026/10/arviz-romania-hatar' },
    sourceRegion: 'Hajdú-Bihar',
    location: { method: 'unknown' },
    publishedAt: '2026-10-22T10:30:00.000Z',
    severity: 'high',
  };

  // 3. Foreign event WITH explicit Hungarian connection (bilateral event)
  const foreignWithHungarianRelevance = {
    id: `event-${'3'.repeat(32)}`,
    kind: 'news',
    title: 'Magyarországról indult segítség Romániába a gátszakadás után',
    summary: 'A magyarországi mentőalakulatok és szakemberek segítenek a szomszédos térségben.',
    source: { name: 'HAON', url: 'https://www.haon.hu/orszag-vilag/2026/10/magyar-segitseg-romania' },
    sourceRegion: 'Hajdú-Bihar',
    location: { method: 'unknown' },
    publishedAt: '2026-10-22T10:45:00.000Z',
    severity: 'high',
  };

  // 4. Domestic located event (Debrecen coordinates -> HUN country via coordinates)
  const domesticLocatedEvent = {
    id: `event-${'4'.repeat(32)}`,
    kind: 'news',
    title: 'Korszerű eszközökkel bővült a debreceni mentőszolgálat',
    summary: 'Új járműveket és felszereléseket adtak át Debrecenben.',
    source: { name: 'Dehir', url: 'https://dehir.hu/debrecen/uj-mentok-debrecen' },
    sourceRegion: 'Debrecen',
    location: { lat: 47.5316, lon: 21.6273, method: 'headline-keyword', precision: 'approximate' },
    publishedAt: '2026-10-22T11:00:00.000Z',
    severity: 'unknown',
  };

  // Verify entity country resolution:
  const unlocRes = resolveEventCountries(unlocatedRegionalEvent);
  assert.equal(unlocRes, null, 'Unlocated regional news has NO country resolved (not fake HUN)');

  const purelyForeignRes = resolveEventCountries(purelyForeignEvent);
  assert.deepEqual(purelyForeignRes, { c: ['ROU'], m: 'm' }, 'Purely foreign news resolves to ROU, NOT HUN');

  const bilateralRes = resolveEventCountries(foreignWithHungarianRelevance);
  assert.ok(bilateralRes?.c?.includes('HUN') && bilateralRes?.c?.includes('ROU'), 'Bilateral event includes BOTH HUN and ROU');

  const domRes = resolveEventCountries(domesticLocatedEvent);
  assert.deepEqual(domRes, { c: ['HUN'], m: 'm' }, 'Debrecen located event resolves to HUN via coordinates');

  // Ingest events into EntityStore
  store.ingest([unlocatedRegionalEvent, purelyForeignEvent, foreignWithHungarianRelevance, domesticLocatedEvent]);

  // Construct snapshot
  const snapshot = {
    crucix: { timestamp: new Date(now).toISOString() },
    events: [unlocatedRegionalEvent, purelyForeignEvent, foreignWithHungarianRelevance, domesticLocatedEvent]
  };

  // Generate HUN briefing
  const hunBriefing = await generateBriefing({
    scope: 'HUN',
    snapshot,
    store,
    language: 'hu',
    now
  });

  assert.equal(hunBriefing.scope, 'HUN');
  assert.ok(hunBriefing.bullets.length > 0, 'HUN briefing produced bullets');

  const citedIds = hunBriefing.bullets.flatMap(b => b.refs.map(r => r.id));

  // 1. Unlocated regional news MUST be included in HUN briefing via source-region:
  assert.ok(citedIds.includes(unlocatedRegionalEvent.id), 'Unlocated regional news is included in HUN briefing');

  // 2. Domestic located news MUST be included in HUN briefing:
  assert.ok(citedIds.includes(domesticLocatedEvent.id), 'Domestic located event is included in HUN briefing');

  // 3. Foreign event WITH explicit Hungarian connection MUST be included in HUN briefing:
  assert.ok(citedIds.includes(foreignWithHungarianRelevance.id), 'Foreign event WITH explicit Hungarian connection is INCLUDED in HUN briefing');

  // 4. Purely foreign news MUST NOT be included in HUN briefing despite being published by HAON:
  assert.ok(!citedIds.includes(purelyForeignEvent.id), 'Purely foreign event is EXCLUDED from HUN briefing');

  // 5. In ROU briefing, BOTH foreign events are included:
  const rouBriefing = await generateBriefing({
    scope: 'ROU',
    snapshot,
    store,
    language: 'hu',
    now
  });
  const rouCitedIds = rouBriefing.bullets.flatMap(b => b.refs.map(r => r.id));
  assert.ok(rouCitedIds.includes(purelyForeignEvent.id), 'Purely foreign event is included in ROU briefing');
  assert.ok(rouCitedIds.includes(foreignWithHungarianRelevance.id), 'Bilateral event is included in ROU briefing');
});
