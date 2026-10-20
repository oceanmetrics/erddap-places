// places of a reference collection (Marine Regions, layers.json `kind: "raster"`): their geometry is not in the bucket
// (VLIZ asked us not to republish it; `mr_eez/places.parquet` answers 403) but one feature at a time from the
// publisher's WFS. offline with a mocked fetch; the live case at the bottom skips without the network (ERDDAP_OFFLINE=1).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  GAZETTEER_FALLBACK, configureGazetteer, featureUrl, geometryBbox, loadLayers, loadReferenceLayers, placeBbox, placeGeometry,
  placeLobes, polygonStatus, referenceLayers, referenceName, rewriteLayers, sourceIdOf, type Place,
} from './gazetteer'
import { gridMask } from './gridMask'
import { ErddapUnreachable } from './fetchRetry'
import type { Layer } from './places'

const HOST    = 'https://fixture.invalid/gazetteer/'
const WFS     = 'https://wfs.invalid/geoserver/wfs?typeName=MarineRegions:eez&outputFormat=application/json&CQL_FILTER=mrgid={source_id}'
const vector  = { slug: 'noaa_sanctuaries', title: 'Sanctuaries', collection: 'noaa_sanctuaries', kind: 'vector', raster: null,
                  pmtiles: 'https://storage.invalid/noaa_sanctuaries/places.pmtiles', source_layer: 'noaa_sanctuaries' }
const eez     = { slug: 'mr_eez', title: 'Marine Regions Exclusive Economic Zones', collection: 'mr_eez', kind: 'raster', pmtiles: null, source_layer: null,
                  attribution_html: 'Flanders Marine Institute (2023). CC BY 4.0.', license: 'CC-BY-4.0',
                  raster: { tiles: ['https://wms.invalid/{z}/{x}/{y}.png'], feature_url: WFS } }
const bare    = { ...eez, slug: 'mr_nofeature', title: 'No WFS', raster: { tiles: ['https://wms.invalid/{z}/{x}/{y}.png'] } }
const MANIFEST = { layers: [vector, eez, bare] }

const ring = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]
const feature = (geometry: unknown, properties: object = { geoname: 'Albanian Exclusive Economic Zone', area_km2: 12165 }) =>
  ({ type: 'Feature', properties, geometry })
const fc = (...features: unknown[]) => ({ type: 'FeatureCollection', features })
const ALBANIA = fc(feature({ type: 'MultiPolygon', coordinates: [ring(18.3, 39.6, 20.0, 42.0)] }))
// Fiji's EEZ as Marine Regions serves it: split at +-180 into an eastern and a western part
const FIJI = fc(feature({ type: 'MultiPolygon', coordinates: [ring(-180, -25, -176.3, -10), ring(172.8, -25, 180, -10)] }, { geoname: 'Fijian Exclusive Economic Zone' }))

let requests: string[] = []
let answer: (url: string, init?: RequestInit) => Response | Promise<Response> = () => new Response('', { status: 404 })
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const mock = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  requests.push(url)
  if (url === `${HOST}index/layers.json`) return json(MANIFEST)
  return answer(url, init)
}) as typeof fetch
const ref = (place_id: string, extra: object = {}) => ({ collection: 'mr_eez', place_id, name: `name of ${place_id}`, authority: 'MRGID', ...extra })
const fast = { retry: { wait: async () => {} } }

beforeAll(() => configureGazetteer({ base: HOST, fetch: mock }))
afterAll(() => configureGazetteer())

describe('reference collections in the manifest', () => {
  it('referenceLayers() keeps kind: raster rows that have a feature_url, loadLayers() still leaves every raster out of the map', async () => {
    expect(referenceLayers(MANIFEST.layers as unknown as Layer[]).map((l) => l.slug)).toEqual(['mr_eez'])
    expect((await loadReferenceLayers()).map((l) => l.slug)).toEqual(['mr_eez'])
    expect((await loadLayers()).map((l) => l.slug)).toEqual(['noaa_sanctuaries'])
    expect(rewriteLayers(MANIFEST.layers as unknown as Layer[]).map((l) => l.slug)).toEqual(['noaa_sanctuaries'])
  })

  it('builds the feature request from feature_url and the source id', () => {
    expect(featureUrl(WFS, '5670')).toBe(WFS.replace('{source_id}', '5670'))
    expect(featureUrl('https://x.invalid/?a={source_id}&b={source_id}', 'a b&c')).toBe('https://x.invalid/?a=a%20b%26c&b=a%20b%26c')
    expect(sourceIdOf({ place_id: 'MRGID:5670' })).toBe('5670')
    expect(sourceIdOf({ place_id: 'MRGID:5670', source_id: ' 99 ' })).toBe('99')
    expect(sourceIdOf({ place_id: 'MRGID:5670', source_id: '' })).toBe('5670')
  })

  it('names Marine Regions for its collections and the host for another publisher', () => {
    expect(referenceName(eez as unknown as Layer)).toBe('Marine Regions')
    expect(referenceName({ title: 'Some Atlas', raster: { feature_url: 'https://geo.example.org/wfs?x={source_id}' } })).toBe('geo.example.org')
    expect(polygonStatus('Albanian EEZ', 'mr_eez', 0, 0, 'Marine Regions')).toBe('loading Albanian EEZ polygon from Marine Regions (one feature)…')
    expect(polygonStatus('Albanian EEZ', 'mr_eez', 338_000, 338_000, 'Marine Regions')).toBe('loading Albanian EEZ polygon from Marine Regions (one feature, 338 kB)…')
    expect(polygonStatus('x', 'c', 840_000, 0)).toBe('loading x polygon from c (840 kB so far)…')    // unchanged for a vector collection
  })
})

describe('placeGeometry() for a reference collection', () => {
  it('requests the one feature, turns the GeoJSON into a Place and caches it; never touches the collection parquet', async () => {
    requests = []
    answer = () => json(ALBANIA)
    const seen: number[] = []
    const p = await placeGeometry(ref('MRGID:5670', { area_km2: 12165.5 }), { onProgress: (b) => seen.push(b) })
    expect(requests.filter((u) => u.includes('wfs.invalid'))).toEqual([WFS.replace('{source_id}', '5670')])
    expect(requests.some((u) => u.endsWith('.parquet'))).toBe(false)
    expect(p).toMatchObject({ place_id: 'MRGID:5670', collection: 'mr_eez', gazetteer: 'MRGID', name: 'name of MRGID:5670', area_km2: 12165.5 })
    expect(p.sourceUrl).toBe(WFS.replace('{source_id}', '5670'))
    expect(p.geometry.type).toBe('MultiPolygon')
    expect(p.bbox).toEqual([18.3, 39.6, 20, 42])
    expect(seen.length).toBeGreaterThan(0)
    const n = requests.length
    expect(await placeGeometry(ref('MRGID:5670'))).toBe(p)
    expect(requests.length).toBe(n)
  })

  it('takes the name and area from the feature when the index row has none, and the id from source_id when given', async () => {
    requests = []
    answer = () => json(ALBANIA)
    const p = await placeGeometry({ collection: 'mr_eez', place_id: 'MRGID:1', source_id: '5670' })
    expect(requests.some((u) => u.endsWith('mrgid=5670'))).toBe(true)
    expect(p.name).toBe('Albanian Exclusive Economic Zone')
    expect(p.area_km2).toBe(12165)
    expect(p.gazetteer).toBe('MRGID')
  })

  it('joins the polygons of several features and of a Polygon feature into one MultiPolygon', async () => {
    answer = () => json(fc(feature({ type: 'Polygon', coordinates: ring(0, 0, 1, 1) }), feature({ type: 'MultiPolygon', coordinates: [ring(2, 2, 3, 3)] })))
    const p = await placeGeometry(ref('MRGID:2'))
    expect(p.geometry).toMatchObject({ type: 'MultiPolygon' })
    expect((p.geometry as any).coordinates).toHaveLength(2)
    expect(p.bbox).toEqual([0, 0, 3, 3])
  })

  it('refuses a point, an empty answer, a 404 and a non-GeoJSON body with an error that says who and why', async () => {
    answer = () => json(fc(feature({ type: 'Point', coordinates: [1, 1] })))
    await expect(placeGeometry(ref('MRGID:3'), fast)).rejects.toThrow(/name of MRGID:3 is a Point: only polygon places can be masked/)
    answer = () => json(fc())
    await expect(placeGeometry(ref('MRGID:4'), fast)).rejects.toThrow(/no place MRGID:4 at Marine Regions/)
    answer = () => new Response('nope', { status: 404, statusText: 'Not Found' })
    await expect(placeGeometry(ref('MRGID:5'), fast)).rejects.toThrow(/wfs\.invalid answered HTTP 404 Not Found for name of MRGID:5/)
    answer = () => new Response('<html>busy</html>', { status: 200 })
    await expect(placeGeometry(ref('MRGID:6'), fast)).rejects.toThrow(/wfs\.invalid did not answer with GeoJSON/)
    // nothing failed is cached
    answer = () => json(ALBANIA)
    await expect(placeGeometry(ref('MRGID:5'), fast)).resolves.toMatchObject({ place_id: 'MRGID:5' })
  })

  it('retries a 5xx once and then names the host', async () => {
    requests = []
    answer = () => new Response('', { status: 503, statusText: 'Service Unavailable' })
    const e = await placeGeometry(ref('MRGID:7'), fast).catch((x) => x)
    expect(e).toBeInstanceOf(ErddapUnreachable)
    expect(e.message).toMatch(/^wfs\.invalid did not answer \(HTTP 503 Service Unavailable, 2 tries\)/)
    expect(requests.filter((u) => u.includes('wfs.invalid'))).toHaveLength(2)
    answer = () => { throw new TypeError('Failed to fetch') }
    await expect(placeGeometry(ref('MRGID:8'), fast)).rejects.toThrow(/wfs\.invalid did not answer \(network error: Failed to fetch, 2 tries\)/)
  })

  it('stops when its run was superseded: before the request and while it is in flight', async () => {
    const before = new AbortController(); before.abort()
    requests = []
    await expect(placeGeometry(ref('MRGID:9'), { signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests.some((u) => u.includes('wfs.invalid'))).toBe(false)
    const ac = new AbortController()
    answer = (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason)))
    const run = placeGeometry(ref('MRGID:10'), { signal: ac.signal })
    setTimeout(() => ac.abort(), 10)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('still reads a vector collection from its parquet, and a collection without a feature_url is not a reference', async () => {
    requests = []
    answer = () => new Response('', { status: 403, statusText: 'Forbidden' })
    await expect(placeGeometry({ collection: 'mr_nofeature', place_id: 'MRGID:11' })).rejects.toThrow()
    expect(requests.some((u) => u.endsWith('mr_nofeature/places.parquet'))).toBe(true)
    expect(requests.some((u) => u.includes('wfs.invalid'))).toBe(false)
  })
})

describe('a reference place across the antimeridian', () => {
  let fiji: Place
  beforeAll(async () => { answer = () => json(FIJI); fiji = await placeGeometry(ref('MRGID:8325')) })

  it('keeps the parts split at +-180 as published: two lobes, each inside [-180, 180], and a bbox that crosses', () => {
    const lobes = placeLobes(fiji)
    expect(lobes).toHaveLength(2)
    expect(lobes[0].bbox).toEqual([-180, -25, -176.3, -10])
    expect(lobes[1].bbox).toEqual([172.8, -25, 180, -10])
    expect(placeBbox(fiji)).toEqual([172.8, -25, -176.3, -10])
    expect(geometryBbox(fiji.geometry)).toEqual([-180, -25, 180, -10])
  })

  it('masks each lobe on its own side of the dateline', () => {
    const lon = (a: number, b: number) => Array.from({ length: Math.round((b - a) / 0.05) + 1 }, (_, i) => +(a + i * 0.05).toFixed(3))
    const lat = lon(-25, -10)
    const [w, e] = placeLobes(fiji)
    const west = gridMask(w.geojson, lon(-179.975, -176), lat), east = gridMask(e.geojson, lon(172.775, 179.975), lat)
    expect(west.cells.length).toBeGreaterThan(1000)
    expect(east.cells.length).toBeGreaterThan(1000)
  })
})

// ---- live: the real Marine Regions WFS and the real manifest ----------------------------------------------------
const online = async () => {
  if (process.env.ERDDAP_OFFLINE) return false
  try { return (await fetch(`${GAZETTEER_FALLBACK}catalog.json`, { signal: AbortSignal.timeout(15_000) })).ok } catch { return false }
}

describe('live: the Albanian EEZ (MRGID:5670) from Marine Regions', () => {
  it('loads the polygon from the publisher and builds a non-empty dhw_5km mask', async () => {
    if (!(await online())) return
    configureGazetteer()
    const refs = await loadReferenceLayers()
    expect(refs.map((l) => l.slug)).toContain('mr_eez')
    const p = await placeGeometry({ collection: 'mr_eez', place_id: 'MRGID:5670', name: 'Albanian Exclusive Economic Zone', authority: 'MRGID' })
    expect(p.sourceUrl).toContain('geo.vliz.be')
    expect(p.geometry.type).toMatch(/Polygon/)
    const lobes = placeLobes(p)
    expect(lobes).toHaveLength(1)
    // dhw_5km's 0.05 degree lattice (cell centres at -179.975 + 0.05 i), cut to the place's box: no ERDDAP request
    const [x0, y0, x1, y1] = lobes[0].bbox
    const axis = (a: number, b: number, o: number) => { const out: number[] = []; for (let v = Math.ceil((a - o) / 0.05) * 0.05 + o - 0.05; v <= b + 0.05; v += 0.05) out.push(+v.toFixed(3)); return out }
    const mask = gridMask(lobes[0].geojson, axis(x0, x1, -179.975), axis(y0, y1, -89.975))
    expect(mask.cells.length).toBeGreaterThan(100)
  }, 60_000)

  it("arrives split at +-180 for Fiji's EEZ (MRGID:8325), so placeLobes() gets one lobe per side", async () => {
    if (!(await online())) return
    configureGazetteer()
    const p = await placeGeometry({ collection: 'mr_eez', place_id: 'MRGID:8325', name: 'Fijian Exclusive Economic Zone', authority: 'MRGID' })
    const lobes = placeLobes(p)
    expect(lobes).toHaveLength(2)
    expect(lobes[0].bbox[0]).toBeGreaterThanOrEqual(-180)
    expect(lobes[0].bbox[2]).toBeLessThan(0)
    expect(lobes[1].bbox[0]).toBeGreaterThan(0)
    expect(lobes[1].bbox[2]).toBeLessThanOrEqual(180)
    expect(placeBbox(p)[0]).toBeGreaterThan(placeBbox(p)[2])     // crosses the antimeridian
  }, 60_000)
})
