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
  assert.ok(optInHtml.includes('CRUCIX_ENABLE_FEED_* vagy CRUCIX_ENABLE_GNEWS'));

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

  // Sanitized javascript: link
  assert.ok(!cardHtml.includes('href="javascript:'), 'javascript: URLs must be neutralized');
  assert.ok(!cardHtml.includes('href="data:'), 'data: URLs must be neutralized');
});

test('20. Régi snapshot kompatibilitás (hiányzó mezők)', () => {
  const { api } = createHarness();
  assert.doesNotThrow(() => api.panelHtml({}), 'Must not throw on empty object snapshot');
  assert.doesNotThrow(() => api.panelHtml(null), 'Must not throw on null snapshot');
  assert.doesNotThrow(() => api.panelHtml({ events: [] }), 'Must not throw on snapshot without views');
  assert.doesNotThrow(() => api.newsFeedHtml({}), 'Must not throw on empty snapshot in newsFeedHtml');
});

test('21. Nézeti plafon figyelmeztetés', () => {
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
  assert.ok(html.includes('Nézeti felső plafon aktív: 1 hír megjelenítve (összes jogosult: 65 db).'));
});
