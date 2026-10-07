import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Load jarvis.html and extract buildMacroMarketsPanel or test it in an isolated vm context
const html = fs.readFileSync('dashboard/public/jarvis.html', 'utf8');

function createMacroPanelHarness(customD = {}) {
  const sandbox = {
    D: {
      fred: [],
      bls: [],
      energy: {},
      metals: {},
      markets: {},
      ...customD,
    },
    esc: str => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    t: (key, fallback) => fallback || key,
    mkSparkSvg: () => '<svg></svg>',
  };

  // Extract the function implementation from jarvis.html
  const match = html.match(/function buildMacroMarketsPanel\(\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'buildMacroMarketsPanel must be present in jarvis.html');
  const fnCode = match[0];

  const script = new vm.Script(`${fnCode}\nbuildMacroMarketsPanel();`);
  const context = vm.createContext(sandbox);
  return script.runInContext(context);
}

test('buildMacroMarketsPanel renders successfully with complete market quotes', () => {
  const result = createMacroPanelHarness({
    markets: {
      timestamp: '2026-10-07T21:00:00Z',
      indexes: [
        { symbol: '^GSPC', name: 'S&P 500', price: 5750.5, changePct: 0.75 },
      ],
      crypto: [
        { symbol: 'BTC-USD', name: 'Bitcoin', price: 62500, changePct: -1.2 },
      ],
    },
  });
  assert.ok(result.includes('S&amp;P 500'));
  assert.ok(/5[\s,.]?750/.test(result));
  assert.ok(result.includes('+0.75%'));
  assert.ok(/62[\s,.]?500/.test(result));
  assert.ok(result.includes('-1.20%'));
});

test('buildMacroMarketsPanel handles missing, undefined, null, NaN, and Infinite prices gracefully without crashing', () => {
  const testCases = [
    { symbol: 'BTC-USD', name: 'Bitcoin', price: undefined, changePct: undefined },
    { symbol: 'ETH-USD', name: 'Ethereum', price: null, changePct: null },
    { symbol: '^IXIC', name: 'Nasdaq', price: NaN, changePct: NaN },
    { symbol: '^DJI', name: 'Dow Jones', price: Infinity, changePct: -Infinity },
    { symbol: '^RUT', name: 'Russell', price: 'not-a-number', changePct: 'bad' },
    null,
    undefined,
    { error: 'timeout' },
  ];

  const result = createMacroPanelHarness({
    markets: {
      indexes: testCases.slice(2),
      crypto: testCases.slice(0, 2),
    },
  });

  assert.ok(result.includes('Bitcoin'));
  assert.ok(result.includes('Ethereum'));
  // Ensure "—" is rendered for missing prices, not "undefined", "null", "NaN", or "$0"
  assert.ok(result.includes('—'));
  assert.ok(!result.includes('$undefined'));
  assert.ok(!result.includes('$null'));
  assert.ok(!result.includes('$NaN'));
  assert.ok(result.includes('Nincs adat'));
});

test('buildMacroMarketsPanel handles completely empty or missing D properties without throwing', () => {
  const result = createMacroPanelHarness({
    fred: null,
    bls: null,
    energy: null,
    metals: null,
    markets: null,
  });
  assert.ok(typeof result === 'string');
  assert.ok(result.includes('lp-macro'));
  assert.ok(result.includes('DELAYED'));
});
