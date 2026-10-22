/**
 * Bihartorda-centered territorial hierarchy, namespaces, and warning matcher.
 *
 * ============================================================================
 * HIVATALOS ADATCSOPORTOK, FORRÁSOK ÉS NÉVTEREK
 * ============================================================================
 * 1. KSH Területi Számjelrendszer (TSZJ)
 *    - Forrás: KSH Területi számjelrendszer struktúra elemei 2025 megnevezésekkel (XLSX)
 *      URL: https://www.ksh.hu/docs/osztalyozasok/teruleti_szamjel/teruleti_szamjelrendszer_struktura_elemei_2025_megnevezesekkel.xlsx
 *    - Verzió / Dátum: 2025. évi hivatalos KSH besorolás
 *    - Névterek:
 *      * Település-azonosító törzsszám / Településkód (5 jegyű string, vezető nullákkal):
 *        - Bihartorda: "29887"
 *        - Püspökladány: "10162"
 *        - Hajdúszoboszló: "05175"
 *        - Debrecen: "15130"
 *      * KSH Járáskód (3 jegyű string, vezető nullákkal, NEM LAU1):
 *        - Püspökladányi járás: "102"
 *        - Hajdúszoboszlói járás: "100"
 *        - Debreceni járás: "095"
 *      * KSH Vármegyekód: "09" (Hajdú-Bihar vármegye)
 *      * KSH Tervezési-statisztikai régiókód: "60" (Észak-Alföld)
 *    - Ellenőrzési mód: Hivatalos KSH XLSX közvetlen feldolgozása és összevetése.
 *
 * 2. Eurostat NUTS Statisztikai Régiók
 *    - Forrás: Eurostat NUTS 2021 classification for Hungary (HU)
 *    - Verzió / Dátum: NUTS 2021 (érvényes: 2021-01-01-től)
 *    - Névterek:
 *      * NUTS0: HU (Magyarország)
 *      * NUTS1: HU3 (Alföld és Észak)
 *      * NUTS2: HU32 (Észak-Alföld nagyrégió)
 *      * NUTS3: HU321 (Hajdú-Bihar vármegye)
 *    - Ellenőrzési mód: Eurostat RAMON metaadatbázis és Meteoalarm CAP NUTS2/NUTS3 geokódok.
 *
 * 3. Településközponti Koordináták
 *    - Forrás: OpenStreetMap / Nominatim geocoding (WGS84 EPSG:4326)
 *    - Verzió / Dátum: 2026. évi állapot
 *    - Adatgazda: OpenStreetMap közösség (Kifejezetten NEM a KSH, mert a TSZJ nem tartalmaz koordinátákat!)
 *    - Bihartorda községháza: lat 47.1658, lon 21.3650
 *
 * 4. Szolgáltatói Geokódok (EMMA_ID)
 *    - Forrás: Meteoalarm korábbi awareness azonosító rendszer (EUMETNET)
 *    - Megbízhatósági besorolás: Nem igazolt 1:1 nyilvános keresztkódolás.
 *      Mivel az EMMA_ID:HU006 -> Észak-Alföld megfeleltetésre nincs független, garantált
 *      szolgáltatói specifikáció a hatályos CAP feedekben, önmagában NEM képez megerősített
 *      helyi találatot (unknown / felülvizsgálandó státuszba kerül).
 * ============================================================================
 */

export const TERRITORY_NAMESPACES = Object.freeze({
  KSH_SETTLEMENT: 'ksh_settlement_id', // KSH Településkód (string, pl. '29887', '05175')
  KSH_DISTRICT: 'ksh_district_id',     // KSH járáskód (string, pl. '102', '100', '095' - NEM LAU1!)
  KSH_COUNTY: 'ksh_county_id',         // KSH vármegyekód ('09')
  NUTS3: 'NUTS3',                      // Vármegye (Hajdú-Bihar: HU321)
  NUTS2: 'NUTS2',                      // Tervezési-statisztikai régió (Észak-Alföld: HU32)
  NUTS1: 'NUTS1',                      // Statisztikai nagyrégió (Alföld és Észak: HU3)
  NUTS0: 'NUTS0',                      // Ország (Magyarország: HU / HUN)
  EMMA: 'EMMA_ID',                     // Meteoalarm belső azonosító (nem hitelesített)
});

/**
 * Bihartorda official gazetteer profile.
 * Településtörzs: KSH TSZJ 2025.
 * Koordináták: OpenStreetMap / Nominatim (WGS84), nem KSH.
 */
export const BIHARTORDA_PROFILE = Object.freeze({
  name: 'Bihartorda',
  kshSettlement: '29887',
  kshDistrict: '102',
  districtName: 'Püspökladányi járás',
  countyCode: '09',
  countyName: 'Hajdú-Bihar',
  nuts3: 'HU321',
  nuts2: 'HU32',
  nuts1: 'HU3',
  nuts0: 'HU',
  iso3: 'HUN',
  // OpenStreetMap / Nominatim WGS84 koordináták:
  coordinates: Object.freeze({
    lat: 47.1658,
    lon: 21.3650,
    source: 'OpenStreetMap/Nominatim',
    label: 'Bihartorda (községháza)'
  })
});

/**
 * Key connection cities for Bihartorda according to KSH TSZJ 2025.
 * All codes are strings with preserved leading zeroes.
 * Coordinates are sourced from OpenStreetMap / Nominatim (NOT KSH).
 */
export const KEY_CONNECTIONS = Object.freeze([
  {
    name: 'Püspökladány',
    kshSettlement: '10162',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    nuts3: 'HU321',
    nuts2: 'HU32',
    coordinates: Object.freeze({ lat: 47.3167, lon: 21.1167, source: 'OpenStreetMap/Nominatim' })
  },
  {
    name: 'Hajdúszoboszló',
    kshSettlement: '05175', // Megőrzött vezető nulla
    kshDistrict: '100',      // KSH TSZJ 2025 szerinti járáskód: 100
    districtName: 'Hajdúszoboszlói járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    nuts3: 'HU321',
    nuts2: 'HU32',
    coordinates: Object.freeze({ lat: 47.4447, lon: 21.3961, source: 'OpenStreetMap/Nominatim' })
  },
  {
    name: 'Debrecen',
    kshSettlement: '15130',
    kshDistrict: '095',      // Megőrzött vezető nulla
    districtName: 'Debreceni járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    nuts3: 'HU321',
    nuts2: 'HU32',
    coordinates: Object.freeze({ lat: 47.5316, lon: 21.6273, source: 'OpenStreetMap/Nominatim' })
  }
]);

/**
 * Eurostat NUTS 2021 NUTS2 regions of Hungary.
 */
export const HUNGARY_NUTS2_REGIONS = Object.freeze({
  HU11: { name: 'Budapest', hu: 'Budapest' },
  HU12: { name: 'Pest', hu: 'Pest' },
  HU21: { name: 'Central Transdanubia', hu: 'Közép-Dunántúl' },
  HU22: { name: 'Western Transdanubia', hu: 'Nyugat-Dunántúl' },
  HU23: { name: 'Southern Transdanubia', hu: 'Dél-Dunántúl' },
  HU31: { name: 'Northern Hungary', hu: 'Észak-Magyarország' },
  HU32: { name: 'Northern Great Plain', hu: 'Észak-Alföld' },
  HU33: { name: 'Southern Great Plain', hu: 'Dél-Alföld' },
});

/**
 * Default territorial configuration.
 */
export const DEFAULT_TERRITORY_CONFIG = Object.freeze({
  primary: BIHARTORDA_PROFILE,
  keyConnections: KEY_CONNECTIONS,
  watchedDistricts: Object.freeze(['102', '100', '095']),
  watchedCounties: Object.freeze(['HU321', '09']),
  watchedRegions: Object.freeze(['HU32'])
});

/**
 * Háromállapotú Területi Illesztési Eredmény (matchState: 'match' | 'no_match' | 'unknown')
 *
 * Dimenziók szétválasztása:
 * - recordRetained: MINDIG true (ismeretlen vagy más területi riasztás sosem vész el)
 * - isConfirmedLocal: true KIZÁRÓLAG igazolt helyi/vármegyei/nagyrégiós egyezésnél (matchState === 'match')
 * - needsLocalReview: true ismeretlen vagy tisztázatlan geokódnál (matchState === 'unknown')
 * - alertEligibleLocal: true KIZÁRÓLAG igazolt helyi érintettségnél
 * - alertEligibleNational: true minden érvényes magyarországi riasztásnál
 * - inScope: true (match), false (no_match), null (unknown)
 *
 * Szigorú elvek:
 * 1. Nagyrégiós vagy vármegyei figyelmeztetés SOHA nem kap szintetikus települési pontot (lat: null, lon: null).
 * 2. Nem állítja, hogy a jelenség biztosan bekövetkezik Bihartordán; a közölt területhez való tartozást jelzi.
 * 3. Ismeretlen geokód esetén: "Területi érintettség nem eldönthető", felülvizsgálandó, helyi riasztást nem indít.
 * 4. Más területre kiadott figyelmeztetésnél: "Nem erre a figyelt területre kiadva (területnév)".
 */
export function matchTerritory(geocodes = [], areaDesc = '', config = DEFAULT_TERRITORY_CONFIG) {
  const codeList = Array.isArray(geocodes)
    ? geocodes
    : geocodes && typeof geocodes === 'object'
      ? [geocodes]
      : [];

  const rawArea = typeof areaDesc === 'string' ? areaDesc.trim() : '';

  if (!codeList.length && !rawArea) {
    return {
      matchState: 'unknown',
      status: 'indeterminate',
      inScope: null,
      recordRetained: true,
      isConfirmedLocal: false,
      needsLocalReview: true,
      alertEligibleLocal: false,
      alertEligibleNational: true,
      territoryLevel: 'indeterminate',
      territoryName: 'Ismeretlen',
      message: 'Területi érintettség nem eldönthető (nincs megadva területi azonosító)',
      matchedRule: 'none'
    };
  }

  // Check 1: Direct settlement match
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim();
    if (val === config.primary.kshSettlement) {
      return {
        matchState: 'match',
        status: 'in_watched_settlement',
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: true,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: 'settlement',
        territoryName: config.primary.name,
        message: `Közvetlen helyi érintettség: ${config.primary.name}`,
        matchedRule: 'settlement_code'
      };
    }
  }
  if (rawArea.toLowerCase().includes('bihartorda')) {
    return {
      matchState: 'match',
      status: 'in_watched_settlement',
      inScope: true,
      recordRetained: true,
      isConfirmedLocal: true,
      needsLocalReview: false,
      alertEligibleLocal: true,
      alertEligibleNational: true,
      territoryLevel: 'settlement',
      territoryName: config.primary.name,
      message: `Közvetlen helyi érintettség: ${config.primary.name}`,
      matchedRule: 'direct_settlement_name'
    };
  }

  // Check 2: District level
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim();
    const vn = String(gc?.valueName || '').toUpperCase();
    if (vn.includes('DISTRICT') && config.watchedDistricts.includes(val)) {
      return {
        matchState: 'match',
        status: 'in_watched_district',
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: true,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: 'district',
        territoryName: config.primary.districtName,
        message: `A közölt területhez (${config.primary.districtName}) tartozik`,
        matchedRule: 'district_code'
      };
    }
  }
  if (/p[uü]sp[oö]klad[aá]nyi j[aá]r[aá]s/i.test(rawArea)) {
    return {
      matchState: 'match',
      status: 'in_watched_district',
      inScope: true,
      recordRetained: true,
      isConfirmedLocal: true,
      needsLocalReview: false,
      alertEligibleLocal: true,
      alertEligibleNational: true,
      territoryLevel: 'district',
      territoryName: config.primary.districtName,
      message: `A közölt területhez (${config.primary.districtName}) tartozik`,
      matchedRule: 'district_name'
    };
  }

  // Check 3: Key connections (settlement level)
  for (const city of config.keyConnections || []) {
    for (const gc of codeList) {
      const val = String(gc?.value || '').trim();
      if (val === city.kshSettlement) {
        return {
          matchState: 'match',
          status: 'in_key_connection',
          inScope: true,
          recordRetained: true,
          isConfirmedLocal: true,
          needsLocalReview: false,
          alertEligibleLocal: true,
          alertEligibleNational: true,
          territoryLevel: 'settlement',
          territoryName: city.name,
          message: `Kiemelt városi kapcsolat érintett: ${city.name}`,
          matchedRule: 'key_connection_code'
        };
      }
    }
    if (rawArea.toLowerCase().includes(city.name.toLowerCase())) {
      return {
        matchState: 'match',
        status: 'in_key_connection',
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: true,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: 'settlement',
        territoryName: city.name,
        message: `Kiemelt városi kapcsolat érintett: ${city.name}`,
        matchedRule: 'key_connection_name'
      };
    }
  }

  // Check 4: County level (Hajdú-Bihar: NUTS3 HU321 or KSH 09)
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim().toUpperCase();
    if (config.watchedCounties.includes(val)) {
      return {
        matchState: 'match',
        status: 'in_watched_county',
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: true,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: 'county',
        territoryName: config.primary.countyName,
        message: `A közölt területhez (${config.primary.countyName} vármegye) tartozik`,
        matchedRule: 'county_code'
      };
    }
  }
  if (/hajd[uú][- ]bihar/i.test(rawArea)) {
    return {
      matchState: 'match',
      status: 'in_watched_county',
      inScope: true,
      recordRetained: true,
      isConfirmedLocal: true,
      needsLocalReview: false,
      alertEligibleLocal: true,
      alertEligibleNational: true,
      territoryLevel: 'county',
      territoryName: config.primary.countyName,
      message: `A közölt területhez (${config.primary.countyName} vármegye) tartozik`,
      matchedRule: 'county_name'
    };
  }

  // Check 5: Region level (Észak-Alföld: NUTS2 HU32)
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim().toUpperCase();
    if (config.watchedRegions.includes(val)) {
      return {
        matchState: 'match',
        status: 'in_watched_region',
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: true,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: 'region',
        territoryName: 'Észak-Alföld',
        message: 'A közölt területhez (Észak-Alföld nagyrégió) tartozik',
        matchedRule: 'region_code'
      };
    }
  }
  if (/([eé]szak[- ]alf[oö]ld|northern great plain)/i.test(rawArea)) {
    return {
      matchState: 'match',
      status: 'in_watched_region',
      inScope: true,
      recordRetained: true,
      isConfirmedLocal: true,
      needsLocalReview: false,
      alertEligibleLocal: true,
      alertEligibleNational: true,
      territoryLevel: 'region',
      territoryName: 'Észak-Alföld',
      message: 'A közölt területhez (Észak-Alföld nagyrégió) tartozik',
      matchedRule: 'region_name'
    };
  }

  // Check 6: Other known Hungarian NUTS2 regions (Explicitly outside watched area)
  for (const [nuts2Code, regInfo] of Object.entries(HUNGARY_NUTS2_REGIONS)) {
    for (const gc of codeList) {
      const val = String(gc?.value || '').trim().toUpperCase();
      if (val === nuts2Code) {
        return {
          matchState: 'no_match',
          status: 'not_in_watched_area',
          inScope: false,
          recordRetained: true,
          isConfirmedLocal: false,
          needsLocalReview: false,
          alertEligibleLocal: false,
          alertEligibleNational: true,
          territoryLevel: 'region',
          territoryName: regInfo.hu,
          message: `Nem erre a figyelt területre kiadva (${regInfo.hu})`,
          matchedRule: 'other_hungarian_nuts2'
        };
      }
    }
    if (rawArea.toLowerCase().includes(regInfo.name.toLowerCase()) || rawArea.toLowerCase().includes(regInfo.hu.toLowerCase())) {
      return {
        matchState: 'no_match',
        status: 'not_in_watched_area',
        inScope: false,
        recordRetained: true,
        isConfirmedLocal: false,
        needsLocalReview: false,
        alertEligibleLocal: false,
        alertEligibleNational: true,
        territoryLevel: 'region',
        territoryName: regInfo.hu,
        message: `Nem erre a figyelt területre kiadva (${regInfo.hu})`,
        matchedRule: 'other_hungarian_nuts2_name'
      };
    }
  }

  // Check 7: National Hungary
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim().toUpperCase();
    if (val === 'HU' || val === 'HUN') {
      return {
        matchState: 'match',
        status: 'national',
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: true,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: 'national',
        territoryName: 'Magyarország',
        message: 'Országos érvényű figyelmeztetés (Magyarország)',
        matchedRule: 'national_code'
      };
    }
  }

  // Unrecognized geocodes (e.g. unverified EMMA_ID or custom provider codes):
  // Retained for record-keeping and review, but NEVER confirmed local and NO local alert eligibility!
  const codeLabels = codeList.map(c => c.valueName ? `${c.valueName}:${c.value}` : c.value).filter(Boolean).join(', ');
  return {
    matchState: 'unknown',
    status: 'indeterminate',
    inScope: null,
    recordRetained: true,
    isConfirmedLocal: false,
    needsLocalReview: true,
    alertEligibleLocal: false,
    alertEligibleNational: true,
    territoryLevel: 'indeterminate',
    territoryName: rawArea || codeLabels || 'Ismeretlen geokód',
    message: `Területi érintettség nem eldönthető (${rawArea || codeLabels || 'Ismeretlen'})`,
    matchedRule: 'unrecognized'
  };
}
