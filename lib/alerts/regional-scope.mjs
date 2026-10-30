// Regional scope filter for Crucix alerts (ALERT_REGIONAL_SCOPE = 'all' | 'domestic')
// In domestic mode:
// - Non-domestic weather/natural disaster alerts appear on the dashboard with "nem hazai, nem értesít",
//   but are suppressed from outbound notification channels (Telegram, Discord, ntfy, webhook).
// - Global threats (space weather, nuclear/radiation, systemic collapse) always notify regardless of region.

const DOMESTIC_TERMS = /\b(hungary|hungarian|magyarorsz[aá]g|budapest|debrecen|szeged|miskolc|p[eé]cs|gy[oő]r|ny[ií]regyh[aá]za|kecskem[eé]t|sz[eé]kesfeh[eé]rv[aá]r|szombathely|szolnok|tatab[aá]nya|kaposv[aá]r|b[eé]k[eé]scsaba|veszpr[eé]m|zalaegerszeg|eger|nagykanizsa|duna[uú]jv[aá]ros|h[oó]dmez[oő]v[aá]s[aá]rhely|hajd[uú]|bihar|borsod|szabolcs|pest|b[aá]cs|somogy|fej[eé]r|kom[aá]rom|tolna|vas|zala|heves|n[oó]gr[aá]d)\b/i;

const WEATHER_NATURAL_TERMS = /\b(weather|natural|earthquake|flood|storm|cyclone|typhoon|hurricane|wildfire|tsunami|volcano|heatwave|blizzard|landslide|avalanche|meteoalarm|f[oö]ldreng[eé]s|[aá]rv[ií]z|vihar|erd[oő]t[uű]z|sz[oö]k[oő][aá]r|vulk[aá]n|h[oő]hull[aá]m|h[oó]vihar)\b/i;

const GLOBAL_THREAT_TERMS = /\b(space[\s_-]?weather|geomagnetic|solar[\s_-]?flare|swpc|celestrak|nuclear|radiation|nuke[\s_-]?anomaly|radiological|systemic)\b/i;

const DOMESTIC_SOURCES = new Set(['idokep', 'hungaromet', 'omsz', 'police-hajdu', 'dehir', 'haon']);

/**
 * Checks if coordinates fall within the geographic bounds of Hungary (with a slight border buffer).
 */
export function isHungaryCoordinates(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= 45.7 && lat <= 48.65 && lon >= 16.1 && lon <= 22.95;
}

/**
 * Checks if the alert is a weather or natural disaster alert.
 */
export function isWeatherOrNaturalAlert(alert) {
  if (!alert || typeof alert !== 'object') return false;
  if (alert.kind === 'weather' || alert.kind === 'natural' || alert.kind === 'earthquake' || alert.kind === 'disaster') {
    return true;
  }
  const text = `${alert.title || ''} ${alert.summary || ''} ${alert.ruleName || ''} ${alert.ruleId || ''}`;
  if (WEATHER_NATURAL_TERMS.test(text)) return true;

  if (Array.isArray(alert.evidence)) {
    for (const item of alert.evidence) {
      if (!item || typeof item !== 'object') continue;
      if (['weather', 'natural', 'earthquake', 'disaster'].includes(item.kind)) return true;
      const evText = `${item.title || ''} ${item.source || ''}`;
      if (WEATHER_NATURAL_TERMS.test(evText)) return true;
    }
  }
  return false;
}

/**
 * Checks if the alert represents a global threat that must always notify.
 */
export function isGlobalThreat(alert) {
  if (!alert || typeof alert !== 'object') return false;
  const text = `${alert.title || ''} ${alert.summary || ''} ${alert.ruleId || ''} ${alert.ruleName || ''}`;
  if (GLOBAL_THREAT_TERMS.test(text)) return true;

  if (Array.isArray(alert.evidence)) {
    for (const item of alert.evidence) {
      if (!item || typeof item !== 'object') continue;
      const evText = `${item.title || ''} ${item.source || ''}`;
      if (GLOBAL_THREAT_TERMS.test(evText)) return true;
    }
  }
  return false;
}

/**
 * Checks if the alert has domestic (Hungarian) territorial affiliation.
 */
export function isDomesticAlert(alert) {
  if (!alert || typeof alert !== 'object') return false;

  // 1. Entity coordinates
  if (alert.entity && typeof alert.entity === 'object') {
    if (isHungaryCoordinates(alert.entity.lat, alert.entity.lon)) return true;
    if (alert.entity.label && DOMESTIC_TERMS.test(alert.entity.label)) return true;
  }

  // 2. Evidence coordinates & sources
  if (Array.isArray(alert.evidence)) {
    for (const item of alert.evidence) {
      if (!item || typeof item !== 'object') continue;
      if (isHungaryCoordinates(item.lat, item.lon)) return true;
      if (item.source && DOMESTIC_SOURCES.has(String(item.source).toLowerCase())) return true;
      if (item.title && DOMESTIC_TERMS.test(item.title)) return true;
    }
  }

  // 3. Text in title, summary, rule
  const text = `${alert.title || ''} ${alert.summary || ''} ${alert.ruleName || ''}`;
  if (DOMESTIC_TERMS.test(text)) return true;

  return false;
}

/**
 * Evaluates and applies regional scope rules to an alert object.
 * In domestic mode:
 * - If non-domestic weather/natural disaster and not a global threat:
 *   sets alert.regionalNotice = 'nem hazai, nem értesít' and returns { suppressed: true }.
 * - Otherwise:
 *   returns { suppressed: false }.
 */
export function evaluateRegionalScope(alert, scope = 'all') {
  if (!alert || typeof alert !== 'object') return { suppressed: false };
  const normalizedScope = String(scope).trim().toLowerCase();
  if (!['domestic', 'carpathian_basin', 'karpat_medence'].includes(normalizedScope)) {
    return { suppressed: false };
  }

  // Global threats always notify unconditionally
  if (isGlobalThreat(alert)) {
    return { suppressed: false };
  }

  // Only weather and natural disaster alerts are filtered by domestic scope
  if (!isWeatherOrNaturalAlert(alert)) {
    return { suppressed: false };
  }

  // If it's domestic, it notifies normally
  if (isDomesticAlert(alert)) {
    return { suppressed: false };
  }

  // Non-domestic weather/natural disaster alert -> attach notice badge and suppress notification
  alert.regionalNotice = 'nem hazai, nem értesít';
  return { suppressed: true };
}
