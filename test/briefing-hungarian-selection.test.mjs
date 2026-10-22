import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateBriefing } from '../lib/llm/briefing.mjs';
import { EntityStore, resolveEventCountries } from '../lib/intelligence/entities.mjs';

test('Requirement 2: unlocated Hungarian regional news is included in HUN briefing via source-region without fake HUN country; foreign news is excluded', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-briefing-select-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const now = Date.parse('2026-10-22T12:00:00.000Z');
  const store = new EntityStore(dir, { now: () => now });
  store.load();

  // 1. Unlocated Hungarian regional news (no coordinates, no explicit country name in text)
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

  // 2. Foreign event published by Hungarian regional media (explicitly mentioning Romania)
  const foreignEvent = {
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

  // 3. Domestic located event (Debrecen coordinates -> HUN country via countryAt)
  const domesticLocatedEvent = {
    id: `event-${'3'.repeat(32)}`,
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

  const foreignRes = resolveEventCountries(foreignEvent);
  assert.deepEqual(foreignRes, { c: ['ROU'], m: 'm' }, 'Foreign news is correctly resolved to ROU, NOT HUN');

  const domRes = resolveEventCountries(domesticLocatedEvent);
  assert.deepEqual(domRes, { c: ['HUN'], m: 'm' }, 'Debrecen located event is resolved to HUN via coordinates');

  // Ingest events into EntityStore
  store.ingest([unlocatedRegionalEvent, foreignEvent, domesticLocatedEvent]);

  // Construct snapshot
  const snapshot = {
    crucix: { timestamp: new Date(now).toISOString() },
    events: [unlocatedRegionalEvent, foreignEvent, domesticLocatedEvent]
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

  // Collect all event IDs cited in HUN briefing
  const citedIds = hunBriefing.bullets.flatMap(b => b.refs.map(r => r.id));

  // The unlocated regional news MUST be citable in HUN briefing:
  assert.ok(citedIds.includes(unlocatedRegionalEvent.id), 'Unlocated regional news is included in HUN briefing');

  // The domestic located news MUST be citable in HUN briefing:
  assert.ok(citedIds.includes(domesticLocatedEvent.id), 'Domestic located event is included in HUN briefing');

  // The foreign news (Romániában -> ROU) MUST NOT be included in HUN briefing despite being published by HAON:
  assert.ok(!citedIds.includes(foreignEvent.id), 'Foreign event published by Hungarian outlet is EXCLUDED from HUN briefing');

  // The foreign news IS included in ROU briefing:
  const rouBriefing = await generateBriefing({
    scope: 'ROU',
    snapshot,
    store,
    language: 'hu',
    now
  });
  const rouCitedIds = rouBriefing.bullets.flatMap(b => b.refs.map(r => r.id));
  assert.ok(rouCitedIds.includes(foreignEvent.id), 'Foreign event is correctly included in its own country scope (ROU)');
});
