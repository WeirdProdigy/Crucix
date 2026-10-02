(function(window){
  'use strict';
  // Pure record logic for the inspector: no DOM, no location/history, no timers; time only comes from a `now` argument.
  const HOUR=3600000,PAGE=25,MAX_TEXT=80;
  const LEVELS=Object.freeze(['critical','high','watch','info','unknown']);
  const GLYPH=Object.freeze({critical:'◆',high:'▲',watch:'●',info:'○',unknown:'–'});
  const SORTS=['severity','time','title'],WINDOWS=[0,1,6,24],WIN={'1':1,'6':6,'24':24,all:0};
  const EVENT_ID=/^event-[0-9a-f]{32}$/;
  // The event scale and provider aliases of lib/intelligence/events.mjs, folded onto the four displayed levels.
  const SEVERITY={critical:'critical',extreme:'critical',severe:'critical',red:'critical',high:'high',elevated:'high',orange:'high',moderate:'watch',medium:'watch',yellow:'watch',monitor:'info',low:'info',minor:'info',info:'info',green:'info'};
  // No lookbehind (a parse error on Safari before 16.4): an intact pair matches first and is kept, any other half is dropped.
  const SURROGATE=/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

  // Same rules as the helpers in live-sources.js.
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC'):'—';
  function safeUrl(raw){try{const url=new URL(raw);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!Array.from(url.searchParams.keys()).some(key=>/^(?:api[-_]?key|token|secret|password|authorization|auth)$/i.test(key))?url.href:null;}catch{return null;}}

  const str=value=>typeof value==='string'?value:'';
  const ident=value=>typeof value==='string'?value:Number.isFinite(value)?String(value):'';
  const fold=value=>str(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
  const coord=value=>Number.isFinite(value)?value:null;
  const timeOf=value=>{const ms=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(ms)?ms:null;};
  // Search text: no control characters, at most 80 UTF-16 units, never a half surrogate pair (encodeURIComponent would throw).
  const cleanText=value=>str(value).replace(/[\u0000-\u001F\u007F-\u009F]/g,'').slice(0,MAX_TEXT).replace(SURROGATE,half=>half.length===2?half:'');

  function severityLevel(value){
    const word=typeof value==='string'?value.slice(0,30).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim().toLowerCase():'';
    return Object.hasOwn(SEVERITY,word)?SEVERITY[word]:'unknown';
  }
  function recordKey(row){return ident(row?.eventId)||ident(row?.providerId)||ident(row?.id)||str(row?.title)+'|'+(str(row?.observedAt)||str(row?.publishedAt));}
  function factsOf(facts){return (Array.isArray(facts)?facts:[]).filter(fact=>fact&&str(fact.label)&&['string','number','boolean'].includes(typeof fact.value)).slice(0,8).map(fact=>({label:fact.label,value:fact.value}));}
  // Live rows carry `source` as a string; snapshot events carry `source.name`, their own `id` and a `location` object.
  function toRecord(row,key,sourceName){
    const event=row.source&&typeof row.source==='object',location=row.location&&typeof row.location==='object'?row.location:{};
    return {key,source:str(sourceName)||(event?str(row.source.name):str(row.source)),kind:str(row.kind),title:row.title,summary:str(row.summary),
      level:severityLevel(row.severity),severity:str(row.severity),time:timeOf(row.observedAt||row.publishedAt),
      observedAt:str(row.observedAt)||null,publishedAt:str(row.publishedAt)||null,forecastAt:str(row.forecastAt)||null,startsAt:str(row.startsAt)||null,validUntil:str(row.validUntil)||null,
      place:str(row.place)||str(row.region)||str(location.label),country:str(row.country),lat:coord(row.lat??location.lat),lon:coord(row.lon??location.lon),
      url:str(row.url)||null,eventId:str(row.eventId)||(event?str(row.id):'')||null,facts:factsOf(row.facts),current:true};
  }
  function toRecords(rows,sourceName){
    const seen=new Set(),out=[];
    for(const row of Array.isArray(rows)?rows:[]){
      if(!row||typeof row!=='object'||!str(row.title))continue;
      const key=recordKey(row);if(seen.has(key))continue;
      seen.add(key);out.push(toRecord(row,key,sourceName));
    }
    return out;
  }

  const defaultFilters=()=>({levels:[],windowHours:0,text:'',sort:'severity'});
  function cleanFilters(value){
    const f=value&&typeof value==='object'?value:{};
    return {levels:Array.isArray(f.levels)?LEVELS.filter(level=>f.levels.includes(level)):[],windowHours:WINDOWS.includes(f.windowHours)?f.windowHours:0,text:cleanText(f.text),sort:SORTS.includes(f.sort)?f.sort:'severity'};
  }
  function filterRecords(recs,filters,now){
    const f=cleanFilters(filters),needle=fold(f.text).trim(),since=now-f.windowHours*HOUR;
    return (Array.isArray(recs)?recs:[]).filter(rec=>rec&&(!f.levels.length||f.levels.includes(rec.level))
      &&(!f.windowHours||(Number.isFinite(rec.time)&&rec.time>=since))
      &&(!needle||[rec.title,rec.summary,rec.place,rec.country].some(value=>fold(value).includes(needle))));
  }
  const rank=rec=>{const index=LEVELS.indexOf(rec.level);return index<0?LEVELS.length:index;};
  const byLevel=(a,b)=>rank(a)-rank(b);
  function byTime(a,b){const x=Number.isFinite(a.time),y=Number.isFinite(b.time);return x&&y?b.time-a.time:x?-1:y?1:0;}
  const byTitle=(a,b)=>str(a.title).localeCompare(str(b.title));
  const ORDER={severity:[byLevel,byTime,byTitle],time:[byTime,byTitle],title:[byTitle,byTime]};
  function sortRecords(recs,key){
    const order=ORDER[SORTS.includes(key)?key:'severity'];
    return (Array.isArray(recs)?recs.filter(Boolean):[]).sort((a,b)=>{for(const compare of order){const diff=compare(a,b);if(diff)return diff;}return 0;});
  }
  function countByLevel(recs){
    const counts=Object.fromEntries(LEVELS.map(level=>[level,0]));
    for(const rec of Array.isArray(recs)?recs:[])if(LEVELS.includes(rec?.level))counts[rec.level]++;
    return counts;
  }
  function ageLabel(ms,now){
    if(!Number.isFinite(ms)||!Number.isFinite(now))return '—';
    const minutes=Math.max(0,Math.floor((now-ms)/60000));
    return minutes<60?minutes+'m':minutes<1440?Math.floor(minutes/60)+'h':Math.floor(minutes/1440)+'d';
  }

  // Every hash piece is checked on its own; anything unknown or invalid is dropped, results only get fixed keys.
  function decode(value){try{return decodeURIComponent(value);}catch{return null;}}
  function parseHash(hash,allowedSources){
    const out={},filters={},allowed=Array.isArray(allowedSources)?allowedSources:[];
    for(const piece of str(hash).replace(/^#/,'').split('&')){
      const at=piece.indexOf('=');if(at<1)continue;
      const key=piece.slice(0,at),value=decode(piece.slice(at+1));if(value===null)continue;
      if(key==='src'){if(value==='all'||allowed.includes(value))out.source=value;}
      else if(key==='sev'){const levels=LEVELS.filter(level=>value.split(',').includes(level));if(levels.length)filters.levels=levels;}
      else if(key==='win'){if(Object.hasOwn(WIN,value))filters.windowHours=WIN[value];}
      else if(key==='q'){const text=cleanText(value);if(text)filters.text=text;}
      else if(key==='sort'){if(SORTS.includes(value))filters.sort=value;}
      else if(key==='rec'){if(EVENT_ID.test(value))out.record=value;}
      else if(key==='view'){if(value==='browser')out.browserOpen=true;}
    }
    if(Object.keys(filters).length)out.filters=filters;
    return out;
  }
  // A closed state (no source) serializes to ''; defaults are omitted.
  function serializeHash(state){
    if(!str(state?.source))return '';
    const f=cleanFilters(state.filters),parts=['src='+encodeURIComponent(state.source)];
    if(f.levels.length)parts.push('sev='+f.levels.join(','));
    if(f.windowHours)parts.push('win='+f.windowHours);
    if(f.text)parts.push('q='+encodeURIComponent(f.text));
    if(f.sort!=='severity')parts.push('sort='+f.sort);
    if(EVENT_ID.test(str(state.record)))parts.push('rec='+state.record);
    if(state.browserOpen===true)parts.push('view=browser');
    return parts.join('&');
  }

  // Transitions are pure: each returns a new State and never shares the filters object with its input.
  const initialState=()=>({source:null,record:null,filters:defaultFilters(),browserOpen:false,limit:PAGE});
  const next=(state,patch)=>({...initialState(),...state,filters:cleanFilters(state?.filters),...patch});
  const openSource=(state,name)=>next(state,{source:str(name)||null,record:null,filters:defaultFilters(),browserOpen:false,limit:PAGE});
  const closeAll=()=>initialState();
  const selectRecord=(state,key)=>next(state,{record:str(key)||null});
  const setFilters=(state,patch)=>next(state,{filters:cleanFilters({...state?.filters,...patch}),limit:PAGE});
  const showMore=state=>next(state,{limit:(Number.isFinite(state?.limit)?state.limit:PAGE)+PAGE});
  const openBrowser=state=>next(state,{browserOpen:true});
  const closeBrowser=state=>next(state,{browserOpen:false});
  // A selected record that left the fresh set stays visible, flagged outdated, until closed or replaced.
  function reconcileSelection(key,lastRec,current){
    if(!str(key))return {record:null,outdated:false};
    const found=(Array.isArray(current)?current:[]).find(rec=>rec?.key===key);
    if(found)return {record:found,outdated:false};
    return lastRec?.key===key?{record:lastRec,outdated:true}:{record:null,outdated:false};
  }

  function indexEvents(events){
    const byId=new Map();
    for(const event of Array.isArray(events)?events:[])if(event&&typeof event==='object'&&str(event.id)&&!byId.has(event.id))byId.set(event.id,event);
    return byId;
  }
  // Rows stamped since 2.9.0 pair by eventId only; 2.8.0 rows without one fall back to source + title + observedAt.
  function eventForRow(row,byId,events){
    if(!row||typeof row!=='object')return null;
    if(str(row.eventId))return (typeof byId?.get==='function'?byId:indexEvents(events)).get(row.eventId)??null;
    return str(row.title)&&(Array.isArray(events)?events:[]).find(event=>event&&event.source?.name===row.source&&event.title===row.title&&event.observedAt===row.observedAt)||null;
  }

  function createStore(initial){
    let state={...initialState(),...initial};
    const listeners=new Set();
    return {get:()=>state,set(patch){state={...state,...patch};for(const listener of [...listeners])listener(state);},subscribe(listener){listeners.add(listener);return ()=>{listeners.delete(listener);};}};
  }

  window.CrucixRecords={LEVELS,GLYPH,severityLevel,recordKey,toRecords,filterRecords,sortRecords,countByLevel,ageLabel,parseHash,serializeHash,
    openSource,closeAll,selectRecord,setFilters,showMore,openBrowser,closeBrowser,reconcileSelection,indexEvents,eventForRow,store:createStore(),createStore,esc,safeUrl,stamp};
})(window);
