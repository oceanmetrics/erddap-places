import { describe, expect, it } from 'vitest'
import { NOTE_ANOM, NOTE_LATEST, NOTE_NO_PLACE, NOTE_RANGE, NOTE_THEN_NOW, NOTE_WINDOW, OM_ORIGIN, redirectFor, STAT_MAP } from './redirect'
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

describe('redirectFor: Then vs Now -> the Map\'s compare link (build week 2: t, t2, swipe, anom)', () => {
  const M = `${I}#view=map&ind=erddap:dhw_5km:CRW_SST:mean`
  it('Now (a year) and the month of md are t, Then is t2, the swipe is carried; not exact (a month, not a day)', () => {
    expect(redirectFor('#lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=2003-2012&now=2024&swipe=0.35&anom=0')).toEqual({
      url: `${M}&place=NMS:FKNMS&grain=month&layer=grid:dhw_5km:CRW_SST&pal=spectral_r&t=2024-08&t2=2003-2012&swipe=0.35`, exact: false, note: NOTE_THEN_NOW,
    })
    expect(NOTE_THEN_NOW).toBe('Then vs Now opens as the Map\'s compare mode, by month: the day of the year (md) is read as its month')
  })
  it('now=latest leaves t out (the layer\'s latest month), and a Then of more than 12 years says the Map averages 12', () => {
    expect(redirectFor('#lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=latest&swipe=0.5&anom=0')).toEqual({
      url: `${M}&place=NMS:FKNMS&grain=month&layer=grid:dhw_5km:CRW_SST&pal=spectral_r&t2=1985-2005`, exact: false,
      note: [NOTE_THEN_NOW, NOTE_LATEST, NOTE_RANGE].join('; '),
    })
  })
  it('anom=1 (or true) is the Map\'s anom=1, the swipe dropped, and the sign said', () => {
    for (const a of ['1', 'true']) {
      expect(redirectFor(`#lens=then-now&place=NMS:CINMS&md=02-10&then=2003-2012&now=2020&swipe=0.2&anom=${a}`)).toEqual({
        url: `${I}#view=map&ind=erddap:dhw_5km:CRW_SST:mean&place=NMS:CINMS&grain=month&layer=grid:dhw_5km:CRW_SST&pal=spectral_r&t=2020-02&t2=2003-2012&anom=1`,
        exact: false, note: [NOTE_THEN_NOW, NOTE_ANOM].join('; '),
      })
    }
  })
  it('pal=viridis is carried; the default Spectral is the map package\'s spectral_r (red = warm)', () => {
    expect(redirectFor('#lens=then-now&place=NMS:CINMS&then=2003-2012&now=2020&pal=viridis').url).toContain('&pal=viridis&t=2020-08&')
  })
  it('reads the old mode=then-now the same way, with its variable', () => {
    expect(redirectFor('#mode=then-now&place=NMS:CINMS&variable=CRW_BAA&now=2021&then=2003-2012').url)
      .toBe(`${I}#view=map&ind=erddap:dhw_5km:CRW_BAA:mean&place=NMS:CINMS&grain=month&layer=grid:dhw_5km:CRW_BAA&pal=spectral_r&t=2021-08&t2=2003-2012`)
  })
  it('takes the lens defaults when the link names none (CRW_SST, 1985-2005, the latest, 08-05); a malformed key too', () => {
    expect(redirectFor('#lens=then-now&place=NMS:CINMS').url).toBe(`${M}&place=NMS:CINMS&grain=month&layer=grid:dhw_5km:CRW_SST&pal=spectral_r&t2=1985-2005`)
    expect(redirectFor('#lens=then-now&place=NMS:CINMS&md=02-30&then=nope&now=2019').url).toContain('&t=2019-08&t2=1985-2005')
  })
  it('opens the Indicators matrix when no place is named, with both notes', () => {
    expect(redirectFor('#lens=then-now&md=08-05')).toEqual({ url: I, exact: false, note: `${NOTE_THEN_NOW}; ${NOTE_NO_PLACE}` })
  })
  it('the redirect stays written, not active: the link is a pure function of the hash', () => {
    const h = '#lens=then-now&place=NMS:FKNMS&now=2024&then=2003-2012'
    expect(redirectFor(h)).toEqual(redirectFor(h))
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
  it('the README\'s Then vs Now offline link (its data root dropped)', () => {
    expect(redirectFor('http://localhost:5179/#lens=then-now&place=NMS:TEST&data=/__then-now-fixture/').url)
      .toBe(`${I}#view=map&ind=erddap:dhw_5km:CRW_SST:mean&place=NMS:TEST&grain=month&layer=grid:dhw_5km:CRW_SST&pal=spectral_r&t2=1985-2005`)
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
