(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'crucix_territory_view_v1';
  const LIVE_TAB_STORAGE_KEY = 'crucix_live_news_tab_v1';
  const VIEWS = Object.freeze({
    LOCAL: 'local',
    COUNTY: 'county',
    NATIONAL: 'national',
    GLOBAL: 'global'
  });

  const VIEW_ORDER = [VIEWS.LOCAL, VIEWS.COUNTY, VIEWS.NATIONAL, VIEWS.GLOBAL];

  const VIEW_LABELS = Object.freeze({
    [VIEWS.LOCAL]: 'Helyi',
    [VIEWS.COUNTY]: 'Hajdú-Bihar',
    [VIEWS.NATIONAL]: 'Magyarország',
    [VIEWS.GLOBAL]: 'Világ',
    all: 'Összes hír'
  });

  const LIVE_STREAM_TABS = Object.freeze({
    IMPORTANT: 'important',
    LOCAL: 'local',
    COUNTY: 'county',
    NATIONAL: 'national',
    GLOBAL: 'global',
    ALL: 'all'
  });

  const LIVE_STREAM_TAB_ORDER = [
    LIVE_STREAM_TABS.IMPORTANT,
    LIVE_STREAM_TABS.LOCAL,
    LIVE_STREAM_TABS.COUNTY,
    LIVE_STREAM_TABS.NATIONAL,
    LIVE_STREAM_TABS.GLOBAL,
    LIVE_STREAM_TABS.ALL
  ];

  const LIVE_STREAM_TAB_LABELS = Object.freeze({
    [LIVE_STREAM_TABS.IMPORTANT]: 'Fontos',
    [LIVE_STREAM_TABS.LOCAL]: 'Helyi',
    [LIVE_STREAM_TABS.COUNTY]: 'Hajdú-Bihar',
    [LIVE_STREAM_TABS.NATIONAL]: 'Magyarország',
    [LIVE_STREAM_TABS.GLOBAL]: 'Világ',
    [LIVE_STREAM_TABS.ALL]: 'Mind'
  });

  const VIEW_TO_MAP_REGION = Object.freeze({
    [VIEWS.LOCAL]: 'local',
    [VIEWS.COUNTY]: 'hajduBihar',
    [VIEWS.NATIONAL]: 'hungary',
    [VIEWS.GLOBAL]: 'world'
  });

  const DEFAULT_TERRITORY_MAP_BOUNDS = Object.freeze({
    local: Object.freeze({
      regionKey: 'local',
      label: 'Helyi (Bihartorda és 35 km-es körzete)',
      center: Object.freeze({ lat: 47.2186, lon: 21.3547 }),
      bounds: Object.freeze([[20.85, 46.90], [21.85, 47.55]]),
      pov: Object.freeze({ lat: 47.2186, lng: 21.3547, altitude: 0.35 })
    }),
    county: Object.freeze({
      regionKey: 'hajduBihar',
      label: 'Hajdú-Bihar vármegye',
      center: Object.freeze({ lat: 47.4, lon: 21.5 }),
      bounds: Object.freeze([[20.8, 46.9], [22.2, 47.95]]),
      pov: Object.freeze({ lat: 47.4, lng: 21.5, altitude: 0.5 })
    }),
    hajduBihar: Object.freeze({
      regionKey: 'hajduBihar',
      label: 'Hajdú-Bihar vármegye',
      center: Object.freeze({ lat: 47.4, lon: 21.5 }),
      bounds: Object.freeze([[20.8, 46.9], [22.2, 47.95]]),
      pov: Object.freeze({ lat: 47.4, lng: 21.5, altitude: 0.5 })
    }),
    national: Object.freeze({
      regionKey: 'hungary',
      label: 'Magyarország',
      center: Object.freeze({ lat: 47.16, lon: 19.50 }),
      bounds: Object.freeze([[16.1, 45.7], [22.9, 48.6]]),
      pov: Object.freeze({ lat: 47.16, lng: 19.50, altitude: 0.75 })
    }),
    hungary: Object.freeze({
      regionKey: 'hungary',
      label: 'Magyarország',
      center: Object.freeze({ lat: 47.16, lon: 19.50 }),
      bounds: Object.freeze([[16.1, 45.7], [22.9, 48.6]]),
      pov: Object.freeze({ lat: 47.16, lng: 19.50, altitude: 0.75 })
    }),
    global: Object.freeze({
      regionKey: 'world',
      label: 'Világ',
      center: Object.freeze({ lat: 25.0, lon: 20.0 }),
      bounds: null,
      pov: Object.freeze({ lat: 25.0, lng: 20.0, altitude: 2.0 })
    }),
    world: Object.freeze({
      regionKey: 'world',
      label: 'Világ',
      center: Object.freeze({ lat: 25.0, lon: 20.0 }),
      bounds: null,
      pov: Object.freeze({ lat: 25.0, lng: 20.0, altitude: 2.0 })
    })
  });

  const CATEGORY_LABELS = Object.freeze({
    confirmedLocal: 'Megerősített helyi esemény',
    keyConnection: 'Kiemelt kapcsolat',
    needsReview: 'Ellenőrizendő szöveges említés',
    regionalAdvisories: 'Térségi tájékoztatás',
    unknownTerritory: 'Tisztázatlan területi érintettség',
    countyEvent: 'Megyei szintű esemény',
    nationalEvent: 'Országos szintű esemény',
    globalEvent: 'Globális esemény'
  });

  const STALE_REASON_LABELS = Object.freeze({
    provider_expired: 'Lejárt kibocsátói érvényesség',
    source_error: 'Forráshiba: az aktualitás nem igazolható',
    source_stale: 'A forrás frissítése késik (elavult lekérés)',
    local_freshness_exceeded: 'Aktualitása nem igazolt: a helyi frissességi korlát letelt.'
  });

  const COVERAGE_LABELS = Object.freeze({
    ok_data: 'Adat rendelkezésre áll',
    ok_empty: 'Szűrés utáni állapot nem meghatározható',
    unconfigured: 'Nincs forrás konfigurálva',
    disabled: 'Letiltva',
    stale_error: 'Elavult / Forráshiba',
    offline_snapshot: 'Offline pillanatkép'
  });

  const NEWS_TOPIC_LABELS = Object.freeze({
    news_hazard: 'Veszélyhelyzeti témájú hír',
    news_local: 'Helyi hír',
    news_regional: 'Megyei hír',
    news_national: 'Országos hír',
    news_global: 'Nemzetközi hír',
    news_energy: 'Energetikai hír',
    news_economy: 'Gazdasági hír',
    news_agriculture: 'Agrár és állategészségügyi hír',
    news_science: 'Tudományos hír',
    news_other: 'Hír'
  });

  const HUNGARIAN_NEWS_SOURCES = Object.freeze([
    'Police-Hajdu',
    'RSS-Dehir',
    'RSS-Telex',
    'RSS-444',
    'RSS-24hu',
    'RSS-Index',
    'RSS-HVG',
    'RSS-Portfolio',
    'RSS-Qubit',
    'Google-News'
  ]);

  let newsFilter = {
    source: 'all',
    category: 'all',
    sort: 'priority' // 'priority' | 'latest'
  };

  let newsScope = 'view'; // 'view' | 'all'
  let visibleNewsLimit = 10;

  function showMoreNews(step = 10) {
    const increment = Number.isFinite(step) && step > 0 ? step : 10;
    visibleNewsLimit += increment;
    for (const fn of changeListeners) {
      try { fn(activeView); } catch (e) { console.error('[ViewsPanel]', e); }
    }
  }

  function getVisibleNewsLimit() {
    return visibleNewsLimit;
  }

  function resetVisibleNewsLimit() {
    visibleNewsLimit = 10;
  }

  function setNewsScope(scope) {
    if (scope === 'view' || scope === 'all') {
      newsScope = scope;
      visibleNewsLimit = 10;
      for (const fn of changeListeners) {
        try { fn(activeView); } catch {}
      }
    }
  }

  function getNewsScope() {
    return newsScope;
  }

  function resetNewsScope() {
    newsScope = 'view';
    visibleNewsLimit = 10;
  }

  let contentTab = 'news'; // 'news' | 'live'

  function setContentTab(tab) {
    if (tab === 'news' || tab === 'live') {
      if (contentTab === 'live' && tab !== 'live') {
        try { window.CrucixLiveMedia?.stopAllStreams?.() || window.CrucixLiveMedia?.stopStream?.(); } catch {}
      }
      contentTab = tab;
      for (const fn of changeListeners) {
        try { fn(activeView); } catch {}
      }
    }
  }

  function getContentTab() {
    return contentTab;
  }

  let activeView = readSavedView();
  let liveStreamTab = readSavedLiveTab();
  let changeListeners = [];
  let selectorOptions = {};

  function readSavedView() {
    try {
      const v = window.localStorage?.getItem(STORAGE_KEY);
      if (v && Object.values(VIEWS).includes(v)) return v;
    } catch {}
    return VIEWS.LOCAL;
  }

  function saveView(view) {
    try {
      window.localStorage?.setItem(STORAGE_KEY, view);
    } catch {}
  }

  function readSavedLiveTab() {
    try {
      const t = window.localStorage?.getItem(LIVE_TAB_STORAGE_KEY);
      if (t && Object.values(LIVE_STREAM_TABS).includes(t)) return t;
    } catch {}
    return LIVE_STREAM_TABS.IMPORTANT;
  }

  function saveLiveTab(tab) {
    try {
      window.localStorage?.setItem(LIVE_TAB_STORAGE_KEY, tab);
    } catch {}
  }

  const scrollPositions = new Map();

  function getScrollKey(listEl) {
    if (!listEl) return null;
    if (listEl.dataset && listEl.dataset.scrollKey) return listEl.dataset.scrollKey;
    if (listEl.classList && listEl.classList.contains('vp-unlocated-list')) return 'unlocated';
    if (listEl.classList && listEl.classList.contains('tk-stream-list')) return 'stream:' + liveStreamTab;
    return null;
  }

  function saveScrollPosition(listEl) {
    const key = getScrollKey(listEl);
    if (key && listEl && typeof listEl.scrollTop === 'number') {
      scrollPositions.set(key, listEl.scrollTop);
    }
  }

  function saveAllScrollPositions(root) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const r = root || document;
    if (!r.querySelectorAll) return;
    const lists = r.querySelectorAll('.vp-unlocated-list, .tk-stream-list');
    lists.forEach(l => saveScrollPosition(l));
  }

  function resetScrollPositions() {
    scrollPositions.clear();
  }

  function getLiveStreamTab() {
    return liveStreamTab;
  }

  function setLiveStreamTab(tab, notify = true) {
    if (!Object.values(LIVE_STREAM_TABS).includes(tab)) return;
    if (tab !== liveStreamTab) {
      scrollPositions.delete('stream:' + tab);
      scrollPositions.delete('stream:' + liveStreamTab);
    }
    liveStreamTab = tab;
    saveLiveTab(tab);
    if (notify) {
      for (const fn of changeListeners) {
        try { fn(activeView); } catch (e) { console.error('[ViewsPanel]', e); }
      }
    }
  }

  function getTerritoryMapRegion(view = activeView) {
    return VIEW_TO_MAP_REGION[view] || 'world';
  }

  function getTerritoryBounds(viewOrRegion = activeView, snapshot = null) {
    const snap = snapshot || (typeof window !== 'undefined' ? window.D : null) || {};
    const cfgBounds = snap?.territoryConfig?.mapBounds || {};
    const regionKey = VIEW_TO_MAP_REGION[viewOrRegion] || viewOrRegion;
    return cfgBounds[viewOrRegion] || cfgBounds[regionKey] || DEFAULT_TERRITORY_MAP_BOUNDS[viewOrRegion] || DEFAULT_TERRITORY_MAP_BOUNDS[regionKey] || DEFAULT_TERRITORY_MAP_BOUNDS.world;
  }

  const NON_CRITICAL_NEWS_PATTERNS = [
    /\b(labdarúg\w*|foci\w*|futball\w*|bajnokság\w*|mérkőzés\w*|meccs\w*|edző\w*|gól\w*|nb\s*i\b|nb1\b|dvsc|loki|kézilabda\w*|kosárlabda\w*|vízilabda\w*|úszás\w*|olimpia\w*|sport\w*|bajnok\w*|kupadöntő\w*|stadion\w*|szurkoló\w*)\b/i,
    /\b(koncert\w*|fesztivál\w*|színház\w*|kiállítás\w*|múzeum\w*|kultúr\w*|kulturális|zene\w*|zenekar\w*|előadás\w*|mozi\w*|film\w*|irodalom\w*|irodalmi|könyvhét\w*|galéria\w*|opera\w*|balett\w*)\b/i,
    /\b(horoszkóp\w*|recept\w*|gasztro\w*|divat\w*|bulvár\w*|celeb\w*|sztár\w*|kvíz\w*)\b/i
  ];

  function isNonCriticalNews(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.newsCategory === 'news_sport' || item.newsCategory === 'news_culture') return true;
    const text = `${item.title || ''} ${item.summary || ''} ${item.category || ''}`;
    if (/\b(baleset\w*|tűz\w*|robbanás\w*|riasztás\w*|rendőrség\w*|katasztrófa\w*|halálos\w*|sérült\w*|mentő\w*|árvíz\w*|vihar\w*|evakuál\w*)\b/i.test(text)) {
      return false;
    }
    return NON_CRITICAL_NEWS_PATTERNS.some(re => re.test(text));
  }

  function isImportantNews(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.isPublisherPromo === true) return false;
    if (isNonCriticalNews(item)) return false;

    const srcName = item.source?.name || (typeof item.source === 'string' ? item.source : '') || '';
    const pubName = item.source?.publisher || item.facts?.sourcePublisher || '';
    const cat = item.newsCategory || item.facts?.newsCategory || item.facts?.topic || item.topic || '';
    const level = typeof item.territory === 'string' ? item.territory : (item.territory?.level || item.territory?.territoryLevel || '');
    const inLocal = Boolean(item.views?.local?.inView || level === 'local' || level === 'settlement' || level === 'district' || item.territory?.settlementId);
    const inCounty = Boolean(item.views?.county?.inView || level === 'county' || item.territory?.countyCode === 'HB' || item.territory?.countyCode === '09');
    const isPoliceOrAuth = srcName === 'Police-Hajdu' || /police|rendőrség|katasztrófavédelem/i.test(`${srcName} ${pubName}`);
    const isHazard = cat === 'news_hazard' || item.urgent === true || item.severity === 'critical' || item.severity === 'high' || item.severity === 'elevated' || /\b(baleset\w*|tűz\w*|robbanás\w*|riasztás\w*|katasztrófa\w*|árvíz\w*|vihar\w*|evakuál\w*)\b/i.test(item.title || item.headline || '');
    const isLocalOrCountyCat = cat === 'news_local' || cat === 'news_regional';

    return Boolean(isHazard || isPoliceOrAuth || inLocal || inCounty || isLocalOrCountyCat);
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function escSafeUrl(url) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) {
      return esc(trimmed);
    }
    return '';
  }

  function getPublisherName(item) {
    if (!item || typeof item !== 'object') return 'Ismeretlen kiadó';
    const isGNews = item.source?.name === 'Google-News' || item.source === 'Google-News';
    const origPublisher = item.source?.publisher || item.facts?.sourcePublisher;
    if (isGNews && origPublisher) {
      return `${origPublisher} via Google Hírek`;
    }
    if (isGNews) {
      return 'Google Hírek';
    }
    return item.source?.displayName || item.source?.name || item.source || 'Ismeretlen kiadó';
  }

  function formatTime(val) {
    if (!val || typeof val !== 'string') return '';
    // Date-only string: do NOT append midnight UTC or format into UTC time
    if (/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
      return val.trim();
    }
    const ms = Date.parse(val);
    if (!Number.isFinite(ms)) return esc(val);
    const d = new Date(ms);
    const utcPart = d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    let bpPart = '';
    try {
      bpPart = ' (' + d.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' }) + ' Budapest)';
    } catch {}
    return `${utcPart}${bpPart}`;
  }

  function formatHhmmBudapest(val) {
    if (!val || typeof val !== 'string') return '—';
    const ms = Date.parse(val);
    if (!Number.isFinite(ms)) return esc(val);
    const d = new Date(ms);
    try {
      return d.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return d.toISOString().slice(11, 16);
    }
  }

  function hasCoordinates(lat, lon) {
    return typeof lat === 'number' && typeof lon === 'number' &&
      Number.isFinite(lat) && Number.isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  function getActiveView() {
    return activeView;
  }

  function setActiveView(view, notify = true, opts = {}) {
    if (!Object.values(VIEWS).includes(view)) return;
    if (view !== activeView) {
      scrollPositions.delete('unlocated');
    }
    if (contentTab === 'live') {
      try { window.CrucixLiveMedia?.stopAllStreams?.() || window.CrucixLiveMedia?.stopStream?.(); } catch {}
    }
    activeView = view;
    saveView(view);
    newsScope = 'view';
    visibleNewsLimit = 10;
    if (opts.syncLiveStream !== false && Object.values(LIVE_STREAM_TABS).includes(view)) {
      liveStreamTab = view;
      saveLiveTab(view);
    }
    updateSelectorUI();
    if (notify) {
      const mapRegion = getTerritoryMapRegion(view);
      try {
        if (typeof selectorOptions?.onSelectRegion === 'function') {
          selectorOptions.onSelectRegion(mapRegion, view, getTerritoryBounds(view));
        } else if (typeof window.setRegion === 'function') {
          window.setRegion(mapRegion);
        }
      } catch (e) {
        console.error('[ViewsPanel:setRegion]', e);
      }
      for (const fn of changeListeners) {
        try { fn(activeView); } catch (e) { console.error('[ViewsPanel]', e); }
      }
    }
  }

  function onChange(fn) {
    if (typeof fn === 'function') changeListeners.push(fn);
  }

  function updateSelectorUI() {
    const tabs = document.querySelectorAll('.vp-tab');
    for (const tab of tabs) {
      const isSelected = tab.dataset.view === activeView;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.setAttribute('tabindex', isSelected ? '0' : '-1');
    }
  }

  function mountSelector(container, options = {}) {
    if (!container) return;
    selectorOptions = options || {};
    const snapshot = options.getSnapshot ? options.getSnapshot() : (window.D || {});
    const counts = snapshot?.views || {};

    container.innerHTML = `
      <div class="vp-tablist" role="tablist" aria-label="Területi nézetválasztó">
        <span class="vp-tab-label" aria-hidden="true">Nézet:</span>
        ${VIEW_ORDER.map(view => {
          const isSelected = view === activeView;
          const viewMeta = counts[view] || {};
          const hasCounts = viewMeta.uniqueEvents !== undefined || viewMeta.totalEvents !== undefined || viewMeta.retainedNewsCount !== undefined || viewMeta.newsCount !== undefined || Array.isArray(viewMeta.newsIds);
          const evCount = viewMeta.uniqueEvents ?? viewMeta.totalEvents ?? 0;
          const newsCount = viewMeta.retainedNewsCount ?? viewMeta.newsCount ?? (Array.isArray(viewMeta.newsIds) ? viewMeta.newsIds.length : getViewNews(snapshot, view).length);
          const tooltipText = `${VIEW_LABELS[view]}: ${evCount} fizikai esemény | ${newsCount} sajtó-/hatósági hír (Első szám: megerősített fizikai események; Második szám: hírek. Kattintásra a térkép és a hírfolyam erre a területre vált.)`;
          return `
            <button type="button"
                    class="vp-tab"
                    role="tab"
                    id="vp-tab-${view}"
                    data-view="${view}"
                    data-map-region="${esc(getTerritoryMapRegion(view))}"
                    title="${esc(tooltipText)}"
                    aria-selected="${isSelected}"
                    aria-controls="panel-territoryViews"
                    tabindex="${isSelected ? '0' : '-1'}">
              <span>${esc(VIEW_LABELS[view])}</span>
              ${hasCounts ? `<span class="vp-count-badge" title="${esc(`Események: ${evCount} | Hírek: ${newsCount}`)}"><span class="vp-count-ev">${evCount}</span><span class="vp-count-sep"> | </span><span class="vp-count-news">${newsCount}</span></span>` : ''}
            </button>
          `;
        }).join('')}
      </div>
    `;

    const tabElements = container.querySelectorAll('.vp-tab');
    tabElements.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        setActiveView(tab.dataset.view);
      });

      tab.addEventListener('keydown', (ev) => {
        let targetIndex = -1;
        if (ev.key === 'ArrowRight') {
          targetIndex = (index + 1) % tabElements.length;
        } else if (ev.key === 'ArrowLeft') {
          targetIndex = (index - 1 + tabElements.length) % tabElements.length;
        } else if (ev.key === 'Home') {
          targetIndex = 0;
        } else if (ev.key === 'End') {
          targetIndex = tabElements.length - 1;
        }

        if (targetIndex >= 0) {
          ev.preventDefault();
          const targetTab = tabElements[targetIndex];
          targetTab.focus();
          setActiveView(targetTab.dataset.view);
        }
      });
    });
  }

  function renderCard(event, { isStale = false } = {}) {
    const isFixture = Boolean(event.isFixture || (typeof event.title === 'string' && event.title.includes('[TESZTADAT]')));
    const level = event.level || event.severity || 'unknown';
    const sevClass = `vp-sev-${level.toLowerCase()}`;
    const timeStr = formatTime(event.observedAt || event.publishedAt || event.timestamp);
    const sourceName = event.source?.name || event.source || 'Ismeretlen';

    // Check for adapter-stale unexpired condition (24-48h old without validUntil)
    let adapterStaleBadge = '';
    const now = Date.now();
    const eventTime = Date.parse(event.observedAt || event.publishedAt || '');
    if (!isStale && !event.validUntil && Number.isFinite(eventTime) && (now - eventTime > 24 * 3600000)) {
      adapterStaleBadge = `<span class="vp-badge-adapter-stale" title="Aktualitása nem igazolt: a helyi frissességi korlát letelt.">Aktualitása nem igazolt: a helyi frissességi korlát letelt.</span><span class="vp-badge-no-expiry" title="A kibocsátó nem adott lejárati időt.">A kibocsátó nem adott lejárati időt.</span>`;
    }

    let noExpiryBadge = '';
    if (isStale && (!event.validUntil || event.staleReason === 'source_stale')) {
      noExpiryBadge = `<span class="vp-badge-no-expiry" title="A kibocsátó nem adott lejárati időt.">A kibocsátó nem adott lejárati időt.</span>`;
    }

    // Regional advisory level badge (settlement / county / region)
    let advisoryLevelBadge = '';
    const category = event.views?.[activeView]?.category;
    if (category === 'regionalAdvisories') {
      const origLevel = event.territory?.level || event.territory?.territoryLevel || '';
      const levelText = origLevel === 'settlement' ? 'Települési szint' :
                        origLevel === 'county' ? 'Megyei szint' :
                        origLevel === 'region' ? 'Régiós szint' :
                        origLevel === 'district' ? 'Járási szint' : 'Ismeretlen szint';
      advisoryLevelBadge = `<span class="vp-badge-level">${esc(levelText)}</span>`;
    }

    const cardIcon = window.CrucixIcons ? `<span class="vp-card-cat-icon">${window.CrucixIcons.renderIcon(event.category || event.source?.name || level, { size: 16, severity: level })}</span>` : '';
    return `
      <div class="vp-card"
           role="button"
           tabindex="0"
           data-event-id="${esc(event.id)}"
           onclick="window.CrucixIntelligence?.openEvent?.('${esc(event.id)}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.CrucixIntelligence?.openEvent?.('${esc(event.id)}');}">
        <div class="vp-card-top">
          <div class="vp-card-title">${cardIcon}${esc(event.title)}</div>
          <div class="vp-card-badges">
            ${isFixture ? `<span class="vp-badge-fixture">[TESZTADAT]</span>` : ''}
            ${advisoryLevelBadge}
            ${adapterStaleBadge}
            ${noExpiryBadge}
            <span class="vp-badge-sev ${sevClass}">${esc(level)}</span>
          </div>
        </div>
        <div class="vp-card-meta">
          <span class="vp-card-source">${esc(sourceName)}</span>
          ${timeStr ? `<span>·</span><span class="vp-card-time">${timeStr}</span>` : ''}
        </div>
      </div>
    `;
  }

  function normalizeNewsTitle(rawTitle, item) {
    if (!rawTitle || typeof rawTitle !== 'string') return '';
    let title = rawTitle.toLowerCase();

    // 1. Strip explicit publisher suffix if known (e.g. " - HAON", " - Dehir")
    const explicitPub = (item?.facts?.sourcePublisher || item?.source?.publisher || '');
    if (explicitPub && explicitPub.length >= 2) {
      const escaped = explicitPub.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      title = title.replace(new RegExp(`\\s*[-–—|]\\s*${escaped}.*$`, 'i'), '');
    }

    // 2. Strip common news outlet suffixes
    title = title.replace(/\s*[-–—|]\s*(dehir(?:\.hu)?|haon(?:\.hu)?|index(?:\.hu)?|telex(?:\.hu)?|hvg(?:\.hu)?|24\.hu|portfolio(?:\.hu)?|civishír|világgazdaság|vg\.hu|police\.hu|qubit(?:\.hu)?|infostart|mti|euronews|magyar nemzet|népszava|blikk|femcafe|metropol|origo(?:\.hu)?).*$/i, '');

    // 3. Strip punctuation ("írásjelek nélkül")
    title = title.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()'"„”»«?–—|]/g, ' ');

    // 4. Collapse whitespace
    title = title.replace(/\s+/g, ' ').trim();
    return title;
  }

  function arePublishTimesWithin15Min(itemA, itemB) {
    const timeA = Date.parse(itemA.publishedAt || itemA.observedAt || '');
    const timeB = Date.parse(itemB.publishedAt || itemB.observedAt || '');
    if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) return false;
    return Math.abs(timeA - timeB) <= 15 * 60 * 1000;
  }

  function isDirectPublisherUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return !url.includes('news.google.com') && !url.includes('/rss/articles/');
  }

  function getNewsTokens(normTitle) {
    return new Set(normTitle.split(' ').filter(w => w.length > 2));
  }

  function calculateTokenSimilarity(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    let common = 0;
    for (const t of setA) {
      if (setB.has(t)) {
        common += 1;
      } else {
        // Stem prefix match for Hungarian inflections (e.g. akció vs akcióval)
        for (const o of setB) {
          if (t.length >= 4 && o.length >= 4 && (t.startsWith(o) || o.startsWith(t))) {
            common += 0.8;
            break;
          }
        }
      }
    }
    const union = setA.size + setB.size - common;
    return union > 0 ? common / union : 0;
  }

  /**
   * Deduplicates news items:
   * 1. Exact normalized title match AND publish time diff <= 15 min -> merged into single card
   *    Direct publisher link takes precedence over Google News redirect URL.
   *    Merged card carries "Kapcsolódó: <forrás>, <forrás>".
   * 2. Similar but distinct titles -> not merged, marked with "kapcsolódó jelölt".
   */
  function deduplicateNewsItems(items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    // Step 1: Exact matches clustering
    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < items.length; i++) {
      if (assigned.has(i)) continue;
      const current = items[i];
      const normCurrent = normalizeNewsTitle(current.title, current);
      const cluster = [current];
      assigned.add(i);

      for (let j = i + 1; j < items.length; j++) {
        if (assigned.has(j)) continue;
        const candidate = items[j];
        const normCand = normalizeNewsTitle(candidate.title, candidate);

        if (normCurrent && normCurrent === normCand && arePublishTimesWithin15Min(current, candidate)) {
          cluster.push(candidate);
          assigned.add(j);
        }
      }
      clusters.push(cluster);
    }

    // Step 2: Merge clusters into single cards with direct link priority
    const mergedList = clusters.map(cluster => {
      if (cluster.length === 1) return { ...cluster[0] };

      // Direct publisher link takes precedence over Google redirect
      let primary = cluster[0];
      for (const item of cluster) {
        const itemUrl = item.link || item.url || '';
        const primaryUrl = primary.link || primary.url || '';
        if (isDirectPublisherUrl(itemUrl) && !isDirectPublisherUrl(primaryUrl)) {
          primary = item;
        }
      }

      const otherItems = cluster.filter(item => item !== primary);
      const primarySourceLabel = primary.source?.name || getPublisherName(primary);
      const relatedSourceNames = [...new Set(
        otherItems.map(item => item.source?.name || getPublisherName(item) || item.source || 'Hírforrás')
      )].filter(name => name !== primarySourceLabel);

      const mergedIds = cluster.map(item => item.id).filter(Boolean);

      return {
        ...primary,
        relatedSources: relatedSourceNames.length > 0 ? relatedSourceNames : ['Google-News'],
        mergedIds,
        mergedItemsCount: cluster.length
      };
    });

    // Step 3: Identify similar non-matching pairs ("kapcsolódó jelölt")
    for (let i = 0; i < mergedList.length; i++) {
      const itemA = mergedList[i];
      if (itemA.relatedSources?.length > 0) continue; // Already merged exact
      const normA = normalizeNewsTitle(itemA.title, itemA);
      const tokensA = getNewsTokens(normA);
      if (tokensA.size < 2) continue;

      for (let j = i + 1; j < mergedList.length; j++) {
        const itemB = mergedList[j];
        if (itemB.relatedSources?.length > 0) continue;
        const normB = normalizeNewsTitle(itemB.title, itemB);
        if (normA === normB) continue;
        const tokensB = getNewsTokens(normB);
        if (tokensB.size < 2) continue;

        const sim = calculateTokenSimilarity(tokensA, tokensB);
        const timeA = Date.parse(itemA.publishedAt || itemA.observedAt || 0);
        const timeB = Date.parse(itemB.publishedAt || itemB.observedAt || 0);
        const timeDiffHours = Math.abs(timeA - timeB) / (3600 * 1000);

        if ((sim >= 0.25 || sim > 0) && timeDiffHours <= 24) {
          const pubA = itemA.source?.name || getPublisherName(itemA) || 'Forrás';
          const pubB = itemB.source?.name || getPublisherName(itemB) || 'Forrás';
          if (pubA !== pubB) {
            itemA.relatedCandidateSources = [...new Set([...(itemA.relatedCandidateSources || []), pubB])];
            itemB.relatedCandidateSources = [...new Set([...(itemB.relatedCandidateSources || []), pubA])];
          }
        }
      }
    }

    return mergedList;
  }

  function renderNewsCard(item) {
    if (!item || typeof item !== 'object') return '';
    const safeUrl = escSafeUrl(item.link || item.url);
    const hasValidUrl = Boolean(safeUrl);
    const newsIcon = window.CrucixIcons ? `<span class="vp-news-cat-icon">${window.CrucixIcons.renderIcon(item.category || item.newsCategory || 'general', { size: 14 })}</span>` : '';
    const titleHtml = hasValidUrl
      ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="vp-news-card-title">${newsIcon}${esc(item.title)}</a>`
      : `<span class="vp-news-card-title">${newsIcon}${esc(item.title)}</span>`;

    const topicKey = item.newsCategory || 'news_other';
    const topicLabel = NEWS_TOPIC_LABELS[topicKey] || 'Hír';
    const topicBadge = `<span class="vp-badge-news-topic vp-badge-topic-${esc(topicKey)}">${esc(topicLabel)}</span>`;

    let settlementBadge = '';
    const settlement = item.territory?.settlementName || item.facts?.settlement;
    if (settlement) {
      settlementBadge = `<span class="vp-badge-news-settlement">Település: ${esc(settlement)}</span>`;
    }

    let reviewBadge = '';
    if (item.needsLocalReview || item.territory?.needsLocalReview) {
      reviewBadge = `<span class="vp-badge-news-review" title="A hír szövege alapján ellenőrizendő említés">Ellenőrizendő említés</span>`;
    }

    let relatedBadge = '';
    if (Array.isArray(item.relatedSources) && item.relatedSources.length > 0) {
      relatedBadge = `<span class="vp-news-related" title="Több forrás által közölt azonos cikk">Kapcsolódó: ${esc(item.relatedSources.join(', '))}</span>`;
    }

    let candidateBadge = '';
    if (!relatedBadge && Array.isArray(item.relatedCandidateSources) && item.relatedCandidateSources.length > 0) {
      candidateBadge = `<span class="vp-badge-related-candidate" title="Hasonló tartalmú hír másik forrásból">Kapcsolódó jelölt: ${esc(item.relatedCandidateSources.join(', '))}</span>`;
    }

    const publisher = getPublisherName(item);
    const rawTime = item.publishedAt || item.observedAt || '';
    const timeStr = formatTime(rawTime);
    const pubTimeHtml = timeStr ? `<span class="vp-news-time" title="${esc(rawTime)}">Publikálva: ${esc(timeStr)}</span>` : '';

    const extLinkHtml = hasValidUrl
      ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="vp-news-extlink" aria-label="Cikk megnyitása új lapon">&#8599; Cikk</a>`
      : '';

    return `
      <div class="vp-news-card" data-news-id="${esc(item.id)}">
        <div class="vp-news-card-top">
          ${titleHtml}
          <div class="vp-news-badges">
            ${topicBadge}
            ${settlementBadge}
            ${reviewBadge}
            ${relatedBadge}
            ${candidateBadge}
          </div>
        </div>
        <div class="vp-news-card-meta">
          <span class="vp-news-publisher">${esc(publisher)}</span>
          ${pubTimeHtml ? `<span>·</span>${pubTimeHtml}` : ''}
          ${extLinkHtml}
        </div>
      </div>
    `;
  }

  function setNewsFilter(filter = {}) {
    if (filter.source !== undefined) newsFilter.source = filter.source;
    if (filter.category !== undefined) newsFilter.category = filter.category;
    if (filter.sort !== undefined) newsFilter.sort = filter.sort;
    visibleNewsLimit = 10;
    for (const fn of changeListeners) {
      try { fn(activeView); } catch {}
    }
  }

  function getNewsFilter() {
    return { ...newsFilter };
  }

  function resetNewsFilter() {
    newsFilter = { source: 'all', category: 'all', sort: 'priority' };
    visibleNewsLimit = 10;
  }

  function newsFeedHtml(snapshot) {
    const effectiveView = newsScope === 'all' || activeView === 'all' ? 'all' : activeView;
    const rawNews = getViewNews(snapshot, effectiveView);
    const viewCounters = snapshot?.views?.[effectiveView] || {};
    const coverage = snapshot?.coverage || {};

    // 1. Filter out publisher promo items
    const nonPromoNews = rawNews.filter(n => n && n.isPublisherPromo !== true);

    // 2. Coverage health and opt-in / technical block evaluation
    const newsSourceEntries = HUNGARIAN_NEWS_SOURCES
      .map(name => coverage[name])
      .filter(Boolean);

    let coverageAlertHtml = '';
    const hasAnyConfigured = newsSourceEntries.some(s => s.status !== 'unconfigured' && s.status !== 'disabled');
    const hasAnyStaleError = newsSourceEntries.some(s => s.status === 'stale_error');

    if (hasAnyStaleError) {
      coverageAlertHtml = `<div class="vp-news-alert-stale">Figyelem: Egy vagy több hírforrás frissítése késik vagy hibát jelzett.</div>`;
    }

    if (newsSourceEntries.length > 0 && !hasAnyConfigured) {
      const isRateLimited = newsSourceEntries.some(s => s.rateLimited === true);
      const isRobotsBlocked = newsSourceEntries.some(s => s.robotsBlocked === true);
      let disabledMsg = 'Nincs bekapcsolt hírforrás (opt-in kikapcsolva). Engedélyezze a CRUCIX_ENABLE_FEED_<ID> vagy CRUCIX_ENABLE_GNEWS változót.';
      if (isRateLimited) {
        disabledMsg = 'Hírforrás sebességkorlátozás miatt ideiglenesen felfüggesztve (várakozási idő aktív).';
      } else if (isRobotsBlocked) {
        disabledMsg = 'Hírforrás technikai tiltás (robots.txt vagy HTTP 403) miatt leállítva.';
      }

      return `
        <div class="vp-newsfeed-section" id="vp-newsfeed">
          <div class="vp-newsfeed-head">
            <span class="vp-newsfeed-title">Hírfolyam – ${esc(VIEW_LABELS[activeView])}</span>
            <span class="vp-sec-badge">0 db</span>
          </div>
          <div class="vp-newsfeed-disclaimer" role="note">
            <strong>Figyelem:</strong> Sajtó- és hatósági hírek; nem igazolt veszélyesemények.
          </div>
          <div class="vp-empty vp-news-disabled">${esc(disabledMsg)}</div>
        </div>
      `;
    }

    if (nonPromoNews.length === 0) {
      const emptyMsg = newsSourceEntries.length === 0
        ? 'Nincs az aktív nézethez illő hír (forrásállapot-adat nem áll rendelkezésre).'
        : 'Nincs az aktív nézethez illő hír.';
      return `
        <div class="vp-newsfeed-section" id="vp-newsfeed">
          <div class="vp-newsfeed-head">
            <span class="vp-newsfeed-title">Hírfolyam – ${esc(VIEW_LABELS[activeView])}</span>
            <span class="vp-sec-badge">0 db</span>
          </div>
          <div class="vp-newsfeed-disclaimer" role="note">
            <strong>Figyelem:</strong> Sajtó- és hatósági hírek; nem igazolt veszélyesemények.
          </div>
          ${coverageAlertHtml}
          <div class="vp-empty">${esc(emptyMsg)}</div>
        </div>
      `;
    }

    // 2b. Deduplicate news items (exact normalized title + <=15 min diff -> single card with related sources; similar items -> candidate badge)
    const dedupedNews = deduplicateNewsItems(nonPromoNews);

    // 3. Unique publishers and categories for filter controls
    const uniquePublishers = [...new Set(dedupedNews.map(n => getPublisherName(n)).filter(Boolean))].sort();
    const uniqueCategories = [...new Set(dedupedNews.map(n => n.newsCategory || 'news_other'))].sort();

    // 4. Apply active filters
    let filtered = dedupedNews;
    if (newsFilter.source !== 'all') {
      filtered = filtered.filter(n => getPublisherName(n) === newsFilter.source || (Array.isArray(n.relatedSources) && n.relatedSources.includes(newsFilter.source)));
    }
    if (newsFilter.category !== 'all') {
      filtered = filtered.filter(n => (n.newsCategory || 'news_other') === newsFilter.category);
    }

    // 5. Apply sorting
    if (newsFilter.sort === 'latest') {
      filtered = [...filtered].sort((a, b) => {
        const ta = Date.parse(a.publishedAt || a.observedAt || '') || 0;
        const tb = Date.parse(b.publishedAt || b.observedAt || '') || 0;
        return tb - ta;
      });
    }

    // 6. Build filter controls HTML
    const filtersHtml = `
      <div class="vp-newsfeed-filters" role="toolbar" aria-label="Hírfolyam szűrők">
        <div class="vp-filter-group">
          <label for="vp-filter-source" class="vp-filter-label">Kiadó:</label>
          <select id="vp-filter-source" class="vp-select" onchange="window.CrucixViewsPanel?.setNewsFilter({source:this.value})">
            <option value="all"${newsFilter.source === 'all' ? ' selected' : ''}>Összes kiadó (${uniquePublishers.length})</option>
            ${uniquePublishers.map(pub => `<option value="${esc(pub)}"${newsFilter.source === pub ? ' selected' : ''}>${esc(pub)}</option>`).join('')}
          </select>
        </div>
        <div class="vp-filter-group">
          <label for="vp-filter-category" class="vp-filter-label">Téma:</label>
          <select id="vp-filter-category" class="vp-select" onchange="window.CrucixViewsPanel?.setNewsFilter({category:this.value})">
            <option value="all"${newsFilter.category === 'all' ? ' selected' : ''}>Összes téma (${uniqueCategories.length})</option>
            ${uniqueCategories.map(cat => `<option value="${esc(cat)}"${newsFilter.category === cat ? ' selected' : ''}>${esc(NEWS_TOPIC_LABELS[cat] || cat)}</option>`).join('')}
          </select>
        </div>
        <div class="vp-filter-group">
          <label for="vp-filter-sort" class="vp-filter-label">Rendezés:</label>
          <select id="vp-filter-sort" class="vp-select" onchange="window.CrucixViewsPanel?.setNewsFilter({sort:this.value})">
            <option value="priority"${newsFilter.sort === 'priority' ? ' selected' : ''}>Alapértelmezett prioritás</option>
            <option value="latest"${newsFilter.sort === 'latest' ? ' selected' : ''}>Legfrissebb elöl</option>
          </select>
        </div>
      </div>
    `;

    // 7. Ceiling notice
    let ceilingNote = '';
    const retainedCount = viewCounters.retainedNewsCount ?? nonPromoNews.length;
    const eligibleCount = viewCounters.newsCount ?? nonPromoNews.length;
    if (eligibleCount > retainedCount) {
      let filterSuffix = '';
      if (filtered.length !== dedupedNews.length) {
        filterSuffix = ` (szűrés után látható: ${filtered.length} db)`;
      }
      ceilingNote = `<div class="vp-newsfeed-ceiling-note">Nézeti felső plafon aktív: ${retainedCount} / ${eligibleCount} hír megtartva${filterSuffix}.</div>`;
    }

    // 8. Render news cards: visible items up to visibleNewsLimit in document flow, with "Mutass többet" pagination button
    const shownCount = Math.min(visibleNewsLimit, filtered.length);
    const visibleNews = filtered.slice(0, shownCount);
    const remainingCount = Math.max(0, filtered.length - shownCount);
    let cardsContent = '';
    if (filtered.length === 0) {
      cardsContent = `<div class="vp-empty">Van hír (${nonPromoNews.length} db), de a szűrés után nincs találat.</div>`;
    } else {
      const newsCardsHtml = visibleNews.map(item => renderNewsCard(item)).join('');
      let moreBtnHtml = '';
      if (remainingCount > 0) {
        const nextStep = Math.min(10, remainingCount);
        moreBtnHtml = `
          <div class="vp-news-more-wrap">
            <button type="button" class="vp-btn-more-news" id="vp-btn-more-news" onclick="window.CrucixViewsPanel?.showMoreNews(10)">↓ Mutass többet (+${nextStep} hír · még ${remainingCount} db van)</button>
          </div>
        `;
      }
      cardsContent = `
        <div id="vp-news-items-flow" class="vp-news-items vp-scroll-region scroll-region" tabindex="0" role="region" aria-label="Hírfolyam lista">
          ${newsCardsHtml}
        </div>
        ${moreBtnHtml}
      `;
    }

    let headBadgeText = `${retainedCount} db`;
    if (dedupedNews.length < nonPromoNews.length) {
      headBadgeText = `${retainedCount} db (${dedupedNews.length} kártya)`;
    }
    if (filtered.length !== dedupedNews.length) {
      headBadgeText = `Szűrt: ${filtered.length} / ${retainedCount} db`;
    }

    return `
      <div class="vp-newsfeed-section" id="vp-newsfeed">
        <div class="vp-newsfeed-head">
          <span class="vp-newsfeed-title">Hírfolyam – ${esc(VIEW_LABELS[effectiveView] || 'Hírfolyam')}</span>
          <span class="vp-newsfeed-ceiling-badge" id="vp-newsfeed-ceiling-badge">${shownCount} / ${retainedCount} hír</span>
          <span class="vp-sec-badge">${esc(headBadgeText)}</span>
        </div>
        <div class="vp-newsfeed-tabs" role="tablist" aria-label="Hírfolyam hatókör">
          <button type="button" class="vp-news-tab${effectiveView !== 'all' ? ' active' : ''}" role="tab" aria-selected="${effectiveView !== 'all'}" onclick="window.CrucixViewsPanel?.setNewsScope('view')">Nézeti (${esc(VIEW_LABELS[activeView] || 'Aktuális')})</button>
          <button type="button" class="vp-news-tab${effectiveView === 'all' ? ' active' : ''}" role="tab" aria-selected="${effectiveView === 'all'}" onclick="window.CrucixViewsPanel?.setNewsScope('all')">Összes hír</button>
        </div>
        <div class="vp-newsfeed-disclaimer" role="note">
          <strong>Figyelem:</strong> Sajtó- és hatósági hírek; nem igazolt veszélyesemények.
        </div>
        ${coverageAlertHtml}
        ${filtersHtml}
        ${ceilingNote}
        ${cardsContent}
      </div>
    `;
  }

  function getViewNews(snapshot, viewName) {
    if (!snapshot || !viewName) return [];
    const views = snapshot.views || snapshot;
    const newsList = views.news || snapshot.news || [];
    if (viewName === 'all' || viewName === 'allNews') {
      return Array.isArray(newsList) ? newsList : [];
    }
    const partition = views[viewName];
    if (!partition?.newsIds || !Array.isArray(newsList)) return [];
    const idSet = new Set(partition.newsIds);
    return newsList.filter(item => idSet.has(item.id));
  }

  function getNewsTerritoryLabel(item) {
    if (!item || typeof item !== 'object') return 'Világ';
    const settlement = item.territory?.settlementName || item.facts?.settlement;
    if (settlement) return `Helyi (${settlement})`;
    const level = typeof item.territory === 'string' ? item.territory : (item.territory?.level || item.territory?.territoryLevel || '');
    if (item.views?.local?.inView || level === 'local' || level === 'settlement' || level === 'district') return 'Helyi';
    if (item.views?.county?.inView || level === 'county' || item.territory?.countyCode === 'HB' || item.territory?.countyCode === '09') return 'Hajdú-Bihar';
    if (item.views?.national?.inView || level === 'national' || level === 'country' || item.territory?.countryCode === 'HU') return 'Magyarország';
    return 'Világ';
  }

  function normalizeLegacyNewsList(snapshot, existingViewsNews) {
    const rawLegacy = Array.isArray(snapshot?.newsFeed)
      ? snapshot.newsFeed
      : (Array.isArray(snapshot?.news) ? snapshot.news : []);
    if (!rawLegacy.length) return [];

    const existingIds = new Set();
    const existingUrls = new Set();
    const existingNormTitles = new Set();
    for (const item of existingViewsNews) {
      if (!item) continue;
      if (item.id) existingIds.add(item.id);
      const u = item.link || item.url;
      if (u) existingUrls.add(u);
      const nt = normalizeNewsTitle(item.title, item);
      if (nt) existingNormTitles.add(nt);
    }

    const legacyOut = [];
    rawLegacy.forEach((raw, idx) => {
      if (!raw || typeof raw !== 'object') return;
      if (raw.id && existingIds.has(raw.id)) return;
      const rawTitle = raw.title || raw.headline || '';
      if (!rawTitle) return;
      const u = raw.url || raw.link || '';
      if (u && existingUrls.has(u)) return;
      const nt = normalizeNewsTitle(rawTitle, raw);
      if (nt && existingNormTitles.has(nt)) return;

      legacyOut.push({
        id: raw.id || `legacy-global-${idx}`,
        kind: 'news',
        isLegacyGlobal: true,
        title: rawTitle,
        source: typeof raw.source === 'object' ? raw.source : { name: raw.source || 'OSINT' },
        publishedAt: raw.timestamp || raw.publishedAt || raw.observedAt || '',
        observedAt: raw.timestamp || raw.observedAt || '',
        url: u,
        link: u,
        urgent: Boolean(raw.urgent),
        newsCategory: raw.newsCategory || (raw.urgent ? 'news_hazard' : 'news_global'),
        territory: raw.territory || { level: 'global', countryCode: null },
        views: {
          local: { inView: false },
          county: { inView: false },
          national: { inView: false },
          global: { inView: true, category: 'globalEvent' }
        }
      });
    });
    return legacyOut;
  }

  function getLiveStreamItems(snapshot, tab = liveStreamTab) {
    const snap = snapshot || (typeof window !== 'undefined' ? window.D : null) || {};
    const viewsNewsRaw = Array.isArray(snap?.views?.news)
      ? snap.views.news.filter(n => n && n.isPublisherPromo !== true)
      : [];
    const legacyGlobal = normalizeLegacyNewsList(snap, viewsNewsRaw);

    let pool = [];
    if (tab === LIVE_STREAM_TABS.IMPORTANT) {
      pool = viewsNewsRaw.filter(item => isImportantNews(item));
    } else if (tab === LIVE_STREAM_TABS.LOCAL) {
      pool = getViewNews(snap, VIEWS.LOCAL).filter(n => n && n.isPublisherPromo !== true);
    } else if (tab === LIVE_STREAM_TABS.COUNTY) {
      pool = getViewNews(snap, VIEWS.COUNTY).filter(n => n && n.isPublisherPromo !== true);
    } else if (tab === LIVE_STREAM_TABS.NATIONAL) {
      pool = getViewNews(snap, VIEWS.NATIONAL).filter(n => n && n.isPublisherPromo !== true);
    } else if (tab === LIVE_STREAM_TABS.GLOBAL) {
      const globalViewsNews = getViewNews(snap, VIEWS.GLOBAL).filter(n => n && n.isPublisherPromo !== true && !n.views?.national?.inView && !n.views?.county?.inView && !n.views?.local?.inView);
      const fallbackGlobal = globalViewsNews.length > 0 ? globalViewsNews : viewsNewsRaw.filter(n => n.newsCategory === 'news_global' || (!n.views?.national?.inView && !n.views?.county?.inView && !n.views?.local?.inView));
      pool = [...fallbackGlobal, ...legacyGlobal];
    } else {
      // 'all'
      pool = [...viewsNewsRaw, ...legacyGlobal];
    }

    const deduped = deduplicateNewsItems(pool);
    return deduped.sort((a, b) => {
      const ta = Date.parse(a.publishedAt || a.observedAt || '') || 0;
      const tb = Date.parse(b.publishedAt || b.observedAt || '') || 0;
      return tb - ta;
    });
  }

  function liveStreamHtml(snapshot, options = {}) {
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const existing = document.querySelector('.tk-stream-list');
      if (existing) saveScrollPosition(existing);
    }
    const snap = snapshot || (typeof window !== 'undefined' ? window.D : null) || {};
    const currentTab = options.tab && Object.values(LIVE_STREAM_TABS).includes(options.tab)
      ? options.tab
      : liveStreamTab;

    const tabCounts = {};
    for (const t of LIVE_STREAM_TAB_ORDER) {
      tabCounts[t] = getLiveStreamItems(snap, t).length;
    }

    const items = getLiveStreamItems(snap, currentTab);

    const tabsMarkup = LIVE_STREAM_TAB_ORDER.map(t => {
      const active = t === currentTab;
      return `
        <button type="button"
                class="tk-tab${active ? ' active' : ''}"
                role="tab"
                data-live-tab="${esc(t)}"
                aria-selected="${active}"
                onclick="window.CrucixViewsPanel?.setLiveStreamTab('${esc(t)}')">
          <span>${esc(LIVE_STREAM_TAB_LABELS[t])}</span>
          <span class="tk-tab-count">${tabCounts[t]}</span>
        </button>
      `;
    }).join('');

    const cardsMarkup = items.length === 0
      ? `<div class="vp-empty tk-empty">Nincs megjeleníthető hír a kiválasztott („${esc(LIVE_STREAM_TAB_LABELS[currentTab])}”) fülön.</div>`
      : items.map(item => {
          const safeUrl = escSafeUrl(item.link || item.url);
          const publisher = getPublisherName(item);
          const rawTime = item.publishedAt || item.observedAt || '';
          const timeStr = formatTime(rawTime) || 'friss';
          const topicKey = item.newsCategory || 'news_other';
          const topicLabel = NEWS_TOPIC_LABELS[topicKey] || 'Hír';
          const territoryLabel = getNewsTerritoryLabel(item);
          const isUrgent = item.newsCategory === 'news_hazard' || item.urgent === true;
          const canInspect = Boolean(item.id && !item.isLegacyGlobal);
          const relatedHtml = Array.isArray(item.relatedSources) && item.relatedSources.length > 0
            ? `<span class="vp-news-related">Kapcsolódó: ${esc(item.relatedSources.join(', '))}</span>`
            : '';

          const timeHhmm = formatHhmmBudapest(rawTime);
          return `
            <div class="tk-row-single${isUrgent ? ' urgent' : ''}"
                 role="button"
                 tabindex="0"
                 data-news-id="${esc(item.id || '')}"
                 ${canInspect ? `data-event-id="${esc(item.id)}"` : ''}
                 ${safeUrl ? `data-url="${safeUrl}"` : ''}
                 title="${esc(rawTime)} · ${esc(publisher)} · ${esc(item.title)}"
                 onclick="window.CrucixViewsPanel?.handleLiveItemClick(this, event)"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.CrucixViewsPanel?.handleLiveItemClick(this, event);}">
              <span class="tk-time-compact" title="${esc(rawTime)}">${esc(timeHhmm)}</span>
              <span class="tk-src-compact">${esc(publisher)}</span>
              <span class="tk-topic-compact vp-badge-topic-${esc(topicKey)}">${esc(topicLabel)}</span>
              <span class="tk-territory-compact">${esc(territoryLabel)}</span>
              <span class="tk-title-single">${isUrgent ? '<span class="urg">!</span>' : ''}${esc(item.title)}</span>
              ${safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="tk-ext-link" onclick="event.stopPropagation()" aria-label="Forráslink megnyitása">&#8599;</a>` : ''}
            </div>
          `;
        }).join('');

    return `
      <div class="tk-unified-panel" data-active-live-tab="${esc(currentTab)}">
        <div class="vp-newsfeed-disclaimer tk-disclaimer" role="note">
          <strong>Figyelem:</strong> Sajtó- és hatósági hírek; nem igazolt veszélyesemények.
        </div>
        <div class="tk-tablist" role="tablist" aria-label="Élő hírfolyam szűrőfülek">
          ${tabsMarkup}
        </div>
        <div class="vp-scroll-wrapper">
          <div class="tk-stream-list vp-scroll-region scroll-region"
               data-scroll-key="stream-${currentTab}"
               tabindex="0"
               role="region"
               aria-label="Élő hírfolyam (${esc(LIVE_STREAM_TAB_LABELS[currentTab])})"
               onscroll="window.CrucixViewsPanel?.updateMoreIndicator?.(this)">
            ${cardsMarkup}
          </div>
          <div class="vp-scroll-fade" aria-hidden="true" onclick="this.previousElementSibling?.scrollBy({top:140,behavior:'smooth'})">
            <span class="vp-scroll-fade-text"></span>
          </div>
        </div>
      </div>
    `;
  }

  function handleLiveItemClick(el, ev) {
    if (!el) return;
    const eventId = el.getAttribute('data-event-id');
    const url = el.getAttribute('data-url');
    if (eventId && typeof window.CrucixIntelligence?.openEvent === 'function') {
      window.CrucixIntelligence.openEvent(eventId);
      return;
    }
    if (url && /^https?:\/\//i.test(url)) {
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch {}
    }
  }

  function panelHtml(snapshot) {
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const existing = document.querySelector('.vp-unlocated-list');
      if (existing) saveScrollPosition(existing);
    }
    const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
    const staleEvents = Array.isArray(snapshot?.staleEvents) ? snapshot.staleEvents : [];
    const viewCounters = snapshot?.views?.[activeView] || {};

    // Filter events for the current active view (client only filters on server-provided views field)
    const inViewEvents = events.filter(e => e.views?.[activeView]?.inView === true && e.isPublisherPromo !== true);
    const inViewStale = staleEvents.filter(e => e.views?.[activeView]?.inView === true && e.isPublisherPromo !== true);

    // Group active events by category
    const categories = {};
    for (const event of inViewEvents) {
      const cat = event.views[activeView].category || 'unknownTerritory';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(event);
    }

    // Determine category display order based on current view
    let categoryOrder = [];
    if (activeView === VIEWS.LOCAL) {
      categoryOrder = ['confirmedLocal', 'keyConnection', 'needsReview', 'regionalAdvisories', 'unknownTerritory'];
    } else if (activeView === VIEWS.COUNTY) {
      categoryOrder = ['countyEvent', 'regionalAdvisories', 'confirmedLocal', 'keyConnection', 'needsReview', 'unknownTerritory'];
    } else if (activeView === VIEWS.NATIONAL) {
      categoryOrder = ['nationalEvent', 'countyEvent', 'confirmedLocal', 'keyConnection', 'needsReview', 'unknownTerritory'];
    } else {
      categoryOrder = ['globalEvent', 'nationalEvent', 'countyEvent', 'confirmedLocal', 'unknownTerritory'];
    }

    // Separate unlocated news events using explicit getViewNews accessor
    const viewNews = getViewNews(snapshot, activeView);
    const allCandidateNews = [...viewNews, ...inViewEvents.filter(e => e.kind === 'news' || e.source?.name?.includes('HAON'))];
    const seenNewsIds = new Set();
    const unlocatedNews = allCandidateNews.filter(e => {
      if (!e || seenNewsIds.has(e.id)) return false;
      seenNewsIds.add(e.id);
      return !hasCoordinates(e.lat, e.lon) && e.isPublisherPromo !== true;
    });

    // Render active categories
    let sectionsHtml = '';
    let renderedCount = 0;
    for (const cat of categoryOrder) {
      const items = categories[cat] || [];
      if (!items.length) continue;
      renderedCount += items.length;
      const catTitle = CATEGORY_LABELS[cat] || cat;
      const catIcon = window.CrucixIcons ? window.CrucixIcons.renderIcon(cat, { size: 18, className: 'vp-sec-cat-icon' }) : '';
      sectionsHtml += `
        <div class="vp-sec" data-cat="${esc(cat)}">
          <div class="vp-sec-head">
            <span class="vp-sec-title">
              ${catIcon}
              <span>${esc(catTitle)}</span>
            </span>
            <span class="vp-sec-badge">${items.length} db</span>
          </div>
          <div class="vp-sec-items">
            ${items.map(e => renderCard(e)).join('')}
          </div>
        </div>
      `;
    }

    // Empty state if no events in view
    if (renderedCount === 0) {
      sectionsHtml = `
        <div class="vp-empty">
          Nincs megerősített helyi esemény a vizsgált időszakban. Ellenőrizze a forrásfedettségi panelt az adatforrások állapotáért. Ez nem jelenti a kockázatok teljes hiányát.
        </div>
      `;
    }

    // Unlocated news strip (safe presentation without fake centroid)
    const dedupedUnlocated = deduplicateNewsItems(unlocatedNews);
    let unlocatedStripHtml = '';
    if (dedupedUnlocated.length > 0) {
      unlocatedStripHtml = `
        <div class="vp-unlocated-strip">
          <div class="vp-unlocated-head">
            <span>Koordináta nélküli hírek (térképi jelölő nélkül)</span>
            <span class="vp-sec-badge">${dedupedUnlocated.length} db</span>
          </div>
          <div class="vp-scroll-wrapper">
            <div class="vp-unlocated-list vp-scroll-region scroll-region"
                 data-scroll-key="unlocated"
                 tabindex="0"
                 role="region"
                 aria-label="Koordináta nélküli hírek"
                 onscroll="window.CrucixViewsPanel?.updateMoreIndicator?.(this)">
              ${dedupedUnlocated.map(n => {
                let relSuffix = '';
                if (Array.isArray(n.relatedSources) && n.relatedSources.length > 0) {
                  relSuffix = ` · Kapcsolódó: ${esc(n.relatedSources.join(', '))}`;
                } else if (Array.isArray(n.relatedCandidateSources) && n.relatedCandidateSources.length > 0) {
                  relSuffix = ` · (Kapcsolódó jelölt: ${esc(n.relatedCandidateSources.join(', '))})`;
                }
                return `
                <div class="vp-unlocated-item"
                     role="button"
                     tabindex="0"
                     onclick="window.CrucixIntelligence?.openEvent?.('${esc(n.id)}')"
                     onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.CrucixIntelligence?.openEvent?.('${esc(n.id)}');}">
                  <span>${esc(n.title)}</span>
                  <span style="color:#64748b">${esc(getPublisherName(n) || n.source?.name || '')}${relSuffix}</span>
                </div>
                `;
              }).join('')}
            </div>
            <div class="vp-scroll-fade" aria-hidden="true" onclick="this.previousElementSibling?.scrollBy({top:140,behavior:'smooth'})">
              <span class="vp-scroll-fade-text"></span>
            </div>
          </div>
        </div>
      `;
    }

    // Stale section by staleReason
    let staleHtml = '';
    if (inViewStale.length > 0) {
      const staleByReason = {};
      for (const s of inViewStale) {
        const r = s.staleReason || 'source_stale';
        if (!staleByReason[r]) staleByReason[r] = [];
        staleByReason[r].push(s);
      }

      const reasonOrder = ['provider_expired', 'source_stale', 'local_freshness_exceeded', 'source_error'];
      staleHtml = `
        <div class="vp-stale-container">
          <div class="vp-stale-title">Elavult / Lejárt események (${inViewStale.length} db)</div>
          ${reasonOrder.filter(r => staleByReason[r]?.length).map(reason => {
            const list = staleByReason[reason];
            return `
              <div class="vp-stale-group">
                <div class="vp-stale-group-head">
                  <span class="vp-badge-reason">${esc(STALE_REASON_LABELS[reason] || reason)}</span>
                  <span>(${list.length})</span>
                </div>
                ${list.map(e => renderCard(e, { isStale: true })).join('')}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const liveStreams = Array.isArray(snapshot?.liveStreams)
      ? snapshot.liveStreams
      : (Array.isArray(window.__CRUCIX_DATA__?.liveStreams) ? window.__CRUCIX_DATA__.liveStreams : []);
    const liveCount = liveStreams.length;

    const contentHtml = contentTab === 'live'
      ? `
        <div class="vp-live-companion">
          <div class="vp-live-companion-head">
            <span class="vp-live-companion-icon">📡</span>
            <span class="vp-live-companion-title">Élő videómód aktív</span>
          </div>
          <p class="vp-live-companion-desc">
            A 16:9 méretű élő adások és a kompakt forrásválasztó a középső munkaterületen látható.
          </p>
          <button type="button" class="vp-btn-back-news" onclick="window.CrucixViewsPanel?.setContentTab('news')">
            ← Vissza a hírfolyamhoz
          </button>
        </div>
      `
      : newsFeedHtml(snapshot);

    const todaySummaryHtml = (activeView === VIEWS.LOCAL && typeof window !== 'undefined' && window.CrucixTodayPanel?.renderTodayPanel)
      ? window.CrucixTodayPanel.renderTodayPanel(snapshot)
      : '';

    return `
      <div class="vp-panel" id="panel-territoryViews">
        <div class="vp-panel-head">
          <span class="vp-panel-title">${esc(VIEW_LABELS[activeView])} nézet</span>
          <span class="vp-panel-sub">Aktív: ${inViewEvents.length} | Elavult: ${inViewStale.length}</span>
        </div>
        ${todaySummaryHtml}
        ${sectionsHtml}
        ${unlocatedStripHtml}
        <div class="vp-section-nav" role="tablist" aria-label="Nézeti média és hírek">
          <button type="button" class="vp-sec-nav-tab active" role="tab" aria-selected="true">Hírfolyam</button>
        </div>
        ${contentHtml}
        ${staleHtml}
      </div>
    `;
  }

  const COVERAGE_STATUS_SORT_WEIGHT = Object.freeze({
    stale_error: 0,
    unconfigured: 1,
    disabled: 2,
    ok_empty: 3,
    offline_snapshot: 4,
    ok_data: 5
  });

  function coveragePanelHtml(snapshot) {
    const rawCoverage = snapshot?.coverage || {};
    const items = Array.isArray(rawCoverage)
      ? rawCoverage
      : Object.entries(rawCoverage).map(([k, v]) => ({
          sourceId: v?.sourceId || v?.name || (isNaN(k) ? k : undefined),
          ...(typeof v === 'object' && v !== null ? v : {})
        }));

    const sorted = [...items].sort((a, b) => {
      const sa = a?.status || 'unconfigured';
      const sb = b?.status || 'unconfigured';
      const wa = COVERAGE_STATUS_SORT_WEIGHT[sa] ?? 9;
      const wb = COVERAGE_STATUS_SORT_WEIGHT[sb] ?? 9;
      if (wa !== wb) return wa - wb;
      const na = String(a?.sourceName || a?.name || a?.sourceId || '');
      const nb = String(b?.sourceName || b?.name || b?.sourceId || '');
      return na.localeCompare(nb, 'hu');
    });

    const staleOrErrorCount = sorted.filter(r => r.status === 'stale_error' || r.status === 'error' || r.status === 'stale').length;
    const okDataCount = sorted.filter(r => r.status === 'ok_data' || r.status === 'ok').length;
    const okEmptyCount = sorted.filter(r => r.status === 'ok_empty').length;
    const unconfiguredCount = sorted.filter(r => r.status === 'unconfigured').length;
    const disabledCount = sorted.filter(r => r.status === 'disabled').length;
    const offlineCount = sorted.filter(r => r.status === 'offline_snapshot').length;

    if (!sorted.length) {
      return `
        <div class="coverage-panel g-panel">
          <div class="vp-panel-head sec-head">
            <span class="vp-panel-title">Forrásfedettség</span>
            <span class="badge">0 FORRÁS</span>
          </div>
          <div class="vp-empty">Nincs elérhető forrásfedettségi adat.</div>
        </div>
      `;
    }

    return `
      <div class="coverage-panel g-panel">
        <div class="vp-panel-head sec-head">
          <span class="vp-panel-title">Forrásfedettség</span>
          <span class="badge">${sorted.length} FORRÁS</span>
        </div>
        <div class="cov-breakdown-sub" style="font-family:var(--mono,monospace);font-size:9px;color:var(--dim,#888);padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.05);line-height:1.4">
          ${staleOrErrorCount > 0 ? `<span style="color:var(--warn,#f5a623);font-weight:600" title="Elavult vagy hibás források">${staleOrErrorCount} hibás/elavult</span> · ` : ''}
          ${okDataCount > 0 ? `<span style="color:var(--accent,#64f0c8)" title="Aktív adattal rendelkező források">${okDataCount} aktív</span> · ` : ''}
          ${okEmptyCount > 0 ? `<span title="Eseménytelen források">${okEmptyCount} eseménytelen</span> · ` : ''}
          ${unconfiguredCount > 0 ? `<span title="Nincs forrás konfigurálva">${unconfiguredCount} konfigurálatlan</span> · ` : ''}
          ${disabledCount > 0 ? `<span title="Letiltott források">${disabledCount} letiltva</span> · ` : ''}
          ${offlineCount > 0 ? `<span title="Offline pillanatkép">${offlineCount} pillanatkép</span> · ` : ''}
          <span style="color:var(--accent,#64f0c8);font-weight:700" title="Összes felügyelt forrás">${sorted.length} összesen</span>
        </div>
        <div class="cov-list vp-scroll-region scroll-region" tabindex="0" role="region" aria-label="Forrásfedettség lista" style="max-height:200px;overflow-y:auto;overscroll-behavior:contain">
          ${sorted.map((row, idx) => {
            const srcName = row.sourceName || row.name || row.sourceId || row.source || `Forrás #${idx + 1}`;
            const statusKey = row.status || 'unconfigured';
            const statusLabel = row.statusLabel || COVERAGE_LABELS[statusKey] || statusKey;
            const originLabel = row.origin === 'live' ? 'Élő lekérés ebben a folyamatban' : 'Offline pillanatkép';
            const originClass = row.origin === 'live' ? 'cov-origin-live' : 'cov-origin-snapshot';
            const lastUp = row.lastUpdated ? formatTime(row.lastUpdated) : '—';
            const countText = Number.isFinite(row.itemCount) ? ` · ${row.itemCount} tétel` : '';
            const errorTitle = row.error ? ` title="${esc(row.error)}"` : '';
            return `
              <div class="cov-item"${errorTitle}>
                <div class="cov-left">
                  <span class="cov-name">${esc(srcName)}</span>
                  <span class="cov-origin ${originClass}">[${esc(originLabel)}]</span>
                  <span class="cov-last-up" style="font-size:9px;color:var(--dim,#888);margin-left:4px">${esc(lastUp)}${countText}</span>
                </div>
                <div class="cov-right">
                  <span class="cov-status-badge cov-status-${esc(statusKey)}">${esc(statusLabel)}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function updateMoreIndicator(listEl) {
    if (!listEl) return;
    saveScrollPosition(listEl);
    const wrapper = listEl.closest ? listEl.closest('.vp-scroll-wrapper') : listEl.parentElement;
    if (!wrapper) return;
    const fade = wrapper.querySelector ? wrapper.querySelector('.vp-scroll-fade') : null;
    const textEl = wrapper.querySelector ? wrapper.querySelector('.vp-scroll-fade-text') : null;
    if (!fade || !textEl) return;

    const children = listEl.children || [];
    const total = children.length;
    if (total <= 1) {
      if (fade.classList) fade.classList.remove('visible');
      return;
    }

    const scrollHeight = listEl.scrollHeight || 0;
    const scrollTop = listEl.scrollTop || 0;
    const clientHeight = listEl.clientHeight || 0;

    // Items below current fold
    const bottomFold = scrollTop + clientHeight - 4;
    let remaining = 0;
    for (let i = 0; i < total; i++) {
      const child = children[i];
      if ((child.offsetTop || 0) + 6 > bottomFold) {
        remaining = total - i;
        break;
      }
    }

    // Fallback if offsetTop is unavailable (e.g. in JSDOM / node:test environments)
    if (remaining === 0 && scrollHeight > clientHeight && (scrollHeight - scrollTop - clientHeight > 4)) {
      const approxItemHeight = scrollHeight / total;
      remaining = Math.max(1, Math.round((scrollHeight - scrollTop - clientHeight) / approxItemHeight));
    }

    if (remaining > 0 && (scrollHeight - scrollTop - clientHeight > 4 || (scrollHeight > clientHeight && scrollTop === 0))) {
      textEl.textContent = `▾ még ${remaining} hír lentebb`;
      if (fade.classList) fade.classList.add('visible');
    } else {
      if (fade.classList) fade.classList.remove('visible');
    }
  }

  function initScrollIndicators(root) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const r = root || document;
    if (!r.querySelectorAll) return;
    const lists = r.querySelectorAll('.vp-unlocated-list, .tk-stream-list');
    lists.forEach(list => {
      const key = getScrollKey(list);
      if (key && scrollPositions.has(key)) {
        const saved = scrollPositions.get(key);
        if (typeof saved === 'number' && saved > 0) {
          list.scrollTop = saved;
        }
      }
      updateMoreIndicator(list);
    });
  }

  function bindAutoScrollObserver() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const target = document.body || document.documentElement;
    if (!target) return;
    let scheduled = false;
    const mo = new MutationObserver(() => {
      if (!scheduled) {
        scheduled = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            scheduled = false;
            initScrollIndicators();
          });
        } else {
          scheduled = false;
          initScrollIndicators();
        }
      }
    });
    mo.observe(target, { childList: true, subtree: true });
  }

  if (typeof window !== 'undefined') {
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', () => initScrollIndicators());
    }
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        if (typeof document.addEventListener === 'function') {
          document.addEventListener('DOMContentLoaded', bindAutoScrollObserver);
        }
      } else {
        bindAutoScrollObserver();
      }
    }
  }

  window.CrucixViewsPanel = Object.freeze({
    VIEWS,
    VIEW_LABELS,
    LIVE_STREAM_TABS,
    LIVE_STREAM_TAB_LABELS,
    CATEGORY_LABELS,
    COVERAGE_LABELS,
    NEWS_TOPIC_LABELS,
    getView: getActiveView,
    getActiveView,
    setView: setActiveView,
    onChange,
    mountSelector,
    panelHtml,
    coveragePanelHtml,
    renderNewsCard,
    newsFeedHtml,
    showMoreNews,
    getVisibleNewsLimit,
    resetVisibleNewsLimit,
    getViewNews,
    setNewsFilter,
    getNewsFilter,
    resetNewsFilter,
    setNewsScope,
    getNewsScope,
    resetNewsScope,
    setContentTab,
    getContentTab,
    getLiveStreamTab,
    setLiveStreamTab,
    getLiveStreamItems,
    liveStreamHtml,
    handleLiveItemClick,
    isNonCriticalNews,
    isImportantNews,
    getTerritoryMapRegion,
    getTerritoryBounds,
    deduplicateNewsItems,
    normalizeNewsTitle,
    updateMoreIndicator,
    initScrollIndicators,
    getScrollPosition: (key) => scrollPositions.get(key) || 0,
    setScrollPosition: (key, pos) => scrollPositions.set(key, pos),
    saveScrollPositions: saveAllScrollPositions,
    restoreScrollPositions: initScrollIndicators,
    resetScrollPositions
  });

})(window, document);
