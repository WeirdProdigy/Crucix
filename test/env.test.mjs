import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvLine } from '../apis/utils/env.mjs';
import { envInteger } from '../crucix.config.mjs';

test('env quotes, comments and export syntax preserve embedded hashes', () => {
  assert.deepEqual(parseEnvLine(' export TEST_KEY="secret # literal" # comment'), { key: 'TEST_KEY', value: 'secret # literal' });
  assert.deepEqual(parseEnvLine("TEST_KEY='quoted value'"), { key: 'TEST_KEY', value: 'quoted value' });
  assert.deepEqual(parseEnvLine('TEST_KEY=plain # comment'), { key: 'TEST_KEY', value: 'plain' });
  assert.equal(parseEnvLine('# comment'), null);
});

test('port accepts five digits and rejects malformed/out-of-range values', () => {
  const key = 'CRUCIX_TEST_PORT';
  process.env[key] = '10000';
  assert.equal(envInteger(key, 3117, 1, 65535), 10000);
  for (const value of ['0', '65536', '3117;evil', '-1', '1.5']) {
    process.env[key] = value;
    assert.throws(() => envInteger(key, 3117, 1, 65535));
  }
  delete process.env[key];
});
