// the view around a lens, in the URL hash: which lens, which panes are open, and the compatibility
// shim for links written before the lenses shared one page.
//
//   #place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&from=…&to=…          statistics (default lens)
//   #lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&…      Then vs Now
//   …&show=table&hide=controls,time                                               panes that differ from the default
//
// the old key `mode=` (`#mode=then-now`, `#mode=stats`) still opens the same view; it is rewritten to
// `lens=` (or dropped, for the default lens) on load by migrateHash().

export type Lens = 'stats' | 'then-now'
export const LENSES: readonly Lens[] = ['stats', 'then-now'] as const
export const LENS_LABEL: Record<Lens, string> = { 'stats': 'Statistics', 'then-now': 'Then vs Now' }

/** the panes of a lens: the Controls pane, the bottom Time strip and the right-edge pill. */
export type PaneId = 'controls' | 'time' | 'side'
export type Panes = Record<PaneId, boolean>
/** the name the URL uses for the right-edge pane of each lens */
export const SIDE_NAME: Record<Lens, string> = { 'stats': 'table', 'then-now': 'exceedance' }
/** the viewport width below which the kit's panes become bottom sheets (one open at a time) */
export const SHEET_BELOW = 640
/**
 * The panes a lens starts with. On a phone the panes are bottom sheets that cover the map, so they
 * start as bars whatever the link says; the link's own choice is kept for the URL (see paneUrlState).
 */
export function initialPanes(fromUrl: Panes, viewportWidth: number): Panes {
  return viewportWidth < SHEET_BELOW ? { controls: false, time: false, side: false } : { ...fromUrl }
}
/**
 * The panes to write into the URL: on a phone the sheets fold and unfold each other (an accordion),
 * which says nothing about the view, so the link keeps the panes it came with.
 */
export function paneUrlState(live: Panes, fromUrl: Panes, viewportWidth: number): Panes {
  return viewportWidth < SHEET_BELOW ? fromUrl : live
}
/** open by default: Controls and Time; the right-edge pane starts folded to its pill */
export const PANE_DEFAULTS: Panes = { controls: true, time: true, side: false }

const params = (hash: string) => {
  const h = String(hash ?? '')
  const i = h.indexOf('#')
  return new URLSearchParams(i < 0 ? '' : h.slice(i + 1))
}
/** write params back with the readable `:` and `/` the app's links have always used. */
export const toHash = (p: URLSearchParams) => {
  const s = p.toString().replace(/%3A/gi, ':').replace(/%2F/gi, '/').replace(/%2C/gi, ',')
  return s ? `#${s}` : ''
}

/** the lens a hash (or a whole URL) asks for: `lens=` first, then the old `mode=`, else statistics. */
export function lensOf(hash: string): Lens {
  const p = params(hash)
  const v = p.get('lens') ?? p.get('mode')
  return v === 'then-now' ? 'then-now' : 'stats'
}

/**
 * The compatibility shim: `mode=then-now` becomes `lens=then-now` in the same place in the list,
 * `mode=stats` (and `lens=stats`, the default) is dropped. Every other key is kept as it was.
 * Returns the hash unchanged when there is nothing to rewrite.
 */
export function migrateHash(hash: string): string {
  const p = params(hash)
  if (!p.has('mode') && p.get('lens') !== 'stats') return String(hash ?? '')
  const out = new URLSearchParams()
  for (const [k, v] of p) {
    if (k === 'mode' || k === 'lens') {
      if (v === 'then-now' && !out.has('lens')) out.set('lens', 'then-now')
      continue
    }
    out.append(k, v)
  }
  return toHash(out)
}

/** which panes are open: the defaults, overridden by `show=` and `hide=` (comma lists). */
export function decodePanes(hash: string, lens: Lens): Panes {
  const p = params(hash)
  const out: Panes = { ...PANE_DEFAULTS }
  const name = (n: string): PaneId | null =>
    n === 'controls' || n === 'time' ? n : n === 'side' || n === SIDE_NAME[lens] ? 'side' : null
  for (const n of (p.get('show') ?? '').split(',')) { const id = name(n.trim()); if (id) out[id] = true }
  for (const n of (p.get('hide') ?? '').split(',')) { const id = name(n.trim()); if (id) out[id] = false }
  return out
}

/** `show=` / `hide=` for the panes that differ from the default (empty strings when none do). */
export function encodePanes(panes: Panes, lens: Lens): { show: string; hide: string } {
  const ids: PaneId[] = ['controls', 'time', 'side']
  const nm = (id: PaneId) => (id === 'side' ? SIDE_NAME[lens] : id)
  return {
    show: ids.filter((id) => panes[id] && !PANE_DEFAULTS[id]).map(nm).join(','),
    hide: ids.filter((id) => !panes[id] && PANE_DEFAULTS[id]).map(nm).join(','),
  }
}

/** a hash with the pane keys (and any other extras) set, dropping the empty ones. */
export function withExtras(hash: string, extras: Record<string, string | undefined | null>): string {
  const p = params(hash)
  for (const [k, v] of Object.entries(extras)) { if (v) p.set(k, v); else p.delete(k) }
  return toHash(p)
}

/** the value of one key in a hash, or null. */
export const hashParam = (hash: string, key: string) => params(hash).get(key)

/**
 * The hash to open another lens with, carrying the place over when the other lens has it.
 * Then vs Now has rasters for the national marine sanctuaries only (and not TBNMS), so any other
 * place falls back to that lens's default; statistics opens CRW SST, the variable Then vs Now shows.
 */
export function lensHash(to: Lens, carry: { place?: string; variable?: string; panes?: Panes } = {}): string {
  const p = new URLSearchParams()
  if (to === 'then-now') {
    p.set('lens', 'then-now')
    if (carry.place && /^NMS:/.test(carry.place) && carry.place !== 'NMS:TBNMS') p.set('place', carry.place)
  } else {
    if (carry.place) p.set('place', carry.place)
    p.set('dataset', 'erddap/dhw_5km')
    p.set('variable', carry.variable || 'CRW_SST')
  }
  if (carry.panes) {
    const { show, hide } = encodePanes(carry.panes, to)
    if (show) p.set('show', show)
    if (hide) p.set('hide', hide)
  }
  return toHash(p)
}

/**
 * Room around a fitted place so the Controls pane and the Time strip do not cover it: the pane
 * width on the left and the strip height at the bottom when they are open; a phone (bottom sheets)
 * only keeps a small margin.
 */
export function fitPadding(viewportWidth: number, panes: Panes, stripHeight: number, controlsWidth = 390) {
  if (viewportWidth < SHEET_BELOW) return { top: 20, bottom: 140, left: 20, right: 20 }   // the sheet bars
  return { top: 30, right: 60, left: panes.controls ? controlsWidth + 30 : 30, bottom: panes.time ? stripHeight + 80 : 60 }
}
