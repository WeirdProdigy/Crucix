// Codex provider: the default model follows the account's own list, a retired hard-coded name answers 400
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultCodexModel, FALLBACK_MODEL, CodexProvider } from '../lib/llm/codex.mjs';

describe('Codex default model', () => {
  const withCache = (content, fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'crucix-codex-'));
    const path = join(dir, 'models_cache.json');
    if (content !== null) writeFileSync(path, content);
    try { return fn(path); } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it('takes the best-priority listed model that the API supports', () => {
    const models = [
      { slug: 'hidden', visibility: 'hide', supported_in_api: true, priority: 0 },
      { slug: 'second', visibility: 'list', supported_in_api: true, priority: 2 },
      { slug: 'no-api', visibility: 'list', supported_in_api: false, priority: 1 },
      { slug: 'first', visibility: 'list', supported_in_api: true, priority: 1.5 },
    ];
    assert.equal(withCache(JSON.stringify({ models }), defaultCodexModel), 'first');
  });

  it('falls back when the cache is missing, malformed or empty', () => {
    assert.equal(withCache(null, defaultCodexModel), FALLBACK_MODEL);
    assert.equal(withCache('{not json', defaultCodexModel), FALLBACK_MODEL);
    assert.equal(withCache(JSON.stringify({ models: [] }), defaultCodexModel), FALLBACK_MODEL);
  });

  it('keeps an explicit LLM_MODEL', () => {
    assert.equal(new CodexProvider({ model: 'my-model' }).model, 'my-model');
  });
});
