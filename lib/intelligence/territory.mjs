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
  KSH_SETTLEMENT: 'ksh_settlement_id', // KSH Településkód (string, 5 jegyű, pl. '29887', '05175')
  KSH_DISTRICT: 'ksh_district_id',     // KSH járáskód (string, 3 jegyű, pl. '102', '100', '095' - NEM LAU1!)
  KSH_COUNTY: 'ksh_county_id',         // KSH vármegyekód (string, 2 jegyű, pl. '09')
  NUTS3: 'NUTS3',                      // Vármegye (Hajdú-Bihar: HU321)
  NUTS2: 'NUTS2',                      // Tervezési-statisztikai régió (Észak-Alföld: HU32)
  NUTS1: 'NUTS1',                      // Statisztikai nagyrégió (Alföld és Észak: HU3)
  NUTS0: 'NUTS0',                      // Ország (Magyarország: HU / HUN)
  EMMA: 'EMMA_ID',                     // Meteoalarm belső azonosító (nem hitelesített)
});

/**
 * Négy különálló területi kapcsolattípus (Requirements 3 & 4):
 * A. ADMINISTRATIVE: közigazgatási hierarchia (település -> járás -> vármegye -> régió -> ország)
 * B. WATCHED_SETTLEMENT: felhasználó által konfigurált megfigyelt települések
 * C. KEY_CONNECTION: kiemelt városi kapcsolatok (Püspökladány, Hajdúszoboszló, Debrecen)
 * D. GEOGRAPHIC_NEIGHBOR: kizárólag igazolt térképi határkapcsolat alapján (nem azonos a közös járással!)
 */
export const RELATIONSHIP_TYPES = Object.freeze({
  ADMINISTRATIVE: 'administrative',
  WATCHED_SETTLEMENT: 'watched_settlement',
  KEY_CONNECTION: 'key_connection',
  GEOGRAPHIC_NEIGHBOR: 'geographic_neighbor'
});

export const BOUNDARY_STATUS = Object.freeze({
  VERIFIED: 'verified',
  UNVERIFIED: 'unverified' // "A földrajzi határkapcsolat a rendelkezésre álló adatokból nem ellenőrzött / nem igazolt"
});

/**
 * Bihartorda official gazetteer profile.
 * Településtörzs: KSH TSZJ 2025.
 * Koordináták: OpenStreetMap / Nominatim (WGS84), referenciapont, nem KSH és nem eseményhelyszín.
 */
export const BIHARTORDA_PROFILE = Object.freeze({
  id: 'bihartorda',
  name: 'Bihartorda',
  kshSettlement: '29887',
  kshDistrict: '102',
  districtName: 'Püspökladányi járás',
  countyCode: '09',
  countyName: 'Hajdú-Bihar',
  county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
  nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
  nuts3: 'HU321',
  nuts2: 'HU32',
  nuts1: 'HU3',
  nuts0: 'HU',
  iso3: 'HUN',
  legalStatus: 'Község',
  source: 'KSH TSZJ 2025',
  sourceVersion: '2025 megnevezésekkel',
  verifiedDate: '2026-10-22',
  relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
  boundaryStatus: BOUNDARY_STATUS.VERIFIED,
  // OpenStreetMap / Nominatim WGS84 koordináták:
  coordinates: Object.freeze({
    lat: 47.1658,
    lon: 21.3650,
    source: 'OpenStreetMap/Nominatim',
    label: 'Bihartorda (községháza referenciapont, nem eseményhely)',
    isEventLocation: false
  })
});

/**
 * Püspökladányi járás (102) teljes hivatalos településtörzse a KSH TSZJ 2025 alapján (mind a 12 település).
 * Minden kód string formátumú, megőrzött vezető nullákkal.
 * Koordináták: OpenStreetMap / Nominatim településközponti referenciapontok (nem eseményhelyszínek).
 */
export const PUSPOKLADANY_DISTRICT_SETTLEMENTS = Object.freeze([
  {
    id: 'bihartorda',
    name: 'Bihartorda',
    kshSettlement: '29887',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Község',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
    boundaryStatus: BOUNDARY_STATUS.VERIFIED,
    coordinates: Object.freeze({ lat: 47.1658, lon: 21.3650, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'puspokladany',
    name: 'Püspökladány',
    kshSettlement: '10162',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Város',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.KEY_CONNECTION,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.3167, lon: 21.1167, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'barand',
    name: 'Báránd',
    kshSettlement: '26693',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Község',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.WATCHED_SETTLEMENT,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.3000, lon: 21.2333, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'bihardancshaza',
    name: 'Bihardancsháza',
    kshSettlement: '25256',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Község',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.WATCHED_SETTLEMENT,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.1667, lon: 21.3167, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'biharnagybajom',
    name: 'Biharnagybajom',
    kshSettlement: '24828',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Község',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.2333, lon: 21.2167, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'foldes',
    name: 'Földes',
    kshSettlement: '03258', // Megőrzött vezető nulla!
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Nagyközség',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.3000, lon: 21.3667, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'kaba',
    name: 'Kaba',
    kshSettlement: '02307', // Megőrzött vezető nulla!
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Város',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.3500, lon: 21.2833, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'nagyrabe',
    name: 'Nagyrábé',
    kshSettlement: '06309', // Megőrzött vezető nulla!
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Nagyközség',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.WATCHED_SETTLEMENT,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.1856, lon: 21.3283, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'sap',
    name: 'Sáp',
    kshSettlement: '26116',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Község',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.WATCHED_SETTLEMENT,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.2500, lon: 21.3500, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'sarretudvari',
    name: 'Sárrétudvari',
    kshSettlement: '23940',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Nagyközség',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.2333, lon: 21.2000, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'szerep',
    name: 'Szerep',
    kshSettlement: '33437',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Község',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.2333, lon: 21.1500, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'tetetlen',
    name: 'Tetétlen',
    kshSettlement: '19691',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Község',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.3167, lon: 21.3000, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  }
]);

/**
 * Javasolt környékbeli figyelési lista (Suggested Nearby Settlements).
 * FONTOS: Ez javasolt megfigyelési lista és nem igazolt közvetlen földrajzi határkapcsolat!
 * A tényleges határszomszédság a rendelkezésre álló adatokból nem ellenőrzött (boundaryStatus: 'unverified').
 * Bakonszeg a Berettyóújfalui járáshoz (094) tartozik.
 */
export const SUGGESTED_NEARBY_SETTLEMENTS = Object.freeze([
  PUSPOKLADANY_DISTRICT_SETTLEMENTS.find(s => s.id === 'nagyrabe'),
  PUSPOKLADANY_DISTRICT_SETTLEMENTS.find(s => s.id === 'bihardancshaza'),
  PUSPOKLADANY_DISTRICT_SETTLEMENTS.find(s => s.id === 'sap'),
  {
    id: 'bakonszeg',
    name: 'Bakonszeg',
    kshSettlement: '15167',
    kshDistrict: '094', // Berettyóújfalui járás
    districtName: 'Berettyóújfalui járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Község',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.WATCHED_SETTLEMENT,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.1833, lon: 21.4500, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  PUSPOKLADANY_DISTRICT_SETTLEMENTS.find(s => s.id === 'barand')
]);

/**
 * Key connection cities for Bihartorda according to KSH TSZJ 2025.
 * All codes are strings with preserved leading zeroes.
 * Coordinates are sourced from OpenStreetMap / Nominatim (NOT KSH and NOT event locations).
 */
export const KEY_CONNECTIONS = Object.freeze([
  {
    id: 'puspokladany',
    name: 'Püspökladány',
    kshSettlement: '10162',
    kshDistrict: '102',
    districtName: 'Püspökladányi járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Város',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.KEY_CONNECTION,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.3167, lon: 21.1167, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'hajduszoboszlo',
    name: 'Hajdúszoboszló',
    kshSettlement: '05175', // Megőrzött vezető nulla
    kshDistrict: '100',      // KSH TSZJ 2025 szerinti járáskód: 100
    districtName: 'Hajdúszoboszlói járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Város',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.KEY_CONNECTION,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.4447, lon: 21.3961, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
  },
  {
    id: 'debrecen',
    name: 'Debrecen',
    kshSettlement: '15130',
    kshDistrict: '095',      // Megőrzött vezető nulla
    districtName: 'Debreceni járás',
    countyCode: '09',
    countyName: 'Hajdú-Bihar',
    county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
    nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
    nuts3: 'HU321',
    nuts2: 'HU32',
    legalStatus: 'Megyei jogú város',
    source: 'KSH TSZJ 2025',
    verifiedDate: '2026-10-22',
    relationshipType: RELATIONSHIP_TYPES.KEY_CONNECTION,
    boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
    coordinates: Object.freeze({ lat: 47.5316, lon: 21.6273, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
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
 * Creates a configurable territorial configuration.
 * Allows customizing primary settlement, watched settlements, key connections, and full district toggle.
 * The configuration is completely decoupled from retrospective alert cascades.
 */
export function createTerritoryConfig({
  primary = BIHARTORDA_PROFILE,
  suggestedNearby = SUGGESTED_NEARBY_SETTLEMENTS,
  watchedSettlements = null,
  keyConnections = KEY_CONNECTIONS,
  includeFullDistrict = false,
  watchedDistricts = ['102', '100', '095'],
  watchedCounties = ['HU321', '09'],
  watchedRegions = ['HU32']
} = {}) {
  const effectiveWatched = Array.isArray(watchedSettlements)
    ? watchedSettlements
    : suggestedNearby;

  return Object.freeze({
    primary,
    suggestedNearbySettlements: Object.freeze([...suggestedNearby]),
    watchedSettlements: Object.freeze([...effectiveWatched]),
    keyConnections: Object.freeze([...keyConnections]),
    districtSettlements: Object.freeze([...PUSPOKLADANY_DISTRICT_SETTLEMENTS]),
    includeFullDistrict: Boolean(includeFullDistrict),
    watchedDistricts: Object.freeze([...watchedDistricts]),
    watchedCounties: Object.freeze([...watchedCounties]),
    watchedRegions: Object.freeze([...watchedRegions])
  });
}

/**
 * Default territorial configuration (Bihartorda primary + suggested nearby watch list).
 */
export const DEFAULT_TERRITORY_CONFIG = createTerritoryConfig();

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

  // Check 1: Direct settlement match (Primary)
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
        settlementId: config.primary.id || 'bihartorda',
        relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
        boundaryStatus: BOUNDARY_STATUS.VERIFIED,
        isDirectGeographicNeighbor: true,
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
      settlementId: config.primary.id || 'bihartorda',
      relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
      boundaryStatus: BOUNDARY_STATUS.VERIFIED,
      isDirectGeographicNeighbor: true,
      message: `Közvetlen helyi érintettség: ${config.primary.name}`,
      matchedRule: 'direct_settlement_name'
    };
  }

  // Check 1.B: User-configured watched settlements (e.g. suggested nearby candidates)
  // Single event identity preserved even if multiple settlements are mentioned in area text.
  const matchedWatched = [];
  for (const ws of config.watchedSettlements || []) {
    let matched = false;
    for (const gc of codeList) {
      const val = String(gc?.value || '').trim();
      if (val === ws.kshSettlement) {
        matched = true;
        break;
      }
    }
    if (!matched && ws.name && rawArea.toLowerCase().includes(ws.name.toLowerCase())) {
      matched = true;
    }
    if (matched) {
      matchedWatched.push(ws);
    }
  }

  if (matchedWatched.length > 0) {
    const primaryMatched = matchedWatched[0];
    const names = matchedWatched.map(s => s.name).join(', ');
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
      territoryName: primaryMatched.name,
      settlementId: primaryMatched.id,
      matchedSettlements: matchedWatched.map(s => ({
        id: s.id,
        name: s.name,
        kshSettlement: s.kshSettlement,
        relationshipType: s.relationshipType || RELATIONSHIP_TYPES.WATCHED_SETTLEMENT,
        boundaryStatus: s.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED
      })),
      relationshipType: primaryMatched.relationshipType || RELATIONSHIP_TYPES.WATCHED_SETTLEMENT,
      boundaryStatus: primaryMatched.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED,
      isDirectGeographicNeighbor: false, // Közigazgatási kapcsolat vagy javasolt figyelés nem igazolt földrajzi szomszédság!
      message: matchedWatched.length === 1
        ? `Figyelt környékbeli település érintett: ${primaryMatched.name}`
        : `Több figyelt település érintett: ${names}`,
      matchedRule: 'watched_settlement'
    };
  }

  // Check 1.C: Optional full district settlements view (when enabled)
  if (config.includeFullDistrict) {
    for (const ds of config.districtSettlements || []) {
      let matched = false;
      for (const gc of codeList) {
        const val = String(gc?.value || '').trim();
        if (val === ds.kshSettlement) {
          matched = true;
          break;
        }
      }
      if (!matched && ds.name && rawArea.toLowerCase().includes(ds.name.toLowerCase())) {
        matched = true;
      }
      if (matched) {
        return {
          matchState: 'match',
          status: 'in_watched_district',
          inScope: true,
          recordRetained: true,
          isConfirmedLocal: true,
          needsLocalReview: false,
          alertEligibleLocal: true,
          alertEligibleNational: true,
          territoryLevel: 'settlement',
          territoryName: ds.name,
          settlementId: ds.id,
          relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
          boundaryStatus: ds.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED,
          isDirectGeographicNeighbor: false,
          message: `Járási település érintett: ${ds.name}`,
          matchedRule: 'district_settlement'
        };
      }
    }
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

/**
 * Resolves a settlement name and county name against the official territorial catalog.
 * Strictly separates exact matches from ambiguous or unknown identities.
 */
export function resolveSettlement(settlementName, countyName = '', options = {}) {
  const territoryConfig = options.territoryConfig || DEFAULT_TERRITORY_CONFIG;
  if (!settlementName || typeof settlementName !== 'string') {
    return {
      status: 'unresolved',
      certainty: 'unresolved_identity',
      settlementId: null,
      settlementName: '',
      kshSettlementCode: null,
      countyName: '',
      isConfirmedLocal: false,
      dataQualityFlag: 'missing_settlement_name'
    };
  }

  const cleanName = settlementName.trim();
  const cleanCounty = typeof countyName === 'string' ? countyName.trim() : '';
  const normName = cleanName.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normCounty = cleanCounty.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const known = [
    territoryConfig.primary,
    ...(territoryConfig.watchedSettlements || []),
    ...(territoryConfig.keyConnections || []),
    ...(PUSPOKLADANY_DISTRICT_SETTLEMENTS || []),
    ...(SUGGESTED_NEARBY_SETTLEMENTS || [])
  ].filter(Boolean);

  const candidates = [];
  const seenCodes = new Set();
  for (const item of known) {
    if (!item?.name || seenCodes.has(item.kshSettlement)) continue;
    const itemNormName = item.name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (itemNormName === normName) {
      seenCodes.add(item.kshSettlement);
      candidates.push(item);
    }
  }

  if (candidates.length === 1) {
    const match = candidates[0];
    const matchCountyNorm = (match.countyName || match.county?.name || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const countyMatches = !normCounty || matchCountyNorm.includes(normCounty) || normCounty.includes(matchCountyNorm);
    if (countyMatches) {
      const isConfirmedLocal = match.kshSettlement === territoryConfig.primary.kshSettlement;
      return {
        status: 'resolved',
        certainty: 'exact_name_and_county_match',
        settlementId: match.id || match.name.toLowerCase(),
        settlementName: match.name,
        kshSettlementCode: match.kshSettlement,
        kshDistrictCode: match.kshDistrict || null,
        districtName: match.districtName || null,
        countyCode: match.countyCode || '09',
        countyName: match.countyName || match.county?.name || cleanCounty,
        isConfirmedLocal,
        relationshipType: match.relationshipType || RELATIONSHIP_TYPES.ADMINISTRATIVE,
        boundaryStatus: match.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED,
        coordinates: match.coordinates || null
      };
    } else {
      return {
        status: 'ambiguous_identity',
        certainty: 'ambiguous_identity',
        settlementId: null,
        settlementName: cleanName,
        kshSettlementCode: null,
        countyName: cleanCounty,
        isConfirmedLocal: false,
        dataQualityFlag: 'ambiguous_identity_county_mismatch'
      };
    }
  } else if (candidates.length > 1) {
    const countyFiltered = candidates.filter(item => {
      const matchCountyNorm = (item.countyName || item.county?.name || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return normCounty && (matchCountyNorm.includes(normCounty) || normCounty.includes(matchCountyNorm));
    });
    if (countyFiltered.length === 1) {
      const match = countyFiltered[0];
      const isConfirmedLocal = match.kshSettlement === territoryConfig.primary.kshSettlement;
      return {
        status: 'resolved',
        certainty: 'exact_name_and_county_match',
        settlementId: match.id || match.name.toLowerCase(),
        settlementName: match.name,
        kshSettlementCode: match.kshSettlement,
        kshDistrictCode: match.kshDistrict || null,
        districtName: match.districtName || null,
        countyCode: match.countyCode || '09',
        countyName: match.countyName || match.county?.name || cleanCounty,
        isConfirmedLocal,
        relationshipType: match.relationshipType || RELATIONSHIP_TYPES.ADMINISTRATIVE,
        boundaryStatus: match.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED,
        coordinates: match.coordinates || null
      };
    }
    return {
      status: 'ambiguous_identity',
      certainty: 'ambiguous_identity',
      settlementId: null,
      settlementName: cleanName,
      kshSettlementCode: null,
      countyName: cleanCounty,
      isConfirmedLocal: false,
      dataQualityFlag: 'ambiguous_identity_multiple_candidates'
    };
  }

  return {
    status: 'unresolved_outside_watched_catalog',
    certainty: 'unresolved_identity',
    settlementId: null,
    settlementName: cleanName,
    kshSettlementCode: null,
    countyName: cleanCounty,
    isConfirmedLocal: false
  };
}
