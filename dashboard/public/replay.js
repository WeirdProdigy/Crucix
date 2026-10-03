(function(window,document){
  'use strict';
  // Sweep replay: shows an archived sweep (GET /api/sweeps/:id) through the page's own render path, with CrucixClock frozen at
  // the sweep's time, until "Back to live". Needs replay-core.js. The page hands over its hooks in mount(options):
  //   root            the bar's element (a landmark docked at the bottom), built here from text nodes only
  //   fetchJson(url)  -> Promise<object>; a rejection may carry .status (404 = the sweep left the archive)
  //   applySnapshot(s) renders an archived snapshot (the page keeps its live alerts); restoreLive(s) renders a live one again
  //   redrive()       redraws every age label after the clock froze or was released (the clock sends no notification)
  //   t(key, fallback), locale (for the time label)
  // While a replay holds the page, live snapshots are not applied (offerLive -> false): the newest is kept and applied on exit.
  const C=window.CrucixReplayCore;
  const SWEEP_ID=/^sweep-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
  const COPY={button:'Replay',region:'Sweep replay',banner:'Replay of an archived sweep',slider:'Archived sweep',prev:'Previous sweep',next:'Next sweep',backToLive:'Back to live',
    loading:'Loading sweep…',error:'Could not load this sweep. The previous view is kept.',notFound:'This sweep is no longer in the archive.',
    newerLive:'Newer live data waiting: {count}. It is shown when you go back to live.',alertsLive:'Alerts stay live during the replay.',
    historyUnavailable:'Event history and export read the live store, so they are off during the replay; the records shown are the replayed sweep’s own.',
    noSweeps:'Replay needs at least two archived sweeps.',position:'{index} of {total}',unknownTime:'Unknown time'};
  const ERRORS=['error','notFound','noSweeps'];
  let opts=null,nodes=null,state=C.createState(),times={},listed=false,seq=0,listSeq=0,liveSeen=0,frozen=false,refocus=false;
  const log=error=>{try{console.error('[replay]',error);}catch{}};
  const guarded=fn=>(...args)=>{try{return fn(...args);}catch(error){log(error);}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Plain text (textContent and DOM attributes); escaped only where it goes into markup.
  function say(key,values){
    let text=COPY[key];
    try{const value=typeof opts?.t==='function'?opts.t('replay.'+key,COPY[key]):COPY[key];if(typeof value==='string'&&value)text=value;}catch{}
    for(const [name,value] of Object.entries(values||{}))text=text.split('{'+name+'}').join(String(value));
    return text;
  }
  const clock=()=>{const c=window.CrucixClock;return c&&typeof c.freeze==='function'&&typeof c.release==='function'?c:null;};
  // Only ISO-8601 times: Date.parse also reads any text with a number in it ("<img … =2>" is February 2001).
  const ISO_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
  const isoTime=value=>{const ms=typeof value==='string'&&ISO_TIME.test(value)?Date.parse(value):NaN;return Number.isFinite(ms)?ms:null;};
  const snapshotTime=snapshot=>snapshot&&typeof snapshot==='object'&&snapshot.meta?isoTime(snapshot.meta.timestamp):null;
  const idTime=id=>{const m=SWEEP_ID.exec(id);return m?Date.UTC(+m[1],m[2]-1,+m[3],+m[4],+m[5],+m[6]):NaN;};
  function label(id){
    const ms=Object.hasOwn(times,id)?times[id]:idTime(id);
    if(!Number.isFinite(ms))return say('unknownTime');
    try{return new Date(ms).toLocaleString(opts.locale||undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
    catch{return new Date(ms).toISOString().slice(0,16).replace('T',' ')+' UTC';}
  }
  const available=()=>listed&&state.sweeps.length>=2;
  const active=()=>!!opts&&!C.canApplyLive(state);

  // ===== The bar =====
  function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
  function control(action,glyph,text){
    const node=element('button','rp-btn rp-'+action);node.type='button';node.setAttribute('data-replay',action);
    if(glyph){node.setAttribute('aria-label',text);const icon=element('span','rp-glyph',glyph);icon.setAttribute('aria-hidden','true');node.append(icon,element('span','rp-label',text));}
    else node.textContent=text;
    return node;
  }
  function build(){
    const root=opts.root;
    root.hidden=true;root.className='rp-bar';root.setAttribute('role','region');root.setAttribute('aria-label',say('region'));
    const head=element('p','rp-head'),mark=element('span','rp-mark','↺');mark.setAttribute('aria-hidden','true');
    const time=element('span','rp-time'),position=element('span','rp-position');
    head.append(mark,element('strong','rp-banner',say('banner')),time,position);
    const range=element('input','rp-range');range.type='range';range.min='0';range.max='0';range.step='1';range.value='0';range.setAttribute('aria-label',say('slider'));
    const prev=control('prev','◀',say('prev')),next=control('next','▶',say('next')),exitButton=control('exit','',say('backToLive'));
    const controls=element('div','rp-controls');controls.append(prev,range,next);
    const status=element('p','rp-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const note=element('p','rp-note',say('alertsLive')+' '+say('historyUnavailable'));
    root.append(head,controls,exitButton,note,status);
    prev.addEventListener('click',guarded(()=>{if(prev.getAttribute('aria-disabled')!=='true')step(-1);}));
    next.addEventListener('click',guarded(()=>{if(next.getAttribute('aria-disabled')!=='true')step(1);}));
    exitButton.addEventListener('click',guarded(()=>leave(true)));
    // input previews the time under the thumb; change (release, or each arrow/Home/End key) loads that sweep.
    range.addEventListener('input',guarded(()=>{const id=state.sweeps[Number(range.value)];if(id)speak(range,time,label(id));}));
    range.addEventListener('change',guarded(()=>{const id=state.sweeps[Number(range.value)];if(id)go({type:'goto',id});}));
    root.addEventListener('keydown',guarded(event=>{
      if(event.key!=='Escape'||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
      event.preventDefault();leave(true);
    }));
    nodes={root,head,time,position,controls,range,prev,next,exitButton,note,status};
    // The page keeps its last rows reachable above the bar: replay.css pads <body> by the bar's measured height.
    if(typeof ResizeObserver==='function')new ResizeObserver(guarded(measure)).observe(root);
  }
  function measure(){document.documentElement?.style?.setProperty('--rp-height',Math.ceil(nodes.root.getBoundingClientRect().height)+'px');}
  function speak(range,time,text){time.textContent=text;range.setAttribute('aria-valuetext',text);}
  function draw(){
    syncTrigger();
    if(!nodes)return;
    const {root,time,position,controls,range,prev,next,status}=nodes,wasHidden=root.hidden;
    root.hidden=state.mode==='live';
    if(root.hidden)return;
    // An error before any sweep was shown has no slider: only the message and the way back.
    const entered=state.id!==null||state.mode==='loading';
    controls.hidden=!entered;time.hidden=!entered;position.hidden=!entered;
    if(entered){
      const at=Math.max(0,state.mode==='loading'?state.targetIndex:state.index),total=state.sweeps.length;
      range.max=String(Math.max(0,total-1));range.value=String(at);
      speak(range,time,label(state.sweeps[at]));
      position.textContent=say('position',{index:at+1,total});
      setDisabled(prev,at<=0);setDisabled(next,at>=total-1);
    }
    status.textContent=[state.mode==='loading'?say('loading'):'',state.error?say(ERRORS.includes(state.error)?state.error:'error'):'',state.missed?say('newerLive',{count:state.missed}):''].filter(Boolean).join(' · ');
    if(wasHidden&&entered)range.focus();
  }
  // aria-disabled keeps the button focusable when an end is reached (a disabled button would drop the keyboard focus).
  function setDisabled(node,off){if(off)node.setAttribute('aria-disabled','true');else node.removeAttribute('aria-disabled');}
  function syncTrigger(){
    const node=document.getElementById('replayTrigger');if(!node)return;
    node.setAttribute('aria-pressed',String(state.mode!=='live'));
    if(state.mode!=='live'||available()){node.removeAttribute('aria-disabled');node.removeAttribute('title');}
    else{node.setAttribute('aria-disabled','true');node.setAttribute('title',say('noSweeps'));}
  }
  // The header button (renderTopbar includes it): disabled with the reason until two sweeps are archived. Empty before mount.
  function button(){
    if(!opts)return '';
    const on=state.mode!=='live',off=!on&&!available(),controls=opts.root.id?` aria-controls="${esc(opts.root.id)}"`:'';
    return `<button type="button" class="guide-btn rp-trigger" id="replayTrigger" aria-pressed="${on}"${controls}${off?` aria-disabled="true" title="${esc(say('noSweeps'))}"`:''}>${esc(say('button'))}</button>`;
  }

  // ===== Loading =====
  // The archive list, oldest -> newest; read again on every open (and when live data shows that a sweep was archived).
  async function refreshList(){
    const mine=++listSeq;
    let data;
    try{data=await opts.fetchJson('/api/sweeps');}catch{return false;}
    if(mine!==listSeq||!data||!Array.isArray(data.sweeps))return false;
    const entries=data.sweeps.filter(entry=>entry&&typeof entry.id==='string'&&SWEEP_ID.test(entry.id));
    times={};for(const entry of entries)times[entry.id]=isoTime(entry.timestamp)??idTime(entry.id);
    listed=true;state=C.reduce(state,{type:'sweeps',sweeps:entries.map(entry=>entry.id)});draw();
    return true;
  }
  function restore(snapshot){try{opts.restoreLive(snapshot);}catch(error){log(error);}}
  function redrive(){try{opts.redrive?.();}catch(error){log(error);}}
  // `mine` is the request's sequence number: anything the user did since (a step, open, exit) makes its answer stale.
  async function load(mine){
    const id=state.target;draw();
    let snapshot=null,error='';
    try{snapshot=await opts.fetchJson('/api/sweeps/'+encodeURIComponent(id));if(snapshotTime(snapshot)===null)error='error';}
    catch(failure){error=failure&&failure.status===404?'notFound':'error';}
    if(mine!==seq)return false;
    if(!error){
      const c=clock(),previous=frozen&&c?c.now():null;
      try{if(c){c.freeze(snapshotTime(snapshot));frozen=true;}opts.applySnapshot(snapshot);}
      catch(failure){
        log(failure);error='error';
        if(c){if(previous===null){c.release();frozen=false;}else c.freeze(previous);}
      }
    }
    if(error){
      const before=state;state=C.reduce(state,{type:'failed',id,error});
      // Never entered: the live snapshot that arrived meanwhile is applied now.
      if(C.canApplyLive(state)&&before.pending)restore(before.pending);
      draw();return false;
    }
    state=C.reduce(state,{type:'loaded',id});
    redrive();draw();
    return true;
  }
  function go(action){
    const before=state;state=C.reduce(state,action);
    if(state===before)return;
    const mine=++seq;
    if(state.mode==='loading')load(mine).catch(log);else draw();
  }
  const step=delta=>go({type:'step',delta});
  async function open(id){
    if(!opts)return false;
    const mine=++seq;
    await refreshList();
    if(mine!==seq)return false;
    const before=state;state=C.reduce(state,{type:'open',id:typeof id==='string'?id:undefined});
    if(C.canApplyLive(state)&&before.pending)restore(before.pending);
    if(state.mode==='loading')return load(mine);
    draw();
    return state.mode==='replay';
  }
  // Back to live: the clock is released first, then the newest kept live snapshot is rendered (or /api/data is read once).
  function leave(focusTrigger){
    if(!opts||state.mode==='live')return;
    const before=state;++seq;
    state=C.reduce(state,{type:'exit'});
    const c=clock();if(frozen){frozen=false;c?.release();}
    draw();
    if(before.pending){restore(before.pending);redrive();}
    else if(before.id!==null){redrive();fromServer().catch(log);}
    refocus=!!focusTrigger;if(refocus)focusTriggerNow();
  }
  // The header button is redrawn with the top bar: focus whatever node carries its id now.
  function focusTriggerNow(){document.getElementById('replayTrigger')?.focus?.();}
  async function fromServer(){
    const mine=seq,seen=liveSeen;
    let data;
    try{data=await opts.fetchJson('/api/data');}catch{return;}
    // A replay entered again, or a live update the page applied meanwhile, makes this answer stale.
    if(mine!==seq||seen!==liveSeen||snapshotTime(data)===null)return;
    restore(data);redrive();
    if(refocus&&(!document.activeElement||document.activeElement===document.body))focusTriggerNow();
  }
  // SSE `update` and the poll fallback ask first: true = apply it (live mode); false = kept aside for the exit.
  function offerLive(snapshot){
    if(!active()){
      liveSeen++;
      // A live sweep was archived meanwhile: the header button may become available.
      if(opts&&!available())refreshList().catch(log);
      return true;
    }
    state=C.reduce(state,{type:'liveArrived',snapshot});
    refreshList().catch(log);draw();
    return false;
  }
  function onDocumentClick(event){
    const trigger=event.target?.closest?.('#replayTrigger');if(!trigger)return;
    if(state.mode!=='live'){leave(true);return;}
    if(available())open().catch(log);
  }
  function mount(options){
    if(opts||!options||typeof options!=='object'||!options.root)return false;
    opts=options;build();
    document.addEventListener('click',guarded(onDocumentClick));
    refreshList().catch(log);
    return true;
  }
  window.CrucixReplay=Object.freeze({mount,open:id=>open(id).catch(error=>{log(error);return false;}),exit:guarded(()=>leave(false)),active,offerLive:guarded(offerLive),button:guarded(button)});
})(window,document);
