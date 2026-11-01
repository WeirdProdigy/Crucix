// Unified Hajdú-Bihar settlement gazetteer and mention detector
import {
  DEFAULT_TERRITORY_CONFIG,
  BIHARTORDA_PROFILE,
  ADMINISTRATIVE_LEVELS,
  LOCAL_RELEVANCE_REASONS
} from '../../lib/intelligence/territory.mjs';

/**
 * Common Hungarian words, adjectives or personal names that coincide with Hajdú-Bihar settlement names.
 * These require strict capitalized matching and locative/geographic disambiguation.
 */
export const AMBIGUOUS_SETTLEMENT_NAMES = new Set([
  'folyas', // common noun: stream / flow (folyás)
  'furta',  // verb: drilled / strange (fúrta)
  'tepe',   // verb: tear / shred (tép, tépte)
  'fulop',  // given name / forename (Fülöp)
  'told',   // verb: lengthen / splice (told, toldoz-foldoz)
  'sap',    // noun: toll / cut (sáp, sápot húz)
  'bojt',   // noun: tassel / pompom (bojt)
  'darvas', // adjective: crane-related (darvas)
  'ebes',   // adjective / slang
  'szerep', // common noun: role / part (szerep, szerepet játszik)
  'kaba',   // adjective: dazed / groggy (kába, kába viselkedés)
  'polgar'  // common noun: citizen (polgár), surname (Polgár Péter)
]);

/**
 * Hajdú-Bihar vármegye településlistája (82 település) a Wikipédia kategórianévjegyzék
 * ("Kategória:Hajdú-Bihar megye települései") alapján összeállítva és egyeztetve.
 */
export const HAJDU_BIHAR_KSH_SETTLEMENTS = Object.freeze([
  { id: 'almosd', name: 'Álmosd' },
  { id: 'artand', name: 'Ártánd' },
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
  { id: 'folyas', name: 'Folyás', ambiguous: true },
  { id: 'foldes', name: 'Földes' },
  { id: 'fulop', name: 'Fülöp', ambiguous: true },
  { id: 'furta', name: 'Furta', ambiguous: true },
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
  { id: 'kaba', name: 'Kaba', ambiguous: true },
  { id: 'kismarja', name: 'Kismarja' },
  { id: 'kokad', name: 'Kokad' },
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
  { id: 'polgar', name: 'Polgár', ambiguous: true },
  { id: 'puspokladany', name: 'Püspökladány' },
  { id: 'sap', name: 'Sáp', ambiguous: true },
  { id: 'sarand', name: 'Sáránd' },
  { id: 'sarretudvari', name: 'Sárrétudvari' },
  { id: 'szentpeterszeg', name: 'Szentpéterszeg' },
  { id: 'szerep', name: 'Szerep', ambiguous: true },
  { id: 'teglas', name: 'Téglás' },
  { id: 'tepe', name: 'Tépe', ambiguous: true },
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

const LOCATIVE_SUFFIXES = '(?:n|on|en|ön|ban|ben|ra|re|ról|ről|rol|rel|hoz|hez|höz|ig|i|ból|ből|bol|bel|nál|nél|nal|nel)';
const NON_LOCATIVE_SUFFIXES = '(?:nek|val|vel|et|ot|öt|t)';

/**
 * Builds Hungarian case inflection regex pattern for an unambiguous settlement name.
 * Uses strict Unicode-aware boundary matching to prevent matching inside compound words (e.g. állampolgár).
 * Accounts for Hungarian stem-final vowel lengthening (a -> á, e -> é) and vowel-final locative suffix (-n).
 */
function buildInflectionRegex(name) {
  const allSuffixes = '(?:n|on|en|ön|ban|ben|ra|re|ról|ről|rol|rel|hoz|hez|höz|ig|i|ból|ből|bol|bel|nál|nél|nal|nel|nek|val|vel|et|ot|öt|t)?';
  if (name.endsWith('a') || name.endsWith('e')) {
    const stem = name.slice(0, -1);
    const lastChar = name.slice(-1);
    const lengthened = lastChar === 'a' ? '[aá]' : '[eé]';
    return new RegExp(`(?<![\\p{L}\\p{N}])${stem}${lengthened}${allSuffixes}(?![\\p{L}\\p{N}])`, 'ui');
  }
  return new RegExp(`(?<![\\p{L}\\p{N}])${name}${allSuffixes}(?![\\p{L}\\p{N}])`, 'ui');
}

/**
 * Foreign locations, international bodies, and world affairs keywords.
 */
export const FOREIGN_LOCATIONS_REGEX = /(?<![\p{L}\p{N}])(?:külföld|világ|nemzetközi|genf|békecsúcs|egyesült államok|kína|oroszország|ukrajna|közel-kelet|nato|brüsszel|brüsszeli|eu|európai unió|fehér ház|kreml|washington|varsó|kijev|moszkva|london|párizs|berlin|róma|teherán|tel-aviv|gáza|irán|izrael|tajvan|trump|putyin|zelenszkij|biden)(?:[a-záéíóöőúüű]+)?(?![\\p{L}\\p{N}])/ui;

/**
 * Major non-Hajdú-Bihar Hungarian cities and other counties.
 */
export const OTHER_HUNGARIAN_REGIONS_REGEX = /(?<![\p{L}\p{N}])(?:budapest|szeged|miskolc|pécs|győr|székesfehérvár|kecskemét|nyíregyháza|szolnok|tatabánya|kaposvár|békéscsaba|veszprém|zalaegerszeg|eger|salgótarján|szombathely|szekszárd|borsod|szabolcs|békés|csongrád|bács-kiskun|pest megye|pest vármegye|fejér|komárom|győr-moson|vas megye|vas vármegye|veszprém megye|veszprém vármegye|zala megye|zala vármegye|somogy|tolna|baranya|heves|nógrád|jász-nagykun)(?:[a-záéíóöőúüű]+)?(?![\\p{L}\\p{N}])/ui;

/**
 * Checks whether the text has explicit county context (e.g. Hajdú-Bihar, Hajdú, Bihar, Debrecen).
 */
export function hasCountyContext(text) {
  if (typeof text !== 'string') return false;
  return /(?<![\p{L}\p{N}])(?:hajd[uú]-bihar|hajd[uú]|bihar|debrecen)(?![\p{L}\p{N}])/ui.test(text);
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

  const explicitCountyPresent = hasCountyContext(rawTitle);
  const isForeign = FOREIGN_LOCATIONS_REGEX.test(rawTitle) || /kulfold|nagyvilag|vilag|global/i.test(options.section || '');
  const isOtherRegion = OTHER_HUNGARIAN_REGIONS_REGEX.test(rawTitle);
  const hasCountyContradiction = isForeign || isOtherRegion;

  // 1. Process ambiguous settlement names with strict disambiguation rules
  for (const amb of AMBIGUOUS_SETTLEMENT_NAMES) {
    const ambRegex = new RegExp(`(?<![\\p{L}\\p{N}])${amb}(?:[a-z]+)?(?![\\p{L}\\p{N}])`, 'ui');
    if (ambRegex.test(normTitle)) {
      const ambSettlement = HAJDU_BIHAR_KSH_SETTLEMENTS.find(s => s.id === amb);
      const ambName = ambSettlement?.name || amb;

      // Negative rules:
      // a) Hyphenated compounds (e.g. Fülöp-szigetek, Fülöp-szigeteki)
      if (new RegExp(`(?<![\\p{L}\\p{N}])${ambName}-[a-záéíóöőúüű]+`, 'ui').test(rawTitle)) {
        continue;
      }

      // b) Forename / title pairing (e.g. Fülöp herceg, Fülöp Márk, Fülöp király)
      if (new RegExp(`(?<![\\p{L}\\p{N}])${ambName}\\s+(?:herceg|márk|gróf|báró|király|vezér|elnök|igazgató|úr|asszony|doktor|dr\\.?|[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+)(?![\\p{L}\\p{N}])`, 'u').test(rawTitle)) {
        continue;
      }

      // Stem pattern with stem-final vowel lengthening (e.g. Kaba -> Kab[aá], Furta -> Furt[aá], Tépe -> Tép[eé])
      let stemPattern;
      if (ambName.endsWith('a') || ambName.endsWith('e')) {
        const stem = ambName.slice(0, -1);
        const lastChar = ambName.slice(-1);
        const lengthened = lastChar === 'a' ? '[aá]' : '[eé]';
        stemPattern = `${ambName[0].toUpperCase()}${stem.slice(1)}${lengthened}`;
      } else {
        stemPattern = `${ambName[0].toUpperCase()}${ambName.slice(1)}`;
      }

      // c) Bare lowercase occurrence (e.g. "szerepet játszik", "sápot húz", "kaba viselkedés")
      const capitalizedRegex = new RegExp(`(?<![\\p{L}\\p{N}])${stemPattern}`, 'u');
      if (!capitalizedRegex.test(rawTitle)) {
        continue;
      }

      // Positive acceptance conditions:
      // 1) Locative / adverbial inflection (e.g. Fülöpön, Szerepen, Ebesen, Toldon, Sápon, Bojton, Darvason, Kabán, Polgáron)
      const locativeRegex = new RegExp(`(?<![\\p{L}\\p{N}])${stemPattern}${LOCATIVE_SUFFIXES}(?![\\p{L}\\p{N}])`, 'u');
      const hasLocative = locativeRegex.test(rawTitle);

      // 2) Geographic noun context ("<név> település/község/falu/város")
      const geoContextRegex = new RegExp(`(?:(?<![\\p{L}\\p{N}])${ambName}\\s+(?:település|község|falu|város)(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?:település|község|falu|város)\\s+${ambName}(?![\\p{L}\\p{N}]))`, 'ui');
      const hasGeoContext = geoContextRegex.test(rawTitle);

      // 3) Explicit county context present alongside the capitalized name
      const hasExplicitCounty = explicitCountyPresent;

      if (hasLocative || hasGeoContext || hasExplicitCounty) {
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
          isConfirmedLocal: false // STRICT RULE: never confirmed local!
        };
      }

      // If capitalized but lacks locative suffix, geographic noun, or county context (e.g. "Baleset történt Sáp közelében")
      return {
        territoryLevel: 'unknown',
        settlementId: null,
        settlementName: null,
        countyCode: (options.implicitCountyContext === false || hasCountyContradiction) ? null : countyCode,
        countyName: (options.implicitCountyContext === false || hasCountyContradiction) ? null : countyName,
        nuts3: (options.implicitCountyContext === false || hasCountyContradiction) ? null : nuts3,
        nuts2: (options.implicitCountyContext === false || hasCountyContradiction) ? null : nuts2,
        nuts0,
        iso3,
        matchState: 'ambiguous',
        localRelevanceReason: 'ambiguous_text_mention',
        needsLocalReview: true,
        isConfirmedLocal: false
      };
    }
  }

  // 2. Process unambiguous settlements
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
    const infRegex = buildInflectionRegex(candName);

    // Strictly test word boundaries - never match inside compound words (e.g. állampolgár)
    if (infRegex.test(rawTitle)) {
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
        isConfirmedLocal: false // STRICT REQUIREMENT: never confirmed local!
      };
    }
  }

  // If explicitly non-local (implicitCountyContext === false) OR there is an explicit contradiction:
  if (options.implicitCountyContext === false || hasCountyContradiction) {
    if (isForeign) {
      return {
        territoryLevel: 'country',
        countyCode: null,
        countyName: null,
        nuts3: null,
        nuts2: null,
        nuts0: null,
        iso3: null,
        matchState: 'no_match',
        localRelevanceReason: null,
        needsLocalReview: false,
        isConfirmedLocal: false
      };
    }
    return {
      territoryLevel: ADMINISTRATIVE_LEVELS.COUNTRY,
      countyCode: null,
      countyName: null,
      nuts3: null,
      nuts2: null,
      nuts0,
      iso3,
      matchState: 'no_match',
      localRelevanceReason: null,
      needsLocalReview: false,
      isConfirmedLocal: false
    };
  }

  // Default to county level (local feeds or uncontradicted county context)
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
