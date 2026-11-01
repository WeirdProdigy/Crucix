import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEATHER_LOCATIONS,
  WMO_CODES_HU,
  getWeatherDescription,
  calculateBiometIndex,
  parseHungaroMetMedicalForecast,
  parseOpenMeteoLocation,
  clearWeatherCache,
  briefing as weatherBriefing
} from '../apis/sources/weather-service.mjs';
import { synthesizeWeather } from '../lib/intelligence/weather.mjs';

test('1. WEATHER_LOCATIONS: covers all 4 territorial scopes and adheres to daily call budget', () => {
  const locs = Object.values(WEATHER_LOCATIONS);
  assert.equal(locs.length, 14, 'Configures 14 territorial stations');

  const local = locs.filter(l => l.region === 'local');
  const county = locs.filter(l => l.region === 'county');
  const national = locs.filter(l => l.region === 'national');
  const regionalCe = locs.filter(l => l.region === 'regional_ce');

  assert.equal(local.length, 2, 'Local includes Bihartorda and Debrecen');
  assert.ok(local.some(l => l.id === 'bihartorda'));
  assert.ok(local.some(l => l.id === 'debrecen'));

  assert.ok(county.length >= 2, 'County includes Hajdú-Bihar towns');
  assert.ok(national.length >= 5, 'National includes 5 major Hungarian cities');
  assert.ok(regionalCe.length >= 3, 'Central Europe includes cross-border capitals');

  // Rate budget calculation: 15-minute sweep (96 sweeps/day) * 14 locations = 1344 calls/day
  const dailyCalls = 96 * locs.length;
  assert.equal(dailyCalls, 1344);
  assert.ok(dailyCalls < 10000, 'Daily call volume is well within Open-Meteo 10,000 free non-commercial limit');
});

test('2. WMO weather codes: returns Hungarian descriptive text', () => {
  assert.equal(getWeatherDescription(0), 'Tiszta, derült égbolt');
  assert.equal(getWeatherDescription(61), 'Gyenge eső');
  assert.equal(getWeatherDescription(71), 'Gyenge havazás');
  assert.equal(getWeatherDescription(95), 'Zivatar');
  assert.match(getWeatherDescription(999), /Ismeretlen/);
});

test('3. calculateBiometIndex: transparent formula, neutral non-medical terminology, and disclaimer', () => {
  // Low level test: ΔP = 0.3 hPa, ΔT = 0.5 °C -> Score = (0.3/3) + (0.5/2) = 0.1 + 0.25 = 0.4
  const biometLow = calculateBiometIndex(1015.3, 1015.0, 12.5, 12.0);
  assert.equal(biometLow.level, 'csekely');
  assert.match(biometLow.tendency, /csekély légköri változás/i);
  assert.equal(biometLow.disclaimer, 'Modellszámítás, nem orvosi tanács');

  // Moderate test: ΔP = -3.0 hPa, ΔT = +2.0 °C -> Score = (3/3) + (2/2) = 2.0
  const biomet = calculateBiometIndex(1012.0, 1015.0, 14.0, 12.0);
  assert.equal(biomet.deltaPressure24h, -3.0);
  assert.equal(biomet.deltaTemp24h, 2.0);
  assert.equal(biomet.score, 2.0);
  assert.equal(biomet.level, 'mersekelt');
  assert.match(biomet.tendency, /mérsékelt légköri változás/i);
  assert.equal(biomet.disclaimer, 'Modellszámítás, nem orvosi tanács');
  assert.equal(biomet.formula, 'Score = (|ΔP| / 3) + (|ΔT| / 2) [24 órás bázison]');

  // Significant test: ΔP = +6.0 hPa, ΔT = -5.0 °C -> Score = (6/3) + (5/2) = 2.0 + 2.5 = 4.5
  const biometHigh = calculateBiometIndex(1020.0, 1014.0, 5.0, 10.0);
  assert.equal(biometHigh.score, 4.5);
  assert.equal(biometHigh.level, 'jelentős');
  assert.match(biometHigh.tendency, /jelentős/i);

  // Missing data test
  const biometMissing = calculateBiometIndex(null, null, null, null);
  assert.equal(biometMissing.score, null);
  assert.equal(biometMissing.level, 'unknown');
  assert.equal(biometMissing.disclaimer, 'Modellszámítás, nem orvosi tanács');
});

test('4. parseHungaroMetMedicalForecast: parses official XML and text formats', () => {
  const xmlSample = `<?xml version="1.0" encoding="utf-8"?>
<bulletin create_datetime="2026-11-01T06:00:00Z">
  <valid date="2026-11-01"/>
  <detailed_description>
    Fronthatás nem terheli az időjárásra érzékenyek szervezetét.
    Napközben kellemes, kora őszi idő várható.
  </detailed_description>
</bulletin>`;

  const parsedXml = parseHungaroMetMedicalForecast(xmlSample);
  assert.ok(parsedXml);
  assert.equal(parsedXml.source, 'HungaroMet-ODP');
  assert.equal(parsedXml.validDate, '2026-11-01');
  assert.match(parsedXml.description, /Fronthatás nem terheli/);

  // Plain text format
  const txtSample = `
# HungaroMet Orvosmeteorológia
Kettősfronti hatás érvényesül. A fejfájósok és keringési panaszokkal küzdők óvatosak legyenek.
`;
  const parsedTxt = parseHungaroMetMedicalForecast(txtSample);
  assert.ok(parsedTxt);
  assert.match(parsedTxt.description, /Kettősfronti hatás/);

  // Null input
  assert.equal(parseHungaroMetMedicalForecast(null), null);
  assert.equal(parseHungaroMetMedicalForecast(''), null);
});

test('5. parseOpenMeteoLocation: extracts current conditions and daily forecast', () => {
  const mockRaw = {
    current: {
      time: '2026-11-01T12:00',
      temperature_2m: 13.5,
      apparent_temperature: 12.1,
      surface_pressure: 1016.4,
      relative_humidity_2m: 68,
      wind_speed_10m: 18.5,
      wind_gusts_10m: 32.0,
      precipitation: 0.2,
      weather_code: 3
    },
    daily: {
      time: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'],
      temperature_2m_max: [14.0, 12.5, 11.0, 10.2, 9.8],
      temperature_2m_min: [6.0, 5.2, 4.0, 3.5, 2.0],
      weather_code: [3, 61, 2, 1, 0],
      precipitation_sum: [0.2, 4.5, 0.0, 0.0, 0.0],
      precipitation_probability_max: [20, 85, 10, 5, 0]
    }
  };

  const parsed = parseOpenMeteoLocation(mockRaw, WEATHER_LOCATIONS.debrecen);
  assert.equal(parsed.id, 'debrecen');
  assert.equal(parsed.name, 'Debrecen');
  assert.equal(parsed.region, 'local');
  assert.equal(parsed.current.temp, 13.5);
  assert.equal(parsed.current.feelsLike, 12.1);
  assert.equal(parsed.current.surfacePressure, 1016.4);
  assert.equal(parsed.current.weatherCode, 3);
  assert.equal(parsed.current.weatherTextHu, 'Borult');
  assert.equal(parsed.forecast.length, 5);
  assert.equal(parsed.forecast[0].tempMax, 14.0);
  assert.equal(parsed.forecast[1].weatherTextHu, 'Gyenge eső');
});

test('6. Weather Service briefing: respects CRUCIX_ENABLE_WEATHER opt-in flag', async () => {
  const origEnv = process.env.CRUCIX_ENABLE_WEATHER;
  try {
    delete process.env.CRUCIX_ENABLE_WEATHER;
    const resDisabled = await weatherBriefing();
    assert.equal(resDisabled.status, 'disabled');
    assert.equal(resDisabled.data.enabled, false);

    process.env.CRUCIX_ENABLE_WEATHER = 'false';
    const resExplicitFalse = await weatherBriefing();
    assert.equal(resExplicitFalse.status, 'disabled');
  } finally {
    if (origEnv !== undefined) {
      process.env.CRUCIX_ENABLE_WEATHER = origEnv;
    } else {
      delete process.env.CRUCIX_ENABLE_WEATHER;
    }
  }
});

test('7. synthesizeWeather: organizes locations by region and preserves biomet indicators', () => {
  const mockLocation = {
    id: 'bihartorda',
    name: 'Bihartorda',
    region: 'local',
    current: { temp: 12.0, surfacePressure: 1018.0, weatherTextHu: 'Túlnyomóan derült' }
  };

  const mockPayload = {
    status: 'ok',
    data: {
      enabled: true,
      locations: [mockLocation],
      byRegion: {
        local: [mockLocation],
        county: [],
        national: [],
        regional_ce: []
      },
      biomet: {
        score: 1.2,
        level: 'alacsony',
        tendency: 'Nincs jelentős terhelés',
        formula: 'Score = (|ΔP| / 3) + (|ΔT| / 2)',
        disclaimer: 'Modellszámítás, nem orvosi tanács'
      },
      hungaroMetBulletin: {
        source: 'HungaroMet-ODP',
        description: 'Nyugodt őszi idő'
      }
    }
  };

  const syn = synthesizeWeather(mockPayload, { now: Date.parse('2026-11-01T12:00:00Z') });
  assert.equal(syn.status, 'ok');
  assert.equal(syn.enabled, true);
  assert.equal(syn.byRegion.local.length, 1);
  assert.equal(syn.byRegion.local[0].name, 'Bihartorda');
  assert.equal(syn.biomet.score, 1.2);
  assert.equal(syn.biomet.level, 'alacsony');
  assert.equal(syn.attribution.openMeteo, 'Open-Meteo.com (DWD ICON, CC BY 4.0)');
});

test('8. Weather-Service: Cache TTL 30 minutes limits upstream calls', async () => {
  clearWeatherCache();
  const origEnv = process.env.CRUCIX_ENABLE_WEATHER;
  process.env.CRUCIX_ENABLE_WEATHER = 'true';
  try {
    const t0 = Date.parse('2026-11-01T12:00:00Z');
    // Call with a single local station to avoid full network fetch
    const res1 = await weatherBriefing({
      now: t0,
      locations: [{ id: 'bihartorda', name: 'Bihartorda', region: 'local', lat: 47.165, lon: 21.365 }],
      fetchHungaroMet: false
    });
    assert.ok(res1);

    // Call 15 minutes later: within 30 min cache TTL
    const res2 = await weatherBriefing({ now: t0 + 15 * 60 * 1000 });
    assert.equal(res2.status, res1.status);
    assert.equal(res2.observedAt, res1.observedAt);
  } finally {
    clearWeatherCache();
    if (origEnv !== undefined) {
      process.env.CRUCIX_ENABLE_WEATHER = origEnv;
    } else {
      delete process.env.CRUCIX_ENABLE_WEATHER;
    }
  }
});
