import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInitialSnapshot } from '../server.mjs';

test('1. Production-shaped latest.json (sources present) runs synthesize and records events and risk', async () => {
  let synthesizeCalled = false;
  let recordSnapshotEventsCalled = false;
  let recordRiskCalled = false;
  let historyAddCalled = false;

  const existingProduction = {
    meta: { timestamp: '2026-10-26T12:00:00.000Z' },
    sources: {
      meteoalarm: { observations: [] }
    }
  };

  const synthesizedResult = {
    events: [{ id: 'prod-ev-1' }],
    meta: { timestamp: '2026-10-26T12:00:00.000Z' }
  };

  const { data, isFixture } = await resolveInitialSnapshot(existingProduction, {
    synthesize: async (input, options) => {
      synthesizeCalled = true;
      assert.deepEqual(input, existingProduction);
      assert.deepEqual(options, { news: [] });
      return synthesizedResult;
    },
    recordSnapshotEvents: (d) => {
      recordSnapshotEventsCalled = true;
      assert.equal(d, synthesizedResult);
    },
    recordRisk: (d, orig) => {
      recordRiskCalled = true;
      assert.equal(d, synthesizedResult);
      assert.equal(orig, existingProduction);
    },
    history: {
      add: () => {
        historyAddCalled = true;
      }
    }
  });

  assert.equal(isFixture, false, 'Production snapshot is not a fixture');
  assert.equal(data, synthesizedResult);
  assert.equal(synthesizeCalled, true, 'synthesize must be called');
  assert.equal(recordSnapshotEventsCalled, true, 'recordSnapshotEvents must be called');
  assert.equal(recordRiskCalled, true, 'recordRisk must be called');
  assert.equal(historyAddCalled, false, 'history.add must not be called directly for production');
});

test('2. Old or corrupt latest.json (neither sources nor fixture flag) preserves safe legacy behavior', async () => {
  let synthesizeCalled = false;
  let recordSnapshotEventsCalled = false;
  let recordRiskCalled = false;
  let historyAddCalled = false;

  const existingOld = {
    meta: { timestamp: '2026-10-20T00:00:00.000Z' }
    // no sources, no views, no isPreSynthesizedFixture
  };

  const synthesizedFallback = {
    events: [],
    meta: { timestamp: '2026-10-20T00:00:00.000Z' }
  };

  const { data, isFixture } = await resolveInitialSnapshot(existingOld, {
    synthesize: async (input, options) => {
      synthesizeCalled = true;
      assert.deepEqual(input, existingOld);
      assert.deepEqual(options, { news: [] });
      return synthesizedFallback;
    },
    recordSnapshotEvents: (d) => {
      recordSnapshotEventsCalled = true;
      assert.equal(d, synthesizedFallback);
    },
    recordRisk: (d, orig) => {
      recordRiskCalled = true;
      assert.equal(d, synthesizedFallback);
      assert.equal(orig, existingOld);
    },
    history: {
      add: () => {
        historyAddCalled = true;
      }
    }
  });

  assert.equal(isFixture, false, 'Old/corrupt snapshot is not a fixture');
  assert.equal(data, synthesizedFallback);
  assert.equal(synthesizeCalled, true, 'synthesize must be invoked safely on old/corrupt payload');
  assert.equal(recordSnapshotEventsCalled, true, 'recordSnapshotEvents must be called');
  assert.equal(recordRiskCalled, true, 'recordRisk must be called');
  assert.equal(historyAddCalled, false, 'history.add must not be called directly');
});

test('3. Pre-synthesized fixture (isPreSynthesizedFixture: true) loads directly without synthesis or recording', async () => {
  let synthesizeCalled = false;
  let recordSnapshotEventsCalled = false;
  let recordRiskCalled = false;
  let historyAddedEvents = null;
  let warningLogged = null;

  const fixtureData = {
    isPreSynthesizedFixture: true,
    meta: { isOfflineSnapshot: true },
    events: [{ id: 'fixture-ev-1' }, { id: 'fixture-ev-2' }],
    views: { local: { uniqueEvents: 2 } }
  };

  const { data, isFixture } = await resolveInitialSnapshot(fixtureData, {
    synthesize: async () => {
      synthesizeCalled = true;
      throw new Error('synthesize must not be called for pre-synthesized fixtures');
    },
    recordSnapshotEvents: () => {
      recordSnapshotEventsCalled = true;
      throw new Error('recordSnapshotEvents must not be called for fixtures');
    },
    recordRisk: () => {
      recordRiskCalled = true;
      throw new Error('recordRisk must not be called for fixtures');
    },
    history: {
      add: (evs) => {
        historyAddedEvents = evs;
      }
    },
    logger: {
      warn: (msg, err) => {
        warningLogged = { msg, err };
      }
    }
  });

  assert.equal(isFixture, true, 'Fixture flag must be detected');
  assert.equal(data, fixtureData, 'Fixture data loaded directly as-is');
  assert.equal(synthesizeCalled, false, 'synthesize must never be called for fixtures');
  assert.equal(recordSnapshotEventsCalled, false, 'recordSnapshotEvents must never be called for fixtures');
  assert.equal(recordRiskCalled, false, 'recordRisk must never be called for fixtures');
  assert.deepEqual(historyAddedEvents, fixtureData.events, 'Fixture events added to history store');
  assert.equal(warningLogged, null, 'No warning logged on success');

  // Also verify that if history.add throws, it logs warning rather than silently suppressing
  let failWarningLogged = null;
  await resolveInitialSnapshot(fixtureData, {
    synthesize: async () => {},
    history: {
      add: () => {
        throw new Error('DB disk full');
      }
    },
    logger: {
      warn: (msg, err) => {
        failWarningLogged = { msg, err };
      }
    }
  });
  assert.ok(failWarningLogged, 'Failure in history.add must be logged via logger.warn');
  assert.ok(failWarningLogged.msg.includes('Failed to add fixture events to history'));
});
