// the pure rules of the precompute: the request window, the chunking, the file/id naming, the
// rendered SQL and the item geometry. everything here runs offline against tiny fixtures.
import { describe, expect, it } from 'vitest'
import { chunkDaysFor, chunks, fileSafe, itemId, statsHref, window } from './stats'
import { buildCollection, buildItem, lobeBoxGeometry, writeThumbnail, CATEGORICAL_COLUMNS, DAILY_COLUMNS } from './stac'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from './sql'
import { MAX_CHUNK_DAYS } from './targets'
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
