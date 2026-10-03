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
assert(['detail', 'history', 'profiles', 'inspector', 'live', 'alerts', 'structure', 'all'].includes(phase), 'QA_PHASE is detail, history, profiles, inspector, live, alerts, structure, or all');
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
        // Activating the records card while the inspector is already open closes the tray too (it was only closed on closed -> open before).
        await card.focus(); await page.keyboard.press('Enter'); await alertTray.waitFor({ state: 'hidden'});
        assert(await aside.isVisible() && await focused(page, '#record-inspector .ri-row'), 'The card puts the focus into the inspector and the tray steps aside');
        // Expand with 'e', switch to all sources, collapse back with Escape, close with Escape. The docked inspector covers the card
        // (before the domain groups too: card at x 1101, inspector from x 960 at 1440 px), so the card is reached with the keyboard.
        await card.focus(); await page.keyboard.press('Enter'); await aside.waitFor({ state: 'visible' }); await page.keyboard.press('e');
        const browserDialog = page.locator('#record-browser[open]'); await browserDialog.waitFor();
        assert.equal(await page.locator('#record-browser').getAttribute('aria-labelledby'), 'rb-heading'); assert.match(hash(page), /view=browser/); assert(await aside.isHidden());
        await browserDialog.locator('[data-ri-source="all"]').click(); assert.match(hash(page), /src=all/);
        const events = await page.evaluate(() => currentSnapshot().events.length); assert(await browserDialog.locator('.ri-row').count() === Math.min(25, events), 'All sources lists the snapshot events');
        await browserDialog.locator('.ri-row').first().click(); assert.equal(await browserDialog.locator('.rb-detail .ri-detail').isVisible(), true);
        await page.screenshot({ path: path.join(artifacts, 'browser-desktop.png') });
        await page.keyboard.press('Escape'); await aside.waitFor({ state: 'visible' }); assert.equal(await page.locator('#record-browser[open]').count(), 0); assert.match(hash(page), /src=GDACS/);
        await page.keyboard.press('Escape'); await aside.waitFor({ state: 'hidden' }); assert(await focused(page, '[data-open-records="GDACS"]'));
        // A hash that opens the inspector while the focus is in the tray hands the focus to the inspector (not to the page).
        await page.keyboard.press('Escape'); await aside.waitFor({ state: 'hidden' });
        await page.locator('#alertBell').click(); await alertTray.waitFor({ state: 'visible' }); await alertTray.locator('#at-tab-active').focus();
        await page.evaluate(() => { location.hash = '#src=GDACS'; }); await aside.waitFor({ state: 'visible' });
        assert(await alertTray.isHidden(), 'The inspector took the place of the tray'); assert(await focused(page, '#record-inspector .ri-row'), 'The focus went into the inspector instead of dropping to the page');
        await page.keyboard.press('Escape'); await aside.waitFor({ state: 'hidden' });
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
// The nineteen live sources: one current card each (desktop and phone), the new kinds in the history type filter, the alert metrics of the
// new sources with their current values, and a map marker per located kind in its own layer and colour (flat and globe); the EMSC copy of
// the USGS fixture quake is drawn once. Classic scrollbars, as in the alert phase.
async function liveChecks() {
  assert.equal(await (await fetch(target.origin + '/control?liveSources=true')).text(), 'ok');
  const rules = await (await fetch(target.origin + '/api/alerts/rules')).json(), value = key => rules.metrics.find(metric => metric.key === key)?.value;
  assert.deepEqual(['hormuz_transits', 'suez_transits', 'hu_power_price', 'grid_frequency_hz', 'mil_aircraft_total', 'dover_transits'].map(value), [3.1, 40, 172.6, 50.0307, 71, null], 'the rules API reads the live metrics (null when the source publishes none)');
  const NEW_KINDS = ['earthquake', 'maritime', 'aviation', 'sanctions', 'market', 'energy'];
  const MARKERS = { 'IMF-PortWatch': ['maritime', 'rgba(179,136,255,0.8)'], EMSC: ['earthquake', 'rgba(255,112,67,0.8)'], 'Copernicus-EMS': ['disaster', 'rgba(255,112,67,0.8)'], 'Aviation-SIGMET': ['weather', 'rgba(100,200,255,0.8)'], 'ADSB-Military': ['air', 'rgba(100,240,200,0.8)'] };
  const owner = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    for (const [width, height, size] of [[1440, 1000, 'desktop'], [390, 844, 'mobile']]) {
      const { context, page } = await prepare({ width, height }, 'en', false, owner);
      try {
        const sources = await page.evaluate(() => Object.keys(CrucixLiveSources.policies)), panel = page.locator('.live-sources-panel');
        assert.equal(sources.length, 19, 'nineteen sources in the browser policy copy');
        await panel.scrollIntoViewIfNeeded();
        // The cards sit in domain groups (lens-core.js): at most eight, a header button each, open by default only when the group needs
        // attention (here hazards: the GDACS Orange and SIGMET high records). Collapsed, the panel stays short; expanded, every card is reachable.
        const heads = panel.locator('button.live-group-head'), domains = await heads.evaluateAll(nodes => nodes.map(node => node.dataset.liveGroup));
        assert(domains.length > 0 && domains.length <= 8, 'the cards are grouped by domain');
        assert.deepEqual(await heads.evaluateAll(nodes => nodes.map(node => [node.getAttribute('aria-controls'), node.closest('.live-group').dataset.attention === 'true', node.getAttribute('aria-expanded') === 'true'])),
          domains.map(domain => ['live-group-' + domain, domain === 'hazards', domain === 'hazards']), 'only the attention group starts open');
        const setGroups = async open => { for (const domain of domains) { const head = panel.locator(`button.live-group-head[data-live-group="${domain}"]`); if (await head.getAttribute('aria-expanded') !== String(open)) await head.click(); } };
        await setGroups(false);
        const collapsed = (await panel.boundingBox()).height;
        if (size === 'desktop') assert(collapsed <= 420, 'the collapsed live panel is at most 420 px tall: ' + collapsed);
        assert.equal(await panel.locator('button.live-open:visible').count(), 0, 'collapsed groups hide their cards');
        await panel.screenshot({ path: path.join(artifacts, `live-panel-${size}-collapsed.png`) });
        await setGroups(true);
        const grouped = await page.evaluate(names => CrucixDomains.DOMAIN_IDS.flatMap(id => names.filter(name => CrucixDomains.domainOfSource(name) === id)), sources);
        assert.deepEqual(await panel.locator('.live-source').evaluateAll(nodes => nodes.map(node => [node.dataset.liveSource, node.dataset.liveState])), grouped.map(source => [source, 'ok']), 'one current card per source, grouped by domain, in policy order inside a group');
        assert.match(await panel.locator('.sec-head .badge').innerText(), /^19\/19$/);
        assert.equal(await panel.locator('button.live-open:visible').count(), 19, 'every current source can open its records once its group is open');
        assert(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'no card is clipped sideways');
        assert(await page.evaluate(() => document.body.scrollWidth <= innerWidth && document.documentElement.scrollWidth <= innerWidth), 'no horizontal page scroll');
        // The page scrolls <body>, so an element screenshot paints only the first screen of a panel this tall: one viewport shot per screen instead.
        const top = await panel.evaluate(node => node.getBoundingClientRect().top + document.body.scrollTop), tall = (await panel.boundingBox()).height;
        for (let offset = 0, part = 1; offset < tall; offset += height - 120, part++) {
          await page.evaluate(y => { document.body.scrollTop = y; }, top + offset - 60); await page.waitForTimeout(150);
          await page.screenshot({ path: path.join(artifacts, `live-panel-${size}-${part}.png`) });
        }
        await page.evaluate(() => { document.body.scrollTop = 0; });
        if (size === 'mobile') { console.log('LIVE mobile PASS', { cards: sources.length, groups: domains.length, collapsed }); continue; }
        // History: the type filter offers the new kinds, labelled; one maritime record however often the fixture re-sends the row.
        assert(await page.evaluate(() => CrucixIntelligence.openHistory())); await page.waitForSelector('#ci-history-kind');
        const kinds = await page.locator('#ci-history-kind option').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.value, node.textContent])));
        for (const kind of NEW_KINDS) assert(kinds[kind] && kinds[kind] !== kind, 'history filter offers ' + kind);
        await fetch(target.origin + '/control?liveSources=true');
        await page.locator('#ci-history-kind').selectOption('maritime');
        await page.waitForFunction(() => document.querySelector('.ci-history-status')?.innerText.startsWith('1 ') && document.querySelector('.ci-event-card')?.innerText.includes('IMF-PortWatch'));
        await page.screenshot({ path: path.join(artifacts, 'live-history-maritime.png') }); await page.keyboard.press('Escape');
        // Flat map (the desktop default): a marker per located new kind, in its layer, with its colour; the EMSC copy of the USGS quake is not drawn.
        if (!await page.evaluate(() => isFlat)) await page.locator('#projToggle').click();
        const title = source => 'Fixture current ' + source + ' <img onerror="window.__liveXss=1">';
        for (const [source, [layer, color]] of Object.entries(MARKERS)) {
          const marker = page.locator(`.markers [aria-label="${title(source).replace(/"/g, '\\"')}"]`); await marker.waitFor({ state: 'attached' });
          assert.deepEqual([await marker.getAttribute('data-layer'), await marker.locator('circle').getAttribute('fill')], [layer, color], source);
        }
        assert.equal(await page.locator('.markers [aria-label="Fixture EMSC copy of the USGS quake"]').count(), 0, 'the EMSC copy of the USGS quake is drawn once (flat)');
        assert(await page.evaluate(() => D.events.some(event => event.title === 'Fixture EMSC copy of the USGS quake')), 'the copy stays an event');
        await page.locator('#mapContainer').scrollIntoViewIfNeeded(); await page.locator('#mapContainer').screenshot({ path: path.join(artifacts, 'live-map-flat.png') });
        // Zoomed: the Gulf (PortWatch Hormuz, the Gulf air theater, the Baku SIGMET) and the north-west Pacific (EMSC Kamchatka, the USGS quake).
        for (const region of ['middleEast', 'asiaPacific']) { await page.locator(`.region-btn[data-region="${region}"]`).click(); await page.waitForTimeout(1200); await page.locator('#mapContainer').screenshot({ path: path.join(artifacts, `live-map-flat-${region}.png`) }); }
        await page.locator('.region-btn[data-region="world"]').click(); await page.waitForTimeout(800);
        // The EMSC marker opens its event, like every live marker.
        await page.locator(`.markers [aria-label="${title('EMSC').replace(/"/g, '\\"')}"]`).click({ force: true }); await page.waitForSelector('#ci-dialog');
        assert.match(await page.locator('#ci-title').innerText(), /Fixture current EMSC/); assert.match(await page.locator('#ci-body').innerText(), /Earthquake/); await page.keyboard.press('Escape');
        // Globe: the same rows, types and colours; Middle East view for the screenshot (Hormuz, the Gulf theater, the Baku SIGMET).
        await page.locator('#projToggle').click(); await page.waitForFunction(() => !isFlat && globe?.pointsData().length > 0);
        const points = await page.evaluate(() => globe.pointsData().filter(point => Object.hasOwn(CrucixLiveSources.policies, point.popMeta)).map(point => [point.popMeta, point.type, point.color, point.popHead]));
        for (const [source, [layer, color]] of Object.entries(MARKERS)) assert(points.some(point => point[0] === source && point[1] === layer && point[2] === color), 'globe: ' + source);
        assert(!points.some(point => point[3] === 'Fixture EMSC copy of the USGS quake'), 'the EMSC copy of the USGS quake is drawn once (globe)');
        await page.locator('.region-btn[data-region="middleEast"]').click(); await page.waitForTimeout(1500);
        await page.locator('#mapContainer').screenshot({ path: path.join(artifacts, 'live-map-globe.png') });
        assert.equal(await page.evaluate(() => window.__liveXss), undefined, 'hostile live titles stay inert');
        console.log('LIVE desktop PASS', { cards: sources.length, groups: domains.length, collapsed, markers: Object.keys(MARKERS), kinds: NEW_KINDS });
      } finally { await context.close(); }
    }
  } finally { await owner.close(); await fetch(target.origin + '/control?liveSources=false'); }
}
// Alerts: the strip under the top bar, the threat drivers, the tray (tabs, acknowledge, snooze, evidence, the rules editor), toasts,
// the tab title, Esc and focus return, hostile titles, the phone layout. Its own Chromium shows classic scrollbars (Playwright hides
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
      assert.deepEqual(await strip.evaluate(node => [node.previousElementSibling?.id, node.nextElementSibling?.id, node.nextElementSibling?.nextElementSibling?.className, node.getAttribute('role'), !!node.getAttribute('aria-label')]), ['topbar', 'lensBar', 'grid', 'region', true], 'The strip is a named region between the top bar and the lens bar, which sits on the grid');
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
      // textContent, not innerText: a row is content-visibility:auto and its contents are skipped until the next frame, so innerText can be empty right after the redraw.
      await tray.locator('#at-tab-handled').click(); assert.match(await tray.locator(`.at-alert[data-alert-id="${ids.high}"] .at-state`).textContent(), /Snoozed until/);
      // Evidence opens the event detail over the tray.
      const evidence = tray.locator(`.at-alert[data-alert-id="${ids.high}"] [data-alert-action="evidence"]`).first(), eventTitle = (await evidence.textContent()).trim();
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
      await trayOverToasts(page, 'desktop');
      await rulesChecks(page, false);
      console.log('ALERTS desktop PASS', { ids });
    } finally { await context.close(); }
  }
  // Toasts never cover the open tray: three new critical alerts toast, then the tray opens over them; every tray button on screen
  // (inside its scroll area) must take its own clicks (elementFromPoint at its centre). Closing the tray brings the toasts back.
  async function trayOverToasts(page, size) {
    const toasts = page.locator('#alertToasts .al-toast'), tray = page.locator('#alertTray');
    for (let n = 1; n <= 3; n++) { await control('newcritical'); await page.waitForFunction(n => document.querySelectorAll('#alertToasts .al-toast').length === n, n); }
    await page.waitForTimeout(300); await page.screenshot({ path: path.join(artifacts, `alerts-toasts-${size}.png`) });
    await page.locator('#alertBell').click(); await tray.waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelectorAll('#alertTray .at-alert').length >= 4); await page.waitForTimeout(300);
    assert(await page.locator('#alertToasts').isHidden(), 'The toasts step aside while the tray is open'); assert.equal(await toasts.count(), 3, 'They are kept, not dropped');
    const hits = await page.evaluate(() => {
      const trayBox = document.getElementById('alertTray').getBoundingClientRect(), checked = [], covered = [];
      for (const node of document.querySelectorAll('#alertTray button')) {
        const r = node.getBoundingClientRect(), area = node.closest('.at-panel, .at-drivers')?.getBoundingClientRect() ?? trayBox, x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (!r.width || !r.height || x < area.left || x > area.right || y < area.top || y > area.bottom || y > innerHeight) continue;
        checked.push(node.textContent.trim().slice(0, 20));
        if (!node.contains(document.elementFromPoint(x, y))) covered.push(node.textContent.trim().slice(0, 20));
      }
      const first = document.querySelector('#alertTray .at-alert .at-actions button'), box = first.getBoundingClientRect();
      return { checked: checked.length, covered, firstFree: first.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) };
    });
    assert(hits.firstFree, 'The first action button of the tray is not covered'); assert(hits.checked >= 8, 'Enough tray buttons on screen to check: ' + hits.checked);
    assert.deepEqual(hits.covered, [], 'No tray button on screen is under a toast');
    await page.screenshot({ path: path.join(artifacts, `alerts-tray-toasts-${size}.png`) });
    await page.keyboard.press('Escape'); await tray.waitFor({ state: 'hidden' });
    assert(await page.locator('#alertToasts').isVisible(), 'The toasts come back when the tray closes'); assert.equal(await toasts.count(), 3);
    while (await toasts.count()) await toasts.first().locator('[data-alert-action="dismiss"]').click();
    console.log('ALERTS tray over toasts PASS', { size, ...hits });
  }
  // The Rules tab: the list, a toggle, an override and its reset, the form for two kinds, a rejected rule (the server's message at the
  // field), a new threshold rule on the VIX, editing and Esc, a hostile name, the delete question. Everything it creates it deletes.
  async function rulesChecks(page, phone) {
    const tray = page.locator('#alertTray'), bell = page.locator('#alertBell'), size = phone ? 'mobile' : 'desktop';
    const rule = id => tray.locator(`.ar-rule[data-rule-id="${id}"]`);
    const shot = name => page.screenshot({ path: path.join(artifacts, `alerts-rules-${name}-${size}.png`) });
    const fits = async what => assert(await tray.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `Nothing in the Rules tab is clipped sideways: ${what}`);
    if (!await tray.isVisible()) { await bell.click(); await tray.waitFor({ state: 'visible' }); }
    await tray.locator('#at-tab-rules').click(); await tray.locator('.ar-rule').first().waitFor();
    assert.equal(await tray.locator('.ar-rule').count(), 8, 'The eight built-in rules'); assert.equal(await tray.locator('.ar-source-builtin').count(), 8);
    assert.match(await rule('vix-spike').innerText(), /VIX spike[\s\S]*threshold[\s\S]*VIX > 30/i, 'Name, kind and the localised summary (CSS upper-cases the badges)');
    assert.match(await rule('events-high').innerText(), /= High/); assert.match(await rule('hungary-region').innerText(), /500 km @ 47\.5, 19/);
    assert.equal(await tray.locator('.ar-rule [data-rule-action="delete"], .ar-rule [data-rule-action="reset"]').count(), 0, 'No delete or reset on a pristine built-in');
    await fits('list'); await shot('list');
    // A toggle saves at once and keeps the focus; the rule is then an override that can be reset.
    const notify = rule('vix-spike').locator('[data-rule-toggle="notify"]');
    assert.equal(await notify.isChecked(), true); await notify.click(); await rule('vix-spike').locator('.ar-source-override').waitFor();
    assert.equal(await rule('vix-spike').locator('[data-rule-toggle="notify"]').isChecked(), false, 'The saved state is shown');
    assert(await focused(page, '#alertTray [data-rule-toggle="notify"][data-rule-id="vix-spike"]'), 'The toggle keeps the focus after the save');
    await rule('vix-spike').locator('[data-rule-action="reset"]').click(); await rule('vix-spike').locator('.ar-source-builtin').waitFor();
    assert.equal(await rule('vix-spike').locator('[data-rule-toggle="notify"]').isChecked(), true, 'Reset brings the default back'); assert.match(await tray.locator('.ar-status').innerText(), /reset to default/);
    // The form: the event fields first, then a threshold.
    await tray.locator('[data-rule-action="new"]').click(); await tray.locator('#ar-name').waitFor(); assert(await focused(page, '#ar-name'), 'The focus goes into the form');
    assert.equal(await tray.locator('.ar-list').count(), 0, 'The form replaces the list');
    assert.deepEqual(await tray.locator('.ar-form [data-rule-field]').evaluateAll(nodes => nodes.map(node => node.dataset.ruleField)),
      ['name', 'id', 'kind', 'params.minLevel', 'params.maxLevel', 'scope.kinds', 'scope.sources', 'scope.keywords', 'scope.radius.lat', 'scope.radius.lon', 'scope.radius.km', 'severity', 'forSweeps', 'cooldownMinutes', 'enabled', 'notify']);
    await tray.locator('[data-rule-action="preset-hungary"]').click(); assert.equal(await tray.locator('#ar-lat').inputValue(), '47.5'); assert.equal(await tray.locator('#ar-km').inputValue(), '500');
    await fits('event form'); await shot('form-event');
    await tray.locator('#ar-kind').selectOption('threshold'); assert(await focused(page, '#ar-kind'), 'Changing the type keeps the focus on it');
    assert.equal(await tray.locator('.ar-form [data-rule-field="params.metric"]').count(), 1); assert.equal(await tray.locator('[data-rule-action="preset-hungary"]').count(), 0);
    await tray.locator('#ar-metric').selectOption('vix'); assert.match(await tray.locator('#ar-metric').evaluate(node => node.selectedOptions[0].textContent), /^VIX — /, 'The metric option carries the current value');
    assert.match(await tray.locator('.ar-form .ar-hint').first().innerText(), /\S/);
    await tray.locator('#ar-name').fill('VIX over 30'); await tray.locator('#ar-value').fill('30'); await fits('threshold form'); await shot('form-threshold');
    // A rule the server refuses: the message sits at its field, what was typed stays, nothing is saved.
    await tray.locator('#ar-name').fill(''); await tray.locator('.ar-save').click();
    const nameError = tray.locator('[data-rule-field="name"] .ar-error'); await nameError.waitFor();
    assert.match(await nameError.innerText(), /must not be empty/); assert.match(await tray.locator('.ar-notice').innerText(), /Could not save the rule/);
    assert(await focused(page, '#ar-name'), 'The focus goes to the field the server named'); assert.equal(await tray.locator('#ar-value').inputValue(), '30', 'What was typed stays');
    assert.equal(await tray.locator('#ar-name').getAttribute('aria-invalid'), 'true'); assert.equal(await tray.locator('.ar-rule').count(), 0);
    await fits('error state'); await shot('form-error');
    await tray.locator('#ar-name').fill('VIX over 30'); await tray.locator('#ar-value').fill('abc'); await tray.locator('.ar-save').click();
    await tray.locator('[data-rule-field="params.value"] .ar-error').waitFor(); assert.match(await tray.locator('[data-rule-field="params.value"] .ar-error').innerText(), /number/, 'A value that is no number is named at its own field');
    await tray.locator('#ar-value').fill('30'); await tray.locator('.ar-save').click();
    await rule('vix-over-30').waitFor(); assert.match(await rule('vix-over-30').innerText(), /VIX over 30[\s\S]*custom[\s\S]*VIX > 30/i); assert.equal(await tray.locator('.ar-source-user').count(), 1);
    assert(await focused(page, '#alertTray [data-rule-action="edit"][data-rule-id="vix-over-30"]'), 'The focus goes to the new rule\'s Edit button'); assert.match(await tray.locator('.ar-status').innerText(), /Rule saved/);
    await page.waitForFunction(() => document.getElementById('alertRulesLive')?.textContent === 'Rule saved'); // The result is spoken through the status node (a moment after it is drawn)
    // Editing: the values come back; Esc closes the form first and the tray after.
    await rule('vix-over-30').locator('[data-rule-action="edit"]').click(); await tray.locator('#ar-value').waitFor();
    assert.equal(await tray.locator('#ar-value').inputValue(), '30'); assert.equal(await tray.locator('#ar-metric').inputValue(), 'vix'); assert.equal(await tray.locator('#ar-kind').count(), 0, 'The type of an existing rule is fixed');
    await page.keyboard.press('Escape'); assert.equal(await tray.locator('.ar-form').count(), 0); assert(await tray.isVisible(), 'The first Esc closes the form only');
    assert(await focused(page, '#alertTray [data-rule-action="edit"][data-rule-id="vix-over-30"]'), 'Esc returns the focus to the rule');
    // A live update does not take away a form that is open.
    await rule('vix-over-30').locator('[data-rule-action="edit"]').click(); await tray.locator('#ar-name').fill('Typing while the page updates'); await tray.locator('#ar-name').focus();
    await page.evaluate(() => pollSnapshot()); await page.waitForTimeout(900);
    assert.equal(await tray.locator('#ar-name').inputValue(), 'Typing while the page updates', 'A redraw of the tray keeps the form'); assert(await focused(page, '#ar-name'), 'and the focus');
    await tray.locator('[data-rule-action="cancel"]').click();
    // A hostile name stays text.
    await tray.locator('[data-rule-action="new"]').click(); await tray.locator('#ar-name').fill('<img src=x onerror="window.__ruleXss=1">'); await tray.locator('#ar-id').fill('hostile-rule'); await tray.locator('.ar-save').click();
    await rule('hostile-rule').waitFor(); assert.equal(await page.evaluate(() => window.__ruleXss), undefined); assert.equal(await tray.locator('img').count(), 0); assert.match(await rule('hostile-rule').innerText(), /<img src=x/);
    // The delete question, then the deletion; the page's rule count is the server's.
    for (const id of ['hostile-rule', 'vix-over-30']) {
      await rule(id).locator('[data-rule-action="delete"]').click(); assert(await focused(page, '#alertTray [data-rule-action="delete-confirm"]'), 'The question takes the focus');
      if (id === 'hostile-rule') { await rule(id).locator('[data-rule-action="cancel-confirm"]').click(); assert.equal(await rule(id).count(), 1, 'Cancel keeps the rule'); await rule(id).locator('[data-rule-action="delete"]').click(); }
      await rule(id).locator('[data-rule-action="delete-confirm"]').click(); await rule(id).waitFor({ state: 'detached' });
    }
    assert.match(await tray.locator('.ar-status').innerText(), /Rule deleted/); assert.equal(await tray.locator('.ar-rule').count(), 8); assert(await focused(page, '#alertTray [data-rule-action="new"]'));
    assert.equal(await page.evaluate(() => window.__ruleXss), undefined);
    await tray.locator('#at-tab-active').click(); assert.equal(await tray.locator('.ar-panel').count(), 0, 'Back on the Active tab');
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
      await toast.locator('[data-alert-action="dismiss"]').click();
      await trayOverToasts(page, 'mobile');
      await rulesChecks(page, true);
      console.log('ALERTS mobile PASS', { strip: box, sheet });
    } finally { await context.close(); }
  }
}
// Dashboard structure (2.12.0) over the fixture's seeded sweep archive (test/fixtures/dashboard-server.mjs): the domain lens (panels,
// source health, live markers and the changes chip re-render without a reload, the choice survives one), the collapsed live panel,
// Ctrl+K, the source-health matrix, a replay entered from a matrix cell (frozen clock, a live update kept aside, Back to live), an empty
// archive, the changes panel and its windows, a hostile source name and record title, and the phone width with each new layer open.
async function structureChecks() {
  const control = async query => assert.equal(await (await fetch(target.origin + '/control?' + query)).text(), 'ok');
  const json = async route => (await fetch(target.origin + route)).json();
  const focused = (page, selector) => page.evaluate(selector => !!document.activeElement?.matches(selector), selector);
  const shot = (page, name) => page.screenshot({ path: path.join(artifacts, `structure-${name}.png`) });
  const HOUR = 3600000, HOSTILE = '<img src=x onerror="window.__structureXss=1">';
  const SOURCES = ['GDELT', 'NOAA', 'FRED', 'WHO', HOSTILE, 'Fixture disabled', 'Fixture error', 'Fixture live', 'Fixture stale'];
  const NEW_RECORDS = ['Fixture current GDACS', 'Fixture current Aviation-SIGMET', 'Fixture current IMF-PortWatch', 'Fixture current ADSB-Military', 'M6.2 earthquake — Test earthquake', 'Fixture structure record'];
  const messages = JSON.parse(fs.readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));
  const measured = {};
  // What the page shows, and what it must show for a lens computed from D with the domain registry (not with the code under test).
  const view = page => page.evaluate(() => ({
    lens: [...document.querySelectorAll('#lensBar [data-lens][aria-pressed="true"]')].map(node => node.dataset.lens),
    groups: [...document.querySelectorAll('.live-sources-panel .live-group')].map(node => node.dataset.liveDomain),
    cards: document.querySelectorAll('.live-sources-panel .live-source').length,
    health: [...document.querySelectorAll('.source-health-panel .source-row > div')].map(node => node.firstChild?.textContent ?? ''),
    markers: document.querySelectorAll('.markers [aria-label^="Fixture current "]').length,
    chip: document.querySelector('#changesChip .ch-n')?.textContent ?? null,
  }));
  const expected = (page, lens) => page.evaluate(lens => {
    const domainOf = CrucixDomains.domainOfSource, keep = name => lens === 'all' || domainOf(name) === lens, c = D.changes;
    return {
      lens: [lens],
      groups: CrucixDomains.DOMAIN_IDS.filter(id => D.liveSources.some(source => domainOf(source.source) === id && keep(source.source))),
      cards: D.liveSources.filter(source => keep(source.source)).length,
      health: D.health.map(row => row.n).filter(keep),
      markers: CrucixLiveSources.markerRows(D.liveSources, D.earthquakes).filter(row => keep(row.source)).length,
      chip: String(lens === 'all' ? c.events.newTotal + c.sources.length + c.signals.length
        : c.events.new.filter(item => domainOf(item.source) === lens).length + c.sources.filter(item => domainOf(item.source) === lens).length),
    };
  }, lens);
  const flat = async page => { if (!await page.evaluate(() => isFlat)) await page.locator('#projToggle').click(); await page.waitForFunction(() => isFlat && document.querySelectorAll('.markers [aria-label^="Fixture current "]').length > 0); };
  const fromBody = async page => { await page.evaluate(() => { document.activeElement?.blur?.(); }); assert(await page.evaluate(() => document.activeElement === document.body), 'the focus is on the page body'); };
  const openPalette = async page => { await page.keyboard.press('Control+k'); await page.locator('#palette[open]').waitFor(); assert(await focused(page, '#palette-input'), 'the focus is in the palette input'); };
  const noXss = async (page, where) => {
    assert.equal(await page.evaluate(() => window.__structureXss), undefined, 'hostile names stay inert: ' + where);
    assert.equal(await page.locator('#changesPanel img, #health-matrix img, #palette img, .source-health-panel img, #replayBar img').count(), 0, 'no image element from a hostile name: ' + where);
  };
  await control('liveSources=true&archive=seed');
  try {
    const sweeps = (await json('/api/sweeps')).sweeps, matrix = await json('/api/source-health');
    assert(sweeps.length >= 5, 'the fixture archive holds at least five sweeps: ' + sweeps.length);
    assert.equal(Date.parse(sweeps[0].timestamp) - Date.parse(sweeps[2].timestamp), 2 * HOUR, 'the third newest sweep is two hours older than the newest');
    const { context, page } = await prepare({ width: 1280, height: 900 });
    try {
      // (1) The hazards lens: only hazards groups, health rows and live markers, and the chip counts the hazards changes; no reload.
      await flat(page);
      const all = await view(page), allExpected = await expected(page, 'all');
      assert.deepEqual(all, allExpected, 'lens all shows every group, source, marker and change');
      await page.locator('#lensBar [data-lens="hazards"]').click();
      const hazards = await view(page), hazardsExpected = await expected(page, 'hazards');
      assert.deepEqual(hazards, hazardsExpected, 'lens hazards re-renders panels, source health, live markers and the chip without a reload');
      assert.deepEqual(hazards.groups, ['hazards']); assert.deepEqual(hazards.health, ['NOAA']);
      assert(hazards.cards < all.cards && hazards.markers < all.markers && hazards.markers > 0 && Number(hazards.chip) < Number(all.chip), 'the lens narrowed every count');
      assert(await page.locator('.live-sources-panel .live-group[data-live-domain="hazards"] .live-group-body').isVisible(), 'the lens group is open');
      await shot(page, 'lens-hazards');
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#eventsTrigger'); await page.waitForTimeout(3800); await flat(page);
      assert.deepEqual(await view(page), await expected(page, 'hazards'), 'the lens survives a reload');
      await page.locator('#lensBar [data-lens="all"]').click();
      assert.deepEqual(await view(page), await expected(page, 'all'), 'back to all without a reload');
      measured.lens = { all: { cards: all.cards, health: all.health.length, markers: all.markers, chip: all.chip }, hazards: { cards: hazards.cards, health: hazards.health.length, markers: hazards.markers, chip: hazards.chip } };
      // (2) Every group collapsed: the live panel stays short at 1280 x 900.
      const panel = page.locator('.live-sources-panel');
      for (const head of await panel.locator('button.live-group-head[aria-expanded="true"]').all()) await head.click();
      assert.equal(await panel.locator('button.live-group-head[aria-expanded="true"]').count(), 0);
      measured.collapsedPanel = Math.round((await panel.boundingBox()).height * 10) / 10;
      assert(measured.collapsedPanel <= 420, 'the collapsed live panel is at most 420 px tall at 1280 px: ' + measured.collapsedPanel);
      await panel.scrollIntoViewIfNeeded(); await panel.screenshot({ path: path.join(artifacts, 'structure-live-collapsed.png') });
      // (3) Ctrl+K from the page body: "hazard" lists the lens action first, Enter switches the lens; Esc returns the focus to the opener.
      await page.evaluate(() => { document.body.scrollTop = 0; });
      await fromBody(page); await openPalette(page);
      await page.keyboard.type('hazard');
      const lensOption = page.locator('#palette-list [role="option"]', { hasText: 'Lens: ' + messages.lenses.hazards });
      await lensOption.waitFor(); assert.equal(await lensOption.getAttribute('aria-selected'), 'true', 'the lens action is the active result');
      assert.equal(await page.locator('#palette-input').getAttribute('aria-activedescendant'), await lensOption.getAttribute('id'));
      measured.paletteHazardResults = await page.locator('#palette-list [role="option"]').count();
      assert(measured.paletteHazardResults <= 12, 'at most 12 results');
      await shot(page, 'palette');
      await page.keyboard.press('Enter'); await page.locator('#palette').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => CrucixLens.get()), 'hazards', 'Enter applied the lens');
      assert.deepEqual((await view(page)).groups, ['hazards']);
      await page.locator('#lensBar [data-lens="all"]').click();
      await page.locator('#eventsTrigger').focus(); await openPalette(page); await page.keyboard.press('Escape');
      await page.locator('#palette').waitFor({ state: 'hidden' }); assert(await focused(page, '#eventsTrigger'), 'Esc returns the focus to where it was');
      // A history query lists records (the last group); End + Enter opens the record in the event detail.
      await fromBody(page); await openPalette(page); await page.keyboard.type('Test earthquake');
      const records = page.locator('#palette-list ul.pl-group:has(#pl-h-record) [role="option"]'); await records.first().waitFor();
      const recordTitle = (await records.last().locator('.pl-label').textContent()).trim();
      assert.match(recordTitle, /Test earthquake/);
      await page.keyboard.press('End'); assert.equal(await records.last().getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Enter'); await page.waitForSelector('#ci-dialog');
      assert.equal(await page.locator('#ci-title').innerText(), recordTitle, 'the record opened in the event detail'); await page.keyboard.press('Escape');
      await fromBody(page); await openPalette(page); await page.keyboard.type('structure record');
      const hostile = page.locator('#palette-list ul.pl-group:has(#pl-h-record) [role="option"]', { hasText: 'Fixture structure record' }); await hostile.waitFor();
      assert((await hostile.textContent()).includes(HOSTILE), 'the hostile title is listed as text'); await noXss(page, 'palette');
      await page.keyboard.press('Escape');
      // (4) The matrix from the source-health panel: one row per source, every cell as the API says, glyph and word.
      await page.locator('.source-health-panel [data-health-matrix]').click();
      await page.waitForFunction(() => document.getElementById('health-matrix')?.open && document.querySelectorAll('#health-matrix tr.hm-row').length > 0);
      const grid = await page.evaluate(() => [...document.querySelectorAll('#health-matrix tr.hm-row')].map(row => ({ source: row.querySelector('th.hm-src').textContent,
        cells: [...row.querySelectorAll('td.hm-c .hm-cell')].map(cell => [cell.dataset.state, cell.querySelector('.hm-g').textContent, cell.querySelector('.hm-sr').textContent, cell.getAttribute('data-hm-sweep')]), ms: row.querySelector('td.hm-ms').textContent })));
      assert.deepEqual(grid.map(row => row.source), matrix.sources.map(row => row.source), 'one row per source of the API, in its order');
      assert.deepEqual(grid.map(row => row.source).sort(), [...SOURCES].sort(), 'one row per fixture source');
      assert.equal(await page.locator('#health-matrix thead th.hm-time').count(), matrix.sweeps.length);
      const STATE = [['ok', '✓', 'OK'], ['stale', '◔', 'Stale'], ['error', '✕', 'Error'], ['disabled', '–', 'Disabled']], NODATA = ['nodata', '·', 'No data'];
      for (const [r, row] of matrix.sources.entries()) for (const [c, cell] of row.cells.entries()) assert.deepEqual(grid[r].cells[c], [...(cell ? STATE[cell[0]] : NODATA), matrix.sweeps[c].id], `cell ${row.source} @ ${c}`);
      const newest = Object.fromEntries(grid.map(row => [row.source, row.cells.at(-1).slice(0, 3)]));
      assert.deepEqual([newest['Fixture live'], newest['Fixture stale'], newest['Fixture error'], newest['Fixture disabled']], STATE, 'ok / stale / error / disabled: glyph and word');
      assert.deepEqual(grid.find(row => row.source === 'GDELT').cells[0].slice(0, 3), NODATA, 'a sweep without the source is "no data"');
      assert.equal(grid.find(row => row.source === 'Fixture live').ms, '120', 'the last run time of the newest sweep');
      await noXss(page, 'matrix'); await shot(page, 'matrix');
      // A cell of the sweep two hours ago enters the replay: banner, frozen clock, two live sources that are current only at that time.
      const old = sweeps[2], oldMs = Date.parse(old.timestamp);
      await page.locator(`#health-matrix button.hm-cell[data-hm-sweep="${old.id}"]`).first().click();
      await page.waitForFunction(ts => D.meta.timestamp === ts, old.timestamp);
      assert.equal(await page.evaluate(() => document.getElementById('health-matrix').open), false, 'the matrix closed');
      assert(await page.locator('#replayBar').isVisible() && await page.locator('#replayBar .rp-banner').isVisible(), 'the replay bar is shown');
      assert.equal(await page.locator('#replayBar .rp-banner').textContent(), messages.replay.banner);
      assert.equal(await page.locator('#replayBar .rp-position').innerText(), `${sweeps.length - 2} of ${sweeps.length}`);
      assert.equal(await page.locator('#replayTrigger').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await page.evaluate(() => [CrucixClock.frozen(), CrucixClock.now()]), [true, oldMs], 'the clock is frozen at the sweep time');
      const frozen = await page.evaluate(names => names.map(name => [name, document.querySelector(`.live-source[data-live-source="${name}"]`)?.dataset.liveState, CrucixLiveSources.state(D.liveSources.find(source => source.source === name), Date.now())]), ['ADSB-Military', 'NOAA-SWPC']);
      assert.deepEqual(frozen, [['ADSB-Military', 'ok', 'stale'], ['NOAA-SWPC', 'ok', 'stale']], 'observed ~2 h 10 min ago: ok at the sweep time, expired at the real time');
      assert.equal(await page.evaluate(() => D.changes.at), old.timestamp, 'the changes panel shows the replayed sweep\'s own changes');
      assert.equal(await page.locator('#changesPanel [data-changes-window="6h"]').getAttribute('aria-disabled'), 'true', 'the archive windows are off during the replay');
      await shot(page, 'replay-bar');
      // A live update during the replay is kept aside; Back to live applies it and releases the clock.
      await control('update=true'); const pushed = (await json('/api/data')).meta.timestamp;
      await page.waitForFunction(() => /Newer live data waiting: 1/.test(document.querySelector('#replayBar .rp-status')?.textContent || ''));
      assert.equal(await page.evaluate(() => D.meta.timestamp), old.timestamp, 'the live update did not change the replayed page');
      await page.locator('#replayBar [data-replay="exit"]').click();
      await page.waitForFunction(ts => D.meta.timestamp === ts, pushed);
      assert(await page.locator('#replayBar').isHidden(), 'the bar is gone'); assert(await focused(page, '#replayTrigger'), 'the focus is on the replay button');
      assert.equal(await page.evaluate(() => CrucixClock.frozen()), false); assert(Math.abs(await page.evaluate(() => CrucixClock.now() - Date.now())) < 1000, 'the real clock is back');
      assert.equal(await page.locator('.live-source[data-live-source="ADSB-Military"]').getAttribute('data-live-state'), 'ok');
      measured.replay = { sweep: old.id, position: `${sweeps.length - 2}/${sweeps.length}`, pushed };
      // (5) What changed: the new records of the fixture, every window fetched, a failing window keeps the content.
      const changes = await page.evaluate(() => D.changes), titles = changes.events.new.map(item => item.title);
      assert(!changes.baseline && changes.events.newTotal === titles.length, 'a real changes object');
      for (const title of NEW_RECORDS) assert(titles.some(item => item.startsWith(title)), 'new record: ' + title);
      const box = page.locator('#changesPanel'); await box.scrollIntoViewIfNeeded();
      await box.locator('[data-changes-more="records"]').click();
      assert.deepEqual(await page.locator('#changesPanel [data-changes-section="records"] .ch-title').allTextContents(), titles, 'every new record, in the server order');
      assert.deepEqual(await page.locator('#changesPanel [data-changes-section="sources"] .ch-name').allTextContents(), changes.sources.map(item => item.source));
      assert.deepEqual(changes.sources.map(item => [item.source, item.from, item.to]), [['NOAA', 'stale', 'ok'], [HOSTILE, 'error', 'ok']]);
      await noXss(page, 'changes panel'); await page.locator('#changesPanel').screenshot({ path: path.join(artifacts, 'structure-changes.png') });
      const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/changes?window=6h')), page.locator('#changesPanel [data-changes-window="6h"]').click()]);
      const six = await response.json();
      await page.waitForFunction(() => document.getElementById('changesPanel')?.dataset.window === '6h' && !document.getElementById('changesPanel').hasAttribute('aria-busy'));
      const sixTitles = await page.locator('#changesPanel [data-changes-section="records"] .ch-title').allTextContents();
      assert.deepEqual(sixTitles, six.events.new.map(item => item.title), 'the 6 h window shows the merged answer');
      assert.equal(await page.locator('#changesPanel [data-changes-window="6h"]').getAttribute('aria-pressed'), 'true');
      await page.route('**/api/changes?window=24h', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture"}' }));
      await page.locator('#changesPanel [data-changes-window="24h"]').click(); await page.locator('#changesPanel .ch-error').waitFor();
      assert.match(await page.locator('#changesPanel .ch-error').innerText(), /Could not load the 24 h changes/);
      assert.deepEqual(await page.locator('#changesPanel [data-changes-section="records"] .ch-title').allTextContents(), sixTitles, 'a failed window keeps the content');
      assert.equal(await page.locator('#changesPanel').getAttribute('data-window'), '6h');
      await page.unroute('**/api/changes?window=24h'); await page.locator('#changesPanel [data-changes-window="last"]').click();
      measured.changes = { newTotal: changes.events.newTotal, sources: changes.sources.length, window6h: six.events.newTotal };
      // (6) The hostile source name and record title are text everywhere.
      assert((await page.locator('.source-health-panel').innerText()).includes(HOSTILE)); await noXss(page, 'desktop');
      console.log('STRUCTURE desktop PASS', measured);
    } finally { await context.close(); }
    // An empty archive: the replay button is disabled with its reason, no matrix button, the palette's replay says why.
    await control('archive=empty');
    {
      const { context, page } = await prepare({ width: 1280, height: 900 });
      try {
        const trigger = page.locator('#replayTrigger'), before = await page.evaluate(() => D.meta.timestamp);
        assert.deepEqual([await trigger.getAttribute('aria-disabled'), await trigger.getAttribute('title'), await trigger.getAttribute('aria-describedby')], ['true', messages.replay.noSweeps, 'replayTriggerHint']);
        assert.equal(await page.locator('#replayTriggerHint').textContent(), messages.replay.noSweeps);
        assert.equal(await page.locator('[data-health-matrix]').count(), 0, 'no matrix button without archived sweeps');
        await trigger.click({ force: true }); await page.waitForTimeout(300);
        assert(await page.locator('#replayBar').isHidden(), 'the disabled button opens nothing'); assert.equal(await page.evaluate(() => D.meta.timestamp), before);
        await fromBody(page); await openPalette(page); await page.keyboard.type('Replay archived'); await page.keyboard.press('Enter');
        await page.waitForFunction(text => document.querySelector('#replayBar .rp-status')?.textContent === text, messages.replay.noSweeps);
        assert(await page.locator('#replayBar .rp-head').isHidden(), 'no banner: the replay never started'); assert.equal(await page.evaluate(() => D.meta.timestamp), before);
        await shot(page, 'replay-empty');
        await page.locator('#replayBar [data-replay="exit"]').click(); assert(await page.locator('#replayBar').isHidden());
        console.log('STRUCTURE empty archive PASS');
      } finally { await context.close(); await control('archive=seed'); }
    }
    // (7) 390 px: no horizontal page scroll with the lens bar, the palette, the matrix and the replay bar, each in turn.
    {
      const { context, page } = await prepare({ width: 390, height: 844 });
      try {
        const fits = async what => {
          const size = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, innerWidth }));
          assert(size.scrollWidth <= size.innerWidth && size.bodyScrollWidth <= size.innerWidth, 'no horizontal scroll at 390 px with the ' + what + ': ' + JSON.stringify(size));
          (measured.phone ||= {})[what] = size.scrollWidth;
        };
        await page.locator('#lensBar').scrollIntoViewIfNeeded(); await page.locator('#lensBar [data-lens="hazards"]').click(); await fits('lens bar'); await shot(page, '390-lens');
        await page.locator('#lensBar [data-lens="all"]').click();
        await fromBody(page); await openPalette(page); await page.keyboard.type('haz'); await fits('palette'); await shot(page, '390-palette'); await page.keyboard.press('Escape');
        await page.locator('.source-health-panel [data-health-matrix]').scrollIntoViewIfNeeded(); await page.locator('.source-health-panel [data-health-matrix]').click();
        await page.waitForFunction(() => document.querySelectorAll('#health-matrix tr.hm-row').length > 0);
        const dialog = await page.locator('#health-matrix').boundingBox(); assert(dialog.x >= 0 && dialog.x + dialog.width <= 390, 'the matrix dialog fits the width');
        await fits('matrix'); await shot(page, '390-matrix'); await page.keyboard.press('Escape');
        await page.evaluate(() => { document.body.scrollTop = 0; }); await page.locator('#replayTrigger').click();
        await page.locator('#replayBar .rp-banner').waitFor(); await page.waitForFunction(() => CrucixClock.frozen());
        await fits('replay bar'); await shot(page, '390-replay'); await noXss(page, 'phone');
        await page.locator('#replayBar [data-replay="exit"]').click(); assert(await page.locator('#replayBar').isHidden());
        console.log('STRUCTURE 390 px PASS', measured.phone);
      } finally { await context.close(); }
    }
  } finally { await control('liveSources=false&archive=seed'); }
}
try {
  if (phase === 'detail' || phase === 'all') await detailChecks();
  if (phase === 'history' || phase === 'all') { await historyChecks(); await clusterChecks(); }
  if (phase === 'profiles' || phase === 'all') await profileChecks();
  if (phase === 'inspector' || phase === 'all') await inspectorChecks();
  if (phase === 'live' || phase === 'all') await liveChecks();
  if (phase === 'alerts' || phase === 'all') await alertChecks();
  if (phase === 'structure' || phase === 'all') await structureChecks();
  assert.deepEqual(errors, [], 'No browser runtime errors'); assert.deepEqual(external, [], 'No unexpected external requests');
  if (phase === 'profiles' || phase === 'all') assert.deepEqual(legacyAssets, [], 'PWA phase loads all assets locally without legacy CDN routing');
  console.log('Intelligence UI QA passed', { phase, target: target.origin, artifacts, browserPlugin: 'not available; existing Playwright used' });
} finally { await browser.close(); }
