// the full-record precompute is incremental per chunk: a second run asks ERDDAP only for the chunks it
// has not aggregated, a superseded partial last chunk is dropped, and the merged file is exactly the
// rows of a one-shot run. ERDDAP is a stub (axis JSON + Parquet slabs written by native DuckDB): no network.
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import type { Place } from '../../app/src/lib/gazetteer'
import type { TimeExtent } from '../../app/src/lib/extent'

const TMP = mkdtempSync(join(tmpdir(), 'chunks-'))
process.env.PRECOMPUTE_CHUNKS = join(TMP, 'chunks')
process.env.PRECOMPUTE_STATS  = join(TMP, 'stats')

// a 0.05° grid over the box, value = day of year at every cell, so the daily mean is the day of year
const LON = [-80.975, -80.925, -80.875, -80.825], LAT = [31.475, 31.425, 31.375, 31.325]   // lat descending (CRW)
const box = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]
const PLACE: Place = {
  place_id: 'NMS:TESTBOX', gazetteer: 'NMS', name: 'Test box', area_km2: 100,
  bbox: [-81, 31.3, -80.8, 31.5], geometry: { type: 'MultiPolygon', coordinates: [box(-81, 31.3, -80.8, 31.5)] },
}
const ext = (end: string): TimeExtent => ({ start: '2026-01-01T12:00:00Z', end, stepDays: 1, stepLabel: 'daily' })

const slabRequests: string[] = []
let duck: Awaited<ReturnType<DuckDBInstance['connect']>>
async function fakeFetch(input: string | URL) {
  const url = decodeURIComponent(String(input))
  if (url.includes('.json?longitude')) return Response.json({ table: { columnNames: ['longitude'], rows: LON.map((x) => [x]) } })
  if (url.includes('.json?latitude'))  return Response.json({ table: { columnNames: ['latitude'],  rows: LAT.map((y) => [y]) } })
  const m = /CRW_SST\[\(([^)]+)\):1:\(([^)]+)\)\]/.exec(url)
  if (!m) return new Response('unexpected request', { status: 404 })
  slabRequests.push(`${m[1].slice(0, 10)}..${m[2].slice(0, 10)}`)
  const f = join(TMP, `slab_${slabRequests.length}.parquet`)
  await duck.run(`COPY (
    SELECT t::TIMESTAMP AS time, lat AS latitude, lon AS longitude, dayofyear(t)::FLOAT AS CRW_SST
    FROM generate_series(TIMESTAMP '${m[1].slice(0, 10)} 12:00:00', TIMESTAMP '${m[2].slice(0, 10)} 12:00:00', INTERVAL 1 DAY) g(t),
         unnest([${LAT.join(',')}]) a(lat), unnest([${LON.join(',')}]) b(lon)
  ) TO '${f}' (FORMAT PARQUET)`)
  return new Response(readFileSync(f))
}

let stats: typeof import('./stats')
beforeAll(async () => {
  duck = await (await DuckDBInstance.create(':memory:')).connect()
  vi.stubGlobal('fetch', fakeFetch)
  stats = await import('./stats')
})
afterAll(() => { vi.unstubAllGlobals(); rmSync(TMP, { recursive: true, force: true }) })

async function fileRows(path: string) {
  return (await duck.runAndReadAll(`SELECT strftime(date, '%Y-%m-%d') AS d, mean, n FROM read_parquet('${path}') ORDER BY date`)).getRowObjects()
}

describe('computeOne: chunked, cached, incremental', () => {
  const quiet = () => {}
  it('the first run fetches every chunk; the next fetches only the new last chunk', async () => {
    const ds = { ...stats.loadDataset('dhw_5km'), baseUrl: 'https://fake.test/erddap', datasetId: 'test_grid' }
    const v  = stats.variableOf(ds, 'CRW_SST')

    // 1 Jan .. 10 Apr = 100 days: one 90-day chunk and a 10-day partial one
    const p1 = await stats.computeOne(ds, v, PLACE, ext('2026-04-10T12:00:00Z'), 'all', quiet)
    expect(slabRequests).toEqual(['2026-01-01..2026-03-31', '2026-04-01..2026-04-10'])
    expect(p1.rows).toBe(100)
    expect(p1.griddap_requests).toBe(2)
    expect(p1.griddap_urls).toHaveLength(2)
    expect(p1.griddap_chunks[1]).toEqual(['2026-04-01T12:00:00Z', '2026-04-10T12:00:00Z'])
    expect(p1.griddap_url_templates[0]).toContain('CRW_SST%5B({t0}):1:({t1})%5D')

    // a week later: the 90-day chunk is reused, the partial one is redone to the new end and replaces the old
    slabRequests.length = 0
    const p2 = await stats.computeOne(ds, v, PLACE, ext('2026-04-17T12:00:00Z'), 'all', quiet)
    expect(slabRequests).toEqual(['2026-04-01..2026-04-17'])
    expect(p2.rows).toBe(107)
    const dir = join(process.env.PRECOMPUTE_CHUNKS!, 'test_grid', 'CRW_SST', 'NMS:TESTBOX')
    const [key] = readdirSync(dir)
    expect(readdirSync(join(dir, key)).sort()).toEqual(['2026-01-01_2026-03-31.parquet', '2026-04-01_2026-04-17.parquet'])

    // the merged file is every day once, in order, with the closed-form values
    const rows = await fileRows(stats.statsPath('test_grid', 'CRW_SST', 'NMS:TESTBOX'))
    expect(rows).toHaveLength(107)
    expect(rows[0]).toMatchObject({ d: '2026-01-01', mean: 1 })
    expect(rows[89]).toMatchObject({ d: '2026-03-31', mean: 90 })
    expect(rows[106]).toMatchObject({ d: '2026-04-17', mean: 107 })
    expect(new Set(rows.map((r) => r.d)).size).toBe(107)
    expect(rows.every((r) => Number(r.n) === Number(rows[0].n) && Number(r.n) > 0)).toBe(true)
  }, 60_000)

  it('a place stopped at the deadline keeps its finished chunks, and the next run fetches only the rest', async () => {
    const ds = { ...stats.loadDataset('dhw_5km'), baseUrl: 'https://fake.test/erddap', datasetId: 'test_stop' }
    const v  = stats.variableOf(ds, 'CRW_SST')
    slabRequests.length = 0
    let n = 0
    // stop once the first chunk has started: its request finishes, nothing after it starts
    await expect(stats.computeOne(ds, v, PLACE, ext('2026-07-31T12:00:00Z'), 'all', quiet, { shouldStop: () => n++ > 0 }))
      .rejects.toBeInstanceOf(stats.StopRequested)
    expect(slabRequests).toEqual(['2026-01-01..2026-03-31'])
    slabRequests.length = 0
    const p = await stats.computeOne(ds, v, PLACE, ext('2026-07-31T12:00:00Z'), 'all', quiet)
    expect(slabRequests).toEqual(['2026-04-01..2026-06-29', '2026-06-30..2026-07-31'])
    expect(p.rows).toBe(212)
  }, 60_000)

  it('the chunk key changes with the mask, so a moved polygon never reuses old rows', () => {
    const ds = stats.loadDataset('dhw_5km'), v = stats.variableOf(ds, 'CRW_SST')
    const cells = [{ lon: -80.9, lat: 31.4, weight: 1 }]
    const k = stats.maskKey(ds, v, cells)
    expect(k).toMatch(/^[0-9a-f]{12}$/)
    expect(stats.maskKey(ds, v, [...cells])).toBe(k)
    expect(stats.maskKey(ds, v, [{ ...cells[0], weight: 0.5 }])).not.toBe(k)
    expect(stats.maskKey(ds, stats.variableOf(ds, 'CRW_BAA'), cells)).not.toBe(k)
  })
})
