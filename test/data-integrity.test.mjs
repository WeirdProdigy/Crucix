import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchAllNews, buildNewsFeed, loadOpenSkyFallback } from '../dashboard/inject.mjs';
import { runSource } from '../apis/briefing.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { MemoryManager } from '../lib/delta/memory.mjs';
import { fetchQuote } from '../apis/sources/yfinance.mjs';
import { briefing as epa } from '../apis/sources/epa.mjs';
import { briefing as treasury } from '../apis/sources/treasury.mjs';

test('source-level failures and opt-outs cannot inflate successful source count', async () => {
  assert.equal((await runSource('broken', async () => ({ error: 'denied' }))).status, 'error');
  assert.equal((await runSource('disabled', async () => ({ disabled: true }))).status, 'disabled');
  assert.equal((await runSource('stale', async () => ({ stale: true }))).status, 'stale');
  assert.equal((await runSource('empty', async () => ({ count: 0 }))).status, 'ok');
  assert.equal((await runSource('bad', async () => null)).status, 'error');
  assert.equal((await runSource('who', async () => ({ outbreakError: 'denied' }))).status, 'error');
  assert.equal((await runSource('defense', async () => ({ defenseError: 'denied' }))).data.error, 'Partial source failure: denied');
  assert.equal((await runSource('kiwi', async () => ({ status: 'error', message: 'denied' }))).status, 'error');
});
test('news without a location stays in feed; inferred map coordinates remain stable', async t => {
  const server = http.createServer((_req, res) => res.end('<rss><channel><item><title>Ukraine update</title></item><item><title>Unlocated science discovery</title></item></channel></rss>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const feeds = [[`http://127.0.0.1:${server.address().port}`, 'SBS Australia']];
  const first = await fetchAllNews(feeds);
  const second = await fetchAllNews(feeds);
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.equal(first[0].locationMethod, 'headline-keyword');
  assert.equal(first[1].lat, undefined);
  assert.equal(buildNewsFeed(first, {}, [], []).length, 2);
});
test('GDELT timestamps preserve provider time, unknown dates remain unknown', () => {
  const feed = buildNewsFeed([], { allArticles: [{ title: 'Known', seendate: '20260930T123456Z' }, { title: 'Unknown', seendate: 'bad' }] }, [], []);
  assert.equal(feed[0].timestamp, '2026-09-30T12:34:56.000Z');
  assert.equal(feed[1].timestamp, null);
});
test('air fallback uses observation time, rejects unknown, future and expired snapshots', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-air-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const snapshot = (file, timestamp, error) => writeFileSync(join(dir, file), JSON.stringify({ sources: { OpenSky: { timestamp, error, hotspots: [{ totalAircraft: 5 }] } } }));
  snapshot('briefing_z.json', '2026-10-01T11:10:00Z');
  snapshot('briefing_a.json', '2026-10-01T11:50:00Z');
  snapshot('briefing_future.json', '2026-10-01T12:01:00Z');
  snapshot('briefing_bad.json', 'bad');
  writeFileSync(join(dir, 'briefing_wrapper_only.json'), JSON.stringify({ crucix: { timestamp: '2026-10-01T11:59:00Z' }, sources: { OpenSky: { hotspots: [{ totalAircraft: 999 }] } } }));
  snapshot('briefing_error.json', '2026-10-01T11:59:00Z', 'denied');
  assert.equal(loadOpenSkyFallback('2026-10-01T12:00:00Z', dir).file, 'briefing_a.json');
  assert.equal(loadOpenSkyFallback('bad', dir), null);
  assert.equal(loadOpenSkyFallback('2026-10-02T12:00:00Z', dir), null);
});

test('partial OpenSky failures preserve successful current hotspots', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-partial-air-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'briefing_old.json'), JSON.stringify({ sources: { OpenSky: { timestamp: '2026-10-01T11:59:00Z', hotspots: [{ region: 'Middle East', totalAircraft: 500 }] } } }));
  const data = await synthesize({ crucix: { timestamp: '2026-10-01T12:00:00Z' }, sources: { OpenSky: { error: 'Partial failure', hotspots: [{ region: 'Middle East', totalAircraft: 20 }, { region: 'Taiwan', totalAircraft: 0, error: 'HTTP 429' }] } } }, { news: [], runsDir: dir });
  assert.equal(data.air[0].total, 20);
  assert.equal(data.airMeta.fallback, false);
});

test('persisted source health prevents repeated degradation and metals remain comparable', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-memory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const memory = new MemoryManager(dir);
  const base = { meta: { timestamp: '2026-10-01T12:00:00Z' }, health: [1, 2, 3].map(n => ({ n: String(n), err: true })), metals: { gold: 100, silver: 20 } };
  memory.addRun(base);
  const reloaded = new MemoryManager(dir);
  const delta = reloaded.addRun({ ...base, meta: { timestamp: '2026-10-01T12:15:00Z' }, metals: { gold: 110, silver: 20 } });
  assert.ok(!delta.signals.new.some(s => s.key === 'source_degradation'));
  assert.equal(reloaded.hot.runs[1].data.metals.gold, 100);
  assert.equal(delta.signals.escalated.find(s => s.key === 'gold').from, 100);
});

test('Yahoo HTML/error responses retain instrument identity and never fabricate prices', async t => {
  const original = globalThis.fetch;
  t.after(() => globalThis.fetch = original);
  globalThis.fetch = async () => new Response('<html>upstream error</html>');
  const data = await fetchQuote('CL=F');
  assert.equal(data.symbol, 'CL=F'); assert.equal(data.name, 'WTI Crude');
  assert.ok(data.error); assert.equal(data.price, undefined);
});

test('EPA and Treasury upstream failures never report a healthy empty source', async t => {
  const original = globalThis.fetch;
  t.after(() => globalThis.fetch = original);
  globalThis.fetch = async () => new Response('{}', { status: 503, headers: { 'Retry-After': '120' } });
  const radiation = await runSource('EPA', epa);
  assert.equal(radiation.status, 'error');
  assert.ok(!radiation.data.signals.some(s => /within normal/i.test(s)));
  assert.equal((await runSource('Treasury', treasury)).status, 'error');
});

test('corrupt hot memory falls back to its valid backup', t => {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-recovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = new MemoryManager(dir);
  first.addRun({ meta: { timestamp: '2026-10-01T12:00:00Z' } });
  first.addRun({ meta: { timestamp: '2026-10-01T12:15:00Z' } });
  writeFileSync(first.hotPath, '{"runs":[],"alertedSignals":null}');
  const recovered = new MemoryManager(dir);
  assert.equal(recovered.getLastRun().meta.timestamp, '2026-10-01T12:00:00Z');
  assert.deepEqual(recovered.getAlertedSignals(), {});
});
