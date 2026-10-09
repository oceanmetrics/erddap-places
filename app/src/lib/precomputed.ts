// the weekly precompute (precompute/src/stats.ts) publishes one small Parquet per (dataset, variable,
// place) under <gazetteer>/stats/: the same statistics the browser computes live, for the last 365
// days (the full record for a monthly series). when a place is picked the app shows that WHOLE series in
// the Time strip at once; the window (default: the last 30 days) is only the sub-range the table, the
// exports and the sentence describe, and the map fetches just the latest time slice live (planRun()).
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
 * Show precomputed rows? Only for a grid (a tabledap roll-up is not published) that the collection lists.
 */
export const usePrecomputed = (t: { protocol: string; has: boolean }) => t.protocol === 'griddap' && t.has

/**
 * Do the file's dates cover the start of the window? The file ends at the last weekly refresh, so a
 * window that runs a few days past it still uses what there is ("precomputed to <date>"); a window
 * that starts before the file or after its end would describe a fragment, so it takes the live path.
 */
export const windowCovered = (cov: Coverage | null, win: Window) =>
  !!cov && win.start >= cov.start && win.start <= cov.end

export interface RunPlan {
  /** where the Time strip's series (and the table's window rows) come from */
  strip: 'precomputed' | 'live'
  /** `slice`: fetch only the latest time step for the map; `window`: fetch the whole window slab and compute everything live */
  map  : 'slice' | 'window'
  /** the day of that one step (the window's end, never past the dataset's last step); null for `window` */
  slice: string | null
}

/**
 * The decision of a run, from what is known once the (cached) file has been read: is there a file for the
 * target, what dates does it cover, which window is asked for, and where does the dataset end?
 *   - a listed grid whose file covers the window's start: the whole series is the strip, the window rows
 *     come from it, and the map needs one live slice;
 *   - a window that starts before the file, a missing / empty file, a tabledap target: the live path as
 *     before (the whole window slab, statistics and map from DuckDB).
 * The slice is never past `extentEnd` (the dataset's last step). Without it (ERDDAP's info did not answer,
 * or not yet), it is never past the file's last day, a step the server is known to hold.
 */
export function planRun(t: { protocol: string; has: boolean; coverage: Coverage | null }, win: Window, extentEnd?: string | null): RunPlan {
  if (!usePrecomputed(t) || !windowCovered(t.coverage, win)) return { strip: 'live', map: 'window', slice: null }
  const last = extentEnd ? extentEnd.slice(0, 10) : t.coverage!.end
  return { strip: 'precomputed', map: 'slice', slice: last < win.end ? last : win.end }
}

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
  /** the file's rows shaped like a live run's: the whole series, or only the window when one was given */
  rows: Row[]
  /** first and last date in the whole file (not the window) */
  coverage: Coverage | null
  /** the file's size in bytes */
  bytes: number
}

/** the rows of a shaped series inside [start, end] (inclusive UTC days): the window's share of the whole file. */
export function inWindow(rows: Row[], win: Window): Row[] {
  const lo = ms(win.start), hi = ms(win.end)
  return rows.filter((r) => r.date >= lo && r.date <= hi)
}

/** read stats Parquet bytes (testable without a network). */
export async function readPrecomputed(buf: ArrayBuffer, kind: StatsKind, win?: Window): Promise<Precomputed> {
  const raw = await parquetReadObjects({ file: buf, compressors })
  const all = shapeRows(raw as Row[], kind)
  return { rows: win ? shapeRows(raw as Row[], kind, win) : all,
           coverage: all.length ? { start: ymd(all[0].date), end: ymd(all[all.length - 1].date) } : null,
           bytes: buf.byteLength }
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
 * Fetch and read one precomputed file (the whole series, or restricted to `win`). Throws on any failure (the caller
 * ignores it); `signal` aborts it, and a slow host gives up after `timeoutMs` so it never holds up the live run.
 */
export async function loadPrecomputed(url: string, kind: StatsKind, win?: Window,
                                      opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Precomputed> {
  const { signal, timeoutMs = 6000 } = opts
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  const res = await fetchStats(url, { signal: sig })
  return readPrecomputed(await res.arrayBuffer(), kind, win)
}

export interface LobeAxes { bbox: [number, number, number, number]; lon: number[]; lat: number[] }
export interface Provenance {
  /** when the file was generated (yyyy-mm-dd), the label of the series */
  asOf  : string | null
  /** the last time step the precompute used (an instant the server holds): the map's fallback when ERDDAP's extent does not answer */
  end   : string | null
  /** per lobe, the axis values the mask was computed from (absent before app 0.3.5's precompute) */
  axes  : LobeAxes[] | null
}

const isNums = (a: unknown): a is number[] => Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'number' && Number.isFinite(x))

/** a provenance JSON (precompute `Provenance`) -> what the app uses of it; anything malformed is null. */
export function parseProvenance(j: any): Provenance {
  const axes = Array.isArray(j?.axes) && j.axes.length && j.axes.every((a: any) => isNums(a?.lon) && isNums(a?.lat) && isNums(a?.bbox) && a.bbox.length === 4)
    ? j.axes.map((a: any): LobeAxes => ({ bbox: [...a.bbox] as LobeAxes['bbox'], lon: a.lon, lat: a.lat }))
    : null
  return {
    asOf: typeof j?.generated === 'string' ? j.generated.slice(0, 10) : null,
    end : typeof j?.end_datetime === 'string' ? j.end_datetime : null,
    axes,
  }
}

/**
 * The published axes for these lobes, in the same order, or null when they do not describe them (a
 * different lobe count, or a bbox that moved because the place's polygon changed): the caller then asks
 * ERDDAP for the axes as before. The lobes are placeLobes() of the same places.parquet the precompute
 * read, so they match bit for bit; the tolerance only absorbs a JSON round trip.
 */
export function lobeAxes(axes: LobeAxes[] | null | undefined, lobes: ReadonlyArray<{ bbox: readonly number[] }>): LobeAxes[] | null {
  if (!axes || axes.length !== lobes.length) return null
  const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9)
  return axes.every((a, i) => same(a.bbox, lobes[i].bbox)) ? axes : null
}

/** the file's provenance JSON (`generated`, `end_datetime`, `axes`); all null on any failure; never throws. */
export async function loadProvenance(url: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Provenance> {
  const { signal, timeoutMs = 6000 } = opts
  try {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    return parseProvenance(await (await fetchStats(provenanceUrl(url), { signal: sig })).json())
  } catch { return { asOf: null, end: null, axes: null } }
}

/** When the file was generated, from its provenance JSON: the date to label it with. null on any failure; never throws. */
export async function precomputedAsOf(url: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string | null> {
  return (await loadProvenance(url, opts)).asOf
}

/**
 * the strip header's words for a series that came from a published file, while the map is the live
 * latest slice: "precomputed to 6 Oct 2026 · map: live 8 Oct 2026". `compact` (a phone) drops the
 * words and the shared year: "precomputed 6 Oct · map 8 Oct". `mapDate` null = the slice is still loading;
 * `failed` = it did not load (the series stays).
 */
export function sourceLabel(s: { through: string; mapDate?: string | null; failed?: boolean }, fmtDay: (d: string) => string, compact = false): string {
  const a = fmtDay(s.through), b = s.mapDate ? fmtDay(s.mapDate) : ''
  const year = (x: string) => x.slice(-4)
  if (compact) {
    const short = (x: string, other: string) => (other && year(x) === year(other) ? x.slice(0, -5) : x)
    return `precomputed ${short(a, b)}` + (b ? ` · map ${short(b, a)}` : s.failed ? ' · map failed' : '')
  }
  return `precomputed to ${a} · map: ` + (s.failed ? 'unavailable' : b ? `live ${b}` : 'loading…')
}
