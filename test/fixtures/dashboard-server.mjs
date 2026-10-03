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
import { normalizeLiveSources, FACT_FIELDS } from '../../lib/intelligence/live-sources.mjs';
import { AlertEngine } from '../../lib/alerts/engine.mjs';
import { installAlertRoutes } from '../../lib/alerts/routes.mjs';
import { writeJsonAtomic } from '../../lib/atomic-json.mjs';
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
// Alerts: the real engine and API over the fixture's tmp dir; /control?alerts=seed|newcritical|clear writes a fixed set.
const alertEngine=new AlertEngine(historyDir,{logger:{warn(){},error(){},log(){}}});alertEngine.load();data.alerts=alertEngine.summary();
const publishAlerts=(summary,newIds)=>{data.alerts=summary;for(const client of streams)client.write(`data: ${JSON.stringify({type:'alerts',data:summary,newIds})}\n\n`);};
installAlertRoutes(api,{engine:alertEngine,getSnapshot:()=>data,onChange:publishAlerts});
let fixtureAlerts=0;
function fixtureAlert(ruleId,ruleName,kind,severity,state,title,extra={}){
  const n=++fixtureAlerts,at=Date.now()-60000*(10-Math.min(n,9));
  return {id:'alert-'+String(n).padStart(32,'0'),ruleId,ruleName,dedupKey:`${ruleId}|fixture-${n}`,kind,severity,state,title,summary:'Fixture alert summary '+n,
    entity:{type:kind,id:'fixture-'+n},evidence:[],firstSeenAt:at,lastSeenAt:at,count:1,notify:true,silent:false,log:[{at,action:'created'}],...extra};
}
function seedAlerts(mode){
  let alerts=[];
  if(mode==='seed'){
    fixtureAlerts=0;
    const evidence=data.events.slice(0,2).map(event=>({type:'event',id:event.id,title:event.title,source:event.source?.name||'',level:'high'}));
    alerts=[fixtureAlert('events-critical','Critical events','event','critical','firing','Fixture critical alert'),
      fixtureAlert('events-high','High-severity events','event','high','firing','Fixture high alert',{evidence}),
      fixtureAlert('hungary-region','Hungary region','event','watch','firing','Fixture watch alert <img src=x onerror="window.__alertXss=1">'),
      fixtureAlert('vix-spike','VIX spike','threshold','high','acked','Fixture acknowledged alert',{ack:{at:Date.now()-30000}})];
  } else if(mode==='newcritical') {
    alerts=[...alertEngine.list({state:'all',limit:1000}),fixtureAlert('events-critical','Critical events','event','critical','firing','Fixture new critical alert',{firstSeenAt:Date.now(),lastSeenAt:Date.now()})];
  } else fixtureAlerts=0;
  writeJsonAtomic(join(historyDir,'alerts','alerts.json'),{version:1,alerts,engine:{initialized:true,lastEvaluatedAt:Date.now()}});
  alertEngine.load();
  publishAlerts(alertEngine.summary(),mode==='newcritical'?[alerts.at(-1).id]:[]);
}
// /control?liveSources=true: one current sample per POLICIES key, so a new source appears without a fixture edit. SAMPLE adds what a source
// needs beyond the default (a 'disaster' row without coordinates): its kind, a place for located kinds (`at`, or `indexed`: 47.5+i, 19+i),
// row extras, metrics; every FACT_FIELDS key gets a value. Located rows show the map marker of each kind.
const SAMPLE={
  Meteoalarm:{rows:false},'NOAA-SWPC':{rows:false,summary:'Current NOAA R0/S0/G0: no active space-weather alert.'},
  GDACS:{indexed:true,row:{severity:'Orange'}},'NASA-EONET':{indexed:true},ECB:{kind:'economic'},RIPEstat:{kind:'network'},'FIRST-EPSS':{kind:'cyber'},OONI:{kind:'network'},
  'MET-Norway':{kind:'forecast',indexed:true,row:now=>({forecastAt:new Date(now+3600000).toISOString(),validUntil:new Date(now+7200000).toISOString()})},
  'IMF-PortWatch':{kind:'maritime',at:[26.2969,56.8598],metrics:{hormuz_transits:3.1,suez_transits:40}},
  EMSC:{kind:'earthquake',at:[51.8043,159.605],precision:'exact',row:{severity:'moderate'}},
  'Copernicus-EMS':{at:[37.7895,-7.2135],row:{severity:'moderate'}},
  'Aviation-SIGMET':{kind:'weather',at:[39.2,45.417],method:'polygon-centroid',row:{severity:'high'}},
  'ADSB-Military':{kind:'aviation',at:[25,48],method:'theater-centre',metrics:{mil_aircraft_total:71}},
  'OpenSanctions-Index':{kind:'sanctions'},'Federal-Register':{kind:'sanctions'},
  'Energy-Charts-HU':{kind:'energy',metrics:{hu_power_price:172.6,grid_frequency_hz:50.0307}},'ENTSOG-HU':{kind:'energy'},'Prediction-Markets':{kind:'market'},
};
function liveSamples(now){
  const quake=data.earthquakes[0];
  return Object.fromEntries(Object.keys(POLICIES).map((source,index)=>{
    const spec=SAMPLE[source]||{},at=spec.at||(spec.indexed?[47.5+index,19+index]:null),extra=typeof spec.row==='function'?spec.row(now):spec.row;
    const row={providerId:'live-'+index,source,kind:spec.kind||'disaster',title:'Fixture current '+source+' <img onerror="window.__liveXss=1">',summary:'Public data: safe text only',
      url:'https://example.org/public/'+index,observedAt:new Date(now-600000).toISOString(),...Object.fromEntries((FACT_FIELDS[source]||[]).map((key,i)=>[key,i+1])),
      ...(at?{lat:at[0],lon:at[1],locationMethod:spec.method||'provider',locationPrecision:spec.precision||'approximate'}:{}),...extra};
    // A second GDACS record at another level, so the inspector's severity chips have something to filter. A second EMSC record is the USGS
    // fixture quake as EMSC reports it: the maps draw it once (the USGS marker), the event lists keep both.
    const more=source==='GDACS'?[{providerId:'live-'+index+'-b',source,kind:'disaster',title:'Fixture GDACS green alert',summary:'Public data: second record',severity:'Green',observedAt:new Date(now-1200000).toISOString()}]
      :source==='EMSC'?[{providerId:'live-'+index+'-usgs',source,kind:'earthquake',title:'Fixture EMSC copy of the USGS quake',summary:'Public data: the same quake in both catalogues',url:'https://example.org/public/emsc-copy',
        observedAt:new Date(Date.parse(quake.time)+50).toISOString(),lat:quake.lat+0.02,lon:quake.lon+0.03,locationMethod:'provider',locationPrecision:'exact',severity:'high'}]:[];
    return [source,{source,status:'ok',observedAt:new Date(now-600000).toISOString(),timestamp:new Date(now).toISOString(),summary:spec.summary||'Fixture current '+source,
      attribution:source+' public source attribution',...(spec.metrics?{metrics:spec.metrics}:{}),observations:spec.rows===false?[]:[row,...more]}];
  }));
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/control') {
    if(url.searchParams.has('liveSources')){
      const enabled=url.searchParams.get('liveSources')==='true';
      data.liveSources=enabled?normalizeLiveSources(liveSamples(Date.now())):[];
      if(enabled&&url.searchParams.get('expired')==='true')data.liveSources[0].observedAt='2025-01-01T00:00:00Z';
      // Rows carry eventId as in 2.9.0 snapshots; legacyIds=true keeps the 2.8.0 shape without it.
      if(url.searchParams.get('legacyIds')!=='true')data.liveSources=stampLiveEventIds(data.liveSources);
      data.events=buildEvents(data);data.eventClusters=clusterEvents(data.events);history.add(data.events);
    }
    if(['seed','newcritical','clear'].includes(url.searchParams.get('alerts')))seedAlerts(url.searchParams.get('alerts'));
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
  if (['/api/history','/api/export','/api/alerts'].includes(url.pathname)||url.pathname.startsWith('/api/events/')||url.pathname.startsWith('/api/alerts/')) { api(req,res);return; }
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
