// the STAC Collections -> Dataset mapping, against the repo copies of the published collections.
// the live catalog read is skipped when the gazetteer is unreachable.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCategorical, loadDatasets, statsTemplate, toDataset, toDatasetLon, valueExpr, valueLabel, type CubeVariable } from './catalog'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const collection = (id: string) =>
  JSON.parse(fs.readFileSync(path.resolve(DIR, `../../../catalog/gazetteer/erddap/${id}/collection.json`), 'utf8'))

const online = async () => {
  if (process.env.ERDDAP_OFFLINE) return false
  try { return (await fetch('https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/catalog.json', { signal: AbortSignal.timeout(15_000) })).ok }
  catch { return false }
}

describe('toDataset', () => {
  it('reads the erddap:* fields and cube:variables of dhw_5km', () => {
    const d = toDataset(collection('dhw_5km'))
    expect(d.datasetId).toBe('dhw_5km')
    expect(d.baseUrl).toMatch(/pacioos/)
    expect(d.latDescending).toBe(true)
    expect(d.format).toBe('parquet')          // CORS on, parquet offered
    expect(d.variables.map((v) => v.name)).toContain('CRW_SST')
    expect(d.timeStep).toBe('P1D')
  })

  it('falls back to jsonp when the server has no CORS', () => {
    const c = { ...collection('dhw_5km'), 'erddap:cors': false }
    expect(toDataset(c).format).toBe('jsonp')
  })

  it('reads the re-served MUR collection', () => {
    const d = toDataset(collection('jplMURSST41'))
    expect(d.baseUrl).toBe('https://erddap.oceanmetrics.io/erddap')
    expect(d.latDescending).toBe(false)
    expect(d.variables.map((v) => v.name)).toContain('analysed_sst')
  })
})

describe('erddap-places:categorical -> the categorical path', () => {
  it('flags CRW_BAA in dhw_5km and CLASS in Seascapes, and only those', () => {
    for (const [id, name] of [['dhw_5km', 'CRW_BAA'], ['noaa_aoml_seascapes_8day', 'CLASS']] as const) {
      const vars = toDataset(collection(id)).variables
      expect(vars.find((v) => v.name === name)!.categorical).toBe(true)
      expect(vars.filter((v) => v.categorical).map((v) => v.name)).toEqual([name])
    }
  })
  it('a flagged variable maps to the categorical SQL template, an unflagged one to stats_daily', () => {
    const vars = toDataset(collection('dhw_5km')).variables
    expect(statsTemplate(vars.find((v) => v.name === 'CRW_BAA'))).toBe('stats_categorical')
    expect(statsTemplate(vars.find((v) => v.name === 'CRW_SST'))).toBe('stats_daily')
    expect(statsTemplate(null)).toBe('stats_daily')
  })
  it('reads the flag whether it is published as a boolean or a string', () => {
    expect(isCategorical({ 'erddap-places:categorical': true })).toBe(true)
    expect(isCategorical({ 'erddap-places:categorical': 'true' })).toBe(true)
    expect(isCategorical({ 'erddap-places:categorical': false })).toBe(false)
    expect(isCategorical({})).toBe(false)
  })
})

describe('valueExpr / valueLabel', () => {
  const v = (unit: string | null): CubeVariable => ({ name: 'analysed_sst', unit, description: '', categorical: false })
  it('converts Kelvin to Celsius in SQL and labels the axis', () => {
    expect(valueExpr(v('K'))).toBe('(s."analysed_sst" - 273.15)')
    expect(valueLabel(v('kelvin'))).toBe('°C')
  })
  it('leaves an already-Celsius variable alone', () => {
    expect(valueExpr(v('degree_C'))).toBe('s."analysed_sst"')
    expect(valueLabel(v('Celsius'))).toBe('°C')
  })
  it('falls back to the variable name for unitless variables', () => {
    expect(valueLabel(v('1'))).toBe('analysed_sst')
    expect(valueLabel(v(null))).toBe('analysed_sst')
  })
})

describe('toDatasetLon', () => {
  it('shifts into a 0..360 dataset and back into a -180..180 one', () => {
    expect(toDatasetLon(-160, [0, 360])).toBe(200)
    expect(toDatasetLon(200, [-180, 180])).toBe(-160)
    expect(toDatasetLon(-160, [-180, 180])).toBe(-160)
  })
})

describe('published catalog', () => {
  it('lists the erddap/* collections', async () => {
    if (!(await online())) return
    const ds = await loadDatasets()
    expect(ds.length).toBeGreaterThanOrEqual(2)
    expect(ds.map((d) => d.datasetId)).toContain('dhw_5km')
    for (const d of ds) expect(d.baseUrl).toMatch(/^https:/)
  }, 120_000)
})
