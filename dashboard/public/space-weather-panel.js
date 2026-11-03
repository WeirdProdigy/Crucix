/**
 * dashboard/public/space-weather-panel.js
 *
 * Crucix Űridőjárás Ablak (Space Weather Window):
 * - Források: NOAA SWPC és GFZ Potsdam Kp nowcast + forecast + Hp30/Hp60 (CC BY 4.0).
 * - Mutatók: Kp (NOAA + GFZ), napszél sebesség és Bz mágneses tér, röntgenosztály (X-ray flare class),
 *   3 napos előrejelzés, aktív riasztások.
 * - Fokozatok: G1-G5, R1-R5, S1-S5 színkóddal és magyarázattal, "Veszélyes" jelöléssel G3+, R3+, S3+ esetén.
 * - Schumann-rezonancia: Tomsk link-kártya közvetlen forráslinkkel, geofizikai frekvenciákkal,
 *   egészségügyi állítás nélkül.
 * - Kompakt, belső görgetés (crucix-scroll-region minta), utolsó frissítés és forrás-egészség.
 */

(function (window, document) {
  'use strict';

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getBadgeHtml(scaleObj, typeLetter) {
    if (!scaleObj) return `<span class="sw-badge normal">${typeLetter}0</span>`;
    const lvl = scaleObj.level || 0;
    const isDanger = Boolean(scaleObj.dangerous || lvl >= 4);
    const dangerTag = isDanger ? ' <span class="sw-danger-pill">VESZÉLYES</span>' : '';
    const color = scaleObj.color || '#64f0c8';
    return `<span class="sw-scale-pill" style="border-color:${color};color:${color}"><strong>${esc(scaleObj.label || typeLetter + lvl)}</strong> ${esc(scaleObj.title || '')}</span>${dangerTag}`;
  }

  function renderSpaceWeatherPanel(snapshot) {
    const sw = snapshot?.spaceWeather || {};
    const scales = sw.scales || {};
    const kp = sw.kp || {};
    const wind = sw.solarWind || {};
    const xrays = sw.xrays || {};
    const forecast = sw.forecast || {};
    const alerts = sw.alerts || {};
    const schumann = sw.schumann || {};
    const sources = sw.sources || {};

    const gScale = scales.G || { level: 0, label: 'G0', title: 'Nyugodt', desc: 'Nyugodt mágneses tér', color: '#64f0c8' };
    const rScale = scales.R || { level: 0, label: 'R0', title: 'Nincs blackout', desc: 'Normál ionoszféra', color: '#64f0c8' };
    const sScale = scales.S || { level: 0, label: 'S0', title: 'Háttérszint', desc: 'Normál protonfluxus', color: '#64f0c8' };

    const isDangerous = sw.isDangerous || gScale.dangerous || rScale.dangerous || sScale.dangerous;
    const topBadge = isDangerous ? '<span class="badge" style="background:rgba(255,95,99,0.2);color:#ff5f63;border-color:#ff5f63">VESZÉLYES AKTIVITÁS</span>'
      : (gScale.level >= 1 ? `<span class="badge" style="background:rgba(255,184,76,0.15);color:#ffb84c;border-color:#ffb84c">${esc(gScale.label)} VIHAR</span>`
      : '<span class="badge" style="color:#64f0c8;border-color:rgba(100,240,200,0.3)">NYUGODT</span>');

    const noaaKpStr = (typeof kp.noaaKp === 'number' && Number.isFinite(kp.noaaKp)) ? kp.noaaKp.toFixed(2) : '--';
    const gfzKpStr = (typeof kp.gfzKp === 'number' && Number.isFinite(kp.gfzKp)) ? `${kp.gfzKp.toFixed(2)} (${kp.gfzStatus || 'pre'})` : '--';
    const hp30Str = (typeof kp.gfzHp30 === 'number' && Number.isFinite(kp.gfzHp30)) ? kp.gfzHp30.toFixed(2) : '--';
    const hp60Str = (typeof kp.gfzHp60 === 'number' && Number.isFinite(kp.gfzHp60)) ? kp.gfzHp60.toFixed(2) : '--';

    const windSpeedStr = wind.speed !== null ? `${wind.speed} km/s` : '-- km/s';
    const windBzStr = wind.bz !== null ? `${wind.bz > 0 ? '+' : ''}${wind.bz} nT` : '-- nT';
    const windDensityStr = wind.density !== null ? `${wind.density} p/cm³` : '--';

    const xrayClassStr = xrays.class || 'A/B';

    // Active alerts snippet
    const alertItems = (alerts.items || []).slice(0, 3);
    const alertHtml = alertItems.length > 0 ? alertItems.map(a => `
      <div class="sw-alert-row ${a.gLevel >= 4 || a.rLevel >= 4 || a.sLevel >= 4 ? 'danger' : (a.gLevel >= 3 || a.rLevel >= 3 || a.sLevel >= 2 ? 'warning' : '')}">
        <span class="sw-alert-type">${esc(a.type.toUpperCase())}</span>
        <span class="sw-alert-msg">${esc(a.messageSnippet || '')}</span>
      </div>
    `).join('') : '<div class="sw-empty-note">Nincs érvényben magas fokozatú űridőjárási riasztás.</div>';

    // Source health indicators
    const noaaState = sources.noaa?.status === 'ok' ? 'ok' : (sources.noaa?.status || 'ismeretlen');
    const gfzState = sources.gfz?.status === 'ok' ? 'ok' : (sources.gfz?.status === 'disabled' ? 'kikapcsolva' : (sources.gfz?.status || 'nem elérhető'));

    return `
      <div class="g-panel space-weather-panel">
        <div class="sec-head">
          <h3>${window.CrucixIcons ? window.CrucixIcons.renderIcon('space-weather', { size: 18, className: 'sw-head-icon' }) : ''}ŰRIDŐJÁRÁS</h3>
          ${topBadge}
        </div>
        <div class="sw-meta-bar">
          <span>NOAA: <strong class="${noaaState === 'ok' ? 'c-ok' : 'c-warn'}">${esc(noaaState)}</strong></span>
          <span>GFZ Potsdam: <strong class="${gfzState === 'ok' ? 'c-ok' : ''}">${esc(gfzState)}</strong></span>
          <span class="sw-updated">${sw.timestamp ? esc(new Date(sw.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : '--:--'}</span>
        </div>
        <div class="space-weather-list scroll-region" tabindex="0" role="region" aria-label="Űridőjárási mutatók és skálák">
          <!-- 1. Főbb Skálák -->
          <div class="sw-section-head">NOAA / GFZ ŰRIDŐJÁRÁSI SKÁLÁK</div>
          <div class="sw-scale-item">
            <div class="sw-scale-row">
              <span class="sw-scale-name">G-skála (Geomágneses vihar)</span>
              ${getBadgeHtml(gScale, 'G')}
            </div>
            <div class="sw-scale-desc">${esc(gScale.desc || '')}</div>
          </div>
          <div class="sw-scale-item">
            <div class="sw-scale-row">
              <span class="sw-scale-name">R-skála (Rádió-blackout)</span>
              ${getBadgeHtml(rScale, 'R')}
            </div>
            <div class="sw-scale-desc">${esc(rScale.desc || '')}</div>
          </div>
          <div class="sw-scale-item">
            <div class="sw-scale-row">
              <span class="sw-scale-name">S-skála (Sugárzási vihar)</span>
              ${getBadgeHtml(sScale, 'S')}
            </div>
            <div class="sw-scale-desc">${esc(sScale.desc || '')}</div>
          </div>

          <!-- 2. Kp és Hpo Indexek -->
          <div class="sw-section-head">PLANETÁRIS KP ÉS HPO INDEXEK</div>
          <div class="sw-metric-grid">
            <div class="sw-metric-cell">
              <span class="sw-mlabel">NOAA Kp</span>
              <span class="sw-mval">${esc(noaaKpStr)}</span>
            </div>
            <div class="sw-metric-cell">
              <span class="sw-mlabel">GFZ Kp (3h)</span>
              <span class="sw-mval">${esc(gfzKpStr)}</span>
            </div>
            <div class="sw-metric-cell">
              <span class="sw-mlabel">GFZ Hp30 (30m)</span>
              <span class="sw-mval">${esc(hp30Str)}</span>
            </div>
            <div class="sw-metric-cell">
              <span class="sw-mlabel">GFZ Hp60 (60m)</span>
              <span class="sw-mval">${esc(hp60Str)}</span>
            </div>
          </div>

          <!-- 3. Napszél és Röntgenfluxus -->
          <div class="sw-section-head">NAPSZÉL ÉS RÖNTGENFLAIR TELEMETRIA</div>
          <div class="sw-metric-grid">
            <div class="sw-metric-cell">
              <span class="sw-mlabel">Napszél sebesség</span>
              <span class="sw-mval">${esc(windSpeedStr)}</span>
            </div>
            <div class="sw-metric-cell">
              <span class="sw-mlabel">IMF Bz mágneses tér</span>
              <span class="sw-mval" style="color:${wind.bz !== null && wind.bz < -5 ? 'var(--warn)' : 'var(--text)'}">${esc(windBzStr)}</span>
            </div>
            <div class="sw-metric-cell">
              <span class="sw-mlabel">Protonsűrűség</span>
              <span class="sw-mval">${esc(windDensityStr)}</span>
            </div>
            <div class="sw-metric-cell">
              <span class="sw-mlabel">Röntgenosztály</span>
              <span class="sw-mval" style="color:${xrayClassStr.startsWith('M') ? 'var(--warn)' : (xrayClassStr.startsWith('X') ? 'var(--danger)' : 'var(--accent)')}">${esc(xrayClassStr)}</span>
            </div>
          </div>

          <!-- 4. Előrejelzés és Riasztások -->
          <div class="sw-section-head">3 NAPOS ELŐREJELZÉS ÉS RIASZTÁSOK</div>
          <div class="sw-forecast-box">
            <div>Max várható Kp: <strong>${forecast.maxExpectedKp !== null ? esc(forecast.maxExpectedKp) : '--'}</strong> (Skála: <strong>${esc(forecast.maxExpectedGScale || 'None')}</strong>)</div>
            ${forecast.summary ? `<div class="sw-forecast-summary">${esc(forecast.summary)}</div>` : ''}
          </div>
          <div class="sw-alerts-container">
            ${alertHtml}
          </div>

          <!-- 5. Schumann-rezonancia Link-kártya (Tomsk Geofizika) -->
          <div class="sw-section-head">SCHUMANN-REZONANCIA (GEOFÖZIKAI MEGFIGYELÉS)</div>
          <div class="sw-schumann-card">
            <div class="sw-schumann-title">
              <span>${esc(schumann.title || 'Schumann-rezonancia')}</span>
              <span class="sw-schumann-station">Tomsk (TSU)</span>
            </div>
            <div class="sw-schumann-freqs">
              Fő frekvenciák: <strong>7.83 Hz</strong> (alap) · 14.3 Hz · 20.8 Hz · 27.3 Hz · 33.8 Hz
            </div>
            <div class="sw-schumann-desc">
              ${esc(schumann.descriptionHu || '')}
            </div>
            <div class="sw-schumann-disclaimer">
              &#9888; <strong>Fontos:</strong> ${esc(schumann.disclaimer || 'Egészségügyi hatása tudományosan nem igazolt (orvosi állítás nélkül).')}
            </div>
            <div class="sw-schumann-links">
              <a href="${esc(schumann.sourceUrl || 'https://sosrff.tsu.ru/')}" target="_blank" rel="noopener noreferrer" class="sw-link-btn">
                Tomszki spektrogram megnyitása ↗
              </a>
              <a href="${esc(schumann.mirrorUrl || 'https://sos70.ru/')}" target="_blank" rel="noopener noreferrer" class="sw-link-btn alt">
                Hivatalos tüköroldal (sos70.ru) ↗
              </a>
            </div>
          </div>
          
          <div class="sw-footer-attribution">
            Források: NOAA Space Weather Prediction Center · GFZ Potsdam (CC BY 4.0) · TSU Space Observing System
          </div>
        </div>
      </div>
    `;
  }

  window.CrucixSpaceWeatherPanel = {
    panelHtml: renderSpaceWeatherPanel
  };

})(window, document);
