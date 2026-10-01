// Deterministic browser checks against test/fixtures/dashboard-server.mjs only.
// Playwright is an optional QA dependency; no application credentials or source APIs are used.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const requested=new URL(process.env.QA_URL||'http://127.0.0.1:3199');
assert(['127.0.0.1','localhost'].includes(requested.hostname)&&requested.pathname==='/'&&requested.protocol==='http:','Use the local deterministic QA fixture');
const qaUrl=requested.origin;
const artifactDir=fileURLToPath(new URL('../docs/audit/images/',import.meta.url));
fs.mkdirSync(artifactDir,{recursive:true});
const artifact=name=>join(artifactDir,name);

async function mainChecks(){
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
 try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const locale=JSON.parse(fs.readFileSync(new URL('../locales/hu.json',import.meta.url),'utf8'));
 await ctx.addInitScript(l=>window.__CRUCIX_LOCALE__=l,locale);
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const consoleWarnings=[];page.on('console',m=>{if(m.type()==='warning')consoleWarnings.push(m.text())});const consoleErrors=[];page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
 await page.goto(qaUrl,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForSelector('#main .g-panel');await page.waitForTimeout(5500);
 console.log('IDENTITY',await page.title(),await page.url());
 console.log('STATE',await page.evaluate(()=>({d3:typeof d3,flat:!!flatG,globe:!!globe,layers:document.querySelectorAll('.markers [data-layer]').length,live:document.getElementById('liveStatus')?.textContent,errors:window.__injected,body:document.body.innerText.slice(0,250)})));
 assert.strictEqual(await page.evaluate(()=>window.__injected),undefined);
 assert.strictEqual(await page.locator('[data-source-state="disabled"]').count(),1);
 assert.strictEqual(await page.locator('[data-source-state="error"]').count(),1);
 assert.strictEqual(await page.locator('[data-source-state="stale"]').count(),1);
 assert.strictEqual(await page.locator('.idea-type.hedge').count(),1);
 assert((await page.locator('.lp-ideas').innerText()).includes('SZABÁLYOK'));
 await page.locator('#settingsTrigger').click();
 assert.strictEqual(await page.evaluate(()=>document.getElementById('main').inert),true);
 assert.strictEqual(await page.locator('#settingsOverlay').getAttribute('aria-hidden'),'false');
 assert.strictEqual(await page.locator('input[data-layer-id]').count(),13);
 const quakeBefore=await page.locator('.markers [data-layer="earthquake"]').count();console.log('QUAKE',quakeBefore);assert.strictEqual(quakeBefore,1);
 await page.locator('#layer-earthquake').uncheck();assert.strictEqual(await page.locator('.markers [data-layer="earthquake"]').count(),0);
 await page.locator('#layer-earthquake').check();assert.strictEqual(await page.locator('.markers [data-layer="earthquake"]').count(),1);
 const kinds=await page.evaluate(()=>mapLayerRegistry.map(l=>({id:l.id,types:l.types})));
 for(const layer of kinds){
   await page.locator('#layer-'+layer.id).uncheck();
   const count=await page.evaluate(types=>[...document.querySelectorAll('.markers [data-layer]')].filter(el=>types.includes(el.dataset.layer)).length,layer.types);
   assert.strictEqual(count,0,'hidden layer '+layer.id);await page.locator('#layer-'+layer.id).check();
 }
 const before=await page.evaluate(()=>dashboardLayout.zones.left[0]);await page.locator('#module-'+before).focus();await page.keyboard.press('Alt+ArrowDown');
 assert.strictEqual(await page.evaluate(()=>dashboardLayout.zones.left[1]),before);
 assert.strictEqual(await page.evaluate(()=>document.activeElement.id),'module-'+before);
 await page.locator('#zone-tradeIdeas').selectOption('right');assert(await page.evaluate(()=>dashboardLayout.zones.right.includes('tradeIdeas')));
 const dragId=await page.evaluate(()=>dashboardLayout.zones.left[0]);
 await page.locator('#module-'+dragId+' .settings-module-title').dragTo(page.locator('.settings-zone-body[data-zone="center1"]'),{targetPosition:{x:20,y:12}});
 assert(await page.evaluate(id=>dashboardLayout.zones.center1.includes(id),dragId),'pointer drag preserves panel placement');
 await page.locator('#zone-'+dragId).selectOption('left');
 const controls=await page.evaluate(()=>settingsFocusable().map(el=>el.id||el.className));console.log('FOCUSCONTROLS',controls.length);
 await page.locator('#settingsOverlay .settings-close').focus();await page.keyboard.press('Shift+Tab');
 assert(await page.evaluate(()=>document.activeElement===settingsFocusable().at(-1)),'Shift+Tab wraps to last control');
 await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement===settingsFocusable()[0]),'Tab wraps to first control');
 await page.keyboard.press('Escape');assert.strictEqual(await page.evaluate(()=>document.getElementById('main').inert),false);assert.strictEqual(await page.evaluate(()=>document.activeElement.id),'settingsTrigger');
 await page.screenshot({path:artifact('browser-desktop-2026-10-01.png'),fullPage:false});
 console.log('DESKTOP PASS');
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(3500);assert(await page.evaluate(()=>dashboardLayout.zones.right.includes('tradeIdeas')));
 assert((await page.locator('#liveStatus').innerText()).includes('Élő'));assert((await page.locator('body').innerText()).includes('Fixture SSE updated'));
 await page.evaluate(()=>{flatSvg.call(flatZoom.transform,d3.zoomIdentity.translate(-40,-20).scale(1.5));});
 assert(await page.evaluate(()=>[...document.querySelectorAll('.marker-label')].every(el=>getComputedStyle(el).display!=='none')));
 await page.locator('#projToggle').click();await page.waitForTimeout(5000);
 console.log('GLOBE',await page.evaluate(()=>({initialized:globeInitialized,flat:isFlat,points:globe?.pointsData().length,error:document.getElementById('mapHint').textContent})));
 assert(await page.evaluate(()=>globeInitialized&&!isFlat),'WebGL globe must initialize');
 {
  await page.evaluate(()=>globe.pointOfView({altitude:1},0));await page.waitForTimeout(300);
  assert(await page.evaluate(()=>globe.pointsData().some(p=>p.type==='earthquake')));
  await page.evaluate(()=>setMapLayer('earthquake',false));assert(!await page.evaluate(()=>globe.pointsData().some(p=>p.type==='earthquake')));
  await page.evaluate(()=>setMapLayer('earthquake',true));assert(await page.evaluate(()=>globe.pointsData().some(p=>p.type==='earthquake')));
  for(const layer of kinds){
   await page.evaluate(id=>setMapLayer(id,false),layer.id);
   assert.strictEqual(await page.evaluate(types=>globe.pointsData().filter(p=>types.includes(p.type)).length,layer.types),0,'hidden globe layer '+layer.id);
   await page.evaluate(id=>setMapLayer(id,true),layer.id);
  }
  assert.strictEqual(await page.evaluate(()=>globe.controls().autoRotate),false);
 }
 await page.request.get(qaUrl+'/control?online=false');await page.waitForTimeout(600);
 assert((await page.locator('#liveStatus').innerText()).includes('Megszakadt'));
 await page.request.get(qaUrl+'/control?online=true');await page.waitForTimeout(7000);
 assert((await page.locator('#liveStatus').innerText()).includes('Élő'));
 console.log('SSE RECONNECT PASS');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1200);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.locator('#settingsTrigger').click();await page.screenshot({path:artifact('browser-mobile-settings-2026-10-01.png'),fullPage:false});
 assert(await page.evaluate(()=>{const r=document.querySelector('.settings-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight+1}));
 await page.keyboard.press('Escape');await page.screenshot({path:artifact('browser-mobile-2026-10-01.png'),fullPage:false});console.log('MOBILE PASS');
 console.log('CONSOLE WARNINGS',JSON.stringify(consoleWarnings));console.log('PAGE ERRORS',JSON.stringify(errors));console.log('CONSOLE ERRORS',JSON.stringify(consoleErrors));assert.deepStrictEqual(errors,[]);
 assert.deepStrictEqual(consoleErrors,[]);
 console.log('QA PASS');
 }finally{await browser.close();}
}

async function edgeChecks(){
 const browser=await chromium.launch({headless:true});
 try{
 const original=await (await fetch(qaUrl)).text();
 const locale=JSON.parse(fs.readFileSync(new URL('../locales/hu.json',import.meta.url),'utf8'));
 const empty={meta:{timestamp:new Date().toISOString(),sourcesQueried:0,sourcesOk:0},ideasSource:'rules',ideas:[],earthquakes:[]};
 const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await ctx.addInitScript(l=>{window.__CRUCIX_LOCALE__=l;Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}});},locale);
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/events',r=>r.fulfill({status:503,body:'offline'}));
 await page.route('**/api/data',r=>r.fulfill({status:503,body:'{}'}));
 await page.route(qaUrl+'/',r=>r.fulfill({contentType:'text/html',body:original.replace(/^let D = .*;\s*$/m,'let D = '+JSON.stringify(empty)+';')}));
 await page.goto(qaUrl,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1000);
 assert((await page.locator('.lp-ideas').innerText()).includes('nincs a szabályoknak megfelelő'));
 assert.strictEqual(await page.locator('#main .g-panel').count()>0,true);
 await page.locator('#settingsTrigger').click();await page.locator('#layer-air').uncheck();await page.keyboard.press('Escape');await page.evaluate(()=>togglePerfMode());
 assert.deepStrictEqual(errors,[]);console.log('BLOCKED STORAGE + EMPTY RULES PASS');
 await ctx.close();
 const ctx2=await browser.newContext({viewport:{width:1100,height:850},reducedMotion:'reduce'});
 await ctx2.addInitScript(l=>{window.__CRUCIX_LOCALE__=l;const base=setInterval;window.setInterval=(fn,ms,...args)=>base(fn,ms===60000?100:ms,...args);},locale);
 const p=await ctx2.newPage(),errors2=[];p.on('pageerror',e=>errors2.push(e.message));
 let apiCalls=0,healthy=false;
 await p.route('**/events',r=>r.fulfill({status:503,body:'offline'}));
 await p.route('**/api/data',r=>{apiCalls++;return r.fulfill({contentType:'application/json',body:healthy?JSON.stringify(empty):JSON.stringify({meta:{timestamp:'bad'},air:'bad'})});});
 await p.goto(qaUrl,{waitUntil:'domcontentloaded'});await p.waitForTimeout(650);
 assert(apiCalls>=3);assert.strictEqual(await p.evaluate(()=>D.meta.sourcesQueried),31);console.log('MALFORMED API PRESERVES INLINE PASS',apiCalls);
 healthy=true;await p.waitForTimeout(400);assert.strictEqual(await p.evaluate(()=>D.meta.sourcesQueried),0);assert((await p.locator('#liveStatus').innerText()).includes('Lekérdezés'));
 await p.evaluate(()=>clearInterval(fallbackTimer));await p.waitForTimeout(300);await p.evaluate(()=>{D.ideasCached=true;D.ideasGeneratedAt=new Date(Date.now()-3600000).toISOString();D.meta.timestamp=new Date(Date.now()-3600000).toISOString();reinit();});
 assert((await p.locator('#freshnessStatus').innerText()).includes('Elavult'));assert((await p.locator('.ideas-age').innerText()).includes('Korábbi'));
 assert.deepStrictEqual(errors2,[]);console.log('FALLBACK POLL + STALE + CACHED IDEA AGE PASS');await ctx2.close();
 const ctx3=await browser.newContext({reducedMotion:'reduce'}),q=await ctx3.newPage(),err3=[];q.on('pageerror',e=>err3.push(e.message));
 await q.route('**/events',r=>r.fulfill({status:503,body:'offline'}));await q.route('**/api/data',r=>r.fulfill({status:503,body:'{}'}));
 await q.route(qaUrl+'/',r=>r.fulfill({contentType:'text/html',body:original.replace(/^let D = .*;\s*$/m,'let D = null;')}));
 await q.goto(qaUrl,{waitUntil:'domcontentloaded'});await q.waitForTimeout(700);assert.deepStrictEqual(err3,[]);console.log('NO INLINE/OFFLINE INITIAL RENDER PASS');await ctx3.close();
 const ctx4=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'}),normal=await ctx4.newPage(),err4=[];
 normal.on('pageerror',e=>err4.push(e.message));await normal.goto(qaUrl,{waitUntil:'domcontentloaded'});await normal.waitForTimeout(6500);
 assert.strictEqual(await normal.locator('#boot').isVisible(),false,'normal-motion boot completes');
 assert(await normal.evaluate(()=>getComputedStyle(document.getElementById('main')).opacity==='1'));
 await normal.locator('#settingsTrigger').click();await normal.locator('#settingsOverlay').click({position:{x:4,y:4}});
 assert.strictEqual(await normal.locator('#settingsOverlay').getAttribute('aria-hidden'),'true','backdrop click closes settings');assert.deepStrictEqual(err4,[]);
 console.log('NORMAL MOTION BOOT + BACKDROP CLOSE PASS');console.log('EDGE QA PASS');
 }finally{await browser.close();}
}

async function xssChecks(){
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(qaUrl,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.markers [data-layer="news"]');
  await page.waitForTimeout(400);
  assert(await page.evaluate(()=>D.newsFeed.some(n=>n.headline?.includes('window.__injected=1'))),'unterminated headline fixture remains');
  assert(await page.evaluate(()=>D.newsFeed.some(n=>n.headline?.includes('window.__injected=3'))),'complete headline fixture remains');
  assert(await page.evaluate(()=>D.ideas.some(n=>n.rationale?.includes('window.__injected=2'))),'complete idea fixture remains');
  assert.strictEqual(await page.locator('.lp-ticker img,.lp-ideas img').count(),0,'external HTML never creates an image element');
  assert((await page.locator('.lp-ticker').innerText()).includes('Fixture complete headline'));
  assert((await page.locator('.lp-ideas').innerText()).includes('Safe text'));
  await page.locator('.markers [data-layer="news"]').first().click();
  assert(await page.locator('#mapPopup').isVisible(),'news marker opens actual popup');
  assert((await page.locator('#mapPopup').innerText()).includes('Fixture popup'));
  assert.strictEqual(await page.locator('#mapPopup img').count(),0,'popup HTML payload stays inert');
  await page.waitForTimeout(250);
  assert.strictEqual(await page.evaluate(()=>window.__injected),undefined);
  assert.deepStrictEqual(errors,[]);
  console.log('XSS PASS: unterminated headline, complete headline, idea rationale, marker popup; no injected DOM image or code execution');
 }finally{await browser.close();}
}

async function raceChecks(){
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const timestamp=new Date().toISOString();
  const fresh={meta:{timestamp,sourcesQueried:222,sourcesOk:222},newsFeed:[{headline:'Race newer SSE',source:'Fixture race',type:'rss',timestamp}]};
  const old={meta:{timestamp:new Date(Date.now()-3600000).toISOString(),sourcesQueried:111,sourcesOk:111},newsFeed:[{headline:'Race stale API',source:'Fixture race',type:'rss',timestamp}]};
  let apiReturned=false;
  await page.route('**/api/data',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({contentType:'application/json',body:JSON.stringify(old)});apiReturned=true;});
  await page.route('**/events',route=>route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'update',data:fresh})+'\n\n'}));
  await page.goto(qaUrl,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>D.meta.sourcesQueried===222);
  await page.waitForTimeout(800);assert(apiReturned,'delayed API response was delivered');
  assert.strictEqual(await page.evaluate(()=>D.meta.sourcesQueried),222,'older initial API must not overwrite newer SSE');
  assert((await page.locator('.lp-ticker').innerText()).includes('Race newer SSE'));
  await page.evaluate(()=>applySnapshot({...D,meta:{...D.meta,sourcesQueried:333}}));
  assert.strictEqual(await page.evaluate(()=>D.meta.sourcesQueried),333,'equal timestamps remain acceptable');
  assert.deepStrictEqual(errors,[]);
  console.log('SNAPSHOT RACE PASS: delayed older API cannot overwrite newer SSE; equal timestamp accepted');
 }finally{await browser.close();}
}

const preview=await fetch(qaUrl);
assert(preview.ok&&(await preview.text()).includes('Fixture live'),'The target must be the deterministic dashboard fixture, not the application server');
await fetch(qaUrl+'/control?online=true');
const suite=process.env.QA_SUITE||'all';assert(['all','xss','edge','race'].includes(suite),'QA_SUITE must be all, xss, edge or race');
try{
 if(suite==='all')await mainChecks();
 if(suite==='all'||suite==='edge')await edgeChecks();
 if(suite!=='xss')await raceChecks();
 if(suite!=='race')await xssChecks();
 console.log('All requested browser QA checks passed.');
}
catch(error){console.error(error);process.exitCode=1;}
finally{await fetch(qaUrl+'/control?online=true').catch(()=>{});}
