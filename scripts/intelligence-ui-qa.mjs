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
const errors = [], external = [], legacyAssets = [];
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
    legacyAssets.push(url.origin + url.pathname);
    const absolute = path.join(vendor, file);
    const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const body = file === 'fonts.css' ? fs.readFileSync(absolute, 'utf8').replace(/url\((['"]?)fonts\//g, 'url($1/vendor/fonts/') : fs.readFileSync(absolute);
    await route.fulfill({ body, contentType });
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
  assert.equal(await page.locator('html').getAttribute('lang'), messages.meta.code, 'Requested locale reached the rendered dashboard');
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
      await page.locator('#eventsTrigger').click(); const id = await page.evaluate(() => D.events.find(event => event.kind === 'earthquake')?.id); assert(id); await page.locator('#ci-body [data-ci-event-id="' + id + '"]').click();
      const messages = JSON.parse(fs.readFileSync(new URL('../locales/' + locale + '.json', import.meta.url), 'utf8'));
      assert.equal(await page.locator('#ci-close').innerText(), messages.intelligence.close, 'Dialog controls are localized');
      assert((await page.locator('.ci-metadata').innerText()).includes(messages.intelligence.severity_unknown), 'Unknown severity is localized');
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
    const initial = await page.locator('.ci-event-card').innerText(); await page.locator('[data-ci-page="next"]').click(); await page.waitForFunction(old => { const card = document.querySelector('.ci-event-card'); return card && card.innerText !== old; }, initial);
    await page.locator('#ci-history-q').fill('Test earthquake'); await page.waitForFunction(() => document.querySelector('.ci-history-status')?.innerText.includes('1 ') && document.querySelector('.ci-event-card')?.innerText.includes('Test earthquake'));
    assert.match(await page.locator('.ci-history-results').innerText(), /Test earthquake/);
    // Clicking after typing also commits the input's native change event. This
    // physical click guards the previous modal-recentering/export regression.
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-ci-export="json"]').click()]);
    assert.match(download.suggestedFilename(), /\.json$/); const jsonPath = path.join(artifacts, download.suggestedFilename()); await download.saveAs(jsonPath);
    const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); assert.equal(exported.total, 1); assert.equal(exported.records.length, 1); assert.equal(exported.filters.q, 'Test earthquake'); assert.equal(exported.records[0].kind, 'earthquake');
    await page.locator('#ci-history-kind').selectOption('earthquake'); await page.locator('#ci-history-source').fill('USGS');
    const date = await page.evaluate(() => D.meta.timestamp.slice(0, 10));
    for (const key of ['from', 'to']) { await page.locator('#ci-history-' + key).fill(date); await page.locator('#ci-history-' + key).dispatchEvent('change'); }
    await page.waitForFunction(() => document.querySelector('.ci-history-status')?.innerText.includes('1 ') && document.querySelector('.ci-event-card')?.innerText.includes('Test earthquake'));
    for (const format of ['csv', 'stix']) {
      const [file] = await Promise.all([page.waitForEvent('download'), page.locator('[data-ci-export="' + format + '"]').click()]); const destination = path.join(artifacts, file.suggestedFilename()); await file.saveAs(destination);
      const query = new URL(file.url()).searchParams; assert.equal(query.get('q'), 'Test earthquake'); assert.equal(query.get('kind'), 'earthquake'); assert.equal(query.get('source'), 'USGS'); assert.equal(query.get('from'), date + 'T00:00:00.000Z'); assert.equal(query.get('to'), date + 'T23:59:59.999Z'); assert.equal(query.has('offset'), false);
      const text = fs.readFileSync(destination, 'utf8'); if (format === 'csv') { assert.match(text, /Test earthquake/); assert.match(text, /sourceUrl/); } else { const bundle = JSON.parse(text); assert.equal(bundle.type, 'bundle'); assert(bundle.objects.some(object => object.type === 'report')); assert(bundle.objects.every(object => ['report', 'note'].includes(object.type)), 'Physical STIX export stays contextual rather than cyber indicators'); }
    }
    await context.addInitScript(() => { window.print = () => { window.__printRequested = true; }; });
    const [report] = await Promise.all([page.waitForEvent('popup'), page.locator('[data-ci-export="html"]').click()]); await report.waitForLoadState('domcontentloaded');
    assert.equal(new URL(report.url()).searchParams.get('q'), 'Test earthquake'); assert.match(await report.locator('body').innerText(), /Exported 1 of 1/); assert.match(await report.locator('body').innerText(), /Test earthquake/); await report.waitForFunction(() => window.__printRequested === true);
    await report.pdf({ path: path.join(artifacts, 'history-filtered-report.pdf'), format: 'A4', printBackground: true }); await report.close();
    await page.screenshot({ path: path.join(artifacts, 'history-desktop.png') });
    await page.locator('.ci-event-card [data-ci-event-id]').click(); await page.waitForSelector('.ci-back'); await page.locator('.ci-back').click(); assert.equal(await page.locator('#ci-history-q').inputValue(), 'Test earthquake');
    await page.keyboard.press('Escape');
    await page.evaluate(() => CrucixIntelligence.openEvent({ id: 'event-tampered-cache', kind: 'news', title: 'Tampered cache fixture', source: { name: 'Provider', url: 'https://example.org/report?ACCESS_TOKEN=fixture-secret', status: 'ok' }, relatedSources: [{ name: 'Related provider', url: 'https://other.example/report?api%5Fkey=fixture-secret' }] }));
    assert.equal(await page.locator('#ci-body a').count(), 0, 'Auth-bearing references from direct/cache objects stay unavailable'); await page.keyboard.press('Escape');
    console.log('HISTORY PASS', { formats: ['json', 'csv', 'stix', 'html/print/pdf'], filters: ['q', 'kind', 'source', 'from', 'to'], pagination: true, authQueryURLs: 'withheld' });
  } finally { await context.close(); }
}
async function clusterChecks() {
  const { context, page } = await prepare({ width: 1440, height: 1000 });
  try {
    const cluster = await page.evaluate(() => { const id = D.events.find(event => event.title === 'Fixture Hungary flood response 1')?.id; return D.eventClusters.find(item => item.eventIds.includes(id)); });
    assert(cluster && cluster.count === 2 && cluster.sourceCount === 2, 'Positive fixture group contains two distinct source reports');
    if (!await page.evaluate(() => isFlat)) await page.locator('#projToggle').click();
    if (!await page.evaluate(() => groupNews)) await page.locator('#clusterTrigger').click();
    const marker = page.locator('.markers [data-cluster-id="' + cluster.id + '"]'); await marker.waitFor();
    assert.equal(await page.locator('#clusterTrigger').getAttribute('aria-pressed'), 'true'); await marker.click();
    assert.equal(await page.locator('#ci-body [data-ci-event-id]').count(), 2); assert.match(await page.locator('#ci-body').innerText(), /Geographic proximity alone/);
    await page.screenshot({ path: path.join(artifacts, 'cluster-flat-detail.png') });
    await page.locator('#ci-body [data-ci-event-id]').first().click(); assert.match(await page.locator('#ci-title').innerText(), /Fixture Hungary flood response/); assert.match(await page.locator('#ci-body .ci-source-link').first().getAttribute('href'), /^https:\/\/fixture[12]\.example\/report$/); await page.keyboard.press('Escape');
    await page.locator('#settingsTrigger').click(); await page.locator('#layer-news').uncheck(); assert.equal(await page.locator('.markers [data-cluster-id]').count(), 0); await page.locator('#layer-news').check(); assert.equal(await marker.count(), 1); await page.keyboard.press('Escape');
    await page.locator('#clusterTrigger').click(); assert.equal(await page.locator('.markers [data-cluster-id]').count(), 0); assert.equal(await page.locator('#clusterTrigger').getAttribute('aria-pressed'), 'false'); await page.locator('#clusterTrigger').click(); await marker.waitFor();
    await page.screenshot({ path: path.join(artifacts, 'cluster-flat-map.png') });
    console.log('CLUSTER flat PASS', { id: cluster.id, count: cluster.count, sourceCount: cluster.sourceCount });
    await page.locator('#projToggle').click(); await page.waitForFunction(() => !isFlat && globe?.pointsData().some(point => point.cluster));
    await page.locator('.region-btn[data-region="europe"]').click(); await page.waitForTimeout(1300);
    const rendered = await page.evaluate(id => { const point = globe.pointsData().find(item => item.cluster?.id === id); return point && { ...globe.getScreenCoords(point.lat, point.lng, point.alt), count: point.cluster.count }; }, cluster.id);
    assert(rendered && rendered.count === 2, 'Grouped point reaches the actual globe renderer');
    const canvas = page.locator('#globeViz canvas'); const bounds = await canvas.boundingBox(); assert(bounds);
    await page.mouse.click(bounds.x + rendered.x, bounds.y + rendered.y); await page.waitForSelector('#ci-dialog', { timeout: 5000 });
    assert.equal(await page.locator('#ci-body [data-ci-event-id]').count(), 2); await page.screenshot({ path: path.join(artifacts, 'cluster-globe-detail.png') }); await page.keyboard.press('Escape');
    await page.locator('#settingsTrigger').click(); await page.locator('#layer-news').uncheck(); assert.equal(await page.evaluate(() => globe.pointsData().filter(point => point.cluster).length), 0); await page.locator('#layer-news').check(); assert.equal(await page.evaluate(id => globe.pointsData().filter(point => point.cluster?.id === id).length, cluster.id), 1); await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(artifacts, 'cluster-globe-map.png') }); console.log('CLUSTER globe PASS', { physicalCanvasClick: true, id: cluster.id });
  } finally { await context.close(); }
}
async function profileChecks() {
  for (const blockedStorage of [false, true]) {
    const { context, page } = await prepare({ width: blockedStorage ? 390 : 1440, height: blockedStorage ? 844 : 1000 }, 'en', blockedStorage);
    try {
      await page.locator('.region-btn[data-region="europe"]').click();
      await page.locator('#settingsTrigger').click(); await page.locator('#layer-space').uncheck(); await page.locator('#zone-tradeIdeas').selectOption('right'); await page.locator('#panel-nuclearWatch').uncheck(); await page.keyboard.press('Escape');
      const before = await page.evaluate(() => ({ layout: dashboardLayout, layers: mapLayers, region: currentRegion }));
      await page.locator('#profilesTrigger').click(); await page.waitForSelector('#ci-profile-name');
      if (blockedStorage) assert.match(await page.locator('#ci-body').innerText(), /session/i);
      await page.locator('#ci-profile-name').fill('<svg onload="window.__profileAttack=1">Saved view'); await page.locator('[data-ci-profile-action="save"]').click(); assert.equal(await page.locator('[data-ci-profile-action="delete"]').count(), 1); assert.equal(await page.evaluate(() => window.__profileAttack), undefined);
      await page.locator('[data-ci-profile-action="apply"][data-profile-id="research"]').click(); assert.equal(await page.evaluate(() => currentRegion), 'world'); assert.notDeepEqual(await page.evaluate(() => dashboardLayout), before.layout);
      await page.locator('[data-ci-profile-action="apply"][data-profile-id="market"]').click(); await page.locator('[data-ci-profile-action="apply"][data-profile-id="custom"]').click();
      assert.deepEqual(await page.evaluate(() => ({ layout: dashboardLayout, layers: mapLayers, region: currentRegion })), before, 'Custom profile restores actual host panels, layer state and region');
      const sizing = await page.locator('#ci-dialog').evaluate(node => ({ width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, contentScroll: document.getElementById('ci-body').scrollHeight > document.getElementById('ci-body').clientHeight }));
      assert(sizing.width <= (blockedStorage ? 390 : 1440) && sizing.scrollWidth <= sizing.clientWidth + 1, 'Profile dialog fits viewport without horizontal clipping'); if (blockedStorage) assert(sizing.contentScroll, 'Mobile profiles scroll vertically');
      await page.screenshot({ path: path.join(artifacts, blockedStorage ? 'profiles-mobile-session.png' : 'profiles-desktop.png') });
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'profilesTrigger', 'Recreated profile toolbar trigger regains focus');
      if (!blockedStorage) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#eventsTrigger'); await page.locator('#profilesTrigger').click(); assert.equal(await page.locator('[data-ci-profile-action="delete"]').count(), 1); const own = await page.locator('[data-ci-profile-action="delete"]').getAttribute('data-profile-id'); await page.locator('[data-ci-profile-action="apply"][data-profile-id="' + own + '"]').click(); assert.deepEqual(await page.evaluate(() => ({ layout: dashboardLayout, layers: mapLayers, region: currentRegion })), before, 'Persisted profile restores full workspace after reload'); }
      else { await page.locator('#profilesTrigger').click(); assert.equal(await page.locator('[data-ci-profile-action="delete"]').count(), 1, 'Session fallback survives closing/reopening profiles'); }
      console.log('PROFILES PASS', { blockedStorage, customRestored: true, persistedReload: !blockedStorage, sizing });
    } finally { await context.close(); }
  }
}
try {
  if (phase === 'detail' || phase === 'all') await detailChecks();
  if (phase === 'history' || phase === 'all') { await historyChecks(); await clusterChecks(); }
  if (phase === 'profiles' || phase === 'all') await profileChecks();
  assert.deepEqual(errors, [], 'No browser runtime errors'); assert.deepEqual(external, [], 'No unexpected external requests');
  if (phase === 'profiles' || phase === 'all') assert.deepEqual(legacyAssets, [], 'PWA phase loads all assets locally without legacy CDN routing');
  console.log('Intelligence UI QA passed', { phase, target: target.origin, artifacts, browserPlugin: 'not available; existing Playwright used' });
} finally { await browser.close(); }
