import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeLiveSources, freshLiveSnapshot } from '../lib/intelligence/live-sources.mjs';
import { buildEvents } from '../lib/intelligence/events.mjs';
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
  const window={}; vm.runInNewContext(readFileSync(new URL('../dashboard/public/live-sources.js',import.meta.url),'utf8'),{window,Date,URL,Object,Array,Number,JSON,Set});
  const api=window.CrucixLiveSources;
  assert.equal(JSON.stringify(api.policies),JSON.stringify(POLICIES));
  const current=normalizeLiveSources({'MET-Norway':source},now);
  assert.equal(api.observations(current,now).length,1);
  assert.equal(api.observations(current,now+86400000).length,0);
  const html=api.renderPanel([{...current[0],observations:[{...current[0].observations[0],title:'<img onerror="evil()">'}]}],(_,fallback)=>fallback,[],now);
  assert(!html.includes('<img')); assert(html.includes('&lt;img'));
  assert.doesNotThrow(()=>api.renderPanel([null,{...current[0],observations:[null]}],(_,fallback)=>fallback,[],now));
  api.setExpanded('MET-Norway',true);
  assert.match(api.renderPanel(current,(_,fallback)=>fallback,[],now),/<details[^>]* open>/);
  api.setExpanded('MET-Norway',false);
  assert.doesNotMatch(api.renderPanel(current,(_,fallback)=>fallback,[],now),/<details[^>]* open>/);
  assert.equal(api.state({source:'MET-Norway',status:'ok',observedAt:'2026-02-30T00:00:00Z'},Date.parse('2026-03-02T01:00:00Z')),'stale');
  assert.equal(api.observations([{...current[0],observations:[{...source.observations[0],validUntil:null}]}],now).length,0);
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
