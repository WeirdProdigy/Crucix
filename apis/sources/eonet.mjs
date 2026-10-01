// NASA EONET is a curated event tracker. Geometry dates provide event observations, not feed generation time.
import { safeFetch } from '../utils/fetch.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';
const SOURCE='NASA-EONET';
const FEED_URL='https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=3&limit=50';
const META={feedUrl:FEED_URL,attribution:'NASA Earth Observatory Natural Event Tracker (EONET), with links to the original event sources',
  coverage:'Open EONET events with a recent provider geometry observation; coverage is curated and not a complete emergency-alert feed.'};
function text(value,limit=1000) {return typeof value==='string' ? value.trim().slice(0,limit) : null;}
function externalUrl(value) {
  if (typeof value!=='string' || value.length>2000) return null;
  try {const url=new URL(value);return ['https:','http:'].includes(url.protocol) ? url.toString() : null;} catch {return null;}
}
function validPair(pair) {return Array.isArray(pair) && pair.length>=2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
  && pair[0]>=-180 && pair[0]<=180 && pair[1]>=-90 && pair[1]<=90;}
function geometry(geo,now) {
  if (!geo || typeof geo!=='object') return null;
  const observedAt=providerTime(geo.date);
  if (!freshness(observedAt,POLICIES[SOURCE].maxAgeMs,now).fresh) return null;
  if (geo.type==='Point' && validPair(geo.coordinates)) return {observedAt,geometryType:'Point',lon:geo.coordinates[0],lat:geo.coordinates[1],locationMethod:'provider',locationPrecision:'exact'};
  if (geo.type==='Polygon' && Array.isArray(geo.coordinates) && geo.coordinates.length>0
      && geo.coordinates.length<=100 && geo.coordinates.every(ring=>Array.isArray(ring) && ring.length>=4 && ring.length<=500
        && ring.every(validPair) && ring[0][0]===ring.at(-1)[0] && ring[0][1]===ring.at(-1)[1])) {
    return {observedAt,geometryType:'Polygon'}; // no invented centroid or exact point
  }
  return null;
}
function observation(event,now) {
  if (!event || typeof event!=='object' || event.closed!==null || !Array.isArray(event.geometry)) return null;
  const title=text(event.title,500),providerId=text(event.id,200);
  if (!title || !providerId) return null;
  // An ongoing storm can begin weeks ago and still have a fresh geometry update.
  const latest=event.geometry.slice(0,500).map(geo=>geometry(geo,now)).filter(Boolean)
    .sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
  if (!latest) return null;
  const category=Array.isArray(event.categories) ? event.categories.slice(0,10).map(item=>text(item?.title,100)).filter(Boolean).join(', ') : '';
  return {kind:'disaster',title,summary:text(event.description,1500)||`${title}${category ? ` — ${category}` : ''}`,
    source:SOURCE,url:externalUrl(event.sources?.[0]?.url)||'https://eonet.gsfc.nasa.gov/',providerId,
    publishedAt:null,...latest,...(category ? {category} : {})};
}

export function parseEonet(data,{now=Date.now()}={}) {
  if (!data || !Array.isArray(data.events)) return unavailableResult(SOURCE,'Invalid EONET events response',META,now);
  const events=data.events.slice(0,500),rows=events.map(event=>observation(event,now)).filter(Boolean);
  const observedAt=rows.map(row=>row.observedAt).sort().at(-1)||null;
  const out=freshResult(SOURCE,observedAt,rows,{...META,examinedRecords:events.length,
    truncatedRecords:Math.max(0,data.events.length-500)+Math.max(0,rows.length-100)},now);
  return {...out,rejectedObservations:events.length-out.observations.length,
    summary:rows.length ? `${out.observations.length} open natural events with a geometry observation in the last 72 hours.`
      : 'No verified recent EONET geometry observations. The API supplies no feed generation timestamp, so fresh empty coverage cannot be established.'};
}

export async function briefing(options={}) {
  const now=options.now ?? Date.now();
  const data=await safeFetch(FEED_URL,{maxBytes:2*1024*1024,
    timeout:Math.max(1,Math.min(10000,Number(options.timeout)||10000)),retries:options.retries===1 ? 1 : 0});
  return data.error ? unavailableResult(SOURCE,data.error,META,now) : parseEonet(data,{now});
}
