// Optional browser QA against the localhost deterministic fixture only.
// PLAYWRIGHT_MODULE may point to an existing installation; no runtime dependency.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const target = new URL(process.env.QA_URL || 'http://127.0.0.1:3199/');
assert(['127.0.0.1', 'localhost'].includes(target.hostname) && target.pathname === '/' && target.protocol === 'http:', 'Use the local deterministic QA fixture');
const phase = process.env.QA_PHASE || 'detail';
assert(['detail', 'history', 'profiles', 'all'].includes(phase), 'QA_PHASE is detail, history, profiles, or all');
const artifacts = process.env.QA_ARTIFACT_DIR || path.join(os.tmpdir(), 'crucix-intelligence-qa');
fs.mkdirSync(artifacts, { recursive: true });
const vendor = fileURLToPath(new URL('../dashboard/public/vendor/', import.meta.url));
const errors = [], external = [];
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });

async function localAssets(context) {
  // The pre-PWA template may still name original CDNs. Serve the project's
  // pinned local copies at this browser boundary, never contact source APIs.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === target.origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    const mappings = [
      [/\/gsap\.min\.js$/, 'gsap-3.12.5.min.js'], [/\/d3\.v7\.min\.js$/, 'd3-7.9.0.min.js'], [/\/topojson\.v3\.min\.js$/, 'topojson-client-3.1.0.min.js'], [/globe\.gl@2\.33\.0/, 'globe.gl-2.33.0.min.js'], [/countries-110m\.json$/, 'countries-110m-2.0.2.json'], [/earth-night\.jpg$/, 'earth-night-2.33.0.jpg'], [/earth-topology\.png$/, 'earth-topology-2.33.0.png'], [/fonts\.googleapis\.com/, 'fonts.css']
    ];
    const file = mappings.find(([pattern]) => pattern.test(url.href))?.[1];
    if (!file) { external.push(url.origin + url.pathname); return route.abort(); }
    const absolute = path.join(vendor, file);
    const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    await route.fulfill({ body: fs.readFileSync(absolute), contentType });
  });
}
async function prepare(viewport, locale = 'en', blockedStorage = false) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }); await localAssets(context);
  const messages = JSON.parse(fs.readFileSync(new URL('../locales/' + locale + '.json', import.meta.url), 'utf8'));
  await context.addInitScript(({ messages, blockedStorage }) => {
    window.__CRUCIX_LOCALE__ = messages;
    if (blockedStorage) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Fixture denied', 'SecurityError'); } });
  }, { messages, blockedStorage });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#eventsTrigger'); await page.waitForTimeout(3800);
  assert.match(await page.title(), /Crucix/i); assert.equal(new URL(page.url()).origin, target.origin);
  assert(await page.locator('#main .g-panel').count(), 'Meaningful dashboard content');
  assert.equal(await page.evaluate(() => window.__injected), undefined, 'Existing fixture payload stayed inert');
  return { context, page };
}
async function detailChecks() {
  const { context, page } = await prepare({ width: 1440, height: 1000 });
  try {
    const count = await page.evaluate(() => D.events.length); assert(count > 0, 'Fixture must contain normalized events');
    await page.locator('#eventsTrigger').click(); assert(await page.locator('#ci-body [data-ci-event-id]').count() > 0);
    assert.equal(await page.locator('#ci-dialog').getAttribute('aria-modal'), 'true');
    const quake = await page.evaluate(() => D.events.find(event => event.kind === 'earthquake'));
    assert(quake); await page.locator('#ci-body [data-ci-event-id="' + quake.id + '"]').click();
    assert.equal(await page.locator('#ci-title').innerText(), quake.title); assert.equal(await page.evaluate(() => document.getElementById('main').inert), true);
    const rows = await page.locator('#ci-body .ci-metadata').innerText(); assert(rows.includes('UTC')); assert(rows.includes(quake.source.name));
    assert(await page.locator('#ci-body .ci-source-link').getAttribute('href')); assert.equal(await page.locator('#ci-body script, #ci-body img').count(), 0);
    await page.screenshot({ path: path.join(artifacts, 'detail-desktop.png') });
    await page.locator('#ci-close').focus(); await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => { const controls = [...document.querySelectorAll('#ci-dialog button,#ci-dialog a,#ci-dialog input,#ci-dialog select')].filter(node => !node.disabled && !node.hidden); return document.activeElement === controls.at(-1); }));
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'ci-close'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#ci-overlay').count(), 0); assert.equal(await page.evaluate(() => document.activeElement.id), 'eventsTrigger');
    const ticker = page.locator('.tk-card[data-event-id]').first(); if (await ticker.count()) { await ticker.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('#ci-dialog'); await page.keyboard.press('Escape'); assert(await ticker.evaluate(node => node === document.activeElement)); }
    const marker = page.locator('.markers [data-layer="earthquake"]').first(); if (await marker.count()) { await marker.click({ force: true }); await page.waitForSelector('#mapPopup .pp-detail'); await page.locator('#mapPopup .pp-detail').click(); await page.waitForSelector('#ci-dialog'); await page.keyboard.press('Escape'); }
    await page.evaluate(() => CrucixIntelligence.openEvent({ id: 'event-malicious', kind: 'news', title: '<img src=x onerror="window.__ciAttack=1">', summary: '<script>window.__ciAttack=2</script>', source: { name: 'Fixture unsafe', status: 'error', url: 'javascript:alert(1)' }, observedAt: null, publishedAt: null, collectedAt: '2026-10-01T10:00:00Z', location: { lat: 999, lon: 20, method: 'inferred', precision: 'approximate' }, relatedSources: [] }));
    assert.equal(await page.evaluate(() => window.__ciAttack), undefined); assert.equal(await page.locator('#ci-body a, #ci-body img, #ci-body script').count(), 0); assert.match(await page.locator('#ci-body').innerText(), /Unknown/); await page.keyboard.press('Escape');
    console.log('DETAIL desktop PASS', { count, title: quake.title });
  } finally { await context.close(); }
  for (const locale of ['en', 'hu', 'fr']) {
    const { context, page } = await prepare({ width: 390, height: 844 }, locale);
    try {
      await page.locator('#eventsTrigger').click(); await page.locator('#ci-body [data-ci-event-id]').first().click();
      const sizing = await page.locator('#ci-dialog').evaluate(node => ({ width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, contentScroll: document.getElementById('ci-body').scrollHeight > document.getElementById('ci-body').clientHeight }));
      assert(sizing.width <= 390 && sizing.scrollWidth <= sizing.clientWidth + 1, 'Readable mobile dialog without horizontal clipping'); assert(sizing.contentScroll, 'Long detail scrolls within mobile viewport');
      await page.screenshot({ path: path.join(artifacts, 'detail-mobile-' + locale + '.png') }); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.getElementById('main').inert), false);
      console.log('DETAIL mobile PASS', { locale, sizing });
    } finally { await context.close(); }
  }
}
async function historyChecks() {
  const { context, page } = await prepare({ width: 1440, height: 1000 });
  try {
    assert(await page.evaluate(() => CrucixIntelligence.openHistory()), 'Enable phase 2.5 history first'); await page.waitForSelector('.ci-pagination');
    await page.waitForFunction(() => document.querySelector('[data-ci-page="next"]'));
    await page.locator('#ci-history-limit').fill('1'); await page.locator('#ci-history-limit').dispatchEvent('change'); await page.waitForFunction(() => document.querySelectorAll('.ci-event-card').length === 1);
    const initial = await page.locator('.ci-event-card').innerText(); await page.locator('[data-ci-page="next"]').click(); await page.waitForFunction(old => document.querySelector('.ci-event-card')?.innerText !== old, initial);
    await page.locator('#ci-history-q').fill('Test earthquake'); await page.waitForFunction(() => document.querySelector('.ci-history-status')?.innerText.includes('1 '));
    assert.match(await page.locator('.ci-history-results').innerText(), /Test earthquake/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-ci-export="json"]').click()]); assert.match(download.suggestedFilename(), /\.json$/); await download.saveAs(path.join(artifacts, download.suggestedFilename()));
    await page.screenshot({ path: path.join(artifacts, 'history-desktop.png') });
    await page.locator('.ci-event-card [data-ci-event-id]').click(); await page.waitForSelector('.ci-back'); await page.locator('.ci-back').click(); assert.equal(await page.locator('#ci-history-q').inputValue(), 'Test earthquake');
    await page.keyboard.press('Escape'); console.log('HISTORY PASS');
  } finally { await context.close(); }
}
async function profileChecks() {
  for (const blockedStorage of [false, true]) {
    const { context, page } = await prepare({ width: blockedStorage ? 390 : 1440, height: blockedStorage ? 844 : 1000 }, 'en', blockedStorage);
    try {
      assert(await page.evaluate(() => CrucixIntelligence.openProfiles()), 'Enable phase 2.6 profiles first');
      if (blockedStorage) assert.match(await page.locator('#ci-body').innerText(), /session/i);
      await page.locator('#ci-profile-name').fill('<svg onload="window.__profileAttack=1">Saved view'); await page.locator('[data-ci-profile-action="save"]').click(); assert.equal(await page.locator('[data-ci-profile-action="delete"]').count(), 1); assert.equal(await page.evaluate(() => window.__profileAttack), undefined);
      await page.locator('[data-ci-profile-action="apply"][data-profile-id="research"]').click(); await page.locator('[data-ci-profile-action="apply"][data-profile-id="market"]').click(); await page.locator('[data-ci-profile-action="apply"][data-profile-id="custom"]').click();
      await page.screenshot({ path: path.join(artifacts, blockedStorage ? 'profiles-mobile-session.png' : 'profiles-desktop.png') });
      await page.keyboard.press('Escape');
      if (!blockedStorage) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#eventsTrigger'); assert(await page.evaluate(() => CrucixIntelligence.openProfiles())); assert.equal(await page.locator('[data-ci-profile-action="delete"]').count(), 1); }
      console.log('PROFILES PASS', { blockedStorage });
    } finally { await context.close(); }
  }
}
try {
  if (phase === 'detail' || phase === 'all') await detailChecks();
  if (phase === 'history' || phase === 'all') await historyChecks();
  if (phase === 'profiles' || phase === 'all') await profileChecks();
  assert.deepEqual(errors, [], 'No browser runtime errors'); assert.deepEqual(external, [], 'No unexpected external requests');
  console.log('Intelligence UI QA passed', { phase, target: target.origin, artifacts, browserPlugin: 'not available; existing Playwright used' });
} finally { await browser.close(); }
