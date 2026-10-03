import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from '../lib/atomic-json.mjs';

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'crucix-atomic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('writeFileAtomic writes the exact bytes and replaces an existing file', t => {
  const dir = tmp(t);
  const path = join(dir, 'blob.bin');
  const first = Buffer.from([0, 1, 2, 255, 0, 128]);
  writeFileAtomic(path, first);
  assert.deepEqual(readFileSync(path), first);
  const second = Buffer.from('second');
  writeFileAtomic(path, second);
  assert.deepEqual(readFileSync(path), second);
  assert.deepEqual(readdirSync(dir), ['blob.bin']);
});

test('writeFileAtomic leaves no temporary file and the old state when the target cannot be replaced', t => {
  const dir = tmp(t);
  const path = join(dir, 'target');
  mkdirSync(path);
  writeFileSync(join(path, 'keep.txt'), 'old');
  assert.throws(() => writeFileAtomic(path, Buffer.from('new')));
  assert.deepEqual(readdirSync(dir), ['target']);
  assert.equal(readFileSync(join(path, 'keep.txt'), 'utf8'), 'old');
});

test('writeFileAtomic does not create the parent directory', t => {
  const dir = tmp(t);
  assert.throws(() => writeFileAtomic(join(dir, 'missing', 'file.bin'), Buffer.from('x')), { code: 'ENOENT' });
});

test('writeJsonAtomic still keeps a backup of the previous good file', t => {
  const dir = tmp(t);
  const path = join(dir, 'doc.json');
  writeJsonAtomic(path, { a: 1 });
  writeJsonAtomic(path, { a: 2 });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { a: 2 });
  assert.deepEqual(JSON.parse(readFileSync(`${path}.bak`, 'utf8')), { a: 1 });
});
