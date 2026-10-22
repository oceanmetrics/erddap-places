import { describe, expect, it } from 'vitest'
import { NOTE_NO_PLACE, NOTE_THEN_NOW, NOTE_WINDOW, OM_ORIGIN, redirectFor, STAT_MAP } from './redirect'
import { decodeHash, encodeHash } from './permalink'
import { lensHash } from './view'

const I = 'https://oceanmetrics.io/indicators/'

describe('redirectFor: Statistics -> the Indicators Place view', () => {
  it('maps place, dataset and variable to view=place&place=&ind=erddap:<dataset>:<variable>:<stat>', () => {
    expect(redirectFor('#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST')).toEqual({
      url: `${I}#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:mean`, exact: true,
    })
  })
  it('strips the erddap/ prefix from the dataset and accepts one without it', () => {
    expect(redirectFor('#place=NMS:CINMS&dataset=erddap/cmems_altimetry&variable=tob').url)
      .toBe(`${I}#view=place&place=NMS:CINMS&ind=erddap:cmems_altimetry:tob:mean`)
    expect(redirectFor('#place=NMS:CINMS&dataset=cmems_altimetry&variable=tob').url)
      .toBe(`${I}#view=place&place=NMS:CINMS&ind=erddap:cmems_altimetry:tob:mean`)
  })
  it('carries coll when it is given, between place and ind', () => {
    expect(redirectFor('#place=MRGID:8439&coll=mr_eez&dataset=erddap/dhw_5km&variable=CRW_SST')).toEqual({
      url: `${I}#view=place&place=MRGID:8439&coll=mr_eez&ind=erddap:dhw_5km:CRW_SST:mean`, exact: true,
    })
  })
  it('maps mean_wt and an absent stat to mean, and mean to mean_unw', () => {
    const h = '#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST'
    expect(redirectFor(h + '&stat=mean_wt').url.endsWith(':CRW_SST:mean')).toBe(true)
    expect(redirectFor(h).url.endsWith(':CRW_SST:mean')).toBe(true)
    expect(redirectFor(h + '&stat=mean').url.endsWith(':CRW_SST:mean_unw')).toBe(true)
  })
  it('leaves min, max, p10, p90 and sd unchanged', () => {
    for (const s of ['min', 'max', 'p10', 'p90', 'sd'])
      expect(redirectFor(`#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&stat=${s}`)).toEqual({
        url: `${I}#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:${s}`, exact: true,
      })
    expect(Object.keys(STAT_MAP).sort()).toEqual(['max', 'mean', 'mean_wt', 'min', 'p10', 'p90', 'sd'])
  })
  it('drops from and to and says the window is not carried (exact: false)', () => {
    expect(redirectFor('#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&from=2026-05-28&to=2026-06-26')).toEqual({
      url: `${I}#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:mean`,
      exact: false, note: 'the window is not carried; the Place view shows the full record',
    })
    expect(NOTE_WINDOW).toBe('the window is not carried; the Place view shows the full record')
    expect(redirectFor('#place=NMS:FKNMS&from=2026-05-28').exact).toBe(false)
  })
  it('falls back to the area-weighted mean for an unknown statistic, and says so', () => {
    const r = redirectFor('#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&stat=median')
    expect(r.url).toBe(`${I}#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:mean`)
    expect(r.exact).toBe(false)
    expect(r.note).toContain('"median"')
  })
  it('uses the app\'s opening dataset and variable (dhw_5km, CRW_SST) when the link names none', () => {
    expect(redirectFor('#place=NMS:CINMS')).toEqual({
      url: `${I}#view=place&place=NMS:CINMS&ind=erddap:dhw_5km:CRW_SST:mean`, exact: true,
    })
  })
  it('drops the pane keys (show, hide) without a note', () => {
    expect(redirectFor('#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&show=table&hide=controls,time')).toEqual({
      url: `${I}#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:mean`, exact: true,
    })
  })
  it('keeps a colon and writes a space or slash in a place id percent-encoded', () => {
    expect(redirectFor('#place=BOEM:OCS-P%200561&dataset=erddap/dhw_5km&variable=CRW_SST').url)
      .toBe(`${I}#view=place&place=BOEM:OCS-P%200561&ind=erddap:dhw_5km:CRW_SST:mean`)
  })
})

describe('redirectFor: Then vs Now -> the Place view of dhw_5km, not exact until build week 2', () => {
  const note = 'the slice arrives in build week 2 (2026-11-06 to 11-12)'
  it('maps place and variable, with dataset dhw_5km and the mean', () => {
    expect(redirectFor('#lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=latest&swipe=0.5&anom=0')).toEqual({
      url: `${I}#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:mean`, exact: false, note,
    })
    expect(NOTE_THEN_NOW).toBe(note)
  })
  it('reads the old mode=then-now the same way', () => {
    expect(redirectFor('#mode=then-now&place=NMS:CINMS&variable=CRW_BAA')).toEqual({
      url: `${I}#view=place&place=NMS:CINMS&ind=erddap:dhw_5km:CRW_BAA:mean`, exact: false, note,
    })
  })
  it('takes CRW_SST when the link names no variable (the lens default)', () => {
    expect(redirectFor('#lens=then-now&place=NMS:CINMS').url).toBe(`${I}#view=place&place=NMS:CINMS&ind=erddap:dhw_5km:CRW_SST:mean`)
  })
  it('opens the Indicators matrix when no place is named, with both notes', () => {
    expect(redirectFor('#lens=then-now&md=08-05')).toEqual({ url: I, exact: false, note: `${note}; ${NOTE_NO_PLACE}` })
  })
})

describe('redirectFor: no place, origin, odd input', () => {
  it('Statistics without a place -> the Indicators matrix', () => {
    expect(redirectFor('#dataset=erddap/dhw_5km&variable=CRW_SST')).toEqual({ url: I, exact: false, note: NOTE_NO_PLACE })
  })
  it('an empty, missing or hash-less input is the matrix and never throws', () => {
    for (const h of ['', '#', 'nonsense', '#%%%', undefined as unknown as string])
      expect(redirectFor(h).url).toBe(I)
  })
  it('honours another origin (a preview), with or without a trailing slash', () => {
    expect(redirectFor('#place=NMS:FKNMS', 'http://localhost:5181').url)
      .toBe('http://localhost:5181/indicators/#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:mean')
    expect(redirectFor('', 'https://example.org/').url).toBe('https://example.org/indicators/')
    expect(OM_ORIGIN).toBe('https://oceanmetrics.io')
  })
  it('reads a whole URL as well as a hash', () => {
    expect(redirectFor('https://oceanmetrics.io/erddap-places/#place=NMS:CINMS&dataset=erddap/dhw_5km&variable=CRW_SST').url)
      .toBe(`${I}#view=place&place=NMS:CINMS&ind=erddap:dhw_5km:CRW_SST:mean`)
  })
})

describe('redirectFor: the examples of the app README and the permalinks the app writes', () => {
  it('the README\'s Then vs Now offline link', () => {
    expect(redirectFor('http://localhost:5179/#lens=then-now&place=NMS:TEST&data=/__then-now-fixture/').url)
      .toBe(`${I}#view=place&place=NMS:TEST&ind=erddap:dhw_5km:CRW_SST:mean`)
  })
  it('the permalink of a run (encodeHash) round-trips to its Place view', () => {
    const h = encodeHash({ place: 'NMS:HIHWNMS', dataset: 'erddap/dhw_5km', variable: 'CRW_SST', from: '2026-05-28', to: '2026-06-26' })
    expect(decodeHash(h).place).toBe('NMS:HIHWNMS')
    expect(redirectFor(h)).toEqual({
      url: `${I}#view=place&place=NMS:HIHWNMS&ind=erddap:dhw_5km:CRW_SST:mean`, exact: false, note: NOTE_WINDOW,
    })
  })
  it('the hash a lens switch writes (lensHash) redirects for both lenses', () => {
    expect(redirectFor(lensHash('stats', { place: 'NMS:CINMS', variable: 'CRW_SST' })).url)
      .toBe(`${I}#view=place&place=NMS:CINMS&ind=erddap:dhw_5km:CRW_SST:mean`)
    expect(redirectFor(lensHash('then-now', { place: 'NMS:CINMS' })).exact).toBe(false)
  })
})
