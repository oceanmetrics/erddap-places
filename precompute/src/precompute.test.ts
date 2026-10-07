// the pure rules of the precompute: the request window, the chunking, the file/id naming, the
// rendered SQL and the item geometry. everything here runs offline against tiny fixtures.
import { describe, expect, it } from 'vitest'
import { chunkDaysFor, chunks, extentOrSkip, fileSafe, itemId, liveExtent, loadDataset, statsHref, window, EXTENT_ATTEMPTS } from './stats'
import { buildCollection, buildItem, datasetProviders, lobeBoxGeometry, mergeItems, writeThumbnail, CATEGORICAL_COLUMNS, DAILY_COLUMNS } from './stac'
import { griddapUrl } from '../../app/src/lib/erddap'
import { TARGETS, placesFor } from './targets'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from './sql'
import { MAX_CHUNK_DAYS } from './targets'
import { vi } from 'vitest'
import type { TimeExtent } from '../../app/src/lib/extent'
import type { Place } from '../../app/src/lib/gazetteer'
import type { Provenance } from './stats'

const ext = (start: string, end: string, stepDays = 1): TimeExtent =>
  ({ start, end, stepDays, stepLabel: stepDays === 1 ? 'daily' : `${stepDays}-day` })

describe('window', () => {
  it('takes the last 365 days ending at the dataset\'s last time step', () => {
    expect(window(ext('1985-04-01T12:00:00Z', '2026-09-14T12:00:00Z'), 365))
      .toEqual({ start: '2025-09-15', end: '2026-09-14' })
  })
  it('never starts before a short dataset does', () => {
    expect(window(ext('2026-08-01T12:00:00Z', '2026-09-14T12:00:00Z'), 365))
      .toEqual({ start: '2026-08-01', end: '2026-09-14' })
  })
})

describe('window: full record', () => {
  it("'all' starts at the dataset's first time step", () => {
    expect(window(ext('2002-07-31T00:00:00Z', '2023-12-31T00:00:00Z', 30.5), 'all'))
      .toEqual({ start: '2002-07-31', end: '2023-12-31' })
  })
})

describe('chunks', () => {
  it('covers the window exactly once: consecutive, non-overlapping, no gaps', () => {
    const cs = chunks('2026-01-01', '2026-01-10', 4)
    expect(cs).toEqual([['2026-01-01', '2026-01-04'], ['2026-01-05', '2026-01-08'], ['2026-01-09', '2026-01-10']])
  })
  it('is a single chunk when the window fits', () => {
    expect(chunks('2026-01-01', '2026-01-10', 90)).toEqual([['2026-01-01', '2026-01-10']])
  })
  it('handles a one-day window', () => {
    expect(chunks('2026-01-01', '2026-01-01', 90)).toEqual([['2026-01-01', '2026-01-01']])
  })
})

describe('chunkDaysFor', () => {
  it('caps at MAX_CHUNK_DAYS for a small place', () => {
    expect(chunkDaysFor(6)).toBe(MAX_CHUNK_DAYS)                    // Gray's Reef: 6 cells a step
  })
  it('shrinks so one request stays near 2 M rows', () => {
    expect(chunkDaysFor(39_026)).toBe(51)                           // Pitcairn EEZ bbox
    expect(chunkDaysFor(39_026) * 39_026).toBeLessThanOrEqual(2_000_000)
  })
  it('never goes below a single step, however big the bbox', () => {
    expect(chunkDaysFor(50_000_000)).toBe(1)
  })
  it('counts an 8-day product in days, not steps', () => {
    expect(chunkDaysFor(250_000, 8)).toBe(64)                       // 8 steps x 8 days
  })
})

describe('chunkDaysFor: monthly', () => {
  it('counts up to MAX_CHUNK_DAYS time steps for a monthly product, not 90 days', () => {
    expect(chunkDaysFor(100, 30)).toBe(MAX_CHUNK_DAYS * 30)         // 90 months in one request
  })
  it('still shrinks a monthly product under the row cap', () => {
    expect(chunkDaysFor(100_000, 30)).toBe(600)                      // 20 steps x 30 days
  })
})

describe('targets', () => {
  const ids = ['MRGID:8439', 'NMS:CBNMS', 'NMS:PMNM', 'PSGID:939']
  it("'nms' picks the NMS:* places only", () => {
    expect(placesFor({ places: 'nms' }, ids)).toEqual(['NMS:CBNMS', 'NMS:PMNM'])
    expect(placesFor({ places: 'all' }, ids)).toEqual(ids)
    expect(placesFor({ places: ['PSGID:939'] }, ids)).toEqual(['PSGID:939'])
  })
  it('keeps the daily targets on the default window and runs the sanctuaries series over the full record', () => {
    expect(TARGETS.find((t) => t.variable === 'CRW_SST')!.days).toBeUndefined()
    const series = TARGETS.filter((t) => t.days === 'all')
    expect(series.map((t) => t.variable).sort()).toEqual(
      ['chl', 'dissic', 'fe', 'mlotst', 'no3', 'npp', 'nppv', 'o2', 'ph', 'phyc', 'po4', 'precipitation', 'si', 'so', 'spco2', 'tob', 'zooc'])
    expect(series.every((t) => t.places === 'nms')).toBe(true)
  })
  it('targets no pending or known-NaN dataset, and every target names a real collection variable', () => {
    for (const t of TARGETS) {
      const ds = loadDataset(t.dataset)
      expect(ds.status).toBeUndefined()
      expect(ds.variables.map((v) => v.name)).toContain(t.variable)
    }
    expect(TARGETS.some((t) => t.dataset === 'CMEMS_PHY_MONTHLY')).toBe(false)
  })
})

describe('depth: the surface slice of a 4-D CMEMS grid', () => {
  it('reads erddap-places:depth and puts one depth constraint between time and latitude', () => {
    const ds = loadDataset('cmems_biogeochem_phyto')
    expect(ds.depth).toBeCloseTo(0.494, 3)
    const url = griddapUrl({ base: ds.baseUrl, datasetId: ds.datasetId, variable: 'chl', time: ['a', 'b'],
      lat: [31, 32], lon: [-81, -80], latDescending: ds.latDescending, depth: ds.depth, format: 'parquet' })
    expect(url).toContain(`chl%5B(a):1:(b)%5D%5B(${ds.depth}):1:(${ds.depth})%5D%5B(31):1:(32)%5D`)
  })
  it('a 3-D grid has no depth', () => {
    expect(loadDataset('cmems_biogeochem_co2').depth).toBeUndefined()
    expect(loadDataset('dhw_5km').depth).toBeUndefined()
  })
})

describe('liveExtent: retry, then fail soft', () => {
  const ds = loadDataset('dhw_5km')
  const info = { table: { columnNames: ['Row Type', 'Variable Name', 'Attribute Name', 'Data Type', 'Value'], rows: [
    ['attribute', 'time', 'actual_range', 'double', '1.0E9, 1.1E9'],
    ['dimension', 'time', '', 'double', 'nValues=10, evenlySpaced=true, averageSpacing=1 day'],
  ] } }
  const ok = () => new Response(JSON.stringify(info), { status: 200 })
  const wait = vi.fn(async () => {})
  const log = () => {}
  it('survives two connect failures and returns the extent on the third try', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ok())
    const e = await liveExtent(ds, { fetchFn: fetchFn as any, wait, log })
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(e.start).toBe('2001-09-09T01:46:40Z')
    expect(e.stepLabel).toBe('daily')
  })
  it('gives up after the last attempt and lists every place of the target as failed', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const failed: string[] = ['earlier/x/NMS:A']
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const e = await extentOrSkip(ds, 'CRW_SST', ['NMS:CBNMS', 'NMS:PMNM'], failed, { fetchFn: fetchFn as any, wait, log })
    err.mockRestore()
    expect(e).toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(EXTENT_ATTEMPTS)
    expect(failed).toEqual(['earlier/x/NMS:A', 'dhw_5km/CRW_SST/NMS:CBNMS', 'dhw_5km/CRW_SST/NMS:PMNM'])
  })
  it('does not retry a 404 (a wrong dataset id is not transient)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' }))
    await expect(liveExtent(ds, { fetchFn: fetchFn as any, wait, log })).rejects.toThrow(/404/)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('naming', () => {
  it('keeps the colon in the object key and drops it from the item id', () => {
    expect(fileSafe('NMS:HIHWNMS')).toBe('NMS:HIHWNMS')
    expect(itemId('dhw_5km', 'CRW_SST', 'NMS:HIHWNMS')).toBe('dhw_5km_CRW_SST_NMS-HIHWNMS')
    expect(itemId('dhw_5km', 'CRW_SST', 'PSGID:939')).toBe('dhw_5km_CRW_SST_PSGID-939')
  })
  it('builds the documented path', () => {
    expect(statsHref('dhw_5km', 'CRW_SST', 'NMS:HIHWNMS')).toBe('./dhw_5km/CRW_SST/NMS:HIHWNMS.parquet')
  })
})

describe('sql templates', () => {
  it('renders the same text the app renders, with the slab and mask spliced literally', () => {
    const sql = render('stats_daily', { expr: 's."CRW_SST"', slab: "read_parquet('x.parquet')", mask: 'mask' })
    expect(sql).toContain('s."CRW_SST"')
    expect(sql).toContain("read_parquet('x.parquet')")
    expect(sql).toContain('sum(m.weight)')
    expect(sql).not.toContain('{{')
  })
  it('renders the categorical template', () => {
    const sql = render('stats_categorical', { expr: 's."CLASS"', slab: 'slab', mask: 'mask' })
    expect(sql).toContain('CAST(s."CLASS" AS BIGINT)')
    expect(sql).not.toContain('{{')
  })
})

// ── STAC ──────────────────────────────────────────────────────────────────────
const box = (x0: number, y0: number, x1: number, y1: number): number[][][] =>
  [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]

/** a two-lobe place straddling +-180, like PMNM, already split by the gazetteer. */
const PMNM: Place = {
  place_id: 'NMS:PMNM', gazetteer: 'NMS', name: 'Papahanaumokuakea', area_km2: 1_511_736,
  bbox: [-180, 19, 180, 32],
  geometry: { type: 'MultiPolygon', coordinates: [box(-180, 19, -161, 32), box(177, 25, 180, 30)] },
}
const SMALL: Place = {
  place_id: 'NMS:GRNMS', gazetteer: 'NMS', name: 'Gray\'s Reef', area_km2: 57,
  bbox: [-80.92, 31.36, -80.83, 31.42],
  geometry: { type: 'MultiPolygon', coordinates: [box(-80.92, 31.36, -80.83, 31.42)] },
}
const prov = (place: Place, variable: string, categorical: boolean): Provenance => ({
  place_id: place.place_id, dataset_id: 'dhw_5km', variable, categorical,
  start_date: '2025-09-15', end_date: '2026-09-14',
  start_datetime: '2025-09-15T12:00:00Z', end_datetime: '2026-09-14T12:00:00Z',
  lobes: 1, mask_cells: 6, griddap_urls: ['https://example.org/erddap/griddap/dhw_5km.parquet?x'],
  rows: 365, bytes: 1234, generated: '2026-09-15T00:00:00Z', erddap_base: 'https://example.org/erddap',
  sql: 'SELECT 1',
})

describe('item geometry', () => {
  it('is the lobe boxes, so an antimeridian place is two boxes and not the whole globe', () => {
    const g = lobeBoxGeometry(PMNM)
    expect(g.type).toBe('MultiPolygon')
    expect(g.coordinates).toHaveLength(2)
    const lons = g.coordinates.flat(2).map((c) => c[0])
    expect(Math.min(...lons)).toBe(-180)
    expect(Math.max(...lons)).toBe(180)
  })
  it('is one box for a single-lobe place', () => {
    expect(lobeBoxGeometry(SMALL).coordinates).toHaveLength(1)
  })
})

describe('buildItem', () => {
  const item = buildItem(prov(SMALL, 'CRW_SST', false), SMALL, 'CRW 5km') as any
  it('is a datetime-null Item with a closed interval', () => {
    expect(item.properties.datetime).toBeNull()
    expect(item.properties.start_datetime).toBe('2025-09-15T12:00:00Z')
    expect(item.properties.end_datetime).toBe('2026-09-14T12:00:00Z')
  })
  it('carries the erddap-places identity and the griddap provenance', () => {
    expect(item.properties['erddap-places:place_id']).toBe('NMS:GRNMS')
    expect(item.properties['erddap-places:dataset_id']).toBe('dhw_5km')
    expect(item.properties['erddap-places:variable']).toBe('CRW_SST')
    expect(item.properties['erddap-places:griddap_urls']).toHaveLength(1)
  })
  it('points at the parquet with the right media type, role and href', () => {
    expect(item.assets.data.type).toBe('application/vnd.apache.parquet')
    expect(item.assets.data.roles).toEqual(['data'])
    expect(item.assets.data.href).toBe('../../dhw_5km/CRW_SST/NMS:GRNMS.parquet')
  })
  it('describes the continuous schema for a continuous variable', () => {
    expect(item.assets.data['table:columns']).toBe(DAILY_COLUMNS)
  })
  it('describes the categorical schema for a categorical variable', () => {
    const cat = buildItem(prov(SMALL, 'CRW_BAA', true), SMALL, 'CRW 5km') as any
    expect(cat.assets.data['table:columns']).toBe(CATEGORICAL_COLUMNS)
    expect(cat.assets.data['table:columns'].map((c: any) => c.name)).toContain('frac_area')
    expect(cat.assets.data['table:columns'].map((c: any) => c.name)).toContain('pct_cells')
  })
})

describe('buildCollection', () => {
  const places = new Map([[SMALL.place_id, SMALL], [PMNM.place_id, PMNM]])
  const col = buildCollection([prov(SMALL, 'CRW_SST', false), prov(PMNM, 'CRW_BAA', true)], places) as any
  it('is a stats Collection with one item link per file', () => {
    expect(col.id).toBe('stats')
    expect(col.links.filter((l: any) => l.rel === 'item')).toHaveLength(2)
  })
  it('spans the union of the place bboxes and the full time window', () => {
    expect(col.extent.spatial.bbox[0]).toEqual([-180, 19, 180, 32])
    expect(col.extent.temporal.interval[0]).toEqual(['2025-09-15T12:00:00Z', '2026-09-14T12:00:00Z'])
  })
  it('summarises what is precomputed', () => {
    expect(col.summaries['erddap-places:variable']).toEqual(['CRW_SST', 'CRW_BAA'])
    expect(col.summaries['erddap-places:place_id']).toEqual(['NMS:GRNMS', 'NMS:PMNM'])
  })
  it('declares the table extension, not datacube', () => {
    expect(col['table:columns']).toBe(DAILY_COLUMNS)
    expect(col.stac_extensions.join(' ')).toContain('table')
    expect(col.stac_extensions.join(' ')).not.toContain('datacube')
  })
})

describe('partial runs keep the other items', () => {
  const r = (dataset_id: string, variable: string, place_id: string) =>
    ({ dataset_id, variable, place_id, start_datetime: '2025-01-01T00:00:00Z', end_datetime: '2025-12-01T00:00:00Z' })
  it('adds the earlier items this run did not recompute, if they are still targets', () => {
    const fresh   = [r('cmems_biogeochem_phyto', 'chl', 'NMS:CBNMS')]
    const earlier = [r('cmems_biogeochem_phyto', 'chl', 'NMS:CBNMS'), r('dhw_5km', 'CRW_SST', 'NMS:CBNMS'), r('gone', 'x', 'NMS:CBNMS')]
    const all = mergeItems(fresh, earlier, (d) => d !== 'gone')
    expect(all.map((x) => `${x.dataset_id}/${x.variable}`)).toEqual(['cmems_biogeochem_phyto/chl', 'dhw_5km/CRW_SST'])
  })
  it('credits every source dataset producer, Ocean Metrics last as host', () => {
    const p = datasetProviders(['dhw_5km', 'cmems_biogeochem_phyto', 'cmems_biogeochem_pp'])
    expect(p.map((x) => x.name)).toEqual([
      'NOAA Coral Reef Watch (CRW)', 'Copernicus Marine Service (CMEMS) / Mercator Ocean International', 'Ocean Metrics LLC'])
    expect(p.at(-1)!.roles).toContain('host')
  })
})

describe('thumbnail', () => {
  it('writes a real PNG (signature, IHDR dimensions, IEND)', () => {
    const path = join(tmpdir(), `stats-thumb-${process.pid}.png`)
    const n = writeThumbnail(path, [SMALL, PMNM])
    const b = readFileSync(path)
    expect(b.length).toBe(n)
    expect([...b.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(b.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(b.readUInt32BE(16)).toBe(480)
    expect(b.readUInt32BE(20)).toBe(240)
    expect(b.subarray(b.length - 8, b.length - 4).toString('ascii')).toBe('IEND')
    rmSync(path)
  })
})
