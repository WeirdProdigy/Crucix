import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNebihAsp,
  mapAspSeverity,
  evaluateNebihAspNotification
} from '../apis/sources/nebih-asp.mjs';

const table = (rows, header = [
  'TELEPULES',
  'Megye',
  'KOCKAZATI BESOROLAS 2026.10.12',
  'Besorolás módja',
  'VGE'
]) => `
  <table>
    <tr>${header.map(cell => `<th>${cell}</th>`).join('')}</tr>
    ${rows.join('\n')}
  </table>
`;

const row = (cells) => `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`;

test('cleans HTML entities and special whitespace from settlement and county cells', () => {
  const html = table([
    row([
      'B&aacute;r&aacute;nd&nbsp;\u200b',
      'Hajd&uacute;-Bihar&nbsp;&amp;&nbsp;megye',
      'Magas kock&aacute;zat&uacute; ter&uuml;let',
      '100%',
      '904960'
    ])
  ]);

  const result = parseNebihAsp(html);
  assert.equal(result.status, 'ok');
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].raw.settlement, 'Báránd');
  assert.equal(result.observations[0].raw.county, 'Hajdú-Bihar & megye');
  assert.equal(result.observations[0].raw.riskCategory, 'Magas kockázatú terület');
});

test('parses percentage values with and without the percent sign', () => {
  const html = table([
    row(['Bihartorda', 'Hajdú-Bihar', 'III-as körzet', '100', '904960']),
    row(['Püspökladány', 'Hajdú-Bihar', 'III-as körzet', '100%', '904961']),
    row(['Báránd', 'Hajdú-Bihar', 'III-as körzet', '100 %', '904962'])
  ]);

  const result = parseNebihAsp(html);
  assert.equal(result.status, 'ok');
  assert.deepEqual(
    result.observations.map(observation => observation.territorialMatching.official_assignment_percentage).sort((a, b) => a - b),
    [100, 100, 100]
  );
  assert.deepEqual(
    result.observations.map(observation => observation.raw.coveragePercent).sort(),
    ['100', '100 %', '100%']
  );
});

test('skips incomplete data rows and spacer rows without creating observations', () => {
  const html = table([
    row(['Bihartorda', 'Hajdú-Bihar', 'III-as körzet', '100', '904960']),
    '<tr><td>Báránd</td><td>Hajdú-Bihar</td><td>III-as körzet</td></tr>',
    '<tr><td colspan="5">&nbsp;</td></tr>'
  ]);

  const result = parseNebihAsp(html);
  assert.equal(result.status, 'ok');
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].raw.settlement, 'Bihartorda');
  assert.equal(result.examinedRecords, 3);
  assert.equal(result.malformedRows, 2);
});

test('accepts case-insensitive settlement, county, and risk headers', () => {
  const html = table([
    row(['Bihartorda', 'Hajdú-Bihar', 'III-as körzet', '100', '904960'])
  ], [
    'TELEPULES',
    'Megye',
    'KOCKAZATI BESOROLAS 2026.10.12',
    'Besorolás módja',
    'VGE'
  ]);

  const result = parseNebihAsp(html);
  assert.equal(result.status, 'ok');
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].raw.settlement, 'Bihartorda');
});

test('maps diacritics and casing to ASP severity levels and monitors unknown categories', () => {
  assert.equal(mapAspSeverity('FERTŐZÖTT TERÜLET (SZIGORÚAN KORLÁTOZOTT TERÜLET: SZKT)'), 'elevated');
  assert.equal(mapAspSeverity('fertőzött terület (SZKT-N KÍVÜLI része)'), 'moderate');
  assert.equal(mapAspSeverity('iii-AS KÖRZET'), 'high');
  assert.equal(mapAspSeverity('MAGAS KOCKÁZATÚ TERÜLET'), 'low');
  assert.equal(mapAspSeverity('Közepes kockázatú terület'), 'low');
  assert.equal(mapAspSeverity('nem értelmezhető besorolás'), 'monitor');
});

test('evaluates a parsed observation as a baseline without alerting', () => {
  const html = table([
    row(['Bihartorda', 'Hajdú-Bihar', 'III-as körzet', '100 %', '904960'])
  ]);
  const [observation] = parseNebihAsp(html).observations;

  const result = evaluateNebihAspNotification(observation, { isFirstRun: true });
  assert.equal(result.action, 'baseline');
  assert.equal(result.eligible, false);
});
