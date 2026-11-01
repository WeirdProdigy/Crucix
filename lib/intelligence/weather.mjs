// Crucix Weather Intelligence Synthesizer
// Unifies Open-Meteo (DWD ICON) and HungaroMet ODP biometeorology.

export function synthesizeWeather(weatherData = {}, { now = Date.now() } = {}) {
  const data = weatherData?.data || weatherData || {};

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
    timestamp: new Date(now).toISOString(),
    status: weatherData?.status || (data.enabled === false ? 'disabled' : 'unknown'),
    enabled: data.enabled !== false,
    byRegion,
    locations,
    biomet,
    hungaroMetBulletin,
    attribution: {
      openMeteo: 'Open-Meteo.com (DWD ICON, CC BY 4.0)',
      hungaroMet: 'HungaroMet ODP (Nyílt Adattár)'
    }
  };
}
