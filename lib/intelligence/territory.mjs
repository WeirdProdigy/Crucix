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
 * Helyi vonatkozás oka (Requirement 1):
 * - official_area_assignment: hivatalos területi kijelölés (pl. hatósági ASP-táblázat, hivatalos közigazgatási besorolási lista)
 * - resolved_event_location: igazolt eseményhelyszín (pl. geokódolt koordináták, pontos eseménypont a településen)
 * - text_mention: szöveges említés (cikkben, hírben vagy leírásban szereplő településnév)
 * - source_region_only: forrásrégió / vármegye / nagyrégió szintű riasztás (pl. Meteoalarm Hajdú-Bihar vármegye vagy Észak-Alföld)
 */
export const LOCAL_RELEVANCE_REASONS = Object.freeze({
  OFFICIAL_AREA_ASSIGNMENT: 'official_area_assignment',
  RESOLVED_EVENT_LOCATION: 'resolved_event_location',
  TEXT_MENTION: 'text_mention',
  SOURCE_REGION_ONLY: 'source_region_only'
});

/**
 * Település-azonosítási állapot (Requirement 3):
 * - resolved: pontosan és egyértelműen beazonosított település
 * - ambiguous: több településjelölt vagy név/vármegye eltérés miatt tisztázatlan identitás
 * - unresolved: azonosítatlan vagy katalóguson kívüli település
 */
export const IDENTITY_STATUSES = Object.freeze({
  RESOLVED: 'resolved',
  AMBIGUOUS: 'ambiguous',
  UNRESOLVED: 'unresolved'
});

/**
 * Figyelési hatókör (Requirement 3):
 * - in: a felhasználó által figyelt település / terület
 * - out: azonosított, de nem figyelt település / terület
 * - unknown: tisztázatlan vagy ismeretlen hatókör
 */
export const WATCH_SCOPES = Object.freeze({
  IN: 'in',
  OUT: 'out',
  UNKNOWN: 'unknown'
});

/**
 * Közigazgatási hierarchiaszintek (Requirement 4):
 * - settlement: település szint
 * - district: járási szint
 * - county: vármegyei szint (NUTS3 / KSH 09)
 * - region: nagyrégió szint (NUTS2 / HU32)
 * - country: országos szint (NUTS0 / HUN)
 */
export const ADMINISTRATIVE_LEVELS = Object.freeze({
  SETTLEMENT: 'settlement',
  DISTRICT: 'district',
  COUNTY: 'county',
  REGION: 'region',
  COUNTRY: 'country'
});

/**
 * Determinisztikus matchState számítás a két ortogonális dimenzióból (Requirement 3):
 * - identityStatus === 'resolved' && watchScope === 'in' -> 'match'
 * - identityStatus === 'resolved' && watchScope === 'out' -> 'no_match'
 * - identityStatus !== 'resolved' || watchScope === 'unknown' -> 'unknown'
 */
export function deriveMatchState(identityStatus, watchScope) {
  if (identityStatus === IDENTITY_STATUSES.RESOLVED) {
    if (watchScope === WATCH_SCOPES.IN) return 'match';
    if (watchScope === WATCH_SCOPES.OUT) return 'no_match';
  }
  return 'unknown';
}

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
 * Berettyóújfalu official gazetteer profile (KSH TSZJ 2025).
 * Járásszékhely a Berettyóújfalui járásban (094).
 */
export const BERETTYOUJFALU_PROFILE = Object.freeze({
  id: 'berettyoujfalu',
  name: 'Berettyóújfalu',
  kshSettlement: '20822',
  kshDistrict: '094',
  districtName: 'Berettyóújfalui járás',
  countyCode: '09',
  countyName: 'Hajdú-Bihar',
  county: Object.freeze({ id: '09', name: 'Hajdú-Bihar' }),
  nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32', nuts1: 'HU3', nuts0: 'HU' }),
  nuts3: 'HU321',
  nuts2: 'HU32',
  nuts1: 'HU3',
  nuts0: 'HU',
  iso3: 'HUN',
  legalStatus: 'Város',
  source: 'KSH TSZJ 2025',
  verifiedDate: '2026-10-23',
  relationshipType: RELATIONSHIP_TYPES.KEY_CONNECTION,
  boundaryStatus: BOUNDARY_STATUS.UNVERIFIED,
  coordinates: Object.freeze({ lat: 47.2167, lon: 21.5500, source: 'OpenStreetMap/Nominatim', isEventLocation: false })
});

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
 * Allows customizing primary settlement, watched settlements, key connections, key cities, and full district toggle.
 * The configuration is completely decoupled from retrospective alert cascades.
 */
export function createTerritoryConfig({
  primary = BIHARTORDA_PROFILE,
  suggestedNearby = SUGGESTED_NEARBY_SETTLEMENTS,
  watchedSettlements = null,
  keyConnections = null,
  keyCities = null,
  includeFullDistrict = false,
  watchedDistricts = ['102', '100', '095'],
  watchedCounties = ['HU321', '09'],
  watchedRegions = ['HU32']
} = {}) {
  const effectiveWatched = Array.isArray(watchedSettlements)
    ? watchedSettlements
    : suggestedNearby;

  const rawKey = keyCities || keyConnections || KEY_CONNECTIONS;
  const effectiveKeyConnections = Array.isArray(rawKey) ? rawKey : KEY_CONNECTIONS;

  return Object.freeze({
    primary,
    suggestedNearbySettlements: Object.freeze([...suggestedNearby]),
    watchedSettlements: Object.freeze([...effectiveWatched]),
    keyConnections: Object.freeze([...effectiveKeyConnections]),
    keyCities: Object.freeze([...effectiveKeyConnections]),
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
export function matchTerritory(geocodes = [], areaDesc = '', config = DEFAULT_TERRITORY_CONFIG, options = {}) {
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
      identityStatus: IDENTITY_STATUSES.UNRESOLVED,
      watchScope: WATCH_SCOPES.UNKNOWN,
      inScope: false,
      recordRetained: true,
      isConfirmedLocal: false,
      needsLocalReview: true,
      alertEligibleLocal: false,
      alertEligibleNational: true,
      territoryLevel: 'indeterminate',
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
      territoryName: 'Ismeretlen',
      message: 'Területi érintettség nem eldönthető (nincs megadva területi azonosító)',
      matchedRule: 'none'
    };
  }

  // Check 1: Direct settlement match (Primary: Bihartorda)
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim();
    if (val === config.primary.kshSettlement) {
      const localRelevanceReason = options.localRelevanceReason ||
        (options.isEventLocation ? LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION : LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT);
      return {
        matchState: 'match',
        status: 'in_watched_settlement',
        identityStatus: IDENTITY_STATUSES.RESOLVED,
        watchScope: WATCH_SCOPES.IN,
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: true,
        localRelevanceReason,
        needsLocalReview: false,
        relevanceLabel: 'megerősített helyi találat',
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
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

  // Check 1.B: Text mention of Bihartorda (without official settlement geocode)
  if (rawArea.toLowerCase().includes('bihartorda')) {
    const localRelevanceReason = options.localRelevanceReason ||
      (options.isEventLocation ? LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION : LOCAL_RELEVANCE_REASONS.TEXT_MENTION);
    const isConfirmedLocal = localRelevanceReason === LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT ||
      localRelevanceReason === LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION;
    return {
      matchState: 'match',
      status: 'in_watched_settlement',
      identityStatus: IDENTITY_STATUSES.RESOLVED,
      watchScope: WATCH_SCOPES.IN,
      inScope: true,
      recordRetained: true,
      isConfirmedLocal,
      localRelevanceReason,
      needsLocalReview: !isConfirmedLocal,
      relevanceLabel: isConfirmedLocal ? 'megerősített helyi találat' : 'ellenőrizendő helyi vonatkozás',
      alertEligibleLocal: isConfirmedLocal,
      alertEligibleNational: true,
      territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
      territoryName: config.primary.name,
      settlementId: config.primary.id || 'bihartorda',
      kshSettlement: config.primary.kshSettlement,
      kshSettlementCode: config.primary.kshSettlement,
      countyCode: config.primary.countyCode || '09',
      nuts3: config.primary.nuts3 || 'HU321',
      nuts2: config.primary.nuts2 || 'HU32',
      country: 'HUN',
      relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
      boundaryStatus: BOUNDARY_STATUS.VERIFIED,
      isDirectGeographicNeighbor: true,
      message: isConfirmedLocal
        ? `Közvetlen helyi érintettség: ${config.primary.name}`
        : `Szöveges helyi említés: ${config.primary.name} (ellenőrizendő helyi vonatkozás)`,
      matchedRule: 'direct_settlement_name'
    };
  }

  // Check 2: Watched settlements (e.g. suggested nearby candidates)
  // Check geocode first:
  for (const ws of config.watchedSettlements || []) {
    for (const gc of codeList) {
      const val = String(gc?.value || '').trim();
      if (val === ws.kshSettlement) {
        const localRelevanceReason = options.localRelevanceReason ||
          (options.isEventLocation ? LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION : LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT);
        return {
          matchState: 'match',
          status: 'in_watched_settlement',
          identityStatus: IDENTITY_STATUSES.RESOLVED,
          watchScope: WATCH_SCOPES.IN,
          inScope: true,
          recordRetained: true,
          isConfirmedLocal: true,
          localRelevanceReason,
          needsLocalReview: false,
          relevanceLabel: 'megerősített helyi találat',
          alertEligibleLocal: true,
          alertEligibleNational: true,
          territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
          territoryName: ws.name,
          settlementId: ws.id,
          matchedSettlements: [{
            id: ws.id,
            name: ws.name,
            kshSettlement: ws.kshSettlement,
            relationshipType: ws.relationshipType || RELATIONSHIP_TYPES.WATCHED_SETTLEMENT,
            boundaryStatus: ws.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED
          }],
          relationshipType: ws.relationshipType || RELATIONSHIP_TYPES.WATCHED_SETTLEMENT,
          boundaryStatus: ws.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED,
          isDirectGeographicNeighbor: false,
          message: `Figyelt környékbeli település érintett: ${ws.name}`,
          matchedRule: 'watched_settlement_code'
        };
      }
    }
  }

  // Check text mention for watched settlements:
  const matchedWatched = [];
  for (const ws of config.watchedSettlements || []) {
    if (ws.name && rawArea.toLowerCase().includes(ws.name.toLowerCase())) {
      matchedWatched.push(ws);
    }
  }

  if (matchedWatched.length > 0) {
    const primaryMatched = matchedWatched[0];
    const names = matchedWatched.map(s => s.name).join(', ');
    const localRelevanceReason = options.localRelevanceReason ||
      (options.isEventLocation ? LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION : LOCAL_RELEVANCE_REASONS.TEXT_MENTION);
    const isConfirmedLocal = localRelevanceReason === LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT ||
      localRelevanceReason === LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION;
    return {
      matchState: 'match',
      status: 'in_watched_settlement',
      identityStatus: IDENTITY_STATUSES.RESOLVED,
      watchScope: WATCH_SCOPES.IN,
      inScope: true,
      recordRetained: true,
      isConfirmedLocal,
      localRelevanceReason,
      needsLocalReview: !isConfirmedLocal,
      relevanceLabel: isConfirmedLocal ? 'megerősített helyi találat' : 'ellenőrizendő helyi vonatkozás',
      alertEligibleLocal: isConfirmedLocal,
      alertEligibleNational: true,
      territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
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
      isDirectGeographicNeighbor: false,
      message: matchedWatched.length === 1
        ? (isConfirmedLocal ? `Figyelt környékbeli település érintett: ${primaryMatched.name}` : `Szöveges említés: ${primaryMatched.name} (ellenőrizendő helyi vonatkozás)`)
        : `Több figyelt település szövegesen említve: ${names} (ellenőrizendő helyi vonatkozás)`,
      matchedRule: 'watched_settlement'
    };
  }

  // Check 3: District level (e.g. ksh_district_id: 102 or "Püspökladányi járás")
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim();
    const vn = String(gc?.valueName || '').toUpperCase();
    if ((vn.includes('DISTRICT') || vn === 'KSH_DISTRICT_ID') && config.watchedDistricts.includes(val)) {
      return {
        matchState: 'match',
        status: 'in_watched_district',
        identityStatus: IDENTITY_STATUSES.RESOLVED,
        watchScope: WATCH_SCOPES.IN,
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: false,
        localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: ADMINISTRATIVE_LEVELS.DISTRICT,
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
      identityStatus: IDENTITY_STATUSES.RESOLVED,
      watchScope: WATCH_SCOPES.IN,
      inScope: true,
      recordRetained: true,
      isConfirmedLocal: false,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
      needsLocalReview: false,
      alertEligibleLocal: true,
      alertEligibleNational: true,
      territoryLevel: ADMINISTRATIVE_LEVELS.DISTRICT,
      territoryName: config.primary.districtName,
      message: `A közölt területhez (${config.primary.districtName}) tartozik`,
      matchedRule: 'district_name'
    };
  }

  // Check 4: Key connections / key cities (Püspökladány, Hajdúszoboszló, Debrecen, Berettyóújfalu)
  const keyCitiesList = config.keyCities || config.keyConnections || KEY_CONNECTIONS;
  for (const city of keyCitiesList) {
    let matchedByCode = false;
    for (const gc of codeList) {
      const val = String(gc?.value || '').trim();
      const vn = String(gc?.valueName || '').toUpperCase();
      if (!vn.includes('DISTRICT') && val === city.kshSettlement) {
        matchedByCode = true;
        break;
      }
    }
    const matchedByText = !matchedByCode && city.name &&
      rawArea.toLowerCase().includes(city.name.toLowerCase()) &&
      !rawArea.toLowerCase().includes(`${city.name.toLowerCase()}i járás`);
    if (matchedByCode || matchedByText) {
      const localRelevanceReason = options.localRelevanceReason ||
        (matchedByCode ? LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT : (options.isEventLocation ? LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION : LOCAL_RELEVANCE_REASONS.TEXT_MENTION));
      const isConfirmedLocal = localRelevanceReason === LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT ||
        localRelevanceReason === LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION;
      return {
        matchState: 'match',
        status: 'in_key_connection',
        identityStatus: IDENTITY_STATUSES.RESOLVED,
        watchScope: WATCH_SCOPES.IN,
        inScope: true,
        recordRetained: true,
        isConfirmedLocal,
        localRelevanceReason,
        needsLocalReview: !isConfirmedLocal,
        relevanceLabel: 'kiemelt városi kapcsolat',
        alertEligibleLocal: isConfirmedLocal,
        alertEligibleNational: true,
        territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
        territoryName: city.name,
        settlementId: city.id,
        relationshipType: RELATIONSHIP_TYPES.KEY_CONNECTION,
        boundaryStatus: city.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED,
        isDirectGeographicNeighbor: false,
        message: `Kiemelt városi kapcsolat érintett: ${city.name}`,
        matchedRule: matchedByCode ? 'key_connection_code' : 'key_connection_name'
      };
    }
  }

  // Check 4: District settlements (Configurable: full district watched vs unwatched)
  for (const ds of config.districtSettlements || []) {
    let matchedByCode = false;
    for (const gc of codeList) {
      const val = String(gc?.value || '').trim();
      if (val === ds.kshSettlement) {
        matchedByCode = true;
        break;
      }
    }
    const matchedByText = !matchedByCode && ds.name && rawArea.toLowerCase().includes(ds.name.toLowerCase());
    if (matchedByCode || matchedByText) {
      if (config.includeFullDistrict) {
        const localRelevanceReason = options.localRelevanceReason ||
          (matchedByCode ? LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT : (options.isEventLocation ? LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION : LOCAL_RELEVANCE_REASONS.TEXT_MENTION));
        const isConfirmedLocal = localRelevanceReason === LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT ||
          localRelevanceReason === LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION;
        return {
          matchState: 'match',
          status: 'in_watched_district',
          identityStatus: IDENTITY_STATUSES.RESOLVED,
          watchScope: WATCH_SCOPES.IN,
          inScope: true,
          recordRetained: true,
          isConfirmedLocal,
          localRelevanceReason,
          needsLocalReview: !isConfirmedLocal,
          relevanceLabel: isConfirmedLocal ? 'megerősített helyi találat' : 'ellenőrizendő helyi vonatkozás',
          alertEligibleLocal: isConfirmedLocal,
          alertEligibleNational: true,
          territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
          territoryName: ds.name,
          settlementId: ds.id,
          relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
          boundaryStatus: ds.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED,
          isDirectGeographicNeighbor: false,
          message: `Járási település érintett: ${ds.name}`,
          matchedRule: 'district_settlement'
        };
      } else {
        return {
          matchState: 'no_match',
          status: 'not_in_watched_area',
          identityStatus: IDENTITY_STATUSES.RESOLVED,
          watchScope: WATCH_SCOPES.OUT,
          inScope: false,
          recordRetained: true,
          isConfirmedLocal: false,
          localRelevanceReason: matchedByCode ? LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT : LOCAL_RELEVANCE_REASONS.TEXT_MENTION,
          needsLocalReview: false,
          relevanceLabel: 'nem figyelt település',
          alertEligibleLocal: false,
          alertEligibleNational: true,
          territoryLevel: ADMINISTRATIVE_LEVELS.SETTLEMENT,
          territoryName: ds.name,
          settlementId: ds.id,
          relationshipType: RELATIONSHIP_TYPES.ADMINISTRATIVE,
          boundaryStatus: ds.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED,
          isDirectGeographicNeighbor: false,
          message: `Nem a figyelt területhez tartozó járási település: ${ds.name}`,
          matchedRule: 'unwatched_district_settlement'
        };
      }
    }
  }

  // Check 5: County level (Hajdú-Bihar: NUTS3 HU321 or KSH 09)
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim().toUpperCase();
    if (config.watchedCounties.includes(val)) {
      return {
        matchState: 'match',
        status: 'in_watched_county',
        identityStatus: IDENTITY_STATUSES.RESOLVED,
        watchScope: WATCH_SCOPES.IN,
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: false,
        localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: ADMINISTRATIVE_LEVELS.COUNTY,
        territoryName: config.primary.countyName,
        countyCode: '09',
        nuts3: 'HU321',
        nuts2: 'HU32',
        nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32' }),
        message: `A közölt területhez (${config.primary.countyName} vármegye) tartozik`,
        matchedRule: 'county_code'
      };
    }
  }
  if (/hajd[uú][- ]bihar/i.test(rawArea)) {
    return {
      matchState: 'match',
      status: 'in_watched_county',
      identityStatus: IDENTITY_STATUSES.RESOLVED,
      watchScope: WATCH_SCOPES.IN,
      inScope: true,
      recordRetained: true,
      isConfirmedLocal: false,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
      needsLocalReview: false,
      alertEligibleLocal: true,
      alertEligibleNational: true,
      territoryLevel: ADMINISTRATIVE_LEVELS.COUNTY,
      territoryName: config.primary.countyName,
      countyCode: '09',
      nuts3: 'HU321',
      nuts2: 'HU32',
      nuts: Object.freeze({ nuts3: 'HU321', nuts2: 'HU32' }),
      message: `A közölt területhez (${config.primary.countyName} vármegye) tartozik`,
      matchedRule: 'county_name'
    };
  }

  // Check 7: Region level (Észak-Alföld: NUTS2 HU32)
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim().toUpperCase();
    if (config.watchedRegions.includes(val)) {
      return {
        matchState: 'match',
        status: 'in_watched_region',
        identityStatus: IDENTITY_STATUSES.RESOLVED,
        watchScope: WATCH_SCOPES.IN,
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: false,
        localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: ADMINISTRATIVE_LEVELS.REGION,
        territoryName: 'Észak-Alföld',
        nuts2: 'HU32',
        nuts: Object.freeze({ nuts2: 'HU32' }),
        message: 'A közölt területhez (Észak-Alföld nagyrégió) tartozik',
        matchedRule: 'region_code'
      };
    }
  }
  if (/([eé]szak[- ]alf[oö]ld|northern great plain)/i.test(rawArea)) {
    return {
      matchState: 'match',
      status: 'in_watched_region',
      identityStatus: IDENTITY_STATUSES.RESOLVED,
      watchScope: WATCH_SCOPES.IN,
      inScope: true,
      recordRetained: true,
      isConfirmedLocal: false,
      localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
      needsLocalReview: false,
      alertEligibleLocal: true,
      alertEligibleNational: true,
      territoryLevel: ADMINISTRATIVE_LEVELS.REGION,
      territoryName: 'Észak-Alföld',
      nuts2: 'HU32',
      nuts: Object.freeze({ nuts2: 'HU32' }),
      message: 'A közölt területhez (Észak-Alföld nagyrégió) tartozik',
      matchedRule: 'region_name'
    };
  }

  // Check 8: Other known Hungarian NUTS2 regions (Explicitly outside watched area)
  for (const [nuts2Code, regInfo] of Object.entries(HUNGARY_NUTS2_REGIONS)) {
    for (const gc of codeList) {
      const val = String(gc?.value || '').trim().toUpperCase();
      if (val === nuts2Code) {
        return {
          matchState: 'no_match',
          status: 'not_in_watched_area',
          identityStatus: IDENTITY_STATUSES.RESOLVED,
          watchScope: WATCH_SCOPES.OUT,
          inScope: false,
          recordRetained: true,
          isConfirmedLocal: false,
          localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
          needsLocalReview: false,
          alertEligibleLocal: false,
          alertEligibleNational: true,
          territoryLevel: ADMINISTRATIVE_LEVELS.REGION,
          territoryName: regInfo.hu,
          nuts2: nuts2Code,
          nuts: Object.freeze({ nuts2: nuts2Code }),
          message: `Nem erre a figyelt területre kiadva (${regInfo.hu})`,
          matchedRule: 'other_hungarian_nuts2'
        };
      }
    }
    if (rawArea.toLowerCase().includes(regInfo.name.toLowerCase()) || rawArea.toLowerCase().includes(regInfo.hu.toLowerCase())) {
      return {
        matchState: 'no_match',
        status: 'not_in_watched_area',
        identityStatus: IDENTITY_STATUSES.RESOLVED,
        watchScope: WATCH_SCOPES.OUT,
        inScope: false,
        recordRetained: true,
        isConfirmedLocal: false,
        localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
        needsLocalReview: false,
        alertEligibleLocal: false,
        alertEligibleNational: true,
        territoryLevel: ADMINISTRATIVE_LEVELS.REGION,
        territoryName: regInfo.hu,
        nuts2: nuts2Code,
        nuts: Object.freeze({ nuts2: nuts2Code }),
        message: `Nem erre a figyelt területre kiadva (${regInfo.hu})`,
        matchedRule: 'other_hungarian_nuts2_name'
      };
    }
  }

  // Check 9: National Hungary
  for (const gc of codeList) {
    const val = String(gc?.value || '').trim().toUpperCase();
    if (val === 'HU' || val === 'HUN') {
      return {
        matchState: 'match',
        status: 'national',
        identityStatus: IDENTITY_STATUSES.RESOLVED,
        watchScope: WATCH_SCOPES.IN,
        inScope: true,
        recordRetained: true,
        isConfirmedLocal: false,
        localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
        needsLocalReview: false,
        alertEligibleLocal: true,
        alertEligibleNational: true,
        territoryLevel: ADMINISTRATIVE_LEVELS.COUNTRY,
        territoryName: 'Magyarország',
        nuts0: 'HU',
        country: 'HUN',
        countryCode: 'HU',
        message: 'Országos érvényű figyelmeztetés (Magyarország)',
        matchedRule: 'national_code'
      };
    }
  }

  // 10. Unrecognized geocodes
  const codeLabels = codeList.map(c => c.valueName ? `${c.valueName}:${c.value}` : c.value).filter(Boolean).join(', ');
  return {
    matchState: 'unknown',
    status: 'indeterminate',
    identityStatus: IDENTITY_STATUSES.UNRESOLVED,
    watchScope: WATCH_SCOPES.UNKNOWN,
    inScope: false,
    recordRetained: true,
    isConfirmedLocal: false,
    needsLocalReview: true,
    alertEligibleLocal: false,
    alertEligibleNational: true,
    territoryLevel: 'indeterminate',
    localRelevanceReason: LOCAL_RELEVANCE_REASONS.SOURCE_REGION_ONLY,
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
  const defaultReason = options.localRelevanceReason || LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT;

  if (!settlementName || typeof settlementName !== 'string') {
    return {
      status: 'unresolved',
      identityStatus: IDENTITY_STATUSES.UNRESOLVED,
      watchScope: WATCH_SCOPES.UNKNOWN,
      matchState: 'unknown',
      inScope: false,
      certainty: 'unresolved_identity',
      settlementId: null,
      settlementName: '',
      kshSettlementCode: null,
      countyName: '',
      isConfirmedLocal: false,
      localRelevanceReason: defaultReason,
      needsLocalReview: true,
      relevanceLabel: 'ellenőrizendő helyi vonatkozás',
      dataQualityFlag: 'missing_settlement_name'
    };
  }

  const cleanName = settlementName.trim();
  const cleanCounty = typeof countyName === 'string' ? countyName.trim() : '';
  const normName = cleanName.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normCounty = cleanCounty.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const keyCitiesList = territoryConfig.keyCities || territoryConfig.keyConnections || KEY_CONNECTIONS;
  const known = [
    territoryConfig.primary,
    ...(territoryConfig.watchedSettlements || []),
    ...(keyCitiesList || []),
    BERETTYOUJFALU_PROFILE,
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

  function evaluateCandidate(match) {
    const isPrimary = match.kshSettlement === territoryConfig.primary.kshSettlement;
    const isWatched = (territoryConfig.watchedSettlements || []).some(w => w.kshSettlement === match.kshSettlement);
    const isKeyCity = (keyCitiesList || []).some(k => k.kshSettlement === match.kshSettlement);
    const isDistrict = (territoryConfig.districtSettlements || []).some(d => d.kshSettlement === match.kshSettlement);

    let watchScope = WATCH_SCOPES.OUT;
    if (isPrimary || isWatched || isKeyCity) {
      watchScope = WATCH_SCOPES.IN;
    } else if (isDistrict && territoryConfig.includeFullDistrict) {
      watchScope = WATCH_SCOPES.IN;
    } else if (isDistrict && !territoryConfig.includeFullDistrict) {
      watchScope = WATCH_SCOPES.OUT;
    }

    const identityStatus = IDENTITY_STATUSES.RESOLVED;
    const matchState = deriveMatchState(identityStatus, watchScope);
    const inScope = watchScope === WATCH_SCOPES.IN;

    const localRelevanceReason = options.localRelevanceReason ||
      (options.isEventLocation ? LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION : LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT);

    const isConfirmedLocal = Boolean(
      inScope &&
      (isPrimary || isWatched) &&
      (localRelevanceReason === LOCAL_RELEVANCE_REASONS.OFFICIAL_AREA_ASSIGNMENT ||
       localRelevanceReason === LOCAL_RELEVANCE_REASONS.RESOLVED_EVENT_LOCATION)
    );

    let relevanceLabel = 'nem figyelt település';
    if (isKeyCity) {
      relevanceLabel = 'kiemelt városi kapcsolat';
    } else if (match.relationshipType === RELATIONSHIP_TYPES.KEY_CONNECTION) {
      relevanceLabel = 'nem figyelt kiemelt kapcsolat';
    } else if (localRelevanceReason === LOCAL_RELEVANCE_REASONS.TEXT_MENTION) {
      relevanceLabel = 'ellenőrizendő helyi vonatkozás';
    } else if (isConfirmedLocal) {
      relevanceLabel = 'megerősített helyi találat';
    }

    return {
      status: 'resolved',
      identityStatus,
      watchScope,
      matchState,
      inScope,
      certainty: 'exact_name_and_county_match',
      settlementId: match.id || match.name.toLowerCase(),
      settlementName: match.name,
      kshSettlementCode: match.kshSettlement,
      kshDistrictCode: match.kshDistrict || null,
      districtName: match.districtName || null,
      countyCode: match.countyCode || '09',
      countyName: match.countyName || match.county?.name || cleanCounty,
      isConfirmedLocal,
      localRelevanceReason,
      needsLocalReview: localRelevanceReason === LOCAL_RELEVANCE_REASONS.TEXT_MENTION,
      relevanceLabel,
      relationshipType: match.relationshipType || RELATIONSHIP_TYPES.ADMINISTRATIVE,
      boundaryStatus: match.boundaryStatus || BOUNDARY_STATUS.UNVERIFIED,
      coordinates: match.coordinates || null
    };
  }

  if (candidates.length === 1) {
    const match = candidates[0];
    const matchCountyNorm = (match.countyName || match.county?.name || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const countyMatches = !normCounty || matchCountyNorm.includes(normCounty) || normCounty.includes(matchCountyNorm);
    if (countyMatches) {
      return evaluateCandidate(match);
    } else {
      return {
        status: 'ambiguous_identity',
        identityStatus: IDENTITY_STATUSES.AMBIGUOUS,
        watchScope: WATCH_SCOPES.UNKNOWN,
        matchState: 'unknown',
        inScope: false,
        certainty: 'ambiguous_identity',
        settlementId: null,
        settlementName: cleanName,
        kshSettlementCode: null,
        countyName: cleanCounty,
        isConfirmedLocal: false,
        localRelevanceReason: defaultReason,
        needsLocalReview: true,
        relevanceLabel: 'ellenőrizendő helyi vonatkozás',
        dataQualityFlag: 'ambiguous_identity_county_mismatch'
      };
    }
  } else if (candidates.length > 1) {
    const countyFiltered = candidates.filter(item => {
      const matchCountyNorm = (item.countyName || item.county?.name || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return normCounty && (matchCountyNorm.includes(normCounty) || normCounty.includes(matchCountyNorm));
    });
    if (countyFiltered.length === 1) {
      return evaluateCandidate(countyFiltered[0]);
    }
    return {
      status: 'ambiguous_identity',
      identityStatus: IDENTITY_STATUSES.AMBIGUOUS,
      watchScope: WATCH_SCOPES.UNKNOWN,
      matchState: 'unknown',
      inScope: false,
      certainty: 'ambiguous_identity',
      settlementId: null,
      settlementName: cleanName,
      kshSettlementCode: null,
      countyName: cleanCounty,
      isConfirmedLocal: false,
      localRelevanceReason: defaultReason,
      needsLocalReview: true,
      relevanceLabel: 'ellenőrizendő helyi vonatkozás',
      dataQualityFlag: 'ambiguous_identity_multiple_candidates'
    };
  }

  return {
    status: 'unresolved_outside_watched_catalog',
    identityStatus: IDENTITY_STATUSES.UNRESOLVED,
    watchScope: WATCH_SCOPES.UNKNOWN,
    matchState: 'unknown',
    inScope: false,
    certainty: 'unresolved_identity',
    settlementId: null,
    settlementName: cleanName,
    kshSettlementCode: null,
    countyName: cleanCounty,
    isConfirmedLocal: false,
    localRelevanceReason: defaultReason,
    needsLocalReview: true,
    relevanceLabel: 'ellenőrizendő helyi vonatkozás'
  };
}
