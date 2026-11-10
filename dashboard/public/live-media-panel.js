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
 * 6. Szigorúan magáncélú, saját, egyfelhasználós használat (Időkép ÁSZF 3., 9. és 10. pont):
 *    - A Crucix futó példánya privát, nem nyilvános, harmadik fél nem éri el (kizárólag saját
 *      helyi hálózatán LAN-on fut), és más médiacsatornán semmilyen formában nem teszi közzé a kamerákat.
 *    - A Crucix szervere a kamerák képeit NEM tölti le, nem tárolja elektronikusan, nem proxyzza és
 *      nem dolgozza fel (megfelelés az ÁSZF 3. pontjának: „Tilos a weboldalon megjelenő tartalmak vagy azok
 *      bármely részletének letöltése, elektronikus tárolása, feldolgozása és értékesítése a Szolgáltató írásos hozzájárulása nélkül.”).
 *    - A képmegjelenítés kizárólag a végfelhasználó saját böngészőjében fut közvetlen <img> lekérésként,
 *      a felhasználó kifejezett kattintására (Click-to-Load), átmeneti memóriabeli megjelenítésként.
 *    - Terheléscsökkentés és csoportos korlát: A percenkénti terhelés csökkentése érdekében a csoportos
 *      kameratöltés legfeljebb 4 kamerát indít egyszerre (MAX_GROUP_CAMERAS = 4), és a rendszerben egyidejűleg
 *      legfeljebb 4 kamera tartható nyitva. A korlát elérésekor újabb betöltés nem indul, és a felület tájékoztatást ad.
 *    - Szigorúan tilos a tartalmak más médiacsatornán való közzététele (ÁSZF 10. pont).
 *    - Az ÁSZF 10. pontja szerinti „Elvihető tartalmak” kivétel kizárólag az adott aloldal térképeire/elemeire
 *      vonatkozik forrásmegjelöléssel és linkkel; a webkamerák képeire ez a kivétel nem terjed ki.
 *    - Módosítási jog (ÁSZF 9. pont): A Szolgáltató bármikor jogosult a szerződési feltételek egyoldalú módosítására.
 *    - Hatályosság: A vizsgált ÁSZF az oldalon megjelölt állapot szerint 2021. március 17-től hatályos
 *      („Hatályos 2021.03.17”).
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
  const STILL_IMAGE_REFRESH_INTERVAL_MS = 1800000; // 30 perc (Cumiana ELF/VLF spektrogram)
  const CAMERA_ERROR_BACKOFF_MS = 300000;
  const MAX_GROUP_CAMERAS = 4;
  const CAMERA_LIMIT_NOTICE_TEXT = 'Legfeljebb 4 kamera tölthető be egyszerre; a többit kártyánként nyisd meg.';
  const DEFAULT_GROUP_CAMERA_IDS = Object.freeze([
    'debrecen-kossuth-ter-webcam',
    'debrecen-bekas-to-webcam',
    'debrecen-egyetem-ter-webcam',
    'debrecen-klinika-webcam'
  ]);
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
  const STALE_MAX_AGE_MS = 24 * 3600 * 1000; // 24 óra
  const IPCAMLIVE_PRIVACY_NOTICE_TEXT = 'A lejátszó betöltése kapcsolatot létesít az IPCamLive szolgáltatóval; a Crucix nem tárolja.';
  const UNIDEB_PRIVACY_NOTICE_TEXT = 'A közvetítés indítása kapcsolatot létesít a Debreceni Egyetem streaming szerverével (unideb.hu); a Crucix nem tárolja.';


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
  let cameraNotice = '';
  let activeEmbedIds = new Set();
  let gridImageTimers = new Map();
  let lastImageRefreshedAt = new Map();
  let gridImageErrors = new Set();
  let streamLastModified = new Map();
  let streamMetaErrors = new Map();
  let hlsInstances = new Map();
  let lastWindyDimensions = new Map(); // streamId -> { width: number, height: number }

  function computeFreshnessBadge(lastModified, now = Date.now()) {
    if (!lastModified) return { label: 'ismeretlen', status: 'unknown', className: 'lm-freshness-unknown' };
    const ts = typeof lastModified === 'number' ? lastModified : new Date(lastModified).getTime();
    if (isNaN(ts)) return { label: 'ismeretlen', status: 'unknown', className: 'lm-freshness-unknown' };
    const nowTs = typeof now === 'number' ? now : new Date(now).getTime();
    const diffMs = Math.max(0, nowTs - ts);
    const diffHours = diffMs / (3600 * 1000);
    const diffDays = diffMs / (24 * 3600 * 1000);

    if (diffHours < 6) {
      return { label: 'LIVE', status: 'live', className: 'lm-freshness-live' };
    } else if (diffDays <= 7) {
      const h = Math.floor(diffHours);
      return { label: `${h} órája`, status: 'recent', className: 'lm-freshness-recent', hours: h };
    } else {
      return { label: 'befagyott', status: 'stale', className: 'lm-freshness-stale' };
    }
  }

  function probeLastModified(stream) {
    if (!stream || !stream.id) return;
    const fetchFn = (typeof window !== 'undefined' && typeof window.fetch === 'function')
      ? window.fetch
      : (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) return;
    try {
      fetchFn(`/api/still-image-meta?id=${encodeURIComponent(stream.id)}`, { method: 'GET', cache: 'no-store' })
        .then(res => {
          if (!res.ok) {
            return res.json().catch(() => ({})).then(data => {
              throw new Error(data?.error || `HTTP ${res.status}`);
            });
          }
          return res.json();
        })
        .then(data => {
          if (data && data.ok && data.lastModified) {
            streamLastModified.set(stream.id, data.lastModified);
            streamMetaErrors.delete(stream.id);
            updateGridFreshnessDom(stream.id);
          } else {
            streamLastModified.set(stream.id, null);
            const errMsg = data?.error || 'A forrás fejléce nem érhető el';
            streamMetaErrors.set(stream.id, errMsg);
            updateGridFreshnessDom(stream.id, errMsg);
            if (errMsg.includes('404') || errMsg.toLowerCase().includes('not found')) {
              notifyChange();
            }
          }
        })
        .catch(err => {
          streamLastModified.set(stream.id, null);
          const errMsg = err?.message || String(err) || 'Hálózati hiba a frissesség lekérdezésekor';
          streamMetaErrors.set(stream.id, errMsg);
          updateGridFreshnessDom(stream.id, errMsg);
          if (errMsg.includes('404') || errMsg.toLowerCase().includes('not found')) {
            notifyChange();
          }
        });
    } catch (err) {
      streamLastModified.set(stream.id, null);
      const errMsg = err?.message || String(err) || 'Hiba';
      streamMetaErrors.set(stream.id, errMsg);
      updateGridFreshnessDom(stream.id, errMsg);
      if (errMsg.includes('404') || errMsg.toLowerCase().includes('not found')) {
        notifyChange();
      }
    }
  }

  function updateGridFreshnessDom(streamId, errorReason = null) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const badge = document.getElementById(`lm-grid-freshness-${streamId}`);
    const headBadge = document.getElementById(`lm-grid-freshness-head-${streamId}`);
    const lm = streamLastModified.get(streamId);
    const err = errorReason || streamMetaErrors.get(streamId);
    const freshness = computeFreshnessBadge(lm);
    for (const b of [badge, headBadge]) {
      if (b) {
        b.textContent = freshness.label;
        b.className = `lm-freshness-badge ${freshness.className}`;
        if (lm) {
          b.setAttribute('title', `Forrás utolsó módosítása (Last-Modified): ${lm}`);
        } else if (err) {
          b.setAttribute('title', `Frissesség nem állapítható meg: ${err}`);
        } else {
          b.setAttribute('title', 'Frissesség nem igazolt');
        }
      }
    }
  }

  function getSourceHiddenCategory(stream) {
    if (!stream) return null;
    // Link-katalógusok és hírek (nem webkamera) nem rejtendők el, hacsak nem halott a forrásoldal
    if (stream.sourceType === 'link-only' && stream.type !== 'webcam') {
      if (stream.status === 'no-live-feed' || stream.status === 'dead') return 'halott';
      return null;
    }
    // 1. Halott forrás (status szerinti leállás, still-image-meta 404 hiba, vagy rács képbetöltési hiba)
    if (stream.status === 'no-live-feed' || stream.status === 'dead') return 'halott';
    if (gridImageErrors.has(stream.id)) return 'halott';
    const metaErr = String(streamMetaErrors.get(stream.id) || '');
    if (metaErr && (metaErr.includes('404') || metaErr.toLowerCase().includes('not found'))) {
      return 'halott';
    }
    // 2. Archív felvétel / nem élő kamera
    if (stream.type === 'webcam' && stream.status === 'archive') return 'archív';
    // 3. Elavult kép (Last-Modified régebbi mint 24 óra)
    const lm = streamLastModified.get(stream.id);
    if (lm) {
      const ts = typeof lm === 'number' ? lm : new Date(lm).getTime();
      if (!isNaN(ts) && (Date.now() - ts) > STALE_MAX_AGE_MS) return 'elavult';
    }
    // Hiányzó Last-Modified vagy nem-404 hiba: frissesség nem igazolt, NEM rejtett
    return null;
  }

  function isCameraStale(stream) {
    return getSourceHiddenCategory(stream) !== null;
  }

  function isSourceHidden(stream) {
    return getSourceHiddenCategory(stream) !== null;
  }

  function getSourceHiddenReason(stream) {
    if (!stream) return 'Ismeretlen ok';
    if (cameraErrorStates.has(stream.id) || gridImageErrors.has(stream.id)) {
      return 'Képbetöltési hiba (404/onerror)';
    }
    const metaErr = String(streamMetaErrors.get(stream.id) || '');
    if (metaErr && (metaErr.includes('404') || metaErr.toLowerCase().includes('not found'))) {
      return `Nem elérhető fejléc (${metaErr})`;
    }
    if (stream.status === 'no-live-feed') return 'Nincs élő közvetítés / leállt forrás';
    if (stream.status === 'dead') return 'Nem működő forrás';
    if (stream.status === 'archive') return 'Archív felvétel';
    const lm = streamLastModified.get(stream.id);
    if (lm) {
      const ts = typeof lm === 'number' ? lm : new Date(lm).getTime();
      if (!isNaN(ts)) {
        const diffH = Math.floor(Math.max(0, Date.now() - ts) / (3600 * 1000));
        return `${diffH} órája nem frissült (>24h)`;
      }
    }
    return 'Elavult vagy elérhetetlen forrás';
  }

  function getStaleReason(stream) {
    return getSourceHiddenReason(stream);
  }

  function buildHiddenSourcesTooltip(hiddenSources) {
    if (!hiddenSources || hiddenSources.length === 0) return '';
    const groups = { halott: [], archív: [], elavult: [] };
    for (const s of hiddenSources) {
      const cat = getSourceHiddenCategory(s) || 'elavult';
      if (groups[cat]) groups[cat].push(s);
      else groups.elavult.push(s);
    }
    const lines = ['Elrejtett források:'];
    if (groups.halott.length > 0) {
      lines.push(`• Halott (${groups.halott.length} db):`);
      for (const s of groups.halott) {
        lines.push(`  - ${s.name}: ${getSourceHiddenReason(s)}`);
      }
    }
    if (groups.archív.length > 0) {
      lines.push(`• Archív (${groups.archív.length} db):`);
      for (const s of groups.archív) {
        lines.push(`  - ${s.name}: ${getSourceHiddenReason(s)}`);
      }
    }
    if (groups.elavult.length > 0) {
      lines.push(`• Elavult (${groups.elavult.length} db):`);
      for (const s of groups.elavult) {
        lines.push(`  - ${s.name}: ${getSourceHiddenReason(s)}`);
      }
    }
    return lines.join('\n');
  }

  function formatTimeString(ts) {
    if (!ts) return '--:--:--';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function buildGridImageUrl(baseUrl) {
    if (!baseUrl) return '';
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}t=${Date.now()}`;
  }

  function updateGridTimestampDom(streamId) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const badge = document.getElementById(`lm-grid-ts-${streamId}`);
    if (badge) {
      const ts = lastImageRefreshedAt.get(streamId);
      badge.textContent = `Frissítve: ${formatTimeString(ts)}`;
    }
  }

  function refreshGridDomImage(streamId, imageUrl) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const img = document.getElementById(`lm-grid-img-${streamId}`);
    if (img && imageUrl) {
      img.src = buildGridImageUrl(imageUrl);
      lastImageRefreshedAt.set(streamId, Date.now());
      updateGridTimestampDom(streamId);
    }
  }

  function startGridImageTimer(stream) {
    if (!stream || !stream.id) return;
    clearGridImageTimer(stream.id);
    if (typeof window === 'undefined' || typeof window.setInterval !== 'function') return;
    const intervalMs = stream.sourceType === 'still-image'
      ? STILL_IMAGE_REFRESH_INTERVAL_MS
      : CAMERA_REFRESH_INTERVAL_MS;

    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      if (gridImageErrors.has(stream.id)) {
        clearGridImageTimer(stream.id);
        return;
      }
      refreshGridDomImage(stream.id, stream.imageUrl);
    }, intervalMs);
    gridImageTimers.set(stream.id, timer);
  }

  function clearGridImageTimer(streamId) {
    if (gridImageTimers.has(streamId)) {
      const timer = gridImageTimers.get(streamId);
      if (typeof window !== 'undefined' && typeof window.clearInterval === 'function') {
        window.clearInterval(timer);
      } else {
        clearInterval(timer);
      }
      gridImageTimers.delete(streamId);
    }
  }

  function clearAllGridImageTimers() {
    for (const [, timer] of gridImageTimers.entries()) {
      if (typeof window !== 'undefined' && typeof window.clearInterval === 'function') {
        window.clearInterval(timer);
      } else {
        clearInterval(timer);
      }
    }
    gridImageTimers.clear();
  }

  function cleanupGridSlot(streamId) {
    clearGridImageTimer(streamId);
    gridImageErrors.delete(streamId);
    lastWindyDimensions.delete(streamId);
    if (hlsInstances && hlsInstances.has(streamId)) {
      try {
        hlsInstances.get(streamId).destroy();
      } catch {}
      hlsInstances.delete(streamId);
    }
    if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
      const v = document.getElementById(`lm-hls-video-${streamId}`);
      if (v) {
        try {
          v.pause();
          v.removeAttribute('src');
          v.load();
        } catch {}
      }
    }
  }

  function buildWindyEmbedUrl(rawUrl, width, height) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
      const parsed = new URL(rawUrl, typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost');
      if (width && Number.isFinite(width) && width > 0) {
        parsed.searchParams.set('width', String(Math.round(width)));
      }
      if (height && Number.isFinite(height) && height > 0) {
        parsed.searchParams.set('height', String(Math.round(height)));
      }
      return parsed.toString();
    } catch (_e) {
      let url = rawUrl;
      if (width && Number.isFinite(width) && width > 0) {
        url = url.includes('width=')
          ? url.replace(/([?&])width=\d+/, `$1width=${Math.round(width)}`)
          : (url.includes('?') ? `${url}&width=${Math.round(width)}` : `${url}?width=${Math.round(width)}`);
      }
      if (height && Number.isFinite(height) && height > 0) {
        url = url.includes('height=')
          ? url.replace(/([?&])height=\d+/, `$1height=${Math.round(height)}`)
          : (url.includes('?') ? `${url}&height=${Math.round(height)}` : `${url}?height=${Math.round(height)}`);
      }
      return url;
    }
  }

  function extractMediaDomain(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    try {
      const u = new URL(urlStr);
      const host = u.hostname.toLowerCase();
      const parts = host.split('.');
      if (parts.length >= 2) {
        return parts.slice(-2).join('.');
      }
      return host;
    } catch {
      return null;
    }
  }

  function getGroupCameraProvidersCounts(rawStreams) {
    const streams = rawStreams || resolveRawStreams();
    const byId = new Map(streams.map(s => [s.id, s]));
    const counts = {};
    for (const id of DEFAULT_GROUP_CAMERA_IDS) {
      const s = byId.get(id);
      if (!s) continue;
      // Extract domain strictly from media properties (imageUrl, streamUrl, embedUrl) NOT s.url
      const mediaUrl = s.imageUrl || s.streamUrl || s.embedUrl;
      const domain = extractMediaDomain(mediaUrl);
      if (domain) {
        counts[domain] = (counts[domain] || 0) + 1;
      }
    }
    return counts;
  }

  function getGroupCameraProvidersNotice(rawStreams) {
    const counts = getGroupCameraProvidersCounts(rawStreams);
    return Object.entries(counts).map(([dom, cnt]) => `${dom} ${cnt}`).join(', ');
  }

  function getWindySlotDimensions(mode) {
    const effectiveMode = mode || getEffectiveViewMode();
    if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
      const stage = document.getElementById('lm-stage-grid') || (typeof document.querySelector === 'function' ? document.querySelector('.lm-stage') : null);
      if (stage && stage.clientWidth > 100) {
        const w = stage.clientWidth;
        if (effectiveMode === 'single') {
          return { width: Math.round(w), height: Math.round(w * 9 / 16) };
        } else {
          const slotW = Math.round((w - 12) / 2);
          return { width: slotW, height: Math.round(slotW * 9 / 16) };
        }
      }
    }
    return effectiveMode === 'single'
      ? { width: 858, height: 483 }
      : { width: 498, height: 280 };
  }

  function updateWindyOnViewModeChange(newMode) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const dims = getWindySlotDimensions(newMode);
    const rawStreams = resolveRawStreams();
    for (const sid of activeStreamIds) {
      const stream = rawStreams.find(s => s.id === sid);
      if (!stream) continue;
      const isWindy = stream.embedKind === 'windy-widget' || Boolean(stream.embedUrl && stream.embedUrl.includes('windy.com'));
      if (isWindy && stream.embedUrl) {
        lastWindyDimensions.set(sid, dims);
        const iframe = document.getElementById(`lm-stage-embed-${sid}`);
        if (iframe) {
          const newUrl = buildWindyEmbedUrl(stream.embedUrl, dims.width, dims.height);
          if (iframe.src !== newUrl) {
            iframe.src = newUrl;
          }
        }
      }
    }
  }

  function onGridImgLoad(streamId) {
    if (typeof streamId !== 'string') return;
    gridImageErrors.delete(streamId);
    if (!lastImageRefreshedAt.has(streamId)) {
      lastImageRefreshedAt.set(streamId, Date.now());
    }
    updateGridTimestampDom(streamId);
    const rawStreams = resolveRawStreams();
    const stream = rawStreams.find(s => s.id === streamId);
    if (stream && stream.sourceType === 'still-image') {
      probeLastModified(stream);
    }
  }

  function onGridImgError(streamId) {
    if (typeof streamId !== 'string') return;
    clearGridImageTimer(streamId);
    gridImageErrors.add(streamId);
    notifyChange();
  }

  function retryGridImage(streamId) {
    if (typeof streamId !== 'string') return;
    gridImageErrors.delete(streamId);
    const rawStreams = resolveRawStreams();
    const stream = rawStreams.find(s => s.id === streamId);
    if (stream && stream.imageUrl) {
      lastImageRefreshedAt.set(streamId, Date.now());
      startGridImageTimer(stream);
    }
    notifyChange();
  }

  function clearCameraTimer(streamId) {
    if (cameraTimers.has(streamId)) {
      const timer = cameraTimers.get(streamId);
      if (typeof window !== 'undefined' && typeof window.clearInterval === 'function') {
        window.clearInterval(timer);
      } else {
        clearInterval(timer);
      }
      cameraTimers.delete(streamId);
    }
  }

  function clearAllCameraTimers() {
    for (const [, timer] of cameraTimers.entries()) {
      if (typeof window !== 'undefined' && typeof window.clearInterval === 'function') {
        window.clearInterval(timer);
      } else {
        clearInterval(timer);
      }
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
    const timer = window.setInterval(() => {
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
        const evicted = activeStreamIds.slice(0, activeStreamIds.length - max);
        for (const eid of evicted) {
          cleanupGridSlot(eid);
        }
        activeStreamIds = activeStreamIds.slice(activeStreamIds.length - max);
      }
      updateWindyOnViewModeChange(mode);
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

  function canStreamPlayInGrid(stream) {
    if (!stream) return false;
    if (stream.sourceType === 'youtube') {
      return isEmbeddableStream(stream);
    }
    if (stream.sourceType === 'embed' && stream.embedUrl && stream.embedUrl.includes('videa.hu')) {
      return isEmbeddableStream(stream);
    }
    const isPrivate = isPrivateOrLocalHost();
    if (!isPrivate) return false;
    if (stream.sourceType === 'hls' || Boolean(stream.streamUrl)) {
      return true;
    }
    if (stream.sourceType === 'embed' || Boolean(stream.embedUrl)) {
      return true;
    }
    if (stream.sourceType === 'still-image' || Boolean(stream.imageUrl)) {
      return true;
    }
    return false;
  }

  function loadFirstFourIntoGrid() {
    if (!isPrivateOrLocalHost()) return;
    if (viewMode !== 'grid') {
      setViewMode('grid');
    }
    const rawStreams = resolveRawStreams();
    const available = rawStreams.filter(s => canStreamPlayInGrid(s));
    const defaultAvailable = DEFAULT_GROUP_CAMERA_IDS.filter(id => available.some(s => s.id === id));
    const toLoad = defaultAvailable.length === 4
      ? Array.from(DEFAULT_GROUP_CAMERA_IDS)
      : available.slice(0, 4).map(s => s.id);

    // Evict any currently active streams that are not in toLoad
    const unwanted = activeStreamIds.filter(id => !toLoad.includes(id));
    for (const uid of unwanted) {
      cleanupGridSlot(uid);
    }
    activeStreamIds = activeStreamIds.filter(id => toLoad.includes(id));

    // Fill missing streams from toLoad
    for (const sid of toLoad) {
      if (!activeStreamIds.includes(sid)) {
        playStream(sid);
      }
    }
    activeStreamIds = toLoad.filter(id => activeStreamIds.includes(id));
    notifyChange();
  }

  const loadCamerasIntoGrid = loadFirstFourIntoGrid;

  function playStream(streamId) {
    if (typeof streamId !== 'string' || !streamId.trim()) return;
    const rawStreams = resolveRawStreams();
    const stream = rawStreams.find(s => s.id === streamId);
    if (!stream || !canStreamPlayInGrid(stream)) return;
    gridImageErrors.delete(streamId);
    if (typeof streamId !== 'string' || !streamId.trim()) return;
    errorStreams.delete(streamId);
    ensureAudioState(streamId);

    const max = getMaxPlayers();
    const existingIdx = activeStreamIds.indexOf(streamId);
    if (existingIdx !== -1) {
      if (max === 1) {
        activeStreamIds = [streamId];
      }
      notifyChange();
      return;
    }

    let evicted = null;
    if (max === 1) {
      if (activeStreamIds.length > 0) {
        evicted = activeStreamIds[0];
      }
      activeStreamIds = [streamId];
    } else {
      if (activeStreamIds.length >= max) {
        evicted = activeStreamIds[0];
        activeStreamIds = [...activeStreamIds.slice(1), streamId];
      } else {
        activeStreamIds = [...activeStreamIds, streamId];
      }
    }

    if (evicted && evicted !== streamId) {
      cleanupGridSlot(evicted);
    }

    if (stream.imageUrl) {
      lastImageRefreshedAt.set(streamId, Date.now());
      startGridImageTimer(stream);
      if (stream.sourceType === 'still-image') {
        probeLastModified(stream);
      }
    }

    notifyChange();
  }

  function stopStream(streamId) {
    if (typeof streamId === 'string' && streamId.trim()) {
      const next = activeStreamIds.filter(id => id !== streamId);
      if (next.length !== activeStreamIds.length) {
        cleanupGridSlot(streamId);
        activeStreamIds = next;
        notifyChange();
      }
      return;
    }
    if (activeStreamIds.length > 0) {
      for (const sid of activeStreamIds) {
        cleanupGridSlot(sid);
      }
      activeStreamIds = [];
      notifyChange();
    }
  }

  function stopAllStreams() {
    if (activeStreamIds.length > 0) {
      activeStreamIds = [];
    }
    clearAllCameraTimers();
    clearAllGridImageTimers();
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
    playStream(streamId);
    return true;
  }

  function unloadEmbed(streamId) {
    stopStream(streamId);
  }

  function isEmbedActive(streamId) {
    return activeStreamIds.includes(streamId);
  }

  function loadCamera(streamId) {
    if (!isPrivateOrLocalHost()) return;
    if (activeStreamIds.length >= MAX_GROUP_CAMERAS && !activeStreamIds.includes(streamId)) {
      cameraNotice = CAMERA_LIMIT_NOTICE_TEXT;
      notifyChange();
      return;
    }
    cameraNotice = '';
    playStream(streamId);
    if (activeStreamIds.length >= MAX_GROUP_CAMERAS) {
      cameraNotice = CAMERA_LIMIT_NOTICE_TEXT;
    }
  }

  function unloadCamera(streamId) {
    stopStream(streamId);
    if (activeStreamIds.length < MAX_GROUP_CAMERAS) {
      cameraNotice = '';
    }
  }

  function loadAllCameras() {
    loadFirstFourIntoGrid();
    if (activeStreamIds.length >= MAX_GROUP_CAMERAS) {
      cameraNotice = CAMERA_LIMIT_NOTICE_TEXT;
    }
  }

  function unloadAllCameras() {
    stopAllStreams();
    cameraNotice = '';
  }

  function onCameraImgError(streamId) {
    onGridImgError(streamId);
  }

  function onCameraImgLoad(streamId) {
    onGridImgLoad(streamId);
  }

  function retryCamera(streamId) {
    retryGridImage(streamId);
  }

  function isCameraActive(streamId) {
    return activeStreamIds.includes(streamId);
  }

  function getCameraError(streamId) {
    return gridImageErrors.has(streamId) ? { error: true } : null;
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
      case 'delayed': return 'Késleltetett (60 perc)';
      case 'archive': return 'Archívum';
      case 'no-live-feed': return 'Nincs közvetítés';
      case 'unverified': return 'Nem ellenőrzött';
      default: return status || '';
    }
  }

  function getEmbedStatusInfo(stream) {
    if (!stream) return { code: 'unverified', label: 'Nem ellenőrzött' };
    if (stream.sourceType === 'still-image') {
      return { code: 'embeddable', label: 'Beágyazható állókép' };
    }
    if (stream.embedKind === 'windy-widget') {
      return { code: 'embeddable', label: 'Beágyazható widget' };
    }
    if (stream.embedStatus === 'external-only' || stream.sourceType === 'link-only') {
      return { code: 'external-only', label: 'Csak külső oldalon nézhető' };
    }
    if (stream.status === 'unverified' || stream.embedStatus === 'unverified') {
      return { code: 'unverified', label: 'Nem beágyazható' };
    }
    if (stream.sourceType === 'embed') {
      return { code: 'embeddable', label: 'Beágyazható' };
    }
    if (stream.sourceType === 'hls') {
      return { code: 'embeddable', label: 'Beágyazható HLS' };
    }
    if (stream.sourceType === 'youtube' && YOUTUBE_VIDEO_ID_REGEX.test(stream.videoId || '')) {
      return { code: 'embeddable', label: 'Beágyazható' };
    }
    return { code: 'unverified', label: 'Nem beágyazható' };
  }

  function isEmbeddableStream(stream) {
    if (!stream || stream.embedStatus === 'external-only' || stream.status === 'unverified') {
      return false;
    }
    if (stream.sourceType === 'youtube') {
      return YOUTUBE_VIDEO_ID_REGEX.test(stream.videoId || '');
    }
    if (stream.sourceType === 'embed') {
      return Boolean(stream.embedUrl && (
        stream.embedUrl.startsWith('https://videa.hu/') ||
        stream.embedUrl.startsWith('https://embed.windy.com/') ||
        stream.embedUrl.startsWith('https://g0.ipcamlive.com/')
      ));
    }
    if (stream.sourceType === 'hls') {
      return Boolean(stream.streamUrl && stream.streamUrl.startsWith('https://'));
    }
    return false;
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

    const regionLabel = REGION_LABELS[stream.region] || stream.region;
    const typeLabel = TYPE_LABELS[stream.type] || stream.type;
    const pageStatusLabel = getPageStatusLabel(stream.status);

    // 0. HLS Élő videostream (pl. Debreceni Egyetem Klinikai Központ)
    if (stream.sourceType === 'hls' || Boolean(stream.streamUrl)) {
      return `
        <div class="lm-stage-slot lm-stage-slot-active lm-stage-slot-hls" id="lm-stage-slot-${esc(stream.id)}" data-active-stream-id="${esc(stream.id)}">
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
              <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Forrás (${esc(stream.provider)}) ↗</a>
            </div>
          </div>
          <div class="lm-player-box">
            <div class="lm-video-aspect">
              <video
                id="lm-hls-video-${esc(stream.id)}"
                class="lm-video-player"
                controls
                playsinline
                data-stream-url="${esc(stream.streamUrl)}"
                style="width: 100%; height: 100%; object-fit: contain; background: #000;">
              </video>
            </div>
            <div class="lm-player-bar lm-hls-bar">
              <span class="lm-hls-indicator">● Élő HLS közvetítés (Full HD)</span>
              <div class="lm-player-right-controls">
                <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.stopStream('${esc(stream.id)}')">■ Leállítás</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 1. Embed Widget (pl. Windy)
    if (stream.sourceType === 'embed' || (Boolean(stream.embedUrl) && stream.sourceType !== 'still-image')) {
      const isWindy = stream.embedKind === 'windy-widget' || Boolean(stream.embedUrl && stream.embedUrl.includes('windy.com'));
      const dims = isWindy ? (lastWindyDimensions.get(stream.id) || getWindySlotDimensions()) : null;
      if (isWindy && dims) {
        lastWindyDimensions.set(stream.id, dims);
      }
      const initialEmbedUrl = (isWindy && dims && dims.width && dims.height)
        ? buildWindyEmbedUrl(stream.embedUrl, dims.width, dims.height)
        : stream.embedUrl;

      return `
        <div class="lm-stage-slot lm-stage-slot-active lm-stage-slot-embed" id="lm-stage-slot-${esc(stream.id)}" data-active-stream-id="${esc(stream.id)}" data-video-id="">
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
              <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Forrás (${esc(stream.provider || 'Külső')}) ↗</a>
            </div>
          </div>
          <div class="lm-player-box">
            <div class="lm-iframe-aspect"${isWindy ? ` data-windy-stream-id="${esc(stream.id)}"` : ''}>
              <iframe
                id="lm-stage-embed-${esc(stream.id)}"
                class="lm-grid-embed-frame"
                src="${esc(initialEmbedUrl)}"
                title="${esc(stream.name)}"
                loading="lazy"
                referrerpolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-popups" allow="autoplay; fullscreen" allowfullscreen>
              </iframe>
            </div>
            <div class="lm-player-bar lm-embed-bar">
              <span class="lm-embed-disclaimer">${esc(stream.embedKind === 'windy-widget' ? WINDY_DISCLAIMER_TEXT : (stream.embedUrl && stream.embedUrl.includes('videa.hu') ? 'Késleltetett adás (60 perc) · Forrás: Hír TV / Videa' : (stream.attribution || '')))}</span>
              <div class="lm-player-right-controls">
                <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.stopStream('${esc(stream.id)}')">■ Leállítás</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 2. Webkamera vagy Állókép (Időkép 60 mp vagy Schumann 30 perc)
    if (stream.sourceType === 'still-image' || Boolean(stream.imageUrl)) {
      const isError = gridImageErrors.has(stream.id);
      const isStillImage = stream.sourceType === 'still-image';
      const intervalLabel = isStillImage ? 'Állókép · 30 perc' : 'Állókép · 60 mp';
      const refTs = lastImageRefreshedAt.get(stream.id);
      const refreshedText = `Frissítve: ${formatTimeString(refTs)}`;
      const lmHeader = streamLastModified.get(stream.id) || null;
      const freshness = isStillImage ? computeFreshnessBadge(lmHeader) : null;

      return `
        <div class="lm-stage-slot lm-stage-slot-active lm-stage-slot-camera" id="lm-stage-slot-${esc(stream.id)}" data-active-stream-id="${esc(stream.id)}" data-video-id="">
          <div class="lm-stage-slot-head">
            <div class="lm-stage-slot-meta">
              <span class="lm-live-dot" aria-hidden="true"></span>
              <span class="lm-card-type-badge lm-type-${esc(stream.type)}">${esc(typeLabel)}</span>
              <span class="lm-card-region-badge">${esc(regionLabel)}</span>
              ${isStillImage ? `
                <span class="lm-badge lm-badge-still">Állókép</span>
                ${freshness ? `<span id="lm-grid-freshness-head-${esc(stream.id)}" class="lm-freshness-badge ${esc(freshness.className)}" title="Forrás utolsó módosítása (Last-Modified): ${esc(lmHeader || 'n/a')}">${esc(freshness.label)}</span>` : ''}
              ` : `
                <span class="lm-badge lm-badge-${esc(stream.status)}">${esc(pageStatusLabel)}</span>
              `}
              <strong class="lm-stage-slot-title">${esc(stream.name)}</strong>
              <span class="lm-stage-slot-provider">(${esc(stream.provider)})</span>
            </div>
            <div class="lm-stage-slot-top-actions">
              <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Forrás ↗</a>
            </div>
          </div>
          <div class="lm-player-box">
            ${isError ? `
              <div class="lm-camera-fallback-box lm-grid-error-box" role="alert">
                <div class="lm-camera-fallback-title">⚠ Nem tölthető be – megnyitás a forráson</div>
                <div class="lm-camera-fallback-desc">A kép közvetlen betöltése nem sikerült vagy a kapcsolat időtúllépéssel megszakadt.</div>
                <div class="lm-camera-fallback-actions">
                  <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">Megnyitás a forráson ↗</a>
                  <button type="button" class="lm-btn lm-btn-retry" onclick="window.CrucixLiveMedia?.retryGridImage('${esc(stream.id)}')">Újrapróbálás</button>
                  <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.stopStream('${esc(stream.id)}')">Bezárás</button>
                </div>
              </div>
            ` : `
              <div class="lm-grid-img-wrap">
                <img
                  id="lm-grid-img-${esc(stream.id)}"
                  class="lm-grid-camera-img"
                  src="${esc(buildGridImageUrl(stream.imageUrl))}"
                  alt="${esc(stream.name)}"
                  loading="eager"
                  referrerpolicy="no-referrer"
                  onload="window.CrucixLiveMedia?.onGridImgLoad('${esc(stream.id)}')"
                  onerror="window.CrucixLiveMedia?.onGridImgError('${esc(stream.id)}')" />
              </div>
              <div class="lm-player-bar lm-camera-bar">
                <div class="lm-camera-bar-left">
                  <span class="lm-camera-interval-badge">${esc(intervalLabel)}</span>
                  ${freshness ? `
                    <span
                      id="lm-grid-freshness-${esc(stream.id)}"
                      class="lm-freshness-badge ${esc(freshness.className)}"
                      title="Forrás utolsó módosítása (Last-Modified): ${esc(lmHeader || 'n/a')}">
                      ${esc(freshness.label)}
                    </span>
                  ` : ''}
                  <span class="lm-camera-refreshed" id="lm-grid-ts-${esc(stream.id)}">${esc(refreshedText)}</span>
                  <span class="lm-camera-attribution">${esc(stream.attribution || ('Forrás: ' + (stream.provider || 'Időkép / idokep.hu')))}</span>
                </div>
                <div class="lm-player-right-controls">
                  <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.stopStream('${esc(stream.id)}')">■ Bezárás</button>
                </div>
              </div>
            `}
          </div>
        </div>
      `;
    }

    // 3. YouTube stream (híradók)
    const embedUrl = buildSafeEmbedUrl(stream.videoId);
    const watchUrl = buildSafeWatchUrl(stream.videoId);
    const audio = ensureAudioState(stream.id);

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

    if (stream.sourceType === 'hls' || Boolean(stream.streamUrl)) {
      const isPlaying = activeStreamIds.includes(stream.id);
      return `
        <article class="lm-card lm-card-embeddable${isPlaying ? ' playing' : ''}" id="lm-card-${esc(stream.id)}" data-stream-id="${esc(stream.id)}">
          <div class="lm-card-head">
            <div class="lm-card-title-row">
              <span class="lm-card-type-badge lm-type-${esc(stream.type)}">${esc(typeLabel)}</span>
              <span class="lm-card-region-badge">${esc(regionLabel)}</span>
              <span class="lm-card-lang-badge">${esc(langCode)}</span>
              <span class="lm-status-pill lm-badge-external-source" title="Közvetlen HLS videófolyam (Crucix szerver nem proxyzza)">élő HLS</span>
              <span class="lm-card-title">${esc(stream.name)}</span>
            </div>
            <div class="lm-card-provider">${esc(stream.provider)}</div>
            <div class="lm-dual-status-row">
              <span class="lm-status-pill lm-page-status lm-badge-${esc(stream.status)}">
                Állapot: ${esc(pageStatusLabel)}
              </span>
              <span class="lm-status-pill lm-embed-status lm-embed-embeddable">
                Beágyazhatóság: Beágyazható
              </span>
            </div>
          </div>
          <div class="lm-card-body">
            ${isPlaying ? `
              <div class="lm-selector-active-bar">
                <span class="lm-selector-playing-indicator"><span class="lm-live-dot"></span> Lejátszás folyamatban a rácsban</span>
                <div class="lm-selector-btns">
                  <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.stopStream('${esc(stream.id)}')">■ Leállítás</button>
                  <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-link-external">Forrás ↗</a>
                </div>
              </div>
            ` : `
              <div class="lm-selector-idle-bar">
                <div class="lm-placeholder-privacy">${esc(UNIDEB_PRIVACY_NOTICE_TEXT)}</div>
                <button type="button" class="lm-btn lm-btn-play" onclick="window.CrucixLiveMedia?.playStream('${esc(stream.id)}')">
                  ▶ Élő HLS közvetítés indítása (Full HD)
                </button>
              </div>
            `}
          </div>
          ${stream.notes ? `<div class="lm-card-footer"><span class="lm-card-notes">${esc(stream.notes)}</span></div>` : ''}
        </article>
      `;
    }

    const isIpcam = Boolean(stream.embedUrl && stream.embedUrl.includes('ipcamlive.com'));
    const isWindy = stream.embedKind === 'windy-widget' || Boolean(stream.embedUrl && stream.embedUrl.includes('windy.com'));
    if (stream.sourceType === 'link-only' || stream.sourceType === 'still-image' || isWindy || isIpcam || embedInfo.code === 'external-only') {
      const isPrivateHost = isPrivateOrLocalHost();
      const canPlay = canStreamPlayInGrid(stream);

      let externalBodyHtml = '';
      if (isPlaying) {
        externalBodyHtml = `
          <div class="lm-selector-active-bar">
            <span class="lm-selector-playing-indicator"><span class="lm-live-dot"></span> Lejátszás folyamatban a rácsban</span>
            <div class="lm-selector-btns">
              <button type="button" class="lm-btn lm-btn-stop" onclick="window.CrucixLiveMedia?.stopStream('${esc(stream.id)}')">■ Leállítás</button>
              <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">Megnyitás a szolgáltató oldalán ↗</a>
            </div>
          </div>
        `;
      } else if (isPrivateHost && canPlay) {
        let privacyNoticeText = '';
        if (isWindy) {
          privacyNoticeText = WINDY_PRIVACY_NOTICE_TEXT;
        } else if (isIpcam) {
          privacyNoticeText = IPCAMLIVE_PRIVACY_NOTICE_TEXT;
        } else if (stream.sourceType === 'still-image') {
          privacyNoticeText = 'A kép betöltése kapcsolatot létesít a forrással (' + (stream.provider || 'IK1QFK / vlf.it') + '); a Crucix nem tárolja.';
        } else {
          privacyNoticeText = CAMERA_PRIVACY_NOTICE_TEXT;
        }

        externalBodyHtml = `
          <div class="lm-camera-privacy-box">
            <span class="lm-camera-privacy-text">${esc(privacyNoticeText)}</span>
          </div>
          <div class="lm-external-actions">
            <button type="button" class="lm-btn lm-btn-play lm-btn-load-grid" onclick="window.CrucixLiveMedia?.playStream('${esc(stream.id)}')">
              ▶ Betöltés a rácsba
            </button>
            <a href="${esc(stream.url)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">
              Megnyitás a szolgáltató oldalán ↗
            </a>
          </div>
        `;
      } else {
        externalBodyHtml = `
          ${!isPrivateHost && canPlay ? `
            <div class="lm-camera-restricted-box">
              <span class="lm-camera-restricted-text">ℹ A közvetlen adatfolyam kizárólag privát helyi hálózatról (LAN / loopback) tölthető be (magáncélú felhasználás védelme).</span>
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
        <article class="lm-card lm-card-external${isWindy ? ' lm-card-windy' : ''}${isPlaying ? ' camera-active' : ''}" id="lm-card-${esc(stream.id)}" data-stream-id="${esc(stream.id)}" data-embed-status="external-only">
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
              ${stream.sourceType === 'still-image' ? `
                <span class="lm-status-pill lm-page-status lm-badge-still" title="Típus">
                  Állókép
                </span>
                <span class="lm-status-pill lm-freshness-badge ${esc(computeFreshnessBadge(streamLastModified.get(stream.id) || null).className)}" title="${streamLastModified.get(stream.id) ? `Forrás utolsó módosítása (Last-Modified): ${esc(streamLastModified.get(stream.id))}` : (streamMetaErrors.get(stream.id) ? `Frissesség nem igazolt: ${esc(streamMetaErrors.get(stream.id))}` : 'Frissesség nem igazolt')}">
                  ${esc(computeFreshnessBadge(streamLastModified.get(stream.id) || null).label)}
                </span>
                <span class="lm-status-pill lm-embed-status lm-embed-external-only" title="Beágyazhatóság">
                  Beágyazhatóság: ${esc(embedInfo.label)}
                </span>
              ` : `
                <span class="lm-status-pill lm-page-status lm-badge-${esc(stream.status)}" title="Forrásoldal állapota">
                  Forrásoldalon: ${esc(pageStatusLabel)}
                </span>
                <span class="lm-status-pill lm-embed-status lm-embed-external-only" title="Beágyazhatóság">
                  Beágyazhatóság: ${esc(embedInfo.label)}
                </span>
              `}
            </div>
          </div>
          <div class="lm-card-body lm-external-body">
            ${stream.notes ? `<div class="lm-external-notes">${esc(stream.notes)}</div>` : ''}
            ${externalBodyHtml}
          </div>
        </article>
      `;
    }

    const isPlayable = (stream.sourceType === 'youtube' && isValidId) ||
                       (stream.sourceType === 'embed' && Boolean(stream.embedUrl)) ||
                       (stream.sourceType === 'hls' && Boolean(stream.streamUrl));

    let actionAreaHtml = '';
    if (!isPlayable || isError) {
      const backoffSec = retryBackoff.get(stream.id) || 5;
      const watchUrl = isValidId ? buildSafeWatchUrl(stream.videoId) : stream.url;
      const watchLabel = stream.sourceType === 'youtube' ? 'Megnyitás a forráson (YouTube) ↗' : 'Megnyitás a forráson ↗';
      actionAreaHtml = `
        <div class="lm-error-box" role="alert">
          <div class="lm-error-text">⚠ A közvetítés jelenleg nem ágyazható be vagy nem érhető el.</div>
          <div class="lm-error-actions">
            ${watchUrl ? `<a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" class="lm-btn lm-btn-external">${esc(watchLabel)}</a>` : ''}
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
      const watchUrl = isValidId ? buildSafeWatchUrl(stream.videoId) : stream.url;
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
    const activeExternalFiltered = externalFiltered.filter(s => !isCameraStale(s));
    const hiddenStaleSources = externalFiltered.filter(s => isCameraStale(s));
    const externalCams = activeExternalFiltered.filter(s => Boolean(s.imageUrl));
    const anyCamActive = externalCams.some(s => activeCameraIds.has(s.id));
    const showLimitNotice = cameraNotice || (activeCameraIds.size >= MAX_GROUP_CAMERAS ? CAMERA_LIMIT_NOTICE_TEXT : '');

    const staleTooltipText = buildHiddenSourcesTooltip(hiddenStaleSources);

    const externalContent = (activeExternalFiltered.length > 0 || hiddenStaleSources.length > 0)
      ? `
        <div class="lm-external-section" id="lm-external-section">
          <div class="lm-section-head">
            <div class="lm-section-title-wrap">
              <span class="lm-section-title">Külső oldalon nézhető</span>
              <span class="lm-count-badge">${activeExternalFiltered.length} forrás</span>
              ${hiddenStaleSources.length > 0 ? `
                <span class="lm-stale-counter-badge" id="lm-stale-counter-badge" title="${esc(staleTooltipText)}">
                  ${hiddenStaleSources.length} forrás elrejtve
                </span>
              ` : ''}
            </div>
            ${showLimitNotice && isPrivateHost ? `
              <div class="lm-camera-limit-notice" role="status" id="lm-camera-limit-notice">
                ${esc(showLimitNotice)}
              </div>
            ` : ''}
            <span class="lm-section-sub">A szolgáltató hivatalos külső beágyazást nem biztosít (pl. X-Frame-Options korlátozás); a kamerák és adások közvetlenül a forrásoldalon érhetők el.</span>
          </div>
          <div class="lm-external-grid scroll-region" tabindex="0" role="region" aria-label="Külső oldalon nézhető adások listája">
            ${activeExternalFiltered.map(renderStreamCard).join('')}
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
    const providersNotice = getGroupCameraProvidersNotice(rawStreams);

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
        <button type="button" class="lm-btn lm-btn-toolbar lm-btn-grid-load" id="lm-btn-cameras-to-grid" onclick="window.CrucixLiveMedia?.loadFirstFourIntoGrid()" title="Az első 4 forrás betöltése a 2×2 rácsba (${esc(providersNotice)})">
          ▶ Első 4 betöltése a rácsba
        </button>
        <span class="lm-group-providers-notice" title="A 4 forrás által használt külső szolgáltatók: ${esc(providersNotice)}">Szolgáltatók: ${esc(providersNotice)}</span>
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
        const matchVideo = targetStream && (targetStream.videoId ? targetStream.videoId === vid : true);
        const isImgError = gridImageErrors.has(sid);
        if (sid && activeIds.includes(sid) && targetStream && matchVideo && !isImgError) {
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

      // 2b. Initialize HLS instances for active HLS streams
      if (typeof window !== 'undefined') {
        for (const sid of activeIds) {
          const s = byId.get(sid);
          if (s && (s.sourceType === 'hls' || Boolean(s.streamUrl))) {
            const videoEl = document.getElementById(`lm-hls-video-${sid}`);
            if (videoEl && !videoEl.dataset.hlsAttached) {
              videoEl.dataset.hlsAttached = 'true';
              if (window.Hls && typeof window.Hls.isSupported === 'function' && window.Hls.isSupported()) {
                const hls = new window.Hls({ enableWorker: true });
                hlsInstances.set(sid, hls);
                hls.loadSource(s.streamUrl);
                hls.attachMedia(videoEl);
                hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                  videoEl.play().catch(() => {});
                });
                hls.on(window.Hls.Events.ERROR, (_evt, data) => {
                  if (data && data.fatal) {
                    markStreamError(sid);
                  }
                });
              } else if (videoEl.canPlayType && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                videoEl.src = s.streamUrl;
                videoEl.play().catch(() => {});
              }
            }
          }
        }
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
        clearAllGridImageTimers();
        if (!allowBackgroundPlayback) {
          const rawStreams = resolveRawStreams();
          const byId = new Map(rawStreams.map(s => [s.id, s]));
          const videoStreamIds = activeStreamIds.filter(sid => {
            const s = byId.get(sid);
            return s && (s.sourceType === 'youtube' || s.sourceType === 'hls' || s.sourceType === 'embed' || Boolean(s.embedUrl));
          });
          for (const vid of videoStreamIds) {
            stopStream(vid);
          }
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
        if (activeStreamIds.length > 0) {
          const rawStreams = resolveRawStreams();
          const byId = new Map(rawStreams.map(s => [s.id, s]));
          for (const sid of activeStreamIds) {
            const stream = byId.get(sid);
            if (stream && stream.imageUrl && !gridImageErrors.has(sid)) {
              refreshGridDomImage(sid, stream.imageUrl);
              startGridImageTimer(stream);
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
    MAX_GROUP_CAMERAS,
    CAMERA_LIMIT_NOTICE_TEXT,
    DEFAULT_GROUP_CAMERA_IDS,
    loadCamerasIntoGrid,
    loadFirstFourIntoGrid,
    canStreamPlayInGrid,
    onGridImgLoad,
    onGridImgError,
    retryGridImage,
    STILL_IMAGE_REFRESH_INTERVAL_MS,
    getLastImageRefreshedAt: (streamId) => lastImageRefreshedAt.get(streamId),
    isGridImageError: (streamId) => gridImageErrors.has(streamId),
    getActiveCameraCount: () => activeStreamIds.length,
    getActiveCameraIds: () => Array.from(activeStreamIds),
    getCameraNotice: () => cameraNotice,
    WINDY_PRIVACY_NOTICE_TEXT,
    WINDY_DISCLAIMER_TEXT,
    computeFreshnessBadge,
    getStreamLastModified: (streamId) => streamLastModified.get(streamId),
    getStreamMetaError: (streamId) => streamMetaErrors.get(streamId),
    setStreamLastModified: (streamId, lm) => {
      streamLastModified.set(streamId, lm);
      if (lm) streamMetaErrors.delete(streamId);
      updateGridFreshnessDom(streamId);
    },
    probeLastModified: (stream) => probeLastModified(stream),
    isCameraStale: (stream) => isCameraStale(stream),
    isSourceHidden: (stream) => isSourceHidden(stream),
    getStaleReason: (stream) => getStaleReason(stream),
    getSourceHiddenReason: (stream) => getSourceHiddenReason(stream),
    getSourceHiddenCategory: (stream) => getSourceHiddenCategory(stream),
    buildHiddenSourcesTooltip: (sources) => buildHiddenSourcesTooltip(sources),
    setCameraError: (streamId) => { cameraErrorStates.set(streamId, { timestamp: Date.now() }); },
    clearCameraError: (streamId) => { cameraErrorStates.delete(streamId); },
    setStreamMetaError: (streamId, err) => { streamMetaErrors.set(streamId, err); },
    clearStreamMetaError: (streamId) => { streamMetaErrors.delete(streamId); },
    buildWindyEmbedUrl,
    extractMediaDomain,
    getGroupCameraProvidersCounts,
    getGroupCameraProvidersNotice,
    getWindySlotDimensions,
    IPCAMLIVE_PRIVACY_NOTICE_TEXT,
    UNIDEB_PRIVACY_NOTICE_TEXT
  });

})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : {});
