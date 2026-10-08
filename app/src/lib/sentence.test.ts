import { describe, expect, it } from 'vitest'
import { cadence, citation, datasetBlurb, exceedanceLine, fmtDay, fmtMd, fmtMonths, fmtRange, fmtYears, isStat, plural, producer, resolution, shortPlace, statLabel, variableWords } from './sentence'

const CRW = {
  providers: [{ name: 'NOAA Coral Reef Watch (CRW)', roles: ['producer', 'licensor'] }, { name: 'Ocean Metrics LLC', roles: ['processor'] }],
  'cube:dimensions': { time: { step: 'P1D' }, latitude: { step: 0.05 }, longitude: { step: 0.05 } },
  license: 'CC0-1.0',
}

describe('the title sentence, in words', () => {
  it('reads the assessment sentence for FKNMS × CRW SST', () => {
    const s = `${variableWords('sea surface temperature', 'CRW_SST')} (${datasetBlurb(CRW, 'P1D')}) in ` +
              `${shortPlace('Florida Keys National Marine Sanctuary')}, ${statLabel('mean_wt')} of ${plural(462, 'cell')}, ` +
              `${fmtRange('2026-09-07', '2026-10-06')}`
    expect(s).toBe('Sea surface temperature (NOAA Coral Reef Watch, 5 km, daily) in Florida Keys NMS, area-weighted mean of 462 cells, 7 Sep – 6 Oct 2026')
  })
  it('shortens sanctuaries and monuments, and leaves other names alone', () => {
    expect(shortPlace('Papahānaumokuākea Marine National Monument')).toBe('Papahānaumokuākea MNM')
    expect(shortPlace('Gulf of Maine')).toBe('Gulf of Maine')
  })
  it('puts words before codes, and drops the categorical note', () => {
    expect(variableWords('bleaching alert area (categorical, 0-4)', 'CRW_BAA')).toBe('Bleaching alert area')
    expect(variableWords('', 'CRW_SST')).toBe('CRW_SST')
    expect(variableWords("water temperature (measurement_type 'temperature')", 'temperature')).toBe('Water temperature')
    expect(variableWords(undefined, 'CLASS')).toBe('CLASS')
  })
  it('names the producer without its acronym, the grid in km or degrees, and the cadence', () => {
    expect(producer(CRW)).toBe('NOAA Coral Reef Watch')
    const prod = (name: string) => producer({ providers: [{ name, roles: ['producer'] }] })
    expect(prod('California Cooperative Oceanic Fisheries Investigations (CalCOFI)')).toBe('CalCOFI')
    expect(prod('NOAA Atlantic Oceanographic and Meteorological Laboratory (AOML)')).toBe('AOML')
    expect(prod('Copernicus Marine Service (CMEMS) / Mercator Ocean International')).toBe('Copernicus Marine Service')
    expect(prod('Oregon State University Ocean Productivity (VGPM, from NASA MODIS-Aqua)')).toBe('Oregon State University Ocean Productivity')
    expect(prod('NASA JPL PO.DAAC')).toBe('NASA JPL PO.DAAC')
    expect(resolution(CRW)).toBe('5 km')
    expect(resolution({ 'cube:dimensions': { longitude: { step: 0.01 } } })).toBe('1 km')
    expect(resolution({ 'cube:dimensions': { longitude: { step: 0.083333 } } })).toBe('9 km')
    expect(resolution({ 'cube:dimensions': { longitude: { step: 0.25 } } })).toBe('0.25°')
    expect(resolution({ 'cube:dimensions': { longitude: { step: null } } })).toBe('')
    expect(cadence('P1D')).toBe('daily'); expect(cadence('P8D')).toBe('8-day'); expect(cadence('P1M')).toBe('monthly')
    expect(cadence(undefined, 'irregular')).toBe('irregular')
    expect(datasetBlurb({ providers: [{ name: 'CalCOFI', roles: ['producer'] }] }, undefined, undefined, 'tabledap'))
      .toBe('CalCOFI, samples, monthly roll-up')
  })
  it('formats days, windows across a year end, month spans and days of the year', () => {
    expect(fmtDay('2026-10-06')).toBe('6 Oct 2026')
    expect(fmtRange('2025-12-28', '2026-01-06')).toBe('28 Dec 2025 – 6 Jan 2026')
    expect(fmtRange('2026-10-06', '2026-10-06')).toBe('6 Oct 2026')
    expect(fmtMonths('2021-10-08', '2026-10-06')).toBe('Oct 2021 – Oct 2026')
    expect(fmtMd('08-05')).toBe('5 Aug')
    expect(fmtYears('1985-2005')).toBe('1985–2005')
  })
  it('knows its statistics, and plurals', () => {
    expect(isStat('p90')).toBe(true); expect(isStat('median')).toBe(false)
    expect(plural(1, 'cell')).toBe('1 cell'); expect(plural(9780, 'cell')).toBe('9,780 cells')
  })
  it('says the Then vs Now headline in words', () => {
    expect(exceedanceLine(76.02, 1, '°C')).toBe('76 % of the sanctuary more than +1 °C warmer')
    expect(exceedanceLine(12, -1, '°C')).toBe('12 % of the sanctuary more than −1 °C cooler')
    expect(exceedanceLine(40, 1, 'mg m-3', 'the raster box')).toBe('40 % of the raster box more than +1 mg m-3 higher')
  })
  it('cites the dataset with its ERDDAP page, access date and licence', () => {
    const c = citation({ collection: CRW, title: 'NOAA Coral Reef Watch — Daily Global 5km SST + DHW', baseUrl: 'https://pae-paha.pacioos.hawaii.edu/erddap/',
      datasetId: 'dhw_5km' }, '2026-10-08')
    expect(c).toBe('NOAA Coral Reef Watch. NOAA Coral Reef Watch — Daily Global 5km SST + DHW (ERDDAP dataset dhw_5km). ' +
      'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.html, accessed 2026-10-08. Licence: CC0-1.0.')
    expect(citation({ collection: { links: [{ rel: 'cite-as', href: 'https://doi.org/10.48670/moi-00016' }] }, title: 'T', baseUrl: 'b', datasetId: 'd', protocol: 'tabledap' }, 'x'))
      .toContain('b/tabledap/d.html, accessed x. https://doi.org/10.48670/moi-00016')
  })
})
