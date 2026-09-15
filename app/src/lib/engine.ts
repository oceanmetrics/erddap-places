// DuckDB-WASM in a Web Worker, self-hosted bundles, no extensions. the ERDDAP slab is fetched whole
// and registered as an in-memory buffer; the mask goes in as an Arrow table; every statistic is a
// SQL template in ../../sql rendered with {{named}} params.
import * as duckdb from '@duckdb/duckdb-wasm'
import eh_wasm    from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import eh_worker  from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import mvp_wasm   from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import { tableFromArrays, tableToIPC } from 'apache-arrow'
import type { MaskCell } from './gridMask'

// ── templates ─────────────────────────────────────────────────────────────────
// (loading and rendering live in ./sql, which is importable from plain Node)
export { lit, render, template, templateNames } from './sql'
import { render } from './sql'
import type { Params } from './sql'
export type { Param, Params } from './sql'

// ── rows ──────────────────────────────────────────────────────────────────────
export type Row = Record<string, any>
function toRows(t: any): Row[] {
  const cols: string[] = t.schema.fields.map((f: any) => f.name)
  const out: Row[] = []
  for (const r of t) {
    const o: Row = {}
    for (const c of cols) { const v = r[c]; o[c] = typeof v === 'bigint' ? Number(v) : v }
    out.push(o)
  }
  return out
}

export interface EngineEvent { name: string; ms: number; note?: string }

export class Engine {
  db!: duckdb.AsyncDuckDB
  conn!: duckdb.AsyncDuckDBConnection
  ready: Promise<void>
  marks: EngineEvent[] = []
  lastSql = ''
  private q: Promise<any> = Promise.resolve() // one connection: serialize everything

  constructor() { this.ready = this.init() }
  private mark(name: string, ms: number, note?: string) { this.marks.push({ name, ms: Math.round(ms), note }) }

  private async init() {
    const t = performance.now()
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: mvp_wasm, mainWorker: mvp_worker },
      eh : { mainModule: eh_wasm,  mainWorker: eh_worker  },
    })
    const worker = new Worker(bundle.mainWorker!)
    this.db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker)
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    this.conn = await this.db.connect()
    this.mark('wasm_init', performance.now() - t, bundle.mainModule.includes('-eh') ? 'eh bundle' : 'mvp bundle')
  }

  /** register an already-fetched slab (parquet bytes) under a virtual file name. */
  async registerBuffer(name: string, buf: Uint8Array) {
    const run = async () => {
      await this.ready
      const t = performance.now()
      await this.db.registerFileBuffer(name, buf)
      this.mark(`register:${name}`, performance.now() - t, `${(buf.byteLength / 1e3).toFixed(0)} kB`)
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  /** the gridMask cells as a DuckDB table (via Arrow IPC, so no giant VALUES list). */
  async insertMask(cells: MaskCell[], table = 'mask') {
    const run = async () => {
      await this.ready
      const t = performance.now()
      const arrow = tableFromArrays({
        latitude : Float64Array.from(cells.map((c) => c.lat)),
        longitude: Float64Array.from(cells.map((c) => c.lon)),
        weight   : Float64Array.from(cells.map((c) => c.weight)),
      })
      await this.conn.query(`DROP TABLE IF EXISTS ${table}`)
      await this.conn.insertArrowFromIPCStream(tableToIPC(arrow, 'stream'), { name: table, create: true })
      this.mark(`mask:${table}`, performance.now() - t, `${cells.length} cells`)
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  /** rows from a non-Parquet slab (.csvp / .jsonp) as a table, so the same SQL works on them. */
  async insertRows(rows: Record<string, unknown>[], table: string) {
    const run = async () => {
      await this.ready
      const t = performance.now()
      const cols = Object.keys(rows[0] ?? {})
      const arrays: Record<string, any> = {}
      for (const c of cols) {
        const vals = rows.map((r) => r[c])
        arrays[c] = vals.every((v) => typeof v === 'number' || v === null)
          ? Float64Array.from(vals.map((v) => (v === null ? NaN : (v as number))))
          : vals.map((v) => (v === null || v === undefined ? null : String(v)))
      }
      await this.conn.query(`DROP TABLE IF EXISTS ${table}`)
      await this.conn.insertArrowFromIPCStream(tableToIPC(tableFromArrays(arrays), 'stream'), { name: table, create: true })
      this.mark(`rows:${table}`, performance.now() - t, `${rows.length} rows`)
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  exec(sql: string, label = 'exec'): Promise<Row[]> {
    const run = async () => {
      await this.ready
      const t = performance.now()
      this.lastSql = sql
      const res = await this.conn.query(sql)
      this.mark(`query:${label}`, performance.now() - t, `${res.numRows} rows`)
      return toRows(res)
    }
    this.q = this.q.then(run, run)
    return this.q
  }

  /** render a `sql/<name>.sql` template with {{params}} and run it. */
  runTemplate(name: string, params: Params): Promise<Row[]> { return this.exec(render(name, params), name) }
}

export const engine = new Engine()
