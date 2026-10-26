import { POLICIES, freshResult, providerTime } from '../../apis/utils/freshness.mjs';
import { partitionEventsByView, evaluateEventTerritoryViews, evaluateSourceCoverage, COVERAGE_STATES } from './views.mjs';
import { DEFAULT_TERRITORY_CONFIG } from './territory.mjs';
export const LIVE_KINDS = ['weather','disaster','space-weather','economic','forecast','network','cyber','earthquake','maritime','aviation','sanctions','market','energy'];
const text = (value, cap=300) => typeof value==='string' ? value.slice(0,cap).replace(/[\u0000-\u001f\u007f]/g,' ').trim() : '';
export const HOME = { Meteoalarm:'https://meteoalarm.org/', GDACS:'https://www.gdacs.org/', 'NOAA-SWPC':'https://www.swpc.noaa.gov/', ECB:'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html', 'NASA-EONET':'https://eonet.gsfc.nasa.gov/', RIPEstat:'https://stat.ripe.net/', 'FIRST-EPSS':'https://www.first.org/epss/', 'MET-Norway':'https://api.met.no/', OONI:'https://explorer.ooni.org/', 'IMF-PortWatch':'https://portwatch.imf.org/', EMSC:'https://www.seismicportal.eu/', 'Copernicus-EMS':'https://mapping.emergency.copernicus.eu/', 'Aviation-SIGMET':'https://aviationweather.gov/', 'ADSB-Military':'https://adsb.lol/', 'OpenSanctions-Index':'https://www.opensanctions.org/', 'Federal-Register':'https://www.federalregister.gov/', 'Energy-Charts-HU':'https://energy-charts.info/', 'ENTSOG-HU':'https://transparency.entsog.eu/', 'Prediction-Markets':'https://manifold.markets/' };
export const FACT_FIELDS = { 'FIRST-EPSS':['epss','percentile','predictionWindowDays'], GDACS:['eventType'], 'NASA-EONET':['category'], Meteoalarm:['area'], ECB:['currency','rate','baseCurrency','rateType'], RIPEstat:['resource','observedNeighbours'], 'MET-Norway':['temperature','windSpeed','precipitation','precipitationHours','symbol'], OONI:['countryCode','measurementStatus','targetHost','resource','blockingConfirmed'], 'NOAA-SWPC':[], 'IMF-PortWatch':['transitCalls','mean7d','baseline28d','changePct'], EMSC:['magnitude','depthKm'], 'Copernicus-EMS':['category','countries'], 'Aviation-SIGMET':['hazard','fir'], 'ADSB-Military':['aircraft','types'], 'OpenSanctions-Index':['thingCount','deltaSinceLast'], 'Federal-Register':['docType','agency'], 'Energy-Charts-HU':['pricePerMwh','frequencyHz','renewableSharePct'], 'ENTSOG-HU':['physicalFlow','unit'], 'Prediction-Markets':['probabilityPct','volume','closesAt','platform'] };
function safeUrl(raw) {
  if (typeof raw!=='string' || raw.length>2048 || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  try { const url = new URL(raw);
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || [...url.searchParams.keys()].some(key=>/^(?:access[-_]?token|refresh[-_]?token|api[-_]?key|token|secret|password|authorization|auth|signature)$/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}
function metrics(raw, depth=0, budget={remaining:50}) {
  if (depth>3 || !raw || typeof raw!=='object') return {};
  const out = {};
  for (const [key,value] of Object.entries(raw).slice(0,40)) {
    if (budget.remaining--<=0) break;
    if (['__proto__','constructor','prototype'].includes(key)) continue;
    const name=text(key,80);
    if (typeof value==='string') out[name]=text(value,200);
    else if (typeof value==='number' && Number.isFinite(value) || typeof value==='boolean') out[name]=value;
    else if (value && typeof value==='object' && !Array.isArray(value)) out[name]=metrics(value,depth+1,budget);
  }
  return out;
}
const FACT_UNITS = ['temperature','windSpeed','precipitation'];
function fact(label, value) {
  const name=text(label,40), shown=typeof value==='string' ? text(value,120) : value;
  if (!name || shown==='' || !(typeof shown==='string' || typeof shown==='boolean' || typeof shown==='number' && Number.isFinite(shown))) return null;
  return { label:name, value:shown };
}
// Whitelisted fields only; a row that already carries facts (re-normalization) keeps them, sanitised again.
function factsOf(row, source) {
  const pairs=Array.isArray(row?.facts) ? row.facts.slice(0,40).map(entry=>[entry?.label,entry?.value]) : (FACT_FIELDS[source]||[]).map(key=>{
    const value=row?.[key], unit=source==='MET-Norway' && FACT_UNITS.includes(key) ? row?.units?.[key] : undefined;
    return [key, typeof value==='number' && Number.isFinite(value) && typeof unit==='string' && unit.length<=20 && text(unit,20) ? `${value} ${text(unit,20)}` : value];
  });
  return pairs.map(([label,value])=>fact(label,value)).filter(Boolean).slice(0,8);
}
export function normalizeLiveSources(input, now=Date.now()) {
  const result=[], sources=Object.keys(POLICIES);
  for (const source of sources) {
    const raw=Array.isArray(input) ? input.slice(0,sources.length).find(row=>row?.source===source) : input?.[source];
    if (!raw || typeof raw!=='object') continue;
    const rows=Array.isArray(raw.observations)?raw.observations.slice(0,100).map(row=>{
      const item={source,sourceStatus:'ok',kind:LIVE_KINDS.includes(row?.kind)?row.kind:'signal',url:safeUrl(row?.url),title:text(row?.title),summary:text(row?.summary,2000)};
      for (const key of ['providerId','id','country','region','place','locationMethod','locationPrecision','severity','sourceRegion','area','chainKey','lifecycle','msgType','awarenessLevel','awarenessType','capUrl','webUrl','sender','sent','references']) if (text(row?.[key],500)) item[key]=text(row[key],500);
      if (row?.territory && typeof row.territory === 'object') item.territory = row.territory;
      if (Array.isArray(row?.geocodes)) item.geocodes = row.geocodes.slice(0, 20);
      if (Array.isArray(row?.parsedReferences)) item.parsedReferences = row.parsedReferences.slice(0, 20);
      if (Array.isArray(row?.referencedIds)) item.referencedIds = row.referencedIds.slice(0, 20);
      if (typeof row?.eventId==='string' && /^event-[0-9a-f]{32}$/.test(row.eventId)) item.eventId=row.eventId;
      for (const key of ['observedAt','publishedAt','forecastAt','startsAt','validUntil']) if (row?.[key]!==undefined) item[key]=providerTime(row[key]);
      if (Number.isFinite(row?.lat)&&Math.abs(row.lat)<=90&&Number.isFinite(row?.lon)&&Math.abs(row.lon)<=180) { item.lat=row.lat;item.lon=row.lon; }
      const facts=factsOf(row,source); if (facts.length) item.facts=facts;
      if (raw.timestamp) item.collectedAt=providerTime(raw.timestamp);
      return item;
    }).filter(row=>row.title):[];
    const out=freshResult(source,raw.observedAt,rows,{},now);
    out.timestamp=providerTime(raw.timestamp);
    out.url=HOME[source]; out.attribution=text(raw.attribution,600);out.rights=text(raw.rights,1000);
    out.license=text(raw.license,200);out.licenseUrl=safeUrl(raw.licenseUrl);
    if (raw.status==='error' || raw.error) {out.status='error';out.stale=false;out.observations=[];out.error=text(raw.error||'Source unavailable');}
    else if (raw.status==='stale' || raw.stale) {out.status='stale';out.stale=true;out.observations=[];}
    out.summary=out.status==='ok'?text(raw.summary,2000):'';
    out.metrics=out.status==='ok'?metrics(raw.metrics):{};
    if (source==='MET-Norway' && out.observations.length!==(Array.isArray(raw.observations)?raw.observations.length:0)) { out.summary='';out.metrics={}; }
    result.push(out);
  }
  return result;
}

/**
 * Determines the primary stale reason for an event dropped from active snapshot events.
 * Precedence order:
 * 1. provider_expired: Official issuer validUntil expired relative to now (definitive publisher expiry).
 * 2. source_error: The data source reported an error / unavailable.
 * 3. source_stale: The data source feed timestamp is stale (exceeds maxAgeMs).
 * 4. local_freshness_exceeded: Item age exceeds local policy limit (observationMaxAgeMs).
 */
export function determineStaleReason(event, states, now = Date.now()) {
  const srcName = event?.source?.name || event?.source;
  const srcState = states?.get?.(srcName);

  // Precedence 1: provider_expired
  if (event?.validUntil) {
    const validMs = Date.parse(event.validUntil);
    if (Number.isFinite(validMs) && validMs <= now) {
      return 'provider_expired';
    }
  }

  // Precedence 2: source_error
  if (srcState?.status === 'error' || srcState?.error || event?.sourceStatus === 'error') {
    return 'source_error';
  }

  // Precedence 3: source_stale
  if (srcState?.status === 'stale' || srcState?.stale) {
    return 'source_stale';
  }

  // Precedence 4: local_freshness_exceeded
  if (event?.isFreshnessLimitExceeded || event?.freshnessStatus === 'stale') {
    return 'local_freshness_exceeded';
  }
  const policy = POLICIES[srcName];
  if (policy) {
    const time = Date.parse(event?.observedAt || event?.publishedAt || '');
    if (Number.isFinite(time) && (now - time > (policy.observationMaxAgeMs || policy.maxAgeMs))) {
      return 'local_freshness_exceeded';
    }
  }

  return 'source_stale';
}

// Called on read as well as synthesis: a paused server cannot revive an old feed.
export function freshLiveSnapshot(snapshot, now=Date.now()) {
  if (!snapshot || !Array.isArray(snapshot.liveSources)) return snapshot;
  const liveSources=normalizeLiveSources(snapshot.liveSources,now);
  const states=new Map(liveSources.map(row=>[row.source,row]));
  const territoryConfig = snapshot.territoryConfig || DEFAULT_TERRITORY_CONFIG;
  const hasViews = Boolean(snapshot.views || (Array.isArray(snapshot.events) && snapshot.events.some(e => e?.views)));
  const keptEvents = new Set();
  const rawFiltered = Array.isArray(snapshot.events)
    ? snapshot.events.filter(event => {
        // Explicit fixture protection: test fixtures (Nébih, Debrecen-HAON) stay available without relying on absence from POLICIES
        const isFixture = Boolean(event.isFixture === true);
        if (isFixture) {
          keptEvents.add(event);
          return true;
        }
        const isPolicySource = Boolean(event?.source?.name && Object.hasOwn(POLICIES, event.source.name));
        const keep = !isPolicySource || (states.get(event.source.name)?.status === 'ok' && states.get(event.source.name).observations.some(row => row.title === event.title && row.observedAt === event.observedAt));
        if (keep) keptEvents.add(event);
        return keep;
      })
    : [];
  const rawStale = Array.isArray(snapshot.events)
    ? snapshot.events.filter(event => !keptEvents.has(event))
    : [];

  const mapWithViews = list => list.map(event => {
    const isCancelled = Boolean(event.isCancelled || event.cancelled || event.lifecycle === 'cancelled');
    const lifecycle = event.lifecycle || (isCancelled ? 'cancelled' : event.superseded ? 'superseded' : 'active');
    const views = event.views ? { ...event.views } : evaluateEventTerritoryViews(event, territoryConfig);
    return {
      ...event,
      views,
      lifecycle,
      isCancelled
    };
  });

  const events = hasViews ? mapWithViews(rawFiltered) : rawFiltered;
  const newlyStale = rawStale.map(event => {
    const base = hasViews ? mapWithViews([event])[0] : event;
    return {
      ...base,
      staleReason: event.staleReason || determineStaleReason(event, states, now)
    };
  });

  const existingStale = Array.isArray(snapshot.staleEvents)
    ? snapshot.staleEvents.map(event => {
        const base = hasViews ? mapWithViews([event])[0] : event;
        return {
          ...base,
          staleReason: event.staleReason || determineStaleReason(event, states, now)
        };
      })
    : [];
  const staleSeen = new Set(existingStale.map(e => e.id));
  const staleEvents = [...existingStale];
  for (const item of newlyStale) {
    if (!staleSeen.has(item.id)) {
      staleSeen.add(item.id);
      staleEvents.push(item);
    }
  }

  const views = snapshot.views ? partitionEventsByView(events, territoryConfig) : undefined;
  const isOffline = Boolean(snapshot.meta?.isOfflineSnapshot || snapshot.coverage?.some?.(c => c.isSnapshot));
  const coverage = Array.isArray(snapshot.coverage)
    ? evaluateSourceCoverage(
        snapshot.coverage.map(c => {
          const liveState = states.get(c.sourceId || c.sourceName);
          return {
            id: c.sourceId,
            name: c.sourceName,
            domain: c.domain,
            enabled: c.status !== COVERAGE_STATES.DISABLED && c.status !== 'letiltott' && c.sourceType !== 'disabled',
            status: liveState ? liveState.status : c.status,
            error: liveState?.error || c.error,
            unconfigured: c.status === COVERAGE_STATES.UNCONFIGURED || c.status === 'nincs_forrás' || c.sourceType === 'unconfigured',
            lastUpdated: liveState?.timestamp || c.lastUpdated,
            origin: c.origin || 'snapshot',
            isSnapshot: c.isSnapshot !== false
          };
        }),
        liveSources,
        { now, isOfflineSnapshot: isOffline }
      )
    : undefined;

  return { ...snapshot,liveSources,
    events,
    staleEvents,
    ...(views ? { views } : {}),
    ...(coverage ? { coverage } : {}),
    health:Array.isArray(snapshot.health)?snapshot.health.map(row=>states.has(row.n)?{...row,stale:states.get(row.n).status==='stale',err:states.get(row.n).status==='error',observedAt:states.get(row.n).observedAt,freshness:states.get(row.n).freshness}:row):[],
  };
}
