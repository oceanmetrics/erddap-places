// what gets precomputed. one entry per (dataset, variable).
//   places: 'all', 'nms' (every NMS:* place, the 18 NOAA sanctuaries / monuments) or an explicit list
//   days  : the window, in days ending at the dataset's last time step, or 'all' for the full record
//           (default DAYS = 'all').
export interface Target {
  dataset : string              // the erddap/<id> collection directory name
  variable: string
  places  : 'all' | 'nms' | string[]
  days   ?: number | 'all'
  note   ?: string
}

/** the 5 reef / tropical places the categorical seascape classes are worth precomputing for. */
export const REEF_PLACES = ['NMS:FKNMS', 'PSGID:939', 'NMS:HIHWNMS', 'NMS:NMSAS', 'NMS:PMNM']

/** the "sanctuaries series": full-record climate variables (re-served USF IMaRS datasets) for every NMS place. */
const SANCTUARY_SERIES: Array<[string, string, string?]> = [
  ['cmems_salinity',              'so',            'surface level'],
  ['cmems_biogeochem_nutrients',  'fe',            'surface level'],
  ['cmems_biogeochem_nutrients',  'no3',           'surface level'],
  ['cmems_biogeochem_nutrients',  'po4',           'surface level'],
  ['cmems_biogeochem_nutrients',  'si',            'surface level'],
  ['cmems_biogeochem_phyto',      'chl',           'surface level'],
  ['cmems_biogeochem_phyto',      'phyc',          'surface level'],
  ['cmems_biogeochem_pp',         'nppv',          'surface level'],
  ['cmems_biogeochem_pp',         'o2',            'surface level'],
  ['cmems_biogeochem_carbon',     'dissic',        'surface level'],
  ['cmems_biogeochem_carbon',     'ph',            'surface level'],
  ['cmems_biogeochem_co2',        'spco2'],
  ['cmems_biogeochem_zoo',        'zooc',          'surface level'],
  ['cmems_altimetry',             'mlotst'],
  ['cmems_altimetry',             'tob',           'bottom temperature'],
  ['IMERG_monthly_global_precip', 'precipitation'],
  ['moda_npp_mo_glob',            'npp'],
]

export const TARGETS: Target[] = [
  { dataset: 'dhw_5km',                  variable: 'CRW_SST', places: 'all' },
  { dataset: 'dhw_5km',                  variable: 'CRW_BAA', places: 'all',
    note: 'categorical bleaching alert area, 0-4' },
  { dataset: 'noaa_aoml_seascapes_8day', variable: 'CLASS',   places: REEF_PLACES,
    note: 'categorical seascape class, 1-33; reef / tropical places only' },
  ...SANCTUARY_SERIES.map(([dataset, variable, note]): Target =>
    ({ dataset, variable, places: 'nms', days: 'all', note: ['sanctuaries series, full record', note].filter(Boolean).join('; ') })),
]

/** a target's place ids, out of every place id in the gazetteer. */
export function placesFor(t: Pick<Target, 'places'>, all: string[]): string[] {
  if (t.places === 'all') return all
  if (t.places === 'nms') return all.filter((id) => id.startsWith('NMS:'))
  return t.places
}

/**
 * default days of history to precompute: the dataset's whole record (Ben, 2026-10-12: the precomputed
 * places should carry every step ERDDAP has, not the last year). Runs are incremental per chunk
 * (stats.ts computeOne), so only the first run fetches the record.
 */
export const DAYS: number | 'all' = 'all'
/** never ask ERDDAP for more than this many time steps in one request (90 days of a daily grid). */
export const MAX_CHUNK_DAYS = 90
/**
 * and shrink the chunk further so a single request (one lobe) stays under this many values: the
 * `n_max_vals_per_req = 100000` of marinebon/extractr `ed_extract()`, which keeps an ERDDAP server
 * responsive with many light requests instead of a few heavy ones. 2 M (until 2026-10-12) let one
 * NMS:PMNM request carry ~20 days x 100k cells, and PacIOOS stalled and dropped those.
 */
export const MAX_REQUEST_VALUES = 100_000
/** concurrent griddap requests (per place; places on one server run one after another). */
export const CONCURRENCY = 2
/** polite pause between griddap requests, ms. */
export const SLEEP_MS = 750

/**
 * when a (dataset, variable, place) fails, its server rests this long before its next request
 * (10 min, then 30, 60, 120 on consecutive failures; a success resets it) and the failed place goes to
 * the back of that server's queue. Other servers keep working meanwhile (precompute.ts, schedule.ts).
 */
export const REST_MS = [10, 30, 60, 120].map((m) => m * 60_000)
/** tries per (dataset, variable, place) in one run; the chunks it finished stay for the next run. */
export const MAX_ATTEMPTS = 3
/** stop starting new work after this many hours (the job's 24 h timeout must leave room to publish). */
export const RUN_HOURS = 21
