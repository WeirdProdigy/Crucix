(function(window,document){
  'use strict';
  // The Ctrl+K / Cmd+K command palette: a modal <dialog> with a combobox input (aria-activedescendant) over a listbox of up to 12 results
  // in three groups: actions and sources (the page's items, ranked by palette-core.js) and records (a live search of the record
  // history, GET /api/history?q=…&limit=6, from 2 characters, 200 ms after the last keystroke). mount(options):
  //   actions(), sources()  the page's items {id, label, hint, keywords?, run()}, read on every open (setActions(list) replaces the actions)
  //   fetchJson(url, {signal})  reads the history; without it there is no record search
  //   t(key, fallback), esc(value)  the page's text (group `palette`, `intelligence.kind_*`) and HTML escaper (a built-in one otherwise)
  //   openEvent(id)  opens a record (default: CrucixIntelligence.openEvent, the page's open-by-id path)
  //   isReplay()     a sweep replay holds the page (default: CrucixReplay.active()): the history reads the live store, so it is not searched
  //   now()          the clock of the record ages (default Date.now); schedule(fn, ms) / cancel(handle): the delay (default setTimeout)
  // Each search has a sequence number and an AbortController: a newer keystroke, a close or a reopen makes an older answer stale, so a
  // slow answer never replaces a newer one. A failed search keeps the static results and only says so in one quiet line.
  // Keys: the open key is taken at the document in the capture phase (so it works from any focus, also inside other fields) and
  // only when it opens or closes the palette. It does nothing while another modal holds the keys: the event dialog (#ci-overlay),
  // the settings overlay, any other open <dialog> (record browser, matrix, offline settings), or when such a modal made the palette
  // inert. On macOS Cmd+K is the shortcut; a plain Ctrl+K inside another text field stays the system's delete-to-end-of-line.
  // The inspector's own keys (j/k, /, e) are scoped to its panels and ignore Ctrl/Cmd, the palette's are scoped to its input: no overlap.
  const LIMIT=12,RECORDS=6,MIN_QUERY=2,DELAY=200,MAX_QUERY=120;
  const EVENT_ID=/^event-[0-9a-f]{32}$/;
  const ISO_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
  const GROUP_KEY={action:'groupActions',source:'groupSources',record:'groupRecords'};
  const COPY={dialogLabel:'Command palette',button:'Commands',inputLabel:'Search commands, sources and records',placeholder:'Type a command, a source or a record…',resultsLabel:'Results',
    groupActions:'Actions',groupSources:'Sources',groupRecords:'Records',searching:'Searching the record history…',empty:'No matches.',
    historyFailed:'The record history could not be searched just now. Commands and sources are still listed.',replayNote:'The record history is not searched during a replay: it holds live records.',
    count:'{count} results',countOne:'{count} result',countNone:'No results',keys:'↑ ↓ move · Enter run · Esc close'};
  let opts=null,nodes=null,opened=false,opener=null,custom=null,statics=[],records=[],shown=[],active=-1,query='',timer=null,controller=null,seq=0,searching=false,failed=false,nextId=0;
  const ids=new Map();
  const log=error=>{try{console.error('[palette]',error);}catch{}};
  const guarded=fn=>(...args)=>{try{return fn(...args);}catch(error){log(error);}};
  const core=()=>window.CrucixPaletteCore;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const escHtml=value=>{if(opts&&typeof opts.esc==='function')try{return String(opts.esc(value));}catch{}return esc(value);};
  // Plain text (textContent and DOM attributes); escaped only where it goes into markup.
  function text(path,fallback){try{const value=opts&&typeof opts.t==='function'?opts.t(path,fallback):fallback;return typeof value==='string'&&value?value:fallback;}catch{return fallback;}}
  function say(key,values){let out=text('palette.'+key,COPY[key]);for(const [name,value] of Object.entries(values||{}))out=out.split('{'+name+'}').join(String(value));return out;}
  function isMac(){try{const nav=window.navigator||{},platform=nav.userAgentData&&nav.userAgentData.platform||nav.platform||'';return /mac|iphone|ipad|ipod/i.test(platform);}catch{return false;}}
  function replaying(){try{if(opts&&typeof opts.isReplay==='function')return !!opts.isReplay();const replay=window.CrucixReplay;return !!(replay&&typeof replay.active==='function'&&replay.active());}catch{return false;}}
  const nowMs=()=>{try{const value=opts&&typeof opts.now==='function'?opts.now():NaN;return Number.isFinite(value)?value:Date.now();}catch{return Date.now();}};
  const later=(fn,ms)=>typeof opts.schedule==='function'?opts.schedule(fn,ms):window.setTimeout(fn,ms);
  const cancel=handle=>{if(typeof opts.cancel==='function')opts.cancel(handle);else window.clearTimeout(handle);};

  // ===== Items =====
  function provided(fn){
    if(typeof fn!=='function')return [];
    try{const list=fn();return Array.isArray(list)?list:[];}catch(error){log(error);return [];}
  }
  // The group comes from where the item was listed; an item needs a label and a run().
  function clean(item,group){
    if(!item||typeof item!=='object'||typeof item.label!=='string'||!item.label.trim()||typeof item.run!=='function')return null;
    return {id:typeof item.id==='string'&&item.id?item.id:item.label,group,label:item.label,hint:typeof item.hint==='string'?item.hint:'',keywords:Array.isArray(item.keywords)?item.keywords.filter(word=>typeof word==='string'):[],run:()=>item.run()};
  }
  const collect=()=>[...(custom||provided(opts.actions)).map(item=>clean(item,'action')),...provided(opts.sources).map(item=>clean(item,'source'))].filter(Boolean);
  const isoMs=value=>{const ms=typeof value==='string'&&ISO_TIME.test(value)?Date.parse(value):NaN;return Number.isFinite(ms)?ms:null;};
  function openEvent(id){
    if(!EVENT_ID.test(id))return;
    const intelligence=window.CrucixIntelligence,fn=opts&&typeof opts.openEvent==='function'?opts.openEvent:intelligence&&intelligence.openEvent;
    if(typeof fn==='function')return fn(id);
  }
  // History answers: valid event ids only, the first 6; title as the label, kind · source · age as the hint.
  function toRecords(items){
    const R=window.CrucixRecords;
    return items.filter(item=>item!==null&&typeof item==='object'&&typeof item.id==='string'&&EVENT_ID.test(item.id)).slice(0,RECORDS).map(item=>{
      const id=item.id,title=typeof item.title==='string'&&item.title.trim()?item.title.trim().slice(0,300):'—';
      const kind=typeof item.kind==='string'&&item.kind?text('intelligence.kind_'+item.kind,item.kind):'';
      const source=item.source&&typeof item.source==='object'&&typeof item.source.name==='string'?item.source.name.slice(0,120):'';
      const ms=isoMs(item.lastSeenAt)??isoMs(item.observedAt)??isoMs(item.publishedAt);
      const age=ms!==null&&R&&typeof R.ageLabel==='function'?R.ageLabel(ms,nowMs()):'';
      return {id:'record:'+id,group:'record',label:title,hint:[kind,source,age].filter(Boolean).join(' · '),keywords:[],run:()=>openEvent(id)};
    });
  }
  const keyOf=item=>item.group+':'+item.id;
  // Stable option ids for the session: the same item keeps its id across redraws and opens (aria-activedescendant).
  function optionId(item){const key=keyOf(item);if(!ids.has(key))ids.set(key,'pl-o'+(++nextId));return ids.get(key);}

  // ===== Drawing =====
  function element(tag,className,content){const node=document.createElement(tag);if(className)node.className=className;if(content!==undefined)node.textContent=content;return node;}
  // A live region speaks on every write: text is only replaced when it changes.
  function write(node,value){if(node.textContent!==value)node.textContent=value;}
  function build(){
    const dialog=element('dialog','pl-dialog'),box=element('div','pl-box'),field=element('div','pl-field'),icon=element('span','pl-icon','›'),input=element('input','pl-input');
    const list=element('div','pl-list'),note=element('p','pl-note'),keys=element('p','pl-keys',say('keys')),status=element('p','pl-sr');
    dialog.id='palette';dialog.setAttribute('aria-label',say('dialogLabel'));icon.setAttribute('aria-hidden','true');
    input.id='palette-input';
    for(const [name,value] of [['type','text'],['role','combobox'],['aria-expanded','false'],['aria-controls','palette-list'],['aria-autocomplete','list'],['aria-label',say('inputLabel')],['aria-describedby','palette-keys'],
      ['placeholder',say('placeholder')],['autocomplete','off'],['spellcheck','false'],['maxlength',String(MAX_QUERY)],['data-palette-input','']])input.setAttribute(name,value);
    list.id='palette-list';list.setAttribute('role','listbox');list.setAttribute('aria-label',say('resultsLabel'));
    note.id='palette-note';keys.id='palette-keys';status.id='palette-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    field.append(icon,input);box.append(field,list,note,keys,status);dialog.append(box);
    input.addEventListener('keydown',guarded(onKey));
    input.addEventListener('input',guarded(onInput));
    list.addEventListener('click',guarded(onPick));
    // Esc is handled on the input; any other close request of the browser ends here the same way. The close event is queued: the one
    // of an earlier close can arrive after a quick reopen (Esc, then Ctrl+K), so only a dialog that is really closed ends the palette.
    dialog.addEventListener('cancel',guarded(event=>{event.preventDefault();close();}));
    dialog.addEventListener('close',guarded(()=>{if(opened&&!dialog.open)finish();}));
    // The backdrop closes only for a press and a release both on it (a drag out of the input ends with a click on the dialog too).
    let press={down:false,up:false};
    dialog.addEventListener('pointerdown',guarded(event=>{press={down:event.target===dialog,up:false};}));
    dialog.addEventListener('pointerup',guarded(event=>{press.up=event.target===dialog;}));
    dialog.addEventListener('click',guarded(event=>{const both=press.down&&press.up;press={down:false,up:false};if(event.target===dialog&&both)close();}));
    document.body.append(dialog);
    nodes={dialog,input,list,note,status};
  }
  function countText(n){return n===0?say('countNone'):say(n===1?'countOne':'count',{count:n});}
  function option(item,index){
    return `<li class="pl-opt" role="option" id="${optionId(item)}" data-palette-option="${index}" aria-selected="${index===active}"><span class="pl-mark" aria-hidden="true">›</span><span class="pl-text"><span class="pl-label">${escHtml(item.label)}</span>${item.hint?`<span class="pl-hint">${escHtml(item.hint)}</span>`:''}</span></li>`;
  }
  // reset: a new query starts at the top; otherwise (an answer arrived) the active item stays active when it is still listed.
  function draw(reset){
    const keep=!reset&&shown[active]?keyOf(shown[active]):null,q=query.trim(),found=records.slice(0,RECORDS);
    const ranked=core().rank(statics,q,{limit:LIMIT-found.length});
    // Actions and sources in the order of their best match, the records last.
    const order=[];for(const item of ranked)if(!order.includes(item.group))order.push(item.group);
    if(found.length)order.push('record');
    shown=order.flatMap(group=>group==='record'?found:ranked.filter(item=>item.group===group));
    const kept=keep===null?-1:shown.findIndex(item=>keyOf(item)===keep);
    active=shown.length?Math.max(kept,0):-1;
    nodes.list.innerHTML=order.map(group=>`<ul class="pl-group" role="group" aria-labelledby="pl-h-${group}"><li class="pl-head" id="pl-h-${group}" role="presentation">${escHtml(say(GROUP_KEY[group]))}</li>${shown.map((item,index)=>item.group===group?option(item,index):'').join('')}</ul>`).join('');
    if(reset)nodes.list.scrollTop=0;
    sync(false);
    const replayOn=q.length>=MIN_QUERY&&replaying(),quiet=replayOn?say('replayNote'):failed?say('historyFailed'):'';
    write(nodes.note,[!shown.length&&!searching?say('empty'):'',replayOn?quiet:searching?say('searching'):quiet].filter(Boolean).join(' '));
    write(nodes.status,[countText(shown.length),quiet].filter(Boolean).join('. '));
  }
  // The selection lives on the input (aria-activedescendant) and the options (aria-selected); the focus never leaves the input.
  function sync(scroll){
    const input=nodes.input,options=[...nodes.list.querySelectorAll('[role="option"]')],at=String(active);
    input.setAttribute('aria-expanded',String(shown.length>0));
    for(const node of options)node.setAttribute('aria-selected',String(node.getAttribute('data-palette-option')===at));
    const current=options.find(node=>node.getAttribute('data-palette-option')===at)||null;
    if(current)input.setAttribute('aria-activedescendant',current.id);else input.removeAttribute('aria-activedescendant');
    if(scroll&&current&&typeof current.scrollIntoView==='function')current.scrollIntoView({block:'nearest'});
  }
  function move(index){active=index;sync(true);}

  // ===== The history search =====
  // Cancels the delay and the running request; every answer started before is stale from now on.
  function stop(){
    if(timer!==null){cancel(timer);timer=null;}
    seq++;searching=false;
    if(controller){try{controller.abort();}catch{}controller=null;}
  }
  function search(q,mine){
    if(mine!==seq||!opened)return;
    const token=++seq;
    let signal=null,request;
    if(typeof AbortController==='function'){controller=new AbortController();signal=controller.signal;}
    try{request=Promise.resolve(opts.fetchJson('/api/history?q='+encodeURIComponent(q)+'&limit='+RECORDS,signal?{signal}:{}));}catch(error){request=Promise.reject(error);}
    const done=list=>{controller=null;searching=false;failed=list===null;records=list||[];draw(false);};
    request.then(data=>{if(token!==seq)return;done(data&&typeof data==='object'&&Array.isArray(data.items)?toRecords(data.items):null);},()=>{if(token===seq)done(null);}).catch(log);
  }
  function onInput(){
    stop();records=[];failed=false;
    query=String(nodes.input.value||'').slice(0,MAX_QUERY);
    const q=query.trim();
    if(q.length>=MIN_QUERY&&opts&&typeof opts.fetchJson==='function'&&!replaying()){
      searching=true;
      const mine=seq;
      timer=later(guarded(()=>{timer=null;search(q,mine);}),DELAY);
    }
    draw(true);
  }

  // ===== Open, close, run =====
  // Another modal holds the keys (see the header): the palette stays closed and the key goes on to the page.
  function blocked(){
    const own=nodes.dialog;
    if(own.inert===true||(typeof own.closest==='function'&&own.closest('[inert]')))return true;
    if(document.getElementById('ci-overlay'))return true;
    const settings=document.getElementById('settingsOverlay');
    if(settings&&(settings.getAttribute('class')||'').split(/\s+/).includes('show'))return true;
    for(const node of document.querySelectorAll('dialog'))if(node!==own&&node.open)return true;
    return false;
  }
  function open(){
    if(!opts||!nodes||opened||blocked())return false;
    opener=document.activeElement||null;
    statics=collect();records=[];query='';failed=false;searching=false;active=-1;
    nodes.input.value='';
    nodes.dialog.showModal();opened=true;
    nodes.input.focus();
    draw(true);
    return true;
  }
  const usable=node=>!!node&&node!==document.body&&node.isConnected!==false&&typeof node.focus==='function';
  // The dialog closes first (the page behind it is inert until then), then the focus goes back to where it was, or to the header
  // button of the rebuilt top bar.
  function finish(){
    opened=false;stop();
    if(nodes.dialog.open)nodes.dialog.close();
    const from=opener;opener=null;
    const target=usable(from)?from:document.getElementById('paletteTrigger');
    if(usable(target))target.focus({preventScroll:true});
  }
  function close(){if(opened)finish();}
  // The item runs after the palette closed and the focus is back: a dialog it opens returns the focus to the same place. An item that
  // rebuilds the top bar (a lens switch re-renders the dashboard) takes the restored focus with the old nodes: the focus then goes to
  // the node that now carries the opener's id, or to the header button. An item that moved the focus itself is left alone.
  function choose(index){
    const item=shown[index];
    if(!item)return;
    const back=opener&&typeof opener.id==='string'?opener.id:'';
    close();
    let result;
    try{result=item.run();}catch(error){log(error);refocus(back);return;}
    refocus(back);
    Promise.resolve(result).catch(log);
  }
  function refocus(back){
    const now=document.activeElement;
    if(now&&now!==document.body&&now.isConnected!==false)return;
    const target=(back&&document.getElementById(back))||document.getElementById('paletteTrigger');
    if(usable(target))target.focus({preventScroll:true});
  }
  function onKey(event){
    if(event.isComposing)return;
    const key=event.key;
    if(key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    // Tab would leave for the inert page or the browser: the focus stays on the input.
    if(key==='Tab'){event.preventDefault();return;}
    if(event.altKey||event.ctrlKey||event.metaKey)return;
    if(key==='Enter'){if(active>=0){event.preventDefault();choose(active);}return;}
    const n=shown.length;
    if(!n)return;
    const next=key==='ArrowDown'?(active+1)%n:key==='ArrowUp'?(active-1+n)%n:key==='Home'?0:key==='End'?n-1:-1;
    if(next<0)return;
    event.preventDefault();move(next);
  }
  function onPick(event){
    const node=event.target&&typeof event.target.closest==='function'?event.target.closest('[data-palette-option]'):null;
    if(!node)return;
    const index=Number(node.getAttribute('data-palette-option'));
    if(Number.isInteger(index))choose(index);
  }
  function onDocumentKey(event){
    const c=core();
    if(!c.isOpenKey(event))return;
    if(event.repeat){if(opened)event.preventDefault();return;}
    if(isMac()&&event.ctrlKey&&!event.metaKey&&c.shouldIgnoreTarget(event.target))return;
    if(opened){event.preventDefault();close();return;}
    if(open())event.preventDefault();
  }
  // The header button is rebuilt with the top bar: found by delegation.
  function onDocumentClick(event){
    const trigger=event.target&&typeof event.target.closest==='function'?event.target.closest('[data-palette-open]'):null;
    if(trigger)open();
  }
  // The header button with the platform's key hint (the accessible name is the word; the hint is aria-keyshortcuts). Empty before mount.
  function button(){
    if(!opts)return '';
    const mac=isMac();
    return `<button type="button" class="guide-btn pl-trigger" id="paletteTrigger" data-palette-open aria-haspopup="dialog" aria-keyshortcuts="${mac?'Meta+K':'Control+K'}">${escHtml(say('button'))} <kbd class="pl-kbd" aria-hidden="true">${mac?'⌘ K':'Ctrl K'}</kbd></button>`;
  }
  // Replaces the action list (null: back to options.actions()); an open palette redraws at once.
  function setActions(list){
    custom=Array.isArray(list)?list.slice():null;
    if(opened){statics=collect();draw(true);}
  }
  function mount(options){
    if(opts||!options||typeof options!=='object'||!core())return false;
    opts=options;build();
    document.addEventListener('keydown',guarded(onDocumentKey),true);
    document.addEventListener('click',guarded(onDocumentClick));
    return true;
  }
  window.CrucixPalette=Object.freeze({mount,open:guarded(()=>open()===true),close:guarded(close),isOpen:()=>opened,setActions:guarded(setActions),button:guarded(button)});
})(window,document);
