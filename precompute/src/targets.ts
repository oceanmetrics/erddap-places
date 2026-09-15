// what gets precomputed. one entry per (dataset, variable); `places` is 'all' or an explicit list.
export interface Target {
  dataset : string              // the erddap/<id> collection directory name
  variable: string
  places  : 'all' | string[]
  note   ?: string
}

/** the 5 reef / tropical places the categorical seascape classes are worth precomputing for. */
export const REEF_PLACES = ['NMS:FKNMS', 'PSGID:939', 'NMS:HIHWNMS', 'NMS:NMSAS', 'NMS:PMNM']

export const TARGETS: Target[] = [
  { dataset: 'dhw_5km',                  variable: 'CRW_SST', places: 'all' },
  { dataset: 'dhw_5km',                  variable: 'CRW_BAA', places: 'all',
    note: 'categorical bleaching alert area, 0-4' },
  { dataset: 'noaa_aoml_seascapes_8day', variable: 'CLASS',   places: REEF_PLACES,
    note: 'categorical seascape class, 1-33; reef / tropical places only' },
]

/** days of history to precompute (clamped to the dataset's own live extent). */
export const DAYS = 365
/** never ask ERDDAP for more than this many days in one request. */
export const MAX_CHUNK_DAYS = 90
/** and shrink the chunk further so a single request stays under this many grid rows. */
export const MAX_CHUNK_ROWS = 2_000_000
/** concurrent griddap requests (per place). */
export const CONCURRENCY = 2
/** polite pause between griddap requests, ms. */
export const SLEEP_MS = 750
