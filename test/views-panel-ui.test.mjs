import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
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

test('12. Hírfolyam newsIds-feloldás és nézetváltás', () => {
  const { api } = createHarness();
  api.resetNewsFilter();

  const mockSnapshot = {
    events: [],
    views: {
      local: { newsCount: 1, retainedNewsCount: 1, newsIds: ['news-loc-1'] },
      global: { newsCount: 2, retainedNewsCount: 2, newsIds: ['news-loc-1', 'news-glob-2'] },
      news: [
        {
          id: 'news-loc-1',
          kind: 'news',
          newsCategory: 'news_local',
          title: '[TESZTADAT] Helyi hír Bihartordáról',
          source: { name: 'RSS-Dehir', displayName: 'Dehir' },
          link: 'https://example.com/loc-1',
          publishedAt: '2026-10-28T12:00:00Z',
          territory: { settlementName: 'Bihartorda' }
        },
        {
          id: 'news-glob-2',
          kind: 'news',
          newsCategory: 'news_global',
          title: '[TESZTADAT] Globális nemzetközi csúcstalálkozó',
          source: { name: 'RSS-Telex', displayName: 'Telex' },
          link: 'https://example.com/glob-2',
          publishedAt: '2026-10-28T13:00:00Z'
        }
      ]
    }
  };

  // 1. In Local view: ONLY news-loc-1 is resolved and rendered
  api.setView(api.VIEWS.LOCAL, false);
  const localHtml = api.panelHtml(mockSnapshot);
  assert.ok(localHtml.includes('Helyi hír Bihartordáról'), 'Local view must render news-loc-1');
  assert.ok(!localHtml.includes('Globális nemzetközi csúcstalálkozó'), 'Local view must NOT render news-glob-2');

  // 2. In Global view: BOTH news-loc-1 and news-glob-2 are rendered
  api.setView(api.VIEWS.GLOBAL, false);
  const globalHtml = api.panelHtml(mockSnapshot);
  assert.ok(globalHtml.includes('Helyi hír Bihartordáról'), 'Global view must render news-loc-1');
  assert.ok(globalHtml.includes('Globális nemzetközi csúcstalálkozó'), 'Global view must render news-glob-2');
});

test('13. Kártyaelemek megjelenítése: Google News eredeti kiadó, publikálási idő és címkék', () => {
  const { api } = createHarness();
  api.resetNewsFilter();

  const gnewsItem = {
    id: 'news-gnews-1',
    kind: 'news',
    newsCategory: 'news_hazard',
    title: '[TESZTADAT] Viharos szél és áramkimaradások a térségben',
    source: { name: 'Google-News', publisher: 'HAON' },
    facts: { sourcePublisher: 'HAON', settlement: 'Debrecen' },
    territory: { settlementName: 'Debrecen', needsLocalReview: true },
    link: 'https://news.google.com/rss/articles/CBMi123456',
    publishedAt: '2026-10-28T14:30:00Z'
  };

  const cardHtml = api.renderNewsCard(gnewsItem);

  // 1. Google News original publisher
  assert.ok(cardHtml.includes('HAON via Google Hírek'), 'Must show original publisher "HAON via Google Hírek"');

  // 2. Published time (NEVER event time)
  assert.ok(cardHtml.includes('Publikálva:'), 'Must be explicitly labelled "Publikálva:"');
  assert.ok(!cardHtml.includes('Esemény ideje:'), 'Must NOT label published time as event time');
  assert.ok(cardHtml.includes('2026-10-28T14:30:00Z'), 'Full ISO must be present in title attribute');

  // 3. Topic badge for news_hazard: "Veszélyhelyzeti témájú hír" (NEVER "Aktív veszély")
  assert.ok(cardHtml.includes('Veszélyhelyzeti témájú hír'), 'Must label news_hazard as "Veszélyhelyzeti témájú hír"');
  assert.ok(!cardHtml.includes('Aktív veszély'), 'Strictly forbidden to label news as "Aktív veszély"');

  // 4. Territory badges
  assert.ok(cardHtml.includes('Település: Debrecen'));
  assert.ok(cardHtml.includes('Ellenőrizendő említés'));

  // 5. External link
  assert.ok(cardHtml.includes('target="_blank"'));
  assert.ok(cardHtml.includes('rel="noopener noreferrer"'));
  assert.ok(cardHtml.includes('https://news.google.com/rss/articles/CBMi123456'));
});

test('14. Kötelező értelmezési határ: Sajtó- és hatósági hírek; nem igazolt veszélyesemények', () => {
  const { api } = createHarness();
  const mockSnapshot = {
    views: {
      local: { newsCount: 0, retainedNewsCount: 0, newsIds: [] },
      news: []
    }
  };
  const html = api.newsFeedHtml(mockSnapshot);
  assert.ok(html.includes('Sajtó- és hatósági hírek; nem igazolt veszélyesemények.'), 'Disclaimer banner must be present');
});

test('15. Forrás- és témaszűrés, rendezésváltás', () => {
  const { api } = createHarness();
  api.setView(api.VIEWS.GLOBAL, false);

  const mockSnapshot = {
    views: {
      global: { newsCount: 3, retainedNewsCount: 3, newsIds: ['n1', 'n2', 'n3'] },
      news: [
        {
          id: 'n1',
          kind: 'news',
          newsCategory: 'news_hazard',
          title: '[TESZTADAT] Veszélyhír',
          source: { name: 'RSS-Telex', displayName: 'Telex' },
          link: 'https://example.com/1',
          publishedAt: '2026-10-28T10:00:00Z'
        },
        {
          id: 'n2',
          kind: 'news',
          newsCategory: 'news_energy',
          title: '[TESZTADAT] Energiahír',
          source: { name: 'RSS-HVG', displayName: 'HVG' },
          link: 'https://example.com/2',
          publishedAt: '2026-10-28T12:00:00Z'
        },
        {
          id: 'n3',
          kind: 'news',
          newsCategory: 'news_local',
          title: '[TESZTADAT] Helyi hír',
          source: { name: 'RSS-Dehir', displayName: 'Dehir' },
          link: 'https://example.com/3',
          publishedAt: '2026-10-28T14:00:00Z'
        }
      ]
    }
  };

  // Default: all 3 rendered
  api.resetNewsFilter();
  let html = api.newsFeedHtml(mockSnapshot);
  assert.ok(html.includes('[TESZTADAT] Veszélyhír'));
  assert.ok(html.includes('[TESZTADAT] Energiahír'));
  assert.ok(html.includes('[TESZTADAT] Helyi hír'));

  // Filter by source: Telex
  api.setNewsFilter({ source: 'Telex' });
  html = api.newsFeedHtml(mockSnapshot);
  assert.ok(html.includes('[TESZTADAT] Veszélyhír'));
  assert.ok(!html.includes('[TESZTADAT] Energiahír'));
  assert.ok(!html.includes('[TESZTADAT] Helyi hír'));

  // Filter by category: news_energy
  api.setNewsFilter({ source: 'all', category: 'news_energy' });
  html = api.newsFeedHtml(mockSnapshot);
  assert.ok(!html.includes('[TESZTADAT] Veszélyhír'));
  assert.ok(html.includes('[TESZTADAT] Energiahír'));
  assert.ok(!html.includes('[TESZTADAT] Helyi hír'));

  // Sort by latest: n3 (14:00) comes before n1 (10:00)
  api.setNewsFilter({ source: 'all', category: 'all', sort: 'latest' });
  html = api.newsFeedHtml(mockSnapshot);
  const idxN3 = html.indexOf('[TESZTADAT] Helyi hír');
  const idxN1 = html.indexOf('[TESZTADAT] Veszélyhír');
  assert.ok(idxN3 < idxN1, 'Latest sort puts newest 14:00 item before 10:00 item');

  api.resetNewsFilter();
});

test('16. Üres, disabled és hibás állapotok megkülönböztetése', () => {
  const { api } = createHarness();
  api.resetNewsFilter();

  // 1. Opt-in disabled
  const optInSnapshot = {
    coverage: {
      'Police-Hajdu': { status: 'disabled' },
      'RSS-Dehir': { status: 'disabled' }
    },
    views: { local: { newsCount: 0, retainedNewsCount: 0, newsIds: [] }, news: [] }
  };
  const optInHtml = api.newsFeedHtml(optInSnapshot);
  assert.ok(optInHtml.includes('CRUCIX_ENABLE_FEED_&lt;ID&gt; vagy CRUCIX_ENABLE_GNEWS') || optInHtml.includes('CRUCIX_ENABLE_FEED_<ID> vagy CRUCIX_ENABLE_GNEWS'), 'Must mention supported switches');
  assert.ok(!optInHtml.includes('CRUCIX_ENABLE_NEWS_RSS'), 'Must NOT contain unsupported CRUCIX_ENABLE_NEWS_RSS');
  assert.ok(!optInHtml.includes('CRUCIX_ENABLE_GOOGLE_NEWS_RSS'), 'Must NOT contain unsupported CRUCIX_ENABLE_GOOGLE_NEWS_RSS');

  // 1b. Missing source state in snapshot
  const missingCoverageSnapshot = {
    views: { local: { newsCount: 0, retainedNewsCount: 0, newsIds: [] }, news: [] }
  };
  const missingCoverageHtml = api.newsFeedHtml(missingCoverageSnapshot);
  assert.ok(missingCoverageHtml.includes('forrásállapot-adat nem áll rendelkezésre'), 'Must indicate lack of source state');
  assert.ok(!missingCoverageHtml.includes('opt-in kikapcsolva'), 'Must NOT claim all sources disabled without coverage data');

  // 2. Technical block (robots / 403)
  const robotsBlockedSnapshot = {
    coverage: {
      'RSS-Telex': { status: 'disabled', robotsBlocked: true }
    },
    views: { local: { newsCount: 0, retainedNewsCount: 0, newsIds: [] }, news: [] }
  };
  const robotsHtml = api.newsFeedHtml(robotsBlockedSnapshot);
  assert.ok(robotsHtml.includes('technikai tiltás (robots.txt vagy HTTP 403)'));

  // 3. Rate limited / backoff (429)
  const rateLimitSnapshot = {
    coverage: {
      'Google-News': { status: 'disabled', rateLimited: true }
    },
    views: { local: { newsCount: 0, retainedNewsCount: 0, newsIds: [] }, news: [] }
  };
  const rateHtml = api.newsFeedHtml(rateLimitSnapshot);
  assert.ok(rateHtml.includes('sebességkorlátozás miatt ideiglenesen felfüggesztve'));

  // 4. Stale / error warning
  const staleSnapshot = {
    coverage: {
      'RSS-Dehir': { status: 'stale_error' }
    },
    views: {
      local: { newsCount: 1, retainedNewsCount: 1, newsIds: ['n1'] },
      news: [{ id: 'n1', title: 'Hír', kind: 'news', link: 'https://example.com' }]
    }
  };
  const staleHtml = api.newsFeedHtml(staleSnapshot);
  assert.ok(staleHtml.includes('vp-news-alert-stale'));

  // 5. Filter produced empty result
  api.setNewsFilter({ source: 'NemletezoKiadó' });
  const filterEmptyHtml = api.newsFeedHtml(staleSnapshot);
  assert.ok(filterEmptyHtml.includes('Van hír (1 db), de a szűrés után nincs találat.'));
  api.resetNewsFilter();
});

test('16b. Útmutató, README és .env.example összhangja', () => {
  const rootDir = join(__dirname, '..');
  const readmeContent = readFileSync(join(rootDir, 'README.md'), 'utf8');
  const envExampleContent = readFileSync(join(rootDir, '.env.example'), 'utf8');

  // Verify supported switches exist
  assert.ok(readmeContent.includes('CRUCIX_ENABLE_FEED_'), 'README must document CRUCIX_ENABLE_FEED_* switches');
  assert.ok(readmeContent.includes('CRUCIX_ENABLE_GNEWS'), 'README must document CRUCIX_ENABLE_GNEWS');
  assert.ok(envExampleContent.includes('CRUCIX_ENABLE_FEED_'), '.env.example must document CRUCIX_ENABLE_FEED_* switches');
  assert.ok(envExampleContent.includes('CRUCIX_ENABLE_GNEWS'), '.env.example must document CRUCIX_ENABLE_GNEWS');

  // Verify unsupported switches do NOT exist
  assert.ok(!readmeContent.includes('CRUCIX_ENABLE_NEWS_RSS'), 'README must NOT contain CRUCIX_ENABLE_NEWS_RSS');
  assert.ok(!readmeContent.includes('CRUCIX_ENABLE_GOOGLE_NEWS_RSS'), 'README must NOT contain CRUCIX_ENABLE_GOOGLE_NEWS_RSS');
  assert.ok(!envExampleContent.includes('CRUCIX_ENABLE_NEWS_RSS'), '.env.example must NOT contain CRUCIX_ENABLE_NEWS_RSS');
  assert.ok(!envExampleContent.includes('CRUCIX_ENABLE_GOOGLE_NEWS_RSS'), '.env.example must NOT contain CRUCIX_ENABLE_GOOGLE_NEWS_RSS');
});

test('17. isPublisherPromo kizárása a hírfolyamból', () => {
  const { api } = createHarness();
  api.resetNewsFilter();
  api.setView(api.VIEWS.GLOBAL, false);

  const mockSnapshot = {
    views: {
      global: { newsCount: 2, retainedNewsCount: 2, newsIds: ['promo-1', 'real-1'] },
      news: [
        {
          id: 'promo-1',
          kind: 'news',
          isPublisherPromo: true,
          title: '[TESZTADAT] Kiadói promóciós cikk',
          link: 'https://example.com/promo'
        },
        {
          id: 'real-1',
          kind: 'news',
          isPublisherPromo: false,
          title: '[TESZTADAT] Valós hír',
          link: 'https://example.com/real'
        }
      ]
    }
  };

  const html = api.newsFeedHtml(mockSnapshot);
  assert.ok(!html.includes('Kiadói promóciós cikk'), 'Promo items must NEVER appear in newsfeed');
  assert.ok(html.includes('Valós hír'), 'Real news must appear');
});

test('18. Eseményszámlálók változatlansága', () => {
  const { api } = createHarness();
  const mockSnapshot = {
    events: [
      { id: 'ev-1', kind: 'incident', title: 'Fizikai esemény', views: { local: { inView: true, category: 'confirmedLocal' } } }
    ],
    views: {
      local: { uniqueEvents: 42, totalEvents: 100, newsCount: 1, newsIds: ['n1'] },
      news: [{ id: 'n1', kind: 'news', title: 'Hír', link: 'https://example.com' }]
    }
  };

  // Call panelHtml and newsFeedHtml
  api.panelHtml(mockSnapshot);
  api.newsFeedHtml(mockSnapshot);

  // Assert counters remained intact
  assert.equal(mockSnapshot.views.local.uniqueEvents, 42, 'uniqueEvents must be untouched');
  assert.equal(mockSnapshot.views.local.totalEvents, 100, 'totalEvents must be untouched');
});

test('19. HTML-injekció és veszélyes linkek (XSS) megelőzése', () => {
  const { api } = createHarness();

  const maliciousItem = {
    id: 'xss-1',
    kind: 'news',
    title: '<img src=x onerror=alert("XSS")>Ártalmas cím',
    source: { name: '<b onmouseover=alert(1)>Kiadó</b>' },
    link: 'javascript:alert(document.cookie)',
    publishedAt: '2026-10-28T10:00:00Z'
  };

  const cardHtml = api.renderNewsCard(maliciousItem);

  // Escaped title
  assert.ok(!cardHtml.includes('<img src=x'), 'Raw HTML tag in title must be escaped');
  assert.ok(cardHtml.includes('&lt;img src=x'), 'Title must be HTML entity escaped');

  // Escaped publisher
  assert.ok(!cardHtml.includes('<b onmouseover'), 'Raw HTML tag in publisher must be escaped');
  assert.ok(cardHtml.includes('&lt;b onmouseover'), 'Publisher must be HTML entity escaped');

  // Sanitized javascript: link: must NOT render <a> tag with href="#" or href="javascript:"
  assert.ok(!cardHtml.includes('href="javascript:'), 'javascript: URLs must be neutralized');
  assert.ok(!cardHtml.includes('href="#"'), 'Dangerous URLs must NOT render href="#" dummy link');
  assert.ok(!cardHtml.includes('<a href='), 'Invalid or dangerous URLs must NOT render any <a> anchor tag');
  assert.ok(cardHtml.includes('<span class="vp-news-card-title">'), 'Title must remain non-clickable plain text span');

  // Test data: URL
  const dataItem = { id: 'xss-2', title: 'Data URL', link: 'data:text/html,<script>alert(1)</script>' };
  const dataHtml = api.renderNewsCard(dataItem);
  assert.ok(!dataHtml.includes('href="data:'), 'data: URLs must be neutralized');
  assert.ok(!dataHtml.includes('href="#"'), 'data: URLs must not render href="#"');
  assert.ok(dataHtml.includes('<span class="vp-news-card-title">Data URL</span>'), 'data: URL title must remain plain text span');

  // Test missing and invalid URLs
  const missingItem = { id: 'no-link', title: 'Nincs link' };
  const missingHtml = api.renderNewsCard(missingItem);
  assert.ok(!missingHtml.includes('<a href='), 'Missing URL must NOT render <a> tag');
  assert.ok(!missingHtml.includes('href="#"'), 'Missing URL must NOT render href="#"');
  assert.ok(missingHtml.includes('<span class="vp-news-card-title">Nincs link</span>'));

  const invalidItem = { id: 'bad-link', title: 'Hibás link', link: 'not-a-valid-url' };
  const invalidHtml = api.renderNewsCard(invalidItem);
  assert.ok(!invalidHtml.includes('<a href='), 'Invalid URL must NOT render <a> tag');
  assert.ok(invalidHtml.includes('<span class="vp-news-card-title">Hibás link</span>'));

  // Test valid http/https link behavior
  const validItem = { id: 'valid-link', title: 'Érvényes link', link: 'https://example.com/hir' };
  const validHtml = api.renderNewsCard(validItem);
  assert.ok(validHtml.includes('<a href="https://example.com/hir" target="_blank" rel="noopener noreferrer" class="vp-news-card-title">Érvényes link</a>'));
  assert.ok(validHtml.includes('class="vp-news-extlink"'));
});

test('20. Régi snapshot kompatibilitás (hiányzó mezők)', () => {
  const { api } = createHarness();
  assert.doesNotThrow(() => api.panelHtml({}), 'Must not throw on empty object snapshot');
  assert.doesNotThrow(() => api.panelHtml(null), 'Must not throw on null snapshot');
  assert.doesNotThrow(() => api.panelHtml({ events: [] }), 'Must not throw on snapshot without views');
  assert.doesNotThrow(() => api.newsFeedHtml({}), 'Must not throw on empty snapshot in newsFeedHtml');
});

test('21. Nézeti plafon figyelmeztetés és szűrési darabszám', () => {
  const { api } = createHarness();
  api.resetNewsFilter();

  const mockSnapshot = {
    views: {
      local: { newsCount: 65, retainedNewsCount: 50, newsIds: ['n1'] },
      news: [{ id: 'n1', kind: 'news', title: 'Helyi hír', link: 'https://example.com' }]
    }
  };

  const html = api.newsFeedHtml(mockSnapshot);
  assert.ok(html.includes('vp-newsfeed-ceiling-note'));
  assert.ok(html.includes('Nézeti felső plafon aktív: 50 / 65 hír megtartva.'));
  assert.ok(html.includes('<span class="vp-sec-badge">50 db</span>'));

  // When filter produces subset: filtered count shown separately
  api.setNewsFilter({ source: 'NemletezoKiadó' });
  const filteredHtml = api.newsFeedHtml(mockSnapshot);
  assert.ok(filteredHtml.includes('Szűrt: 0 / 50 db'), 'Filtered count must be shown separately in head badge');
  assert.ok(filteredHtml.includes('(szűrés után látható: 0 db)'), 'Filtered count must be shown separately in ceiling note');
  api.resetNewsFilter();
});


test('22. Duplikátum-összevonás: normalizált cím egyezése és <= 15 perc időeltérés esetén egyetlen kártya', () => {
  const { api } = createHarness();
  const itemA = {
    id: 'dehir-dog-1',
    kind: 'news',
    title: 'Két hónap börtönt kapott egy férfi, aki miatt éhen halt egy kutya',
    source: { name: 'RSS-Dehir' },
    link: 'https://dehir.hu/eletmod/ket-honap-bortont-kapott-egy-ferfi-aki-miatt-ehen-halt-egy-kutya/2026/10/29/',
    publishedAt: '2026-10-29T19:08:13.000Z'
  };
  const itemB = {
    id: 'gnews-dog-1',
    kind: 'news',
    title: 'Két hónap börtönt kapott egy férfi, aki miatt éhen halt egy kutya - Dehir',
    source: { name: 'Google-News', publisher: 'Dehir' },
    facts: { sourcePublisher: 'Dehir' },
    link: 'https://news.google.com/rss/articles/CBMi1234567890',
    publishedAt: '2026-10-29T19:11:19.000Z'
  };

  const deduped = api.deduplicateNewsItems([itemA, itemB]);
  assert.equal(deduped.length, 1, 'Két tételnek 1 kártyára kell összevonódnia');
  assert.equal(deduped[0].id, 'dehir-dog-1');
  assert.equal(deduped[0].link, 'https://dehir.hu/eletmod/ket-honap-bortont-kapott-egy-ferfi-aki-miatt-ehen-halt-egy-kutya/2026/10/29/');
  assert.ok(deduped[0].relatedSources.includes('Google Hírek') || deduped[0].relatedSources.includes('Google-News'));

  const cardHtml = api.renderNewsCard(deduped[0]);
  assert.ok(cardHtml.includes('vp-news-related'));
  assert.ok(cardHtml.includes('Kapcsolódó:'));
  assert.ok(cardHtml.includes('https://dehir.hu/eletmod/'));
  assert.ok(!cardHtml.includes('https://news.google.com/'));
});

test('23. Közvetlen kiadói link elsőbbsége a Google-átirányítóval szemben sorrendtől függetlenül', () => {
  const { api } = createHarness();
  const googleFirst = {
    id: 'gnews-1',
    kind: 'news',
    title: 'Elutasította a kereseteket a Debreceni Törvényszék a CATL-ügyben – videóval - Dehir',
    source: { name: 'Google-News', publisher: 'Dehir' },
    facts: { sourcePublisher: 'Dehir' },
    link: 'https://news.google.com/rss/articles/CBMiCATL123',
    publishedAt: '2026-10-29T16:15:02.000Z'
  };
  const directSecond = {
    id: 'dehir-1',
    kind: 'news',
    title: 'Elutasította a kereseteket a Debreceni Törvényszék a CATL-ügyben – videóval',
    source: { name: 'RSS-Dehir' },
    link: 'https://dehir.hu/debrecen/elutasitotta-a-kereseteket-a-debreceni-torvenyszek-a-catl-ugyben/2026/10/29/',
    publishedAt: '2026-10-29T16:15:00.000Z'
  };

  const deduped = api.deduplicateNewsItems([googleFirst, directSecond]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].link, directSecond.link, 'A közvetlen Dehir linknek kell győznie még akkor is, ha a Google News volt az első a listában');
  assert.equal(deduped[0].title, directSecond.title);
});

test('24. Időeltérés > 15 perc esetén nincs összevonás, külön kártyák maradnak', () => {
  const { api } = createHarness();
  const morningItem = {
    id: 'n-morning',
    kind: 'news',
    title: 'Mindenszentek: erre hívja fel a figyelmet a rendőrség és a katasztrófavédelem',
    source: { name: 'RSS-Dehir' },
    link: 'https://dehir.hu/debrecen/mindenszentek-1',
    publishedAt: '2026-10-29T13:06:00.000Z'
  };
  const afternoonItem = {
    id: 'n-afternoon',
    kind: 'news',
    title: 'Mindenszentek: erre hívja fel a figyelmet a rendőrség és a katasztrófavédelem',
    source: { name: 'Google-News' },
    link: 'https://news.google.com/rss/articles/CBMiMSZ',
    publishedAt: '2026-10-29T13:39:00.000Z'
  };

  const deduped = api.deduplicateNewsItems([morningItem, afternoonItem]);
  assert.equal(deduped.length, 2, '15 percnél nagyobb időeltérésnél tilos összevonni, 2 kártyának kell maradnia');
});

test('25. Hasonló, de eltérő című tételek: legfeljebb "kapcsolódó jelölt" jelzés, nincs összevonás', () => {
  const { api } = createHarness();
  const policeItem = {
    id: 'pol-1',
    kind: 'news',
    title: 'Összehangolt akció Nádudvaron',
    source: { name: 'Police-Hajdu' },
    link: 'https://police.hu/hu/hirek/nadudvar',
    publishedAt: '2026-10-29T13:00:00.000Z'
  };
  const gnewsItem = {
    id: 'gnews-var-1',
    kind: 'news',
    title: 'Összehangolt akcióval kapcsolt le egy dílert a rendőrség Nádudvaron',
    source: { name: 'Google-News' },
    link: 'https://news.google.com/rss/articles/CBMiNadudvar',
    publishedAt: '2026-10-29T13:20:00.000Z'
  };

  const deduped = api.deduplicateNewsItems([policeItem, gnewsItem]);
  assert.equal(deduped.length, 2, 'Eltérő című tételeket tilos összevonni');

  const cardA = api.renderNewsCard(deduped[0]);
  const cardB = api.renderNewsCard(deduped[1]);
  assert.ok(cardA.includes('Kapcsolódó jelölt:') || cardB.includes('Kapcsolódó jelölt:'), 'Legalább az egyik kártyán meg kell jelennie a "Kapcsolódó jelölt" jelzésnek');
});

test('26. Koordináta nélküli hírek listájában is érvényesül az összevonás', () => {
  const { api } = createHarness();
  const snapshot = {
    views: {
      local: { newsCount: 2, retainedNewsCount: 2, newsIds: ['unloc-1', 'unloc-2'] },
      news: [
        {
          id: 'unloc-1',
          kind: 'news',
          title: 'Két hónap börtönt kapott egy férfi, aki miatt éhen halt egy kutya',
          source: { name: 'RSS-Dehir' },
          link: 'https://dehir.hu/dog',
          publishedAt: '2026-10-29T19:08:00.000Z'
        },
        {
          id: 'unloc-2',
          kind: 'news',
          title: 'Két hónap börtönt kapott egy férfi, aki miatt éhen halt egy kutya - Dehir',
          source: { name: 'Google-News', publisher: 'Dehir' },
          facts: { sourcePublisher: 'Dehir' },
          link: 'https://news.google.com/rss/dog',
          publishedAt: '2026-10-29T19:11:00.000Z'
        }
      ]
    }
  };

  const panelHtml = api.panelHtml(snapshot);
  assert.ok(panelHtml.includes('Koordináta nélküli hírek (térképi jelölő nélkül)'));
  assert.ok(panelHtml.includes('Kapcsolódó: Google Hírek') || panelHtml.includes('Kapcsolódó: Google-News') || panelHtml.includes('Kapcsolódó: Dehir'));
  const unlocMatches = panelHtml.match(/class="vp-unlocated-item"/g) || [];
  assert.equal(unlocMatches.length, 1, 'A koordináta nélküli hírek listájában a duplikátumok összevonása után pontosan 1 elemnek kell szerepelnie');
});

test('27. Eseményszámlálók és plafon változatlansága duplikátum-összevonás mellett', () => {
  const { api } = createHarness();
  api.resetNewsFilter();

  const mockSnapshot = {
    views: {
      local: {
        newsCount: 58,
        retainedNewsCount: 50,
        newsIds: ['item-1', 'item-2', 'item-3'],
        breakdown: { confirmedLocal: 0, keyConnection: 0, needsReview: 0, regionalAdvisories: 0, unknownTerritory: 0, countyEvent: 0, nationalEvent: 0, globalEvent: 0 }
      },
      news: [
        {
          id: 'item-1',
          kind: 'news',
          title: 'Azonos hír címe',
          source: { name: 'RSS-Dehir' },
          link: 'https://dehir.hu/hir1',
          publishedAt: '2026-10-29T12:00:00Z'
        },
        {
          id: 'item-2',
          kind: 'news',
          title: 'Azonos hír címe - Dehir',
          source: { name: 'Google-News' },
          link: 'https://news.google.com/hir1',
          publishedAt: '2026-10-29T12:05:00Z'
        },
        {
          id: 'item-3',
          kind: 'news',
          title: 'Másik független hír',
          source: { name: 'HAON' },
          link: 'https://haon.hu/hir2',
          publishedAt: '2026-10-29T12:10:00Z'
        }
      ]
    }
  };

  const html = api.newsFeedHtml(mockSnapshot);
  assert.ok(html.includes('Nézeti felső plafon aktív: 50 / 58 hír megtartva.'));
  assert.ok(html.includes('50 db (2 kártya)'), 'A fejléc jelvénynek mutatnia kell a megőrzött elemszámot és az összevont kártyák számát');

  const panelHtml = api.panelHtml(mockSnapshot);
  assert.ok(panelHtml.includes('0 db'), 'A fizikai eseményszámlálók nem szennyeződhetnek hírrel');
});

test('28. Egységes Élő hírfolyam: fülek (Fontos / Helyi / Hajdú-Bihar / Magyarország / Világ / Mind) és sport/kultúra kizárása a Fontos fülről', () => {
  const { api } = createHarness();
  const mockSnapshot = {
    views: {
      local: { uniqueEvents: 1, newsCount: 1, newsIds: ['n-local-1'] },
      county: { uniqueEvents: 0, newsCount: 4, newsIds: ['n-local-1', 'n-county-hazard', 'n-county-police', 'n-county-sport'] },
      national: { uniqueEvents: 2, newsCount: 6, newsIds: ['n-local-1', 'n-county-hazard', 'n-county-police', 'n-county-sport', 'n-nat-hazard', 'n-nat-culture'] },
      global: { uniqueEvents: 5, newsCount: 6, newsIds: ['n-local-1', 'n-county-hazard', 'n-county-police', 'n-county-sport', 'n-nat-hazard', 'n-nat-culture'] },
      news: [
        {
          id: 'n-local-1',
          kind: 'news',
          title: 'Bihartordán áramszünet és közműkarbantartás várható',
          source: { name: 'RSS-HAON' },
          territory: 'local',
          facts: { topic: 'news_local' },
          link: 'https://haon.hu/bihartorda-aram',
          publishedAt: '2026-10-31T10:00:00Z'
        },
        {
          id: 'n-county-hazard',
          kind: 'news',
          title: 'Tűzoltói beavatkozás és riasztás Debrecen határában',
          source: { name: 'Katasztrófavédelem' },
          territory: 'county',
          facts: { topic: 'news_hazard' },
          link: 'https://katasztrofavedelem.hu/debrecen-tuz',
          publishedAt: '2026-10-31T10:05:00Z'
        },
        {
          id: 'n-county-police',
          kind: 'news',
          title: 'Rendőrségi fokozott ellenőrzés Hajdúszoboszlón',
          source: { name: 'Police-Hajdu' },
          territory: 'county',
          facts: { topic: 'news_regional' },
          link: 'https://police.hu/hajduszoboszlo',
          publishedAt: '2026-10-31T10:10:00Z'
        },
        {
          id: 'n-county-sport',
          kind: 'news',
          title: 'DVSC–Ferencváros bajnoki labdarúgó mérkőzés összefoglaló',
          source: { name: 'RSS-Dehir' },
          territory: 'county',
          facts: { topic: 'news_regional' },
          link: 'https://dehir.hu/sport/dvsc-fradi',
          publishedAt: '2026-10-31T10:15:00Z'
        },
        {
          id: 'n-nat-hazard',
          kind: 'news',
          title: 'Másodfokú viharriasztás a Dunántúlon',
          source: { name: 'RSS-Telex' },
          territory: 'national',
          facts: { topic: 'news_hazard' },
          link: 'https://telex.hu/vihar-dunantul',
          publishedAt: '2026-10-31T10:20:00Z'
        },
        {
          id: 'n-nat-culture',
          kind: 'news',
          title: 'Színházi fesztivál és koncert hétvége Budapesten',
          source: { name: 'RSS-Telex' },
          territory: 'national',
          facts: { topic: 'news_national' },
          link: 'https://telex.hu/kultura/fesztival',
          publishedAt: '2026-10-31T10:25:00Z'
        }
      ]
    },
    newsFeed: [
      {
        id: 'legacy-intl-1',
        headline: 'Global maritime trade corridor update in Red Sea',
        source: 'BBC World',
        timestamp: '2026-10-31T09:50:00Z',
        url: 'https://bbc.co.uk/news/world-1'
      }
    ]
  };

  // Non-critical & importance unit checks
  const sportItem = mockSnapshot.views.news.find(n => n.id === 'n-county-sport');
  const cultureItem = mockSnapshot.views.news.find(n => n.id === 'n-nat-culture');
  const localItem = mockSnapshot.views.news.find(n => n.id === 'n-local-1');
  const hazardItem = mockSnapshot.views.news.find(n => n.id === 'n-county-hazard');
  const policeItem = mockSnapshot.views.news.find(n => n.id === 'n-county-police');

  assert.equal(api.isNonCriticalNews(sportItem), true, 'DVSC labdarúgó mérkőzés sporttételként nem kritikus');
  assert.equal(api.isNonCriticalNews(cultureItem), true, 'Színházi fesztivál és koncert kultúratételként nem kritikus');
  assert.equal(api.isImportantNews(sportItem), false, 'Sporttétel nem kerülhet a Fontos fülre még megyei címkével sem');
  assert.equal(api.isImportantNews(cultureItem), false, 'Kultúratétel nem kerülhet a Fontos fülre');
  assert.equal(api.isImportantNews(localItem), true, 'Helyi (Bihartorda) hír fontos');
  assert.equal(api.isImportantNews(hazardItem), true, 'Katasztrófavédelmi veszélyhelyzeti hír fontos');
  assert.equal(api.isImportantNews(policeItem), true, 'Police-Hajdu rendőrségi hír fontos');

  // Check Fontos tab
  api.setLiveStreamTab('important', false);
  const importantHtml = api.liveStreamHtml(mockSnapshot);
  assert.ok(importantHtml.includes('Sajtó- és hatósági hírek; nem igazolt veszélyesemények'), 'Kötelező figyelmeztető szöveg az Élő hírfolyamban');
  assert.ok(importantHtml.includes('role="tablist"'), 'Fülek tablist szerepkörrel');
  assert.ok(importantHtml.includes('Fontos'), 'Fontos fül');
  assert.ok(importantHtml.includes('Helyi'), 'Helyi fül');
  assert.ok(importantHtml.includes('Hajdú-Bihar'), 'Hajdú-Bihar fül');
  assert.ok(importantHtml.includes('Magyarország'), 'Magyarország fül');
  assert.ok(importantHtml.includes('Világ'), 'Világ fül');
  assert.ok(importantHtml.includes('Mind'), 'Mind fül');
  assert.ok(importantHtml.includes('Bihartordán áramszünet'));
  assert.ok(importantHtml.includes('Tűzoltói beavatkozás'));
  assert.ok(importantHtml.includes('Rendőrségi fokozott ellenőrzés'));
  assert.ok(importantHtml.includes('Másodfokú viharriasztás'));
  assert.ok(!importantHtml.includes('DVSC–Ferencváros'), 'Sport hír NEM szerepelhet a Fontos fülön');
  assert.ok(!importantHtml.includes('Színházi fesztivál'), 'Kultúra hír NEM szerepelhet a Fontos fülön');
  assert.ok(!importantHtml.includes('Global maritime trade'), 'Régi nemzetközi hír NEM szerepelhet a Fontos fülön');

  // Check Világ tab contains legacy international news
  api.setLiveStreamTab('global', false);
  const globalHtml = api.liveStreamHtml(mockSnapshot);
  assert.ok(globalHtml.includes('Global maritime trade corridor update in Red Sea'), 'Régi nemzetközi hír a Világ fülre kerül');

  // Check Mind tab contains everything
  api.setLiveStreamTab('all', false);
  const allHtml = api.liveStreamHtml(mockSnapshot);
  assert.ok(allHtml.includes('DVSC–Ferencváros'), 'Mind fülön a sporthír is megjelenik');
  assert.ok(allHtml.includes('Global maritime trade corridor update in Red Sea'), 'Mind fülön a nemzetközi hír is megjelenik');
});

test('29. Területi gombok: két számláló (események | hírek), tooltip, és térképi fókusz / preset szinkron', () => {
  const { win, api } = createHarness();
  const focusedRegions = [];
  win.setRegion = (r) => focusedRegions.push(r);

  const mockSnapshot = {
    territoryConfig: {
      mapBounds: {
        local: { regionKey: 'local', bounds: [[21.1, 47.05], [21.65, 47.4]], pov: { lat: 47.2186, lng: 21.3547, altitude: 0.08 } },
        hajduBihar: { regionKey: 'hajduBihar', bounds: [[20.8, 46.9], [22.2, 47.9]], pov: { lat: 47.42, lng: 21.52, altitude: 0.12 } },
        hungary: { regionKey: 'hungary', bounds: [[16.1, 45.7], [22.9, 48.6]], pov: { lat: 47.16, lng: 19.50, altitude: 0.25 } },
        world: { regionKey: 'world', bounds: [[-180, -60], [180, 80]], pov: { lat: 20, lng: 20, altitude: 1.8 } }
      }
    },
    views: {
      local: { uniqueEvents: 1, newsCount: 4, newsIds: ['n1', 'n2', 'n3', 'n4'] },
      county: { uniqueEvents: 0, newsCount: 42, newsIds: [] },
      national: { uniqueEvents: 3, newsCount: 118, newsIds: [] },
      global: { uniqueEvents: 9, newsCount: 250, newsIds: [] }
    }
  };

  const mockContainer = { innerHTML: '', querySelectorAll() { return []; } };
  api.mountSelector(mockContainer, { getSnapshot: () => mockSnapshot });

  // Verify dual counts: események | hírek
  assert.ok(mockContainer.innerHTML.includes('<span class="vp-count-ev">0</span><span class="vp-count-sep"> | </span><span class="vp-count-news">42</span>'), 'Hajdú-Bihar 0 | 42 formátumú kettős számláló');
  assert.ok(mockContainer.innerHTML.includes('<span class="vp-count-ev">1</span><span class="vp-count-sep"> | </span><span class="vp-count-news">4</span>'), 'Helyi 1 | 4 formátumú kettős számláló');
  assert.ok(mockContainer.innerHTML.includes('fizikai esemény |'), 'Tooltip magyarázza a két szám jelentését');

  // Verify clicking / activating territory buttons triggers map focus and syncs liveStreamTab + activeView + newsScope
  api.setNewsScope('all');
  api.setView('county', true);
  assert.equal(focusedRegions.at(-1), 'hajduBihar', 'Hajdú-Bihar gomb a hajduBihar térképi régióra fókuszál');
  assert.equal(api.getLiveStreamTab(), 'county', 'Élő hírfolyam fül szinkronban: county');
  assert.equal(api.getActiveView(), 'county', 'Aktív területi nézet szinkronban: county');
  assert.equal(api.getNewsScope(), 'view', 'Hírfolyam hatókör visszaáll a kiválasztott területi nézetre (view)');
  assert.deepEqual(api.getTerritoryBounds('county', mockSnapshot).bounds, [[20.8, 46.9], [22.2, 47.9]], 'Bounding box a konfigurációból jön');

  api.setView('local', true);
  assert.equal(focusedRegions.at(-1), 'local', 'Helyi gomb a local térképi régióra fókuszál');
  assert.equal(api.getLiveStreamTab(), 'local');

  api.setView('national', true);
  assert.equal(focusedRegions.at(-1), 'hungary', 'Magyarország gomb a hungary térképi régióra fókuszál');
  assert.equal(api.getLiveStreamTab(), 'national');

  api.setView('global', true);
  assert.equal(focusedRegions.at(-1), 'world', 'Világ gomb a world térképi régióra fókuszál');
  assert.equal(api.getLiveStreamTab(), 'global');
});

test('30. Kompakt görgethető panelminta és térképi hírjelölő szűrés ellenőrzése', () => {
  const { api } = createHarness();
  const jarvisHtml = readFileSync(resolve(ROOT, 'dashboard/public/jarvis.html'), 'utf8');

  // 1. Verify region preset buttons in jarvis.html include MAGYARORSZÁG and HAJDÚ-BIHAR
  assert.ok(jarvisHtml.includes("'hungary','hajduBihar'"), 'A térképi régióválasztó tartalmazza a hungary és hajduBihar gombokat');
  assert.ok(jarvisHtml.includes('MAGYARORSZÁG') && jarvisHtml.includes('HAJDÚ-BIHAR'), 'A régiógombok magyar feliratai szerepelnek');

  // 2. Verify mapNewsMarkers in jarvis.html filters out non-critical sport/culture news and keeps hazard/local/county
  const fnMatch = jarvisHtml.match(/function mapNewsMarkers\(\)\{[^\n]*\}/);
  assert.ok(fnMatch, 'mapNewsMarkers függvény definiálva van a jarvis.html-ben');
  const mapCtx = vm.createContext({
    window: { CrucixViewsPanel: api },
    hasCoordinates: (lat, lon) => typeof lat === 'number' && typeof lon === 'number',
    D: {
      views: {
        news: [
          { id: 'loc-1', title: 'Bihartordai tűzeset', territory: 'local', facts: { topic: 'news_hazard' }, location: { lat: 47.22, lon: 21.35 } },
          { id: 'cnt-sport', title: 'DVSC labdarúgó bajnoki mérkőzés', territory: 'county', facts: { topic: 'news_regional' }, location: { lat: 47.53, lon: 21.62 } },
          { id: 'cnt-pol', title: 'Rendőrségi körözés Debrecenben', source: { name: 'Police-Hajdu' }, territory: 'county', facts: { topic: 'news_regional' }, location: { lat: 47.53, lon: 21.62 } },
          { id: 'nat-gen', title: 'Általános gazdasági elemzés Budapesten', territory: 'national', facts: { topic: 'news_national' }, location: { lat: 47.49, lon: 19.04 } }
        ]
      },
      news: []
    }
  });
  vm.runInContext(fnMatch[0], mapCtx);
  const markers = mapCtx.mapNewsMarkers();
  const markerIds = markers.map(m => m.id);
  assert.ok(markerIds.includes('loc-1'), 'Helyi veszélyhelyzeti hír kap térképi jelölőt');
  assert.ok(markerIds.includes('cnt-pol'), 'Megyei rendőrségi hír kap térképi jelölőt');
  assert.ok(!markerIds.includes('cnt-sport'), 'Sporthír NEM kaphat térképi jelölőt');
  assert.ok(!markerIds.includes('nat-gen'), 'Nem veszélyhelyzeti országos hír alapértelmezetten nem kap térképi jelölőt');

  // 3. Verify compact scrollable regions have tabindex="0", role="region", aria-label
  const streamHtml = api.liveStreamHtml({ views: { news: [{ id: '1', title: 'Helyi hír', territory: 'local', publishedAt: '2026-10-31T10:00:00Z' }] } });
  assert.ok(streamHtml.includes('class="tk-stream-list vp-scroll-region scroll-region"'));
  assert.ok(streamHtml.includes('tabindex="0"') && streamHtml.includes('role="region"') && streamHtml.includes('aria-label="Élő hírfolyam'));

  const feedHtml = api.newsFeedHtml({ views: { local: { newsCount: 1, newsIds: ['1'] }, news: [{ id: '1', title: 'Helyi hír', territory: 'local' }] } });
  assert.ok(feedHtml.includes('class="vp-news-items vp-scroll-region scroll-region" tabindex="0" role="region" aria-label="Hírfolyam lista"'));

  const covHtml = api.coveragePanelHtml({ coverage: { HAON: { status: 'ok_data', origin: 'live' }, Dehir: { status: 'stale_error', origin: 'live' } } });
  assert.ok(covHtml.includes('class="cov-list vp-scroll-region scroll-region" tabindex="0" role="region" aria-label="Forrásfedettség lista"'));
  assert.ok(covHtml.indexOf('Dehir') < covHtml.indexOf('HAON'), 'Hibás/elavult forrás (stale_error) kerül előre a Forrásfedettség panelen');
});

test('31. Helyi hírek: folyam-alapú lapozás (Mutass többet), nincs belső 480px-es görgetődoboz', () => {
  const { api } = createHarness();

  // 25 teszt hír generálása
  const mockNews = [];
  for (let i = 1; i <= 25; i++) {
    mockNews.push({
      id: `news-${i}`,
      title: `Helyi esemény hír #${i}`,
      territory: 'local',
      category: 'news_general',
      publishedAt: '2026-11-01T12:00:00Z',
      url: `https://example.com/hir-${i}`
    });
  }

  const snapshot = {
    views: {
      local: { newsCount: 25, retainedNewsCount: 25, newsIds: mockNews.map(n => n.id) },
      news: mockNews
    }
  };

  // 1. Alapállapot: visibleNewsLimit = 10
  assert.equal(api.getVisibleNewsLimit(), 10);
  let html = api.newsFeedHtml(snapshot);

  // Felső plafon jelvény 10 / 25 hír
  assert.ok(html.includes('<span class="vp-newsfeed-ceiling-badge" id="vp-newsfeed-ceiling-badge">10 / 25 hír</span>'));
  // "Mutass többet" gomb jelen van
  assert.ok(html.includes('id="vp-btn-more-news"'));
  assert.ok(html.includes('↓ Mutass többet (+10 hír · még 15 db van)'));
  // Régi 480px-es belső görgetősáv NINCS a kimenetben
  assert.ok(!html.includes('vp-news-remaining-scroll'));
  assert.ok(!html.includes('vp-news-remaining-section'));

  // 2. showMoreNews(10) -> visibleNewsLimit = 20
  api.showMoreNews(10);
  assert.equal(api.getVisibleNewsLimit(), 20);
  html = api.newsFeedHtml(snapshot);

  assert.ok(html.includes('<span class="vp-newsfeed-ceiling-badge" id="vp-newsfeed-ceiling-badge">20 / 25 hír</span>'));
  assert.ok(html.includes('id="vp-btn-more-news"'));
  assert.ok(html.includes('↓ Mutass többet (+5 hír · még 5 db van)'));

  // 3. showMoreNews(10) újra -> visibleNewsLimit = 30 (mind a 25 látható)
  api.showMoreNews(10);
  assert.equal(api.getVisibleNewsLimit(), 30);
  html = api.newsFeedHtml(snapshot);

  assert.ok(html.includes('<span class="vp-newsfeed-ceiling-badge" id="vp-newsfeed-ceiling-badge">25 / 25 hír</span>'));
  assert.ok(!html.includes('id="vp-btn-more-news"'), 'Nincs több hír, a léptetőgomb nem jelenik meg');

  // 4. resetVisibleNewsLimit visszaállítja 10-re
  api.resetVisibleNewsLimit();
  assert.equal(api.getVisibleNewsLimit(), 10);
  html = api.newsFeedHtml(snapshot);
  assert.ok(html.includes('<span class="vp-newsfeed-ceiling-badge" id="vp-newsfeed-ceiling-badge">10 / 25 hír</span>'));
  assert.ok(html.includes('id="vp-btn-more-news"'));
});

test('32. Helyi hírek: görgetési tartomány, min(40vh, 280px), látható görgetősáv és "még N hír" alsó jelzés', () => {
  const { api } = createHarness();

  // 1. CSS szabályok ellenőrzése
  const cssPath = join(ROOT, 'dashboard', 'public', 'views-panel.css');
  const css = readFileSync(cssPath, 'utf8');

  // .vp-unlocated-list és .tk-stream-list magassága min(40vh, 280px)
  assert.ok(css.includes('max-height: min(40vh, 280px);'), 'min(40vh, 280px) definiálva van');
  const unlocCssMatch = css.match(/\.vp-unlocated-list\s*\{[^}]*max-height:\s*min\(40vh,\s*280px\);/);
  assert.ok(unlocCssMatch, '.vp-unlocated-list max-height min(40vh, 280px) szabály létezik');

  const streamCssMatch = css.match(/\.tk-stream-list\s*\{[^}]*max-height:\s*min\(40vh,\s*280px\);/);
  assert.ok(streamCssMatch, '.tk-stream-list max-height min(40vh, 280px) szabály létezik');

  // Látható görgetősáv szabályok
  assert.ok(css.includes('scrollbar-color: #38bdf8 rgba(15, 23, 42, 0.75);'), 'Kontrasztos scrollbar-color definiálva');
  assert.ok(css.includes('width: 8px;'), '8px széles webkit scrollbar');
  assert.ok(css.includes('.vp-scroll-fade'), '.vp-scroll-fade indikátor stílus definiálva');
  assert.ok(css.includes('.vp-scroll-fade-text'), '.vp-scroll-fade-text stílus definiálva');

  // 2. HTML struktúra: .vp-scroll-wrapper és .vp-scroll-fade
  const snapshot = {
    views: {
      local: { newsIds: ['u1', 'u2'] },
      news: [
        { id: 'u1', title: 'Koordináta nélküli hír 1', isPublisherPromo: false, source: { name: 'HAON' } },
        { id: 'u2', title: 'Koordináta nélküli hír 2', isPublisherPromo: false, source: { name: 'HAON' } },
        { id: 's1', title: 'Stream hír 1', territory: 'local', publishedAt: '2026-11-01T12:00:00Z' },
        { id: 's2', title: 'Stream hír 2', territory: 'local', publishedAt: '2026-11-01T12:05:00Z' }
      ]
    }
  };

  const panelHtml = api.panelHtml(snapshot);
  assert.ok(panelHtml.includes('class="vp-scroll-wrapper"'), 'Unlocated lista vp-scroll-wrapper-be van ágyazva');
  assert.ok(panelHtml.includes('class="vp-scroll-fade"'), 'Unlocated lista alsó vp-scroll-fade jelzéssel rendelkezik');
  assert.ok(panelHtml.includes('class="vp-scroll-fade-text"'), 'vp-scroll-fade-text számláló konténer jelen van');
  assert.ok(panelHtml.includes('onscroll="window.CrucixViewsPanel?.updateMoreIndicator?.(this)"'), 'Unlocated lista onscroll eseménykezelője be van kötve');

  const streamHtml = api.liveStreamHtml(snapshot);
  assert.ok(streamHtml.includes('class="vp-scroll-wrapper"'), 'Stream lista vp-scroll-wrapper-be van ágyazva');
  assert.ok(streamHtml.includes('class="vp-scroll-fade"'), 'Stream lista alsó vp-scroll-fade jelzéssel rendelkezik');
  assert.ok(streamHtml.includes('class="vp-scroll-fade-text"'), 'Stream lista számláló konténere jelen van');
  assert.ok(streamHtml.includes('onscroll="window.CrucixViewsPanel?.updateMoreIndicator?.(this)"'), 'Stream lista onscroll eseménykezelője be van kötve');

  // 3. updateMoreIndicator viselkedés tesztelése
  assert.equal(typeof api.updateMoreIndicator, 'function', 'updateMoreIndicator exportálva van');

  // Szimulált DOM elemek az updateMoreIndicator teszteléséhez
  const mockFadeClasses = new Set();
  const mockTextEl = { textContent: '' };
  const mockFade = {
    classList: {
      add: c => mockFadeClasses.add(c),
      remove: c => mockFadeClasses.delete(c),
      contains: c => mockFadeClasses.has(c)
    }
  };
  const mockWrapper = {
    querySelector: sel => {
      if (sel === '.vp-scroll-fade') return mockFade;
      if (sel === '.vp-scroll-fade-text') return mockTextEl;
      return null;
    }
  };
  const mockList = {
    closest: sel => sel === '.vp-scroll-wrapper' ? mockWrapper : null,
    parentElement: mockWrapper,
    children: [
      { offsetTop: 0 },
      { offsetTop: 30 },
      { offsetTop: 60 },
      { offsetTop: 90 },
      { offsetTop: 120 },
      { offsetTop: 150 },
      { offsetTop: 180 },
      { offsetTop: 210 }
    ],
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 240
  };

  // 3a. Kezdeti állapot (scrollTop = 0, clientHeight = 100): az elemek a 100px alatt maradtak -> remaining > 0
  api.updateMoreIndicator(mockList);
  assert.ok(mockFadeClasses.has('visible'), 'Indikátor látható ha van lefelé görgethető elem');
  assert.ok(mockTextEl.textContent.includes('▾ még'), 'Szöveges számláló megjelenik');

  // 3b. Legörgetve az aljára (scrollTop = 140, clientHeight = 100, scrollHeight = 240)
  mockList.scrollTop = 140;
  api.updateMoreIndicator(mockList);
  assert.ok(!mockFadeClasses.has('visible'), 'Aljára érve az indikátor eltűnik');

  // 3c. Kevés elem (összesen 1 elem) -> nincs indikátor
  mockList.children = [{ offsetTop: 0 }];
  mockList.scrollTop = 0;
  mockList.scrollHeight = 30;
  api.updateMoreIndicator(mockList);
  assert.ok(!mockFadeClasses.has('visible'), 'Kevés elem esetén nem jelenik meg indikátor');
});

test('33. Helyi hírek görgetés-megőrzés: újrarederelés során a scrollTop megmarad és az indikátor automatikusan újrakötődik', () => {
  const { api } = createHarness();

  // 1. Mentés és visszaállítás funkciók exportjának ellenőrzése
  assert.equal(typeof api.saveScrollPositions, 'function', 'saveScrollPositions exportálva van');
  assert.equal(typeof api.restoreScrollPositions, 'function', 'restoreScrollPositions exportálva van');
  assert.equal(typeof api.resetScrollPositions, 'function', 'resetScrollPositions exportálva van');

  api.resetScrollPositions();

  // 2. Mock környezet: lista görgetése
  const mockFadeClasses = new Set();
  const mockTextEl = { textContent: '' };
  const mockFade = {
    classList: {
      add: c => mockFadeClasses.add(c),
      remove: c => mockFadeClasses.delete(c),
      contains: c => mockFadeClasses.has(c)
    }
  };
  const mockWrapper = {
    querySelector: sel => {
      if (sel === '.vp-scroll-fade') return mockFade;
      if (sel === '.vp-scroll-fade-text') return mockTextEl;
      return null;
    }
  };

  const oldList = {
    dataset: { scrollKey: 'unlocated' },
    classList: { contains: c => c === 'vp-unlocated-list' },
    closest: sel => sel === '.vp-scroll-wrapper' ? mockWrapper : null,
    parentElement: mockWrapper,
    children: [
      { offsetTop: 0 },
      { offsetTop: 30 },
      { offsetTop: 60 },
      { offsetTop: 90 },
      { offsetTop: 120 },
      { offsetTop: 150 },
      { offsetTop: 180 },
      { offsetTop: 210 }
    ],
    scrollTop: 140,
    clientHeight: 100,
    scrollHeight: 240
  };

  // 2a. A felhasználó görgetett (140px) -> updateMoreIndicator elmenti a pozíciót
  api.updateMoreIndicator(oldList);
  assert.equal(api.getScrollPosition('unlocated'), 140, 'Görgetési pozíció elmentve a cache-be');

  // 3. Szimulált DOM újragenerálás (az éles innerHTML felülírás új DOM elemet hoz létre scrollTop = 0-val)
  const newList = {
    dataset: { scrollKey: 'unlocated' },
    classList: { contains: c => c === 'vp-unlocated-list' },
    closest: sel => sel === '.vp-scroll-wrapper' ? mockWrapper : null,
    parentElement: mockWrapper,
    children: [
      { offsetTop: 0 },
      { offsetTop: 30 },
      { offsetTop: 60 },
      { offsetTop: 90 },
      { offsetTop: 120 },
      { offsetTop: 150 },
      { offsetTop: 180 },
      { offsetTop: 210 }
    ],
    scrollTop: 0, // Alapértelmezett 0 az új DOM node-on
    clientHeight: 100,
    scrollHeight: 240
  };

  const mockRoot = {
    querySelectorAll: sel => {
      if (sel.includes('vp-unlocated-list')) return [newList];
      return [];
    }
  };

  // 4. Újrarenderelés utáni visszaállítás (initScrollIndicators)
  api.restoreScrollPositions(mockRoot);

  assert.equal(newList.scrollTop, 140, 'Az új DOM elemen a scrollTop visszaállt 140-re');

  // 5. Területváltáskor (setView) a görgetési pozíció törlődik, hogy tiszta lappal induljon
  api.setView('county');
  assert.equal(api.getScrollPosition('unlocated'), 0, 'Területi nézetváltáskor a mentett pozíció törlődik');
});

test('34. updateMoreIndicator: textContent feltételes beállítása, ugyanazon szöveg nem generál redundáns értékadást vagy mutációt', () => {
  const { api } = createHarness();

  let textContentSetCount = 0;
  let currentText = '';

  const mockTextEl = {
    get textContent() {
      return currentText;
    },
    set textContent(val) {
      textContentSetCount++;
      currentText = val;
    }
  };

  const mockFadeClasses = new Set();
  const mockFade = {
    classList: {
      add: c => mockFadeClasses.add(c),
      remove: c => mockFadeClasses.delete(c),
      contains: c => mockFadeClasses.has(c)
    }
  };

  const mockWrapper = {
    querySelector: sel => {
      if (sel === '.vp-scroll-fade') return mockFade;
      if (sel === '.vp-scroll-fade-text') return mockTextEl;
      return null;
    }
  };

  const listEl = {
    classList: { contains: () => false },
    closest: sel => sel === '.vp-scroll-wrapper' ? mockWrapper : null,
    parentElement: mockWrapper,
    children: [
      { offsetTop: 0 },
      { offsetTop: 30 },
      { offsetTop: 60 },
      { offsetTop: 90 },
      { offsetTop: 120 },
      { offsetTop: 150 },
      { offsetTop: 180 },
      { offsetTop: 210 }
    ],
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 240
  };

  // 1. Első hívás: a szöveg még üres, be kell állítani
  api.updateMoreIndicator(listEl);
  assert.equal(textContentSetCount, 1, 'Első alkalommal a textContent beállítása megtörténik');
  assert.ok(currentText.includes('még'), 'Helyes indikátorszöveg beállítva');
  assert.ok(mockFadeClasses.has('visible'), 'A fade megkapja a visible osztályt');

  // 2. Második hívás azonos állapot mellett: a textContent nem változott, NEM szabad újra értékadást végezni
  api.updateMoreIndicator(listEl);
  assert.equal(textContentSetCount, 1, 'Második alkalommal változatlan szövegnél nincs újabb textContent értékadás (nem generál childList mutációt)');

  // 3. Harmadik hívás: a felhasználó aljára görget, az indikátor eltűnik
  listEl.scrollTop = 140; // eléri az alját
  api.updateMoreIndicator(listEl);
  assert.ok(!mockFadeClasses.has('visible'), 'Aljára görgetve a visible osztály lekerül');
  assert.equal(currentText, '', 'A szöveg kiürül');
  assert.equal(textContentSetCount, 2, 'Kiürítéskor pontosan egyszer kap értéket');

  // 4. Negyedik hívás alul maradva: a szöveg már üres, nem kap újabb értékadást
  api.updateMoreIndicator(listEl);
  assert.equal(textContentSetCount, 2, 'Már üres szöveg esetén nincs felesleges üres string értékadás');
});

