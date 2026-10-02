(function(window){
  'use strict';
  const HOUR=3600000;
  const policies={Meteoalarm:{maxAgeMs:3*HOUR,observationMaxAgeMs:48*HOUR},GDACS:{maxAgeMs:6*HOUR,observationMaxAgeMs:72*HOUR},'NOAA-SWPC':{maxAgeMs:HOUR},ECB:{maxAgeMs:120*HOUR},'NASA-EONET':{maxAgeMs:72*HOUR},RIPEstat:{maxAgeMs:8*HOUR},'FIRST-EPSS':{maxAgeMs:48*HOUR},'MET-Norway':{maxAgeMs:8*HOUR},OONI:{maxAgeMs:24*HOUR},'IMF-PortWatch':{maxAgeMs:240*HOUR,observationMaxAgeMs:240*HOUR},EMSC:{maxAgeMs:12*HOUR,observationMaxAgeMs:26*HOUR}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function time(value){
    if(typeof value!=='string'||value.length>128)return NaN;
    const match=value.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?$/);
    if(!match||Number(match[2]||0)>23||Number(match[3]||0)>59||Number(match[4]||0)>59)return NaN;
    const day=new Date(match[1]+'T00:00:00Z');
    if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==match[1])return NaN;
    if(match[5]&&match[5]!=='Z'&&(Number(match[5].slice(1,3))>23||Number(match[5].slice(4))>59))return NaN;
    return Date.parse(value);
  }
  function fresh(value,limit,now){const ms=time(value);return Number.isFinite(ms)&&now-ms>=-300000&&now-ms<=limit;}
  function validRow(row,policy,now,source){
    if(!row||!fresh(row.observedAt||row.publishedAt,policy.observationMaxAgeMs||policy.maxAgeMs,now))return false;
    if(row.validUntil!==undefined&&(!Number.isFinite(time(row.validUntil))||time(row.validUntil)<=now))return false;
    if(source==='MET-Norway'||row.kind==='forecast'){
      const target=time(row.forecastAt),until=time(row.validUntil);
      if(!Number.isFinite(target)||!Number.isFinite(until)||Math.abs(target-now)>HOUR||until<=target||until-target>12*HOUR||until<=now)return false;
    }
    return true;
  }
  function state(source,now=Date.now()){
    if(source?.status==='error'||source?.error)return 'error';
    const policy=policies[source?.source];
    return policy && source?.status==='ok' && !source.stale && fresh(source.observedAt,policy.maxAgeMs,now) && (source.source!=='MET-Norway'||(Array.isArray(source.observations)&&source.observations.slice(0,100).some(row=>validRow(row,policy,now,source.source))))?'ok':'stale';
  }
  const limit=()=>Object.keys(policies).length;
  function observations(sources,now=Date.now()){
    return (Array.isArray(sources)?sources:[]).slice(0,limit()).flatMap(source=>{
      if(state(source,now)!=='ok')return [];
      const policy=policies[source.source];
      return (Array.isArray(source.observations)?source.observations:[]).slice(0,100).filter(row=>validRow(row,policy,now,source.source));
    });
  }
  const stamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC'):'—';
  function safeUrl(raw){try{const url=new URL(raw);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!Array.from(url.searchParams.keys()).some(key=>/^(?:api[-_]?key|token|secret|password|authorization|auth)$/i.test(key))?url.href:null;}catch{return null;}}
  function metricText(metrics){
    const rows=[];
    function walk(value,path='',depth=0){if(depth>3||!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value).slice(0,40)){const label=path?path+' / '+key:key;if(typeof item==='string'||typeof item==='number'||typeof item==='boolean')rows.push(label+': '+item);else walk(item,label,depth+1);if(rows.length>=8)return;}}
    walk(metrics);return rows.slice(0,8).join(' · ');
  }
  // One badge per known level that has records: glyph and count, so colour is never the only signal; the level name is spoken (.ri-sr) and shown as a tooltip.
  function badges(R,recs,t){
    const counts=R.countByLevel(recs);
    return R.LEVELS.filter(level=>level!=='unknown'&&counts[level]).map(level=>{const name=esc(t('inspector.level.'+level,level[0].toUpperCase()+level.slice(1)));return `<span class="sev sev-${level}" title="${name}"><i aria-hidden="true">${R.GLYPH[level]}</i>${counts[level]}<span class="ri-sr"> ${name}</span></span>`;}).join('');
  }
  // `events` is unused (the inspector pairs records by eventId); it stays so `now` keeps its position.
  function renderPanel(sources,t,events,now=Date.now()){
    const R=window.CrucixRecords,tr=(key,fallback)=>esc(t('liveSources.'+key,fallback));
    const providers=(Array.isArray(sources)?sources:[]).slice(0,limit()).filter(source=>source&&Object.hasOwn(policies,source.source));
    const cards=providers.map(source=>{
      const status=state(source,now),rows=observations([source],now),url=safeUrl(source.url);
      const partialForecast=source.source==='MET-Norway'&&rows.length!==(source.observations||[]).length;
      const recs=R?R.toRecords(rows,source.source):[],count=R?recs.length:rows.length;
      const detail=status==='ok'?(partialForecast?'':source.summary||metricText(source.metrics))||(count?'':t('liveSources.noRecords','No current records in the watched scope')):'';
      const content=status==='ok'?(detail?`<p class="live-summary">${esc(detail)}</p>`:''):`<p class="live-summary">${status==='error'?tr('unavailable','Source unavailable'):tr('expired','Provider data expired or its timestamp is unknown. Live records are hidden.')}</p>`;
      const top=R?R.sortRecords(recs,'severity').slice(0,3).map(rec=>`<li>${esc(rec.title)}</li>`).join(''):'';
      const overview=count?`<div class="live-meta"><span>${count} ${tr('records','current records')}</span>${R?badges(R,recs,t):''}</div>${top?`<ul class="live-top" aria-label="${tr('topRecords','Top records')}">${top}</ul>`:''}`:'';
      const open=status==='ok'?`<button type="button" class="live-open" data-open-records="${esc(source.source)}" aria-controls="record-inspector">${tr('openRecords','Open records')}</button>`:'';
      const licenseUrl=safeUrl(source.licenseUrl);
      return `<article class="live-source" data-live-source="${esc(source.source)}" data-live-state="${status}"${R?.store.get().source===source.source?' data-selected="true"':''}><div class="live-source-head"><h4>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(source.source)} ↗</a>`:esc(source.source)}</h4><span class="source-state ${status}">${tr(status,status==='ok'?'Current':status==='error'?'Unavailable':'Expired')}</span></div><small>${tr('providerTime','Provider time')}: ${esc(stamp(source.observedAt))}</small>${content}${overview}${open}${source.attribution||source.rights?`<small class="live-attribution">${esc(source.attribution)} ${esc(source.rights)}</small>`:''}${source.license?`<small>${licenseUrl?'<a href="'+esc(licenseUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(source.license)+'</a>':esc(source.license)}</small>`:''}</article>`;
    }).join('');
    return `<div class="g-panel live-sources-panel"><div class="sec-head"><h3>${tr('title','Current public data')}</h3><span class="badge">${providers.filter(row=>state(row,now)==='ok').length}/${providers.length}</span></div><p class="live-help">${tr('help','Only records within each provider’s freshness window are shown. Forecasts and model estimates are labelled.')}</p><div class="live-source-list">${cards||'<div class="empty-state">'+tr('waiting','Waiting for the first collection')+'</div>'}</div></div>`;
  }
  window.CrucixLiveSources={policies,state,observations,renderPanel};
})(window);
