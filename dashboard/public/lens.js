(function(window){
  'use strict';
  // The active domain lens and the live panel's group expansion (needs lens-core.js). Both persist in localStorage (crucix.lens,
  // crucix.liveGroups) when it works and live in memory when it does not. The dashboard rebuilds the live panel with innerHTML on every
  // update and with outerHTML on the 30 s freshness tick, so the expansion state lives here, never in the DOM.
  // mount(root, {t}) draws the lens bar under the top bar and handles the live group headers (button[data-live-group]) in place.
  const LENS_KEY='crucix.lens',GROUPS_KEY='crucix.liveGroups';
  const COPY={all:'All',label:'Domain lens',security:'Security and conflict',hazards:'Natural hazards and weather',space:'Space',cyber:'Cyber and internet',
    economy:'Markets and economy',supply:'Energy and supply chain',sanctions:'Sanctions and regulation',health:'Health and environment',status:'Domain lens: {name}'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const log=error=>{try{console.error('[lens]',error);}catch{}};
  const ids=()=>{const domains=window.CrucixDomains;return domains&&Array.isArray(domains.DOMAIN_IDS)?domains.DOMAIN_IDS:[];};
  const normalize=value=>window.CrucixLensCore?window.CrucixLensCore.normalize(value):'all';
  function load(key){try{return window.localStorage.getItem(key);}catch{return null;}}
  function save(key,value){try{window.localStorage.setItem(key,value);}catch{}}
  let lens=null,choices=null,root=null,opts={};
  const listeners=[],seen=new Map();

  function get(){if(lens===null)lens=normalize(load(LENS_KEY));return lens;}
  function set(id){
    const next=normalize(id);
    if(next===get())return;
    lens=next;save(LENS_KEY,next);sync(true);
    for(const fn of listeners.slice())try{fn(next);}catch(error){log(error);}
  }
  function onChange(fn){if(typeof fn==='function')listeners.push(fn);}

  // A group's choice is kept with the attention state it was made under. A group the user opened stays open whatever its attention
  // does; a collapsed choice holds while the attention state is unchanged and is dropped once it changes (a group that starts needing
  // attention opens), and then the default (open exactly when it needs attention) applies again.
  function stored(){
    if(choices)return choices;
    choices=new Map();
    let raw=null;
    try{raw=JSON.parse(load(GROUPS_KEY)||'null');}catch{raw=null;}
    if(raw&&typeof raw==='object'&&!Array.isArray(raw))for(const id of ids()){
      const entry=Object.hasOwn(raw,id)?raw[id]:null;
      if(entry&&typeof entry.open==='boolean'&&typeof entry.attention==='boolean')choices.set(id,{open:entry.open,attention:entry.attention});
    }
    return choices;
  }
  const persist=()=>save(GROUPS_KEY,JSON.stringify(Object.fromEntries(stored())));
  // attention: whether the group needs attention now (the live panel passes it on every render); left out, the last one seen.
  function expanded(domain,attention){
    if(!ids().includes(domain))return attention===true;
    if(typeof attention==='boolean')seen.set(domain,attention);
    const need=seen.get(domain)===true,map=stored(),entry=map.get(domain);
    if(!entry)return need;
    if(entry.open)return true;
    if(entry.attention===need)return false;
    map.delete(domain);persist();
    return need;
  }
  function toggle(domain){
    if(!ids().includes(domain))return false;
    const attention=seen.get(domain)===true,open=!expanded(domain,attention);
    stored().set(domain,{open,attention});persist();
    return open;
  }

  // ===== The lens bar =====
  function say(key){
    let text=COPY[key]||key;
    try{const value=typeof opts.t==='function'?opts.t('lenses.'+key,text):text;if(typeof value==='string'&&value)text=value;}catch{}
    return text;
  }
  // The buttons keep their nodes (and the focus); only aria-pressed and, after a change, the polite status line are updated.
  function sync(announce){
    if(!root)return;
    const current=get();
    for(const button of root.querySelectorAll('[data-lens]'))button.setAttribute('aria-pressed',String(button.getAttribute('data-lens')===current));
    const status=root.querySelector('.lens-status');
    if(status&&announce)status.textContent=say('status').split('{name}').join(say(current));
  }
  function pick(event){
    const button=event.target&&typeof event.target.closest==='function'?event.target.closest('[data-lens]'):null;
    if(button)set(button.getAttribute('data-lens'));
  }
  // A group header of the live panel: flip its state here, then its aria-expanded and the body it controls, without a re-render.
  function flipGroup(event){
    const button=event.target&&typeof event.target.closest==='function'?event.target.closest('button[data-live-group]'):null;
    if(!button)return;
    const open=toggle(button.getAttribute('data-live-group'));
    button.setAttribute('aria-expanded',String(open));
    const body=window.document.getElementById(button.getAttribute('aria-controls')||'');
    if(body)body.hidden=!open;
  }
  let bound=false;
  function mount(element,options){
    try{
      opts=options&&typeof options==='object'?options:{};
      if(!bound&&window.document){bound=true;window.document.addEventListener('click',flipGroup);}
      if(!element||root)return;
      root=element;
      const current=get(),buttons=['all',...ids()].map(id=>`<button type="button" class="lens-btn" data-lens="${esc(id)}" aria-pressed="${id===current}">${esc(say(id))}</button>`).join('');
      root.innerHTML=`<div class="lens-bar" role="group" aria-label="${esc(say('label'))}">${buttons}</div><p class="lens-status" role="status" aria-live="polite"></p>`;
      root.addEventListener('click',pick);
    }catch(error){log(error);}
  }
  window.CrucixLens={get,set,onChange,mount,expanded,toggle};
})(window);
