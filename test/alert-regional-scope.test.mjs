import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHungaryCoordinates,
  isWeatherOrNaturalAlert,
  isGlobalThreat,
  isDomesticAlert,
  evaluateRegionalScope
} from '../lib/alerts/regional-scope.mjs';
import { AlertNotifier } from '../lib/alerts/notify.mjs';

test('1. Regional scope evaluator: isHungaryCoordinates and territory detection', () => {
  assert.equal(isHungaryCoordinates(47.4979, 19.0402), true, 'Budapest is in Hungary');
  assert.equal(isHungaryCoordinates(47.5316, 21.6273), true, 'Debrecen is in Hungary');
  assert.equal(isHungaryCoordinates(35.6762, 139.6503), false, 'Tokyo is not in Hungary');
  assert.equal(isHungaryCoordinates(25.7617, -80.1918), false, 'Miami is not in Hungary');
  assert.equal(isHungaryCoordinates(null, undefined), false);
});

test('2. Regional scope: domestic vs non-domestic weather/natural alerts and global threats', () => {
  // Foreign earthquake
  const japanQuake = {
    id: 'quake-japan-1',
    ruleId: 'events-high',
    title: 'Earthquake M7.1 - Honshu, Japan',
    summary: 'A strong earthquake occurred off the east coast of Honshu, Japan.',
    kind: 'event',
    severity: 'high',
    notify: true,
    entity: { lat: 37.5, lon: 141.0, label: 'Honshu, Japan' },
    evidence: [{ kind: 'earthquake', source: 'USGS', title: 'M7.1 Honshu' }]
  };
  assert.equal(isWeatherOrNaturalAlert(japanQuake), true);
  assert.equal(isDomesticAlert(japanQuake), false);
  assert.equal(isGlobalThreat(japanQuake), false);

  // Domestic storm (Debrecen)
  const debrecenStorm = {
    id: 'weather-deb-1',
    ruleId: 'events-high',
    title: 'Viharos szél és felhőszakadás Debrecen térségében',
    summary: 'Katasztrófavédelem riasztás: faágak dőltek a 4-es főútra Debrecen közelében.',
    kind: 'event',
    severity: 'high',
    notify: true,
    entity: { lat: 47.53, lon: 21.62, label: 'Debrecen' },
    evidence: [{ kind: 'weather', source: 'Katasztrófavédelem Vész', title: 'Debreceni viharkár' }]
  };
  assert.equal(isWeatherOrNaturalAlert(debrecenStorm), true);
  assert.equal(isDomesticAlert(debrecenStorm), true);

  // Global threat: SWPC extreme geomagnetic storm G5
  const spaceWeather = {
    id: 'space-swpc-1',
    ruleId: 'events-critical',
    title: 'Extreme G5 Geomagnetic Storm in Progress',
    summary: 'NOAA-SWPC space weather alert: severe CME impact detected.',
    kind: 'event',
    severity: 'critical',
    notify: true,
    evidence: [{ kind: 'space-weather', source: 'NOAA-SWPC', title: 'G5 Geomagnetic Storm' }]
  };
  assert.equal(isGlobalThreat(spaceWeather), true);

  // Global threat: Nuclear anomaly
  const nukeAlert = {
    id: 'nuke-1',
    ruleId: 'events-critical',
    title: 'Radiation Monitor Anomaly Detected',
    summary: 'Radiation sensor spike: elevated background detected.',
    kind: 'event',
    severity: 'critical',
    notify: true,
    evidence: [{ title: 'nuke_anomaly sensor spike' }]
  };
  assert.equal(isGlobalThreat(nukeAlert), true);

  // Non-weather alert: Conflict / ACLED
  const conflictAlert = {
    id: 'conflict-1',
    ruleId: 'events-high',
    title: 'Armed Clashes in Khartoum',
    summary: 'ACLED report: artillery fire reported.',
    kind: 'event',
    severity: 'high',
    notify: true,
    evidence: [{ kind: 'conflict', source: 'ACLED', title: 'Khartoum clashes' }]
  };
  assert.equal(isWeatherOrNaturalAlert(conflictAlert), false);
});

test('3. Regional scope mode "all" (default): no alerts suppressed, no regionalNotice badge', () => {
  const foreignQuake = {
    id: 'quake-1',
    ruleId: 'events-high',
    title: 'Earthquake M6.5 in Indonesia',
    severity: 'high',
    entity: { lat: -0.5, lon: 100.0 },
    evidence: [{ kind: 'earthquake', source: 'EMSC' }]
  };
  const res = evaluateRegionalScope(foreignQuake, 'all');
  assert.equal(res.suppressed, false);
  assert.equal(foreignQuake.regionalNotice, undefined);
});

test('4. Regional scope mode "domestic": foreign weather suppressed with notice, domestic & global threats notify', () => {
  // Foreign weather -> suppressed + badge
  const foreignCyclone = {
    id: 'cyclone-1',
    ruleId: 'events-high',
    title: 'Tropical Cyclone Alert - Bay of Bengal',
    summary: 'Category 3 cyclone approaching Bangladesh coast.',
    severity: 'high',
    entity: { lat: 18.0, lon: 88.0, label: 'Bay of Bengal' },
    evidence: [{ kind: 'weather', source: 'GDACS' }]
  };
  const res1 = evaluateRegionalScope(foreignCyclone, 'domestic');
  assert.equal(res1.suppressed, true, 'Foreign cyclone must be suppressed from notifications');
  assert.equal(foreignCyclone.regionalNotice, 'nem hazai, nem értesít', 'Must attach regionalNotice marker');

  // Domestic storm -> NOT suppressed, no badge
  const domesticStorm = {
    id: 'storm-hu-1',
    ruleId: 'events-high',
    title: 'Meteoalarm Narancs Riasztás: Heves zivatarok Magyarországon',
    summary: 'HungaroMet másodfokú zivatarriasztást adott ki Hajdú-Bihar és Szabolcs vármegyére.',
    severity: 'high',
    entity: { lat: 47.5, lon: 21.6, label: 'Hajdú-Bihar' },
    evidence: [{ kind: 'weather', source: 'Meteoalarm' }]
  };
  const res2 = evaluateRegionalScope(domesticStorm, 'domestic');
  assert.equal(res2.suppressed, false, 'Domestic weather must not be suppressed');
  assert.equal(domesticStorm.regionalNotice, undefined);

  // Global threat -> NOT suppressed, even if foreign or space-related
  const globalSpaceThreat = {
    id: 'space-1',
    ruleId: 'events-critical',
    title: 'SWPC Solar Radiation Storm S4 Event',
    summary: 'Extreme solar energetic particle flux.',
    severity: 'critical',
    evidence: [{ kind: 'space-weather', source: 'NOAA-SWPC' }]
  };
  const res3 = evaluateRegionalScope(globalSpaceThreat, 'domestic');
  assert.equal(res3.suppressed, false, 'Global threat must notify unconditionally');
  assert.equal(globalSpaceThreat.regionalNotice, undefined);

  // carpathian_basin mode works identically to domestic
  const foreignQuake = {
    id: 'quake-cb-1',
    ruleId: 'events-high',
    title: 'Earthquake M6.2 in Pacific Ocean',
    severity: 'high',
    entity: { lat: 10.0, lon: -120.0 },
    evidence: [{ kind: 'earthquake', source: 'USGS' }]
  };
  const resCb = evaluateRegionalScope(foreignQuake, 'carpathian_basin');
  assert.equal(resCb.suppressed, true);
  assert.equal(foreignQuake.regionalNotice, 'nem hazai, nem értesít');
});

test('5. AlertNotifier respects regionalScope="domestic" for outbound dispatch', async () => {
  const sentMessages = [];
  const mockTelegram = {
    isConfigured: true,
    sendMessage: async (text) => {
      sentMessages.push(text);
      return { ok: true };
    }
  };

  const notifierDomestic = new AlertNotifier({
    telegram: mockTelegram,
    notifyChannels: ['telegram'],
    minSeverity: 'high',
    regionalScope: 'domestic'
  });

  const foreignQuake = {
    id: 'alert-foreign-quake',
    ruleId: 'events-high',
    ruleName: 'High-severity events',
    severity: 'high',
    notify: true,
    title: 'Earthquake M7.0 Philippines',
    summary: 'USGS reports strong earthquake in Mindanao.',
    entity: { lat: 7.5, lon: 125.0, label: 'Mindanao, Philippines' },
    evidence: [{ kind: 'earthquake', source: 'USGS', title: 'M7.0 Mindanao' }]
  };

  const domesticStorm = {
    id: 'alert-domestic-storm',
    ruleId: 'events-high',
    ruleName: 'High-severity events',
    severity: 'high',
    notify: true,
    title: 'Viharos szél és jégkár Debrecen belterületén',
    summary: 'Debreceni tűzoltók műszaki mentéseket végeznek.',
    entity: { lat: 47.53, lon: 21.62, label: 'Debrecen' },
    evidence: [{ kind: 'weather', source: 'Katasztrófavédelem Vész', title: 'Debreceni vihar' }]
  };

  const dispatchBatch = {
    created: [foreignQuake, domesticStorm],
    escalated: []
  };

  const outcome = await notifierDomestic.dispatch(dispatchBatch);

  // foreignQuake is skipped due to regional scope; domesticStorm is delivered!
  assert.equal(outcome.sent.length, 1, 'Only 1 alert sent');
  assert.equal(outcome.sent[0].alertId, 'alert-domestic-storm');
  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].includes('Debrecen'));
  assert.ok(!sentMessages[0].includes('Philippines'));
  assert.equal(foreignQuake.regionalNotice, 'nem hazai, nem értesít');
});
test('6. Global threats bypass regional boundary suppression, but strictly respect severity, silent, and notify conditions', async () => {
  const sentMessages = [];
  const mockTelegram = {
    isConfigured: true,
    async sendMessage(text) {
      sentMessages.push(text);
      return { ok: true };
    }
  };

  const notifierDomestic = new AlertNotifier({
    telegram: mockTelegram,
    notifyChannels: ['telegram'],
    minSeverity: 'high',
    regionalScope: 'domestic'
  });

  // 1. Low severity global threat (severity: 'watch' < minSeverity: 'high')
  const lowSeverityGlobal = {
    id: 'alert-global-low',
    ruleId: 'space-weather-minor',
    ruleName: 'Minor Space Weather',
    severity: 'watch',
    notify: true,
    title: 'G1 Minor Geomagnetic Storm Alert',
    summary: 'Minor space weather activity observed by SWPC.',
    evidence: [{ kind: 'space-weather', source: 'NOAA-SWPC', title: 'G1 Watch' }]
  };

  // 2. Silent global threat (silent: true)
  const silentGlobal = {
    id: 'alert-global-silent',
    ruleId: 'space-weather-silent',
    ruleName: 'Baseline Space Weather',
    severity: 'high',
    notify: true,
    silent: true,
    title: 'Solar Flare Baseline Established',
    summary: 'Initial baseline for solar monitoring.',
    evidence: [{ kind: 'space-weather', source: 'NOAA-SWPC', title: 'Baseline' }]
  };

  // 3. Global threat with notify=false
  const unnotifiedGlobal = {
    id: 'alert-global-no-notify',
    ruleId: 'space-weather-no-notify',
    ruleName: 'Space Weather Muted Rule',
    severity: 'critical',
    notify: false,
    title: 'Critical Solar Event Without Notification',
    summary: 'Rule has notify=false.',
    evidence: [{ kind: 'space-weather', source: 'NOAA-SWPC', title: 'Muted rule' }]
  };

  // 4. Critical global threat with notify=true (all conditions satisfied)
  const criticalGlobal = {
    id: 'alert-global-critical',
    ruleId: 'space-weather-critical',
    ruleName: 'Extreme Space Weather',
    severity: 'critical',
    notify: true,
    title: 'Extreme G5 Geomagnetic Storm Alert',
    summary: 'SWPC reports extreme storm.',
    evidence: [{ kind: 'space-weather', source: 'NOAA-SWPC', title: 'G5 Storm' }]
  };

  const batch = {
    created: [lowSeverityGlobal, silentGlobal, unnotifiedGlobal, criticalGlobal],
    escalated: []
  };

  const outcome = await notifierDomestic.dispatch(batch);

  // Assert: only criticalGlobal is delivered; low severity, silent, and notify=false are all rejected
  assert.equal(outcome.sent.length, 1, 'Only the high/critical alert with notify=true is sent');
  assert.equal(outcome.sent[0].alertId, 'alert-global-critical');
  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].includes('Extreme G5 Geomagnetic Storm'));
});
