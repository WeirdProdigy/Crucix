// Real browser storage/offline checks against the isolated fixture only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require=createRequire(import.meta.url), {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const target=new URL(process.env.QA_URL||'http://127.0.0.1:3199/');
assert(['127.0.0.1','localhost'].includes(target.hostname)&&target.protocol==='http:'&&target.pathname==='/');
const artifacts=join(tmpdir(),'crucix-pwa-qa');mkdirSync(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const errors=[],external=[];
try {
  await fetch(target.origin+'/control?language=hu');
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const locale=JSON.parse(readFileSync(new URL('../locales/hu.json',import.meta.url),'utf8'));
  await context.addInitScript(value=>window.__CRUCIX_LOCALE__=value,locale);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===target.origin||['data:','blob:'].includes(url.protocol))return route.continue();external.push(url.href);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(target.href,{waitUntil:'domcontentloaded'});await page.waitForSelector('#pwaTrigger');
  assert.match(await page.locator('body').innerText(),/Fixture/);
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  assert.equal(await page.evaluate(()=>CrucixPWA.restoreSnapshot()),null,'Snapshot is off by default');
  const manifest=await page.evaluate(()=>fetch('/manifest.webmanifest').then(r=>r.json()));assert.equal(manifest.display,'standalone');assert.equal(manifest.icons.length,2);
  await page.locator('#pwaTrigger').click();await page.locator('#pwa-save-snapshot').check();
  await page.waitForFunction(async()=>!!await CrucixPWA.restoreSnapshot());await page.locator('#pwa-close').click();
  const saved=await page.evaluate(()=>CrucixPWA.restoreSnapshot());assert.ok(saved.data.events.length>0);
  assert.equal(await page.evaluate(async()=>CrucixPWA.saveSnapshot({...D,meta:{...D.meta,timestamp:new Date(Date.parse(D.meta.timestamp)-3600000).toISOString()}})),false,'Older saves cannot replace a newer snapshot');
  await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
  try { await page.waitForFunction(()=>document.getElementById('pwaFreshness')?.dataset.offlineSnapshot==='true'); }
  catch(error) {
    console.error('OFFLINE_DIAGNOSTIC',await page.evaluate(async()=>({online:navigator.onLine,shell:window.__CRUCIX_OFFLINE_SHELL__,timestamp:typeof D==='undefined'?null:D.meta?.timestamp,pwa:typeof CrucixPWA,status:document.getElementById('pwaFreshness')?.outerHTML,saved:!!await window.CrucixPWA?.restoreSnapshot()})),errors);
    throw error;
  }
  assert.equal(await page.evaluate(()=>D.meta.timestamp),saved.data.meta.timestamp);assert.match(await page.locator('#pwaFreshness').innerText(),/Mentett/);
  await page.waitForFunction(()=>document.querySelectorAll('#flatMapSvg .land').length>100);
  await page.locator('#eventsTrigger').click();await page.waitForSelector('.ci-event-card');await page.keyboard.press('Escape');
  await page.locator('#historyTrigger').click();await page.waitForFunction(()=>document.querySelector('.ci-history-status')?.innerText.match(/Offline|offline|Nem|nem|kapcsolat/));await page.keyboard.press('Escape');
  await page.screenshot({path:join(artifacts,'offline-flat-hu.png')});
  await page.locator('#projToggle').click();await page.waitForFunction(()=>!isFlat&&globe&&document.querySelector('#globeViz canvas'));
  await page.screenshot({path:join(artifacts,'offline-globe-hu.png')});
  const keys=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys()){if(name.startsWith('crucix-shell-')){const cache=await caches.open(name);result.push(...(await cache.keys()).map(request=>new URL(request.url).pathname));}}return result;});
  assert.ok(keys.includes('/offline-shell'));assert.ok(!keys.some(path=>path==='/'||path.startsWith('/api/')||path==='/events'||path==='/jarvis.html'));
  await page.locator('#pwaTrigger').click();await page.locator('#pwa-clear').click();await page.waitForFunction(async()=>await CrucixPWA.restoreSnapshot()===null);await page.locator('#pwa-close').click();
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#pwaTrigger');assert.equal(await page.evaluate(()=>D.events.length),0,'Clear disables saved data on the next offline startup');
  assert.ok(!(await page.locator('#topbar').innerText()).includes('1970'));
  await page.screenshot({path:join(artifacts,'offline-empty-hu.png')});
  await context.setOffline(false);await page.goto(target.href,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>D.events.length>0);
  await context.close();
  const blocked=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await blocked.addInitScript(()=>Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Fixture storage denied','SecurityError');}}));
  const mobile=await blocked.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(target.href,{waitUntil:'domcontentloaded'});await mobile.waitForSelector('#pwaTrigger');await mobile.locator('#pwaTrigger').click();
  await mobile.locator('#pwa-save-snapshot').click();await mobile.waitForFunction(expected=>document.querySelector('#pwa-message')?.innerText.includes(expected),locale.pwa.storageError);
  assert.equal(await mobile.locator('#pwa-save-snapshot').isChecked(),false);assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=390),true);
  await mobile.screenshot({path:join(artifacts,'pwa-mobile-blocked.png')});await mobile.keyboard.press('Escape');await blocked.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PWA QA PASS: default off, opt-in, monotonic saves, offline flat/globe/events, unavailable history, cache allowlist, clear/reload, blocked storage, no external assets',artifacts);
}finally{await browser.close();}
