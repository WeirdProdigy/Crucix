import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read=file=>readFileSync(new URL('../dashboard/public/'+file,import.meta.url),'utf8');
// record-core.js and record-inspector.js share one realm, as in the page; the render functions only return strings.
const load=()=>{const window={},context=vm.createContext({window,Date,URL});for(const file of ['record-core.js','record-inspector.js'])vm.runInContext(read(file),context);return window;};
const t=(_,fallback)=>fallback;
const now=Date.parse('2026-10-02T12:00:00Z'),HOUR=3600000,at=ms=>new Date(ms).toISOString();
const ID='event-'+'a'.repeat(32),HOSTILE='<img onerror=x>';
const count=(html,needle)=>html.split(needle).length-1;
const gdacs={name:'GDACS',url:'https://www.gdacs.org/',state:'ok',observedAt:at(now-HOUR),attribution:'GDACS',rights:'',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'};
// The caller composes filterRecords + sortRecords; the renderers never filter or sort themselves.
function view(window,rows,extra={}){
  const R=window.CrucixRecords,all=R.toRecords(rows,'GDACS'),filters={levels:[],windowHours:0,text:'',sort:'severity',...extra.filters};
  return {source:gdacs,records:R.sortRecords(R.filterRecords(all,filters,now),filters.sort),total:all.length,filters,limit:25,selected:null,...extra};
}
const row=(i,more={})=>({providerId:'p'+i,title:'Row '+i,severity:'Orange',observedAt:at(now-i*60000),...more});

test('rendering escapes hostile text',()=>{
  const window=load(),I=window.CrucixRecordInspector,R=window.CrucixRecords;
  const hostile={...gdacs,name:HOSTILE,url:'javascript:alert(1)',attribution:HOSTILE,rights:HOSTILE,license:HOSTILE,licenseUrl:'javascript:alert(1)'};
  const rows=[row(1,{title:HOSTILE,summary:HOSTILE,place:HOSTILE,country:HOSTILE,facts:[{label:HOSTILE,value:HOSTILE}],url:'https://example.org/?api_key=s'}),row(2,{title:HOSTILE,url:'javascript:alert(1)'})];
  const recs=R.toRecords(rows,'GDACS');
  for (const rec of recs) {
    const v={...view(window,rows),source:hostile,selected:{record:rec,outdated:false}};
    const inspector=I.renderInspector(v,t,now),browser=I.renderBrowser({...v,sources:[{name:HOSTILE,state:'ok',count:2,levels:{high:2}}]},t,now);
    for (const html of [inspector,browser]) {
      assert(!html.includes('<img'),'no raw markup'); assert(html.includes('&lt;img'),'escaped text is present');
      assert(!/href=/.test(html),'unsafe source, licence and record links are dropped');
    }
  }
  const facts=I.renderInspector({...view(window,rows),selected:{record:recs[0],outdated:false}},t,now);
  assert(facts.includes('<dt>&lt;img onerror=x&gt;</dt><dd>&lt;img onerror=x&gt;</dd>'),'fact label and value are escaped');
});

test('paging',()=>{
  const window=load(),I=window.CrucixRecordInspector,rows=Array.from({length:60},(_,i)=>row(i));
  const first=I.renderInspector(view(window,rows),t,now);
  assert.equal(count(first,'class="ri-row"'),25); assert.equal(count(first,'data-ri-action="more"'),1);
  assert.match(first,/class="ri-count" role="status">25 \/ 60 shown</,'the shown/total line is a live region');
  const rest=I.renderInspector(view(window,rows,{limit:100}),t,now);
  assert.equal(count(rest,'class="ri-row"'),60); assert.equal(count(rest,'data-ri-action="more"'),0);
  assert.match(rest,/class="ri-count" role="status">60 \/ 60 shown</);
  assert.equal(count(first,'tabindex="0"'),1,'roving tabindex: one row is focusable');
  assert(first.includes('<span class="ri-glyph sev-high" aria-hidden="true">▲</span><span class="ri-sr">High</span>'),'glyph is hidden, level is spoken');
});

test('selection and outdated',()=>{
  const window=load(),I=window.CrucixRecordInspector,R=window.CrucixRecords;
  const rows=[row(1,{eventId:ID,url:'https://example.org/a',summary:'Full text',place:'Szeged',country:'HU',lat:46.25,lon:20.15,facts:[{label:'blockingConfirmed',value:true},{label:'rate',value:1.08}]}),row(2),row(3)];
  const recs=R.toRecords(rows,'GDACS'),pick=(rec,outdated)=>I.renderInspector(view(window,rows,{selected:{record:rec,outdated}}),t,now);
  const html=pick(recs[1],false);
  assert.equal(count(html,'aria-selected="true"'),1); assert.equal(count(html,'aria-selected="false"'),2);
  assert.match(html,new RegExp(`data-key="${recs[1].key}" aria-selected="true" tabindex="0"`));
  assert(!html.includes('No longer current'));
  assert(!html.includes('data-ri-action="details"'),'no eventId, no details button');
  const full=pick(recs[0],false);
  assert(full.includes(`data-ri-action="details" data-event-id="${ID}"`));
  assert(full.includes('href="https://example.org/a"')); assert(full.includes('rel="noopener noreferrer"'));
  for (const text of ['Full text','Szeged, HU','Provider time','2026-10-02 11:59:00 UTC','<dt>blockingConfirmed</dt><dd>Yes</dd>','<dt>rate</dt><dd>1.08</dd>']) assert(full.includes(text),text);
  // The outdated flag drives the badge, not rec.current (reconcileSelection can hand back an outdated record whose current is true).
  const gone=R.toRecords([row(9,{title:'Dropped out'})],'GDACS')[0];
  const outdated=pick(gone,true);
  assert.equal(gone.current,true); assert(outdated.includes('No longer current')); assert(outdated.includes('Dropped out'));
  assert.equal(count(outdated,'aria-selected="true"'),0);
  assert(!I.renderInspector(view(window,rows),t,now).includes('<section class="ri-detail"><'),'no selection, empty detail');
});

test('states',()=>{
  const window=load(),I=window.CrucixRecordInspector,rows=[row(1),row(2)];
  for (const [state,reason] of [['error','Source unavailable'],['stale','Provider data expired']]) {
    const html=I.renderInspector({...view(window,rows),source:{...gdacs,state}},t,now);
    assert(html.includes(reason),state); assert(html.includes('Last successful update: 2026-10-02 11:00:00 UTC'),state);
    assert.equal(count(html,'class="ri-row"'),0,state); assert(!html.includes('ri-filters'),state);
  }
  const empty=I.renderInspector(view(window,[]),t,now);
  assert(empty.includes('No current records in the watched scope')); assert(!empty.includes('No records match'));
  const filtered=I.renderInspector(view(window,rows,{filters:{text:'nothing like this'}}),t,now);
  assert(filtered.includes('No records match the filters')); assert.equal(count(filtered,'class="ri-row"'),0);
  assert(filtered.includes('value="nothing like this"'),'the search box keeps its text');
  // Opened from the hash before the first collection arrived: a reason, not an empty panel.
  const waiting=I.renderInspector({source:null,records:[],total:0,filters:{},limit:25,selected:null},t,now);
  assert(waiting.includes('Waiting for the first collection')); assert(waiting.includes('data-ri-action="close"'));
});

test('browser',()=>{
  const window=load(),I=window.CrucixRecordInspector,R=window.CrucixRecords;
  const sources=[{name:'GDACS',state:'ok',count:3,levels:{critical:1,high:2,watch:0,info:0,unknown:0}},{name:'OONI',state:'error',count:0,levels:{}},{name:'ECB',state:'ok',count:7,levels:{info:7}}];
  const events=[{id:ID,title:'Quake M6',severity:'high',observedAt:at(now-HOUR),source:{name:'USGS'},location:{label:'Chile'}},{id:'event-'+'b'.repeat(32),title:'Undated bulletin',severity:'monitor',source:{name:'WHO'}}];
  const recs=R.toRecords(events),compose=filters=>{const f={levels:[],windowHours:0,text:'',sort:'severity',...filters};return {source:null,all:true,sources,records:R.sortRecords(R.filterRecords(recs,f,now),f.sort),total:recs.length,filters:f,limit:25,selected:null};};
  const html=I.renderBrowser(compose({}),t,now);
  for (const part of ['class="rb-sources"','class="rb-list"','class="rb-detail"','data-ri-source="all" aria-current="true"','data-ri-action="collapse"','data-ri-action="close"']) assert(html.includes(part),part);
  for (const [name,n] of [['GDACS',3],['OONI',0],['ECB',7]]) {
    const button=html.match(new RegExp(`<button[^>]*data-ri-source="${name}"[^>]*>.*?</button>`))?.[0]??'';
    assert(button.includes(`<span class="rb-count">${n}</span>`),name);
  }
  assert(html.includes('<span class="sev sev-high"><i aria-hidden="true">▲</i>2<span class="ri-sr"> High</span></span>'),'badge with spoken level');
  const undated=html.match(/<li class="ri-row"[^>]*>(?:(?!<\/li>).)*Undated bulletin(?:(?!<\/li>).)*<\/li>/)?.[0]??'';
  assert(undated.includes('<span class="ri-age">—</span>'),'time-less event shows a dash');
  assert.equal(count(html,'class="ri-row"'),2);
  const recent=I.renderBrowser(compose({windowHours:6}),t,now);
  assert(!recent.includes('Undated bulletin')); assert(recent.includes('Quake M6')); assert(recent.includes('<option value="6" selected>'));
  const one=I.renderBrowser({...compose({}),all:false,source:{...gdacs,name:'OONI',state:'error'},records:[],total:0},t,now);
  assert(one.includes('data-ri-source="OONI" aria-current="true"')); assert(one.includes('Source unavailable')); assert(!one.includes('data-ri-source="all" aria-current'));
  assert(!html.includes('id="ri-window"'),'browser controls do not reuse the inspector ids'); assert(html.includes('id="rb-window"'));
  assert(html.includes('<p class="ri-keys">j/k move · Enter details · / search · Esc back to panel</p>'),'the browser hint lists only the keys it has');
  assert(!html.includes('e expand'),'the browser has no e key');
  assert(html.includes('class="ri-count" role="status">2 / 2 shown<'),'the browser count is a live region too');
  assert(I.renderInspector(view(window,[row(1)]),t,now).includes('<p class="ri-keys">j/k move · Enter details · / search · e expand · Esc close</p>'),'the panel hint keeps e and Esc close');
});

test('robustness',()=>{
  const window=load(),I=window.CrucixRecordInspector;
  for (const fn of [I.renderInspector,I.renderBrowser]) {
    for (const v of [{},null,undefined,{source:gdacs,records:[null,5,{}],total:3},{source:gdacs,records:'x',total:NaN,limit:-1,filters:'x',selected:{record:5}},{all:true,sources:[null,5,{}],records:[{},null]}])
      assert.doesNotThrow(()=>{const html=fn(v,t,now);assert.equal(typeof html,'string');},JSON.stringify(v));
    assert.doesNotThrow(()=>fn({source:gdacs,records:[],total:0},undefined,NaN));
  }
  assert.equal(count(I.renderInspector({source:gdacs,records:[null,5,{}],total:3},t,now),'class="ri-row"'),1);
});

// A minimal DOM: just enough for mount/refresh to run; dialog.showModal throws like a browser that refuses a modal.
// `bars` maps element ids (topbar, alertStrip) to {hidden?, bottom} for the dock offset; `created` lists the made elements.
function dom(hash,files=['record-core.js','live-sources.js','record-inspector.js'],bars={}){
  const errors=[],created=[],window={addEventListener(){}},el=tag=>{const node={tag,hidden:false,open:false,dataset:{},props:{},style:{setProperty(k,v){node.props[k]=v;}},attrs:{},
    setAttribute(k,v){this.attrs[k]=v;},removeAttribute(){},hasAttribute(){return false;},addEventListener(){},append(){},contains(){return false;},querySelector(){return null;},
    showModal(){throw new Error('showModal refused');},close(){}};created.push(node);return node;};
  const byId=id=>Object.hasOwn(bars,id)?{hidden:bars[id].hidden===true,getBoundingClientRect:()=>({bottom:bars[id].bottom})}:null;
  const document={body:el('body'),createElement:el,getElementById:byId,querySelectorAll(){return [];},addEventListener(){},activeElement:null};
  const context=vm.createContext({window,document,location:{hash,pathname:'/',search:''},history:{replaceState(){}},console:{error:(...args)=>errors.push(args)},Date,URL});
  for(const file of files)vm.runInContext(read(file),context);
  return {window,errors,created};
}
const options={getSources:()=>[{...gdacs,source:'GDACS',status:'ok',observations:[]}],getEvents:()=>[],t,now:()=>now};

test('an inspector error never escapes mount or refresh',()=>{
  const {window,errors}=dom('#src=GDACS&view=browser'),I=window.CrucixRecordInspector;
  assert.doesNotThrow(()=>I.mount(options),'a hash that opens the browser must not stop the dashboard start-up');
  assert(errors.length>0&&errors[0][0]==='[inspector]','the error is logged, not swallowed');
  const before=errors.length;
  assert.doesNotThrow(()=>I.refresh(),'a failing re-render must not abort the SSE update'); assert(errors.length>before);
  assert.doesNotThrow(()=>dom('').window.CrucixRecordInspector.refresh(),'refresh before mount is a no-op');
});

test('the docked panel starts below the alert strip, else below the top bar',()=>{
  for(const [bars,expected] of [[{topbar:{bottom:123}},'123px'],[{topbar:{bottom:123},alertStrip:{bottom:170}},'170px'],
    [{topbar:{bottom:123},alertStrip:{bottom:0,hidden:true}},'123px'],[{topbar:{bottom:-40},alertStrip:{bottom:-4}},'0px']]){
    const {window,errors,created}=dom('#src=GDACS',undefined,bars);
    window.CrucixRecordInspector.mount(options);
    const aside=created.find(node=>node.tag==='aside');
    assert.equal(aside.hidden,false); assert.equal(aside.props['--ri-top'],expected,JSON.stringify(bars)); assert.deepEqual(errors,[]);
  }
});

test('mount does nothing without the live source module',()=>{
  const {window,errors}=dom('#src=GDACS',['record-core.js','record-inspector.js']);
  assert.doesNotThrow(()=>window.CrucixRecordInspector.mount(options)); assert.equal(errors.length,0);
});
