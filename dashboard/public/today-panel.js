(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrucixTodayPanel = factory();
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const MISSING = '—';

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const valueOf = (obj, keys) => {
    for (const key of keys) {
      const value = obj?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  };
  const text = (value, fallback = MISSING) => value === undefined || value === null || value === '' ? fallback : String(value);
  const metric = (value, unit = '') => value === null || value === undefined || value === '' ? MISSING : `${text(value)}${unit}`;
  const number = (value, decimals = 1) => finite(value) ? value.toFixed(decimals).replace('.', ',') : text(value);

  function source(snapshot, names, direct = []) {
    const sources = object(snapshot?.sources) ? snapshot.sources : {};
    for (const name of [...direct, ...names]) {
      const candidate = snapshot?.[name] ?? sources[name];
      if (candidate !== undefined && candidate !== null) return candidate;
      const found = Object.keys(sources).find(key => key.toLowerCase() === String(name).toLowerCase());
      if (found) return sources[found];
    }
    return null;
  }

  function payload(candidate) {
    if (!object(candidate)) return candidate;
    if (candidate.data !== undefined) return candidate.data;
    if (candidate.payload !== undefined) return candidate.payload;
    return candidate;
  }

  function hasData(candidate) {
    const data = payload(candidate);
    if (data === null || data === undefined || data === '') return false;
    if (Array.isArray(data)) return data.length > 0;
    if (!object(data)) return true;
    return Object.keys(data).some(key => key !== 'enabled' && key !== 'fresh' && key !== 'isFresh' && key !== 'stale');
  }

  function status(candidate) {
    if (candidate?.enabled === false) return ['KIKAPCSOLVA', 'tp-pill-off'];
    if (!hasData(candidate)) return ['NINCS ADAT', 'tp-pill-nodata'];
    if (candidate?.stale === true || candidate?.fresh === false || candidate?.isFresh === false ||
        candidate?.status === 'stale' || candidate?.status === 'error') return ['ELAVULT', 'tp-pill-stale'];
    return ['FRISS', 'tp-pill-fresh'];
  }

  function icon(category) {
    try {
      if (typeof window !== 'undefined' && window.CrucixIcons?.renderIcon) {
        return window.CrucixIcons.renderIcon(category, { size: 16 });
      }
    } catch { /* an icon is decorative; text remains available */ }
    return `<span class="tp-icon-fallback" aria-hidden="true">◌</span>`;
  }

  function time(value) {
    if (!value) return MISSING;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return esc(value);
    return esc(date.toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' }));
  }

  function renderTile(tile) {
    const badge = tile.badge || ['NINCS ADAT', 'tp-pill-nodata'];
    return `<article class="today-tile" data-today-tile="${esc(tile.id)}">` +
      `<div class="today-tile-head"><div class="today-tile-title">${icon(tile.category)}<h4>${esc(tile.title)}</h4></div>` +
      `<span class="tp-pill ${esc(badge[1])}">${esc(badge[0])}</span></div>` +
      `<div class="today-tile-body">${tile.body || `<p class="tp-empty">${MISSING}</p>`}</div>` +
      `<div class="today-tile-foot">${tile.time ? `<time>${tile.time}</time>` : ''}<a href="${esc(tile.href)}">${esc(tile.linkLabel || 'Megnyitás')} ↗</a></div>` +
      `</article>`;
  }

  function dataTiles(snapshot) {
    const sn = object(snapshot) ? snapshot : {};
    const weather = object(sn.weather) ? sn.weather : {};
    const meteo = source(sn, ['Meteoalarm', 'meteoalarm'], ['meteoalarm']);
    const meteoData = payload(meteo) || {};
    const observed = source(sn, ['HungaroMet-Observations', 'hungarometObs'], []) || weather.observed;
    const observedData = payload(observed) || {};
    const forecast = source(sn, ['Open-Meteo', 'openMeteo', 'Weather-Service'], []) || weather.forecast || weather.byRegion?.local;
    const forecastData = payload(forecast) || {};
    const hydro = sn.ovfGauges || weather.ovfGauges || source(sn, ['OVF-Gauges', 'ovfGauges']);
    const hydroData = payload(hydro) || {};
    const drought = sn.ovfDrought || weather.ovfDrought || source(sn, ['ovfDrought', 'OVF-Drought']);
    const droughtData = payload(drought) || {};
    const sw = sn.spaceWeather || source(sn, ['Space-Weather', 'NOAA-SWPC', 'GFZ-Potsdam']);
    const swData = payload(sw) || {};
    const police = source(sn, ['Police-Hajdu', 'policeHajdu', 'police']);
    const policeData = payload(police) || {};
    const local = source(sn, ['localNews', 'news', 'RSS-HAON', 'RSS-Dehir', 'RSS-Katved']);
    const localData = payload(local) || {};

    const meteoAlert = Array.isArray(meteoData.alerts) ? meteoData.alerts[0] : (meteoData.alert || meteoData);
    const station = observedData.stations?.['65305'] || observedData.station || (Array.isArray(observedData.stations) ? observedData.stations[0] : observedData);
    const gauge = (hydroData.gauges || []).find(item => item.isPrimary || /beretty/i.test(item.name || '')) || hydroData.gauge || hydroData;
    const soil = droughtData.soilMoisture || {};
    const newsItem = Array.isArray(policeData.items) ? policeData.items[0] : (policeData.latest || policeData);
    const localItem = Array.isArray(localData.items) ? localData.items[0] : (localData.latest || localData);
    const forecastDay = forecastData.daily || forecastData.today || forecastData;
    const scales = swData.scales || {};

    return [
      {
        id: 'meteoalarm', category: 'weather', title: 'Meteoalarm · Hajdú-Bihar', href: '#alerts',
        badge: status(meteo), time: time(valueOf(meteoAlert, ['onset', 'effective', 'publishedAt'])),
        body: `<div class="tp-main">${esc(text(valueOf(meteoAlert, ['event', 'eventType', 'title']), 'Nincs aktív figyelmeztetés'))}</div>` +
          `<div class="tp-detail">Fokozat: <strong>${esc(text(valueOf(meteoAlert, ['severity', 'level'])))}</strong> · ${esc(text(valueOf(meteoAlert, ['status']), 'aktív'))}</div>`
      },
      {
        id: 'hungaromet', category: 'weather', title: 'HungaroMet mért adat · Berettyóújfalu', href: '#weather',
        badge: status(observed), time: time(valueOf(station, ['observedAt', 'timestamp']) || valueOf(observedData, ['timestamp'])),
        body: `<div class="tp-metrics"><span>Hőmérséklet <strong>${metric(valueOf(station, ['temperatureC', 'temperature']), ' °C')}</strong></span>` +
          `<span>Szél <strong>${metric(valueOf(station, ['windSpeedKmh', 'windSpeed']), ' km/h')}</strong></span>` +
          `<span>Nyomás <strong>${metric(valueOf(station, ['pressureHpa', 'pressure']), ' hPa')}</strong></span>` +
          `<span>Csapadék <strong>${metric(valueOf(station, ['precipitationMm', 'precipitation']), ' mm')}</strong></span></div>` +
          (observedData.fallback || station?.isFallback ? '<div class="tp-detail">Közeli állomásról származó érzékelői fallback</div>' : '')
      },
      {
        id: 'open-meteo', category: 'weather', title: 'Open-Meteo előrejelzés', href: '#weather-forecast',
        badge: status(forecast), time: time(valueOf(forecastData, ['timestamp', 'updatedAt'])),
        body: `<div class="tp-main">${esc(text(valueOf(forecastDay, ['weatherCodeSummary', 'summary', 'weatherCode']), 'Nincs előrejelzés'))}</div>` +
          `<div class="tp-detail">Min/max: <strong>${metric(valueOf(forecastDay, ['minTemperature', 'temperatureMin']), ' °C')} / ${metric(valueOf(forecastDay, ['maxTemperature', 'temperatureMax']), ' °C')}</strong> · Csapadék: ${metric(valueOf(forecastDay, ['precipitationProbability', 'precipitationProb']), ' %')} / ${metric(valueOf(forecastDay, ['precipitationSum', 'precipitation']), ' mm')}</div>`
      },
      {
        id: 'ovf-gauges', category: 'flood', title: 'OVF Berettyó vízállás', href: '#hydro',
        badge: status(hydro), time: time(valueOf(gauge, ['observedAt', 'timestamp'])),
        body: `<div class="tp-main">${metric(valueOf(gauge, ['waterLevelCm', 'levelCm', 'waterLevel']), ' cm')}</div>` +
          `<div class="tp-detail">${esc(text(valueOf(gauge?.levelRelation, ['text']) || valueOf(gauge, ['tendency', 'trend']), 'stagnál'))} · I. fok alatt (nem hivatalos állapot)</div>`
      },
      {
        id: 'ovf-drought', category: 'drought', title: 'OVF aszály / talajnedvesség', href: '#drought',
        badge: status(drought), time: time(valueOf(droughtData, ['lastUpdated', 'observedAt', 'timestamp'])),
        body: `<div class="tp-main">10–20 cm: ${metric(valueOf(soil, ['10-20cm', '10cm', '20cm', '10_20cm']), ' V/V %')}</div>` +
          `<div class="tp-detail">Aszályindex: <strong>${esc(text(valueOf(droughtData.droughtIndex, ['value']) ?? valueOf(droughtData, ['droughtIndex'])))}</strong></div>`
      },
      {
        id: 'space-weather', category: 'space-weather', title: 'Űridőjárás (G/R/S)', href: '#space-weather',
        badge: status(sw), time: time(valueOf(swData, ['timestamp', 'updatedAt'])),
        body: `<div class="tp-metrics"><span>Kp <strong>${esc(text(valueOf(swData.kp, ['noaaKp', 'gfzKp']) ?? valueOf(swData, ['kp'])))}</strong></span>` +
          `<span>G <strong>${esc(text(valueOf(scales.G, ['label', 'level'])))}</strong></span><span>R <strong>${esc(text(valueOf(scales.R, ['label', 'level'])))}</strong></span><span>S <strong>${esc(text(valueOf(scales.S, ['label', 'level'])))}</strong></span></div>`
      },
      {
        id: 'police', category: 'transport', title: 'Rendőrségi hírek · Hajdú-Bihar', href: '#news',
        badge: status(police), time: time(valueOf(newsItem, ['publishedAt', 'publicationDate', 'timestamp'])),
        body: `<div class="tp-main">${esc(text(valueOf(newsItem, ['title', 'headline']), 'Nincs rendőrségi közlemény'))}</div>`
      },
      {
        id: 'local-news', category: 'general', title: 'Helyi hírek', href: '#local-news',
        badge: status(local), time: time(valueOf(localItem, ['publishedAt', 'publicationDate', 'timestamp'])),
        body: `<div class="tp-main">${esc(text(valueOf(localItem, ['title', 'headline']), 'Nincs helyi hír'))}</div>`
      }
    ];
  }

  function renderTodayPanel(snapshot) {
    let sn = snapshot;
    if (sn == null && typeof window !== 'undefined') {
      sn = typeof window.currentSnapshot === 'function' ? window.currentSnapshot() : (window.D || {});
    }
    const tiles = dataTiles(sn);
    return `<section class="g-panel today-panel-root" id="todayPanel" role="region" aria-labelledby="todayPanelTitle">` +
      `<div class="sec-head"><h3 id="todayPanelTitle">MI ÉRINTHET MA?</h3><span class="badge">8 TÁJÉKOZTATÓ CSEMPE</span></div>` +
      `<p class="today-panel-intro">Helyi és környékbeli nyilvános adatforrások állapota, kockázati összesítés nélkül.</p>` +
      `<div class="today-grid">${tiles.map(renderTile).join('')}</div></section>`;
  }

  return { renderTodayPanel, renderTile, esc };
});
