(function(window){
  'use strict';
  // Needs record-core.js (window.CrucixRecords) loaded first.
  const {LEVELS,GLYPH,esc,safeUrl,stamp,ageLabel}=window.CrucixRecords;

  // ===== Render =====
  // Pure HTML-string builders: no DOM access, every dynamic value escaped, links through safeUrl, times through stamp/ageLabel.
  // They show the records the view gives in the given order; the caller composes filterRecords/sortRecords first.
  // Filter controls carry data-ri-filter="window|search|sort"; ids are prefixed ri- in the inspector and rb- in the browser.
  const PAGE=25,CHIPS=LEVELS.filter(level=>level!=='unknown');
  const STATE_TEXT={ok:'Current',error:'Unavailable',stale:'Expired'};
  const WINDOW_OPTIONS=[[1,'window1h','1 h'],[6,'window6h','6 h'],[24,'window24h','24 h'],[0,'windowAll','All']];
  const SORT_OPTIONS=[['severity','sortSeverity','Severity'],['time','sortTime','Newest'],['title','sortTitle','Title']];
  const obj=value=>value&&typeof value==='object'?value:null;
  const text=value=>typeof value==='string'?value:'';
  const levelOf=rec=>LEVELS.includes(rec.level)?rec.level:'unknown';
  // Anything but ok/error (a missing or unknown state) is treated as expired, like CrucixLiveSources.state.
  const stateOf=source=>source.state==='ok'||source.state==='error'?source.state:'stale';
  const translator=t=>(key,fallback)=>esc(typeof t==='function'?t(key,fallback):fallback);
  const levelName=(tx,level)=>tx('inspector.level.'+level,level[0].toUpperCase()+level.slice(1));
  // Glyph and colour for the eye, the level name for screen readers: colour is never the only signal.
  const glyph=(tx,level)=>`<span class="ri-glyph sev-${level}" aria-hidden="true">${GLYPH[level]}</span><span class="ri-sr">${levelName(tx,level)}</span>`;
  const link=(url,label,cls='')=>{const href=safeUrl(url);return href?`<a${cls?` class="${cls}"`:''} href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`:label;};
  const place=rec=>[rec.place,rec.country].map(text).filter(Boolean).map(esc).join(', ');
  const keys=tx=>`<p class="ri-keys">${tx('inspector.keys','j/k move · Enter details · / search · e expand · Esc close')}</p>`;

  function sourceInfo(source,tx,now,tag,id){
    const state=stateOf(source),rights=[source.attribution,source.rights].map(text).filter(Boolean).map(esc).join(' ');
    const license=text(source.license)?link(source.licenseUrl,esc(source.license)):'';
    const age=`<span class="ri-age" title="${tx('liveSources.providerTime','Provider time')}: ${esc(stamp(source.observedAt))}">${esc(ageLabel(Date.parse(source.observedAt),now))}</span>`;
    return `<div class="ri-source"><${tag} class="ri-name"${id?` id="${id}"`:''}>${link(source.url,esc(source.name))}</${tag}><span class="ri-state ri-state-${state}">${tx('liveSources.'+state,STATE_TEXT[state])}</span>${age}</div>${rights||license?`<small class="ri-attr">${[rights,license].filter(Boolean).join(' · ')}</small>`:''}`;
  }
  // Error and expired sources show why and when they last succeeded, never rows.
  function reason(source,tx){
    const why=stateOf(source)==='error'?tx('liveSources.unavailable','Source unavailable'):tx('liveSources.expired','Provider data expired or its timestamp is unknown. Live records are hidden.');
    return `<div class="ri-reason"><p>${why}</p><p>${tx('inspector.lastSuccess','Last successful update')}: ${esc(stamp(source.observedAt))}</p></div>`;
  }
  function filterBar(filters,tx,id){
    const f=obj(filters)||{},levels=Array.isArray(f.levels)?f.levels:[],hours=Number.isFinite(f.windowHours)?f.windowHours:0,sort=text(f.sort)||'severity';
    const option=(value,selected,label)=>`<option value="${value}"${selected?' selected':''}>${label}</option>`;
    const chips=CHIPS.map(level=>`<button type="button" class="ri-chip" data-ri-level="${level}" aria-pressed="${levels.includes(level)}"><span class="ri-glyph sev-${level}" aria-hidden="true">${GLYPH[level]}</span>${levelName(tx,level)}</button>`).join('');
    const windows=WINDOW_OPTIONS.map(([value,key,fallback])=>option(value,value===hours,tx('inspector.'+key,fallback))).join('');
    const sorts=SORT_OPTIONS.map(([value,key,fallback])=>option(value,value===sort,tx('inspector.'+key,fallback))).join('');
    return `<div class="ri-filters"><div class="ri-chips" role="group" aria-label="${tx('inspector.severity','Severity')}">${chips}</div>`
      +`<label class="ri-field"><span>${tx('inspector.timeWindow','Time window')}</span><select id="${id}-window" data-ri-filter="window">${windows}</select></label>`
      +`<label class="ri-field ri-field-search"><span>${tx('inspector.search','Search records')}</span><input id="${id}-search" data-ri-filter="search" type="search" maxlength="80" autocomplete="off" value="${esc(text(f.text).slice(0,80))}"></label>`
      +`<label class="ri-field"><span>${tx('inspector.sort','Sort')}</span><select id="${id}-sort" data-ri-filter="sort">${sorts}</select></label></div>`;
  }
  function listPart(view,tx,now){
    const recs=(Array.isArray(view.records)?view.records:[]).filter(obj);
    const total=Number.isFinite(view.total)?view.total:recs.length,limit=Number.isFinite(view.limit)&&view.limit>0?view.limit:PAGE;
    const page=recs.slice(0,limit),key=obj(obj(view.selected)?.record)?.key,picked=key===undefined?-1:page.findIndex(rec=>rec.key===key);
    // Roving tabindex: the selected row, or the first one, is the single tab stop.
    const rows=page.map((rec,i)=>{const where=place(rec);return `<li class="ri-row" role="option" data-key="${esc(rec.key)}" aria-selected="${i===picked}" tabindex="${i===Math.max(picked,0)?0:-1}">${glyph(tx,levelOf(rec))}<span class="ri-text"><span class="ri-title">${esc(rec.title)}</span>${where?`<span class="ri-place">${where}</span>`:''}</span><span class="ri-age">${esc(ageLabel(rec.time,now))}</span></li>`;}).join('');
    const list=rows?`<ul class="ri-list" role="listbox" aria-label="${tx('inspector.title','Record inspector')}">${rows}</ul>`
      :`<p class="ri-empty">${total?tx('inspector.noMatch','No records match the filters'):tx('liveSources.noRecords','No current records in the watched scope')}</p>`;
    const more=recs.length>limit?`<button type="button" class="ri-more" data-ri-action="more">${tx('inspector.showMore','Show 25 more')}</button>`:'';
    return list+more+(total?`<p class="ri-count">${page.length} / ${total} ${tx('inspector.shown','shown')}</p>`:'');
  }
  // `outdated` comes from reconcileSelection; rec.current is not consulted.
  function detail(selected,tx){
    const rec=obj(obj(selected)?.record);
    if(!rec)return '<section class="ri-detail" hidden></section>';
    const outdated=selected.outdated===true,level=levelOf(rec),where=place(rec);
    const coords=Number.isFinite(rec.lat)&&Number.isFinite(rec.lon)?rec.lat.toFixed(3)+', '+rec.lon.toFixed(3):'';
    const times=[['providerTime','Provider time',rec.observedAt||rec.publishedAt],['forecastFor','Forecast for',rec.forecastAt],['startsAt','Starts at',rec.startsAt],['validUntil','Valid until',rec.validUntil]]
      .filter(([,,value])=>value).map(([key,fallback,value])=>`<dt>${tx('liveSources.'+key,fallback)}</dt><dd>${esc(stamp(value))}</dd>`).join('');
    const info=times+(text(rec.source)?`<dt>${tx('inspector.sourceLabel','Source')}</dt><dd>${esc(rec.source)}</dd>`:'')
      +(where||coords?`<dt>${tx('inspector.location','Location')}</dt><dd>${[where,coords].filter(Boolean).join(' · ')}</dd>`:'');
    const facts=(Array.isArray(rec.facts)?rec.facts:[]).filter(fact=>text(fact?.label)).slice(0,8)
      .map(fact=>`<dt>${tx('inspector.fact.'+fact.label,fact.label)}</dt><dd>${typeof fact.value==='boolean'?(fact.value?tx('inspector.yes','Yes'):tx('inspector.no','No')):esc(fact.value)}</dd>`).join('');
    const original=safeUrl(rec.url)?`<p>${link(rec.url,tx('liveSources.original','Original source'),'ri-original')}</p>`:'';
    const details=text(rec.eventId)?`<button type="button" class="ri-details" data-ri-action="details" data-event-id="${esc(rec.eventId)}">${tx('inspector.details','Event details')}</button>`:'';
    return `<section class="ri-detail${outdated?' ri-outdated':''}"><h3 class="ri-detail-title">${glyph(tx,level)}<span>${esc(rec.title)}</span></h3>${outdated?`<span class="ri-badge">${tx('inspector.outdated','No longer current')}</span>`:''}`
      +`${text(rec.summary)?`<p class="ri-summary">${esc(rec.summary)}</p>`:''}${info?`<dl class="ri-meta">${info}</dl>`:''}`
      +`${facts?`<h4>${tx('inspector.facts','Facts')}</h4><dl class="ri-facts">${facts}</dl>`:''}${original}${details}</section>`;
  }
  // Waiting (no source yet, e.g. opened from the hash before data), a reason, or filters + list.
  function body(view,source,tx,now,id){
    if(!source&&view.all!==true)return `<p class="ri-empty">${tx('liveSources.waiting','Waiting for the first collection')}</p>`;
    if(source&&stateOf(source)!=='ok')return reason(source,tx);
    return filterBar(view.filters,tx,id)+listPart(view,tx,now);
  }

  // Inner HTML of <aside id="record-inspector">.
  function renderInspector(view,t,now){
    const v=obj(view)||{},tx=translator(t),source=obj(v.source);
    const head=source?sourceInfo(source,tx,now,'h2','ri-heading'):`<h2 class="ri-name" id="ri-heading">${tx('inspector.title','Record inspector')}</h2>`;
    const actions=`<div class="ri-actions"><button type="button" class="ri-icon" data-ri-action="expand" aria-label="${tx('inspector.expand','Expand to full screen')}" title="${tx('inspector.expand','Expand to full screen')}"><span aria-hidden="true">⤢</span></button><button type="button" class="ri-icon" data-ri-action="close" aria-label="${tx('inspector.close','Close')}" title="${tx('inspector.close','Close')}"><span aria-hidden="true">×</span></button></div>`;
    return `<header class="ri-head">${head}${actions}</header>${body({...v,all:false},source,tx,now,'ri')}${detail(v.selected,tx)}${keys(tx)}`;
  }
  // Inner HTML of <dialog id="record-browser">: sources | list | detail. `source` is null when `all`.
  function renderBrowser(view,t,now){
    const v=obj(view)||{},tx=translator(t),all=v.all===true,source=all?null:obj(v.source);
    const pick=(name,label,current)=>`<li><button type="button" class="rb-source" data-ri-source="${esc(name)}"${current?' aria-current="true"':''}>${label}</button></li>`;
    const badges=levels=>CHIPS.filter(level=>Number.isFinite(levels?.[level])&&levels[level]>0).map(level=>`<span class="sev sev-${level}"><i aria-hidden="true">${GLYPH[level]}</i>${levels[level]}<span class="ri-sr"> ${levelName(tx,level)}</span></span>`).join('');
    const sources=(Array.isArray(v.sources)?v.sources:[]).filter(item=>obj(item)&&text(item.name)).map(item=>{const state=stateOf(item);return pick(item.name,`<span class="rb-name">${esc(item.name)}</span><span class="rb-count">${Number.isFinite(item.count)?item.count:0}</span>${state==='ok'?'':`<span class="rb-state">${tx('liveSources.'+state,STATE_TEXT[state])}</span>`}${badges(obj(item.levels))}`,source?.name===item.name);}).join('');
    const head=`<header class="rb-head"><h2 id="rb-heading">${tx('inspector.browserTitle','Record browser')}</h2><div class="ri-actions"><button type="button" class="rb-collapse" data-ri-action="collapse">${tx('inspector.collapse','Back to panel')}</button><button type="button" class="ri-icon" data-ri-action="close" aria-label="${tx('inspector.close','Close')}" title="${tx('inspector.close','Close')}"><span aria-hidden="true">×</span></button></div></header>`;
    const nav=`<nav class="rb-sources" aria-label="${tx('inspector.sourceLabel','Source')}"><ul>${pick('all',`<span class="rb-name">${tx('inspector.allSources','All sources')}</span>`,all)}${sources}</ul></nav>`;
    return `${head}<div class="rb-cols">${nav}<div class="rb-list">${source?sourceInfo(source,tx,now,'h3',''):''}${body({...v,all},source,tx,now,'rb')}</div><div class="rb-detail">${detail(v.selected,tx)}</div></div>${keys(tx)}`;
  }
  // ===== End render =====

  window.CrucixRecordInspector={renderInspector,renderBrowser};
})(window);
