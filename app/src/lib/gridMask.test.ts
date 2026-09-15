// gridMask against the four NOAA sanctuary fixtures on the CRW 5 km lattice. the exact
// centre-inside counts are the regression contract: 124 / 152 / 352 / 54,480 (spikes/gridmask_bench.mjs).
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gridMask, polygonParts, axisEdges } from './gridMask'
import type { FeatureCollection } from 'geojson'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const RES = 0.05, ORIGIN = -179.975 // CRW 5 km grid: cell centres at ORIGIN + k*RES

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(DIR, '__fixtures__', `${name}.geojson`), 'utf8')) as FeatureCollection

function bbox(gj: FeatureCollection): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of polygonParts(gj)) {
    x0 = Math.min(x0, p.bbox[0]); y0 = Math.min(y0, p.bbox[1])
    x1 = Math.max(x1, p.bbox[2]); y1 = Math.max(y1, p.bbox[3])
  }
  return [x0, y0, x1, y1]
}
/** the CRW axis values ERDDAP would return for a bbox, padded a cell; lat descending as on the server. */
function crwAxes(gj: FeatureCollection) {
  const [x0, y0, x1, y1] = bbox(gj)
  const k = (v: number) => Math.round((v - ORIGIN) / RES)
  const seq = (a: number, b: number) => {
    const out: number[] = []
    for (let i = a; i <= b; i++) out.push(Number((ORIGIN + i * RES).toFixed(3)))
    return out
  }
  const lon = seq(k(x0) - 1, k(x1) + 1)
  const lat = seq(k(y0) - 1, k(y1) + 1).reverse() // ERDDAP latitude is descending
  return { lon, lat }
}

const CASES: Array<[string, number]> = [['HIHWNMS', 124], ['CINMS', 152], ['FKNMS', 352], ['PMNM', 54_480]]

describe('axisEdges', () => {
  it('uses midpoints and extrapolates the ends', () => {
    expect(axisEdges([0, 1, 2])).toEqual([-0.5, 0.5, 1.5, 2.5])
  })
  it('handles a descending axis and irregular spacing', () => {
    expect(axisEdges([10, 6, 4])).toEqual([12, 8, 5, 3])
    expect(axisEdges([0, 1, 3, 7])).toEqual([-0.5, 0.5, 2, 5, 9])
  })
})

describe('gridMask: exact centre-inside counts on the CRW lattice', () => {
  for (const [name, n] of CASES) {
    it(`${name} scan = ${n}`, () => {
      const gj = fixture(name)
      const { lon, lat } = crwAxes(gj)
      const r = gridMask(gj, lon, lat, { method: 'scan', weights: false })
      expect(r.method).toBe('scan')
      expect(r.nInside).toBe(n)
      expect(r.cells.length).toBe(n)
    }, 30_000)

    // PMNM has 101k candidate cells; turf point-in-polygon takes a few seconds there but is still exact.
    it(`${name} turf = ${n}`, () => {
      const gj = fixture(name)
      const { lon, lat } = crwAxes(gj)
      const r = gridMask(gj, lon, lat, { method: 'turf', weights: false })
      expect(r.method).toBe('turf')
      expect(r.nInside).toBe(n)
    }, 60_000)
  }
})

describe('gridMask: weights', () => {
  for (const [name, n] of CASES) {
    it(`${name} weights are fractions bracketed by nInside and nCandidates`, () => {
      const gj = fixture(name)
      const { lon, lat } = crwAxes(gj)
      const r = gridMask(gj, lon, lat, { method: 'scan' }) // weights default true
      expect(r.nInside).toBe(n)
      expect(r.cells.length).toBeGreaterThanOrEqual(n)
      for (const c of r.cells) { expect(c.weight).toBeGreaterThan(0); expect(c.weight).toBeLessThanOrEqual(1) }
      const sum      = r.cells.reduce((s, c) => s + c.weight, 0)
      const boundary = r.cells.filter((c) => c.weight < 0.999).length
      expect(sum).toBeLessThanOrEqual(r.nCandidates)
      expect(sum).toBeGreaterThanOrEqual(n - boundary)
    }, 120_000)
  }
})

describe('gridMask: auto method and axis order', () => {
  it('picks turf for a small place and scan for a big one', () => {
    expect(gridMask(fixture('HIHWNMS'), ...Object.values(crwAxes(fixture('HIHWNMS'))) as [number[], number[]], { weights: false }).method).toBe('scan') // HIHWNMS has > 5,000 vertices
    const sq: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }],
    }
    const lon = [0.25, 0.5, 0.75], lat = [0.75, 0.5, 0.25]
    const r = gridMask(sq, lon, lat, { weights: false })
    expect(r.method).toBe('turf')
    expect(r.nInside).toBe(9)
  })
  it('gives the same cells whether latitude ascends or descends', () => {
    const gj = fixture('CINMS')
    const { lon, lat } = crwAxes(gj)
    const a = gridMask(gj, lon, lat, { method: 'scan', weights: false })
    const b = gridMask(gj, lon, [...lat].reverse(), { method: 'scan', weights: false })
    expect(b.nInside).toBe(a.nInside)
    expect(b.cells).toEqual(a.cells)
  })
})
