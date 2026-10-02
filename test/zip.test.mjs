import test from 'node:test';
import assert from 'node:assert/strict';
import { readZipEntry } from '../apis/utils/zip.mjs';
import { zipOf } from './fixtures/zip.mjs';

test('reads a deflated entry whose local header leaves the sizes empty', () => {
  const text = 'row one\trow two\n'.repeat(500);
  assert.equal(readZipEntry(zipOf('feed.csv', text, { descriptor: true })).toString(), text);
});

test('reads a stored entry and keeps non-ASCII bytes intact', () => {
  assert.equal(readZipEntry(zipOf('feed.csv', 'Árvíztűrő €5', { method: 0 })).toString(), 'Árvíztűrő €5');
});

test('rejects bytes that are not a ZIP archive', () => {
  assert.throws(() => readZipEntry(Buffer.from('<html>Service unavailable</html>')), /not a ZIP/i);
  assert.throws(() => readZipEntry(Buffer.alloc(0)), /not a ZIP/i);
});

test('rejects an archive that expands beyond the byte limit', () => {
  const bomb = zipOf('feed.csv', 'x'.repeat(200000));
  assert.ok(bomb.length < 2000, 'The fixture compresses well, like a real zip bomb');
  assert.throws(() => readZipEntry(bomb, { maxBytes: 1000 }), /byte limit/i);
});

test('rejects encrypted entries and unsupported compression methods', () => {
  assert.throws(() => readZipEntry(zipOf('feed.csv', 'secret', { flags: 1 })), /encrypted/i);
  assert.throws(() => readZipEntry(zipOf('feed.csv', 'data', { method: 12 })), /compression method/i);
});
