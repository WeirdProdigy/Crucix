import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const iconsJsPath = path.join(ROOT, 'dashboard/public/icons.js');
const iconsSvgPath = path.join(ROOT, 'dashboard/public/icons.svg');
const thirdPartyDocsPath = path.join(ROOT, 'THIRD_PARTY_ICONS.md');

// Load icons.js module
await import(`file://${iconsJsPath}`);
const iconsModule = globalThis.CrucixIcons;
const {
  CATEGORIES,
  CATEGORY_NAMES_HU,
  SEVERITY_COLORS,
  normalizeSeverity,
  getSeverityColor,
  getCategory,
  getIconId,
  renderIcon
} = iconsModule;

test('Pictograms: all 16 canonical categories are defined', () => {
  assert.equal(CATEGORIES.length, 16, 'Exactly 16 alert categories must be defined');
  const expected = [
    'space-weather',
    'weather',
    'earthquake',
    'fire',
    'transport',
    'military',
    'flood',
    'drought',
    'health',
    'radiation',
    'cyber',
    'energy',
    'economy',
    'supply-chain',
    'sanctions',
    'general'
  ];
  for (const cat of expected) {
    assert.ok(CATEGORIES.includes(cat), `Category "${cat}" must be present in CATEGORIES`);
    assert.ok(CATEGORY_NAMES_HU[cat], `Hungarian name for "${cat}" must be defined`);
  }
});

test('Sprite: icons.svg defines exactly the 16 unique symbol IDs without duplication', () => {
  const svgContent = fs.readFileSync(iconsSvgPath, 'utf8');
  const symbolRegex = /<symbol\s+id="([^"]+)"/g;
  const foundSymbols = [];
  let match;
  while ((match = symbolRegex.exec(svgContent)) !== null) {
    foundSymbols.push(match[1]);
  }

  assert.equal(foundSymbols.length, 16, 'icons.svg must contain exactly 16 symbols');

  // Check uniqueness
  const uniqueSet = new Set(foundSymbols);
  assert.equal(uniqueSet.size, 16, 'All symbol IDs in icons.svg must be strictly unique');

  // Verify all categories have matching symbols in SVG
  for (const cat of CATEGORIES) {
    const expectedId = `icon-${cat}`;
    assert.ok(uniqueSet.has(expectedId), `Symbol ID "${expectedId}" must exist in icons.svg`);
  }
});

test('Sprite: zero external network requests and zero external URLs in icons.svg', () => {
  const svgContent = fs.readFileSync(iconsSvgPath, 'utf8');
  // Check for http, https or external xlink hrefs
  assert.ok(!svgContent.includes('href="http'), 'icons.svg must not contain any external href');
  assert.ok(!svgContent.includes('xlink:href="http'), 'icons.svg must not contain any external xlink:href');
  assert.ok(!svgContent.includes('src="http'), 'icons.svg must not contain any external src');
  // Only standard XML namespace declaration is permitted
  const nonXmlHttpMatches = (svgContent.match(/https?:\/\/(?!www\.w3\.org)/g) || []);
  assert.equal(nonXmlHttpMatches.length, 0, 'No external URLs allowed in icons.svg other than w3 xmlns');
});

test('Category resolution & fallback handling', () => {
  // Direct matches
  assert.equal(getCategory('earthquake'), 'earthquake');
  assert.equal(getIconId('earthquake'), 'icon-earthquake');
  assert.equal(getCategory('flood'), 'flood');
  assert.equal(getIconId('flood'), 'icon-flood');

  // Source keyword mappings
  assert.equal(getCategory('noaa-swpc'), 'space-weather');
  assert.equal(getIconId('noaa-swpc'), 'icon-space-weather');
  assert.equal(getCategory('ovf-gauges'), 'flood');
  assert.equal(getIconId('ovf-gauges'), 'icon-flood');
  assert.equal(getCategory('meteoalarm'), 'weather');
  assert.equal(getIconId('meteoalarm'), 'icon-weather');
  assert.equal(getCategory('nasa-firms'), 'fire');
  assert.equal(getIconId('nasa-firms'), 'icon-fire');
  assert.equal(getCategory('ooni'), 'cyber');
  assert.equal(getIconId('ooni'), 'icon-cyber');
  assert.equal(getCategory('energy-charts-hu'), 'energy');
  assert.equal(getIconId('energy-charts-hu'), 'icon-energy');

  // Fallbacks for unknown / null / undefined / empty
  assert.equal(getCategory(null), 'general');
  assert.equal(getIconId(null), 'icon-general');
  assert.equal(getCategory(undefined), 'general');
  assert.equal(getIconId(undefined), 'icon-general');
  assert.equal(getCategory(''), 'general');
  assert.equal(getIconId(''), 'icon-general');
  assert.equal(getCategory('completely-unknown-category-12345'), 'general');
  assert.equal(getIconId('completely-unknown-category-12345'), 'icon-general');
});

test('Severity colors: Meteoalarm green, yellow, orange, red', () => {
  assert.equal(normalizeSeverity('low'), 'low');
  assert.equal(normalizeSeverity('info'), 'low');
  assert.equal(normalizeSeverity('green'), 'low');
  assert.equal(getSeverityColor('low'), '#64f0c8');

  assert.equal(normalizeSeverity('moderate'), 'moderate');
  assert.equal(normalizeSeverity('medium'), 'moderate');
  assert.equal(normalizeSeverity('yellow'), 'moderate');
  assert.equal(getSeverityColor('moderate'), '#ffe600');

  assert.equal(normalizeSeverity('high'), 'high');
  assert.equal(normalizeSeverity('severe'), 'high');
  assert.equal(normalizeSeverity('orange'), 'high');
  assert.equal(getSeverityColor('high'), '#ff9f1a');

  assert.equal(normalizeSeverity('critical'), 'critical');
  assert.equal(normalizeSeverity('extreme'), 'critical');
  assert.equal(normalizeSeverity('red'), 'critical');
  assert.equal(getSeverityColor('critical'), '#ff4d4f');

  assert.equal(normalizeSeverity('unknown'), null);
  assert.equal(getSeverityColor('unknown'), null);
});

test('Accessible rendering helper: renderIcon produces valid, accessible SVG', () => {
  const html = renderIcon('flood', {
    size: 20,
    severity: 'high',
    title: 'Árvízveszély Berettyóújfalu',
    ariaLabel: 'Árvízveszély'
  });

  assert.ok(html.startsWith('<svg class="crucix-icon crucix-icon-flood crucix-icon-20 sev-high"'), 'Includes proper classes');
  assert.ok(html.includes('width="20" height="20"'), 'Includes width and height');
  assert.ok(html.includes('role="img"'), 'Includes role="img"');
  assert.ok(html.includes('aria-label="Árvízveszély"'), 'Includes aria-label');
  assert.ok(html.includes('<title>Árvízveszély Berettyóújfalu</title>'), 'Includes title tag');
  assert.ok(html.includes('color:#ff9f1a'), 'Applies severity color style');
  assert.ok(html.includes('<use href="/icons.svg#icon-flood"></use>'), 'References symbol via use href');
});

test('Badge rendering helper: renderIcon with badge=true', () => {
  const badgeHtml = renderIcon('drought', {
    badge: true,
    severity: 'moderate'
  });

  assert.ok(badgeHtml.startsWith('<span class="crucix-icon-badge crucix-badge-moderate"'), 'Wraps in crucix-icon-badge');
  assert.ok(badgeHtml.includes('Aszály'), 'Includes text label alongside icon for accessibility');
  assert.ok(badgeHtml.includes('use href="/icons.svg#icon-drought"'), 'Includes drought icon use');
});

test('Documentation alignment: every icon in icons.svg is recorded in THIRD_PARTY_ICONS.md', () => {
  const docs = fs.readFileSync(thirdPartyDocsPath, 'utf8');

  // Verify OCHA mandatory attribution
  assert.ok(docs.includes('Source: OCHA'), 'Must include required "Source: OCHA" attribution');
  assert.ok(docs.includes('CC0 1.0 Universal'), 'Must state CC0 1.0 Universal license');
  assert.ok(docs.includes('Lucide Icons'), 'Must include Lucide Icons');
  assert.ok(docs.includes('ISC License'), 'Must include ISC License text');

  // Verify all 16 symbols are in table
  for (const cat of CATEGORIES) {
    const symbolId = `icon-${cat}`;
    assert.ok(docs.includes(`\`${symbolId}\``), `THIRD_PARTY_ICONS.md must document symbol \`${symbolId}\``);
  }
});
