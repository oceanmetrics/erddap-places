// the SQL templates, rendered here and executed by the native `duckdb` CLI on a tiny synthetic slab
// and mask. this is the same text the browser runs (src/lib/sql.ts loads it from ../../sql), so a
// rule change cannot drift between the CLI and DuckDB-WASM. skipped when `duckdb` is not installed.
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { lit, render, templateNames } from './sql'

const haveDuckdb = (() => {
  try { execFileSync('duckdb', ['-c', 'select 1'], { stdio: 'ignore' }); return true } catch { return false }
})()

/** two dates x four cells: classes 1,2,1,3 with weights 1, .5, 1, .25 (a quarter-covered cell). */
const FIXTURE = `
CREATE TABLE mask AS SELECT * FROM (VALUES
  (20.00, -160.00, 1.00), (20.00, -159.95, 0.50),
  (20.05, -160.00, 1.00), (20.05, -159.95, 0.25)
) t(latitude, longitude, weight);
CREATE TABLE slab AS SELECT * FROM (VALUES
  (TIMESTAMP '2026-01-01 12:00:00', 20.00, -160.00, 1, 25.0),
  (TIMESTAMP '2026-01-01 12:00:00', 20.00, -159.95, 2, 26.0),
  (TIMESTAMP '2026-01-01 12:00:00', 20.05, -160.00, 1, 27.0),
  (TIMESTAMP '2026-01-01 12:00:00', 20.05, -159.95, 3, 29.0),
  (TIMESTAMP '2026-01-09 12:00:00', 20.00, -160.00, 2, 25.5),
  (TIMESTAMP '2026-01-09 12:00:00', 20.00, -159.95, 2, 26.5),
  (TIMESTAMP '2026-01-09 12:00:00', 20.05, -160.00, 2, 27.5),
  (TIMESTAMP '2026-01-09 12:00:00', 20.05, -159.95, 2, 29.5),
  -- a cell outside the mask: it must not reach any statistic
  (TIMESTAMP '2026-01-01 12:00:00', 40.00,  -60.00, 9, 99.0)
) t("time", latitude, longitude, "CLASS", "SST");
`

function duck(sql: string): Record<string, any>[] {
  const out = execFileSync('duckdb', ['-json', '-c', FIXTURE + sql], { encoding: 'utf8' })
  return JSON.parse(out || '[]')
}

describe('sql templates', () => {
  it('ships the statistics and map templates', () => {
    expect(templateNames()).toEqual(expect.arrayContaining(['stats_daily', 'stats_categorical', 'last_step']))
  })
  it('quotes literals and splices identifiers', () => {
    expect(lit("O'ahu")).toBe("'O''ahu'")
    expect(render('stats_categorical', { expr: 's."CLASS"', slab: 'slab', mask: 'mask' })).toContain('FROM slab s')
  })
})

describe.skipIf(!haveDuckdb)('stats_categorical.sql', () => {
  const rows = () => duck(render('stats_categorical', { expr: 's."CLASS"', slab: 'slab', mask: 'mask' }))

  it('gives the area-weighted fractions per date x class, summing to 1 per date', () => {
    const r = rows()
    expect(r.map((x) => `${x.date}:${x.class}`)).toEqual(
      ['2026-01-01:1', '2026-01-01:2', '2026-01-01:3', '2026-01-09:2'])
    for (const date of ['2026-01-01', '2026-01-09']) {
      const sum = r.filter((x) => x.date === date).reduce((s, x) => s + Number(x.fraction), 0)
      expect(sum).toBeCloseTo(1, 12)
    }
    // date 1: weights 1 + 1 = 2 of 2.75 in class 1, .5 in class 2, .25 in class 3
    const d1 = r.filter((x) => x.date === '2026-01-01')
    expect(Number(d1[0].fraction)).toBeCloseTo(2 / 2.75, 12)
    expect(Number(d1[1].fraction)).toBeCloseTo(0.5 / 2.75, 12)
    expect(Number(d1[2].fraction)).toBeCloseTo(0.25 / 2.75, 12)
  })

  it('counts cells and percentages independently of the area weights', () => {
    const d1 = rows().filter((x) => x.date === '2026-01-01')
    expect(d1.map((x) => x.n)).toEqual([2, 1, 1])
    expect(d1.reduce((s, x) => s + Number(x.percent_cells), 0)).toBeCloseTo(100, 10)
  })

  it('drops cells that are not in the mask (a single class on the second date)', () => {
    const r = rows()
    expect(r.some((x) => x.class === 9)).toBe(false)
    const d2 = r.filter((x) => x.date === '2026-01-09')
    expect(d2).toHaveLength(1)
    expect(Number(d2[0].fraction)).toBe(1)
  })
})

describe.skipIf(!haveDuckdb)('last_step.sql', () => {
  it('returns the masked cells of the latest time step only, for the map', () => {
    const r = duck(render('last_step', { expr: 's."SST"', slab: 'slab', mask: 'mask' }))
    expect(r.map((x) => x.date)).toEqual(Array(4).fill('2026-01-09'))
    // ordered by latitude then longitude, with the mask's own coordinates and weights
    expect(r.map((x) => [Number(x.latitude), Number(x.longitude), Number(x.weight), Number(x.value)])).toEqual([
      [20.00, -160.00, 1.00, 25.5],
      [20.00, -159.95, 0.50, 26.5],
      [20.05, -160.00, 1.00, 27.5],
      [20.05, -159.95, 0.25, 29.5],
    ])
  })
  it('drops cells outside the mask', () => {
    const r = duck(render('last_step', { expr: 's."SST"', slab: 'slab', mask: 'mask' }))
    expect(r.some((x) => Number(x.value) === 99)).toBe(false)
  })
})

describe.skipIf(!haveDuckdb)('stats_daily.sql', () => {
  it('computes the plain and the area-weighted mean', () => {
    const r = duck(render('stats_daily', { expr: 's."SST"', slab: 'slab', mask: 'mask' }))
    expect(r).toHaveLength(2)
    expect(Number(r[0].mean)).toBeCloseTo((25 + 26 + 27 + 29) / 4, 10)
    expect(Number(r[0].mean_wt)).toBeCloseTo((25 * 1 + 26 * 0.5 + 27 * 1 + 29 * 0.25) / 2.75, 10)
    expect(r[0].n).toBe(4)
  })
  it('applies a unit conversion given in the value expression', () => {
    const r = duck(render('stats_daily', { expr: '(s."SST" + 273.15)', slab: 'slab', mask: 'mask' }))
    expect(Number(r[0].mean)).toBeCloseTo((25 + 26 + 27 + 29) / 4 + 273.15, 8)
  })
})
