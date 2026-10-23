// the final assembly of a stats file from its chunk files: a day belongs to the chunk whose span holds it.
// chunk files are written by native DuckDB with synthetic rows: no network, no ERDDAP.
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { assembleSql } from './stats'

const TMP = mkdtempSync(join(tmpdir(), 'assemble-'))
let duck: Awaited<ReturnType<DuckDBInstance['connect']>>
beforeAll(async () => { duck = await (await DuckDBInstance.create(':memory:')).connect() })
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

/** write one chunk file `<dir>/<start>_<end>.parquet` from `[date, mean]` pairs (continuous stats columns). */
async function chunk(dir: string, span: string, rows: Array<[string, number]>) {
  mkdirSync(dir, { recursive: true })
  const f = join(dir, `${span}.parquet`)
  const values = rows.map(([d, m]) => `(DATE '${d}', 10::BIGINT, ${m}::DOUBLE)`).join(', ')
  await duck.run(`COPY (SELECT * FROM (VALUES ${values}) t(date, n, mean)) TO '${f}' (FORMAT PARQUET)`)
  return f
}
async function assemble(files: string[], out: string, categorical = false) {
  await duck.run(assembleSql(files, out, 'NMS:TEST', 'test_ds', 'CRW_SST', categorical))
  return (await duck.runAndReadAll(
    `SELECT strftime(date, '%Y-%m-%d') AS d, mean, place_id, dataset_id, variable FROM read_parquet('${out}') ORDER BY date`,
  )).getRowObjects()
}

describe('assembleSql: one row per day, from the chunk whose span holds it', () => {
  it('a chunk ending on a day missing from the axis does not duplicate the next chunk\'s first day', async () => {
    // axis: 1, 2, 3 Jan, then no 4 Jan, then 5, 6, 7 Jan. chunk A = 1..4 Jan: ERDDAP answers its end (the missing 4th)
    // with the next day, the 5th, which is also chunk B's first day (5..7). the two rows of the 5th differ in the last bits.
    const dir = join(TMP, 'gap')
    const a = await chunk(dir, '2026-01-01_2026-01-04', [
      ['2026-01-01', 1], ['2026-01-02', 2], ['2026-01-03', 3], ['2026-01-05', 5.000000000000001],   // A's 5th: outside its span
    ])
    const b = await chunk(dir, '2026-01-05_2026-01-07', [['2026-01-05', 5], ['2026-01-06', 6], ['2026-01-07', 7]])
    const rows = await assemble([a, b], join(TMP, 'gap.parquet'))
    expect(rows.map((r) => r.d)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-05', '2026-01-06', '2026-01-07'])
    expect(rows.filter((r) => r.d === '2026-01-05')).toHaveLength(1)
    expect(rows.find((r) => r.d === '2026-01-05')!.mean).toBe(5)         // chunk B holds the 5th, not chunk A's 5.000000000000001
    expect(rows[0]).toMatchObject({ place_id: 'NMS:TEST', dataset_id: 'test_ds', variable: 'CRW_SST' })
  })

  it('the file order of the list does not matter, and a file without such a day is written as it was', async () => {
    const dir = join(TMP, 'plain')
    const a = await chunk(dir, '2026-02-01_2026-02-02', [['2026-02-01', 1], ['2026-02-02', 2]])
    const b = await chunk(dir, '2026-02-03_2026-02-04', [['2026-02-03', 3], ['2026-02-04', 4]])
    const rows = await assemble([b, a], join(TMP, 'plain.parquet'))
    expect(rows.map((r) => [r.d, r.mean])).toEqual([['2026-02-01', 1], ['2026-02-02', 2], ['2026-02-03', 3], ['2026-02-04', 4]])
  })

  it('two kept chunks that still overlap give one row per day, the first file by name', async () => {
    const dir = join(TMP, 'overlap')
    const a = await chunk(dir, '2026-03-01_2026-03-04', [['2026-03-01', 1], ['2026-03-02', 2], ['2026-03-03', 3], ['2026-03-04', 4]])
    const b = await chunk(dir, '2026-03-03_2026-03-05', [['2026-03-03', 3.5], ['2026-03-04', 4.5], ['2026-03-05', 5]])
    const rows = await assemble([b, a], join(TMP, 'overlap.parquet'))
    expect(rows.map((r) => [r.d, r.mean])).toEqual([['2026-03-01', 1], ['2026-03-02', 2], ['2026-03-03', 3], ['2026-03-04', 4], ['2026-03-05', 5]])
  })

  it('categorical files are keyed by date and class: each class keeps its one row of the day', async () => {
    const dir = join(TMP, 'cat')
    mkdirSync(dir, { recursive: true })
    const mk = async (span: string, rows: string) => {
      const f = join(dir, `${span}.parquet`)
      await duck.run(`COPY (SELECT date, class, weight::DOUBLE AS weight FROM (VALUES ${rows}) t(date, class, weight)) TO '${f}' (FORMAT PARQUET)`)
      return f
    }
    const a = await mk('2026-04-01_2026-04-02', `(DATE '2026-04-01', 1, 1.0), (DATE '2026-04-01', 2, 2.0), (DATE '2026-04-03', 1, 9.1), (DATE '2026-04-03', 2, 9.2)`)
    const b = await mk('2026-04-03_2026-04-03', `(DATE '2026-04-03', 1, 3.0), (DATE '2026-04-03', 2, 4.0)`)
    const out = join(TMP, 'cat.parquet')
    await duck.run(assembleSql([a, b], out, 'NMS:TEST', 'test_ds', 'CRW_BAA', true))
    const rows = (await duck.runAndReadAll(
      `SELECT strftime(date, '%Y-%m-%d') AS d, class, weight FROM read_parquet('${out}') ORDER BY date, class`)).getRowObjects()
    expect(rows.map((r) => [r.d, Number(r.class), r.weight])).toEqual([
      ['2026-04-01', 1, 1], ['2026-04-01', 2, 2], ['2026-04-03', 1, 3], ['2026-04-03', 2, 4],
    ])
  })
})
