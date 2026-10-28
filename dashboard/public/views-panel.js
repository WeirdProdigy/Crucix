(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'crucix_territory_view_v1';
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
    [VIEWS.GLOBAL]: 'Világ'
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

  let activeView = readSavedView();
  let changeListeners = [];

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

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
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

  function hasCoordinates(lat, lon) {
    return typeof lat === 'number' && typeof lon === 'number' &&
      Number.isFinite(lat) && Number.isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  function getActiveView() {
    return activeView;
  }

  function setActiveView(view, notify = true) {
    if (!Object.values(VIEWS).includes(view)) return;
    activeView = view;
    saveView(view);
    updateSelectorUI();
    if (notify) {
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
    const snapshot = options.getSnapshot ? options.getSnapshot() : (window.D || {});
    const counts = snapshot?.views || {};

    container.innerHTML = `
      <div class="vp-tablist" role="tablist" aria-label="Területi nézetválasztó">
        <span class="vp-tab-label" aria-hidden="true">Nézet:</span>
        ${VIEW_ORDER.map(view => {
          const isSelected = view === activeView;
          const count = counts[view]?.uniqueEvents ?? counts[view]?.totalEvents ?? '';
          return `
            <button type="button"
                    class="vp-tab"
                    role="tab"
                    id="vp-tab-${view}"
                    data-view="${view}"
                    aria-selected="${isSelected}"
                    aria-controls="panel-territoryViews"
                    tabindex="${isSelected ? '0' : '-1'}">
              <span>${esc(VIEW_LABELS[view])}</span>
              ${count !== '' ? `<span class="vp-count-badge">${count}</span>` : ''}
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

    return `
      <div class="vp-card"
           role="button"
           tabindex="0"
           data-event-id="${esc(event.id)}"
           onclick="window.CrucixIntelligence?.openEvent?.('${esc(event.id)}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.CrucixIntelligence?.openEvent?.('${esc(event.id)}');}">
        <div class="vp-card-top">
          <div class="vp-card-title">${esc(event.title)}</div>
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

  function panelHtml(snapshot) {
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

    // Separate unlocated news events
    const unlocatedNews = inViewEvents.filter(e => (e.kind === 'news' || e.source?.name?.includes('HAON')) && !hasCoordinates(e.lat, e.lon) && e.isPublisherPromo !== true);

    // Render active categories
    let sectionsHtml = '';
    let renderedCount = 0;
    for (const cat of categoryOrder) {
      const items = categories[cat] || [];
      if (!items.length) continue;
      renderedCount += items.length;
      const catTitle = CATEGORY_LABELS[cat] || cat;
      sectionsHtml += `
        <div class="vp-sec" data-cat="${esc(cat)}">
          <div class="vp-sec-head">
            <span class="vp-sec-title">
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
    let unlocatedStripHtml = '';
    if (unlocatedNews.length > 0) {
      unlocatedStripHtml = `
        <div class="vp-unlocated-strip">
          <div class="vp-unlocated-head">Koordináta nélküli hírek (térképi jelölő nélkül)</div>
          ${unlocatedNews.map(n => `
            <div class="vp-unlocated-item"
                 role="button"
                 tabindex="0"
                 onclick="window.CrucixIntelligence?.openEvent?.('${esc(n.id)}')"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.CrucixIntelligence?.openEvent?.('${esc(n.id)}');}">
              <span>${esc(n.title)}</span>
              <span style="color:#64748b">${esc(n.source?.name || '')}</span>
            </div>
          `).join('')}
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

    return `
      <div class="vp-panel" id="panel-territoryViews">
        <div class="vp-panel-head">
          <span class="vp-panel-title">${esc(VIEW_LABELS[activeView])} nézet</span>
          <span class="vp-panel-sub">Aktív: ${inViewEvents.length} | Elavult: ${inViewStale.length}</span>
        </div>
        ${sectionsHtml}
        ${unlocatedStripHtml}
        ${staleHtml}
      </div>
    `;
  }

  function coveragePanelHtml(snapshot) {
    const coverage = snapshot?.coverage || {};
    const sources = Object.keys(coverage);

    if (!sources.length) {
      return `
        <div class="coverage-panel">
          <div class="vp-panel-head">
            <span class="vp-panel-title">Forrásfedettség</span>
          </div>
          <div class="vp-empty">Nincs elérhető forrásfedettségi adat.</div>
        </div>
      `;
    }

    return `
      <div class="coverage-panel">
        <div class="vp-panel-head">
          <span class="vp-panel-title">Forrásfedettség</span>
          <span class="vp-panel-sub">${sources.length} forrás felügyelve</span>
        </div>
        <div class="cov-list">
          ${sources.map(src => {
            const row = coverage[src] || {};
            const statusKey = row.status || 'unconfigured';
            const statusLabel = COVERAGE_LABELS[statusKey] || statusKey;
            const originLabel = row.origin === 'live' ? 'Élő lekérés ebben a folyamatban' : 'Offline pillanatkép';
            const originClass = row.origin === 'live' ? 'cov-origin-live' : 'cov-origin-snapshot';
            return `
              <div class="cov-item">
                <div class="cov-left">
                  <span class="cov-name">${esc(src)}</span>
                  <span class="cov-origin ${originClass}">[${esc(originLabel)}]</span>
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

  window.CrucixViewsPanel = Object.freeze({
    VIEWS,
    VIEW_LABELS,
    CATEGORY_LABELS,
    COVERAGE_LABELS,
    getView: getActiveView,
    getActiveView,
    setView: setActiveView,
    onChange,
    mountSelector,
    panelHtml,
    coveragePanelHtml
  });

})(window, document);
