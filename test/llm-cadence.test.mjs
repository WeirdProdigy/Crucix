import test from 'node:test';
import assert from 'node:assert/strict';
import { IdeaCadence } from '../lib/llm/cadence.mjs';

const fixture = (vix = 30) => ({ fred: [{ id: 'VIXCLS', value: vix }] });
const at = minute => new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString();

function model({ failOn = [] } = {}) {
  let calls = 0;
  return {
    isConfigured: true,
    get calls() { return calls; },
    async complete() {
      calls++;
      if (failOn.includes(calls)) throw new Error('synthetic model failure');
      return { text: JSON.stringify([{ title: `Generated idea ${calls}`, type: 'WATCH', confidence: 'LOW', horizon: 'Days', rationale: 'A source-grounded observation.' }]) };
    },
  };
}

test('default cadence generates on each of sweeps 1,2,3,4', async () => {
  const provider = model();
  let minute = 0;
  const cadence = new IdeaCadence({ now: () => Date.UTC(2026, 9, 1, 0, minute) });
  for (minute = 1; minute <= 4; minute++) {
    const result = await cadence.resolve(provider, fixture());
    assert.equal(result.ideasSource, 'llm');
    assert.equal(result.ideasCached, false);
    assert.equal(result.ideasGeneratedAt, at(minute));
    assert.equal(provider.calls, minute);
  }
  assert.equal(cadence.everyNSweeps, 1);
  assert.equal(cadence.sweepCount, 4);
});

test('N=3 generates on warm-start sweep1 and sweep3, preserving timestamps on sweeps2/4', async () => {
  const provider = model();
  let minute = 0;
  const cadence = new IdeaCadence({ everyNSweeps: 3, now: () => Date.UTC(2026, 9, 1, 0, minute) });
  const expected = [
    { cached: false, calls: 1, generated: 1 },
    { cached: true, calls: 1, generated: 1 },
    { cached: false, calls: 2, generated: 3 },
    { cached: true, calls: 2, generated: 3 },
  ];
  for (minute = 1; minute <= 4; minute++) {
    const result = await cadence.resolve(provider, fixture());
    assert.equal(result.ideasCached, expected[minute - 1].cached);
    assert.equal(result.ideasGeneratedAt, at(expected[minute - 1].generated));
    assert.equal(provider.calls, expected[minute - 1].calls);
  }
});

test('later model failure gives fresh rules and never advances the cached LLM timestamp', async () => {
  const provider = model({ failOn: [3] });
  let minute = 0;
  const cadence = new IdeaCadence({ everyNSweeps: 3, now: () => Date.UTC(2026, 9, 1, 0, minute) });
  let result;
  for (minute = 1; minute <= 6; minute++) result = await cadence.resolve(provider, fixture());
  assert.equal(result.ideasSource, 'rules');
  assert.equal(result.ideasCached, false);
  assert.equal(result.ideasGeneratedAt, at(6));
  assert.equal(result.ideas[0].type, 'HEDGE');
  minute = 7;
  result = await cadence.resolve(provider, fixture());
  assert.equal(result.ideasSource, 'llm');
  assert.equal(result.ideasCached, true);
  assert.equal(result.ideasGeneratedAt, at(3));
  assert.equal(result.ideas[0].title, 'Generated idea 2');
  assert.equal(provider.calls, 3);
});

test('initial failure uses current rules until the next scheduled attempt', async () => {
  const provider = model({ failOn: [1] });
  const cadence = new IdeaCadence({ everyNSweeps: 3 });
  assert.equal((await cadence.resolve(provider, fixture())).ideasSource, 'rules');
  assert.equal((await cadence.resolve(provider, fixture())).ideasSource, 'rules');
  assert.equal(provider.calls, 1);
  assert.equal((await cadence.resolve(provider, fixture())).ideasSource, 'llm');
  assert.equal(provider.calls, 2);
});

test('absent/disabled provider always uses fresh rules, including between scheduled sweeps', async () => {
  let minute = 1;
  const cadence = new IdeaCadence({ everyNSweeps: 96, now: () => Date.UTC(2026, 9, 1, 0, minute) });
  const first = await cadence.resolve(null, fixture(21), null, [], 'hu');
  minute = 2;
  const second = await cadence.resolve({ isConfigured: false }, fixture(30), null, [], 'hu');
  assert.equal(first.ideasSource, 'rules');
  assert.equal(second.ideasSource, 'rules');
  assert.equal(first.ideas[0].confidence, 'MEDIUM');
  assert.equal(second.ideas[0].confidence, 'HIGH');
  assert.equal(second.ideasCached, false);
  assert.equal(second.ideasGeneratedAt, at(2));
  assert.match(second.ideas[0].title, /volatilitás/);
  assert.deepEqual(await cadence.resolve(null, {}), { ideas: [], ideasSource: 'rules', ideasGeneratedAt: null, ideasCached: false });
});

test('caller mutations cannot corrupt cached ideas', async () => {
  const provider = model();
  const cadence = new IdeaCadence({ everyNSweeps: 4 });
  const first = await cadence.resolve(provider, fixture());
  first.ideas[0].title = 'Caller mutation';
  const second = await cadence.resolve(provider, fixture());
  assert.equal(second.ideas[0].title, 'Generated idea 1');
  second.ideas[0].signals.push('Another mutation');
  const third = await cadence.resolve(provider, fixture());
  assert.deepEqual(third.ideas[0].signals, []);
  assert.equal(provider.calls, 1);
});

test('cadence validates an integer interval bounded to 1..96', () => {
  for (const value of [0, -1, 97, 1.5, NaN, Infinity, '3invalid', true, {}]) {
    assert.throws(() => new IdeaCadence({ everyNSweeps: value }), /integer between 1 and 96/);
  }
  assert.equal(new IdeaCadence({ everyNSweeps: 96 }).everyNSweeps, 96);
});

test('a new process-level cadence instance starts without inheriting another cache', async () => {
  const provider = model();
  const first = new IdeaCadence({ everyNSweeps: 96 });
  const second = new IdeaCadence({ everyNSweeps: 96 });
  await first.resolve(provider, fixture());
  const result = await second.resolve(provider, fixture());
  assert.equal(provider.calls, 2);
  assert.equal(result.ideasCached, false);
  assert.equal(result.ideas[0].title, 'Generated idea 2');
});
