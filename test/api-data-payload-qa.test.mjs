import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { startQaServer } from '../scripts/qa-server.mjs';
import { isNewsEvent } from '../lib/intelligence/views.mjs';

test('/api/data QA walkthrough: physical-only events, news in views.news, newsId resolution, inspector lookup, and payload measurement', async () => {
  const tempRunsDir = mkdtempSync(path.join(tmpdir(), 'crucix-qa-test-runs-'));
  const testPort = '3197';

  const now = Date.now();
  const physId1 = 'event-11111111111111111111111111111101';
  const physId2 = 'event-11111111111111111111111111111102';
  const newsId1 = 'event-22222222222222222222222222222201';
  const newsId2 = 'event-22222222222222222222222222222202';

  const physicalEvent1 = {
    id: physId1,
    kind: 'earthquake',
    title: 'M4.2 Földrengés Kelet-Magyarország',
    summary: 'Mérsékelt rengés Debrecen térségében',
    source: { name: 'USGS', status: 'ok' },
    observedAt: new Date(now - 10000).toISOString(),
    location: { lat: 47.5, lon: 21.6 }
  };
  const physicalEvent2 = {
    id: physId2,
    kind: 'weather',
    title: 'Viharos szél figyelmeztetés Hajdú-Bihar',
    summary: 'Sárga riasztás',
    source: { name: 'Meteoalarm', status: 'ok' },
    observedAt: new Date(now - 5000).toISOString(),
    location: { lat: 47.3, lon: 21.4 }
  };
  const newsEvent1 = {
    id: newsId1,
    kind: 'news',
    title: 'Új ipari parki beruházás Debrecenben',
    summary: 'Újabb fejlesztések indulnak a déli ipari parkban.',
    source: { name: 'RSS-Dehir', status: 'ok' },
    observedAt: new Date(now - 60000).toISOString(),
    publishedAt: new Date(now - 60000).toISOString(),
    location: { lat: 47.53, lon: 21.62, label: 'Debrecen' }
  };
  const newsEvent2 = {
    id: newsId2,
    kind: 'news',
    title: 'Rendőrségi tájékoztató Berettyóújfalu',
    summary: 'Fokozott közúti ellenőrzések a 47-es főúton.',
    source: { name: 'Police-Hajdu', status: 'ok' },
    observedAt: new Date(now - 120000).toISOString(),
    publishedAt: new Date(now - 120000).toISOString(),
    location: { lat: 47.21, lon: 21.55, label: 'Berettyóújfalu' }
  };

  const syntheticSnapshot = {
    isPreSynthesizedFixture: true,
    meta: {
      timestamp: new Date(now).toISOString(),
      sourcesQueried: 63,
      sourcesOk: 58,
      sourcesFailed: 5,
      sourcesDisabled: 0
    },
    liveSources: [
      { source: 'USGS', status: 'ok', observations: [physicalEvent1] },
      { source: 'Meteoalarm', status: 'ok', observations: [physicalEvent2] },
      { source: 'RSS-Dehir', status: 'ok', observations: [newsEvent1] },
      { source: 'Police-Hajdu', status: 'ok', observations: [newsEvent2] }
    ],
    events: [physicalEvent1, physicalEvent2, newsEvent1, newsEvent2],
    views: {
      local: { newsIds: [newsId1, newsId2], retainedNewsCount: 2 },
      county: { newsIds: [newsId1, newsId2], retainedNewsCount: 2 },
      national: { newsIds: [newsId1, newsId2], retainedNewsCount: 2 },
      global: { newsIds: [newsId1, newsId2], retainedNewsCount: 2 },
      news: [newsEvent1, newsEvent2]
    }
  };

  writeFileSync(path.join(tempRunsDir, 'latest.json'), JSON.stringify(syntheticSnapshot));

  let qaServer;
  try {
    qaServer = await startQaServer({
      port: testPort,
      runsDir: tempRunsDir
    });

    // 1. Verify /api/data response
    const res = await fetch(`http://127.0.0.1:${testPort}/api/data`);
    assert.equal(res.status, 200);
    const bodyText = await res.text();
    const servedData = JSON.parse(bodyText);

    // Assert no news in events (only physical events or fixtures)
    const hasNewsInEvents = servedData.events.some(e => isNewsEvent(e) && !e.isFixture);
    assert.equal(hasNewsInEvents, false, 'data.events must contain physical events only, zero news');
    assert.ok(servedData.views.news.length > 0, 'data.views.news must be populated');

    // Assert all newsIds in all views resolve against views.news
    const newsMap = new Map(servedData.views.news.map(n => [n.id, n]));
    let totalResolvedIds = 0;
    for (const v of ['local', 'county', 'national', 'global']) {
      const ids = servedData.views[v]?.newsIds || [];
      for (const id of ids) {
        assert.ok(newsMap.has(id), `News ID ${id} in view ${v} must resolve against views.news`);
        totalResolvedIds++;
      }
    }
    assert.ok(totalResolvedIds > 0, 'Must have verified resolved newsIds across views');

    // 2. Verify inspector route resolves news item
    const inspectorRes = await fetch(`http://127.0.0.1:${testPort}/api/events/${newsId1}`);
    assert.equal(inspectorRes.status, 200, 'Inspector route must resolve news event with 200 OK');
    const resolvedEvent = await inspectorRes.json();
    assert.equal(resolvedEvent.id, newsId1);
    assert.equal(resolvedEvent.title, newsEvent1.title);

    // 3. Measure payload size difference
    const servedBefore = {
      ...servedData,
      events: [...servedData.events, ...servedData.views.news]
    };
    const beforePayload = JSON.stringify(servedBefore);
    const beforeRaw = Buffer.byteLength(beforePayload, 'utf8');
    const beforeGzip = zlib.gzipSync(beforePayload).length;

    const afterPayload = JSON.stringify(servedData);
    const afterRaw = Buffer.byteLength(afterPayload, 'utf8');
    const afterGzip = zlib.gzipSync(afterPayload).length;

    assert.ok(afterRaw < beforeRaw, 'Deduplicated payload raw size must be smaller');
    assert.ok(afterGzip <= beforeGzip, 'Deduplicated payload gzip size must be smaller or equal');
  } finally {
    if (qaServer) await qaServer.stop();
    try { rmSync(tempRunsDir, { recursive: true, force: true }); } catch {}
  }
});
