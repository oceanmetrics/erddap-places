// the published gazetteer: a STAC catalog on object storage, with places.parquet (GeoParquet) as the
// place list. we read the whole 4 MB file once with hyparquet (pure JS, no server, no DuckDB spatial
// extension) and decode the WKB geometry with our own src/lib/wkb.ts.
import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { wkbToGeoJSON, polygonCoordinates } from './wkb'
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson'

/** primary base URL for the published catalog (trailing slash). */
export const GAZETTEER_BASE = 'https://storage.oceanmetrics.io/gazetteer/'
/** same objects, straight from the bucket: used when the storage host does not answer. */
export const GAZETTEER_FALLBACK = 'https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/'

let activeBase: string | null = null
/** the base URL that last answered (after `gazetteerFetch`), for display. */
export const gazetteerBase = () => activeBase ?? GAZETTEER_BASE

/** fetch `path` under the gazetteer base, falling back to the bucket URL on any failure. */
export async function gazetteerFetch(path: string, init?: RequestInit): Promise<Response> {
  const bases = activeBase ? [activeBase, ...[GAZETTEER_BASE, GAZETTEER_FALLBACK].filter((b) => b !== activeBase)]
                          : [GAZETTEER_BASE, GAZETTEER_FALLBACK]
  let last: unknown
  for (const base of bases) {
    try {
      const res = await fetch(base + path.replace(/^\//, ''), init)
      if (!res.ok) { last = new Error(`${base}${path}: ${res.status} ${res.statusText}`); continue }
      activeBase = base
      return res
    } catch (e) { last = e }
  }
  throw new Error(`gazetteer unreachable for ${path}: ${last instanceof Error ? last.message : String(last)}`)
}

// ── places ────────────────────────────────────────────────────────────────────
export interface Place {
  place_id : string                                   // e.g. NMS:HIHWNMS
  gazetteer: string                                   // NMS | MRGID | PSGID
  name     : string
  area_km2 : number
  bbox     : [number, number, number, number]         // [xmin, ymin, xmax, ymax]
  geometry : Geometry                                 // MULTIPOLYGON, already split at ±180
}

// hyparquet's column parsers. it does ship a WKB decoder of its own, but we pass ours so the app and
// wkb.test.ts exercise the same code; the rest are the library defaults, restated because
// DEFAULT_PARSERS is not exported from the package entry point.
const decoder = new TextDecoder()
const parsers = {
  timestampFromMilliseconds: (ms: bigint) => new Date(Number(ms)),
  timestampFromMicroseconds: (us: bigint) => new Date(Number(us / 1000n)),
  timestampFromNanoseconds : (ns: bigint) => new Date(Number(ns / 1000000n)),
  dateFromDays             : (d: number)  => new Date(d * 86400000),
  stringFromBytes          : (b: Uint8Array) => b && decoder.decode(b),
  jsonFromBytes            : (b: Uint8Array) => b && JSON.parse(decoder.decode(b)),
  geometryFromBytes        : (b: Uint8Array) => b && wkbToGeoJSON(b),
  geographyFromBytes       : (b: Uint8Array) => b && wkbToGeoJSON(b),
  uuidFromBytes            : (b: Uint8Array) => b && Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''),
} as any

/** rows of places.parquet, geometry decoded to GeoJSON. */
export async function loadPlaces(buffer?: ArrayBuffer): Promise<Place[]> {
  const ab = buffer ?? (await (await gazetteerFetch('places/places.parquet')).arrayBuffer())
  const rows = await parquetReadObjects({
    file       : ab,
    compressors,
    columns    : ['place_id', 'gazetteer', 'name', 'area_km2', 'bbox', 'geometry'],
    parsers,
  })
  return rows.map((r: any) => ({
    place_id : String(r.place_id),
    gazetteer: String(r.gazetteer),
    name     : String(r.name),
    area_km2 : Number(r.area_km2),
    bbox     : [Number(r.bbox.xmin), Number(r.bbox.ymin), Number(r.bbox.xmax), Number(r.bbox.ymax)] as [number, number, number, number],
    geometry : r.geometry as Geometry,
  })).sort((a, b) => a.gazetteer.localeCompare(b.gazetteer) || a.name.localeCompare(b.name))
}

// ── lobes ─────────────────────────────────────────────────────────────────────
/** one griddap request's worth of a place: its own bbox and the polygons inside it. */
export interface Lobe {
  id      : string
  bbox    : [number, number, number, number]
  geojson : FeatureCollection
  nParts  : number
}

const partBbox = (rings: number[][][]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of rings[0]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

/**
 * Split a place into the lobes that each get one griddap request.
 *
 * Parts are grouped by side of the antimeridian, and only when the place actually spans it (a
 * lon extent wider than 180°, as for PMNM): a place wholly on one side stays a single request
 * covering all its parts. The polygon parts themselves are never modified — the gazetteer has
 * already split them at ±180.
 */
export function placeLobes(place: Place): Lobe[] {
  const parts = polygonCoordinates(place.geometry)
  if (!parts.length) return []
  const boxes = parts.map(partBbox)
  const x0 = Math.min(...boxes.map((b) => b[0])), x1 = Math.max(...boxes.map((b) => b[2]))
  const split = x1 - x0 > 180

  const groups = new Map<string, number[]>()
  boxes.forEach((b, i) => {
    const g = !split ? 'all' : (b[0] + b[2]) / 2 < 0 ? 'W' : 'E'
    ;(groups.get(g) ?? groups.set(g, []).get(g)!).push(i)
  })

  const lobes: Lobe[] = []
  for (const [g, idx] of groups) {
    const feats: Feature<Polygon>[] = idx.map((i) => ({
      type: 'Feature', properties: { place_id: place.place_id },
      geometry: { type: 'Polygon', coordinates: parts[i] },
    }))
    lobes.push({
      id     : `${place.place_id}${g === 'all' ? '' : `:${g}`}`,
      bbox   : [Math.min(...idx.map((i) => boxes[i][0])), Math.min(...idx.map((i) => boxes[i][1])),
                Math.max(...idx.map((i) => boxes[i][2])), Math.max(...idx.map((i) => boxes[i][3]))],
      geojson: { type: 'FeatureCollection', features: feats },
      nParts : idx.length,
    })
  }
  return lobes.sort((a, b) => a.bbox[0] - b.bbox[0])
}
