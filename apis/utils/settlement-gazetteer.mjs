// Unified Hajdú-Bihar settlement gazetteer and mention detector
import {
  DEFAULT_TERRITORY_CONFIG,
  BIHARTORDA_PROFILE,
  ADMINISTRATIVE_LEVELS,
  LOCAL_RELEVANCE_REASONS
} from '../../lib/intelligence/territory.mjs';

/**
 * Common Hungarian words or forenames that coincide with Hajdú-Bihar settlement names.
 * These require strict capitalized matching and county context disambiguation.
 * Removed artificial / non-settlement tokens (e.g. 'ketertelmu', 'keterdelmu').
 */
export const AMBIGUOUS_SETTLEMENT_NAMES = new Set([
  'szerep', // common noun: role / part (szerep, szerepet játszik)
  'fulop',  // given name / forename (Fülöp)
  'ebes',   // adjective / slang
  'told',   // verb: lengthen / splice (told, toldoz-foldoz)
  'sap',    // noun: toll / cut (sáp, sápot húz)
  'bojt',   // noun: tassel / pompom (bojt)
  'darvas'  // adjective: crane-related (darvas)
]);

/**
 * Complete official KSH gazetteer of Hajdú-Bihar vármegye settlements (82 settlements).
 */
export const HAJDU_BIHAR_KSH_SETTLEMENTS = Object.freeze([
  { id: 'almosd', name: 'Álmosd' },
  { id: 'bagamer', name: 'Bagamér' },
  { id: 'bakonszeg', name: 'Bakonszeg' },
  { id: 'balmazujvaros', name: 'Balmazújváros' },
  { id: 'barand', name: 'Báránd' },
  { id: 'bedo', name: 'Bedő' },
  { id: 'berekboszormeny', name: 'Berekböszörmény' },
  { id: 'berettyoujfalu', name: 'Berettyóújfalu' },
  { id: 'bihardancshaza', name: 'Bihardancsháza' },
  { id: 'biharkeresztes', name: 'Biharkeresztes' },
  { id: 'biharnagybajom', name: 'Biharnagybajom' },
  { id: 'bihartorda', name: 'Bihartorda' },
  { id: 'bocskaikert', name: 'Bocskaikert' },
  { id: 'bojt', name: 'Bojt', ambiguous: true },
  { id: 'csokmo', name: 'Csökmő' },
  { id: 'darvas', name: 'Darvas', ambiguous: true },
  { id: 'debrecen', name: 'Debrecen' },
  { id: 'derecske', name: 'Derecske' },
  { id: 'ebes', name: 'Ebes', ambiguous: true },
  { id: 'egyek', name: 'Egyek' },
  { id: 'esztar', name: 'Esztár' },
  { id: 'folyas', name: 'Folyás' },
  { id: 'foldes', name: 'Földes' },
  { id: 'fulop', name: 'Fülöp', ambiguous: true },
  { id: 'gaborjan', name: 'Gáborján' },
  { id: 'gorbehaza', name: 'Görbeháza' },
  { id: 'hajdubagos', name: 'Hajdúbagos' },
  { id: 'hajduboszormeny', name: 'Hajdúböszörmény' },
  { id: 'hajdudorog', name: 'Hajdúdorog' },
  { id: 'hajduhadhaz', name: 'Hajdúhadház' },
  { id: 'hajdunanás', name: 'Hajdúnánás' },
  { id: 'hajdusamson', name: 'Hajdúsámson' },
  { id: 'hajduszoboszlo', name: 'Hajdúszoboszló' },
  { id: 'hajduszovat', name: 'Hajdúszovát' },
  { id: 'hencida', name: 'Hencida' },
  { id: 'hortobagy', name: 'Hortobágy' },
  { id: 'hosszupalyi', name: 'Hosszúpályi' },
  { id: 'kaba', name: 'Kaba' },
  { id: 'kismarja', name: 'Kismarja' },
  { id: 'komadi', name: 'Komádi' },
  { id: 'konyar', name: 'Konyár' },
  { id: 'korosszakal', name: 'Körösszakál' },
  { id: 'korosszegapati', name: 'Körösszegapáti' },
  { id: 'letavertes', name: 'Létavértes' },
  { id: 'magyarhomorog', name: 'Magyarhomorog' },
  { id: 'mezopeterd', name: 'Mezőpeterd' },
  { id: 'mezosas', name: 'Mezősas' },
  { id: 'mikepercs', name: 'Mikepércs' },
  { id: 'monostorpalyi', name: 'Monostorpályi' },
  { id: 'nadudvar', name: 'Nádudvar' },
  { id: 'nagyhegyes', name: 'Nagyhegyes' },
  { id: 'nagykereki', name: 'Nagykereki' },
  { id: 'nagyrabe', name: 'Nagyrábé' },
  { id: 'nyiracsad', name: 'Nyíracsád' },
  { id: 'nyiradony', name: 'Nyíradony' },
  { id: 'nyirabrany', name: 'Nyírábrány' },
  { id: 'nyirmartonfalva', name: 'Nyírmártonfalva' },
  { id: 'pocsaj', name: 'Pocsaj' },
  { id: 'polgar', name: 'Polgár' },
  { id: 'puspokladany', name: 'Püspökladány' },
  { id: 'sap', name: 'Sáp', ambiguous: true },
  { id: 'sarand', name: 'Sáránd' },
  { id: 'sarretudvari', name: 'Sárrétudvari' },
  { id: 'szentpeterszeg', name: 'Szentpéterszeg' },
  { id: 'szerep', name: 'Szerep', ambiguous: true },
  { id: 'teglas', name: 'Téglás' },
  { id: 'tepe', name: 'Tépe' },
  { id: 'tetetlen', name: 'Tetétlen' },
  { id: 'tiszacsege', name: 'Tiszacsege' },
  { id: 'tiszagyulahaza', name: 'Tiszagyulaháza' },
  { id: 'told', name: 'Told', ambiguous: true },
  { id: 'ujiraz', name: 'Újiráz' },
  { id: 'ujleta', name: 'Újléta' },
  { id: 'ujszentmargita', name: 'Újszentmargita' },
  { id: 'ujtikos', name: 'Újtikos' },
  { id: 'vamospercs', name: 'Vámospércs' },
  { id: 'vancsad', name: 'Váncsod' },
  { id: 'vekerd', name: 'Vekerd' },
  { id: 'zsaka', name: 'Zsáka' }
]);

/**
 * Builds Hungarian case inflection regex pattern for a settlement name.
 */
function buildInflectionRegex(name, isAmbiguous = false) {
  // Inflection suffixes for Hungarian settlement names
  // e.g., -on/-en/-ön/-ban/-ben/-ra/-re/-ról/-ről/-hoz/-hez/-höz/-ig/-i/-ból/-ből/-nál/-nél/-nek/-val/-vel
  const suffixes = '(?:on|en|ön|ban|ben|ra|re|ról|ről|rol|rel|hoz|hez|höz|ig|i|ból|ből|bol|bel|nál|nél|nal|nel|nek|val|vel)?';
  if (isAmbiguous) {
    // Strict uppercase first letter required for ambiguous words
    const firstLetter = name[0].toUpperCase();
    const rest = name.slice(1);
    return new RegExp(`\\b${firstLetter}${rest}${suffixes}\\b`, 'u');
  }
  return new RegExp(`\\b${name}${suffixes}\\b`, 'ui');
}

/**
 * Checks whether the text has explicit county context (e.g. Hajdú-Bihar, Hajdú, Bihar, Debrecen).
 */
export function hasCountyContext(text) {
  if (typeof text !== 'string') return false;
  return /\b(?:hajd[uú]-bihar|hajd[uú]|bihar|debrecen)\b/i.test(text);
}

/**
 * Detects whether a known settlement in Hajdú-Bihar is mentioned in the news title/text.
 * CRITICAL RULE: A settlement match in news text is ALWAYS classified as
 * text_mention (needsLocalReview: true, isConfirmedLocal: false).
 * It must NEVER be marked as confirmedLocal.
 * Ambiguous names yield territoryLevel: 'unknown', matchState: 'ambiguous'.
 */
export function detectSettlementMention(title, territoryConfig = DEFAULT_TERRITORY_CONFIG, options = {}) {
  const rawTitle = typeof title === 'string' ? title : '';
  const normTitle = rawTitle
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

  const primary = territoryConfig?.primary || BIHARTORDA_PROFILE;
  const countyCode = primary.countyCode || '09';
  const countyName = primary.countyName || 'Hajdú-Bihar';
  const nuts3 = primary.nuts3 || primary.nuts?.nuts3 || 'HU321';
  const nuts2 = primary.nuts2 || primary.nuts?.nuts2 || 'HU32';
  const nuts0 = primary.nuts0 || primary.nuts?.nuts0 || 'HU';
  const iso3 = primary.iso3 || 'HUN';

  const implicitCounty = options.implicitCountyContext === true;
  const explicitCountyPresent = hasCountyContext(rawTitle);

  // Check for ambiguous settlement names
  for (const amb of AMBIGUOUS_SETTLEMENT_NAMES) {
    const ambRegex = new RegExp(`\\b${amb}\\b`, 'i');
    if (ambRegex.test(normTitle)) {
      // Check if it was capitalized in rawTitle
      const ambSettlement = HAJDU_BIHAR_KSH_SETTLEMENTS.find(s => s.id === amb);
      const isCapitalized = ambSettlement ? buildInflectionRegex(ambSettlement.name, true).test(rawTitle) : false;
      
      // If it wasn't even capitalized, it's just a lowercase common word (e.g. "szerepet játszik") -> ignore, continue checking other settlements
      if (!isCapitalized) {
        continue;
      }

      // If capitalized, check if explicit county context is provided
      if (explicitCountyPresent && implicitCounty) {
        // Confirmed settlement match with county context
        return {
          territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
          settlementId: ambSettlement.id,
          settlementName: ambSettlement.name,
          kshSettlementCode: ambSettlement.kshSettlement || null,
          countyCode,
          countyName,
          nuts3,
          nuts2,
          nuts0,
          iso3,
          matchState: 'match',
          localRelevanceReason: LOCAL_RELEVANCE_REASONS.TEXT_MENTION,
          needsLocalReview: true,
          isConfirmedLocal: false
        };
      }

      // Without explicit disambiguation, return ambiguous
      return {
        territoryLevel: 'unknown',
        settlementId: null,
        settlementName: null,
        countyCode,
        countyName,
        nuts3,
        nuts2,
        nuts0,
        iso3,
        matchState: 'ambiguous',
        localRelevanceReason: 'ambiguous_text_mention',
        needsLocalReview: true,
        isConfirmedLocal: false
      };
    }
  }

  const candidateMap = new Map();

  if (primary) {
    candidateMap.set(primary.id || 'bihartorda', { ...primary, id: primary.id || 'bihartorda' });
  }
  for (const w of territoryConfig?.watchedSettlements || []) {
    if (w?.id) candidateMap.set(w.id, w);
  }
  for (const k of territoryConfig?.keyCities || territoryConfig?.keyConnections || []) {
    if (k?.id) candidateMap.set(k.id, k);
  }
  for (const s of HAJDU_BIHAR_KSH_SETTLEMENTS) {
    if (!candidateMap.has(s.id)) {
      candidateMap.set(s.id, s);
    }
  }

  // Sort candidates by name length descending to match compound/longer names first
  const sortedCandidates = Array.from(candidateMap.values())
    .sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

  for (const cand of sortedCandidates) {
    if (AMBIGUOUS_SETTLEMENT_NAMES.has(cand.id)) continue; // Handled above

    const candName = cand.name || '';
    const normName = candName
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();

    // Check with inflected word boundary regex
    const infRegex = buildInflectionRegex(candName, false);
    if (normName.length >= 3 && (infRegex.test(rawTitle) || (normName.length >= 5 && normTitle.includes(normName)))) {
      return {
        territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
        settlementId: cand.id,
        settlementName: cand.name,
        kshSettlementCode: cand.kshSettlement || null,
        countyCode,
        countyName,
        nuts3,
        nuts2,
        nuts0,
        iso3,
        matchState: 'match',
        localRelevanceReason: LOCAL_RELEVANCE_REASONS.TEXT_MENTION,
        needsLocalReview: true,
        isConfirmedLocal: false
      };
    }
  }

  // Default to county level Hajdú-Bihar
  return {
    territoryLevel: ADMINISTRATIVE_LEVELS.COUNTY,
    countyCode,
    countyName,
    nuts3,
    nuts2,
    nuts0,
    iso3,
    matchState: 'match',
    localRelevanceReason: LOCAL_RELEVANCE_REASONS.COUNTY_EVENT,
    needsLocalReview: false,
    isConfirmedLocal: false
  };
}
