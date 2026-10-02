import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FACT_FIELDS } from '../lib/intelligence/live-sources.mjs';

const LANGS = ['en', 'hu', 'fr'];
const locale = lang => JSON.parse(fs.readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
const flatten = (value, prefix) => Object.entries(value || {}).flatMap(([key, item]) => item && typeof item === 'object' ? flatten(item, `${prefix}.${key}`) : [[`${prefix}.${key}`, item]]);
const flat = lang => { const data = locale(lang); return new Map([...flatten(data.liveSources, 'liveSources'), ...flatten(data.inspector, 'inspector')]); };
const factKeys = [...new Set(Object.values(FACT_FIELDS).flat())];

test('liveSources and inspector strings have identical keys, in the same order, in en, hu and fr', () => {
  const [en, ...others] = LANGS.map(lang => [...flat(lang).keys()]);
  assert.ok(en.length > 60, 'the inspector group is present');
  for (const keys of others) assert.deepEqual(keys, en);
});

test('every liveSources and inspector value is a non-empty string', () => {
  for (const lang of LANGS) for (const [key, value] of flat(lang)) assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}: ${key}`);
});

test('liveSources.showRecords is retired and the new record labels exist', () => {
  for (const lang of LANGS) {
    const strings = flat(lang);
    assert.ok(!strings.has('liveSources.showRecords'), `${lang}: showRecords`);
    for (const key of ['liveSources.openRecords', 'liveSources.topRecords']) assert.ok(strings.has(key), `${lang}: ${key}`);
  }
});

test('inspector.fact has a label for every fact key a live source can emit', () => {
  assert.ok(factKeys.length >= 20, 'FACT_FIELDS yields its keys');
  for (const lang of LANGS) {
    const strings = flat(lang);
    for (const key of factKeys) assert.ok(strings.has(`inspector.fact.${key}`), `${lang}: inspector.fact.${key}`);
  }
});

test('the French outdated badge reads as a negation, not as "more up to date"', () => {
  assert.equal(flat('fr').get('inspector.outdated'), 'N’est plus à jour');
});

test('the browser key hint lists only keys the browser has (no e, Esc goes back)', () => {
  for (const lang of LANGS) {
    const strings = flat(lang), panel = strings.get('inspector.keys'), browser = strings.get('inspector.keysBrowser');
    assert.ok(browser && browser !== panel, `${lang}: inspector.keysBrowser`);
    for (const key of ['j/k', 'Enter', '/', 'Esc']) assert.ok(browser.includes(key), `${lang}: ${key}`);
    assert.ok(!/(^| )e /.test(browser), `${lang}: the browser has no e key`);
  }
  assert.ok(/(^| )e /.test(flat('en').get('inspector.keys')), 'the panel keeps e expand');
});
