(function(window){
  'use strict';
  // The command palette's pure logic (palette.js draws it): matching a query against item labels, ranking, and the key rules.
  // Matching folds case and diacritics (NFD, combining marks dropped), so "termeszeti" finds "Természeti veszélyek" and "chaine"
  // finds "chaîne". Tiers: the whole label, a label prefix, a word prefix (a word starts after anything that is not a letter or a
  // digit), the query's characters in order (spaces in the query skipped). Ties keep the items' own order.
  const LIMIT=12,EXACT=4,PREFIX=3,WORD=2,LOOSE=1;
  const NOT_TEXT=['button','checkbox','radio','range','submit','reset','file','color','image','hidden'];
  const fold=value=>typeof value==='string'?value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim():'';
  const wordChar=/[\p{L}\p{N}]/u;
  // q and label are folded already.
  function tier(q,label){
    if(!q||!label)return 0;
    if(label===q)return EXACT;
    if(label.startsWith(q))return PREFIX;
    for(let at=label.indexOf(q,1);at>0;at=label.indexOf(q,at+1))if(!wordChar.test(label[at-1]))return WORD;
    const chars=q.replace(/ /g,'');
    let from=0;
    for(const char of chars){const at=label.indexOf(char,from);if(at<0)return 0;from=at+char.length;}
    return LOOSE;
  }
  // 0 = no match; a higher number is a better match.
  const score=(query,label)=>tier(fold(query),fold(label));
  const usable=item=>item!==null&&typeof item==='object'&&typeof item.label==='string';
  // An item's best tier over its label and its keywords (a source's domain name and id, a lens's domain id).
  const best=(item,q)=>Math.max(tier(q,fold(item.label)),...(Array.isArray(item.keywords)?item.keywords:[]).map(word=>tier(q,fold(word))));
  // The matching items, best first, at most `limit` (12). An empty query lists the actions only (the first `limit`), never every source.
  function rank(items,query,options){
    const limit=options&&Number.isInteger(options.limit)&&options.limit>0?options.limit:LIMIT;
    const list=Array.isArray(items)?items.filter(usable):[],q=fold(query);
    if(!q)return list.filter(item=>item.group==='action').slice(0,limit);
    return list.map((item,index)=>({item,index,score:best(item,q)})).filter(entry=>entry.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(entry=>entry.item);
  }
  // Ctrl+K or Cmd+K, not with Alt or Shift, not while an input method composes. The letter decides on a Latin layout; on another
  // script (a Cyrillic layout types "л") the physical K key does.
  function isOpenKey(event){
    if(!event||typeof event!=='object'||event.isComposing||event.altKey||event.shiftKey||!(event.ctrlKey||event.metaKey))return false;
    const key=typeof event.key==='string'?event.key:'';
    return /^[a-z]$/i.test(key)?key.toLowerCase()==='k':event.code==='KeyK';
  }
  // A text field other than the palette's own input: where a plain Ctrl+K belongs to the field on macOS (delete to the end of the
  // line). The palette's input is never ignored, so the open key closes the palette from there.
  function shouldIgnoreTarget(target){
    if(!target||typeof target!=='object')return false;
    if(typeof target.hasAttribute==='function'&&target.hasAttribute('data-palette-input'))return false;
    if(target.isContentEditable===true)return true;
    const tag=typeof target.tagName==='string'?target.tagName.toUpperCase():'';
    if(tag==='TEXTAREA'||tag==='SELECT')return true;
    if(tag!=='INPUT')return false;
    const type=typeof target.type==='string'&&target.type?target.type.toLowerCase():'text';
    return !NOT_TEXT.includes(type);
  }
  window.CrucixPaletteCore=Object.freeze({score,rank,isOpenKey,shouldIgnoreTarget});
})(window);
