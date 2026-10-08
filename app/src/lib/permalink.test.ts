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
  it('round-trips the gazetteer ids: a space, extra colons, punctuation, and coll= only when set', () => {
    const ids = ['BOEM:OCS-A 0506', 'ONMS:florida-keys-national-marine-sanctuary:northern-section', 'MC:cables:1',
                 'USACE:AK:334-1275-a-1', 'GEBCO:1', "WPA:Gray's Reef + co & more #1 100%", 'a/b']
    for (const place of ids) {
      const h = encodeHash({ ...RUN, place })
      expect(h).not.toContain(' ')
      expect(decodeHash(h).place).toBe(place)
      expect(decodeHash(h)).toEqual({ ...RUN, place })
    }
    // the written form: colons stay readable, a space is a plus, nothing else leaks
    expect(encodeHash({ place: 'BOEM:OCS-A 0506' })).toBe('#place=BOEM:OCS-A+0506')
    expect(encodeHash({ place: 'ONMS:a:b' })).toBe('#place=ONMS:a:b')
    // %20, + and a literal space (a hand-typed link) all read as a space
    expect(decodeHash('#place=BOEM:OCS-A%200506').place).toBe('BOEM:OCS-A 0506')
    expect(decodeHash('#place=BOEM:OCS-A+0506').place).toBe('BOEM:OCS-A 0506')
    expect(decodeHash('#place=BOEM%3AOCS-A%200506').place).toBe('BOEM:OCS-A 0506')
    // coll= is written only when given (the app gives it only for an id that exists in two collections)
    expect(encodeHash({ place: 'BOEM:OCS-P 0562' })).toBe('#place=BOEM:OCS-P+0562')
    expect(encodeHash({ place: 'BOEM:OCS-P 0562', coll: 'boem_wind_leases' })).toBe('#place=BOEM:OCS-P+0562&coll=boem_wind_leases')
    expect(decodeHash('#place=BOEM:OCS-P+0562&coll=boem_wind_leases')).toEqual({ place: 'BOEM:OCS-P 0562', coll: 'boem_wind_leases' })
    expect(decodeHash(encodeHash(RUN)).coll).toBeUndefined()
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
  it('puts a suffix before the extension, so the Time strip plot PNG never collides with the map PNG', () => {
    expect(resultFileName(RUN, 'png', 'plot'))
      .toBe('erddap-places_NMS-HIHWNMS_erddap-dhw_5km_CRW_SST_2026-05-28_2026-06-26_plot.png')
    expect(resultFileName(RUN, 'png')).not.toBe(resultFileName(RUN, 'png', 'plot'))
  })
  it('makes the gazetteer ids file-safe: colons and spaces become hyphens, a second collection is named', () => {
    expect(resultFileName({ ...RUN, place: 'BOEM:OCS-A 0506' }, 'csv'))
      .toBe('erddap-places_BOEM-OCS-A-0506_erddap-dhw_5km_CRW_SST_2026-05-28_2026-06-26.csv')
    expect(resultFileName({ ...RUN, place: 'ONMS:florida-keys-national-marine-sanctuary:northern-section' }, 'png'))
      .toBe('erddap-places_ONMS-florida-keys-national-marine-sanctuary-northern-section_erddap-dhw_5km_CRW_SST_2026-05-28_2026-06-26.png')
    expect(resultFileName({ ...RUN, place: 'BOEM:OCS-P 0562', coll: 'boem_wind_leases' }, 'csv'))
      .toBe('erddap-places_BOEM-OCS-P-0562_boem_wind_leases_erddap-dhw_5km_CRW_SST_2026-05-28_2026-06-26.csv')
    expect(resultFileName({ ...RUN, place: 'BOEM:OCS-P 0562', coll: 'boem_pacific_og_leases' }, 'csv'))
      .not.toBe(resultFileName({ ...RUN, place: 'BOEM:OCS-P 0562', coll: 'boem_wind_leases' }, 'csv'))
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
