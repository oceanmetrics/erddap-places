// the gazetteer Parquet -> place list -> griddap lobes. runs against the repo copy of
// places.parquet offline; the live fetch (storage host, then the S3 fallback) is skipped when the
// network is unavailable or ERDDAP_OFFLINE=1.
import { describe, expect, it, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GAZETTEER_BASE, GAZETTEER_FALLBACK, PLACES_ATTRIBUTION, gazetteerBase, gazetteerFetch, loadPlaces, placeLobes, placesPmtilesUrl, type Place } from './gazetteer'
import { PMTiles } from 'pmtiles'
import { configureGazetteer, loadIndex, loadLayers, placeGeometry } from './gazetteer'

const DIR   = path.dirname(fileURLToPath(import.meta.url))
const LOCAL = path.resolve(DIR, '../../../catalog/gazetteer/places/places.parquet')

const online = async () => {
  if (process.env.ERDDAP_OFFLINE) return false
  for (const b of [GAZETTEER_BASE, GAZETTEER_FALLBACK]) {
    try { if ((await fetch(b + 'catalog.json', { signal: AbortSignal.timeout(15_000) })).ok) return true } catch { /* next */ }
  }
  return false
}

describe('places.parquet (local copy)', () => {
  let places: Place[]
  beforeAll(async () => { places = await loadPlaces(fs.readFileSync(LOCAL).buffer as ArrayBuffer) })

  it('lists the 20 gazetteer places with decoded geometry', () => {
    expect(places).toHaveLength(20)
    expect(new Set(places.map((p) => p.gazetteer))).toEqual(new Set(['NMS', 'MRGID', 'PSGID']))
    const hi = places.find((p) => p.place_id === 'NMS:HIHWNMS')!
    expect(hi.name).toMatch(/Humpback/)
    expect(hi.geometry.type).toBe('MultiPolygon')
    expect(hi.bbox[0]).toBeCloseTo(-159.5998, 3)
  })

  it('splits PMNM at the antimeridian into two lobes, each inside [-180, 180]', () => {
    const lobes = placeLobes(places.find((p) => p.place_id === 'NMS:PMNM')!)
    expect(lobes).toHaveLength(2)
    expect(lobes[0].bbox[0]).toBeGreaterThanOrEqual(-180)
    expect(lobes[0].bbox[2]).toBeLessThanOrEqual(0)     // western lobe, negative longitudes
    expect(lobes[1].bbox[0]).toBeGreaterThanOrEqual(0)  // eastern lobe, positive longitudes
    expect(lobes[1].bbox[2]).toBeLessThanOrEqual(180)
  })

  it('keeps a place that does not cross the antimeridian in one request', () => {
    const fk = placeLobes(places.find((p) => p.place_id === 'NMS:FKNMS')!)
    expect(fk).toHaveLength(1)
    expect(fk[0].nParts).toBeGreaterThan(0)
    expect(fk[0].bbox[2]).toBeLessThan(-80)
  })
})

describe('published gazetteer', () => {
  it('fetches places.parquet over the network and decodes PMNM into 2 lobes', async () => {
    if (!(await online())) return
    const res    = await gazetteerFetch('places/places.parquet')
    const buf    = await res.arrayBuffer()
    const places = await loadPlaces(buf)
    expect(buf.byteLength).toBeGreaterThan(1e6)
    expect(places.length).toBe(20)
    expect(placeLobes(places.find((p) => p.place_id === 'NMS:PMNM')!)).toHaveLength(2)
    expect([GAZETTEER_BASE, GAZETTEER_FALLBACK]).toContain(gazetteerBase())
  }, 120_000)

  it('credits the places source with the attribution the published PMTiles carry', async () => {
    if (!(await online())) return
    const meta = await new PMTiles(placesPmtilesUrl()).getMetadata() as { attribution?: string }
    expect(meta.attribution).toBe(PLACES_ATTRIBUTION)
  }, 60_000)

  it('reads the live manifest and index: 22 layers on the bucket host, more than 14,000 places', async () => {
    if (!(await online())) return
    configureGazetteer()                                  // the bucket, no fakes (an earlier test may have configured one)
    const layers = await loadLayers()
    expect(layers).toHaveLength(22)
    expect(layers.every((l) => l.pmtiles === `${GAZETTEER_FALLBACK}${l.slug}/places.pmtiles`)).toBe(true)
    const rows = await loadIndex()
    expect(rows.length).toBeGreaterThan(14_000)
    expect(new Set(rows.map((r) => r.collection)).size).toBe(22)
    expect(rows.every((r) => r.attribution === null)).toBe(true)
    expect(rows.filter((r) => r.collection === 'places')).toHaveLength(20)
    // the index unwraps places cut at the antimeridian (xmax may exceed 180); NMS:PMNM is ~177.8..199
    expect(rows.find((r) => r.place_id === 'NMS:PMNM')!.bbox[2]).toBeGreaterThan(180)
    // collections republished with small row groups: one MPA of the 69 MB mpa_inventory is a few MB at most, not 30
    const mpa = rows.find((r) => r.place_id === 'MPAINV:CA136')!
    let bytes = 0
    const p = await placeGeometry(mpa, { onProgress: (b) => { bytes = b } })
    expect(p.geometry.type).toMatch(/Polygon/)
    expect(bytes).toBeGreaterThan(0)
    expect(bytes).toBeLessThan(3_000_000)
  }, 120_000)
})
