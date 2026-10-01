import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineJson } from '../lib/html.mjs';

test('inline JSON cannot close a script, open an HTML comment or alter its roundtrip', () => {
  const value = { text: '</script ><script>alert(1)</script><!--\u2028', nested: ['<img onerror=alert(1)>'] };
  const serialized = inlineJson(value);
  assert.ok(!serialized.includes('<'));
  assert.deepEqual(JSON.parse(serialized), value);
});
