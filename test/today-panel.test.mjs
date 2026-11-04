import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dashboard/public/today-panel.js', import.meta.url), 'utf8');

function panel() {
  const context = { window: {}, module: { exports: {} }, globalThis: {} };
  vm.runInNewContext(source, context);
  return context.module.exports;
}

const fresh = {
  sources: {
    Meteoalarm: { enabled: true, fresh: true, alerts: [{ severity: 'yellow', event: 'Zivatar', onset: '2026-11-04T08:00:00Z' }] },
    'HungaroMet-Observations': { enabled: true, fresh: true, timestamp: '2026-11-04T10:00:00Z', station: { temperatureC: 12, windSpeedKmh: 14, pressureHpa: 1014, precipitationMm: 0 } },
    'Open-Meteo': { enabled: true, fresh: true, daily: { minTemperature: 6, maxTemperature: 15, precipitationProbability: 30, precipitationSum: 1.2, summary: 'Napos' } },
    'OVF-Gauges': { enabled: true, fresh: true, gauges: [{ name: 'Berettyóújfalu', waterLevelCm: 132, observedAt: '2026-11-04T09:00:00Z', tendency: 'stagnál' }] },
    ovfDrought: { enabled: true, fresh: true, lastUpdated: '2026-11-04T06:00:00Z', soilMoisture: { '10-20cm': 24 }, droughtIndex: { value: 0.3 } },
    'Police-Hajdu': { enabled: true, fresh: true, items: [{ title: 'Rendőrségi közlemény', publishedAt: '2026-11-04T09:30:00Z' }] },
    localNews: { enabled: true, fresh: true, items: [{ title: 'Helyi hír', publishedAt: '2026-11-04T09:45:00Z' }] }
  },
  spaceWeather: { enabled: true, fresh: true, timestamp: '2026-11-04T10:00:00Z', kp: { noaaKp: 2.4 }, scales: { G: { label: 'G0' }, R: { label: 'R0' }, S: { label: 'S0' } } }
};

test('renders all eight Today Summary tiles with fresh data', () => {
  const html = panel().renderTodayPanel(fresh);
  assert.equal((html.match(/data-today-tile=/g) || []).length, 8);
  assert.match(html, /Meteoalarm/);
  assert.match(html, /Berettyóújfalu/);
  assert.match(html, /FRISS/);
  assert.doesNotMatch(html, /aggregate|composite|risk score|kockázati pontszám/i);
});

test('keeps every tile visible for stale, disabled, and missing sources', () => {
  const broken = { sources: { Meteoalarm: { enabled: false }, 'Open-Meteo': { enabled: true, stale: true, daily: {} } } };
  const html = panel().renderTodayPanel(broken);
  assert.equal((html.match(/data-today-tile=/g) || []).length, 8);
  assert.match(html, /KIKAPCSOLVA/);
  assert.match(html, /ELAVULT/);
  assert.match(html, /NINCS ADAT/);
});

test('escapes tile content', () => {
  const html = panel().renderTodayPanel({ localNews: { items: [{ title: '<script>alert(1)</script>' }] } });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('has no browser network primitives', () => {
  assert.equal((source.match(/fetch\(/g) || []).length, 0);
  assert.equal((source.match(/XMLHttpRequest/g) || []).length, 0);
});
