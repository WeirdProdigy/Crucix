import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { generateNewsViewMatrix, computeFileSha256 } from '../scripts/news-view-matrix.mjs';
import { generateCoverageDiff } from '../scripts/coverage-diff.mjs';

test('1. news-view-matrix: synthetic snapshot structure and verification integrity', () => {
  const syntheticSnapshot = {
    meta: { timestamp: new Date().toISOString() },
    liveSources: [
      {
        source: 'Police-Hajdu',
        observations: [
          { headline: 'Hajdú-Bihar baleset', published: new Date().toISOString() }
        ]
      },
      {
        source: 'RSS-Dehir',
        observations: [
          { title: 'Debrecen kultúra', link: 'https://dehir.hu/1', pubDate: new Date().toISOString() }
        ]
      }
    ],
    news: []
  };

  const report = generateNewsViewMatrix(syntheticSnapshot, { totalNewsCap: 50, viewNewsCap: 20 });
  assert.ok(report.metadata);
  assert.equal(report.metadata.totalNewsCap, 50);
  assert.equal(report.metadata.viewNewsCap, 20);
  assert.ok(Array.isArray(report.rows));
  assert.ok(report.totals);
  assert.ok(report.verifications);

  // Column sums match partition counts
  assert.equal(report.verifications.allColSumsMatch, true);
  assert.equal(report.verifications.allNewSourcesObsCheck, true);
  assert.equal(report.verifications.allSourceViewsCheck, true);
});

test('2. news-view-matrix: scratch/live_api_data.json live replay exact counts and verification', () => {
  const filePath = 'scratch/live_api_data.json';
  if (!fs.existsSync(filePath)) {
    return; // Skip if scratch file missing in isolated environment
  }

  const sha256 = computeFileSha256(filePath);
  assert.equal(typeof sha256, 'string');
  assert.equal(sha256.length, 64);

  const report = generateNewsViewMatrix(filePath, { totalNewsCap: 200, viewNewsCap: 50 });

  // 1. Input file SHA-256 matches
  assert.equal(report.metadata.inputFileSha256, sha256);

  // 2. Observations sum for new sources strictly matches 372
  assert.equal(report.totals.newNewsObsSum, 372);
  assert.equal(report.verifications.newNewsObsSumMatches372, true);

  // 3. Exact per-source observation counts match known real figures
  const rowMap = new Map(report.rows.map(r => [r.source, r]));
  assert.equal(rowMap.get('Police-Hajdu')?.obs, 3, 'Police-Hajdu obs = 3');
  assert.equal(rowMap.get('RSS-Dehir')?.obs, 10, 'RSS-Dehir obs = 10');
  assert.equal(rowMap.get('RSS-Telex')?.obs, 50, 'RSS-Telex obs = 50');
  assert.equal(rowMap.get('RSS-444')?.obs, 30, 'RSS-444 obs = 30');
  assert.equal(rowMap.get('RSS-24hu')?.obs, 10, 'RSS-24hu obs = 10');
  assert.equal(rowMap.get('RSS-Index')?.obs, 59, 'RSS-Index obs = 59');
  assert.equal(rowMap.get('RSS-HVG')?.obs, 60, 'RSS-HVG obs = 60');
  assert.equal(rowMap.get('RSS-Portfolio')?.obs, 20, 'RSS-Portfolio obs = 20');
  assert.equal(rowMap.get('RSS-Qubit')?.obs, 30, 'RSS-Qubit obs = 30');
  assert.equal(rowMap.get('Google-News')?.obs, 100, 'Google-News obs = 100');

  // Sum: 3+10+50+30+10+59+60+20+30+100 = 372
  const sumCheck = [
    'Police-Hajdu', 'RSS-Dehir', 'RSS-Telex', 'RSS-444', 'RSS-24hu',
    'RSS-Index', 'RSS-HVG', 'RSS-Portfolio', 'RSS-Qubit', 'Google-News'
  ].reduce((acc, k) => acc + (rowMap.get(k)?.obs || 0), 0);
  assert.equal(sumCheck, 372);

  // 4. Column sums match partition counts
  assert.equal(report.totals.localColSum, 42);
  assert.equal(report.totals.countyColSum, 50);
  assert.equal(report.totals.nationalColSum, 50);
  assert.equal(report.totals.globalColSum, 50);
  assert.equal(report.verifications.allColSumsMatch, true);

  // 5. Union of kept news items within cap
  assert.equal(report.metadata.retainedUniqueNewsCount, 148);
  assert.ok(report.metadata.retainedUniqueNewsCount <= 200);
  assert.equal(report.verifications.unionRetainedWithinCap, true);

  // 6. County territorial gating strictly holds
  assert.equal(report.verifications.countyTerritorialGatingValid, true);
  assert.equal(rowMap.get('RSS-Portfolio')?.county, 0, 'Portfolio has 0 in county');
  assert.equal(rowMap.get('RSS-Qubit')?.county, 0, 'Qubit has 0 in county');
});

test('3. coverage-diff: detects status changes and counts between pre and live snapshot', () => {
  const preMock = {
    meta: { timestamp: '2026-10-29T14:00:00Z', sourcesQueried: 50, sourcesOk: 45, sourcesFailed: 5, sourcesDisabled: 2, sourcesStale: 1 },
    health: [
      { n: 'Meteoalarm', disabled: false, err: false },
      { n: 'Old-Feed', disabled: false, err: true, message: 'timeout' }
    ]
  };

  const liveMock = {
    meta: { timestamp: '2026-10-30T10:00:00Z', sourcesQueried: 60, sourcesOk: 55, sourcesFailed: 4, sourcesDisabled: 3, sourcesStale: 0 },
    health: [
      { n: 'Meteoalarm', disabled: false, err: false },
      { n: 'Old-Feed', disabled: false, err: false },
      { n: 'RSS-Dehir', disabled: false, err: false }
    ]
  };

  const diff = generateCoverageDiff(preMock, liveMock);
  assert.ok(diff.metadata);
  assert.ok(diff.coverageCounts);
  assert.ok(Array.isArray(diff.statusChanges));

  // Old-feed changed from error to ok
  const oldFeedChange = diff.statusChanges.find(c => c.source === 'Old-Feed');
  assert.ok(oldFeedChange);
  assert.equal(oldFeedChange.preStatus, 'error');
  assert.equal(oldFeedChange.liveStatus, 'ok');

  // RSS-Dehir was absent in pre and is ok in live
  const dehirChange = diff.statusChanges.find(c => c.source === 'RSS-Dehir');
  assert.ok(dehirChange);
  assert.equal(dehirChange.preStatus, 'ABSENT');
  assert.equal(dehirChange.liveStatus, 'ok');
});
