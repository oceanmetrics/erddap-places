import { describe, expect, it } from 'vitest'
import { decodeHash, encodeHash, permalink, type RunState } from './permalink'
import { csvField, resultFileName, toCsv } from './download'

const RUN: RunState = {
  place: 'NMS:HIHWNMS', dataset: 'erddap/dhw_5km', variable: 'CRW_SST',
  from: '2026-05-28', to: '2026-06-26',
}

describe('permalink', () => {
  it('round-trips a run through the hash', () => {
    expect(decodeHash(encodeHash(RUN))).toEqual(RUN)
  })
  it('leaves the colon in a place id and the slash in a dataset id readable', () => {
    expect(encodeHash(RUN)).toBe(
      '#place=NMS:HIHWNMS&dataset=erddap/dhw_5km&variable=CRW_SST&from=2026-05-28&to=2026-06-26')
  })
  it('round-trips ids that do need escaping', () => {
    const odd: RunState = { ...RUN, place: 'MRGID:8521 & co', variable: 'a=b#c' }
    const h = encodeHash(odd)
    expect(h).not.toContain(' ')
    expect(decodeHash(h)).toEqual(odd)
  })
  it('reads a hash out of a whole URL, and ignores anything else in it', () => {
    expect(decodeHash('https://oceanmetrics.io/erddap-places/#place=NMS:CINMS&zoom=4'))
      .toEqual({ place: 'NMS:CINMS' })
  })
  it('is empty for an empty state, and forgiving of junk', () => {
    expect(encodeHash({})).toBe('')
    expect(decodeHash('')).toEqual({})
    expect(decodeHash('#')).toEqual({})
    expect(decodeHash('no-hash-here')).toEqual({})
    expect(decodeHash('#place=')).toEqual({})
  })
  it('drops the fields that are not set', () => {
    expect(decodeHash(encodeHash({ place: 'NMS:CINMS', variable: 'CRW_SST' })))
      .toEqual({ place: 'NMS:CINMS', variable: 'CRW_SST' })
  })
  it('replaces an existing hash on the page URL', () => {
    expect(permalink({ place: 'NMS:CINMS' }, 'https://x.io/app/#place=NMS:OLD&from=2020-01-01'))
      .toBe('https://x.io/app/#place=NMS:CINMS')
  })
})

describe('export files', () => {
  it('names a file after the place, dataset, variable and window', () => {
    expect(resultFileName(RUN, 'csv'))
      .toBe('erddap-places_NMS-HIHWNMS_erddap-dhw_5km_CRW_SST_2026-05-28_2026-06-26.csv')
    expect(resultFileName(RUN, '.parquet')).toMatch(/\.parquet$/)
  })
  it('quotes CSV fields that need it and renders dates as ISO days', () => {
    expect(csvField('Papahānaumokuākea, NWHI')).toBe('"Papahānaumokuākea, NWHI"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField(new Date('2026-06-26T12:00:00Z'))).toBe('2026-06-26')
    expect(csvField(null)).toBe('')
  })
  it('writes a header row and one row per record', () => {
    const csv = toCsv([{ date: '2026-06-26', n: 12, mean: 26.15 }, { date: '2026-06-27', n: 12, mean: null }])
    expect(csv).toBe('date,n,mean\n2026-06-26,12,26.15\n2026-06-27,12,\n')
  })
})
