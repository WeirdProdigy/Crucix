(function(window){
  'use strict';
  // Needs record-core.js and alerts-core.js (window.CrucixAlertsCore) loaded first.
  const {LEVELS,GLYPH,esc,safeUrl,ageLabel,sortAlerts,groupByRule}=window.CrucixAlertsCore;

  // ===== Render =====
  // Pure HTML-string builders: no DOM access, no fetch, no timers; time only from `now`. Every dynamic value is escaped (text
  // and attributes), links go through safeUrl, no inline handlers. Actions are `button[data-alert-action]` with the alert in
  // `data-alert-id`: ack | snooze-menu (toggles the hidden 1 h / 8 h / 24 h group) | snooze (+ data-minutes) | resolve | open |
  // dismiss (toast) | close (tray) | threat | group (+ data-rule-id) | ack-all (+ data-severity) | evidence (+ data-event-id).
  // Tabs are `button[data-alert-tab]`. Element ids the markup refers to: alertTray (aria-controls of the threat badge).
  const BUILTIN_RULES=new Set(['events-critical','events-high','convergence-default','source-stale','vix-spike','hy-spread-wide','delta-critical','hungary-region']);
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
  // Built-in rule names are English constants on the server: localised by id, other names shown as stored.
  const ruleLabel=(tx,ruleId,ruleName)=>{const id=text(ruleId),name=text(ruleName)||id;return BUILTIN_RULES.has(id)?tx('alerts.ruleNames.'+id,name):esc(name);};
  const threatLevel=summary=>{const level=obj(summary.threat)?.level;return Number.isInteger(level)&&level>=1&&level<=5?level:1;};
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
      return `<li class="at-group"><div class="at-group-head"><button type="button" class="at-group-toggle" data-alert-action="group" data-rule-id="${esc(group.ruleId)}" aria-expanded="${open}">${glyph(tx,lead)}<span class="at-group-name">${name}</span><span class="at-group-count">${group.alerts.length}</span></button>${extra}</div>`
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
  // Why the threat level is what it is: the firing alerts that drive it (at most five, from the summary).
  function drivers(tx,s,alerts){
    const level=threatLevel(s),names=new Map(alerts.map(alert=>[alert.id,alert.ruleName]));
    const rows=list(obj(s.threat)?.drivers).map(driver=>`<li data-alert-id="${esc(driver.alertId)}">${glyph(tx,levelOf(driver.severity))}<span class="at-driver-title">${esc(driver.title)}</span><span class="at-rule">${ruleLabel(tx,driver.ruleId,names.get(driver.alertId))}</span></li>`).join('');
    return `<section class="at-drivers" aria-labelledby="at-drivers-heading"><h3 id="at-drivers-heading">${tx('alerts.drivers','Driving this level')} · ${tx('alerts.threat','Threat')} ${level}/5</h3>`
      +(rows?`<ul>${rows}</ul>`:`<p class="at-empty">${tx('alerts.calm','No active alerts')}</p>`)+'</section>';
  }

  // Inner HTML of #alertTray. view = {tab, alerts, summary, expandedGroups: string[], threatOpen: boolean}; the alerts of
  // every state may be given, each tab shows its own. The Rules tab is an empty div.at-rules (filled by the rule editor).
  function renderTray(view,t,now){
    const v=obj(view)||{},tx=translator(t),s=obj(v.summary)||{},tab=TABS.some(([id])=>id===v.tab)?v.tab:'active';
    const all=sortAlerts(v.alerts).filter(alert=>text(alert.id));
    const inTab=states=>all.filter(alert=>states.includes(alert.state));
    const tabs=TABS.map(([id,key,fallback,states])=>`<button type="button" role="tab" class="at-tab" id="at-tab-${id}" data-alert-tab="${id}" aria-selected="${id===tab}" aria-controls="at-panel" tabindex="${id===tab?0:-1}">${tx('alerts.'+key,fallback)}${states?` <span class="at-tab-count">${inTab(states).length}</span>`:''}</button>`).join('');
    const states=TABS.find(([id])=>id===tab)[3],shown=states?inTab(states):[];
    const panel=states?(tab==='active'&&shown.length?ackAll(tx,shown):'')+alertList(tx,shown,v,s,now,tab):'<div class="at-rules"></div>';
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

  window.CrucixAlerts={renderStrip,renderTray,renderToast};
})(window);
