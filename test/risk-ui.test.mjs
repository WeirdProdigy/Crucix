import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { countryByName, countryByNum } from '../lib/intelligence/countries.mjs';

// The country-risk views (risk.js, country.js, briefing.js) in a vm realm. The panel and the briefing answer are markup strings; the
// dialogs run on a minimal fake DOM (enough for build/open), and the delegated clicks get a fake target with closest().
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const locale = lang => JSON.parse(read(`locales/${lang}.json`));
const ID = n => 'event-' + n.toString(16).padStart(32, '0');
const tick = () => new Promise(resolve => setImmediate(resolve));

class El {
  constructor(tag) { Object.assign(this, { tag, kids: [], attrs: {}, listeners: {}, textContent: '', innerHTML: '', open: false, value: '', disabled: false, className: '' }); }
  append(...kids) { this.kids.push(...kids); }
  replaceChildren(...kids) { this.kids = kids; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  showModal() { this.open = true; }
  close() { this.open = false; for (const fn of this.listeners.close || []) fn({}); }
  contains() { return false; }
  focus() {}
}
function realm(files) {
  const listeners = {};
  const document = { body: new El('body'), activeElement: null, createElement: tag => new El(tag), getElementById: () => null,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
  const window = { console };
  const context = vm.createContext({ window, document, console, Intl, Promise, setTimeout, clearTimeout });
  for (const file of files) vm.runInContext(read('dashboard/public/' + file), context);
  // A delegated click: the target matches exactly the selectors given (attribute name -> value).
  const click = attrs => { const node = { getAttribute: name => Object.hasOwn(attrs, name) ? attrs[name] : null, closest: selector => Object.keys(attrs).some(name => selector.includes(`[${name}]`)) ? node : null };
    for (const fn of listeners.click || []) fn({ target: node }); };
  return { window, document, click };
}
const t = lang => { const data = locale(lang); return (key, fallback) => { const value = key.split('.').reduce((at, part) => at && typeof at === 'object' ? at[part] : undefined, data); return typeof value === 'string' ? value : fallback; }; };

test('the risk, country and briefing groups and panels.countryRisk have identical keys in identical order in en, hu and fr; the map table matches the server', () => {
  const [en, hu, fr] = ['en', 'hu', 'fr'].map(locale);
  for (const group of ['risk', 'country', 'briefing']) {
    const keys = Object.keys(en[group] || {});
    assert.ok(keys.length > 10, `${group} exists`);
    for (const [lang, data] of [['hu', hu], ['fr', fr]]) {
      assert.deepEqual(Object.keys(data[group] || {}), keys, `${lang}: ${group} keys in the en order`);
      for (const key of keys) {
        const value = data[group][key], placeholders = text => (text.match(/\{\w+\}/g) || []).sort().join();
        assert.ok(typeof value === 'string' && value.trim() && !/[<>]/.test(value), `${lang}: ${group}.${key} is plain non-empty text`);
        assert.equal(placeholders(value), placeholders(en[group][key]), `${lang}: ${group}.${key} has the en placeholders`);
      }
    }
  }
  for (const data of [en, hu, fr]) {
    const panels = Object.keys(data.panels);
    assert.ok(typeof data.panels.countryRisk === 'string' && data.panels.countryRisk, 'panels.countryRisk');
    assert.equal(panels[panels.indexOf('changes') + 1], 'countryRisk', 'right after panels.changes');
  }
  // Every shape of the vendored world map resolves in the browser to the ISO3 code the server's gazetteer gives it.
  const { window } = realm(['risk.js']);
  const world = JSON.parse(read('dashboard/public/vendor/countries-110m-2.0.2.json'));
  for (const shape of world.objects.countries.geometries) {
    const server = (shape.id !== undefined ? countryByNum(shape.id) : null) ?? countryByName(shape.properties?.name);
    assert.ok(server && window.CrucixRisk.shapeIso3(shape.id, shape.properties?.name) === server.iso3, `shape ${shape.id} ${shape.properties?.name}`);
  }
  assert.equal(window.CrucixRisk.shapeIso3('999', 'Atlantis'), null);
});

test('the panel ranks the top 10 with score, change, coverage and convergence, escapes hostile names and says when there is not enough track record', () => {
  const { window } = realm(['risk.js']);
  const R = window.CrucixRisk;
  R.mount({ t: t('en'), locale: 'en-US', fetchJson: () => Promise.reject(new Error('offline')), isReplay: () => false });
  const hostile = '<img src=x onerror="window.__riskXss=1">';
  const top = [
    { iso3: 'SDN', name: hostile, score: 81.4, change24h: 5, coverage: 0.9, convergence: { active: true, kinds: ['conflict', 'disaster', 'weather'] } },
    { iso3: 'UKR', name: 'Ukraine', score: 55, change24h: -3, coverage: 0.65, convergence: { active: false, kinds: [] } },
    { iso3: 'COD', name: 'Congo', score: 40, change24h: null, coverage: 0.9, convergence: null },
    { iso3: 'bad', name: 'Not a code', score: 99 },
    ...Array.from({ length: 12 }, (_, i) => ({ iso3: 'A' + String.fromCharCode(65 + i) + 'Z', name: 'Country ' + i, score: 30 - i, change24h: 0, coverage: 1 })),
  ];
  const html = R.panelHtml({ version: 1, at: '2026-10-03T10:00:00.000Z', top, counts: { scored: 196, high: 1 }, calibration: { n: 12, brier: null, skill: null } });
  assert.ok(html.includes('id="countryRiskPanel"') && html.includes('Model v1') && html.includes('196 countries scored · 1 at 70 or above'));
  assert.equal((html.match(/data-risk-country="/g) || []).length, 10, 'top 10 only, invalid codes dropped');
  assert.ok(!html.includes('<img') && html.includes('&lt;img src=x onerror=&quot;window.__riskXss=1&quot;&gt;'), 'the hostile name is escaped');
  assert.ok(html.includes('data-band="high"') && html.includes('style="width:81%"') && html.includes('Score 81 of 100'), 'score bar and number');
  assert.ok(html.includes('<i>▲</i> +5') && html.includes('Up 5 in 24 h') && html.includes('<i>▼</i> -3') && html.includes('Down 3 in 24 h'), 'glyph and text for each change');
  assert.ok(/data-dir="none" title="No history yet"><span aria-hidden="true">–<\/span>/.test(html), 'a missing change is a dash, never 0');
  assert.ok(html.includes('90% coverage') && html.includes('65% coverage') && html.includes('missing ones are left out'), 'coverage with its explanation');
  assert.ok(html.includes('◆</i> Convergence') && html.includes('Conflict, Natural event, Weather'), 'convergence mark with the kind names');
  assert.equal((html.match(/Convergence/g) || []).length, 1, 'only the converging country');
  assert.ok(html.includes('data-risk-state="notEnough"') && html.includes('Not enough resolved predictions yet (n=12; 30 needed).'));
  const scored = R.panelHtml({ version: 1, top: [], counts: { scored: 0, high: 0 }, calibration: { n: 40, brier: 0.1234, skill: -0.05 } });
  assert.ok(scored.includes('Resolved: 40 · Brier 0.123 · skill -0.05') && scored.includes('data-risk-state="empty"'));
  assert.ok(R.panelHtml(undefined).includes('data-risk-state="unavailable">Country risk is not available.'), 'no risk summary (not yet, or RISK_ENABLED=false): a neutral note');
  assert.ok(R.panelHtml({ top: [], calibration: null }).includes('(n=0; 30 needed)'), 'no journal yet');
});

test('the briefing shows citation chips only for valid refs and a chip opens the record through openEvent', async () => {
  const { window, click } = realm(['briefing.js']);
  const opened = [];
  const B = window.CrucixBriefing;
  B.mount({ t: t('en'), locale: 'en-US', isReplay: () => false, getScopes: () => [], openEvent: id => opened.push(id) });
  const markup = B.render({ scope: 'global', generatedAt: '2026-10-03T10:00:00.000Z', language: 'en', source: 'llm', bullets: [
    { text: 'Flooding <b onmouseover="x">reported</b>', refs: [{ n: 1, id: ID(1), title: 'Flood "A"' }, { n: 2, id: 'javascript:alert(1)', title: 'bad' }, { n: 0, id: ID(2), title: 'zero' }] },
    { text: 'Only invalid citations', refs: [{ n: 3, id: '../api/x', title: 'x' }] },
    { text: 'No refs', refs: [] },
  ] });
  assert.equal((markup.match(/data-briefing-ref="/g) || []).length, 1, 'one valid chip');
  assert.ok(markup.includes(`data-briefing-ref="${ID(1)}"`) && markup.includes('>[1]</button>') && markup.includes('Open record 1: Flood &quot;A&quot;'));
  assert.ok(!markup.includes('javascript:') && !markup.includes('Only invalid citations') && !markup.includes('No refs'), 'a bullet without a valid citation is not shown');
  assert.ok(markup.includes('&lt;b onmouseover=&quot;x&quot;&gt;') && !markup.includes('<b '), 'model text is escaped');
  assert.ok(markup.includes('AI-generated from the cited records'));
  assert.ok(B.render({ source: 'rules', bullets: [] }).includes('Rule-based summary') && B.render({ source: 'rules', bullets: [] }).includes('Nothing to summarise'));
  assert.equal(B.render({ bullets: 'nope' }), '', 'not an answer');
  click({ 'data-briefing-ref': ID(1) });
  click({ 'data-briefing-ref': 'javascript:alert(1)' });
  await tick();
  assert.deepEqual(opened, [ID(1)], 'the valid chip opens its record, nothing else does');
});

test('during a replay the country sheet and briefing entry points are off and say why', async () => {
  const { window, document, click } = realm(['risk.js', 'country.js', 'briefing.js']);
  const calls = [];
  const common = { t: t('en'), locale: 'en-US', isReplay: () => true };
  window.CrucixRisk.mount({ ...common, getRisk: () => ({ top: [{ iso3: 'SDN', name: 'Sudan', score: 20 }] }), fetchJson: url => { calls.push(['risk', url]); return Promise.resolve({}); }, openCountry: iso3 => calls.push(['open', iso3]), openBriefing: () => calls.push(['brief']) });
  window.CrucixCountry.mount({ ...common, fetchJson: url => { calls.push(['country', url]); return Promise.resolve({}); } });
  window.CrucixBriefing.mount({ ...common, getScopes: () => [], postJson: () => { calls.push(['post']); return Promise.resolve({ bullets: [] }); } });
  const note = locale('en').risk.replayNote;
  const html = window.CrucixRisk.panelHtml({ top: [{ iso3: 'SDN', name: 'Sudan', score: 20 }], calibration: null });
  assert.ok(html.includes('data-replay="true"') && html.includes(`id="countryRiskReplay">${note}`), 'the panel says why');
  assert.ok(/data-risk-country="SDN" aria-disabled="true" aria-describedby="countryRiskReplay"/.test(html) && /data-risk-briefing aria-haspopup="dialog" aria-disabled="true"/.test(html), 'rows and the briefing button are disabled');
  click({ 'data-risk-country': 'SDN', 'aria-disabled': 'true' });
  click({ 'data-risk-briefing': '' });
  window.CrucixRisk.update({ at: '2026-10-03T10:00:00.000Z', top: [] });
  assert.equal(window.CrucixRisk.paletteItems().length, 0, 'no palette country or briefing actions');
  assert.equal(await window.CrucixCountry.open('SDN'), false);
  const sheet = document.body.kids.find(node => node.tag === 'dialog' && node.id === 'country-sheet');
  assert.ok(sheet && sheet.open && sheet.getAttribute('data-replay') === 'true', 'a map click still opens the sheet, with only the reason');
  assert.ok(sheet.kids[0].kids.some(node => node.textContent === note), 'the sheet shows the replay note');
  assert.equal(window.CrucixBriefing.open('SDN'), false);
  const dialog = document.body.kids.find(node => node.tag === 'dialog' && node.id === 'briefing-dialog');
  const generate = dialog.kids[0].kids.flatMap(node => node.kids).find(node => node.className === 'bf-generate');
  assert.ok(generate.getAttribute('aria-disabled') === 'true', 'Generate is off');
  assert.ok(dialog.kids[0].kids.some(node => node.textContent === note), 'the briefing shows the replay note');
  for (const fn of generate.listeners.click) fn({});
  assert.equal(await window.CrucixBriefing.generate(), false);
  await tick();
  assert.deepEqual(calls, [], 'nothing was opened, fetched or posted');
});
