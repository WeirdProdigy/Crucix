import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FACT_FIELDS } from '../lib/intelligence/live-sources.mjs';
import { DEFAULT_RULES, RULE_KINDS } from '../lib/alerts/rules.mjs';
import { METRICS } from '../lib/alerts/metrics.mjs';

const LANGS = ['en', 'hu', 'fr'];
const locale = lang => JSON.parse(fs.readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
const flatten = (value, prefix) => Object.entries(value || {}).flatMap(([key, item]) => item && typeof item === 'object' ? flatten(item, `${prefix}.${key}`) : [[`${prefix}.${key}`, item]]);
const flat = lang => { const data = locale(lang); return new Map([...flatten(data.liveSources, 'liveSources'), ...flatten(data.inspector, 'inspector'), ...flatten(data.alerts, 'alerts')]); };
const factKeys = [...new Set(Object.values(FACT_FIELDS).flat())];
const BUILTIN_RULES = DEFAULT_RULES.map(rule => rule.id);
const ALERT_UI_KEYS = ['title', 'threat', 'calm', 'lastEval', 'ack', 'snooze', 'resolve', 'open', 'close', 'ackAll', 'tabActive', 'tabHandled', 'tabResolved', 'tabRules', 'empty',
  'firing', 'acked', 'snoozedUntil', 'resolvedAt', 'count', 'rule', 'evidence', 'drivers', 'snooze1h', 'snooze8h', 'snooze24h', 'more', 'errorLoad', 'errorAction', 'silent', 'toastNew'];

test('liveSources, inspector and alerts strings have identical keys, in the same order, in en, hu and fr', () => {
  const [en, ...others] = LANGS.map(lang => [...flat(lang).keys()]);
  assert.ok(en.length > 60, 'the inspector group is present');
  assert.ok(en.includes('alerts.calm') && en.includes('alerts.tiers.flash.label'), 'the alerts group is covered');
  for (const keys of others) assert.deepEqual(keys, en);
});

test('every liveSources, inspector and alerts value is a non-empty string', () => {
  for (const lang of LANGS) for (const [key, value] of flat(lang)) assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}: ${key}`);
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
    for (const unit of new Set(METRICS.map(metric => metric.unit))) if (/^[a-z]+$/.test(unit)) assert.ok(strings.has(`alerts.rules.unit.${unit}`), `${lang}: alerts.rules.unit.${unit}`);
    for (const source of ['builtin', 'override', 'user']) assert.ok(strings.has(`alerts.rules.source.${source}`), `${lang}: source.${source}`);
  }
  assert.equal(flat('en').get('alerts.rules.metric.vix'), 'VIX');
  assert.equal(flat('en').get('alerts.rules.title'), 'Rules');
});
