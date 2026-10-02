(function(window){
  'use strict';
  // Needs record-core.js and alerts-core.js (window.CrucixAlertsCore) loaded first.
  const {LEVELS,GLYPH,esc,safeUrl,ageLabel,sortAlerts,groupByRule,titleBadge,newAlertToasts}=window.CrucixAlertsCore;

  // ===== Render =====
  // Pure HTML-string builders: no DOM access, no fetch, no timers; time only from `now`. Every dynamic value is escaped (text
  // and attributes), links go through safeUrl, no inline handlers. Actions are `button[data-alert-action]` with the alert in
  // `data-alert-id`: ack | snooze-menu (toggles the hidden 1 h / 8 h / 24 h group) | snooze (+ data-minutes) | resolve | open |
  // dismiss (toast) | close (tray) | threat | group (+ data-rule-id) | ack-all (+ data-severity) | evidence (+ data-event-id).
  // Tabs are `button[data-alert-tab]`. Element ids the markup refers to: alertTray (aria-controls of the threat badge).
  const RULE_ID=/^[a-z0-9-]{1,40}$/;
  const SNOOZES=[[60,'snooze1h','1 h'],[480,'snooze8h','8 h'],[1440,'snooze24h','24 h']];
  const TABS=[['active','tabActive','Active',['firing']],['handled','tabHandled','Handled',['acked','snoozed']],['resolved','tabResolved','Resolved',['resolved']],['rules','tabRules','Rules',null]];
  const STATE_TEXT={firing:['firing','Firing'],acked:['acked','Acknowledged'],snoozed:['snoozedUntil','Snoozed until'],resolved:['resolvedAt','Resolved']};
  const MAX_EVIDENCE=8;
  const obj=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value:null;
  const text=value=>typeof value==='string'?value:'';
  const list=value=>Array.isArray(value)?value.filter(obj):[];
  const count=value=>Number.isSafeInteger(value)&&value>0?value:0;
  const levelOf=value=>LEVELS.includes(value)?value:'unknown';
  // A translator that never throws and always returns escaped text (t may be missing, throw, or return a non-string).
  const translator=t=>(key,fallback)=>{let value=fallback;try{if(typeof t==='function')value=t(key,fallback);}catch{value=fallback;}return esc(typeof value==='string'&&value?value:fallback);};
  const levelName=(tx,level)=>level==='unknown'?tx('inspector.level.unknown','Unknown'):tx('alerts.level.'+level,level[0].toUpperCase()+level.slice(1));
  // Glyph and colour for the eye, the level name for screen readers: colour is never the only signal.
  const glyph=(tx,level)=>`<span class="ri-glyph sev-${level}" aria-hidden="true">${GLYPH[level]||'–'}</span><span class="ri-sr">${levelName(tx,level)}</span>`;
  // Built-in rule names are English constants on the server: localised by id (alerts.ruleNames.<id>); a rule without a locale
  // key keeps its stored name. Only well-formed rule ids are looked up; a non-string result (e.g. a prototype member such as
  // "constructor") falls back to the stored name in the translator.
  const ruleLabel=(tx,ruleId,ruleName)=>{const id=text(ruleId),name=text(ruleName)||id;return RULE_ID.test(id)?tx('alerts.ruleNames.'+id,name):esc(name);};
  const threatLevel=summary=>{const level=obj(summary.threat)?.level;return Number.isInteger(level)&&level>=1&&level<=5?level:1;};
  // No summary from the server (offline shell, file: page, a snapshot older than the alert engine): nothing is known, so the
  // strip says "unavailable" with a neutral badge instead of a calm level 1.
  const known=summary=>!!obj(summary)&&!!obj(summary.counts)&&!!obj(summary.threat);
  const unknownThreat=tx=>`${tx('alerts.threat','Threat')} –/5`;
  const pad=n=>String(n).padStart(2,'0');
  // Local HH:MM, with the date in front when it is not the day of `now`.
  function when(ms,now){
    const date=Number.isFinite(ms)?new Date(ms):null;
    if(!date||!Number.isFinite(date.getTime()))return '—';
    const day=date.toDateString()===new Date(Number.isFinite(now)?now:NaN).toDateString()?'':`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} `;
    return `<time datetime="${date.toISOString()}">${day}${pad(date.getHours())}:${pad(date.getMinutes())}</time>`;
  }
  const button=(tx,action,id,key,fallback,extra='')=>`<button type="button" class="al-btn" data-alert-action="${action}" data-alert-id="${id}"${extra}>${tx('alerts.'+key,fallback)}</button>`;
  // Snooze ▾ discloses the three lengths; `menuId` is generated, never taken from the data.
  function snoozeControl(tx,id,menuId){
    const lengths=SNOOZES.map(([minutes,key,fallback])=>button(tx,'snooze',id,key,fallback,` data-minutes="${minutes}"`)).join('');
    return `<span class="al-snooze"><button type="button" class="al-btn" data-alert-action="snooze-menu" data-alert-id="${id}" aria-expanded="false" aria-controls="${menuId}">${tx('alerts.snooze','Snooze')} <span aria-hidden="true">▾</span></button>`
      +`<span class="al-snooze-menu" id="${menuId}" role="group" aria-label="${tx('alerts.snooze','Snooze')}" hidden>${lengths}</span></span>`;
  }
  const more=(tx,n)=>`<span class="al-more">+${n} ${tx('alerts.more','more alerts')}</span>`;

  // Inner HTML of #alertStrip. `threatOpen` mirrors the tray's drivers block in aria-expanded.
  function renderStrip(summary,t,now,threatOpen=false){
    const s=obj(summary)||{},tx=translator(t),counts=obj(s.counts)||{},level=threatLevel(s);
    if(!known(s))return `<button type="button" class="as-threat as-threat-0" data-alert-action="threat" aria-expanded="${threatOpen===true}" aria-controls="alertTray">${unknownThreat(tx)}</button><span class="as-calm">${tx('alerts.unavailable','Alerts unavailable')}</span>`;
    const threat=`<button type="button" class="as-threat as-threat-${level}" data-alert-action="threat" aria-expanded="${threatOpen===true}" aria-controls="alertTray">${tx('alerts.threat','Threat')} ${level}/5</button>`;
    const firing=LEVELS.reduce((sum,name)=>sum+count(counts[name]),0),top=sortAlerts(s.top).find(alert=>alert.state==='firing'&&text(alert.id));
    if(!firing&&!top)return `${threat}<span class="as-calm">${tx('alerts.calm','No active alerts')} · ${tx('alerts.lastEval','Last evaluation')} ${when(s.lastEvaluatedAt,now)}</span>`;
    const counters=LEVELS.filter(name=>count(counts[name])).map(name=>`<span class="sev as-count sev-${name}"><i aria-hidden="true">${GLYPH[name]}</i>${counts[name]}<span class="ri-sr"> ${levelName(tx,name)}</span></span>`).join('');
    let lead='';
    if(top){
      const id=esc(top.id);
      lead=`<span class="as-top">${glyph(tx,levelOf(top.severity))}<span class="as-title">${esc(top.title)}</span><span class="as-age">${esc(ageLabel(top.firstSeenAt,now))}</span></span>`
        +(firing>1?more(tx,firing-1):'')
        +`<span class="as-actions">${button(tx,'ack',id,'ack','Acknowledge')}${snoozeControl(tx,id,'as-snooze')}${button(tx,'open',id,'open','Open')}</span>`;
    }
    return `${threat}<span class="as-counts">${counters}</span>${lead}`;
  }

  function evidenceItem(item){
    const id=text(item.id),title=text(item.title),source=text(item.source)?`<span class="at-source">${esc(item.source)}</span>`:'';
    if(id)return `<li><button type="button" class="at-evidence-link" data-alert-action="evidence" data-event-id="${esc(id)}">${esc(title||id)}</button>${source}</li>`;
    const href=safeUrl(item.url);
    if(href)return `<li><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(title||href)} ↗</a>${source}</li>`;
    return title?`<li>${esc(title)}${source}</li>`:'';
  }
  // When the alert entered its state: firing shows only the word, the others their time (and a snooze its reason).
  function stateLine(tx,alert,now){
    const state=Object.hasOwn(STATE_TEXT,text(alert.state))?alert.state:'firing',[key,fallback]=STATE_TEXT[state];
    const at=state==='acked'?obj(alert.ack)?.at:state==='snoozed'?obj(alert.snooze)?.until:state==='resolved'?alert.resolvedAt:null;
    const reason=state==='snoozed'?text(obj(alert.snooze)?.reason):'';
    return `<span class="at-state at-state-${state}">${tx('alerts.'+key,fallback)}${state==='firing'?'':' '+when(at,now)}${reason?` · ${esc(reason)}`:''}</span>`;
  }
  function alertRow(tx,alert,now,menuId){
    const id=esc(alert.id),level=levelOf(alert.severity),resolved=alert.state==='resolved',n=count(alert.count);
    const evidence=list(alert.evidence).slice(0,MAX_EVIDENCE).map(evidenceItem).join('');
    const actions=resolved?'':`<div class="at-actions">${alert.state==='acked'?'':button(tx,'ack',id,'ack','Acknowledge')}${snoozeControl(tx,id,menuId)}${button(tx,'resolve',id,'resolve','Resolve')}</div>`;
    return `<li class="at-alert at-${level}" data-alert-id="${id}">${glyph(tx,level)}<div class="at-body"><p class="at-title">${esc(alert.title)}</p>`
      +`<p class="at-meta"><span class="at-rule"><span class="ri-sr">${tx('alerts.rule','Rule')}: </span>${ruleLabel(tx,alert.ruleId,alert.ruleName)}</span><span class="at-age">${esc(ageLabel(alert.firstSeenAt,now))}</span>${n?`<span class="at-count">${tx('alerts.count','seen')} ${n}×</span>`:''}</p>`
      +`<p class="at-status">${stateLine(tx,alert,now)}${alert.silent===true?`<span class="at-badge">${tx('alerts.silent','Initial baseline')}</span>`:''}</p>`
      +`${text(alert.summary)?`<p class="at-summary">${esc(alert.summary)}</p>`:''}`
      +`${evidence?`<div class="at-evidence"><span class="at-label">${tx('alerts.evidence','Evidence')}</span><ul>${evidence}</ul></div>`:''}${actions}</div></li>`;
  }
  // Rule groups (more than five alerts collapse behind a toggle) and the "+N more" held back by the engine's caps.
  function alertList(tx,alerts,v,s,now,tab){
    const expanded=Array.isArray(v.expandedGroups)?v.expandedGroups:[],held=new Map();
    if(tab==='active')for(const row of list(s.overflow))if(text(row.ruleId)&&count(row.count))held.set(row.ruleId,row.count);
    let menus=0;
    const rows=group=>group.alerts.map(alert=>alertRow(tx,alert,now,'at-snooze-'+(menus++))).join('');
    const items=groupByRule(alerts).map(group=>{
      const name=ruleLabel(tx,group.ruleId,group.ruleName),extra=held.has(group.ruleId)?more(tx,held.get(group.ruleId)):'';
      held.delete(group.ruleId);
      if(!group.grouped)return rows(group)+(extra?`<li class="at-overflow"><span class="at-rule">${name}</span>${extra}</li>`:'');
      const open=expanded.includes(group.ruleId),lead=levelOf(group.alerts[0].severity);
      return `<li class="at-group"><div class="at-group-head"><button type="button" class="at-group-toggle" data-alert-action="group" data-rule-id="${esc(group.ruleId)}" aria-expanded="${open}">${glyph(tx,lead)}<span class="at-group-name">${name}</span><span class="at-group-count">${group.alerts.length}</span><span class="at-caret" aria-hidden="true">${open?'▾':'▸'}</span></button>${extra}</div>`
        +`${open?`<ul class="at-group-list">${rows(group)}</ul>`:''}</li>`;
    });
    // Rules whose every hit was held back still say so.
    for(const [ruleId,n] of held)items.push(`<li class="at-overflow"><span class="at-rule">${ruleLabel(tx,ruleId,ruleId)}</span>${more(tx,n)}</li>`);
    return items.length?`<ul class="at-list">${items.join('')}</ul>`:`<p class="at-empty">${tx('alerts.empty','Nothing here')}</p>`;
  }
  function ackAll(tx,alerts){
    const levels=LEVELS.filter(level=>alerts.some(alert=>alert.severity===level));
    const label=tx('alerts.ackAll','Acknowledge all');
    return `<div class="at-bulk" role="group" aria-label="${label}"><button type="button" class="al-btn" data-alert-action="ack-all">${label}</button>`
      +levels.map(level=>`<button type="button" class="al-btn" data-alert-action="ack-all" data-severity="${level}" aria-label="${label}: ${levelName(tx,level)}"><span class="sev-${level}" aria-hidden="true">${GLYPH[level]}</span> ${levelName(tx,level)}</button>`).join('')+'</div>';
  }
  // Why the threat level is what it is: the firing alerts that drive it (at most five, from the summary). A driver carries
  // data-driver-id, not data-alert-id, so a lookup of an alert row never lands on it. Its rule name comes from the alert list,
  // else from summary.top, before the bare rule id is shown.
  function drivers(tx,s,alerts){
    const level=threatLevel(s),names=new Map();
    for(const alert of [...alerts,...list(s.top)])if(text(alert.id)&&text(alert.ruleName)&&!names.has(alert.id))names.set(alert.id,alert.ruleName);
    const rows=list(obj(s.threat)?.drivers).map(driver=>`<li data-driver-id="${esc(driver.alertId)}">${glyph(tx,levelOf(driver.severity))}<span class="at-driver-title">${esc(driver.title)}</span><span class="at-rule">${ruleLabel(tx,driver.ruleId,names.get(driver.alertId))}</span></li>`).join('');
    const ok=known(s);
    return `<section class="at-drivers" aria-labelledby="at-drivers-heading"><h3 id="at-drivers-heading">${tx('alerts.drivers','Driving this level')} · ${ok?`${tx('alerts.threat','Threat')} ${level}/5`:unknownThreat(tx)}</h3>`
      +(rows?`<ul>${rows}</ul>`:`<p class="at-empty">${ok?tx('alerts.calm','No active alerts'):tx('alerts.unavailable','Alerts unavailable')}</p>`)+'</section>';
  }

  // The Rules tab's content comes from the rule editor (alert-rules.js, loaded after this file): without it, or without a view
  // of its own, the tab is an empty div.at-rules.
  function rulesPanel(rules,t){
    const editor=window.CrucixAlertRules;
    if(!obj(rules)||typeof editor?.renderRules!=='function')return '';
    try{return editor.renderRules(rules,t);}catch(error){log(error);return '';}
  }
  // Inner HTML of #alertTray. view = {tab, alerts, summary, expandedGroups: string[], threatOpen: boolean, rules}; the alerts of
  // every state may be given, each tab shows its own. `rules` is the rule editor's view (CrucixAlertRules.view()).
  function renderTray(view,t,now){
    const v=obj(view)||{},tx=translator(t),s=obj(v.summary)||{},tab=TABS.some(([id])=>id===v.tab)?v.tab:'active';
    const all=sortAlerts(v.alerts).filter(alert=>text(alert.id));
    const inTab=states=>all.filter(alert=>states.includes(alert.state));
    const tabs=TABS.map(([id,key,fallback,states])=>`<button type="button" role="tab" class="at-tab" id="at-tab-${id}" data-alert-tab="${id}" aria-selected="${id===tab}" aria-controls="at-panel" tabindex="${id===tab?0:-1}">${tx('alerts.'+key,fallback)}${states?` <span class="at-tab-count">${inTab(states).length}</span>`:''}</button>`).join('');
    const states=TABS.find(([id])=>id===tab)[3],shown=states?inTab(states):[];
    const panel=states?(tab==='active'&&shown.length?ackAll(tx,shown):'')+alertList(tx,shown,v,s,now,tab):`<div class="at-rules">${rulesPanel(v.rules,t)}</div>`;
    const close=tx('alerts.close','Close');
    return `<header class="at-head"><h2 id="at-heading">${tx('alerts.title','Alerts')}</h2><button type="button" class="ri-icon" data-alert-action="close" aria-label="${close}" title="${close}"><span aria-hidden="true">×</span></button></header>`
      +(v.threatOpen===true?drivers(tx,s,all):'')
      +`<div class="at-tabs" role="tablist" aria-labelledby="at-heading">${tabs}</div><div class="at-panel" id="at-panel" role="tabpanel" aria-labelledby="at-tab-${tab}" tabindex="0">${panel}</div>`;
  }

  // One toast: critical interrupts (role="alert"), high is polite (role="status"). No timer: it stays until acknowledged or closed.
  function renderToast(alert,t){
    const a=obj(alert);
    if(!a||!text(a.id))return '';
    const tx=translator(t),id=esc(a.id),level=levelOf(a.severity),close=tx('alerts.close','Close');
    return `<div class="al-toast al-toast-${level}" role="${level==='critical'?'alert':'status'}" data-alert-id="${id}"><div class="al-toast-body"><p class="al-toast-kicker">${tx('alerts.toastNew','New alert')}</p>`
      +`<p class="al-toast-title">${glyph(tx,level)}<span>${esc(a.title)}</span></p><p class="al-toast-rule">${ruleLabel(tx,a.ruleId,a.ruleName)}</p>`
      +`<div class="al-toast-actions">${button(tx,'ack',id,'ack','Acknowledge')}${button(tx,'open',id,'open','Open')}</div></div>`
      +`<button type="button" class="ri-icon al-toast-close" data-alert-action="dismiss" data-alert-id="${id}" aria-label="${close}" title="${close}"><span aria-hidden="true">×</span></button></div>`;
  }
  // ===== End render =====

  // ===== Controller =====
  // Thin DOM layer: #alertStrip between the top bar and the grid, the bell in the top bar (renderTopbar calls bell()), the
  // non-modal #alertTray and the #alertToasts stack (body children). The summary comes from snapshots and SSE (update), the
  // tray's list from GET /api/alerts. File pages and the offline shell are read-only: summary only, no request, no actions.
  // Every entry point catches its own errors: an alert failure never stops the dashboard.
  const ALERT_ID=/^alert-[0-9a-f]{32}$/,EVENT_ID=/^event-[0-9a-f]{32}$/,TAB_IDS=TABS.map(([id])=>id),MAX_TOASTS=3,SCROLLERS=['.at-panel','.at-drivers'];
  // A summary this much older than the one shown means the server clock went back (not a late, stale answer).
  const CLOCK_RESET_MS=5*60000;
  // Refusals of the origin check (http-security.mjs): the page is open at an address the server does not take changes from.
  const ORIGIN_CODES=['CROSS_ORIGIN','HOST_NOT_ALLOWED'],ORIGIN_TEXT='Refused at this address: open the dashboard at its ALERT_PUBLIC_URL address, or set ALERT_PUBLIC_URL or ALERT_ALLOWED_HOSTS on the server';
  const FOCUS_ATTRS=['data-alert-action','data-alert-id','data-minutes','data-severity','data-rule-id','data-event-id','data-rule-action','data-rule-toggle'];
  const BELL='<svg class="al-bell-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><path d="M8 1.75a4 4 0 0 0-4 4v2.5l-1.25 2.5h10.5L12 8.25v-2.5a4 4 0 0 0-4-4zM6.5 12.75a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  let opts={},strip=null,tray=null,toasts=null,announcer=null,errorLive=null,summary={},alerts=[],loaded=false,primed=false,readOnly=false;
  let tab='active',threatOpen=false,expandedGroups=[],notice=null,opener=null,loadSeq=0,loadTimer=null,speakTimer=0,lastLevel=0;
  const seen=new Set(),busy=new Set();
  const log=error=>{try{console.error('[alerts]',error);}catch{}};
  const guarded=fn=>(...args)=>{try{return fn(...args);}catch(error){log(error);}};
  const clock=()=>{let value=NaN;try{value=typeof opts.now==='function'?opts.now():NaN;}catch{}return Number.isFinite(value)?value:Date.now();};
  // Unescaped text for textContent and attributes set through the DOM.
  const say=(key,fallback)=>{try{const value=typeof opts.t==='function'?opts.t(key,fallback):fallback;return typeof value==='string'&&value?value:fallback;}catch{return fallback;}};
  const firingCount=s=>LEVELS.reduce((sum,level)=>sum+count(obj(s.counts)?.[level]),0);
  const bellCount=()=>known(summary)?String(firingCount(summary)):'–';
  // A summary as the server builds it: anything else never replaces the one shown.
  const validSummary=value=>{const s=obj(value);return s&&obj(s.counts)&&obj(s.threat)?s:null;};
  const trayOpen=()=>!!tray&&!tray.hidden;
  const attr=(node,name)=>node?.getAttribute?.(name)||'';
  const make=(tag,id)=>{const node=document.createElement(tag);node.id=id;return node;};

  // Re-render one container, keeping scroll positions, an open snooze menu and the focused control.
  function focusKey(node){
    if(!node)return null;
    if(node.id)return '#'+CSS.escape(node.id);
    const parts=FOCUS_ATTRS.filter(name=>node.hasAttribute(name)).map(name=>`[${name}="${CSS.escape(node.getAttribute(name))}"]`);
    return parts.length?String(node.tagName||'').toLowerCase()+parts.join(''):null;
  }
  function setMenu(toggle,open){
    const menu=toggle?.closest?.('.al-snooze')?.querySelector('.al-snooze-menu');
    if(!menu)return;
    toggle.setAttribute('aria-expanded',String(open));menu.hidden=!open;
  }
  const openToggles=()=>[strip,tray].flatMap(root=>root?[...root.querySelectorAll('[data-alert-action="snooze-menu"][aria-expanded="true"]')]:[]);
  function paint(el,html,fallback){
    const active=el.contains(document.activeElement)?document.activeElement:null,key=focusKey(active);
    const caret=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
    const menu=attr(el.querySelector('[data-alert-action="snooze-menu"][aria-expanded="true"]'),'data-alert-id');
    const scroll=SCROLLERS.map(selector=>el.querySelector(selector)?.scrollTop||0);
    el.innerHTML=html;
    if(menu)setMenu(el.querySelector(`[data-alert-action="snooze-menu"][data-alert-id="${CSS.escape(menu)}"]`),true);
    SCROLLERS.forEach((selector,i)=>{const node=el.querySelector(selector);if(node&&scroll[i])node.scrollTop=scroll[i];});
    if(!active)return;
    const target=(key&&el.querySelector(key))||el.querySelector(fallback);
    target?.focus({preventScroll:true});
    // A text field keeps its caret (the rule editor's form is redrawn by live updates).
    if(caret&&typeof target?.setSelectionRange==='function')try{target.setSelectionRange(caret[0],caret[1]);}catch{}
  }
  // A failure is drawn without a role (redraws would repeat it) and spoken once through the persistent #alertError node.
  const noticeHtml=tag=>notice?`<${tag} class="al-notice">${translator(opts.t)(notice.key,notice.fallback)}</${tag}>`:'';
  function fail(where,key,fallback,always){
    const repeat=notice?.where===where&&notice.key===key;
    notice={where,key,fallback};
    if(!errorLive||(repeat&&!always))return;
    // Emptied first, so the same message twice in a row is spoken twice.
    const message=say(key,fallback);errorLive.textContent='';clearTimeout(speakTimer);
    speakTimer=setTimeout(()=>{errorLive.textContent=message;},50);
  }
  // Every place a notice goes away: the visible text, the persistent live region and an announcement still pending.
  function clearNotice(){notice=null;clearTimeout(speakTimer);if(errorLive)errorLive.textContent='';}
  function drawStrip(){
    if(!strip)return;
    paint(strip,renderStrip(summary,opts.t,clock(),threatOpen&&trayOpen())+(notice?.where==='strip'?noticeHtml('span'):''),'.as-threat');
  }
  function drawTray(){
    if(!trayOpen())return;
    const rules=tab==='rules'?window.CrucixAlertRules?.view?.():undefined;
    const html=renderTray({tab,alerts:loaded?alerts:list(summary.top),summary,expandedGroups,threatOpen,rules},opts.t,clock()),cut=html.indexOf('</header>')+9;
    paint(tray,notice?.where==='tray'?html.slice(0,cut)+noticeHtml('p')+html.slice(cut):html,'#at-panel');
    dockTray();
  }
  // The tray starts below the strip while the strip is on screen (the page scrolls it away), like the record inspector.
  function dockTray(){if(trayOpen()&&strip)tray.style.setProperty('--at-top',Math.max(0,Math.round(strip.getBoundingClientRect().bottom||0))+'px');}
  function syncBell(){
    const node=document.getElementById('alertBell');if(!node)return;
    node.setAttribute('class','guide-btn al-bell al-bell-'+threatLevel(summary));node.setAttribute('aria-expanded',String(trayOpen()));
    const n=node.querySelector('.al-bell-count');if(n)n.textContent=bellCount();
  }
  function syncTitle(){const base=String(document.title).replace(/^\(\d+\) /,''),next=titleBadge(summary)+base;if(document.title!==next)document.title=next;}
  // The strip's live region: a change of the threat level is spoken once (the strip itself is re-rendered too often to be live).
  function announce(){const level=threatLevel(summary);if(announcer&&lastLevel&&level!==lastLevel)announcer.textContent=`${say('alerts.threat','Threat')} ${level}/5`;lastLevel=level;}

  // Toasts: firing critical/high alerts not seen in this session that were first seen after the summary shown before
  // (`since`). summary.top holds only five alerts, so an old alert that moves up into it (another one was acknowledged, a
  // snooze ran out) is not new. Whatever fires at the first summary (or at a clock reset: since Infinity) counts as seen. At
  // most three, the oldest leaves first.
  function toast(since){
    const after=Number.isFinite(since)||since===Infinity?since:-Infinity;
    const fresh=primed?newAlertToasts(summary,seen).filter(alert=>Number.isFinite(alert.firstSeenAt)&&alert.firstSeenAt>after):[];
    for(const alert of list(summary.top))if(text(alert.id))seen.add(alert.id);
    primed=true;
    for(const alert of fresh)toasts.insertAdjacentHTML('beforeend',renderToast(alert,opts.t));
    const stack=[...toasts.querySelectorAll('.al-toast')];
    stack.slice(0,Math.max(0,stack.length-MAX_TOASTS)).forEach(removeToast);
  }
  // A toast that leaves with the focus in it hands the focus to the bell.
  function removeToast(node){
    if(node.contains(document.activeElement))document.getElementById('alertBell')?.focus();
    node.remove();
  }
  function dropToasts(selector){for(const node of toasts?[...toasts.querySelectorAll(selector)]:[])removeToast(node);}
  const dropToast=id=>dropToasts(`.al-toast[data-alert-id="${CSS.escape(id)}"]`);

  // Requests: same origin, JSON both ways, 10 s deadline. Every method but GET sends Content-Type: application/json, DELETE
  // too (the server refuses any other shape for a change); the body is optional. The answer must be a JSON object: an HTML
  // login page or other garbage behind a 2xx is a failure. Also CrucixAlerts.request(url, body, method) for the rule editor.
  // A refused request keeps what the server said ({error, code, field}: plain text, never markup) for the caller.
  function httpError(status,data){
    const failure=new Error('HTTP '+status),body=obj(data)||{};
    failure.status=status;failure.code=text(body.code);failure.field=text(body.field);failure.detail=text(body.error);
    return failure;
  }
  async function request(url,body,method){
    if(readOnly)throw new Error('Read-only');
    const verb=typeof method==='string'?method.toUpperCase():body===undefined?'GET':'POST';
    if(!['GET','POST','PUT','DELETE'].includes(verb))throw new Error('Unsupported method');
    const init={method:verb,credentials:'same-origin',headers:{Accept:'application/json'}};
    if(verb!=='GET'){init.headers['Content-Type']='application/json';if(body!==undefined)init.body=JSON.stringify(body);}
    let data;
    if(typeof opts.fetchJson==='function')data=await opts.fetchJson(url,init);
    else{
      if(typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function')init.signal=AbortSignal.timeout(10000);
      const response=await fetch(url,{cache:'no-store',...init});
      data=await response.json().catch(()=>null);
      if(!response.ok)throw httpError(response.status,data);
    }
    if(!obj(data))throw new Error('Not a JSON object');
    return data;
  }
  // The tray's list: every state in one request (the tab counts are those of the fetched alerts). Its ids count as seen.
  async function load(){
    if(readOnly||!trayOpen())return;
    const seq=++loadSeq;
    try{
      const data=await request('/api/alerts?state=all&limit=200');
      if(!Array.isArray(data.alerts))throw new Error('No alert list');
      if(seq!==loadSeq)return;
      alerts=list(data.alerts);loaded=true;
      if(notice?.key==='alerts.errorLoad')clearNotice();
      for(const alert of alerts){if(!text(alert.id))continue;seen.add(alert.id);if(alert.state!=='firing')dropToast(alert.id);}
    }catch(error){
      if(seq!==loadSeq)return;
      fail('tray','alerts.errorLoad','Could not load alerts',false);
    }
    drawTray();
  }
  function scheduleLoad(){if(readOnly||!trayOpen())return;clearTimeout(loadTimer);loadTimer=setTimeout(guarded(load),150);}
  // A change: the response carries the summary after it; a failure is shown where the operator is looking.
  async function act(path,body,drop){
    if(readOnly||busy.has(path))return;
    busy.add(path);
    try{
      const data=await request('/api/alerts/'+path,body);
      clearNotice();drop?.();
      if(!update(data.summary)){drawStrip();drawTray();}
      scheduleLoad();
    }catch(error){
      const origin=ORIGIN_CODES.includes(error?.code);
      fail(trayOpen()?'tray':'strip',origin?'alerts.errorOrigin':'alerts.errorAction',origin?ORIGIN_TEXT:'Action failed',true);
      drawStrip();drawTray();
    }finally{busy.delete(path);}
  }

  function rememberOpener(node){opener=node?{node,key:focusKey(node),inStrip:!!strip?.contains(node)}:null;}
  function restoreOpener(){
    const {node,key,inStrip}=opener||{};
    const target=node?.isConnected?node:(key&&(inStrip?strip:document).querySelector(key))||document.getElementById('alertBell');
    target?.focus?.();
  }
  // The alert's first action (its evidence links come before them in the row), else the selected tab.
  const focusRow=id=>{const row=id?tray.querySelector(`.at-alert[data-alert-id="${CSS.escape(id)}"]`):null;(row?.querySelector('.at-actions button')||row?.querySelector('button')||tray.querySelector('.at-tab[aria-selected="true"]'))?.focus();};
  // Opening focuses the alert asked for, else the selected tab; the list is (re)loaded each time.
  function open({focusId='',threat=false,from=null}={}){
    if(!tray)return;
    if(!trayOpen()){rememberOpener(from||document.activeElement);tray.hidden=false;tray.setAttribute('aria-hidden','false');}
    if(focusId)tab='active';
    threatOpen=threat;
    drawTray();drawStrip();syncBell();focusRow(focusId);
    if(tab==='rules')window.CrucixAlertRules?.activate?.();
    if(!readOnly)load().then(()=>{if(focusId&&trayOpen()&&attr(document.activeElement?.closest?.('.at-alert'),'data-alert-id')!==focusId)focusRow(focusId);}).catch(log);
  }
  // focus: 'return' (Esc, × : back to the opener), 'inside' (the bell: only when the focus was in the tray), 'none' (another
  // panel takes over and places the focus itself).
  function close(focus='return'){
    if(!trayOpen())return;
    const inside=tray.contains(document.activeElement);
    tray.hidden=true;tray.setAttribute('aria-hidden','true');threatOpen=false;
    if(notice?.where==='tray')clearNotice();
    for(const toggle of openToggles())setMenu(toggle,false);
    drawStrip();syncBell();
    if(focus==='return'||(focus==='inside'&&inside))restoreOpener();
    opener=null;
  }
  function selectTab(id,focus){
    if(!TAB_IDS.includes(id))return;
    tab=id;drawTray();
    // The Rules tab reads the rules (and the metric values) each time it is shown.
    if(id==='rules')window.CrucixAlertRules?.activate?.();
    if(focus)tray.querySelector('#at-tab-'+id)?.focus();
  }

  function onClick(event){
    let node=event.target?.closest?.('[data-alert-action],[data-alert-tab]');if(!node)return;
    const root=event.currentTarget;
    // The next click in the alert UI clears an action failure (a load failure stays until a load succeeds). The redraw replaces
    // the clicked node: the handlers below act on the one that took its place.
    if(notice&&notice.key!=='alerts.errorLoad'){const where=notice.where,key=focusKey(node);clearNotice();if(where==='strip')drawStrip();else drawTray();node=(key&&root.querySelector?.(key))||node;}
    if(node.hasAttribute('data-alert-tab'))return selectTab(attr(node,'data-alert-tab'));
    const action=attr(node,'data-alert-action'),id=attr(node,'data-alert-id'),valid=ALERT_ID.test(id);
    if(action!=='snooze-menu')for(const toggle of openToggles())if(action!=='snooze'||!toggle.closest?.('.al-snooze')?.contains(node))setMenu(toggle,false);
    if(action==='ack'&&valid)act(id+'/ack',{},()=>dropToast(id));
    else if(action==='snooze'&&valid)act(id+'/snooze',{minutes:Number(attr(node,'data-minutes'))},()=>dropToast(id));
    else if(action==='resolve'&&valid)act(id+'/resolve',{},()=>dropToast(id));
    else if(action==='ack-all'){const severity=attr(node,'data-severity');act('ack-all',LEVELS.includes(severity)?{severity}:{},()=>dropToasts(LEVELS.includes(severity)?'.al-toast-'+severity:'.al-toast'));}
    else if(action==='snooze-menu'){const opening=attr(node,'aria-expanded')!=='true';for(const toggle of openToggles())setMenu(toggle,false);setMenu(node,opening);}
    else if(action==='open'&&valid){open({focusId:id,from:root===toasts?null:node});if(root===toasts)dropToast(id);}
    else if(action==='threat'){if(!trayOpen())open({threat:true,from:node});else{threatOpen=!threatOpen;drawTray();drawStrip();}}
    else if(action==='group'){const rule=attr(node,'data-rule-id');expandedGroups=expandedGroups.includes(rule)?expandedGroups.filter(item=>item!==rule):[...expandedGroups,rule];drawTray();}
    else if(action==='evidence'){const eventId=attr(node,'data-event-id');if(EVENT_ID.test(eventId))window.CrucixIntelligence?.openEvent(eventId);}
    else if(action==='dismiss'&&id)dropToast(id);
    else if(action==='close')close('return');
  }
  // Esc closes an open snooze menu first, then the tray (focus back to the opener); arrows move along the tabs.
  function onKey(event){
    if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey)return;
    const root=event.currentTarget,key=event.key;
    if(key==='Escape'){
      const toggle=root.querySelector('[data-alert-action="snooze-menu"][aria-expanded="true"]');
      if(toggle){event.preventDefault();setMenu(toggle,false);toggle.focus();}
      else if(root===tray){event.preventDefault();close('return');}
      return;
    }
    const current=event.target?.closest?.('[data-alert-tab]');
    if(root!==tray||!current||!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;
    event.preventDefault();
    const i=TAB_IDS.indexOf(attr(current,'data-alert-tab')),n=TAB_IDS.length;
    selectTab(TAB_IDS[key==='Home'?0:key==='End'?n-1:(i+(key==='ArrowRight'?1:-1)+n)%n],true);
  }
  // A click elsewhere closes an open snooze menu; the bell toggles the tray (it is re-created with the top bar).
  function onDocumentClick(event){
    const target=event.target;
    if(!target?.closest?.('.al-snooze'))for(const toggle of openToggles())setMenu(toggle,false);
    const bell=target?.closest?.('#alertBell');
    if(bell){if(trayOpen())close('inside');else open({from:bell});}
  }

  // The bell for the top bar: the firing count, coloured by the threat level. Empty before mount.
  function bell(){
    try{
      if(!strip)return '';
      return `<button type="button" class="guide-btn al-bell al-bell-${threatLevel(summary)}" id="alertBell" aria-controls="alertTray" aria-expanded="${trayOpen()}">${BELL}${translator(opts.t)('alerts.title','Alerts')} <span class="al-bell-count">${bellCount()}</span></button>`;
    }catch(error){log(error);return '';}
  }
  // A new summary (snapshot, SSE `alerts`, action response). An older one than shown (by up to 5 minutes), or one without
  // counts and threat, is ignored; true when applied. One more than 5 minutes older means the server clock went back: it is
  // applied, and like the first summary it is the new baseline (what fires in it does not toast). It also clears a failure
  // shown in the strip.
  function update(next){
    try{
      const s=validSummary(next);
      if(!strip||!s)return false;
      const age=Number.isFinite(summary.generatedAt)&&Number.isFinite(s.generatedAt)?summary.generatedAt-s.generatedAt:0;
      if(age>0&&age<=CLOCK_RESET_MS)return false;
      const since=age>CLOCK_RESET_MS?Infinity:summary.generatedAt;
      summary=s;
      if(notice?.where==='strip')clearNotice();
      toast(since);drawStrip();syncBell();syncTitle();announce();
      if(trayOpen()){drawTray();scheduleLoad();}
      return true;
    }catch(error){log(error);return false;}
  }
  // Once, before the first top bar render: getSummary() -> D.alerts, t(key, fallback), now() -> ms.
  function mount(options){
    if(strip)return;
    try{
      const bar=document.getElementById('topbar');if(!bar)return;
      opts=obj(options)||{};
      readOnly=location.protocol==='file:'||!!window.__CRUCIX_OFFLINE_SHELL__||(typeof fetch!=='function'&&typeof opts.fetchJson!=='function');
      strip=make('div','alertStrip');strip.setAttribute('role','region');strip.setAttribute('aria-label',say('alerts.strip','Alert summary'));
      announcer=make('p','alertAnnounce');announcer.className='ri-sr';announcer.setAttribute('role','status');announcer.setAttribute('aria-live','polite');
      tray=make('aside','alertTray');tray.hidden=true;tray.setAttribute('aria-hidden','true');tray.setAttribute('role','region');tray.setAttribute('aria-labelledby','at-heading');
      errorLive=make('p','alertError');errorLive.className='ri-sr';errorLive.setAttribute('role','alert');
      toasts=make('div','alertToasts');
      for(const node of [strip,tray,toasts]){node.classList.toggle('al-readonly',readOnly);node.addEventListener('click',guarded(onClick));node.addEventListener('keydown',guarded(onKey));}
      bar.after(strip);document.body.append(tray,toasts,announcer,errorLive);
      window.CrucixAlertRules?.attach?.({root:tray,t:opts.t,redraw:drawTray,readOnly});
      document.addEventListener('click',guarded(onDocumentClick));
      // The page scrolls <body>, whose scroll events do not bubble: listen in the capture phase.
      document.addEventListener('scroll',event=>{if(!tray.contains(event.target))guarded(dockTray)();},{capture:true,passive:true});
      if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(guarded(dockTray));observer.observe(bar);observer.observe(strip);}
      window.addEventListener('resize',guarded(dockTray));
      // Ages ("12m") move on between sweeps.
      setInterval(guarded(drawStrip),60000);
      let initial=null;try{initial=validSummary(opts.getSummary?.());}catch(error){log(error);}
      if(initial){summary=initial;toast();}
      drawStrip();syncTitle();lastLevel=threatLevel(summary);
    }catch(error){log(error);}
  }
  // ===== End controller =====

  // close({focus:false}) hides the tray without moving the focus (the record inspector opening over it places its own).
  window.CrucixAlerts={renderStrip,renderTray,renderToast,mount,update,bell,request:(url,body,method)=>request(url,body,method),
    open:guarded(options=>open(obj(options)||{})),close:guarded(options=>close(obj(options)?.focus===false?'none':'return'))};
})(window);
