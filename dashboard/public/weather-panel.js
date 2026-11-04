/**
 * dashboard/public/weather-panel.js
 *
 * Crucix Időjárás és Orvosmeteorológiai Ablak (Weather & Biometeorology Window):
 * - Forrás: Open-Meteo (DWD ICON, Közép-Európa 15 perces modell, CC BY 4.0).
 * - Mért adat: HungaroMet ODP 10 perces szinoptikus automata mérőhálózat (Berettyóújfalu 65305, Debrecen 64711/64310, Derecske 64713).
 * - Attribúció: "Adatbázis: Meteorológiai Adattár, HungaroMet Nonprofit Zrt." (kötelező feltétel).
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
  let activeObservedStation = '65305'; // Berettyóújfalu (elsődleges)

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMetricNum(val, decimals = 1) {
    if (val === null || val === undefined || !Number.isFinite(val)) return null;
    return val.toFixed(decimals).replace('.', ',');
  }

  function renderDroughtBlock(snapshot) {
    const drought = snapshot?.sources?.ovfDrought || snapshot?.ovfDrought;
    if (!drought || drought.enabled === false || !drought.station) return '';
    const value = (metric, decimals = 1) => metric?.value === null || metric?.value === undefined ? '--' : formatMetricNum(metric.value, decimals);
    const depthGrid = (data, decimals = 1) => ['10cm', '20cm', '30cm', '45cm', '60cm', '75cm'].map(depth => `
      <div class="wp-drought-cell"><span>${esc(depth)}</span><strong>${data?.[depth] === null || data?.[depth] === undefined ? '--' : esc(formatMetricNum(data[depth], decimals))}</strong></div>
    `).join('');
    const isFixture = Boolean(drought.isFixture || snapshot?.isPreSynthesizedFixture || drought.status === 'fixture');
    const statusText = isFixture ? 'FIXTURE MINTA' : (drought.isFresh ? 'FRISS' : 'ELAVULT');
    const statusClass = isFixture ? 'wp-obs-pill-stale' : (drought.isFresh ? 'wp-obs-pill-fresh' : 'wp-obs-pill-stale');
    return `
      <section class="wp-drought-card ${drought.isFresh && !isFixture ? 'fresh' : 'stale'}" role="region" aria-label="OVF Aszálymonitoring">
        <div class="wp-drought-header">
          <h4>${window.CrucixIcons ? window.CrucixIcons.renderIcon('drought', { size: 17, className: 'wp-drought-icon' }) : '◌'} OVF Aszálymonitoring (${esc(drought.station.name)}, ${esc(drought.station.distanceKm)} km)</h4>
          <span class="wp-obs-pill ${statusClass}">${statusText}</span>
        </div>
        <div class="wp-drought-section"><span class="wp-drought-label">Talajnedvesség · V/V %</span><div class="wp-drought-grid">${depthGrid(drought.soilMoisture)}</div></div>
        <div class="wp-drought-section"><span class="wp-drought-label">Talajhőmérséklet · °C</span><div class="wp-drought-grid">${depthGrid(drought.soilTemperature)}</div></div>
        <div class="wp-drought-section">
          <span class="wp-drought-label">OVF számított értékek (értelmezés nélkül)</span>
          <div class="wp-drought-summary">
            <div><span>Aszályindex (OVF számított érték)</span><strong>${esc(value(drought.droughtIndex, 2))}</strong></div>
            <div><span>Vízhiány 35 cm (OVF számított érték)</span><strong>${drought.waterDeficit?.['35cm'] == null ? '--' : esc(formatMetricNum(drought.waterDeficit['35cm'], 1))} mm</strong></div>
            <div><span>Vízhiány 80 cm (OVF számított érték)</span><strong>${drought.waterDeficit?.['80cm'] == null ? '--' : esc(formatMetricNum(drought.waterDeficit['80cm'], 1))} mm</strong></div>
          </div>
        </div>
        <div class="wp-drought-meta">${isFixture ? 'Adatforrás: Fixture minta (nem élő telemetria) · ' : 'Adatforrás: OVF Aszálymonitoring hálózat (tájékoztató jellegű számított érték) · '}Utolsó mérés: ${esc(drought.lastUpdated || '--')}</div>
      </section>
    `;
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

  function setObservedStation(stationId) {
    activeObservedStation = stationId;
    const panel = document.querySelector('.weather-panel-root');
    if (panel) {
      const sn = typeof window.currentSnapshot === 'function' ? window.currentSnapshot() : (window.D || {});
      panel.outerHTML = renderWeatherPanel(sn);
    }
  }

  function renderObservedBlock(snapshot) {
    const weather = snapshot?.weather || {};
    const observed = weather.observed || snapshot?.hungarometObs || null;

    if (!observed || observed.enabled === false) {
      return `
        <div class="wp-observed-card wp-obs-disabled">
          <div class="wp-obs-header">
            <div class="wp-obs-title-wrap">
              <span class="wp-obs-badge">MÉRT ADAT</span>
              <span class="wp-obs-station-name">HungaroMet ODP Automata Mérőhálózat</span>
            </div>
            <span class="wp-obs-pill wp-obs-pill-off">KIKAPCSOLVA</span>
          </div>
          <div class="wp-obs-note">
            A valós idejű talajszinti mérések megjelenítése inaktív (<code>CRUCIX_ENABLE_HUNGAROMET_OBS=false</code>).
            Az alábbi kártyák az Open-Meteo (DWD ICON) numerikus modell előrejelzéseit mutatják.
          </div>
        </div>
      `;
    }

    const stations = observed.stations || {};
    const stationKeys = Object.keys(stations);

    if (stationKeys.length === 0) {
      return `
        <div class="wp-observed-card wp-obs-stale">
          <div class="wp-obs-header">
            <div class="wp-obs-title-wrap">
              <span class="wp-obs-badge">MÉRT ADAT</span>
              <span class="wp-obs-station-name">HungaroMet ODP</span>
            </div>
            <span class="wp-obs-pill wp-obs-pill-stale">&#9888; NINCS ELÉRHETŐ ÁLLOMÁS</span>
          </div>
          <div class="wp-obs-note">${esc(observed.error || 'Nincs feldolgozott állomásadat a szinoptikus csomagban.')}</div>
        </div>
      `;
    }

    let currentStation = stations[activeObservedStation];
    if (!currentStation) {
      currentStation = observed.primaryStation || stations['65305'] || stations[stationKeys[0]];
    }

    const stVal = currentStation.values || {};
    const isFresh = Boolean(currentStation.fresh);
    const statusClass = isFresh ? 'wp-obs-fresh' : 'wp-obs-stale';
    const statusPill = isFresh
      ? `<span class="wp-obs-pill wp-obs-pill-fresh">&#10003; FRISS MÉRÉS · ${esc(currentStation.observedAtLocal || '--:--')}</span>`
      : `<span class="wp-obs-pill wp-obs-pill-stale">&#9888; NINCS FRISS MÉRÉS (Utolsó: ${esc(currentStation.observedAtLocal || '--:--')}${currentStation.ageMinutes ? ', ' + currentStation.ageMinutes + ' perce' : ''})</span>`;

    const stationTabsHtml = stationKeys.map(sId => {
      const sObj = stations[sId];
      const isActive = sObj.station === currentStation.station;
      const isPri = sObj.isPrimary ? ' ★' : '';
      return `
        <button type="button" class="wp-obs-station-btn ${isActive ? 'active' : ''}" onclick="window.CrucixWeatherPanel.setStation('${esc(sObj.station)}')">
          ${esc(sObj.stationName)}${isPri}
        </button>
      `;
    }).join('');

    const fallbackInfo = currentStation.fallback || currentStation.composite || observed.fallback || null;
    const fbVal = fallbackInfo?.values || {};

    // Collect fallback items for metrics missing on currentStation
    const fallbackItems = [];

    if (stVal.windSpeed === null && fbVal.windSpeed?.value !== null && fbVal.windSpeed?.isFallback) {
      const ws = formatMetricNum(fbVal.windSpeed.value, 1);
      const stName = fbVal.windSpeed.stationName || 'Tartalékállomás';
      const dist = fbVal.windSpeed.distanceKm !== null ? `~${Math.round(fbVal.windSpeed.distanceKm)} km` : '';
      const meta = dist ? `(${stName}, ${dist})` : `(${stName})`;
      fallbackItems.push({
        label: 'Szél',
        value: `${ws} m/s`,
        meta
      });
    }

    if (stVal.pressure === null && fbVal.pressure?.value !== null && fbVal.pressure?.isFallback) {
      const p = formatMetricNum(fbVal.pressure.value, 1);
      const stName = fbVal.pressure.stationName || 'Tartalékállomás';
      const dist = fbVal.pressure.distanceKm !== null ? `~${Math.round(fbVal.pressure.distanceKm)} km` : '';
      const meta = dist ? `(${stName}, ${dist})` : `(${stName})`;
      fallbackItems.push({
        label: 'Légnyomás',
        value: `${p} hPa`,
        meta
      });
    }

    if (stVal.soilTemp5cm === null && fbVal.soilTemp5cm?.value !== null && fbVal.soilTemp5cm?.isFallback) {
      const t = formatMetricNum(fbVal.soilTemp5cm.value, 1);
      const stName = fbVal.soilTemp5cm.stationName || 'Tartalékállomás';
      const dist = fbVal.soilTemp5cm.distanceKm !== null ? `~${Math.round(fbVal.soilTemp5cm.distanceKm)} km` : '';
      const meta = dist ? `(${stName}, ${dist})` : `(${stName})`;
      fallbackItems.push({
        label: 'Talajhő (5cm)',
        value: `${t} °C`,
        meta
      });
    }

    if (stVal.visibility === null && fbVal.visibility?.value !== null && fbVal.visibility?.isFallback) {
      const v = fbVal.visibility.value >= 1000
        ? `${formatMetricNum(fbVal.visibility.value / 1000, 1)} km`
        : `${fbVal.visibility.value} m`;
      const stName = fbVal.visibility.stationName || 'Tartalékállomás';
      const dist = fbVal.visibility.distanceKm !== null ? `~${Math.round(fbVal.visibility.distanceKm)} km` : '';
      const meta = dist ? `(${stName}, ${dist})` : `(${stName})`;
      fallbackItems.push({
        label: 'Látástávolság',
        value: v,
        meta
      });
    }

    // Direct metrics for primary row
    const directMetricsHtml = [];

    if (stVal.temperature !== null) {
      directMetricsHtml.push(`
        <div class="wp-obs-metric-item">
          <span class="wp-obs-ml">Hőmérséklet</span>
          <span class="wp-obs-mv highlight">${stVal.temperature} °C</span>
          ${stVal.temperatureAvg !== null ? `<span class="wp-obs-ms">Átlag: ${stVal.temperatureAvg} °C</span>` : ''}
        </div>
      `);
    }

    if (stVal.humidity !== null) {
      directMetricsHtml.push(`
        <div class="wp-obs-metric-item">
          <span class="wp-obs-ml">Légnedvesség</span>
          <span class="wp-obs-mv">${stVal.humidity} %</span>
        </div>
      `);
    }

    if (stVal.windSpeed !== null) {
      directMetricsHtml.push(`
        <div class="wp-obs-metric-item">
          <span class="wp-obs-ml">Szél (10m)</span>
          <span class="wp-obs-mv">${stVal.windSpeed} m/s</span>
          ${stVal.windGust !== null ? `<span class="wp-obs-ms">Lökés: ${stVal.windGust} m/s</span>` : ''}
        </div>
      `);
    }

    if (stVal.precipitation !== null) {
      directMetricsHtml.push(`
        <div class="wp-obs-metric-item">
          <span class="wp-obs-ml">Csapadék (10p)</span>
          <span class="wp-obs-mv">${stVal.precipitation} mm</span>
        </div>
      `);
    }

    if (stVal.pressure !== null) {
      directMetricsHtml.push(`
        <div class="wp-obs-metric-item">
          <span class="wp-obs-ml">Légnyomás</span>
          <span class="wp-obs-mv">${stVal.pressure} hPa</span>
        </div>
      `);
    }

    if (stVal.soilTemp5cm !== null) {
      directMetricsHtml.push(`
        <div class="wp-obs-metric-item">
          <span class="wp-obs-ml">Talajhő (5cm)</span>
          <span class="wp-obs-mv">${stVal.soilTemp5cm} °C</span>
        </div>
      `);
    }

    const fallbackHtml = fallbackItems.length > 0 ? `
      <div class="wp-obs-fallback-box" role="region" aria-label="Tartalékállomásról pótolt szenzoradatok">
        <span class="wp-obs-fallback-title">Közeli állomásról pótolt szenzorok (más állomásról mérve):</span>
        <div class="wp-obs-fallback-items">
          ${fallbackItems.map(item => `
            <span class="wp-obs-fallback-item">
              <span class="wp-obs-fb-label">${esc(item.label)}:</span>
              <strong class="wp-obs-fb-val">${esc(item.value)}</strong>
              <span class="wp-obs-fb-meta">${esc(item.meta)}</span>
            </span>
          `).join('')}
        </div>
      </div>
    ` : '';

    return `
      <div class="wp-observed-card ${statusClass}">
        <div class="wp-obs-header">
          <div class="wp-obs-title-wrap">
            <span class="wp-obs-badge">MÉRT ADAT (MÉRÉS vs MODELL)</span>
            <span class="wp-obs-station-name">${esc(currentStation.stationName)} (${esc(currentStation.station)})</span>
          </div>
          ${statusPill}
        </div>

        <div class="wp-obs-station-tabs" role="tablist" aria-label="Mérőállomások">
          ${stationTabsHtml}
        </div>

        <div class="wp-obs-metrics-row">
          ${directMetricsHtml.join('')}
        </div>

        ${fallbackHtml}

        <div class="wp-obs-attribution">
          Adatbázis: Meteorológiai Adattár, HungaroMet Nonprofit Zrt. · Valós talajszinti mérés (nem numerikus modell)
        </div>
      </div>
    `;
  }

  function renderHydroBlock(snapshot) {
    const hydro = snapshot?.ovfGauges || snapshot?.weather?.ovfGauges || null;
    const ATTRIBUTION_OVF = 'Forrás: Országos Vízügyi Főigazgatóság (OVF), tájékoztató jellegű adat; nem hivatalos árvízi vagy belvízi előrejelzés.';

    if (!hydro || hydro.enabled === false) {
      return `
        <div class="wp-hydro-card off" role="region" aria-label="Vízállás adatok (Berettyó)">
          <div class="wp-hydro-header">
            <div class="wp-hydro-title-wrap">
              <span class="wp-hydro-badge">VÍZÁLLÁS (BERETTYÓ)</span>
              <span class="wp-hydro-subtitle">Berettyóújfalu · Pocsaj · Darvas · Szeghalom</span>
            </div>
            <span class="wp-obs-pill wp-obs-pill-off">KIKAPCSOLVA</span>
          </div>
          <div class="wp-hydro-note">
            Az OVF vízmérce modul kikapcsolva (CRUCIX_ENABLE_OVF_GAUGES=false).
          </div>
          <div class="wp-hydro-attribution">
            ${ATTRIBUTION_OVF}
          </div>
        </div>
      `;
    }

    const isFresh = Boolean(hydro.fresh);
    const statusClass = isFresh ? 'fresh' : 'stale';
    const statusPill = isFresh
      ? '<span class="wp-obs-pill wp-obs-pill-fresh">FRISS</span>'
      : '<span class="wp-obs-pill wp-obs-pill-stale">ELAVULT</span>';

    const gauges = Array.isArray(hydro.gauges) ? hydro.gauges : [];

    const gaugeRowsHtml = gauges.map(g => {
      const isGaugeFresh = Boolean(g.fresh);
      const isDaily = g.cadence === 'daily';
      const levelStr = g.waterLevelCm !== null ? `${g.waterLevelCm > 0 ? '+' : ''}${g.waterLevelCm} cm` : '-';
      const dischargeStr = g.dischargeM3s !== null ? `${formatMetricNum(g.dischargeM3s, 2)} m³/s` : '-';
      const tempStr = g.waterTempC !== null ? `${formatMetricNum(g.waterTempC, 1)} °C` : '-';
      const timeStr = g.observedAtBudapestTime || '--:--';
      const timeBadgeClass = isGaugeFresh ? 'fresh' : (g.observedAt ? 'stale' : 'off');
      const timeBadgeText = isGaugeFresh
        ? timeStr
        : (g.observedAt ? `ELAVULT (${esc(g.observedAtBudapestDate || timeStr)})` : 'NINCS ADAT');

      const kfText = g.levelRelation?.text && g.levelRelation.text !== '-'
        ? esc(g.levelRelation.text)
        : (g.kf1 ? `I. fok: ${g.kf1} cm` : '-');

      const levelStatusClass = g.levelRelation?.status === 'kf3' ? 'alert-kf3' :
        (g.levelRelation?.status === 'kf2' ? 'alert-kf2' :
        (g.levelRelation?.status === 'kf1' ? 'alert-kf1' : 'normal'));

      const officialFokozatHtml = (g.currentFokozat && g.currentFokozat > 0)
        ? ` <span class="wp-hydro-fok-pill" style="font-size:8.5px;padding:1px 4px;border-radius:2px;background:rgba(255,184,76,0.18);color:#ffb84c;border:1px solid rgba(255,184,76,0.4)">OVF Fokozat mező: ${esc(g.currentFokozat)} (értelmezés ellenőrizendő)</span>`
        : '';

      return `
        <div class="wp-hydro-gauge-row ${levelStatusClass}">
          <div class="wp-hydro-gauge-head">
            <div class="wp-hydro-gauge-name">
              <strong>${esc(g.name)}</strong>${g.isPrimary ? ' <span class="wp-hydro-star" title="Elsődleges állomás">★</span>' : ''}${officialFokozatHtml}
              <span class="wp-hydro-gauge-sub">(${esc(g.river || 'Berettyó')}, #${esc(g.id)}${isDaily ? ' · napi mérce' : ''})</span>
            </div>
            <span class="wp-hydro-time-badge ${timeBadgeClass}">${timeBadgeText}</span>
          </div>

          <div class="wp-hydro-metrics-grid">
            <div class="wp-hydro-m-item">
              <span class="wp-hydro-ml">Vízállás</span>
              <strong class="wp-hydro-mv highlight">${levelStr}</strong>
            </div>
            <div class="wp-hydro-m-item">
              <span class="wp-hydro-ml">Vízhozam</span>
              <span class="wp-hydro-mv">${dischargeStr}</span>
            </div>
            <div class="wp-hydro-m-item">
              <span class="wp-hydro-ml">Vízhő</span>
              <span class="wp-hydro-mv">${tempStr}</span>
            </div>
            <div class="wp-hydro-m-item wide">
              <span class="wp-hydro-ml">Készültségi viszony</span>
              <span class="wp-hydro-mv sub">${kfText}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="wp-hydro-card ${statusClass}" role="region" aria-label="Vízállás adatok (Berettyó)">
        <div class="wp-hydro-header">
          <div class="wp-hydro-title-wrap">
            <span class="wp-hydro-badge">VÍZÁLLÁS (BERETTYÓ)</span>
            <span class="wp-hydro-subtitle">Berettyóújfalu · Pocsaj · Darvas · Szeghalom</span>
          </div>
          ${statusPill}
        </div>

        <div class="wp-hydro-gauges-list">
          ${gaugeRowsHtml}
        </div>

        <div class="wp-hydro-attribution">
          ${ATTRIBUTION_OVF}
        </div>
      </div>
    `;
  }

  function renderWeatherPanel(snapshot) {
    const weather = snapshot?.weather || {};
    const byRegion = weather.byRegion || {};
    const biomet = weather.biomet || {};
    const hungaroMet = weather.hungaroMetBulletin || {};

    const regionLocations = byRegion[activeWeatherRegion] || byRegion.local || [];

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

    // Observed ground station block (HungaroMet ODP)
    const observedBlockHtml = renderObservedBlock(snapshot);

    // OVF Hydro gauges block (Berettyó)
    const hydroBlockHtml = renderHydroBlock(snapshot);
    const droughtBlockHtml = renderDroughtBlock(snapshot);

    // Content by active mode tab
    let bodyHtml = '';

    if (activeWeatherTab === 'current') {
      const modelCardsHtml = regionLocations.map(loc => {
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
              <span style="font-size:9px;color:var(--dim,#8ba2b5);font-family:var(--mono,monospace)">[MODELL · DWD ICON]</span>
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

      bodyHtml = `
        ${observedBlockHtml}
        ${hydroBlockHtml}
        ${droughtBlockHtml}
        <div style="font-size:9.5px;color:var(--dim,#8ba2b5);font-family:var(--mono,monospace);margin:6px 0 2px 2px;letter-spacing:0.5px">
          NUMERIKUS ELŐREJELZÉSI MODELL (DWD ICON · TERÜLETI ADATOK):
        </div>
        ${modelCardsHtml}
      `;
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
          <h3>${window.CrucixIcons ? window.CrucixIcons.renderIcon('weather', { size: 18, className: 'wp-head-icon' }) : ''}IDŐJÁRÁS ÉS ORVOSMETEOROLÓGIA</h3>
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
            Források: Open-Meteo (DWD ICON, CC BY 4.0) · GFZ (CC BY 4.0) · HungaroMet (Meteorológiai Adattár) · Piktogramok: OCHA (CC0 1.0), Lucide (ISC)
          </div>
        </div>
      </div>
    `;
  }

  window.CrucixWeatherPanel = {
    panelHtml: renderWeatherPanel,
    renderObservedBlock: renderObservedBlock,
    renderHydroBlock: renderHydroBlock,
    renderDroughtBlock: renderDroughtBlock,
    setRegion: setWeatherRegion,
    setTab: setWeatherTab,
    setStation: setObservedStation
  };

})(window, document);
