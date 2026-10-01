import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('service worker caches only the allowlisted static shell and never API/live HTML',async()=>{
  const handlers={};const stored=new Map();let fetches=0;
  const cache={async put(key,value){stored.set(String(key),value)},async match(key){return stored.get(String(key))?.clone()}};
  const self={location:{origin:'http://localhost:3117'},addEventListener:(name,fn)=>handlers[name]=fn,clients:{claim:async()=>{}},skipWaiting:async()=>{}};
  let mode='offline';
  const fetch=async request=>{fetches++;const url=typeof request==='string'?request:request.url;
    if(url==='http://localhost:3117/'&&mode==='denied')return new Response('Denied',{status:401});
    if(url==='http://localhost:3117/'&&mode==='online')return new Response('Live intelligence');
    if(url==='http://localhost:3117/intelligence.js'&&mode==='online')return new Response('Updated app');
    if(url.includes('/api/')||url.endsWith('/'))throw new Error('Offline');if(url.endsWith('/vendor/manifest.json'))return new Response(JSON.stringify({assets:[{path:'/vendor/test.js'}]}),{headers:{'Content-Type':'application/json'}});return new Response('static shell');};
  vm.runInNewContext(readFileSync(new URL('../dashboard/public/sw.js',import.meta.url),'utf8'),{self,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch,URL,Request,Response,Set,Promise});
  let pending;handlers.install({waitUntil:p=>pending=p});await pending;
  assert.ok(stored.has('/offline-shell'));assert.ok(stored.has('/vendor/test.js'));assert.ok(!stored.has('/'));
  for(const path of ['/api/data','/api/history','/api/export','/events','/healthz','/jarvis.html','/unlisted.js']) {
    let intercepted=false;handlers.fetch({request:{url:'http://localhost:3117'+path,method:'GET',mode:'cors',headers:new Headers()},respondWith:()=>intercepted=true});assert.equal(intercepted,false,path);
  }
  let response;handlers.fetch({request:{url:'http://localhost:3117/',method:'GET',mode:'navigate',headers:new Headers()},respondWith:p=>response=p});
  assert.equal(await (await response).text(),'static shell');
  mode='denied';handlers.fetch({request:{url:'http://localhost:3117/',method:'GET',mode:'navigate',headers:new Headers({Authorization:'Basic test'})},respondWith:p=>response=p});assert.equal((await response).status,401);
  mode='online';handlers.fetch({request:{url:'http://localhost:3117/',method:'GET',mode:'navigate',headers:new Headers()},respondWith:p=>response=p});assert.equal(await (await response).text(),'Live intelligence');
  handlers.fetch({request:{url:'http://localhost:3117/intelligence.js',method:'GET',mode:'cors',headers:new Headers()},respondWith:p=>response=p});assert.equal(await (await response).text(),'Updated app');
  assert.equal(await stored.get('/intelligence.js').text(),'static shell','Online application code is not silently written over the versioned offline shell');
  assert.ok(fetches>0);assert.ok(!stored.has('/'));
});

test('offline shell replaces intelligence with an empty snapshot and inert JSON',async()=>{
  const { renderOfflineShell }=await import('../lib/offline-shell.mjs');
  const html=renderOfflineShell('<head></head><script>\nlet D = {"secret":"operator snapshot"};\n</script>',{meta:{code:'hu'},text:'</script>'});
  assert.ok(!html.includes('operator snapshot'));assert.ok(html.includes('"events":[]'));assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes('__CRUCIX_OFFLINE_SHELL__'));
  assert.throws(()=>renderOfflineShell('<script>const operatorData = {secret:1};</script>',{}),/exactly one/);
});

test('all pinned vendor assets match the SHA-256 ledger',()=>{
  const ledger=JSON.parse(readFileSync(new URL('../dashboard/public/vendor/manifest.json',import.meta.url),'utf8'));
  assert.ok(ledger.assets.length>=20);
  for(const asset of ledger.assets) {
    assert.match(asset.path,/^\/vendor\/[a-zA-Z0-9./_-]+$/);assert.ok(!asset.path.includes('..'));
    const data=readFileSync(new URL('../dashboard/public'+asset.path,import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'),asset.sha256,asset.path);
  }
});
