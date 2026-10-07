// what gets precomputed. one entry per (dataset, variable).
//   places: 'all', 'nms' (every NMS:* place, the 18 NOAA sanctuaries / monuments) or an explicit list
//   days  : the window, in days ending at the dataset's last time step, or 'all' for the full record
//           (default DAYS). the monthly sanctuary-series products use 'all'.
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

/** default days of history to precompute (clamped to the dataset's own live extent). */
export const DAYS = 365
/** never ask ERDDAP for more than this many time steps in one request (90 days of a daily grid). */
export const MAX_CHUNK_DAYS = 90
/** and shrink the chunk further so a single request stays under this many grid rows. */
export const MAX_CHUNK_ROWS = 2_000_000
/** concurrent griddap requests (per place). */
export const CONCURRENCY = 2
/** polite pause between griddap requests, ms. */
export const SLEEP_MS = 750
