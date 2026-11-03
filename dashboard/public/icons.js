(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CrucixIcons = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  /**
   * Crucix Alert & Intelligence Pictograms Helper
   * Offline SVG sprite reference helper with zero external network requests.
   * Licences documented in THIRD_PARTY_ICONS.md (UN OCHA CC0 1.0 & Lucide ISC).
   */

  const CATEGORIES = [
    'space-weather',
    'weather',
    'earthquake',
    'fire',
    'transport',
    'military',
    'flood',
    'drought',
    'health',
    'radiation',
    'cyber',
    'energy',
    'economy',
    'supply-chain',
    'sanctions',
    'general'
  ];

  const CATEGORY_NAMES_HU = {
    'space-weather': 'Űridőjárás',
    'weather': 'Időjárás / Szél',
    'earthquake': 'Földrengés',
    'fire': 'Tűz / Erdőtűz',
    'transport': 'Baleset / Közlekedés',
    'military': 'Katonai / Biztonság',
    'flood': 'Árvíz / Vízállás',
    'drought': 'Aszály',
    'health': 'Járvány / Egészségügy',
    'radiation': 'Sugárzás / Nukleáris',
    'cyber': 'Kiberbiztonság / Hálózat',
    'energy': 'Energia / Ellátás',
    'economy': 'Gazdaság / Piac',
    'supply-chain': 'Ellátási lánc / Logisztika',
    'sanctions': 'Szankciók / Korlátozások',
    'general': 'Figyelmeztetés'
  };

  // Meteoalarm severity colors: green, yellow, orange, red
  const SEVERITY_COLORS = {
    low: '#64f0c8',
    moderate: '#ffe600',
    high: '#ff9f1a',
    critical: '#ff4d4f'
  };

  // Keywords and source identifiers mapped to one of the 16 categories
  const KEYWORD_MAP = [
    // space-weather
    [/^(space-weather|spaceweather|space_weather|noaa-swpc|swpc|gfz|aurora|geomagnetic|solar|solar-flare|kp-index)$/i, 'space-weather'],
    // weather
    [/^(weather|weatheradvisories|meteoalarm|hungaromet|met-norway|open-meteo|dwd|rain|wind|storm|snow|frost|heat|temperature)$/i, 'weather'],
    // earthquake
    [/^(earthquake|seismic|emsc|usgs|tremor|quakeml)$/i, 'earthquake'],
    // fire
    [/^(fire|wildfire|firms|nasa-firms|forestfire|smoke)$/i, 'fire'],
    // transport
    [/^(transport|accident|traffic|aviation|sigmet|flight|road|railway)$/i, 'transport'],
    // military / security
    [/^(military|security|defense|conflict|threat|armed|adsb-military|war|ukraine|border)$/i, 'military'],
    // flood / hydrology
    [/^(flood|hydrology|ovf|ovf-gauges|water-level|waterlevel|river|inundation|belviz|arviz)$/i, 'flood'],
    // drought
    [/^(drought|aridity|soil-moisture|soil_moisture|aszaly)$/i, 'drought'],
    // health / biological
    [/^(health|epidemic|pandemic|disease|biomet|who|nebih|asp|virus|medical|biological)$/i, 'health'],
    // radiation / cbrn
    [/^(radiation|nuclear|radiological|cbrn|iaea|atomic)$/i, 'radiation'],
    // cyber / network
    [/^(cyber|network|cyberattack|ooni|ripestat|bgp|dns|epss|cve|malware|outage|telecom)$/i, 'cyber'],
    // energy
    [/^(energy|power|grid|blackout|energy-charts-hu|entsog-hu|gas|electricity|mavir|pipeline)$/i, 'energy'],
    // economy
    [/^(economy|market|inflation|currency|ecb|prediction-markets|forex|finance|gdp|recession)$/i, 'economy'],
    // supply chain
    [/^(supply-chain|supplychain|logistics|shipping|port|maritime|imf-portwatch|freight|cargo|vessel)$/i, 'supply-chain'],
    // sanctions
    [/^(sanctions|embargo|opensanctions|federal-register|trade-restriction|sanction)$/i, 'sanctions'],
    // general fallback
    [/^(general|fallback|unknown|alert|warning|info)$/i, 'general']
  ];

  function esc(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeSeverity(sev) {
    if (!sev || typeof sev !== 'string') return null;
    const s = sev.toLowerCase().trim();
    if (s === 'low' || s === 'info' || s === 'minor' || s === 'green' || s === '1') return 'low';
    if (s === 'moderate' || s === 'medium' || s === 'yellow' || s === '2') return 'moderate';
    if (s === 'high' || s === 'severe' || s === 'major' || s === 'orange' || s === '3') return 'high';
    if (s === 'critical' || s === 'extreme' || s === 'red' || s === '4' || s === '5') return 'critical';
    return null;
  }

  function getSeverityColor(sev) {
    const norm = normalizeSeverity(sev);
    return norm ? SEVERITY_COLORS[norm] : null;
  }

  function getCategory(categoryOrSource) {
    if (!categoryOrSource || typeof categoryOrSource !== 'string') return 'general';
    const key = categoryOrSource.trim().toLowerCase();

    // Direct match against known 16 categories
    if (CATEGORIES.includes(key)) return key;

    // Pattern / alias match
    for (const [pattern, cat] of KEYWORD_MAP) {
      if (pattern.test(key)) return cat;
    }

    // Substring heuristic for compound keys (e.g. "ovf-gauges-station" or "firms-fire-hu")
    for (const [pattern, cat] of KEYWORD_MAP) {
      const parts = key.split(/[-_/\s:.]+/);
      for (const p of parts) {
        if (pattern.test(p)) return cat;
      }
    }

    return 'general';
  }

  function getIconId(categoryOrSource) {
    const cat = getCategory(categoryOrSource);
    return `icon-${cat}`;
  }

  /**
   * Renders an accessible SVG icon referring to the local SVG sprite.
   *
   * @param {string} categoryOrSource Category name or source identifier
   * @param {Object} [options]
   * @param {number} [options.size=16] Icon width and height in px
   * @param {string} [options.severity] Optional alert severity for Meteoalarm coloring
   * @param {string} [options.className] Additional CSS class names
   * @param {string} [options.title] Tooltip title (defaults to Hungarian category name)
   * @param {string} [options.ariaLabel] Accessible description (defaults to title)
   * @param {string} [options.role='img'] ARIA role
   * @param {boolean} [options.badge=false] Whether to wrap in a stylized badge
   * @returns {string} Safe HTML/SVG string
   */
  function renderIcon(categoryOrSource, options = {}) {
    const {
      size = 16,
      severity = null,
      className = '',
      title = '',
      ariaLabel = '',
      role = 'img',
      badge = false
    } = options;

    const iconId = getIconId(categoryOrSource);
    const cat = getCategory(categoryOrSource);
    const color = getSeverityColor(severity);
    const resolvedTitle = title || CATEGORY_NAMES_HU[cat] || 'Figyelmeztetés';
    const resolvedAria = ariaLabel || resolvedTitle;

    const styleParts = [];
    if (color) {
      styleParts.push(`color:${color}`);
    }
    const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';

    const cls = ['crucix-icon', `crucix-icon-${cat}`];
    if (size) cls.push(`crucix-icon-${size}`);
    if (severity) {
      const norm = normalizeSeverity(severity);
      if (norm) cls.push(`sev-${norm}`);
    }
    if (className) cls.push(className);

    // Modern SVG use reference to local /icons.svg#icon-...
    const svgHtml = `<svg class="${cls.join(' ')}" width="${size}" height="${size}" viewBox="0 0 24 24" role="${role}" aria-label="${esc(resolvedAria)}"${styleAttr}><title>${esc(resolvedTitle)}</title><use href="/icons.svg#${iconId}"></use></svg>`;

    if (badge) {
      const badgeCls = ['crucix-icon-badge'];
      if (severity) {
        const norm = normalizeSeverity(severity);
        if (norm) badgeCls.push(`crucix-badge-${norm}`);
      }
      return `<span class="${badgeCls.join(' ')}"${styleAttr}>${svgHtml}<span class="crucix-icon-badge-text">${esc(resolvedTitle)}</span></span>`;
    }

    return svgHtml;
  }

  return {
    CATEGORIES,
    CATEGORY_NAMES_HU,
    SEVERITY_COLORS,
    normalizeSeverity,
    getSeverityColor,
    getCategory,
    getIconId,
    renderIcon
  };
});
