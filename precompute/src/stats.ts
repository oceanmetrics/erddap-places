// precompute one (dataset, variable, place) statistic table.
//
// this is the browser app's Run button, headless: the SAME modules do the work, so a precomputed
// parquet and a live in-browser run agree cell for cell.
//   app/src/lib/gazetteer.ts  placeLobes()  - one griddap request area per polygon lobe
//   app/src/lib/erddap.ts     griddapUrl()  - the request URL, fetchAxis() - the axis vectors
//   app/src/lib/gridMask.ts   gridMask()    - which cells are in, and their partial-area weight
//   app/src/lib/extent.ts     the live time extent and the clamping
//   sql/stats_*.sql           the aggregation itself
// only the engine differs: native DuckDB here, DuckDB-WASM there.
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync, rmSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'

import { gridMask, type MaskCell }            from '../../app/src/lib/gridMask'
import { fetchAxis, griddapUrl, noonZ }       from '../../app/src/lib/erddap'
import { placeLobes, plainPlace, loadPlaces } from '../../app/src/lib/gazetteer'
import type { Lobe, Place }                   from '../../app/src/lib/gazetteer'
import { lobeLonSpan, toDataset, toDatasetLon, valueExpr, statsTemplate } from '../../app/src/lib/catalog'
import type { CubeVariable, Dataset }         from '../../app/src/lib/catalog'
import { addDays, day, daysBetween, parseInfoExtent, timeInstant } from '../../app/src/lib/extent'
import type { TimeExtent }                    from '../../app/src/lib/extent'

import { render } from './sql'
import { CACHE, CHUNKS, GAZETTEER, PLACES, STATS } from './paths'
import { DAYS, MAX_CHUNK_DAYS, MAX_CHUNK_ROWS, CONCURRENCY, SLEEP_MS } from './targets'

// ── file naming ───────────────────────────────────────────────────────────────
// place ids carry a colon (NMS:HIHWNMS). a colon is legal in an S3 key and in a URL path segment
// (RFC 3986 pchar), and both `aws s3 sync` and DuckDB's httpfs read it back fine, so the colon is
// kept verbatim in the object key. flip COLON_IN_KEYS to false to fall back to `_` everywhere.
export const COLON_IN_KEYS = true
export const fileSafe = (placeId: string) => (COLON_IN_KEYS ? placeId : placeId.replace(/:/g, '_'))
/** the STAC Item id: never contains a colon, so it is safe in a file name and in a URL fragment. */
export const itemId = (dataset: string, variable: string, placeId: string) =>
  `${dataset}_${variable}_${placeId.replace(/:/g, '-')}`

export const statsPath = (dataset: string, variable: string, placeId: string) =>
  join(STATS, dataset, variable, `${fileSafe(placeId)}.parquet`)
export const statsHref = (dataset: string, variable: string, placeId: string) =>
  `./${dataset}/${variable}/${encodeURIComponent(fileSafe(placeId)).replace(/%3A/gi, ':')}.parquet`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── catalog + places ──────────────────────────────────────────────────────────
export function loadDataset(dsDir: string): Dataset {
  const path = join(GAZETTEER, 'erddap', dsDir, 'collection.json')
  return toDataset(JSON.parse(readFileSync(path, 'utf8')))
}
export async function loadLocalPlaces(): Promise<Place[]> {
  const buf = readFileSync(PLACES)
  return loadPlaces(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
}
export function variableOf(ds: Dataset, name: string): CubeVariable {
  const v = ds.variables.find((x) => x.name === name)
  if (!v) throw new Error(`${ds.id}: no cube:variable ${name} (have ${ds.variables.map((x) => x.name).join(', ')})`)
  return v
}

/** retry settings for the extent probe: attempts, and the pause before each retry (ms). */
export const EXTENT_ATTEMPTS = 5
export const EXTENT_BACKOFF_MS = [5_000, 20_000, 60_000, 120_000]   // ~3.5 min in all: PacIOOS drops connects for minutes at a time (2026-10-07/08)

/**
 * The live time extent, straight from `<base>/info/<id>/index.json` (never the possibly-stale STAC
 * one). A network error or a 5xx is retried (EXTENT_ATTEMPTS, backing off EXTENT_BACKOFF_MS): CI saw
 * a transient 10 s connect timeout to PacIOOS abort a whole run. `fetchFn` / `wait` are for tests.
 */
export async function liveExtent(
  ds: Dataset,
  { fetchFn = fetch, wait = sleep, attempts = EXTENT_ATTEMPTS, log = console.log }:
    { fetchFn?: typeof fetch; wait?: (ms: number) => Promise<unknown>; attempts?: number; log?: (s: string) => void } = {},
): Promise<TimeExtent> {
  const url = `${ds.baseUrl.replace(/\/+$/, '')}/info/${ds.datasetId}/index.json`
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const ms = EXTENT_BACKOFF_MS[Math.min(i - 1, EXTENT_BACKOFF_MS.length - 1)]
      log(`   extent probe failed (${errText(last)}); retry ${i}/${attempts - 1} in ${ms / 1000} s`)
      await wait(ms)
    }
    let res: Response
    try { res = await fetchFn(url, { signal: AbortSignal.timeout(120_000) }) }
    catch (e) { last = e; continue }                                   // network: retry
    if (res.status >= 500) { last = new Error(`${url}: ${res.status} ${res.statusText}`); continue }
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
    const ext = parseInfoExtent(await res.json())
    if (!ext) throw new Error(`${url}: no time extent in the info table`)
    return ext
  }
  throw new Error(`${url}: extent probe failed ${attempts} times: ${errText(last)}`)
}
const errText = (e: unknown) => {
  if (!(e instanceof Error)) return String(e)
  const cause = (e as any).cause
  return cause instanceof Error ? `${e.message} (${cause.message})` : e.message
}

/**
 * liveExtent(), fail-soft: on failure log it, add every `dataset/variable/place` of this target to
 * `failed` and return null, so the caller moves on to the next target instead of aborting the run.
 */
export async function extentOrSkip(
  ds: Dataset, variable: string, placeIds: string[], failed: string[],
  opts: Parameters<typeof liveExtent>[1] = {},
): Promise<TimeExtent | null> {
  try { return await liveExtent(ds, opts) }
  catch (e) {
    console.error(`   !! ${ds.datasetId}: ${errText(e)}; skipping its ${placeIds.length} place(s)`)
    for (const id of placeIds) failed.push(`${ds.datasetId}/${variable}/${id}`)
    return null
  }
}

/** the last DAYS days of the dataset, or its full extent when that is shorter (or `days` is 'all'). */
export function window(ext: TimeExtent, days: number | 'all' = DAYS): { start: string; end: string } {
  const end = day(ext.end)
  if (days === 'all' || !Number.isFinite(days)) return { start: day(ext.start), end }
  let start = addDays(end, -(days - 1))
  if (daysBetween(day(ext.start), start) < 0) start = day(ext.start)
  return { start, end }
}

/** split [start, end] into consecutive, non-overlapping slices of at most `chunkDays` days. */
export function chunks(start: string, end: string, chunkDays: number): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let s = start
  while (daysBetween(s, end) >= 0) {
    const e = addDays(s, chunkDays - 1)
    out.push([s, daysBetween(e, end) < 0 ? end : e])
    s = addDays(e, 1)
  }
  return out
}

/**
 * days per request: MAX_CHUNK_DAYS time steps (90 days of a daily grid; a coarser grid's steps are
 * counted in its own days, so a monthly product asks for up to 90 months at once), shrunk so one slab
 * stays under MAX_CHUNK_ROWS grid rows.
 */
export function chunkDaysFor(cellsPerStep: number, stepDays = 1): number {
  const sd  = Math.max(1, stepDays)
  const cap = Math.floor(MAX_CHUNK_DAYS * sd)
  if (!(cellsPerStep > 0)) return cap
  const steps = Math.max(1, Math.floor(MAX_CHUNK_ROWS / cellsPerStep))
  return Math.max(1, Math.min(cap, Math.floor(steps * sd)))
}

// ── the mask, per lobe ────────────────────────────────────────────────────────
export interface LobeMask { lobe: Lobe; cells: MaskCell[]; lon: number[]; lat: number[]; nAxis: number }

/** the axis requests of a headless run wait longer than the browser's (2 min per try, 3 tries). */
export const AXIS_RETRY = { timeoutMs: 120_000, attempts: 3, backoffMs: 10_000 }

/** axis vectors from the server + gridMask, exactly as App.svelte does it. */
export async function maskLobe(ds: Dataset, lobe: Lobe): Promise<LobeMask> {
  const shifted = ds.lonRange[1] > 180                       // dataset longitudes run 0..360
  const toPoly  = (x: number) => (shifted && x > 180 ? x - 360 : x)
  const [lo, hi] = lobeLonSpan(lobe.bbox, ds.lonRange)
  const [lon, lat] = [
    await fetchAxis(ds.baseUrl, ds.datasetId, 'longitude', lo, hi, false, undefined, AXIS_RETRY),
    await fetchAxis(ds.baseUrl, ds.datasetId, 'latitude',  lobe.bbox[1], lobe.bbox[3], ds.latDescending, undefined, AXIS_RETRY),
  ]
  const m = gridMask(lobe.geojson, lon.map(toPoly), lat)
  const cells = m.cells.map((c) => (shifted ? { ...c, lon: toDatasetLon(c.lon, ds.lonRange) } : c))
  return { lobe, cells, lon, lat, nAxis: lon.length * lat.length }
}

// ── griddap download, cached on disk ──────────────────────────────────────────
/** GET a griddap URL to `file`, once; one retry on failure. cached files are reused. */
export async function download(url: string, file: string, log = console.log): Promise<number> {
  if (existsSync(file) && statSync(file).size > 0) return statSync(file).size
  mkdirSync(dirname(file), { recursive: true })
  let last: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const t = Date.now()
      const res = await fetch(url, { signal: AbortSignal.timeout(900_000) })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(file, buf)
      log(`      ${(buf.byteLength / 1e6).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(1)} s`)
      return buf.byteLength
    } catch (e) {
      last = e
      if (attempt === 0) { log(`      retrying after: ${e instanceof Error ? e.message : String(e)}`); await sleep(5_000) }
    }
  }
  throw new Error(`griddap failed twice: ${url}\n  ${last instanceof Error ? last.message : String(last)}`)
}

/** run `jobs` with at most `n` in flight, pausing SLEEP_MS between starts. */
async function pool<T>(jobs: Array<() => Promise<T>>, n = CONCURRENCY): Promise<T[]> {
  const out = new Array<T>(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++
      await sleep(SLEEP_MS)
      out[i] = await jobs[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker))
  return out
}

// ── DuckDB ────────────────────────────────────────────────────────────────────
let conn: DuckDBConnection | null = null
export async function db(): Promise<DuckDBConnection> {
  if (!conn) conn = await (await DuckDBInstance.create(':memory:')).connect()
  return conn
}

/** the mask cells as a DuckDB table (via a CSV side file: an Arrow insert is not worth the dep here). */
async function insertMask(c: DuckDBConnection, cells: MaskCell[], tmp: string) {
  mkdirSync(dirname(tmp), { recursive: true })
  writeFileSync(tmp, 'latitude,longitude,weight\n' + cells.map((x) => `${x.lat},${x.lon},${x.weight}`).join('\n') + '\n')
  await c.run('DROP TABLE IF EXISTS mask')
  await c.run(`CREATE TABLE mask AS SELECT * FROM read_csv('${tmp}',
    columns = {'latitude': 'DOUBLE', 'longitude': 'DOUBLE', 'weight': 'DOUBLE'}, header = true)`)
}

/** the app's column list, plus the three identity columns that make the files unionable. */
function selectList(categorical: boolean): string {
  return categorical
    // the app's SQL names `fraction` / `percent_cells`; the published columns are frac_area / pct_cells
    ? `date, class, n, weight, fraction AS frac_area, percent_cells AS pct_cells`
    : `date, n, mean, mean_wt, sd, "min", "max", p10, p90, weight_sum`
}

// ── one (dataset, variable, place) ────────────────────────────────────────────
/** at most this many request URLs are listed verbatim in a provenance (else the templates + chunks). */
export const GRIDDAP_URLS_MAX = 24

/**
 * what a cached chunk's rows depend on besides its dates: the server, the dataset, the value
 * expression, the template and the mask cells. a changed polygon or grid gives a new key, so stale
 * chunk rows are never reused.
 */
export function maskKey(ds: Pick<Dataset, 'baseUrl' | 'datasetId' | 'depth'>, v: CubeVariable, cells: MaskCell[]): string {
  const h = createHash('sha1')
  h.update(JSON.stringify([ds.baseUrl, ds.datasetId, ds.depth ?? null, v.name, valueExpr(v), statsTemplate(v)]))
  for (const c of cells) h.update(`${c.lon},${c.lat},${c.weight};`)
  return h.digest('hex').slice(0, 12)
}

export interface LobeAxes { bbox: [number, number, number, number]; lon: number[]; lat: number[] }
/** the provenance's `axes`: what each lobe's mask was computed from. */
export const provenanceAxes = (masks: LobeMask[]): LobeAxes[] =>
  masks.map((m) => ({ bbox: [...m.lobe.bbox] as LobeAxes['bbox'], lon: m.lon, lat: m.lat }))

export interface Provenance {
  place_id     : string
  dataset_id   : string
  variable     : string
  categorical  : boolean
  start_date   : string
  end_date     : string
  start_datetime: string
  end_datetime  : string
  lobes        : number
  mask_cells   : number
  /**
   * per lobe, in placeLobes() order: its bbox and the server's longitude / latitude axis values over it
   * (what fetchAxis() returned). The app masks the grid from these instead of asking ERDDAP for them
   * again, so a precomputed place's map needs only its one time step (app `lobeAxes()`).
   */
  axes        ?: LobeAxes[]
  /** every request, when there are at most GRIDDAP_URLS_MAX of them (a full daily record has hundreds) */
  griddap_urls ?: string[]
  /** one per lobe: the request with its time constraint as `({t0}):1:({t1})`; with `griddap_chunks`, every request exactly */
  griddap_url_templates: string[]
  /** the [t0, t1] instants of each request, oldest first (every lobe is asked for every chunk) */
  griddap_chunks: Array<[string, string]>
  griddap_requests: number
  rows         : number
  bytes        : number
  generated    : string
  erddap_base  : string
  erddap_version?: string
  sql          : string
}

export async function computeOne(
  ds: Dataset, v: CubeVariable, place: Place, ext: TimeExtent, days: number | 'all' = DAYS, log = console.log,
): Promise<Provenance> {
  const t0    = Date.now()
  const win   = window(ext, days)
  const lobes = placeLobes(plainPlace(place))
  if (!lobes.length) throw new Error(`${place.place_id}: no polygon lobes`)

  // 1. mask every lobe (and count the axis cells, which sets the chunk size)
  const masks: LobeMask[] = []
  for (const lobe of lobes) { masks.push(await maskLobe(ds, lobe)); await sleep(SLEEP_MS) }
  const cells    = masks.flatMap((m) => m.cells)
  const perStep  = masks.reduce((s, m) => s + m.nAxis, 0)
  const cd       = chunkDaysFor(perStep, ext.stepDays ?? 1)
  const slices   = chunks(win.start, win.end, cd)
  log(`    ${lobes.length} lobe(s), ${cells.length} masked cells, ${perStep} axis cells/step, ` +
      `${slices.length} request(s) of <=${cd} d`)

  // 2. one chunk at a time: download its slab per lobe, aggregate it with the app's own SQL template into
  // the chunk's daily rows, keep those (a few kB) and drop the slabs. a day lies in exactly one chunk, so
  // the per-chunk rows ARE the file's rows; the full record never sits on disk as raw grid. the chunk
  // rows are kept in CHUNKS (outside the checkout on the runner), keyed by the mask, so the next run
  // (or a resumed one) asks ERDDAP only for the chunks it has not done: after the first full-record
  // run, a weekly refresh is the last chunk.
  const key  = maskKey(ds, v, cells)
  const dir  = join(CHUNKS, ds.datasetId, v.name, fileSafe(place.place_id), key)
  mkdirSync(dir, { recursive: true })
  const c    = await db()
  await insertMask(c, cells, join(CACHE, `mask_${key}.csv`))
  const t    = (d: string) => timeInstant(d, ext, noonZ)
  const urlFor = (m: LobeMask, t0: string, t1: string) => griddapUrl({
    base: ds.baseUrl, datasetId: ds.datasetId, variable: v.name, time: [t0, t1],
    lat : [m.lat[m.lat.length - 1], m.lat[0]], lon: [m.lon[0], m.lon[m.lon.length - 1]],
    latDescending: ds.latDescending, depth: ds.depth, format: 'parquet',
  })
  const chunkFiles = slices.map(([s, e]) => join(dir, `${s}_${e}.parquet`))
  // a chunk file for the same start and another end is last run's partial last chunk: superseded
  const keep = new Set(chunkFiles.map((f) => f.slice(dir.length + 1)))
  for (const f of readdirSync(dir)) if (f.endsWith('.parquet') && !keep.has(f)) rmSync(join(dir, f))
  const todo = slices.map((sl, j) => ({ sl, j })).filter(({ j }) => !existsSync(chunkFiles[j]))
  log(`    ${slices.length - todo.length} chunk(s) already done, ${todo.length} to fetch (${todo.length * masks.length} request(s))`)

  let agg = Promise.resolve()                 // one DuckDB connection: aggregate one chunk at a time
  let done = 0
  await pool(todo.map(({ sl: [s, e], j }) => async () => {
    const files = masks.map((_, i) => join(CACHE, ds.datasetId, v.name, fileSafe(place.place_id), `lobe${i}_${s}_${e}.parquet`))
    for (const [i, m] of masks.entries()) await download(urlFor(m, t(s), t(e)), files[i], log)
    const run = agg.then(async () => {
      // DISTINCT: a coarse axis (the 8-day grid) can snap a chunk's two endpoints onto one step
      const slab = `(SELECT DISTINCT * FROM read_parquet([${files.map((f) => `'${f}'`).join(', ')}]))`
      const body = render(statsTemplate(v), { expr: valueExpr(v), slab, mask: 'mask' })
      const tmp  = chunkFiles[j] + '.tmp'
      await c.run(`COPY (SELECT ${selectList(v.categorical)} FROM (${body})) TO '${tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)`)
      renameSync(tmp, chunkFiles[j])           // only a whole chunk ever counts as done
      for (const f of files) rmSync(f, { force: true })
      done++
      if (done % 25 === 0 || done === todo.length) log(`      ${done}/${todo.length} chunk(s) aggregated`)
    })
    agg = run.catch(() => {})
    await run
  }))

  // 3. the file: every chunk's rows, oldest first. DISTINCT again: two chunks snapped onto the same
  // step of a coarse axis give that step's row twice, identical
  const order = v.categorical ? 'date, class' : 'date'
  const out   = statsPath(ds.datasetId, v.name, place.place_id)
  mkdirSync(dirname(out), { recursive: true })
  await c.run(`COPY (
  SELECT *, '${place.place_id}' AS place_id, '${ds.datasetId}' AS dataset_id, '${v.name}' AS variable
  FROM (SELECT DISTINCT * FROM read_parquet([${chunkFiles.map((f) => `'${f}'`).join(', ')}])) ORDER BY ${order}
) TO '${out}' (FORMAT PARQUET, COMPRESSION ZSTD)`)

  const n = Number((await c.runAndReadAll(`SELECT count(*) AS n FROM read_parquet('${out}')`)).getRowObjects()[0].n)
  const bytes = statSync(out).size
  const chunksAt = slices.map(([s, e]): [string, string] => [t(s), t(e)])
  const urls = masks.flatMap((m) => chunksAt.map(([a, b]) => urlFor(m, a, b)))
  const prov: Provenance = {
    place_id: place.place_id, dataset_id: ds.datasetId, variable: v.name, categorical: v.categorical,
    start_date: win.start, end_date: win.end,
    start_datetime: t(win.start), end_datetime: t(win.end),
    lobes: lobes.length, mask_cells: cells.length, axes: provenanceAxes(masks),
    ...(urls.length <= GRIDDAP_URLS_MAX ? { griddap_urls: urls } : {}),
    griddap_url_templates: masks.map((m) => urlFor(m, '{t0}', '{t1}')),
    griddap_chunks: chunksAt, griddap_requests: urls.length,
    rows: n, bytes, generated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    erddap_base: ds.baseUrl, erddap_version: ds.version,
    sql: render(statsTemplate(v), { expr: valueExpr(v), slab: '(SELECT DISTINCT * FROM read_parquet([<one griddap slab per lobe for the chunk>]))', mask: 'mask' }),
  }
  writeFileSync(out.replace(/\.parquet$/, '.provenance.json'), JSON.stringify(prov, null, 2) + '\n')
  log(`    -> ${n} rows, ${(bytes / 1e3).toFixed(0)} kB in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  return prov
}
