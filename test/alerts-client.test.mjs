import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read=file=>readFileSync(new URL('../dashboard/public/'+file,import.meta.url),'utf8');
// record-core.js, alerts-core.js and alerts.js share one realm, as in the page; a fresh realm per test, so nothing leaks.
// Results cross the realm boundary: compare plain data through JSON (prototypes differ).
const load=()=>{const window={},context=vm.createContext({window,Date,URL});for(const file of ['record-core.js','alerts-core.js','alerts.js'])vm.runInContext(read(file),context);return window;};
const plain=value=>JSON.parse(JSON.stringify(value));
const t=(_,fallback)=>fallback;
const now=Date.parse('2026-10-02T12:00:00Z'),MIN=60000,HOUR=3600000;
const EVENT='event-'+'a'.repeat(32),HOSTILE='"><img onerror=x>';
const count=(html,needle)=>html.split(needle).length-1;
const hhmm=ms=>{const d=new Date(ms);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
// A tag with an on*= attribute name. Escaped text ("&lt;img onerror=x&gt;") is not a tag, and inside a tag the quoted attribute
// values are dropped first: an escaped value cannot contain a raw quote, so " onerror=" there is inert text.
const hasInlineHandler=html=>(html.match(/<[a-z][^>]*>/gi)||[]).some(tag=>/\son\w+\s*=/i.test(tag.replace(/"[^"]*"/g,'""')));
let serial=0;
const alert=(more={})=>{serial+=1;return {id:'alert-'+String(serial).padStart(32,'0'),ruleId:'events-critical',ruleName:'Critical events',dedupKey:'events-critical|'+EVENT,kind:'event',severity:'critical',state:'firing',
  title:'Alert '+serial,summary:'Summary '+serial,evidence:[{type:'event',id:EVENT,title:'Quake near Szeged',source:'USGS',level:'critical'}],firstSeenAt:now-2*HOUR,lastSeenAt:now-10*MIN,count:3,notify:true,silent:false,log:[],...more};};
const compact=a=>({id:a.id,ruleId:a.ruleId,ruleName:a.ruleName,severity:a.severity,state:a.state,title:a.title,firstSeenAt:a.firstSeenAt,lastSeenAt:a.lastSeenAt,count:a.count,silent:a.silent});
const summaryOf=(alerts,more={})=>{
  const counts={critical:0,high:0,watch:0,info:0,total:0,acked:0,snoozed:0},firing=alerts.filter(a=>a.state==='firing');
  for(const a of alerts){if(a.state==='resolved')continue;counts.total++;if(a.state==='firing')counts[a.severity]++;else counts[a.state]++;}
  const level={critical:5,high:4,watch:3,info:2}[firing[0]?.severity]||1;
  return {generatedAt:now,lastEvaluatedAt:now-5*MIN,counts,threat:{level,drivers:firing.slice(0,5).map(a=>({alertId:a.id,ruleId:a.ruleId,severity:a.severity,title:a.title}))},
    top:firing.slice(0,5).map(compact),overflow:[],rules:{enabled:8,total:8},status:{alerts:{source:'main'}},...more};
};
const view=(alerts,more={})=>({tab:'active',alerts,summary:summaryOf(alerts),expandedGroups:[],threatOpen:false,...more});

test('core constants and helpers are those of record-core',()=>{
  const window=load(),C=window.CrucixAlertsCore,R=window.CrucixRecords;
  assert.deepEqual(plain(C.LEVELS),['critical','high','watch','info']);
  for(const level of C.LEVELS)assert.equal(C.GLYPH[level],R.GLYPH[level],level);
  assert.equal(C.esc(`<a href="x">'&`),'&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(C.safeUrl('javascript:alert(1)'),null); assert.equal(C.safeUrl('https://user:pw@example.org/'),null); assert.equal(C.safeUrl('https://example.org/a'),'https://example.org/a');
  assert.equal(C.ageLabel(now-12*MIN,now),'12m'); assert.equal(C.ageLabel(now-3*HOUR,now),'3h'); assert.equal(C.ageLabel(now-2*24*HOUR,now),'2d'); assert.equal(C.ageLabel(NaN,now),'—');
});

test('sortAlerts: firing first, then severity, then newest lastSeenAt; stable; input untouched',()=>{
  const C=load().CrucixAlertsCore;
  const a=alert({state:'acked',severity:'critical',lastSeenAt:now}),b=alert({severity:'watch',lastSeenAt:now-MIN}),c=alert({severity:'critical',lastSeenAt:now-5*MIN}),d=alert({severity:'critical',lastSeenAt:now-MIN});
  const e=alert({state:'snoozed',severity:'high',lastSeenAt:now}),f=alert({state:'resolved',severity:'critical',lastSeenAt:now}),g=alert({severity:'critical',lastSeenAt:now-5*MIN});
  const input=[a,b,c,d,e,f,g],before=input.map(x=>x.id);
  assert.deepEqual(C.sortAlerts(input).map(x=>x.id),[d.id,c.id,g.id,b.id,a.id,e.id,f.id]);
  assert.deepEqual(input.map(x=>x.id),before,'the input array keeps its order');
  for(const garbage of [null,undefined,'x',42,{},[null,1,'x']])assert.deepEqual(plain(C.sortAlerts(garbage)),[]);
});

test('groupByRule: more than five alerts of a rule form a group, in sorted order',()=>{
  const C=load().CrucixAlertsCore;
  const six=Array.from({length:6},(_,i)=>alert({ruleId:'events-high',ruleName:'High-severity events',severity:'high',lastSeenAt:now-i*MIN}));
  const five=Array.from({length:5},(_,i)=>alert({ruleId:'vix-spike',ruleName:'VIX spike',severity:'watch',lastSeenAt:now-i*MIN}));
  const top=alert();
  const groups=C.groupByRule(C.sortAlerts([...five,...six,top]));
  assert.deepEqual(plain(groups.map(g=>[g.ruleId,g.ruleName,g.alerts.length,g.grouped])),[['events-critical','Critical events',1,false],['events-high','High-severity events',6,true],['vix-spike','VIX spike',5,false]]);
  assert.deepEqual(plain(groups[1].alerts.map(a=>a.id)),six.map(a=>a.id));
  assert.equal(C.groupByRule(six,6)[0].grouped,false,'the threshold is configurable');
  assert.deepEqual(plain(C.groupByRule('nope')),[]);
});

test('titleBadge counts firing critical and high alerts',()=>{
  const C=load().CrucixAlertsCore;
  assert.equal(C.titleBadge({counts:{critical:1,high:2,watch:7,info:1}}),'(3) ');
  assert.equal(C.titleBadge({counts:{critical:0,high:0,watch:4}}),'');
  for(const garbage of [null,undefined,'x',{counts:null},{counts:{critical:-1,high:'2'}},{counts:{critical:NaN,high:Infinity}}])assert.equal(C.titleBadge(garbage),'');
});

test('newAlertToasts: new firing critical or high alerts only, never silent ones',()=>{
  const C=load().CrucixAlertsCore;
  const critical=alert(),high=alert({severity:'high'}),watch=alert({severity:'watch'}),seen=alert(),silent=alert({silent:true}),acked=alert({state:'acked'});
  const summary={top:[critical,high,watch,seen,silent,acked].map(compact)};
  assert.deepEqual(C.newAlertToasts(summary,new Set([seen.id])).map(a=>a.id),[critical.id,high.id]);
  assert.deepEqual(plain(C.newAlertToasts(summary,new Set([critical.id,high.id,seen.id]))),[]);
  for(const garbage of [null,'x',{top:'x'},{top:[null,1]}])assert.deepEqual(plain(C.newAlertToasts(garbage,new Set())),[]);
  assert.deepEqual(plain(C.newAlertToasts(summary,null).map(a=>a.id)),[critical.id,high.id,seen.id],'a missing seen set counts as empty');
  assert.deepEqual(plain(C.newAlertToasts({top:[compact(critical),compact(critical)]},new Set()).map(a=>a.id)),[critical.id],'one toast per id');
});

test('renderStrip: calm state',()=>{
  const A=load().CrucixAlerts,summary=summaryOf([]);
  const html=A.renderStrip(summary,t,now);
  assert(html.includes('No active alerts')); assert(html.includes('Last evaluation')); assert(html.includes(hhmm(now-5*MIN)));
  assert(html.includes('data-alert-action="threat"')); assert(html.includes('1/5'));
  for(const action of ['ack','snooze','open'])assert(!html.includes(`data-alert-action="${action}"`),action);
  assert(A.renderStrip({...summary,lastEvaluatedAt:null},t,now).includes('—'),'never evaluated');
});

test('renderStrip: active state',()=>{
  const A=load().CrucixAlerts,top=alert({title:'Earthquake M7.1'}),alerts=[top,alert({severity:'high'}),alert({severity:'high'})];
  const html=A.renderStrip(summaryOf(alerts),t,now);
  assert.match(html,/<button type="button" class="as-threat as-threat-5" data-alert-action="threat" aria-expanded="false"[^>]*>/);
  assert(html.includes('Threat 5/5'));
  assert(html.includes('<span class="ri-sr"> Critical</span>')&&html.includes('<span class="ri-sr"> High</span>'),'level names are spoken');
  assert(html.includes('sev-critical')&&html.includes('sev-high'));
  assert(!html.includes('as-count sev-watch')&&!html.includes('as-count sev-info'),'no counter for zero levels');
  assert.match(html,/as-count sev-critical"><i aria-hidden="true">◆<\/i>1</); assert.match(html,/as-count sev-high"><i aria-hidden="true">▲<\/i>2</);
  assert(html.includes('Earthquake M7.1')); assert(!html.includes('No active alerts'));
  for(const action of ['ack','snooze-menu','open'])assert(html.includes(`data-alert-action="${action}" data-alert-id="${top.id}"`),action);
  for(const minutes of [60,480,1440])assert(html.includes(`data-alert-action="snooze" data-alert-id="${top.id}" data-minutes="${minutes}"`),String(minutes));
  assert(html.includes('+2 more alerts'),'the other firing alerts are counted');
  assert(A.renderStrip(summaryOf(alerts),t,now,true).includes('aria-expanded="true"'),'an open threat panel is announced');
});

test('renderTray: tabs, empty state and the rules placeholder',()=>{
  const A=load().CrucixAlerts;
  const html=A.renderTray(view([]),t,now);
  assert.equal(count(html,'role="tab"'),4);
  for(const [tab,label] of [['active','Active'],['handled','Handled'],['resolved','Resolved'],['rules','Rules']])assert(html.includes(`data-alert-tab="${tab}"`)&&html.includes(label),tab);
  assert.match(html,/data-alert-tab="active"[^>]*aria-selected="true"/); assert.match(html,/data-alert-tab="rules"[^>]*aria-selected="false"/);
  assert(html.includes('role="tabpanel"')); assert(html.includes('Nothing here'));
  assert(html.includes('data-alert-action="close"'));
  const rules=A.renderTray(view([alert()],{tab:'rules'}),t,now);
  assert(rules.includes('<div class="at-rules"></div>')); assert(!rules.includes('data-alert-id='),'the rules tab lists no alerts');
  assert.match(A.renderTray(view([],{tab:'bogus'}),t,now),/data-alert-tab="active"[^>]*aria-selected="true"/,'an unknown tab falls back to active');
});

test('renderTray: rows, actions and per-tab filtering',()=>{
  const A=load().CrucixAlerts;
  const firing=alert({title:'Firing one',count:4}),acked=alert({state:'acked',ack:{at:now-HOUR},title:'Acked one'});
  const snoozed=alert({state:'snoozed',snooze:{at:now-HOUR,until:now+3*HOUR},title:'Snoozed one'}),resolved=alert({state:'resolved',resolvedAt:now-30*MIN,title:'Resolved one'});
  const all=[firing,acked,snoozed,resolved];
  const active=A.renderTray(view(all),t,now);
  assert.equal(count(active,'data-alert-id="'+firing.id+'"')>0,true); assert(!active.includes(acked.id)&&!active.includes(resolved.id),'active shows firing alerts only');
  assert.match(active,new RegExp(`<li class="at-alert[^"]*" data-alert-id="${firing.id}"`));
  for(const action of ['ack','snooze-menu','resolve'])assert(active.includes(`data-alert-action="${action}" data-alert-id="${firing.id}"`),action);
  for(const minutes of [60,480,1440])assert(active.includes(`data-alert-action="snooze" data-alert-id="${firing.id}" data-minutes="${minutes}"`),String(minutes));
  for(const text of ['Firing one','Critical events','<span class="at-age">2h</span>','seen 4×','Summary'])assert(active.includes(text),text);
  assert(active.includes(`data-alert-action="evidence" data-event-id="${EVENT}"`)&&active.includes('Quake near Szeged'),'evidence opens the event');
  assert(active.includes('<span class="ri-sr">Critical</span>'));
  assert(active.includes('data-alert-action="ack-all"')&&active.includes('Acknowledge all'));
  assert(active.includes('data-alert-action="ack-all" data-severity="critical"'),'ack all by level');
  const handled=A.renderTray(view(all,{tab:'handled'}),t,now);
  assert(handled.includes('Acked one')&&handled.includes('Snoozed one')&&!handled.includes('Firing one')&&!handled.includes('Resolved one'));
  assert(handled.includes('Snoozed until')&&handled.includes(hhmm(now+3*HOUR)),'the snooze deadline is shown');
  assert(handled.includes('Acknowledged'));
  assert(!handled.includes(`data-alert-action="ack" data-alert-id="${acked.id}"`),'an acknowledged alert has no ack button');
  assert(handled.includes(`data-alert-action="resolve" data-alert-id="${acked.id}"`));
  assert(!handled.includes('data-alert-action="ack-all"'),'ack all lives on the active tab');
  const done=A.renderTray(view(all,{tab:'resolved'}),t,now);
  assert(done.includes('Resolved one')&&!done.includes('Firing one')); assert(done.includes(hhmm(now-30*MIN)),'the resolve time is shown');
  for(const action of ['ack','snooze-menu','snooze','resolve'])assert(!done.includes(`data-alert-action="${action}"`),'a resolved alert has no '+action+' action');
  assert(A.renderTray(view([alert({silent:true})]),t,now).includes('Initial baseline'),'a bootstrap alert is labelled');
});

test('renderTray: grouping, expansion and overflow',()=>{
  const A=load().CrucixAlerts;
  const six=Array.from({length:6},(_,i)=>alert({ruleId:'events-high',ruleName:'High-severity events',severity:'high',lastSeenAt:now-i*MIN}));
  const lone=alert();
  const collapsed=A.renderTray(view([...six,lone],{summary:{...summaryOf([...six,lone]),overflow:[{ruleId:'events-high',count:12}]}}),t,now);
  assert.match(collapsed,/data-alert-action="group" data-rule-id="events-high" aria-expanded="false"/);
  assert(collapsed.includes('High-severity events')); assert(collapsed.includes('+12 more alerts'),'overflow in the group header');
  assert.equal(count(collapsed,'<li class="at-alert'),1,'a collapsed group hides its rows');
  const open=A.renderTray(view([...six,lone],{expandedGroups:['events-high']}),t,now);
  assert.match(open,/data-alert-action="group" data-rule-id="events-high" aria-expanded="true"/);
  assert.equal(count(open,'<li class="at-alert'),7);
  const five=A.renderTray(view(six.slice(0,5)),t,now);
  assert(!five.includes('data-alert-action="group"'),'five alerts are not grouped'); assert.equal(count(five,'<li class="at-alert'),5);
  const loneOverflow=A.renderTray(view([lone],{summary:{...summaryOf([lone]),overflow:[{ruleId:'events-critical',count:3}]}}),t,now);
  assert(loneOverflow.includes('+3 more alerts'),'overflow of an ungrouped rule is shown too');
});

test('renderTray: threat drivers block',()=>{
  const A=load().CrucixAlerts,a=alert({title:'Driver title'}),alerts=[a,alert({severity:'high'})];
  assert(!A.renderTray(view(alerts),t,now).includes('Driving this level'),'closed by default');
  const html=A.renderTray(view(alerts,{threatOpen:true}),t,now);
  assert(html.includes('Driving this level')&&html.includes('Threat 5/5')&&html.includes('Driver title'));
  assert(html.includes(`data-alert-id="${a.id}"`));
  assert(A.renderTray(view([],{threatOpen:true}),t,now).includes('No active alerts'),'no drivers at level 1');
});

test('built-in rule names are localised by id, other names shown as stored',()=>{
  const A=load().CrucixAlerts;
  const tr=(key,fallback)=>({'alerts.ruleNames.events-critical':'Kritikus események','alerts.ruleNames.constructor':'NOPE'})[key]??fallback;
  const html=A.renderTray(view([alert(),alert({ruleId:'constructor',ruleName:'My rule'})]),tr,now);
  assert(html.includes('Kritikus események')); assert(html.includes('My rule')); assert(!html.includes('NOPE'));
  assert(A.renderToast(alert(),tr).includes('Kritikus események'));
});

test('hostile feed text stays inert',()=>{
  assert(hasInlineHandler('<img src="x" onerror=y>')&&hasInlineHandler('<b\nonclick="y">'),'the matcher finds handlers');
  assert(!hasInlineHandler('<b title=" onerror=x">&lt;img onerror=x&gt;</b>'),'quoted values and escaped text are inert');
  const A=load().CrucixAlerts;
  const evil=alert({id:HOSTILE,ruleId:HOSTILE,ruleName:HOSTILE,title:HOSTILE,summary:HOSTILE,severity:HOSTILE,state:'firing',
    evidence:[{type:'event',id:HOSTILE,title:HOSTILE,source:HOSTILE},{type:'link',title:HOSTILE,url:'javascript:alert(1)'},{type:'link',title:'Safe',url:'https://example.org/?token=s'}]});
  const good=alert({title:HOSTILE,summary:HOSTILE,ruleName:HOSTILE,evidence:[{type:'event',id:EVENT,title:HOSTILE,url:'javascript:alert(1)'}]});
  const summary={...summaryOf([good]),top:[compact(good),compact(evil)],threat:{level:5,drivers:[{alertId:HOSTILE,ruleId:HOSTILE,severity:HOSTILE,title:HOSTILE}]},overflow:[{ruleId:HOSTILE,count:HOSTILE}]};
  const outputs=[A.renderStrip(summary,t,now,true),A.renderToast(good,t),A.renderToast(evil,t),
    ...['active','handled','resolved'].map(tab=>A.renderTray({tab,alerts:[good,evil,{...evil,state:'snoozed',snooze:{until:HOSTILE}},{...evil,state:'resolved',resolvedAt:HOSTILE}],summary,expandedGroups:[HOSTILE],threatOpen:true},t,now))];
  for(const html of outputs){
    assert(!html.includes('<img'),'no raw markup'); assert(!html.includes('"&gt;<')&&!html.includes('">&lt;img'),'no attribute breakout');
    assert(!/href=/.test(html),'unsafe evidence links are dropped'); assert(!hasInlineHandler(html),'no inline handler');
  }
  assert(outputs[3].includes('&quot;&gt;&lt;img onerror=x&gt;'),'escaped text is present');
  assert(outputs[3].includes('data-event-id="&quot;&gt;&lt;img onerror=x&gt;"'),'attribute values are escaped');
  const safe=A.renderTray({tab:'active',alerts:[alert({evidence:[{type:'link',title:'Report',url:'https://example.org/report'}]})],summary:summaryOf([])},t,now);
  assert(safe.includes('href="https://example.org/report"')&&safe.includes('rel="noopener noreferrer"'),'a safe evidence link is kept');
});

test('renderToast: roles and actions',()=>{
  const A=load().CrucixAlerts,critical=alert({title:'Big one'}),high=alert({severity:'high'});
  const html=A.renderToast(critical,t);
  assert.match(html,/role="alert"/); assert(!html.includes('role="status"'));
  assert(html.includes('New alert')&&html.includes('Big one')&&html.includes('<span class="ri-sr">Critical</span>'));
  for(const action of ['ack','open','dismiss'])assert(html.includes(`data-alert-action="${action}" data-alert-id="${critical.id}"`),action);
  assert(html.includes('aria-label="Close"'));
  assert.match(A.renderToast(high,t),/role="status"/);
  for(const garbage of [null,undefined,'x',42,[],{}])assert.equal(A.renderToast(garbage,t),'',String(garbage));
});

test('no inline handlers in any output',()=>{
  const A=load().CrucixAlerts,alerts=[alert(),alert({severity:'high',state:'snoozed',snooze:{at:now,until:now+HOUR}}),alert({state:'resolved',resolvedAt:now})];
  const outputs=[A.renderStrip(summaryOf(alerts),t,now),A.renderStrip(summaryOf([]),t,now),A.renderToast(alerts[0],t),
    ...['active','handled','resolved','rules'].map(tab=>A.renderTray(view(alerts,{tab,threatOpen:true}),t,now))];
  for(const html of outputs){assert(!/\son\w+=/i.test(html),'no on*= attribute'); assert(!/javascript:/i.test(html));}
});

test('robustness: garbage summaries, views and translators never throw',()=>{
  const A=load().CrucixAlerts,C=load().CrucixAlertsCore;
  const garbage=[null,undefined,0,'x',[],{},{counts:'x',top:'y',threat:'z',overflow:'w'},{counts:{critical:'1',high:-2,watch:NaN},top:[null,1,'x',{}],threat:{level:'9',drivers:[null,{}]},overflow:[null,{ruleId:3}],lastEvaluatedAt:'soon'}];
  const badT=[t,null,()=>{throw new Error('boom');},()=>42,()=>({})];
  for(const summary of garbage)for(const tr of badT){
    assert.equal(typeof A.renderStrip(summary,tr,now),'string');
    assert.equal(typeof A.renderStrip(summary,tr,NaN),'string');
    assert.equal(typeof A.renderTray(summary,tr,now),'string');
    assert.equal(typeof A.renderTray({tab:'active',alerts:[null,1,'x',{},{id:7,state:{},severity:[],evidence:'x',lastSeenAt:'y'}],summary,expandedGroups:'x',threatOpen:'yes'},tr,now),'string');
    assert.equal(typeof A.renderToast({id:'a',severity:'critical',evidence:null},tr),'string');
    assert.equal(typeof C.titleBadge(summary),'string'); assert(Array.isArray(plain(C.newAlertToasts(summary,new Set()))));
  }
  assert(A.renderStrip(null,null,now).includes('No active alerts'),'a missing translator falls back to English');
});
