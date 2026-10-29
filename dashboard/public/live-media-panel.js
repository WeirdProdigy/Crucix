/**
 * dashboard/public/live-media-panel.js
 *
 * Crucix "Élő" Panel: Hivatalos nyilvános híradók és turisztikai/meteorológiai webkamerák.
 *
 * Alapelvek:
 * 1. Szigorú "No Telemetry": Harmadik fél (YouTube/Google) hálózati kérése CSAK kifejezett
 *    felhasználói kattintásra ("Click-to-Load") indulhat el.
 * 2. YouTube-nocookie: Kizárólag youtube-nocookie.com beágyazás engedélyezett.
 * 3. Egyetlen futó lejátszó: Egyszerre legfeljebb 1 iframe létezhet; más stream indításakor,
 *    fülváltáskor vagy háttérbe kerüléskor az előző azonnal leáll és megsemmisül.
 * 4. XSS és azonosító védelem: Minden szöveg mező szigorúan escape-elve jelenik meg,
 *    az URL-ek kizárólag érvényes 11 karakteres YouTube videóazonosítókból épülnek fel.
 * 5. Megkerülés-mentesség: Nincs proxy, relay vagy fejléc-hamisítás.
 */

(function (window, document) {
  'use strict';

  const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

  const REGION_LABELS = Object.freeze({
    local: 'Helyi',
    county: 'Hajdú-Bihar',
    national: 'Magyarország',
    global: 'Világ'
  });

  const TYPE_LABELS = Object.freeze({
    news: 'Híradó',
    webcam: 'Webkamera'
  });

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- State ---
  let typeFilter = 'all';     // 'all' | 'news' | 'webcam'
  let regionFilter = 'all';   // 'all' | 'local' | 'county' | 'national' | 'global'
  let viewMode = 'single';    // 'single' | 'grid'
  let activeStreamId = null;  // currently playing stream ID or null
  let errorStreams = new Set();
  let retryBackoff = new Map(); // streamId -> backoff seconds
  let changeListeners = [];

  function isMobileViewport() {
    if (typeof window === 'undefined') return false;
    return (window.innerWidth || 1024) <= 768;
  }

  function getEffectiveViewMode() {
    return isMobileViewport() ? 'single' : viewMode;
  }

  function notifyChange() {
    for (const fn of changeListeners) {
      try { fn(); } catch {}
    }
  }

  function setTypeFilter(type) {
    if (type === 'all' || type === 'news' || type === 'webcam') {
      typeFilter = type;
      notifyChange();
    }
  }

  function getTypeFilter() {
    return typeFilter;
  }

  function setRegionFilter(region) {
    if (region === 'all' || ['local', 'county', 'national', 'global'].includes(region)) {
      regionFilter = region;
      notifyChange();
    }
  }

  function getRegionFilter() {
    return regionFilter;
  }

  function setViewMode(mode) {
    if (mode === 'single' || mode === 'grid') {
      viewMode = mode;
      notifyChange();
    }
  }

  function getViewMode() {
    return getEffectiveViewMode();
  }

  function getActiveStreamId() {
    return activeStreamId;
  }

  function playStream(streamId) {
    if (typeof streamId !== 'string') return;
    activeStreamId = streamId;
    errorStreams.delete(streamId);
    notifyChange();
  }

  function stopStream() {
    if (activeStreamId !== null) {
      activeStreamId = null;
      notifyChange();
    }
  }

  function markStreamError(streamId) {
    if (typeof streamId !== 'string') return;
    errorStreams.add(streamId);
    if (activeStreamId === streamId) {
      activeStreamId = null;
    }
    const current = retryBackoff.get(streamId) || 5;
    retryBackoff.set(streamId, Math.min(current * 2, 60));
    notifyChange();
  }

  function retryStream(streamId) {
    if (typeof streamId !== 'string') return;
    errorStreams.delete(streamId);
    playStream(streamId);
  }

  function onChange(fn) {
    if (typeof fn === 'function') {
      changeListeners.push(fn);
    }
  }

  // --- Background Visibility Teardown ---
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && activeStreamId !== null) {
        stopStream();
      }
    });
  }

  function buildSafeEmbedUrl(videoId) {
    if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) return null;
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1`;
  }

  function buildSafeWatchUrl(videoId) {
    if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) return null;
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  /**
   * Renders an individual stream card.
   */
  function renderStreamCard(stream) {
    if (!stream || !stream.id) return '';
    const isPlaying = activeStreamId === stream.id;
    const isError = errorStreams.has(stream.id);
    const isValidId = YOUTUBE_VIDEO_ID_REGEX.test(stream.videoId || '');

    const regionLabel = REGION_LABELS[stream.region] || stream.region;
    const typeLabel = TYPE_LABELS[stream.type] || stream.type;
    const langCode = (stream.language || 'hu').toUpperCase();

    let mediaAreaHtml = '';

    if (!isValidId || isError) {
      const backoffSec = retryBackoff.get(stream.id) || 5;
      const watchUrl = isValidId ? buildSafeWatchUrl(stream.videoId) : null;
      mediaAreaHtml = `
        <div class="lm-error-box" role="alert">
          <div class="lm-error-icon">⚠</div>
          <div class="lm-error-text">A közvetítés jelenleg nem ágyazható be vagy nem érhető el.</div>
          <div class="lm-error-actions">
            ${watchUrl ? `<a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">Megnyitás a forráson (YouTube) ↗</a>` : ''}
            <button type="button" class="lm-btn lm-btn-retry" onclick="window.CrucixLiveMedia?.retryStream('${esc(stream.id)}')">Újrapróbálás (${backoffSec}s)</button>
          </div>
        </div>
      `;
    } else if (isPlaying) {
      const embedUrl = buildSafeEmbedUrl(stream.videoId);
      const watchUrl = buildSafeWatchUrl(stream.videoId);
      mediaAreaHtml = `
        <div class="lm-player-box">
          <iframe
            class="lm-iframe"
            src="${esc(embedUrl)}"
            title="${esc(stream.name)}"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            sandbox="allow-scripts allow-same-origin allow-presentation"
            loading="lazy">
          </iframe>
          <div class="lm-player-bar">
            <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.stopStream()">■ Leállítás</button>
            <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Forrás ↗</a>
            <button type="button" class="lm-link-error" onclick="window.CrucixLiveMedia?.markStreamError('${esc(stream.id)}')">Nem tölt be?</button>
          </div>
        </div>
      `;
    } else {
      mediaAreaHtml = `
        <div class="lm-placeholder-box">
          <div class="lm-placeholder-icon">${stream.type === 'news' ? '📺' : '📹'}</div>
          <div class="lm-placeholder-title">${esc(stream.provider)}</div>
          <div class="lm-placeholder-privacy">Adatvédelmi mód: Kattintásra töltődik be a közvetítés (youtube-nocookie.com). Harmadik fél felé telemetria nincs.</div>
          <button type="button" class="lm-btn lm-btn-play" onclick="window.CrucixLiveMedia?.playStream('${esc(stream.id)}')">
            ▶ Közvetítés indítása
          </button>
        </div>
      `;
    }

    return `
      <article class="lm-card${isPlaying ? ' playing' : ''}${isError ? ' error' : ''}" id="lm-card-${esc(stream.id)}" data-stream-id="${esc(stream.id)}">
        <div class="lm-card-head">
          <div class="lm-card-title-row">
            <span class="lm-card-type-badge lm-type-${esc(stream.type)}">${esc(typeLabel)}</span>
            <span class="lm-card-region-badge">${esc(regionLabel)}</span>
            <span class="lm-card-lang-badge">${esc(langCode)}</span>
            <span class="lm-card-title">${esc(stream.name)}</span>
          </div>
          <div class="lm-card-provider">${esc(stream.provider)}</div>
        </div>
        <div class="lm-card-body">
          ${mediaAreaHtml}
        </div>
        ${stream.notes ? `<div class="lm-card-footer"><span class="lm-card-notes">${esc(stream.notes)}</span></div>` : ''}
      </article>
    `;
  }

  /**
   * Renders the complete "Élő" panel HTML.
   */
  function panelHtml(snapshot) {
    const rawStreams = Array.isArray(snapshot?.liveStreams)
      ? snapshot.liveStreams
      : (Array.isArray(window.__CRUCIX_DATA__?.liveStreams) ? window.__CRUCIX_DATA__.liveStreams : []);

    // Filter by type and region
    const filtered = rawStreams.filter(s => {
      if (typeFilter !== 'all' && s.type !== typeFilter) return false;
      if (regionFilter !== 'all' && s.region !== regionFilter) return false;
      return true;
    });

    const isMobile = isMobileViewport();
    const effectiveMode = isMobile ? 'single' : viewMode;

    // Type filter buttons
    const typeButtons = [
      { id: 'all', label: 'Mind' },
      { id: 'news', label: 'Híradók' },
      { id: 'webcam', label: 'Webkamerák' }
    ].map(b => `
      <button type="button" class="lm-filter-btn${typeFilter === b.id ? ' active' : ''}" onclick="window.CrucixLiveMedia?.setTypeFilter('${b.id}')">
        ${esc(b.label)}
      </button>
    `).join('');

    // Region filter buttons
    const regionButtons = [
      { id: 'all', label: 'Mind' },
      { id: 'local', label: 'Helyi' },
      { id: 'county', label: 'Hajdú-Bihar' },
      { id: 'national', label: 'Magyarország' },
      { id: 'global', label: 'Világ' }
    ].map(b => `
      <button type="button" class="lm-filter-btn${regionFilter === b.id ? ' active' : ''}" onclick="window.CrucixLiveMedia?.setRegionFilter('${b.id}')">
        ${esc(b.label)}
      </button>
    `).join('');

    // View mode toggle (hidden / disabled on mobile)
    const modeButtons = `
      <div class="lm-mode-toggle" role="group" aria-label="Nézetmód"${isMobile ? ' style="display:none;"' : ''}>
        <button type="button" class="lm-mode-btn${effectiveMode === 'single' ? ' active' : ''}" onclick="window.CrucixLiveMedia?.setViewMode('single')" title="Egynézet">Egynézet</button>
        <button type="button" class="lm-mode-btn${effectiveMode === 'grid' ? ' active' : ''}" onclick="window.CrucixLiveMedia?.setViewMode('grid')" title="Rács">Rács</button>
      </div>
    `;

    // Cards list
    let cardsContent = '';
    if (filtered.length === 0) {
      cardsContent = `
        <div class="lm-empty-state">
          <div class="lm-empty-icon">📡</div>
          <div class="lm-empty-text">Nincs a kiválasztott szűrőknek megfelelő élő közvetítés.</div>
        </div>
      `;
    } else {
      cardsContent = filtered.map(renderStreamCard).join('');
    }

    return `
      <div class="lm-panel-container" id="lm-panel">
        <div class="lm-head">
          <div class="lm-title-wrap">
            <span class="lm-title">Élő adások és Webkamerák</span>
            <span class="lm-count-badge">${filtered.length} stream</span>
          </div>
          ${modeButtons}
        </div>

        <div class="lm-controls-bar">
          <div class="lm-filter-group" role="group" aria-label="Típus szűrő">
            <span class="lm-filter-label">Típus:</span>
            ${typeButtons}
          </div>
          <div class="lm-filter-group" role="group" aria-label="Régió szűrő">
            <span class="lm-filter-label">Régió:</span>
            ${regionButtons}
          </div>
        </div>

        <div class="lm-disclaimer-notice" role="note">
          <strong>Adatvédelmi garancia:</strong> Hivatalos nyilvános közvetítések. Külső hálózati forrás (youtube-nocookie.com) kizárólag a gombra kattintva töltődik be; nyomkövetés és telemetria nélkül.
        </div>

        <div class="lm-stream-grid ${effectiveMode === 'grid' ? 'layout-grid' : 'layout-single'}">
          ${cardsContent}
        </div>
      </div>
    `;
  }

  // --- Export on Window ---
  window.CrucixLiveMedia = Object.freeze({
    panelHtml,
    renderStreamCard,
    setTypeFilter,
    getTypeFilter,
    setRegionFilter,
    getRegionFilter,
    setViewMode,
    getViewMode,
    getActiveStreamId,
    playStream,
    stopStream,
    markStreamError,
    retryStream,
    onChange
  });

})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
