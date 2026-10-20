// what the Place tab lists, as plain data: the curated order, the per-group cap, the noisy collections
// behind "show more", and the ranked-search grouping.
import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileFetch } from './__fixtures__/fileFetch'
import { buildIndex, configureGazetteer, loadIndex, type GazIndex } from './gazetteer'
import { CURATED, GROUP_CAP, NOISY, PLACES_TITLE, SEARCH_LIMIT, alsoIn, azRows, defaultView, groupOrder, searchView } from './placePicker'
import { groupHits, search, type IndexPlace, type Layer } from './places'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/gazetteer')
const LAYERS: Layer[] = JSON.parse(fs.readFileSync(path.join(FIX, 'layers.json'), 'utf8')).layers
const row = (collection: string, i: number, over: Partial<IndexPlace> = {}): IndexPlace => ({
  place_id: `${collection}:${i}`, name: `${collection} ${String(i).padStart(4, '0')}`, authority: 'X', place_type: '', geom_type: 'MultiPolygon',
  collection, bbox: [0, 0, 1, 1], centroid: [0.5, 0.5], area_km2: null, license: null, attribution: null, version: null, updated: null, group_id: null, ...over,
})
const many = (collection: string, n: number) => Array.from({ length: n }, (_, i) => row(collection, i))

describe('group order', () => {
  it('lists `places` first, then the curated collections, then the rest in manifest order', () => {
    const order = groupOrder(LAYERS.map((l) => l.slug))
    expect(order.slice(0, CURATED.length)).toEqual([...CURATED])
    expect(order[0]).toBe('places')
    const rest = order.slice(CURATED.length)
    expect(rest).toEqual(LAYERS.map((l) => l.slug).filter((s) => !(CURATED as readonly string[]).includes(s)))
    expect(rest).toEqual(expect.arrayContaining(['noaa_sanctuaries', 'gebco_undersea', 'calcofi_lines']))
  })
  it('names only collections the manifest has, and the order holds before the manifest has loaded', () => {
    expect(CURATED.every((s) => LAYERS.some((l) => l.slug === s))).toBe(true)
    expect(groupOrder([])[0]).toBe('places')
  })
})

describe('the list with no query', () => {
  const polygons = [
    ...many('boem_wind_planning_rescinded', 70), ...many('noaa_submarine_cables', 60), ...many('mpa_inventory', 120),
    ...many('noaa_nerrs', 30), ...many('gebco_undersea', 90), ...many('noaa_sanctuaries', 5), ...many('places', 18),
    ...many('noaa_marine_monuments', 3),
  ]

  it('shows the curated collections in curated order, `places` first under its own heading', () => {
    const v = defaultView(polygons, LAYERS)
    expect(v.sections.map((s) => s.slug)).toEqual(['places', 'noaa_marine_monuments', 'noaa_nerrs', 'mpa_inventory'])
    expect(v.sections[0].title).toBe(PLACES_TITLE)
    expect(v.sections[2].title).toBe('NOAA National Estuarine Research Reserves')       // the manifest title
    expect(v.sections[0].rows.every((r) => r.precomputed)).toBe(true)
    expect(v.sections[3].rows.every((r) => !r.precomputed)).toBe(true)
  })

  it('caps each group at 50 rows and says how many more there are', () => {
    expect(GROUP_CAP).toBe(50)
    const v = defaultView(polygons, LAYERS)
    const mpa = v.sections.find((s) => s.slug === 'mpa_inventory')!
    expect(mpa.rows).toHaveLength(50)
    expect(mpa.more).toBe(70)
    expect(v.sections.find((s) => s.slug === 'noaa_nerrs')!.more).toBe(0)
    expect(v.sections.find((s) => s.slug === 'places')!.rows).toHaveLength(18)
    expect(v.sections.reduce((n, s) => n + s.rows.length, 0)).toBeLessThanOrEqual(CURATED.length * GROUP_CAP)
    expect(defaultView(polygons, LAYERS, false, 10).sections.find((s) => s.slug === 'mpa_inventory')!.rows).toHaveLength(10)
    // sorted by name inside a group
    const names = mpa.rows.map((r) => r.row.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('folds the two noisiest collections and the uncurated ones behind "show more", and unfolds them on request', () => {
    expect(NOISY).toEqual(['noaa_submarine_cables', 'boem_wind_planning_rescinded'])
    const v = defaultView(polygons, LAYERS)
    expect(v.sections.map((s) => s.slug)).not.toContain('boem_wind_planning_rescinded')
    expect(v.sections.map((s) => s.slug)).not.toContain('noaa_submarine_cables')
    expect(v.sections.map((s) => s.slug)).not.toContain('gebco_undersea')
    expect(v.hiddenGroups).toBe(4)                                      // cables, rescinded, gebco, noaa_sanctuaries
    expect(v.hiddenPlaces).toBe(60 + 70 + 90 + 5)
    const all = defaultView(polygons, LAYERS, true)
    expect(all.hiddenGroups).toBe(0)
    expect(all.sections.map((s) => s.slug)).toEqual([
      'places', 'noaa_marine_monuments', 'noaa_nerrs', 'mpa_inventory', 'noaa_submarine_cables', 'boem_wind_planning_rescinded',
      'gebco_undersea', 'noaa_sanctuaries'])
  })

  it('lists a collection the manifest does not know, last, and works before the manifest has loaded', () => {
    const v = defaultView([...many('places', 2), ...many('brand_new', 1)], [], true)
    expect(v.sections.map((s) => s.slug)).toEqual(['places', 'brand_new'])
    expect(v.sections[1].title).toBe('brand_new')
  })

  it('lists the 18 sanctuaries of `places` A–Z, under their own heading', () => {
    const rows = [row('places', 1, { authority: 'NMS', name: 'Zed Sanctuary' }), row('places', 2, { authority: 'NMS', name: 'Alpha Sanctuary' }),
                  row('places', 3, { authority: 'NMS', name: 'Mid Sanctuary' })]
    const s = defaultView(rows, LAYERS).sections[0]
    expect(s.title).toBe('National Marine Sanctuaries (precomputed)')
    expect(s.rows.map((r) => r.row.name)).toEqual(['Alpha Sanctuary', 'Mid Sanctuary', 'Zed Sanctuary'])
  })

  it('flattens to A–Z by name', () => {
    const v = defaultView([row('noaa_nerrs', 1, { name: 'Zeta' }), row('mpa_inventory', 2, { name: 'Alpha' }), row('places', 3, { name: 'Mid' })], LAYERS)
    expect(azRows(v.sections).map((r) => r.row.name)).toEqual(['Alpha', 'Mid', 'Zeta'])
  })
})

describe('the ranked search over the whole index', () => {
  let idx: GazIndex
  beforeAll(async () => {
    const HOST = 'https://fixture.invalid/gazetteer/'
    configureGazetteer({ base: HOST, fetch: fileFetch({ [`${HOST}index/places_index.parquet`]: fs.readFileSync(path.join(FIX, 'places_index.parquet')) }).fetch })
    idx = buildIndex(await loadIndex(), LAYERS)
  })

  it('groups hits by collection in group order, keeping the rank inside a group, and keeps duplicates apart', async () => {
    const hits = await search('ocs', { geomType: ['MultiPolygon', 'Polygon'], limit: 1e6 })
    const v = searchView(hits, LAYERS)
    expect(v.total).toBe(hits.length)
    expect(v.sections.map((s) => s.slug)).toEqual(['boem_wind_leases', 'boem_pacific_og_leases'])    // curated order, not alphabetical
    const keys = v.sections.flatMap((s) => s.rows.map((r) => r.key))
    expect(new Set(keys).size).toBe(keys.length)
    const dup = v.sections.flatMap((s) => s.rows).filter((r) => r.row.place_id === 'BOEM:OCS-P 0562')
    expect(dup.map((r) => r.row.collection).sort()).toEqual(['boem_pacific_og_leases', 'boem_wind_leases'])
    expect(v.sections.every((s) => s.more === 0)).toBe(true)
  })

  it('cuts a long hit list at the limit, gives every collection a share, and reports the total', () => {
    expect(SEARCH_LIMIT).toBe(200)
    // one collection: capped at its share (50), the rest counted
    const one = searchView(many('mpa_inventory', 500), LAYERS)
    expect(one.shown).toBe(50)
    expect(one.total).toBe(500)
    expect(one.sections[0].more).toBe(450)
    // many matches in two noisy collections must not push the wind leases out of the 200
    const hits = [...many('noaa_submarine_cables', 900), ...many('boem_wind_planning_rescinded', 900), ...many('boem_wind_leases', 12), ...many('mpa_inventory', 40)]
    const v = searchView(hits, LAYERS)
    expect(v.sections.map((s) => s.slug)).toEqual(['mpa_inventory', 'boem_wind_leases', 'noaa_submarine_cables', 'boem_wind_planning_rescinded'])
    expect(v.sections.find((s) => s.slug === 'boem_wind_leases')!.rows).toHaveLength(12)
    expect(v.sections.find((s) => s.slug === 'mpa_inventory')!.rows).toHaveLength(40)
    expect(v.sections.find((s) => s.slug === 'noaa_submarine_cables')!.rows).toHaveLength(50)
    expect(v.sections.find((s) => s.slug === 'noaa_submarine_cables')!.more).toBe(850)
    expect(v.shown).toBeLessThanOrEqual(SEARCH_LIMIT)
    expect(v.total).toBe(hits.length)
    // all 22 collections matching: still about 200 rows (10 each), never 14,000
    const wide = LAYERS.flatMap((l) => many(l.slug, 300))
    expect(searchView(wide, LAYERS).shown).toBeLessThanOrEqual(220)
  })

  it('loads an index from before group_id (the column is absent): every row ungrouped, grouped search unchanged', async () => {
    expect(idx.rows.every((r) => r.group_id === null)).toBe(true)
    const opts = { geomType: ['MultiPolygon', 'Polygon'], limit: 1e6 }
    expect(await search('ocs', { ...opts, group: true, prefer: ['places'] })).toEqual(await search('ocs', opts))
  })

  it('never lists a line or a point (the polygon filter), however well it matches', async () => {
    const hits = await search('calcofi', { geomType: ['MultiPolygon', 'Polygon'], limit: 1e6 })
    expect(hits).toHaveLength(0)
    expect(searchView(hits, LAYERS).sections).toEqual([])
    expect(idx.polygons.some((r) => /calcofi/i.test(r.collection))).toBe(false)
  })
})

describe('one hit per place (grouped search)', () => {
  // Florida Keys NMS as the live index has it (2026-10-16): 5 rows in 4 collections, one group_id
  const g = { group_id: 'grp:fknms', name: 'Florida Keys' }
  const copies = [
    row('noaa_sanctuaries', 1, g), row('mpa_inventory', 2, g), row('places', 3, g), row('noaa_hapc', 4, g), row('noaa_hapc', 5, g),
  ]
  // what the client's search({ group: true, prefer: ['places'] }) ranks by: `prefer` first, then search_rank
  const rank = (p: IndexPlace) => (p.collection === 'places' ? 0 : 100) + (p.collection === 'noaa_sanctuaries' ? 0 : 1)
  const title = (slug: string) => LAYERS.find((l) => l.slug === slug)!.title

  it('lists the precomputed `places` copy once, in its own section, with the others in `also`', () => {
    const hits = groupHits([...copies, row('mpa_inventory', 9)], rank)
    expect(hits).toHaveLength(2)
    expect(hits[0].collection).toBe('places')
    expect(hits[0].also!.map((c) => c.collection)).toEqual(['noaa_sanctuaries', 'mpa_inventory', 'noaa_hapc', 'noaa_hapc'])
    const v = searchView(hits, LAYERS)
    expect(v.sections.map((s) => [s.slug, s.rows.length])).toEqual([['places', 1], ['mpa_inventory', 1]])
    expect(v.sections[0].rows[0].precomputed).toBe(true)
  })

  it('names each other layer once, in preference order, and nothing for a place with no copy', () => {
    const [hit] = groupHits(copies, rank)
    expect(alsoIn(hit, LAYERS)).toEqual([title('noaa_sanctuaries'), title('mpa_inventory'), title('noaa_hapc')])
    expect(alsoIn(row('mpa_inventory', 9), LAYERS)).toEqual([])
    // a second copy in the hit's own collection is not "another layer"
    const [hapc] = groupHits([row('noaa_hapc', 4, g), row('noaa_hapc', 5, g)])
    expect(alsoIn(hapc, LAYERS)).toEqual([])
  })
})
