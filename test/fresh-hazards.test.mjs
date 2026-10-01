import test from 'node:test';
import assert from 'node:assert/strict';

const now = Date.parse('2026-10-01T21:00:00Z');
const modules = {};
// Dynamic loading makes the initial red run report missing adapter behavior as an assertion.
for (const name of ['meteoalarm', 'gdacs', 'eonet']) {
  try { modules[name] = await import(`../apis/sources/${name}.mjs`); } catch (error) { modules[name] = { loadError: error.message }; }
}
const load = name => { assert.equal(modules[name].loadError, undefined, `${name} adapter must be implemented`); return modules[name]; };
const atomEntry = (changes = {}) => {
  const x = { id:'warning-1', updated:'2026-10-01T20:30:00Z', published:'2026-10-01T20:00:00Z', expires:'2026-10-02T20:00:00Z', status:'Actual', point:'', ...changes };
  return `<entry><id>${x.id}</id><title>Heavy rain &amp; wind warning</title><updated>${x.updated}</updated><published>${x.published}</published><cap:sent>${x.updated}</cap:sent><cap:expires>${x.expires}</cap:expires><cap:status>${x.status}</cap:status><cap:event>Heavy rain</cap:event><cap:areaDesc>Fixture region</cap:areaDesc><cap:severity>Moderate</cap:severity><cap:onset>2026-10-02T01:00:00Z</cap:onset><cap:urgency>Future</cap:urgency><link type="application/cap+xml" href="https://feeds.meteoalarm.org/linked-cap"/><link title="Fixture region" href="https://meteoalarm.org?geocode=EMMA_ID:HU001"/>${x.point ? `<georss:point>${x.point}</georss:point>` : ''}</entry>`;
};
const atom = (entries = [], updated = '2026-10-01T20:45:00Z') => `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2" xmlns:georss="http://www.georss.org/georss"><updated>${updated}</updated><rights>CC BY 4.0 equivalent with additional redistribution terms</rights>${entries.join('')}</feed>`;
const rssItem = (changes = {}) => {
  const x = { id:'1', modified:'Thu, 01 Oct 2026 20:00:00 GMT', published:'Thu, 01 Oct 2026 20:30:00 GMT', started:'Thu, 01 Oct 2026 19:00:00 GMT', current:'true', point:'47.5 19.1', ...changes };
  return `<item><title>Green flood alert in Hungary</title><description>Provider flood alert</description><link>https://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=${x.id}</link><atom:link href="https://www.gdacs.org/other"/><pubDate>${x.published}</pubDate><gdacs:datemodified>${x.modified}</gdacs:datemodified><gdacs:fromdate>${x.started}</gdacs:fromdate><gdacs:todate>Thu, 01 Oct 2026 19:00:00 GMT</gdacs:todate><gdacs:iscurrent>${x.current}</gdacs:iscurrent><gdacs:eventtype>FL</gdacs:eventtype><gdacs:eventid>${x.id}</gdacs:eventid><gdacs:episodeid>2</gdacs:episodeid><gdacs:country>Hungary</gdacs:country><gdacs:alertlevel>Green</gdacs:alertlevel><gdacs:severity value="0" unit="">Magnitude 0</gdacs:severity><georss:point>${x.point}</georss:point></item>`;
};
const rss = (items = [], published = 'Thu, 01 Oct 2026 20:45:00 GMT') => `<rss version="2.0" xmlns:gdacs="http://www.gdacs.org" xmlns:georss="http://www.georss.org/georss" xmlns:atom="http://www.w3.org/2005/Atom"><channel><pubDate>${published}</pubDate><copyright>public domain</copyright>${items.join('')}</channel></rss>`;
const event = (changes = {}) => ({ id:'EONET-fixture', title:'Ongoing storm', closed:null, description:null, categories:[{id:'severeStorms',title:'Severe Storms'}], sources:[{id:'JTWC',url:'https://www.metoc.navy.mil/jtwc/fixture'}], geometry:[{ date:'2026-09-21T12:00:00Z', type:'Point', coordinates:[130,10] }, { date:'2026-10-01T12:00:00Z', type:'Point', coordinates:[140,15], magnitudeValue:50, magnitudeUnit:'kts' }], ...changes });

test('Meteoalarm preserves fresh issued warnings, expiry, attribution and future warning onset', () => {
  const result = load('meteoalarm').parseMeteoalarm(atom([atomEntry()]), { country:'hungary', now });
  assert.equal(result.status, 'ok'); assert.equal(result.observations.length, 1);
  const row = result.observations[0];
  assert.equal(row.kind, 'weather'); assert.equal(row.source, 'Meteoalarm');
  assert.equal(row.title, 'Heavy rain & wind warning'); assert.equal(row.country, 'Hungary');
  assert.equal(row.observedAt, '2026-10-01T20:30:00.000Z'); assert.equal(row.publishedAt, '2026-10-01T20:00:00.000Z');
  assert.equal(row.validUntil, '2026-10-02T20:00:00.000Z'); assert.equal(row.startsAt, '2026-10-02T01:00:00.000Z');
  assert.equal(row.url, 'https://meteoalarm.org/?geocode=EMMA_ID:HU001');
  assert.equal(row.lat, undefined); assert.equal(row.lon, undefined);
  assert.match(result.rights, /additional redistribution terms/); assert.match(result.attribution, /Meteoalarm/i);
});

test('Meteoalarm rejects stale, invalid, future-dated, expired and non-actual warnings', () => {
  const entries = [atomEntry(), atomEntry({updated:'2026-09-28T20:00:00Z'}), atomEntry({updated:'nonsense'}), atomEntry({updated:'2026-10-02T20:00:00Z'}), atomEntry({expires:'2026-10-01T20:59:00Z'}), atomEntry({expires:'invalid'}), atomEntry({status:'Test'})];
  const result = load('meteoalarm').parseMeteoalarm(atom(entries), { now });
  assert.equal(result.observations.length, 1); assert.equal(result.rejectedObservations, 6);
  assert.equal(load('meteoalarm').parseMeteoalarm(atom([atomEntry()], '2026-09-28T20:00:00Z'), { now }).status, 'stale');
  assert.equal(load('meteoalarm').parseMeteoalarm(atom([], 'invalid'), { now }).status, 'stale');
});

test('Meteoalarm marks only explicit valid provider points as exact coordinates', () => {
  const result = load('meteoalarm').parseMeteoalarm(atom([atomEntry({point:'47.5 19.1'}), atomEntry({point:'91 181'})]), { now });
  assert.equal(result.observations.length, 1); assert.equal(result.observations[0].lat,47.5); assert.equal(result.observations[0].lon,19.1);
  assert.equal(result.observations[0].locationMethod,'provider'); assert.equal(result.observations[0].locationPrecision,'exact');
});

test('Meteoalarm bounded country feeds allow fresh valid empty coverage without following CAP links', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => { urls.push(url); return new Response(atom()); });
  const result = await load('meteoalarm').briefing({ now, retries:0 });
  assert.equal(result.status,'ok'); assert.equal(result.observations.length,0);
  assert.deepEqual(urls.sort(),['https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-austria','https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-hungary']);
  const invalid = await load('meteoalarm').briefing({ countries:['https://evil.example/'], now });
  assert.equal(invalid.status,'error'); assert.equal(urls.length,2);
});

test('Meteoalarm caps examined records across countries and distinguishes rejected coverage from an empty feed', async t => {
  t.mock.method(globalThis,'fetch',async()=>new Response(atom(Array.from({length:600},()=>atomEntry()))));
  const result=await load('meteoalarm').briefing({countries:['hungary','austria','france','germany'],now,retries:0});
  assert.equal(result.examinedRecords,500); assert.equal(result.observations.length,100);
  const rejected=load('meteoalarm').parseMeteoalarm(atom([atomEntry({updated:'invalid'})]),{now});
  assert.match(rejected.summary,/excluded|rejected|verified/i); assert.doesNotMatch(rejected.summary,/No active warnings/i);
});

test('hazard feeds reject unsafe XML and never let ambiguous namespace dates establish freshness', () => {
  for (const [name,parser,xml] of [['meteoalarm','parseMeteoalarm',atom()],['gdacs','parseGdacs',rss()]]) {
    assert.equal(load(name)[parser](`<!DOCTYPE feed [<!ENTITY x "boom">]>${xml}`,{now}).status,'error');
  }
  const ambiguous=atom([atomEntry()]).replace('<updated>2026-10-01T20:45:00Z</updated>', '<updated>2026-10-01T20:45:00Z</updated><cap:updated>2026-10-01T20:46:00Z</cap:updated>');
  assert.equal(load('meteoalarm').parseMeteoalarm(ambiguous,{now}).status,'stale');
});

test('GDACS uses the actual event modification date and preserves onset independently', () => {
  const result = load('gdacs').parseGdacs(rss([rssItem({started:'Mon, 21 Sep 2026 01:00:00 GMT'})]), { now });
  assert.equal(result.status,'ok'); assert.equal(result.observations.length,1);
  const row = result.observations[0];
  assert.equal(row.observedAt,'2026-10-01T20:00:00.000Z'); assert.equal(row.publishedAt,'2026-10-01T20:30:00.000Z');
  assert.equal(row.startsAt,'2026-09-21T01:00:00.000Z'); assert.equal(row.kind,'disaster');
  assert.equal(row.providerId,'FL:1:2'); assert.equal(row.url,'https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1');
  assert.equal(row.lat,47.5); assert.equal(row.lon,19.1); assert.equal(row.severity,'Green');
});

test('GDACS cannot revive stale or future disasters merely because the feed or publication is fresh', () => {
  const bad = [rssItem({modified:'Fri, 18 Sep 2026 06:16:34 GMT'}),rssItem({started:'Mon, 05 Oct 2026 01:00:00 GMT'}),rssItem({started:'invalid'}),rssItem({modified:'invalid'}),rssItem({modified:'Fri, 02 Oct 2026 06:16:34 GMT'}),rssItem({current:'false'}),rssItem({point:'100 200'})];
  const result = load('gdacs').parseGdacs(rss([rssItem(),...bad]), {now});
  assert.equal(result.observations.length,1); assert.equal(result.rejectedObservations,7);
  const stale = load('gdacs').parseGdacs(rss([rssItem()], 'Sun, 27 Sep 2026 20:00:00 GMT'), {now});
  assert.equal(stale.status,'stale'); assert.equal(stale.observations.length,0);
  assert.equal(load('gdacs').parseGdacs(rss([], 'invalid'),{now}).status,'stale');
});

test('GDACS supports geo:Point without fabricating coordinates when location is absent', () => {
  const xml = rss([rssItem()]).replace('<georss:point>47.5 19.1</georss:point>','<geo:Point xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#"><geo:lat>47.5</geo:lat><geo:long>19.1</geo:long></geo:Point>');
  assert.equal(load('gdacs').parseGdacs(xml,{now}).observations[0].lat,47.5);
  const row = load('gdacs').parseGdacs(rss([rssItem({point:''})]),{now}).observations[0];
  assert.equal(row.lat,undefined); assert.equal(row.lon,undefined);
});

test('GDACS retains provider reuse acknowledgements alongside the channel copyright', () => {
  const xml=rss([rssItem().replace('</item>','<gdacs:resources><gdacs:resource><gdacs:acknowledgements>European Union (CC BY 4.0), credit GDACS</gdacs:acknowledgements></gdacs:resource></gdacs:resources></item>')]);
  const result=load('gdacs').parseGdacs(xml,{now});
  assert.match(result.rights,/public domain/); assert.match(result.rights,/CC BY 4.0/); assert.match(result.rights,/credit GDACS/);
});

test('EONET selects the latest recent geometry of an ongoing event and links the original source', () => {
  const result = load('eonet').parseEonet({ events:[event()] }, {now});
  assert.equal(result.source,'NASA-EONET'); assert.equal(result.status,'ok'); assert.equal(result.observedAt,'2026-10-01T12:00:00.000Z');
  const row = result.observations[0];
  assert.equal(row.observedAt,'2026-10-01T12:00:00.000Z'); assert.equal(row.publishedAt,null);
  assert.equal(row.lat,15); assert.equal(row.lon,140); assert.equal(row.url,'https://www.metoc.navy.mil/jtwc/fixture');
  assert.equal(row.locationPrecision,'exact'); assert.equal(row.geometryType,'Point');
});

test('EONET Polygon observations remain fresh without an invented center point', () => {
  const geometry = [{date:'2026-10-01T12:00:00Z',type:'Polygon',coordinates:[[[1,2],[3,2],[3,4],[1,2]]]}];
  const result = load('eonet').parseEonet({events:[event({geometry})]},{now});
  assert.equal(result.observations.length,1); assert.equal(result.observations[0].geometryType,'Polygon');
  assert.equal(result.observations[0].lat,undefined); assert.equal(result.observations[0].lon,undefined);
});

test('EONET rejects stale, unknown, future, malformed and closed observations', () => {
  const geometry = (date,coordinates=[1,2]) => [{date,type:'Point',coordinates}];
  const bad = [event({geometry:geometry('2026-09-21T12:00:00Z')}),event({geometry:geometry('bad')}),event({geometry:geometry('2026-10-02T12:00:00Z')}),event({geometry:geometry('2026-10-01T12:00:00Z',[181,91])}),event({closed:'2026-10-01T12:00:00Z'})];
  const result = load('eonet').parseEonet({events:[event(),...bad]},{now});
  assert.equal(result.observations.length,1); assert.equal(result.rejectedObservations,5);
  const empty = load('eonet').parseEonet({events:[]},{now});
  assert.equal(empty.status,'stale'); assert.equal(empty.observedAt,null); assert.equal(empty.freshness.reason,'unknown-provider-time');
});

test('all hazard adapters bound output and distinguish malformed or transport failures from valid empty feeds', async t => {
  assert.equal(load('meteoalarm').parseMeteoalarm(atom(Array.from({length:600},()=>atomEntry())),{now}).observations.length,100);
  assert.equal(load('gdacs').parseGdacs(rss(Array.from({length:600},()=>rssItem())),{now}).examinedRecords,500);
  assert.equal(load('eonet').parseEonet({events:Array.from({length:600},()=>event())},{now}).observations.length,100);
  for (const name of ['meteoalarm','gdacs','eonet']) {
    t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:503}));
    const failure = await load(name).briefing({now,retries:0});
    assert.equal(failure.status,'error'); assert.equal(failure.observations.length,0); assert.match(failure.error,/503/);
    t.mock.restoreAll();
  }
  assert.equal(load('meteoalarm').parseMeteoalarm('<html/>',{now}).status,'error');
  assert.equal(load('gdacs').parseGdacs('<rss/>',{now}).status,'error');
  assert.equal(load('eonet').parseEonet({events:{}},{now}).status,'error');
});

test('all hazard transports refuse bodies larger than 2 MiB without producing successful empty coverage', async t => {
  for (const name of ['meteoalarm','gdacs','eonet']) {
    t.mock.method(globalThis,'fetch',async()=>new Response('x'.repeat(2*1024*1024+1)));
    const result=await load(name).briefing({now,retries:0});
    assert.equal(result.status,'error'); assert.equal(result.observations.length,0); assert.match(result.error,/byte limit/);
    t.mock.restoreAll();
  }
});

test('Meteoalarm exposes partial country coverage and never borrows a fresh neighbour timestamp for stale warnings', async t => {
  t.mock.method(globalThis,'fetch',async url=>new Response(url.endsWith('-hungary') ? atom([atomEntry()],'2026-09-21T12:00:00Z') : atom()));
  const result=await load('meteoalarm').briefing({now,retries:0});
  assert.equal(result.status,'ok'); assert.equal(result.partial,true); assert.equal(result.observations.length,0);
  assert.equal(result.countryFeeds[0].status,'stale'); assert.match(result.summary,/partial/i);
});
