// the then-now mode, offline: URL state, the day-of-year calendar, COG band reads + Then averaging
// on the committed fixture (served by a fake ranged `fetch`), colour domains and the series SQL
// (run by the native duckdb CLI on the fixture parquet; skipped when duckdb is not installed).
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bandDate, bandToMd, dateToBand, isLeap, mdLabel, mdToBand, stepMd } from './doy'
import { DEFAULTS, decodeThenNow, encodeThenNow, isThenNowHash, parseRange, type ThenNowState } from './state'
import { CogReader, diffBands, latticeAxes, latticeWeights, meanBands, sameLattice, valueAt } from './cog'
import { gridMask } from '../gridMask'
import { climUrl, emptyYears, parseRasterCollection, placeItemLinks, placesWith, rasterUrl, seriesUrl, thenSources } from './data'
import { anomalyDomain, colorize, exceedance, lut, paletteStops, sharedDomain } from './scale'
import { seriesSql } from './series'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures') + '/'
const ROOT = 'https://fixture.invalid/gazetteer/'
const P = 'NMS:TEST'

/** the fixture's closed form (see fixtures/make_fixture.mjs) */
const value = (year: number, band: number, row: number, col: number) =>
  row + col < 3 || (band === 60 && !isLeap(year)) ? NaN
    : 20 + 0.01 * band + 0.5 * (year - 2024) + 0.1 * col - 0.05 * row

/** a fetch that serves the fixture files, honouring `Range: bytes=a-b`, and logs every request. */
function fixtureFetch(log: { url: string; range: string | null; bytes: number }[] = []): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    const url = String(input)
    if (!url.startsWith(ROOT)) return new Response(null, { status: 404 })
    let buf: Buffer
    try { buf = readFileSync(FIX + decodeURIComponent(url.slice(ROOT.length))) }
    catch { return new Response(null, { status: 404 }) }
    const h = new Headers(init?.headers as any)
    const range = h.get('range')
    const m = range && /bytes=(\d+)-(\d+)/.exec(range)
    if (m) {
      const a = Number(m[1]), b = Math.min(Number(m[2]), buf.length - 1)
      const body = buf.subarray(a, b + 1)
      log.push({ url, range, bytes: body.length })
      return new Response(new Uint8Array(body), { status: 206, headers: {
        'content-range': `bytes ${a}-${b}/${buf.length}`, 'content-length': String(body.length) } })
    }
    log.push({ url, range: null, bytes: buf.length })
    return new Response(new Uint8Array(buf), { status: 200 })
  }) as any
}

describe('then-now URL state', () => {
  it('round-trips every field', () => {
    const s: ThenNowState = { place: 'NMS:FKNMS', dataset: 'dhw_5km', variable: 'CRW_SST', md: '02-29',
      then: '1990-1999', now: 2023, swipe: 0.25, anom: true, pal: 'viridis', data: '' }
    const h = encodeThenNow(s)
    expect(h).toContain('mode=then-now')
    expect(h).toContain('place=NMS:FKNMS')            // colon kept literal, like the run permalink
    expect(isThenNowHash(h)).toBe(true)
    expect(decodeThenNow(h)).toEqual(s)
    expect(decodeThenNow(encodeThenNow(DEFAULTS))).toEqual(DEFAULTS)
  })
  it('keeps the presets and "latest", and falls back on malformed values', () => {
    const d = decodeThenNow('#mode=then-now&then=2003-2012&now=latest&md=02-30&swipe=7&anom=1')
    expect(d.then).toBe('2003-2012'); expect(d.now).toBe('latest')
    expect(d.md).toBe(DEFAULTS.md)                   // 30 Feb does not exist
    expect(d.swipe).toBe(1)                          // clamped
    expect(d.anom).toBe(true)
    expect(decodeThenNow('#mode=then-now&then=2005-1985').then).toBe(DEFAULTS.then)
    expect(isThenNowHash('#place=NMS:FKNMS')).toBe(false)
    expect(isThenNowHash('')).toBe(false)
    expect(parseRange('1985-2005')).toEqual([1985, 2005])
  })
})

describe('day of year <-> band', () => {
  it('follows the leap-year calendar: 29 Feb is band 60, 1 Mar is 61 in every year', () => {
    expect(mdToBand('01-01')).toBe(1)
    expect(mdToBand('02-29')).toBe(60)
    expect(mdToBand('03-01')).toBe(61)
    expect(mdToBand('12-31')).toBe(366)
    expect(dateToBand('2025-03-01')).toBe(61)
    expect(dateToBand('2024-03-01')).toBe(61)
    expect(dateToBand('2025-08-05')).toBe(218)
    expect(bandToMd(60)).toBe('02-29')
    for (let b = 1; b <= 366; b++) expect(mdToBand(bandToMd(b))).toBe(b)
  })
  it('has no 29 Feb in a non-leap year, and wraps the month-day stepper', () => {
    expect(bandDate(2025, 60)).toBeNull()
    expect(bandDate(2024, 60)).toBe('2024-02-29')
    expect(bandDate(2000, 366)).toBe('2000-12-31')
    expect(() => mdToBand('02-30')).toThrow()
    expect(stepMd('12-31', 1)).toBe('01-01')
    expect(stepMd('01-01', -1)).toBe('12-31')
    expect(stepMd('02-28', 1)).toBe('02-29')
    expect(mdLabel('08-05')).toBe('05 Aug')
  })
})

describe('data paths and the rasters collection', () => {
  it('builds the contract URLs', () => {
    expect(rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', 'NMS:FKNMS', 2025)).toBe(`${ROOT}rasters/dhw_5km/CRW_SST/NMS%3AFKNMS/2025.tif`)
    expect(climUrl(ROOT, 'dhw_5km', 'CRW_SST', 'NMS:FKNMS', '1985-2005')).toBe(`${ROOT}climatology/dhw_5km/CRW_SST/NMS%3AFKNMS/1985-2005_mean.tif`)
    expect(seriesUrl(ROOT, 'dhw_5km', 'CRW_SST', 'NMS:FKNMS')).toBe(`${ROOT}series/dhw_5km/CRW_SST/NMS%3AFKNMS.parquet`)
    const b = thenSources(ROOT, 'dhw_5km', 'CRW_SST', P, '1985-2005', [1985, 2025])
    expect(b.kind).toBe('baseline'); expect(b.urls).toHaveLength(1); expect(b.years).toHaveLength(21)
    const c = thenSources(ROOT, 'dhw_5km', 'CRW_SST', P, '1980-1987', [1985, 2025])
    expect(c.kind).toBe('custom'); expect(c.years).toEqual([1985, 1986, 1987])   // clipped to the archive
  })
  it('finds a place\'s year Items and the all-NaN years among them', () => {
    const col = { links: [
      { rel: 'item', href: './items/dhw_5km_CRW_SST_NMS-MBNMS_2014.json' },
      { rel: 'item', href: './items/dhw_5km_CRW_SST_NMS-MBNMS_2015.json' },
      { rel: 'item', href: './items/dhw_5km_CRW_SST_NMS-MNMS_2015.json' },     // another place
      { rel: 'item', href: './items/dhw_5km_CRW_SST_NMS-MBNMSX_2015.json' },   // a prefix is not a match
      { rel: 'self', href: './collection.json' }] }
    expect(placeItemLinks(col, 'dhw_5km', 'CRW_SST', 'NMS:MBNMS').map((l) => l.year)).toEqual([2014, 2015])
    const items = [2014, 2015].map((y) => ({ properties: { 'erddap-places:year': y, 'erddap-places:n_days_valid': y === 2015 ? 0 : 365 } }))
    const empty = emptyYears(items)
    expect([...empty]).toEqual([2015])
    // a custom Then skips the empty year instead of averaging a band of NaN
    expect(thenSources(ROOT, 'dhw_5km', 'CRW_SST', 'NMS:MBNMS', '2013-2016', [1985, 2026], undefined, empty).years).toEqual([2013, 2014, 2016])
  })
  it('reads places from summaries, item links or asset hrefs', () => {
    // the shape catalog/build_then_now.py publishes
    const a = parseRasterCollection({ summaries: { 'erddap-places:dataset_id': ['dhw_5km'], 'erddap-places:variable': ['CRW_SST'],
      'erddap-places:place_id': ['NMS:FKNMS', 'NMS:CINMS'], 'erddap-places:baselines': ['1985-2005', '2003-2012'],
      year: { minimum: 1985, maximum: 2025 } }, extent: { temporal: { interval: [['1985-01-01T00:00:00Z', '2026-01-01T00:00:00Z']] } } })
    expect([...placesWith(a, 'dhw_5km', 'CRW_SST')]).toEqual(['NMS:FKNMS', 'NMS:CINMS'])
    expect(a.years).toEqual([1985, 2025])                          // year summary beats the interval
    expect(a.baselines).toEqual(['1985-2005', '2003-2012'])
    const f = parseRasterCollection(JSON.parse(readFileSync(FIX + 'rasters/collection.json', 'utf8')))
    expect([...placesWith(f, 'dhw_5km', 'CRW_SST')]).toEqual(['NMS:TEST'])
    expect(f.baselines).toEqual(['2024-2025']); expect(f.years).toEqual([2024, 2025])
    // a published baseline is one climatology read; the same range not on offer is averaged
    expect(thenSources(ROOT, 'dhw_5km', 'CRW_SST', P, '2024-2025', f.years, f.baselines).kind).toBe('baseline')
    expect(thenSources(ROOT, 'dhw_5km', 'CRW_SST', P, '2024-2025', f.years).urls).toHaveLength(2)
    const b = parseRasterCollection({ links: [{ rel: 'item', href: './rasters/dhw_5km/CRW_SST/NMS:MBNMS/item.json' },
      { rel: 'item', href: 'rasters/dhw_5km/CRW_SST/NMS%3AGRNMS/2020.json' }, { rel: 'self', href: './collection.json' }] })
    expect([...placesWith(b, 'dhw_5km', 'CRW_SST')].sort()).toEqual(['NMS:GRNMS', 'NMS:MBNMS'])
    expect(placesWith(b, 'dhw_5km', 'NOPE').size).toBe(0)
  })
})

describe('COG band reads on the fixture', () => {
  it('reads one band with range requests and gets the closed-form values', async () => {
    const log: any[] = []
    const r = new CogReader(fixtureFetch(log))
    const b = await r.read(rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', P, 2025), 218)
    expect([b.width, b.height]).toEqual([20, 20])
    expect(b.bbox.map((v) => +v.toFixed(6))).toEqual([-81, 24.5, -80, 25.5])
    expect(b.data[2 * 20 + 5]).toBeCloseTo(value(2025, 218, 2, 5), 4)
    expect(b.data[19 * 20 + 19]).toBeCloseTo(value(2025, 218, 19, 19), 4)
    expect(Number.isNaN(b.data[0])).toBe(true)                    // outside the "sanctuary"
    expect(valueAt(b, b.data, -81 + 0.05 * 5.5, 25.5 - 0.05 * 2.5)).toBeCloseTo(value(2025, 218, 2, 5), 4)
    expect(Number.isNaN(valueAt(b, b.data, -82, 25))).toBe(true)
    // every request was a range, and well short of the 250 kB file
    expect(log.every((l) => l.range)).toBe(true)
    expect(r.meter.bytes).toBeLessThan(120_000)
    const before = r.meter.bytes
    await r.read(rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', P, 2025), 218)   // memoised
    expect(r.meter.bytes).toBe(before)
  })
  it('band 60 is NaN in a non-leap year and real in a leap year', async () => {
    const r = new CogReader(fixtureFetch())
    const b25 = await r.read(rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', P, 2025), 60)
    const b24 = await r.read(rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', P, 2024), 60)
    expect(b25.data.every((v) => Number.isNaN(v))).toBe(true)
    expect(b24.data[2 * 20 + 5]).toBeCloseTo(value(2024, 60, 2, 5), 4)
  })
  it('a custom Then range averaged in the browser equals the published climatology', async () => {
    const r = new CogReader(fixtureFetch())
    for (const band of [1, 60, 61, 218, 366]) {
      const ys = await Promise.all([2024, 2025].map((y) => r.read(rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', P, y), band)))
      const mean = meanBands(ys)
      const clim = await r.read(climUrl(ROOT, 'dhw_5km', 'CRW_SST', P, '2024-2025'), band)
      expect(sameLattice(ys[0], clim)).toBe(true)
      for (let i = 0; i < mean.length; i++) {
        if (Number.isNaN(clim.data[i])) expect(Number.isNaN(mean[i])).toBe(true)
        else expect(mean[i]).toBeCloseTo(clim.data[i], 4)
      }
    }
    // band 60: 2025 is NaN, so the mean is 2024 alone (n = 1), not NaN
    const b = await Promise.all([2024, 2025].map((y) => r.read(rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', P, y), 60)))
    expect(meanBands(b)[2 * 20 + 5]).toBeCloseTo(value(2024, 60, 2, 5), 4)
  })
  it('the anomaly is Now - Then per pixel', async () => {
    const r = new CogReader(fixtureFetch())
    const now  = await r.read(rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', P, 2025), 218)
    const then = await r.read(rasterUrl(ROOT, 'dhw_5km', 'CRW_SST', P, 2024), 218)
    const d = diffBands(now.data, then.data)
    expect(d[2 * 20 + 5]).toBeCloseTo(0.5, 4)                     // the fixture warms 0.5 °C a year
    const ex = exceedance(d, now, 0.4)
    expect(ex.valid).toBe(400 - 6)                                // row + col < 3 is 6 pixels
    expect(ex.n).toBe(ex.valid)
    expect(exceedance(d, now, 1).n).toBe(0)
    // a 0.05° pixel at 25° N is about 5.04 x 5.53 km
    expect(ex.km2 / ex.n).toBeGreaterThan(27); expect(ex.km2 / ex.n).toBeLessThan(28.5)
    // masked to a polygon: the rasters are a buffered box, so only the pixels of the place count
    const ax = latticeAxes(now)
    expect(ax.lon[0]).toBeCloseTo(-80.975, 9); expect(ax.lat[0]).toBeCloseTo(25.475, 9)
    const sq = { type: 'Polygon' as const, coordinates: [[[-80.5, 24.75], [-80.25, 24.75], [-80.25, 25], [-80.5, 25], [-80.5, 24.75]]] }
    const wts = latticeWeights(now, gridMask(sq, ax.lon, ax.lat).cells)
    const inside = exceedance(d, now, 0.4, wts)
    expect(inside.n).toBe(25)                                     // a 0.25° square = 5 x 5 pixels
    expect(inside.validKm2 / inside.km2).toBeCloseTo(1, 9)
    expect(inside.km2).toBeCloseTo(25 * ex.km2 / ex.n, -1)
  })
})

describe('colour scales', () => {
  it('shares one domain across Then and Now, ignoring NaN', () => {
    expect(sharedDomain(Float32Array.from([1, NaN, 3]), Float32Array.from([2, 5, NaN]))).toEqual([1, 5])
    expect(sharedDomain(Float32Array.from([NaN]))).toBeNull()
    expect(sharedDomain([2, 2])).toEqual([1.5, 2.5])             // a flat raster still gets a span
  })
  it('centres the anomaly domain on zero', () => {
    const [lo, hi] = anomalyDomain(Float32Array.from([-0.2, 1.7, NaN]))
    expect(lo).toBeCloseTo(-1.7, 6); expect(hi).toBeCloseTo(1.7, 6)
    expect(anomalyDomain(Float32Array.from([0.1]))).toEqual([-0.5, 0.5])
  })
  it('colours the ends of the domain with the ends of the palette, NaN transparent', () => {
    const t = lut(paletteStops('viridis'))
    const px = colorize(Float32Array.from([0, 10, NaN, 99]), [0, 10], t)
    expect(Array.from(px.slice(0, 3))).toEqual([0x44, 0x01, 0x54])
    expect(Array.from(px.slice(4, 7))).toEqual([0xfd, 0xe7, 0x25])
    expect(px[11]).toBe(0)                                         // NaN: alpha 0
    expect(Array.from(px.slice(12, 15))).toEqual([0xfd, 0xe7, 0x25]) // clamped
    expect(paletteStops('spectral')[0]).toBe('#5e4fa2')            // reversed: blue = cold
  })
})

const haveDuckdb = (() => {
  try { execFileSync('duckdb', ['-c', 'select 1'], { stdio: 'ignore' }); return true } catch { return false }
})()

describe('series SQL', () => {
  it('renders the Then range, the smoothing window and the band calendar', () => {
    const q = seriesSql({ src: "x'.parquet", then: [1985, 2005], smooth: 7 })
    expect(q).toContain("read_parquet('x''.parquet')")
    expect(q).toContain('BETWEEN 1985 AND 2005')
    expect(q).toContain('ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING')
    expect(q).toContain('make_date(2000, month(date), day(date))')
    expect(seriesSql({ src: 'a', then: [1, 2] })).not.toContain('OVER')
  })
  it.skipIf(!haveDuckdb)('runs on the fixture parquet: bands, climatology and anomaly', () => {
    const src = FIX + `series/dhw_5km/CRW_SST/${P}.parquet`
    const run = (q: string) => JSON.parse(execFileSync('duckdb', ['-json', '-c', q], { encoding: 'utf8' }) || '[]')
    const rows = run(seriesSql({ src, then: [2020, 2022] }))
    expect(rows).toHaveLength(6 * 365 + 2)                        // 2020-2025, two leap years
    const at = (y: number, b: number) => rows.find((r: any) => r.year === y && r.band === b)
    expect(at(2021, 60)).toBeUndefined()                           // no 29 Feb in 2021
    expect(at(2021, 61).date).toBe('2021-03-01')
    expect(at(2020, 61).date).toBe('2020-03-01')
    // the fixture adds 0.1 °C a year: the 2025 anomaly against 2020-2022 is ~ +0.4 on every day
    // that all three Then years share (band 60 only has 2020)
    expect(at(2025, 218).anom).toBeCloseTo(0.4, 3)
    expect(at(2025, 61).anom).toBeCloseTo(0.4, 3)
    expect(at(2020, 60).anom).toBeCloseTo(0, 6)
    // smoothing keeps one row per day
    expect(run(seriesSql({ src, then: [2020, 2022], smooth: 7 }))).toHaveLength(rows.length)
  })
})
