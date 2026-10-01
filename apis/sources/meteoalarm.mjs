// Maintained country Atom feeds; CAP links are attribution links, never extra fetch targets.
import { safeFetch } from '../utils/fetch.mjs';
import { parseXml } from '../utils/xml.mjs';
import { providerTime, freshness, freshResult, unavailableResult, POLICIES } from '../utils/freshness.mjs';

const SOURCE = 'Meteoalarm';
const BASE = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-';
const COUNTRIES = Object.freeze({
  andorra:'Andorra', austria:'Austria', belgium:'Belgium', 'bosnia-herzegovina':'Bosnia and Herzegovina',
  bulgaria:'Bulgaria', croatia:'Croatia', cyprus:'Cyprus', czechia:'Czech Republic', denmark:'Denmark',
  estonia:'Estonia', finland:'Finland', france:'France', germany:'Germany', greece:'Greece', hungary:'Hungary',
  iceland:'Iceland', ireland:'Ireland', israel:'Israel', italy:'Italy', latvia:'Latvia', lithuania:'Lithuania',
  luxembourg:'Luxembourg', malta:'Malta', moldova:'Moldova', montenegro:'Montenegro', netherlands:'Netherlands',
  norway:'Norway', poland:'Poland', portugal:'Portugal', 'republic-of-north-macedonia':'North Macedonia',
  romania:'Romania', serbia:'Serbia', slovakia:'Slovakia', slovenia:'Slovenia', spain:'Spain', sweden:'Sweden',
  switzerland:'Switzerland', ukraine:'Ukraine', 'united-kingdom':'United Kingdom',
});
const META = { feedUrl:'https://feeds.meteoalarm.org/', attribution:'Meteoalarm / EUMETNET and the issuing national meteorological services',
  licenseUrl:'https://creativecommons.org/licenses/by/4.0/', coverage:'Selected national weather warning feeds; this is not complete European coverage.' };
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
// Prefix removal can merge Atom/CAP names. Reject ambiguous scalar arrays; links are deliberately multiple.
function text(value, limit = 1000) {
  const raw = typeof value === 'string' ? value : !Array.isArray(value) && typeof value?.['#text'] === 'string' ? value['#text'] : null;
  return raw === null ? null : raw.trim().slice(0,limit);
}
function externalUrl(value) {
  if (typeof value !== 'string' || value.length>2000) return null;
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
}
function coordinates(entry) {
  const raw = text(entry.point);
  if (raw === null || raw === '') return {};
  const pair = raw.split(/\s+/);
  if (pair.length!==2 || pair.some(v=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v))) return null;
  const [lat,lon] = pair.map(Number);
  return lat>=-90 && lat<=90 && lon>=-180 && lon<=180
    ? { lat,lon,locationMethod:'provider',locationPrecision:'exact' } : null;
}
function warning(entry, country, now) {
  if (!entry || typeof entry!=='object' || Array.isArray(entry)) return null;
  if (text(entry.status)?.toLowerCase()!=='actual' || text(entry.message_type)?.toLowerCase()==='cancel'
      || (entry.scope!==undefined && text(entry.scope)?.toLowerCase()!=='public')) return null;
  const observedAt = providerTime(text(entry.updated ?? entry.sent));
  const publishedAt = providerTime(text(entry.published ?? entry.sent));
  const validUntil = providerTime(text(entry.expires));
  const startsAt = providerTime(text(entry.onset ?? entry.effective));
  if (!freshness(observedAt,POLICIES[SOURCE].observationMaxAgeMs,now).fresh || !publishedAt
      || Date.parse(publishedAt)>now+300000 || !validUntil || Date.parse(validUntil)<=now
      || ((entry.onset!==undefined || entry.effective!==undefined) && !startsAt)) return null;
  const title = text(entry.title,500);
  const providerId = text(entry.id ?? entry.identifier,1000);
  const point = coordinates(entry);
  if (!title || !providerId || !point) return null;
  const links = list(entry.link);
  // An Atom entry can have region HTML, CAP XML, and related-country links in the same array.
  const html = links.find(link=>link && typeof link==='object' && link['@_type']!=='application/cap+xml'
    && link['@_rel']!=='related' && link['@_rel']!=='self' && externalUrl(link['@_href']));
  const area = text(entry.areaDesc,400);
  const event = text(entry.event,400);
  return { kind:'weather',title,summary:[event,area,startsAt && Date.parse(startsAt)>now ? `Warning valid from ${startsAt}` : null].filter(Boolean).join(' — ') || title,
    source:SOURCE,url:externalUrl(html?.['@_href']) || 'https://meteoalarm.org/',providerId,
    observedAt,publishedAt,validUntil,...(startsAt ? {startsAt} : {}),country:COUNTRIES[country],
    ...(area ? {area} : {}),...(text(entry.severity,100) ? {severity:text(entry.severity,100)} : {}),...point };
}

export function parseMeteoalarm(xml, { country = 'hungary', now = Date.now(), recordLimit = 500 } = {}) {
  const meta = {...META,country:COUNTRIES[country],feedUrl:`${BASE}${country}`};
  try {
    if (!Object.hasOwn(COUNTRIES,country)) throw new Error('Unsupported Meteoalarm country');
    const feed = parseXml(xml).feed;
    if (!feed || typeof feed!=='object' || Array.isArray(feed)) throw new Error('Invalid Meteoalarm Atom feed');
    const entries = list(feed.entry);
    const limit = Math.max(0,Math.min(500,Math.floor(Number(recordLimit)||500)));
    const examined = entries.slice(0,limit);
    const rows = examined.map(entry=>warning(entry,country,now)).filter(Boolean);
    const rights = text(feed.rights,1500) || 'Terms equivalent to CC BY 4.0, with additional redistribution requirements in Meteoalarm Terms and Conditions.';
    const out = freshResult(SOURCE,providerTime(text(feed.updated)),rows,{...meta,rights,examinedRecords:examined.length,
      truncatedRecords:Math.max(0,entries.length-limit)+Math.max(0,rows.length-100)},now);
    return {...out,rejectedObservations:examined.length-out.observations.length,
      summary:out.status==='ok' && !out.observations.length ? examined.length
        ? `No verified recent warnings among ${examined.length} ${COUNTRIES[country]} Meteoalarm records; all records excluded.`
        : `No active warnings in the watched ${COUNTRIES[country]} Meteoalarm feed.`
        : out.status==='stale' ? 'Provider feed time is unknown, in the future, or older than the freshness limit.'
        : `${out.observations.length} recent weather warnings in ${COUNTRIES[country]}.`};
  } catch (error) { return unavailableResult(SOURCE,error.message,meta,now); }
}

export async function briefing(options = {}) {
  const now = options.now ?? Date.now();
  const countries = options.countries ?? ['hungary','austria'];
  if (!Array.isArray(countries) || !countries.length || countries.length>4
      || countries.some(country=>typeof country!=='string' || !Object.hasOwn(COUNTRIES,country))) {
    return unavailableResult(SOURCE,'Expected 1–4 official Meteoalarm country slugs',META,now);
  }
  const selected = [...new Set(countries)];
  const results = await Promise.all(selected.map(async country=>{
    const data = await safeFetch(`${BASE}${country}`,{format:'text',maxBytes:2*1024*1024,
      timeout:Math.max(1,Math.min(10000,Number(options.timeout)||10000)),retries:options.retries===1 ? 1 : 0});
    return data.error ? unavailableResult(SOURCE,data.error,{...META,country:COUNTRIES[country],feedUrl:`${BASE}${country}`},now)
      : parseMeteoalarm(data.rawText,{country,now,recordLimit:Math.floor(500/selected.length)});
  }));
  const countryFeeds = results.map(result=>({country:result.country,feedUrl:result.feedUrl,status:result.status,
    observedAt:result.observedAt,warnings:result.observations.length,...(result.error ? {error:result.error} : {})}));
  const fresh = results.filter(result=>result.status==='ok');
  const meta = {...META,countries:selected.map(country=>COUNTRIES[country]),countryFeeds,
    partial:results.some(result=>result.status!=='ok'),rights:[...new Set(results.map(result=>result.rights).filter(Boolean))].join(' ')};
  if (!fresh.length && results.some(result=>result.status==='error')) return unavailableResult(SOURCE,
    results.filter(result=>result.error).map(result=>`${result.country}: ${result.error}`).join('; '),meta,now);
  const observedAt = (fresh.length ? fresh : results).map(result=>result.observedAt).filter(Boolean).sort()[0] || null;
  const out = freshResult(SOURCE,observedAt,fresh.flatMap(result=>result.observations),meta,now);
  const examinedRecords = results.reduce((n,result)=>n+(result.examinedRecords||0),0);
  return {...out,examinedRecords,
    rejectedObservations:results.reduce((n,result)=>n+(result.rejectedObservations||0),0)+Math.max(0,fresh.reduce((n,result)=>n+result.observations.length,0)-out.observations.length),
    summary:!fresh.length ? 'Watched national feeds have no verified fresh provider timestamp.'
      : !out.observations.length ? examinedRecords
        ? `No verified recent warnings among ${examinedRecords} watched Meteoalarm records; all records excluded.${meta.partial ? ' Coverage is partial.' : ''}`
        : `No active warnings in the watched Meteoalarm feeds: ${fresh.map(result=>result.country).join(', ')}.${meta.partial ? ' Some watched feeds are unavailable or stale.' : ''}`
      : `${out.observations.length} recent weather warnings across watched national feeds.${meta.partial ? ' Coverage is partial.' : ''}`};
}
