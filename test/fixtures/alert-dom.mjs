import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read=file=>readFileSync(new URL('../../dashboard/public/'+file,import.meta.url),'utf8');
// A minimal DOM for the alert controllers (alerts.js, alert-rules.js, record-inspector.js): elements keep their attributes, listeners and innerHTML; queries find nothing, except the toast nodes that
// insertAdjacentHTML adds (one per call, matched by class, level class or data-alert-id). Enough for mount/update/open, the
// toast stack and for driving the delegated click listener with a fake button.
const TOAST_SELECTOR=/^\.al-toast(-[a-z]+)?(?:\[data-alert-id="([^"]*)"\])?$/;
export function dom({protocol='http:',topbar=true,fetch,offline=false,files=['record-core.js','alerts-core.js','alerts.js'],hash=''}={}){
  const ids=new Map(),errors=[],calls=[],opened=[],listeners={document:{},window:{}},on=(table,type,fn)=>{(table[type]??=[]).push(fn);};
  const el=tag=>{const node={tag,id:'',hidden:false,className:'',innerHTML:'',textContent:'',attrs:{},handlers:{},listeners:{},kids:[],isConnected:true,focused:0,
    style:{setProperty(k,v){node.style[k]=v;}},classList:{set:new Set(),add(c){this.set.add(c);},remove(c){this.set.delete(c);},toggle(c,on){if(on)this.set.add(c);else this.set.delete(c);},contains(c){return this.set.has(c);}},
    setAttribute(k,v){node.attrs[k]=String(v);},getAttribute(k){return Object.hasOwn(node.attrs,k)?node.attrs[k]:null;},hasAttribute(k){return Object.hasOwn(node.attrs,k);},removeAttribute(k){delete node.attrs[k];},
    addEventListener(type,fn,options){const list=(node.listeners[type]??=[]);list.push({fn,capture:options===true||options?.capture===true});node.handlers[type]=event=>{for(const entry of [...list.filter(item=>item.capture),...list.filter(item=>!item.capture)])entry.fn(event);};},after(...nodes){nodes.forEach(add);},append(...nodes){nodes.forEach(add);},
    insertAdjacentHTML(_,html){node.innerHTML+=html;const kid={html,inner:{},contains:x=>x===kid.inner,remove(){node.kids=node.kids.filter(item=>item!==kid);node.innerHTML=node.innerHTML.replace(html,'');}};node.kids.push(kid);},
    querySelector(){return null;},querySelectorAll(selector){const m=TOAST_SELECTOR.exec(selector);return m?node.kids.filter(kid=>(!m[1]||kid.html.includes('al-toast'+m[1]+'"'))&&(m[2]===undefined||kid.html.includes(`data-alert-id="${m[2]}"`))):[];},
    contains(){return false;},closest(){return null;},getBoundingClientRect(){return {top:40,bottom:80};},focus(){node.focused++;}};return node;};
  const add=node=>{if(node.id)ids.set(node.id,node);};
  const document={title:'Crucix',activeElement:null,body:el('body'),createElement:el,getElementById:id=>ids.get(id)||null,querySelector(){return null;},querySelectorAll(){return [];},addEventListener:(type,fn)=>on(listeners.document,type,fn)};
  if(topbar){const bar=el('div');bar.id='topbar';add(bar);const bell=el('button');bell.id='alertBell';add(bell);}
  const spy=fetch||(async(url,init)=>{calls.push([url,init]);return {ok:true,status:200,json:async()=>({alerts:[]})};});
  const window={addEventListener:(type,fn)=>on(listeners.window,type,fn),CrucixIntelligence:{openEvent:id=>opened.push(id)},...(offline?{__CRUCIX_OFFLINE_SHELL__:true}:{})};
  const location={protocol,hash,pathname:'/',search:''};
  const context=vm.createContext({window,document,location,history:{replaceState(){}},console:{error:(...args)=>errors.push(args)},fetch:(...args)=>spy(...args),CSS:{escape:value=>String(value)},Date,URL,JSON,setTimeout,clearTimeout,setInterval:()=>0});
  for(const file of files)vm.runInContext(read(file),context);
  return {A:window.CrucixAlerts,window,document,location,listeners,errors,calls,opened,byId:id=>ids.get(id)};
}
