(function(window,document){
  'use strict';
  // Source-health matrix: a modal <dialog> with every source x the last N archived sweeps (GET /api/source-health?sweeps=N), grouped by
  // domain, one cell per source and sweep, the run time of the newest sweep in the last column. A state is a glyph and a word, never
  // colour alone. A cell is a button: the page decides what opening its sweep means. mount(options):
  //   fetchJson(url)    -> Promise<object>; a rejection may carry .status (404/503 = the archive is not there)
  //   t(key, fallback)  the page's text: group `matrix`, plus `lenses.<domain>` for the group names and `status.unknownTime`
  //   esc(value)        optional HTML escaper (a built-in one otherwise)
  //   onOpenSweep(id)   a cell of that sweep was chosen (may return a promise); the page closes the dialog when it wants to
  //   onAvailability()  the archive got its first sweep (or lost the last one): the page redraws the panel header's button
  //   locale            BCP 47 tag of the time labels (the page language, as replay.js gets it)
  // The panel button comes from button() and is found by delegation, so a panel rebuilt with innerHTML needs no rebinding. A cell of a
  // sweep id that is not a real archive id is plain text; every real sweep column is clickable, even where the source has no data
  // (the sweep exists). If the sweep has been pruned since, the replay says so.
  const SWEEP_ID=/^sweep-\d{8}T\d{6}Z$/,SWEEP_TIME=/^sweep-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
  const ISO_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
  // The sweep counts offered up to the archive's retention (the retention itself is always the last choice).
  const STEPS=[12,24,48,96,192,384],DEFAULT_SWEEPS=48;
  const STATES={0:'ok',1:'stale',2:'error',3:'disabled'},GLYPHS={ok:'✓',stale:'◔',error:'✕',disabled:'–',nodata:'·'};
  const WORDS={ok:'stateOk',stale:'stateStale',error:'stateError',disabled:'stateDisabled',nodata:'stateNoData'};
  const COPY={title:'Source health matrix',trigger:'Matrix',caption:'Source status in each archived sweep, oldest to newest',openHint:'The newest sweep is on the right. Select a cell to replay that sweep.',
    sweeps:'Sweeps shown',source:'Source',ms:'Last run (ms)',stateOk:'OK',stateStale:'Stale',stateError:'Error',stateDisabled:'Disabled',stateNoData:'No data',other:'Other sources',
    loading:'Loading the matrix…',empty:'No archived sweeps yet.',noSources:'No source reported for this domain in the shown sweeps.',
    error:'Could not load the source health. Close and reopen this window to try again.',close:'Close'};
  const MOVES={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]};
  let opts=null,nodes=null,model=null,archive=0,probing=null,seq=0,opener=null,skipFocus=false;
  const log=error=>{try{console.error('[health-matrix]',error);}catch{}};
  const guarded=fn=>(...args)=>{try{return fn(...args);}catch(error){log(error);}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const escHtml=value=>{if(opts&&typeof opts.esc==='function')try{return String(opts.esc(value));}catch{}return esc(value);};
  // Plain text (textContent and DOM attributes); escaped only where it goes into markup.
  function text(path,fallback){try{const value=opts&&typeof opts.t==='function'?opts.t(path,fallback):fallback;return typeof value==='string'&&value?value:fallback;}catch{return fallback;}}
  const say=key=>text('matrix.'+key,COPY[key]);
  const ids=()=>{const domains=window.CrucixDomains;return domains&&Array.isArray(domains.DOMAIN_IDS)?domains.DOMAIN_IDS:[];};
  function lensId(){try{const id=window.CrucixLens?window.CrucixLens.get():'all';return typeof id==='string'&&ids().includes(id)?id:'all';}catch{return 'all';}}
  const groupOf=item=>typeof item.domain==='string'&&ids().includes(item.domain)?item.domain:null;
  const groupName=domain=>domain===null?say('other'):text('lenses.'+domain,domain);
  const note=key=>`<p class="hm-note">${escHtml(say(key))}</p>`;

  // ===== Times =====
  const isoTime=value=>{const ms=typeof value==='string'&&ISO_TIME.test(value)?Date.parse(value):NaN;return Number.isFinite(ms)?ms:null;};
  const idTime=id=>{const m=typeof id==='string'?SWEEP_TIME.exec(id):null;return m?Date.UTC(+m[1],m[2]-1,+m[3],+m[4],+m[5],+m[6]):null;};
  const sweepTime=entry=>entry&&typeof entry==='object'?isoTime(entry.timestamp)??idTime(entry.id):null;
  // The short time heads the column; the full label (as replay.js writes it) is what a screen reader gets.
  function stamps(ms){
    const date=new Date(ms),locale=opts&&opts.locale||undefined;
    try{return {time:date.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),day:date.toLocaleDateString(locale,{month:'short',day:'numeric'}),full:date.toLocaleString(locale,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};}
    catch{const iso=date.toISOString();return {time:iso.slice(11,16),day:iso.slice(5,10),full:iso.slice(0,16).replace('T',' ')+' UTC'};}
  }
  function head(entry,previousDay){
    const ms=sweepTime(entry);
    if(ms===null){const unknown=escHtml(text('status.unknownTime','Unknown time'));return {markup:`<th scope="col" class="hm-time" title="${unknown}"><span class="hm-sr">${unknown}</span><span class="hm-t" aria-hidden="true">?</span></th>`,day:previousDay};}
    const stamp=stamps(ms);
    return {markup:`<th scope="col" class="hm-time" title="${escHtml(stamp.full)}"><span class="hm-sr">${escHtml(stamp.full)}</span>${stamp.day!==previousDay?`<span class="hm-d" aria-hidden="true">${escHtml(stamp.day)}</span>`:''}<span class="hm-t" aria-hidden="true">${escHtml(stamp.time)}</span></th>`,day:stamp.day};
  }

  // ===== The table =====
  // answer: the /api/source-health answer. Pure: markup only. Groups follow the domain order, the active lens keeps only its own.
  function render(answer){
    const sweeps=answer&&typeof answer==='object'&&Array.isArray(answer.sweeps)?answer.sweeps:[];
    if(!sweeps.length)return note('empty');
    const sources=Array.isArray(answer.sources)?answer.sources.filter(item=>item&&typeof item==='object'&&typeof item.source==='string'):[];
    const lens=lensId(),groups=[...ids(),null].filter(domain=>lens==='all'||domain===lens).map(domain=>({domain,rows:sources.filter(item=>groupOf(item)===domain)})).filter(group=>group.rows.length);
    if(!groups.length)return note('noSources');
    const words={};for(const state of Object.keys(GLYPHS))words[state]=escHtml(say(WORDS[state]));
    let day=null,firstRow=true;
    const heads=sweeps.map(entry=>{const column=head(entry,day);day=column.day;return column.markup;}).join('');
    // One tab stop for the whole grid: the newest clickable cell of the first row (the table opens scrolled to the newest sweeps, so
    // Tab does not scroll it back); the arrow keys move between the cells.
    const valid=entry=>!!entry&&typeof entry==='object'&&typeof entry.id==='string'&&SWEEP_ID.test(entry.id);
    const stopColumn=sweeps.map(valid).lastIndexOf(true);
    const cell=(code,entry,stop)=>{
      const state=typeof code==='number'&&Object.hasOwn(STATES,code)?STATES[code]:'nodata';
      const inner=`<span class="hm-g" aria-hidden="true">${GLYPHS[state]}</span><span class="hm-sr">${words[state]}</span>`;
      if(!valid(entry))return `<td class="hm-c"><span class="hm-cell" data-state="${state}">${inner}</span></td>`;
      return `<td class="hm-c"><button type="button" class="hm-cell" data-state="${state}" data-hm-sweep="${escHtml(entry.id)}" tabindex="${stop?0:-1}">${inner}</button></td>`;
    };
    const row=item=>{
      const cells=Array.isArray(item.cells)?item.cells:[],last=cells[sweeps.length-1],stopRow=firstRow;
      firstRow=false;
      const ms=Array.isArray(last)&&typeof last[1]==='number'&&Number.isFinite(last[1])&&last[1]>=0?Math.round(last[1]):null;
      return `<tr class="hm-row"><th scope="row" class="hm-src">${escHtml(item.source)}</th>${sweeps.map((entry,index)=>cell(Array.isArray(cells[index])?cells[index][0]:undefined,entry,stopRow&&index===stopColumn)).join('')}<td class="hm-ms">${ms===null?`<span aria-hidden="true">—</span><span class="hm-sr">${words.nodata}</span>`:ms}</td></tr>`;
    };
    const body=groups.map(group=>`<tbody class="hm-group" data-domain="${group.domain===null?'other':escHtml(group.domain)}"><tr class="hm-group-row"><th scope="rowgroup" colspan="${sweeps.length+2}"><span class="hm-gl">${escHtml(groupName(group.domain))}</span></th></tr>${group.rows.map(row).join('')}</tbody>`).join('');
    return `<table class="hm-table"><caption class="hm-sr">${escHtml(say('caption'))}</caption><thead><tr><th scope="col" class="hm-src-h">${escHtml(say('source'))}</th>${heads}<th scope="col" class="hm-ms-h">${escHtml(say('ms'))}</th></tr></thead>${body}</table>`;
  }

  // ===== The archive =====
  const unavailable=error=>!!error&&(error.status===404||error.status===503);
  function learn(count){const was=archive>0;archive=count;if(was!==count>0)try{opts.onAvailability?.();}catch(error){log(error);}}
  // GET /api/sweeps: how many sweeps there are and how many the archive keeps (the longest series that can be asked for). One request
  // at a time. 404/503 = no archive; any other failure is thrown and leaves what was known.
  function probe(){
    if(probing)return probing;
    const request=async()=>{
      try{
        const data=await opts.fetchJson('/api/sweeps'),list=data&&typeof data==='object'&&Array.isArray(data.sweeps)?data.sweeps:[];
        const kept=data&&data.retention&&typeof data.retention==='object'?data.retention.count:null;
        learn(list.length);
        return {sweeps:list.length,count:Number.isSafeInteger(kept)&&kept>=1?kept:list.length};
      }catch(error){if(unavailable(error)){learn(0);return {sweeps:0,count:0};}throw error;}
    };
    probing=request().finally(()=>{probing=null;});
    return probing;
  }
  // The panel header button looks again only while no sweep has been seen (a live update calls this).
  const refresh=()=>!opts||archive>0?Promise.resolve(archive>0):probe().then(()=>archive>0,()=>false);
  const button=()=>opts&&archive>0?`<button type="button" class="hm-open" id="healthMatrixTrigger" data-health-matrix aria-haspopup="dialog" title="${escHtml(say('title'))}">${escHtml(say('trigger'))}</button>`:'';

  // ===== The dialog =====
  function element(tag,className,content){const node=document.createElement(tag);if(className)node.className=className;if(content!==undefined)node.textContent=content;return node;}
  function build(){
    const dialog=element('dialog','hm-dialog'),body=element('div','hm-body'),top=element('div','hm-head'),title=element('h2','hm-title',say('title'));
    dialog.id='health-matrix';dialog.setAttribute('aria-labelledby','hm-title');title.id='hm-title';
    const closeButton=element('button','hm-close',say('close'));closeButton.type='button';
    top.append(title,closeButton);
    const tools=element('div','hm-tools'),label=element('label','hm-label',say('sweeps')),select=element('select','hm-count');
    select.id='hm-count';label.setAttribute('for','hm-count');tools.append(label,select);
    // The glyphs are explained once for sighted users; every cell already carries its word for assistive technology.
    const legend=element('p','hm-legend');legend.setAttribute('aria-hidden','true');
    for(const state of Object.keys(GLYPHS)){const key=element('span','hm-key');key.setAttribute('data-state',state);key.append(element('span','hm-g',GLYPHS[state]),' '+say(WORDS[state]));legend.append(key);}
    const status=element('p','hm-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const scroll=element('div','hm-scroll');
    body.append(top,element('p','hm-hint',say('openHint')),tools,legend,status,scroll);dialog.append(body);
    // A click on the backdrop closes only when the press and the release were both on it: a text selection dragged out of the table
    // ends with a click whose target is the dialog too.
    let press={down:false,up:false};
    dialog.addEventListener('pointerdown',guarded(event=>{press={down:event.target===dialog,up:false};}));
    dialog.addEventListener('pointerup',guarded(event=>{press.up=event.target===dialog;}));
    dialog.addEventListener('click',guarded(event=>{const both=press.down&&press.up;press={down:false,up:false};if(event.target===dialog&&both)closeDialog();}));
    dialog.addEventListener('close',guarded(closed));
    closeButton.addEventListener('click',guarded(()=>closeDialog()));
    select.addEventListener('change',guarded(()=>reload(Number(select.value))));
    scroll.addEventListener('click',guarded(chosen));
    scroll.addEventListener('keydown',guarded(navigate));
    document.body.append(dialog);
    tools.hidden=true;legend.hidden=true;
    nodes={dialog,tools,legend,select,status,scroll};
  }
  // The legend only makes sense next to a table.
  const paint=markup=>{nodes.scroll.innerHTML=markup;nodes.legend.hidden=!markup.startsWith('<table');};
  function busy(on){nodes.scroll.setAttribute('aria-busy',String(on));nodes.status.textContent=on?say('loading'):'';}
  function empty(){model=null;busy(false);nodes.tools.hidden=true;paint(note('empty'));return true;}
  function failed(){model=null;busy(false);paint('');nodes.status.textContent=say('error');return false;}
  function choices(count){
    const values=[...STEPS.filter(step=>step<count),count],select=nodes.select;
    select.replaceChildren(...values.map(value=>{const option=element('option',undefined,String(value));option.value=String(value);return option;}));
    select.value=String(Math.min(DEFAULT_SWEEPS,count));
    nodes.tools.hidden=false;
  }
  // `mine` is the request's sequence number: another open, a new choice or a close since makes this answer stale.
  async function series(count,mine){
    busy(true);
    let data;
    try{data=await opts.fetchJson('/api/source-health?sweeps='+count);}
    catch(error){if(mine!==seq)return false;return unavailable(error)?empty():failed();}
    if(mine!==seq)return false;
    let markup;
    try{markup=render(data);}catch(error){log(error);return failed();}
    model=data;busy(false);paint(markup);
    nodes.scroll.scrollLeft=nodes.scroll.scrollWidth;
    return true;
  }
  function reload(count){if(!opts||!nodes||!Number.isInteger(count)||count<1)return;series(count,++seq).catch(log);}
  // Resolves true when the dialog shows an answer (a table or the empty state); false after a failure or when something newer took over.
  async function open(){
    if(!opts)return false;
    const mine=++seq;
    if(!nodes)build();
    if(!nodes.dialog.open){opener=document.activeElement||null;nodes.dialog.showModal();}
    // A table from an earlier open (an older answer, maybe another lens) is not shown while the new one loads.
    model=null;paint('');busy(true);
    let info;
    try{info=await probe();}catch{if(mine!==seq)return false;nodes.tools.hidden=true;return failed();}
    if(mine!==seq)return false;
    if(!info.sweeps)return empty();
    choices(info.count);
    return series(Number(nodes.select.value),mine);
  }
  function closeDialog(options){
    if(!nodes||!nodes.dialog.open)return;
    skipFocus=!!options&&options.focus===false;
    nodes.dialog.close();
  }
  const usable=node=>!!node&&node!==document.body&&node.isConnected!==false&&typeof node.focus==='function';
  // Esc, the Close button, the backdrop and close() all end here: late answers are dropped and the focus goes back to the opener (or to
  // the button of the rebuilt panel when the opener left the page), unless the page is moving it elsewhere.
  function closed(){
    if(nodes.dialog.open)return;
    seq++;
    const from=opener,skip=skipFocus;opener=null;skipFocus=false;
    if(skip)return;
    const target=usable(from)?from:document.getElementById('healthMatrixTrigger');
    if(usable(target))target.focus();
  }

  // ===== Events =====
  function chosen(event){
    const cell=event.target&&typeof event.target.closest==='function'?event.target.closest('[data-hm-sweep]'):null;
    if(!cell)return;
    const id=cell.getAttribute('data-hm-sweep');
    if(typeof id!=='string'||!SWEEP_ID.test(id)||!opts||typeof opts.onOpenSweep!=='function')return;
    // A synchronous throw is caught by guarded() around this handler, a rejection here.
    Promise.resolve(opts.onOpenSweep(id)).catch(log);
  }
  // Arrow keys move between the cells (rows and columns, skipping what cannot be clicked), Home/End go to the ends of the row.
  function navigate(event){
    if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    const current=event.target&&typeof event.target.closest==='function'?event.target.closest('button[data-hm-sweep]'):null;
    const move=Object.hasOwn(MOVES,event.key)?MOVES[event.key]:null,edge=event.key==='Home'||event.key==='End';
    if(!current||!(move||edge))return;
    const cell=current.closest('td'),rows=[...nodes.scroll.querySelectorAll('tr.hm-row')];
    let target=null;
    if(edge){const own=[...cell.parentNode.querySelectorAll('button[data-hm-sweep]')];target=event.key==='Home'?own[0]:own[own.length-1];}
    else for(let r=rows.indexOf(cell.parentNode)+move[0],c=cell.cellIndex+move[1];rows[r]&&rows[r].cells[c]&&!target;r+=move[0],c+=move[1])target=rows[r].cells[c].querySelector('button[data-hm-sweep]');
    if(!target)return;
    event.preventDefault();
    const stop=nodes.scroll.querySelector('button[data-hm-sweep][tabindex="0"]');
    if(stop&&stop!==target)stop.setAttribute('tabindex','-1');
    target.setAttribute('tabindex','0');target.focus();
  }
  // The panel button is rebuilt with the panel: found by delegation.
  function onDocumentClick(event){
    const trigger=event.target&&typeof event.target.closest==='function'?event.target.closest('[data-health-matrix]'):null;
    if(trigger)api.open();
  }
  function mount(options){
    if(opts||!options||typeof options!=='object'||typeof options.fetchJson!=='function')return false;
    opts=options;
    document.addEventListener('click',guarded(onDocumentClick));
    // A lens change redraws an open table from the answer already received.
    try{if(window.CrucixLens&&typeof window.CrucixLens.onChange==='function')window.CrucixLens.onChange(guarded(()=>{if(nodes&&nodes.dialog.open&&model)paint(render(model));}));}catch(error){log(error);}
    probe().catch(()=>{});
    return true;
  }
  const api=Object.freeze({mount,open:()=>open().catch(error=>{log(error);return false;}),close:guarded(closeDialog),render,button:guarded(button),refresh});
  window.CrucixHealthMatrix=api;
})(window,document);
