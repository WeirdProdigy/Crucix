// Deterministic local UI fixture; never loads operator .env or runtime runs.
import http from 'node:http';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, extname, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { inlineJson } from '../../lib/html.mjs';
import { buildEvents, clusterEvents, stampLiveEventIds } from '../../lib/intelligence/events.mjs';
import { HistoryStore } from '../../lib/intelligence/history.mjs';
import { installIntelligenceRoutes } from '../../lib/intelligence/routes.mjs';
import { getLocaleForLanguage } from '../../lib/i18n.mjs';
import { renderOfflineShell } from '../../lib/offline-shell.mjs';
import { POLICIES } from '../../apis/utils/freshness.mjs';
import { normalizeLiveSources } from '../../lib/intelligence/live-sources.mjs';
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
const reports = [1,2].map(n=>({title:'Fixture Hungary flood response '+n,headline:'Fixture Hungary flood response '+n,source:'Fixture Report '+n,date:data.meta.timestamp,publishedAt:data.meta.timestamp,url:`https://fixture${n}.example/report`,lat:47.5,lon:19.1,locationMethod:'headline-keyword',locationPrecision:'approximate'}));
data.news.push(...reports);data.newsFeed.push(...reports);
data.events = buildEvents(data);
data.eventClusters = clusterEvents(data.events);
const historyDir = mkdtempSync(join(tmpdir(),'crucix-fixture-'));
const history = new HistoryStore(historyDir);history.add(data.events);
const api=express();installIntelligenceRoutes(api,{getSnapshot:()=>data,history,language:'en'});
process.on('exit',()=>rmSync(historyDir,{recursive:true,force:true}));
let online = true;
let fixtureLanguage = 'en';
const streams = new Set();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/control') {
    if(url.searchParams.has('liveSources')){
      const enabled=url.searchParams.get('liveSources')==='true';
      const now=Date.now();
      data.liveSources=enabled?normalizeLiveSources(Object.fromEntries(Object.keys(POLICIES).map((source,index)=>[source,{
        source,status:'ok',observedAt:new Date(now-600000).toISOString(),timestamp:new Date(now).toISOString(),
        summary:source==='NOAA-SWPC'?'Current NOAA R0/S0/G0: no active space-weather alert.':'Fixture current '+source,
        attribution:source+' public source attribution',
        observations:source==='NOAA-SWPC'||source==='Meteoalarm'?[]:[{providerId:'live-'+index,source,kind:source==='ECB'?'economic':source==='MET-Norway'?'forecast':source==='FIRST-EPSS'?'cyber':source==='RIPEstat'||source==='OONI'?'network':'disaster',
          title:'Fixture current '+source+' <img onerror="window.__liveXss=1">',summary:'Public data: safe text only',url:'https://example.org/public/'+index,observedAt:new Date(now-600000).toISOString(),
          ...(source==='MET-Norway'?{forecastAt:new Date(now+3600000).toISOString(),validUntil:new Date(now+7200000).toISOString()}:{}),
          ...(['MET-Norway','GDACS','NASA-EONET'].includes(source)?{lat:47.5+index,lon:19+index,locationMethod:'provider',locationPrecision:'approximate'}:{}),
          ...(source==='GDACS'?{severity:'Orange'}:{}),
        },
        // A second GDACS record at another level, so the inspector's severity chips have something to filter.
        ...(source==='GDACS'?[{providerId:'live-'+index+'-b',source,kind:'disaster',title:'Fixture GDACS green alert',summary:'Public data: second record',severity:'Green',observedAt:new Date(now-1200000).toISOString()}]:[])]
      }]))):[];
      if(enabled&&url.searchParams.get('expired')==='true')data.liveSources[0].observedAt='2025-01-01T00:00:00Z';
      // Rows carry eventId as in 2.9.0 snapshots; legacyIds=true keeps the 2.8.0 shape without it.
      if(url.searchParams.get('legacyIds')!=='true')data.liveSources=stampLiveEventIds(data.liveSources);
      data.events=buildEvents(data);data.eventClusters=clusterEvents(data.events);history.add(data.events);
    }
    if(['en','hu','fr'].includes(url.searchParams.get('language')))fixtureLanguage=url.searchParams.get('language');
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
      data.eventClusters = clusterEvents(data.events);history.add(data.events);
      res.write(`data: ${JSON.stringify({ type: 'update', data })}\n\n`);
    }, 3000);
    req.on('close', () => { clearTimeout(timer); streams.delete(res); }); return;
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (url.pathname === '/offline-shell') {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(renderOfflineShell(readFileSync(new URL('../../dashboard/public/jarvis.html',import.meta.url),'utf8'),getLocaleForLanguage(fixtureLanguage)));return;
  }
  if (['/api/history','/api/export'].includes(url.pathname)||url.pathname.startsWith('/api/events/')) { api(req,res);return; }
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
    .replace('</head>', `<script>window.__CRUCIX_LOCALE__ ||= ${inlineJson(getLocaleForLanguage(fixtureLanguage))};</script></head>`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
server.listen(Number(process.env.QA_PORT || 3199), '127.0.0.1', () => console.log(`QA fixture http://127.0.0.1:${server.address().port}`));
