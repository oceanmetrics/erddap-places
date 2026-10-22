// the argument rules of a requested run (--gazetteer), offline: every refusal, the id and slug patterns,
// target selection, and that the daily run's expansion is unchanged.
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PLACE_ID_RE, SLUG_RE, RequestRefusal, checkLayer, collisionOf, daysOf, parseArgs, resolveRequest, selectTargets, validateArgs,
  type Args, type RequestDeps,
} from './request'
import { TARGETS, DAYS, placesFor } from './targets'
import { internalParquet } from './paths'
import { PLACES_COLLECTION_TITLE, buildItem, itemCollections } from './stac'
import type { Place } from '../../app/src/lib/gazetteer'
import type { Provenance } from './stats'

const args = (argv: string[]) => parseArgs(argv, {})
const refusal = (f: () => unknown) => { try { f() } catch (e) { return e instanceof RequestRefusal ? e.message : `not a refusal: ${e}` } return null }
const refusalOf = async (f: () => Promise<unknown>) => { try { await f() } catch (e) { return e instanceof RequestRefusal ? e.message : `not a refusal: ${e}` } return null }

const GOOD = ['--gazetteer', 'noaa_nerrs', '--place', 'NERR:XYZ', '--dataset', 'dhw_5km']

describe('parseArgs', () => {
  it('reads the daily run\'s flags as before and leaves gazetteer unset', () => {
    expect(args(['--dataset', 'dhw_5km', '--place', 'NMS:PMNM', '--place', 'NMS:FKNMS', '--days', '30', '--items-only'])).toEqual({
      datasets: ['dhw_5km'], variables: [], places: ['NMS:PMNM', 'NMS:FKNMS'], gazetteer: undefined, days: 30, itemsOnly: true, resume: false, hours: 21 })
  })
  it('reads a request', () => {
    expect(args([...GOOD, '--variable', 'CRW_SST'])).toMatchObject({ gazetteer: 'noaa_nerrs', places: ['NERR:XYZ'], datasets: ['dhw_5km'], variables: ['CRW_SST'] })
  })
  it('takes PRECOMPUTE_HOURS from the environment', () => {
    expect(parseArgs([], { PRECOMPUTE_HOURS: '3' }).hours).toBe(3)
  })
  it('rejects an unknown argument and a flag without its value', () => {
    expect(() => args(['--gazeteer', 'x'])).toThrow(/unknown argument/)
    expect(() => args(['--gazetteer'])).toThrow(/needs a value/)
    expect(() => args(['--gazetteer', '--place', 'NERR:XYZ'])).toThrow(/needs a value/)
  })
})

describe('slug and place id patterns', () => {
  it('accepts the bucket\'s slugs and gazetteer ids', () => {
    for (const s of ['noaa_nerrs', 'places', 'protectedseas_mpa', 'mr_eez']) expect(SLUG_RE.test(s)).toBe(true)
    for (const id of ['NERR:XYZ', 'NMS:PMNM', 'MRGID:8439', 'PSGID:AIFL11', 'BOEM:OCS-P0562', 'A_b:x.y-z']) expect(PLACE_ID_RE.test(id)).toBe(true)
  })
  it('rejects anything a path, a URL or a shell would read', () => {
    for (const s of ['', 'NOAA', 'a-b', 'a/b', '../places', 'a b', 'a.b', 'a\nb', 'a;rm']) expect(SLUG_RE.test(s), JSON.stringify(s)).toBe(false)
    for (const id of ['', 'NERR', ':XYZ', '1NERR:XYZ', 'NERR:', 'NERR:a b', 'NERR:a/b', 'NERR:../x', 'N/R:x', 'NERR:x;y', 'NERR:x\ny', 'NERR:x?y=1', 'NERR:x$(id)'])
      expect(PLACE_ID_RE.test(id), JSON.stringify(id)).toBe(false)
  })
})

describe('validateArgs: what a request must name', () => {
  it('accepts a complete request', () => {
    expect(refusal(() => validateArgs(args(GOOD)))).toBeNull()
    expect(refusal(() => validateArgs(args([...GOOD, '--variable', 'CRW_BAA'])))).toBeNull()
  })
  it('refuses a bad slug', () => {
    expect(refusal(() => validateArgs(args(['--gazetteer', '../places', '--place', 'NERR:XYZ', '--dataset', 'dhw_5km'])))).toMatch(/not a collection slug/)
    expect(refusal(() => validateArgs(args(['--gazetteer', 'NOAA', '--place', 'NERR:XYZ', '--dataset', 'dhw_5km'])))).toMatch(/not a collection slug/)
  })
  it('refuses a request without --place', () => {
    expect(refusal(() => validateArgs(args(['--gazetteer', 'noaa_nerrs', '--dataset', 'dhw_5km'])))).toMatch(/at least one --place/)
  })
  it('refuses a malformed place id', () => {
    expect(refusal(() => validateArgs(args(['--gazetteer', 'noaa_nerrs', '--place', 'NERR:a b', '--dataset', 'dhw_5km'])))).toMatch(/not a place id/)
    expect(refusal(() => validateArgs(args(['--gazetteer', 'noaa_nerrs', '--place', 'NERR:XYZ', '--place', '../x', '--dataset', 'dhw_5km'])))).toMatch(/not a place id/)
  })
  it('refuses a request without --dataset', () => {
    expect(refusal(() => validateArgs(args(['--gazetteer', 'noaa_nerrs', '--place', 'NERR:XYZ'])))).toMatch(/needs a --dataset/)
  })
  it('refuses a dataset that is not a target', () => {
    expect(refusal(() => validateArgs(args(['--gazetteer', 'noaa_nerrs', '--place', 'NERR:XYZ', '--dataset', 'not_a_dataset'])))).toMatch(/not a catalogued target/)
    // a real ERDDAP collection that is not in TARGETS is refused the same way
    expect(refusal(() => validateArgs(args(['--gazetteer', 'noaa_nerrs', '--place', 'NERR:XYZ', '--dataset', '../erddap/x'])))).toMatch(/not a catalogued target/)
  })
  it('refuses a variable that is not a target of the dataset, or without exactly one dataset', () => {
    expect(refusal(() => validateArgs(args([...GOOD, '--variable', 'chl'])))).toMatch(/not a target of dhw_5km/)
    expect(refusal(() => validateArgs(args([...GOOD, '--dataset', 'noaa_aoml_seascapes_8day', '--variable', 'CRW_SST'])))).toMatch(/exactly one --dataset/)
    expect(refusal(() => validateArgs(args(['--variable', 'CRW_SST'])))).toMatch(/exactly one --dataset/)
  })
  it('does not apply the request rules to the daily run', () => {
    expect(refusal(() => validateArgs(args([])))).toBeNull()
    expect(refusal(() => validateArgs(args(['--dataset', 'dhw_5km', '--place', 'NMS:PMNM'])))).toBeNull()
  })
})

describe('checkLayer: only polygon vector layers, or reference layers held privately, are fetched as geometry', () => {
  const layers = [
    { slug: 'noaa_nerrs', kind: 'vector', geom_type: 'MultiPolygon' },
    { slug: 'mr_eez', kind: 'raster', geom_type: 'MultiPolygon' },
    { slug: 'calcofi_stations', kind: 'vector', geom_type: 'Point' },
    { slug: 'noaa_maritime_limits', kind: 'vector', geom_type: 'MultiLineString' },
    { slug: 'old', geom_type: 'Polygon' },
  ]
  it('accepts a polygon vector layer', () => { expect(checkLayer(layers, 'noaa_nerrs').slug).toBe('noaa_nerrs') })
  it('refuses a reference (raster) collection this machine holds no private copy of', () => {
    expect(refusal(() => checkLayer(layers, 'mr_eez'))).toBe('collection mr_eez is a reference ("raster") layer and this runner holds no private copy of its geometry to mask a grid with')
  })
  // indicators#3 (Albanian EEZ, 2026-10-21) was refused here although the Mac mini holds mr_eez/places.parquet
  it('accepts a reference collection whose private parquet this machine holds', () => {
    expect(checkLayer(layers, 'mr_eez', (s) => s === 'mr_eez').slug).toBe('mr_eez')
  })
  it('a private copy does not make a layer without kind, or a point layer, maskable', () => {
    expect(refusal(() => checkLayer(layers, 'old', () => true))).toMatch(/not a vector layer/)
    expect(refusal(() => checkLayer(layers, 'calcofi_stations', () => true))).toMatch(/only polygon places/)
  })
  it('refuses a layer without kind, a point or line layer, and an unknown slug', () => {
    expect(refusal(() => checkLayer(layers, 'old'))).toMatch(/not a vector layer/)
    expect(refusal(() => checkLayer(layers, 'calcofi_stations'))).toMatch(/only polygon places/)
    expect(refusal(() => checkLayer(layers, 'noaa_maritime_limits'))).toMatch(/only polygon places/)
    expect(refusal(() => checkLayer(layers, 'nope'))).toMatch(/no collection "nope"/)
  })
})

describe('target selection', () => {
  const local = ['NMS:CBNMS', 'NMS:FKNMS', 'NMS:HIHWNMS', 'NMS:NMSAS', 'NMS:PMNM']
  const none = { datasets: [], variables: [], places: [], gazetteer: undefined }
  it('the daily run expands every target by its own places rule, exactly as before', () => {
    const sel = selectTargets(none, local)
    expect(sel.map((s) => s.target)).toEqual(TARGETS)
    expect(sel.map((s) => s.placeIds)).toEqual(TARGETS.map((t) => placesFor(t, local)))
    expect(sel.find((s) => s.target.variable === 'chl')!.placeIds).toEqual(local)
    expect(sel.find((s) => s.target.variable === 'CLASS')!.placeIds).toEqual(['NMS:FKNMS', 'NMS:HIHWNMS', 'NMS:NMSAS', 'NMS:PMNM'])   // REEF_PLACES, a list
  })
  it('the daily run\'s --dataset and --place only filter', () => {
    const sel = selectTargets({ ...none, datasets: ['dhw_5km'], places: ['NMS:PMNM', 'NMS:XXX'] }, local)
    expect(sel.map((s) => s.target.variable)).toEqual(['CRW_SST', 'CRW_BAA'])
    expect(sel.map((s) => s.placeIds)).toEqual([['NMS:PMNM'], ['NMS:PMNM']])
  })
  it('a request names its places and ignores the target\'s places rule', () => {
    // the sanctuaries series is "nms" and the seascapes "reef places": a NERR place is neither, and is still asked for
    for (const dataset of ['cmems_salinity', 'noaa_aoml_seascapes_8day', 'dhw_5km']) {
      const sel = selectTargets({ datasets: [dataset], variables: [], places: ['NERR:XYZ', 'NERR:ABC', 'NERR:XYZ'], gazetteer: 'noaa_nerrs' }, local)
      expect(sel.length).toBeGreaterThan(0)
      for (const s of sel) expect(s.placeIds).toEqual(['NERR:XYZ', 'NERR:ABC'])
    }
  })
  it('a request with --variable selects that one target', () => {
    const sel = selectTargets({ datasets: ['dhw_5km'], variables: ['CRW_BAA'], places: ['NERR:XYZ'], gazetteer: 'noaa_nerrs' }, local)
    expect(sel.map((s) => [s.target.dataset, s.target.variable, s.placeIds])).toEqual([['dhw_5km', 'CRW_BAA', ['NERR:XYZ']]])
  })
  it('the window is --days, else the target\'s, else the default', () => {
    expect(daysOf({ days: 10 }, { days: 'all' })).toBe(10)
    expect(daysOf({ days: undefined }, { days: 'all' })).toBe('all')
    expect(daysOf({ days: undefined }, {})).toBe(DAYS)
  })
})

describe('collisions: stats files are keyed by place id, not by collection', () => {
  it('refuses an id of the local places collection from another collection', () => {
    expect(collisionOf('noaa_nerrs', 'NMS:PMNM', ['NMS:PMNM'], [])).toMatch(/also a place of the places collection/)
  })
  it('refuses an id that already has a file from another collection, but not from the same one', () => {
    expect(collisionOf('noaa_nerrs', 'NERR:XYZ', ['NMS:PMNM'], ['mpa_inventory'])).toMatch(/already has a stats file from the mpa_inventory/)
    expect(collisionOf('noaa_nerrs', 'NERR:XYZ', ['NMS:PMNM'], ['noaa_nerrs'])).toBeNull()
    expect(collisionOf('noaa_nerrs', 'NERR:XYZ', ['NMS:PMNM'], [])).toBeNull()
  })
  it('the local collection may be asked for its own ids', () => {
    expect(collisionOf('places', 'NMS:PMNM', ['NMS:PMNM'], ['places'])).toBeNull()
  })
})

// ── the whole flow, with the network replaced ─────────────────────────────────
const box: Place['geometry'] = { type: 'MultiPolygon', coordinates: [[[[-70, 41], [-69, 41], [-69, 42], [-70, 42], [-70, 41]]]] }
const NERR: Place = { place_id: 'NERR:XYZ', gazetteer: 'NERR', name: 'Test Reserve', area_km2: 10, bbox: [-70, 41, -69, 42], geometry: box, collection: 'noaa_nerrs' }
const layers = [
  { slug: 'noaa_nerrs', kind: 'vector', geom_type: 'MultiPolygon' },
  { slug: 'mr_eez', kind: 'raster', geom_type: 'MultiPolygon' },
]
const deps = (over: Partial<RequestDeps> = {}) => ({
  fetchLayers: vi.fn(async () => layers),
  loadPlace  : vi.fn(async (slug: string, id: string) => {
    if (id !== 'NERR:XYZ') throw new Error(`no place ${id} in the ${slug} collection`)
    return NERR
  }),
  localIds: ['NMS:PMNM'],
  existing: () => [] as string[],
  ...over,
})

describe('resolveRequest', () => {
  it('returns the requested places from the collection', async () => {
    const d = deps()
    expect(await resolveRequest(args(GOOD), d)).toEqual([NERR])
    expect(d.loadPlace).toHaveBeenCalledWith('noaa_nerrs', 'NERR:XYZ')
  })
  it('refuses a bad request before any network work', async () => {
    for (const argv of [['--gazetteer', 'x/y', '--place', 'NERR:XYZ', '--dataset', 'dhw_5km'], ['--gazetteer', 'noaa_nerrs', '--dataset', 'dhw_5km'],
                        ['--gazetteer', 'noaa_nerrs', '--place', 'NERR:XYZ'], ['--gazetteer', 'noaa_nerrs', '--place', 'NERR:XYZ', '--dataset', 'nope']]) {
      const d = deps()
      expect(await refusalOf(() => resolveRequest(args(argv), d)), argv.join(' ')).toMatch(/./)
      expect(d.fetchLayers).not.toHaveBeenCalled()
      expect(d.loadPlace).not.toHaveBeenCalled()
    }
  })
  it('refuses a reference collection without a private copy, without fetching its geometry', async () => {
    const d = deps()
    expect(await refusalOf(() => resolveRequest(args(['--gazetteer', 'mr_eez', '--place', 'MRGID:8403', '--dataset', 'dhw_5km']), d))).toMatch(/no private copy/)
    expect(d.loadPlace).not.toHaveBeenCalled()
  })
  it('loads a place of a reference collection that this machine holds privately', async () => {
    const EEZ = { ...NERR, place_id: 'MRGID:5670', collection: 'mr_eez' }
    const d = deps({ internal: (s) => s === 'mr_eez', loadPlace: vi.fn(async () => EEZ) })
    expect(await resolveRequest(args(['--gazetteer', 'mr_eez', '--place', 'MRGID:5670', '--dataset', 'dhw_5km']), d)).toEqual([EEZ])
    expect(d.loadPlace).toHaveBeenCalledWith('mr_eez', 'MRGID:5670')
  })
  it('refuses a collection that is not in the manifest', async () => {
    const d = deps()
    expect(await refusalOf(() => resolveRequest(args(['--gazetteer', 'nope', '--place', 'NERR:XYZ', '--dataset', 'dhw_5km']), d))).toMatch(/no collection "nope"/)
    expect(d.loadPlace).not.toHaveBeenCalled()
  })
  it('refuses a place that is not in the collection', async () => {
    expect(await refusalOf(() => resolveRequest(args(['--gazetteer', 'noaa_nerrs', '--place', 'NERR:XYZ', '--place', 'NERR:NOPE', '--dataset', 'dhw_5km']), deps())))
      .toBe('NERR:NOPE is not a place of the noaa_nerrs collection')
  })
  it('refuses an id that would overwrite another collection\'s file, before fetching geometry', async () => {
    const d = deps({ localIds: ['NERR:XYZ'] })
    expect(await refusalOf(() => resolveRequest(args(GOOD), d))).toMatch(/also a place of the places collection/)
    expect(d.loadPlace).not.toHaveBeenCalled()
  })
  it('a network failure is not a refusal', async () => {
    const d = deps({ loadPlace: vi.fn(async () => { throw new Error('fetch failed') }) })
    expect(await refusalOf(() => resolveRequest(args(GOOD), d))).toMatch(/^not a refusal: Error: fetch failed/)
  })
})

// ── the Item ──────────────────────────────────────────────────────────────────
const prov = (place: Place): Provenance => ({
  place_id: place.place_id, dataset_id: 'dhw_5km', variable: 'CRW_SST', categorical: false,
  start_date: '2026-09-05', end_date: '2026-09-14', start_datetime: '2026-09-05T12:00:00Z', end_datetime: '2026-09-14T12:00:00Z',
  lobes: 1, mask_cells: 6, griddap_url_templates: ['https://example.org/{t0}'], griddap_chunks: [], griddap_requests: 1,
  rows: 10, bytes: 100, generated: '2026-09-15T00:00:00Z', erddap_base: 'https://example.org/erddap', sql: 'SELECT 1',
})

describe('gazetteer:collection on the Item', () => {
  it('names the collection a requested place came from, and links to it', () => {
    const item = buildItem(prov(NERR), NERR, 'CRW 5km') as any
    expect(item.properties['gazetteer:collection']).toBe('noaa_nerrs')
    expect(item.links.filter((l: any) => l.rel === 'related').map((l: any) => l.href)).toContain('../../noaa_nerrs/collection.json')
    expect(item.links.map((l: any) => l.href)).not.toContain('../../places/collection.json')
  })
  it('is "places" for the local collection (no collection on the place, or the collection named)', () => {
    const local: Place = { ...NERR, place_id: 'NMS:PMNM', collection: undefined }
    for (const p of [local, { ...local, collection: 'places' }]) {
      const item = buildItem(prov(p), p, 'CRW 5km') as any
      expect(item.properties['gazetteer:collection']).toBe('places')
      expect(item.links.find((l: any) => l.rel === 'related' && l.title === PLACES_COLLECTION_TITLE).href).toBe('../../places/collection.json')
    }
  })
  it('keeps every other property of the Item', () => {
    const local: Place = { ...NERR, place_id: 'NMS:PMNM', collection: undefined }
    const { 'gazetteer:collection': _c, ...rest } = (buildItem(prov(local), local, 'CRW 5km') as any).properties
    expect(Object.keys(rest).sort()).toEqual(['created', 'datetime', 'description', 'end_datetime', 'erddap-places:categorical', 'erddap-places:dataset_id',
      'erddap-places:griddap_requests', 'erddap-places:griddap_url_templates', 'erddap-places:lobes', 'erddap-places:mask_cells', 'erddap-places:place_id',
      'erddap-places:variable', 'start_datetime', 'table:row_count', 'title'].concat(rest['erddap-places:status'] ? ['erddap-places:status', 'erddap-places:record_start'] : []).sort())
  })
  it('itemCollections reads it back, and an Item from before the property is "places"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'items-'))
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'a.json'), JSON.stringify({ properties: { 'erddap-places:place_id': 'NERR:XYZ', 'gazetteer:collection': 'noaa_nerrs' } }))
      writeFileSync(join(dir, 'b.json'), JSON.stringify({ properties: { 'erddap-places:place_id': 'NMS:PMNM' } }))
      expect(itemCollections('NERR:XYZ', dir)).toEqual(['noaa_nerrs'])
      expect(itemCollections('NMS:PMNM', dir)).toEqual(['places'])
      expect(itemCollections('NMS:NONE', dir)).toEqual([])
      expect(itemCollections('NMS:PMNM', join(dir, 'missing'))).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('internalParquet: the private copy of a reference collection on this machine', () => {
  it('names <dir>/<slug>/places.parquet when it exists, else undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'internal-'))
    try {
      mkdirSync(join(dir, 'mr_eez'))
      writeFileSync(join(dir, 'mr_eez', 'places.parquet'), '')
      expect(internalParquet('mr_eez', dir)).toBe(join(dir, 'mr_eez', 'places.parquet'))
      expect(internalParquet('mr_goas', dir)).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
