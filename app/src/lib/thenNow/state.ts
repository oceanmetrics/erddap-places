// the then-now view in the URL hash, like the rest of the app:
//
//   #lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=latest&swipe=0.5&anom=0
//
// (written `lens=then-now` since the lenses share one page; the older `mode=then-now` still reads,
// and the shell rewrites it on load: see ../view.ts)
// `then` is a published climatology baseline (`1985-2005`, `2003-2012`) or any custom `y0-y1`
// range (averaged in the browser); `now` is `latest` (the newest year in the archive) or a year.

export const MODE = 'then-now'
/** the hash key that names the lens (`mode` before 2026-10, still read) */
export const LENS_KEY = 'lens'
export const BASELINES = ['1985-2005', '2003-2012'] as const

export interface ThenNowState {
  place   : string                 // place_id, e.g. NMS:FKNMS
  dataset : string                 // raster dataset folder, e.g. dhw_5km
  variable: string                 // e.g. CRW_SST
  md      : string                 // MM-DD
  then    : string                 // a baseline name or a custom `y0-y1`
  now     : 'latest' | number
  swipe   : number                 // 0..1, the slider's share of the map width (Then on the left)
  anom    : boolean                // show Now - Then instead of the swipe
  pal     : 'spectral' | 'viridis'
  /** another data root (trailing slash), e.g. the dev fixture `/src/lib/thenNow/fixtures/`; '' = the gazetteer */
  data    : string
}

export const DEFAULTS: ThenNowState = {
  place: 'NMS:FKNMS', dataset: 'dhw_5km', variable: 'CRW_SST', md: '08-05',
  then: '1985-2005', now: 'latest', swipe: 0.5, anom: false, pal: 'spectral', data: '',
}

/** is this hash (or URL) asking for the then-now view? */
export function isThenNowHash(hash: string): boolean {
  const h = String(hash ?? '')
  const i = h.indexOf('#')
  if (i < 0) return false
  const p = new URLSearchParams(h.slice(i + 1))
  return (p.get(LENS_KEY) ?? p.get('mode')) === MODE
}

/** `1985-2005` -> [1985, 2005]; null for anything that is not an ordered pair of years. */
export function parseRange(s: string): [number, number] | null {
  const m = /^(\d{4})-(\d{4})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const a = Number(m[1]), b = Number(m[2])
  return a <= b ? [a, b] : null
}

/** a published climatology (one file read) or a custom range (one read per year, averaged here). */
export const isBaseline = (then: string, baselines: readonly string[] = BASELINES) => baselines.includes(then)

export function encodeThenNow(s: ThenNowState): string {
  const p = new URLSearchParams()
  p.set(LENS_KEY, MODE)
  p.set('place', s.place)
  if (s.dataset !== DEFAULTS.dataset) p.set('dataset', s.dataset)
  p.set('variable', s.variable)
  p.set('md', s.md)
  p.set('then', s.then)
  p.set('now', String(s.now))
  p.set('swipe', String(Math.round(s.swipe * 1000) / 1000))
  p.set('anom', s.anom ? '1' : '0')
  if (s.pal !== DEFAULTS.pal) p.set('pal', s.pal)
  if (s.data) p.set('data', s.data)
  return '#' + p.toString().replace(/%3A/gi, ':').replace(/%2F/gi, '/')
}

/** the then-now state in a hash, every missing or malformed field taking its default. */
export function decodeThenNow(hash: string, defaults: ThenNowState = DEFAULTS): ThenNowState {
  const h = String(hash ?? '')
  const p = new URLSearchParams(h.includes('#') ? h.slice(h.indexOf('#') + 1) : '')
  const get = (k: string) => p.get(k) ?? undefined
  const md = get('md')
  const okMd = md && /^\d{2}-\d{2}$/.test(md) && !Number.isNaN(Date.parse(`2000-${md}T00:00:00Z`)) &&
               new Date(`2000-${md}T00:00:00Z`).toISOString().slice(5, 10) === md
  const then = get('then')
  const nowS = get('now')
  const now  = nowS === 'latest' ? 'latest' : /^\d{4}$/.test(nowS ?? '') ? Number(nowS) : defaults.now
  const sw   = Number(get('swipe'))
  const pal  = get('pal')
  return {
    place   : get('place') ?? defaults.place,
    dataset : get('dataset') ?? defaults.dataset,
    variable: get('variable') ?? defaults.variable,
    md      : okMd ? md! : defaults.md,
    then    : then && (isBaseline(then) || parseRange(then)) ? then : defaults.then,
    now,
    swipe   : get('swipe') !== undefined && Number.isFinite(sw) ? Math.min(1, Math.max(0, sw)) : defaults.swipe,
    anom    : get('anom') !== undefined ? get('anom') === '1' || get('anom') === 'true' : defaults.anom,
    pal     : pal === 'viridis' || pal === 'spectral' ? pal : defaults.pal,
    data    : get('data') ?? defaults.data,
  }
}
