import { describe, expect, it } from 'vitest'
import { decodePanes, encodePanes, hashParam, lensHash, lensOf, migrateHash, PANE_DEFAULTS, withExtras } from './view'
import { decodeHash } from './permalink'
import { decodeThenNow } from './thenNow/state'

describe('the lens in the URL', () => {
  it('is statistics by default, Then vs Now for lens=then-now and for the old mode=then-now', () => {
    expect(lensOf('')).toBe('stats')
    expect(lensOf('#place=NMS:FKNMS&dataset=erddap/dhw_5km')).toBe('stats')
    expect(lensOf('#lens=then-now&place=NMS:FKNMS')).toBe('then-now')
    expect(lensOf('#mode=then-now')).toBe('then-now')
    expect(lensOf('#mode=stats')).toBe('stats')
    expect(lensOf('https://oceanmetrics.io/erddap-places/#lens=then-now')).toBe('then-now')
    expect(lensOf('#lens=nonsense')).toBe('stats')
  })
})

describe('the compatibility shim for old links', () => {
  it('rewrites mode=then-now to lens=then-now, in place, keeping every other key', () => {
    const old = '#mode=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=latest&swipe=0.5&anom=1'
    const h = migrateHash(old)
    expect(h).toBe('#lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=latest&swipe=0.5&anom=1')
    // and the lens reads it back to the same view
    expect(decodeThenNow(h)).toEqual(decodeThenNow(old))
  })
  it('drops mode=stats and lens=stats (the default lens) and leaves the run keys alone', () => {
    const old = '#mode=stats&place=NMS:HIHWNMS&dataset=erddap/dhw_5km&variable=CRW_SST&from=2026-05-28&to=2026-06-26'
    const h = migrateHash(old)
    expect(h).toBe('#place=NMS:HIHWNMS&dataset=erddap/dhw_5km&variable=CRW_SST&from=2026-05-28&to=2026-06-26')
    expect(decodeHash(h)).toEqual(decodeHash(old))
    expect(migrateHash('#lens=stats&place=NMS:CINMS')).toBe('#place=NMS:CINMS')
  })
  it('returns a current link unchanged', () => {
    for (const h of ['', '#place=NMS:CINMS', '#lens=then-now&place=NMS:FKNMS', '#place=NMS:CINMS&show=table'])
      expect(migrateHash(h)).toBe(h)
  })
  it('turns a bare #mode=then-now into #lens=then-now', () => {
    expect(migrateHash('#mode=then-now')).toBe('#lens=then-now')
  })
})

describe('which panes are open (show= / hide=)', () => {
  it('defaults to Controls and Time open, the right-edge pane folded', () => {
    expect(decodePanes('', 'stats')).toEqual(PANE_DEFAULTS)
    expect(PANE_DEFAULTS).toEqual({ controls: true, time: true, side: false })
    expect(encodePanes(PANE_DEFAULTS, 'stats')).toEqual({ show: '', hide: '' })
  })
  it('names the right-edge pane after the lens: table for statistics, exceedance for Then vs Now', () => {
    expect(decodePanes('#show=table', 'stats').side).toBe(true)
    expect(decodePanes('#show=exceedance', 'then-now').side).toBe(true)
    expect(decodePanes('#show=exceedance', 'stats').side).toBe(false)
    expect(encodePanes({ controls: true, time: true, side: true }, 'stats')).toEqual({ show: 'table', hide: '' })
    expect(encodePanes({ controls: true, time: true, side: true }, 'then-now')).toEqual({ show: 'exceedance', hide: '' })
  })
  it('round-trips every combination through the hash', () => {
    for (const lens of ['stats', 'then-now'] as const)
      for (let i = 0; i < 8; i++) {
        const p = { controls: !!(i & 1), time: !!(i & 2), side: !!(i & 4) }
        const { show, hide } = encodePanes(p, lens)
        expect(decodePanes(withExtras('#place=NMS:FKNMS', { show, hide }), lens)).toEqual(p)
      }
  })
  it('writes only what differs, as comma lists, and ignores unknown names', () => {
    expect(encodePanes({ controls: false, time: false, side: false }, 'stats')).toEqual({ show: '', hide: 'controls,time' })
    expect(withExtras('#place=NMS:FKNMS', { show: '', hide: 'controls,time' })).toBe('#place=NMS:FKNMS&hide=controls,time')
    expect(decodePanes('#hide=controls,bogus&show=nothing', 'stats')).toEqual({ controls: false, time: true, side: false })
  })
})

describe('extras and switching lens', () => {
  it('sets, replaces and drops extra keys without touching the run keys', () => {
    const h = withExtras('#place=NMS:FKNMS&stat=mean', { stat: 'p90', show: 'table', hide: null })
    expect(h).toBe('#place=NMS:FKNMS&stat=p90&show=table')
    expect(hashParam(h, 'stat')).toBe('p90')
    expect(withExtras(h, { stat: null, show: '' })).toBe('#place=NMS:FKNMS')
  })
  it('keeps a gazetteer id with a space or extra colons, and coll=, through extras, migration and a lens switch', () => {
    const base = '#place=BOEM:OCS-P+0562&coll=boem_wind_leases&dataset=erddap/dhw_5km&variable=CRW_SST'
    const h = withExtras(base, { stat: 'p90', show: 'table', hide: '' })
    expect(h).toBe(`${base}&stat=p90&show=table`)
    expect(hashParam(h, 'place')).toBe('BOEM:OCS-P 0562')
    expect(hashParam(h, 'coll')).toBe('boem_wind_leases')
    expect(decodeHash(h)).toMatchObject({ place: 'BOEM:OCS-P 0562', coll: 'boem_wind_leases' })
    expect(migrateHash('#mode=stats&place=BOEM:OCS-A+0506')).toBe('#place=BOEM:OCS-A+0506')
    expect(hashParam('#place=ONMS:a:b:c&stat=sd', 'place')).toBe('ONMS:a:b:c')
    // Then vs Now has rasters for sanctuaries only: a gazetteer place falls back, and Statistics carries the id whole
    expect(lensHash('then-now', { place: 'BOEM:OCS-A 0506' })).toBe('#lens=then-now')
    expect(lensHash('stats', { place: 'BOEM:OCS-A 0506', variable: 'CRW_SST' }))
      .toBe('#place=BOEM:OCS-A+0506&dataset=erddap/dhw_5km&variable=CRW_SST')
  })
  it('carries a sanctuary into Then vs Now, and anything else falls back to its default place', () => {
    expect(lensHash('then-now', { place: 'NMS:CINMS' })).toBe('#lens=then-now&place=NMS:CINMS')
    expect(lensHash('then-now', { place: 'MRGID:8521' })).toBe('#lens=then-now')
    expect(lensHash('then-now', { place: 'NMS:TBNMS' })).toBe('#lens=then-now')   // no rasters
  })
  it('opens statistics on CRW SST for the place Then vs Now was showing, with the pane layout', () => {
    const h = lensHash('stats', { place: 'NMS:FKNMS', variable: 'CRW_SST', panes: { controls: true, time: false, side: true } })
    expect(h).toBe('#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&show=table&hide=time')
    expect(lensOf(h)).toBe('stats')
    expect(decodeHash(h)).toEqual({ place: 'NMS:FKNMS', dataset: 'erddap/dhw_5km', variable: 'CRW_SST' })
  })
})

describe('fitting a place around the panes', () => {
  it('leaves the Controls width on the left and the strip at the bottom, only when they are open', async () => {
    const { fitPadding } = await import('./view')
    expect(fitPadding(1280, { controls: true, time: true, side: false }, 150)).toEqual({ top: 30, right: 60, left: 420, bottom: 230 })
    expect(fitPadding(1280, { controls: false, time: false, side: true }, 150)).toEqual({ top: 30, right: 60, left: 30, bottom: 60 })
    expect(fitPadding(390, { controls: true, time: true, side: false }, 150)).toEqual({ top: 20, bottom: 140, left: 20, right: 20 })
  })
})

describe('panes on a phone (bottom sheets)', () => {
  it('start folded to bars so the map shows, whatever the link says', async () => {
    const { initialPanes } = await import('./view')
    expect(initialPanes({ controls: true, time: true, side: true }, 390)).toEqual({ controls: false, time: false, side: false })
    expect(initialPanes({ controls: true, time: false, side: true }, 1280)).toEqual({ controls: true, time: false, side: true })
  })
  it('never write the accordion folding into the link', async () => {
    const { paneUrlState } = await import('./view')
    const url = { controls: true, time: true, side: false }
    expect(paneUrlState({ controls: false, time: true, side: false }, url, 390)).toEqual(url)
    expect(paneUrlState({ controls: false, time: true, side: false }, url, 1280)).toEqual({ controls: false, time: true, side: false })
  })
})
