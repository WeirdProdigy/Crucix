/**
 * Bihartorda-centered territorial hierarchy, namespaces, and warning matcher.
 *
 * Official sources and versions:
 * - KSH Helységnévtár 2024 / Területi Statisztikai Évkönyv 2024 (districts.xlsx)
 * - Eurostat NUTS 2021 classification for Hungary (HU)
 */

export const TERRITORY_NAMESPACES = Object.freeze({
  KSH_SETTLEMENT: 'ksh_settlement_id', // Településazonosító törzsszám (Bihartorda: 29887)
  KSH_DISTRICT: 'ksh_district_id',     // KSH járáskód (Püspökladányi járás: 102 - NEM LAU1!)
  NUTS3: 'NUTS3',                      // Vármegye (Hajdú-Bihar: HU321)
  NUTS2: 'NUTS2',                      // Tervezési-statisztikai nagyrégió (Észak-Alföld: HU32)
  NUTS1: 'NUTS1',                      // Statisztikai nagyrégió (Alföld és Észak: HU3)
  NUTS0: 'NUTS0',                      // Ország (Magyarország: HU / HUN)
  EMMA: 'EMMA_ID',                     // Meteoalarm belső awareness azonosító (pl. EMMA_ID:HU006)
});

/**
 * Bihartorda official gazetteer profile.
 * Source: KSH Területi Statisztikai Évkönyv 2024 / districts.xlsx
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
  // Official municipality center coordinates (KSH / OpenStreetMap EPSG:4326):
  coordinates: Object.freeze({
    lat: 47.1658,
    lon: 21.3650,
    label: 'Bihartorda (községháza)'
  })
});

/**
 * Key connection cities for Bihartorda.
 * Source: KSH Helységnévtár 2024
 */
export const KEY_CONNECTIONS = Object.freeze([
  {
    name: 'Püspökladány',
    kshSettlement: '20921',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    nuts3: 'HU321',
    nuts2: 'HU32',
    coordinates: Object.freeze({ lat: 47.3167, lon: 21.1167 })
  },
  {
    name: 'Hajdúszoboszló',
    kshSettlement: '10427',
    kshDistrict: '101',
    districtName: 'Hajdúszoboszlói járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    nuts3: 'HU321',
    nuts2: 'HU32',
    coordinates: Object.freeze({ lat: 47.4447, lon: 21.3961 })
  },
  {
    name: 'Debrecen',
    kshSettlement: '15185',
    kshDistrict: '098',
    districtName: 'Debreceni járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    nuts3: 'HU321',
    nuts2: 'HU32',
    coordinates: Object.freeze({ lat: 47.5316, lon: 21.6273 })
  }
]);

/**
 * Eurostat NUTS 2021 NUTS2 regions of Hungary with EMMA_ID mapping.
 */
export const HUNGARY_NUTS2_REGIONS = Object.freeze({
  HU11: { name: 'Budapest', hu: 'Budapest', emmaId: 'EMMA_ID:HU001' },
  HU12: { name: 'Pest', hu: 'Pest', emmaId: 'EMMA_ID:HU001' },
  HU21: { name: 'Central Transdanubia', hu: 'Közép-Dunántúl', emmaId: 'EMMA_ID:HU003' },
  HU22: { name: 'Western Transdanubia', hu: 'Nyugat-Dunántúl', emmaId: 'EMMA_ID:HU002' },
  HU23: { name: 'Southern Transdanubia', hu: 'Dél-Dunántúl', emmaId: 'EMMA_ID:HU004' },
  HU31: { name: 'Northern Hungary', hu: 'Észak-Magyarország', emmaId: 'EMMA_ID:HU005' },
  HU32: { name: 'Northern Great Plain', hu: 'Észak-Alföld', emmaId: 'EMMA_ID:HU006' },
  HU33: { name: 'Southern Great Plain', hu: 'Dél-Alföld', emmaId: 'EMMA_ID:HU007' },
});

/**
 * Default territorial configuration.
 */
export const DEFAULT_TERRITORY_CONFIG = Object.freeze({
  primary: BIHARTORDA_PROFILE,
  keyConnections: KEY_CONNECTIONS,
  watchedDistricts: Object.freeze(['102', '101', '098', '097']),
  watchedCounties: Object.freeze(['HU321', '09']),
  watchedRegions: Object.freeze(['HU32', 'EMMA_ID:HU006'])
});

/**
 * Match an alert's geocodes and area description against the Bihartorda territorial profile.
 *
 * Szigorú elvek:
 * 1. Nagyrégiós vagy vármegyei figyelmeztetés SOHA nem kap szintetikus települési pontot (lat: null, lon: null).
 * 2. Nem állítja, hogy a jelenség biztosan bekövetkezik Bihartordán; a közölt területhez való tartozást jelzi.
 * 3. Ismeretlen geokód esetén: "Területi érintettség nem eldönthető".
 * 4. Más területre kiadott figyelmeztetésnél: "Nem erre a figyelt területre kiadva (területnév)".
 * 5. A területi felbontás és a CAP bizonyosság (certainty) szigorúan független dimenziók maradnak.
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
      status: 'indeterminate',
      inScope: false,
      territoryLevel: 'indeterminate',
      territoryName: 'Ismeretlen',
      message: 'Területi érintettség nem eldönthető (nincs megadva területi azonosító)',
      matchedRule: 'none'
    };
  }

  // Check 1: Direct settlement match
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim();
    const vn = String(gc?.valueName || '').toUpperCase();
    if ((vn === 'KSH_SETTLEMENT' || vn === 'KSH_SETTLEMENT_ID') && val === config.primary.kshSettlement) {
      return {
        status: 'in_watched_settlement',
        inScope: true,
        territoryLevel: 'settlement',
        territoryName: config.primary.name,
        message: `Közvetlen helyi érintettség: ${config.primary.name}`,
        matchedRule: 'direct_settlement'
      };
    }
  }
  if (rawArea.toLowerCase().includes('bihartorda')) {
    return {
      status: 'in_watched_settlement',
      inScope: true,
      territoryLevel: 'settlement',
      territoryName: config.primary.name,
      message: `Közvetlen helyi érintettség: ${config.primary.name}`,
      matchedRule: 'direct_settlement_name'
    };
  }

  // Check 2: District level (Prioritize over city names if district is explicitly indicated)
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim();
    const vn = String(gc?.valueName || '').toUpperCase();
    if (vn.includes('DISTRICT') && config.watchedDistricts.includes(val)) {
      return {
        status: 'in_watched_district',
        inScope: true,
        territoryLevel: 'district',
        territoryName: config.primary.districtName,
        message: `A közölt területhez (${config.primary.districtName}) tartozik`,
        matchedRule: 'district_code'
      };
    }
  }
  if (/p[uü]sp[oö]klad[aá]nyi j[aá]r[aá]s/i.test(rawArea)) {
    return {
      status: 'in_watched_district',
      inScope: true,
      territoryLevel: 'district',
      territoryName: config.primary.districtName,
      message: `A közölt területhez (${config.primary.districtName}) tartozik`,
      matchedRule: 'district_name'
    };
  }

  // Check 3: Key connections (settlement level)
  for (const city of config.keyConnections || []) {
    if (rawArea.toLowerCase().includes(city.name.toLowerCase())) {
      return {
        status: 'in_key_connection',
        inScope: true,
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
        status: 'in_watched_county',
        inScope: true,
        territoryLevel: 'county',
        territoryName: config.primary.countyName,
        message: `A közölt területhez (${config.primary.countyName} vármegye) tartozik`,
        matchedRule: 'county_code'
      };
    }
  }
  if (/hajd[uú][- ]bihar/i.test(rawArea)) {
    return {
      status: 'in_watched_county',
      inScope: true,
      territoryLevel: 'county',
      territoryName: config.primary.countyName,
      message: `A közölt területhez (${config.primary.countyName} vármegye) tartozik`,
      matchedRule: 'county_name'
    };
  }

  // Check 5: Region level (Észak-Alföld: NUTS2 HU32 or EMMA_ID:HU006)
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim().toUpperCase();
    if (config.watchedRegions.includes(val)) {
      return {
        status: 'in_watched_region',
        inScope: true,
        territoryLevel: 'region',
        territoryName: 'Észak-Alföld',
        message: 'A közölt területhez (Észak-Alföld nagyrégió) tartozik',
        matchedRule: 'region_code'
      };
    }
  }
  if (/([eé]szak[- ]alf[oö]ld|northern great plain)/i.test(rawArea)) {
    return {
      status: 'in_watched_region',
      inScope: true,
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
      if (val === nuts2Code || val === regInfo.emmaId.toUpperCase()) {
        return {
          status: 'not_in_watched_area',
          inScope: false,
          territoryLevel: 'region',
          territoryName: regInfo.hu,
          message: `Nem erre a figyelt területre kiadva (${regInfo.hu})`,
          matchedRule: 'other_hungarian_nuts2'
        };
      }
    }
    if (rawArea.toLowerCase().includes(regInfo.name.toLowerCase()) || rawArea.toLowerCase().includes(regInfo.hu.toLowerCase())) {
      return {
        status: 'not_in_watched_area',
        inScope: false,
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
        status: 'national',
        inScope: true,
        territoryLevel: 'national',
        territoryName: 'Magyarország',
        message: 'Országos érvényű figyelmeztetés (Magyarország)',
        matchedRule: 'national_code'
      };
    }
  }

  // If geocode is unrecognized:
  return {
    status: 'indeterminate',
    inScope: false,
    territoryLevel: 'indeterminate',
    territoryName: rawArea || 'Ismeretlen geokód',
    message: `Területi érintettség nem eldönthető (${rawArea || codeList.map(c => c.value).join(', ')})`,
    matchedRule: 'unrecognized'
  };
}
