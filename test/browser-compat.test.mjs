import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
const dir = new URL('../dashboard/public/', import.meta.url);
// Regex lookbehind is a parse-time SyntaxError on Safari/iOS before 16.4: the whole script is lost, not just the one regex.
const LOOKBEHIND = /\(\?<[=!]/;
const scripts = () => readdirSync(dir).filter(name => name.endsWith('.js')).sort();

test('the lookbehind matcher flags lookbehind groups and nothing else', () => {
  assert.ok(LOOKBEHIND.test('/(?<=a)b/'));
  assert.ok(LOOKBEHIND.test('x.replace(/(?<!a)b/g,"")'));
  assert.ok(!LOOKBEHIND.test('/(?<name>a)(?=b)(?!c)(?:d)/u'), 'named groups and lookaheads are fine');
});

test('browser scripts use no regex lookbehind', () => {
  const files = scripts();
  assert.ok(files.includes('record-core.js') && files.includes('record-inspector.js') && files.includes('live-sources.js'), 'the dashboard scripts are scanned');
  for (const name of files) assert.ok(!LOOKBEHIND.test(readFileSync(new URL(name, dir), 'utf8')), `${name}: regex lookbehind breaks Safari before 16.4`);
});
