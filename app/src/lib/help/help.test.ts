// help, the tour and feedback: the rules behind the welcome card, the tour, the shortcuts, the
// feedback issue and "Cite this data", each on a small fixture with the exact expected output.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cardPosition, TABS, tourKey, tourStep, TOUR_STOPS } from './tour'
import { OWNS_ARROWS, shortcutFor, SHORTCUTS } from './keys'
import { doors, onLoad, pageBase, parseHelpQuery, QUESTIONS, recentMd, withoutHelpQuery } from './start'
import { appCitation, citeText, gazetteerCitation } from './cite'
import { datasetSources, fixedSources } from './sources'
import { issueTitle, issueUrl, ISSUE_BASE, MAX_ISSUE_URL_LENGTH, reportBody, type FeedbackReport } from '../feedback/issue'
import { arrowHead, insetFractions, rectBox, toImage } from '../feedback/annotate'
import { decodeHash } from '../permalink'
import { lensOf, decodePanes } from '../view'
import { decodeThenNow } from '../thenNow/state'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('the tour', () => {
  it('visits the page in pipeline order', () => {
    expect(TOUR_STOPS.map((s) => s.id)).toEqual(['sentence', 'place', 'data', 'method', 'legend', 'time', 'table', 'share', 'help'])
    expect(TOUR_STOPS.filter((s) => s.tab).map((s) => s.tab)).toEqual(['place', 'data', 'method', 'share'])
    expect(TOUR_STOPS.find((s) => s.id === 'time')?.time).toBe(true)
    // the Time strip stop shows the plot, the next one the Table tab (and unfolds the strip, where the tab is)
    expect(TOUR_STOPS.find((s) => s.id === 'time')?.timeTab).toBe('plot')
    expect(TOUR_STOPS.find((s) => s.id === 'table')).toMatchObject({ time: true, timeTab: 'table' })
    expect(TOUR_STOPS.find((s) => s.id === 'table')?.target[0]).toContain('tab-table')
    expect(TOUR_STOPS.find((s) => s.id === 'method')?.text).toMatch(/Then vs Now/)
  })
  it('keeps every stop to one or two plain sentences', () => {
    for (const s of TOUR_STOPS) {
      expect(s.text.split(/(?<=[.!?])\s+/).filter(Boolean).length, s.id).toBeLessThanOrEqual(3)
      expect(s.target.length, s.id).toBeGreaterThan(0)
    }
  })
  it('maps keys to moves and moves to stops (Next on the last is Done)', () => {
    expect(['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp', 'Home', 'End', 'Escape', 'a'].map(tourKey))
      .toEqual(['next', 'next', 'back', 'back', 'first', 'last', 'close', null])
    const n = TOUR_STOPS.length
    expect(tourStep(0, 'next')).toBe(1)
    expect(tourStep(n - 1, 'next')).toBe(-1)
    expect(tourStep(0, 'back')).toBe(0)
    expect(tourStep(4, 'first')).toBe(0)
    expect(tourStep(0, 'last')).toBe(n - 1)
    expect(tourStep(3, 'close')).toBe(-1)
    expect(tourStep(3, null)).toBe(3)
    expect(tourStep(0, 'next', 0)).toBe(-1)
  })
  it('puts the card below, else above, else beside, inside the window', () => {
    const win = { width: 1000, height: 800 }, card = { width: 300, height: 150 }
    expect(cardPosition({ left: 100, top: 100, width: 50, height: 20 }, card, win)).toEqual({ left: 100, top: 132 })
    expect(cardPosition({ left: 900, top: 700, width: 50, height: 20 }, card, win)).toEqual({ left: 692, top: 538 })
    expect(cardPosition({ left: 0, top: 0, width: 200, height: 800 }, card, win)).toEqual({ left: 212, top: 8 })
  })
})

describe('?tour= and ?modal=', () => {
  it('parses the switches', () => {
    expect(parseHelpQuery('')).toEqual({ tour: null, modal: null })
    expect(parseHelpQuery('?tour=off')).toEqual({ tour: 'off', modal: null })
    expect(parseHelpQuery('?tour=ON')).toEqual({ tour: 'on', modal: null })
    expect(parseHelpQuery('?tour=1&modal=sources')).toEqual({ tour: 'on', modal: 'sources' })
    expect(parseHelpQuery('?modal=nope')).toEqual({ tour: null, modal: null })
  })
  it('decides what opens on load', () => {
    expect(onLoad({ tour: null, modal: null }, false)).toEqual({ welcome: true, tour: false, modal: null })
    expect(onLoad({ tour: null, modal: null }, true)).toEqual({ welcome: false, tour: false, modal: null })
    expect(onLoad({ tour: 'off', modal: null }, false)).toEqual({ welcome: false, tour: false, modal: null })
    expect(onLoad({ tour: 'off', modal: 'about' }, false)).toEqual({ welcome: false, tour: false, modal: 'about' })
    expect(onLoad({ tour: 'on', modal: null }, true)).toEqual({ welcome: false, tour: true, modal: null })
    expect(onLoad({ tour: null, modal: 'sources' }, false)).toEqual({ welcome: false, tour: false, modal: 'sources' })
  })
  it('drops the switches from a page URL and keeps the rest', () => {
    expect(withoutHelpQuery('?tour=off&modal=keys')).toBe('')
    expect(withoutHelpQuery('?theme=dark&tour=on')).toBe('?theme=dark')
    // a view link (Copy link, the citation, the feedback report) never carries them
    expect(pageBase({ origin: 'https://oceanmetrics.io', pathname: '/erddap-places/', search: '?tour=off&modal=sources' })).toBe('https://oceanmetrics.io/erddap-places/')
  })
})

describe('the welcome card', () => {
  it('opens FKNMS × CRW SST statistics and the Then vs Now lens', () => {
    const [a, b] = doors(new Date('2026-10-08T12:00:00Z'))
    expect(a.label).toBe('Sea surface temperature in a sanctuary this month')
    expect(lensOf(a.hash)).toBe('stats')
    expect(decodeHash(a.hash)).toEqual({ place: 'NMS:FKNMS', dataset: 'erddap/dhw_5km', variable: 'CRW_SST' })
    expect(b.label).toBe('Then vs Now: this day against the 1985–2005 climatology')
    expect(lensOf(b.hash)).toBe('then-now')
    expect(decodeThenNow(b.hash)).toMatchObject({ place: 'NMS:FKNMS', variable: 'CRW_SST', md: '10-01', then: '1985-2005', now: 'latest' })
  })
  it('takes "this day" a week back, across a year end', () => {
    expect(recentMd(new Date('2026-10-08T12:00:00Z'))).toBe('10-01')
    expect(recentMd(new Date('2027-01-03T12:00:00Z'))).toBe('12-27')
  })
  it('asks three worked questions: seascape classes, a CMEMS monthly record, the anomaly', () => {
    expect(QUESTIONS).toHaveLength(3)
    expect(decodeHash(QUESTIONS[0].hash)).toEqual({ place: 'NMS:MBNMS', dataset: 'erddap/noaa_aoml_seascapes_8day', variable: 'CLASS' })
    expect(decodeHash(QUESTIONS[1].hash)).toEqual({ place: 'NMS:CINMS', dataset: 'erddap/cmems_biogeochem_phyto', variable: 'chl', from: '2021-10-16', to: '2025-02-15' })
    expect(lensOf(QUESTIONS[2].hash)).toBe('then-now')
    expect(decodeThenNow(QUESTIONS[2].hash)).toMatchObject({ place: 'NMS:FKNMS', md: '08-05', then: '1985-2005', now: 2023, anom: true })
    expect(decodePanes(QUESTIONS[2].hash, 'then-now').side).toBe(true)
  })
})

describe('shortcuts', () => {
  const k = (key: string, more: object = {}) => ({ key, targetTag: 'BODY', ...more })
  it('maps ? t 1–4 l and Esc', () => {
    expect(shortcutFor(k('?'))).toEqual({ kind: 'tour' })
    expect(shortcutFor(k('t'))).toEqual({ kind: 'theme' })
    expect(shortcutFor(k('L'))).toEqual({ kind: 'lens' })
    expect(['1', '2', '3', '4'].map((n) => shortcutFor(k(n)))).toEqual(TABS.map((tab) => ({ kind: 'tab', tab })))
    expect(shortcutFor(k('5'))).toBeNull()
    expect(shortcutFor(k('Escape'), { busy: true })).toEqual({ kind: 'escape' })
  })
  it('steps the day with ← → in Then vs Now only, and not where the arrows belong to a control', () => {
    expect(shortcutFor(k('ArrowRight'), { lens: 'then-now' })).toEqual({ kind: 'day', by: 1 })
    expect(shortcutFor(k('ArrowLeft'), { lens: 'then-now' })).toEqual({ kind: 'day', by: -1 })
    expect(shortcutFor(k('ArrowRight'), { lens: 'stats' })).toBeNull()
    expect(shortcutFor(k('ArrowRight', { targetOwnsArrows: true }), { lens: 'then-now' })).toBeNull()
    expect(OWNS_ARROWS).toContain('[role="tablist"]')
  })
  it('stays out of the way while typing, with a modifier, or while a dialog or the tour is open', () => {
    expect(shortcutFor(k('t', { targetTag: 'INPUT' }))).toBeNull()
    expect(shortcutFor(k('t', { targetTag: 'textarea' }))).toBeNull()
    expect(shortcutFor(k('t', { targetEditable: true }))).toBeNull()
    expect(shortcutFor(k('t', { metaKey: true }))).toBeNull()
    expect(shortcutFor(k('?'), { busy: true })).toBeNull()
  })
  it('lists every shortcut in Help ▾ → Keyboard', () => {
    expect(SHORTCUTS.flatMap((s) => s.keys)).toEqual(['?', 't', '1', '2', '3', '4', 'l', '←', '→', 'Esc'])
  })
})

const REPORT: FeedbackReport = {
  kind: 'feedback', note: 'The mean looks too warm\nfrom 1 Oct on.', lens: 'Statistics',
  url: 'https://oceanmetrics.io/erddap-places/#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&from=2026-09-07&to=2026-10-06',
  appVersion: '0.1.0', release: 'NOAA Coral Reef Watch — Daily Global 5km SST + DHW · ERDDAP 2.29 · data through 6 Oct 2026',
  viewport: '1280×800', theme: 'dark',
  sentence: 'Sea surface temperature (NOAA Coral Reef Watch, 5 km, daily) in Florida Keys NMS, area-weighted mean of 462 cells, 7 Sep – 6 Oct 2026',
}

describe('the feedback issue', () => {
  it('titles it with the first line of the note, else the sentence', () => {
    expect(issueTitle(REPORT)).toBe('Feedback: The mean looks too warm')
    expect(issueTitle({ ...REPORT, note: '' })).toBe(`Feedback: ${REPORT.sentence!.slice(0, 80)}`)
    expect(issueTitle({ ...REPORT, kind: 'product', note: 'A sanctuary report' })).toBe('I built something with this: A sanctuary report')
  })
  it('writes the body: note, paste line, then view, sentence, lens, data, app, viewport, theme', () => {
    expect(reportBody(REPORT)).toBe([
      '**Note**', '', 'The mean looks too warm\nfrom 1 Oct on.', '',
      '_Screenshot: paste it here (it is on your clipboard)._', '', '---',
      `- View: ${REPORT.url}`, `- Showing: ${REPORT.sentence}`, '- Lens: Statistics',
      `- Data: ${REPORT.release}`, '- App: erddap-places v0.1.0', '- Viewport: 1280×800', '- Theme: dark',
    ].join('\n'))
    expect(reportBody({ ...REPORT, note: ' ', release: null })).toContain('_(no note)_')
    expect(reportBody({ ...REPORT, release: '' })).toContain('- Data: not loaded yet')
  })
  it('prefills a new-issue URL with title, body and label', () => {
    const u = new URL(issueUrl(REPORT))
    expect(`${u.origin}${u.pathname}`).toBe(ISSUE_BASE)
    expect(u.searchParams.get('title')).toBe('Feedback: The mean looks too warm')
    expect(u.searchParams.get('body')).toBe(reportBody(REPORT))
    expect(u.searchParams.get('labels')).toBe('feedback')
    expect(new URL(issueUrl({ ...REPORT, kind: 'product' })).searchParams.get('labels')).toBe('product')
  })
  it('cuts a long note, never the details, to stay under the URL limit', () => {
    const long = { ...REPORT, note: 'x'.repeat(20000) }
    const u = issueUrl(long)
    expect(u.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH)
    const body = new URL(u).searchParams.get('body')!
    expect(body).toContain('… (cut: the full note is on the clipboard)')
    expect(body).toContain('- Theme: dark')
  })
  it('never asks for an email address', () => {
    expect(reportBody(REPORT).toLowerCase()).not.toContain('email')
  })
})

describe('the mark-up', () => {
  it('normalises a rectangle and points an arrow head back along the shaft', () => {
    expect(rectBox({ x0: 50, y0: 40, x1: 10, y1: 60 })).toEqual({ x: 10, y: 40, w: 40, h: 20 })
    const [p, q] = arrowHead({ x0: 0, y0: 0, x1: 100, y1: 0 }, 10)
    expect(p[0]).toBeLessThan(100); expect(q[0]).toBeLessThan(100); expect(p[1]).toBeCloseTo(-q[1])
    expect(toImage(150, 120, { left: 100, top: 100, width: 100, height: 50 }, 200, 100)).toEqual({ x: 100, y: 40 })
  })
  it('reads the swipe clip so the right-hand map lands where it is seen', () => {
    expect(insetFractions('none', 800, 600)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
    expect(insetFractions('inset(0px 0px 0px 400px)', 800, 600)).toEqual({ x0: 0.5, y0: 0, x1: 1, y1: 1 })
    expect(insetFractions('inset(0 0 0 100%)', 800, 600).x0).toBe(1)
    expect(insetFractions('inset(10%)', 800, 600)).toEqual({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 })
  })
})

const CRW = {
  title: 'NOAA Coral Reef Watch — Daily Global 5km SST + DHW', baseUrl: 'https://pae-paha.pacioos.hawaii.edu/erddap',
  datasetId: 'dhw_5km', protocol: 'griddap',
  collection: {
    license: 'CC0-1.0',
    providers: [{ name: 'NOAA Coral Reef Watch (CRW)', roles: ['producer', 'licensor'] }, { name: 'PacIOOS (Pacific Islands Ocean Observing System)', roles: ['host'] }],
    links: [{ rel: 'via', href: 'https://pae-paha.pacioos.hawaii.edu/erddap/info/dhw_5km/index.html' }],
  },
}
const CMEMS = {
  title: 'CMEMS Global Biogeochemistry — monthly chlorophyll + phytoplankton', baseUrl: 'https://erddap.oceanmetrics.io/erddap',
  datasetId: 'cmems_biogeochem_phyto', protocol: 'griddap',
  collection: {
    license: 'other',
    providers: [{ name: 'Copernicus Marine Service (CMEMS) / Mercator Ocean International', roles: ['producer', 'licensor'] }, { name: 'Ocean Metrics LLC', roles: ['processor', 'host'] }],
    links: [{ rel: 'about', href: 'https://doi.org/10.48670/moi-00015' }, { rel: 'license', href: 'https://marine.copernicus.eu/user-corner/service-commitments-and-licence' }],
  },
}

describe('Cite this data', () => {
  it('cites each dataset in view once, then the gazetteer, then the app with the view link', () => {
    const t = citeText({ datasets: [CRW, CRW], accessed: '2026-10-08', url: REPORT.url, appVersion: '0.1.0', gazetteerVersion: '1.1.0' })
    expect(t).toBe([
      'NOAA Coral Reef Watch. NOAA Coral Reef Watch — Daily Global 5km SST + DHW (ERDDAP dataset dhw_5km). ' +
        'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.html, accessed 2026-10-08. Licence: CC0-1.0.',
      'Ocean Metrics (2026). Ocean Metrics gazetteer of marine places, places v1.1.0: boundaries from NOAA Office of National ' +
        'Marine Sanctuaries, MarineRegions.org (Flanders Marine Institute) and ProtectedSeas, as GeoParquet and PMTiles with a STAC ' +
        'catalog. Licence: CC-BY-4.0. https://storage.oceanmetrics.io/gazetteer/',
      `Ocean Metrics for MBON (2026). erddap-places v0.1.0: place statistics from ERDDAP, computed in the browser. ` +
        `https://github.com/oceanmetrics/erddap-places. View: ${REPORT.url}`,
    ].join('\n\n'))
  })
  it('carries the DOI and the producer licence page when the collection has them', () => {
    const t = citeText({ datasets: [CMEMS], accessed: '2026-10-08', url: '', appVersion: '0.1.0' })
    expect(t).toContain("Licence: the producer's terms (https://marine.copernicus.eu/user-corner/service-commitments-and-licence). https://doi.org/10.48670/moi-00015")
    expect(t).toContain('View: https://oceanmetrics.io/erddap-places/')
  })
  it('puts a non-ERDDAP citation (Then vs Now) before the places', () => {
    const t = citeText({ datasets: [], extra: ['CoralTemp rasters.'], accessed: '2026-10-08', url: 'u', appVersion: '0.1.0' })
    expect(t.split('\n\n')).toEqual(['CoralTemp rasters.', gazetteerCitation('2026'), appCitation('2026', '0.1.0', 'u')])
  })
})

describe('Data sources and attribution', () => {
  it('gives each ERDDAP dataset its provider, licence, DOI and server', () => {
    const [crw, cm] = datasetSources([CRW, { ...CMEMS, status: 'pending' }], '2026-10-08')
    expect(crw).toMatchObject({ name: CRW.title, provider: 'NOAA Coral Reef Watch', licence: 'CC0-1.0',
      server: 'pae-paha.pacioos.hawaii.edu (PacIOOS (Pacific Islands Ocean Observing System))',
      href: 'https://pae-paha.pacioos.hawaii.edu/erddap/info/dhw_5km/index.html' })
    expect(crw.doi).toBeUndefined()
    expect(cm).toMatchObject({ provider: 'Copernicus Marine Service', doi: '10.48670/moi-00015', server: 'erddap.oceanmetrics.io (Ocean Metrics LLC)' })
    expect(cm.role).toContain('(listed, not served yet)')
  })
  it('names the places, the basemap and the software', () => {
    const names = fixedSources('2026').map((s) => s.name)
    expect(names).toEqual(['Ocean Metrics gazetteer', 'NOAA ONMS sanctuary boundaries', 'MarineRegions.org', 'ProtectedSeas', 'Then vs Now rasters', 'Basemaps', 'Software'])
    const sw = fixedSources('2026').find((s) => s.name === 'Software')!.role
    for (const w of ['DuckDB-WASM', 'MapLibre', 'geotiff']) expect(sw).toContain(w)
  })
})
describe('html-to-image stays lazy', () => {
  it('is imported only by capture.ts, and that only through import()', () => {
    const shell = readFileSync(path.join(SRC, 'Shell.svelte'), 'utf8')
    const statics = [shell, readFileSync(path.join(SRC, 'App.svelte'), 'utf8'), readFileSync(path.join(SRC, 'main.ts'), 'utf8')]
    for (const s of statics) {
      expect(s).not.toMatch(/from ['"]html-to-image['"]/)
      expect(s).not.toMatch(/^\s*import [^(]*['"][^'"]*feedback\/(capture|FeedbackDialog)/m)
    }
    expect(shell).toMatch(/import\(['"]\.\/lib\/feedback\/capture['"]\)/)
    expect(shell).toMatch(/import\(['"]\.\/lib\/feedback\/FeedbackDialog\.svelte['"]\)/)
  })
})
