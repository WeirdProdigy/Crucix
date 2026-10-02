import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../dashboard/public/jarvis.html', import.meta.url), 'utf8');
const escape = html.includes('function esc(') ? helper('esc') : String;
function helper(name, context = {}) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf('\nfunction ', start + 1);
  return vm.runInNewContext(`${html.slice(start, end)}\n${name}`, context);
}

test('feed text escapes unterminated markup and quotes before HTML rendering', () => {
  const clean = helper('cleanText', { esc: escape, plainText: helper('plainText') });
  assert.equal(clean('<img src=x onerror="alert(1)"'), '&lt;img src=x onerror=&quot;alert(1)&quot;');
  assert.equal(clean(0), '0');
});

test('idea panel never renders provider strings as markup or attributes', () => {
  const payload = '<img src=x onerror="alert(1)">';
  const render = helper('buildTradeIdeasPanel', {
    D: { ideas: [{ type: '" onclick="alert(1)', title: payload, rationale: payload, ticker: payload, risk: payload, confidence: payload }], ideasSource: 'llm' },
    t: (_key, fallback) => fallback,
    esc: escape,
    ideaTypeClass: value => ['long', 'short', 'hedge', 'watch'].includes(value) ? value : 'watch',
  });
  const output = render();
  assert.ok(!output.includes('<img'));
  assert.ok(!output.includes('idea-type " onclick='));
  assert.ok(output.includes('&lt;img'));
});

test('external links escape attribute delimiters and reject active protocols', () => {
  const safe = helper('safeExternalUrl', { URL, location: { href: 'http://localhost:3117/' }, esc: escape });
  assert.equal(safe('javascript:alert(1)'), null);
  assert.ok(!safe('https://example.com/?x=" onmouseover="alert(1)').includes('"'));
});

test('nuclear panel never calls the sites normal without current readings and shows how old a reading is', () => {
  const render = nuke => helper('buildNuclearWatchPanel', { D: { nuke }, t: (_key, fallback) => fallback, esc: escape, getAge: value => `age(${value})` })();
  const none = render([{ site: 'A', anom: false, cpm: null, n: 0, status: 'unavailable' }, { site: 'B', anom: false, cpm: null, n: 0, status: 'pending' }]);
  assert.match(none, /No radiation readings in this snapshot/);
  assert.doesNotMatch(none, /ALL SITES NORMAL/, 'Missing data is not a normal reading');
  const some = render([{ site: 'A', anom: false, cpm: 28.14, n: 25, status: 'cached', last: '2026-10-01T17:00:33.000Z' }, { site: 'B', anom: false, cpm: null, n: 0, status: 'pending' }]);
  assert.match(some, /ALL SITES NORMAL/);
  assert.match(some, /28\.1 CPM · age\(2026-10-01T17:00:33\.000Z\)/);
  assert.match(some, /No data/);
  const alarm = render([{ site: 'A', anom: true, cpm: 150, n: 2, status: 'fresh', last: '2026-10-02T10:00:00.000Z' }, { site: 'B', anom: false, cpm: null, n: 0 }]);
  assert.match(alarm, /ANOMALY DETECTED/);
  const legacy = render([{ site: 'A', anom: false, cpm: 30, n: 3 }]);
  assert.match(legacy, /30\.0 CPM/, 'Snapshots saved before this change still render');
  assert.doesNotMatch(legacy, /CPM ·/);
});

test('missing external links never become local undefined or null routes', () => {
  const safe = helper('safeExternalUrl', { URL, location: { href: 'http://localhost:3117/' } });
  for (const value of [undefined, null, '', ' \t\n ', false, 0, {}, []]) {
    assert.equal(safe(value), null, `No link for ${String(value)}`);
  }
  assert.equal(safe('https://example.com/report'), 'https://example.com/report');
});

test('dashboard controls never open links while ticker cards remain clickable', () => {
  const clicks = [], opened = [], details = [];
  const start = html.indexOf('function init(){');
  const end = html.indexOf("\ndocument.addEventListener('DOMContentLoaded'", start);
  assert.ok(start >= 0 && end > start, 'Dashboard init function exists');
  const context = {
    booted: true, uiEventsBound: false,
    rerenderDashboard() {}, renderGlossary() {}, bindSettingsEvents() {}, syncResponsiveLayout() {},
    document: {
      getElementById: () => ({ addEventListener() {} }),
      addEventListener: (type, listener) => { if (type === 'click') clicks.push(listener); },
    },
    CrucixIntelligence: { openEvent: id => details.push(id) },
    window: { open: (...args) => opened.push(args) },
    safeExternalUrl: helper('safeExternalUrl', { URL, location: { href: 'http://localhost:3117/' } }),
  };
  vm.runInNewContext(`${html.slice(start, end)}\ninit();`, context);
  const click = card => { for (const listener of clicks) listener({ target: { closest: () => card } }); };
  click(null); // Visuals, settings and other controls outside ticker cards.
  click({ dataset: {} }); // A ticker card without a source link.
  assert.deepEqual(opened, [], 'Controls and missing links cannot navigate');
  click({ dataset: { url: 'https://example.com/report' } });
  assert.deepEqual(opened, [['https://example.com/report', '_blank', 'noopener']]);
  click({ dataset: { eventId: 'event-fixture', url: 'https://example.com/report' } });
  assert.deepEqual(details, ['event-fixture']);
  assert.equal(opened.length, 1, 'Event details stay inside the dashboard');
});
