// gridMask: mark the grid cells of an ERDDAP axis lattice that fall inside a place polygon, and
// give boundary cells a partial-area weight. no spatial extension, no server: plain JS + turf.
//
// axis vectors are the dataset's own axis values (any monotonic direction, any spacing). cell edges
// are the midpoints between neighbours, with the two ends extrapolated by half the end spacing.
// polygon lobes must already be split at +-180 (the gazetteer does that); each polygon part is
// handled on its own, so MULTIPOLYGONs work.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import bboxClip            from '@turf/bbox-clip'
import area                from '@turf/area'
import { polygon as tPolygon } from '@turf/helpers'
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson'

export type GeoInput = FeatureCollection | Feature | Geometry
export type MaskMethod = 'auto' | 'scan' | 'turf'

export interface MaskCell { lon: number; lat: number; weight: number }
export interface MaskResult {
  cells       : MaskCell[]   // one row per included cell (centre inside, or boundary-touching when weighted)
  nCandidates : number       // cells whose centre falls in some part's bbox
  nInside     : number       // cells whose centre is inside the polygon
  method      : 'scan' | 'turf'
  ms          : number
}
export interface MaskOptions { weights?: boolean; method?: MaskMethod }

// ── axis geometry ─────────────────────────────────────────────────────────────
/** cell edges for a monotonic axis: midpoints between neighbours, ends extrapolated. */
export function axisEdges(v: number[]): number[] {
  const n = v.length
  if (n === 0) return []
  if (n === 1) return [v[0] - 0.5, v[0] + 0.5] // unknown spacing: assume 1
  const e = new Array<number>(n + 1)
  for (let i = 1; i < n; i++) e[i] = (v[i - 1] + v[i]) / 2
  e[0] = v[0] - (v[1] - v[0]) / 2
  e[n] = v[n - 1] + (v[n - 1] - v[n - 2]) / 2
  return e
}

/** an axis prepared for lookup: ascending values + edges, plus the map back to the caller's order. */
interface Axis {
  val  : number[]   // ascending values
  lo   : number[]   // ascending lower edges
  hi   : number[]   // ascending upper edges
  uniform: number   // spacing when uniform, else 0
  min  : number
  max  : number
}
function prepAxis(v: number[]): Axis {
  const desc = v.length > 1 && v[1] < v[0]
  const val  = desc ? [...v].reverse() : [...v]
  const e    = axisEdges(val)
  const lo   = e.slice(0, -1), hi = e.slice(1)
  let uniform = val.length > 1 ? val[1] - val[0] : 0
  for (let i = 2; i < val.length; i++)
    if (Math.abs(val[i] - val[i - 1] - uniform) > Math.abs(uniform) * 1e-6) { uniform = 0; break }
  return { val, lo, hi, uniform, min: e[0], max: e[e.length - 1] }
}
/** index of the cell containing x, or -1. uniform axes short-circuit; others binary-search. */
function cellIndex(a: Axis, x: number): number {
  if (x < a.min || x > a.max) return -1
  if (a.uniform) {
    const i = Math.floor((x - a.min) / a.uniform)
    return i < 0 ? 0 : i >= a.val.length ? a.val.length - 1 : i
  }
  let lo = 0, hi = a.val.length - 1
  while (lo < hi) { const m = (lo + hi) >> 1; if (x > a.hi[m]) lo = m + 1; else hi = m }
  return lo
}
/** smallest index with hi[i] >= x (the first cell that could contain x or anything above it). */
function lowerIndex(a: Axis, x: number): number {
  if (x <= a.min) return 0
  if (x > a.max) return a.val.length
  return cellIndex(a, x)
}
function upperIndex(a: Axis, x: number): number {
  if (x >= a.max) return a.val.length - 1
  if (x < a.min) return -1
  return cellIndex(a, x)
}

// ── polygon parts ─────────────────────────────────────────────────────────────
interface Part { rings: number[][][]; bbox: [number, number, number, number]; feat: Feature<Polygon> }
export function polygonParts(gj: GeoInput): Part[] {
  const feats: Feature[] =
    (gj as FeatureCollection).type === 'FeatureCollection' ? (gj as FeatureCollection).features
    : (gj as Feature).type === 'Feature'                   ? [gj as Feature]
    : [{ type: 'Feature', properties: {}, geometry: gj as Geometry }]
  const out: Part[] = []
  for (const f of feats) {
    const g = f.geometry as Geometry
    if (!g) continue
    let polys: number[][][][]
    if      (g.type === 'Polygon')      polys = [g.coordinates as number[][][]]
    else if (g.type === 'MultiPolygon') polys = g.coordinates as number[][][][]
    else if (g.type === 'GeometryCollection')
      { for (const sub of g.geometries) out.push(...polygonParts(sub)); continue }
    else continue
    for (const rings of polys) {
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity
      for (const [x, y] of rings[0]) {
        if (x < xmin) xmin = x; if (x > xmax) xmax = x
        if (y < ymin) ymin = y; if (y > ymax) ymax = y
      }
      out.push({ rings, bbox: [xmin, ymin, xmax, ymax], feat: tPolygon(rings) })
    }
  }
  return out
}
export function countVertices(ps: Part[]): number {
  return ps.reduce((s, p) => s + p.rings.reduce((t, r) => t + r.length, 0), 0)
}

// ── masking ───────────────────────────────────────────────────────────────────
const key = (i: number, j: number) => i * 1e7 + j

/** candidate cells = union over parts of the cells whose centre lies in that part's bbox. */
function candidates(ps: Part[], ax: Axis, ay: Axis): Set<number> {
  const set = new Set<number>()
  for (const p of ps) {
    const [x0, y0, x1, y1] = p.bbox
    const i0 = lowerIndex(ax, x0), i1 = upperIndex(ax, x1)
    const j0 = lowerIndex(ay, y0), j1 = upperIndex(ay, y1)
    for (let i = i0; i <= i1; i++) {
      if (i < 0 || i >= ax.val.length || ax.val[i] < x0 || ax.val[i] > x1) continue
      for (let j = j0; j <= j1; j++) {
        if (j < 0 || j >= ay.val.length || ay.val[j] < y0 || ay.val[j] > y1) continue
        set.add(key(i, j))
      }
    }
  }
  return set
}

/** A) turf point-in-polygon per candidate cell centre, with a part-bbox prefilter. */
function maskTurf(ps: Part[], cands: Set<number>, ax: Axis, ay: Axis): Set<number> {
  const m = new Set<number>()
  for (const k of cands) {
    const i = Math.floor(k / 1e7), j = k - i * 1e7
    const x = ax.val[i], y = ay.val[j]
    for (const p of ps) {
      const [x0, y0, x1, y1] = p.bbox
      if (x < x0 || x > x1 || y < y0 || y > y1) continue
      if (booleanPointInPolygon([x, y], p.feat)) { m.add(k); break }
    }
  }
  return m
}

/** B) scanline fill: for each grid row, x-crossings of every ring, fill the columns between pairs. */
function maskScan(ps: Part[], ax: Axis, ay: Axis): Set<number> {
  const m = new Set<number>()
  for (const p of ps) {
    const [, y0, , y1] = p.bbox
    const j0 = Math.max(0, lowerIndex(ay, y0)), j1 = Math.min(ay.val.length - 1, upperIndex(ay, y1))
    for (let j = j0; j <= j1; j++) {
      const y = ay.val[j]
      if (y < y0 || y > y1) continue
      const xs: number[] = []
      for (const ring of p.rings) {
        for (let k = 0, n = ring.length - 1; k < n; k++) {
          const [axx, ayy] = ring[k], [bx, by] = ring[k + 1]
          if ((ayy > y) !== (by > y)) xs.push(axx + (y - ayy) * (bx - axx) / (by - ayy))
        }
      }
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // cells whose centre lies in [xs[k], xs[k+1]]
        let i0 = lowerIndex(ax, xs[k]); if (i0 < ax.val.length && ax.val[i0] < xs[k]) i0++
        let i1 = upperIndex(ax, xs[k + 1]); if (i1 >= 0 && ax.val[i1] > xs[k + 1]) i1--
        for (let i = Math.max(0, i0); i <= Math.min(ax.val.length - 1, i1); i++) m.add(key(i, j))
      }
    }
  }
  return m
}

/** C) partial-cell area weights: clip each part to the cell rectangle and divide by the cell area. */
function cellWeights(ps: Part[], inside: Set<number>, ax: Axis, ay: Axis): Map<number, number> {
  const w   = new Map<number, number>()
  const all = new Set<number>(inside)
  // also the 8-neighbours: cells whose centre is outside but whose square the polygon touches
  for (const k of inside) {
    const i = Math.floor(k / 1e7), j = k - i * 1e7
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ii = i + di, jj = j + dj
      if (ii >= 0 && ii < ax.val.length && jj >= 0 && jj < ay.val.length) all.add(key(ii, jj))
    }
  }
  for (const k of all) {
    const i = Math.floor(k / 1e7), j = k - i * 1e7
    const x0 = ax.lo[i], x1 = ax.hi[i], y0 = ay.lo[j], y1 = ay.hi[j]
    const cell = tPolygon([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]])
    const cellArea = area(cell)
    if (!(cellArea > 0)) continue
    let a = 0
    for (const p of ps) {
      const [px0, py0, px1, py1] = p.bbox
      if (x1 < px0 || x0 > px1 || y1 < py0 || y0 > py1) continue
      a += area(bboxClip(p.feat, [x0, y0, x1, y1]) as Feature<any>)
    }
    const f = a / cellArea
    if (f > 0) w.set(k, Math.min(f, 1))
  }
  return w
}

/**
 * Grid cells of the (lon, lat) lattice covered by `geojson`.
 *
 * `method: 'auto'` uses turf point-in-polygon for small problems (< 10,000 candidate cells and
 * < 5,000 vertices) and the scanline fill otherwise; both are exact and agree.
 * `weights: true` (the default) adds the partial-cell area fraction: 1 for interior cells,
 * fractional for boundary cells, and cells whose centre is outside but whose square the polygon
 * clips are included with their fraction too.
 */
export function gridMask(geojson: GeoInput, lon: number[], lat: number[], opts: MaskOptions = {}): MaskResult {
  const t0       = (globalThis.performance ?? Date).now()
  const weights  = opts.weights !== false
  const ps       = polygonParts(geojson)
  const ax       = prepAxis(lon), ay = prepAxis(lat)
  if (!ps.length || !ax.val.length || !ay.val.length)
    return { cells: [], nCandidates: 0, nInside: 0, method: 'scan', ms: 0 }

  const cands = candidates(ps, ax, ay)
  const nv    = countVertices(ps)
  const method: 'scan' | 'turf' =
    opts.method === 'scan' || opts.method === 'turf' ? opts.method
    : (cands.size < 10_000 && nv < 5_000) ? 'turf' : 'scan'

  const inside = method === 'turf' ? maskTurf(ps, cands, ax, ay) : maskScan(ps, ax, ay)
  const w      = weights ? cellWeights(ps, inside, ax, ay) : null

  const cells: MaskCell[] = []
  const emit = (k: number, weight: number) => {
    const i = Math.floor(k / 1e7), j = k - i * 1e7
    cells.push({ lon: ax.val[i], lat: ay.val[j], weight })
  }
  if (w) for (const [k, f] of w) emit(k, f)
  else   for (const k of inside) emit(k, 1)
  cells.sort((a, b) => a.lat - b.lat || a.lon - b.lon)

  return { cells, nCandidates: cands.size, nInside: inside.size, method, ms: (globalThis.performance ?? Date).now() - t0 }
}

// ── point masking (tabledap) ──────────────────────────────────────────────────
/** a sampling position, as it comes out of a tabledap slab. */
export interface MaskPoint { lon: number; lat: number }
export interface PointMaskResult { cells: MaskCell[]; nCandidates: number; nInside: number; ms: number }

/**
 * The positions inside a place polygon, for a **tabledap** (point) dataset.
 *
 * There is no lattice and no partial cell here: a sample is in or out, so every kept position gets
 * weight 1 and the caller can feed the result straight into the same `mask` table the grid path
 * uses. Duplicate positions (one station, many casts and depths) are collapsed, which is what makes
 * this cheap: a two-degree CalCOFI box over five years is tens of stations, not thousands of rows.
 * The bbox of each polygon part prefilters, exactly as `maskTurf` does.
 */
export function pointMask(geojson: GeoInput, points: MaskPoint[]): PointMaskResult {
  const t0 = (globalThis.performance ?? Date).now()
  const ps = polygonParts(geojson)
  const seen = new Map<string, MaskPoint>()
  for (const p of points) {
    if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue
    const k = `${p.lon},${p.lat}`
    if (!seen.has(k)) seen.set(k, p)
  }
  const cells: MaskCell[] = []
  for (const p of seen.values()) {
    for (const part of ps) {
      const [x0, y0, x1, y1] = part.bbox
      if (p.lon < x0 || p.lon > x1 || p.lat < y0 || p.lat > y1) continue
      if (booleanPointInPolygon([p.lon, p.lat], part.feat)) { cells.push({ lon: p.lon, lat: p.lat, weight: 1 }); break }
    }
  }
  cells.sort((a, b) => a.lat - b.lat || a.lon - b.lon)
  return {
    cells, nCandidates: seen.size, nInside: cells.length,
    ms: (globalThis.performance ?? Date).now() - t0,
  }
}
