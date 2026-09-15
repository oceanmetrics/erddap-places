// Regression: the place -> mask path must stay fast, and must never run on reactive (proxied) data.
//
// Svelte 5's deep `$state` proxy wraps every nested coordinate array, and gridMask reads each vertex
// many times: masking FKNMS (13 parts, 39,645 vertices) measured 0.24 s on plain arrays and 67 s
// through the proxy — the freeze seen in the browser on selecting "Florida Keys". The app now holds
// places in `$state.raw` and unwraps with plainPlace() before any heavy work.
import { describe, expect, it, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { proxy } from 'svelte/internal/client'
import { gazetteerFetch, loadPlaces, placeLobes, plainPlace, plainGeometry, type Place } from './gazetteer'
import { countVertices, gridMask, polygonParts } from './gridMask'
import type { FeatureCollection } from 'geojson'

const DIR    = path.dirname(fileURLToPath(import.meta.url))
const BUDGET = 1000                        // ms for decode + lobes + mask with weights
const RES = 0.05, ORIGIN = -179.975        // the CRW 5 km lattice the app requests

/** the CRW axis vectors ERDDAP returns for a bbox, padded a cell (latitude descending). */
function crwAxes(b: [number, number, number, number]) {
  const k   = (v: number) => Math.round((v - ORIGIN) / RES)
  const seq = (a: number, z: number) => { const o: number[] = []; for (let i = a; i <= z; i++) o.push(Number((ORIGIN + i * RES).toFixed(3))); return o }
  return { lon: seq(k(b[0]) - 1, k(b[2]) + 1), lat: seq(k(b[1]) - 1, k(b[3]) + 1).reverse() }
}
const fixture = (n: string) => JSON.parse(fs.readFileSync(path.join(DIR, '__fixtures__', `${n}.geojson`), 'utf8')) as FeatureCollection
const asPlace = (gj: FeatureCollection): Place => ({
  place_id: 'NMS:FKNMS', gazetteer: 'NMS', name: 'Florida Keys', area_km2: 0,
  bbox: [-83.1498852, 24.300408, -80.0664707, 25.6504576],
  geometry: { type: 'MultiPolygon', coordinates: polygonParts(gj).map((p) => p.rings) },
})

/** decode -> lobes -> mask with weights, exactly as App.svelte's run() does it. */
function maskPlace(p: Place) {
  const t0 = performance.now()
  const lobes = placeLobes(plainPlace(p))
  const out = lobes.map((l) => gridMask(l.geojson, crwAxes(l.bbox).lon, crwAxes(l.bbox).lat))
  return { lobes, out, ms: performance.now() - t0, cells: out.reduce((s, m) => s + m.cells.length, 0) }
}

describe('FKNMS mask stays under a second', () => {
  const fknms = asPlace(fixture('FKNMS'))

  it('the fixture is the full-resolution Florida Keys geometry (13 parts, 39,645 vertices)', () => {
    const ps = polygonParts(fixture('FKNMS'))
    expect(ps.length).toBe(13)
    expect(countVertices(ps)).toBe(39_645)
  })

  it('plain geometry: lobes + weighted mask well inside the budget', () => {
    const r = maskPlace(fknms)
    expect(r.out[0].nInside).toBe(352)
    expect(r.ms).toBeLessThan(BUDGET)
  })

  it('reactive ($state-proxied) geometry: plainPlace() unwraps it and keeps the budget', () => {
    const reactive = proxy(fknms) as Place
    expect(util.types.isProxy(reactive.geometry)).toBe(true)
    const plain = plainPlace(reactive)
    expect(util.types.isProxy(plain.geometry)).toBe(false)
    expect(util.types.isProxy((plain.geometry as any).coordinates[0][0])).toBe(false)
    const r = maskPlace(reactive)                      // unwrapped inside maskPlace too
    expect(r.out[0].nInside).toBe(352)
    expect(r.ms).toBeLessThan(BUDGET)                  // 67 s before the fix
  })

  it('plainGeometry() preserves the coordinates exactly', () => {
    expect(plainGeometry(fknms.geometry)).toEqual(fknms.geometry)
  })
})

// ── the published places.parquet, end to end ──────────────────────────────────
let buf: ArrayBuffer | null = null
beforeAll(async () => {
  if (process.env.ERDDAP_OFFLINE) return
  try { buf = await (await gazetteerFetch('places/places.parquet')).arrayBuffer() }
  catch { console.warn('gazetteer unreachable: skipping the live places.parquet mask test') }
}, 120_000)

describe('the app path from places.parquet', () => {
  it('decodes NMS:FKNMS and masks it with weights in under a second', async () => {
    if (!buf) return
    const t0 = performance.now()
    const places = await loadPlaces(buf)
    const p = places.find((x) => x.place_id === 'NMS:FKNMS')!
    const r = maskPlace(p)
    const total = performance.now() - t0                // parquet decode + lobes + mask, no network
    expect(r.cells).toBeGreaterThan(352)                // boundary cells carry partial weights
    expect(total).toBeLessThan(BUDGET)
  }, 120_000)
})
