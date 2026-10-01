// GDACS updates are not event onset times; reject archived updates and future onsets.
import { safeFetch } from '../utils/fetch.mjs';
import { parseXml } from '../utils/xml.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';
const SOURCE = 'GDACS';
const FEED_URL = 'https://www.gdacs.org/xml/rss.xml';
const META = {feedUrl:FEED_URL,attribution:'GDACS / European Commission Joint Research Centre and United Nations',
  coverage:'Recent provider updates for current GDACS humanitarian-impact alerts; this is not a complete disaster catalogue.'};
const list = value => value===undefined ? [] : Array.isArray(value) ? value : [value];
function text(value,limit=1000) {
  const raw = typeof value==='string' ? value : !Array.isArray(value) && typeof value?.['#text']==='string' ? value['#text'] : null;
  return raw===null ? null : raw.trim().slice(0,limit);
}
function externalUrl(value) {
  if (typeof value!=='string' || value.length>2000) return null;
  try { const url=new URL(value); return ['https:','http:'].includes(url.protocol) ? url.toString() : null; } catch {return null;}
}
function point(item) {
  let pair;
  const geo = item.Point;
  if (geo!==undefined) {
    if (!geo || Array.isArray(geo)) return null;
    pair = [text(geo.lat),text(geo.long)];
  } else {
    const raw=text(item.point);
    if (!raw) return {};
    pair=raw.split(/\s+/);
  }
  if (pair.length!==2 || pair.some(v=>typeof v!=='string' || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v))) return null;
  const [lat,lon]=pair.map(Number);
  return lat>=-90 && lat<=90 && lon>=-180 && lon<=180 ? {lat,lon,locationMethod:'provider',locationPrecision:'exact'} : null;
}
function disaster(item,now) {
  if (!item || typeof item!=='object' || Array.isArray(item) || text(item.iscurrent)?.toLowerCase()!=='true') return null;
  const publishedAt=providerTime(text(item.pubDate ?? item.dateadded));
  // A supplied invalid/old modification date must never fall back to a newer publication date.
  const observedAt=providerTime(text(item.datemodified ?? item.pubDate ?? item.dateadded));
  const startsAt=providerTime(text(item.fromdate));
  if (!publishedAt || Date.parse(publishedAt)>now+300000 || !startsAt || Date.parse(startsAt)>now+300000
      || !freshness(observedAt,POLICIES[SOURCE].observationMaxAgeMs,now).fresh) return null;
  const title=text(item.title,500), id=text(item.eventid,100), type=text(item.eventtype,20), episode=text(item.episodeid,100);
  const coordinates=point(item);
  if (!title || !id || !type || !coordinates) return null;
  // RSS link text can coexist with an atom:link object after namespace-prefix removal.
  const link=list(item.link).map(value=>externalUrl(text(value,2000))).find(Boolean);
  const country=text(item.country,150),severity=text(item.alertlevel,100);
  return {kind:'disaster',title,summary:text(item.description,1500)||title,source:SOURCE,
    url:link||`https://www.gdacs.org/report.aspx?eventtype=${encodeURIComponent(type)}&eventid=${encodeURIComponent(id)}`,
    providerId:`${type}:${id}:${episode||'0'}`,observedAt,publishedAt,startsAt,eventType:type,
    ...(country ? {country} : {}),...(severity ? {severity} : {}),...coordinates};
}

export function parseGdacs(xml,{now=Date.now()}={}) {
  try {
    const channel=parseXml(xml).rss?.channel;
    if (!channel || typeof channel!=='object' || Array.isArray(channel)) throw new Error('Invalid GDACS RSS channel');
    const items=list(channel.item),examined=items.slice(0,500);
    const rows=examined.map(item=>disaster(item,now)).filter(Boolean);
    const acknowledgements=[...new Set(examined.flatMap(item=>list(item?.resources?.resource)
      .slice(0,10).map(resource=>text(resource?.acknowledgements,1000)).filter(Boolean)))].slice(0,5);
    const rights=[text(channel.copyright,500)||'GDACS source attribution required',...acknowledgements].join(' ').slice(0,1500);
    const out=freshResult(SOURCE,providerTime(text(channel.pubDate ?? channel.lastBuildDate)),rows,{...META,rights,
      examinedRecords:examined.length,truncatedRecords:Math.max(0,items.length-500)+Math.max(0,rows.length-100)},now);
    return {...out,rejectedObservations:examined.length-out.observations.length,
      summary:out.status==='stale' ? 'GDACS feed time is unknown, in the future, or older than the freshness limit.'
        : `${out.observations.length} current GDACS disaster alerts with verified recent event updates; ${examined.length-out.observations.length} records excluded.`};
  } catch(error) {return unavailableResult(SOURCE,error.message,META,now);}
}

export async function briefing(options={}) {
  const now=options.now ?? Date.now();
  const data=await safeFetch(FEED_URL,{format:'text',maxBytes:2*1024*1024,
    timeout:Math.max(1,Math.min(10000,Number(options.timeout)||10000)),retries:options.retries===1 ? 1 : 0});
  return data.error ? unavailableResult(SOURCE,data.error,META,now) : parseGdacs(data.rawText,{now});
}
