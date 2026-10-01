import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../dashboard/public/jarvis.html', import.meta.url), 'utf8');
const escape = html.includes('function esc(') ? helper('esc') : String;
function helper(name, context = {}) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf('\nfunction ', start + 1);
  return vm.runInNewContext(`${html.slice(start, end)}\n${name}`, context);
}

test('feed text escapes unterminated markup and quotes before HTML rendering', () => {
  const clean = helper('cleanText', { esc: escape, plainText: helper('plainText') });
  assert.equal(clean('<img src=x onerror="alert(1)"'), '&lt;img src=x onerror=&quot;alert(1)&quot;');
  assert.equal(clean(0), '0');
});

test('idea panel never renders provider strings as markup or attributes', () => {
  const payload = '<img src=x onerror="alert(1)">';
  const render = helper('buildTradeIdeasPanel', {
    D: { ideas: [{ type: '" onclick="alert(1)', title: payload, rationale: payload, ticker: payload, risk: payload, confidence: payload }], ideasSource: 'llm' },
    t: (_key, fallback) => fallback,
    esc: escape,
    ideaTypeClass: value => ['long', 'short', 'hedge', 'watch'].includes(value) ? value : 'watch',
  });
  const output = render();
  assert.ok(!output.includes('<img'));
  assert.ok(!output.includes('idea-type " onclick='));
  assert.ok(output.includes('&lt;img'));
});

test('external links escape attribute delimiters and reject active protocols', () => {
  const safe = helper('safeExternalUrl', { URL, location: { href: 'http://localhost:3117/' }, esc: escape });
  assert.equal(safe('javascript:alert(1)'), null);
  assert.ok(!safe('https://example.com/?x=" onmouseover="alert(1)').includes('"'));
});
