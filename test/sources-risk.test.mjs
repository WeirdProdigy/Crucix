import test from 'node:test';
import assert from 'node:assert/strict';
import { parseViews, briefing as views } from '../apis/sources/views.mjs';
import { parseInform, briefing as inform } from '../apis/sources/inform.mjs';

// Trimmed real responses of 2026-10-03 (Hungary, Ukraine, Afghanistan only); the `current` alias and the unpublished/regional
// workflows are decoys the adapters must ignore.
const NOW = Date.parse('2026-10-03T12:00:00Z');
const DAY = 86400000;
const row = (id, month, name, isoab, dich, mean) => ({ country_id: 1, month_id: id, name, gwcode: 1, isoab, year: 2026, month, main_mean_ln: 0, main_dich: dich, main_mean: mean });
const viewsRows = {
  next_page: '', prev_page: '', row_count: 6, page_count: 1, page_cur: 1, start_date: 561, end_date: 596,
  data: [row(561, 9, 'Hungary', 'HUN', 0, 0.0065), row(562, 10, 'Hungary', 'HUN', 0, 0.0082), row(563, 11, 'Hungary', 'HUN', 0, 0.013),
    row(561, 9, 'Ukraine', 'UKR', 1, 4062.14), row(562, 10, 'Ukraine', 'UKR', 1, 4255.26), row(563, 11, 'Ukraine', 'UKR', 1, 4224.612)],
};
const viewsRuns = { runs: ['d_2021_02_01', 'fatalities001_2022_00_t01', 'fatalities003_2026_07_t01', 'fatalities003_2026_08_t01', 'current', 'r_2021_12_01'] };
const workflow = (WorkflowId, Name, FlagGnaPublished, extra = {}) => ({ WorkflowId, Name, FlagGnaPublished, System: 'INFORM', Iso3: null, ...extra });
const mid2026 = workflow(515, 'INFORM Risk Mid 2026', '2026-09-02T00:00:00');
const risk2026 = workflow(505, 'INFORM Risk 2026', '2026-03-23T00:00:00');
const scoreRows = [['AFG', 7.8], ['HUN', 2.2], ['UKR', 5.7]].map(([Iso3, IndicatorScore]) => ({ Iso3, IndicatorId: 'INFORM', IndicatorScore, IndicatorName: '', nodelevel: 0, ValidityYear: 0, Unit: '', Note: '' }));
const failing = status => async () => ({ error: `HTTP ${status}`, status });

test('VIEWS-Forecast: the newest run, three forecast months, ISO3 map, attribution; a changed shape or an outage is an error and the last good payload goes stale', async () => {
  const result = parseViews(viewsRuns, viewsRows, NOW);
  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'VIEWS-Forecast');
  assert.equal(result.run, 'fatalities003_2026_08_t01', 'the greatest run id of the documented shape; never the current alias');
  assert.deepEqual(result.months, [561, 562, 563], 'run month 2026-08 -> forecasts for 2026-09.. with month_id = (year-1980)*12+month');
  assert.deepEqual(Object.keys(result.countries), ['HUN', 'UKR']);
  assert.equal(result.countries.UKR.name, 'Ukraine');
  assert.deepEqual(result.countries.UKR.months[0], { month_id: 561, year: 2026, month: 9, main_dich: 1, main_mean: 4062.14 });
  assert.deepEqual(result.countries.HUN.months.map(item => item.month), [9, 10, 11]);
  assert.ok(result.attribution.startsWith('Conflict forecasts: VIEWS (Uppsala University and PRIO), run fatalities003_2026_08_t01.') && result.attribution.includes('Hegre et al. 2021'));
  assert.ok(/no data licence/i.test(result.license) && !/CC BY 4/.test(result.license), 'no data licence is stated and CC BY 4.0 is not claimed');
  assert.ok(!('stale' in result));

  for (const [runs, data] of [[viewsRuns, { results: viewsRows.data }], [viewsRuns, { ...viewsRows, next_page: '/page/2' }], [viewsRuns, { data: viewsRows.data.map(item => ({ ...item, isoab: null })) }],
    [viewsRuns, { data: viewsRows.data.map(item => ({ ...item, main_dich: '0.5' })) }], [{ runs: ['current', 'd_2021_02_01'] }, viewsRows], [{ runs: 'x' }, viewsRows], [null, null]]) {
    const bad = parseViews(runs, data, NOW);
    assert.equal(bad.status, 'error');
    assert.ok(typeof bad.error === 'string' && bad.error.length > 0 && !('countries' in bad));
  }

  // briefing(): two requests when cold, the run id (not the alias) in the data URL, never throws, last good payload kept 45 days.
  const urls = [];
  const fetcher = async url => { urls.push(url); return url.endsWith('/') ? viewsRuns : viewsRows; };
  const cold = await views({ fetcher, now: NOW });
  assert.equal(cold.status, 'ok');
  assert.equal(urls.length, 2);
  assert.equal(urls[0], 'https://api.viewsforecasting.org/');
  assert.equal(urls[1], 'https://api.viewsforecasting.org/fatalities003_2026_08_t01/cm/sb?month=561&month=562&month=563');
  const down = await views({ fetcher: failing(503), now: NOW });
  assert.equal(down.status, 'error');
  assert.ok(/503/.test(down.error) && !/https?:/.test(down.error));
  assert.equal((await views({ fetcher: async () => { throw new Error('boom https://secret.example/?key=1'); }, now: NOW })).error, 'VIEWS request failed');
  await views({ fetcher, now: NOW, useCache: true });
  urls.length = 0;
  assert.equal((await views({ fetcher, now: NOW + 3600000, useCache: true })).status, 'ok');
  assert.equal(urls.length, 0, 'a run already held is not requested again within a day');
  const stale = await views({ fetcher: failing(500), now: NOW + 2 * DAY, useCache: true });
  assert.equal(stale.status, 'ok');
  assert.equal(stale.stale, true);
  assert.equal(stale.run, 'fatalities003_2026_08_t01');
  assert.equal(stale.timestamp, new Date(NOW + 2 * DAY).toISOString());
  assert.equal((await views({ fetcher: failing(500), now: NOW + 46 * DAY, useCache: true })).status, 'error', 'after 45 days the last good payload is gone');
});

test('INFORM-Risk: the newest published release, ISO3 scores, attribution; a changed shape is an error; the year fallback reads the previous year in the same call', async () => {
  const workflows = [workflow(530, 'INFORM Risk Mid 2027', null), workflow(10, 'INFORM LAC', '2026-09-30T00:00:00', { System: 'INFORM_LAC' }), risk2026, mid2026];
  const result = parseInform(workflows, scoreRows, NOW);
  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'INFORM-Risk');
  assert.equal(result.release, 'INFORM Risk Mid 2026', 'unpublished and regional workflows are ignored');
  assert.equal(result.workflowId, 515);
  assert.equal(result.published, '2026-09-02', 'zone-less provider timestamps are UTC');
  assert.deepEqual(result.countries, { AFG: { score: 7.8 }, HUN: { score: 2.2 }, UKR: { score: 5.7 } });
  assert.equal(result.attribution, 'INFORM Risk Index, European Commission Joint Research Centre (DRMKC) / INFORM partnership, INFORM Risk Mid 2026.');
  assert.ok(result.license.includes('INFORM is open-source'));

  for (const [list, scores] of [[workflows, { rows: scoreRows }], [workflows, scoreRows.map(item => ({ ...item, IndicatorScore: '2.2' }))], [workflows, scoreRows.map(item => ({ ...item, Iso3: 'hu' }))],
    [workflows, []], [[workflow(530, 'INFORM Risk Mid 2027', null)], scoreRows], [{ error: 'x' }, scoreRows], [null, null]]) {
    const bad = parseInform(list, scores, NOW);
    assert.equal(bad.status, 'error');
    assert.ok(typeof bad.error === 'string' && bad.error.length > 0 && !('countries' in bad));
  }

  // briefing(): list + scores = two requests; in spring the current year's list is empty, so the previous year's list is read
  // too and the release's scores come with a third request in the same call.
  const urls = [];
  const fetcher = async url => {
    urls.push(url.replace('https://drmkc.jrc.ec.europa.eu/inform-index/API/InformAPI', ''));
    if (url.includes('GetByYear/2026')) return now >= NOW ? [mid2026] : [];
    if (url.includes('GetByYear/2025')) return [risk2026];
    return scoreRows;
  };
  let now = NOW;
  const warm = await inform({ fetcher, now });
  assert.equal(warm.status, 'ok');
  assert.deepEqual(urls, ['/Workflows/GetByYear/2026', '/Countries/Scores/?WorkflowId=515&IndicatorId=INFORM']);

  urls.length = 0;
  now = Date.parse('2026-05-01T00:00:00Z');
  const first = await inform({ fetcher, now, useCache: true });
  assert.equal(first.status, 'ok');
  assert.equal(first.release, 'INFORM Risk 2026');
  assert.equal(first.workflowId, 505);
  assert.deepEqual(urls, ['/Workflows/GetByYear/2026', '/Workflows/GetByYear/2025', '/Countries/Scores/?WorkflowId=505&IndicatorId=INFORM']);
  urls.length = 0;
  assert.equal((await inform({ fetcher, now: now + 2 * 900000, useCache: true })).status, 'ok');
  assert.equal(urls.length, 0, 'the release scores are cached for 7 days');

  const down = await inform({ fetcher: failing(502), now: NOW });
  assert.equal(down.status, 'error');
  assert.ok(/502/.test(down.error) && !/https?:/.test(down.error));
  assert.equal((await inform({ fetcher: async () => { throw new Error('boom https://secret.example/?key=1'); }, now: NOW })).error, 'INFORM request failed');
});
