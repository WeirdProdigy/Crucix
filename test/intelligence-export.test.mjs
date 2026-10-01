import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../lib/intelligence/export.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const generatedAt = '2026-10-01T12:00:00.000Z';
function event(n, overrides = {}) {
  return {
    id: `event-${n.toString(16).padStart(32, '0')}`, kind: 'earthquake', title: `Earthquake ${n}`, summary: 'Unverified public-source report',
    source: { name: 'USGS', url: `https://earthquake.usgs.gov/earthquakes/eventpage/${n}`, hostname: 'earthquake.usgs.gov', status: 'ok' },
    observedAt: '2026-10-01T08:00:00.000Z', publishedAt: null, collectedAt: '2026-10-01T10:00:00.000Z',
    location: { lat: 47.5, lon: 19, method: 'provider', label: 'Budapest', precision: 'coordinates' },
    severity: 'moderate', quality: { level: 'complete', checks: { sourceUrl: true, providerTime: true, location: true, sourceStatus: true }, explanationCodes: [] }, relatedSources: [], ...overrides,
  };
}
function serialize(records, format, options = {}) {
  assert.equal(typeof module.exportRecords, 'function', 'exportRecords is implemented');
  return module.exportRecords(records, format, { generatedAt, ...options });
}
function parseCsv(body) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let n = 0; n < body.length; n++) {
    const char = body[n];
    if (quoted) {
      if (char === '"' && body[n + 1] === '"') { cell += '"'; n++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('JSON export carries collection provenance and strips raw secret fields', () => {
  const result = serialize([event(1, { raw: { apiKey: 'secret' }, token: 'hidden' })], 'json', { total: 7 });
  assert.match(result.contentType, /application\/json/);
  assert.equal(result.extension, 'json');
  const data = JSON.parse(result.body);
  assert.equal(data.generatedAt, generatedAt);
  assert.equal(data.total, 7);
  assert.equal(data.exported, 1);
  assert.equal(data.truncated, true);
  assert.equal(data.records[0].publishedAt, null);
  assert.equal(data.records[0].source.url, 'https://earthquake.usgs.gov/earthquakes/eventpage/1');
  assert.equal(/secret|hidden|apiKey/.test(result.body), false);
});

test('CSV quotes commas, newlines and quotes and neutralizes formulas after hidden whitespace', () => {
  const titles = ['=HYPERLINK("evil")', ' \t+SUM(1,2)', '\r\n@SUM(1)', '-1+2', '\u0001=1', '\u200b=1', 'ordinary, "quoted"\nline'];
  const rows = parseCsv(serialize(titles.map((title, n) => event(n + 1, { title })), 'csv').body);
  const header = rows[0]; const titleIndex = header.indexOf('title');
  assert.ok(titleIndex >= 0);
  for (let n = 0; n < 6; n++) assert.equal(rows[n + 1][titleIndex][0], "'");
  assert.equal(rows[7][titleIndex], 'ordinary, "quoted"\nline');
  assert.equal(rows[1][header.indexOf('publishedAt')], '');
});

test('all export formats cap records and display the truncation and query summary', () => {
  const records = Array.from({ length: 2003 }, (_, n) => event(n + 1));
  const json = JSON.parse(serialize(records, 'json', { total: 3500, filters: { q: 'quake', kind: 'earthquake' } }).body);
  assert.equal(json.records.length, 2000);
  assert.equal(json.exported, 2000);
  assert.equal(json.total, 3500);
  assert.equal(json.truncated, true);
  assert.equal(json.filters.q, 'quake');
  const csv = parseCsv(serialize(records, 'csv', { total: 3500 }).body);
  assert.equal(csv.length, 2001);
  assert.equal(csv[0].includes('exportTruncated'), true);
  assert.equal(csv[1][csv[0].indexOf('exportTruncated')], 'true');
  const html = serialize(records, 'html', { total: 3500, filters: { q: 'quake' } }).body;
  assert.match(html, /2[,. ]?000/);
  assert.match(html, /3[,. ]?500/);
  assert.match(html, /truncat/i);
  assert.match(html, /quake/);
  const stix = JSON.parse(serialize(records, 'stix', { total: 3500 }).body);
  assert.equal(stix.objects.filter(object => object.type === 'note' && object.external_references?.some(ref => ref.external_id?.startsWith('event-'))).length, 2000);
  assert.match(stix.objects.find(object => object.type === 'report').description, /truncat/i);
});

test('HTML report renders untrusted fields inert, keeps safe original links and needs no scripts', () => {
  const malicious = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const result = serialize([event(1, { title: malicious, summary: '<svg/onload=alert(3)>', source: { name: '" onmouseover="evil', url: 'javascript:alert(4)', hostname: 'bad', status: 'error' }, location: { lat: null, lon: null, method: 'unknown', label: malicious, precision: 'unknown' } }), event(2)], 'html');
  assert.equal(result.extension, 'html');
  assert.match(result.contentType, /text\/html/);
  assert.equal(/<script|<svg|<img|href=["']javascript:/i.test(result.body), false);
  assert.match(result.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(result.body, /https:\/\/earthquake\.usgs\.gov\/earthquakes\/eventpage\/2/);
  assert.match(result.body, /@media print/);
  assert.match(result.body, /publishedAt/);
});

test('STIX 2.1 uses standard report and contextual notes with valid UUIDs and resolved references', () => {
  const bundle = JSON.parse(serialize([event(1)], 'stix', { language: 'hu' }).body);
  const uuid = /^[a-z-]+--[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.equal(bundle.type, 'bundle');
  assert.match(bundle.id, uuid);
  assert.equal(Object.hasOwn(bundle, 'spec_version'), false);
  const ids = new Set(bundle.objects.map(object => object.id));
  assert.equal(ids.size, bundle.objects.length);
  for (const object of bundle.objects) {
    assert.ok(['report', 'note'].includes(object.type));
    assert.equal(object.spec_version, '2.1');
    assert.match(object.id, uuid);
    assert.equal(object.created, generatedAt);
    assert.equal(object.modified, generatedAt);
    assert.ok(object.object_refs.length > 0);
    for (const ref of object.object_refs) assert.equal(ids.has(ref), true);
    assert.equal(Object.hasOwn(object, 'confidence'), false);
    if (object.type === 'report') assert.equal(object.published, generatedAt);
    else assert.ok(object.content.length > 0);
  }
  const note = bundle.objects.find(object => object.external_references?.some(ref => ref.external_id === event(1).id));
  assert.equal(note.lang, 'hu');
  assert.ok(note.external_references.some(ref => ref.source_name === 'USGS' && ref.url === event(1).source.url));
  assert.match(note.content, /observedAt: 2026-10-01T08:00:00.000Z/);
  assert.match(note.content, /publishedAt: unknown/);
  assert.equal(bundle.objects.some(object => ['indicator', 'threat-actor', 'attack-pattern'].includes(object.type)), false);
});

test('empty exports remain usable and STIX has no empty required reference lists', () => {
  for (const format of ['json', 'csv', 'html', 'stix']) assert.ok(serialize([], format).body.length > 0);
  const bundle = JSON.parse(serialize([], 'stix').body);
  for (const object of bundle.objects) assert.ok(object.object_refs.length > 0);
  const csv = parseCsv(serialize([], 'csv').body);
  assert.equal(csv.length, 2);
  assert.equal(csv[1][csv[0].indexOf('exportTotal')], '0');
});

test('bad export format, timestamps and options are controlled validation failures', () => {
  assert.equal(typeof module.exportRecords, 'function', 'exportRecords is implemented');
  for (const [records, format, options] of [[[], 'pdf', {}], [{}, 'json', {}], [[], 'json', { generatedAt: 'bad' }], [[], 'json', { total: -1 }], [[], 'json', { language: '<script>' }]]) {
    assert.throws(() => module.exportRecords(records, format, { generatedAt, ...options }), error => error.status === 400);
  }
});
