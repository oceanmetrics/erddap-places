// the run, in the URL hash: place, dataset, variable and window, so a shared link reproduces it.
//
// everything the app needs to repeat a run is five short strings, and none of them is secret, so the
// hash is a plain `key=value&…` list. place ids carry a colon (`NMS:HIHWNMS`) and dataset ids a
// slash (`erddap/dhw_5km`); both are left literal in the written hash (they are legal in a fragment
// and make the link readable) while everything else is percent-encoded, and reading accepts either.

export interface RunState {
  place   : string   // place_id, e.g. NMS:HIHWNMS
  dataset : string   // STAC collection id, e.g. erddap/dhw_5km
  variable: string   // e.g. CRW_SST
  from    : string   // yyyy-mm-dd
  to      : string   // yyyy-mm-dd
}
export const RUN_KEYS = ['place', 'dataset', 'variable', 'from', 'to'] as const

/** `#place=NMS:HIHWNMS&dataset=erddap/dhw_5km&variable=CRW_SST&from=…&to=…` (empty fields dropped). */
export function encodeHash(state: Partial<RunState>): string {
  const p = new URLSearchParams()
  for (const k of RUN_KEYS) { const v = state[k]; if (v) p.set(k, String(v)) }
  const s = p.toString().replace(/%3A/gi, ':').replace(/%2F/gi, '/')
  return s ? `#${s}` : ''
}

/** the run fields present in a hash (or a whole URL); unknown keys and empty values are ignored. */
export function decodeHash(hash: string): Partial<RunState> {
  const h = String(hash ?? '')
  const q = h.slice(h.indexOf('#') + 1)
  if (!q || h.indexOf('#') < 0) return {}
  const p = new URLSearchParams(q)
  const out: Partial<RunState> = {}
  for (const k of RUN_KEYS) { const v = p.get(k); if (v) out[k] = v }
  return out
}

/** the current permalink for a run, given a base URL (defaults to the page, hash stripped). */
export function permalink(state: Partial<RunState>, href?: string): string {
  const base = (href ?? (typeof location === 'undefined' ? '' : location.href)).split('#')[0]
  return base + encodeHash(state)
}
