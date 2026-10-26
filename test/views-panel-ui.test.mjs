import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function createHarness() {
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

  const store = new Map();
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

  return { win, api: win.CrucixViewsPanel };
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

  // Origin badges
  assert.ok(html.includes('[LIVE]'));
  assert.ok(html.includes('[SNAPSHOT]'));
});
