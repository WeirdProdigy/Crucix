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
assert(['detail', 'history', 'profiles', 'inspector', 'alerts', 'all'].includes(phase), 'QA_PHASE is detail, history, profiles, inspector, alerts, or all');
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
async function prepare(viewport, locale = 'en', blockedStorage = false, owner = browser) {
  const context = await owner.newContext({ viewport, reducedMotion: 'reduce' }); await localAssets(context);
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
// Record inspector: summary card -> docked inspector -> full-screen browser, hash state, keyboard and refresh behaviour.
// Runs against 2.9.0 rows (eventId stamped) and 2.8.0 rows (legacyIds=true, no eventId) so record/event pairing is covered both ways.
async function inspectorChecks() {
  const hash = page => decodeURIComponent(new URL(page.url()).hash);
  const focused = (page, selector) => page.evaluate(selector => !!document.activeElement?.matches(selector), selector);
  for (const legacy of [false, true]) {
    const mode = legacy ? 'legacy' : 'stamped', control = target.origin + '/control?liveSources=true' + (legacy ? '&legacyIds=true' : '');
    assert.equal(await (await fetch(control)).text(), 'ok');
    const { context, page } = await prepare({ width: 1440, height: 1000 });
    try {
      assert.equal(await page.evaluate(() => D.liveSources.some(source => source.observations?.some(row => row.eventId))), !legacy, 'Fixture rows have the ' + mode + ' shape');
      const title = await page.evaluate(() => D.liveSources.find(source => source.source === 'GDACS').observations.find(row => row.severity === 'Orange').title);
      assert.equal(await page.locator('.live-sources-panel details').count(), 0, 'Summary cards carry no inline <details>');
      const card = page.locator('button.live-open[data-open-records="GDACS"]'), aside = page.locator('#record-inspector');
      assert.equal(await aside.getAttribute('aria-hidden'), 'true'); assert(await aside.isHidden());
      await card.scrollIntoViewIfNeeded(); await card.click(); await aside.waitFor({ state: 'visible' });
      assert.equal(await aside.getAttribute('aria-hidden'), 'false'); assert.equal(await aside.getAttribute('aria-labelledby'), 'ri-heading');
      assert(await page.locator('#mapContainer').isVisible(), 'The map stays visible beside the docked inspector');
      // The dashboard scrolls <body>: at the top the panel starts below the (wrapping) top bar and the alert strip under it,
      // scrolled past them the panel uses the full height.
      await page.evaluate(() => { document.body.scrollTop = 0; }); await page.waitForTimeout(100);
      const bar = await page.locator('#alertStrip').boundingBox(), docked = await aside.boundingBox();
      assert(bar.y + bar.height > 0 && Math.abs(docked.y - (bar.y + bar.height)) <= 1 && Math.abs(docked.x + docked.width - 1440) <= 1, 'Docked below the alert strip, at the right edge');
      await page.evaluate(() => { document.body.scrollTop = 600; }); await page.waitForTimeout(100);
      assert.equal(Math.round((await aside.boundingBox()).y), 0, 'Scrolled past the top bar, the panel uses the full height');
      await page.evaluate(() => { document.body.scrollTop = 0; }); await page.waitForTimeout(100);
      assert.match(hash(page), /src=GDACS/); assert.equal(await page.locator('.live-source[data-live-source="GDACS"]').getAttribute('data-selected'), 'true');
      assert(await focused(page, '#record-inspector .ri-row'), 'Opening moves focus into the inspector list');
      assert.equal(await aside.locator('.ri-row').count(), 2);
      await aside.locator('.ri-chip[data-ri-level="high"]').click();
      assert.equal(await aside.locator('.ri-row').count(), 1, 'A severity chip filters the rows'); assert.equal(await aside.locator('.ri-chip[data-ri-level="high"]').getAttribute('aria-pressed'), 'true'); assert.match(hash(page), /sev=high/);
      await aside.locator('.ri-chip[data-ri-level="high"]').click(); assert.equal(await aside.locator('.ri-row').count(), 2);
      // Keyboard: j/k move the selection, '/' focuses search, typing (including 'e') stays in the field.
      await aside.locator('.ri-row').first().focus(); await page.keyboard.press('j');
      assert.equal(await aside.locator('.ri-row').nth(1).getAttribute('aria-selected'), 'true'); assert(await focused(page, '#record-inspector .ri-row[aria-selected="true"]'));
      await page.keyboard.press('k'); assert.equal(await aside.locator('.ri-row').first().getAttribute('aria-selected'), 'true');
      await page.keyboard.press('/'); assert(await focused(page, '#ri-search')); await page.keyboard.type('green');
      assert.equal(await page.locator('#ri-search').inputValue(), 'green'); assert(await focused(page, '#ri-search'), 'Search keeps focus across re-renders');
      assert.equal(await aside.locator('.ri-row').count(), 1); assert.equal(await page.locator('#record-browser[open]').count(), 0, 'Typing e in search does not expand');
      await page.locator('#ri-search').fill(''); assert.equal(await aside.locator('.ri-row').count(), 2);
      // Event details: the stamped row pairs by eventId, the legacy row by source + title + observedAt.
      await aside.locator('.ri-row', { hasText: 'Fixture current GDACS' }).click();
      assert.equal(await aside.locator('.ri-detail').isVisible(), true); assert.match(await aside.locator('.ri-detail').innerText(), /Public data: safe text only/);
      await aside.locator('[data-ri-action="details"]').click(); await page.waitForSelector('#ci-dialog');
      assert.equal(await page.locator('#ci-title').innerText(), title); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#ci-overlay').count(), 0); assert(await aside.isVisible(), 'Closing the event detail leaves the inspector open');
      await page.screenshot({ path: path.join(artifacts, 'inspector-desktop-' + mode + '.png') });
      // Refresh keeps the selection and the focused row; a record that leaves the fresh set stays visible, marked outdated.
      await aside.locator('.ri-row[aria-selected="true"]').focus(); await page.evaluate(() => pollSnapshot());
      assert(await focused(page, '#record-inspector .ri-row[aria-selected="true"]'), 'Refresh keeps the focused, selected row');
      await page.evaluate(() => { D.liveSources.find(source => source.source === 'GDACS').observations = []; reinit(); });
      assert(await aside.locator('.ri-detail.ri-outdated .ri-badge').isVisible(), 'The selected record stays visible, marked no longer current');
      assert.equal(await aside.locator('.ri-row').count(), 0);
      await page.evaluate(() => pollSnapshot()); assert.equal(await aside.locator('.ri-outdated').count(), 0); assert.equal(await aside.locator('.ri-row[aria-selected="true"]').count(), 1);
      // Escape closes and returns focus to the card; a refresh keeps it closed.
      await aside.locator('.ri-row').first().focus(); await page.keyboard.press('Escape'); await aside.waitFor({ state: 'hidden' });
      assert.equal(await aside.getAttribute('aria-hidden'), 'true'); assert(await focused(page, '[data-open-records="GDACS"]'), 'Focus returns to the opener card');
      assert.equal(hash(page), ''); assert.equal(await page.locator('.live-source[data-selected]').count(), 0);
      await fetch(control); await page.evaluate(() => pollSnapshot()); assert(await aside.isHidden(), 'A refresh never reopens a closed inspector');
      // Map marker of the live row opens the paired event (both row shapes).
      if (!await page.evaluate(() => isFlat)) await page.locator('#projToggle').click();
      const marker = page.locator('.markers [aria-label="' + title.replace(/"/g, '\\"') + '"]'); await marker.waitFor({ state: 'attached' });
      await marker.click({ force: true }); await page.waitForSelector('#ci-dialog'); assert.equal(await page.locator('#ci-title').innerText(), title); await page.keyboard.press('Escape');
      if (!legacy) {
        // The alert tray docks where the inspector does: an inspector that opens closes the tray and is the panel on top;
        // a tray opened over the inspector leaves it open. (The card sits under the open tray: reached with the keyboard.)
        const alertTray = page.locator('#alertTray');
        await page.locator('#alertBell').click(); await alertTray.waitFor({ state: 'visible' });
        await card.focus(); await page.keyboard.press('Enter'); await aside.waitFor({ state: 'visible' });
        assert(await alertTray.isHidden(), 'Opening the inspector closes the alert tray'); assert(await focused(page, '#record-inspector .ri-row'), 'The focus is in the visible inspector');
        const panel = await aside.boundingBox();
        assert(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('#record-inspector'), [panel.x + panel.width / 2, panel.y + 40]), 'The inspector is the panel on top');
        await page.locator('#alertBell').click(); await alertTray.waitFor({ state: 'visible' }); assert(await aside.isVisible(), 'A tray opened over the inspector leaves it open');
        await alertTray.locator('[data-alert-action="close"]').click(); await alertTray.waitFor({ state: 'hidden' });
        // Expand with 'e', switch to all sources, collapse back with Escape, close with Escape.
        await card.click(); await aside.waitFor({ state: 'visible' }); await page.keyboard.press('e');
        const browserDialog = page.locator('#record-browser[open]'); await browserDialog.waitFor();
        assert.equal(await page.locator('#record-browser').getAttribute('aria-labelledby'), 'rb-heading'); assert.match(hash(page), /view=browser/); assert(await aside.isHidden());
        await browserDialog.locator('[data-ri-source="all"]').click(); assert.match(hash(page), /src=all/);
        const events = await page.evaluate(() => currentSnapshot().events.length); assert(await browserDialog.locator('.ri-row').count() === Math.min(25, events), 'All sources lists the snapshot events');
        await browserDialog.locator('.ri-row').first().click(); assert.equal(await browserDialog.locator('.rb-detail .ri-detail').isVisible(), true);
        await page.screenshot({ path: path.join(artifacts, 'browser-desktop.png') });
        await page.keyboard.press('Escape'); await aside.waitFor({ state: 'visible' }); assert.equal(await page.locator('#record-browser[open]').count(), 0); assert.match(hash(page), /src=GDACS/);
        await page.keyboard.press('Escape'); await aside.waitFor({ state: 'hidden' }); assert(await focused(page, '[data-open-records="GDACS"]'));
        // The hash restores the view on hashchange and on reload; a hostile hash opens nothing and throws nothing.
        await page.goto(target.origin + '/#src=GDACS&sev=high', { waitUntil: 'domcontentloaded' }); await aside.waitFor({ state: 'visible' }); assert.equal(await aside.locator('.ri-row').count(), 1);
        await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#eventsTrigger'); await aside.waitFor({ state: 'visible' }); await page.waitForTimeout(1500);
        assert.equal(await aside.locator('.ri-chip[data-ri-level="high"]').getAttribute('aria-pressed'), 'true'); assert.equal(await aside.locator('.ri-row').count(), 1, 'Reload with the hash reopens the same view');
        const reloadedBar = await page.locator('#alertStrip').boundingBox(); assert(Math.abs((await aside.boundingBox()).y - Math.max(0, reloadedBar.y + reloadedBar.height)) <= 1, 'Opened before the top bar and the strip were filled, the panel still docks below them');
        for (const hostile of ['#src=__proto__&rec=nope', '#src=__proto__&sev=<script>&win=999&q=%00&rec=nope&view=evil']) {
          await page.goto(target.origin + '/' + hostile, { waitUntil: 'domcontentloaded' }); assert(await aside.isHidden(), 'A hostile hash closes the view');
          await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#eventsTrigger'); await page.waitForTimeout(1500);
          assert(await aside.isHidden()); assert.equal(await page.locator('#record-browser[open]').count(), 0, 'A hostile hash opens nothing');
        }
      }
      assert.equal(await page.evaluate(() => window.__liveXss), undefined, 'Hostile live titles stay inert');
      console.log('INSPECTOR desktop PASS', { mode });
    } finally { await context.close(); }
  }
  // Narrow screens: the inspector is a bottom sheet, the browser is full screen.
  await fetch(target.origin + '/control?liveSources=true');
  const { context, page } = await prepare({ width: 390, height: 844 });
  try {
    const card = page.locator('button.live-open[data-open-records="GDACS"]'), aside = page.locator('#record-inspector');
    await card.scrollIntoViewIfNeeded(); await card.click(); await aside.waitFor({ state: 'visible' });
    await aside.locator('.ri-row').first().click(); await page.waitForTimeout(300);
    const box = await aside.boundingBox(), detail = await aside.locator('.ri-detail').boundingBox();
    assert(box && Math.abs(box.width - 390) < 1 && Math.abs(box.y + box.height - 844) < 1 && box.height <= 844 * 0.75 + 1, 'Bottom sheet: full width, docked to the bottom, at most 75% high');
    assert(detail && detail.y >= box.y && detail.y + detail.height <= box.y + box.height + 1, 'The detail stays inside the sheet');
    assert(await aside.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'No horizontal clipping');
    await page.screenshot({ path: path.join(artifacts, 'inspector-mobile.png') });
    await aside.locator('[data-ri-action="expand"]').click(); await page.locator('#record-browser[open]').waitFor();
    const sheet = await page.locator('#record-browser').boundingBox(); assert(sheet && sheet.width <= 390 && sheet.height <= 844);
    await page.locator('#record-browser .ri-row').last().click(); const shown = await page.locator('#record-browser .rb-detail .ri-detail').boundingBox();
    assert(shown && shown.y >= 0 && shown.y < 844 && await page.locator('#rb-heading').isVisible(), 'A tap in the stacked browser brings the detail into view, the header stays');
    await page.screenshot({ path: path.join(artifacts, 'browser-mobile.png') });
    await page.locator('#record-browser [data-ri-action="close"]').click(); assert.equal(await page.locator('#record-browser[open]').count(), 0); assert(await aside.isHidden());
    assert.equal(await page.evaluate(() => window.__liveXss), undefined);
    console.log('INSPECTOR mobile PASS', { sheet: box });
  } finally { await context.close(); await fetch(target.origin + '/control?liveSources=false'); }
}
// Alerts: the strip under the top bar, the threat drivers, the tray (tabs, acknowledge, snooze, evidence), toasts, the tab
// title, Esc and focus return, hostile titles, the phone layout. Its own Chromium shows classic scrollbars (Playwright hides
// them by default), so a scrollbar artefact in the screenshots is a real one.
async function alertChecks() {
  const control = async mode => assert.equal(await (await fetch(target.origin + '/control?alerts=' + mode)).text(), 'ok');
  const threat = page => page.locator('#alertStrip .as-threat').innerText();
  const level = (page, n) => page.waitForFunction(n => document.querySelector('#alertStrip .as-threat')?.textContent.includes(n + '/5'), n);
  const focused = (page, selector) => page.evaluate(selector => !!document.activeElement?.matches(selector), selector);
  const owner = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    await control('seed');
    await desktop(await prepare({ width: 1440, height: 1000 }, 'en', false, owner));
    // Phone: the strip wraps inside the width, the tray is a bottom sheet, the toast spans the width.
    await control('seed');
    await phone(await prepare({ width: 390, height: 844 }, 'en', false, owner));
  } finally { await owner.close(); await control('clear'); }
  async function desktop({ context, page }) {
    try {
      const strip = page.locator('#alertStrip'), tray = page.locator('#alertTray'), bell = page.locator('#alertBell');
      const ids = await page.evaluate(() => Object.fromEntries(D.alerts.top.map(alert => [alert.severity, alert.id])));
      assert(ids.critical && ids.high && ids.watch, 'The fixture seeded a firing alert of each level');
      assert.deepEqual(await strip.evaluate(node => [node.previousElementSibling?.id, node.nextElementSibling?.className, node.getAttribute('role'), !!node.getAttribute('aria-label')]), ['topbar', 'grid', 'region', true], 'The strip is a named region between the top bar and the grid');
      assert.match(await threat(page), /5\/5/); assert.match(await strip.innerText(), /Fixture critical alert/);
      assert.match(await page.title(), /^\(2\) /, 'The tab title counts firing critical + high alerts'); assert.match(await bell.innerText(), /3/, 'The bell shows the firing count');
      await page.evaluate(() => renderTopbar()); assert.equal(await strip.count(), 1); assert.equal(await bell.count(), 1, 'Strip and bell survive a top bar re-render');
      assert.equal(await page.evaluate(() => window.__alertXss), undefined); assert.equal(await page.locator('#alertStrip img').count(), 0);
      await page.screenshot({ path: path.join(artifacts, 'alerts-strip-desktop.png') });
      // The threat badge opens the tray with the alerts that drive the level; a second click hides them again.
      await strip.locator('.as-threat').click(); await tray.waitFor({ state: 'visible' });
      assert.deepEqual([await tray.getAttribute('aria-hidden'), await tray.getAttribute('role'), await tray.getAttribute('aria-labelledby')], ['false', 'region', 'at-heading']);
      assert.equal(await strip.locator('.as-threat').getAttribute('aria-expanded'), 'true'); assert.equal(await tray.locator('.at-drivers li').count(), 3);
      assert.match(await tray.locator('.at-drivers li').first().innerText(), /Fixture critical alert/);
      const stripBox = await strip.boundingBox(), trayBox = await tray.boundingBox();
      assert(Math.abs(trayBox.y - (stripBox.y + stripBox.height)) <= 1 && Math.abs(trayBox.x + trayBox.width - 1440) <= 1, 'The tray docks right, below the strip');
      await strip.locator('.as-threat').click(); assert.equal(await tray.locator('.at-drivers').count(), 0); assert(await tray.isVisible(), 'The tray stays open without the drivers');
      await tray.locator('[data-alert-action="close"]').click(); await tray.waitFor({ state: 'hidden' }); assert.equal(await tray.getAttribute('aria-hidden'), 'true');
      // The bell opens the tray: firing alerts, most severe first; the acknowledged one is under Handled.
      await bell.click(); await tray.waitFor({ state: 'visible' }); assert.equal(await bell.getAttribute('aria-expanded'), 'true');
      assert.equal(await bell.evaluate(node => getComputedStyle(node).color), await strip.locator('.as-threat').evaluate(node => getComputedStyle(node).color), 'The hovered bell keeps the threat colour');
      await page.waitForFunction(() => document.querySelectorAll('#alertTray .at-alert').length === 3);
      assert.deepEqual(await tray.locator('.at-alert').evaluateAll(rows => rows.map(row => row.dataset.alertId)), [ids.critical, ids.high, ids.watch], 'Sorted by severity');
      assert.match(await tray.locator('#at-tab-handled').innerText(), /1/); assert(await focused(page, '#alertTray #at-tab-active'), 'Opening moves focus to the active tab');
      assert.equal(await page.evaluate(() => window.__alertXss), undefined, 'Hostile alert titles stay inert'); assert.equal(await page.locator('#alertTray img').count(), 0);
      await page.screenshot({ path: path.join(artifacts, 'alerts-tray-desktop.png') });
      // Acknowledge: the critical moves to Handled, the threat drops to 4 and the title count to 1.
      await tray.locator(`.at-alert[data-alert-id="${ids.critical}"] [data-alert-action="ack"]`).click(); await level(page, 4);
      await page.waitForFunction(id => !document.querySelector(`#alertTray #at-panel .at-alert[data-alert-id="${id}"]`), ids.critical);
      assert.match(await page.title(), /^\(1\) /); assert.match(await bell.innerText(), /2/);
      await tray.locator('#at-tab-handled').click(); assert.equal(await tray.locator(`.at-alert[data-alert-id="${ids.critical}"] .at-state-acked`).count(), 1);
      await tray.locator('#at-tab-active').click(); await page.keyboard.press('ArrowRight'); assert(await focused(page, '#at-tab-handled[aria-selected="true"]'), 'Arrow keys move along the tabs');
      await page.keyboard.press('ArrowLeft'); assert(await focused(page, '#at-tab-active[aria-selected="true"]'));
      // Snooze ▾ stays open, with the focus, across a live update; Esc closes the menu first, the tray stays.
      const row = tray.locator(`.at-alert[data-alert-id="${ids.high}"]`), toggle = row.locator('[data-alert-action="snooze-menu"]');
      await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'), 'true'); assert(await row.locator('[data-minutes="60"]').isVisible());
      await page.evaluate(() => pollSnapshot()); await page.waitForTimeout(800);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'An update keeps the snooze menu open'); assert(await focused(page, `[data-alert-action="snooze-menu"][data-alert-id="${ids.high}"]`), 'An update keeps the focus');
      await page.keyboard.press('Escape'); assert.equal(await toggle.getAttribute('aria-expanded'), 'false'); assert(await tray.isVisible()); assert(await focused(page, `[data-alert-action="snooze-menu"][data-alert-id="${ids.high}"]`));
      await toggle.click(); await row.locator('[data-alert-action="snooze"][data-minutes="60"]').click(); await level(page, 3);
      await tray.locator('#at-tab-handled').click(); assert.match(await tray.locator(`.at-alert[data-alert-id="${ids.high}"] .at-state`).innerText(), /Snoozed until/);
      // Evidence opens the event detail over the tray.
      const evidence = tray.locator(`.at-alert[data-alert-id="${ids.high}"] [data-alert-action="evidence"]`).first(), eventTitle = await evidence.innerText();
      await evidence.click(); await page.waitForSelector('#ci-dialog'); assert.equal(await page.locator('#ci-title').innerText(), eventTitle);
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#ci-overlay').count(), 0); assert(await tray.isVisible(), 'Closing the event detail leaves the tray open');
      // Esc closes the tray and returns the focus to the bell.
      await tray.locator('#at-tab-handled').focus(); await page.keyboard.press('Escape'); await tray.waitFor({ state: 'hidden' });
      assert.equal(await tray.getAttribute('aria-hidden'), 'true'); assert(await focused(page, '#alertBell'), 'Esc returns the focus to the bell');
      // Open from the strip focuses the alert in the tray; Esc returns to the strip button.
      await strip.locator('[data-alert-action="open"]').click(); await tray.waitFor({ state: 'visible' });
      await page.waitForFunction(id => document.activeElement?.closest?.('.at-alert')?.dataset.alertId === id, ids.watch);
      await page.keyboard.press('Escape'); await tray.waitFor({ state: 'hidden' }); assert(await focused(page, '#alertStrip [data-alert-action="open"]'));
      // A new critical alert: a toast with role="alert" that no timer removes; the threat is back at 5.
      await control('newcritical'); const toast = page.locator('#alertToasts .al-toast'); await toast.waitFor();
      assert.equal(await toast.count(), 1); assert.equal(await toast.getAttribute('role'), 'alert'); assert.match(await toast.innerText(), /Fixture new critical alert/);
      await level(page, 5); assert.match(await page.title(), /^\(1\) /);
      await page.screenshot({ path: path.join(artifacts, 'alerts-toast-desktop.png') });
      await page.waitForTimeout(4000); assert.equal(await toast.count(), 1, 'No timer dismisses a toast');
      await toast.locator('[data-alert-action="dismiss"]').click(); assert.equal(await toast.count(), 0); assert(await page.locator('#alertToasts').isHidden(), 'The empty stack takes no room');
      assert.equal(await page.evaluate(() => window.__alertXss), undefined);
      console.log('ALERTS desktop PASS', { ids });
    } finally { await context.close(); }
  }
  async function phone({ context, page }) {
    try {
      const strip = page.locator('#alertStrip'), tray = page.locator('#alertTray');
      const box = await strip.boundingBox(); assert(box.width <= 390 && box.height > 60, 'The strip wraps to several rows');
      assert(await strip.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Nothing in the strip is clipped');
      assert(await page.evaluate(() => document.body.scrollWidth <= innerWidth && document.documentElement.scrollWidth <= innerWidth), 'No horizontal page scroll');
      await strip.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(artifacts, 'alerts-strip-mobile.png') });
      await page.locator('#alertBell').click(); await tray.waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelectorAll('#alertTray .at-alert').length === 3); await page.waitForTimeout(300);
      const sheet = await tray.boundingBox(), panel = await tray.locator('.at-panel').boundingBox();
      assert(Math.abs(sheet.width - 390) < 1 && Math.abs(sheet.y + sheet.height - 844) < 1 && sheet.height <= 844 * 0.75 + 1, 'Bottom sheet: full width, docked to the bottom, at most 75% high');
      assert(panel.height >= 96 && await tray.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'The list stays reachable, nothing clipped sideways');
      await page.screenshot({ path: path.join(artifacts, 'alerts-tray-mobile.png') });
      await page.keyboard.press('Escape'); await tray.waitFor({ state: 'hidden' });
      await control('newcritical'); const toast = page.locator('#alertToasts .al-toast'); await toast.waitFor(); await page.waitForTimeout(300);
      const card = await toast.boundingBox(); assert(card.x >= 0 && card.x + card.width <= 390 && card.y + card.height <= 844, 'The toast fits the phone screen');
      await page.screenshot({ path: path.join(artifacts, 'alerts-toast-mobile.png') });
      console.log('ALERTS mobile PASS', { strip: box, sheet });
    } finally { await context.close(); }
  }
}
try {
  if (phase === 'detail' || phase === 'all') await detailChecks();
  if (phase === 'history' || phase === 'all') { await historyChecks(); await clusterChecks(); }
  if (phase === 'profiles' || phase === 'all') await profileChecks();
  if (phase === 'inspector' || phase === 'all') await inspectorChecks();
  if (phase === 'alerts' || phase === 'all') await alertChecks();
  assert.deepEqual(errors, [], 'No browser runtime errors'); assert.deepEqual(external, [], 'No unexpected external requests');
  if (phase === 'profiles' || phase === 'all') assert.deepEqual(legacyAssets, [], 'PWA phase loads all assets locally without legacy CDN routing');
  console.log('Intelligence UI QA passed', { phase, target: target.origin, artifacts, browserPlugin: 'not available; existing Playwright used' });
} finally { await browser.close(); }
