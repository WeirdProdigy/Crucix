// Crucix Space Weather Intelligence Synthesizer
// Unifies NOAA SWPC, GFZ Potsdam, and Schumann geophysics monitoring.

export const SPACE_WEATHER_SCALES_HU = Object.freeze({
  G: {
    name: 'Geomágneses vihar',
    code: 'G',
    levels: {
      0: { label: 'G0', title: 'Nyugodt', desc: 'Nincs geomágneses vihartevékenység (Kp < 5)', color: '#64f0c8', dangerous: false },
      1: { label: 'G1', title: 'Kisebb', desc: 'Gyenge elektromos hálózati ingadozás, sarki fény magas szélességeken (Kp=5)', color: '#81d4fa', dangerous: false },
      2: { label: 'G2', title: 'Mérsékelt', desc: 'Feszültségriasztások magas szélességeken, műholdas pályakorrekciók (Kp=6)', color: '#ffe082', dangerous: false },
      3: { label: 'G3', title: 'Erős', desc: 'Feszültségingadozások, műholdas navigációs és HF rádiós zavarok (Kp=7)', color: '#ffb84c', dangerous: false },
      4: { label: 'G4', title: 'Súlyos', desc: 'Hálózati védelmi lekapcsolások veszélye, elterjedt GPS és rádiós kimaradások (Kp=8)', color: '#ff5f63', dangerous: true },
      5: { label: 'G5', title: 'Szélsőséges', desc: 'Kiterjedt áramkimaradás, transzformátor-károsodás, HF rádió teljes kiesése napokra (Kp=9)', color: '#e040fb', dangerous: true }
    }
  },
  R: {
    name: 'Rádió-blackout',
    code: 'R',
    levels: {
      0: { label: 'R0', title: 'Nyugodt', desc: 'Normális ionoszférikus rádióhullám-terjedés', color: '#64f0c8', dangerous: false },
      1: { label: 'R1', title: 'Kisebb', desc: 'Gyenge HF rádiójel-csillapodás a nappali oldalon (M1 röntgenflair)', color: '#81d4fa', dangerous: false },
      2: { label: 'R2', title: 'Mérsékelt', desc: 'Korlátozott HF rádiókapcsolat tízpercekig (M5 röntgenflair)', color: '#ffe082', dangerous: false },
      3: { label: 'R3', title: 'Erős', desc: 'Széles körű HF rádiózavar, navigációs jelek romlása 1-2 óráig (X1 flair)', color: '#ffb84c', dangerous: false },
      4: { label: 'R4', title: 'Súlyos', desc: 'HF rádió teljes kiesése a nappali félgömbön 1-2 órára (X10 flair)', color: '#ff5f63', dangerous: true },
      5: { label: 'R5', title: 'Szélsőséges', desc: 'Teljes rádiócsend a teljes nappali oldalon órákon át (X20+ flair)', color: '#e040fb', dangerous: true }
    }
  },
  S: {
    name: 'Sugárzási vihar',
    code: 'S',
    levels: {
      0: { label: 'S0', title: 'Nyugodt', desc: 'Normál napenergiás protonfluxus', color: '#64f0c8', dangerous: false },
      1: { label: 'S1', title: 'Kisebb', desc: 'Kisebb HF kommunikációs zavarok a sarkvidéki útvonalakon', color: '#81d4fa', dangerous: false },
      2: { label: 'S2', title: 'Mérsékelt', desc: 'Kis dózistöbblet magasrepülésen, műholdas memóriahibák', color: '#ffe082', dangerous: false },
      3: { label: 'S3', title: 'Erős', desc: 'Sarkvidéki légi útvonalak kerülése javasolt, űrséták veszélye', color: '#ffb84c', dangerous: false },
      4: { label: 'S4', title: 'Súlyos', desc: 'Elkerülhetetlen sugárdózis űrhajósoknak, műholdak leállása', color: '#ff5f63', dangerous: true },
      5: { label: 'S5', title: 'Szélsőséges', desc: 'Kritikus biológiai veszély, műholdak maradandó sérülése', color: '#e040fb', dangerous: true }
    }
  }
});

export function getScaleInfo(scaleType, level) {
  const scale = SPACE_WEATHER_SCALES_HU[scaleType];
  if (!scale) return null;
  const numLevel = Math.max(0, Math.min(5, Number(level) || 0));
  return scale.levels[numLevel] || scale.levels[0];
}

/**
 * Synthesizes space weather data from raw NOAA-SWPC and GFZ-Potsdam sources.
 */
export function synthesizeSpaceWeather(swpcData = {}, gfzData = {}, { now = Date.now() } = {}) {
  const swpc = swpcData?.data || swpcData || {};
  const gfz = gfzData?.data || gfzData || {};

  const swpcMetrics = swpc.metrics || {};
  const gfzMetrics = gfz.metrics || {};

  // Extract scale levels
  const gLevel = Number(swpcMetrics.geomagneticStorms?.scale ?? 0);
  const rLevel = Number(swpcMetrics.radioBlackouts?.scale ?? 0);
  const sLevel = Number(swpcMetrics.solarRadiationStorms?.scale ?? 0);

  const gScale = getScaleInfo('G', gLevel);
  const rScale = getScaleInfo('R', rLevel);
  const sScale = getScaleInfo('S', sLevel);

  const isDangerous = gScale.dangerous || rScale.dangerous || sScale.dangerous;

  // Kp readings: NOAA vs GFZ
  const noaaKp = swpc.kp?.kp ?? swpcMetrics.kp ?? null;
  const gfzKp = gfzMetrics.kp ?? null;
  const gfzHp30 = gfzMetrics.hp30 ?? null;
  const gfzHp60 = gfzMetrics.hp60 ?? null;

  // Best consensus Kp
  const currentKp = gfzKp !== null ? gfzKp : noaaKp;

  // Solar wind
  const wind = swpc.wind || swpc.solarWind || {};
  const solarWind = {
    speed: Number.isFinite(wind.speed) ? wind.speed : null,
    density: Number.isFinite(wind.density) ? wind.density : null,
    temperature: Number.isFinite(wind.temperature) ? wind.temperature : null,
    bz: Number.isFinite(wind.bz) ? wind.bz : null,
    bt: Number.isFinite(wind.bt) ? wind.bt : null,
    source: wind.source || null,
    timeTag: wind.timeTag || null
  };

  // Solar X-ray flux
  const xrays = swpc.xrays || {};
  const xrayClass = xrays.xrayClass || (rLevel > 0 ? `R${rLevel}` : 'A/B');

  // 3-day forecast
  const forecast = swpc.forecast || {};

  // Active alerts
  const alerts = swpc.alerts || {};
  const activeAlerts = Array.isArray(alerts.activeAlerts) ? alerts.activeAlerts : [];

  // Schumann geophysics link-card metadata
  const schumann = {
    title: 'Schumann-rezonancia (Tomszki Állami Egyetem)',
    fundamentalFrequencyHz: 7.83,
    harmonicsHz: [14.3, 20.8, 27.3, 33.8],
    descriptionHu: 'Tomszk, Nyugat-Szibéria; ELF/VLF elektromágneses zajszonogram az elmúlt 3 napról; a Föld–ionoszféra üregrezonátor alaprezgése (7,83 Hz) és felharmonikusai (14,3 / 20,8 / 27,3 / 33,8 Hz). Tájékoztató jellegű vizualizáció, nincs hivatalos API.',
    disclaimer: 'Geofizikai mérési adat; élettani vagy egészségügyi hatása tudományosan nem igazolt (orvosi állítás nélkül).',
    station: 'Tomsk, Nyugat-Szibéria (TSU / sos70.ru)',
    sourceUrl: 'https://sosrff.tsu.ru/',
    mirrorUrl: 'http://sos70.ru/'
  };

  return {
    timestamp: new Date(now).toISOString(),
    isDangerous,
    scales: {
      G: { level: gLevel, ...gScale },
      R: { level: rLevel, ...rScale },
      S: { level: sLevel, ...sScale }
    },
    kp: {
      current: currentKp,
      noaaKp,
      gfzKp,
      gfzHp30,
      gfzHp60,
      gfzStatus: gfzMetrics.kpStatus || null,
      historyGfz: gfzMetrics.history24h || null
    },
    solarWind,
    xrays: {
      class: xrayClass,
      flux: xrays.flux || null,
      satellite: xrays.satellite || null
    },
    forecast: {
      maxExpectedKp: forecast.maxExpectedKp ?? null,
      maxExpectedGScale: forecast.maxExpectedGScale ?? 'None',
      summary: forecast.summary ?? null
    },
    alerts: {
      count: alerts.activeCount ?? activeAlerts.length,
      items: activeAlerts.slice(0, 5)
    },
    schumann,
    sources: {
      noaa: {
        status: swpcData?.status || 'unknown',
        lastUpdated: swpc?.timestamp || swpc?.observedAt || null
      },
      gfz: {
        status: gfzData?.status || (gfzData?.data?.enabled === false ? 'disabled' : 'unknown'),
        lastUpdated: gfz?.observedAt || gfz?.timestamp || null,
        attribution: 'GFZ Potsdam (CC BY 4.0)'
      }
    }
  };
}
