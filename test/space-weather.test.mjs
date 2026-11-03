import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGfzIndexSeries,
  parseGfzData,
  getGfzHeaders,
  clearGfzCache,
  briefing as gfzBriefing
} from '../apis/sources/gfz-potsdam.mjs';
import {
  parseSwpcNotifyThreshold
} from '../apis/sources/swpc.mjs';
import {
  SPACE_WEATHER_SCALES_HU,
  getScaleInfo,
  synthesizeSpaceWeather
} from '../lib/intelligence/space-weather.mjs';

test('1. GFZ Potsdam: parseGfzIndexSeries parses parallel arrays correctly', () => {
  const sample = {
    datetime: ['2026-11-01T12:00:00Z', '2026-11-01T15:00:00Z', '2026-11-01T18:00:00Z'],
    Kp: [2.333, 3.0, 4.667],
    status: ['def', 'def', 'pre']
  };

  const parsed = parseGfzIndexSeries(sample, 'Kp');
  assert.ok(parsed);
  assert.equal(parsed.series.length, 3);
  assert.equal(parsed.latest.time, '2026-11-01T18:00:00Z');
  assert.equal(parsed.latest.value, 4.667);
  assert.equal(parsed.latest.status, 'pre');

  // Handles null, non-object, and missing arrays
  assert.equal(parseGfzIndexSeries(null, 'Kp'), null);
  assert.equal(parseGfzIndexSeries({}, 'Kp'), null);
  assert.equal(parseGfzIndexSeries({ datetime: [] }, 'Kp'), null);
  assert.equal(parseGfzIndexSeries({ datetime: ['2026-11-01T00:00:00Z'], Kp: [] }, 'Kp'), null);
});

test('2. GFZ Potsdam: parseGfzData combines Kp, Hp30, and Hp60 and assigns G-scale', () => {
  const rawKp = {
    datetime: ['2026-11-01T15:00:00Z', '2026-11-01T18:00:00Z'],
    Kp: [3.333, 7.0],
    status: ['pre', 'pre']
  };
  const rawHp30 = {
    datetime: ['2026-11-01T17:30:00Z', '2026-11-01T18:00:00Z'],
    Hp30: [5.1, 7.2],
    status: ['pre', 'pre']
  };
  const rawHp60 = {
    datetime: ['2026-11-01T17:00:00Z', '2026-11-01T18:00:00Z'],
    Hp60: [4.8, 7.1],
    status: ['pre', 'pre']
  };

  const result = parseGfzData(rawKp, rawHp30, rawHp60, { now: Date.parse('2026-11-01T18:05:00Z') });
  assert.equal(result.source, 'GFZ-Potsdam');
  assert.equal(result.status, 'ok');
  assert.equal(result.stale, false);
  assert.equal(result.metrics.kp, 7.0);
  assert.equal(result.metrics.hp30, 7.2);
  assert.equal(result.metrics.hp60, 7.1);
  assert.equal(result.metrics.gScale, 'G3');
  assert.equal(result.metrics.gSeverity, 'high');
  assert.equal(result.observations.length, 1);
  assert.match(result.observations[0].title, /G3/);
});

test('3. GFZ Potsdam: parseGfzData handles completely missing or empty data gracefully', () => {
  const result = parseGfzData(null, null, null, { now: Date.parse('2026-11-01T18:05:00Z') });
  assert.equal(result.status, 'error');
  assert.equal(result.freshness.fresh, false);
  assert.equal(result.source, 'GFZ-Potsdam');
});

test('4. GFZ Potsdam: briefing respects CRUCIX_ENABLE_GFZ opt-in flag', async () => {
  const origEnv = process.env.CRUCIX_ENABLE_GFZ;
  try {
    delete process.env.CRUCIX_ENABLE_GFZ;
    const resDisabled = await gfzBriefing();
    assert.equal(resDisabled.status, 'disabled');
    assert.equal(resDisabled.data.enabled, false);

    process.env.CRUCIX_ENABLE_GFZ = 'false';
    const resExplicitFalse = await gfzBriefing();
    assert.equal(resExplicitFalse.status, 'disabled');
  } finally {
    if (origEnv !== undefined) {
      process.env.CRUCIX_ENABLE_GFZ = origEnv;
    } else {
      delete process.env.CRUCIX_ENABLE_GFZ;
    }
  }
});

test('5. GFZ Potsdam: getGfzHeaders includes Crucix User-Agent and Accept', () => {
  const headers = getGfzHeaders();
  assert.ok(headers['User-Agent'].startsWith('Crucix/'));
  assert.equal(headers['Accept'], 'application/json');
});

test('6. Space Weather Scales: NOAA scale Hungarian naming, level 3 not dangerous, level 4+ dangerous', () => {
  // G-scale
  const g0 = getScaleInfo('G', 0);
  assert.equal(g0.label, 'G0');
  assert.equal(g0.title, 'Nyugodt');
  assert.equal(g0.dangerous, false);

  const g1 = getScaleInfo('G', 1);
  assert.equal(g1.title, 'Kisebb');
  assert.equal(g1.dangerous, false);

  const g2 = getScaleInfo('G', 2);
  assert.equal(g2.title, 'Mérsékelt');
  assert.equal(g2.dangerous, false);

  const g3 = getScaleInfo('G', 3);
  assert.equal(g3.label, 'G3');
  assert.equal(g3.title, 'Erős');
  assert.equal(g3.dangerous, false, 'Level 3 Erős must NOT be marked as dangerous (no VESZÉLYES badge)');

  const g4 = getScaleInfo('G', 4);
  assert.equal(g4.label, 'G4');
  assert.equal(g4.title, 'Súlyos');
  assert.equal(g4.dangerous, true, 'Level 4 Súlyos must be marked as dangerous');

  const g5 = getScaleInfo('G', 5);
  assert.equal(g5.label, 'G5');
  assert.equal(g5.title, 'Szélsőséges');
  assert.equal(g5.dangerous, true, 'Level 5 Szélsőséges must be marked as dangerous');
  assert.equal(g5.color, '#e040fb');

  // R-scale
  const r2 = getScaleInfo('R', 2);
  assert.equal(r2.title, 'Mérsékelt');
  assert.equal(r2.dangerous, false);
  const r3 = getScaleInfo('R', 3);
  assert.equal(r3.title, 'Erős');
  assert.equal(r3.dangerous, false, 'R3 Erős must NOT be marked as dangerous');
  const r4 = getScaleInfo('R', 4);
  assert.equal(r4.title, 'Súlyos');
  assert.equal(r4.dangerous, true);

  // S-scale
  const s1 = getScaleInfo('S', 1);
  assert.equal(s1.title, 'Kisebb');
  assert.equal(s1.dangerous, false);
  const s2 = getScaleInfo('S', 2);
  assert.equal(s2.title, 'Mérsékelt');
  assert.equal(s2.dangerous, false);
  const s3 = getScaleInfo('S', 3);
  assert.equal(s3.title, 'Erős');
  assert.equal(s3.dangerous, false, 'S3 Erős must NOT be marked as dangerous');
  const s4 = getScaleInfo('S', 4);
  assert.equal(s4.title, 'Súlyos');
  assert.equal(s4.dangerous, true);

  // Clamping
  assert.equal(getScaleInfo('G', -1).label, 'G0');
  assert.equal(getScaleInfo('G', 99).label, 'G5');
  assert.equal(getScaleInfo('INVALID', 2), null);
});

test('7. synthesizeSpaceWeather: unifies NOAA SWPC and GFZ Potsdam, flags dangerous activity only at level 4+', () => {
  const mockSwpc = {
    status: 'fresh',
    metrics: {
      geomagneticStorms: { scale: 3 },
      radioBlackouts: { scale: 0 },
      solarRadiationStorms: { scale: 1 },
      kp: 6.67
    },
    wind: { speed: 520, bz: -8.5, density: 12.3 },
    xrays: { xrayClass: 'M2.4' },
    forecast: { maxExpectedKp: 7.0, maxExpectedGScale: 'G3' },
    alerts: {
      activeCount: 1,
      activeAlerts: [
        { type: 'geomagnetic-warning', gLevel: 3, messageSnippet: 'Geomagnetic Storm Watch G3' }
      ]
    }
  };

  const mockGfz = {
    status: 'fresh',
    metrics: {
      kp: 7.0,
      hp30: 7.33,
      hp60: 7.0,
      kpStatus: 'pre',
      gScale: 'G3'
    }
  };

  const syn = synthesizeSpaceWeather(mockSwpc, mockGfz, { now: Date.parse('2026-11-01T18:00:00Z') });
  assert.equal(syn.isDangerous, false, 'G3 storm must NOT flag global danger');
  assert.equal(syn.scales.G.level, 3);
  assert.equal(syn.scales.G.title, 'Erős');
  assert.equal(syn.scales.G.dangerous, false);
  assert.equal(syn.kp.current, 7.0); // Prefer GFZ
  assert.equal(syn.kp.noaaKp, 6.67);
  assert.equal(syn.kp.gfzKp, 7.0);
  assert.equal(syn.kp.gfzHp30, 7.33);
  assert.equal(syn.solarWind.speed, 520);
  assert.equal(syn.solarWind.bz, -8.5);
  assert.equal(syn.xrays.class, 'M2.4');
  assert.equal(syn.forecast.maxExpectedGScale, 'G3');
  assert.equal(syn.alerts.count, 1);
  assert.equal(syn.sources.noaa.status, 'fresh');
  assert.equal(syn.sources.gfz.status, 'fresh');

  // Verify that G4 flags dangerous
  const mockG4 = {
    metrics: { geomagneticStorms: { scale: 4 } }
  };
  const synG4 = synthesizeSpaceWeather(mockG4, {}, { now: Date.parse('2026-11-01T18:00:00Z') });
  assert.equal(synG4.isDangerous, true, 'G4 Súlyos storm must flag danger');
  assert.equal(synG4.scales.G.title, 'Súlyos');
  assert.equal(synG4.scales.G.dangerous, true);
});

test('8. Schumann geophysics link-card: strict absence of pseudoscientific health claims', () => {
  const syn = synthesizeSpaceWeather({}, {});
  const schumann = syn.schumann;
  assert.ok(schumann);
  assert.equal(schumann.fundamentalFrequencyHz, 7.83);
  assert.deepEqual(schumann.harmonicsHz, [14.3, 20.8, 27.3, 33.8]);
  assert.match(schumann.sourceUrl, /sosrff\.tsu\.ru/);
  assert.match(schumann.mirrorUrl, /sos70\.ru/);

  // Verification of geophysics disclaimer
  assert.match(schumann.disclaimer, /orvosi állítás nélkül|tudományosan nem igazolt/i);
  // Ensure no pseudoscientific health claims exist in metadata
  assert.doesNotMatch(schumann.descriptionHu, /gyógyító|csakrák|rezgésszint emelkedés|DNS aktiválás/i);
});

test('9. Configurable Thresholds: Dashboard (G3/R3/S2) vs Notification (G4/R4/S3)', () => {
  // Default notification minimum is G4, R4, S3
  const defaultNotify = parseSwpcNotifyThreshold();
  assert.equal(defaultNotify.g, 4, 'Telegram notify requires G4+');
  assert.equal(defaultNotify.r, 4, 'Telegram notify requires R4+');
  assert.equal(defaultNotify.s, 3, 'Telegram notify requires S3+');

  // Custom environment variable parsing
  const customNotify = parseSwpcNotifyThreshold('G3,R3,S2');
  assert.equal(customNotify.g, 3);
  assert.equal(customNotify.r, 3);
  assert.equal(customNotify.s, 2);
});

test('10. GFZ Potsdam: Cache TTL 30 minutes prevents redundant upstream fetch', async () => {
  clearGfzCache();
  const origEnv = process.env.CRUCIX_ENABLE_GFZ;
  process.env.CRUCIX_ENABLE_GFZ = 'true';
  try {
    const t0 = Date.parse('2026-11-01T12:00:00Z');
    // First call without network (mocked empty or handled)
    const res1 = await gfzBriefing({ now: t0 });
    assert.ok(res1);

    // Call 10 minutes later: within 30 min TTL
    const res2 = await gfzBriefing({ now: t0 + 10 * 60 * 1000 });
    assert.equal(res2.status, res1.status);
  } finally {
    clearGfzCache();
    if (origEnv !== undefined) {
      process.env.CRUCIX_ENABLE_GFZ = origEnv;
    } else {
      delete process.env.CRUCIX_ENABLE_GFZ;
    }
  }
});


test('11. space-weather-panel.js: guards undefined, null, and NaN Kp values without throwing', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const panelPath = path.join(testDir, '..', 'dashboard', 'public', 'space-weather-panel.js');
  const code = fs.readFileSync(panelPath, 'utf8');

  const mockWindow = {};
  const mockDocument = { querySelector: () => null };
  const runModule = new Function('window', 'document', code);
  runModule(mockWindow, mockDocument);

  assert.ok(mockWindow.CrucixSpaceWeatherPanel, 'CrucixSpaceWeatherPanel is defined');
  assert.equal(typeof mockWindow.CrucixSpaceWeatherPanel.panelHtml, 'function');

  const edgeSnapshots = [
    { spaceWeather: { kp: { noaaKp: undefined, gfzKp: null, gfzHp30: NaN, gfzHp60: 'not-a-number' } } },
    { spaceWeather: { kp: {} } },
    { spaceWeather: {} },
    {},
    null,
    undefined
  ];

  for (const snap of edgeSnapshots) {
    assert.doesNotThrow(() => {
      const html = mockWindow.CrucixSpaceWeatherPanel.panelHtml(snap);
      assert.ok(typeof html === 'string', 'returns html string');
      assert.ok(html.includes('--'), 'renders fallback dashes for non-finite Kp values');
    });
  }

  const validSnap = {
    spaceWeather: {
      kp: { noaaKp: 4.67, gfzKp: 5.0, gfzHp30: 4.88, gfzHp60: 5.12, gfzStatus: 'def' }
    }
  };
  const validHtml = mockWindow.CrucixSpaceWeatherPanel.panelHtml(validSnap);
  assert.ok(validHtml.includes('4.67'), 'NOAA Kp formatted');
  assert.ok(validHtml.includes('5.00 (def)'), 'GFZ Kp formatted');
  assert.ok(validHtml.includes('4.88'), 'Hp30 formatted');
  assert.ok(validHtml.includes('5.12'), 'Hp60 formatted');
});
