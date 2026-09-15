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
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'

import { gridMask, type MaskCell }            from '../../app/src/lib/gridMask'
import { fetchAxis, griddapUrl, noonZ }       from '../../app/src/lib/erddap'
import { placeLobes, plainPlace, loadPlaces } from '../../app/src/lib/gazetteer'
import type { Lobe, Place }                   from '../../app/src/lib/gazetteer'
import { toDataset, toDatasetLon, valueExpr, statsTemplate } from '../../app/src/lib/catalog'
import type { CubeVariable, Dataset }         from '../../app/src/lib/catalog'
import { addDays, day, daysBetween, parseInfoExtent, timeInstant } from '../../app/src/lib/extent'
import type { TimeExtent }                    from '../../app/src/lib/extent'

import { render } from './sql'
import { CACHE, GAZETTEER, PLACES, STATS } from './paths'
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

/** the live time extent, straight from `<base>/info/<id>/index.json` (never the possibly-stale STAC one). */
export async function liveExtent(ds: Dataset): Promise<TimeExtent> {
  const url = `${ds.baseUrl.replace(/\/+$/, '')}/info/${ds.datasetId}/index.json`
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
  const ext = parseInfoExtent(await res.json())
  if (!ext) throw new Error(`${url}: no time extent in the info table`)
  return ext
}

/** the last DAYS days of the dataset, or its full extent when that is shorter. */
export function window(ext: TimeExtent, days = DAYS): { start: string; end: string } {
  const end = day(ext.end)
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

/** days per request: MAX_CHUNK_DAYS, shrunk so one slab stays under MAX_CHUNK_ROWS grid rows. */
export function chunkDaysFor(cellsPerStep: number, stepDays = 1): number {
  if (!(cellsPerStep > 0)) return MAX_CHUNK_DAYS
  const steps = Math.max(1, Math.floor(MAX_CHUNK_ROWS / cellsPerStep))
  return Math.max(1, Math.min(MAX_CHUNK_DAYS, Math.floor(steps * Math.max(1, stepDays))))
}

// ── the mask, per lobe ────────────────────────────────────────────────────────
export interface LobeMask { lobe: Lobe; cells: MaskCell[]; lon: number[]; lat: number[]; nAxis: number }

/** axis vectors from the server + gridMask, exactly as App.svelte does it. */
export async function maskLobe(ds: Dataset, lobe: Lobe): Promise<LobeMask> {
  const shifted = ds.lonRange[1] > 180                       // dataset longitudes run 0..360
  const toPoly  = (x: number) => (shifted && x > 180 ? x - 360 : x)
  const lo = toDatasetLon(lobe.bbox[0], ds.lonRange), hi = toDatasetLon(lobe.bbox[2], ds.lonRange)
  const [lon, lat] = [
    await fetchAxis(ds.baseUrl, ds.datasetId, 'longitude', Math.min(lo, hi), Math.max(lo, hi), false),
    await fetchAxis(ds.baseUrl, ds.datasetId, 'latitude',  lobe.bbox[1], lobe.bbox[3], ds.latDescending),
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
  griddap_urls : string[]
  rows         : number
  bytes        : number
  generated    : string
  erddap_base  : string
  erddap_version?: string
  sql          : string
}

export async function computeOne(
  ds: Dataset, v: CubeVariable, place: Place, ext: TimeExtent, days = DAYS, log = console.log,
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

  // 2. download every (lobe x slice) griddap slab
  const files: string[] = []
  const urls : string[] = []
  const jobs : Array<() => Promise<void>> = []
  for (const [i, m] of masks.entries()) {
    for (const [j, [s, e]] of slices.entries()) {
      const url = griddapUrl({
        base: ds.baseUrl, datasetId: ds.datasetId, variable: v.name,
        time: [timeInstant(s, ext, noonZ), timeInstant(e, ext, noonZ)],
        lat : [m.lat[m.lat.length - 1], m.lat[0]], lon: [m.lon[0], m.lon[m.lon.length - 1]],
        latDescending: ds.latDescending, format: 'parquet',
      })
      const file = join(CACHE, ds.datasetId, v.name, fileSafe(place.place_id), `lobe${i}_${s}_${e}.parquet`)
      urls.push(url); files.push(file)
      jobs.push(async () => { await download(url, file, log) })
    }
  }
  await pool(jobs)

  // 3. aggregate with the app's own SQL template
  const c = await db()
  await insertMask(c, cells, join(CACHE, 'mask.csv'))
  // DISTINCT: consecutive slices never overlap by date, but a coarse axis (the 8-day grid) can snap
  // two slice endpoints onto the same time step, and a duplicated row would inflate `n`.
  const slab = `(SELECT DISTINCT * FROM read_parquet([${files.map((f) => `'${f}'`).join(', ')}]))`
  const body = render(statsTemplate(v), { expr: valueExpr(v), slab, mask: 'mask' })
  const out  = statsPath(ds.datasetId, v.name, place.place_id)
  mkdirSync(dirname(out), { recursive: true })
  const sql = `COPY (
  SELECT ${selectList(v.categorical)},
         '${place.place_id}' AS place_id, '${ds.datasetId}' AS dataset_id, '${v.name}' AS variable
  FROM (${body})
) TO '${out}' (FORMAT PARQUET, COMPRESSION ZSTD)`
  await c.run(sql)

  const n = Number((await c.runAndReadAll(`SELECT count(*) AS n FROM read_parquet('${out}')`)).getRowObjects()[0].n)
  const bytes = statSync(out).size
  const prov: Provenance = {
    place_id: place.place_id, dataset_id: ds.datasetId, variable: v.name, categorical: v.categorical,
    start_date: win.start, end_date: win.end,
    start_datetime: timeInstant(win.start, ext, noonZ), end_datetime: timeInstant(win.end, ext, noonZ),
    lobes: lobes.length, mask_cells: cells.length, griddap_urls: urls,
    rows: n, bytes, generated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    erddap_base: ds.baseUrl, erddap_version: ds.version, sql: body,
  }
  writeFileSync(out.replace(/\.parquet$/, '.provenance.json'), JSON.stringify(prov, null, 2) + '\n')
  log(`    -> ${n} rows, ${(bytes / 1e3).toFixed(0)} kB in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  return prov
}
