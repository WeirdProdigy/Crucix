/**
 * dashboard/public/live-media-panel.js
 *
 * Crucix "Élő" Videónézet (World Monitor stílusú központi munkaterület):
 * Hivatalos nyilvános híradók és intézményi/meteorológiai webkamerák.
 *
 * Alapelvek:
 * 1. Click-to-Load: Alapállapotban 0 aktív lejátszó. Külső videószolgáltatói kapcsolat
 *    (youtube-nocookie.com) kizárólag kifejezett felhasználói kattintásra indul el;
 *    betöltés előtt nincs automatikus külső előnézeti kép vagy rejtett preload.
 * 2. Adatvédelmi tájékoztatás: Betöltés előtt pontos tájékoztatás jelenik meg:
 *    „A közvetítés indítása kapcsolatot létesít a videószolgáltatóval.”
 * 3. Egynézet és 2×2 Rács: Egynézetben legfeljebb 1, 2×2 rácsban legfeljebb 4 egyidejű,
 *    felhasználó által indított 16:9 lejátszó futhat. Mobilon (<= 768px) egynézet érvényesül.
 * 4. DOM-megőrzés: Szűrőváltás (típus, régió, keresés), másik slot indítása vagy háttérbeli
 *    dashboard-frissítés nem rombolja le a már futó <iframe> példányokat.
 * 5. Külső oldalon nézhető források elkülönítése: A nem beágyazható (link-only) kamerák és
 *    oldalak külön „Külső oldalon nézhető” csoportban jelennek meg, külön jelezve a
 *    forrásoldali elérhetőséget/élő állapotot és a beágyazhatóságot.
 * 6. Szigorúan magáncélú, saját, egyfelhasználós használat (Időkép ÁSZF 3. és 10. pont):
 *    - A Crucix futó példánya privát, nem nyilvános, harmadik fél nem éri el (kizárólag saját
 *      helyi hálózatán LAN-on fut), és más médiacsatornán semmilyen formában nem teszi közzé a kamerákat.
 *    - A Crucix szervere a kamerák képeit NEM tölti le, nem tárolja elektronikusan, nem proxyzza és
 *      nem dolgozza fel (megfelelés az ÁSZF 3. pontjának: „Tilos a weboldalon megjelenő tartalmak vagy azok
 *      bármely részletének letöltése, elektronikus tárolása, feldolgozása és értékesítése...”).
 *    - A képmegjelenítés kizárólag a végfelhasználó saját böngészőjében fut közvetlen <img> lekérésként,
 *      a felhasználó kifejezett kattintására (Click-to-Load), átmeneti memóriabeli megjelenítésként.
 *    - Szigorúan tilos a tartalmak más médiacsatornán való közzététele (ÁSZF 10. pont: „Szigorúan tilos továbbá
 *      ezeket a tartalmakat más médiacsatornán közzétenni...”).
 *    - Az ÁSZF 10. pontja szerinti „Elvihető tartalmak” kivétel kizárólag az adott aloldal térképeire/elemeire
 *      vonatkozik forrásmegjelöléssel és linkkel; a webkamerák képeire ez a kivétel nem terjed ki.
 *    - Hatályosság: A vizsgált ÁSZF az oldalon megjelölt állapot szerint 2021. március 17-től hatályos
 *      („Hatályos 2021.03.17”); az Időkép fenntartja a jogot a feltételek egyoldalú módosítására.
 *    - Jogilag nem rendezett státusz: Az automatizált periodikus (1 perces) böngészőoldali frissítés és a közvetlen
 *      cam.idokep.hu mélyhivatkozás az ÁSZF alapján jogilag nem rendezett, ezért az Időkép kifejezett írásbeli
 *      hozzájárulásától függ (nem állítható, hogy az ÁSZF ezt megengedi).
 *    - Hálózati védelmi kapu (Guardrail): A közvetlen kamerakép-betöltő felület kizárólag privát hálózatról
 *      (localhost, 127.0.0.1, ::1, 192.168.*, 10.*, 172.16-31.*, 100.64.0.0/10, *.local, IPv6 ULA fc00::/7,
 *      IPv6 link-local fe80::/10, valamint az opcionális CRUCIX_PRIVATE_HOSTS lista) érhető el; egyéb hosztnév
 *      esetén a felület rejtve tartja a kamerákat és csak külső szolgáltatói linket jelenít meg a magáncélú
 *      használat védelmében.
 * 7. Windy Embed Widget (Csapadéktérkép) és használati feltételek (Windyty, SE):
 *    - Hivatalos forrás: Windyty, SE (Praha, Csehország) – General Terms of Use of Windy Services
 *      (Hatályos: 2020. december 17., legutóbbi frissítés: 2023. szeptember 1.).
 *    - „Windy and Webcam embeddable widget” rendelkezés: „Embeddable widgets are intended for media use and are
 *      available at windy.com/widgets and via the webcam detail and Share button. The Windy logo must be present
 *      and clickable (leading to the Windy Website), and they are not allowed to be used by weather apps and other
 *      commercial websites.”
 *    - „Free and Paid Services” rendelkezés: „Free Services are intended to be used by private persons only. All other
 *      institutions are demanded to use the Paid Services.”
 *    - Megfelelés a Crucixban: Privát magánszemély személyes otthoni felülete zárt LAN környezetben (192.168.1.81:3117);
 *      nem nyilvános és nem kereskedelmi időjárási app. Kizárólag a hivatalos embed.windy.com generált iframe-et használja,
 *      API-kulcsos szolgáltatás (Map Forecast API, Webcams API) nincs használatban. A Windy logó és forráslink megmarad és
 *      kattintható.
 *    - Click-to-Load elv: Alapállapotban 0 iframe és 0 hálózati kérés. Az iframe kizárólag a „🗺 Windy csapadéktérkép betöltése”
 *      gombra kattintva jön létre a böngésző memóriájában.
 *    - Bezárás gomb: Teljes leállítás és iframe-eltávolítás src nélkül. Lapelhagyáskor nem indul újratöltés.
 *    - Hálózati védelmi kapu: Nem privát hoszton a betöltő gomb rejtett és a betöltés no-op; csak a külső link látható.
 *    - Vizuális kiegészítő disclaimer: „Nem hivatalos előrejelzés; hivatalos forrás: HungaroMet”.
 */

(function (window, document) {
  'use strict';

  const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
  const PRIVACY_NOTICE_TEXT = 'A közvetítés indítása kapcsolatot létesít a videószolgáltatóval.';
  const CAMERA_PRIVACY_NOTICE_TEXT = 'A kép betöltése kapcsolatot létesít az Időképpel; a Crucix nem tárolja.';
  const CAMERA_REFRESH_INTERVAL_MS = 60000;
  const CAMERA_ERROR_BACKOFF_MS = 300000;
  const WINDY_PRIVACY_NOTICE_TEXT = 'A betöltés kapcsolatot létesít a Windy.com szervereivel, és a Windy a böngésző helyi tárolóját használhatja; a Crucix nem tárolja az adatot.';
  const WINDY_DISCLAIMER_TEXT = 'Nem hivatalos előrejelzés; hivatalos forrás: HungaroMet';

  const REGION_LABELS = Object.freeze({
    local: 'Helyi',
    county: 'Hajdú-Bihar',
    national: 'Magyarország',
    global: 'Világ'
  });

  const TYPE_LABELS = Object.freeze({
    news: 'Híradó',
    webcam: 'Kamera',
    directory: 'Katalógus',
    map: 'Térkép'
  });

  const BACKGROUND_PLAYBACK_PREF_KEY = 'crucix.liveMedia.background.v1';

  function readBackgroundPlaybackPreference() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(BACKGROUND_PLAYBACK_PREF_KEY) === 'true';
      }
    } catch {}
    return false;
  }

  function saveBackgroundPlaybackPreference(val) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(BACKGROUND_PLAYBACK_PREF_KEY, val ? 'true' : 'false');
      }
    } catch {}
  }

  let allowBackgroundPlayback = readBackgroundPlaybackPreference();

  function setAllowBackgroundPlayback(val) {
    allowBackgroundPlayback = Boolean(val);
    saveBackgroundPlaybackPreference(allowBackgroundPlayback);
    notifyChange();
  }

  function getAllowBackgroundPlayback() {
    return allowBackgroundPlayback;
  }

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
  let typeFilter = 'all';         // 'all' | 'news' | 'webcam' | 'directory'
  let regionFilter = 'all';       // 'all' | 'local' | 'county' | 'national' | 'global'
  let searchQuery = '';           // source name filter
  let viewMode = 'single';        // 'single' | 'grid'
  let activeStreamIds = [];       // array of active stream IDs (max 1 in single, max 4 in grid)
  let streamAudioState = new Map(); // streamId -> { muted: boolean, volume: number }
  let errorStreams = new Set();
  let retryBackoff = new Map();   // streamId -> backoff seconds
  let changeListeners = [];
  let lastSnapshot = null;
  let activeCameraIds = new Set();
  let cameraErrorStates = new Map();
  let cameraTimers = new Map();
  let activeEmbedIds = new Set();

  function clearCameraTimer(streamId) {
    if (cameraTimers.has(streamId)) {
      clearInterval(cameraTimers.get(streamId));
      cameraTimers.delete(streamId);
    }
  }

  function clearAllCameraTimers() {
    for (const [, timer] of cameraTimers.entries()) {
      clearInterval(timer);
    }
    cameraTimers.clear();
  }

  function buildCameraImageUrl(baseUrl) {
    if (!baseUrl) return '';
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}t=${Date.now()}`;
  }

  function refreshCameraDomImage(streamId, imageUrl) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const img = document.getElementById(`lm-camera-img-${streamId}`);
    if (img && imageUrl) {
      img.src = buildCameraImageUrl(imageUrl);
    }
  }

  function startCameraTimer(streamId, imageUrl) {
    clearCameraTimer(streamId);
    if (typeof window === 'undefined' || typeof window.setInterval !== 'function') return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      if (cameraErrorStates.has(streamId)) {
        clearCameraTimer(streamId);
        return;
      }
      refreshCameraDomImage(streamId, imageUrl);
    }, CAMERA_REFRESH_INTERVAL_MS);
    cameraTimers.set(streamId, timer);
  }

  /**
   * Ellenőrzi, hogy a felület helyi loopbackről vagy szabványos privát hálózatról fut-e.
   * Kizárólag magánhálózaton engedélyezett a közvetlen böngészőoldali kamerabetöltés (Időkép ÁSZF
   * 10. pont szerinti szigorúan magáncélú, saját, egyfelhasználós használat védelmében).
   *
   * Támogatott címek / tartományok:
   * - Loopback: localhost, 127.0.0.1, ::1, [::1], *.localhost
   * - mDNS / helyi tartomány: *.local, local
   * - Privát C osztály (RFC 1918): 192.168.0.0/16
   * - Privát A osztály (RFC 1918): 10.0.0.0/8
   * - Privát B osztály (RFC 1918): 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
   * - Shared Address / CGNAT / Tailscale (RFC 6598): 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
   * - IPv6 ULA (RFC 4193): fc00::/7 (fc00: - fdff:)
   * - IPv6 Link-Local (RFC 4291): fe80::/10 (fe80: - febf:)
   * - Opcionális CRUCIX_PRIVATE_HOSTS lista (vesszővel elválasztott egyedi engedélyezett nevek)
   *
   * Alapértelmezetten szigorú: bármely ismeretlen vagy nyilvános cím esetén false értéket ad.
   *
   * @param {string} [hostname] - Opcionális hosztnév teszteléshez vagy felülbíráláshoz
   * @param {string|string[]} [customAllowedHosts] - Opcionális extra engedélyezett privát hosztnevek
   * @returns {boolean}
   */
  function isPrivateOrLocalHost(hostname, customAllowedHosts) {
    let host = '';
    if (hostname !== undefined) {
      if (typeof hostname === 'string') {
        host = hostname.trim().toLowerCase();
      } else {
        return false;
      }
    } else if (typeof window !== 'undefined' && window.location && typeof window.location.hostname === 'string') {
      host = window.location.hostname.trim().toLowerCase();
    }
    if (!host) return false;

    // Outer brackets eltávolítása (IPv6 esetén, pl. [::1] -> ::1)
    const cleanHost = host.replace(/^\[|\]$/g, '');

    // 1. Loopback
    if (
      cleanHost === 'localhost' ||
      cleanHost === '127.0.0.1' ||
      cleanHost === '::1' ||
      cleanHost.endsWith('.localhost')
    ) {
      return true;
    }

    // 2. .local mDNS tartomány
    if (cleanHost === 'local' || cleanHost.endsWith('.local')) {
      return true;
    }

    // 3. IPv4 RFC 1918 C osztály: 192.168.0.0/16
    const m192 = cleanHost.match(/^192\.168\.(\d{1,3})\.(\d{1,3})$/);
    if (m192) {
      const o3 = parseInt(m192[1], 10);
      const o4 = parseInt(m192[2], 10);
      if (o3 >= 0 && o3 <= 255 && o4 >= 0 && o4 <= 255) return true;
    }

    // 4. IPv4 RFC 1918 A osztály: 10.0.0.0/8
    const m10 = cleanHost.match(/^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m10) {
      const o2 = parseInt(m10[1], 10);
      const o3 = parseInt(m10[2], 10);
      const o4 = parseInt(m10[3], 10);
      if (o2 >= 0 && o2 <= 255 && o3 >= 0 && o3 <= 255 && o4 >= 0 && o4 <= 255) return true;
    }

    // 5. IPv4 RFC 1918 B osztály: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    const m172 = cleanHost.match(/^172\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m172) {
      const o2 = parseInt(m172[1], 10);
      const o3 = parseInt(m172[2], 10);
      const o4 = parseInt(m172[3], 10);
      if (o2 >= 16 && o2 <= 31 && o3 >= 0 && o3 <= 255 && o4 >= 0 && o4 <= 255) return true;
    }

    // 6. IPv4 RFC 6598 Shared Address / CGNAT / Tailscale: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
    const m100 = cleanHost.match(/^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m100) {
      const o2 = parseInt(m100[1], 10);
      const o3 = parseInt(m100[2], 10);
      const o4 = parseInt(m100[3], 10);
      if (o2 >= 64 && o2 <= 127 && o3 >= 0 && o3 <= 255 && o4 >= 0 && o4 <= 255) return true;
    }

    // 7. IPv6 ULA (fc00::/7) és Link-Local (fe80::/10)
    if (cleanHost.includes(':')) {
      const firstHextet = cleanHost.split(':')[0];
      if (/^[0-9a-f]{1,4}$/i.test(firstHextet)) {
        const val = parseInt(firstHextet, 16);
        // fc00::/7 (0xfc00 - 0xfdff): (val >> 9) === 0x7e
        if ((val >> 9) === 0x7e) return true;
        // fe80::/10 (0xfe80 - 0xfebf): (val >> 6) === 0x3fa
        if ((val >> 6) === 0x3fa) return true;
      }
    }

    // 8. Opcionális CRUCIX_PRIVATE_HOSTS lista (vesszővel elválasztva vagy tömbként)
    const extraHosts = [];
    function appendRawHosts(raw) {
      if (typeof raw === 'string') {
        for (const part of raw.split(',')) {
          const item = part.trim().toLowerCase();
          if (item && !extraHosts.includes(item)) extraHosts.push(item);
        }
      } else if (Array.isArray(raw)) {
        for (const part of raw) {
          if (typeof part === 'string') {
            const item = part.trim().toLowerCase();
            if (item && !extraHosts.includes(item)) extraHosts.push(item);
          }
        }
      }
    }

    if (customAllowedHosts !== undefined) {
      appendRawHosts(customAllowedHosts);
    }
    if (typeof window !== 'undefined') {
      appendRawHosts(window.CRUCIX_PRIVATE_HOSTS);
      appendRawHosts(window.__CRUCIX_PRIVATE_HOSTS__);
      appendRawHosts(window.__CRUCIX_DATA__?.privateHosts);
      appendRawHosts(window.__CRUCIX_CONFIG__?.privateHosts);
    }
    if (typeof process !== 'undefined' && process.env && process.env.CRUCIX_PRIVATE_HOSTS) {
      appendRawHosts(process.env.CRUCIX_PRIVATE_HOSTS);
    }

    if (extraHosts.includes(cleanHost)) {
      return true;
    }

    // Alapértelmezett szigorú lezárás: ismeretlen hosztnév
    return false;
  }

  function isMobileViewport() {
    if (typeof window === 'undefined') return false;
    return (window.innerWidth || 1024) <= 768;
  }

  function getEffectiveViewMode() {
    return isMobileViewport() ? 'single' : viewMode;
  }

  function getMaxPlayers() {
    return getEffectiveViewMode() === 'grid' ? 4 : 1;
  }

  function notifyChange() {
    for (const fn of changeListeners) {
      try { fn(); } catch {}
    }
  }

  function setTypeFilter(type) {
    if (type === 'all' || type === 'news' || type === 'webcam' || type === 'directory') {
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

  function setSearchQuery(q) {
    searchQuery = typeof q === 'string' ? q : '';
    notifyChange();
  }

  function getSearchQuery() {
    return searchQuery;
  }

  function setViewMode(mode) {
    if (mode === 'single' || mode === 'grid') {
      viewMode = mode;
      const max = getMaxPlayers();
      if (activeStreamIds.length > max) {
        activeStreamIds = activeStreamIds.slice(activeStreamIds.length - max);
      }
      notifyChange();
    }
  }

  function getViewMode() {
    return getEffectiveViewMode();
  }

  function getActiveStreamId() {
    return activeStreamIds.length > 0 ? activeStreamIds[activeStreamIds.length - 1] : null;
  }

  function getActiveStreamIds() {
    const max = getMaxPlayers();
    return activeStreamIds.slice(0, max);
  }

  function ensureAudioState(streamId) {
    if (!streamAudioState.has(streamId)) {
      streamAudioState.set(streamId, { muted: false, volume: 80 });
    }
    return streamAudioState.get(streamId);
  }

  function getStreamAudioState(streamId) {
    const st = ensureAudioState(streamId);
    return { muted: Boolean(st.muted), volume: Number(st.volume) };
  }

  function sendYouTubeCommand(streamId, func, args = []) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return false;
    const iframe = document.getElementById(`lm-stage-iframe-${streamId}`);
    if (!iframe || !iframe.contentWindow || typeof iframe.contentWindow.postMessage !== 'function') {
      return false;
    }
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        'https://www.youtube-nocookie.com'
      );
      return true;
    } catch {
      return false;
    }
  }

  function updateStageAudioControlsDom(streamId) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const st = ensureAudioState(streamId);
    const muteBtn = document.getElementById(`lm-mute-btn-${streamId}`);
    if (muteBtn) {
      muteBtn.textContent = st.muted ? '🔇 Némítva' : '🔊 Hang';
      muteBtn.setAttribute('aria-pressed', st.muted ? 'true' : 'false');
      muteBtn.classList.toggle('is-muted', Boolean(st.muted));
    }
    const volSlider = document.getElementById(`lm-vol-slider-${streamId}`);
    if (volSlider && String(volSlider.value) !== String(st.volume)) {
      volSlider.value = String(st.volume);
    }
    const volLabel = document.getElementById(`lm-vol-val-${streamId}`);
    if (volLabel) {
      volLabel.textContent = `${st.muted ? 0 : st.volume}%`;
    }
  }

  function toggleMuteStream(streamId) {
    const targetId = typeof streamId === 'string' && streamId ? streamId : getActiveStreamId();
    if (!targetId) return;
    const st = ensureAudioState(targetId);
    st.muted = !st.muted;
    sendYouTubeCommand(targetId, st.muted ? 'mute' : 'unMute', []);
    if (!st.muted && st.volume > 0) {
      sendYouTubeCommand(targetId, 'setVolume', [st.volume]);
    }
    updateStageAudioControlsDom(targetId);
  }

  function setStreamVolume(streamId, volume) {
    const targetId = typeof streamId === 'string' && streamId ? streamId : getActiveStreamId();
    if (!targetId) return;
    const num = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    const st = ensureAudioState(targetId);
    st.volume = num;
    if (num === 0) {
      st.muted = true;
      sendYouTubeCommand(targetId, 'mute', []);
    } else {
      if (st.muted) {
        st.muted = false;
        sendYouTubeCommand(targetId, 'unMute', []);
      }
      sendYouTubeCommand(targetId, 'setVolume', [num]);
    }
    updateStageAudioControlsDom(targetId);
  }

  function playStream(streamId) {
    if (typeof streamId !== 'string' || !streamId.trim()) return;
    errorStreams.delete(streamId);
    ensureAudioState(streamId);

    const max = getMaxPlayers();
    const existingIdx = activeStreamIds.indexOf(streamId);
    if (existingIdx !== -1) {
      // Already active: keep it active (and make it primary) without recreating
      if (max === 1) {
        activeStreamIds = [streamId];
      }
      notifyChange();
      return;
    }

    if (max === 1) {
      activeStreamIds = [streamId];
    } else {
      if (activeStreamIds.length >= max) {
        activeStreamIds = [...activeStreamIds.slice(1), streamId];
      } else {
        activeStreamIds = [...activeStreamIds, streamId];
      }
    }
    notifyChange();
  }

  function stopStream(streamId) {
    if (typeof streamId === 'string' && streamId.trim()) {
      const next = activeStreamIds.filter(id => id !== streamId);
      if (next.length !== activeStreamIds.length) {
        activeStreamIds = next;
        notifyChange();
      }
      return;
    }
    if (activeStreamIds.length > 0) {
      activeStreamIds = [];
      notifyChange();
    }
  }

  function stopAllStreams() {
    if (activeStreamIds.length > 0) {
      activeStreamIds = [];
    }
    clearAllCameraTimers();
    activeCameraIds.clear();
    for (const embedId of activeEmbedIds) {
      const frame = document.getElementById(`lm-embed-frame-${embedId}`);
      if (frame) {
        try { frame.src = 'about:blank'; } catch {}
        try { frame.remove(); } catch {}
      }
    }
    activeEmbedIds.clear();
    notifyChange();
  }

  function loadEmbed(streamId) {
    if (!isPrivateOrLocalHost()) return false;
    if (typeof streamId !== 'string' || !streamId.trim()) return false;
    const rawStreams = resolveRawStreams();
    const stream = rawStreams.find(s => s.id === streamId);
    if (!stream || !stream.embedUrl) return false;
    activeEmbedIds.add(streamId);
    notifyChange();
    return true;
  }

  function unloadEmbed(streamId) {
    if (activeEmbedIds.has(streamId)) {
      const frame = document.getElementById(`lm-embed-frame-${streamId}`);
      if (frame) {
        try { frame.src = 'about:blank'; } catch {}
        try { frame.remove(); } catch {}
      }
      activeEmbedIds.delete(streamId);
      notifyChange();
    }
  }

  function isEmbedActive(streamId) {
    return activeEmbedIds.has(streamId);
  }

  function loadCamera(streamId) {
    if (!isPrivateOrLocalHost()) return;
    if (typeof streamId !== 'string' || !streamId.trim()) return;
    cameraErrorStates.delete(streamId);
    activeCameraIds.add(streamId);
    const rawStreams = resolveRawStreams();
    const stream = rawStreams.find(s => s.id === streamId);
    if (stream && stream.imageUrl) {
      startCameraTimer(streamId, stream.imageUrl);
    }
    notifyChange();
  }

  function unloadCamera(streamId) {
    if (typeof streamId !== 'string') return;
    activeCameraIds.delete(streamId);
    clearCameraTimer(streamId);
    notifyChange();
  }

  function loadAllCameras() {
    if (!isPrivateOrLocalHost()) return;
    const rawStreams = resolveRawStreams();
    const filtered = rawStreams.filter(matchesFilters);
    for (const stream of filtered) {
      if (stream.imageUrl && (stream.sourceType === 'link-only' || stream.embedStatus === 'external-only')) {
        cameraErrorStates.delete(stream.id);
        activeCameraIds.add(stream.id);
        startCameraTimer(stream.id, stream.imageUrl);
      }
    }
    notifyChange();
  }

  function unloadAllCameras() {
    clearAllCameraTimers();
    activeCameraIds.clear();
    notifyChange();
  }

  function onCameraImgError(streamId) {
    if (typeof streamId !== 'string') return;
    clearCameraTimer(streamId);
    cameraErrorStates.set(streamId, { timestamp: Date.now() });
    activeCameraIds.delete(streamId);
    notifyChange();
  }

  function onCameraImgLoad(streamId) {
    if (typeof streamId !== 'string') return;
    cameraErrorStates.delete(streamId);
  }

  function retryCamera(streamId) {
    if (typeof streamId !== 'string') return;
    cameraErrorStates.delete(streamId);
    loadCamera(streamId);
  }

  function isCameraActive(streamId) {
    return activeCameraIds.has(streamId);
  }

  function getCameraError(streamId) {
    return cameraErrorStates.get(streamId) || null;
  }

  function markStreamError(streamId) {
    if (typeof streamId !== 'string') return;
    errorStreams.add(streamId);
    activeStreamIds = activeStreamIds.filter(id => id !== streamId);
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

  function buildSafeEmbedUrl(videoId) {
    if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) return null;
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
  }

  function buildSafeWatchUrl(videoId) {
    if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) return null;
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  function getPageStatusLabel(status) {
    switch (status) {
      case 'verified-live': return 'Élő adás';
      case 'unverified-live': return 'Nem igazolt élő';
      case 'verified': return 'Hitelesített';
      case 'page-ok': return 'Oldal elérhető';
      case 'delayed': return 'Késleltetett (60p)';
      case 'archive': return 'Archívum';
      case 'no-live-feed': return 'Nincs közvetítés';
      case 'unverified': return 'Nem ellenőrzött';
      default: return status || '';
    }
  }

  function getEmbedStatusInfo(stream) {
    if (!stream) return { code: 'unverified', label: 'Nem ellenőrzött' };
    if (stream.sourceType === 'embed' || stream.embedKind === 'windy-widget') {
      return { code: 'embeddable', label: 'Beágyazható widget' };
    }
    if (stream.embedStatus === 'external-only' || stream.sourceType === 'link-only') {
      return { code: 'external-only', label: 'Csak külső oldalon nézhető' };
    }
    if (stream.status === 'unverified' || stream.embedStatus === 'unverified') {
      return { code: 'unverified', label: 'Nem beágyazható' };
    }
    if (stream.sourceType === 'youtube' && YOUTUBE_VIDEO_ID_REGEX.test(stream.videoId || '')) {
      return { code: 'embeddable', label: 'Beágyazható' };
    }
    return { code: 'unverified', label: 'Nem beágyazható' };
  }

  function isEmbeddableStream(stream) {
    return Boolean(
      stream &&
      stream.sourceType === 'youtube' &&
      stream.embedStatus !== 'external-only' &&
      stream.status !== 'unverified' &&
      YOUTUBE_VIDEO_ID_REGEX.test(stream.videoId || '')
    );
  }

  function resolveRawStreams(snapshot) {
    if (Array.isArray(snapshot?.liveStreams)) return snapshot.liveStreams;
    if (Array.isArray(lastSnapshot?.liveStreams)) return lastSnapshot.liveStreams;
    if (typeof window !== 'undefined' && Array.isArray(window.__CRUCIX_DATA__?.liveStreams)) {
      return window.__CRUCIX_DATA__.liveStreams;
    }
    return [];
  }

  function matchesFilters(stream) {
    if (!stream) return false;
    if (typeFilter !== 'all' && stream.type !== typeFilter) return false;
    if (regionFilter !== 'all' && stream.region !== regionFilter) return false;
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const hay = `${stream.name || ''} ${stream.provider || ''} ${stream.id || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  /**
   * Renders an active player slot HTML (16:9 stage slot).
   */
  function renderStageSlotHtml(stream, slotIndex, totalSlots) {
    if (!stream) {
      return `
        <div class="lm-stage-slot lm-stage-slot-empty" data-slot-index="${slotIndex}">
          <div class="lm-stage-placeholder">
            <div class="lm-placeholder-icon">📺</div>
            <div class="lm-placeholder-title">${totalSlots > 1 ? `Lejátszó hely #${slotIndex + 1} (üres)` : 'Nincs elindított közvetítés'}</div>
            <div class="lm-placeholder-privacy">${esc(PRIVACY_NOTICE_TEXT)}</div>
            <div class="lm-placeholder-hint">Válassz egy beágyazható híradót vagy kamerát az alábbi forrásválasztóból az indításhoz.</div>
          </div>
        </div>
      `;
    }

    const embedUrl = buildSafeEmbedUrl(stream.videoId);
    const watchUrl = buildSafeWatchUrl(stream.videoId);
    const audio = ensureAudioState(stream.id);
    const regionLabel = REGION_LABELS[stream.region] || stream.region;
    const typeLabel = TYPE_LABELS[stream.type] || stream.type;
    const pageStatusLabel = getPageStatusLabel(stream.status);

    return `
      <div class="lm-stage-slot lm-stage-slot-active" id="lm-stage-slot-${esc(stream.id)}" data-active-stream-id="${esc(stream.id)}" data-video-id="${esc(stream.videoId)}">
        <div class="lm-stage-slot-head">
          <div class="lm-stage-slot-meta">
            <span class="lm-live-dot" aria-hidden="true"></span>
            <span class="lm-card-type-badge lm-type-${esc(stream.type)}">${esc(typeLabel)}</span>
            <span class="lm-card-region-badge">${esc(regionLabel)}</span>
            <span class="lm-badge lm-badge-${esc(stream.status)}">${esc(pageStatusLabel)}</span>
            <strong class="lm-stage-slot-title">${esc(stream.name)}</strong>
            <span class="lm-stage-slot-provider">(${esc(stream.provider)})</span>
          </div>
          <div class="lm-stage-slot-top-actions">
            <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Forrás (YouTube) ↗</a>
          </div>
        </div>
        <div class="lm-player-box">
          <div class="lm-iframe-aspect">
            <iframe
              id="lm-stage-iframe-${esc(stream.id)}"
              class="lm-iframe"
              data-stream-id="${esc(stream.id)}"
              data-video-id="${esc(stream.videoId)}"
              src="${esc(embedUrl)}"
              title="${esc(stream.name)}"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
              referrerpolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation">
            </iframe>
          </div>
          <div class="lm-player-bar">
            <div class="lm-player-audio-controls">
              <button
                type="button"
                id="lm-mute-btn-${esc(stream.id)}"
                class="lm-btn lm-btn-audio${audio.muted ? ' is-muted' : ''}"
                aria-pressed="${audio.muted ? 'true' : 'false'}"
                onclick="window.CrucixLiveMedia?.toggleMuteStream('${esc(stream.id)}')">
                ${audio.muted ? '🔇 Némítva' : '🔊 Hang'}
              </button>
              <label class="lm-vol-wrap" title="Hangerő">
                <span class="lm-vol-icon">🎚</span>
                <input
                  type="range"
                  id="lm-vol-slider-${esc(stream.id)}"
                  class="lm-vol-slider"
                  min="0"
                  max="100"
                  step="5"
                  value="${esc(audio.volume)}"
                  aria-label="Hangerő: ${esc(stream.name)}"
                  oninput="window.CrucixLiveMedia?.setStreamVolume('${esc(stream.id)}', this.value)" />
                <span id="lm-vol-val-${esc(stream.id)}" class="lm-vol-val">${audio.muted ? 0 : audio.volume}%</span>
              </label>
            </div>
            <div class="lm-player-right-controls">
              <button type="button" class="lm-link-error" onclick="window.CrucixLiveMedia?.markStreamError('${esc(stream.id)}')">Nem tölt be?</button>
              <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.stopStream('${esc(stream.id)}')">■ Leállítás</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renders an embeddable source selector card/item, or an external-only item card.
   */
  function renderStreamCard(stream) {
    if (!stream || !stream.id) return '';
    const isPlaying = activeStreamIds.includes(stream.id);
    const isError = errorStreams.has(stream.id);
    const isValidId = YOUTUBE_VIDEO_ID_REGEX.test(stream.videoId || '');

    const regionLabel = REGION_LABELS[stream.region] || stream.region;
    const typeLabel = TYPE_LABELS[stream.type] || stream.type;
    const langCode = (stream.language || 'hu').toUpperCase();
    const pageStatusLabel = getPageStatusLabel(stream.status);
    const embedInfo = getEmbedStatusInfo(stream);

    if (stream.sourceType === 'link-only' || stream.sourceType === 'embed' || Boolean(stream.embedUrl) || embedInfo.code === 'external-only') {
      const isPrivateHost = isPrivateOrLocalHost();
      const hasImage = Boolean(stream.imageUrl) && isPrivateHost;
      const isCameraActive = activeCameraIds.has(stream.id);
      const isCameraError = cameraErrorStates.has(stream.id);
      const isEmbedActive = activeEmbedIds.has(stream.id);

      let externalBodyHtml = '';
      if (stream.embedUrl) {
        if (isPrivateHost) {
          if (isEmbedActive) {
            externalBodyHtml = `
              <div class="lm-embed-view-wrap">
                <iframe
                  id="lm-embed-frame-${esc(stream.id)}"
                  class="lm-embed-frame"
                  src="${esc(stream.embedUrl)}"
                  title="${esc(stream.name)}"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin allow-popups">
                </iframe>
                <div class="lm-embed-meta-bar">
                  <span class="lm-embed-disclaimer">${esc(WINDY_DISCLAIMER_TEXT)}</span>
                  <button type="button" class="lm-btn-embed-close" title="Térkép bezárása" onclick="window.CrucixLiveMedia?.unloadEmbed('${esc(stream.id)}')">✕ Bezárás</button>
                </div>
              </div>
              <div class="lm-embed-attribution">
                ${esc(stream.attribution || 'Forrás: Windy.com')} — <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Megnyitás a forráson ↗</a>
              </div>
            `;
          } else {
            externalBodyHtml = `
              <div class="lm-embed-privacy-box">
                <span class="lm-embed-privacy-text">${esc(WINDY_PRIVACY_NOTICE_TEXT)}</span>
              </div>
              <div class="lm-external-actions">
                <button type="button" class="lm-btn lm-btn-load-embed" onclick="window.CrucixLiveMedia?.loadEmbed('${esc(stream.id)}')">
                  🗺 Windy csapadéktérkép betöltése
                </button>
                <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">
                  Megnyitás a szolgáltató oldalán ↗
                </a>
              </div>
            `;
          }
        } else {
          externalBodyHtml = `
            <div class="lm-embed-restricted-box">
              <span class="lm-embed-restricted-text">ℹ A közvetlen térkép widget kizárólag privát helyi hálózatról (LAN / loopback) tölthető be (magáncélú felhasználás védelme).</span>
            </div>
            <div class="lm-external-actions">
              <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">
                Megnyitás a szolgáltató oldalán ↗
              </a>
            </div>
          `;
        }
      } else if (hasImage) {
        if (isCameraError) {
          externalBodyHtml = `
            <div class="lm-camera-fallback-box" role="alert">
              <div class="lm-camera-fallback-title">⚠ Nem tölthető be – megnyitás a forráson</div>
              <div class="lm-camera-fallback-desc">A kép közvetlen betöltése nem sikerült vagy a külső forrás korlátozta.</div>
              <div class="lm-camera-fallback-actions">
                <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">Megnyitás a forráson ↗</a>
                <button type="button" class="lm-btn lm-btn-retry" onclick="window.CrucixLiveMedia?.retryCamera('${esc(stream.id)}')">Újrapróbálás</button>
              </div>
            </div>
          `;
        } else if (isCameraActive) {
          externalBodyHtml = `
            <div class="lm-camera-view-wrap">
              <img
                id="lm-camera-img-${esc(stream.id)}"
                class="lm-camera-img"
                src="${esc(buildCameraImageUrl(stream.imageUrl))}"
                alt="${esc(stream.name)}"
                loading="eager"
                referrerpolicy="no-referrer"
                onload="window.CrucixLiveMedia?.onCameraImgLoad('${esc(stream.id)}')"
                onerror="window.CrucixLiveMedia?.onCameraImgError('${esc(stream.id)}')" />
              <div class="lm-camera-meta-bar">
                <span class="lm-camera-refresh-indicator">🔄 Frissítés: 60 mp (közvetlen böngészőoldali)</span>
                <button type="button" class="lm-btn-camera-close" title="Kamera bezárása" onclick="window.CrucixLiveMedia?.unloadCamera('${esc(stream.id)}')">✕ Bezárás</button>
              </div>
            </div>
            <div class="lm-camera-attribution">
              ${esc(stream.attribution || 'Forrás: Időkép / idokep.hu')} — <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Megnyitás a forráson ↗</a>
            </div>
          `;
        } else {
          externalBodyHtml = `
            <div class="lm-camera-privacy-box">
              <span class="lm-camera-privacy-text">${esc(CAMERA_PRIVACY_NOTICE_TEXT)}</span>
            </div>
            <div class="lm-external-actions">
              <button type="button" class="lm-btn lm-btn-load-cam" onclick="window.CrucixLiveMedia?.loadCamera('${esc(stream.id)}')">
                📷 Kamera betöltése
              </button>
              <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">
                Megnyitás a szolgáltató oldalán ↗
              </a>
            </div>
          `;
        }
      } else {
        externalBodyHtml = `
          ${stream.imageUrl && !isPrivateHost ? `
            <div class="lm-camera-restricted-box">
              <span class="lm-camera-restricted-text">ℹ A közvetlen kamerakép kizárólag privát helyi hálózatról (LAN / loopback) tölthető be (magáncélú felhasználás védelme).</span>
            </div>
          ` : ''}
          <div class="lm-external-actions">
            <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">
              Megnyitás a szolgáltató oldalán ↗
            </a>
          </div>
        `;
      }

      return `
        <article class="lm-card lm-card-external${isCameraActive ? ' camera-active' : ''}${isCameraError ? ' camera-error' : ''}${isEmbedActive ? ' embed-active' : ''}" id="lm-card-${esc(stream.id)}" data-stream-id="${esc(stream.id)}" data-embed-status="external-only">
          <div class="lm-card-head">
            <div class="lm-card-title-row">
              <span class="lm-card-type-badge lm-type-${esc(stream.type)}">${esc(typeLabel)}</span>
              <span class="lm-card-region-badge">${esc(regionLabel)}</span>
              <span class="lm-card-lang-badge">${esc(langCode)}</span>
              <span class="lm-status-pill lm-badge-external-source" title="Közvetlen böngészőoldali kapcsolat a külső forrással (Crucix szerver nem proxyzza)">külső forrás</span>
              <span class="lm-card-title">${esc(stream.name)}</span>
            </div>
            <div class="lm-card-provider">${esc(stream.provider)}</div>
            <div class="lm-dual-status-row">
              <span class="lm-status-pill lm-page-status lm-badge-${esc(stream.status)}" title="Forrásoldal állapota">
                Forrásoldalon: ${esc(pageStatusLabel)}
              </span>
              <span class="lm-status-pill lm-embed-status lm-embed-external-only" title="Beágyazhatóság">
                Beágyazhatóság: ${esc(embedInfo.label)}
              </span>
            </div>
          </div>
          <div class="lm-card-body lm-external-body">
            ${stream.notes ? `<div class="lm-external-notes">${esc(stream.notes)}</div>` : ''}
            ${externalBodyHtml}
          </div>
        </article>
      `;
    }

    let actionAreaHtml = '';
    if (!isValidId || isError) {
      const backoffSec = retryBackoff.get(stream.id) || 5;
      const watchUrl = isValidId ? buildSafeWatchUrl(stream.videoId) : null;
      actionAreaHtml = `
        <div class="lm-error-box" role="alert">
          <div class="lm-error-text">⚠ A közvetítés jelenleg nem ágyazható be vagy nem érhető el.</div>
          <div class="lm-error-actions">
            ${watchUrl ? `<a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">Megnyitás a forráson (YouTube) ↗</a>` : ''}
            <button type="button" class="lm-btn lm-btn-retry" onclick="window.CrucixLiveMedia?.retryStream('${esc(stream.id)}')">Újrapróbálás (${backoffSec}s)</button>
          </div>
        </div>
      `;
    } else if (stream.status === 'unverified') {
      actionAreaHtml = `
        <div class="lm-unverified-box">
          <div class="lm-placeholder-privacy">Nem igazolt közvetítés: jelenleg nem áll rendelkezésre ellenőrzött 24/7 beágyazható adás.</div>
          ${stream.channelId ? `<a href="https://www.youtube.com/channel/${esc(stream.channelId)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Szolgáltató csatornája ↗</a>` : ''}
        </div>
      `;
    } else if (isPlaying) {
      const watchUrl = buildSafeWatchUrl(stream.videoId);
      actionAreaHtml = `
        <div class="lm-selector-active-bar">
          <span class="lm-selector-playing-indicator"><span class="lm-live-dot"></span> Lejátszás folyamatban a főképernyőn</span>
          <div class="lm-selector-btns">
            <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.stopStream('${esc(stream.id)}')">■ Leállítás</button>
            <a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Forrás ↗</a>
          </div>
        </div>
      `;
    } else {
      actionAreaHtml = `
        <div class="lm-selector-idle-bar">
          <div class="lm-placeholder-privacy">${esc(PRIVACY_NOTICE_TEXT)}</div>
          <button type="button" class="lm-btn lm-btn-play" onclick="window.CrucixLiveMedia?.playStream('${esc(stream.id)}')">
            ▶ Közvetítés indítása
          </button>
        </div>
      `;
    }

    return `
      <article class="lm-card lm-card-embeddable${isPlaying ? ' playing' : ''}${isError ? ' error' : ''}" id="lm-card-${esc(stream.id)}" data-stream-id="${esc(stream.id)}" data-embed-status="${esc(embedInfo.code)}">
        <div class="lm-card-head">
          <div class="lm-card-title-row">
            <span class="lm-card-type-badge lm-type-${esc(stream.type)}">${esc(typeLabel)}</span>
            <span class="lm-card-region-badge">${esc(regionLabel)}</span>
            <span class="lm-card-lang-badge">${esc(langCode)}</span>
            ${stream.status === 'unverified' ? '<span class="lm-card-status-badge lm-status-unverified">Nem igazolt</span>' : ''}
            <span class="lm-card-title">${esc(stream.name)}</span>
          </div>
          <div class="lm-card-provider">${esc(stream.provider)}</div>
          <div class="lm-dual-status-row">
            <span class="lm-status-pill lm-page-status lm-badge-${esc(stream.status)}">
              Állapot: ${esc(pageStatusLabel)}
            </span>
            <span class="lm-status-pill lm-embed-status lm-embed-${esc(embedInfo.code)}">
              ${esc(embedInfo.label)}
            </span>
          </div>
        </div>
        <div class="lm-card-body">
          ${actionAreaHtml}
        </div>
        ${stream.notes ? `<div class="lm-card-footer"><span class="lm-card-notes">${esc(stream.notes)}</span></div>` : ''}
      </article>
    `;
  }

  function renderBrowserSectionHtml(rawStreams) {
    const filtered = rawStreams.filter(matchesFilters);
    const embeddableFiltered = filtered.filter(s => s.sourceType !== 'link-only' && s.embedStatus !== 'external-only');
    const externalFiltered = filtered.filter(s => s.sourceType === 'link-only' || s.embedStatus === 'external-only');

    // Quick-select dropdown options for all embeddable streams
    const allEmbeddable = rawStreams.filter(isEmbeddableStream);
    const quickSelectOptions = [
      '<option value="">— Gyorsindítás forrásnév szerint —</option>',
      ...allEmbeddable.map(s => `<option value="${esc(s.id)}"${activeStreamIds.includes(s.id) ? ' selected' : ''}>${esc(s.name)} (${esc(REGION_LABELS[s.region] || s.region)})</option>`)
    ].join('');

    const typeButtons = [
      { id: 'all', label: 'Mind' },
      { id: 'news', label: 'Híradók' },
      { id: 'webcam', label: 'Webkamerák' },
      { id: 'directory', label: 'Katalógusok' },
      { id: 'map', label: 'Térképek' }
    ].map(b => `
      <button type="button" class="lm-filter-btn${typeFilter === b.id ? ' active' : ''}" onclick="window.CrucixLiveMedia?.setTypeFilter('${b.id}')">
        ${esc(b.label)}
      </button>
    `).join('');

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

    const embeddableContent = embeddableFiltered.length > 0
      ? `<div class="lm-selector-grid scroll-region" tabindex="0" role="region" aria-label="Élő adások listája">${embeddableFiltered.map(renderStreamCard).join('')}</div>`
      : `
        <div class="lm-empty-state lm-empty-compact">
          <div class="lm-empty-icon">📡</div>
          <div class="lm-empty-text">Nincs a kiválasztott szűrőknek megfelelő beágyazható élő közvetítés.</div>
        </div>
      `;

    const isPrivateHost = isPrivateOrLocalHost();
    const externalCams = externalFiltered.filter(s => Boolean(s.imageUrl));
    const anyCamActive = externalCams.some(s => activeCameraIds.has(s.id));

    const externalContent = externalFiltered.length > 0
      ? `
        <div class="lm-external-section" id="lm-external-section">
          <div class="lm-section-head">
            <div class="lm-section-title-wrap">
              <span class="lm-section-title">Külső oldalon nézhető</span>
              <span class="lm-count-badge">${externalFiltered.length} forrás</span>
              ${externalCams.length > 0 && isPrivateHost ? `
                ${anyCamActive ? `
                  <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.unloadAllCameras()" title="Minden aktív intézményi kamera bezárása">
                    ✕ Kamerák bezárása
                  </button>
                ` : `
                  <button type="button" class="lm-btn lm-btn-load-cam" onclick="window.CrucixLiveMedia?.loadAllCameras()" title="Összes intézményi kamera betöltése">
                    📷 Kamerák betöltése
                  </button>
                `}
              ` : ''}
            </div>
            <span class="lm-section-sub">A szolgáltató hivatalos külső beágyazást nem biztosít (pl. X-Frame-Options korlátozás); a kamerák és adások közvetlenül a forrásoldalon érhetők el.</span>
          </div>
          <div class="lm-external-grid scroll-region" tabindex="0" role="region" aria-label="Külső oldalon nézhető adások listája">
            ${externalFiltered.map(renderStreamCard).join('')}
          </div>
        </div>
      `
      : '';

    const bothEmpty = embeddableFiltered.length === 0 && externalFiltered.length === 0;

    return `
      <div class="lm-controls-bar">
        <div class="lm-filters-row">
          <div class="lm-filter-group" role="group" aria-label="Típus szűrő">
            <span class="lm-filter-label">Típus:</span>
            ${typeButtons}
          </div>
          <div class="lm-filter-group" role="group" aria-label="Régió szűrő">
            <span class="lm-filter-label">Régió:</span>
            ${regionButtons}
          </div>
          <div class="lm-source-picker-group">
            <select
              id="lm-quick-source-select"
              class="lm-source-select"
              aria-label="Forrásnév szerinti kiválasztás"
              onchange="if(this.value) window.CrucixLiveMedia?.playStream(this.value)">
              ${quickSelectOptions}
            </select>
            <input
              type="search"
              id="lm-source-search-input"
              class="lm-source-search"
              placeholder="Forrás keresése..."
              value="${esc(searchQuery)}"
              aria-label="Forrás keresése név szerint"
              oninput="window.CrucixLiveMedia?.setSearchQuery(this.value)" />
          </div>
        </div>
      </div>

      <div class="lm-disclaimer-notice" role="note">
        <strong>Adatvédelmi tájékoztatás:</strong> ${esc(PRIVACY_NOTICE_TEXT)} Külső előnézeti kép vagy rejtett előtöltés nem indul a gombra kattintás előtt.
      </div>

      ${bothEmpty ? `
        <div class="lm-empty-state">
          <div class="lm-empty-icon">📡</div>
          <div class="lm-empty-text">Nincs a kiválasztott szűrőknek megfelelő élő közvetítés.</div>
        </div>
      ` : `
        <div class="lm-embeddable-section" id="lm-embeddable-section">
          <div class="lm-section-head">
            <div class="lm-section-title-wrap">
              <span class="lm-section-title">Beágyazható élő közvetítések (Crucix lejátszó)</span>
              <span class="lm-count-badge">${embeddableFiltered.length} beágyazható</span>
            </div>
          </div>
          ${embeddableContent}
        </div>
        ${externalContent}
      `}
    `;
  }

  function renderHeadHtml(rawStreams) {
    const isMobile = isMobileViewport();
    const effectiveMode = getEffectiveViewMode();
    const activeIds = getActiveStreamIds();
    const embeddableTotal = rawStreams.filter(isEmbeddableStream).length;
    const externalTotal = rawStreams.filter(s => s.sourceType === 'link-only' || s.sourceType === 'embed' || s.embedStatus === 'external-only').length;

    return `
      <div class="lm-title-wrap">
        <span class="lm-title">Élő Videóközpont</span>
        <span class="lm-count-badge">${embeddableTotal} beágyazható · ${externalTotal} külső</span>
        <span class="lm-active-badge${activeIds.length > 0 ? ' is-live' : ''}">
          ${activeIds.length} / ${effectiveMode === 'grid' ? 4 : 1} aktív lejátszó
        </span>
      </div>
      <div class="lm-head-actions">
        <label class="lm-bg-toggle-wrap" title="Ha be van kapcsolva, a videó lejátszása nem áll le a lap elhagyásakor vagy minimalizálásakor">
          <input type="checkbox" id="lm-bg-playback-toggle" class="lm-bg-checkbox"${allowBackgroundPlayback ? ' checked' : ''} onchange="window.CrucixLiveMedia?.setAllowBackgroundPlayback(this.checked)" />
          <span class="lm-bg-label">Háttérben is fusson</span>
        </label>
        <button type="button" class="lm-btn lm-btn-exit-live" onclick="window.CrucixViewsPanel?.setContentTab('news')" title="Kilépés az Élő nézetből (minden lejátszó leáll)">
          ← Térkép / Hírfolyam
        </button>
        ${activeIds.length > 0 ? `
          <button type="button" class="lm-btn lm-btn-stop-all" onclick="window.CrucixLiveMedia?.stopAllStreams()">
            ■ Összes leállítása
          </button>
        ` : ''}
        <div class="lm-mode-toggle" role="group" aria-label="Nézetmód"${isMobile ? ' style="display:none;"' : ''}>
          <button type="button" class="lm-mode-btn${effectiveMode === 'single' ? ' active' : ''}" onclick="window.CrucixLiveMedia?.setViewMode('single')" title="16:9 Egynézet (max. 1 lejátszó)">16:9 Egynézet</button>
          <button type="button" class="lm-mode-btn${effectiveMode === 'grid' ? ' active' : ''}" onclick="window.CrucixLiveMedia?.setViewMode('grid')" title="2×2 Rács (max. 4 lejátszó)">2×2 Rács</button>
        </div>
      </div>
    `;
  }

  function renderStageGridHtml(rawStreams) {
    const effectiveMode = getEffectiveViewMode();
    const maxSlots = effectiveMode === 'grid' ? 4 : 1;
    const activeIds = getActiveStreamIds();
    const byId = new Map(rawStreams.map(s => [s.id, s]));

    if (effectiveMode === 'single') {
      const activeStream = activeIds[0] ? byId.get(activeIds[0]) : null;
      return renderStageSlotHtml(activeStream, 0, 1);
    }

    const slots = [];
    for (let i = 0; i < maxSlots; i++) {
      const stream = activeIds[i] ? byId.get(activeIds[i]) : null;
      slots.push(renderStageSlotHtml(stream, i, maxSlots));
    }
    return slots.join('');
  }

  /**
   * Renders the complete "Élő" panel HTML string (for unit tests and initial mount).
   */
  function panelHtml(snapshot) {
    if (snapshot && typeof snapshot === 'object') {
      lastSnapshot = snapshot;
    }
    const rawStreams = resolveRawStreams(snapshot);
    const effectiveMode = getEffectiveViewMode();

    return `
      <div class="lm-panel-container lm-workspace-container" id="lm-panel">
        <div class="lm-head" id="lm-workspace-head">
          ${renderHeadHtml(rawStreams)}
        </div>

        <div class="lm-stage-section">
          <div class="lm-stage-grid ${effectiveMode === 'grid' ? 'stage-grid-2x2' : 'stage-single'}" id="lm-stage-grid">
            ${renderStageGridHtml(rawStreams)}
          </div>
        </div>

        <div class="lm-browser-section" id="lm-browser-section">
          ${renderBrowserSectionHtml(rawStreams)}
        </div>
      </div>
    `;
  }

  /**
   * Non-destructive DOM reconciliation for the center workspace (#liveWorkspaceStack).
   * Preserves already-running <iframe> elements across filter changes, slot additions,
   * and periodic dashboard refreshes!
   */
  function mountWorkspace(container, snapshot) {
    if (!container) return;
    if (snapshot && typeof snapshot === 'object') {
      lastSnapshot = snapshot;
    }
    const rawStreams = resolveRawStreams(snapshot);
    const effectiveMode = getEffectiveViewMode();
    const maxSlots = effectiveMode === 'grid' ? 4 : 1;
    const activeIds = getActiveStreamIds();
    const byId = new Map(rawStreams.map(s => [s.id, s]));

    let root = container.querySelector ? container.querySelector('#lm-panel') : null;
    if (!root) {
      container.innerHTML = panelHtml(snapshot);
      return;
    }

    // 1. Update header bar
    const headEl = container.querySelector('#lm-workspace-head');
    if (headEl) {
      headEl.innerHTML = renderHeadHtml(rawStreams);
    }

    // 2. Reconcile stage grid WITHOUT destroying existing active <iframe> elements
    const stageGrid = container.querySelector('#lm-stage-grid');
    if (stageGrid) {
      stageGrid.className = `lm-stage-grid ${effectiveMode === 'grid' ? 'stage-grid-2x2' : 'stage-single'}`;

      // Map existing active DOM slots by streamId
      const existingActiveSlots = new Map();
      const childNodes = Array.from(stageGrid.children || []);
      for (const child of childNodes) {
        const sid = child.getAttribute && child.getAttribute('data-active-stream-id');
        const vid = child.getAttribute && child.getAttribute('data-video-id');
        const targetStream = sid ? byId.get(sid) : null;
        if (sid && activeIds.includes(sid) && targetStream && targetStream.videoId === vid) {
          existingActiveSlots.set(sid, child);
        } else {
          // Slot is either an empty placeholder or a stopped stream -> remove it
          stageGrid.removeChild(child);
        }
      }

      // Build ordered slot list for current mode
      for (let i = 0; i < maxSlots; i++) {
        const sid = activeIds[i] || null;
        const stream = sid ? byId.get(sid) : null;
        if (sid && stream && existingActiveSlots.has(sid)) {
          const existingNode = existingActiveSlots.get(sid);
          // Only move if not already at index i (avoiding unnecessary DOM moves that reload iframes)
          if (stageGrid.children[i] !== existingNode) {
            stageGrid.insertBefore(existingNode, stageGrid.children[i] || null);
          }
          updateStageAudioControlsDom(sid);
        } else {
          const temp = document.createElement('div');
          temp.innerHTML = renderStageSlotHtml(stream, i, maxSlots).trim();
          const newSlot = temp.firstElementChild;
          if (newSlot) {
            stageGrid.insertBefore(newSlot, stageGrid.children[i] || null);
          }
        }
      }

      // Remove any trailing placeholders beyond maxSlots
      while (stageGrid.children.length > maxSlots) {
        stageGrid.removeChild(stageGrid.lastElementChild);
      }
    }

    // 3. Update browser / filter section (preserving focus if user is typing in search input)
    const browserEl = container.querySelector('#lm-browser-section');
    if (browserEl) {
      const activeEl = document.activeElement;
      const isSearchFocused = activeEl && activeEl.id === 'lm-source-search-input';
      const selStart = isSearchFocused ? activeEl.selectionStart : null;
      const selEnd = isSearchFocused ? activeEl.selectionEnd : null;

      browserEl.innerHTML = renderBrowserSectionHtml(rawStreams);

      if (isSearchFocused) {
        const newSearchInput = container.querySelector('#lm-source-search-input');
        if (newSearchInput) {
          newSearchInput.focus();
          try {
            if (selStart !== null && selEnd !== null) {
              newSearchInput.setSelectionRange(selStart, selEnd);
            }
          } catch {}
        }
      }
    }
  }

  // --- Global Event Listeners ---
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearAllCameraTimers();
        if (!allowBackgroundPlayback) {
          stopAllStreams();
        }
      } else {
        if (activeCameraIds.size > 0) {
          const rawStreams = resolveRawStreams();
          const byId = new Map(rawStreams.map(s => [s.id, s]));
          for (const cid of activeCameraIds) {
            const stream = byId.get(cid);
            if (stream && stream.imageUrl && !cameraErrorStates.has(cid)) {
              refreshCameraDomImage(cid, stream.imageUrl);
              startCameraTimer(cid, stream.imageUrl);
            }
          }
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('message', (event) => {
      if (typeof event.data === 'string' && event.data.includes('infoDelivery') && event.data.includes('onError')) {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed?.event === 'infoDelivery' && parsed?.info?.errorCode !== undefined) {
            for (const sid of activeStreamIds) {
              const iframe = document.getElementById(`lm-stage-iframe-${sid}`);
              if (iframe && iframe.contentWindow === event.source) {
                markStreamError(sid);
                break;
              }
            }
          }
        } catch {}
      }
    });
  }

  // --- Export on Window ---
  window.CrucixLiveMedia = Object.freeze({
    panelHtml,
    mountWorkspace,
    renderStreamCard,
    setTypeFilter,
    getTypeFilter,
    setRegionFilter,
    getRegionFilter,
    setSearchQuery,
    getSearchQuery,
    setViewMode,
    getViewMode,
    getActiveStreamId,
    getActiveStreamIds,
    getStreamAudioState,
    toggleMuteStream,
    setStreamVolume,
    playStream,
    stopStream,
    stopAllStreams,
    markStreamError,
    retryStream,
    loadCamera,
    unloadCamera,
    loadAllCameras,
    unloadAllCameras,
    onCameraImgError,
    onCameraImgLoad,
    retryCamera,
    isCameraActive,
    getCameraError,
    loadEmbed,
    unloadEmbed,
    isEmbedActive,
    isPrivateOrLocalHost,
    setAllowBackgroundPlayback,
    getAllowBackgroundPlayback,
    onChange,
    PRIVACY_NOTICE_TEXT,
    CAMERA_PRIVACY_NOTICE_TEXT,
    WINDY_PRIVACY_NOTICE_TEXT,
    WINDY_DISCLAIMER_TEXT
  });

})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
