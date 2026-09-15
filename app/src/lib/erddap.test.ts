// URL shape is asserted offline; the live PacIOOS fetches run only when the network is reachable
// (set ERDDAP_OFFLINE=1 to force-skip).
import { describe, expect, it, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { constraint, fetchAxis, fetchSlab, griddapUrl, griddapUrls, noonZ, parseCsvp, pickFormat } from './erddap'
import { gridMask, polygonParts } from './gridMask'
import type { FeatureCollection } from 'geojson'

const BASE = 'https://pae-paha.pacioos.hawaii.edu/erddap'
const DIR  = path.dirname(fileURLToPath(import.meta.url))

describe('griddapUrl', () => {
  it('encodes only the constraint brackets and honours a descending latitude axis', () => {
    const url = griddapUrl({
      base: BASE + '/', datasetId: 'dhw_5km', variable: 'CRW_SST',
      time: ['2026-08-01T12:00:00Z', '2026-08-30T12:00:00Z'],
      lat: [18.8, 22.4], lon: [-160.3, -154.5], latDescending: true,
    })
    expect(url).toBe(
      BASE + '/griddap/dhw_5km.parquet?CRW_SST' +
      '%5B(2026-08-01T12:00:00Z):1:(2026-08-30T12:00:00Z)%5D' +
      '%5B(22.4):1:(18.8)%5D' +
      '%5B(-160.3):1:(-154.5)%5D')
  })
  it('puts an ascending latitude axis the other way round', () => {
    const url = griddapUrl({ base: BASE, datasetId: 'd', variable: 'v', time: ['a', 'b'], lat: [1, 2], lon: [3, 4], latDescending: false })
    expect(url).toContain('%5B(1):1:(2)%5D%5B(3):1:(4)%5D')
  })
  it('appends the jsonp callback and uses .json', () => {
    const url = griddapUrl({ base: BASE, datasetId: 'd', variable: 'v', time: ['a', 'b'], lat: [1, 2], lon: [3, 4], format: 'jsonp', callback: 'cb1' })
    expect(url).toContain('/griddap/d.json?')
    expect(url.endsWith('&.jsonp=cb1')).toBe(true)
  })
  it('gives one URL per lobe', () => {
    const u = griddapUrls({ base: BASE, datasetId: 'd', variable: 'v', time: ['a', 'b'] },
                          [[-180, 20, -175, 30], [175, 20, 180, 30]])
    expect(u).toHaveLength(2)
    expect(u[0]).toContain('(-180):1:(-175)')
    expect(u[1]).toContain('(175):1:(180)')
  })
  it('constraint() and noonZ()', () => {
    expect(constraint(1, 2)).toBe('%5B(1):1:(2)%5D')
    expect(noonZ('2026-09-10')).toBe('2026-09-10T12:00:00Z')
    expect(noonZ(new Date('2026-09-10T03:00:00Z'))).toBe('2026-09-10T12:00:00Z')
  })
})

describe('pickFormat: the fallback rung', () => {
  it('parquet when the server advertises it', () => {
    expect(pickFormat({ erddap: { cors: true, formats: ['.parquet', '.csvp', '.json'] } })).toBe('parquet')
  })
  it('csvp for an older CORS server', () => {
    expect(pickFormat({ erddap: { cors: true, formats: ['.csvp', '.json'] } })).toBe('csvp')
  })
  it('jsonp when CORS is off, whatever the formats', () => {
    expect(pickFormat({ erddap: { cors: false, formats: ['.parquet'] } })).toBe('jsonp')
  })
})

describe('parseCsvp', () => {
  it('strips the units suffix and numbers the values', () => {
    const rows = parseCsvp('time (UTC),latitude (degrees_north),CRW_SST (degree_C)\n2026-08-01T12:00:00Z,21.375,26.1\n')
    expect(rows[0]).toEqual({ time: '2026-08-01T12:00:00Z', latitude: 21.375, CRW_SST: 26.1 })
  })
})

// ── live PacIOOS ──────────────────────────────────────────────────────────────
let online = false
beforeAll(async () => {
  if (process.env.ERDDAP_OFFLINE) return
  // latitude descends on this grid, so the probe puts the high value first
  const probe = `${BASE}/griddap/dhw_5km.json?latitude%5B(21.1):1:(21)%5D`
  online = await fetch(probe, { signal: AbortSignal.timeout(20_000) }).then((r) => r.ok).catch(() => false)
  if (!online) console.warn('PacIOOS unreachable: skipping the live ERDDAP tests')
}, 30_000)

describe('live PacIOOS dhw_5km', () => {
  it('fetches axis vectors on the CRW lattice', async () => {
    if (!online) return
    const lat = await fetchAxis(BASE, 'dhw_5km', 'latitude', 21.0, 21.2, true)
    expect(lat.length).toBeGreaterThan(2)
    expect(lat[0]).toBeGreaterThan(lat[lat.length - 1]) // descending
    for (const v of lat) { const k = (v + 179.975) / 0.05; expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-4) } // on the CRW lattice
  }, 60_000)

  it('fetches 5 days of CRW_SST over HIHWNMS as non-empty Parquet', async () => {
    if (!online) return
    const gj = JSON.parse(fs.readFileSync(path.join(DIR, '__fixtures__', 'HIHWNMS.geojson'), 'utf8')) as FeatureCollection
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of polygonParts(gj)) {
      x0 = Math.min(x0, p.bbox[0]); y0 = Math.min(y0, p.bbox[1])
      x1 = Math.max(x1, p.bbox[2]); y1 = Math.max(y1, p.bbox[3])
    }
    const [lon, lat] = await Promise.all([
      fetchAxis(BASE, 'dhw_5km', 'longitude', x0, x1),
      fetchAxis(BASE, 'dhw_5km', 'latitude',  y0, y1, true),
    ])
    const mask = gridMask(gj, lon, lat, { weights: false })
    expect(mask.nInside).toBe(124)

    const end = new Date(Date.now() - 2 * 864e5), start = new Date(end.getTime() - 4 * 864e5)
    const url = griddapUrl({
      base: BASE, datasetId: 'dhw_5km', variable: 'CRW_SST',
      time: [noonZ(start), noonZ(end)],
      lat : [lat[lat.length - 1], lat[0]], lon: [lon[0], lon[lon.length - 1]], latDescending: true,
    })
    const slab = await fetchSlab(url, 'parquet')
    expect(slab.bytes).toBeGreaterThan(1000)
    expect(slab.buffer!.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x41, 0x52, 0x31])) // "PAR1"
  }, 180_000)
})
