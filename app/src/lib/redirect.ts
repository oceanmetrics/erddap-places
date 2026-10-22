// the redirect map of the freeze (2026-10-22): an erddap-places hash -> the Ocean Metrics Indicators
// URL that shows the same thing. Written, NOT activated: nothing in the app navigates by it, the
// freeze banner only offers the link. The table and the reason for each rule: ../../docs/redirects.md.
//
//   Statistics   #place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&stat=mean_wt&from=…&to=…
//     -> https://oceanmetrics.io/indicators/#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:mean
//   Then vs Now  #lens=then-now&place=NMS:FKNMS&variable=CRW_SST&…
//     -> the same Place view (dataset dhw_5km, statistic mean), not exact until build week 2
//
// the Place view's keys are indicators' `view=place&place=&coll=&ind=` (indicators/viewer/src/lib/hash.ts),
// and its indicator ids are `erddap:<dataset id>:<variable>:<stat>` (indicators/config/indicators.yml).

export const OM_ORIGIN = 'https://oceanmetrics.io'

export interface Redirect {
  /** where the same view lives in Ocean Metrics */
  url: string
  /** true when the target shows the same data the old link did (a window or a slice may differ) */
  exact: boolean
  /** what the target does not carry, when `exact` is false; several reasons are joined with "; " */
  note?: string
}

/** the statistics the app writes (`stat=`) -> the statistic of an Indicators id. `mean_wt` is the area-weighted
 * mean, the record of Ocean Metrics (`mean`); the app's plain `mean` is the unweighted one (`mean_unw`). */
export const STAT_MAP: Readonly<Record<string, string>> = {
  mean_wt: 'mean', mean: 'mean_unw', min: 'min', max: 'max', p10: 'p10', p90: 'p90', sd: 'sd',
}

export const NOTE_WINDOW   = 'the window is not carried; the Place view shows the full record'
export const NOTE_THEN_NOW = 'the slice arrives in build week 2 (2026-11-06 to 11-12)'
export const NOTE_NO_PLACE = 'this link names no place; Indicators opens on its matrix'

/** the dataset and variable of the app's opening view (App.svelte, state.ts DEFAULTS) */
const DEFAULT_DATASET  = 'dhw_5km'
const DEFAULT_VARIABLE = 'CRW_SST'

/** the key/value pairs of a hash (with or without its `#`); a bare query string is read as the hash */
function params(hash: string): URLSearchParams {
  const h = String(hash ?? '')
  const i = h.indexOf('#')
  return new URLSearchParams(i < 0 ? h.replace(/^\?/, '') : h.slice(i + 1))
}

/** encodeURIComponent with the readable `:` and `|` kept, as Indicators writes its hashes */
const enc = (s: string) => encodeURIComponent(s).replace(/%3A/gi, ':').replace(/%7C/gi, '|')

const base = (origin: string) => String(origin || OM_ORIGIN).replace(/\/+$/, '')

/** `erddap/dhw_5km` -> `dhw_5km` */
const datasetId = (d: string) => d.replace(/^erddap\//, '')

/** the Place view of Indicators for a place (and, when given, its collection and an indicator) */
function placeUrl(origin: string, place: string, coll: string, ind: string): string {
  const parts = ['view=place', 'place=' + enc(place)]
  if (coll) parts.push('coll=' + enc(coll))
  if (ind) parts.push('ind=' + ind)
  return `${base(origin)}/indicators/#${parts.join('&')}`
}

const indId = (dataset: string, variable: string, stat: string) => `erddap:${enc(datasetId(dataset))}:${enc(variable)}:${enc(stat)}`

/**
 * Where an erddap-places hash lives in Ocean Metrics. Never throws: an empty or unknown hash gives the
 * Indicators matrix. Keys that carry no data (`show`, `hide`, `md`, `then`, `now`, `swipe`, `anom`, `pal`,
 * `data`, `lens`, `mode`) are dropped without a note, except where the table says otherwise.
 */
export function redirectFor(hash: string, origin: string = OM_ORIGIN): Redirect {
  const p = params(hash)
  const lens = p.get('lens') ?? p.get('mode')
  const place = (p.get('place') ?? '').trim()
  const coll  = (p.get('coll') ?? '').trim()
  const notes: string[] = []

  if (lens === 'then-now') {
    notes.push(NOTE_THEN_NOW)
    if (!place) {
      notes.push(NOTE_NO_PLACE)
      return { url: `${base(origin)}/indicators/`, exact: false, note: notes.join('; ') }
    }
    const variable = (p.get('variable') ?? '').trim() || DEFAULT_VARIABLE
    return { url: placeUrl(origin, place, '', indId(DEFAULT_DATASET, variable, 'mean')), exact: false, note: notes.join('; ') }
  }

  if (!place) return { url: `${base(origin)}/indicators/`, exact: false, note: NOTE_NO_PLACE }

  const dataset  = (p.get('dataset') ?? '').trim() || DEFAULT_DATASET
  const variable = (p.get('variable') ?? '').trim() || DEFAULT_VARIABLE
  const statQ    = p.get('stat')
  const stat     = statQ === null || statQ === '' ? STAT_MAP.mean_wt : STAT_MAP[statQ]
  if (stat === undefined) notes.push(`the statistic "${statQ}" is not one of the app's; the area-weighted mean is shown`)
  if (p.get('from') || p.get('to')) notes.push(NOTE_WINDOW)
  const out: Redirect = { url: placeUrl(origin, place, coll, indId(dataset, variable, stat ?? STAT_MAP.mean_wt)), exact: notes.length === 0 }
  if (notes.length) out.note = notes.join('; ')
  return out
}
