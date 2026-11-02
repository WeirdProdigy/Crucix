// Crucix Weather Intelligence Synthesizer
// Unifies Open-Meteo (DWD ICON), HungaroMet ODP biometeorology, and HungaroMet ODP ground measurements.

export function synthesizeWeather(weatherData = {}, hungarometObsData = null, opts = {}) {
  // Gracefully handle either (weatherData, hungarometObsData, opts) or legacy (weatherData, opts)
  let obs = hungarometObsData;
  let options = opts;

  if (hungarometObsData && typeof hungarometObsData === 'object' && ('now' in hungarometObsData && !hungarometObsData.data && !hungarometObsData.stations && !hungarometObsData.source)) {
    options = hungarometObsData;
    obs = null;
  }

  const effectiveNow = options.now ?? Date.now();
  const data = weatherData?.data || weatherData || {};
  const observed = obs?.data || obs || null;

  const byRegion = data.byRegion || {
    local: [],
    county: [],
    national: [],
    regional_ce: []
  };

  const locations = Array.isArray(data.locations) ? data.locations : [];
  const biomet = data.biomet || {
    score: null,
    level: 'unknown',
    tendency: 'Nincs elérhető adat',
    formula: 'Score = (|ΔP| / 3) + (|ΔT| / 2)',
    disclaimer: 'Modellszámítás, nem orvosi tanács',
    officialUrl: 'https://www.met.hu/idojaras/orvosmeteorologia/'
  };

  const hungaroMetBulletin = data.hungaroMetBulletin || null;

  return {
    timestamp: new Date(effectiveNow).toISOString(),
    status: weatherData?.status || (data.enabled === false ? 'disabled' : 'unknown'),
    enabled: data.enabled !== false,
    byRegion,
    locations,
    biomet,
    hungaroMetBulletin,
    observed,
    attribution: {
      openMeteo: 'Open-Meteo.com (DWD ICON, CC BY 4.0)',
      hungaroMet: 'HungaroMet ODP (Nyílt Adattár)'
    }
  };
}
