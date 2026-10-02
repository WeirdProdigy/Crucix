import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLiveSources, freshLiveSnapshot, FACT_FIELDS } from '../lib/intelligence/live-sources.mjs';
import { buildEvents, liveEventId, stampLiveEventIds } from '../lib/intelligence/events.mjs';
import { synthesize } from '../dashboard/inject.mjs';
import { normalizeHistoryEvent, validateHistoryFilters } from '../lib/intelligence/history.mjs';
import { POLICIES } from '../apis/utils/freshness.mjs';
const now = Date.parse('2026-10-01T21:00:00Z');
const source = {source:'MET-Norway',status:'ok',observedAt:'2026-10-01T19:00:00Z',timestamp:'2026-10-01T20:00:00Z',
  privateConfig:{secret:'hidden'}, metrics:{temperature:15}, observations:[{providerId:'forecast-1',kind:'forecast',title:'Budapest forecast',summary:'15 C forecast, not an observed temperature',observedAt:'2026-10-01T19:00:00Z',forecastAt:'2026-10-01T22:00:00Z',validUntil:'2026-10-01T23:00:00Z',lat:47.5,lon:19,locationMethod:'forecast-grid',url:'https://api.met.no/',raw:{secret:'hidden'}}]};
test('synthesis envelope is bounded, sanitized and reevaluates cached age instead of collection time',()=>{
  const [fresh] = normalizeLiveSources({'MET-Norway':source},now);
  assert.equal(fresh.status,'ok'); assert.equal(fresh.observations.length,1);
  assert.equal(fresh.privateConfig,undefined); assert.equal(fresh.observations[0].raw,undefined);
  assert.equal(fresh.timestamp,'2026-10-01T20:00:00.000Z');
  const [old] = normalizeLiveSources([fresh],now+86400000);
  assert.equal(old.status,'stale'); assert.deepEqual(old.observations,[]); assert.deepEqual(old.metrics,{});
  const [unsafe] = normalizeLiveSources({'MET-Norway':{...source,observations:[{...source.observations[0],url:'https://example.org/?api_key=secret'}]}},now);
  assert.equal(unsafe.observations[0].url,null);
});
test('new source kinds and forecast validity survive details, history and filters',()=>{
  const snapshot={meta:{timestamp:new Date(now).toISOString()},liveSources:normalizeLiveSources({'MET-Norway':source},now)};
  const events=buildEvents(snapshot,{now});
  assert.equal(events.length,1); assert.equal(events[0].kind,'forecast');
  assert.equal(events[0].forecastAt,'2026-10-01T22:00:00.000Z');
  assert.equal(normalizeHistoryEvent(events[0]).validUntil,'2026-10-01T23:00:00.000Z');
  assert.equal(validateHistoryFilters({kind:'forecast'}).kind,'forecast');
  assert.equal(buildEvents(snapshot,{now:now+86400000}).length,0);
});
test('browser policy matches backend and expired PWA data is suppressed without deleting historical data',()=>{
  const load=(...files)=>{const window={},context=vm.createContext({window,Date,URL,Object,Array,Number,JSON,Set});for(const file of files)vm.runInContext(readFileSync(new URL('../dashboard/public/'+file,import.meta.url),'utf8'),context);return window;};
  const window=load('record-core.js','live-sources.js'),api=window.CrucixLiveSources,t=(_,fallback)=>fallback;
  assert.equal(JSON.stringify(api.policies),JSON.stringify(POLICIES));
  const current=normalizeLiveSources({'MET-Norway':source},now);
  assert.equal(api.observations(current,now).length,1);
  assert.equal(api.observations(current,now+86400000).length,0);
  const html=api.renderPanel([{...current[0],observations:[{...current[0].observations[0],title:'<img onerror="evil()">'}]}],t,[],now);
  assert(!html.includes('<img')); assert(html.includes('&lt;img'));
  assert.doesNotThrow(()=>api.renderPanel([null,{...current[0],observations:[null]}],t,[],now));
  const card=api.renderPanel(current,t,[],now);
  assert(card.includes('data-open-records="MET-Norway"')); assert(card.includes('aria-controls="record-inspector"')); assert(!card.includes('<details')); assert(!card.includes('live-detail'));
  assert(!card.includes('data-selected')); window.CrucixRecords.store.set({source:'MET-Norway'});
  assert(api.renderPanel(current,t,[],now).includes('data-selected="true"'));
  window.CrucixRecords.store.set({source:null});
  assert(!api.renderPanel([{...current[0],status:'error'}],t,[],now).includes('data-open-records'));
  assert(!api.renderPanel([{...current[0],observedAt:'2026-09-01T00:00:00Z'}],t,[],now).includes('data-open-records'));
  assert.equal(api.setExpanded,undefined);
  assert.equal(api.state({source:'MET-Norway',status:'ok',observedAt:'2026-02-30T00:00:00Z'},Date.parse('2026-03-02T01:00:00Z')),'stale');
  assert.equal(api.observations([{...current[0],observations:[{...source.observations[0],validUntil:null}]}],now).length,0);
  const alert=(i,severity,title)=>({providerId:'g'+i,kind:'disaster',title:title||'Alert '+i,severity,observedAt:'2026-10-01T20:30:00Z'});
  const big={source:'GDACS',status:'ok',observedAt:'2026-10-01T20:30:00Z',observations:Array.from({length:100},(_,i)=>alert(i,'Green'))};
  const crowded=api.renderPanel([big],t,[],now);
  assert.equal(crowded.match(/<li>/g).length,3); assert(crowded.includes('100 current records'));
  const mixed={...big,observations:[alert(1,'Green','Calm'),alert(2,'Red','Worst <b>one</b>'),alert(3,'Orange','Second'),alert(4,'Red','Also red'),alert(5,undefined,'Unrated')]};
  const sorted=api.renderPanel([mixed],t,[],now);
  assert.deepEqual([...sorted.matchAll(/<li>(.*?)<\/li>/g)].map(m=>m[1]),['Also red','Worst &lt;b&gt;one&lt;/b&gt;','Second']);
  assert(sorted.includes('<span class="sev sev-critical" title="Critical"><i aria-hidden="true">◆</i>2<span class="ri-sr"> Critical</span></span>')); assert(sorted.includes('sev sev-high')); assert(sorted.includes('sev sev-info')); assert(!sorted.includes('sev-watch')); assert(!sorted.includes('sev-unknown'));
  const bare=load('live-sources.js').CrucixLiveSources.renderPanel([mixed],t,[],now);
  assert(bare.includes('data-open-records="GDACS"')); assert(!bare.includes('class="sev')); assert(!bare.includes('<li>')); assert(bare.includes('5 current records'));
});
test('expired forecast metrics and summaries cannot outlive the forecast target',()=>{
  const past={...source,summary:'15C forecast',observations:[{...source.observations[0],forecastAt:'2026-10-01T19:00:00Z',validUntil:'2026-10-01T20:00:00Z'}]};
  const [out]=normalizeLiveSources({'MET-Norway':past},now);
  assert.equal(out.status,'stale');assert.equal(out.summary,'');assert.deepEqual(out.metrics,{});
  assert.equal(normalizeLiveSources({'MET-Norway':{...source,status:'stale'}},now)[0].status,'stale');
  const partial={...source,summary:'STALE999 plus fresh forecast',metrics:{old:999},observations:[{...past.observations[0],title:''},...source.observations]};
  const [clean]=normalizeLiveSources({'MET-Norway':partial},now);assert.equal(clean.summary,'');assert.deepEqual(clean.metrics,{});
  const event={id:'event-123',title:'orphan',source:{name:'MET-Norway'}};
  assert.equal(freshLiveSnapshot({events:[event],liveSources:[]},now).events.length,0);
});
test('public metrics have a total item budget and provider licence links survive',()=>{
  const nested=Object.fromEntries(Array.from({length:20},(_,i)=>['branch'+i,Object.fromEntries(Array.from({length:20},(_,j)=>['child'+j,{value:42}]))]));
  const [out]=normalizeLiveSources({'MET-Norway':{...source,metrics:nested,license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'}},now);
  let entries=0;const visit=value=>{if(value&&typeof value==='object')for(const child of Object.values(value)){entries++;visit(child);}};visit(out.metrics);
  assert(entries<=50);assert.equal(out.license,'CC BY 4.0');assert.equal(out.licenseUrl,'https://creativecommons.org/licenses/by/4.0/');
});
test('provider severity words reach the event scale and urgent Telegram keeps its fallback',()=>{
  const gdacs={source:'GDACS',status:'ok',observedAt:'2026-10-01T20:30:00Z',timestamp:'2026-10-01T20:30:00Z',observations:[{providerId:'gdacs-eq-1',kind:'disaster',title:'Orange earthquake alert',severity:'Orange',observedAt:'2026-10-01T20:30:00Z',startsAt:'2026-10-01T20:00:00Z',lat:36.2,lon:28.1}]};
  const events=buildEvents({meta:{timestamp:new Date(now).toISOString()},liveSources:normalizeLiveSources({GDACS:gdacs},now)},{now});
  assert.equal(events.length,1); assert.equal(events[0].severity,'high');
  const urgent=buildEvents({meta:{timestamp:new Date(now).toISOString()},tg:{urgent:[{channel:'channel',text:'Local report',severity:'banana',date:'2026-10-01T20:30:00Z',url:'https://t.me/channel/1'}]}},{now});
  assert.equal(urgent.length,1); assert.equal(urgent[0].severity,'high');
});
const epss = {source:'FIRST-EPSS',status:'ok',observedAt:'2026-10-01T19:00:00Z',timestamp:'2026-10-01T20:00:00Z',observations:[{providerId:'CVE-2026-0001',kind:'cyber',title:'CVE-2026-0001',observedAt:'2026-10-01T19:00:00Z',epss:.12345,percentile:.9,secret:'x',nested:{a:1}}]};
test('facts come only from the per-source whitelist',()=>{
  const [out]=normalizeLiveSources({'FIRST-EPSS':epss},now);
  assert.deepEqual(out.observations[0].facts,[{label:'epss',value:.12345},{label:'percentile',value:.9}]);
  const dump=JSON.stringify(out); assert(!dump.includes('secret')); assert(!dump.includes('nested'));
  assert.deepEqual(Object.keys(FACT_FIELDS).sort(),Object.keys(POLICIES).sort());
  const [swpc]=normalizeLiveSources({'NOAA-SWPC':{...epss,source:'NOAA-SWPC',observedAt:'2026-10-01T20:30:00Z',observations:[{...epss.observations[0],observedAt:'2026-10-01T20:30:00Z',epss:1}]}},now);
  assert.equal(swpc.observations[0].facts,undefined);
});
test('facts are bounded',()=>{
  const pairs=Array.from({length:20},(_,i)=>({label:'k'+i,value:i}));
  const facts=[...pairs.slice(0,2),{label:'L'.repeat(41),value:'ok'},{label:'long',value:'v'.repeat(200)},{label:'object',value:{a:1}},{label:'missing',value:null},...pairs.slice(2)];
  const [out]=normalizeLiveSources({'FIRST-EPSS':{...epss,observations:[{...epss.observations[0],facts}]}},now);
  const kept=out.observations[0].facts;
  assert(kept.length>0&&kept.length<=8); assert(kept.every(f=>f.label.length<=40&&(typeof f.value!=='string'||f.value.length<=120)));
  assert(!kept.some(f=>f.label==='object'||f.label==='missing'));
  const [small]=normalizeLiveSources({'FIRST-EPSS':{...epss,observations:[{...epss.observations[0],facts:[facts[2],facts[3],facts[4],facts[5]]}]}},now);
  assert.deepEqual(small.observations[0].facts,[{label:'L'.repeat(40),value:'ok'},{label:'long',value:'v'.repeat(120)}]);
});
test('facts survive re-normalization',()=>{
  const first=normalizeLiveSources({'FIRST-EPSS':epss},now);
  const again=normalizeLiveSources([first[0]],now);
  assert.deepEqual(again[0].observations[0].facts,first[0].observations[0].facts); assert.equal(again[0].observations[0].facts.length,2);
});
test('MET-Norway units are appended',()=>{
  const row={...source.observations[0],temperature:15,windSpeed:3.2,precipitation:.4,precipitationHours:1,symbol:'cloudy',units:{temperature:'celsius',windSpeed:'m/s',precipitation:'u'.repeat(21)}};
  const [out]=normalizeLiveSources({'MET-Norway':{...source,observations:[row]}},now);
  const facts=Object.fromEntries(out.observations[0].facts.map(f=>[f.label,f.value]));
  assert.equal(facts.temperature,'15 celsius'); assert.equal(facts.windSpeed,'3.2 m/s'); assert.equal(facts.precipitation,.4);
  assert.strictEqual(facts.precipitationHours,1); assert.equal(facts.symbol,'cloudy'); assert.equal(out.observations[0].units,undefined);
});
const gdacs = {source:'GDACS',status:'ok',observedAt:'2026-10-01T20:30:00Z',timestamp:'2026-10-01T20:30:00Z',observations:[
  {kind:'disaster',title:'Flood alert with a report link',url:'https://www.gdacs.org/report.aspx?eventid=1001',observedAt:'2026-10-01T20:30:00Z',lat:36.2,lon:28.1},
  {kind:'disaster',title:'Volcano alert without id or link',observedAt:'2026-10-01T20:20:00Z',lat:37.7,lon:15}]};
test('stamped eventId equals the id buildEvents assigns',()=>{
  const before=normalizeLiveSources({'MET-Norway':source,GDACS:gdacs},now);
  const before1=JSON.stringify(before);
  const stamped=stampLiveEventIds(before);
  assert.equal(JSON.stringify(before),before1);
  const rows=stamped.flatMap(row=>row.observations);
  assert.equal(rows.length,3); assert(rows.every(row=>/^event-[0-9a-f]{32}$/.test(row.eventId)));
  assert.equal(new Set(rows.map(row=>row.eventId)).size,3);
  assert(before.flatMap(row=>row.observations).every(row=>!Object.hasOwn(row,'eventId')));
  const events=buildEvents({meta:{timestamp:new Date(now).toISOString()},liveSources:stamped},{now});
  assert.equal(events.length,3);
  for (const row of rows) assert(events.some(event=>event.id===row.eventId),row.title);
  assert.deepEqual(stampLiveEventIds(stamped),stamped);
  const withFacts=stampLiveEventIds(normalizeLiveSources({'FIRST-EPSS':epss},now))[0].observations[0];
  assert.equal(withFacts.facts.length,2); assert.equal(liveEventId(withFacts),withFacts.eventId);
});
test('stampLiveEventIds tolerates input that is not a source list',()=>{
  for (const input of [null,undefined,'x',{}]) assert.strictEqual(stampLiveEventIds(input),input);
  const odd=[null,{source:'GDACS'},{source:'GDACS',observations:[null,'x',{kind:'disaster'}]}];
  const out=stampLiveEventIds(odd);
  assert.strictEqual(out[0],null); assert.deepEqual(out[1],{source:'GDACS'}); assert.deepEqual(out[2].observations,[null,'x',{kind:'disaster'}]);
});
test('eventId survives freshLiveSnapshot and forged values are dropped',()=>{
  const stamped=stampLiveEventIds(normalizeLiveSources({'MET-Norway':source},now));
  const kept=freshLiveSnapshot({liveSources:stamped},now).liveSources[0].observations[0];
  assert.equal(kept.eventId,stamped[0].observations[0].eventId); assert.match(kept.eventId,/^event-[0-9a-f]{32}$/);
  for (const forged of ['x','event-'+'z'.repeat(32),'event-'+'a'.repeat(31),'event-'+'a'.repeat(33),['event-'+'a'.repeat(32)],{}]) {
    const [out]=normalizeLiveSources({'MET-Norway':{...source,observations:[{...source.observations[0],eventId:forged}]}},now);
    assert.equal(out.observations.length,1); assert(!Object.hasOwn(out.observations[0],'eventId'),String(forged));
  }
});
test('rows of unsupported kind get no eventId',()=>{
  const [out]=normalizeLiveSources({GDACS:{...gdacs,observations:[{...gdacs.observations[0],kind:'banana'},gdacs.observations[1]]}},now);
  assert.equal(out.observations[0].kind,'signal');
  const [stamped]=stampLiveEventIds([out]);
  assert(!Object.hasOwn(stamped.observations[0],'eventId')); assert.match(stamped.observations[1].eventId,/^event-[0-9a-f]{32}$/);
  assert.equal(liveEventId(out.observations[0]),null); assert.equal(liveEventId({...out.observations[1],title:''}),null);
  assert.equal(liveEventId(null),null); assert.equal(liveEventId({kind:'disaster',source:'GDACS'}),null);
  assert(!Object.hasOwn(stampLiveEventIds([{...out,observations:[{...out.observations[0],eventId:'event-'+'a'.repeat(32)}]}])[0].observations[0],'eventId'));
});
test('synthesize stamps the snapshot it builds events from',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'crucix-live-ids-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const data=await synthesize({crucix:{timestamp:new Date(now).toISOString()},sources:{'MET-Norway':source,GDACS:gdacs}},{news:[],runsDir:dir,now});
  const rows=data.liveSources.flatMap(row=>row.observations);
  assert.equal(rows.length,3);
  for (const row of rows) assert(data.events.some(event=>event.id===row.eventId),row.title);
});
