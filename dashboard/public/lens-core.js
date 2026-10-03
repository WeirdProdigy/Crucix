(function(window){
  'use strict';
  // Pure domain-lens logic over CrucixDomains (domains.js, loaded first). `all` matches everything, domain-less items (news, OSINT,
  // signals) included; any other lens matches only the items of its own domain. Without domains.js every lens is `all`.
  const LEVELS=['critical','high','watch','info'];
  const registry=()=>window.CrucixDomains;
  const ids=()=>{const domains=registry();return domains&&Array.isArray(domains.DOMAIN_IDS)?domains.DOMAIN_IDS:[];};
  const normalize=value=>typeof value==='string'&&ids().includes(value)?value:'all';
  const matchesDomain=(lens,domain)=>{const id=normalize(lens);return id==='all'||domain===id;};
  const matchesSource=(lens,name)=>matchesDomain(lens,registry()?registry().domainOfSource(name):null);
  // An event record names its source in source.name (or sourceName); a live row carries the bare adapter name in `source`.
  function matchesEvent(lens,event){
    if(normalize(lens)==='all')return true;
    const domains=registry();
    if(!domains||!event||typeof event!=='object')return false;
    return matchesDomain(lens,typeof event.source==='string'?domains.domainOfSource(event.source):domains.domainOfEvent(event));
  }
  // rows: [{source, state, levels:{critical:n, high:n, …}}] in display order. Groups come in the domain order with their rows in the
  // given order; rows without a known domain trail in a group whose domain is null. worst: the highest level any row counts (null
  // without one); attention: a row is not ok, or worst is high or critical.
  function groupSources(rows,domainOf){
    const order=ids(),byDomain=new Map();
    for(const row of Array.isArray(rows)?rows:[]){
      if(!row||typeof row!=='object')continue;
      let domain=null;
      try{domain=typeof domainOf==='function'?domainOf(row.source):null;}catch{domain=null;}
      if(!order.includes(domain))domain=null;
      if(!byDomain.has(domain))byDomain.set(domain,[]);
      byDomain.get(domain).push(row);
    }
    return [...order,null].filter(domain=>byDomain.has(domain)).map(domain=>{
      const list=byDomain.get(domain),worst=LEVELS.find(level=>list.some(row=>row.levels&&Number(row.levels[level])>0))||null;
      return {domain,rows:list,worst,attention:list.some(row=>row.state!=='ok')||worst==='critical'||worst==='high'};
    });
  }
  window.CrucixLensCore={normalize,matchesSource,matchesEvent,groupSources};
})(window);
