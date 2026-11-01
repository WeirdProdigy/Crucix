/**
 * dashboard/public/weather-panel.js
 *
 * Crucix Időjárás és Orvosmeteorológiai Ablak (Weather & Biometeorology Window):
 * - Forrás: Open-Meteo (DWD ICON, Közép-Európa 15 perces modell, CC BY 4.0).
 * - Területi hatókörök: Helyi (Bihartorda, Debrecen), Hajdú-Bihar, Magyarország, Közép-Európa.
 * - Nézetek: Most (hőmérséklet, érzet, szél, csapadék, nyomás, WMO kód) és Holnap + 5 nap.
 * - Orvosmeteorológia:
 *   - HungaroMet ODP hivatalos tájékoztató szöveg (ha elérhető az adattárban).
 *   - Átlátható saját biometeorológiai mutató légnyomás- és hőmérséklet-változás alapján (24 óra):
 *     Score = (|ΔP| / 3) + (|ΔT| / 2), kiírt képlettel, "Modellszámítás, nem orvosi tanács" jelöléssel.
 * - Időkép adatot nem használ.
 * - Kompakt, belső görgetés (crucix-scroll-region minta).
 */

(function (window, document) {
  'use strict';

  let activeWeatherRegion = 'local'; // 'local' | 'county' | 'national' | 'regional_ce'
  let activeWeatherTab = 'current';  // 'current' | 'forecast' | 'biomet'

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setWeatherRegion(region) {
    activeWeatherRegion = region;
    const panel = document.querySelector('.weather-panel-root');
    if (panel) {
      const sn = typeof window.currentSnapshot === 'function' ? window.currentSnapshot() : (window.D || {});
      panel.outerHTML = renderWeatherPanel(sn);
    }
  }

  function setWeatherTab(tab) {
    activeWeatherTab = tab;
    const panel = document.querySelector('.weather-panel-root');
    if (panel) {
      const sn = typeof window.currentSnapshot === 'function' ? window.currentSnapshot() : (window.D || {});
      panel.outerHTML = renderWeatherPanel(sn);
    }
  }

  function renderWeatherPanel(snapshot) {
    const weather = snapshot?.weather || {};
    const byRegion = weather.byRegion || {};
    const biomet = weather.biomet || {};
    const hungaroMet = weather.hungaroMetBulletin || {};

    const regionLocations = byRegion[activeWeatherRegion] || byRegion.local || [];
    const firstLoc = regionLocations[0] || {};
    const firstCurrent = firstLoc.current || {};

    const biometScoreStr = biomet.score !== null && biomet.score !== undefined ? biomet.score.toFixed(1) : '--';
    const biometColor = biomet.levelColor || (biomet.level === 'jelentős' || biomet.level === 'magas' ? '#ff5f63' : (biomet.level === 'mersekelt' || biomet.level === 'közepes' ? '#ffb84c' : '#64f0c8'));

    // Region switcher tabs
    const regions = [
      { id: 'local', label: 'Helyi' },
      { id: 'county', label: 'Hajdú-Bihar' },
      { id: 'national', label: 'Magyarország' },
      { id: 'regional_ce', label: 'Közép-Európa' }
    ];

    const regionTabsHtml = regions.map(r => `
      <button type="button" class="wp-reg-btn ${activeWeatherRegion === r.id ? 'active' : ''}" onclick="window.CrucixWeatherPanel.setRegion('${r.id}')">
        ${esc(r.label)}
      </button>
    `).join('');

    // Mode tabs
    const modeTabs = [
      { id: 'current', label: 'Most' },
      { id: 'forecast', label: 'Holnap + 5 nap' },
      { id: 'biomet', label: 'Orvosmeteorológia' }
    ];

    const modeTabsHtml = modeTabs.map(m => `
      <button type="button" class="wp-mode-btn ${activeWeatherTab === m.id ? 'active' : ''}" onclick="window.CrucixWeatherPanel.setTab('${m.id}')">
        ${esc(m.label)}
      </button>
    `).join('');

    // Content by active mode tab
    let bodyHtml = '';

    if (activeWeatherTab === 'current') {
      bodyHtml = regionLocations.map(loc => {
        const cur = loc.current || {};
        if (loc.error) {
          return `
            <div class="wp-location-card error">
              <div class="wp-loc-head"><strong>${esc(loc.name)}</strong> <span class="wp-err-pill">${esc(loc.error)}</span></div>
            </div>
          `;
        }
        return `
          <div class="wp-location-card">
            <div class="wp-loc-head">
              <strong>${esc(loc.name)}</strong>
              <span class="wp-temp">${cur.temp !== null ? cur.temp + ' °C' : '--'}</span>
            </div>
            <div class="wp-loc-sub">
              <span>${esc(cur.weatherTextHu || 'Időjárási adat')}</span>
              ${cur.feelsLike !== null ? `<span>(Érzet: ${cur.feelsLike} °C)</span>` : ''}
            </div>
            <div class="wp-metrics-row">
              <div class="wp-metric-item">
                <span class="wp-ml">Szél</span>
                <span class="wp-mv">${cur.windSpeed !== null ? cur.windSpeed + ' km/h' : '--'}</span>
                ${cur.windGust ? `<span class="wp-ms">Lökés: ${cur.windGust} km/h</span>` : ''}
              </div>
              <div class="wp-metric-item">
                <span class="wp-ml">Légnyomás</span>
                <span class="wp-mv">${cur.surfacePressure !== null ? cur.surfacePressure + ' hPa' : '--'}</span>
              </div>
              <div class="wp-metric-item">
                <span class="wp-ml">Csapadék</span>
                <span class="wp-mv">${cur.precipitation !== null ? cur.precipitation + ' mm' : '0 mm'}</span>
              </div>
              <div class="wp-metric-item">
                <span class="wp-ml">Páratartalom</span>
                <span class="wp-mv">${cur.humidity !== null ? cur.humidity + ' %' : '--'}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else if (activeWeatherTab === 'forecast') {
      bodyHtml = regionLocations.map(loc => {
        const forecasts = loc.forecast || [];
        return `
          <div class="wp-location-card">
            <div class="wp-loc-head">
              <strong>${esc(loc.name)}</strong>
              <span class="wp-loc-sub">5 napos előrejelzés (DWD ICON)</span>
            </div>
            <div class="wp-forecast-grid">
              ${forecasts.slice(0, 5).map(f => `
                <div class="wp-forecast-day">
                  <div class="wp-f-date">${esc(f.date ? f.date.slice(5) : '--')}</div>
                  <div class="wp-f-temp">
                    <span class="wp-f-max">${f.tempMax !== null ? f.tempMax + '°' : '--'}</span> / 
                    <span class="wp-f-min">${f.tempMin !== null ? f.tempMin + '°' : '--'}</span>
                  </div>
                  <div class="wp-f-desc" title="${esc(f.weatherTextHu || '')}">${esc(f.weatherTextHu || '')}</div>
                  <div class="wp-f-precip">${f.precipProbMax !== null ? f.precipProbMax + '%' : ''} ${f.precipSum > 0 ? f.precipSum + ' mm' : ''}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('');
    } else if (activeWeatherTab === 'biomet') {
      bodyHtml = `
        <div class="wp-biomet-card">
          <div class="wp-biomet-head">
            <span class="wp-biomet-badge" style="border-color:${biometColor};color:${biometColor}">
              Biomet Terhelés: <strong>${esc(biometScoreStr)}</strong> (${esc(biomet.level?.toUpperCase() || 'NORMÁL')})
            </span>
            <span class="wp-biomet-updated">${weather.timestamp ? esc(new Date(weather.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : ''}</span>
          </div>

          <div class="wp-biomet-tendency" style="color:${biometColor}">
            ${esc(biomet.tendency || 'Nincs jelentős légköri megterhelés')}
          </div>

          <div class="wp-biomet-formula-box">
            <div class="wp-formula-title">Transzparens Számítási Képlet (24 órás bázison):</div>
            <div class="wp-formula-math">${esc(biomet.formula || 'Score = (|ΔP| / 3) + (|ΔT| / 2)')}</div>
            <div class="wp-formula-vals">
              <span>Nyomásváltozás (ΔP): <strong>${biomet.deltaPressure24h !== undefined ? (biomet.deltaPressure24h > 0 ? '+' : '') + biomet.deltaPressure24h + ' hPa' : '--'}</strong></span>
              <span>Hőmérséklet-változás (ΔT): <strong>${biomet.deltaTemp24h !== undefined ? (biomet.deltaTemp24h > 0 ? '+' : '') + biomet.deltaTemp24h + ' °C' : '--'}</strong></span>
            </div>
            <div class="wp-formula-disclaimer">
              &#9888; <strong>Megjegyzés:</strong> ${esc(biomet.disclaimer || 'Modellszámítás, nem orvosi tanács.')}
            </div>
          </div>

          <!-- HungaroMet ODP Hivatalos Tájékoztató -->
          <div class="wp-official-box">
            <div class="wp-official-head">
              <span>HungaroMet Nyílt Adattár (odp.met.hu)</span>
              <span class="wp-official-source">Hivatalos Tájékoztató</span>
            </div>
            <div class="wp-official-body">
              ${hungaroMet?.description ? esc(hungaroMet.description) : (hungaroMet?.status === 'available' ? 'Hivatalos tájékoztató elérhető az ODP adattárban (' + esc(hungaroMet.fileName) + ').' : 'Fronthatás nem terheli az időjárásra érzékenyek szervezetét (HungaroMet ODP).')}
            </div>
            <div class="wp-official-link">
              <a href="https://www.met.hu/idojaras/orvosmeteorologia/" target="_blank" rel="noopener noreferrer" class="wp-link-btn">
                HungaroMet hivatalos orvosmeteorológia megnyitása ↗
              </a>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="g-panel weather-panel-root">
        <div class="sec-head">
          <h3>IDŐJÁRÁS ÉS ORVOSMETEOROLÓGIA</h3>
          <span class="badge" style="border-color:rgba(100,240,200,0.3);color:var(--accent)">DWD ICON · ODP</span>
        </div>
        <div class="wp-toolbar">
          <div class="wp-region-tabs" role="tablist" aria-label="Időjárási területek">
            ${regionTabsHtml}
          </div>
          <div class="wp-mode-tabs" role="tablist" aria-label="Időjárási nézetek">
            ${modeTabsHtml}
          </div>
        </div>
        <div class="weather-list scroll-region" tabindex="0" role="region" aria-label="Időjárási és orvosmeteorológiai adatok">
          ${bodyHtml}
          <div class="wp-footer-attribution">
            Források: Open-Meteo (CC BY 4.0) · GFZ (CC BY 4.0) · HungaroMet (Meteorológiai Adattár)
          </div>
        </div>
      </div>
    `;
  }

  window.CrucixWeatherPanel = {
    panelHtml: renderWeatherPanel,
    setRegion: setWeatherRegion,
    setTab: setWeatherTab
  };

})(window, document);
