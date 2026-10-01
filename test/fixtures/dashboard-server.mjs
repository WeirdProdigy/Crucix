// Deterministic local UI fixture; never loads operator .env or runtime runs.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { inlineJson } from '../../lib/html.mjs';
import { buildEvents } from '../../lib/intelligence/events.mjs';
import { getLocaleForLanguage } from '../../lib/i18n.mjs';
const template = readFileSync(new URL('../../dashboard/public/jarvis.html', import.meta.url), 'utf8');
const embedded = template.match(/^(?:let|const) D = (.*);\s*$/m);
const data = JSON.parse(embedded[1]);
data.meta = { ...data.meta, timestamp: new Date().toISOString(), sourcesQueried: 31, sourcesOk: 28, sourcesFailed: 1, sourcesDisabled: 1, sourcesStale: 1 };
data.health = [{ n: 'Fixture live', err: false, timestamp: data.meta.timestamp },
  { n: 'Fixture error', err: true, message: 'HTTP 503', timestamp: data.meta.timestamp },
  { n: 'Fixture stale', stale: true, timestamp: new Date(Date.now() - 3600000).toISOString() },
  { n: 'Fixture disabled', disabled: true }];
data.newsFeed.unshift({ headline: '<img src=x onerror="window.__injected=1"', source: 'Fixture', timestamp: data.meta.timestamp, type: 'rss' });
data.newsFeed.unshift({ headline: 'Fixture complete headline <img src=x onerror="window.__injected=3">', source: 'Fixture complete', timestamp: data.meta.timestamp, type: 'rss' });
data.newsFeed.unshift({ headline: 'Fixture waiting for SSE', source: 'Fixture SSE', timestamp: data.meta.timestamp, type: 'rss' });
data.news.unshift({ title: 'Fixture popup <img src=x onerror="window.__injected=4">', source: 'Fixture popup', lat: 40, lon: -30, region: 'Fixture' });
data.earthquakes = [{ id: 'fixture-quake', magnitude: 6.2, place: 'Test earthquake', time: data.meta.timestamp, lat: 36, lon: 140, depth: 25, tsunamiFlag: 0, url: 'https://earthquake.usgs.gov/' }];
data.ideas = [{ type: 'HEDGE', title: 'Fixture idea', rationale: 'Safe text <img src=x onerror="window.__injected=2">', ticker: 'TEST', confidence: 'HIGH', horizon: 'Days', risk: 'Fixture' }];
data.ideasSource = 'rules';
data.events = buildEvents(data);
let online = true;
const streams = new Set();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/control') {
    online = url.searchParams.get('online') !== 'false';
    if (!online) for (const client of streams) client.end();
    res.end('ok'); return;
  }
  if (url.pathname === '/api/data') {
    if (!online) { res.writeHead(503); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return;
  }
  if (url.pathname === '/api/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', refreshIntervalMinutes: 15, lastSweep: data.meta.timestamp, nextSweep: new Date(Date.now() + 900000).toISOString() })); return;
  }
  if (url.pathname === '/events') {
    if (!online) { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    streams.add(res); res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    const timer = setTimeout(() => {
      data.meta.timestamp = new Date().toISOString();
      data.newsFeed[0].headline = 'Fixture SSE updated';
      data.events = buildEvents(data);
      res.write(`data: ${JSON.stringify({ type: 'update', data })}\n\n`);
    }, 3000);
    req.on('close', () => { clearTimeout(timer); streams.delete(res); }); return;
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (url.pathname.startsWith('/api/events/')) {
    const item = data.events.find(event => event.id === url.pathname.split('/').at(-1));
    res.writeHead(item ? 200 : 404, {'Content-Type':'application/json'});res.end(JSON.stringify(item || {error:'Not found'}));return;
  }
  if (url.pathname !== '/') {
    const root = resolve('dashboard/public');const file = resolve(root, '.' + url.pathname);
    if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) {
      const type = {'.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ttf':'font/ttf'}[extname(file)] || 'application/octet-stream';
      res.writeHead(200, {'Content-Type':type});res.end(readFileSync(file));return;
    }
    res.writeHead(404);res.end();return;
  }
  const html = readFileSync(new URL('../../dashboard/public/jarvis.html', import.meta.url), 'utf8')
    .replace(/^(let|const) D = .*;\s*$/m, () => `let D = ${inlineJson(data)};`)
    .replace('</head>', `<script>window.__CRUCIX_LOCALE__ ||= ${inlineJson(getLocaleForLanguage('en'))};</script></head>`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
server.listen(Number(process.env.QA_PORT || 3199), '127.0.0.1', () => console.log(`QA fixture http://127.0.0.1:${server.address().port}`));
