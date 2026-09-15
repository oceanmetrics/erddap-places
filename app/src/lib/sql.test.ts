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
    expect(templateNames()).toEqual(expect.arrayContaining(
      ['stats_daily', 'stats_categorical', 'last_step', 'stats_tabledap', 'points_tabledap']))
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

// ── tabledap (point samples) ──────────────────────────────────────────────────
/** two stations, two cruises a quarter apart, three depths each; one station outside the mask. */
const TABLE_FIXTURE = `
CREATE TABLE mask AS SELECT * FROM (VALUES
  (34.00, -120.50, 1.0), (34.10, -120.60, 1.0)
) t(latitude, longitude, weight);
CREATE TABLE slab AS SELECT * FROM (VALUES
  (TIMESTAMPTZ '2015-01-27 08:34:10Z', 34.00, -120.50,  0.0, 'temperature', 15.0),
  (TIMESTAMPTZ '2015-01-27 08:34:10Z', 34.00, -120.50, 10.0, 'temperature', 14.0),
  (TIMESTAMPTZ '2015-01-27 08:34:10Z', 34.00, -120.50, 20.0, 'temperature', 13.0),
  (TIMESTAMPTZ '2015-01-27 11:02:00Z', 34.10, -120.60,  0.0, 'temperature', 16.0),
  (TIMESTAMPTZ '2015-01-27 11:02:00Z', 34.10, -120.60, 10.0, 'temperature', 12.0),
  (TIMESTAMPTZ '2015-04-14 09:00:00Z', 34.00, -120.50,  0.0, 'temperature', 18.0),
  (TIMESTAMPTZ '2015-04-14 09:00:00Z', 34.00, -120.50, 10.0, 'temperature', NULL),
  -- a station outside the place: it must not reach any statistic
  (TIMESTAMPTZ '2015-01-27 08:34:10Z', 40.00,  -60.00,  0.0, 'temperature', 99.0)
) t("time", latitude, longitude, depth, measurement_type, measurement_value);
`

function duckTable(sql: string): Record<string, any>[] {
  const out = execFileSync('duckdb', ['-json', '-c', TABLE_FIXTURE + sql], { encoding: 'utf8' })
  return JSON.parse(out || '[]')
}

const TPARAMS = { expr: 's."measurement_value"', slab: 'slab', mask: 'mask' }

describe.skipIf(!haveDuckdb)('stats_tabledap.sql', () => {
  const rows = () => duckTable(render('stats_tabledap', TPARAMS))

  it('rolls the sparse points up by month, not by day', () => {
    const r = rows()
    expect(r.map((x) => x.date)).toEqual(['2015-01-01', '2015-04-01'])
  })
  it('counts measurements and the distinct casts behind them', () => {
    const [jan, apr] = rows()
    expect(jan.n).toBe(5)        // 3 depths at one station + 2 at the other
    expect(jan.n_casts).toBe(2)  // but only two sampling events
    expect(apr.n).toBe(1)        // the NULL measurement is not counted
    expect(apr.n_casts).toBe(1)
  })
  it('computes the month mean, sd and the min-max band the chart draws', () => {
    const [jan] = rows()
    expect(Number(jan.mean)).toBeCloseTo((15 + 14 + 13 + 16 + 12) / 5, 10)
    expect(Number(jan.min)).toBe(12)
    expect(Number(jan.max)).toBe(16)
    expect(Number(jan.p10)).toBeCloseTo(12.4, 6)   // quantile_cont over 12,13,14,15,16
    expect(Number(jan.p90)).toBeCloseTo(15.6, 6)
    expect(Number(jan.sd)).toBeGreaterThan(0)
  })
  it('drops the samples that are not in the point mask', () => {
    expect(rows().some((x) => Number(x.max) === 99)).toBe(false)
  })
  it('honours a unit conversion given in the value expression', () => {
    const r = duckTable(render('stats_tabledap', { ...TPARAMS, expr: '(s."measurement_value" + 273.15)' }))
    expect(Number(r[0].mean)).toBeCloseTo((15 + 14 + 13 + 16 + 12) / 5 + 273.15, 8)
  })
})

describe.skipIf(!haveDuckdb)('points_tabledap.sql', () => {
  it('gives the map one row per station: its mean, its n and its last sample date', () => {
    const r = duckTable(render('points_tabledap', TPARAMS))
    expect(r).toHaveLength(2)
    const a = r.find((x) => Number(x.latitude) === 34)!
    expect(Number(a.longitude)).toBe(-120.5)
    expect(Number(a.mean ?? a.value)).toBeCloseTo((15 + 14 + 13 + 18) / 4, 10)
    expect(a.n).toBe(4)
    expect(a.date).toBe('2015-04-14')
    expect(Number(a.weight)).toBe(1)
  })
})
