// ECB daily EUR reference rates: informational publication, never an executable quote.
import { safeFetch } from '../utils/fetch.mjs';
import { parseXml } from '../utils/xml.mjs';
import { providerTime, freshResult, unavailableResult } from '../utils/freshness.mjs';

const SOURCE = 'ECB';
const FEED_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const SOURCE_URL = 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html';
const CURRENCIES = new Set('USD JPY CZK DKK GBP HUF PLN RON SEK CHF ISK NOK TRY AUD BRL CAD CNY HKD IDR ILS INR KRW MXN MYR NZD PHP SGD THB ZAR'.split(' '));
const DEFAULTS = ['HUF','USD','GBP','CHF'];
const USAGE = 'Daily euro reference rates for information only; using them for transaction purposes is strongly discouraged by the ECB. Not a trading or executable exchange quote.';
const META = { url:SOURCE_URL, feedUrl:FEED_URL, attribution:'European Central Bank', baseCurrency:'EUR', rateType:'daily-reference', datePrecision:'day', usageNote:USAGE };

function currencyChoices(currencies = DEFAULTS) {
  if (!Array.isArray(currencies) || currencies.length < 1 || currencies.length > 32
      || currencies.some(value=>typeof value !== 'string' || !/^[A-Z]{3}$/.test(value) || !CURRENCIES.has(value))) {
    throw new Error('Invalid currency selection: choose 1 to 32 supported three-letter currency codes');
  }
  return [...new Set(currencies)];
}

export function parseECB(xml, { now = Date.now(), currencies } = {}) {
  let selected, dated;
  try {
    selected = currencyChoices(currencies);
    dated = parseXml(xml)?.Envelope?.Cube?.Cube;
    if (Array.isArray(dated)) dated = dated.length === 1 ? dated[0] : null;
    if (!dated || typeof dated !== 'object' || !Array.isArray(dated.Cube) && typeof dated.Cube !== 'object') throw new Error('Invalid ECB daily rate response');
  } catch (error) { return unavailableResult(SOURCE, error.message, {...META,rates:{}}, now); }
  const providerDate = typeof dated['@_time'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dated['@_time']) ? dated['@_time'] : null;
  const observedAt = providerTime(providerDate);
  const rows = Array.isArray(dated.Cube) ? dated.Cube.slice(0,100) : [dated.Cube];
  const valid = new Map();
  let rejectedRates = 0;
  for (const row of rows) {
    const currency = row?.['@_currency'];
    if (!selected.includes(currency)) continue;
    const raw = row?.['@_rate'];
    const rate = typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(rate) || rate <= 0 || valid.has(currency)) { rejectedRates++; continue; }
    valid.set(currency,rate);
  }
  const observations = selected.filter(currency=>valid.has(currency)).map(currency=>({
    kind:'economic', title:`EUR/${currency} reference rate`,
    summary:`1 EUR = ${valid.get(currency)} ${currency}; ECB daily reference rate dated ${providerDate ?? 'unknown'}. Publication date precision: day. Information only; unsuitable as an executable transaction quote.`,
    source:SOURCE, url:SOURCE_URL, providerId:`EUR/${currency}:${providerDate}`, observedAt, publishedAt:observedAt,
    currency, rate:valid.get(currency), baseCurrency:'EUR', rateType:'daily-reference', datePrecision:'day', severity:'monitor',
    lat:null, lon:null, locationMethod:'unknown', locationPrecision:'unknown',
  }));
  const rates = Object.fromEntries(observations.map(row=>[row.currency,row.rate]));
  const summary = `ECB daily EUR reference rates, provider date ${providerDate ?? 'unknown'} (day precision): ${observations.map(row=>`EUR/${row.currency} ${row.rate}`).join('; ') || 'no valid selected quotes'}. Information only; the provider date is retained across weekends and holidays.`;
  const out = freshResult(SOURCE, observedAt, observations, {...META,providerDate,rates,metrics:rates,summary,rejectedRates}, now);
  if (out.stale) { out.rates = {}; out.metrics = {}; out.summary = 'ECB daily reference rates are outside the 120-hour publication-date freshness window or lack a valid provider date.'; }
  else if (!observations.length) return unavailableResult(SOURCE,'ECB feed contains no valid selected reference rates',{...META,providerDate,rates:{},metrics:{},rejectedRates},now);
  return out;
}

export async function briefing({ now = Date.now(), currencies } = {}) {
  try { currencyChoices(currencies); } catch (error) { return unavailableResult(SOURCE,error.message,{...META,rates:{}},now); }
  const data = await safeFetch(FEED_URL, {timeout:10000,retries:0,maxBytes:2*1024*1024,format:'text'});
  return data?.error ? unavailableResult(SOURCE,data.error,{...META,rates:{}},now) : parseECB(data.rawText,{now,currencies});
}
