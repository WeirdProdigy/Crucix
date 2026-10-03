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

test('the alert client is in the shell cache and loads after its dependencies',()=>{
  const sw=readFileSync(new URL('../dashboard/public/sw.js',import.meta.url),'utf8'),base=JSON.parse(sw.match(/const BASE = (\[[^\]]*\]);/)[1].replace(/'/g,'"'));
  for(const path of ['/alerts-core.js','/alerts.js','/alert-rules.js','/alerts.css'])assert.ok(base.includes(path),path+' is in BASE');
  const html=readFileSync(new URL('../dashboard/public/jarvis.html',import.meta.url),'utf8'),at=needle=>{const i=html.indexOf(needle);assert.ok(i>0,needle);return i;};
  assert.ok(at('<script src="record-core.js">')<at('<script src="alerts-core.js">')&&at('<script src="alerts-core.js">')<at('<script src="alerts.js">'),'record-core -> alerts-core -> alerts');
  assert.ok(at('<script src="alerts.js">')<at('<script src="alert-rules.js">'),'the rule editor loads after the alert controller');
  assert.ok(at('href="record-inspector.css"')<at('href="alerts.css"'),'alerts.css overrides after record-inspector.css');
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

test('shell text: no mojibake (UTF-8 read as Latin-1) in the dashboard files and one list style for the shell paths',()=>{
  const dir=new URL('../dashboard/public/',import.meta.url);
  for(const name of ['pwa.js','sw.js','replay.js','palette.js','health-matrix.js','changes.js','live-sources.js','lens.js','jarvis.html'])assert.doesNotMatch(readFileSync(new URL(name,dir),'utf8'),/â€|Ã[\u0080-¿]/,name);
  assert.match(readFileSync(new URL('pwa.js',dir),'utf8'),/Use your browser’s Install app menu/,'the install help fallback has a real apostrophe');
  const sw=readFileSync(new URL('sw.js',dir),'utf8'),base=sw.match(/const BASE = \[([^\]]*)\];/)[1];
  assert.doesNotMatch(base,/','/,'every shell path is followed by a comma and a space');
});
