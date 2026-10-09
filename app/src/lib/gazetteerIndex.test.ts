// the whole-gazetteer layer, offline: the manifest (index/layers.json, copied from the bucket), a slice of the
// place index (14 columns, 55 rows) and a two-place geometry Parquet, all served by an in-memory fetch.
// The live counterpart (22 layers, > 14,000 rows) is at the bottom of gazetteer.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileFetch } from './__fixtures__/fileFetch'
import {
  GAZETTEER_FALLBACK, PLACES_COLLECTION, buildIndex, bucketPmtiles, cachedPlace, collForHash, collectionAttribution, collectionParquet,
  configureGazetteer, fmtBytes, isPolygonal, loadIndex, loadLayers, placeGeometry, placeKey, placeLobes, polygonStatus, resolvePlace,
  rewriteLayers, PLACES_ATTRIBUTION, placesAttribution,
} from './gazetteer'
import { indexBounds } from './cells'
import { INDEX_COLUMNS, search, type IndexPlace, type Layer } from './places'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(DIR, '__fixtures__/gazetteer')
const read = (f: string) => fs.readFileSync(path.join(FIX, f))
const HOST = 'https://fixture.invalid/gazetteer/'
const PARQ = (slug: string) => `${HOST}${slug}/places.parquet`
const MANIFEST = JSON.parse(fs.readFileSync(path.join(FIX, 'layers.json'), 'utf8'))

let net: ReturnType<typeof fileFetch>
beforeAll(() => {
  net = fileFetch({
    [`${HOST}layers.json`]: read('layers.json'),
    [`${HOST}index/places_index.parquet`]: read('places_index.parquet'),
    [PARQ('fixture')]: read('places.parquet'),
  })
  configureGazetteer({ base: HOST, fetch: net.fetch, parquetUrl: PARQ })
})
afterAll(() => configureGazetteer())

describe('the layers manifest', () => {
  it('has 22 layers whose pmtiles name the storage host, and loadLayers() rewrites each to the bucket', async () => {
    const raw: Layer[] = MANIFEST.layers
    expect(raw).toHaveLength(22)
    expect(raw.every((l) => l.pmtiles.startsWith('https://storage.oceanmetrics.io/gazetteer/'))).toBe(true)
    const layers = await loadLayers()
    expect(layers).toHaveLength(22)
    for (const l of layers) {
      expect(l.pmtiles).toBe(`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/${l.slug}/places.pmtiles`)
      expect(l.source_layer).toBe(l.slug)                  // slug == collection == PMTiles source-layer
      expect(l.collection).toBe(l.slug)
    }
    expect(layers.map((l) => l.slug)).toEqual(raw.map((l) => l.slug))      // manifest order kept
    expect(layers.find((l) => l.slug === 'boem_wind_leases')!.attribution_html).toContain('<a href=')
  })

  it('rewriteLayers() is pure: it leaves the manifest it was given alone', () => {
    const raw: Layer[] = MANIFEST.layers
    const out = rewriteLayers(raw)
    expect(raw[0].pmtiles).toContain('storage.oceanmetrics.io')
    expect(out[0].pmtiles).toBe(bucketPmtiles(raw[0].slug))
    expect(GAZETTEER_FALLBACK).toBe('https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/')
    expect(collectionParquet('mpa_inventory')).toBe(`${GAZETTEER_FALLBACK}mpa_inventory/places.parquet`)
  })

  it('credits a collection once: nothing for `places`, nothing for a string the places source already carries', () => {
    const wind = (MANIFEST.layers as Layer[]).find((l) => l.slug === 'boem_wind_leases')!
    expect(collectionAttribution(wind)).toBe(wind.attribution_html)
    expect(collectionAttribution({ slug: 'places', attribution_html: 'x' })).toBe('')
    expect(collectionAttribution({ slug: 'other', attribution_html: PLACES_ATTRIBUTION })).toBe('')
    expect(collectionAttribution({ slug: 'other', attribution_html: '  ' })).toBe('')
    expect(collectionAttribution(null)).toBe('')
  })

  // issue #6: the map credited all three gazetteers with only Florida Keys NMS on screen
  it('credits only the gazetteers of the places on screen, in the published order', () => {
    const [nms, mrgid, psgid] = PLACES_ATTRIBUTION.split(' | ')
    expect(nms).toMatch(/NOAA ONMS/)
    expect(mrgid).toMatch(/MarineRegions/)
    expect(psgid).toMatch(/ProtectedSeas/)
    expect(placesAttribution(['NMS:FKNMS', 'NMS:FKNMS'])).toBe(nms)
    expect(placesAttribution(['PSGID:1234', 'NMS:CINMS'])).toBe(`${nms} | ${psgid}`)
    expect(placesAttribution(['MRGID:8456'])).toBe(mrgid)
    expect(placesAttribution(['PSGID:1', 'MRGID:2', 'NMS:3'])).toBe(PLACES_ATTRIBUTION)
    expect(placesAttribution([])).toBe('')
    expect(placesAttribution(['', 'BOEM:OCS-A 0506'])).toBe('')     // not a gazetteer of the places source
  })
})

describe('the place index', () => {
  let rows: IndexPlace[]
  beforeAll(async () => { rows = await loadIndex() })

  it('reads only the columns the app uses and keeps no per-row credit', () => {
    expect(INDEX_COLUMNS).toEqual(['place_id', 'name', 'authority', 'place_type', 'geom_type', 'collection', 'bbox', 'centroid_lon', 'centroid_lat', 'area_km2'])
    for (const dropped of ['attribution', 'license', 'version', 'updated']) expect(INDEX_COLUMNS).not.toContain(dropped)
    expect(rows).toHaveLength(55)
    for (const r of rows) {
      expect(r.attribution).toBeNull()
      expect(r.license).toBeNull()
      expect(r.version).toBeNull()
      expect(r.updated).toBeNull()
      expect(r.bbox).toHaveLength(4)
      expect(typeof r.collection).toBe('string')
    }
    const hi = rows.find((r) => r.place_id === 'NMS:HIHWNMS')!
    expect(hi.collection).toBe(PLACES_COLLECTION)
    expect(hi.centroid![0]).toBeLessThan(-150)                  // centroid_lon / centroid_lat -> [lon, lat]
    expect(hi.area_km2).toBeGreaterThan(1000)
  })

  it('reads the index\'s unwrapped bbox and centroid for a place cut at the antimeridian (PMNM is 177.8..199.0)', () => {
    const pmnm = rows.find((r) => r.place_id === 'NMS:PMNM')!
    expect(pmnm.bbox[0]).toBeCloseTo(177.84, 1)
    expect(pmnm.bbox[2]).toBeGreaterThan(180)
    expect(pmnm.centroid![0]).toBeCloseTo(188.02, 1)
    expect(indexBounds(pmnm.bbox)).toBe(pmnm.bbox)                 // fits as it is: no geometry walk
    // a row that still reads -180..180 waits for its geometry, then fits the true extent
    expect(indexBounds([-180, 19.2, 180, 31.8])).toBeNull()
    const split = { type: 'MultiPolygon', coordinates: [[[[-170, 20], [-165, 20], [-165, 25], [-170, 25], [-170, 20]]], [[[178, 20], [180, 20], [180, 25], [178, 25], [178, 20]]]] }
    expect(indexBounds([-180, 19.2, 180, 31.8], split)).toEqual([178, 20, 195, 25])
  })

  it('keys places by (collection, place_id): three BOEM ids exist in two collections', () => {
    const idx = buildIndex(rows, MANIFEST.layers)
    const dups = [...idx.byId].filter(([, list]) => list.length > 1).map(([id]) => id).sort()
    expect(dups).toEqual(['BOEM:OCS-P 0562', 'BOEM:OCS-P 0563', 'BOEM:OCS-P 0564'])
    // default = the first collection in manifest order (boem_pacific_og_leases sorts before boem_wind_leases)
    const first = resolvePlace(idx.byId, 'BOEM:OCS-P 0562')
    expect(first.row!.collection).toBe('boem_pacific_og_leases')
    expect(first.ambiguous).toBe(true)
    expect(resolvePlace(idx.byId, 'BOEM:OCS-P 0562', 'boem_wind_leases').row!.collection).toBe('boem_wind_leases')
    expect(resolvePlace(idx.byId, 'BOEM:OCS-P 0562', 'no_such_collection').row!.collection).toBe('boem_pacific_og_leases')
    const one = resolvePlace(idx.byId, 'NMS:FKNMS', 'boem_wind_leases')       // a coll that does not hold the id is ignored
    expect(one.row!.collection).toBe(PLACES_COLLECTION)
    expect(one.ambiguous).toBe(false)
    expect(resolvePlace(idx.byId, 'NOPE:1').row).toBeNull()
    // the permalink carries coll= only for those three
    expect(collForHash(idx.byId, resolvePlace(idx.byId, 'BOEM:OCS-P 0563', 'boem_wind_leases').row!)).toBe('boem_wind_leases')
    expect(collForHash(idx.byId, resolvePlace(idx.byId, 'NMS:FKNMS').row!)).toBeUndefined()
    expect(placeKey({ collection: 'a', place_id: 'b' })).not.toBe(placeKey({ collection: 'b', place_id: 'a' }))
  })

  it('selects polygons only: lines and points are not maskable', () => {
    const idx = buildIndex(rows, MANIFEST.layers)
    expect(idx.polygons.length).toBeLessThan(rows.length)
    expect(idx.polygons.every((r) => isPolygonal(r.geom_type))).toBe(true)
    expect(rows.filter((r) => r.collection.startsWith('calcofi'))).toHaveLength(4)
    expect(idx.polygons.some((r) => r.collection.startsWith('calcofi'))).toBe(false)
    expect(isPolygonal('MultiPolygon') && isPolygonal('Polygon')).toBe(true)
    expect(isPolygonal('MultiLineString') || isPolygonal('Point') || isPolygonal('')).toBe(false)
  })

  it('searches ids with a space and extra colons, and the client can restrict to polygons', async () => {
    const hits = await search('OCS-P 0562', { limit: 50 })
    expect(hits.map((h) => h.collection).sort()).toEqual(['boem_pacific_og_leases', 'boem_wind_leases'])
    expect((await search('calcofi', { limit: 50 })).length).toBe(4)
    expect(await search('calcofi', { limit: 50, geomType: ['MultiPolygon', 'Polygon'] })).toHaveLength(0)
    const sanct = await search('flower garden', { limit: 50, geomType: 'MultiPolygon' })
    expect(sanct.length).toBeGreaterThan(0)
    expect(sanct.every((h) => h.geom_type === 'MultiPolygon')).toBe(true)
  })
})

describe('placeGeometry() on a two-place Parquet', () => {
  const ref = (place_id: string, extra: object = {}) => ({ collection: 'fixture', place_id, name: place_id, authority: 'NMS', ...extra })

  it('reads one place, splits PMNM at the antimeridian into two lobes, and caches by (collection, place_id)', async () => {
    const progress: [number, number][] = []
    const before = net.log.length
    const pmnm = await placeGeometry(ref('NMS:PMNM', { area_km2: 1511735.8 }), { onProgress: (b, t) => progress.push([b, t]) })
    expect(pmnm.place_id).toBe('NMS:PMNM')
    expect(pmnm.collection).toBe('fixture')
    expect(pmnm.geometry.type).toBe('MultiPolygon')
    expect(pmnm.bbox[0]).toBe(-180)
    expect(pmnm.bbox[2]).toBe(180)
    expect(pmnm.area_km2).toBeCloseTo(1511735.8, 0)
    // not unwrapped: the parts stay split at +-180, so the two lobes each sit inside [-180, 180]
    const lobes = placeLobes(pmnm)
    expect(lobes).toHaveLength(2)
    expect(lobes[0].bbox[0]).toBeGreaterThanOrEqual(-180)
    expect(lobes[0].bbox[2]).toBeLessThanOrEqual(0)
    expect(lobes[1].bbox[0]).toBeGreaterThanOrEqual(0)
    expect(lobes[1].bbox[2]).toBeLessThanOrEqual(180)
    // the byte count the status line shows: the HEAD gave the file size, the reads add up to part of it
    expect(net.log.slice(before).some((r) => r.method === 'HEAD')).toBe(true)
    expect(progress.length).toBeGreaterThan(0)
    const total = read('places.parquet').byteLength
    expect(progress[progress.length - 1][1]).toBe(total)
    expect(progress[progress.length - 1][0]).toBeGreaterThan(0)
    expect(polygonStatus('Papahānaumokuākea', 'fixture', 12_300_000, 29_800_000)).toBe('loading Papahānaumokuākea polygon from fixture (12.3 MB of 29.8 MB so far)…')
    expect(polygonStatus('x', 'c', 840_000, 0)).toBe('loading x polygon from c (840 kB so far)…')
    expect(fmtBytes(0)).toBe('1 kB')
    // cached: the same (collection, id) makes no request
    const n = net.log.length
    expect(cachedPlace({ collection: 'fixture', place_id: 'NMS:PMNM' })).toBe(pmnm)
    expect(await placeGeometry(ref('NMS:PMNM'))).toBe(pmnm)
    expect(net.log.length).toBe(n)
    expect(cachedPlace({ collection: 'other', place_id: 'NMS:PMNM' })).toBeNull()
  })

  it('keeps a one-sided place in a single lobe', async () => {
    const cb = await placeGeometry(ref('NMS:CBNMS'))
    expect(cb.bbox[2]).toBeLessThan(-123)
    expect(placeLobes(cb)).toHaveLength(1)
  })

  it('refuses a line or point, an unknown id and an unknown collection', async () => {
    await expect(placeGeometry(ref('CALCOFI:line-060.0', { geom_type: 'MultiLineString' }))).rejects.toThrow(/only polygon places can be masked/)
    await expect(placeGeometry(ref('NMS:NOPE'))).rejects.toThrow(/no place NMS:NOPE in the fixture collection/)
    await expect(placeGeometry({ collection: 'missing', place_id: 'NMS:CBNMS' })).rejects.toThrow()
  })

  it('stops reading when its run was superseded', async () => {
    const ac = new AbortController()
    ac.abort()
    // a collection not read yet, so the request is made (and refused) rather than served from the cache
    await expect(placeGeometry({ collection: 'unread', place_id: 'NMS:CBNMS' }, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
