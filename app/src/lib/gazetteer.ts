// the published gazetteer: a STAC catalog on object storage, with places.parquet (GeoParquet) as the
// place list. we read the whole 4 MB file once with hyparquet (pure JS, no server, no DuckDB spatial
// extension) and decode the WKB geometry with our own src/lib/wkb.ts.
import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { wkbToGeoJSON, polygonCoordinates } from './wkb'
import { configure, getPlace, listLayers, loadIndex as clientIndex, type ClientConfig, type IndexPlace, type Layer } from './places'
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson'

/** primary base URL for the published catalog (trailing slash). */
export const GAZETTEER_BASE = 'https://storage.oceanmetrics.io/gazetteer/'
/** same objects, straight from the bucket: used when the storage host does not answer. */
export const GAZETTEER_FALLBACK = 'https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/'

/** the tippecanoe layer inside places.pmtiles (`-l places`): place_id, name, gazetteer, area_km2. */
export const PLACES_SOURCE_LAYER = 'places'

/**
 * credit for the places source; the map shows only the parts for the places on screen (placesAttribution).
 * the same string is the `attribution` field of the published PMTiles metadata (places 1.2.0); `gazetteer.test.ts` reads
 * that metadata live and fails if the two drift.
 */
export const PLACES_ATTRIBUTION =
  '<a href="https://sanctuaries.noaa.gov" target="_blank">NOAA ONMS</a> | ' +
  '<a href="https://www.marineregions.org" target="_blank">MarineRegions.org</a> (CC-BY-4.0) | ' +
  '<a href="https://protectedseas.net" target="_blank">ProtectedSeas</a>'

/** each gazetteer of the places source (the `place_id` prefix) and its part of PLACES_ATTRIBUTION, in that order. */
export const PLACES_CREDITS: [prefix: string, credit: string][] =
  PLACES_ATTRIBUTION.split(' | ').map((c, i) => [['NMS', 'MRGID', 'PSGID'][i], c])

/**
 * the map's credit for the places source: only the gazetteers of the places on screen (their `place_id`s),
 * in PLACES_ATTRIBUTION's order; '' when none is.
 */
export function placesAttribution(placeIds: Iterable<string>): string {
  const on = new Set<string>()
  for (const id of placeIds) on.add(String(id).split(':')[0])
  return PLACES_CREDITS.filter(([p]) => on.has(p)).map(([, c]) => c).join(' | ')
}

let activeBase: string | null = null
/** the base URL that last answered (after `gazetteerFetch`), for display. */
export const gazetteerBase = () => activeBase ?? GAZETTEER_BASE
/**
 * the vector tiles of the places, for the map: always straight from the bucket. the storage host
 * answers with a 302 that carries no `Access-Control-Allow-Origin`, and a browser rejects a
 * cross-origin redirect without it before following, so `pmtiles://` range requests through
 * `GAZETTEER_BASE` fail with status 0 from every origin but the host's own (verified 2026-10-08 with
 * `curl -I -H 'Origin: http://localhost:5179'`). the bucket answers 206 with CORS on the first hop,
 * and the tiles skip one redirect per range request. Then vs Now reads its COGs the same way.
 */
export const placesPmtilesUrl = () => `${GAZETTEER_FALLBACK}places/places.pmtiles`

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
  gazetteer: string                                   // NMS | MRGID | PSGID (the authority, for other collections)
  name     : string
  area_km2 : number
  bbox     : [number, number, number, number]         // [xmin, ymin, xmax, ymax]
  geometry : Geometry                                 // MULTIPOLYGON, already split at ±180
  /** the gazetteer collection the geometry came from; absent = `places` */
  collection?: string
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

let placesP: Promise<Place[]> | null = null
/**
 * rows of places.parquet (the 20 precomputed places), geometry decoded to GeoJSON. A call without a
 * buffer is read once and shared, so `placeGeometry()` for one of these ids costs nothing extra.
 */
export function loadPlaces(buffer?: ArrayBuffer): Promise<Place[]> {
  if (buffer) return readPlaces(buffer)
  if (!placesP) { placesP = readPlaces().catch((e) => { placesP = null; throw e }) }
  return placesP
}
async function readPlaces(buffer?: ArrayBuffer): Promise<Place[]> {
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

// ── plain (non-reactive) geometry ─────────────────────────────────────────────
/**
 * A plain deep copy of a coordinate tree.
 *
 * Svelte 5 `$state` proxies **every nested array**, and the mask reads each vertex many times, so a
 * place held in deep reactive state is catastrophic: FKNMS (13 parts, 39,645 vertices) masks in
 * 0.24 s plain and 67 s through the proxy — a 280x penalty that freezes the tab. The app keeps
 * places in `$state.raw`; this is the belt-and-braces unwrap right before the heavy work, and it
 * costs one read per vertex (~0.03 s plain, ~0.3 s proxied). `structuredClone` cannot be used: it
 * throws DataCloneError on a proxy.
 */
export function plainCoords<T>(c: T): T {
  return (Array.isArray(c) ? c.map(plainCoords) : c) as T
}
/** a plain copy of a GeoJSON geometry, free of any reactive proxy. */
export function plainGeometry(g: Geometry): Geometry {
  if (g.type === 'GeometryCollection')
    return { type: 'GeometryCollection', geometries: g.geometries.map(plainGeometry) }
  return { type: g.type, coordinates: plainCoords((g as any).coordinates) } as Geometry
}
/** a plain copy of a place, for the mask/lobe code paths. */
export function plainPlace(p: Place): Place {
  return { ...p, bbox: [...p.bbox] as Place['bbox'], geometry: plainGeometry(p.geometry) }
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

// ── the whole gazetteer: manifest, index, a place on demand ───────────────────
//
// three published files, all read from the bucket host (never the storage host: its 302 costs one
// redirect per range request):
//   layers.json                      the manifest, 22 collections (title, paint, credit, citation, licence)
//   index/places_index.parquet       one row per place of every collection (1.1 MB, no geometry)
//   <collection>/places.parquet      the geometry (WKB), read for ONE place with a row-group filtered range read
// the picker lists the index, the map draws a collection's PMTiles, and only the mask needs the polygon.

/** the collection of the 20 precomputed places: its geometry is already in memory (`loadPlaces`). */
export const PLACES_COLLECTION = 'places'
/** the geometry types a grid mask can use */
export const isPolygonal = (geomType: string | null | undefined) => !!geomType && /^(multi)?polygon$/i.test(geomType)

/** what identifies a place: place_id is NOT unique across collections (BOEM:OCS-P 0562 is in two). */
export interface PlaceKey { collection: string; place_id: string }
export const placeKey = (r: PlaceKey) => `${r.collection}\u0001${r.place_id}`

/** the PMTiles of a collection on the bucket host, whatever host the manifest names. */
export const bucketPmtiles = (slug: string) => `${GAZETTEER_FALLBACK}${slug}/places.pmtiles`
/** the manifest with every `pmtiles` rewritten to the bucket prefix (the manifest names the storage host). */
export const rewriteLayers = (layers: Layer[]): Layer[] => layers.map((l) => ({ ...l, pmtiles: bucketPmtiles(l.slug) }))
/** the collection's geometry file */
export const collectionParquet = (slug: string) => `${GAZETTEER_FALLBACK}${slug}/places.parquet`

// every request the client makes goes through here: it keeps the byte count of the polygon being
// loaded (for the status line) and stops reading when that run has been superseded
interface Load { url: string; bytes: number; total: number; signal?: AbortSignal; onProgress?: (bytes: number, total: number) => void }
let load: Load | null = null
let innerFetch: typeof fetch | null = null
let parquetOf: (slug: string) => string = collectionParquet
const totals = new Map<string, number>()      // HEAD Content-Length per url, remembered while the handle is cached

const abortError = () => new DOMException('the run was superseded', 'AbortError')

/** a fetch that counts the bytes of the collection file being read (the HEAD gives the file size). */
export async function meteredFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const l = load
  if (l?.signal?.aborted) throw abortError()
  const res = await (innerFetch ?? globalThis.fetch.bind(globalThis))(input, init)
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!l || !res.ok || url !== l.url) return res
  if (init?.method === 'HEAD') {
    const n = Number(res.headers.get('content-length'))
    if (n > 0) { totals.set(url, n); l.total = n }
    return res
  }
  if (!res.body) return res
  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      if (l.signal?.aborted) { reader.cancel().catch(() => {}); c.error(abortError()); return }
      const { done, value } = await reader.read()
      if (done) { c.close(); return }
      l.bytes += value.byteLength
      l.onProgress?.(l.bytes, l.total)
      c.enqueue(value)
    },
    cancel: (why) => reader.cancel(why),
  })
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
}

/**
 * Point the client at the bucket (and, for tests, at other URLs or a fake fetch). Clears every cache:
 * the manifest, the index, the open Parquet handles and the loaded places.
 */
export function configureGazetteer(next: Partial<ClientConfig> = {}) {
  innerFetch = next.fetch ?? null
  parquetOf = next.parquetUrl ?? collectionParquet
  placeCache.clear(); totals.clear(); layersMemo = null
  configure({ base: GAZETTEER_FALLBACK, layersUrl: undefined, indexUrl: undefined, ...next, parquetUrl: parquetOf, fetch: meteredFetch })
}

let layersMemo: { src: Layer[]; out: Layer[] } | null = null
/** the layers manifest, each `pmtiles` on the bucket host, in manifest order (cached). */
export async function loadLayers(): Promise<Layer[]> {
  const src = await listLayers()
  if (layersMemo?.src !== src) layersMemo = { src, out: rewriteLayers(src) }
  return layersMemo.out
}

/** every place of every collection (no geometry), only the columns the app uses; cached. */
export const loadIndex = (): Promise<IndexPlace[]> => clientIndex()

/** the 20 precomputed places as index rows, for the first paint (before the index is in). */
export function placeAsRow(p: Place): IndexPlace {
  return {
    place_id: p.place_id, name: p.name, authority: p.gazetteer, place_type: '', geom_type: 'MultiPolygon',
    collection: PLACES_COLLECTION, bbox: p.bbox, centroid: null, area_km2: p.area_km2 || null,
    license: null, attribution: null, version: null, updated: null,
  }
}

/** the index, by id and by (collection, id), plus the manifest order that breaks ties. */
export interface GazIndex {
  rows   : IndexPlace[]
  /** the rows a grid mask can use: polygons */
  polygons: IndexPlace[]
  byId   : Map<string, IndexPlace[]>
  /** collection slugs in manifest order */
  order  : string[]
}
export function buildIndex(rows: IndexPlace[], layers: Layer[]): GazIndex {
  const order = layers.map((l) => l.slug)
  const rank = (c: string) => { const i = order.indexOf(c); return i < 0 ? order.length : i }
  const byId = new Map<string, IndexPlace[]>()
  for (const r of rows) (byId.get(r.place_id) ?? byId.set(r.place_id, []).get(r.place_id)!).push(r)
  for (const list of byId.values()) if (list.length > 1) list.sort((a, b) => rank(a.collection) - rank(b.collection))
  return { rows, polygons: rows.filter((r) => isPolygonal(r.geom_type)), byId, order }
}

/**
 * The row a (place_id, collection) pair names. A `coll` that does not match falls back to the first
 * collection (manifest order) that has the id. `ambiguous` = the id occurs in more than one collection,
 * which is when the permalink carries `coll=`.
 */
export function resolvePlace(byId: Map<string, IndexPlace[]>, id: string, coll?: string | null): { row: IndexPlace | null; ambiguous: boolean } {
  const list = byId.get(id) ?? []
  const row = (coll && list.find((r) => r.collection === coll)) || list[0] || null
  return { row, ambiguous: list.length > 1 }
}

/** the `coll=` of the permalink: the collection when the id also exists in another one, else nothing. */
export const collForHash = (byId: Map<string, IndexPlace[]>, row: PlaceKey): string | undefined =>
  (byId.get(row.place_id)?.length ?? 0) > 1 ? row.collection : undefined

const placeCache = new Map<string, Place>()
/** a Place already loaded (or null): the cache is a plain Map, never reactive state. */
export const cachedPlace = (k: PlaceKey): Place | null => placeCache.get(placeKey(k)) ?? null

export interface GeometryOptions {
  signal?    : AbortSignal
  /** called as the collection file is read: bytes so far, and the file size when the HEAD gave it (else 0) */
  onProgress?: (bytes: number, total: number) => void
}

/**
 * The polygon of one place, ready for `placeLobes()`/`gridMask()`.
 *
 * The 20 `places` ids come from `loadPlaces()` (already in memory). Any other place is read from its
 * collection's `places.parquet` with the client's `getPlace(id, { slug, unwrap: false })`: a range read of
 * the footer and of the row group(s) whose `place_id` statistics can hold the id. How much that costs
 * depends on how the file was written: a collection written as one row group (noaa_sanctuaries, 5.5 MB)
 * costs the whole file, mpa_inventory's overlapping Morton row groups can cost 25–30 MB, and a small
 * collection costs a few kB. The geometry is NOT unwrapped: the parts stay split at ±180 for `placeLobes()`.
 * Results are cached by (collection, place_id).
 */
export async function placeGeometry(
  ref: PlaceKey & Partial<Pick<IndexPlace, 'name' | 'authority' | 'area_km2' | 'geom_type'>>,
  opts: GeometryOptions = {},
): Promise<Place> {
  const key = placeKey(ref)
  const hit = placeCache.get(key)
  if (hit) return hit
  if (ref.geom_type && !isPolygonal(ref.geom_type)) throw new Error(`${ref.name ?? ref.place_id} is a ${ref.geom_type}: only polygon places can be masked`)
  let place: Place | undefined
  if (ref.collection === PLACES_COLLECTION) {
    place = (await loadPlaces()).find((p) => p.place_id === ref.place_id)
    if (!place) throw new Error(`no place ${ref.place_id} in the places collection`)
  } else {
    const url = parquetOf(ref.collection)
    const mine: Load = { url, bytes: 0, total: totals.get(url) ?? 0, signal: opts.signal, onProgress: opts.onProgress }
    load = mine
    let f: Awaited<ReturnType<typeof getPlace>>
    try { f = await getPlace(ref.place_id, { slug: ref.collection, unwrap: false }) }
    finally { if (load === mine) load = null }
    if (opts.signal?.aborted) throw abortError()
    if (!f) throw new Error(`no place ${ref.place_id} in the ${ref.collection} collection`)
    if (!polygonCoordinates(f.geometry).length) throw new Error(`${ref.name ?? ref.place_id} is a ${f.geometry.type}: only polygon places can be masked`)
    const area = Number((f.properties as any)?.area_km2)
    place = {
      place_id: ref.place_id, collection: ref.collection,
      gazetteer: ref.authority ?? String(ref.place_id).split(':')[0],
      name: ref.name ?? String((f.properties as any)?.name ?? ref.place_id),
      area_km2: Number.isFinite(area) && area > 0 ? area : (ref.area_km2 ?? 0),
      bbox: (f.bbox ?? [0, 0, 0, 0]) as Place['bbox'],
      geometry: f.geometry,
    }
  }
  placeCache.set(key, place)
  return place
}

/** "12.3 MB" / "840 kB": the status line's byte counts */
export const fmtBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`)

/** the status line while a polygon loads: "loading X polygon from mpa_inventory (12.3 of 29.8 MB so far)…" */
export function polygonStatus(name: string, collection: string, bytes: number, total: number): string {
  const so = total > 0 ? `${fmtBytes(bytes)} of ${fmtBytes(total)}` : fmtBytes(bytes)
  return `loading ${name} polygon from ${collection} (${so} so far)…`
}

// what the map credits for a collection other than `places`: its own credit line, once. the `places`
// source already carries PLACES_ATTRIBUTION, and a collection that publishes the same string adds nothing.
export function collectionAttribution(layer: Pick<Layer, 'slug' | 'attribution_html'> | null | undefined): string {
  if (!layer || layer.slug === PLACES_COLLECTION) return ''
  const a = (layer.attribution_html ?? '').trim()
  return !a || a === PLACES_ATTRIBUTION ? '' : a
}

configureGazetteer()
