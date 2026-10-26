import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { COVERAGE_LABELS as SERVER_COVERAGE_LABELS, COVERAGE_STATES } from '../lib/intelligence/views.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function createHarness(sharedStorage = null) {
  const listeners = {};
  const doc = {
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    querySelectorAll(selector) {
      return [];
    }
  };

  const store = sharedStorage || new Map();
  const localStorage = {
    getItem(k) { return store.get(k) ?? null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); }
  };

  const win = {
    localStorage,
    document: doc,
    console
  };
  win.window = win;

  const context = vm.createContext({
    window: win,
    document: doc,
    console,
    Date,
    String,
    Number,
    Object,
    Array,
    Boolean
  });
  const code = readFileSync(resolve(ROOT, 'dashboard/public/views-panel.js'), 'utf8');
  vm.runInContext(code, context);

  return { win, api: win.CrucixViewsPanel, store };
}

test('1. ViewsPanel contract and enum definitions', () => {
  const { api } = createHarness();
  assert.ok(api, 'CrucixViewsPanel must be mounted on window');
  assert.deepEqual(Object.keys(api.VIEWS), ['LOCAL', 'COUNTY', 'NATIONAL', 'GLOBAL']);
  assert.equal(api.VIEW_LABELS[api.VIEWS.LOCAL], 'Helyi');
  assert.equal(api.VIEW_LABELS[api.VIEWS.COUNTY], 'Hajdú-Bihar');
  assert.equal(api.VIEW_LABELS[api.VIEWS.NATIONAL], 'Magyarország');
  assert.equal(api.VIEW_LABELS[api.VIEWS.GLOBAL], 'Világ');
});

test('2. ViewsPanel mountSelector creates tablist and accessible tabs', () => {
  const { api } = createHarness();
  const mockContainer = { innerHTML: '', querySelectorAll() { return []; } };
  const mockSnapshot = {
    views: {
      local: { uniqueEvents: 5 },
      county: { uniqueEvents: 6 },
      national: { uniqueEvents: 7 },
      global: { uniqueEvents: 9 }
    }
  };

  api.mountSelector(mockContainer, { getSnapshot: () => mockSnapshot });
  assert.ok(mockContainer.innerHTML.includes('role="tablist"'));
  assert.ok(mockContainer.innerHTML.includes('id="vp-tab-local"'));
  assert.ok(mockContainer.innerHTML.includes('id="vp-tab-county"'));
  assert.ok(mockContainer.innerHTML.includes('id="vp-tab-national"'));
  assert.ok(mockContainer.innerHTML.includes('id="vp-tab-global"'));
  assert.ok(mockContainer.innerHTML.includes('Helyi'));
  assert.ok(mockContainer.innerHTML.includes('Hajdú-Bihar'));
  assert.ok(mockContainer.innerHTML.includes('>5</span>'));
  assert.ok(mockContainer.innerHTML.includes('>9</span>'));
});

test('3. ViewsPanel panelHtml renders category sections and level badges', () => {
  const { api } = createHarness();
  api.setView(api.VIEWS.LOCAL, false);

  const mockSnapshot = {
    events: [
      {
        id: 'event-01',
        title: '[TESZTADAT] Bihartordai ASP intézkedés',
        isFixture: true,
        source: { name: 'Nebih-ASP' },
        observedAt: '2026-10-20', // Date-only
        views: { local: { inView: true, category: 'confirmedLocal' } }
      },
      {
        id: 'event-02',
        title: '[TESZTADAT] Debreceni tranzit kapcsolat',
        isFixture: true,
        source: { name: 'HAON-Fixture' },
        observedAt: '2026-10-26T10:00:00.000Z',
        views: { local: { inView: true, category: 'keyConnection' } }
      },
      {
        id: 'event-03',
        title: '[TESZTADAT] Észak-Alföldi viharjelzés',
        source: { name: 'Meteoalarm' },
        observedAt: '2026-10-26T12:00:00.000Z',
        territory: { territoryLevel: 'region' },
        views: { local: { inView: true, category: 'regionalAdvisories' } }
      }
    ],
    staleEvents: [
      {
        id: 'event-stale-01',
        title: 'Lejárt riasztás',
        source: { name: 'Meteoalarm' },
        staleReason: 'provider_expired',
        views: { local: { inView: true, category: 'regionalAdvisories' } }
      }
    ],
    views: {
      local: { uniqueEvents: 3 }
    }
  };

  const html = api.panelHtml(mockSnapshot);

  // 1. Megerősített helyi esemény
  assert.ok(html.includes('Megerősített helyi esemény'), 'Must include confirmedLocal section');
  assert.ok(html.includes('[TESZTADAT] Bihartordai ASP intézkedés'));
  assert.ok(html.includes('[TESZTADAT]'), 'Fixture must display [TESZTADAT] badge');

  // 2. Date-only formatting test: 2026-10-20 does NOT get UTC or midnight
  assert.ok(html.includes('2026-10-20'), 'Must display date-only string');
  assert.ok(!html.includes('2026-10-20 00:00:00'), 'Date-only must never become midnight UTC');

  // 3. Debrecen is in Kiemelt kapcsolat, NOT confirmedLocal
  assert.ok(html.includes('Kiemelt kapcsolat'), 'Debrecen connection in keyConnection');

  // 4. Regional advisories shows original level
  assert.ok(html.includes('Térségi tájékoztatás'));
  assert.ok(html.includes('Régiós szint'), 'Must show Régiós szint badge for regional advisory');

  // 5. Stale event section
  assert.ok(html.includes('Elavult / Lejárt események'));
  assert.ok(html.includes('Lejárt kibocsátói érvényesség'));
});

test('4. Empty local state shows safe referral to coverage panel', () => {
  const { api } = createHarness();
  api.setView(api.VIEWS.LOCAL, false);

  const emptySnapshot = { events: [], staleEvents: [], views: { local: { uniqueEvents: 0 } } };
  const html = api.panelHtml(emptySnapshot);

  assert.ok(html.includes('Nincs megerősített helyi esemény a vizsgált időszakban'));
  assert.ok(html.includes('Ellenőrizze a forrásfedettségi panelt'));
  assert.ok(html.includes('Ez nem jelenti a kockázatok teljes hiányát.'));
  assert.ok(!html.includes('nincs veszély'), 'Empty state must never make reassuring safety claims');
});

test('5. Source coverage panel displays only payload states and non-reassuring ok_empty label', () => {
  const { api } = createHarness();

  const mockSnapshot = {
    coverage: {
      Meteoalarm: { status: 'ok_data', origin: 'live' },
      'Nebih-ASP': { status: 'disabled', origin: 'snapshot' },
      HAON: { status: 'unconfigured', origin: 'snapshot' },
      'MET-Norway': { status: 'ok_empty', origin: 'live' }
    }
  };

  const html = api.coveragePanelHtml(mockSnapshot);

  // Status badges
  assert.ok(html.includes('Adat rendelkezésre áll'));
  assert.ok(html.includes('Letiltva'));
  assert.ok(html.includes('Nincs forrás konfigurálva'));
  assert.ok(html.includes('Szűrés utáni állapot nem meghatározható'), 'ok_empty must be neutral, not calm');
  assert.ok(!html.includes('nyugodt'), 'ok_empty must not contain nyugodt text');
  assert.ok(!html.includes('nincs veszély'), 'ok_empty must not claim safety');

  // Origin badges
  assert.ok(html.includes('[Élő lekérés ebben a folyamatban]'));
  assert.ok(html.includes('[Offline pillanatkép]'));

  // Server-side COVERAGE_LABELS alignment
  assert.equal(SERVER_COVERAGE_LABELS[COVERAGE_STATES.OK_EMPTY], 'Szűrés utáni állapot nem meghatározható');
});

test('6. Debrecen keyConnection has separate section and counter from confirmedLocal', () => {
  const { api } = createHarness();
  api.setView(api.VIEWS.LOCAL, false);

  const mockSnapshot = {
    events: [
      {
        id: 'ev-local-1',
        title: 'Bihartordai helyi esemény',
        source: { name: 'Nebih-ASP' },
        views: { local: { inView: true, category: 'confirmedLocal' } }
      },
      {
        id: 'ev-conn-1',
        title: 'Debrecen-Nagyvárad tranzit kapocs',
        source: { name: 'HAON' },
        views: { local: { inView: true, category: 'keyConnection' } }
      }
    ],
    staleEvents: [],
    views: { local: { uniqueEvents: 2 } }
  };

  const html = api.panelHtml(mockSnapshot);

  // Both categories have their own sections and 1 db counters
  assert.ok(html.includes('data-cat="confirmedLocal"'), 'Must have confirmedLocal section');
  assert.ok(html.includes('data-cat="keyConnection"'), 'Must have keyConnection section');
  assert.ok(html.includes('Megerősített helyi esemény'), 'confirmedLocal title');
  assert.ok(html.includes('Kiemelt kapcsolat'), 'keyConnection title');

  // Debrecen event is strictly inside keyConnection section, not confirmedLocal
  const confIdx = html.indexOf('data-cat="confirmedLocal"');
  const connIdx = html.indexOf('data-cat="keyConnection"');
  const debIdx = html.indexOf('Debrecen-Nagyvárad tranzit kapocs');
  assert.ok(confIdx !== -1 && connIdx !== -1 && debIdx !== -1);
  assert.ok(debIdx > connIdx, 'Debrecen item must appear inside keyConnection section');
});

test('7. unknownTerritory category section renders localized label', () => {
  const { api } = createHarness();
  api.setView(api.VIEWS.LOCAL, false);

  const mockSnapshot = {
    events: [
      {
        id: 'ev-unknown-1',
        title: 'Bizonytalan területi bejelentés',
        source: { name: 'Unknown-Source' },
        views: { local: { inView: true, category: 'unknownTerritory' } }
      }
    ],
    staleEvents: [],
    views: { local: { uniqueEvents: 1 } }
  };

  const html = api.panelHtml(mockSnapshot);
  assert.ok(html.includes('data-cat="unknownTerritory"'));
  assert.ok(html.includes('Tisztázatlan területi érintettség'), 'Must display Tisztázatlan területi érintettség');
  assert.ok(html.includes('Bizonytalan területi bejelentés'));
});

test('8. Coordinate-less matching news renders in text strip; unmatching news is excluded from Local view', () => {
  const { api } = createHarness();
  api.setView(api.VIEWS.LOCAL, false);

  const mockSnapshot = {
    events: [
      {
        id: 'news-matching',
        kind: 'news',
        title: 'Helyi hír Bihartordáról koordináták nélkül',
        source: { name: 'HAON' },
        views: {
          local: { inView: true, category: 'confirmedLocal' }
        }
      },
      {
        id: 'news-unmatching',
        kind: 'news',
        title: 'Pécsi távoli hír koordináták nélkül',
        source: { name: 'HAON' },
        views: {
          local: { inView: false },
          national: { inView: true, category: 'nationalEvent' }
        }
      }
    ],
    staleEvents: [],
    views: { local: { uniqueEvents: 1 } }
  };

  const html = api.panelHtml(mockSnapshot);

  // Strip present
  assert.ok(html.includes('vp-unlocated-strip'), 'Unlocated text strip must be rendered');
  assert.ok(html.includes('Koordináta nélküli hírek (térképi jelölő nélkül)'));
  assert.ok(html.includes('Helyi hír Bihartordáról koordináták nélkül'), 'Matching news must appear in strip');

  // Unmatching news must NOT appear anywhere in local view
  assert.ok(!html.includes('Pécsi távoli hír koordináták nélkül'), 'Unmatching news must never enter Local view');
});

test('9. Stale text and no-expiry badges render according to specifications', () => {
  const { api } = createHarness();
  api.setView(api.VIEWS.LOCAL, false);

  const now = Date.now();
  const past30h = new Date(now - 30 * 3600000).toISOString();

  const mockSnapshot = {
    events: [
      {
        id: 'ev-active-unexpired',
        title: 'Meteoalarm riasztás 30 órája (nincs validUntil)',
        source: { name: 'Meteoalarm' },
        observedAt: past30h,
        // no validUntil
        views: { local: { inView: true, category: 'regionalAdvisories' } }
      }
    ],
    staleEvents: [
      {
        id: 'ev-stale-no-expiry',
        title: 'Elavult Meteoalarm riasztás 50 órája (nincs validUntil)',
        source: { name: 'Meteoalarm' },
        staleReason: 'source_stale',
        views: { local: { inView: true, category: 'regionalAdvisories' } }
      }
    ],
    views: { local: { uniqueEvents: 1 } }
  };

  const html = api.panelHtml(mockSnapshot);

  // Active unexpired (24-48h old without validUntil) gets:
  assert.ok(html.includes('Aktualitása nem igazolt: a helyi frissességi korlát letelt.'), 'Active unexpired must show specific freshness warning');
  assert.ok(html.includes('A kibocsátó nem adott lejárati időt.'), 'Active unexpired must show no-expiry note');

  // Stale event gets:
  assert.ok(html.includes('Elavult / Lejárt események'), 'Stale section header');
  assert.ok(html.includes('A forrás frissítése késik (elavult lekérés)'), 'Stale reason group');
});

test('10. Keyboard navigation and focus management in mountSelector', () => {
  const { api, win } = createHarness();

  // Create mock DOM structure for tab elements
  const focusedTabs = [];
  const tabs = [
    {
      dataset: { view: 'local' },
      attributes: { 'aria-selected': 'true', tabindex: '0' },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      focus() { focusedTabs.push('local'); }
    },
    {
      dataset: { view: 'county' },
      attributes: { 'aria-selected': 'false', tabindex: '-1' },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      focus() { focusedTabs.push('county'); }
    },
    {
      dataset: { view: 'national' },
      attributes: { 'aria-selected': 'false', tabindex: '-1' },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      focus() { focusedTabs.push('national'); }
    },
    {
      dataset: { view: 'global' },
      attributes: { 'aria-selected': 'false', tabindex: '-1' },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      focus() { focusedTabs.push('global'); }
    }
  ];

  win.document.querySelectorAll = (sel) => {
    if (sel === '.vp-tab') return tabs;
    return [];
  };

  const container = {
    innerHTML: '',
    querySelectorAll(sel) {
      if (sel === '.vp-tab') return tabs;
      return [];
    }
  };

  api.mountSelector(container, { getSnapshot: () => ({ views: {} }) });

  // Simulate ArrowRight on tab 0 (local)
  assert.ok(tabs[0].listeners.keydown, 'keydown listener must be attached');
  let defaultPrevented = false;
  tabs[0].listeners.keydown({
    key: 'ArrowRight',
    preventDefault: () => { defaultPrevented = true; }
  });

  assert.equal(defaultPrevented, true, 'Default action must be prevented on arrow navigation');
  assert.equal(focusedTabs[focusedTabs.length - 1], 'county', 'ArrowRight must focus county tab');
  assert.equal(api.getActiveView(), 'county', 'Active view must update to county');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'false');

  // Simulate End key on tab 1 -> jumps to global (index 3)
  tabs[1].listeners.keydown({
    key: 'End',
    preventDefault: () => {}
  });
  assert.equal(focusedTabs[focusedTabs.length - 1], 'global');
  assert.equal(api.getActiveView(), 'global');

  // Simulate Home key on tab 3 -> jumps back to local (index 0)
  tabs[3].listeners.keydown({
    key: 'Home',
    preventDefault: () => {}
  });
  assert.equal(focusedTabs[focusedTabs.length - 1], 'local');
  assert.equal(api.getActiveView(), 'local');
});

test('11. View persistence across reloads via localStorage', () => {
  const sharedStorage = new Map();

  // 1st visit: set view to 'county'
  const harness1 = createHarness(sharedStorage);
  assert.equal(harness1.api.getActiveView(), 'local', 'Default view is local');
  harness1.api.setView(harness1.api.VIEWS.COUNTY);
  assert.equal(harness1.api.getActiveView(), 'county');
  assert.equal(sharedStorage.get('crucix_territory_view_v1'), 'county');

  // 2nd visit (reload with same shared storage): initializes to saved view
  const harness2 = createHarness(sharedStorage);
  assert.equal(harness2.api.getActiveView(), 'county', 'Reload must restore saved view mode from localStorage');
});
