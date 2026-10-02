import test from 'node:test';
import assert from 'node:assert/strict';
import { briefing as fred } from '../apis/sources/fred.mjs';
import { briefing as gdelt } from '../apis/sources/gdelt.mjs';
import { briefing as epa } from '../apis/sources/epa.mjs';
import { zipOf } from './fixtures/zip.mjs';

test('FRED retrieves supported macro indicators without requesting the removed gold series', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const id = new URL(url).searchParams.get('series_id');
    requests.push(id);
    if (id === 'GOLDAMGBD228NLBM') return new Response('{}', { status: 400 });
    return Response.json({ observations: [{ date: '2026-10-01', value: '4.25' }] });
  });
  const result = await fred('fixture-key');
  assert.equal(result.error, undefined, 'All currently supported indicators are available');
  assert.equal(result.indicators.length, 20);
  assert.equal(requests.includes('GOLDAMGBD228NLBM'), false);
  assert.equal(result.indicators.find(item => item.id === 'DGS10').value, 4.25);
});

test('FRED still reports failures of an active series and keeps successful indicators', async t => {
  t.mock.method(globalThis, 'fetch', async url => new URL(url).searchParams.get('series_id') === 'DGS10'
    ? new Response('{}', { status: 403 })
    : Response.json({ observations: [{ date: '2026-10-01', value: '4.25' }] }));
  const result = await fred('fixture-key');
  assert.match(result.error, /1\/20/);
  assert.equal(result.indicators.length, 19);
  assert.equal(result.indicators.some(item => item.id === 'DGS10'), false);
});

test('EPA provider access denial remains a visible failure without radiation assessments', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('Blocked', { status: 403 }); });
  const result = await epa();
  assert.match(result.error, /EPA.*access denied.*403/i);
  assert.equal(calls, 1, 'Access denial is not retried');
  assert.deepEqual(result.readings, []);
  assert.doesNotMatch(result.signals.join(' '), /normal|below.*threshold/i);
});

// GDELT: the REST API (api.gdeltproject.org) answers every request after ~10 s, rejects
// scheduled clients with HTTP 429 and no longer serves /geo/geo, so the source reads GDELT's
// static 15-minute GKG 2.0 file (data.gdeltproject.org) instead.
const NOW = Date.parse('2026-10-02T07:50:00Z');
const FEED = 'https://data.gdeltproject.org/gdeltv2';
const LABEL = '20261002074500';

// V2Themes (column 8) lists one "THEME,charoffset" entry per occurrence in the article.
function gkgRow({ date = LABEL, domain = 'news.example', url = 'https://news.example/story', themes = [], mentions = 3, locations = [], tone = -3, title = 'Story', published } = {}) {
  const columns = Array(27).fill('');
  columns[0] = `${date}-1`; columns[1] = date; columns[2] = '1'; columns[3] = domain; columns[4] = url;
  columns[8] = themes.flatMap(theme => Array.from({ length: mentions }, (_, i) => `${theme},${100 + i * 40}`)).join(';');
  columns[10] = locations.join(';'); columns[15] = `${tone},1,2,3,4,5,100`;
  columns[26] = `${published ? `<PAGE_PRECISEPUBTIMESTAMP>${published}</PAGE_PRECISEPUBTIMESTAMP>` : ''}<PAGE_TITLE>${title}</PAGE_TITLE>`;
  return columns.join('\t');
}
const place = (type, name, lat, lon) => `${type}#${name}#XX#XX00#1#${lat}#${lon}#-1#10`;

function feedFetch(t, { label = LABEL, rows = [], listing, archive, listingStatus = 200 } = {}) {
  const requests = [];
  t.mock.restoreAll();
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname.endsWith('/lastupdate.txt')) {
      return new Response(listing ?? `1 a http://data.gdeltproject.org/gdeltv2/${label}.export.CSV.zip\n1 b http://data.gdeltproject.org/gdeltv2/${label}.mentions.CSV.zip\n2924100 c http://data.gdeltproject.org/gdeltv2/${label}.gkg.csv.zip\n`, { status: listingStatus });
    }
    return new Response(archive ?? zipOf(`${label}.gkg.csv`, rows.join('\n') + '\n'));
  });
  return requests;
}

test('GDELT builds its briefing from the static GKG feed and never calls the rate-limited API', async t => {
  const requests = feedFetch(t, {
    rows: [
      gkgRow({ title: 'Missile strike hits depot &amp; &#xA3;5m port', url: 'https://news.example/strike', themes: ['ARMEDCONFLICT', 'KILL'], tone: -8,
        locations: [place(1, 'Ukraine', 49, 32), place(4, 'Kyiv, Ukraine', 50.45, 30.52)], published: '20261002071500' }),
      gkgRow({ title: 'Floods and inflation squeeze households', domain: 'econ.example', url: 'https://econ.example/flood', themes: ['ECON_INFLATION', 'NATURAL_DISASTER_FLOOD'], tone: -2,
        locations: [place(4, 'Kyiv, Ukraine', 50.45, 30.52), place(5, 'Texas, United States', 31, -100)] }),
      gkgRow({ title: 'Outbreak response widens', url: 'https://news.example/outbreak', themes: ['HEALTH_PANDEMIC'], tone: -5 }),
      gkgRow({ title: 'Band announces tour', url: 'https://news.example/band', themes: ['MEDIA_SOCIAL', 'WB_678_DIGITAL_GOVERNMENT'], tone: 4 }),
      gkgRow({ title: 'Unsafe link', url: 'javascript:alert(1)', themes: ['ARMEDCONFLICT'], tone: -9 }),
    ],
  });
  const result = await gdelt();
  assert.equal(result.error, undefined);
  assert.equal(result.source, 'GDELT');
  assert.deepEqual(requests.map(url => `${url.protocol}//${url.host}${url.pathname}`), [
    `${FEED}/lastupdate.txt`, `${FEED}/${LABEL}.gkg.csv.zip`,
  ]);
  assert.ok(requests.every(url => url.protocol === 'https:' && url.host === 'data.gdeltproject.org'), 'Only the static https data host is contacted');
  assert.equal(result.totalArticles, 3, 'Irrelevant and unsafe-link articles are excluded');
  assert.deepEqual(result.allArticles.map(a => a.title), [
    'Floods and inflation squeeze households', 'Missile strike hits depot & £5m port', 'Outbreak response widens',
  ], 'Stories most about the watched themes come first (then tone) and entities in titles are decoded');
  const [flood, strike] = result.allArticles;
  assert.equal(strike.url, 'https://news.example/strike');
  assert.equal(strike.domain, 'news.example');
  assert.equal(strike.seendate, '20261002T074500Z');
  assert.equal(strike.date, '20261002T071500Z', 'Publication time comes from the provider timestamp');
  assert.equal(flood.date, undefined, 'An unknown publication time stays unknown');
  assert.deepEqual([result.conflicts, result.economy, result.health, result.crisis].map(list => list.length), [1, 1, 1, 1]);
  assert.equal(result.conflicts[0].title, strike.title);
  assert.deepEqual(result.geoPoints, [{ lat: 50.45, lon: 30.52, name: 'Kyiv, Ukraine', count: 2, type: 'event' }],
    'Only cities are mapped; country and state centroids would plot events at meaningless points');
  assert.equal(result.feedTimestamp, '2026-10-02T07:45:00.000Z');
});

test('GDELT never downloads from a host or path the official feed index does not own', async t => {
  for (const line of [
    `1 a http://evil.example/gdeltv2/${LABEL}.gkg.csv.zip`,
    `1 a https://data.gdeltproject.org.evil.example/gdeltv2/${LABEL}.gkg.csv.zip`,
    `1 a https://data.gdeltproject.org/other/${LABEL}.gkg.csv.zip`,
    `1 a https://data.gdeltproject.org/gdeltv2/../../${LABEL}.gkg.csv.zip`,
  ]) {
    const requests = feedFetch(t, { listing: `${line}\n` });
    const result = await gdelt();
    assert.match(result.error, /GDELT.*index.*GKG/i, line);
    assert.equal(requests.length, 1, `Only the index is requested for ${line}`);
    assert.deepEqual(result.allArticles, []);
    assert.deepEqual(result.geoPoints, []);
    t.mock.restoreAll();
  }
});

test('GDELT reports an outdated feed as stale without inventing articles', async t => {
  const requests = feedFetch(t, { label: '20261002010000', rows: [gkgRow({ themes: ['ARMEDCONFLICT'] })] });
  const result = await gdelt();
  assert.equal(result.stale, true);
  assert.equal(result.error, undefined);
  assert.match(result.message, /GDELT.*older than/i);
  assert.deepEqual(result.allArticles, []);
  assert.deepEqual(result.geoPoints, []);
  assert.equal(requests.length, 1, 'The outdated archive is not downloaded');
});

test('GDELT keeps a feed that is labelled slightly ahead of the current time', async t => {
  feedFetch(t, { label: '20261002080500', rows: [gkgRow({ date: '20261002080500', themes: ['TERROR'] })] });
  const result = await gdelt();
  assert.equal(result.error, undefined);
  assert.equal(result.stale, undefined);
  assert.equal(result.totalArticles, 1, 'GDELT labels files about ten minutes ahead of when they are written');
});

test('GDELT makes provider failures visible and never reports an empty feed as healthy', async t => {
  const cases = [
    [{ listingStatus: 404 }, /GDELT.*index.*unavailable.*404/i],
    [{ listing: 'maintenance page\n' }, /GDELT.*index.*GKG/i],
    [{ archive: Buffer.from('<html>Service unavailable</html>') }, /GDELT.*archive.*could not be read/i],
    [{ rows: [] }, /GDELT.*no (usable )?article/i],
  ];
  for (const [options, message] of cases) {
    feedFetch(t, options);
    const result = await gdelt();
    assert.match(result.error, message);
    assert.deepEqual(result.allArticles, []);
    assert.deepEqual(result.geoPoints, []);
    t.mock.restoreAll();
  }
});

test('GDELT skips malformed rows and bounds hostile titles instead of failing the sweep', async t => {
  feedFetch(t, {
    rows: [
      'not a gkg row',
      gkgRow({ title: `Alert \u0007‮${'x'.repeat(600)}`, themes: ['MILITARY'], locations: [place(4, 'Nowhere', 'abc', 'def'), place(4, 'Off map', 95, 10), place(4, 'Oslo, Norway', 59.91, 10.75)] }),
    ],
  });
  const result = await gdelt();
  assert.equal(result.error, undefined);
  assert.equal(result.totalArticles, 1);
  assert.ok(result.allArticles[0].title.length <= 300);
  assert.doesNotMatch(result.allArticles[0].title, /[\u0000-\u001f‮]/);
  assert.deepEqual(result.geoPoints.map(point => point.name), ['Oslo, Norway'], 'Invalid or out-of-range coordinates are dropped');
});

test('GDELT limits the briefing to fifty articles and thirty places without hiding weaker categories', async t => {
  const rows = Array.from({ length: 80 }, (_, i) => gkgRow({
    title: `Conflict report ${i}`, url: `https://news.example/${i}`, themes: ['ARMEDCONFLICT'], tone: -1 - i / 10,
    locations: [place(4, `City ${i}`, (i % 80) - 40, i)],
  }));
  rows.push(gkgRow({ title: 'Quiet outbreak update', url: 'https://news.example/quiet', themes: ['HEALTH_PANDEMIC'], tone: -0.1 }));
  feedFetch(t, { rows });
  const result = await gdelt();
  assert.equal(result.allArticles.length, 50);
  assert.equal(result.allArticles[0].title, 'Conflict report 79');
  assert.equal(result.allArticles.some(a => a.title === 'Quiet outbreak update'), false, 'Weak coverage stays out of the top fifty');
  assert.deepEqual(result.health.map(a => a.title), ['Quiet outbreak update'], 'Category counts do not depend on the top-fifty cut');
  assert.equal(result.conflicts.length, 50);
  assert.equal(result.geoPoints.length, 30);
  assert.equal(result.matchedArticles, 81);
});

test('GDELT ranks by how much an article is about a theme and ignores passing mentions', async t => {
  feedFetch(t, {
    rows: [
      gkgRow({ title: 'Passing mention of a protest', domain: 'a.example', url: 'https://a.example/1', themes: ['PROTEST'], mentions: 1, tone: -9 }),
      gkgRow({ title: 'Brief note on sanctions', domain: 'b.example', url: 'https://b.example/1', themes: ['SANCTIONS'], mentions: 2, tone: -1 }),
      gkgRow({ title: 'Everything about the eruption', domain: 'c.example', url: 'https://c.example/1', themes: ['NATURAL_DISASTER_VOLCANIC'], mentions: 12, tone: -1 }),
      ...['d', 'e', 'f'].map(name => gkgRow({ title: 'Syndicated lifestyle piece', domain: `${name}.example`, url: `https://${name}.example/1`, themes: ['ECON_DEBT'], mentions: 2, tone: -9 })),
    ],
  });
  const result = await gdelt();
  assert.deepEqual(result.allArticles.map(a => a.title), ['Everything about the eruption', 'Syndicated lifestyle piece', 'Brief note on sanctions'],
    'A single mention is not coverage; a focused story beats a widely syndicated passing one');
  assert.equal(result.crisis.length, 1);
  assert.equal(result.conflicts.length, 0, 'One protest mention does not make a conflict story');
});

test('GDELT treats a populated feed with no matching coverage as a visible failure', async t => {
  feedFetch(t, { rows: [gkgRow({ title: 'Band announces tour', themes: ['MEDIA_SOCIAL'], tone: 4 })] });
  const result = await gdelt();
  assert.match(result.error, /GDELT.*no matching/i);
  assert.deepEqual(result.allArticles, []);
});

test('GDELT collapses repeated headlines and ranks widely covered stories first', async t => {
  feedFetch(t, {
    rows: [
      gkgRow({ title: 'Lone report of a dramatic attack', domain: 'solo.example', url: 'https://solo.example/a', themes: ['TERROR'], tone: -9 }),
      gkgRow({ title: 'Ports closed as strike widens', domain: 'one.example', url: 'https://one.example/s', themes: ['PROTEST'], tone: -1 }),
      gkgRow({ title: 'PORTS closed as strike widens!', domain: 'two.example', url: 'https://two.example/s', themes: ['PROTEST'], tone: -4 }),
      gkgRow({ title: 'Ports closed as strike widens', domain: 'three.example', url: 'https://three.example/s', themes: ['PROTEST'], tone: -2 }),
      gkgRow({ title: 'Ports closed as strike widens', domain: 'three.example', url: 'https://three.example/s2', themes: ['PROTEST'], tone: -2 }),
    ],
  });
  const result = await gdelt();
  assert.deepEqual(result.allArticles.map(a => a.title), ['PORTS closed as strike widens!', 'Lone report of a dramatic attack'],
    'Repeats collapse into the most intense copy, and a story carried by more outlets outranks a single louder one');
  assert.equal(result.allArticles[0].domain, 'two.example');
  assert.equal(result.totalArticles, 2);
  assert.equal(result.matchedArticles, 5);
});

test('GDELT drops publication times that are later than the moment GDELT saw the article', async t => {
  feedFetch(t, {
    rows: [
      gkgRow({ title: 'Page claims the future', url: 'https://news.example/future', themes: ['MILITARY'], tone: -4, published: '20261002082500' }),
      gkgRow({ title: 'Page clock is a minute fast', url: 'https://news.example/skew', themes: ['MILITARY'], tone: -3, published: '20261002074600' }),
      gkgRow({ title: 'Page time is impossible', url: 'https://news.example/bad', themes: ['MILITARY'], tone: -2, published: '20261302250000' }),
    ],
  });
  const result = await gdelt();
  const byTitle = Object.fromEntries(result.allArticles.map(a => [a.title, a]));
  assert.equal(byTitle['Page claims the future'].date, undefined);
  assert.equal(byTitle['Page claims the future'].seendate, '20261002T074500Z', 'Observation time is kept');
  assert.equal(byTitle['Page clock is a minute fast'].date, '20261002T074600Z', 'Small clock skew is tolerated');
  assert.equal(byTitle['Page time is impossible'].date, undefined);
});
