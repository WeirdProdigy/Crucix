import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function fixture({broken=false}={}) {
  const values=new Map();let closed=0;
  const db={close(){closed++;},transaction(){
    if(broken)throw new Error('Missing store');
    let pending=0,finished=false;const tx={abort(){finished=true;queueMicrotask(()=>tx.onabort?.());},objectStore(){return store;}};
    const schedule=fn=>{pending++;queueMicrotask(()=>{fn();pending--;if(!pending&&!finished){finished=true;queueMicrotask(()=>tx.oncomplete?.());}});};
    const store={get(key){const request={};schedule(()=>{request.result=structuredClone(values.get(key));request.onsuccess?.();});return request;},put(value,key){schedule(()=>values.set(key,structuredClone(value)));},delete(key){schedule(()=>values.delete(key));}};return tx;
  }};
  const window={indexedDB:{open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}},navigator:{},addEventListener(){}};
  const document={querySelector:()=>null};
  vm.runInNewContext(readFileSync(new URL('../dashboard/public/pwa.js',import.meta.url),'utf8'),{window,document,TextEncoder,Date,JSON,Promise,Error,Object,Number,Array});
  return {api:window.CrucixPWA,values,closed:()=>closed};
}
const snapshot=(timestamp=new Date().toISOString())=>({meta:{timestamp},events:[],health:[],privateConfig:{password:'must not persist'}});

test('offline data storage is explicit, bounded, monotonic and clear disables future saves',async()=>{
  const {api,values}=fixture();
  assert.equal(await api.saveSnapshot(snapshot()),false);assert.equal(values.has('snapshot'),false);
  await api.setOfflineEnabled(true);const fresh=snapshot();assert.equal(await api.saveSnapshot(fresh),true);
  const saved=await api.restoreSnapshot();assert.equal(saved.data.meta.timestamp,fresh.meta.timestamp);assert.equal(saved.data.privateConfig,undefined);
  assert.equal(await api.saveSnapshot(snapshot(new Date(Date.now()-3600000).toISOString())),false);
  await api.clearSnapshot();assert.equal(await api.restoreSnapshot(),null);assert.equal(await api.saveSnapshot(snapshot()),false);assert.equal(values.has('snapshot'),false);
});

test('future or oversized corrupt offline data is ignored and a fresh save heals it',async()=>{
  const {api,values}=fixture();values.set('enabled',true);
  values.set('snapshot',{data:snapshot(new Date(Date.now()+86400000).toISOString()),savedAt:'bad'});
  assert.equal(await api.restoreSnapshot(),null);assert.equal(await api.saveSnapshot(snapshot()),true);
  values.set('snapshot',{data:{...snapshot(),news:[{title:'x'.repeat(6*1024*1024)}]}});
  assert.equal(await api.restoreSnapshot(),null);assert.equal(await api.saveSnapshot(snapshot()),true);
  assert.equal(await api.saveSnapshot(snapshot('2026-02-30T00:00:00Z')),false);
});

test('a failed IDB transaction closes the connection instead of leaking it',async()=>{
  const {api,closed}=fixture({broken:true});await assert.rejects(api.clearSnapshot(),/Missing store/);assert.equal(closed(),1);
});
