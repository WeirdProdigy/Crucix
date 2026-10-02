import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeSeverity } from '../lib/intelligence/events.mjs';
const code=readFileSync(new URL('../dashboard/public/record-core.js',import.meta.url),'utf8');
// A fresh context per test: the singleton store must not leak between tests.
const load=()=>{const window={};vm.runInNewContext(code,{window,Date,URL});return window.CrucixRecords;};
// Objects built inside the vm realm have foreign prototypes; compare their JSON shape.
const plain=value=>JSON.parse(JSON.stringify(value));
const now=Date.parse('2026-10-02T12:00:00Z'),HOUR=3600000;
const at=ms=>new Date(ms).toISOString();
const ID='event-'+'a'.repeat(32),OTHER='event-'+'b'.repeat(32);

test('severityLevel matches the server vocabulary',()=>{
  const R=load(),display={critical:'critical',high:'high',elevated:'high',moderate:'watch',low:'info',monitor:'info',unknown:'unknown'};
  for (const word of ['Critical','Extreme','Severe','Red','High','Elevated','Orange','Moderate','Medium','Yellow','Monitor','Low','Minor','Info','Green','unknown','banana','',null,7])
    assert.equal(R.severityLevel(word),display[normalizeSeverity(word)??'unknown'],String(word));
  // CAP Extreme > Severe: Severe (an NWS Flood Warning) is High, only Extreme and Red are Critical.
  assert.deepEqual(['Severe','severe','Extreme','Red'].map(R.severityLevel),['high','high','critical','critical']);
  assert.deepEqual(plain(R.LEVELS),['critical','high','watch','info','unknown']);
  assert.deepEqual(plain(R.GLYPH),{critical:'◆',high:'▲',watch:'●',info:'○',unknown:'–'});
});

test('filter and sort',()=>{
  const R=load();
  const rows=[
    {providerId:'a',title:'Árvíz Szegeden',severity:'Red',observedAt:at(now-HOUR)},
    {providerId:'b',title:'Storm',severity:'Orange',place:'ARVIZ county',observedAt:at(now-2*HOUR)},
    {providerId:'c',title:'Old quake',severity:'Extreme',observedAt:at(now-10*HOUR)},
    {providerId:'d',title:'No time',severity:'Yellow'},
    {providerId:'e',title:'Info row',severity:'green',observedAt:at(now-HOUR/2)},
    {providerId:'f',title:'Critical newer',severity:'critical',publishedAt:at(now-HOUR/4)},
    {providerId:'g',title:'Critical no time',severity:'Extreme'}];
  const recs=R.toRecords(rows,'GDACS'),before=JSON.stringify(recs);
  const titles=list=>plain(list.map(rec=>rec.title));
  assert.equal(recs.length,7); assert.equal(recs[3].time,null); assert.equal(recs[5].time,now-HOUR/4);
  assert.deepEqual(titles(R.filterRecords(recs,{levels:['critical']},now)),['Árvíz Szegeden','Old quake','Critical newer','Critical no time']);
  assert.deepEqual(titles(R.filterRecords(recs,{levels:['high','info']},now)),['Storm','Info row']);
  assert.deepEqual(titles(R.filterRecords(recs,{windowHours:6},now)),['Árvíz Szegeden','Storm','Info row','Critical newer']);
  assert.equal(R.filterRecords(recs,{windowHours:0},now).length,7);
  assert.deepEqual(titles(R.filterRecords(recs,{text:'arviz'},now)),['Árvíz Szegeden','Storm']);
  assert.deepEqual(titles(R.sortRecords(recs,'severity')),['Critical newer','Árvíz Szegeden','Old quake','Critical no time','Storm','No time','Info row']);
  assert.deepEqual(titles(R.sortRecords(recs,'time')),['Critical newer','Info row','Árvíz Szegeden','Storm','Old quake','Critical no time','No time']);
  assert.deepEqual(titles(R.sortRecords(recs,'title')),['Árvíz Szegeden','Critical newer','Critical no time','Info row','No time','Old quake','Storm']);
  assert.equal(JSON.stringify(recs),before);
  assert.notStrictEqual(R.sortRecords(recs,'severity'),recs);
  assert.deepEqual(plain(R.countByLevel(recs)),{critical:4,high:1,watch:1,info:1,unknown:0});
});

test('keys are unique and stable',()=>{
  const R=load(),T=at(now-HOUR),T2=at(now-2*HOUR);
  const one={title:'Same',observedAt:T},two={title:'Same',observedAt:T},later={title:'Same',observedAt:T2};
  assert.equal(R.recordKey(one),R.recordKey(two));
  assert.equal(R.toRecords([one,two],'GDACS').length,1);
  assert.equal(R.toRecords([one,later],'GDACS').length,2);
  assert.notEqual(R.recordKey(one),R.recordKey(later));
  assert.equal(R.recordKey({eventId:ID,providerId:'p',id:'i',title:'x'}),ID);
  assert.equal(R.recordKey({providerId:'p',id:'i',title:'x'}),'p');
  const kept=R.toRecords([null,5,'x',[],{summary:'no title'},{title:''},{title:'<img onerror=x>',observedAt:T,providerId:'p1',summary:'first'},{title:'dup',providerId:'p1',summary:'second'}],'GDACS');
  assert.equal(kept.length,1); assert.equal(kept[0].title,'<img onerror=x>'); assert.equal(kept[0].summary,'first');
  const [rec]=R.toRecords([{id:ID,kind:'disaster',title:'Quake',summary:'M6',severity:'high',source:{name:'USGS'},location:{label:'Somewhere',lat:1,lon:2},observedAt:T}]);
  assert.deepEqual(plain(rec),{key:ID,source:'USGS',kind:'disaster',title:'Quake',summary:'M6',level:'high',severity:'high',time:now-HOUR,observedAt:T,publishedAt:null,forecastAt:null,startsAt:null,validUntil:null,place:'Somewhere',country:'',lat:1,lon:2,url:null,eventId:ID,facts:[],current:true});
  const [live]=R.toRecords([{source:'OONI',title:'Blocked',eventId:OTHER,region:'Region',country:'HU',facts:[{label:'targetHost',value:'example.org'},null],url:'https://example.org/'}]);
  assert.equal(live.source,'OONI'); assert.equal(live.place,'Region'); assert.equal(live.country,'HU'); assert.equal(live.eventId,OTHER);
  assert.deepEqual(plain(live.facts),[{label:'targetHost',value:'example.org'}]); assert.equal(live.url,'https://example.org/');
});

test('hash parsing drops hostile input piecewise',()=>{
  const R=load();
  assert.deepEqual(plain(R.parseHash('#src=__proto__&sev=critical,<script>&win=999&q=%00%00abc&rec=nope&view=evil&sort=drop',['GDACS'])),{filters:{levels:['critical'],text:'abc'}});
  assert.deepEqual(plain(R.parseHash('__proto__=x&constructor=y&src=GDACS',['GDACS'])),{source:'GDACS'});
  assert.deepEqual(plain(R.parseHash('#q=%E0%A4%A&sev=high',['GDACS'])),{filters:{levels:['high']}});
  assert.deepEqual(plain(R.parseHash('#src=all&win=all',['GDACS'])),{source:'all',filters:{windowHours:0}});
  for (const hash of ['','#','%E0%A4%A','#'+'x'.repeat(10000)]) assert.deepEqual(plain(R.parseHash(hash,['GDACS'])),{},hash.slice(0,10));
  assert.equal(R.parseHash('#q='+'x'.repeat(10000),['GDACS']).filters.text.length,80);
  assert.equal(R.serializeHash({source:'GDACS',filters:{text:'x'.repeat(79)+'😀'}}),'src=GDACS&q='+'x'.repeat(79));
  const state={source:'GDACS',record:ID,filters:{levels:['critical','watch'],windowHours:6,text:'árvíz & co=1#',sort:'time'},browserOpen:true,limit:50};
  const hash=R.serializeHash(state);
  assert(!hash.startsWith('#'));
  assert.deepEqual(plain(R.parseHash('#'+hash,['GDACS'])),{source:'GDACS',record:ID,filters:{levels:['critical','watch'],windowHours:6,text:'árvíz & co=1#',sort:'time'},browserOpen:true});
  assert.equal(R.serializeHash({source:'GDACS',record:null,filters:{levels:[],windowHours:0,text:'',sort:'severity'},browserOpen:false,limit:25}),'src=GDACS');
  assert.equal(R.serializeHash({source:null,record:null,filters:{levels:[],windowHours:0,text:'',sort:'severity'},browserOpen:false,limit:25}),'');
});

test('transitions and reconcile',()=>{
  const R=load(),closed=R.closeAll({});
  assert.deepEqual(plain(closed),{source:null,record:null,filters:{levels:[],windowHours:0,text:'',sort:'severity'},browserOpen:false,limit:25});
  const filtered=R.setFilters(R.selectRecord(R.openSource(closed,'GDACS'),'k'),{levels:['high']});
  assert.equal(filtered.record,'k'); assert.equal(filtered.limit,25);
  const more=R.showMore(filtered); assert.equal(more.limit,50); assert.equal(filtered.limit,25);
  const refined=R.setFilters(more,{text:'flood'});
  assert.equal(refined.limit,25); assert.equal(refined.record,'k'); assert.deepEqual(plain(refined.filters),{levels:['high'],windowHours:0,text:'flood',sort:'severity'});
  const reopened=R.openSource(R.openBrowser(refined),'OONI');
  assert.deepEqual(plain(reopened),{source:'OONI',record:null,filters:{levels:[],windowHours:0,text:'',sort:'severity'},browserOpen:false,limit:25});
  assert.equal(R.openBrowser(refined).browserOpen,true); assert.equal(R.closeBrowser(R.openBrowser(refined)).browserOpen,false);
  assert.equal(R.closeAll(refined).source,null); assert.equal(R.selectRecord(refined,null).record,null);
  assert.deepEqual(plain(refined.filters.levels),['high']);
  const last={key:'k',title:'Last'},fresh={key:'k',title:'Fresh'};
  const gone=R.reconcileSelection('k',last,[]); assert.strictEqual(gone.record,last); assert.equal(gone.outdated,true);
  const here=R.reconcileSelection('k',last,[{key:'x'},fresh]); assert.strictEqual(here.record,fresh); assert.equal(here.outdated,false);
  assert.deepEqual(plain(R.reconcileSelection('unknown',null,[fresh])),{record:null,outdated:false});
  assert.deepEqual(plain(R.reconcileSelection(null,last,[fresh])),{record:null,outdated:false});
});

test('legacy rows still pair with events',()=>{
  const R=load(),T=at(now-HOUR);
  const flood={id:ID,title:'Flood',source:{name:'GDACS'},observedAt:T},other={id:OTHER,title:'Fire',source:{name:'NASA-EONET'},observedAt:T};
  const events=[null,5,'x',{title:'no id'},flood,other],byId=R.indexEvents(events);
  assert.equal(byId.size,2); assert.strictEqual(byId.get(ID),flood);
  assert.strictEqual(R.eventForRow({source:'GDACS',title:'Flood',observedAt:T},byId,events),flood);
  assert.strictEqual(R.eventForRow({source:'GDACS',title:'Fire',eventId:OTHER,observedAt:T},byId,events),other);
  assert.equal(R.eventForRow({source:'GDACS',title:'Flood',eventId:'event-'+'c'.repeat(32),observedAt:T},byId,events),null);
  assert.equal(R.eventForRow({source:'OONI',title:'Flood',observedAt:T},byId,events),null);
  assert.equal(R.eventForRow(null,byId,events),null);
  assert.equal(R.indexEvents(null).size,0);
});

test('store notifies and unsubscribes',()=>{
  const R=load(),store=R.createStore(),seen=[];
  assert.equal(R.store.get().source,null); assert.equal(store.get().limit,25);
  const off=store.subscribe(state=>seen.push(state.source));
  store.set({source:'GDACS'});
  assert.deepEqual(seen,['GDACS']); assert.equal(store.get().source,'GDACS'); assert.equal(store.get().limit,25);
  off(); store.set({source:null});
  assert.deepEqual(seen,['GDACS']); assert.equal(store.get().source,null);
  assert.equal(R.createStore({source:'OONI'}).get().source,'OONI');
});

test('shared helpers follow the live-sources rules',()=>{
  const R=load();
  assert.equal(R.esc('<a href="x">\'&'),'&lt;a href=&quot;x&quot;&gt;&#39;&amp;'); assert.equal(R.esc(null),'');
  assert.equal(R.safeUrl('https://example.org/a?b=1'),'https://example.org/a?b=1');
  for (const bad of ['javascript:alert(1)','https://user:pw@example.org/','https://example.org/?api_key=s','https://example.org/?Token=s','not a url',null]) assert.equal(R.safeUrl(bad),null,String(bad));
  assert.equal(R.stamp('2026-10-02T11:00:00.000Z'),'2026-10-02 11:00:00 UTC'); assert.equal(R.stamp('nope'),'—');
  assert.equal(R.ageLabel(now-12*60000,now),'12m'); assert.equal(R.ageLabel(now-3*HOUR,now),'3h');
  assert.equal(R.ageLabel(now-50*HOUR,now),'2d'); assert.equal(R.ageLabel(null,now),'—');
});
test('search text never keeps a half surrogate pair',()=>{
  const R=load(),clean=text=>R.setFilters({},{text}).filters.text;
  assert.equal(clean('x'.repeat(79)+'😀'),'x'.repeat(79),'high half cut off by the length cap');
  assert.equal(clean('\uDE00abc'),'abc','leading low half');
  assert.equal(clean('a\uD83Db'),'ab','high half in the middle');
  assert.equal(clean('\uDE00\uD83D'),'','reversed pair: both halves are lone');
  assert.equal(clean('😀 árvíz 😀'),'😀 árvíz 😀','intact pairs stay');
  for (const text of ['x'.repeat(79)+'😀','\uDE00abc','a\uD83Db','\uDE00\uD83D'])assert.doesNotThrow(()=>encodeURIComponent(clean(text)),JSON.stringify(text));
});
