import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FACT_FIELDS } from '../lib/intelligence/live-sources.mjs';
import { DEFAULT_RULES, RULE_KINDS } from '../lib/alerts/rules.mjs';
import { METRICS } from '../lib/alerts/metrics.mjs';
import { DOMAIN_IDS } from '../lib/domains.mjs';

const LANGS = ['en', 'hu', 'fr'];
const locale = lang => JSON.parse(fs.readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
const flatten = (value, prefix) => Object.entries(value || {}).flatMap(([key, item]) => item && typeof item === 'object' ? flatten(item, `${prefix}.${key}`) : [[`${prefix}.${key}`, item]]);
const flat = lang => { const data = locale(lang); return new Map([...flatten(data.liveSources, 'liveSources'), ...flatten(data.inspector, 'inspector'), ...flatten(data.alerts, 'alerts'), ...flatten(data.lenses, 'lenses')]); };
const factKeys = [...new Set(Object.values(FACT_FIELDS).flat())];
const BUILTIN_RULES = DEFAULT_RULES.map(rule => rule.id);
const ALERT_UI_KEYS = ['title', 'threat', 'calm', 'lastEval', 'ack', 'snooze', 'resolve', 'open', 'close', 'ackAll', 'tabActive', 'tabHandled', 'tabResolved', 'tabRules', 'empty',
  'firing', 'acked', 'snoozedUntil', 'resolvedAt', 'count', 'rule', 'evidence', 'drivers', 'snooze1h', 'snooze8h', 'snooze24h', 'more', 'errorLoad', 'errorAction', 'errorOrigin', 'unavailable', 'silent', 'toastNew'];

test('liveSources, inspector, alerts and lenses strings have identical keys, in the same order, in en, hu and fr', () => {
  const [en, ...others] = LANGS.map(lang => [...flat(lang).keys()]);
  assert.ok(en.length > 60, 'the inspector group is present');
  assert.ok(en.includes('alerts.calm') && en.includes('alerts.tiers.flash.label'), 'the alerts group is covered');
  assert.ok(en.includes('lenses.all') && en.includes('lenses.health'), 'the lenses group is covered');
  for (const keys of others) assert.deepEqual(keys, en);
});

test('every liveSources, inspector, alerts and lenses value is a non-empty string', () => {
  for (const lang of LANGS) for (const [key, value] of flat(lang)) assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}: ${key}`);
});

// The live panel's group headers and the lens bar's announcement (live-sources.js, lens.js), after the domain names.
const LENS_UI_KEYS = ['sourceCount', 'sourceCountOne', 'recordCount', 'recordCountOne', 'attention', 'moreSources', 'noLiveSources', 'noSources', 'status'];

test('the lenses group names "all", the lens bar and each domain of the registry, in registry order, then the group-header strings', () => {
  for (const lang of LANGS) assert.deepEqual(Object.keys(locale(lang).lenses), ['all', 'label', ...DOMAIN_IDS, ...LENS_UI_KEYS], `${lang}: lenses keys`);
  assert.deepEqual(['en', 'hu', 'fr'].map(lang => locale(lang).lenses.all), ['All', 'Mind', 'Tous']);
});

// Every string replay.js renders, in locale order (the same order in en, hu and fr).
const REPLAY_KEYS = ['button', 'region', 'banner', 'slider', 'prev', 'next', 'backToLive', 'dismiss', 'loading', 'error', 'notFound', 'newerLive', 'alertsLive', 'historyUnavailable', 'noSweeps', 'position', 'unknownTime'];

test('the replay group has the same keys in the same order in en, hu and fr, each a non-empty string', () => {
  for (const lang of LANGS) {
    const group = locale(lang).replay;
    assert.deepEqual(Object.keys(group || {}), REPLAY_KEYS, `${lang}: replay keys`);
    for (const key of REPLAY_KEYS) assert.ok(typeof group[key] === 'string' && group[key].trim() !== '', `${lang}: replay.${key}`);
    assert.ok(group.newerLive.includes('{count}'), `${lang}: replay.newerLive names the count`);
    assert.ok(group.position.includes('{index}') && group.position.includes('{total}'), `${lang}: replay.position`);
  }
  assert.deepEqual(LANGS.map(lang => locale(lang).replay.button), ['Replay', 'Visszajátszás', 'Relecture']);
});

// Every string health-matrix.js renders (the dialog, the legend, the table words and the messages), in locale order.
const MATRIX_KEYS = ['title', 'trigger', 'caption', 'openHint', 'sweeps', 'source', 'ms', 'stateOk', 'stateStale', 'stateError', 'stateDisabled', 'stateNoData', 'other', 'loading', 'empty', 'noSources', 'error', 'close'];

test('the matrix group has the same keys in the same order in en, hu and fr, each a non-empty string', () => {
  for (const lang of LANGS) {
    const group = locale(lang).matrix;
    assert.deepEqual(Object.keys(group || {}), MATRIX_KEYS, `${lang}: matrix keys`);
    for (const key of MATRIX_KEYS) assert.ok(typeof group[key] === 'string' && group[key].trim() !== '', `${lang}: matrix.${key}`);
    assert.ok(!/[<>]/.test(Object.values(group).join('')), `${lang}: plain text, no markup`);
  }
  assert.deepEqual(LANGS.map(lang => locale(lang).matrix.title), ['Source health matrix', 'Forrásállapot-mátrix', 'Matrice de santé des sources']);
  // The five cell states are told apart in every language (a glyph is never the only signal, and the words must not collapse).
  for (const lang of LANGS) assert.equal(new Set(['stateOk', 'stateStale', 'stateError', 'stateDisabled', 'stateNoData'].map(key => locale(lang).matrix[key])).size, 5, `${lang}: five distinct state words`);
});

test('the alert UI has every string it renders, a name for each built-in rule and the inspector level words', () => {
  assert.equal(BUILTIN_RULES.length, 8, 'the built-in rule pack');
  for (const lang of LANGS) {
    const strings = flat(lang);
    for (const key of ALERT_UI_KEYS) assert.ok(strings.has(`alerts.${key}`), `${lang}: alerts.${key}`);
    for (const id of BUILTIN_RULES) assert.ok(strings.has(`alerts.ruleNames.${id}`), `${lang}: alerts.ruleNames.${id}`);
    for (const level of ['critical', 'high', 'watch', 'info']) assert.equal(strings.get(`alerts.level.${level}`), strings.get(`inspector.level.${level}`), `${lang}: alerts.level.${level}`);
  }
  assert.equal(flat('en').get('alerts.calm'), 'No active alerts');
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

test('the rule editor names every rule kind, every metric of the registry and every unit in en, hu and fr', () => {
  for (const lang of LANGS) {
    const strings = flat(lang), rules = locale(lang).alerts.rules;
    assert.deepEqual(Object.keys(rules.kind), [...RULE_KINDS], `${lang}: alerts.rules.kind`);
    assert.deepEqual(Object.keys(rules.metric), METRICS.map(metric => metric.key), `${lang}: alerts.rules.metric`);
    for (const unit of new Set(METRICS.map(metric => metric.unit))) if (/^[a-z]+(?:\/[a-z]+)?$/.test(unit)) assert.ok(strings.has(`alerts.rules.unit.${unit}`), `${lang}: alerts.rules.unit.${unit}`);
    for (const source of ['builtin', 'override', 'user']) assert.ok(strings.has(`alerts.rules.source.${source}`), `${lang}: source.${source}`);
  }
  assert.equal(flat('en').get('alerts.rules.metric.vix'), 'VIX');
  assert.equal(flat('en').get('alerts.rules.title'), 'Rules');
});
