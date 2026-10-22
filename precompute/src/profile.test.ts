// the `erddap-grid` STAC profile (@oceanmetrics/catalog, an npm devDependency): the collections in the repo and the
// builder's output must pass it. `npm run check:profiles` is the same check from the command line.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { validate } from '@oceanmetrics/catalog/validate'
import { GAZETTEER } from './paths'
import { SPECS, buildCollection } from '../../catalog/build_erddap_collections'

const PROFILE = 'erddap-grid'

const ERDDAP_DIR = join(GAZETTEER, 'erddap')
const collectionFiles = (): string[] =>
  readdirSync(ERDDAP_DIR)
    .map(id => join(ERDDAP_DIR, id, 'collection.json'))
    .filter(existsSync)
    .sort()

// a synthetic ERDDAP info response, already parsed the way build_erddap_collections.ts info() does (no network)
const axis = (name: string, n: number, spacing: number | null, range: [number, number], first = NaN, units = '') =>
  ({ name, n, spacing, range, first, longName: name, units })
const INFO_2D = {
  rows: [] as string[][],
  axes: [
    axis('time', 12, 30, [1704067200, 1730419200]),
    axis('latitude', 1800, 0.1, [-89.95, 89.95]),
    axis('longitude', 3600, 0.1, [-179.95, 179.95]),
  ],
  vars: [{ name: 'precipitation', dims: ['time', 'latitude', 'longitude'], units: 'mm/month', longName: 'Monthly precipitation' }],
}
const INFO_DEPTH = {
  rows: [] as string[][],
  axes: [
    axis('time', 12, 30, [1704067200, 1730419200]),
    axis('depth', 50, null, [0.494, 5727.9], 0.494, 'm'),
    axis('latitude', 2041, -0.0833, [90, -80]),     // descending, as cmems_salinity is
    axis('longitude', 4320, 0.0833, [-180, 179.92]),
  ],
  vars: [{ name: 'so', dims: ['time', 'depth', 'latitude', 'longitude'], units: '1e-3', longName: 'Salinity' }],
}
const spec = (id: string) => SPECS.find(s => s.id === id)!

describe('erddap-grid profile', () => {
  const check = (doc: unknown) => validate(PROFILE, doc)

  it('every catalog/gazetteer/erddap/*/collection.json passes', () => {
    const files = collectionFiles()
    expect(files.length).toBeGreaterThan(0)
    const failed = files.flatMap(f => {
      const { ok, errors } = check(JSON.parse(readFileSync(f, 'utf8')))
      return ok ? [] : [`${f}\n  ${errors.join('\n  ')}`]
    })
    expect(failed, `collections failing ${PROFILE}:\n${failed.join('\n')}`).toEqual([])
  })

  it('the builder output passes (a flat grid, no depth axis)', () => {
    const c = buildCollection(spec('IMERG_monthly_global_precip'), INFO_2D, 'https://erddap.oceanmetrics.io/erddap')
    const { ok, errors } = check(c)
    expect(errors).toEqual([])
    expect(ok).toBe(true)
  })

  it('the builder output passes (descending latitude and a depth axis)', () => {
    const c = buildCollection(spec('cmems_salinity'), INFO_DEPTH, 'https://erddap.oceanmetrics.io/erddap')
    expect(c['erddap:lat_descending']).toBe(true)
    expect(c['erddap-places:depth']).toBe(0.494)
    const { ok, errors } = check(c)
    expect(errors).toEqual([])
    expect(ok).toBe(true)
  })

  it('the builder output for a pending spec passes (erddap-places:status "pending")', () => {
    const c = buildCollection(spec('jplMURSST41mday'), INFO_2D, 'https://erddap.marine.usf.edu/erddap')
    expect(c['erddap-places:status']).toBe('pending')
    expect(check(c).errors).toEqual([])
  })

  it('seeded fault: an erddap:lon_range of one element fails, naming the field', () => {
    const f = collectionFiles()[0]
    const c = JSON.parse(readFileSync(f, 'utf8'))
    expect(check(c).ok).toBe(true)
    c['erddap:lon_range'] = [c['erddap:lon_range'][0]]
    const { ok, errors } = check(c)
    expect(ok).toBe(false)
    expect(errors.join('\n')).toContain('erddap:lon_range')
  })
})
