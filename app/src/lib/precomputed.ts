// the weekly precompute (precompute/src/stats.ts) publishes one small Parquet per (dataset, variable,
// place) under <gazetteer>/stats/: the same statistics the browser computes live, for the last 365
// days. when a place is picked the app shows those rows at once, then the live run replaces them.
//
// everything here is plain and tested: the URL, the "is there a file" question (answered from the
// published stats/collection.json, never a HEAD per run), the window rule, and the shaping of file
// rows into the exact row objects the Time strip and the table already consume.
//   - read with hyparquet (pure JS, already loaded for places.parquet), not DuckDB-WASM: the rows
//     are on screen before the WASM engine has even finished starting
import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { GAZETTEER_BASE, GAZETTEER_FALLBACK } from './gazetteer'

export type Row = Record<string, any>
export type StatsKind = 'continuous' | 'categorical'

// ── names ─────────────────────────────────────────────────────────────────────
/** `stats/<dataset_id>/<variable>/<place_id>.parquet`; the place id keeps its colon (legal in a URL path). */
export const precomputedPath = (datasetId: string, variable: string, placeId: string, ext = 'parquet') =>
  `stats/${encodeURIComponent(datasetId)}/${encodeURIComponent(variable)}/${encodeURIComponent(placeId).replace(/%3A/gi, ':')}.${ext}`

/**
 * the published file for a target, straight from the bucket (trailing-slash `base`): the storage host
 * only 302s to it, and that redirect carries no CORS header, so the bucket URL is the one that is
 * safe from every origin (and saves a hop). fetchStats() retries the storage host if the bucket fails.
 */
export const precomputedUrl = (datasetId: string, variable: string, placeId: string, base = GAZETTEER_FALLBACK) =>
  base + precomputedPath(datasetId, variable, placeId)

/** the sibling provenance JSON of a stats Parquet URL. */
export const provenanceUrl = (url: string) => url.replace(/\.parquet$/, '.provenance.json')

/** the STAC Item id the precompute gives a target (stats.ts `itemId()`): no colon, safe in a file name. */
export const itemId = (datasetId: string, variable: string, placeId: string) =>
  `${datasetId}_${variable}_${placeId.replace(/:/g, '-')}`

// ── what exists ───────────────────────────────────────────────────────────────
/** the Item ids a stats/collection.json lists (its `rel: "item"` links: the published truth). */
export function parseStatsCollection(json: any): Set<string> {
  const out = new Set<string>()
  for (const l of Array.isArray(json?.links) ? json.links : [])
    if (l?.rel === 'item' && typeof l.href === 'string') {
      const m = /([^/]+)\.json$/.exec(l.href)
      if (m) out.add(m[1])
    }
  return out
}

/** is there a precomputed file for this target, according to a parsed collection? */
export const hasPrecomputed = (index: ReadonlySet<string> | null | undefined, datasetId: string, variable: string, placeId: string) =>
  !!index && index.has(itemId(datasetId, variable, placeId))

let indexPromise: Promise<Set<string>> | null = null
/**
 * The set of precomputed Item ids, fetched once per page load and cached (a failure caches an empty
 * set: no retries, no noise, the live run is unaffected). `fetchFn` is for tests.
 */
export function precomputedIndex(fetchFn: (path: string) => Promise<Response> = (p) => fetchStats(GAZETTEER_FALLBACK + p)): Promise<Set<string>> {
  indexPromise ??= fetchFn('stats/collection.json')
    .then((r) => r.json())
    .then(parseStatsCollection)
    .catch((e) => { console.debug('precomputed: no stats collection', e); return new Set<string>() })
  return indexPromise
}
/** forget the cached index (tests). */
export const resetPrecomputedIndex = () => { indexPromise = null }

// ── should the run use it? ────────────────────────────────────────────────────
export interface Coverage { start: string; end: string }   // YYYY-MM-DD, first and last date in the file
export interface Window   { start: string; end: string }

/**
 * Show precomputed rows before the live run? Only for a grid (a tabledap roll-up is not published)
 * that the collection lists.
 */
export const usePrecomputed = (t: { protocol: string; has: boolean }) => t.protocol === 'griddap' && t.has

/**
 * Do the file's dates cover the start of the window? The file ends at the last weekly refresh, so a
 * window that runs a few days past it still shows what there is ("precomputed to <date>"); a window
 * that starts before the file or after its end would show a misleading fragment, so it waits for the live run.
 */
export const windowCovered = (cov: Coverage | null, win: Window) =>
  !!cov && win.start >= cov.start && win.start <= cov.end

// ── rows ──────────────────────────────────────────────────────────────────────
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))   // bigint -> number, as the engine does
const ms  = (d: unknown) => (d instanceof Date ? d.getTime() : Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`))
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * File rows -> the rows the live run produces (sql/stats_daily.sql, sql/stats_categorical.sql): `date`
 * is epoch ms of the UTC day, categorical `frac_area` / `pct_cells` are `fraction` / `percent_cells`.
 * Sorted by date (then class). `win` keeps only [start, end], inclusive.
 */
export function shapeRows(raw: Row[], kind: StatsKind, win?: Window): Row[] {
  const lo = win ? ms(win.start) : -Infinity, hi = win ? ms(win.end) : Infinity
  const rows = raw.map((r): Row => kind === 'categorical'
    ? { date: ms(r.date), class: num(r.class), n: num(r.n), weight: num(r.weight),
        fraction: num(r.frac_area), percent_cells: num(r.pct_cells) }
    : { date: ms(r.date), n: num(r.n), mean: num(r.mean), mean_wt: num(r.mean_wt), sd: num(r.sd),
        min: num(r.min), max: num(r.max), p10: num(r.p10), p90: num(r.p90), weight_sum: num(r.weight_sum) })
  return rows.filter((r) => r.date >= lo && r.date <= hi)
             .sort((a, b) => a.date - b.date || (a.class ?? 0) - (b.class ?? 0))
}

export interface Precomputed {
  /** rows inside the window, shaped like a live run's */
  rows: Row[]
  /** first and last date in the whole file (not the window) */
  coverage: Coverage | null
}

/** read stats Parquet bytes (testable without a network). */
export async function readPrecomputed(buf: ArrayBuffer, kind: StatsKind, win?: Window): Promise<Precomputed> {
  const raw = await parquetReadObjects({ file: buf, compressors })
  const all = shapeRows(raw as Row[], kind)
  return { rows: win ? shapeRows(raw as Row[], kind, win) : all,
           coverage: all.length ? { start: ymd(all[0].date), end: ymd(all[all.length - 1].date) } : null }
}

/** fetch `url`; if it is under the bucket and fails, retry the same path on the storage host. */
async function fetchStats(url: string, init?: RequestInit): Promise<Response> {
  const attempts = url.startsWith(GAZETTEER_FALLBACK) ? [url, GAZETTEER_BASE + url.slice(GAZETTEER_FALLBACK.length)] : [url]
  let last: unknown
  for (const u of attempts) {
    try { const res = await fetch(u, init); if (res.ok) return res; last = new Error(`${u}: ${res.status}`) }
    catch (e) { if ((e as any)?.name === 'AbortError') throw e; last = e }
  }
  throw last
}

/**
 * Fetch and read one precomputed file, restricted to the window. Throws on any failure (the caller
 * ignores it); `signal` aborts it, and a slow host gives up after `timeoutMs` so it never holds up the live run.
 */
export async function loadPrecomputed(url: string, kind: StatsKind, win?: Window,
                                      opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Precomputed> {
  const { signal, timeoutMs = 6000 } = opts
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  const res = await fetchStats(url, { signal: sig })
  return readPrecomputed(await res.arrayBuffer(), kind, win)
}

/**
 * When the file was generated, from its provenance JSON (`generated`, an ISO instant): the date to
 * label it with. null on any failure; never throws.
 */
export async function precomputedAsOf(url: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string | null> {
  const { signal, timeoutMs = 6000 } = opts
  try {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    const j = await (await fetchStats(provenanceUrl(url), { signal: sig })).json()
    return typeof j?.generated === 'string' ? j.generated.slice(0, 10) : null
  } catch { return null }
}

/** the strip header's words for rows that came from a published file. `failed`: the live run did not complete. */
export function sourceLabel(s: { through: string; asOf?: string | null; failed?: boolean }, fmtDay: (d: string) => string): string {
  return `precomputed to ${fmtDay(s.through)}; ${s.failed ? 'live refresh failed' : 'refreshing…'}`
}
