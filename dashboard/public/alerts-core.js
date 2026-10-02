(function(window){
  'use strict';
  // Pure alert logic for the strip, the tray, the toasts and the tab title: no DOM, no fetch, no timers; time only comes from
  // a `now` argument. Needs record-core.js (window.CrucixRecords) loaded first: glyphs, escaping, link and age rules are shared.
  const R=window.CrucixRecords;
  const LEVELS=Object.freeze(['critical','high','watch','info']);
  const GLYPH=Object.freeze(Object.fromEntries(LEVELS.map(level=>[level,R.GLYPH[level]])));
  const STATE_RANK={firing:0,acked:1,snoozed:1,resolved:2};
  const obj=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value:null;
  const str=value=>typeof value==='string'?value:'';
  const time=value=>Number.isFinite(value)?value:-Infinity;
  const levelRank=level=>{const index=LEVELS.indexOf(level);return index<0?LEVELS.length:index;};
  const stateRank=state=>Object.hasOwn(STATE_RANK,str(state))?STATE_RANK[state]:3;
  const alertsOf=value=>Array.isArray(value)?value.filter(obj):[];

  // Firing before acknowledged/snoozed (resolved last), most severe first, then the most recently seen. Stable; a new array.
  function sortAlerts(alerts){
    return alertsOf(alerts).sort((a,b)=>stateRank(a.state)-stateRank(b.state)||levelRank(a.severity)-levelRank(b.severity)||time(b.lastSeenAt)-time(a.lastSeenAt));
  }
  // Groups in the order of each rule's first alert; a rule with more than `min` alerts is shown as a group. Keyed by a Map:
  // rule ids such as "constructor" are valid.
  function groupByRule(alerts,min=5){
    const groups=new Map();
    for(const alert of alertsOf(alerts)){
      const ruleId=str(alert.ruleId);
      if(!groups.has(ruleId))groups.set(ruleId,{ruleId,ruleName:str(alert.ruleName),alerts:[],grouped:false});
      groups.get(ruleId).alerts.push(alert);
    }
    return [...groups.values()].map(group=>({...group,grouped:group.alerts.length>min}));
  }
  // Firing critical + high alerts (summary.counts has only firing alerts per level).
  function titleBadge(summary){
    const counts=obj(obj(summary)?.counts),n=['critical','high'].reduce((sum,level)=>sum+(Number.isSafeInteger(counts?.[level])&&counts[level]>0?counts[level]:0),0);
    return n>0?`(${n}) `:'';
  }
  // Toast candidates: firing critical/high alerts of summary.top not yet in `seen` and not silent (the initial baseline never
  // notifies). The caller adds the returned ids to `seen`.
  function newAlertToasts(summary,seen){
    const known=typeof seen?.has==='function'?seen:new Set(),ids=new Set();
    return alertsOf(obj(summary)?.top).filter(alert=>{
      const id=str(alert.id);
      if(!id||ids.has(id)||known.has(id)||alert.state!=='firing'||alert.silent===true||!['critical','high'].includes(alert.severity))return false;
      ids.add(id);return true;
    });
  }

  window.CrucixAlertsCore={LEVELS,GLYPH,sortAlerts,groupByRule,ageLabel:R.ageLabel,titleBadge,newAlertToasts,esc:R.esc,safeUrl:R.safeUrl};
})(window);
