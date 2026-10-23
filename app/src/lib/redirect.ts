// the redirect map of the freeze (2026-10-22): an erddap-places hash -> the Ocean Metrics Indicators
// URL that shows the same thing. Written, NOT activated: nothing in the app navigates by it, the
// freeze banner only offers the link. The table and the reason for each rule: ../../docs/redirects.md. The page that will
// call it (static/redirect/redirect.js, shared with obis-hex; bundled to dist/redirect/codec.js) is written, not linked.
//
//   Statistics   #place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&stat=mean_wt&from=…&to=…
//     -> https://oceanmetrics.io/indicators/#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:mean
//   Then vs Now  #lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=2024&swipe=0.35
//     -> https://oceanmetrics.io/indicators/#view=map&ind=erddap:dhw_5km:CRW_SST:mean&place=NMS:FKNMS&grain=month
//        &layer=grid:dhw_5km:CRW_SST&pal=spectral_r&t=2024-08&t2=1985-2005&swipe=0.35
//     the Map's compare mode (build week 2): `t` is Now's month, `t2` Then (a period or a year range, averaged per cell),
//     `swipe` the handle, `anom=1` the difference; not exact (a month, not a day of the year)
//
// the Place view's keys are indicators' `view=place&place=&coll=&ind=` and the Map's `view=map&ind=&place=&grain=&layer=
// &pal=&t=&t2=&anom=|swipe=` (indicators/viewer/src/lib/hash.ts, in the order it writes them), and its indicator ids are
// `erddap:<dataset id>:<variable>:<stat>` (indicators/config/indicators.yml).

import { decodeThenNow, parseRange, type ThenNowState } from './thenNow/state'

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
export const NOTE_THEN_NOW = 'Then vs Now opens as the Map\'s compare mode, by month: the day of the year (md) is read as its month'
export const NOTE_LATEST   = 'Now is the layer\'s latest month, not the month of md'
export const NOTE_RANGE    = 'a Then of more than 12 years is the mean of its first 12 (the Map averages at most 12 periods)'
export const NOTE_ANOM     = 'the difference reads Then minus Now (the Map\'s t2 - t), the sign of Now minus Then reversed'
export const NOTE_NO_PLACE = 'this link names no place; Indicators opens on its matrix'

/** the dataset and variable of the app's opening view (App.svelte, state.ts DEFAULTS) */
const DEFAULT_DATASET  = 'dhw_5km'
const DEFAULT_VARIABLE = 'CRW_SST'
/** Then vs Now's palettes -> the ramps of @oceanmetrics/map: its Spectral is the reversed one (red = warm) */
const PAL_MAP: Readonly<Record<string, string>> = { spectral: 'spectral_r', viridis: 'viridis' }

/** the Map's compare link of a Then vs Now state (the keys in the order indicators' serializeHash writes them) */
function compareUrl(origin: string, s: ThenNowState): { url: string; notes: string[] } {
  const notes = [NOTE_THEN_NOW]
  const variable = s.variable || DEFAULT_VARIABLE
  const parts = ['view=map', 'ind=' + indId(DEFAULT_DATASET, variable, 'mean'), 'place=' + enc(s.place), 'grain=month',
    `layer=grid:${enc(DEFAULT_DATASET)}:${enc(variable)}`, 'pal=' + (PAL_MAP[s.pal] ?? PAL_MAP.spectral)]
  const month = s.md.slice(0, 2)
  if (s.now === 'latest') notes.push(NOTE_LATEST)
  else parts.push(`t=${s.now}-${month}`)
  parts.push('t2=' + s.then)
  const r = parseRange(s.then)
  if (r && r[1] - r[0] + 1 > 12) notes.push(NOTE_RANGE)
  if (s.anom) { parts.push('anom=1'); notes.push(NOTE_ANOM) }
  else if (Math.round(s.swipe * 1000) !== 500) parts.push('swipe=' + Math.round(s.swipe * 1000) / 1000)
  return { url: `${base(origin)}/indicators/#${parts.join('&')}`, notes }
}

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
 * Indicators matrix. In Statistics the keys that carry no data (`show`, `hide`, `data`, `lens`, `mode`) are dropped
 * without a note; Then vs Now's `md`, `then`, `now`, `swipe`, `anom` and `pal` become the Map's `t`, `t2`, `swipe`,
 * `anom` and `pal` (its `data` and pane keys are dropped).
 */
export function redirectFor(hash: string, origin: string = OM_ORIGIN): Redirect {
  const p = params(hash)
  const lens = p.get('lens') ?? p.get('mode')
  const place = (p.get('place') ?? '').trim()
  const coll  = (p.get('coll') ?? '').trim()
  const notes: string[] = []

  if (lens === 'then-now') {
    if (!place) {
      notes.push(NOTE_THEN_NOW, NOTE_NO_PLACE)
      return { url: `${base(origin)}/indicators/`, exact: false, note: notes.join('; ') }
    }
    // the state as Then vs Now reads it: a missing or malformed key takes its default (md 08-05, then 1985-2005, now latest)
    const s = decodeThenNow('#' + p.toString())
    const c = compareUrl(origin, { ...s, place, variable: (p.get('variable') ?? '').trim() || DEFAULT_VARIABLE })
    return { url: c.url, exact: false, note: c.notes.join('; ') }
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
